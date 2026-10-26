import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, resolvePattern, stepVariant } from "../core/project.mjs";
import { CopilotHarness, agentConfig, frontmatter, projectMcpServers } from "../core/adapters/copilot.mjs";
import { launchPrompt } from "../core/prompt.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

class FakeHarness {
    constructor() {
        this.opened = []; this.sent = []; this.aborted = [];
        this.agentList = [{ name: "demo-writer", model: "gpt-6-luna", userInvocable: true }];
        this.modelList = [{ id: "gpt-6-luna" }, { id: "claude-sonnet-5.5", supportedContextTiers: ["long_context"] }];
    }
    status() { return { harness: "fake", connected: true, login: "tester", busy: false }; }
    defaultModel() { return "claude-sonnet-5.5"; }
    async models() { return this.modelList; }
    async agents() { return this.agentList; }
    async openStep(options) {
        const sessionId = `session-${this.opened.length + 1}`;
        this.opened.push(options);
        return { sessionId, send: async (prompt, attachments = []) => { this.sent.push({ sessionId, prompt, attachments }); return `message-${this.sent.length}`; },
            abort: async () => { this.aborted.push(sessionId); }, disconnect: async () => {} };
    }
}

async function demoProject(t) {
    const base = await mkdtemp(path.join(process.cwd(), ".test-core-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const dir = path.join(base, "demo");
    await cp(path.join(fixtures, "demo"), dir, { recursive: true });
    await writeFile(path.join(dir, "demo.yml"), "project:\n  name: Essai\n  language: fr\npaths:\n  root: work\n");
    await mkdir(path.join(dir, "work", "topics", "topic-1"), { recursive: true });
    await writeFile(path.join(dir, "work", "note.md"), "# Note\n");
    await writeFile(path.join(dir, "work", "topics", "topic-1", "tasks.md"), "Plan status: approved\n\n## Tasks\n\n- [ ] T01 First\n- [ ] T02 Second\n");
    const harness = new FakeHarness();
    const project = await new Project(dir, { harness, dataDir: path.join(base, "data") }).init();
    t.after(() => project.dispose());
    return { base, dir, harness, project };
}

function trackedCosts(f, fail = false) {
    const adapter = f.project.adapter, marks = [];
    f.harness.status = () => ({ harness: "copilot", connected: true });
    f.project.adapter = async (project, command, input) => {
        if (command === "mark") {
            assert.equal(f.harness.sent.length, marks.length, "each marker precedes its AI prompt");
            if (fail) throw new Error("Marker writer unavailable");
            marks.push(input); return { marked: true };
        }
        const result = await adapter(project, command, input);
        if (command === "snapshot") result.contract.modules.costs = { script: "demo-0-start/scripts/costs.py" };
        return result;
    };
    return marks;
}

function automaticBuild(f) {
    const adapter = f.project.adapter;
    f.project.adapter = async (...args) => {
        const kit = await adapter(...args);
        if (args[1] === "snapshot") kit.contract.steps.find(step => step.id === "2-explore-topic").approves = [];
        return kit;
    };
}

test("every tracked project and unit step is attributed to its exact session and run before prompting", async t => {
    const f = await demoProject(t), marks = trackedCosts(f);
    for (const [step, unit] of [["1-write-note", undefined], ["2-explore-topic", 1]]) {
        const started = await f.project.launch((await f.project.prepare({ step, unit })).ticket);
        const mark = marks.at(-1);
        assert.deepEqual(mark, { step, unit: unit ?? null, sessionId: started.sessionId, runId: started.runId });
        assert.equal((await f.project.store.read()).runs.at(-1).costMark.recorded, true);
        await f.project.close(started.runId);
    }
    assert.equal(marks.length, 2);
});

test("an attribution error prevents any AI prompt and leaves an explicit failed launch", async t => {
    const f = await demoProject(t); trackedCosts(f, true);
    const draft = await f.project.prepare({ step: "1-write-note" });
    await assert.rejects(f.project.launch(draft.ticket), error => error.key === "costs.markFailed");
    assert.equal(f.harness.sent.length, 0);
    assert.equal(f.project.sessions.size, 0);
    const run = (await f.project.store.read()).runs.at(-1);
    assert.equal(run.status, "error"); assert.ok(run.endedAt);
    assert.equal(run.costMark, undefined);
});

test("a completed build is automatically validated without a human approval and retains its completion after feedback edits", async t => {
    const f = await demoProject(t), tasks = path.join(f.dir, "work", "topics", "topic-1", "tasks.md");
    automaticBuild(f);
    await writeFile(tasks, "Plan status: approved\n\n## Tasks\n\n- [x] T01 First\n- [x] T02 Second\n");
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "2-explore-topic", unit: 1 })).ticket);
    await writeFile(path.join(f.dir, "work", "topics", "topic-1", "findings.md"), "# Completed\n");
    await f.project.report({ runId, status: "produced", paths: ["work/topics/topic-1/findings.md", "work/topics/topic-1/tasks.md"] }, sessionId);
    await f.project.event(sessionId, { type: "session.idle" });
    const completed = (await f.project.store.read()).runs.at(-1);
    assert.equal(completed.status, "produced"); assert.equal(completed.completion.automatic, true);
    await writeFile(tasks, "Plan status: approved\n\n## Tasks\n\n- [x] T01 First\n- [x] T02 Second\n- [ ] R01 Feedback for review\n");
    assert.equal((await f.project.snapshot()).runs.at(-1).status, "produced");
    await assert.rejects(f.project.prepare({ step: "2-explore-topic", unit: 1 }), error => error.key === "step.approved");
    const adapter = f.project.adapter;
    f.project.adapter = async (...args) => {
        const kit = await adapter(...args);
        if (args[1] === "snapshot") {
            kit.contract.modules.review = { buildStep: "2-explore-topic", reviewStep: "1-write-note" };
            kit.contract.steps.find(step => step.id === "2-explore-topic").variants = { corrections: { title: "Corrections" } };
            kit.tasks["1"].loop = { step: "corrections", open: ["R01"], round: 1 };
        }
        return kit;
    };
    assert.ok((await f.project.prepare({ step: "2-explore-topic", unit: 1 })).ticket, "the review correction cycle can still reopen construction");
});

