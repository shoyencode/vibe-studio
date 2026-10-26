import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ClaudeHarness, bundledExecutable, canonicalCalls, claudeTools, permissionRequest, projectMcpServers, signedIn } from "../core/adapters/claude.mjs";
import { decide, prepareRules } from "../core/guards.mjs";
import { reportSchema } from "../core/prompt.mjs";

const MODELS = [
    { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)" },
    { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus" },
    { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet" },
    { value: "sonnet[1m]", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet (1M context)" },
    { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku" },
];

// Output stream of a fake query.
class Channel {
    constructor() { this.items = []; this.waiters = []; this.closed = false; }
    push(item) { const w = this.waiters.shift(); if (w) w({ value: item, done: false }); else this.items.push(item); }
    close() { this.closed = true; for (const w of this.waiters.splice(0)) w({ value: undefined, done: true }); }
    [Symbol.asyncIterator]() {
        return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false })
            : this.closed ? Promise.resolve({ value: undefined, done: true }) : new Promise(r => this.waiters.push(r)) };
    }
}

// Fake query() of the Claude Agent SDK: no process, no network. `script` plays Claude Code for each user message.
function fakeSdk({ account = { email: "me@example.com", tokenSource: "claude.ai", apiProvider: "firstParty" }, models = MODELS, script } = {}) {
    const queries = [];
    const createQuery = async ({ prompt, options }) => {
        const out = new Channel();
        const q = { options, sent: [], interrupted: 0, closed: false,
            initializationResult: async () => ({ account, models, commands: [], agents: [] }),
            interrupt: async () => { q.interrupted++; out.push({ type: "result", subtype: "error_during_execution", is_error: true, errors: [], total_cost_usd: 0, modelUsage: {} }); },
            close: () => { q.closed = true; out.close(); },
            emit: message => out.push(message),
            [Symbol.asyncIterator]: () => out[Symbol.asyncIterator]() };
        queries.push(q);
        if (options.settingSources?.length) (async () => { for await (const message of prompt) { q.sent.push(message); await script?.(message, q); } })();
        return q;
    };
    return { createQuery, queries, session: () => queries.find(q => q.options.settingSources?.length) };
}

async function until(check, label = "condition") {
    for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); }
    assert.fail(`timed out waiting for ${label}`);
}

