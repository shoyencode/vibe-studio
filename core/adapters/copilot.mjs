// Copilot adapter of Vibe Studio: hosts one Copilot CLI session per step through the Copilot SDK.
// Vibe Studio passes the project configuration explicitly (agents, skills, MCP servers) instead of letting the runtime
// discover it: Copilot extensions of the user or of the project are not loaded into these sessions.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPORT_TOOL } from "../prompt.mjs";
import { UserError as Error } from "../errors.mjs";
import { ModelCatalog } from "../model-catalog.mjs";

// Front matter of an agent file: key: value lines; JSON arrays for tools. Enough for the agents of kits.
export function frontmatter(text) {
    const source = text.replace(/^\uFEFF/, "");
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const fields = {};
    for (const line of (match?.[1] || "").split(/\r?\n/)) {
        const pair = line.match(/^([A-Za-z][A-Za-z-]*):\s*(.*)$/);
        if (!pair) continue;
        let value = pair[2].trim();
        if (value.startsWith("[")) { try { value = JSON.parse(value); } catch { /* kept as text */ } }
        else if (value === "true" || value === "false") value = value === "true";
        else value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
        fields[pair[1]] = value;
    }
    return { fields, body: match ? match[2] : source };
}

// Agents with a closed tool list receive the report tool of Vibe Studio.
export function agentConfig(info, text) {
    const { fields, body } = frontmatter(text);
    const tools = Array.isArray(fields.tools) ? [...new Set([...fields.tools, REPORT_TOOL])] : undefined;
    return {
        name: info.name, displayName: info.displayName || fields.name || info.name, description: info.description || fields.description || "",
        prompt: body, ...(tools ? { tools } : {}), ...(fields.model ? { model: fields.model } : {}),
    };
}

// MCP servers declared by the project, in the files written by APM and the editors.
export function projectMcpServers(project) {
    const servers = {};
    for (const [relative, key] of [[".vscode/mcp.json", "servers"], [".copilot/mcp-config.json", "mcpServers"], [".github/mcp.json", "mcpServers"]]) {
        const file = path.join(project, relative);
        if (!existsSync(file)) continue;
        let declared;
        try { declared = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""))[key] || {}; } catch { continue; }
        for (const [name, config] of Object.entries(declared)) {
            const { id, ...rest } = config || {};
            servers[name] = { type: "local", tools: ["*"], ...rest };
        }
    }
    return servers;
}

const PERMISSION = { approve: { kind: "approve-once" }, "approve-session": { kind: "approve-for-session" } };