test("a final produced report cannot automatically validate a build with failing end checks", async t => {
    const f = await demoProject(t); automaticBuild(f);
    const adapter = f.project.adapter;
    await writeFile(path.join(f.dir, "work", "topics", "topic-1", "tasks.md"), "Plan status: approved\n\n## Tasks\n\n- [x] T01 Done\n");
    f.project.adapter = async (...args) => {
        const kit = await adapter(...args);
        if (args[1] === "snapshot") kit.contract.steps.find(step => step.id === "2-explore-topic").guards.end.push({
            id: "fixture-end", check: "modified", path: "work/missing-journal.md",
        });
        return kit;
    };
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "2-explore-topic", unit: 1 })).ticket);
    await writeFile(path.join(f.dir, "work", "topics", "topic-1", "findings.md"), "# Done\n");
    await f.project.report({ runId, status: "produced", paths: ["work/topics/topic-1/findings.md"] }, sessionId);
    await f.project.event(sessionId, { type: "session.idle" });
    const run = (await f.project.store.read()).runs.at(-1);
    assert.equal(run.status, "unconfirmed"); assert.equal(run.completion, undefined);
    assert.deepEqual(run.endGate.failed, ["fixture-end"]);
});

test("a demo kit step is prepared from the contract and launched in a new session", async t => {
    const f = await demoProject(t);
    const snapshot = await f.project.snapshot();
    assert.equal(snapshot.kit.kit.id, "kit-demo");
    assert.deepEqual(snapshot.kit.units, [1]);
    const draft = await f.project.prepare({ step: "1-write-note" });
    assert.equal(draft.model, "gpt-6-luna");
    assert.equal(draft.step, "Rédiger la note de cadrage");
    const result = await f.project.launch(draft.ticket);
    assert.equal(f.harness.opened[0].agent, "demo-writer");
    assert.equal(f.harness.opened[0].tools[0].name, "vibe_studio_report");
    const prompt = f.harness.sent[0].prompt;
    assert.match(prompt, /Run the demo-1-write-note skill/);
    assert.match(prompt, new RegExp(`runId=${result.runId}`));
    assert.doesNotMatch(prompt, /cost mark/, "the demo kit declares no costs module");
    const run = (await f.project.snapshot()).runs.at(-1);
    assert.deepEqual([run.step, run.unit, run.status, run.sessionId], ["1-write-note", null, "running", "session-1"]);
    await assert.rejects(f.project.prepare({ step: "2-explore-topic", unit: 1 }), error => error.key === "step.busy");
});

