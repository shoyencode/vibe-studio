// Claude Code adapter of Vibe Studio: hosts one Claude Code session per step through the Claude Agent SDK.
// Every tool call goes through the PreToolUse hook (guards of the kit) and every permission through canUseTool
// (the window of Vibe Studio). The session keeps the "default" permission mode, even in autopilot, so that the
// Vibe Studio sees each permission; autopilot is applied by ui.permission, which then approves.
// The kit is read where `apm install --target claude` deploys it: .claude/skills, .claude/agents and CLAUDE.md.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { REPORT_TOOL } from "../prompt.mjs";
import { UserError as Error } from "../errors.mjs";
import { frontmatter } from "./copilot.mjs";

const NAME = "Claude Code";
const SERVER = "vibe_studio";
const MCP_PREFIX = `mcp__${SERVER}__`;
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const FAMILIES = ["fable", "opus", "sonnet", "haiku"];
// Tools that would let a session act outside the project or wake up after the end of its step.
const DISALLOWED = ["EnterWorktree", "ExitWorktree", "RemoteTrigger", "CronCreate", "CronDelete", "ScheduleWakeup"];
// Copilot tool aliases used in the agent files of kits, and their Claude Code tools.
const TOOL_ALIASES = {
    read: ["Read"], view: ["Read"], edit: ["Edit", "Write", "MultiEdit", "NotebookEdit"], write: ["Write"],
    search: ["Grep", "Glob"], grep: ["Grep"], glob: ["Glob"],
    execute: ["Bash", "PowerShell"], shell: ["Bash", "PowerShell"], bash: ["Bash"], powershell: ["PowerShell"],
    web: ["WebFetch", "WebSearch"], fetch: ["WebFetch"], agent: ["Agent"], task: ["Agent"], "custom-agent": ["Agent"],
    todo: ["TodoWrite"], ask_user: ["AskUserQuestion"], skill: ["Skill"],
};