async function project(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vibe_studio-claude-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(path.join(dir, ".claude", "agents"), { recursive: true });
    await writeFile(path.join(dir, ".claude", "agents", "demo-writer.md"),
        '---\nname: demo-writer\ndescription: "Writer"\nmodel: claude-opus-4.8\ntools: ["read", "edit", "search", "execute", "ask_user", "vibe_studio_report"]\n---\n\n# Demo writer\n\nWrite.\n');
    await writeFile(path.join(dir, ".claude", "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Reviews\nmodel: gpt-6-luna\nuser-invocable: false\n---\nReview.\n");
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp"] } } }));
    return dir;
}

const harnessFor = (sdk, ui = {}) => new ClaudeHarness({ createQuery: sdk.createQuery, command: process.execPath, ui });

test("Claude advertises native effort levels and passes the selected effort to the SDK", async t => {
    const sdk = fakeSdk({ models: [{ value: "sonnet", supportsEffort: true, supportedEffortLevels: ["low", "high"] }] });
    const harness = harnessFor(sdk);
    t.after(() => harness.stop());
    assert.deepEqual((await harness.models())[0].supportedReasoningEfforts, ["low", "high"]);
    const session = await harness.openStep({ project: await project(t), model: "sonnet", reasoningEffort: "high" });
    assert.equal(sdk.session().options.effort, "high");
    await session.disconnect();
});

test("start checks the account through the initialize handshake, without a prompt", async () => {
    const sdk = fakeSdk();
    const harness = harnessFor(sdk);
    assert.deepEqual(await harness.start(), { login: "me@example.com" });
    const probe = sdk.queries[0];
    assert.deepEqual(probe.options.settingSources, [], "the probe loads no settings of the user or of a project");
    assert.equal(probe.options.pathToClaudeCodeExecutable, process.execPath);
    assert.equal(probe.closed, true, "the probe process is closed at once");
    assert.deepEqual(harness.status(), { harness: "claude", connected: true, login: "me@example.com", busy: false });
    const models = await harness.models();
    assert.deepEqual(models.map(m => m.id), ["default", "opus", "sonnet", "sonnet[1m]", "haiku"]);
    assert.deepEqual(models.find(m => m.id === "sonnet").supportedContextTiers, ["default", "long_context"]);
    assert.equal(sdk.queries.length, 1, "the catalog of the handshake is cached");
    assert.equal(harness.defaultModel(), "sonnet");
    assert.equal(harness.resolveModel("opus"), "opus");
    assert.equal(harness.resolveModel("claude-sonnet-5.5"), "sonnet", "Copilot ids with dots match the resolved model");
    assert.equal(harness.resolveModel("claude-opus-4.8"), "opus", "same family");
    assert.equal(harness.resolveModel("claude-haiku-4.5"), "haiku");
    assert.equal(harness.resolveModel("gpt-6-luna"), "sonnet", "another vendor falls back to the default model");
    assert.equal(harness.resolveModel(undefined), "sonnet");
});

test("not signed in, missing executable and failed handshake are user errors", async () => {
    const out = harnessFor(fakeSdk({ account: { tokenSource: "none", apiProvider: "firstParty" } }));
    await assert.rejects(out.start(), error => error.key === "harness.login");
    assert.equal(out.status().connected, false);
    assert.equal(signedIn({ apiKeySource: "ANTHROPIC_API_KEY" }), "ANTHROPIC_API_KEY");
    assert.equal(signedIn({ apiProvider: "bedrock" }), "bedrock");
    assert.equal(signedIn({ tokenSource: "none", apiKeySource: "none", apiProvider: "firstParty" }), null);
    let spawned = 0;
    const missing = new ClaudeHarness({ command: path.join(os.tmpdir(), "no-such-dir", "claude.exe"), createQuery: async () => { spawned++; } });
    await assert.rejects(missing.start(), error => error.key === "harness.missing" && error.vars.name === "Claude Code");
    assert.equal(spawned, 0);
    const broken = new ClaudeHarness({ command: process.execPath, createQuery: async () => ({
        initializationResult: () => Promise.reject(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })), close() {},
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }) });
    await assert.rejects(broken.start(), error => error.key === "harness.missing");
});