test("the report tool writes task markers of the unit and the end of the session closes the step", async t => {
    const f = await demoProject(t);
    const draft = await f.project.prepare({ step: "2-explore-topic", unit: 1 });
    const { runId, sessionId } = await f.project.launch(draft.ticket);
    assert.match(f.harness.sent[0].prompt, /Selected topic: 1\./);
    const tool = f.harness.opened[0].tools[0];
    const answer = JSON.parse(await tool.handler({ runId, status: "started", task: { id: "T02", status: "in_progress" } }, { sessionId }));
    assert.equal(answer.task.written, true);
    assert.match(await readFile(path.join(f.dir, "work/topics/topic-1/tasks.md"), "utf8"), /- \[~\] T02 Second/);
    const refused = await tool.handler({ runId: "other", status: "started" }, { sessionId });
    assert.equal(refused.resultType, "failure");
    await f.project.event(sessionId, { type: "user_input.requested", data: {} });
    assert.equal((await f.project.snapshot()).runs.at(-1).status, "waiting");
    await f.project.event(sessionId, { type: "user_input.completed", data: {} });
    assert.equal((await f.project.snapshot()).runs.at(-1).status, "running");
    await tool.handler({ runId, status: "produced", paths: [path.join(f.dir, "work", "topics", "topic-1", "tasks.md")] }, { sessionId });
    await f.project.event(sessionId, { type: "session.idle", data: {} });
    assert.equal((await f.project.snapshot()).runs.at(-1).status, "produced");
    assert.deepEqual(await f.project.say(runId, "Merci"), { messageId: "message-2" });
});

test("optional modules missing from a kit are refused, declared ones work", async t => {
    const f = await demoProject(t);
    await assert.rejects(f.project.feedback({ unit: 1, text: "x", priority: "low" }), error => error.key === "module.feedback");
    await assert.rejects(f.project.costs(), error => error.key === "module.costs");
    const approved = await f.project.approve({ path: "work/note.md", comment: "ok" });
    assert.equal(approved.file, "work/approvals.md");
    assert.equal((await f.project.snapshot()).kit.validations["work/note.md"].current, true);
    assert.equal((await f.project.snapshot()).app.declared, false);
});

test("a step left running by a previous Vibe Studio process is shown as interrupted", async t => {
    const f = await demoProject(t);
    const draft = await f.project.prepare({ step: "1-write-note" });
    await f.project.launch(draft.ticket);
    const reopened = await new Project(f.dir, { harness: new FakeHarness(), dataDir: path.join(f.base, "data") }).init();
    t.after(() => reopened.dispose());
    assert.equal((await reopened.snapshot()).runs.at(-1).status, "interrupted");
});

test("guards of the contract are imposed in the session of a step", async t => {
    const f = await demoProject(t);
    const draft = await f.project.prepare({ step: "2-explore-topic", unit: 1 });
    const { runId, sessionId } = await f.project.launch(draft.ticket);
    const { hooks, tools } = f.harness.opened[0];
    const findings = path.join(f.dir, "work", "topics", "topic-1", "findings.md");
    const write = { toolName: "create", toolArgs: { path: findings, file_text: "# Findings" } };
    assert.deepEqual(await hooks.onPreToolUse(write), { permissionDecision: "deny", permissionDecisionReason: "Vibe Studio guard G12: mark a task in progress with vibe_studio_report before writing the findings." });
    assert.equal((await hooks.onPreToolUse({ toolName: "edit", toolArgs: { path: path.join(f.dir, "work", "approvals.md"), new_str: "x" } })).permissionDecision, "deny");
    const report = input => tools[0].handler(input, { sessionId });
    JSON.parse(await report({ runId, status: "started", task: { id: "T01", status: "in_progress" } }));
    assert.equal(await hooks.onPreToolUse(write), undefined, "a task is in progress");
    const second = await report({ runId, status: "started", task: { id: "T02", status: "in_progress" } });
    assert.match(second.textResultForLlm, /G13/);
    let run = (await f.project.snapshot()).runs.at(-1);
    assert.deepEqual(run.blocks.map(b => b.id), ["G12", "G02", "G13"]);
    // End of step: report and task still missing, the AI is sent back twice, then the user is alerted.
    const first = await hooks.onAgentStop({});
    assert.equal(first.decision, "block");
    assert.match(first.reason, /E1: .*\n- E2: /);
    assert.equal((await hooks.onAgentStop({ stopHookActive: true })).decision, "block");
    assert.equal(await hooks.onAgentStop({ stopHookActive: true }), undefined);
    run = (await f.project.snapshot()).runs.at(-1);
    assert.deepEqual(run.endGate, { count: 2, failed: ["E1", "E2"], alert: true });
    // A guard suspended by the user stops blocking, and the change is traced.
    await report({ runId, status: "started", task: { id: "T01", status: "done" } });
    await f.project.suspend(runId, "G12", true);
    assert.equal(await hooks.onPreToolUse(write), undefined);
    run = (await f.project.snapshot()).runs.at(-1);
    assert.deepEqual([run.suspended, run.suspensions.map(s => [s.id, s.suspended])], [["G12"], [["G12", true]]]);
    await assert.rejects(f.project.suspend(runId, "G99", true), error => error.key === "guard.unknown");
});

