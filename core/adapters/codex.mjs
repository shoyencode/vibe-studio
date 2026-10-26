// Codex adapter of Vibe Studio: hosts one Codex thread per step through the official `codex app-server` protocol
// (JSON-RPC over stdio, one JSON message per line). The SDK of Codex cannot route approvals, the app-server can.
// Codex asks before every write and every command that is not known to be read-only ("untrusted" approval policy):
// each request goes through the guards of the kit, then to the user in Vibe Studio.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { UserError as Error } from "../errors.mjs";
import { frontmatter } from "./copilot.mjs";

const NAME = "Codex CLI";
const ASK_TOOL = "ask_user";
// "untrusted": Codex asks for every file change and every command outside its list of read-only commands.
const APPROVAL_POLICY = "untrusted";
const SANDBOX = "workspace-write";
const SHELL = process.platform === "win32" ? "powershell" : "bash";
const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const SKILL_FILE = /[\\/]skills[\\/]([^\\/"'`\s]+)[\\/]SKILL\.md\b/i;
const TRIPLES = {
    "win32-x64": "x86_64-pc-windows-msvc", "win32-arm64": "aarch64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl",
    "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin",
};
// Streams the window does not show: fewer messages on the pipe.
const QUIET = ["item/commandExecution/outputDelta", "item/fileChange/outputDelta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded", "command/exec/outputDelta", "process/outputDelta", "turn/diff/updated", "item/plan/delta",
    "rawResponseItem/completed", "rawResponse/completed"];
const ASK_NOTE = "To ask the user a question, call the `ask_user` tool (one question at a time, with choices when the answer is one of a few options) and wait for its answer. Never guess the answer.";
const VERSION = (() => {
    try { return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version || "0.0.0"; } catch { return "0.0.0"; }
})();

// ----- Executable: npm installs a launcher (codex.cmd, codex.js) in front of a native binary; Vibe Studio starts the binary itself.

function nativeOf(pkg, platform, arch) {
    const triple = TRIPLES[`${platform}-${arch}`];
    if (!triple) return null;
    const exe = platform === "win32" ? "codex.exe" : "codex";
    const scoped = `codex-${platform}-${arch}`;
    for (const vendor of [path.join(pkg, "node_modules", "@openai", scoped, "vendor"), path.join(path.dirname(pkg), scoped, "vendor"), path.join(pkg, "vendor")]) {
        for (const file of [path.join(vendor, triple, "bin", exe), path.join(vendor, triple, "codex", exe)]) if (existsSync(file)) return file;
    }
    return null;
}

function fromPackage(pkg, platform, arch) {
    const file = nativeOf(pkg, platform, arch);
    return file ? { file, env: { CODEX_MANAGED_BY_NPM: "1", CODEX_MANAGED_PACKAGE_ROOT: pkg } } : null;
}

function fromLauncher(file, platform, arch) {
    const lower = file.toLowerCase();
    if (lower.endsWith(".exe")) return { file, env: {} };
    if (lower.endsWith(".js")) return fromPackage(path.dirname(path.dirname(file)), platform, arch);
    if (platform === "win32") return fromPackage(path.join(path.dirname(file), "node_modules", "@openai", "codex"), platform, arch);
    let real = file;
    try { real = realpathSync(file); } catch { /* kept as given */ }
    if (real.toLowerCase().endsWith(".js")) return fromPackage(path.dirname(path.dirname(real)), platform, arch);
    return { file: real, env: {} };
}

/** Native Codex executable from an explicit command or the PATH, or null when Codex is not installed. */
export function resolveCodex({ command, env = process.env, platform = process.platform, arch = process.arch } = {}) {
    if (command) return existsSync(command) ? fromLauncher(command, platform, arch) : null;
    const dirs = String(env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
    const names = platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"];
    for (const dir of dirs) {
        for (const name of names) {
            const file = path.join(dir, name);
            if (!existsSync(file)) continue;
            const found = fromLauncher(file, platform, arch);
            if (found) return found;
        }
    }
    return null;
}

/** Transport over the stdio of `codex app-server`: { send, onMessage, onClose, close }. */
export function stdioTransport({ file, env = {}, args = ["app-server"] }) {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env }, windowsHide: true, shell: false });
    const listeners = { message: [], close: [] };
    let buffer = "", stderr = "", closed = false;
    const close = reason => {
        if (closed) return;
        closed = true;
        for (const listener of listeners.close) listener(reason);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
        buffer += chunk;
        for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (!line) continue;
            let message;
            try { message = JSON.parse(line); } catch { continue; }
            for (const listener of listeners.message) listener(message);
        }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.stdin.on("error", () => {});
    child.on("error", error => close(error));
    child.on("exit", (code, signal) => close(Object.assign(new globalThis.Error(`codex app-server stopped (${signal || code}). ${stderr.trim().slice(-500)}`), { code: "EXIT" })));
    return {
        send: message => { if (!closed) child.stdin.write(`${JSON.stringify(message)}\n`); },
        onMessage: listener => listeners.message.push(listener),
        onClose: listener => listeners.close.push(listener),
        close: async () => { closed = true; child.stdin.end(); child.kill(); },
    };
}

