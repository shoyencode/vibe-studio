import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexHarness, RpcPeer, canonicalChange, kitAgents, parseToml, resolveCodex, skillOf } from "../core/adapters/codex.mjs";
import { decide, prepareRules } from "../core/guards.mjs";

const SHELL = process.platform === "win32" ? "powershell" : "bash";
const tick = () => new Promise(resolve => setImmediate(resolve));
const MODELS = [
    { id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", isDefault: true, hidden: false, inputModalities: ["text", "image"] },
    { id: "gpt-6-luna", model: "gpt-6-luna", displayName: "GPT-6-Luna", isDefault: false, hidden: false, inputModalities: ["text", "image"],
        supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "low" },
    { id: "gpt-5.6-terra", model: "gpt-5.6-terra", displayName: "GPT-5.6-Terra", isDefault: false, hidden: false, inputModalities: ["text"] },
    { id: "secret", model: "secret", displayName: "Hidden", isDefault: false, hidden: true, inputModalities: ["text"] },
];

// In-memory app-server: answers the requests of the adapter and plays the notifications and requests of Codex.
class FakeCodex {
    constructor({ account = { type: "chatgpt", email: "me@example.com", planType: "plus" }, modelFailures = 0 } = {}) {
        this.account = account; this.modelFailures = modelFailures;
        this.requests = []; this.notifications = []; this.waiting = new Map(); this.closeListeners = []; this.next = 1; this.turns = 0;
    }
    transport() {
        return {
            send: message => this.receive(message),
            onMessage: listener => { this.toClient = listener; },
            onClose: listener => this.closeListeners.push(listener),
            close: async () => { this.closedByClient = true; },
        };
    }
    of(method) { return this.requests.filter(request => request.method === method); }
    handle(method, params) {
        switch (method) {
            case "initialize": return { userAgent: "fake", codexHome: "x", platformFamily: "windows", platformOs: "windows" };
            case "account/read": return { account: this.account, requiresOpenaiAuth: true };
            case "model/list":
                if (this.modelFailures-- > 0) throw new Error("catalog timed out");
                return { data: MODELS, nextCursor: null };
            case "thread/start": return { thread: { id: "thread-1" }, model: params.model };
            case "turn/start": return { turn: { id: `turn-${++this.turns}`, status: "inProgress", items: [] } };
            default: return {};
        }
    }
    receive(message) {
        if (message.method && message.id !== undefined) {
            this.requests.push(message);
            let reply;
            try { reply = { id: message.id, result: this.handle(message.method, message.params) }; }
            catch (error) { reply = { id: message.id, error: { code: -32603, message: error.message } }; }
            queueMicrotask(() => this.toClient(reply));
        } else if (message.method) this.notifications.push(message);
        else this.waiting.get(message.id)?.(message);
    }
    notify(method, params) { this.toClient({ method, params }); }
    request(method, params) {
        const id = `server-${this.next++}`;
        return new Promise(resolve => { this.waiting.set(id, resolve); this.toClient({ id, method, params }); });
    }
    close(error) { for (const listener of this.closeListeners) listener(error); }
}

function harnessWith(fake, ui = {}) {
    return new CodexHarness({ ui, createTransport: async () => fake.transport() });
}

test("Codex forwards the selected effort on every turn", async t => {
    const fake = new FakeCodex(), harness = harnessWith(fake);
    t.after(() => harness.stop());
    assert.equal((await harness.models()).find(model => model.id === "gpt-6-luna").defaultReasoningEffort, "low");
    const session = await harness.openStep({ project: await kitProject(t), model: "gpt-6-luna", reasoningEffort: "high" });
    await session.send("Hello");
    assert.equal(fake.of("turn/start")[0].params.effort, "high");
    fake.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    await tick();
    await session.send("Again");
    assert.equal(fake.of("turn/start")[1].params.effort, "high");
});

async function kitProject(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vibe_studio-codex-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(path.join(dir, ".codex", "agents"), { recursive: true });
    await mkdir(path.join(dir, ".github", "agents"), { recursive: true });
    await writeFile(path.join(dir, ".codex", "agents", "demo-writer.toml"),
        'name = "demo-writer"\ndescription = "Writer: notes"\ndeveloper_instructions = "# Demo writer\\n\\nAsk with `ask_user`."\n');
    await writeFile(path.join(dir, ".github", "agents", "demo-writer.agent.md"), '---\nname: demo-writer\ndescription: "Writer"\nmodel: gpt-6-luna\ntools: ["read"]\n---\n\n# Copilot body\n');
    await writeFile(path.join(dir, ".github", "agents", "reviewer.agent.md"), '---\nname: reviewer\ndescription: Reviewer\nmodel: claude-haiku-4.5\nuser-invocable: false\n---\n\n# Reviewer\n');
    return dir;
}

async function openSession(t, { ui = {}, hooks, tools = [] } = {}) {
    const dir = await kitProject(t);
    const fake = new FakeCodex();
    const events = [];
    const harness = harnessWith(fake, ui);
    const handle = await harness.openStep({ project: dir, agent: "demo-writer", model: "gpt-6-luna", contextTier: "default", tools, hooks,
        mode: "interactive", onEvent: event => events.push(event) });
    return { dir, fake, harness, handle, events };
}

test("start checks the sign-in through the app-server and lists the models of Codex", async () => {
    const fake = new FakeCodex();
    const harness = harnessWith(fake);
    assert.deepEqual(await harness.start(), { login: "me@example.com" });
    const init = fake.of("initialize")[0].params;
    assert.equal(init.capabilities.experimentalApi, true, "dynamic tools need the experimental API");
    assert.ok(fake.notifications.some(n => n.method === "initialized"));
    const models = await harness.models();
    assert.deepEqual(models.map(m => m.id), ["gpt-6.1-sol", "gpt-6-luna", "gpt-5.6-terra"]);
    assert.equal(harness.status().harness, "codex");
    assert.equal(harness.status().connected, true);
    assert.equal(harness.defaultModel(), "gpt-6.1-sol");
    assert.equal(harness.resolveModel("gpt-6-luna"), "gpt-6-luna");
    assert.equal(harness.resolveModel("gpt-7-terra"), "gpt-5.6-terra", "same variant of another generation");
    assert.equal(harness.resolveModel("claude-opus-5.5"), "gpt-6.1-sol");
    assert.equal(harness.resolveModel("claude-haiku-4.5"), "gpt-6-luna", "a light model for a light one");
    assert.equal(harness.resolveModel("gemini-3.8-flash"), "gpt-6-luna");
    assert.equal(harness.resolveModel("gemini-4-argon"), "gpt-6.1-sol");
    await harness.stop();
    assert.equal(harness.status().connected, false);
    assert.equal(fake.closedByClient, true);
});

test("an unknown default model falls back to the default of the catalog", async () => {
    const harness = new CodexHarness({ model: "gpt-0", createTransport: async () => new FakeCodex().transport() });
    await harness.models();
    assert.equal(harness.defaultModel(), "gpt-6.1-sol");
});

test("not signed in, missing CLI and slow catalog give the errors of the Vibe Studio", async t => {
    await assert.rejects(harnessWith(new FakeCodex({ account: null })).start(), error => error.key === "harness.login");
    const missing = new CodexHarness({ command: path.join(os.tmpdir(), "no-such-folder", "codex.exe") });
    await assert.rejects(missing.start(), error => error.key === "harness.missing" && error.vars.name === "Codex CLI");
    const crashed = new FakeCodex();
    const spawnFailure = new CodexHarness({ createTransport: async () => ({ ...crashed.transport(),
        send: () => queueMicrotask(() => crashed.close(Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }))) }) });
    await assert.rejects(spawnFailure.start(), error => error.key === "harness.missing");
    const flaky = new FakeCodex({ modelFailures: 1 });
    assert.equal((await harnessWith(flaky).models()).length, 3, "one failure, one retry");
    const down = new FakeCodex({ modelFailures: 9 });
    await assert.rejects(harnessWith(down).models(), error => error.key === "harness.network");
    void t;
});