test("files attached at launch are copied next to the unit and given to the session", async t => {
    const f = await demoProject(t);
    const outside = path.join(f.base, "maquette écran.png");
    await writeFile(outside, "png");
    const draft = await f.project.prepare({ step: "2-explore-topic", unit: 1 });
    await f.project.launch(draft.ticket, [outside]);
    const [sent] = f.harness.sent;
    assert.equal(sent.attachments.length, 1);
    const copy = path.relative(f.dir, sent.attachments[0].path).replaceAll("\\", "/");
    assert.match(copy, /^work\/topics\/topic-1\/attachments\/\d{8}-\d{6}-maquette-écran\.png$/);
    assert.equal(sent.attachments[0].displayName, "maquette écran.png");
    assert.equal(await readFile(sent.attachments[0].path, "utf8"), "png");
    assert.match(sent.prompt, new RegExp(`Attachments given by the user[\\s\\S]*${copy.replace(/[.]/g, "\\.")}`));
    const second = await f.project.prepare({ step: "1-write-note" }).catch(error => error);
    assert.equal(second.key, "step.busy");
    await assert.rejects(f.project.attach(Array.from({ length: 11 }, () => outside), 1), error => error.key === "attach.tooMany");
    await assert.rejects(f.project.attach([path.join(f.base, "missing.pdf")], 1), error => error.key === "attach.missing");
});

test("a free conversation runs outside the journey, under the permanent guards", async t => {
    const f = await demoProject(t);
    await f.project.snapshot();
    const { sessionId } = await f.project.chat({ model: "gpt-6-luna", agent: "demo-writer" });
    const opened = f.harness.opened[0];
    assert.deepEqual([opened.agent, opened.model, opened.tools.length], ["demo-writer", "gpt-6-luna", 0]);
    assert.equal((await f.project.snapshot()).chats[0].sessionId, sessionId);
    assert.equal((await f.project.store.read()).runs.length, 0, "a conversation is not a step");
    await f.project.sayToChat(sessionId, "  Bonjour  ");
    assert.equal(f.harness.sent[0].prompt, "Bonjour");
    const denied = await opened.hooks.onPreToolUse({ toolName: "create", toolArgs: { path: path.join(f.dir, "work", "approvals.md"), file_text: "x" } });
    assert.equal(denied.permissionDecision, "deny", "permanent guard G02");
    assert.equal(await opened.hooks.onAgentStop({}), undefined, "no end checks without a step");
    f.project.event(sessionId, { type: "assistant.turn_start" });
    assert.equal(f.project.chatList()[0].busy, true);
    await f.project.closeChat(sessionId);
    assert.deepEqual([f.project.chatList(), f.harness.aborted], [[], [sessionId]]);
    await assert.rejects(f.project.sayToChat(sessionId, "x"), error => error.key === "run.notHosted");
    await assert.rejects(f.project.chat({ agent: "unknown" }), error => error.key === "agent.unavailable");
});

test("the session mode chosen by the user is passed to each new session", async t => {
    const f = await demoProject(t);
    f.project.sessionMode = () => "autopilot";
    const draft = await f.project.prepare({ step: "1-write-note" });
    await f.project.launch(draft.ticket);
    assert.equal(f.harness.opened[0].mode, "autopilot");
    f.project.forcedAsks.set("s", 1);
    assert.deepEqual([f.project.takeForcedAsk("s"), f.project.takeForcedAsk("s")], [true, false]);
});

test("an approved step cannot be launched, reopening preserves its files and history", async t => {
    const f = await demoProject(t);
    await f.project.approve({ path: "work/note.md" });
    await assert.rejects(f.project.prepare({ step: "1-write-note" }), error => error.key === "step.approved");
    const before = await readFile(path.join(f.dir, "work", "note.md"), "utf8");
    await f.project.reopen({ step: "1-write-note" });
    assert.equal(await readFile(path.join(f.dir, "work", "note.md"), "utf8"), before);
    const snapshot = await f.project.snapshot();
    assert.equal(snapshot.kit.validations["work/note.md"].current, false);
    assert.equal(snapshot.kit.validations["work/note.md"].reopened, true);
    assert.match(await readFile(path.join(f.dir, "work", "approvals.md"), "utf8"), /reopened/);
    await f.project.prepare({ step: "1-write-note" });
    await assert.rejects(f.project.reopen({ step: "1-write-note" }), error => error.key === "reopen.notApproved");
    await f.project.approve({ path: "work/note.md" });
    assert.equal((await f.project.snapshot()).kit.validations["work/note.md"].current, true);
});