/** JSON-RPC 2.0 peer as spoken by the app-server: the "jsonrpc" member is omitted on the wire. */
export class RpcPeer {
    constructor(transport, { onNotification = () => {}, onRequest = async () => { throw rpcError(-32601, "Method not found"); }, onClose = () => {} } = {}) {
        this.transport = transport; this.onNotification = onNotification; this.onRequest = onRequest;
        this.next = 1; this.pending = new Map(); this.closed = null;
        transport.onMessage(message => void this.receive(message));
        transport.onClose?.(reason => {
            this.closed = reason || new globalThis.Error("codex app-server closed");
            for (const { reject } of this.pending.values()) reject(this.closed);
            this.pending.clear();
            onClose(this.closed);
        });
    }
    request(method, params, timeout = 0) {
        if (this.closed) return Promise.reject(this.closed);
        const id = this.next++;
        return new Promise((resolve, reject) => {
            const timer = timeout ? setTimeout(() => { this.pending.delete(id); reject(new globalThis.Error(`${method} timed out after ${timeout} ms`)); }, timeout) : null;
            timer?.unref?.();
            this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
            this.transport.send(params === undefined ? { id, method } : { id, method, params });
        });
    }
    notify(method, params) { if (!this.closed) this.transport.send(params === undefined ? { method } : { method, params }); }
    async receive(message) {
        if (!message || typeof message !== "object") return;
        if (message.method && message.id !== undefined) {
            try {
                const result = await this.onRequest(message.method, message.params || {}, message.id);
                if (!this.closed) this.transport.send({ id: message.id, result: result ?? {} });
            } catch (error) {
                if (!this.closed) this.transport.send({ id: message.id, error: { code: Number.isInteger(error?.rpcCode) ? error.rpcCode : -32603, message: String(error?.message || error) } });
            }
        } else if (message.method) {
            this.onNotification(message.method, message.params || {});
        } else if (message.id !== undefined && this.pending.has(message.id)) {
            const waiter = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) waiter.reject(Object.assign(new globalThis.Error(message.error.message || "JSON-RPC error"), { rpcCode: message.error.code, data: message.error.data }));
            else waiter.resolve(message.result);
        }
    }
}

function rpcError(code, message) { return Object.assign(new globalThis.Error(message), { rpcCode: code }); }

// ----- Kit files: `apm install --target codex` writes the skills to .agents/skills and the agents to .codex/agents/<name>.toml.

