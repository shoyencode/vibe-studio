import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CopilotHarness } from "../core/adapters/copilot.mjs";
import { Project } from "../core/project.mjs";
import { normalizeModels, modelFamily, policyFor, policyModels, appliedSettings, productionProvenance, validateSelection } from "../core/models.mjs";

const catalog = [
    { id: "claude-sonnet-5.5", name: "Sonnet", supportedContextTiers: ["default", "long_context"],
        capabilities: { limits: { max_context_window_tokens: 200000 } } },
    { id: "gpt-6-luna", name: "Luna" },
    { id: "gemini-3-pro", name: "Gemini" },
];
const offline = () => { throw new Error("Catalog timed out"); };

async function workspace(t) {
    const dir = await mkdtemp(path.join(process.cwd(), ".test-models-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

function copilot(t, { cacheDir, login = "alice", host = "github.com", listModels = async () => catalog, auth, ...options } = {}) {
    let calls = 0;
    const client = {
        start: async () => {}, stop: async () => {},
        getAuthStatus: async () => auth || { isAuthenticated: true, login, host },
        listModels: async () => { calls++; return listModels(); },
        rpc: { agents: { discover: async () => ({ agents: [] }) } },
    };
    const harness = new CopilotHarness({ createClient: async () => client, cacheDir, ...options });
    t.after(() => harness.stop());
    return { harness, client, calls: () => calls };
}

class Harness {
    constructor() { this.opened = []; this.sent = []; this.reads = 0; this.introspect = true; }
    status() { return { harness: "fake", connected: true }; }
    defaultModel() { return "claude-sonnet-5.5"; }
    async agents() { return [{ name: "writer", description: "Writes", model: "gpt-6-luna" }, { name: "private", userInvocable: false }]; }
    async models() { this.reads++; return catalog; }
    async openStep(options) {
        this.opened.push(options);
        const session = {
            sessionId: `s${this.opened.length}`,
            send: async prompt => { this.sent.push(prompt); return "message"; },
            abort: async () => {}, disconnect: async () => { this.disconnected = true; },
            ...(this.introspect ? { current: async () => this.current || { modelId: options.model, contextTier: options.contextTier } } : {}),
        };
        return session;
    }
}

async function fixture(t, harness = new Harness()) {
    const dir = await workspace(t);
    const kit = {
        kit: { id: "test" }, valid: true, language: "en", placeholders: {}, skills: { write: "write/SKILL.md", review: "review/SKILL.md" },
        skillHashes: {}, files: [{ path: "note.md", exists: true, hash: "note-v1" }], validations: {},
        contract: { steps: [
            { id: "write", scope: "project", skill: "write", agent: "writer", requires: [], title: "Write" },
            { id: "review", scope: "project", skill: "review", requires: ["note.md"], title: "Review" },
        ] },
    };
    const project = await new Project(dir, { harness, adapter: async () => kit, dataDir: path.join(dir, "data") }).init();
    t.after(() => project.dispose());
    return { dir, kit, project, harness };
}

test("model normalization offers only known tiers and labels only known token limits", () => {
    const models = normalizeModels([
        ...catalog,
        { id: "large-standard", capabilities: { limits: { max_context_window_tokens: 1000000 } } },
        { id: "explicit", contextTiers: [{ id: "default", tokens: 200000 }, { id: "long_context", tokens: 1000000 }, { id: "invented", tokens: 42 }] },
        { id: "billing", billing: { tokenPrices: { longContext: { input: 2 } } } },
        { id: "invalid-limit", contextTiers: [{ id: "default", tokens: -1 }] },
        { id: "gpt-6-luna" }, {},
    ]);
    assert.deepEqual(models[0].contextTiers, [{ id: "default" }, { id: "long_context" }]);
    assert.deepEqual(models.find(m => m.id === "large-standard").contextTiers, [{ id: "default", tokens: 1000000 }]);
    assert.deepEqual(models.find(m => m.id === "explicit").contextTiers, [{ id: "default", tokens: 200000 }, { id: "long_context", tokens: 1000000 }]);
    assert.deepEqual(models.find(m => m.id === "billing").contextTiers, [{ id: "default" }, { id: "long_context" }]);
    assert.deepEqual(models.find(m => m.id === "invalid-limit").contextTiers, [{ id: "default" }]);
    assert.equal(models.filter(m => m.id === "gpt-6-luna").length, 1);
});

test("a catalog survives restart and is usable without awaiting a slow refresh", { timeout: 5000 }, async t => {
    const cacheDir = await workspace(t);
    const first = copilot(t, { cacheDir });
    assert.deepEqual(await first.harness.models(), normalizeModels(catalog));
    assert.equal(first.harness.catalogStatus().source, "live");
    await first.harness.stop();
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const warm = copilot(t, { cacheDir, listModels: () => pending });
    await warm.harness.start();
    assert.deepEqual(await warm.harness.models(), normalizeModels(catalog));
    assert.equal(warm.harness.catalogStatus().source, "cache");
    const refresh = warm.harness.refreshModels();
    const secondRefresh = warm.harness.refreshModels();
    finish([{ id: "fresh" }]);
    assert.deepEqual(await refresh, await secondRefresh);
    assert.equal(warm.calls(), 1, "background and explicit refreshes share a single request");
    assert.equal(warm.harness.catalogStatus().source, "live");
    assert.deepEqual((await readdir(cacheDir)).filter(file => file.endsWith(".pending")), []);
    const saved = JSON.parse(await readFile(path.join(cacheDir, (await readdir(cacheDir))[0]), "utf8"));
    assert.equal(saved.version, 3);
    assert.equal(typeof saved.fetchedAt, "string");
    assert.equal(JSON.stringify(saved).includes("alice"), false, "identity is hashed, no credentials are persisted");
});

test("context choices use actual per-tier input budgets rather than the largest model window", () => {
    const models = normalizeModels([
        { id: "tiered", capabilities: { limits: { max_context_window_tokens: 1000000 } },
            billing: { tokenPrices: { maxPromptTokens: 200000, longContext: { maxPromptTokens: 936000 } } } },
        { id: "legacy", billing: { tokenPrices: { contextMax: 272000, longContext: { contextMax: 872000 } } } },
        { id: "input-only", contextTiers: [{ id: "default", maxInputTokens: 123000 }] },
    ]);
    assert.deepEqual(models[0].contextTiers, [{ id: "default", maxInputTokens: 200000 }, { id: "long_context", maxInputTokens: 936000 }]);
    assert.deepEqual(models[1].contextTiers, [{ id: "default", maxInputTokens: 272000 }, { id: "long_context", maxInputTokens: 872000 }]);
    assert.deepEqual(models[2].contextTiers, [{ id: "default", maxInputTokens: 123000 }]);
    assert.deepEqual(normalizeModels(models), models, "the disk cache preserves limits without relabelling input budgets as window capacities");
});

test("failed listing retains the last successful catalog and exposes source/date/error", async t => {
    const cacheDir = await workspace(t);
    const first = copilot(t, { cacheDir });
    await first.harness.models();
    const at = first.harness.catalogStatus().fetchedAt;
    const warm = copilot(t, { cacheDir, listModels: offline });
    assert.equal((await warm.harness.models()).length, catalog.length);
    await warm.harness.refreshModels();
    assert.deepEqual(warm.harness.catalogStatus(), { source: "cache", fetchedAt: at, error: "Catalog timed out" });
    assert.equal((await warm.harness.models()).length, catalog.length);
});

test("first explicit refresh and concurrent startup perform only one catalog fetch", async t => {
    const { harness, calls } = copilot(t);
    const [first, second] = await Promise.all([harness.refreshModels(), harness.refreshModels()]);
    assert.deepEqual(first, second);
    assert.equal(calls(), 1);
});

test("cache identities isolate accounts and endpoints", async t => {
    const cacheDir = await workspace(t);
    await copilot(t, { cacheDir }).harness.models();
    for (const identity of [{ login: "bob" }, { host: "enterprise.example" }, { endpoint: "https://other.example/api" }]) {
        const other = copilot(t, { cacheDir, ...identity, listModels: offline });
        assert.deepEqual(await other.harness.models(), []);
        assert.equal(other.harness.catalogStatus().source, "kit");
    }
    const same = copilot(t, { cacheDir, login: "ALICE", listModels: offline });
    assert.equal((await same.harness.models()).length, catalog.length);
});

test("corrupt, wrong-version and forged-capability caches are ignored and reported", async t => {
    const cacheDir = await workspace(t);
    await copilot(t, { cacheDir }).harness.models();
    const file = path.join(cacheDir, (await readdir(cacheDir))[0]);
    const valid = JSON.parse(await readFile(file, "utf8"));
    for (const broken of ["{broken", JSON.stringify({ ...valid, version: valid.version + 1 }),
        JSON.stringify({ ...valid, models: [{ id: "forged", name: "Forged", contextTiers: [{ id: "infinite" }] }] })]) {
        await writeFile(file, broken);
        const next = copilot(t, { cacheDir, listModels: offline });
        assert.deepEqual(await next.harness.models(), []);
        assert.match(next.harness.catalogStatus().error, /invalid/);
        assert.match(next.harness.catalogStatus().error, /timed out/);
    }
});

test("authentication and session errors are not disguised as catalog failures", async t => {
    const unauthenticated = copilot(t, { auth: { isAuthenticated: false } });
    await assert.rejects(unauthenticated.harness.models(), error => error.key === "harness.login");
    assert.equal(unauthenticated.harness.status().connected, false);
    assert.equal(unauthenticated.calls(), 0);
    const unavailable = copilot(t);
    unavailable.client.getAuthStatus = async () => { throw new Error("Auth service unavailable"); };
    await assert.rejects(unavailable.harness.start(), /Auth service unavailable/);
    const expired = copilot(t, { listModels: () => { throw Object.assign(new Error("Unauthorized"), { status: 401 }); } });
    await assert.rejects(expired.harness.models(), error => error.key === "harness.login");
    const sessionError = copilot(t);
    sessionError.client.createSession = async () => { throw new Error("Selected model is unavailable"); };
    await assert.rejects(sessionError.harness.openStep({ project: process.cwd(), model: "gpt-6-luna" }), /Selected model is unavailable/);
});

test("failed cold listing uses only kit declarations, with unverified standard contexts", async t => {
    const { harness } = copilot(t, { listModels: offline });
    const f = await fixture(t, harness);
    f.kit.contract.modelPolicies = { default: { default: "gpt-6-luna", models: ["gpt-6-luna", "claude-sonnet-5.5"] } };
    const options = await f.project.chatOptions();
    assert.deepEqual(options.models.map(model => model.id), ["gpt-6-luna", "claude-sonnet-5.5"]);
    assert.deepEqual(options.models.map(model => model.contextTiers), [[{ id: "default" }], [{ id: "default" }]]);
    assert.equal(options.catalog.source, "kit");
    assert.match(options.catalog.error, /timed out/);
    const draft = await f.project.prepare({ step: "review" });
    assert.equal(draft.model, "gpt-6-luna");
    assert.equal(draft.catalog.source, "kit");
});

test("a scalar agent model remains a usable first-boot kit declaration despite a catalog outage", async t => {
    const { harness, client } = copilot(t, { listModels: offline });
    harness.agents = async () => [{ name: "writer", model: "gpt-6-luna" }, { name: "unrelated", model: "not-in-kit" }];
    const f = await fixture(t, harness);
    let current;
    client.createSession = async options => {
        current = { modelId: options.model, contextTier: options.contextTier || "default" };
        return { sessionId: "offline-catalog-session", on: () => () => {}, abort: async () => {}, disconnect: async () => {},
            send: async () => "message", rpc: { agent: { select: async () => {} },
                model: { switchTo: async settings => { current = settings; }, getCurrent: async () => current } } };
    };
    assert.deepEqual((await f.project.chatOptions()).models.map(model => model.id), ["gpt-6-luna"]);
    const draft = await f.project.prepare({ step: "write" });
    const launched = await f.project.launch(draft.ticket);
    assert.equal(launched.sessionId, "offline-catalog-session");
    assert.equal((await f.project.store.read()).runs[0].model, "gpt-6-luna");
});

test("without a cache or kit declarations there are no selectable models and retry is explicit", async t => {
    let down = true;
    const { harness, calls } = copilot(t, { listModels: () => down ? offline() : catalog });
    const f = await fixture(t, harness);
    let options = await f.project.chatOptions();
    assert.deepEqual([options.models, options.defaultModel, options.catalog.source], [[], null, "kit"]);
    await assert.rejects(f.project.chat(), error => error.key === "model.none");
    await assert.rejects(f.project.prepare({ step: "review" }), error => error.key === "model.none");
    assert.equal(calls(), 1);
    down = false;
    options = await f.project.chatOptions({ refresh: true });
    assert.equal(options.models.length, catalog.length);
    assert.equal(options.catalog.source, "live");
    f.project.adapter = async () => { throw new Error("No kit installed"); };
    options = await f.project.chatOptions();
    assert.equal(options.models.length, catalog.length, "free conversations still work without a kit");
});

test("a missing kit cannot manufacture the adapter default during a listing outage", async t => {
    const { harness } = copilot(t, { listModels: offline });
    const f = await fixture(t, harness);
    f.project.adapter = async () => { throw new Error("No kit installed"); };
    assert.deepEqual((await f.project.chatOptions()).models, []);
    await assert.rejects(f.project.chat({ model: "claude-sonnet-5.5" }), error => error.key === "model.none");
});

test("policy priority is step, agent, kit default, then the historical scalar", () => {
    const kit = { contract: { modelPolicies: {
        default: { default: "kit", models: ["kit"] },
        agents: { writer: { default: "agent", models: ["agent"] } },
        steps: { write: { default: "step", models: ["step"], byProducerFamily: { anthropic: { default: "opposite", models: ["opposite"] } } } },
    } } };
    assert.equal(policyFor(kit, { id: "write" }, { name: "writer" }).default, "step");
    assert.equal(policyFor(kit, { id: "write" }, { name: "writer" }, "anthropic").default, "opposite");
    assert.equal(policyFor(kit, { id: "other" }, { name: "writer" }).default, "agent");
    assert.equal(policyFor(kit, { id: "other" }, null).default, "kit");
    const old = policyModels({ kit: { contract: {} }, step: {}, agent: { model: "gpt-6-luna" },
        models: normalizeModels(catalog), harness: new Harness() });
    assert.deepEqual(old.models.map(model => model.id), ["gpt-6-luna"]);
});

test("shortlists are mapped explicitly and deduplicated, never widened to the whole catalog", () => {
    const result = policyModels({ kit: { contract: { modelPolicies: { default: { default: "declared-a", models: ["declared-a", "declared-b"] } } } },
        step: {}, models: normalizeModels(catalog), harness: { resolveModel: () => "gpt-6-luna" }, source: "live" });
    assert.deepEqual(result.models.map(model => model.id), ["gpt-6-luna"]);
    assert.deepEqual(result.modelSwitches, [{ from: "declared-a", to: "gpt-6-luna" }, { from: "declared-b", to: "gpt-6-luna" }]);
    assert.equal(result.defaultModel, "gpt-6-luna");
    const unavailableDefault = policyModels({ kit: { contract: { modelPolicies: {
        default: { default: "missing", models: ["missing", "gpt-6-luna"] },
    } } }, step: {}, models: normalizeModels(catalog), harness: {}, source: "live" });
    assert.deepEqual(unavailableDefault.modelSwitches, [{ from: "missing", to: "gpt-6-luna" }]);
});

test("tickets capture allowed models and contexts; launch never refetches the catalog", async t => {
    const f = await fixture(t);
    f.kit.contract.modelPolicies = { default: { default: "gpt-6-luna", models: ["gpt-6-luna", "claude-sonnet-5.5"] } };
    const draft = await f.project.prepare({ step: "write" });
    assert.deepEqual(draft.models.map(model => model.id), ["gpt-6-luna", "claude-sonnet-5.5"]);
    const before = f.harness.reads;
    await f.project.launch(draft.ticket, [], { model: "claude-sonnet-5.5", contextTier: "long_context" });
    assert.equal(f.harness.reads, before);
    assert.deepEqual([f.harness.opened[0].model, f.harness.opened[0].contextTier], ["claude-sonnet-5.5", "long_context"]);
    const run = (await f.project.store.read()).runs[0];
    assert.deepEqual([run.model, run.contextTier, run.modelVerified, run.contextVerified], ["claude-sonnet-5.5", "long_context", true, true]);
    assert.match(f.harness.sent[0], /do not replace them with the agent's static defaults/);
    assert.match(f.harness.sent[0], /"model":"claude-sonnet-5.5","contextTier":"long_context"/);
});

test("launch rejects arbitrary IDs, invalid contexts, and changes to the confirmed policy", async t => {
    const f = await fixture(t);
    f.kit.contract.modelPolicies = { default: { default: "gpt-6-luna", models: ["gpt-6-luna", "claude-sonnet-5.5"] } };
    for (const selection of [{ model: "not-a-model" }, { model: "gemini-3-pro" }, { model: 42 }]) {
        const draft = await f.project.prepare({ step: "write" });
        await assert.rejects(f.project.launch(draft.ticket, [], selection), error => error.key === "model.unavailable");
    }
    for (const contextTier of ["long_context", "infinite", null]) {
        const draft = await f.project.prepare({ step: "write" });
        await assert.rejects(f.project.launch(draft.ticket, [], { contextTier }), error => error.key === "model.contextUnavailable");
    }
    const changed = await f.project.prepare({ step: "write" });
    f.kit.contract.modelPolicies.default.models.pop();
    await assert.rejects(f.project.launch(changed.ticket), error => error.key === "launch.kitChanged");
    assert.equal(f.harness.opened.length, 0);
});

test("legacy callers may omit selection or pass undefined model/context values", async t => {
    const f = await fixture(t);
    const draft = await f.project.prepare({ step: "write" });
    await f.project.launch(draft.ticket, [], { model: undefined, contextTier: undefined });
    assert.deepEqual([f.harness.opened[0].model, f.harness.opened[0].contextTier], ["gpt-6-luna", "default"]);
    const chat = await f.project.chat({ model: undefined, contextTier: undefined });
    assert.equal(f.project.chatList().find(item => item.sessionId === chat.sessionId).model, "claude-sonnet-5.5");
});

test("catalog units accept a noncontiguous selection without creating previous units", async t => {
    const f = await fixture(t);
    Object.assign(f.kit, { unitCatalog: true, units: [1, 5, 9], plannedUnits: [], unitDependencies: { 5: [9] } });
    f.kit.contract.steps[0].scope = "unit";
    const draft = await f.project.prepare({ step: "write", unit: 5 });
    assert.equal(draft.unit, 5, "planning has no artificial numerical predecessor/dependency requirement");
    await assert.rejects(f.project.prepare({ step: "write", unit: 4 }), error => error.key === "unit.invalid");
    f.kit.contract.steps[0].requires = ["unit-{n}/plan.md"];
    await assert.rejects(f.project.prepare({ step: "write", unit: 5 }), error => error.key === "prereq.missing");
    f.kit.unitCatalog = false;
    f.kit.contract.steps[0].requires = [];
    assert.equal((await f.project.prepare({ step: "write", unit: 4 })).unit, 4, "old kits retain numeric unit selection");
});

test("chat offers the whole catalog even with an agent and propagates the real context", async t => {
    const f = await fixture(t);
    f.kit.contract.modelPolicies = { agents: { writer: { default: "gpt-6-luna", models: ["gpt-6-luna"] } } };
    const options = await f.project.chatOptions();
    assert.equal(options.models.length, catalog.length);
    assert.deepEqual(options.agents.map(agent => agent.name), ["writer"]);
    assert.equal(options.defaultModel, "claude-sonnet-5.5");
    const chat = await f.project.chat({ model: "claude-sonnet-5.5", contextTier: "long_context", agent: "writer" });
    await f.project.sayToChat(chat.sessionId, "Hello");
    assert.deepEqual([f.harness.opened[0].model, f.harness.opened[0].contextTier, f.harness.opened[0].agent],
        ["claude-sonnet-5.5", "long_context", "writer"]);
    assert.equal(f.project.chatList()[0].contextTier, "long_context");
    await assert.rejects(f.project.chat({ model: "arbitrary-id" }), error => error.key === "model.unavailable");
    await assert.rejects(f.project.chat({ model: "gpt-6-luna", contextTier: "long_context" }), error => error.key === "model.contextUnavailable");
    await assert.rejects(f.project.chat({ contextTier: "other" }), error => error.key === "model.contextUnavailable");
});

test("Copilot re-applies model and explicit standard context after selecting an agent", async t => {
    const calls = [];
    const { harness, client } = copilot(t);
    let current = { modelId: "agent-default", contextTier: "long_context" };
    client.createSession = async () => ({
        sessionId: "runtime", rpc: { agent: { select: async () => calls.push("agent") },
            model: { switchTo: async selected => { calls.push(selected); current = selected; }, getCurrent: async () => current } },
        on: () => () => {}, disconnect: async () => {}, abort: async () => {}, send: async () => "sent",
    });
    const session = await harness.openStep({ project: process.cwd(), agent: "writer", model: "gpt-6-luna", contextTier: "default" });
    assert.deepEqual(calls, ["agent", { modelId: "gpt-6-luna", contextTier: "default" }]);
    assert.deepEqual(await session.current(), { modelId: "gpt-6-luna", contextTier: "default" });
    client.createSession = async () => ({
        sessionId: "bad", rpc: { agent: { select: async () => {} }, model: { switchTo: async () => { throw new Error("Switch failed"); } } },
        disconnect: async () => { calls.push("disconnected"); },
    });
    await assert.rejects(harness.openStep({ project: process.cwd(), agent: "writer", model: "gpt-6-luna" }), /Switch failed/);
    assert.equal(calls.at(-1), "disconnected");
});

test("effort capabilities survive normalization and selections reject unsupported values", () => {
        const models = normalizeModels([{ id: "reasoner", supportedReasoningEfforts: ["low", "high", "invented", "high"],
            defaultReasoningEffort: "low", contextTiers: [{ id: "default", maxInputTokens: 123000 }] }]);
        assert.deepEqual(models[0].supportedReasoningEfforts, ["low", "high"]);
        assert.deepEqual(normalizeModels(models), models);
        assert.deepEqual(validateSelection(models, { model: "reasoner" }, { reasoningEffort: "high" }),
            { model: "reasoner", contextTier: "default", reasoningEffort: "high", contextBudget: 123000 });
        assert.equal(validateSelection(models, { model: "reasoner" }).reasoningEffort, "low");
        assert.throws(() => validateSelection(models, { model: "reasoner" }, { reasoningEffort: "max" }), error => error.key === "model.effortUnavailable");
        assert.throws(() => validateSelection(normalizeModels([{ id: "unknown" }]), { model: "unknown" }, { reasoningEffort: "high" }),
            error => error.key === "model.effortUnavailable");
        assert.deepEqual(normalizeModels([{ id: "codex", supportedReasoningEfforts: [{ reasoningEffort: "minimal" }, { reasoningEffort: "high" }] }])[0].supportedReasoningEfforts,
            ["minimal", "high"]);
    });

    test("step and chat efforts are persisted without inventing runtime verification", async t => {
        const f = await fixture(t);
        f.harness.models = async () => [{ id: "gpt-6-luna", supportedReasoningEfforts: ["low", "high"],
            contextTiers: [{ id: "default", maxInputTokens: 123000 }] }];
        const draft = await f.project.prepare({ step: "write" });
        await f.project.launch(draft.ticket, [], { reasoningEffort: "high" });
        const run = (await f.project.store.read()).runs[0];
        assert.equal(run.reasoningEffort, "high"); assert.equal(run.effortVerified, false);
        assert.equal(run.contextBudget, 123000);
        assert.equal(f.harness.opened[0].reasoningEffort, "high");
        const chat = await f.project.chat({ reasoningEffort: "low" });
        await f.project.sayToChat(chat.sessionId, "Hello");
        assert.equal(f.project.chatList()[0].reasoningEffort, "low");
        assert.equal(f.project.chatList()[0].contextBudget, 123000);
        const actual = await appliedSettings({ current: async () => ({ reasoningEffort: "medium" }) },
            { model: "gpt-6-luna", reasoningEffort: "high" });
        assert.equal(actual.requestedReasoningEffort, "high");
        assert.equal(actual.reasoningEffort, "medium");
        assert.equal(actual.effortVerified, true);
    });

    test("Copilot applies explicit effort after agent selection as well as at session creation", async t => {
        const { harness, client } = copilot(t);
        const calls = [];
        client.createSession = async options => {
            assert.equal(options.reasoningEffort, "high");
            return { sessionId: "effort", rpc: { agent: { select: async () => calls.push("agent") },
                model: { switchTo: async () => calls.push("model"), setReasoningEffort: async value => calls.push(value) } },
                on: () => () => {}, disconnect: async () => {} };
        };
        await harness.openStep({ project: process.cwd(), model: "gpt-6-luna", agent: "writer", reasoningEffort: "high" });
        assert.deepEqual(calls, ["agent", "model", { reasoningEffort: "high" }]);
    });

    test("manual corrections refuse live step writes and forward the file revision otherwise", async t => {
        const f = await fixture(t);
        const draft = await f.project.prepare({ step: "write" });
        await f.project.launch(draft.ticket);
        const run = (await f.project.store.read()).runs[0];
        await f.project.store.change(data => { data.runs[0].unit = 1; });
        await assert.rejects(f.project.correction({ unit: 1, id: "R01", action: "delete", revision: "hash" }), error => error.key === "feedback.busy");
        await f.project.close(run.id);
        let forwarded;
        f.project.adapter = async (_, command, input) => { forwarded = { command, input }; return { written: true }; };
        await f.project.correction({ unit: 1, id: "R01", action: "delete", revision: "hash" });
        assert.equal(forwarded.command, "correction");
        assert.equal(forwarded.input.revision, "hash");
    });

test("actual runtime values are recorded before prompting and no fake verification is invented", async t => {
    const f = await fixture(t);
    f.harness.current = { modelId: "claude-sonnet-5.5", contextTier: "default" };
    const draft = await f.project.prepare({ step: "write" });
    await f.project.launch(draft.ticket);
    const run = (await f.project.store.read()).runs[0];
    assert.equal(run.model, "claude-sonnet-5.5");
    assert.equal(run.requestedModel, "gpt-6-luna");
    assert.equal(run.modelFamily, "anthropic");
    assert.match(f.harness.sent[0], /"model":"claude-sonnet-5.5"/);
    const unverified = await appliedSettings({}, { model: "gpt-6-luna", contextTier: "default" });
    assert.deepEqual([unverified.modelVerified, unverified.contextVerified], [false, false]);
    assert.deepEqual(await appliedSettings({ current: async () => ({}) }, { model: "gpt-6-luna", contextTier: "default" }), unverified);
    const alias = await appliedSettings({ current: async () => ({ modelId: "sonnet" }) }, { model: "sonnet", contextTier: "default" }, "claude");
    assert.equal(alias.modelFamily, "anthropic");
});

test("introspection errors abort before a prompt instead of claiming requested settings were verified", async t => {
    const f = await fixture(t);
    f.harness.openStep = async () => ({ sessionId: "broken", current: async () => { throw new Error("Runtime unavailable"); },
        disconnect: async () => { f.harness.disconnected = true; } });
    const draft = await f.project.prepare({ step: "write" });
    await assert.rejects(f.project.launch(draft.ticket), /Runtime unavailable/);
    assert.equal(f.harness.disconnected, true);
    assert.equal((await f.project.store.read()).runs.length, 0);
});

test("reported files carry their verified producer and reviewer policies use that family", async t => {
    const f = await fixture(t);
    f.kit.contract.modelPolicies = { steps: { review: {
        default: "claude-sonnet-5.5", models: ["claude-sonnet-5.5"],
        byProducerFamily: { openai: { default: "claude-sonnet-5.5", models: ["claude-sonnet-5.5"] },
            anthropic: { default: "gpt-6-luna", models: ["gpt-6-luna"] } },
    } } };
    const write = await f.project.prepare({ step: "write" });
    const { runId, sessionId } = await f.project.launch(write.ticket);
    f.kit.files[0].hash = "newly-produced";
    await f.project.report({ runId, status: "produced", paths: ["note.md"] }, sessionId);
    const saved = (await f.project.store.read()).runs[0];
    assert.deepEqual(saved.evidence[0].producer, { model: "gpt-6-luna", family: "openai", contextTier: "default" });
    await f.project.event(sessionId, { type: "session.idle" });
    const review = await f.project.prepare({ step: "review" });
    assert.deepEqual(review.models.map(model => model.id), ["claude-sonnet-5.5"]);
    await f.project.launch(review.ticket);
    assert.match(f.harness.sent[1], /"producer":\{"model":"gpt-6-luna","family":"openai"/);
    const older = productionProvenance(f.kit, f.kit.contract.steps[1], null,
        [{ model: "pretend-default", evidence: [{ path: "note.md", hash: "newly-produced" }] }], pattern => pattern);
    assert.equal(older[0].producer, undefined, "legacy run defaults are never evidence of authorship");
    f.kit.files[0].hash = "changed-after-production";
    const stale = productionProvenance(f.kit, f.kit.contract.steps[1], null, [saved], pattern => pattern);
    assert.equal(stale[0].producer, undefined, "changed files cannot inherit a former author's metadata");
});

test("review routing uses the build author rather than the authors of shared configuration or plans", () => {
    const kit = { contract: { modules: { review: { buildStep: "build", reviewStep: "review" }, tasks: { file: "tasks.md" } } },
        files: [{ path: "config.yml", exists: true, hash: "config" }, { path: "tasks.md", exists: true, hash: "tasks" }] };
    const build = { step: "build", unit: 5, evidence: [{ path: "tasks.md", hash: "tasks", producer: { model: "gpt-6-luna", family: "openai" } }] };
    const config = { step: "configure", unit: null, evidence: [{ path: "config.yml", hash: "config",
        producer: { model: "claude-sonnet-5.5", family: "anthropic" } }] };
    const step = { id: "review", requires: ["config.yml", "tasks.md"] };
    const known = productionProvenance(kit, step, 5, [config, build], pattern => pattern);
    assert.deepEqual(known.map(item => item.producer?.family), ["openai"]);
    const legacy = productionProvenance(kit, step, 5, [config], pattern => pattern);
    assert.deepEqual(legacy, [{ path: "tasks.md", hash: "tasks" }], "an unrecorded build cannot inherit the configuration author's model");
    const otherUnit = productionProvenance(kit, step, 9, [config, build], pattern => pattern);
    assert.equal(otherUnit[0].producer, undefined);
});

test("author family is unknown when output was reported by an adapter without model introspection", async t => {
    const f = await fixture(t);
    f.harness.introspect = false;
    const draft = await f.project.prepare({ step: "write" });
    const { runId, sessionId } = await f.project.launch(draft.ticket);
    f.kit.files[0].hash = "newly-produced";
    await f.project.report({ runId, status: "produced", paths: ["note.md"] }, sessionId);
    const run = (await f.project.store.read()).runs[0];
    assert.equal(run.modelVerified, false);
    assert.equal(run.evidence[0].producer, undefined);
    assert.equal(modelFamily("unknown-id"), "unknown");
    assert.equal(modelFamily("gemini-3-pro"), "google");
});

test("top-level usage updates actual provenance but nested subagents do not replace it", async t => {
    const f = await fixture(t);
    const draft = await f.project.prepare({ step: "write" });
    const { sessionId, runId } = await f.project.launch(draft.ticket);
    await f.project.event(sessionId, { type: "assistant.usage", data: { model: "claude-sonnet-5.5" } });
    await f.project.event(sessionId, { type: "assistant.usage", agentId: "nested", data: { model: "gpt-6-luna" } });
    f.kit.files[0].hash = "newly-produced";
    await f.project.report({ runId, status: "produced", paths: ["note.md"] }, sessionId);
    const run = (await f.project.store.read()).runs[0];
    assert.equal(run.model, "claude-sonnet-5.5");
    assert.equal(run.evidence[0].producer.family, "anthropic");
});

test("reporting an unchanged old file never claims the current model is its author", async t => {
    const f = await fixture(t);
    const draft = await f.project.prepare({ step: "write" });
    const { runId, sessionId } = await f.project.launch(draft.ticket);
    await f.project.report({ runId, status: "produced", paths: ["note.md"] }, sessionId);
    assert.equal((await f.project.store.read()).runs[0].evidence[0].producer, undefined);
    f.kit.files[0].hash = "actually-written";
    await f.project.report({ runId, status: "produced", paths: ["note.md"] }, sessionId);
    assert.equal((await f.project.store.read()).runs[0].evidence[0].producer.family, "openai");
    await f.project.event(sessionId, { type: "assistant.usage", data: { model: "claude-sonnet-5.5" } });
    await f.project.report({ runId, status: "produced", paths: ["note.md"] }, sessionId);
    assert.equal((await f.project.store.read()).runs[0].evidence[0].producer.family, "openai", "an unchanged reported file retains its actual producer");
});

test("explicitly inventoried originals are allowed but containment and format checks remain", async t => {
    const f = await fixture(t);
    await mkdir(path.join(f.dir, "sources"));
    await writeFile(path.join(f.dir, "sources", "original.docx"), "document");
    await writeFile(path.join(f.dir, "sources", "unlisted.pdf"), "not inventoried");
    f.kit.originals = ["sources/original.docx", "../outside.pdf", "run.exe"];
    assert.equal(await f.project.originalFile("sources/original.docx"), path.join(f.dir, "sources", "original.docx"));
    await assert.rejects(f.project.originalFile("sources/unlisted.pdf"), error => error.key === "preview.forbidden");
    await assert.rejects(f.project.originalFile("run.exe"), error => error.key === "files.formatDenied");
    const outside = await workspace(t);
    await writeFile(path.join(outside, "outside.pdf"), "outside");
    const relative = path.relative(f.dir, path.join(outside, "outside.pdf"));
    f.kit.originals.push(relative);
    await assert.rejects(f.project.originalFile(relative), error => error.key === "preview.forbidden");
    try { await symlink(path.join(outside, "outside.pdf"), path.join(f.dir, "sources", "linked.pdf")); }
    catch (error) { if (error.code === "EPERM") return; throw error; }
    f.kit.originals.push("sources/linked.pdf");
    await assert.rejects(f.project.originalFile("sources/linked.pdf"), error => error.key === "preview.forbidden");
});