test("conversation attachments are copied and sent for free chats and running steps", async t => {
    const f = await demoProject(t), events = [];
    f.project.onSessionEvent = (sessionId, event) => events.push({ sessionId, event });
    const file = path.join(f.base, "feedback.txt"); await writeFile(file, "Feedback");
    const chat = await f.project.chat();
    await f.project.sayToChat(chat.sessionId, "", [file]);
    assert.equal(f.harness.sent[0].attachments.length, 1);
    assert.match(f.harness.sent[0].prompt, /work\/attachments\/.*feedback.txt/);
    const user = events.find(item => item.event.type === "vibe_studio.user").event.data;
    assert.equal(user.attachments[0].name, "feedback.txt");
    await f.project.closeChat(chat.sessionId);
    const draft = await f.project.prepare({ step: "2-explore-topic", unit: 1 });
    const run = await f.project.launch(draft.ticket);
    await f.project.say(run.runId, "Here is the document", [file]);
    assert.match(f.harness.sent.at(-1).prompt, /work\/topics\/topic-1\/attachments\//);
    await assert.rejects(f.project.say(run.runId, ""), error => error.key === "say.empty");
});

test("originals must be known deliverables, inside the project and in a document format", async t => {
    const f = await demoProject(t);
    assert.equal(await f.project.originalFile("work/note.md"), path.join(f.dir, "work", "note.md"));
    await assert.rejects(f.project.originalFile("../outside.md"), error => error.key === "preview.forbidden");
    await assert.rejects(f.project.originalFile("work/unknown.pdf"), error => error.key === "preview.forbidden");
    await assert.rejects(f.project.originalFile("program.exe"), error => error.key === "files.formatDenied");
});

test("step usage is persisted without reopening a finished run, and duplicate events are ignored", async t => {
    const f = await demoProject(t);
    const draft = await f.project.prepare({ step: "1-write-note" });
    const { sessionId } = await f.project.launch(draft.ticket);
    const usage = { type: "assistant.usage", id: "u1", data: { model: "actual-model", inputTokens: 100, outputTokens: 20,
        copilotUsage: { totalNanoAiu: 1250000000 } } };
    await f.project.event(sessionId, usage); await f.project.event(sessionId, usage);
    await f.project.event(sessionId, { type: "session.idle" });
    const before = (await f.project.store.read()).runs.at(-1);
    await f.project.event(sessionId, { type: "session.usage_info", data: { currentTokens: 400, tokenLimit: 200000 } });
    const after = (await f.project.store.read()).runs.at(-1);
    assert.equal(after.metrics.inputTokens, 100);
    assert.equal(after.metrics.credits, 1.25);
    assert.equal(after.metrics.tokenLimit, 200000);
    assert.equal(after.endedAt, before.endedAt);
    assert.equal(after.status, before.status);
});

test("placeholders and review variants come from the contract", () => {
    const kit = { contract: { units: { folder: "{root}/build/scenario-{n}" }, modules: { review: { buildStep: "5-build", reviewStep: "6-review" } } },
        placeholders: { root: "poc" }, tasks: { 2: { loop: { step: "corrections", open: ["R01"], round: 1 } } } };
    assert.equal(resolvePattern("{unit}/plan.md", kit, 2), "poc/build/scenario-2/plan.md");
    const step = { id: "5-build", variants: { corrections: { title: "Fix" } } };
    assert.equal(stepVariant(step, kit, 2).key, "corrections");
    assert.equal(stepVariant({ id: "6-review", variants: {} }, kit, 2), null);
    const prompt = launchPrompt({ kit: { contract: { units: { label: "Scenario" }, modules: { costs: {} } } },
        draft: { step: { skill: "poc-5" }, skillPath: "s/SKILL.md", unit: 2, variant: { key: "corrections", loop: { open: ["R01"] } } },
        run: { id: "r1" }, sessionId: "s1", projectDir: "/p" });
    assert.match(prompt, /Selected scenario: 2\./);
    assert.match(prompt, /Open correction tasks: R01/);
    assert.match(prompt, /--session-id s1 --run-id r1/);
});

test("pause confirms interruption before resume and keeps the same step, session, files and metrics", async t => {
    const f = await demoProject(t);
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "1-write-note" })).ticket);
    const session = f.project.sessions.get(sessionId), original = await readFile(path.join(f.dir, "work", "note.md"), "utf8");
    session.abort = async () => { await f.project.event(sessionId, { type: "session.idle", data: { aborted: true } }); };
    await f.project.pause(runId, async id => {
        assert.equal(id, sessionId);
        assert.equal((await f.project.store.read()).runs.at(-1).status, "pausing");
        assert.equal((await f.harness.opened[0].hooks.onPreToolUse({ toolName: "edit", toolArgs: { path: "work/note.md" } })).permissionDecision, "deny");
        assert.equal(await f.harness.opened[0].hooks.onAgentStop({}), undefined, "end checks cannot restart an interrupted turn");
    });
    let run = (await f.project.store.read()).runs.at(-1);
    assert.equal(run.status, "paused"); assert.equal(run.endedAt, undefined);
    assert.ok(run.pausedAt); assert.equal((await f.project.snapshot()).runs.at(-1).status, "paused");
    await assert.rejects(f.project.say(runId, "do more"), error => error.key === "run.pauseRequired");
    await assert.rejects(f.project.prepare({ step: "1-write-note" }), error => error.key === "step.busy");
    await assert.rejects(f.project.report({ runId, status: "started" }, sessionId), error => error.key === "run.pauseRequired");
    await f.project.event(sessionId, { type: "assistant.usage", id: "pause-usage", data: { inputTokens: 40, copilotUsage: { totalNanoAiu: 500000000 } } });
    await f.project.event(sessionId, { type: "permission.completed" });
    assert.equal((await f.project.store.read()).runs.at(-1).status, "paused", "late tool completion cannot resume the step");
    await f.project.resume(runId);
    run = (await f.project.store.read()).runs.at(-1);
    assert.equal(run.status, "running"); assert.equal(run.id, runId); assert.equal(run.sessionId, sessionId);
    assert.equal(run.metrics.credits, 0.5); assert.ok(run.resumedAt);
    assert.equal(f.harness.opened.length, 1); assert.match(f.harness.sent.at(-1).prompt, /garde-fous/);
    assert.equal(await readFile(path.join(f.dir, "work", "note.md"), "utf8"), original);
    await assert.rejects(f.project.resume(runId), error => error.key === "run.notPaused");
});