function unescapeToml(text) {
    return text.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[btnfr"\\])/g, (_, code) =>
        ({ b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" })[code] ?? String.fromCodePoint(parseInt(code.slice(1), 16)));
}

function tomlValue(raw) {
    if (raw.startsWith('"""')) return unescapeToml(raw.slice(3, -3).replace(/^\r?\n/, ""));
    if (raw.startsWith("'''")) return raw.slice(3, -3).replace(/^\r?\n/, "");
    if (raw.startsWith('"')) return unescapeToml(raw.slice(1, -1));
    if (raw.startsWith("'")) return raw.slice(1, -1);
    if (raw === "true" || raw === "false") return raw === "true";
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw.startsWith("[")) { try { return JSON.parse(raw.replace(/'/g, '"').replace(/,\s*\]$/, "]")); } catch { return raw; } }
    return raw;
}

/** Top-level keys of a TOML file (strings, booleans, numbers, simple arrays): enough for the agent files of Codex. */
export function parseToml(text) {
    const source = String(text).replace(/^\uFEFF/, "");
    const pair = /[ \t]*([A-Za-z0-9_-]+)[ \t]*=[ \t]*("""[\s\S]*?"""(?!")|'''[\s\S]*?'''|"(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*'|\[[^\]]*\]|[^\r\n#]*)[^\r\n]*(?:\r?\n|$)/y;
    const blank = /(?:[ \t]*(?:#[^\r\n]*)?\r?\n)+/y;
    const fields = {};
    let position = 0;
    while (position < source.length) {
        blank.lastIndex = position;
        if (blank.exec(source)) { position = blank.lastIndex; continue; }
        if (/^[ \t]*\[/.test(source.slice(position, position + 40))) break; // a table: the top-level keys are over
        pair.lastIndex = position;
        const match = pair.exec(source);
        if (!match || pair.lastIndex === position) break;
        fields[match[1]] = tomlValue(match[2].trim());
        position = pair.lastIndex;
    }
    return fields;
}

function listFiles(folder, suffix) {
    try { return readdirSync(folder).filter(name => name.toLowerCase().endsWith(suffix)).sort().map(name => path.join(folder, name)); } catch { return []; }
}

/** Agents of the kit as Codex sees them, with the Copilot agent files as fallback (and for the model, that APM drops). */
export function kitAgents(project) {
    const found = new Map();
    for (const file of listFiles(path.join(project, ".codex", "agents"), ".toml")) {
        let fields;
        try { fields = parseToml(readFileSync(file, "utf8")); } catch { continue; }
        const name = typeof fields.name === "string" && fields.name ? fields.name : path.basename(file, ".toml");
        found.set(name, { name, description: String(fields.description || ""), prompt: String(fields.developer_instructions || ""),
            ...(typeof fields.model === "string" && fields.model ? { model: fields.model } : {}), userInvocable: true, file });
    }
    for (const file of listFiles(path.join(project, ".github", "agents"), ".md")) {
        let parsed;
        try { parsed = frontmatter(readFileSync(file, "utf8")); } catch { continue; }
        const { fields, body } = parsed;
        const name = typeof fields.name === "string" && fields.name ? fields.name : path.basename(file).replace(/(\.agent)?\.md$/i, "");
        const userInvocable = fields["user-invocable"] !== false;
        const known = found.get(name);
        if (known) {
            if (!known.model && typeof fields.model === "string" && fields.model) known.model = fields.model;
            known.userInvocable = known.userInvocable && userInvocable;
            continue;
        }
        found.set(name, { name, description: String(fields.description || ""), prompt: body,
            ...(typeof fields.model === "string" && fields.model ? { model: fields.model } : {}), userInvocable, file });
    }
    return [...found.values()];
}

// ----- Mapping of Codex requests to the canonical tool calls of the guards.

function diffSides(diff) {
    const removed = [], added = [];
    for (const line of String(diff || "").split(/\r?\n/)) {
        if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) continue;
        if (line.startsWith("-")) removed.push(line.slice(1));
        else if (line.startsWith("+")) added.push(line.slice(1));
    }
    return { removed: removed.join("\n"), added: added.join("\n") };
}

/** One canonical call per file of a Codex file change: create, edit, or apply_patch for a deletion or a move. */
export function canonicalChange(change) {
    const kind = change?.kind?.type;
    if (kind === "add") return { toolName: "create", toolArgs: { path: change.path, file_text: String(change.diff ?? "") } };
    if (kind === "update" && !change.kind.move_path) {
        const { removed, added } = diffSides(change.diff);
        return { toolName: "edit", toolArgs: { path: change.path, old_str: removed, new_str: added } };
    }
    const lines = kind === "delete" ? [`*** Delete File: ${change.path}`]
        : [`*** Update File: ${change.path}`, `*** Move to: ${change.kind?.move_path}`, ...String(change.diff || "").split(/\r?\n/).filter(line => !/^(---|\+\+\+) /.test(line))];
    return { toolName: "apply_patch", toolArgs: { input: ["*** Begin Patch", ...lines, "*** End Patch"].join("\n") } };
}

/** Skill whose SKILL.md a command reads, if any: Codex loads a skill by reading this file. */
export function skillOf(command) {
    return String(command || "").match(SKILL_FILE)?.[1] || null;
}

function userInput(prompt, attachments = []) {
    const files = (attachments || []).filter(item => item && typeof item.path === "string");
    const images = files.filter(item => IMAGE.test(item.path));
    const others = files.filter(item => !IMAGE.test(item.path));
    let text = String(prompt ?? "");
    if (others.length) text += `\n\nAttached files (read them from the disk):\n${others.map(item => `- ${item.path}${item.displayName ? ` (${item.displayName})` : ""}`).join("\n")}`;
    return [{ type: "text", text, text_elements: [] }, ...images.map(item => ({ type: "localImage", path: item.path }))];
}

function loginOf(account) {
    if (!account) return "local provider";
    if (account.type === "chatgpt") return account.email || "ChatGPT";
    if (account.type === "apiKey") return "OpenAI API key";
    if (account.type === "amazonBedrock") return "Amazon Bedrock";
    return account.type || "Codex";
}

const askTool = {
    name: ASK_TOOL,
    description: "Ask the user a question in Vibe Studio and wait for the answer. Use it whenever a skill or your instructions say to ask the user. One question at a time.",
    parameters: {
        type: "object", required: ["question"], additionalProperties: false,
        properties: {
            question: { type: "string", description: "The question, in the language of the user." },
            choices: { type: "array", items: { type: "string" }, description: "Possible answers, when the answer is one of a few options." },
            allow_freeform: { type: "boolean", description: "Whether the user may type another answer. Default true." },
        },
    },
};

export class CodexHarness {
    /**
     * @param ui permission({ sessionId, request }) -> "approve" | "approve-session" | { reject: feedback };
     *           question({ sessionId, request }) -> { answer, wasFreeform }
     * @param command path of the Codex executable (codex.exe, codex.cmd or codex.js); the PATH by default
     * @param createTransport ({ command }) -> { send, onMessage, onClose, close } (tests)
     */
    constructor({ ui = {}, model = "gpt-6.1-sol", command, createTransport } = {}) {
        this.ui = ui; this.fallbackModel = model; this.command = command;
        this.createTransport = createTransport || (async ({ command: explicit }) => {
            const found = resolveCodex({ command: explicit });
            if (!found) throw new Error("harness.missing", { name: NAME });
            return stdioTransport(found);
        });
        this.peer = null; this.transport = null; this.login = null; this.modelCache = null; this.modelRequest = null;
        this.sessions = new Map(); // sessionId (= main thread id) -> session
        this.threads = new Map();  // thread id -> { session, threadId, agentId, parentToolCallId, total }
    }
    async connect() {
        let transport;
        try { transport = await this.createTransport({ command: this.command }); }
        catch (error) {
            if (error instanceof Error) throw error;
            throw new Error("harness.missing", { name: NAME });
        }
        const peer = new RpcPeer(transport, {
            onNotification: (method, params) => this.notification(method, params),
            onRequest: (method, params) => this.serverRequest(method, params),
            onClose: reason => this.closed(peer, reason),
        });
        try {
            await peer.request("initialize", { clientInfo: { name: "vibe-studio", title: "Vibe Studio", version: VERSION },
                capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: QUIET } }, 60_000);
            peer.notify("initialized");
        } catch (error) {
            await transport.close?.()?.catch?.(() => {});
            if (["ENOENT", "EACCES", "EPERM", "ENOEXEC"].includes(error?.code)) throw new Error("harness.missing", { name: NAME });
            throw error;
        }
        this.peer = peer; this.transport = transport;
    }
    async start() {
        if (!this.peer) await this.connect();
        if (!this.login) {
            const { account = null, requiresOpenaiAuth = true } = (await this.peer.request("account/read", { refreshToken: false }, 60_000)) || {};
            if (!account && requiresOpenaiAuth !== false) throw new Error("harness.login");
            this.login = loginOf(account);
            void this.models().catch(() => {}); // The model catalog is fetched ahead.
        }
        return { login: this.login };
    }
    status() { return { harness: "codex", connected: !!this.peer, login: this.login, busy: this.sessions.size > 0 }; }
    defaultModel() {
        const list = this.modelCache;
        if (!list?.length || list.some(model => model.id === this.fallbackModel)) return this.fallbackModel;
        return (list.find(model => model.isDefault) || list[0]).id;
    }
    async listModels() {
        const list = [];
        let cursor = null;
        do {
            const page = await this.peer.request("model/list", { cursor, limit: 100, includeHidden: false }, 60_000);
            list.push(...(page?.data || []));
            cursor = page?.nextCursor || null;
        } while (cursor && list.length < 500);
        return list.filter(model => !model.hidden).map(model => ({ id: model.model || model.id, name: model.displayName || model.id,
            description: model.description || "", isDefault: !!model.isDefault, inputModalities: model.inputModalities || ["text"],
            supportedReasoningEfforts: model.supportedReasoningEfforts || [], defaultReasoningEffort: model.defaultReasoningEffort }));
    }
    async models() {
        await this.start();
        if (this.modelCache) return this.modelCache;
        // One request at a time; a failed request (often a network timeout) is tried once more.
        this.modelRequest ??= (async () => {
            try { return await this.listModels(); }
            catch { return await this.listModels(); }
        })().finally(() => { this.modelRequest = null; });
        try { this.modelCache = await this.modelRequest; }
        catch (failure) { throw new Error("harness.network", { message: String(failure?.message || failure).slice(0, 300) }); }
        return this.modelCache;
    }
    /** Codex offers OpenAI models only: a kit model of another vendor gets the default, or a light model for a light one. */
    resolveModel(kitModel) {
        const list = this.modelCache || [];
        if (!kitModel) return this.defaultModel();
        if (list.some(model => model.id === kitModel)) return kitModel;
        const id = String(kitModel).toLowerCase();
        if (id.startsWith("gpt-")) {
            const variant = id.match(/^gpt-[\d.]+-(.+)$/)?.[1];
            const same = variant && list.find(model => model.id.toLowerCase().endsWith(`-${variant}`));
            if (same) return same.id;
        }
        const light = /(^|[-._])(haiku|flash|mini|nano|lite|luna|spark)([-._]|$)/;
        if (light.test(id)) {
            const small = list.find(model => light.test(model.id.toLowerCase()));
            if (small) return small.id;
        }
        return this.defaultModel();
    }
    async agents(project) {
        const list = kitAgents(project);
        if (list.some(agent => agent.model)) {
            try { await this.models(); } catch { /* the model is then left to Vibe Studio */ }
        }
        return list.map(({ file, model, ...agent }) => ({ ...agent, ...(model && this.modelCache ? { model: this.resolveModel(model) } : {}) }));
    }
    /** One Codex thread for one step or one free conversation. */
    async openStep({ project, agent, model, contextTier, reasoningEffort, tools = [], hooks, mode, onEvent = () => {} }) {
        await this.start();
        let chosen = null;
        if (agent) {
            chosen = kitAgents(project).find(item => item.name === agent);
            if (!chosen) throw new Error("agent.unavailable", { agent });
        }
        const exposed = [...tools.filter(tool => tool?.name && tool.name !== ASK_TOOL), askTool];
        const response = await this.peer.request("thread/start", {
            cwd: project, model, approvalPolicy: APPROVAL_POLICY, approvalsReviewer: "user", sandbox: SANDBOX, serviceName: "vibe_studio",
            developerInstructions: [chosen?.prompt?.trim(), ASK_NOTE].filter(Boolean).join("\n\n"),
            dynamicTools: exposed.map(tool => ({ type: "function", name: tool.name, description: tool.description || tool.name,
                inputSchema: tool.parameters || { type: "object", properties: {} } })),
        });
        const sessionId = response.thread.id;
        const session = { sessionId, threadId: sessionId, project, model, contextTier, reasoningEffort, mode: mode || "interactive", hooks, onEvent,
            tools: new Map(tools.filter(tool => tool?.name).map(tool => [tool.name, tool])), items: new Map(), skillChecks: new Map(),
            approved: { commands: new Set(), writes: false, urls: new Set() }, queue: [], busy: false, turnId: null, abortPending: false,
            continuing: false, reported: { input: 0, output: 0, cached: 0 }, lastError: null };
        this.sessions.set(sessionId, session);
        this.threads.set(sessionId, { session, threadId: sessionId, agentId: null, parentToolCallId: null, total: null });
        const handle = {
            sessionId,
            send: (prompt, attachments = []) => this.send(session, prompt, attachments),
            abort: () => this.abort(session),
            disconnect: () => this.disconnect(session),
            current: async () => ({ modelId: session.model }),
            setMode: async next => { session.mode = next; },
        };
        session.handle = handle;
        return handle;
    }
    async send(session, prompt, attachments = []) {
        const messageId = randomUUID();
        const input = userInput(prompt, attachments);
        if (session.busy) { session.queue.push({ input, messageId }); return messageId; }
        await this.startTurn(session, input, messageId);
        return messageId;
    }
    async startTurn(session, input, messageId = randomUUID()) {
        if (!this.peer) throw new globalThis.Error("The Codex app-server is not running.");
        session.busy = true;
        try {
            const response = await this.peer.request("turn/start", { threadId: session.threadId, input, clientUserMessageId: messageId, model: session.model,
                ...(session.reasoningEffort ? { effort: session.reasoningEffort } : {}) });
            if (response?.turn?.id && response.turn.status === "inProgress") session.turnId ??= response.turn.id;
        } catch (error) {
            session.busy = false;
            throw error;
        }
        if (session.abortPending && session.turnId) await this.interrupt(session);
    }
    async interrupt(session) {
        session.abortPending = false;
        await this.peer?.request("turn/interrupt", { threadId: session.threadId, turnId: session.turnId });
    }
    async abort(session) {
        session.queue = [];
        if (!session.busy) return;
        if (session.turnId) await this.interrupt(session);
        else session.abortPending = true;
    }
    async disconnect(session) {
        this.sessions.delete(session.sessionId);
        for (const [threadId, link] of this.threads) if (link.session === session) this.threads.delete(threadId);
        await this.peer?.request("thread/unsubscribe", { threadId: session.threadId }, 10_000).catch(() => {});
    }
    /** Codex has no autonomous mode of its own: approvals keep coming, and Vibe Studio answers them in autopilot. */
    async setMode(mode) {
        for (const session of this.sessions.values()) session.mode = mode;
    }
    async stop() {
        for (const session of [...this.sessions.values()]) await this.disconnect(session).catch(() => {});
        const transport = this.transport;
        this.peer = null; this.transport = null; this.login = null;
        await transport?.close?.()?.catch?.(() => {});
    }
    closed(peer, reason) {
        if (this.peer !== peer) return;
        for (const session of this.sessions.values()) {
            if (session.busy) this.emit(session, "session.error", { message: `Codex stopped: ${String(reason?.message || reason).slice(0, 300)}` });
            session.busy = false;
        }
        this.sessions.clear(); this.threads.clear();
        this.peer = null; this.transport = null; this.login = null;
    }
    emit(session, type, data = {}) {
        try { session.onEvent({ type, id: randomUUID(), data }); } catch { /* a listener never breaks the session */ }
    }
    // Events of a sub-agent thread are nested under the tool call that started it.
    nested(link) { return link.agentId ? { parentToolCallId: link.parentToolCallId || link.threadId } : {}; }
    adopt(session, threadId, parentToolCallId = null) {
        const known = this.threads.get(threadId);
        if (known) { if (parentToolCallId && known.agentId) known.parentToolCallId ??= parentToolCallId; return; }
        this.threads.set(threadId, { session, threadId, agentId: threadId, parentToolCallId, total: null });
    }
    notification(method, params) {
        if (method === "thread/started") {
            const owner = params.thread?.parentThreadId && this.threads.get(params.thread.parentThreadId);
            if (owner) this.adopt(owner.session, params.thread.id);
            return;
        }
        const link = params.threadId ? this.threads.get(params.threadId) : null;
        if (!link) return;
        const { session } = link, main = !link.agentId;
        switch (method) {
            case "turn/started":
                if (!main) return;
                session.turnId = params.turn?.id || session.turnId;
                this.emit(session, "assistant.turn_start", {});
                if (session.abortPending && session.turnId) void this.interrupt(session);
                return;
            case "item/agentMessage/delta":
                this.emit(session, "assistant.message_delta", { messageId: params.itemId, deltaContent: params.delta || "", ...this.nested(link) });
                return;
            case "item/started":
                this.itemStarted(link, params.item, params.turnId);
                return;
            case "item/completed":
                this.itemCompleted(link, params.item);
                return;
            case "item/fileChange/patchUpdated": {
                const item = session.items.get(params.itemId);
                if (item) item.changes = params.changes || item.changes;
                return;
            }
            case "thread/tokenUsage/updated":
                link.total = params.tokenUsage?.total || link.total;
                if (main) this.emit(session, "session.usage_info", { tokenLimit: params.tokenUsage?.modelContextWindow,
                    currentTokens: params.tokenUsage?.last?.totalTokens });
                return;
            case "error":
                if (!params.willRetry) session.lastError = params.error?.message || session.lastError;
                return;
            case "turn/completed":
                if (main) void this.turnEnded(session, params.turn || {});
                return;
            default:
                return;
        }
    }
    itemStarted(link, item, turnId) {
        if (!item?.id) return;
        const { session } = link, nested = this.nested(link);
        const start = (toolName, args) => this.emit(session, "tool.execution_start", { toolCallId: item.id, toolName, arguments: args, ...nested });
        switch (item.type) {
            case "commandExecution":
                session.items.set(item.id, item);
                start(SHELL, { command: item.command });
                // A skill is loaded by reading its SKILL.md, often without an approval: its guard is checked here.
                if (skillOf(item.command)) void this.skillVerdict(link, item.id, item.command, turnId);
                return;
            case "fileChange":
                session.items.set(item.id, item);
                start("apply_patch", { path: (item.changes || []).map(change => change.path).join(", ") });
                return;
            case "mcpToolCall": return start(item.tool, { ...(item.arguments && typeof item.arguments === "object" ? item.arguments : {}), server: item.server });
            case "dynamicToolCall": return start(item.tool, item.arguments && typeof item.arguments === "object" ? item.arguments : {});
            case "webSearch": return start("web_search", { query: item.query });
            case "imageView": return start("view", { path: item.path });
            case "collabAgentToolCall":
                for (const threadId of item.receiverThreadIds || []) this.adopt(session, threadId, item.id);
                if (item.tool === "spawnAgent") this.emit(session, "subagent.started", { toolCallId: item.id, agentName: "codex-agent",
                    agentDisplayName: String(item.prompt || "Codex sub-agent").replace(/\s+/g, " ").slice(0, 80), ...nested });
                return;
            default:
                return;
        }
    }
    itemCompleted(link, item) {
        if (!item?.id) return;
        const { session } = link, nested = this.nested(link);
        const done = (success, error) => this.emit(session, "tool.execution_complete", { toolCallId: item.id, success, ...(error ? { error: { message: error } } : {}), ...nested });
        switch (item.type) {
            case "agentMessage":
                this.emit(session, "assistant.message", { messageId: item.id, content: item.text || "", ...nested });
                return;
            case "commandExecution": {
                session.items.delete(item.id);
                const success = item.status === "completed" && (item.exitCode ?? 0) === 0;
                return done(success, success ? null : item.status === "declined" ? "Declined." : `Exit code ${item.exitCode ?? "?"}. ${String(item.aggregatedOutput || "").slice(-300)}`.trim());
            }
            case "fileChange":
                session.items.delete(item.id);
                return done(item.status === "completed", item.status === "completed" ? null : item.status === "declined" ? "Declined." : "The change was not applied.");
            case "mcpToolCall": return done(item.status === "completed" && !item.error, item.error?.message);
            case "dynamicToolCall": return done(item.status === "completed" && item.success !== false, item.success === false ? "The tool reported a failure." : null);
            case "webSearch":
            case "imageView": return done(true);
            case "collabAgentToolCall":
                for (const threadId of item.receiverThreadIds || []) this.adopt(session, threadId, item.id);
                return;
            default:
                return;
        }
    }
    // ----- End of a turn: usage, stop hook of Vibe Studio, queued messages, then idle.
    reportUsage(session) {
        const total = { input: 0, output: 0, cached: 0 };
        for (const link of this.threads.values()) {
            if (link.session !== session || !link.total) continue;
            total.input += link.total.inputTokens || 0; total.output += link.total.outputTokens || 0; total.cached += link.total.cachedInputTokens || 0;
        }
        const delta = { input: total.input - session.reported.input, output: total.output - session.reported.output, cached: total.cached - session.reported.cached };
        session.reported = total;
        if (delta.input > 0 || delta.output > 0) this.emit(session, "vibe_studio.usage", { model: session.model, inputTokens: delta.input, outputTokens: delta.output, cachedInputTokens: delta.cached, aggregate: true });
    }
    async turnEnded(session, turn) {
        session.turnId = null;
        if (!this.sessions.has(session.sessionId)) return;
        this.reportUsage(session);
        if (turn.status === "interrupted") {
            session.continuing = false; session.queue = []; session.busy = false; session.abortPending = false;
            this.emit(session, "session.idle", { aborted: true });
            return;
        }
        if (turn.status === "failed") {
            session.continuing = false;
            this.emit(session, "session.error", { message: turn.error?.message || session.lastError || "The Codex turn failed." });
            session.lastError = null;
            if (!(await this.nextQueued(session))) session.busy = false;
            return;
        }
        let verdict;
        try { verdict = await session.hooks?.onAgentStop?.({ stopHookActive: session.continuing }); } catch { verdict = undefined; }
        if (verdict?.decision === "block" && verdict.reason) {
            session.continuing = true;
            try { await this.startTurn(session, [{ type: "text", text: String(verdict.reason), text_elements: [] }]); return; }
            catch (error) { this.emit(session, "session.error", { message: String(error?.message || error) }); }
        }
        session.continuing = false;
        if (await this.nextQueued(session)) return;
        session.busy = false;
        this.emit(session, "session.idle", {});
    }
    async nextQueued(session) {
        while (session.queue.length) {
            const next = session.queue.shift();
            try { await this.startTurn(session, next.input, next.messageId); return true; }
            catch (error) { this.emit(session, "session.error", { message: String(error?.message || error) }); }
        }
        return false;
    }
    // ----- Requests of Codex: approvals, dynamic tools, questions.
    async serverRequest(method, params) {
        const link = this.threads.get(params.threadId);
        if (!link) throw rpcError(-32602, `Unknown thread for ${method}`);
        switch (method) {
            case "item/commandExecution/requestApproval": return this.commandApproval(link, params);
            case "item/fileChange/requestApproval": return this.fileApproval(link, params);
            case "item/permissions/requestApproval": return this.permissionsApproval(link, params);
            case "item/tool/call": return this.toolCall(link, params);
            case "item/tool/requestUserInput": return this.userInputRequest(link, params);
            case "mcpServer/elicitation/request": return this.elicitation(link, params);
            default: throw rpcError(-32601, `Not supported by Vibe Studio: ${method}`);
        }
    }
    async guard(link, toolName, toolArgs) {
        const hook = link.session.hooks?.onPreToolUse;
        if (!hook) return null;
        const verdict = await hook({ toolName, toolArgs, ...(link.agentId ? { agentId: link.agentId } : {}) });
        return verdict?.permissionDecision === "deny" ? { reason: verdict.permissionDecisionReason || "Refused by a guard of Vibe Studio." } : null;
    }
    async guardAll(link, calls) {
        for (const { toolName, toolArgs } of calls) {
            const denied = await this.guard(link, toolName, toolArgs);
            if (denied) return denied;
        }
        return null;
    }
    // Codex declines without a message: the reason reaches the model as a steering message of the running turn.
    refuse(link, turnId, reason) {
        if (!reason || !turnId) return;
        setImmediate(() => {
            void this.peer?.request("turn/steer", { threadId: link.threadId, expectedTurnId: turnId,
                input: [{ type: "text", text: `Vibe Studio refused this action: ${reason}`, text_elements: [] }] }).catch(() => {});
        });
    }
    skillVerdict(link, itemId, command, turnId) {
        const { session } = link;
        if (!session.skillChecks.has(itemId)) {
            const skill = skillOf(command);
            session.skillChecks.set(itemId, (async () => {
                const denied = skill ? await this.guard(link, "skill", { skill }).catch(() => null) : null;
                if (denied) this.refuse(link, turnId, `skill ${skill}: ${denied.reason}`);
                return denied;
            })());
            setTimeout(() => session.skillChecks.delete(itemId), 600_000).unref?.();
        }
        return session.skillChecks.get(itemId);
    }
    async askPermission(link, request) {
        const { session } = link;
        if (!this.ui.permission) return { reject: "No user is available." };
        this.emit(session, "permission.requested", {});
        try { return await this.ui.permission({ sessionId: session.sessionId, request }); }
        finally { this.emit(session, "permission.completed", {}); }
    }
    async question(link, request) {
        const { session } = link;
        if (!this.ui.question) throw new Error("harness.noUser");
        this.emit(session, "user_input.requested", {});
        try { return await this.ui.question({ sessionId: session.sessionId, request }); }
        finally { this.emit(session, "user_input.completed", {}); }
    }
    async commandApproval(link, params) {
        const { session } = link;
        const command = params.command ?? session.items.get(params.itemId)?.command ?? "";
        if (skillOf(command) && await this.skillVerdict(link, params.itemId, command, params.turnId)) return { decision: "decline" };
        const denied = command ? await this.guard(link, SHELL, { command }) : null;
        if (denied) { this.refuse(link, params.turnId, denied.reason); return { decision: "decline" }; }
        const network = params.networkApprovalContext;
        const key = network ? `${network.protocol}://${network.host}` : command;
        // "Approve for the session" is kept by Vibe Studio, not by Codex: every later request still meets the guards.
        if (network ? session.approved.urls.has(key) : session.approved.commands.has(key)) return { decision: "accept" };
        const request = network
            ? { kind: "url", url: key, intention: params.reason || `Network access for: ${command}`, canOfferSessionApproval: true }
            : { kind: "shell", fullCommandText: command, intention: params.reason || (params.cwd ? `Run a command in ${params.cwd}` : "Run a command"), canOfferSessionApproval: true };
        const answer = await this.askPermission(link, request);
        if (answer === "approve-session") (network ? session.approved.urls : session.approved.commands).add(key);
        if (answer === "approve" || answer === "approve-session") return { decision: "accept" };
        this.refuse(link, params.turnId, answer?.reject);
        return { decision: "decline" };
    }
    async fileApproval(link, params) {
        const { session } = link;
        const changes = session.items.get(params.itemId)?.changes || [];
        const denied = await this.guardAll(link, changes.map(canonicalChange));
        if (denied) { this.refuse(link, params.turnId, denied.reason); return { decision: "decline" }; }
        if (session.approved.writes) return { decision: "accept" };
        const answer = await this.askPermission(link, {
            kind: "write", fileName: changes.map(change => change.path).join(", ") || params.grantRoot || "",
            diff: changes.map(change => `${change.kind?.type || "update"} ${change.path}\n${change.diff || ""}`).join("\n"),
            intention: params.reason || "Change files", canOfferSessionApproval: true,
        });
        if (answer === "approve-session") session.approved.writes = true;
        if (answer === "approve" || answer === "approve-session") return { decision: "accept" };
        this.refuse(link, params.turnId, answer?.reject);
        return { decision: "decline" };
    }
    async permissionsApproval(link, params) {
        const fileSystem = params.permissions?.fileSystem, network = params.permissions?.network;
        const request = fileSystem?.write?.length ? { kind: "write", fileName: fileSystem.write.join(", "), intention: params.reason || "Write access", canOfferSessionApproval: true }
            : network?.enabled ? { kind: "url", url: "network", intention: params.reason || "Network access", canOfferSessionApproval: true }
            : { kind: "read", path: fileSystem?.read?.[0] || params.cwd, intention: params.reason || "Read access", canOfferSessionApproval: true };
        const answer = await this.askPermission(link, request);
        if (answer !== "approve" && answer !== "approve-session") return { permissions: {}, scope: "turn" };
        return { permissions: { ...(fileSystem ? { fileSystem } : {}), ...(network ? { network } : {}) }, scope: answer === "approve-session" ? "session" : "turn" };
    }
    async toolCall(link, params) {
        const { session } = link;
        let args = params.arguments;
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = { input: args }; } }
        args = args && typeof args === "object" ? args : {};
        const reply = (text, success = true) => ({ contentItems: [{ type: "inputText", text: String(text ?? "") }], success });
        try {
            if (params.tool === ASK_TOOL) {
                const choices = Array.isArray(args.choices) ? args.choices.map(String) : [];
                const answer = await this.question(link, { question: String(args.question || ""), choices, allowFreeform: args.allow_freeform !== false || !choices.length });
                return reply(answer?.answer ?? "");
            }
            const tool = session.tools.get(params.tool);
            if (!tool?.handler) return reply(`Unknown tool: ${params.tool}`, false);
            const result = await tool.handler(args, { sessionId: session.sessionId, toolCallId: params.callId });
            if (result && typeof result === "object" && result.resultType === "failure") return reply(result.textResultForLlm || "The tool failed.", false);
            return reply(typeof result === "string" ? result : JSON.stringify(result ?? ""));
        } catch (error) {
            return reply(String(error?.message || error), false);
        }
    }
    async userInputRequest(link, params) {
        const answers = {};
        for (const item of params.questions || []) {
            const choices = (item.options || []).map(option => option.label);
            const answer = await this.question(link, { question: [item.header, item.question].filter(Boolean).join("\n"), choices,
                allowFreeform: !!item.isOther || !choices.length });
            answers[item.id] = { answers: [String(answer?.answer ?? "")] };
        }
        return { answers };
    }
    // MCP servers ask through elicitations: a confirmation (form without field) or a URL to open. Forms with fields are declined.
    async elicitation(link, params) {
        const decline = { action: "decline", content: null, _meta: null };
        const form = ["form", "openai/form", "openaiForm"].includes(params.mode);
        let request;
        if (params.mode === "url") request = { kind: "url", url: params.url, intention: params.message, canOfferSessionApproval: false };
        else if (form && !Object.keys(params.requestedSchema?.properties || {}).length) {
            request = { kind: "mcp", serverName: params.serverName, toolName: params.message, intention: params.message, canOfferSessionApproval: false };
        } else return decline;
        const answer = await this.askPermission(link, request);
        return answer === "approve" || answer === "approve-session" ? { action: "accept", content: form ? {} : null, _meta: null } : decline;
    }
}