test("the packaged application starts the executable unpacked from app.asar", async t => {
    const base = await mkdtemp(path.join(os.tmpdir(), "vibe_studio-asar-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
    const binary = process.platform === "win32" ? "claude.exe" : "claude";
    const unpacked = path.join(base, "app.asar.unpacked", "node_modules", ...pkg.split("/"));
    await mkdir(unpacked, { recursive: true });
    await writeFile(path.join(unpacked, binary), "");
    const resolve = name => { if (name !== `${pkg}/package.json`) throw new Error("not found"); return path.join(base, "app.asar", "node_modules", ...pkg.split("/"), "package.json"); };
    assert.equal(bundledExecutable(resolve), path.join(unpacked, binary));
    assert.equal(bundledExecutable(() => { throw new Error("not installed"); }), null);
});

test("kit agents are read from .claude/agents with Claude tool names and models", async t => {
    const dir = await project(t);
    const harness = harnessFor(fakeSdk());
    const agents = await harness.agents(dir);
    assert.deepEqual(agents.map(a => [a.name, a.model, a.userInvocable]), [["demo-writer", "opus", true], ["reviewer", "sonnet", false]]);
    assert.deepEqual(agents[0].tools, ["Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Grep", "Glob", "Bash", "PowerShell", "AskUserQuestion",
        "mcp__vibe_studio__vibe_studio_report", "Skill"]);
    assert.match(agents[0].prompt, /# Demo writer/);
    assert.equal(agents[1].tools, undefined, "no tool list: every tool");
    assert.deepEqual(claudeTools("Read, Grep, Task"), ["Read", "Grep", "Agent", "Skill", "mcp__vibe_studio__vibe_studio_report"]);
    assert.deepEqual(claudeTools(["github/*", "playwright/browser_click"]), ["mcp__github", "mcp__playwright__browser_click", "Skill", "mcp__vibe_studio__vibe_studio_report"]);
});

test("a step session selects the agent natively, keeps the model and exposes the Vibe Studio tools", async t => {
    const dir = await project(t);
    const sdk = fakeSdk();
    const harness = harnessFor(sdk);
    const reports = [];
    const tools = [{ name: "vibe_studio_report", description: "Report", parameters: reportSchema, skipPermission: true,
        handler: async (input, invocation) => { reports.push([input, invocation.sessionId]); return input.status === "error" ? { resultType: "failure", textResultForLlm: "Report not recorded" } : JSON.stringify({ recorded: true }); } }];
    const handle = await harness.openStep({ project: dir, agent: "demo-writer", model: "sonnet", contextTier: "long_context", tools, hooks: {}, mode: "autopilot" });
    const { options } = sdk.session();
    assert.match(handle.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(options.sessionId, handle.sessionId, "the session id is known before the first message");
    assert.equal(options.cwd, dir);
    assert.equal(options.model, "sonnet[1m]", "long context uses the 1M variant offered by Claude Code");
    assert.equal(options.permissionMode, "default", "autopilot keeps every permission visible to the Vibe Studio");
    assert.deepEqual(options.settingSources, ["project"]);
    assert.equal(options.agent, "demo-writer");
    assert.equal(options.agents["demo-writer"].model, "sonnet[1m]", "the main agent runs on the model chosen in the Vibe Studio");
    assert.equal(options.agents.reviewer.model, "sonnet");
    assert.ok(options.agents["demo-writer"].tools.includes("mcp__vibe_studio__vibe_studio_report"));
    assert.equal(options.allowedTools, undefined, "every permission goes through canUseTool");
    assert.deepEqual(await options.canUseTool("mcp__vibe_studio__vibe_studio_report", { runId: "r" }, { toolUseID: "r1" }),
        { behavior: "allow", updatedInput: { runId: "r" } }, "the report tool needs no approval");
    assert.deepEqual(options.mcpServers.playwright, { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp"] });
    assert.equal(options.strictMcpConfig, true);
    assert.equal(options.mcpServers.vibe_studio.type, "sdk");
    assert.equal(options.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, "1");
    assert.equal(options.includePartialMessages, true);
    assert.ok(options.disallowedTools.includes("ScheduleWakeup"));

    // The in-process MCP server answers like Claude Code would call it.
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await options.mcpServers.vibe_studio.instance.connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ["vibe_studio_report"]);
    assert.deepEqual(listed.tools[0].inputSchema.required, ["runId", "status"]);
    const ok = await client.callTool({ name: "vibe_studio_report", arguments: { runId: "r1", status: "produced", paths: ["work/note.md"] } });
    assert.deepEqual(ok.content, [{ type: "text", text: '{"recorded":true}' }]);
    const failed = await client.callTool({ name: "vibe_studio_report", arguments: { runId: "r1", status: "error" } });
    assert.equal(failed.isError, true);
    assert.equal(failed.content[0].text, "Report not recorded");
    const invalid = await client.callTool({ name: "vibe_studio_report", arguments: { runId: "r1", status: "done" } });
    assert.equal(invalid.isError, true, "the JSON schema is enforced");
    assert.deepEqual(reports.map(([input, sessionId]) => [input.status, sessionId]), [["produced", handle.sessionId], ["error", handle.sessionId]]);
    await client.close();

    assert.equal(harness.status().busy, true);
    await harness.stop();
    assert.equal(sdk.session().closed, true);
    assert.equal(harness.status().connected, false);
});

test("permissions go to the window with the request kinds of the Vibe Studio", async t => {
    const dir = await project(t);
    const sdk = fakeSdk();
    const answers = ["approve", "approve-session", { reject: "non" }, "approve"];
    const seen = [], events = [];
    const harness = harnessFor(sdk, { permission: async ({ sessionId, request }) => { seen.push({ sessionId, request }); return answers.shift(); } });
    const handle = await harness.openStep({ project: dir, agent: null, model: "sonnet", onEvent: e => events.push(e) });
    const { canUseTool } = sdk.session().options;
    assert.equal(sdk.session().options.agent, undefined);
    const suggestion = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" };
    assert.deepEqual(await canUseTool("Bash", { command: "npm test", description: "Run tests" }, { suggestions: [suggestion], toolUseID: "t1" }),
        { behavior: "allow", updatedInput: { command: "npm test", description: "Run tests" }, decisionClassification: "user_temporary" });
    assert.deepEqual(seen[0], { sessionId: handle.sessionId, request: { toolName: "Bash", intention: "Run tests", canOfferSessionApproval: true, kind: "shell", fullCommandText: "npm test" } });
    const session = await canUseTool("Write", { file_path: path.join(dir, "a.md"), content: "x" }, { suggestions: [suggestion], toolUseID: "t2" });
    assert.deepEqual(session.updatedPermissions, [{ ...suggestion, destination: "session" }], "never written into the settings of the project");
    assert.equal(seen[1].request.kind, "write");
    assert.equal(seen[1].request.fileName, path.join(dir, "a.md"));
    assert.equal(seen[1].request.diff, "+x");
    assert.deepEqual(await canUseTool("WebFetch", { url: "https://example.com" }, { toolUseID: "t3" }),
        { behavior: "deny", message: "non", decisionClassification: "user_reject" });
    assert.equal(seen[2].request.kind, "url");
    assert.equal(seen[2].request.canOfferSessionApproval, false);
    await canUseTool("Read", { file_path: "C:\\outside\\secret.txt" }, { toolUseID: "t4", blockedPath: "C:\\outside\\secret.txt" });
    assert.equal(seen[3].request.kind, "read");
    assert.equal(seen[3].request.resolvedPath, path.resolve("C:\\outside\\secret.txt"));
    assert.deepEqual(events.map(e => e.type).slice(0, 2), ["permission.requested", "permission.completed"]);
    assert.equal(permissionRequest("mcp__playwright__browser_click", {}, { mcpServer: { name: "playwright", source: "project" } }).kind, "mcp");
    assert.equal(permissionRequest("mcp__playwright__browser_click", {}).toolName, "browser_click");
    assert.equal(permissionRequest("ExitPlanMode", {}).kind, "custom-tool");
    const noneSdk = fakeSdk();
    const none = harnessFor(noneSdk);
    await none.openStep({ project: dir, model: "sonnet" });
    assert.equal((await noneSdk.session().options.canUseTool("Bash", { command: "ls" }, { toolUseID: "t5" })).behavior, "deny", "no window, no approval");
    await harness.stop(); await none.stop();
});

test("AskUserQuestion is asked in the window, one question at a time, and answered the SDK way", async t => {
    const dir = await project(t);
    const sdk = fakeSdk();
    const asked = [], events = [];
    const harness = harnessFor(sdk, { question: async ({ request }) => { asked.push(request); return { answer: asked.length === 1 ? "Rouge" : "libre", wasFreeform: asked.length > 1 }; } });
    await harness.openStep({ project: dir, model: "sonnet", onEvent: e => events.push(e) });
    const input = { questions: [
        { question: "Quelle couleur ?", header: "Couleur", multiSelect: false, options: [{ label: "Rouge", description: "" }, { label: "Bleu", description: "" }] },
        { question: "Quels modules ?", header: "Modules", multiSelect: true, options: [{ label: "A", description: "" }, { label: "B", description: "" }] }] };
    const result = await sdk.session().options.canUseTool("AskUserQuestion", input, { toolUseID: "q1" });
    assert.deepEqual(asked[0], { question: "Quelle couleur ?", choices: ["Rouge", "Bleu"], allowFreeform: true });
    assert.match(asked[1].question, /^Quels modules \? \(several answers allowed/);
    assert.deepEqual(result, { behavior: "allow", updatedInput: { ...input, answers: { "Quelle couleur ?": "Rouge", "Quels modules ?": "libre" } } });
    assert.deepEqual(events.map(e => e.type), ["user_input.requested", "user_input.completed", "user_input.requested", "user_input.completed"]);
    const mutedSdk = fakeSdk();
    const muted = harnessFor(mutedSdk);
    await muted.openStep({ project: dir, model: "sonnet" });
    const refused = await mutedSdk.session().options.canUseTool("AskUserQuestion", input, { toolUseID: "q2" });
    assert.equal(refused.behavior, "deny");
    await harness.stop(); await muted.stop();
});

test("guards see Claude tools under canonical names and deny before a write or a shell command", async t => {
    const dir = await project(t);
    const sdk = fakeSdk();
    const harness = harnessFor(sdk);
    const rules = prepareRules({ guards: {
        readOnly: [{ id: "locked", paths: ["locked/**"], reason: "Locked by the kit." }],
        confirmCommands: [{ id: "push", commands: ["git push"], reason: "Confirm the push." }],
        skills: { id: "skills", reason: "Not this step." },
    } }, null, p => p);
    const calls = [];
    const hooks = { onPreToolUse: async input => {
        calls.push(input);
        const verdict = decide(input, { project: dir, rules, suspended: new Set(), tasks: null, allowedSkills: new Set(["demo-1-write-note"]) });
        return verdict ? { permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } : undefined;
    } };
    await harness.openStep({ project: dir, model: "sonnet", hooks });
    const [preToolUse] = sdk.session().options.hooks.PreToolUse[0].hooks;
    const run = (tool_name, tool_input, extra = {}) => preToolUse({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "x", session_id: "s", cwd: dir, ...extra }, "x", { signal: new AbortController().signal });
    const deny = reason => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });

    assert.deepEqual(await run("Write", { file_path: path.join(dir, "locked", "a.md"), content: "x" }), deny("Locked by the kit."));
    assert.deepEqual(calls.at(-1), { toolName: "create", toolArgs: { path: path.join(dir, "locked", "a.md"), file_text: "x" }, agentId: undefined });
    assert.deepEqual(await run("Edit", { file_path: path.join(dir, "locked", "a.md"), old_string: "a", new_string: "b" }), deny("Locked by the kit."));
    assert.deepEqual(calls.at(-1).toolArgs, { path: path.join(dir, "locked", "a.md"), old_str: "a", new_str: "b" });
    assert.deepEqual(await run("Bash", { command: `echo x > ${path.join(dir, "locked", "b.md")}` }), deny("Locked by the kit."));
    assert.equal(calls.at(-1).toolName, "bash");
    assert.deepEqual(await run("PowerShell", { command: "Set-Content locked/c.md x" }), deny("Locked by the kit."));
    assert.equal(calls.at(-1).toolName, "powershell");
    assert.deepEqual(await run("Bash", { command: "git push origin main" }),
        { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "Confirm the push." } });
    assert.deepEqual(await run("Skill", { skill: "demo-2-explore-topic" }), deny("Not this step."));
    assert.deepEqual(calls.at(-1), { toolName: "skill", toolArgs: { skill: "demo-2-explore-topic" }, agentId: undefined });
    assert.deepEqual(await run("Skill", { skill: "kit:demo-1-write-note" }), {}, "an allowed skill goes on to the normal permissions");
    assert.deepEqual(await run("Write", { file_path: path.join(dir, "work", "a.md"), content: "x" }, { agent_id: "sub-1" }), {});
    assert.equal(calls.at(-1).agentId, "sub-1");
    calls.length = 0;
    await run("MultiEdit", { file_path: path.join(dir, "work", "a.md"), edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] });
    assert.deepEqual(calls.map(c => [c.toolName, c.toolArgs.new_str]), [["edit", "b"], ["edit", "d"]]);
    assert.deepEqual(canonicalCalls("Read", { file_path: "/p/a.md" }), [{ toolName: "view", toolArgs: { path: "/p/a.md" } }]);
    assert.deepEqual(canonicalCalls("mcp__vibe_studio__vibe_studio_report", { runId: "r" }), [{ toolName: "vibe_studio_report", toolArgs: { runId: "r" } }]);
    const failingSdk = fakeSdk();
    const broken = harnessFor(failingSdk);
    await broken.openStep({ project: dir, model: "sonnet", hooks: { onPreToolUse: async () => { throw new Error("boom"); } } });
    const out = await failingSdk.session().options.hooks.PreToolUse[0].hooks[0]({ tool_name: "Bash", tool_input: { command: "ls" } });
    assert.equal(out.hookSpecificOutput.permissionDecision, "ask", "a guard failure asks the user, it never approves");
    await harness.stop(); await broken.stop();
});

test("the stop hook continues the turn natively with the reason of the Vibe Studio", async t => {
    const dir = await project(t);
    const sdk = fakeSdk();
    const harness = harnessFor(sdk);
    const seen = [];
    const verdicts = [{ decision: "block", reason: "Something is missing." }, undefined];
    await harness.openStep({ project: dir, model: "sonnet", hooks: { onAgentStop: async input => { seen.push(input); return verdicts.shift(); } } });
    const [stop] = sdk.session().options.hooks.Stop[0].hooks;
    assert.deepEqual(await stop({ hook_event_name: "Stop", stop_hook_active: false }), { decision: "block", reason: "Something is missing." });
    assert.deepEqual(await stop({ hook_event_name: "Stop", stop_hook_active: true }), {});
    assert.deepEqual(seen, [{ stopHookActive: false }, { stopHookActive: true }]);
    await harness.stop();
});

test("Claude Code messages are normalised to the events of the Vibe Studio, with usage", async t => {
    const dir = await project(t);
    const events = [];
    const sdk = fakeSdk({ script: async (message, q) => {
        if (message.message.content[0].text !== "Go") return;
        q.emit({ type: "system", subtype: "init", session_id: "s" });
        q.emit({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: "msg_1" } } });
        q.emit({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Bon" } } });
        q.emit({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "…" } } });
        q.emit({ type: "assistant", parent_tool_use_id: null, message: { id: "msg_1", content: [{ type: "text", text: "Bonjour" }] } });
        q.emit({ type: "assistant", parent_tool_use_id: null, message: { id: "msg_1", content: [{ type: "tool_use", id: "tu_1", name: "Write", input: { file_path: "C:/p/a.md", content: "x" } }] } });
        q.emit({ type: "assistant", parent_tool_use_id: null, message: { id: "msg_1", content: [{ type: "tool_use", id: "tu_2", name: "Agent", input: { subagent_type: "reviewer", description: "Review the note", prompt: "…" } }] } });
        q.emit({ type: "assistant", parent_tool_use_id: "tu_2", message: { id: "msg_2", content: [{ type: "tool_use", id: "tu_3", name: "mcp__vibe_studio__vibe_studio_report", input: { runId: "r" } }] } });
        q.emit({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: true, content: [{ type: "text", text: "Refused" }] }] } });
        q.emit({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_2", content: "done" }] } });
        q.emit({ type: "result", subtype: "success", is_error: false, result: "Bonjour", total_cost_usd: 0.25, usage: { input_tokens: 10, output_tokens: 5 },
            modelUsage: { "claude-sonnet-5-5": { inputTokens: 100, outputTokens: 40, cacheReadInputTokens: 7, cacheCreationInputTokens: 3, costUSD: 0.25, contextWindow: 200000 } } });
    } });
    const harness = harnessFor(sdk);
    const handle = await harness.openStep({ project: dir, model: "sonnet", onEvent: e => events.push(e) });
    const messageId = await handle.send("Go");
    assert.match(messageId, /^[0-9a-f-]{36}$/);
    await until(() => events.some(e => e.type === "session.idle"), "idle");
    const sent = sdk.session().sent[0];
    assert.deepEqual([sent.type, sent.uuid, sent.parent_tool_use_id, sent.session_id], ["user", messageId, null, handle.sessionId]);
    assert.deepEqual(events.map(e => e.type), ["assistant.turn_start", "assistant.message_delta", "assistant.message", "tool.execution_start",
        "tool.execution_start", "subagent.started", "tool.execution_start", "tool.execution_complete", "tool.execution_complete", "session.usage_info", "vibe_studio.usage", "session.idle"]);
    assert.equal(new Set(events.map(e => e.id)).size, events.length, "every event has its own id");
    const data = type => events.filter(e => e.type === type).map(e => e.data);
    assert.deepEqual(data("assistant.message_delta"), [{ messageId: "msg_1", deltaContent: "Bon" }]);
    assert.deepEqual(data("assistant.message"), [{ messageId: "msg_1", content: "Bonjour" }]);
    assert.deepEqual(data("tool.execution_start")[0], { toolCallId: "tu_1", toolName: "Write", arguments: { file_path: "C:/p/a.md", content: "x", path: "C:/p/a.md" } });
    assert.deepEqual(data("tool.execution_start")[2], { toolCallId: "tu_3", toolName: "vibe_studio_report", arguments: { runId: "r" }, parentToolCallId: "tu_2" });
    assert.deepEqual(data("subagent.started"), [{ toolCallId: "tu_2", agentName: "reviewer", agentDisplayName: "Review the note" }]);
    assert.deepEqual(data("tool.execution_complete"), [{ toolCallId: "tu_1", success: false, error: { message: "Refused" } }, { toolCallId: "tu_2", success: true }]);
    assert.deepEqual(data("vibe_studio.usage"), [{ model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 40, cacheReadTokens: 7, cacheWriteTokens: 3, costUsd: 0.25, aggregate: true }]);
    assert.deepEqual(data("session.usage_info"), [{ tokenLimit: 200000 }]);
    assert.deepEqual(data("session.idle"), [{}]);

    // Second turn: the cumulative totals of Claude Code become the usage of this turn only.
    events.length = 0;
    sdk.session().emit({ type: "assistant", parent_tool_use_id: null, message: { id: "msg_3", content: [{ type: "text", text: "Encore" }] } });
    sdk.session().emit({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.4,
        modelUsage: { "claude-sonnet-5-5": { inputTokens: 150, outputTokens: 60, cacheReadInputTokens: 7, cacheCreationInputTokens: 3, costUSD: 0.4 } } });
    await until(() => events.some(e => e.type === "session.idle"), "second idle");
    const usage = events.find(e => e.type === "vibe_studio.usage").data;
    assert.deepEqual([usage.inputTokens, usage.outputTokens, Math.round(usage.costUsd * 100)], [50, 20, 15]);
    await harness.stop();
});