test("failed interruption never claims a completed pause and can be retried", async t => {
    const f = await demoProject(t);
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "1-write-note" })).ticket);
    const session = f.project.sessions.get(sessionId);
    session.abort = async () => { throw new Error("Cancellation unavailable"); };
    await assert.rejects(f.project.pause(runId), /Cancellation unavailable/);
    const run = (await f.project.store.read()).runs.at(-1);
    assert.equal(run.status, "pausing"); assert.match(run.pauseError, /Cancellation unavailable/);
    await assert.rejects(f.project.resume(runId), error => error.key === "run.notPaused");
    session.abort = async () => { await f.project.event(sessionId, { type: "session.idle", data: { aborted: true } }); };
    await f.project.pause(runId);
    assert.equal((await f.project.store.read()).runs.at(-1).status, "paused");
    await f.project.close(runId);
    assert.equal((await f.project.store.read()).runs.at(-1).status, "unconfirmed");
});

test("pause times out explicitly, rejects concurrent controls, and accepts a late cancellation acknowledgement", async t => {
    const f = await demoProject(t);
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "1-write-note" })).ticket);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let aborted;
    const abortCalled = new Promise(resolve => { aborted = resolve; });
    f.project.sessions.get(sessionId).abort = async () => { aborted(); };
    const pending = f.project.pause(runId), rejection = assert.rejects(pending, error => error.key === "run.pauseTimeout");
    await abortCalled;
    await assert.rejects(f.project.pause(runId), error => error.key === "run.controlBusy");
    await assert.rejects(f.project.resume(runId), error => error.key === "run.controlBusy");
    await f.project.event(sessionId, { type: "session.idle", agentId: "nested", data: { aborted: true } });
    assert.equal((await f.project.store.read()).runs.at(-1).status, "pausing", "a subagent cannot acknowledge cancellation of the main turn");
    t.mock.timers.tick(30000); await rejection;
    assert.equal((await f.project.store.read()).runs.at(-1).status, "pausing");
    await f.project.event(sessionId, { type: "session.idle", data: { aborted: true } });
    assert.equal((await f.project.store.read()).runs.at(-1).status, "paused");
});