test("the native binary is found behind the npm launcher on Windows", async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vibe_studio-codex-bin-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pkg = path.join(dir, "node_modules", "@openai", "codex");
    const bin = path.join(pkg, "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "codex.exe"), "");
    await writeFile(path.join(dir, "codex.cmd"), "@echo off\n");
    const found = resolveCodex({ env: { PATH: `${path.join(dir, "missing")};${dir}` }, platform: "win32", arch: "x64" });
    assert.equal(found.file, path.join(bin, "codex.exe"));
    assert.equal(found.env.CODEX_MANAGED_BY_NPM, "1");
    assert.equal(found.env.CODEX_MANAGED_PACKAGE_ROOT, pkg);
    assert.equal(resolveCodex({ env: { PATH: path.join(dir, "missing") }, platform: "win32", arch: "x64" }), null);
    assert.equal(resolveCodex({ command: path.join(dir, "codex.cmd"), platform: "win32", arch: "x64" }).file, path.join(bin, "codex.exe"));
});

test("the agents of the kit are read from .codex/agents, with the Copilot files as fallback", async t => {
    const dir = await kitProject(t);
    const raw = kitAgents(dir);
    assert.deepEqual(raw.map(a => [a.name, a.prompt.trim(), a.model, a.userInvocable]),
        [["demo-writer", "# Demo writer\n\nAsk with `ask_user`.", "gpt-6-luna", true], ["reviewer", "# Reviewer", "claude-haiku-4.5", false]]);
    const harness = harnessWith(new FakeCodex());
    const agents = await harness.agents(dir);
    assert.deepEqual(agents.map(a => [a.name, a.model]), [["demo-writer", "gpt-6-luna"], ["reviewer", "gpt-6-luna"]], "models resolved to Codex models");
    assert.equal(agents[0].file, undefined);
    assert.deepEqual(parseToml('# c\nname = \'x\'\nlist = ["a", "b"]\nflag = true\nbody = """\nline "1"\n[not a table]\n"""\n[table]\nname = "y"\n'),
        { name: "x", list: ["a", "b"], flag: true, body: 'line "1"\n[not a table]\n' });
});

