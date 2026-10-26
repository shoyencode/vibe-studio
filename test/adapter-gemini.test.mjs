import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GeminiHarness, changedRegion, describeCall, guardCalls, resolveCommand } from "../core/adapters/gemini.mjs";
import { LoopbackTools } from "../core/adapters/mcp-tools.mjs";

const acp = await import("@agentclientprotocol/sdk/unstable");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

const SHELL = process.platform === "win32" ? "powershell" : "bash";
const MODELS = [{ modelId: "auto", name: "Auto" }, { modelId: "gemini-3-pro-preview", name: "Gemini 3 Pro" },
    { modelId: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }, { modelId: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { modelId: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" }];

async function callMcp(server, name, args) {
    const client = new Client({ name: "fake-gemini", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: Object.fromEntries(server.headers.map(h => [h.name, h.value])) } });
    await client.connect(transport);
    try {
        const { tools } = await client.listTools();
        const result = name ? await client.callTool({ name, arguments: args }) : null;
        return { tools: tools.map(tool => tool.name), result, text: result?.content?.[0]?.text };
    } finally { await client.close(); }
}

// A fake Gemini CLI speaking ACP over an in-memory stream. onPrompt(ctx, session) scripts each turn.
function fakeGemini({ signedIn = true, failures = 0, onPrompt = async () => ({ stopReason: "end_turn" }) } = {}) {
    const fake = { sessions: [], prompts: [], modes: [], models: [], cancels: [], initialize: null, onPrompt, attempts: 0 };
    const toAgent = new TransformStream(), toClient = new TransformStream();
    acp.agent({ name: "fake-gemini" })
        .onRequest("initialize", ({ params }) => {
            fake.initialize = params;
            return { protocolVersion: 1, authMethods: [{ id: "oauth-personal", name: "Log in with Google" }, { id: "gemini-api-key", name: "Gemini API key" }],
                agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: true, embeddedContext: true }, mcpCapabilities: { http: true, sse: true } } };
        })
        .onRequest("session/new", ({ params }) => {
            if (!signedIn) throw new acp.RequestError(-32000, "Gemini API key is missing or not configured.");
            if (fake.attempts++ < failures) throw new acp.RequestError(-32603, "fetch failed: ETIMEDOUT");
            const session = { id: `s${fake.sessions.length + 1}`, cwd: params.cwd, mcpServers: params.mcpServers };
            fake.sessions.push(session);
            return { sessionId: session.id, modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "autoEdit", name: "Auto Edit" }, { id: "yolo", name: "YOLO" }] },
                models: { availableModels: MODELS, currentModelId: "auto" } };
        })
        .onRequest("session/set_mode", ({ params }) => { fake.modes.push(params); return {}; })
        .onRequest("session/prompt", async ctx => {
            const session = fake.sessions.find(s => s.id === ctx.params.sessionId);
            fake.prompts.push(ctx.params);
            const say = text => ctx.client.notify("session/update", { sessionId: session.id, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
            const update = value => ctx.client.notify("session/update", { sessionId: session.id, update: value });
            const permission = toolCall => ctx.client.request("session/request_permission", { sessionId: session.id, toolCall,
                options: [{ optionId: "proceed_always", name: "Allow for this session", kind: "allow_always" },
                    { optionId: "proceed_once", name: "Allow", kind: "allow_once" }, { optionId: "cancel", name: "Reject", kind: "reject_once" }] });
            const write = (file, content) => ctx.client.request("fs/write_text_file", { sessionId: session.id, path: file, content });
            return fake.onPrompt({ ...ctx, session, say, update, permission, write, server: session.mcpServers[0] });
        })
        .onRequest("*", ({ method, params }) => {
            if (method === "session/set_model") { fake.models.push(params); return {}; }
            throw acp.RequestError.methodNotFound(method);
        })
        .onNotification("session/cancel", ({ params }) => { fake.cancels.push(params.sessionId); fake.cancel?.(); })
        .connect({ readable: toAgent.readable, writable: toClient.writable });
    fake.transport = { stream: { readable: toClient.readable, writable: toAgent.writable }, close: async () => {} };
    return fake;
}

function setup(t, options = {}, harnessOptions = {}) {
    const fake = fakeGemini(options);
    const events = [], permissions = [], questions = [];
    const answers = [...(harnessOptions.answers || [])];
    const harness = new GeminiHarness({
        createTransport: async () => fake.transport, env: { PATH: "" },
        ui: {
            permission: async input => { permissions.push(input.request); return answers.length ? answers.shift() : "approve"; },
            question: async input => { questions.push(input.request); return harnessOptions.answer ? harnessOptions.answer(input.request) : { answer: "Option B", wasFreeform: false }; },
        },
        ...harnessOptions.harness,
    });
    t.after(() => harness.stop());
    return { fake, harness, events, permissions, questions, onEvent: event => events.push(event) };
}

const idle = events => new Promise(resolve => {
    const timer = setInterval(() => { if (events.some(e => e.type === "session.idle" || e.type === "session.error")) { clearInterval(timer); resolve(); } }, 5);
});

async function project(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vibe_studio-gemini-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

test("start raises harness.login cleanly when Gemini CLI is not signed in", async t => {
    const { harness, fake } = setup(t, { signedIn: false });
    await assert.rejects(harness.start(), error => error.key === "harness.login");
    assert.equal(harness.status().connected, false);
    assert.deepEqual(fake.initialize.clientCapabilities.fs, { readTextFile: true, writeTextFile: true });
});

test("a slow network is tried twice, then reported as harness.network", async t => {
    const once = setup(t, { failures: 1 });
    await once.harness.start();
    assert.equal(once.fake.attempts, 2);
    const twice = setup(t, { failures: 2 });
    await assert.rejects(twice.harness.start(), error => error.key === "harness.network" && /ETIMEDOUT/.test(error.vars.message));
    assert.equal(twice.harness.status().connected, false);
});

test("a missing Gemini CLI is reported as harness.missing, the npm shim is resolved without a shell", async t => {
    const harness = new GeminiHarness({ command: "gemini-vibe_studio-missing", env: { PATH: "" } });
    await assert.rejects(harness.start(), error => error.key === "harness.missing" && error.vars.name === "Gemini CLI");
    const dir = await project(t);
    const script = path.join(dir, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
    await mkdir(path.dirname(script), { recursive: true });
    await writeFile(script, "");
    await writeFile(path.join(dir, "node.exe"), "");
    await writeFile(path.join(dir, "gemini.cmd"), `@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js" %*\r\n`);
    assert.deepEqual(resolveCommand("gemini", { platform: "win32", env: { PATH: dir } }), { file: path.join(dir, "node.exe"), args: [script] });
    assert.equal(resolveCommand("gemini", { platform: "win32", env: { PATH: path.join(dir, "none") } }), null);
});

test("models come from session/new and kit models are resolved to Gemini families", async t => {
    const { harness } = setup(t);
    assert.deepEqual(await harness.start(), { login: null });
    assert.deepEqual(harness.status(), { harness: "gemini", connected: true, login: null, busy: false });
    assert.deepEqual((await harness.models()).map(m => m.id), MODELS.map(m => m.modelId));
    assert.equal(harness.defaultModel(), "auto");
    assert.equal(harness.resolveModel("gemini-2.5-flash"), "gemini-2.5-flash");
    assert.equal(harness.resolveModel("gemini-3-flash-preview"), "gemini-2.5-flash");
    assert.equal(harness.resolveModel("gemini-9-pro"), "gemini-3-pro-preview");
    assert.equal(harness.resolveModel("claude-opus-4.8"), "gemini-3-pro-preview");
    assert.equal(harness.resolveModel("claude-haiku-4.5"), "gemini-2.5-flash");
    assert.equal(harness.resolveModel("gpt-6-luna"), "auto");
    assert.equal(harness.resolveModel(undefined), "auto");
});

test("agents of the kit are read from the project, their prompt opens the session, the model is kept", async t => {
    const dir = await project(t);
    await mkdir(path.join(dir, ".github", "agents"), { recursive: true });
    await writeFile(path.join(dir, ".github", "agents", "demo-writer.agent.md"),
        `---\nname: demo-writer\ndescription: "Writer"\nmodel: gpt-6-luna\ntools: ["read", "edit", "ask_user"]\n---\n\n# Demo writer\n\nAsk before guessing.\n`);
    const { harness, fake, onEvent, events } = setup(t);
    const agents = await harness.agents(dir);
    assert.deepEqual(agents.map(({ path: file, ...agent }) => agent), [{ name: "demo-writer", displayName: "demo-writer", description: "Writer",
        prompt: "# Demo writer\n\nAsk before guessing.", tools: ["read", "edit", "ask_user"], model: "auto", userInvocable: true }]);
    const handle = await harness.openStep({ project: dir, agent: "demo-writer", model: "gemini-2.5-pro", tools: [], onEvent, mode: "autopilot" });
    assert.deepEqual(fake.models, [{ sessionId: handle.sessionId, modelId: "gemini-2.5-pro" }]);
    assert.deepEqual(fake.modes, [], "the session stays in the default mode, which asks the Vibe Studio");
    assert.equal((await handle.current()).modelId, "gemini-2.5-pro");
    await handle.send("Bonjour");
    await idle(events);
    events.length = 0;
    await handle.send("Encore");
    await idle(events);
    assert.match(fake.prompts[0].prompt[0].text, /^Act as the agent "demo-writer"[\s\S]*Ask before guessing\.[\s\S]*Bonjour$/);
    assert.equal(fake.prompts[1].prompt[0].text, "Encore");
});

test("Vibe Studio tools are served by a loopback MCP server and called with the session id", async t => {
    const dir = await project(t);
    const reports = [];
    const { harness, fake, onEvent, events, permissions } = setup(t, { onPrompt: async ({ permission, server }) => {
        const outcome = await permission({ toolCallId: "mcp_vibe_studio_vibe_studio_report_1729000000000_0", title: "vibe_studio_report(runId: r1, status: started)", kind: "other", status: "pending" });
        fake.outcome = outcome;
        fake.call = await callMcp(server, "vibe_studio_report", { runId: "r1", status: "started" });
        fake.failure = await callMcp(server, "vibe_studio_report", { runId: "bad", status: "started" });
        return { stopReason: "end_turn" };
    } });
    const tools = [{ name: "vibe_studio_report", description: "Report", parameters: { type: "object", properties: { runId: { type: "string" } } },
        handler: async (input, invocation) => {
            reports.push({ input, sessionId: invocation.sessionId });
            return input.runId === "bad" ? { resultType: "failure", textResultForLlm: "Report not recorded" } : JSON.stringify({ recorded: true });
        } }];
    const handle = await harness.openStep({ project: dir, agent: null, model: "auto", tools, onEvent });
    const [server] = fake.sessions.at(-1).mcpServers;
    assert.equal(server.type, "http");
    assert.equal(server.name, "vibe_studio");
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[a-f0-9]{48}$/);
    assert.equal(server.headers[0].name, "Authorization");
    await handle.send("Go");
    await idle(events);
    assert.deepEqual(fake.outcome, { outcome: { outcome: "selected", optionId: "proceed_once" } });
    assert.equal(permissions.length, 0, "Vibe Studio tools are approved without a question");
    assert.deepEqual(fake.call.tools.sort(), ["ask_user", "vibe_studio_report"]);
    assert.equal(fake.call.text, JSON.stringify({ recorded: true }));
    assert.equal(fake.failure.result.isError, true);
    assert.equal(fake.failure.text, "Report not recorded");
    assert.deepEqual(reports[0], { input: { runId: "r1", status: "started" }, sessionId: handle.sessionId });
    // The route needs the bearer token of the server.
    const refused = await fetch(server.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(refused.status, 404);
    await handle.disconnect();
    await assert.rejects(callMcp(server), /404|Not found|Error/i);
});

test("ask_user goes to the question of the window and returns the answer", async t => {
    const dir = await project(t);
    const { harness, fake, onEvent, events, questions } = setup(t, { onPrompt: async ({ server }) => {
        fake.answer = await callMcp(server, "ask_user", { question: "Which topic?", choices: ["Option A", "Option B"], allow_freeform: false });
        return { stopReason: "end_turn" };
    } });
    const handle = await harness.openStep({ project: dir, model: "auto", tools: [], onEvent });
    await handle.send("Go");
    await idle(events);
    assert.deepEqual(questions, [{ question: "Which topic?", choices: ["Option A", "Option B"], allowFreeform: false }]);
    assert.equal(fake.answer.text, "Option B");
    const types = events.map(e => e.type);
    assert.ok(types.indexOf("user_input.requested") < types.indexOf("user_input.completed"));
});

test("an unanswered question keeps the same pending question when ask_user is called again", async t => {
    const dir = await project(t);
    let release;
    const { harness, fake, onEvent, events, questions } = setup(t, { onPrompt: async ({ server }) => {
        fake.first = await callMcp(server, "ask_user", { question: "Ready?" });
        fake.second = await callMcp(server, "ask_user", { question: "Ready?" });
        return { stopReason: "end_turn" };
    } }, { harness: { questionWait: 20 }, answer: () => new Promise(resolve => { release = resolve; }) });
    const question = harness.question.bind(harness);
    let attempts = 0;
    harness.question = (state, input) => {
        const pending = question(state, input);
        if (++attempts === 2) release({ answer: "Yes", wasFreeform: true });
        return pending;
    };
    const handle = await harness.openStep({ project: dir, model: "auto", tools: [], onEvent });
    await handle.send("Go");
    await idle(events);
    assert.match(fake.first.text, /not answered yet/);
    assert.equal(fake.second.text, "Yes");
    assert.equal(questions.length, 1);
});

test("permissions are guarded, then asked to the window; approve-session is kept by the Vibe Studio", async t => {
    const dir = await project(t);
    const hooked = [];
    const { harness, fake, onEvent, events, permissions } = setup(t, { onPrompt: async ({ permission }) => {
        fake.outcomes = [];
        for (const command of ["npm test", "npm run build", "git status"]) {
            fake.outcomes.push((await permission({ toolCallId: `run_shell_command_172900000000${fake.outcomes.length}_0`, title: command, kind: "execute", status: "pending",
                content: [{ type: "content", content: { type: "text", text: "Runs the tests" } }] })).outcome.optionId);
        }
        fake.outcomes.push((await permission({ toolCallId: "activate_skill_1729000000009_0", title: '"demo-1-write-note": Writes the note', kind: "other", status: "pending" })).outcome.optionId);
        return { stopReason: "end_turn" };
    } }, { answers: ["approve-session", { reject: "Not now" }, "approve"] });
    const hooks = { onPreToolUse: async input => { hooked.push(input); return undefined; } };
    const handle = await harness.openStep({ project: dir, model: "auto", tools: [], hooks, onEvent });
    await handle.send("Go");
    await idle(events);
    assert.deepEqual(hooked.map(h => [h.toolName, h.toolArgs]), [[SHELL, { command: "npm test" }], [SHELL, { command: "npm run build" }],
        [SHELL, { command: "git status" }], ["skill", { skill: "demo-1-write-note" }]]);
    assert.deepEqual(fake.outcomes, ["proceed_once", "proceed_once", "cancel", "proceed_once"]);
    assert.equal(permissions.length, 3, "npm run build was approved for the session");
    assert.deepEqual(permissions[0], { kind: "shell", fullCommandText: "npm test", intention: "Runs the tests", canOfferSessionApproval: true });
    assert.deepEqual(permissions[2], { kind: "custom-tool", toolName: "activate_skill", intention: '"demo-1-write-note": Writes the note', canOfferSessionApproval: true });
    assert.equal(events.filter(e => e.type === "permission.requested").length, 3);
    assert.equal(events.filter(e => e.type === "permission.completed").length, 3);
    // The feedback of the user reaches the model with the next message.
    events.length = 0;
    await handle.send("Next");
    await idle(events);
    assert.match(fake.prompts[1].prompt[0].text, /The user refused "git status": Not now[\s\S]*Next$/);
});

test("a guard refuses a shell command and a write before anything runs", async t => {
    const dir = await project(t);
    const target = path.join(dir, "work", "spec.md");
    const hooked = [];
    const { harness, fake, onEvent, events, permissions } = setup(t, { onPrompt: async ({ permission, write }) => {
        fake.shell = (await permission({ toolCallId: "run_shell_command_1729000000000_0", title: "Remove-Item work/spec.md", kind: "execute", status: "pending" })).outcome.optionId;
        fake.edit = (await permission({ toolCallId: "write_file_1729000000001_0", title: "Writing to work/spec.md", kind: "edit", status: "pending",
            locations: [{ path: target }], content: [{ type: "diff", path: target, oldText: null, newText: "# Spec\n" }] })).outcome.optionId;
        fake.write = await write(target, "# Spec\n").then(() => "written", error => error.message);
        return { stopReason: "end_turn" };
    } });
    const hooks = { onPreToolUse: async input => { hooked.push(input); return { permissionDecision: "deny", permissionDecisionReason: "Read-only deliverable" }; } };
    const handle = await harness.openStep({ project: dir, model: "auto", tools: [], hooks, onEvent });
    await handle.send("Go");
    await idle(events);
    assert.equal(fake.shell, "cancel");
    assert.equal(fake.edit, "proceed_once", "the write is refused by fs/write_text_file, where the model reads the reason");
    assert.match(fake.write, /Refused by Vibe Studio: Read-only deliverable/);
    assert.equal(existsSync(target), false);
    assert.equal(permissions.length, 0);
    assert.deepEqual(hooked.map(h => [h.toolName, h.toolArgs]), [[SHELL, { command: "Remove-Item work/spec.md" }], ["create", { path: target, file_text: "# Spec\n" }]]);
    events.length = 0;
    await handle.send("Next");
    await idle(events);
    assert.match(fake.prompts[1].prompt[0].text, /"Remove-Item work\/spec\.md" was refused by a guard: Read-only deliverable/);
});

test("approved writes go through the client file system once; unasked writes are guarded there", async t => {
    const dir = await project(t);
    const note = path.join(dir, "work", "note.md"), other = path.join(dir, "work", "other.md");
    await mkdir(path.dirname(note), { recursive: true });
    await writeFile(note, "# Note\n\nOld line\n");
    const hooked = [];
    const { harness, fake, onEvent, events, permissions } = setup(t, { onPrompt: async ({ permission, write, client, session }) => {
        fake.edit = (await permission({ toolCallId: "replace_1729000000000_0", title: "work/note.md: Old line => New line", kind: "edit", status: "pending",
            locations: [{ path: note }], content: [{ type: "diff", path: note, oldText: "# Note\n\nOld line\n", newText: "# Note\n\nNew line\n" }] })).outcome.optionId;
        fake.write = await write(note, "# Note\r\n\r\nNew line\r\n").then(() => "written", error => error.message);
        fake.unasked = await write(other, "secret").then(() => "written", error => error.message);
        fake.read = await client.request("fs/read_text_file", { sessionId: session.id, path: note, line: 3, limit: 1 });
        fake.missing = await client.request("fs/read_text_file", { sessionId: session.id, path: path.join(dir, "none.md") }).then(() => "found", error => error.message);
        return { stopReason: "end_turn" };
    } });
    const hooks = { onPreToolUse: async input => { hooked.push(input); return input.toolName === "create" ? { permissionDecision: "deny", permissionDecisionReason: "No new file" } : undefined; } };
    const handle = await harness.openStep({ project: dir, model: "auto", tools: [], hooks, onEvent });
    await handle.send("Go");
    await idle(events);
    assert.equal(fake.edit, "proceed_once");
    assert.equal(fake.write, "written");
    assert.equal(await readFile(note, "utf8"), "# Note\r\n\r\nNew line\r\n");
    assert.deepEqual(hooked[0], { toolName: "edit", toolArgs: { path: note, old_str: "Old line", new_str: "New line" }, agentId: undefined });
    assert.equal(hooked.length, 2, "the approved write is not checked twice");
    assert.deepEqual(hooked[1], { toolName: "create", toolArgs: { path: other, file_text: "secret" }, agentId: undefined });
    assert.match(fake.unasked, /No new file/);
    assert.equal(existsSync(other), false);
    assert.equal(permissions[0].kind, "write");
    assert.match(permissions[0].diff, /-Old line\n\+New line/);
    assert.deepEqual(fake.read, { content: "New line\r" });
    assert.match(fake.missing, /Resource not found/);
});

test("session updates are normalised to the Copilot events, with usage and unique ids", async t => {
    const dir = await project(t);
    const { harness, onEvent, events } = setup(t, { onPrompt: async ({ say, update }) => {
        await say("Hello ");
        await say("world");
        await say("[MODE_UPDATE] default");
        await update({ sessionUpdate: "tool_call", toolCallId: "run_shell_command_1729000000000_0", title: "npm test", kind: "execute", status: "in_progress" });
        await update({ sessionUpdate: "tool_call_update", toolCallId: "run_shell_command_1729000000000_0", status: "failed", content: [{ type: "content", content: { type: "text", text: "exit 1" } }] });
        await update({ sessionUpdate: "tool_call", toolCallId: "read_file_1729000000001_0", title: "note.md", kind: "read", status: "in_progress", locations: [{ path: "/p/note.md" }] });
        await update({ sessionUpdate: "tool_call_update", toolCallId: "read_file_1729000000001_0", status: "completed" });
        await say("Done.");
        return { stopReason: "end_turn", usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } };
    } });
    const handle = await harness.openStep({ project: dir, model: "auto", tools: [], onEvent });
    await handle.send("Go");
    await idle(events);
    const seen = events.map(({ type, data }) => [type, data]);
    const [first, second] = seen.filter(([type]) => type === "assistant.message").map(([, data]) => data);
    assert.deepEqual(seen.map(([type]) => type), ["assistant.turn_start", "assistant.message_delta", "assistant.message_delta", "assistant.message",
        "tool.execution_start", "tool.execution_complete", "tool.execution_start", "tool.execution_complete",
        "assistant.message_delta", "assistant.message", "vibe_studio.usage", "session.idle"]);
    assert.equal(first.content, "Hello world");
    assert.equal(second.content, "Done.");
    assert.notEqual(first.messageId, second.messageId);
    assert.deepEqual(seen[4][1], { toolCallId: "run_shell_command_1729000000000_0", toolName: "run_shell_command", arguments: { command: "npm test" } });
    assert.deepEqual(seen[5][1], { toolCallId: "run_shell_command_1729000000000_0", success: false, error: { message: "exit 1" } });
    assert.deepEqual(seen[6][1].arguments, { path: "/p/note.md" });
    assert.deepEqual(seen[10][1], { model: "auto", inputTokens: 120, outputTokens: 30 });
    assert.equal(new Set(events.map(e => e.id)).size, events.length);
});

test("the stop hook sends its reason as a new message, then the session goes idle", async t => {
    const dir = await project(t);
    const stops = [];
    const { harness, fake, onEvent, events } = setup(t);
    const hooks = { onAgentStop: async input => { stops.push(input); return stops.length === 1 ? { decision: "block", reason: "Report the end of the step." } : undefined; } };
    const handle = await harness.openStep({ project: dir, model: "auto", tools: [], hooks, onEvent });
    await handle.send("Go");
    await idle(events);
    assert.deepEqual(stops, [{ stopHookActive: false }, { stopHookActive: true }]);
    assert.deepEqual(fake.prompts.map(p => p.prompt[0].text), ["Go", "Report the end of the step."]);
    assert.equal(events.filter(e => e.type === "session.idle").length, 1);
    assert.equal(events.filter(e => e.type === "assistant.turn_start").length, 2);
});

test("messages wait for the running turn; abort cancels it; images are sent as image content", async t => {
    const dir = await project(t);
    const image = path.join(dir, "shot.png"), doc = path.join(dir, "brief.pdf");
    await writeFile(image, Buffer.from([137, 80, 78, 71]));
    await writeFile(doc, "pdf");
    let running = 0, overlap = false;
    const { harness, fake, onEvent, events } = setup(t, { onPrompt: async () => {
        running++; if (running > 1) overlap = true;
        if (fake.prompts.length === 1) await new Promise(resolve => { fake.cancel = resolve; });
        running--;
        return { stopReason: fake.prompts.length === 1 ? "cancelled" : "end_turn" };
    } });
    const handle = await harness.openStep({ project: dir, model: "auto", tools: [], onEvent });
    await handle.send("Long work", [{ type: "file", path: image, displayName: "shot.png" }, { type: "file", path: doc, displayName: "brief.pdf" }]);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(harness.status().busy, true);
    await handle.abort();
    await idle(events);
    assert.deepEqual(fake.cancels, [handle.sessionId]);
    assert.deepEqual(events.find(e => e.type === "session.idle").data, { aborted: true });
    const [text, picture] = fake.prompts[0].prompt;
    assert.match(text.text, /Long work\n\nAttached files \(read them from disk\):\n- .*brief\.pdf \(brief\.pdf\)$/);
    assert.deepEqual(picture, { type: "image", mimeType: "image/png", data: Buffer.from([137, 80, 78, 71]).toString("base64") });
    events.length = 0;
    await Promise.all([handle.send("One"), handle.send("Two")]);
    await new Promise(resolve => { const timer = setInterval(() => { if (events.filter(e => e.type === "session.idle").length === 2) { clearInterval(timer); resolve(); } }, 5); });
    assert.equal(overlap, false);
    assert.deepEqual(fake.prompts.slice(1).map(p => p.prompt[0].text), ["One", "Two"]);
});

test("ACP tool calls are described and mapped to canonical guard calls", () => {
    assert.deepEqual(changedRegion("a\nb\nc\n", "a\nB\nc\n"), { old_str: "b", new_str: "B" });
    const own = describeCall({ toolCallId: "synth_x", title: "vibe_studio_report(runId: 1)", kind: "other" }, ["vibe_studio_report", "ask_user"]);
    assert.equal(own.own, "vibe_studio_report");
    assert.deepEqual(guardCalls(own), []);
    const skill = describeCall({ toolCallId: "activate_skill_1729000000000_1", title: '"poc-2-write-specification": Write', kind: "other" });
    assert.deepEqual(guardCalls(skill), [{ toolName: "skill", toolArgs: { skill: "poc-2-write-specification" } }]);
    const rewrite = describeCall({ toolCallId: "write_file_1729000000000_1", title: "Writing to a.md", kind: "edit", content: [{ type: "diff", path: "/p/a.md", oldText: "old", newText: "new" }] });
    assert.equal(guardCalls(rewrite)[0].toolName, "create");
    assert.deepEqual(guardCalls(describeCall({ toolCallId: "x", title: "ls", kind: "execute" }), { shell: "bash" }), [{ toolName: "bash", toolArgs: { command: "ls" } }]);
});

test("the loopback MCP server refuses requests without the token or for a closed route", async t => {
    const tools = new LoopbackTools();
    t.after(() => tools.stop());
    const registration = await tools.register([{ name: "echo", description: "Echo", parameters: { type: "object" }, handler: async input => input.text }]);
    const server = LoopbackTools.acpServer(registration);
    assert.equal((await callMcp(server, "echo", { text: "hi" })).text, "hi");
    const wrong = await fetch(server.url, { method: "POST", headers: { Authorization: "Bearer nope", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(wrong.status, 404);
    const get = await fetch(server.url, { headers: { Authorization: registration.headers.Authorization } });
    assert.equal(get.status, 405);
    registration.close();
    const closed = await fetch(server.url, { method: "POST", headers: { Authorization: registration.headers.Authorization, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(closed.status, 404);
});