test("paused sessions are interrupted on application restart rather than silently resumed", async t => {
    const f = await demoProject(t);
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "1-write-note" })).ticket);
    f.project.sessions.get(sessionId).abort = async () => { await f.project.event(sessionId, { type: "session.idle" }); };
    await f.project.pause(runId); await f.project.dispose();
    const reopened = await new Project(f.dir, { harness: f.harness, dataDir: path.join(f.base, "data") }).init();
    t.after(() => reopened.dispose());
    assert.equal((await reopened.store.read()).runs.at(-1).status, "interrupted");
    await assert.rejects(reopened.resume(runId), error => error.key === "run.notHosted");
});

test("failed resume leaves a resumable pause and concurrent stop cannot overtake its send", async t => {
    const f = await demoProject(t);
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "1-write-note" })).ticket);
    const session = f.project.sessions.get(sessionId);
    session.abort = async () => { await f.project.event(sessionId, { type: "session.idle" }); };
    await f.project.pause(runId);
    session.send = async () => { throw new Error("Resume unavailable"); };
    await assert.rejects(f.project.resume(runId), /Resume unavailable/);
    assert.equal((await f.project.store.read()).runs.at(-1).status, "paused");
    let sent, finish;
    const sending = new Promise(resolve => { sent = resolve; });
    session.send = async () => { sent(); return new Promise(resolve => { finish = resolve; }); };
    const resumed = f.project.resume(runId);
    await sending;
    await assert.rejects(f.project.close(runId), error => error.key === "run.controlBusy");
    finish("resumed"); await resumed;
    await f.project.close(runId);
    assert.equal((await f.project.store.read()).runs.at(-1).status, "unconfirmed");
});

test("a runtime error during cancellation is surfaced instead of becoming a paused session", async t => {
    const f = await demoProject(t);
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "1-write-note" })).ticket);
    f.project.sessions.get(sessionId).abort = async () => { await f.project.event(sessionId, { type: "session.error", data: { message: "Runtime disconnected" } }); };
    await assert.rejects(f.project.pause(runId), error => error.key === "run.pauseFailed");
    assert.equal((await f.project.store.read()).runs.at(-1).status, "interrupted");
});

test("a terminal event that read the old running state still acknowledges a concurrent pause", async t => {
    const f = await demoProject(t);
    const { runId, sessionId } = await f.project.launch((await f.project.prepare({ step: "1-write-note" })).ticket);
    const read = f.project.store.read.bind(f.project.store);
    let first = true, entered, release;
    const reading = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    f.project.store.read = async () => {
        const data = await read();
        if (first) { first = false; entered(); await gate; }
        return data;
    };
    const idle = f.project.event(sessionId, { type: "session.idle", data: { aborted: true } });
    await reading;
    f.project.sessions.get(sessionId).abort = async () => { release(); await idle; };
    await f.project.pause(runId);
    assert.equal((await f.project.store.read()).runs.at(-1).status, "paused");
});