test("a session starts a thread with the agent prompt, the Vibe Studio tools and an approval for every write", async t => {
    const report = { name: "vibe_studio_report", description: "Report", parameters: { type: "object", properties: { status: { type: "string" } } },
        handler: async (input, { sessionId }) => JSON.stringify({ recorded: true, input, sessionId }) };
    const { fake, handle, harness } = await openSession(t, { tools: [report] });
    const params = fake.of("thread/start")[0].params;
    assert.equal(handle.sessionId, "thread-1");
    assert.equal(params.approvalPolicy, "untrusted");
    assert.equal(params.sandbox, "workspace-write");
    assert.equal(params.model, "gpt-6-luna");
    assert.match(params.developerInstructions, /^# Demo writer/);
    assert.match(params.developerInstructions, /ask_user/);
    assert.deepEqual(params.dynamicTools.map(tool => tool.name), ["vibe_studio_report", "ask_user"]);
    assert.deepEqual(params.dynamicTools[0].inputSchema, report.parameters);
    const result = await fake.request("item/tool/call", { threadId: "thread-1", turnId: "turn-1", callId: "c1", namespace: null, tool: "vibe_studio_report", arguments: { status: "started" } });
    assert.equal(result.result.success, true);
    assert.deepEqual(JSON.parse(result.result.contentItems[0].text), { recorded: true, input: { status: "started" }, sessionId: "thread-1" });
    report.handler = async () => ({ resultType: "failure", textResultForLlm: "Report not recorded" });
    const failed = await fake.request("item/tool/call", { threadId: "thread-1", turnId: "turn-1", callId: "c2", namespace: null, tool: "vibe_studio_report", arguments: {} });
    assert.deepEqual(failed.result, { contentItems: [{ type: "inputText", text: "Report not recorded" }], success: false });
    assert.equal(harness.status().busy, true);
    await assert.rejects(harness.openStep({ project: params.cwd, agent: "nobody", model: "gpt-6-luna", tools: [] }), error => error.key === "agent.unavailable");
});

test("questions go to the Vibe Studio through ask_user and the native question request", async t => {
    const asked = [];
    const ui = { question: async ({ sessionId, request }) => { asked.push([sessionId, request]); return { answer: request.choices[0] || "libre", wasFreeform: false }; } };
    const { fake, events } = await openSession(t, { ui });
    const reply = await fake.request("item/tool/call", { threadId: "thread-1", turnId: "t", callId: "q", tool: "ask_user", arguments: { question: "Which topic?", choices: ["A", "B"], allow_freeform: false } });
    assert.deepEqual(reply.result, { contentItems: [{ type: "inputText", text: "A" }], success: true });
    assert.deepEqual(asked[0], ["thread-1", { question: "Which topic?", choices: ["A", "B"], allowFreeform: false }]);
    assert.deepEqual(events.map(e => e.type), ["user_input.requested", "user_input.completed"]);
    const native = await fake.request("item/tool/requestUserInput", { threadId: "thread-1", turnId: "t", itemId: "i", isBlocking: true, autoResolutionMs: null,
        questions: [{ id: "q1", header: "Scope", question: "Keep it?", isOther: true, isSecret: false, options: [{ label: "Yes", description: "" }] }] });
    assert.deepEqual(native.result, { answers: { q1: { answers: ["Yes"] } } });
    assert.deepEqual(asked[1][1], { question: "Scope\nKeep it?", choices: ["Yes"], allowFreeform: true });
});

test("a guard refuses a write and a command before they run, and the model gets the reason", async t => {
    const permissions = [];
    const calls = [];
    const contract = { guards: { readOnly: [{ id: "frozen", paths: ["work/note.md"], reason: "The note is frozen." }],
        confirmCommands: [{ id: "push", commands: ["git push"], reason: "Pushing needs a confirmation." }] } };
    const ui = { permission: async ({ request }) => { permissions.push(request); return "approve"; } };
    let dir;
    const hooks = { onPreToolUse: async input => {
        calls.push(input);
        const verdict = decide(input, { project: dir, rules: prepareRules(contract, null, p => p), suspended: new Set(), tasks: null, allowedSkills: new Set() });
        return verdict ? { permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } : undefined;
    } };
    const opened = await openSession(t, { ui, hooks });
    dir = opened.dir;
    const { fake, events } = opened;
    const note = path.join(dir, "work", "note.md");
    fake.notify("item/started", { threadId: "thread-1", turnId: "turn-1", startedAtMs: 0,
        item: { type: "fileChange", id: "p1", status: "inProgress", changes: [{ path: note, kind: { type: "update", move_path: null }, diff: "@@\n-old\n+new\n" }] } });
    const write = await fake.request("item/fileChange/requestApproval", { threadId: "thread-1", turnId: "turn-1", itemId: "p1", startedAtMs: 0 });
    assert.deepEqual(write.result, { decision: "decline" });
    assert.deepEqual(calls[0], { toolName: "edit", toolArgs: { path: note, old_str: "old", new_str: "new" } });
    assert.equal(permissions.length, 0, "a denied write never reaches the user");
    await tick();
    const steer = fake.of("turn/steer")[0].params;
    assert.equal(steer.expectedTurnId, "turn-1");
    assert.match(steer.input[0].text, /The note is frozen\./);

    const command = await fake.request("item/commandExecution/requestApproval", { threadId: "thread-1", turnId: "turn-1", itemId: "c1", startedAtMs: 0,
        kind: "command", environmentId: null, command: "Remove-Item work/note.md", cwd: dir });
    assert.deepEqual(command.result, { decision: "decline" });
    assert.deepEqual(calls[1], { toolName: SHELL, toolArgs: { command: "Remove-Item work/note.md" } });
    const asked = await fake.request("item/commandExecution/requestApproval", { threadId: "thread-1", turnId: "turn-1", itemId: "c2", startedAtMs: 0,
        kind: "command", environmentId: null, command: "git push", cwd: dir, reason: "Publish" });
    assert.deepEqual(asked.result, { decision: "accept" }, "an ask verdict goes to the user, who approves here");
    assert.deepEqual(permissions[0], { kind: "shell", fullCommandText: "git push", intention: "Publish", canOfferSessionApproval: true });
    assert.deepEqual(events.filter(e => e.type.startsWith("permission.")).map(e => e.type), ["permission.requested", "permission.completed"]);

    const other = path.join(dir, "work", "other.md");
    fake.notify("item/started", { threadId: "thread-1", turnId: "turn-1", startedAtMs: 0,
        item: { type: "fileChange", id: "p2", status: "inProgress", changes: [{ path: other, kind: { type: "add" }, diff: "# Other\n" }] } });
    const created = await fake.request("item/fileChange/requestApproval", { threadId: "thread-1", turnId: "turn-1", itemId: "p2", startedAtMs: 0 });
    assert.deepEqual(created.result, { decision: "accept" });
    assert.deepEqual(calls.at(-1), { toolName: "create", toolArgs: { path: other, file_text: "# Other\n" } });
    assert.equal(permissions.at(-1).kind, "write");
    assert.equal(permissions.at(-1).fileName, other);
});

test("user answers map to the decisions of Codex, and a session approval is kept by the Vibe Studio", async t => {
    const answers = ["approve-session", { reject: "Not now" }];
    const seen = [];
    const ui = { permission: async ({ request }) => { seen.push(request.kind); return answers.shift(); } };
    const hooks = { onPreToolUse: async () => undefined };
    const { fake } = await openSession(t, { ui, hooks });
    const ask = (itemId, command) => fake.request("item/commandExecution/requestApproval", { threadId: "thread-1", turnId: "turn-1", itemId, startedAtMs: 0, kind: "command", environmentId: null, command });
    assert.deepEqual((await ask("a", "npm test")).result, { decision: "accept" });
    assert.deepEqual((await ask("b", "npm test")).result, { decision: "accept" }, "approved for the session");
    assert.deepEqual((await ask("c", "npm run build")).result, { decision: "decline" });
    assert.deepEqual(seen, ["shell", "shell"]);
    await tick();
    assert.match(fake.of("turn/steer")[0].params.input[0].text, /Not now/);
    const elicitation = await fake.request("mcpServer/elicitation/request", { threadId: "thread-1", turnId: "turn-1", serverName: "playwright", mode: "form",
        _meta: null, message: "Allow browser_navigate?", requestedSchema: { type: "object", properties: {} } });
    assert.deepEqual(elicitation.result, { action: "decline", content: null, _meta: null }, "no answer left: refused");
    const unknown = await fake.request("attestation/generate", { threadId: "thread-1" });
    assert.equal(unknown.error.code, -32601);
});

test("loading a skill meets the skill guard", async t => {
    const calls = [];
    const hooks = { onPreToolUse: async input => { calls.push(input); return input.toolName === "skill" ? { permissionDecision: "deny", permissionDecisionReason: "Not this step." } : undefined; } };
    const { fake } = await openSession(t, { hooks, ui: { permission: async () => "approve" } });
    const command = 'Get-Content -Raw ".agents\\skills\\demo-2-explore-topic\\SKILL.md"';
    assert.equal(skillOf(command), "demo-2-explore-topic");
    fake.notify("item/started", { threadId: "thread-1", turnId: "turn-1", startedAtMs: 0,
        item: { type: "commandExecution", id: "s1", command, cwd: ".", processId: null, source: "agent", status: "inProgress", commandActions: [] } });
    const reply = await fake.request("item/commandExecution/requestApproval", { threadId: "thread-1", turnId: "turn-1", itemId: "s1", startedAtMs: 0, kind: "command", environmentId: null, command });
    assert.deepEqual(reply.result, { decision: "decline" });
    assert.deepEqual(calls.filter(c => c.toolName === "skill"), [{ toolName: "skill", toolArgs: { skill: "demo-2-explore-topic" } }], "checked once");
    await tick();
    assert.match(fake.of("turn/steer")[0].params.input[0].text, /skill demo-2-explore-topic: Not this step\./);
});

test("events are normalised, the stop hook continues the turn and the usage is reported", async t => {
    const stops = [];
    const verdicts = [{ decision: "block", reason: "Report the step first." }, undefined];
    const hooks = { onAgentStop: async input => { stops.push(input); return verdicts.shift(); } };
    const { fake, handle, events } = await openSession(t, { hooks });
    const image = path.join(os.tmpdir(), "shot.png"), doc = path.join(os.tmpdir(), "brief.docx");
    const messageId = await handle.send("Go", [{ type: "file", path: image, displayName: "shot.png" }, { type: "file", path: doc, displayName: "brief.docx" }]);
    assert.equal(typeof messageId, "string");
    const turn = fake.of("turn/start")[0].params;
    assert.equal(turn.threadId, "thread-1");
    assert.equal(turn.clientUserMessageId, messageId);
    assert.match(turn.input[0].text, /^Go\n\nAttached files[\s\S]*brief\.docx/);
    assert.deepEqual(turn.input[1], { type: "localImage", path: image });
    await handle.send("Queued while busy");
    assert.equal(fake.of("turn/start").length, 1, "a message sent during a turn waits for its end");

    fake.notify("turn/started", { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress" } });
    fake.notify("item/agentMessage/delta", { threadId: "thread-1", turnId: "turn-1", itemId: "m1", delta: "Hel" });
    fake.notify("item/completed", { threadId: "thread-1", turnId: "turn-1", completedAtMs: 0, item: { type: "agentMessage", id: "m1", text: "Hello" } });
    fake.notify("item/started", { threadId: "thread-1", turnId: "turn-1", startedAtMs: 0, item: { type: "commandExecution", id: "x1", command: "ls", status: "inProgress" } });
    fake.notify("item/completed", { threadId: "thread-1", turnId: "turn-1", completedAtMs: 0, item: { type: "commandExecution", id: "x1", command: "ls", status: "completed", exitCode: 0 } });
    fake.notify("item/started", { threadId: "thread-1", turnId: "turn-1", startedAtMs: 0, item: { type: "dynamicToolCall", id: "d1", tool: "vibe_studio_report", arguments: { status: "produced" }, status: "inProgress" } });
    fake.notify("item/completed", { threadId: "thread-1", turnId: "turn-1", completedAtMs: 0, item: { type: "dynamicToolCall", id: "d1", tool: "vibe_studio_report", status: "failed", success: false } });
    fake.notify("thread/started", { thread: { id: "child-1", parentThreadId: "thread-1" } });
    fake.notify("item/started", { threadId: "thread-1", turnId: "turn-1", startedAtMs: 0, item: { type: "collabAgentToolCall", id: "spawn-1", tool: "spawnAgent", prompt: "Check the note", receiverThreadIds: ["child-1"] } });
    fake.notify("item/started", { threadId: "child-1", turnId: "c-turn", startedAtMs: 0, item: { type: "commandExecution", id: "x2", command: "cat a", status: "inProgress" } });
    fake.notify("turn/completed", { threadId: "child-1", turn: { id: "c-turn", status: "completed" } });
    fake.notify("thread/tokenUsage/updated", { threadId: "thread-1", turnId: "turn-1", tokenUsage: { total: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 }, last: { totalTokens: 120 }, modelContextWindow: 272000 } });
    fake.notify("thread/tokenUsage/updated", { threadId: "child-1", turnId: "c-turn", tokenUsage: { total: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 }, last: {} } });
    fake.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    await tick(); await tick();
    assert.deepEqual(stops, [{ stopHookActive: false }]);
    assert.equal(fake.of("turn/start").length, 2);
    assert.equal(fake.of("turn/start")[1].params.input[0].text, "Report the step first.");
    assert.equal(events.some(e => e.type === "session.idle"), false, "no idle while the stop hook continues");

    fake.notify("turn/started", { threadId: "thread-1", turn: { id: "turn-2", status: "inProgress" } });
    fake.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-2", status: "completed" } });
    await tick(); await tick();
    assert.deepEqual(stops[1], { stopHookActive: true });
    assert.equal(fake.of("turn/start").length, 3, "the queued message starts after the stop hook lets the turn end");
    assert.match(fake.of("turn/start")[2].params.input[0].text, /^Queued while busy/);
    fake.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-3", status: "completed" } });
    await tick(); await tick();

    const shown = events.map(({ type, data }) => [type, data]);
    assert.ok(events.every(e => typeof e.id === "string") && new Set(events.map(e => e.id)).size === events.length, "unique ids");
    assert.deepEqual(shown.slice(0, 7), [
        ["assistant.turn_start", {}],
        ["assistant.message_delta", { messageId: "m1", deltaContent: "Hel" }],
        ["assistant.message", { messageId: "m1", content: "Hello" }],
        ["tool.execution_start", { toolCallId: "x1", toolName: SHELL, arguments: { command: "ls" } }],
        ["tool.execution_complete", { toolCallId: "x1", success: true }],
        ["tool.execution_start", { toolCallId: "d1", toolName: "vibe_studio_report", arguments: { status: "produced" } }],
        ["tool.execution_complete", { toolCallId: "d1", success: false, error: { message: "The tool reported a failure." } }],
    ]);
    assert.deepEqual(shown[7], ["subagent.started", { toolCallId: "spawn-1", agentName: "codex-agent", agentDisplayName: "Check the note" }]);
    assert.deepEqual(shown[8], ["tool.execution_start", { toolCallId: "x2", toolName: SHELL, arguments: { command: "cat a" }, parentToolCallId: "spawn-1" }]);
    assert.deepEqual(shown.find(([type]) => type === "vibe_studio.usage"), ["vibe_studio.usage", { model: "gpt-6-luna", inputTokens: 110, outputTokens: 22, cachedInputTokens: 50, aggregate: true }]);
    assert.deepEqual(shown.find(([type]) => type === "session.usage_info"), ["session.usage_info", { tokenLimit: 272000, currentTokens: 120 }]);
    assert.equal(shown.at(-1)[0], "session.idle");
    assert.deepEqual(shown.at(-1)[1], {});
});

test("abort interrupts the running turn and the end is reported as aborted, without stop hook", async t => {
    const stops = [];
    const { fake, handle, events } = await openSession(t, { hooks: { onAgentStop: async input => { stops.push(input); } } });
    await handle.send("Go");
    fake.notify("turn/started", { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress" } });
    await handle.abort();
    assert.deepEqual(fake.of("turn/interrupt")[0].params, { threadId: "thread-1", turnId: "turn-1" });
    fake.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted" } });
    await tick();
    assert.deepEqual(events.at(-1).type, "session.idle");
    assert.deepEqual(events.at(-1).data, { aborted: true });
    assert.equal(stops.length, 0);
    await handle.send("Again");
    fake.notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-2", status: "failed", error: { message: "Quota exceeded" } } });
    await tick();
    assert.deepEqual(events.at(-1).data, { message: "Quota exceeded" });
    assert.equal(events.at(-1).type, "session.error");
    await handle.disconnect();
    assert.equal(fake.of("thread/unsubscribe").length, 1);
});

test("a stopped app-server ends the running sessions with an error", async t => {
    const { fake, handle, harness, events } = await openSession(t);
    await handle.send("Go");
    fake.close(new Error("crashed"));
    assert.equal(events.at(-1).type, "session.error");
    assert.match(events.at(-1).data.message, /crashed/);
    assert.equal(harness.status().connected, false);
});

test("file changes become canonical calls the guards understand", () => {
    assert.deepEqual(canonicalChange({ path: "a.md", kind: { type: "add" }, diff: "x" }), { toolName: "create", toolArgs: { path: "a.md", file_text: "x" } });
    assert.deepEqual(canonicalChange({ path: "a.md", kind: { type: "delete" }, diff: "x" }).toolArgs.input, "*** Begin Patch\n*** Delete File: a.md\n*** End Patch");
    const moved = canonicalChange({ path: "a.md", kind: { type: "update", move_path: "b.md" }, diff: "--- a\n+++ b\n@@\n-x\n+y" });
    assert.equal(moved.toolName, "apply_patch");
    assert.match(moved.toolArgs.input, /\*\*\* Move to: b\.md\n@@\n-x\n\+y/);
});

test("the JSON-RPC peer answers server requests and rejects pending calls when closed", async () => {
    const sent = [];
    let deliver, close;
    const peer = new RpcPeer({ send: m => sent.push(m), onMessage: l => { deliver = l; }, onClose: l => { close = l; } },
        { onRequest: async method => { if (method === "boom") throw new Error("bad"); return { ok: true }; } });
    deliver({ id: 7, method: "ping", params: {} });
    deliver({ id: 8, method: "boom", params: {} });
    await tick();
    assert.deepEqual(sent, [{ id: 7, result: { ok: true } }, { id: 8, error: { code: -32603, message: "bad" } }]);
    const pending = peer.request("model/list", {});
    assert.deepEqual(sent.at(-1), { id: 1, method: "model/list", params: {} });
    close(new Error("gone"));
    await assert.rejects(pending, /gone/);
});