export class CopilotHarness {
    /**
     * @param ui permission({ sessionId, request }) -> "approve" | "approve-session" | { reject: feedback };
     *           question({ sessionId, request }) -> { answer, wasFreeform }
     */
    constructor({ createClient, ui = {}, model = "claude-sonnet-5.5", cacheDir, endpoint } = {}) {
        this.createClient = createClient || (async () => {
            const { CopilotClient } = await import("@github/copilot-sdk");
            return new CopilotClient({ logLevel: "error" });
        });
        this.ui = ui; this.fallbackModel = model;
        this.cacheDir = cacheDir; this.endpoint = endpoint;
        this.client = null; this.login = null; this.modelCache = null; this.active = new Map(); this.connected = false;
    }
    async start() {
        if (this.connected) return { login: this.login };
        this.starting ??= (async () => {
            const client = await this.createClient();
            try {
                await client.start();
                const auth = await client.getAuthStatus();
                if (!auth?.isAuthenticated) throw new Error("harness.login");
                this.login = auth.login || null;
                const account = auth.accountId || this.login?.toLowerCase();
                this.catalog = new ModelCatalog(account ? this.cacheDir : null, {
                    harness: "copilot", account: account || null,
                    endpoint: this.endpoint || auth.endpoint || auth.host || process.env.GH_HOST || "github.com",
                });
                await this.catalog.load();
                this.modelCache = this.catalog.models;
                this.catalogAttempted = false; this.catalogAuthError = null;
                this.client = client; this.connected = true;
                // Warm caches are immediately usable; one shared refresh updates them in the background.
                this.initialModelRequest = this.requestModels();
                void this.initialModelRequest.catch(() => { /* Authentication errors remain available to models()/refreshModels(). */ });
                return { login: this.login };
            } catch (error) {
                await client.stop?.().catch(() => {});
                this.client = null; this.connected = false; this.login = null;
                throw error;
            }
        })().finally(() => { this.starting = null; });
        return this.starting;
    }
    status() { return { harness: "copilot", connected: this.connected, login: this.login, busy: this.active.size > 0 }; }
    defaultModel() { return this.fallbackModel; }
    resolveModel(id) { return (this.modelCache || []).some(model => model.id === id) ? id : this.fallbackModel; }
    catalogStatus() { return this.catalog?.status() || { source: "kit" }; }
    async models() {
        await this.start();
        if (this.catalogAuthError) throw this.catalogAuthError;
        if (this.modelCache) return this.modelCache;
        if (this.modelRequest) return this.modelRequest;
        return this.catalogAttempted ? [] : this.requestModels();
    }
    async refreshModels() {
        const started = this.connected && !this.starting;
        await this.start();
        return started ? this.requestModels() : this.initialModelRequest;
    }
    requestModels() {
        if (this.modelRequest) return this.modelRequest;
        const catalog = this.catalog, client = this.client;
        const request = (async () => {
            this.catalogAttempted = true;
            try {
                const models = await catalog.accept(await client.listModels());
                if (this.catalog === catalog) { this.modelCache = models; this.catalogAuthError = null; }
                return models;
            } catch (failure) {
                catalog.failure(failure);
                if (failure?.key === "harness.login" || [401, 403].includes(Number(failure?.status ?? failure?.statusCode ?? failure?.code))
                    || /unauthori[sz]ed|not authenticated|authentication failed|token expired/i.test(String(failure?.message || failure))) {
                    const error = failure?.key === "harness.login" ? failure : new Error("harness.login");
                    if (error !== failure) error.cause = failure;
                    if (this.catalog === catalog) this.catalogAuthError = error;
                    throw error;
                }
                return catalog.models || [];
            }
        })().finally(() => { if (this.modelRequest === request) this.modelRequest = null; });
        this.modelRequest = request;
        return request;
    }
    async agents(project) {
        await this.start();
        const found = (await this.client.rpc.agents.discover({ projectPaths: [project], excludeHostAgents: true })).agents || [];
        return found.filter(info => info.path).map(info => {
            const config = agentConfig(info, readFileSync(info.path, "utf8"));
            return { ...config, userInvocable: info.userInvocable !== false };
        });
    }
    async sessionConfig(project) {
        return {
            workingDirectory: project,
            customAgents: (await this.agents(project)).map(({ userInvocable, ...agent }) => agent),
            skillDirectories: [path.join(project, ".agents", "skills"), path.join(project, ".apm", "skills")].filter(existsSync),
            mcpServers: projectMcpServers(project),
        };
    }
    /** One session for one step. Returns a handle Vibe Studio keeps while the step lives. */
    async openStep({ project, agent, model, contextTier, reasoningEffort, tools = [], hooks, mode, onEvent = () => {} }) {
        await this.start();
        let sessionId;
        const session = await this.client.createSession({
            ...(await this.sessionConfig(project)),
            model, ...(contextTier && contextTier !== "default" ? { contextTier } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            streaming: true, tools, ...(hooks ? { hooks } : {}),
            onPermissionRequest: async request => {
                const answer = this.ui.permission ? await this.ui.permission({ sessionId, request }) : { reject: "No user is available." };
                if (PERMISSION[answer]) return PERMISSION[answer];
                return { kind: "reject", feedback: (answer && answer.reject) || "Refused by the user in Vibe Studio." };
            },
            onUserInputRequest: async request => {
                if (!this.ui.question) throw new Error("harness.noUser");
                return this.ui.question({ sessionId, request });
            },
        });
        sessionId = session.sessionId;
        try {
            if (agent) {
                await session.rpc.agent.select({ name: agent });
                // Explicitly reset the tier too: the selected agent may have applied a different window.
                await session.rpc.model.switchTo({ modelId: model, contextTier: contextTier || "default" });
                if (reasoningEffort) await session.rpc.model.setReasoningEffort({ reasoningEffort });
            }
        } catch (error) { await session.disconnect().catch(() => {}); throw error; }
        // Autopilot: the agent keeps working without stopping for the user (experimental API of the SDK).
        if (mode) await session.rpc.mode?.set({ mode }).catch(() => {});
        const unsubscribe = session.on(event => onEvent(event));
        const handle = {
            sessionId,
            send: (prompt, attachments = []) => session.send({ prompt, ...(attachments.length ? { attachments } : {}) }),
            abort: () => session.abort(),
            disconnect: async () => { unsubscribe(); this.active.delete(sessionId); await session.disconnect(); },
            ...(typeof session.rpc?.model?.getCurrent === "function" ? { current: () => session.rpc.model.getCurrent() } : {}),
            setMode: next => session.rpc.mode?.set({ mode: next }),
        };
        this.active.set(sessionId, handle);
        return handle;
    }
    async setMode(mode) {
        for (const handle of this.active.values()) await handle.setMode?.(mode)?.catch?.(() => {});
    }
    async stop() {
        for (const handle of this.active.values()) await handle.disconnect().catch(() => {});
        this.active.clear();
        if (this.client) await this.client.stop().catch(() => {});
        this.client = null; this.connected = false; this.modelRequest = null; this.initialModelRequest = null;
    }
}