test("the reference kit is driven through its contract", async t => {
    const base = await mkdtemp(path.join(process.cwd(), ".test-poc-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    await cp(path.join(fixtures, "reference-kit", ".apm", "skills"), path.join(base, ".apm", "skills"), { recursive: true });
    await writeFile(path.join(base, "apm.yml"), "name: reference-kit\nversion: 0.12.0\n");
    const project = await new Project(base, { harness: new FakeHarness(), dataDir: path.join(base, ".data") }).init();
    t.after(() => project.dispose());
    const snapshot = await project.snapshot();
    assert.equal(snapshot.kit.kit.id, "reference-kit");
    assert.equal(snapshot.kit.valid, false, "no poc.yml yet");
    assert.equal(snapshot.kit.contract.steps.find(s => s.configures).id, "0-start");
    assert.equal(snapshot.app.declared, true);
});

test("the Copilot adapter passes the project configuration explicitly and maps permissions", async t => {
    const dir = await mkdtemp(path.join(process.cwd(), ".test-copilot-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(path.join(dir, ".github", "agents"), { recursive: true });
    await mkdir(path.join(dir, ".agents", "skills"), { recursive: true });
    const agentFile = path.join(dir, ".github", "agents", "poc-analyst.agent.md");
    await writeFile(agentFile, '---\nname: poc-analyst\ndescription: "Analyst: reads"\nmodel: claude-opus-5.5\ntools: ["read", "ask_user"]\n---\n\n# Analyst\n');
    await writeFile(path.join(dir, ".github", "mcp.json"), JSON.stringify({ mcpServers: { playwright: { id: "", command: "npx", args: ["-y", "@playwright/mcp"] } } }));
    const calls = [];
    const session = { sessionId: "abc", rpc: { agent: { select: async a => calls.push(["select", a]) }, model: { switchTo: async m => calls.push(["switch", m]), getCurrent: async () => ({}) } },
        on: () => () => {}, send: async options => { calls.push(["send", options]); return "m1"; }, abort: async () => {}, disconnect: async () => {} };
    let created;
    const client = { start: async () => {}, stop: async () => {}, getAuthStatus: async () => ({ isAuthenticated: true, login: "me" }),
        listModels: async () => [{ id: "claude-opus-5.5" }],
        rpc: { agents: { discover: async () => ({ agents: [{ name: "poc-analyst", description: "Analyst: reads", path: agentFile, userInvocable: true }] }) } },
        createSession: async config => { created = config; return session; } };
    const answers = ["approve", { reject: "non" }];
    const harness = new CopilotHarness({ createClient: async () => client, ui: { permission: async () => answers.shift(), question: async () => ({ answer: "A", wasFreeform: false }) } });
    assert.deepEqual(await harness.start(), { login: "me" });
    const handle = await harness.openStep({ project: dir, agent: "poc-analyst", model: "claude-opus-5.5", contextTier: "long_context", tools: [{ name: "vibe_studio_report" }] });
    assert.equal(handle.sessionId, "abc");
    assert.deepEqual(created.customAgents[0].tools, ["read", "ask_user", "vibe_studio_report"]);
    assert.equal(created.customAgents[0].model, "claude-opus-5.5");
    assert.deepEqual(created.skillDirectories, [path.join(dir, ".agents", "skills")]);
    assert.deepEqual(created.mcpServers.playwright, { type: "local", tools: ["*"], command: "npx", args: ["-y", "@playwright/mcp"] });
    assert.equal(created.contextTier, "long_context");
    assert.equal(created.enableConfigDiscovery, undefined, "discovery would load Copilot extensions into the session");
    assert.deepEqual(await created.onPermissionRequest({ kind: "shell" }), { kind: "approve-once" });
    assert.deepEqual(await created.onPermissionRequest({ kind: "write" }), { kind: "reject", feedback: "non" });
    assert.deepEqual(await created.onUserInputRequest({ question: "?" }), { answer: "A", wasFreeform: false });
    assert.deepEqual(calls.slice(0, 2), [["select", { name: "poc-analyst" }], ["switch", { modelId: "claude-opus-5.5", contextTier: "long_context" }]]);
    assert.equal(await handle.send("go"), "m1");
    assert.equal(harness.status().busy, true);
    await harness.stop();
    assert.equal(harness.status().connected, false);
});

test("the model catalog is fetched ahead once, exposes failures and retries explicitly", async t => {
    let calls = 0, failures = 1;
    const client = { start: async () => {}, stop: async () => {}, getAuthStatus: async () => ({ isAuthenticated: true, login: "me" }),
        listModels: async () => { calls++; if (failures-- > 0) throw new Error("Model catalog request timed out after 30000ms"); return [{ id: "m" }]; } };
    const harness = new CopilotHarness({ createClient: async () => client });
    t.after(() => harness.stop());
    await harness.start();
    assert.deepEqual(await harness.models(), []);
    assert.match(harness.catalogStatus().error, /timed out/);
    assert.equal(calls, 1, "catalog failure never creates a second blocking request");
    assert.equal((await harness.refreshModels())[0].id, "m");
    assert.equal((await harness.models())[0].id, "m");
    assert.equal(calls, 2, "only explicit retry fetches again");
    const down = new CopilotHarness({ createClient: async () => ({ ...client, listModels: async () => { throw new Error("timed out"); } }) });
    t.after(() => down.stop());
    await down.start();
    assert.deepEqual(await down.models(), []);
    assert.equal(down.catalogStatus().source, "kit");
    assert.match(down.catalogStatus().error, /timed out/);
});

test("agent front matter and MCP declarations are read like Copilot does", async t => {
    assert.deepEqual(frontmatter("---\nname: a\nuser-invocable: false\n---\nBody").fields, { name: "a", "user-invocable": false });
    assert.equal(agentConfig({ name: "x" }, "---\nname: x\n---\nPrompt").tools, undefined, "an open tool list stays open");
    const dir = await mkdtemp(path.join(process.cwd(), ".test-mcp-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(path.join(dir, ".vscode"));
    await writeFile(path.join(dir, ".vscode", "mcp.json"), JSON.stringify({ servers: { a: { command: "x" } } }));
    assert.deepEqual(Object.keys(projectMcpServers(dir)), ["a"]);
});
