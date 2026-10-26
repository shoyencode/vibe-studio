// Gemini CLI adapter of Vibe Studio: drives `gemini --acp` through the Agent Client Protocol (ACP), the official
// integration interface of Gemini CLI. One Gemini process serves every session of Vibe Studio.
// 1. File writes: Vibe Studio advertises the ACP file system, so Gemini writes project files through
//    fs/write_text_file, where the guards of the kit are checked again before anything reaches the disk.
// 2. Permissions: every session/request_permission goes through the guards, then to the window. The session stays in
//    the "default" approval mode of Gemini (asks before edits, shell commands, skills and MCP tools), even in autopilot:
//    Vibe Studio answers the permissions itself in autopilot.
// 3. Vibe Studio tools (vibe_studio_report, ask_user): Gemini has no custom tool API over ACP and drops its own ask_user tool
//    in ACP mode, so they are served by a loopback MCP server given in session/new (Gemini names them mcp_vibe_studio_*).
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { UserError } from "../errors.mjs";
import { frontmatter } from "./copilot.mjs";
import { LoopbackTools } from "./mcp-tools.mjs";

export const DEFAULT_MODEL = "auto";
// Models offered by Gemini CLI 0.65 without preview access; the live list comes from session/new.
export const FALLBACK_MODELS = [
    { id: "auto", name: "Auto (Gemini)" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
];
const SERVER = "vibe_studio";
const MODE = "default";
const QUESTION_WAIT = 9 * 60_000; // Gemini stops waiting for an MCP tool after 10 minutes.
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const IMAGE_LIMIT = 10 * 1024 * 1024;
const STILL_WAITING = Symbol("waiting");

const geminiHome = (env = process.env) => env.GEMINI_CLI_HOME || path.join(os.homedir(), ".gemini");
const key = file => { const resolved = path.resolve(file); return process.platform === "win32" ? resolved.toLowerCase() : resolved; };
const inside = (root, file) => {
    const relative = path.relative(key(root), key(file));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
const writeKey = (file, content) => `${key(file)}\0${String(content).replace(/\r\n/g, "\n")}`;

// Command line of the Gemini CLI. On Windows the npm shim gemini.cmd is resolved to node + the script of the package,
// so that the process starts without a shell.
export function resolveCommand(command = "gemini", { platform = process.platform, env = process.env } = {}) {
    const dirs = String(env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
    const find = name => path.isAbsolute(name) ? (existsSync(name) ? name : null) : dirs.map(dir => path.join(dir, name)).find(existsSync) || null;
    const nodeNear = dir => {
        const local = path.join(dir, platform === "win32" ? "node.exe" : "node");
        return existsSync(local) ? local : find(platform === "win32" ? "node.exe" : "node") || "node";
    };
    if (/\.(m?js|cjs)$/i.test(command)) {
        const script = find(command);
        return script && { file: nodeNear(path.dirname(script)), args: [script] };
    }
    if (platform !== "win32") { const bin = find(command); return bin && { file: bin, args: [] }; }
    const shim = /\.(cmd|bat|exe)$/i.test(command) ? find(command) : find(`${command}.cmd`) || find(`${command}.exe`);
    if (!shim) return null;
    if (/\.exe$/i.test(shim)) return { file: shim, args: [] };
    let script = null;
    try { script = readFileSync(shim, "utf8").match(/"%dp0%\\([^"]+?\.m?js)"/)?.[1] || null; } catch { /* unreadable shim */ }
    const entry = path.join(path.dirname(shim), ...(script ? script.split(/[\\/]/) : ["node_modules", "@google", "gemini-cli", "bundle", "gemini.js"]));
    return existsSync(entry) ? { file: nodeNear(path.dirname(shim)), args: [entry] } : null;
}

// Spawns `gemini --acp` and wraps its standard streams as an ACP stream.
export async function spawnTransport({ command = "gemini", cwd = os.tmpdir(), env = process.env } = {}) {
    const resolved = resolveCommand(command, { env });
    if (!resolved) throw new UserError("harness.missing", { name: "Gemini CLI" });
    const { ndJsonStream } = await import("@agentclientprotocol/sdk/unstable");
    // --skip-trust: the project opened in Vibe Studio is trusted, otherwise Gemini ignores its skills and settings.
    const child = spawn(resolved.file, [...resolved.args, "--acp", "--skip-trust"], {
        cwd, env: { ...env, GEMINI_CLI_NO_RELAUNCH: "true" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false,
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
    const exited = new Promise(resolve => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
        child.once("error", error => resolve({ error }));
    });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); })
        .catch(error => { throw error?.code === "ENOENT" ? new UserError("harness.missing", { name: "Gemini CLI" }) : error; });
    child.stdin.on("error", () => {});
    return {
        stream: ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
        exited, stderr: () => stderr,
        close: async () => {
            child.stdin.end();
            const timer = setTimeout(() => child.kill(), 2000);
            await exited;
            clearTimeout(timer);
        },
    };
}

// Lines that differ between two texts: what an edit removes and what it adds.
export function changedRegion(before, after) {
    const a = String(before ?? "").replace(/\r\n/g, "\n").split("\n"), b = String(after ?? "").replace(/\r\n/g, "\n").split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    return { old_str: a.slice(start, a.length - end).join("\n"), new_str: b.slice(start, b.length - end).join("\n") };
}

function diffText(file, before, after) {
    const { old_str: removed, new_str: added } = changedRegion(before, after);
    const lines = text => (text ? text.split("\n") : []);
    return [`--- ${file}`, `+++ ${file}`, ...lines(removed).map(line => `-${line}`), ...lines(added).map(line => `+${line}`)].join("\n");
}

const textOf = content => (content || []).filter(item => item?.type === "content" && item.content?.type === "text").map(item => item.content.text).join("\n");

// What an ACP tool call is: Gemini sends no tool name, only an id (`<tool>_<time>_<n>`), a title, a kind and contents.
export function describeCall(call = {}, ownTools = []) {
    const title = String(call.title || "");
    let name = String(call.toolCallId || "").match(/^(.+?)[_-]\d{10,}[_-]\d+$/)?.[1] || null;
    const ownPrefix = `mcp_${SERVER}_`;
    let own = name?.startsWith(ownPrefix) && ownTools.includes(name.slice(ownPrefix.length)) ? name.slice(ownPrefix.length) : null;
    if (!own && !name && call.kind === "other") own = ownTools.find(tool => title.startsWith(`${tool}(`)) || null;
    const skill = name === "activate_skill" || (!name && call.kind === "other")
        ? title.match(/^"([^"]+)"(?::| \(\?\))/)?.[1] || (name === "activate_skill" ? call.rawInput?.name : null) : null;
    if (skill) name = "activate_skill";
    const diffs = (call.content || []).filter(item => item?.type === "diff" && item.path);
    const locations = (call.locations || []).map(location => location?.path).filter(Boolean);
    const command = call.kind === "execute" ? String(call.rawInput?.command ?? title) : null;
    if (!name) name = command !== null ? "run_shell_command" : call.kind || "tool";
    return { name: own || name, own, skill, title, diffs, locations, command, kind: call.kind || "other", explanation: textOf(call.content) };
}

// Tool calls of an ACP call in the canonical vocabulary of guards.mjs.
export function guardCalls(info, { shell = process.platform === "win32" ? "powershell" : "bash" } = {}) {
    if (info.own) return [];
    if (info.command !== null) return [{ toolName: shell, toolArgs: { command: info.command } }];
    if (info.skill) return [{ toolName: "skill", toolArgs: { skill: info.skill } }];
    if (info.diffs.length) {
        return info.diffs.map(diff => {
            const before = diff.oldText ?? null, after = diff.newText ?? "";
            // A new file, or write_file over an existing one: the whole file is written.
            const whole = !before || info.name === "write_file" || /^Writing to /.test(info.title);
            return whole
                ? { toolName: "create", toolArgs: { path: diff.path, file_text: after }, write: { path: diff.path, content: after } }
                : { toolName: "edit", toolArgs: { path: diff.path, ...changedRegion(before, after) }, write: { path: diff.path, content: after } };
        });
    }
    if (["edit", "delete", "move"].includes(info.kind)) return info.locations.map(file => ({ toolName: "edit", toolArgs: { path: file, old_str: "", new_str: "" } }));
    return [];
}

// Permission request of Vibe Studio window for an ACP call.
export function permissionRequest(info, project) {
    const intention = info.explanation || info.title;
    if (info.command !== null) return { kind: "shell", fullCommandText: info.command, intention, canOfferSessionApproval: true };
    if (info.diffs.length) {
        const [diff] = info.diffs;
        return { kind: "write", fileName: diff.path, path: diff.path, intention: info.title, canOfferSessionApproval: true,
            diff: info.diffs.map(item => diffText(item.path, item.oldText, item.newText)).join("\n") };
    }
    if (info.kind === "read") {
        const file = info.locations[0] || info.title.replace(/^Allow access to absolute path:\s*/, "");
        return { kind: "read", path: file, resolvedPath: path.resolve(project, file), intention: info.title, canOfferSessionApproval: true };
    }
    if (info.kind === "fetch") return { kind: "url", url: info.title.match(/https?:\/\/\S+/)?.[0] || info.title, intention, canOfferSessionApproval: true };
    if (info.name.startsWith("mcp_")) {
        const toolName = info.title.split("(")[0] || info.name;
        const serverName = info.name.endsWith(`_${toolName}`) ? info.name.slice(4, -(toolName.length + 1)) : info.name.slice(4);
        return { kind: "mcp", serverName, toolName, intention, canOfferSessionApproval: true };
    }
    return { kind: "custom-tool", toolName: info.name, intention, canOfferSessionApproval: true };
}

function approvalKey(request) {
    if (request.kind === "shell") return `shell:${String(request.fullCommandText || "").trim().split(/\s+/)[0].toLowerCase()}`;
    if (request.kind === "mcp") return `mcp:${request.serverName}:${request.toolName}`;
    if (request.kind === "custom-tool") return `tool:${request.toolName}`;
    return request.kind;
}

const isAuthError = error => error?.code === -32000 || /auth|api key|credential|sign[ -]?in|log[ -]?in/i.test(String(error?.message || ""));
const modelsOf = response => (response?.models?.availableModels || [])
    .filter(model => typeof model?.modelId === "string")
    .map(model => ({ id: model.modelId, name: model.name || model.modelId, ...(model.description ? { description: model.description } : {}) }));

function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); timer.unref?.(); })])
        .finally(() => clearTimeout(timer));
}