test("abort, errors, sign-out and attachments", async t => {
    const dir = await project(t);
    const events = [];
    const sdk = fakeSdk();
    const harness = harnessFor(sdk);
    const handle = await harness.openStep({ project: dir, model: "sonnet", onEvent: e => events.push(e) });
    const image = path.join(dir, "shot.png"), pdf = path.join(dir, "brief.pdf");
    await writeFile(image, Buffer.from([137, 80, 78, 71]));
    await writeFile(pdf, "%PDF");
    await handle.send("Look", [{ type: "file", path: image, displayName: "shot.png" }, { type: "file", path: pdf, displayName: "brief.pdf" }]);
    await until(() => sdk.session().sent.length === 1, "sent");
    const content = sdk.session().sent[0].message.content;
    assert.deepEqual(content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from([137, 80, 78, 71]).toString("base64") } });
    assert.match(content[0].text, /^Look\n\nAttached files \(read them from these paths\):\n- .*brief\.pdf \(brief\.pdf\)$/);

    await handle.abort();
    assert.equal(sdk.session().interrupted, 1);
    await until(() => events.some(e => e.type === "session.idle"), "aborted idle");
    assert.deepEqual(events.find(e => e.type === "session.idle").data, { aborted: true });
    await handle.abort();
    assert.equal(sdk.session().interrupted, 1, "nothing to interrupt between turns");

    events.length = 0;
    await handle.send("Again");
    sdk.session().emit({ type: "result", subtype: "error_max_turns", is_error: true, errors: ["Too many turns"], total_cost_usd: 0, modelUsage: {} });
    await until(() => events.some(e => e.type === "session.error"), "error");
    assert.equal(events.find(e => e.type === "session.error").data.message, "Too many turns\nerror_max_turns");

    events.length = 0;
    await handle.send("Hello");
    sdk.session().emit({ type: "assistant", parent_tool_use_id: null, error: "authentication_failed", message: { id: "m", content: [{ type: "text", text: "Not logged in · Please run /login" }] } });
    sdk.session().emit({ type: "result", subtype: "success", is_error: true, result: "Not logged in", total_cost_usd: 0, modelUsage: {} });
    await until(() => events.some(e => e.type === "session.error"), "login error");
    assert.match(events.find(e => e.type === "session.error").data.message, /not signed in/);
    assert.equal(harness.status().connected, false, "the next start checks the account again");

    events.length = 0;
    sdk.session().close();
    await until(() => !harness.status().busy, "closed by the runtime");
    assert.equal(events.at(-1)?.type, "session.error");
    await assert.rejects(handle.send("late"));
    await harness.stop();
});

test("project MCP declarations are passed in Claude Code form", async t => {
    const dir = await project(t);
    await mkdir(path.join(dir, ".vscode"), { recursive: true });
    await writeFile(path.join(dir, ".vscode", "mcp.json"), JSON.stringify({ servers: { docs: { type: "http", url: "https://example.com/mcp" }, playwright: { command: "other" }, vibe_studio: { command: "x" } } }));
    assert.deepEqual(projectMcpServers(dir), {
        playwright: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp"] },
        docs: { type: "http", url: "https://example.com/mcp" },
    });
});