// Path of the Claude Code executable shipped with the SDK for this platform. In a packaged Electron application the
// package sits inside app.asar, from which no program can be started: the copy unpacked next to it is used.
export function bundledExecutable(resolve = createRequire(import.meta.url).resolve) {
    const binary = process.platform === "win32" ? "claude.exe" : "claude";
    for (const suffix of ["", "-musl"]) {
        try {
            const folder = path.dirname(resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${suffix}/package.json`));
            const file = path.join(folder, binary).replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
            if (existsSync(file)) return file;
        } catch { /* not installed for this platform */ }
    }
    return null;
}

function locate(command) {
    return new Promise(resolve => execFile(process.platform === "win32" ? "where.exe" : "which", [command], { timeout: 4000, windowsHide: true },
        (error, stdout) => resolve(error ? null : String(stdout).split(/\r?\n/).find(Boolean) || null)));
}

// Signed in: an account, an API key, or a third-party provider whose credentials Claude Code takes from the environment.
export function signedIn(account = {}) {
    if (account.email) return account.email;
    if (account.apiKeySource && account.apiKeySource !== "none") return account.apiKeySource;
    if (account.tokenSource && account.tokenSource !== "none") return account.organization || account.tokenSource;
    if (account.apiProvider && account.apiProvider !== "firstParty") return account.apiProvider;
    return null;
}

// Tool list of a kit agent (Copilot aliases or Claude names) in Claude Code names. The report tool of Vibe Studio and
// the skill tool are added to a closed list, as the Copilot adapter adds the report tool.
export function claudeTools(tools) {
    const list = Array.isArray(tools) ? tools : typeof tools === "string" && tools.trim() ? tools.split(",").map(t => t.trim()) : null;
    if (!list) return undefined;
    const mapped = [];
    for (const raw of list.filter(Boolean)) {
        const tool = String(raw);
        if (tool === REPORT_TOOL || tool.startsWith(MCP_PREFIX)) mapped.push(MCP_PREFIX + tool.replace(MCP_PREFIX, ""));
        else if (TOOL_ALIASES[tool.toLowerCase()] && tool === tool.toLowerCase()) mapped.push(...TOOL_ALIASES[tool.toLowerCase()]);
        else if (/^[^/]+\/\*$/.test(tool)) mapped.push(`mcp__${tool.slice(0, -2)}`);
        else if (/^[^/]+\/[^/]+$/.test(tool)) mapped.push(`mcp__${tool.replace("/", "__")}`);
        else mapped.push(tool === "Task" ? "Agent" : tool);
    }
    return [...new Set([...mapped, "Skill", MCP_PREFIX + REPORT_TOOL])];
}

// A Claude Code tool call in the canonical names of guards.mjs. MultiEdit gives one edit per change.
export function canonicalCalls(toolName, input = {}) {
    const args = input && typeof input === "object" ? input : {};
    const file = args.file_path ?? args.notebook_path ?? args.path;
    switch (toolName) {
        case "Write": return [{ toolName: "create", toolArgs: { path: file, file_text: String(args.content ?? "") } }];
        case "Edit": return [{ toolName: "edit", toolArgs: { path: file, old_str: String(args.old_string ?? ""), new_str: String(args.new_string ?? "") } }];
        case "MultiEdit": {
            const edits = Array.isArray(args.edits) && args.edits.length ? args.edits : [{}];
            return edits.map(e => ({ toolName: "edit", toolArgs: { path: file, old_str: String(e.old_string ?? ""), new_str: String(e.new_string ?? "") } }));
        }
        case "NotebookEdit": return [{ toolName: "edit", toolArgs: { path: file, old_str: "", new_str: String(args.new_source ?? "") } }];
        case "Bash": return [{ toolName: "bash", toolArgs: { command: String(args.command ?? "") } }];
        case "PowerShell": return [{ toolName: "powershell", toolArgs: { command: String(args.command ?? "") } }];
        case "Read": return [{ toolName: "view", toolArgs: { path: file } }];
        case "Skill": {
            const skill = String(args.skill ?? args.command ?? args.name ?? "").replace(/^\//, "");
            return [{ toolName: "skill", toolArgs: { skill: skill.includes(":") ? skill.slice(skill.lastIndexOf(":") + 1) : skill } }];
        }
        case "Agent": case "Task":
            return [{ toolName: "task", toolArgs: { agent_type: args.subagent_type, prompt: args.prompt, description: args.description } }];
        case "AskUserQuestion": return [{ toolName: "ask_user", toolArgs: { question: (args.questions || []).map(q => q.question).join("\n") } }];
        default:
            return [{ toolName: toolName.startsWith(MCP_PREFIX) ? toolName.slice(MCP_PREFIX.length) : toolName, toolArgs: args }];
    }
}

function preview(text, max = 20_000) { return String(text ?? "").slice(0, max); }

// A permission asked by Claude Code, in the request vocabulary of Vibe Studio window.
export function permissionRequest(toolName, input = {}, options = {}, cwd = process.cwd()) {
    const args = input && typeof input === "object" ? input : {};
    const intention = options.title || options.description || options.decisionReason || undefined;
    const canOfferSessionApproval = !options.suppressAlwaysAllowRule && Array.isArray(options.suggestions) && options.suggestions.length > 0;
    const base = { toolName, ...(intention ? { intention } : {}), canOfferSessionApproval };
    const file = args.file_path ?? args.notebook_path ?? args.path;
    switch (toolName) {
        case "Bash": case "PowerShell":
            return { ...base, kind: "shell", fullCommandText: String(args.command ?? ""), intention: args.description || intention };
        case "Write":
            return { ...base, kind: "write", fileName: file, diff: preview(String(args.content ?? "").split(/\r?\n/).map(line => `+${line}`).join("\n")) };
        case "Edit": case "MultiEdit": case "NotebookEdit": {
            const edits = toolName === "MultiEdit" ? args.edits || [] : toolName === "Edit" ? [args] : [{ old_string: "", new_string: args.new_source }];
            const diff = edits.map(e => [...String(e.old_string ?? "").split(/\r?\n/).filter(Boolean).map(l => `-${l}`),
                ...String(e.new_string ?? "").split(/\r?\n/).map(l => `+${l}`)].join("\n")).join("\n@@\n");
            return { ...base, kind: "write", fileName: file, diff: preview(diff) };
        }
        case "Read": case "Glob": case "Grep": case "LS": case "NotebookRead": {
            const target = options.blockedPath || file || cwd;
            return { ...base, kind: "read", path: target, resolvedPath: path.resolve(cwd, String(target)) };
        }
        case "WebFetch": case "WebSearch":
            return { ...base, kind: "url", url: args.url || args.query || "" };
        default: {
            const mcp = toolName.match(/^mcp__(.+?)__(.+)$/);
            if (mcp) return { ...base, kind: "mcp", serverName: options.mcpServer?.name || mcp[1], toolName: mcp[2] };
            return { ...base, kind: "custom-tool" };
        }
    }
}

// MCP servers declared by the project, in Claude Code form. .mcp.json is the file of Claude Code; the files of the
// editors and of Copilot are read too, as the Copilot adapter does. They are passed explicitly (strict MCP config).
export function projectMcpServers(project) {
    const servers = {};
    for (const [relative, key] of [[".mcp.json", "mcpServers"], [".vscode/mcp.json", "servers"], [".copilot/mcp-config.json", "mcpServers"], [".github/mcp.json", "mcpServers"]]) {
        const file = path.join(project, relative);
        if (!existsSync(file)) continue;
        let declared;
        try { declared = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""))[key] || {}; } catch { continue; }
        for (const [name, config] of Object.entries(declared)) {
            if (servers[name] || name === SERVER || !config || typeof config !== "object") continue;
            if (config.url && ["http", "sse"].includes(config.type || "http")) {
                servers[name] = { type: config.type || "http", url: config.url, ...(config.headers ? { headers: config.headers } : {}) };
            } else if (config.command) {
                servers[name] = { type: "stdio", command: config.command, ...(config.args ? { args: config.args } : {}), ...(config.env ? { env: config.env } : {}) };
            }
        }
    }
    return servers;
}

// Async queue of the user messages of a session: the streaming input of query().
class Inbox {
    constructor() { this.items = []; this.waiters = []; this.closed = false; }
    push(item) {
        if (this.closed) return false;
        const waiter = this.waiters.shift();
        if (waiter) waiter({ value: item, done: false }); else this.items.push(item);
        return true;
    }
    close() {
        this.closed = true;
        for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
    }
    [Symbol.asyncIterator]() {
        return {
            next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false })
                : this.closed ? Promise.resolve({ value: undefined, done: true })
                    : new Promise(resolve => this.waiters.push(resolve)),
            return: async () => { this.close(); return { value: undefined, done: true }; },
        };
    }
}

const textOf = content => typeof content === "string" ? content
    : Array.isArray(content) ? content.map(part => part?.text ?? "").join("") : "";

export class ClaudeHarness {
    /**
     * @param ui permission({ sessionId, request }) -> "approve" | "approve-session" | { reject: feedback };
     *           question({ sessionId, request }) -> { answer, wasFreeform }
     * @param command executable of Claude Code; by default the one shipped with the SDK, else `claude` on the PATH.
     * @param createQuery query() of the SDK (tests inject a fake one).
     */
    constructor({ ui = {}, model = "sonnet", command, createQuery, createServer, env } = {}) {
        this.ui = ui; this.fallbackModel = model; this.command = command;
        this.createQuery = createQuery || (async params => (await import("@anthropic-ai/claude-agent-sdk")).query(params));
        this.createServer = createServer || (async (tools, sessionId) => this.mcpServer(tools, sessionId));
        this.env = env;
        this.executable = null; this.login = null; this.connected = false; this.modelCache = null; this.active = new Map();
    }
    baseEnv() {
        return { ...process.env, ...this.env, CLAUDE_AGENT_SDK_CLIENT_APP: "vibe_studio",
            // Background agents and commands would let a turn end while work goes on: the step would look finished.
            CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" };
    }
    async findExecutable() {
        if (this.command) {
            if (existsSync(this.command)) return this.command;
            if (!/[\\/]/.test(this.command)) { const found = await locate(this.command); if (found) return found; }
            throw new Error("harness.missing", { name: NAME });
        }
        const found = bundledExecutable() || await locate("claude");
        if (!found) throw new Error("harness.missing", { name: NAME });
        return found;
    }
    // Starts Claude Code without any prompt: the initialize handshake gives the account and the models, and costs nothing.
    async probe() {
        const inbox = new Inbox();
        let stderr = "";
        const q = await this.createQuery({ prompt: inbox, options: { cwd: os.homedir(), settingSources: [], permissionMode: "default",
            pathToClaudeCodeExecutable: this.executable, env: this.baseEnv(), stderr: data => { stderr = (stderr + data).slice(-2000); } } });
        let timer;
        try {
            const drained = (async () => { for await (const message of q) void message; throw new globalThis.Error(`${NAME} stopped. ${stderr}`.trim()); })();
            drained.catch(() => {}); // it also rejects when the probe is closed, after the race
            const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new globalThis.Error(`${NAME} did not start in time.`)), 90_000); });
            return await Promise.race([q.initializationResult(), drained, timeout]);
        } catch (failure) {
            if (failure?.code === "ENOENT" || /ENOENT|not found/i.test(String(failure?.message))) throw new Error("harness.missing", { name: NAME });
            throw new Error("harness.network", { message: String(failure?.message || failure).slice(0, 300) });
        } finally {
            clearTimeout(timer);
            inbox.close();
            try { q.close?.(); } catch { /* already stopped */ }
        }
    }
    catalog(models = []) {
        const ids = new Set(models.map(m => m.value));
        return models.map(m => ({ id: m.value, name: m.displayName || m.value, ...(m.resolvedModel ? { resolvedModel: m.resolvedModel } : {}),
            ...(m.description ? { description: m.description } : {}),
            ...(m.supportsEffort && m.supportedEffortLevels?.length ? { supportedReasoningEfforts: m.supportedEffortLevels } : {}),
            ...(ids.has(`${m.value}[1m]`) ? { supportedContextTiers: ["default", "long_context"] } : {}) }));
    }
    async start() {
        if (this.connected) return { login: this.login };
        this.starting ??= (async () => {
            this.executable = await this.findExecutable();
            const init = await this.probe();
            const login = signedIn(init?.account);
            if (!login) throw new Error("harness.login");
            this.login = login;
            if (init.models?.length) this.modelCache = this.catalog(init.models);
            this.connected = true;
            return { login };
        })().finally(() => { this.starting = null; });
        return this.starting;
    }
    status() { return { harness: "claude", connected: this.connected, login: this.login, busy: this.active.size > 0 }; }
    defaultModel() {
        if (!this.modelCache || this.modelCache.some(m => m.id === this.fallbackModel)) return this.fallbackModel;
        return (this.modelCache.find(m => m.id === "default") || this.modelCache[0])?.id || this.fallbackModel;
    }
    async models() {
        await this.start();
        if (this.modelCache) return this.modelCache;
        this.modelRequest ??= (async () => {
            try { return await this.probe(); } catch { return await this.probe(); }
        })().finally(() => { this.modelRequest = null; });
        let init;
        try { init = await this.modelRequest; } catch (failure) { throw new Error("harness.network", { message: String(failure?.message || failure).slice(0, 300) }); }
        if (!init?.models?.length) throw new Error("harness.network", { message: "No model offered." });
        this.modelCache = this.catalog(init.models);
        return this.modelCache;
    }
    resolveModel(kitModel) {
        const list = this.modelCache || [];
        if (!kitModel) return this.defaultModel();
        const norm = value => String(value || "").toLowerCase().replace(/\./g, "-").replace(/\[.*\]$/, "");
        const exact = list.find(m => m.id === kitModel) || list.find(m => m.resolvedModel && norm(m.resolvedModel) === norm(kitModel));
        if (exact) return exact.id;
        const family = FAMILIES.find(name => norm(kitModel).includes(name));
        if (family) {
            const matching = list.filter(m => m.id === family || norm(m.resolvedModel || m.id).includes(family));
            const choice = matching.find(m => m.id === family) || matching.find(m => !m.id.includes("[")) || matching[0];
            if (choice) return choice.id;
        }
        return this.defaultModel();
    }
    // Agents of the kit installed for Claude Code (.claude/agents), as Claude Code reads them for the project.
    async agents(project) {
        await this.models();
        const folder = path.join(project, ".claude", "agents");
        const files = [];
        const walk = async dir => {
            for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) await walk(full);
                else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(full);
            }
        };
        await walk(folder);
        const agents = [];
        for (const file of files.sort()) {
            const { fields, body } = frontmatter(await readFile(file, "utf8"));
            const name = fields.name || path.basename(file).replace(/(\.agent)?\.md$/i, "");
            const tools = claudeTools(fields.tools);
            agents.push({ name, description: fields.description || "", prompt: body, ...(tools ? { tools } : {}),
                ...(fields.model ? { model: this.resolveModel(fields.model) } : {}),
                userInvocable: fields["user-invocable"] !== false });
        }
        return agents;
    }
    // In-process MCP server "vibe_studio": the tools of Vibe Studio, callable by the model as mcp__vibe_studio__<name>.
    async mcpServer(tools, sessionId) {
        const [{ createSdkMcpServer, tool }, { z }] = await Promise.all([import("@anthropic-ai/claude-agent-sdk"), import("zod")]);
        const definitions = tools.map(spec => {
            let shape = {};
            try { shape = z.fromJSONSchema(spec.parameters || { type: "object" }).shape || {}; } catch { shape = {}; }
            return tool(spec.name, spec.description || spec.name, shape, async args => {
                try {
                    const result = await spec.handler(args, { sessionId: sessionId() });
                    if (result && typeof result === "object" && result.resultType === "failure") {
                        return { content: [{ type: "text", text: String(result.textResultForLlm || "Failure.") }], isError: true };
                    }
                    return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result ?? "") }] };
                } catch (failure) {
                    return { content: [{ type: "text", text: String(failure?.message || failure) }], isError: true };
                }
            });
        });
        return createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: definitions, alwaysLoad: true });
    }
    async userMessage(prompt, attachments, sessionId) {
        const content = [{ type: "text", text: String(prompt ?? "") }];
        const mentioned = [];
        for (const file of attachments || []) {
            const type = IMAGE_TYPES[path.extname(file?.path || "").toLowerCase()];
            const data = type ? await readFile(file.path).catch(() => null) : null;
            if (data) content.push({ type: "image", source: { type: "base64", media_type: type, data: data.toString("base64") } });
            else if (file?.path) mentioned.push(`- ${file.path}${file.displayName ? ` (${file.displayName})` : ""}`);
        }
        if (mentioned.length) content[0].text += `\n\nAttached files (read them from these paths):\n${mentioned.join("\n")}`;
        return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, uuid: randomUUID(), session_id: sessionId, origin: { kind: "human" } };
    }
    /** One session for one step. Returns a handle Vibe Studio keeps while the step lives. */
    async openStep({ project, agent, model, contextTier, reasoningEffort, tools = [], hooks, mode, onEvent = () => {} }) {
        await this.start();
        const models = await this.models();
        const sessionId = randomUUID();
        const emit = (type, data = {}) => { try { onEvent({ type, id: randomUUID(), timestamp: new Date().toISOString(), data }); } catch { /* the window keeps going */ } };
        const state = { mode: mode || "interactive", turn: false, aborting: false, closed: false, authFailed: false, stderr: "",
            texts: new Map(), streams: new Map(), usage: new Map(), costUsd: 0 };

        const longModel = `${model}[1m]`;
        const sessionModel = contextTier === "long_context" && models.some(m => m.id === longModel) ? longModel : model;
        // Agents of the kit, passed explicitly: their Copilot tool names and models are translated for Claude Code.
        // The agent of the step runs the main thread natively (--agent) on the model shown to the user.
        const definitions = {};
        for (const item of await this.agents(project)) {
            definitions[item.name] = { description: item.description || item.name, prompt: item.prompt,
                ...(item.tools ? { tools: item.tools } : {}), model: item.name === agent ? sessionModel : item.model || "inherit" };
        }

        const ask = async request => {
            if (!this.ui.permission) return { reject: "No user is available in Vibe Studio." };
            emit("permission.requested", {});
            try { return await this.ui.permission({ sessionId, request }); }
            finally { emit("permission.completed", {}); }
        };
        const question = async request => {
            if (!this.ui.question) throw new Error("harness.noUser");
            emit("user_input.requested", {});
            try { return await this.ui.question({ sessionId, request }); }
            finally { emit("user_input.completed", {}); }
        };
        const unattended = new Set(tools.filter(spec => spec?.skipPermission).map(spec => MCP_PREFIX + spec.name));
        const canUseTool = async (toolName, input, options = {}) => {
            // The tools of Vibe Studio that need no approval (the report tool); the guards have already seen the call.
            if (unattended.has(toolName)) return { behavior: "allow", updatedInput: input };
            if (toolName === "AskUserQuestion") {
                const answers = {};
                try {
                    for (const item of input?.questions || []) {
                        const several = item.multiSelect ? " (several answers allowed, separated by commas)" : "";
                        const reply = await question({ question: `${item.question}${several}`, choices: (item.options || []).map(o => o.label), allowFreeform: true });
                        answers[item.question] = String(reply?.answer ?? "");
                    }
                } catch (failure) {
                    return { behavior: "deny", message: String(failure?.message || failure) };
                }
                return { behavior: "allow", updatedInput: { ...input, answers } };
            }
            const answer = await ask(permissionRequest(toolName, input, options, project));
            if (answer === "approve") return { behavior: "allow", updatedInput: input, decisionClassification: "user_temporary" };
            if (answer === "approve-session") {
                // "For this session" only: a suggestion that would write a settings file of the project or the user is kept in the session.
                const updatedPermissions = (options.suggestions || []).map(s => ({ ...s, destination: "session" }));
                return { behavior: "allow", updatedInput: input, ...(updatedPermissions.length ? { updatedPermissions } : {}), decisionClassification: "user_permanent" };
            }
            return { behavior: "deny", message: (answer && answer.reject) || "Refused by the user in Vibe Studio.", decisionClassification: "user_reject" };
        };
        const preToolUse = async input => {
            if (!hooks?.onPreToolUse) return {};
            let asked = null;
            try {
                for (const call of canonicalCalls(input.tool_name, input.tool_input)) {
                    const verdict = await hooks.onPreToolUse({ ...call, agentId: input.agent_id });
                    if (verdict?.permissionDecision === "deny") {
                        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.permissionDecisionReason || "Refused by a guard of Vibe Studio." } };
                    }
                    if (verdict?.permissionDecision === "ask") asked ??= verdict;
                }
            } catch (failure) {
                asked = { permissionDecisionReason: `Vibe Studio could not check its guards: ${failure?.message || failure}` };
            }
            if (asked) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: asked.permissionDecisionReason || "" } };
            return {}; // never "allow": the permissions of the user stay in force
        };
        const stop = async input => {
            if (!hooks?.onAgentStop) return {};
            try {
                const verdict = await hooks.onAgentStop({ stopHookActive: !!input?.stop_hook_active });
                // Claude Code goes on with the reason as feedback, and marks the next stop with stop_hook_active.
                if (verdict?.decision === "block") return { decision: "block", reason: String(verdict.reason || "") };
            } catch { /* the end checks never break the session */ }
            return {};
        };

        const vibeStudioTools = tools.filter(spec => spec && typeof spec.handler === "function");
        const mcpServers = { ...projectMcpServers(project) };
        if (vibeStudioTools.length) mcpServers[SERVER] = await this.createServer(vibeStudioTools, () => sessionId);
        const inbox = new Inbox();
        const options = {
            cwd: project, model: sessionModel, sessionId, permissionMode: "default", settingSources: ["project"], skills: "all",
            ...(reasoningEffort ? { effort: reasoningEffort } : {}),
            includePartialMessages: true, pathToClaudeCodeExecutable: this.executable, env: this.baseEnv(),
            agents: definitions, ...(agent && definitions[agent] ? { agent } : {}),
            mcpServers, strictMcpConfig: true, disallowedTools: DISALLOWED,
            canUseTool,
            hooks: { PreToolUse: [{ hooks: [preToolUse] }], Stop: [{ hooks: [stop] }] },
            stderr: data => { state.stderr = (state.stderr + data).slice(-2000); },
        };
        const q = await this.createQuery({ prompt: inbox, options });

        const turnStart = () => { if (!state.turn) { state.turn = true; emit("assistant.turn_start", {}); } };
        const toolName = name => name?.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
        const handleUsage = result => {
            const perModel = result.modelUsage && Object.keys(result.modelUsage).length ? result.modelUsage : null;
            if (perModel) {
                for (const [name, usage] of Object.entries(perModel)) {
                    const before = state.usage.get(name) || { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 };
                    state.usage.set(name, usage);
                    if ((name === sessionModel || Object.keys(perModel).length === 1) && usage.contextWindow > 0)
                        emit("session.usage_info", { tokenLimit: usage.contextWindow });
                    const delta = key => Math.max(0, (usage[key] || 0) - (before[key] || 0));
                    if (!delta("inputTokens") && !delta("outputTokens") && !delta("costUSD")) continue;
                    emit("vibe_studio.usage", { model: name, inputTokens: delta("inputTokens"), outputTokens: delta("outputTokens"),
                        cacheReadTokens: delta("cacheReadInputTokens"), cacheWriteTokens: delta("cacheCreationInputTokens"), costUsd: delta("costUSD"), aggregate: true });
                }
            } else if (result.usage) {
                const cost = Math.max(0, (result.total_cost_usd || 0) - state.costUsd);
                emit("vibe_studio.usage", { model: sessionModel, inputTokens: result.usage.input_tokens || 0, outputTokens: result.usage.output_tokens || 0,
                    cacheReadTokens: result.usage.cache_read_input_tokens || 0, cacheWriteTokens: result.usage.cache_creation_input_tokens || 0, costUsd: cost });
            }
            if (typeof result.total_cost_usd === "number") state.costUsd = result.total_cost_usd;
        };
        const handle = message => {
            const parentToolCallId = message.parent_tool_use_id || undefined;
            switch (message.type) {
                case "stream_event": {
                    turnStart();
                    const event = message.event || {}, key = parentToolCallId || "main";
                    if (event.type === "message_start") state.streams.set(key, event.message?.id);
                    else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                        emit("assistant.message_delta", { messageId: state.streams.get(key) || message.uuid, deltaContent: event.delta.text || "",
                            ...(parentToolCallId ? { parentToolCallId } : {}) });
                    }
                    return;
                }
                case "assistant": {
                    turnStart();
                    if (message.error === "authentication_failed") state.authFailed = true;
                    const messageId = message.message?.id || message.uuid;
                    for (const block of message.message?.content || []) {
                        if (block.type === "text" && block.text) {
                            const content = (state.texts.get(messageId) || "") + block.text;
                            state.texts.set(messageId, content);
                            emit("assistant.message", { messageId, content, ...(parentToolCallId ? { parentToolCallId } : {}) });
                        } else if (block.type === "tool_use") {
                            const args = block.input && typeof block.input === "object" ? block.input : {};
                            const shown = args.file_path || args.notebook_path ? { ...args, path: args.file_path || args.notebook_path } : args;
                            emit("tool.execution_start", { toolCallId: block.id, toolName: toolName(block.name), arguments: shown, ...(parentToolCallId ? { parentToolCallId } : {}) });
                            if (block.name === "Agent" || block.name === "Task") {
                                const agentName = args.subagent_type || "general-purpose";
                                emit("subagent.started", { toolCallId: block.id, agentName, agentDisplayName: args.description || agentName });
                            }
                        }
                    }
                    return;
                }
                case "user": {
                    const content = message.message?.content;
                    if (!Array.isArray(content)) return;
                    for (const block of content) {
                        if (block?.type !== "tool_result") continue;
                        const failed = !!block.is_error;
                        emit("tool.execution_complete", { toolCallId: block.tool_use_id, success: !failed,
                            ...(failed ? { error: { message: textOf(block.content).slice(0, 500) } } : {}) });
                    }
                    return;
                }
                case "result": {
                    handleUsage(message);
                    if (message.queued_turn_count > 0) return; // another turn follows at once
                    const aborted = state.aborting;
                    state.turn = false; state.aborting = false; state.texts.clear();
                    if (state.authFailed) { state.authFailed = false; this.connected = false; emit("session.error", { message: new Error("harness.login").message }); return; }
                    if (message.is_error && !aborted) {
                        emit("session.error", { message: [...(message.errors || []), message.subtype !== "success" ? message.subtype : message.result].filter(Boolean).join("\n").slice(0, 1000) });
                        return;
                    }
                    emit("session.idle", aborted ? { aborted: true } : {});
                    return;
                }
                default:
                    return;
            }
        };
        const loop = (async () => {
            try {
                for await (const message of q) handle(message);
                if (!state.closed) emit("session.error", { message: `${NAME} stopped. ${state.stderr}`.trim().slice(0, 1000) });
            } catch (failure) {
                if (!state.closed) emit("session.error", { message: String(failure?.message || failure).slice(0, 1000) });
            } finally {
                state.turn = false;
                if (!state.closed) { state.closed = true; inbox.close(); this.active.delete(sessionId); }
            }
        })();

        const sessionHandle = {
            sessionId,
            send: async (prompt, attachments = []) => {
                if (state.closed) throw new globalThis.Error(`${NAME} session is closed.`);
                const message = await this.userMessage(prompt, attachments, sessionId);
                inbox.push(message);
                turnStart();
                return message.uuid;
            },
            abort: async () => {
                if (!state.turn || state.closed) return;
                state.aborting = true;
                await q.interrupt();
            },
            disconnect: async () => {
                if (!state.closed) { state.closed = true; inbox.close(); }
                this.active.delete(sessionId);
                try { q.close?.(); } catch { /* already stopped */ }
                await Promise.race([loop, new Promise(resolve => setTimeout(resolve, 2000).unref?.())]);
            },
            // Autopilot keeps the "default" mode: ui.permission approves, so that guards and the user still see each tool.
            setMode: async next => { state.mode = next; },
            current: async () => ({ modelId: sessionModel, mode: state.mode }),
        };
        this.active.set(sessionId, sessionHandle);
        return sessionHandle;
    }
    async setMode(mode) {
        for (const handle of this.active.values()) await handle.setMode?.(mode)?.catch?.(() => {});
    }
    async stop() {
        for (const handle of [...this.active.values()]) await handle.disconnect().catch(() => {});
        this.active.clear();
        this.connected = false; this.login = null;
    }
}