export class GeminiHarness {
    /**
     * @param ui permission({ sessionId, request }) -> "approve" | "approve-session" | { reject: feedback };
     *           question({ sessionId, request }) -> { answer, wasFreeform }
     * @param createTransport tests: async ({ cwd }) -> { stream, close?, exited?, stderr? } where stream is an ACP stream.
     */
    constructor({ ui = {}, model = DEFAULT_MODEL, command = "gemini", createTransport, env = process.env, questionWait = QUESTION_WAIT } = {}) {
        this.ui = ui; this.fallbackModel = model; this.command = command; this.env = env; this.questionWait = questionWait;
        this.createTransport = createTransport || (options => spawnTransport({ command: this.command, env: this.env, ...options }));
        this.acp = null; this.agent = null; this.connection = null; this.transport = null; this.capabilities = null;
        this.authMethods = []; this.login = null; this.modelCache = null;
        this.sessions = new Map(); this.active = new Map(); this.tools = new LoopbackTools({ name: SERVER });
    }
    async start() {
        if (!this.agent) {
            this.starting ??= this.connect().finally(() => { this.starting = null; });
            await this.starting;
        }
        return { login: this.login };
    }
    async connect() {
        const acp = this.acp = await import("@agentclientprotocol/sdk/unstable");
        const transport = await this.createTransport({ cwd: os.tmpdir() });
        // Raw handlers: Gemini bundles an older ACP library; its messages are read as sent, without schema stripping.
        const connection = acp.client({ name: "vibe_studio" })
            .onRequest("*", context => this.clientRequest(context.method, context.params))
            .onNotification("*", context => this.clientNotification(context.method, context.params))
            .connect(transport.stream);
        const fail = async error => {
            connection.close();
            await transport.close?.().catch(() => {});
            throw error;
        };
        let init;
        try {
            init = await withTimeout(connection.agent.request("initialize", {
                protocolVersion: acp.PROTOCOL_VERSION,
                clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
                clientInfo: { name: "vibe-studio", title: "Vibe Studio", version: "1" },
            }), 90_000, "Gemini CLI did not answer (initialize).");
        } catch (error) {
            const detail = transport.stderr?.() || "";
            return fail(error instanceof UserError ? error : new UserError("harness.network", { message: `${error?.message || error} ${detail}`.trim().slice(0, 300) }));
        }
        this.capabilities = init?.agentCapabilities || {};
        this.authMethods = init?.authMethods || [];
        this.agent = connection.agent; this.connection = connection; this.transport = transport;
        try {
            // A session in a neutral folder checks the sign-in (Gemini asks for it only there) and gives the models.
            await this.probe().catch(error => { if (error.key === "harness.login") throw error; return this.probe(); });
        } catch (error) {
            this.agent = null; this.connection = null; this.transport = null;
            return fail(error);
        }
        this.login = this.loginName();
        const lost = () => { if (this.connection === connection) this.lost(transport); };
        void connection.closed?.then(lost, lost);
        void transport.exited?.then(lost);
    }
    async probe() {
        try {
            const response = await this.agent.request("session/new", { cwd: os.tmpdir(), mcpServers: [] });
            const models = modelsOf(response);
            this.modelCache = models.length ? models : this.modelCache || FALLBACK_MODELS;
            return response;
        } catch (error) {
            throw this.mapError(error);
        }
    }
    mapError(error) {
        if (error instanceof UserError) return error;
        if (isAuthError(error)) return new UserError("harness.login");
        return new UserError("harness.network", { message: String(error?.message || error).slice(0, 300) });
    }
    loginName() {
        try {
            const accounts = JSON.parse(readFileSync(path.join(geminiHome(this.env), "google_accounts.json"), "utf8"));
            if (typeof accounts?.active === "string" && accounts.active) return accounts.active;
        } catch { /* no Google account cached */ }
        if (this.env.GEMINI_API_KEY || this.env.GOOGLE_API_KEY) return "API key";
        if (this.env.GOOGLE_GENAI_USE_VERTEXAI) return "Vertex AI";
        return null;
    }
    lost(transport) {
        const detail = transport?.stderr?.().trim().split(/\r?\n/).slice(-3).join(" ") || "";
        for (const state of this.sessions.values()) {
            if (state.closed) continue;
            state.closed = true;
            state.registration?.close();
            this.emit(state, "session.error", { message: `Gemini CLI stopped.${detail ? ` ${detail}` : ""}` });
        }
        this.sessions.clear(); this.active.clear();
        this.agent = null; this.connection = null; this.transport = null;
    }
    status() { return { harness: "gemini", connected: !!this.agent, login: this.login, busy: this.active.size > 0 }; }
    defaultModel() { return this.fallbackModel; }
    async models() {
        await this.start();
        if (this.modelCache) return this.modelCache;
        this.modelRequest ??= (async () => {
            try { return await this.probe(); }
            catch (error) { if (error.key === "harness.login") throw error; return await this.probe(); }
        })().finally(() => { this.modelRequest = null; });
        await this.modelRequest;
        return this.modelCache;
    }
    resolveModel(kitModel) {
        const ids = (this.modelCache || FALLBACK_MODELS).map(model => model.id);
        if (!kitModel) return this.defaultModel();
        if (ids.includes(kitModel)) return kitModel;
        const id = String(kitModel).toLowerCase();
        let family = null;
        if (id.includes("gemini")) family = /lite/.test(id) ? "lite" : /flash/.test(id) ? "flash" : /pro/.test(id) ? "pro" : null;
        else if (id.includes("opus")) family = "pro";
        else if (/haiku|mini|nano/.test(id)) family = "flash";
        const tests = { pro: m => /pro/.test(m), flash: m => /flash/.test(m) && !/lite/.test(m), lite: m => /lite/.test(m) };
        const found = family ? ids.find(m => !m.startsWith("auto") && tests[family](m.toLowerCase())) : null;
        return found || this.defaultModel();
    }
    // Agents of the kit: Gemini sub-agents (.gemini/agents), then the agents deployed for Copilot (.github/agents) and
    // the agents of a kit package (.apm/agents). APM deploys no agent for the gemini target.
    async agents(project) {
        const found = new Map();
        for (const [folder, pattern] of [[".gemini/agents", /\.md$/i], [".github/agents", /\.md$/i], [".apm/agents", /\.agent\.md$/i]]) {
            const dir = path.join(project, folder);
            let names;
            try { names = readdirSync(dir).filter(name => pattern.test(name)).sort(); } catch { continue; }
            for (const name of names) {
                const file = path.join(dir, name);
                let text;
                try { if (!statSync(file).isFile()) continue; text = readFileSync(file, "utf8"); } catch { continue; }
                const { fields, body } = frontmatter(text);
                const agentName = String(fields.name || name.replace(/(\.agent)?\.md$/i, ""));
                if (found.has(agentName)) continue;
                found.set(agentName, {
                    name: agentName, displayName: fields.displayName || agentName, description: fields.description || "", prompt: body.trim(),
                    ...(Array.isArray(fields.tools) ? { tools: fields.tools } : {}),
                    ...(fields.model ? { model: this.resolveModel(fields.model) } : {}),
                    userInvocable: fields["user-invocable"] !== false && fields.userInvocable !== false, path: file,
                });
            }
        }
        return [...found.values()];
    }
    emit(state, type, data = {}) {
        try { state.onEvent({ type, id: randomUUID(), timestamp: new Date().toISOString(), data }); } catch { /* the window keeps going */ }
    }
    /** One session for one step. Returns a handle Vibe Studio keeps while the step lives. */
    async openStep({ project, agent, model, contextTier, tools = [], hooks, mode, onEvent = () => {} }) {
        void contextTier; // Gemini has no context tier.
        await this.start();
        const state = {
            sessionId: null, project, hooks, onEvent, model, mode: mode || "interactive", queue: [], running: false, closed: false,
            stopHookActive: false, approvals: new Set(), writes: new Set(), refusals: new Map(), notes: [], questions: new Map(),
            message: null, agentPrompt: null, agentName: agent || null, currentModel: null, currentMode: null, modes: null,
        };
        const own = [...tools.filter(tool => tool?.name && tool.name !== "ask_user"), this.askUserTool(state)];
        state.ownTools = own.map(tool => tool.name);
        const registration = state.registration = await this.tools.register(own.map(tool => ({
            name: tool.name, description: tool.description, parameters: tool.parameters,
            handler: (input, invocation) => tool.handler(input, { ...invocation, sessionId: state.sessionId }),
        })));
        let response;
        try {
            response = await this.agent.request("session/new", { cwd: project, mcpServers: [LoopbackTools.acpServer(registration)] });
        } catch (error) {
            registration.close();
            throw this.mapError(error);
        }
        const sessionId = state.sessionId = registration.sessionId = response.sessionId;
        state.modes = response.modes || null;
        state.currentMode = response.modes?.currentModeId || null;
        state.currentModel = response.models?.currentModelId || null;
        if (modelsOf(response).length) this.modelCache = modelsOf(response);
        this.sessions.set(sessionId, state);
        if (model && model !== state.currentModel) {
            try { await this.agent.request("session/set_model", { sessionId, modelId: model }); state.currentModel = model; }
            catch { /* unstable method: Gemini keeps its own model */ }
        }
        await this.applyMode(state, state.mode);
        // Gemini cannot select an agent over ACP: its instructions open the first message of the session.
        if (agent) state.agentPrompt = (await this.agents(project)).find(item => item.name === agent)?.prompt || null;
        const handle = {
            sessionId,
            send: async (prompt, attachments = []) => {
                if (state.closed) throw new UserError("run.notHosted");
                const id = randomUUID();
                state.queue.push({ id, prompt: String(prompt ?? ""), attachments: Array.isArray(attachments) ? attachments : [], user: true });
                void this.pump(state);
                return id;
            },
            abort: async () => {
                state.queue.length = 0;
                if (state.running && this.agent) await this.agent.notify("session/cancel", { sessionId });
            },
            disconnect: async () => {
                await handle.abort();
                state.closed = true;
                registration.close();
                this.sessions.delete(sessionId); this.active.delete(sessionId);
            },
            current: async () => ({ modelId: state.currentModel || state.model, mode: state.currentMode }),
            setMode: next => this.applyMode(state, next),
        };
        this.active.set(sessionId, handle);
        return handle;
    }
    // Autopilot and interactive both keep the "default" approval mode of Gemini: auto_edit and yolo would run tools
    // without asking Vibe Studio. In autopilot Vibe Studio approves the permissions itself.
    async applyMode(state, mode) {
        state.mode = mode || state.mode;
        const offered = state.modes?.availableModes?.some(item => item.id === MODE);
        if (!offered || state.currentMode === MODE || !this.agent) return;
        try { await this.agent.request("session/set_mode", { sessionId: state.sessionId, modeId: MODE }); state.currentMode = MODE; }
        catch { /* best effort */ }
    }
    async setMode(mode) {
        for (const handle of this.active.values()) await handle.setMode?.(mode)?.catch?.(() => {});
    }
    async pump(state) {
        if (state.running || state.closed) return;
        const item = state.queue.shift();
        if (!item) return;
        state.running = true;
        try { await this.turn(state, item); }
        catch (error) { this.emit(state, "session.error", { message: String(error?.message || error) }); }
        finally { state.running = false; }
        if (state.queue.length && !state.closed) void this.pump(state);
    }
    async blocks(text, attachments) {
        const blocks = [], mentions = [];
        for (const attachment of attachments) {
            const file = attachment?.path;
            if (typeof file !== "string" || !file) continue;
            const mimeType = IMAGE_TYPES[path.extname(file).toLowerCase()];
            if (mimeType && this.capabilities?.promptCapabilities?.image) {
                try {
                    const data = await readFile(file);
                    if (data.length <= IMAGE_LIMIT) { blocks.push({ type: "image", mimeType, data: data.toString("base64") }); continue; }
                } catch { /* mentioned below */ }
            }
            mentions.push(`- ${path.resolve(file)}${attachment.displayName ? ` (${attachment.displayName})` : ""}`);
        }
        const body = mentions.length ? `${text}\n\nAttached files (read them from disk):\n${mentions.join("\n")}` : text;
        return [{ type: "text", text: body }, ...blocks];
    }
    async turn(state, item) {
        if (item.user) state.stopHookActive = false;
        let text = item.prompt;
        if (state.notes.length) { text = `${state.notes.join("\n")}\n\n${text}`; state.notes = []; }
        if (state.agentPrompt) {
            text = `Act as the agent "${state.agentName}" for this whole session. Its instructions:\n<agent_instructions>\n${state.agentPrompt}\n</agent_instructions>\n\n${text}`;
            state.agentPrompt = null;
        }
        const prompt = await this.blocks(text, item.attachments);
        this.emit(state, "assistant.turn_start", {});
        let result;
        try {
            result = await this.agent.request("session/prompt", { sessionId: state.sessionId, prompt });
        } catch (error) {
            this.flush(state);
            this.emit(state, "session.error", { message: String(error?.message || error) });
            return;
        }
        this.flush(state);
        const usage = result?.usage;
        if (usage && (usage.inputTokens || usage.outputTokens)) {
            this.emit(state, "vibe_studio.usage", { model: state.currentModel || state.model, inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 });
        }
        if (result?.stopReason === "cancelled" || state.closed) { this.emit(state, "session.idle", { aborted: true }); return; }
        if (result?.stopReason === "end_turn" && state.hooks?.onAgentStop) {
            let verdict;
            try { verdict = await state.hooks.onAgentStop({ stopHookActive: state.stopHookActive }); } catch { verdict = undefined; }
            if (verdict?.decision === "block" && verdict.reason) {
                state.stopHookActive = true;
                state.queue.unshift({ id: randomUUID(), prompt: String(verdict.reason), attachments: [], user: false });
                return;
            }
        }
        this.emit(state, "session.idle", {});
    }
    flush(state) {
        const message = state.message;
        state.message = null;
        if (message?.text) this.emit(state, "assistant.message", { messageId: message.id, content: message.text });
    }
    clientNotification(method, params) {
        if (method !== "session/update") return;
        const state = this.sessions.get(params?.sessionId);
        const update = params?.update;
        if (!state || !update) return;
        switch (update.sessionUpdate) {
            case "agent_message_chunk": {
                const text = update.content?.type === "text" ? String(update.content.text ?? "") : "";
                if (!text || text.startsWith("[MODE_UPDATE]")) return;
                state.message ??= { id: randomUUID(), text: "" };
                state.message.text += text;
                this.emit(state, "assistant.message_delta", { messageId: state.message.id, deltaContent: text });
                return;
            }
            case "tool_call": {
                this.flush(state);
                const info = describeCall(update, state.ownTools);
                const args = update.rawInput && typeof update.rawInput === "object" ? update.rawInput
                    : info.command !== null ? { command: info.command } : info.skill ? { skill: info.skill }
                    : info.locations[0] ? { path: info.locations[0] } : {};
                this.emit(state, "tool.execution_start", { toolCallId: update.toolCallId, toolName: info.name, arguments: args });
                if (update.status === "completed" || update.status === "failed") {
                    this.emit(state, "tool.execution_complete", { toolCallId: update.toolCallId, success: update.status === "completed" });
                }
                return;
            }
            case "tool_call_update": {
                if (update.status !== "completed" && update.status !== "failed") return;
                const failed = update.status === "failed";
                this.emit(state, "tool.execution_complete", { toolCallId: update.toolCallId, success: !failed,
                    ...(failed ? { error: { message: textOf(update.content) || "The tool failed." } } : {}) });
                return;
            }
            case "current_mode_update":
                state.currentMode = update.currentModeId || state.currentMode;
                return;
            default:
                return;
        }
    }
    async clientRequest(method, params) {
        if (method === "session/request_permission") return this.permission(params);
        if (method === "fs/write_text_file") return this.writeTextFile(params);
        if (method === "fs/read_text_file") return this.readTextFile(params);
        throw this.acp.RequestError.methodNotFound(method);
    }
    async ask(state, request) {
        this.emit(state, "permission.requested", {});
        try {
            return this.ui.permission ? await this.ui.permission({ sessionId: state.sessionId, request }) : { reject: "No user is available." };
        } finally {
            this.emit(state, "permission.completed", {});
        }
    }
    async permission(params) {
        const options = Array.isArray(params?.options) ? params.options : [];
        const select = option => option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
        const allow = () => select(options.find(o => o.kind === "allow_once") || options.find(o => o.kind === "allow_always"));
        const reject = () => select(options.find(o => o.kind === "reject_once") || options.find(o => o.kind === "reject_always"));
        const state = this.sessions.get(params?.sessionId);
        if (!state || state.closed) return reject();
        const info = describeCall(params.toolCall || {}, state.ownTools);
        // Vibe Studio tools are answered at once, for the whole server, like skipPermission in the Copilot SDK.
        if (info.own) return select(options.find(o => o.optionId === "proceed_always_server") || options.find(o => o.kind === "allow_once"));
        const checks = guardCalls(info);
        let forced = false;
        for (const check of checks) {
            let verdict;
            try { verdict = await state.hooks?.onPreToolUse?.({ toolName: check.toolName, toolArgs: check.toolArgs, agentId: undefined }); }
            catch (error) { verdict = { permissionDecision: "deny", permissionDecisionReason: `Guard error: ${error?.message || error}` }; }
            if (verdict?.permissionDecision === "deny") {
                const reason = verdict.permissionDecisionReason || "Refused by a guard of Vibe Studio.";
                // A refused write in the project is let through to fs/write_text_file, which refuses it: the model
                // reads the reason there. Gemini would only say "canceled by the user" for a rejected permission.
                if (check.write && inside(state.project, check.write.path) && !inside(geminiHome(this.env), check.write.path)) {
                    state.refusals.set(key(check.write.path), reason);
                    return allow();
                }
                state.notes.push(`[Vibe Studio] "${info.command ?? info.title}" was refused by a guard: ${reason}`);
                return reject();
            }
            if (verdict?.permissionDecision === "ask") forced = true;
        }
        const request = permissionRequest(info, state.project);
        const remembered = approvalKey(request);
        const approveWrites = () => { for (const check of checks) if (check.write) state.writes.add(writeKey(check.write.path, check.write.content)); };
        if (!forced && state.approvals.has(remembered)) { approveWrites(); return allow(); }
        const answer = await this.ask(state, request);
        if (answer === "approve" || answer === "approve-session") {
            if (answer === "approve-session") state.approvals.add(remembered);
            approveWrites();
            return allow();
        }
        const feedback = answer && typeof answer === "object" ? answer.reject : null;
        if (feedback) state.notes.push(`[Vibe Studio] The user refused "${info.command ?? info.title}": ${feedback}`);
        return reject();
    }
    async writeTextFile(params) {
        const { RequestError } = this.acp;
        const state = this.sessions.get(params?.sessionId);
        if (!state || state.closed) throw new RequestError(-32000, "This session is closed in Vibe Studio.");
        const target = path.resolve(state.project, String(params.path || ""));
        const content = String(params.content ?? "");
        const refusal = state.refusals.get(key(target));
        if (refusal !== undefined) {
            state.refusals.delete(key(target));
            throw new RequestError(-32000, `Refused by Vibe Studio: ${refusal}`);
        }
        const checked = writeKey(target, content);
        if (state.writes.has(checked)) state.writes.delete(checked);
        else {
            // A write Gemini did not ask permission for (saved policy, sub-agent...): the guards are checked here.
            const before = existsSync(target) ? await readFile(target, "utf8").catch(() => null) : null;
            const check = before === null
                ? { toolName: "create", toolArgs: { path: target, file_text: content } }
                : { toolName: "edit", toolArgs: { path: target, ...changedRegion(before, content) } };
            let verdict;
            try { verdict = await state.hooks?.onPreToolUse?.({ ...check, agentId: undefined }); }
            catch (error) { verdict = { permissionDecision: "deny", permissionDecisionReason: `Guard error: ${error?.message || error}` }; }
            if (verdict?.permissionDecision === "deny") throw new RequestError(-32000, `Refused by Vibe Studio: ${verdict.permissionDecisionReason || "guard"}`);
            if (verdict?.permissionDecision === "ask") {
                const answer = await this.ask(state, { kind: "write", fileName: target, path: target, intention: `Write ${target}`,
                    diff: diffText(target, before, content), canOfferSessionApproval: false });
                if (answer !== "approve" && answer !== "approve-session") {
                    throw new RequestError(-32000, `Refused by the user: ${(answer && answer.reject) || "Refused in Vibe Studio."}`);
                }
            }
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
        return {};
    }
    async readTextFile(params) {
        const { RequestError } = this.acp;
        const state = this.sessions.get(params?.sessionId);
        const target = path.resolve(state?.project || process.cwd(), String(params?.path || ""));
        let text;
        try { text = await readFile(target, "utf8"); }
        catch (error) { if (error?.code === "ENOENT") throw RequestError.resourceNotFound(target); throw new RequestError(-32000, String(error?.message || error)); }
        if (params.line || params.limit) {
            const lines = text.split("\n");
            const start = Math.max(0, (Number(params.line) || 1) - 1);
            text = lines.slice(start, params.limit ? start + Number(params.limit) : undefined).join("\n");
        }
        return { content: text };
    }
    // ask_user routes skill questions to the Vibe Studio window.
    askUserTool(state) {
        return {
            name: "ask_user",
            description: "Ask the user a question in Vibe Studio and wait for the answer. Use it for every question to the user, one question at a time; give choices when the answer is one of a few options.",
            parameters: {
                type: "object", required: ["question"], additionalProperties: false,
                properties: {
                    question: { type: "string", description: "The question, in the output language of the project." },
                    choices: { type: "array", items: { type: "string" }, description: "Options the user can pick." },
                    allow_freeform: { type: "boolean", description: "Whether the user may answer in free text (default true)." },
                },
            },
            handler: input => this.question(state, input),
        };
    }
    async question(state, input = {}) {
        if (typeof input.question !== "string" || !input.question.trim()) return { resultType: "failure", textResultForLlm: "ask_user needs a question." };
        if (!this.ui.question) return { resultType: "failure", textResultForLlm: "No user is available to answer the question." };
        const choices = Array.isArray(input.choices) ? input.choices.filter(choice => typeof choice === "string" && choice.trim()) : [];
        const request = { question: input.question.trim(), choices, allowFreeform: input.allow_freeform !== false || !choices.length };
        const id = JSON.stringify(request);
        let pending = state.questions.get(id);
        if (!pending) {
            this.emit(state, "user_input.requested", {});
            pending = Promise.resolve().then(() => this.ui.question({ sessionId: state.sessionId, request }))
                .finally(() => { state.questions.delete(id); this.emit(state, "user_input.completed", {}); });
            state.questions.set(id, pending);
        }
        let timer;
        const answer = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(STILL_WAITING), this.questionWait); timer.unref?.(); })])
            .finally(() => clearTimeout(timer));
        if (answer === STILL_WAITING) {
            return "The user has not answered yet; the question is still shown in Vibe Studio. Call ask_user again with exactly the same question to keep waiting.";
        }
        return String(answer?.answer ?? "");
    }
    async stop() {
        for (const handle of [...this.active.values()]) await handle.disconnect().catch(() => {});
        this.active.clear(); this.sessions.clear();
        const connection = this.connection, transport = this.transport;
        this.agent = null; this.connection = null; this.transport = null;
        connection?.close();
        await transport?.close?.().catch(() => {});
        await this.tools.stop();
    }
}
