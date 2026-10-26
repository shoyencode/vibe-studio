// Conversation of each step session, kept in memory for the window: messages, tools, questions and permissions.
const LIMIT = 600;
import { updateMetrics } from "../core/metrics.mjs";

const summary = (name, args) => {
    if (!args || typeof args !== "object") return "";
    const value = args.command ?? args.path ?? args.pattern ?? args.query ?? args.url ?? args.skill ?? args.question ?? args.status;
    return value === undefined ? "" : String(value).replace(/\s+/g, " ").slice(0, 240);
};

export class Conversations {
    constructor(push = () => {}) { this.push = push; this.sessions = new Map(); }
    list(sessionId) {
        if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, { items: [], index: new Map(), metrics: {}, metricEvents: new Set() });
        return this.sessions.get(sessionId);
    }
    items(sessionId) { return this.sessions.get(sessionId)?.items || []; }
    metrics(sessionId) { return this.sessions.get(sessionId)?.metrics || {}; }
    upsert(sessionId, key, patch, emit = patch) {
        const list = this.list(sessionId);
        let item = list.index.get(key);
        if (!item) {
            item = { key, sessionId, at: new Date().toISOString(), ...patch };
            list.items.push(item); list.index.set(key, item);
            if (list.items.length > LIMIT) list.index.delete(list.items.shift().key);
            this.push({ sessionId, op: "add", item });
        } else {
            Object.assign(item, patch);
            this.push({ sessionId, op: "update", key, patch: emit });
        }
        return item;
    }
    event(sessionId, event) {
        const d = event.data || {};
        const list = this.list(sessionId);
        if (["assistant.usage", "vibe_studio.usage", "session.usage_info"].includes(event.type)) {
            const key = event.id || d.apiCallId;
            if (key && list.metricEvents.has(key)) return null;
            if (key) list.metricEvents.add(key);
            list.metrics = updateMetrics(list.metrics, event);
            this.push({ sessionId, op: "metrics", metrics: list.metrics });
            return null;
        }
        switch (event.type) {
            case "vibe_studio.launch":
                return this.upsert(sessionId, `launch-${d.runId}`, { kind: "launch", text: d.prompt, step: d.step, unit: d.unit });
            case "vibe_studio.user":
                return this.upsert(sessionId, `user-${Date.now()}-${Math.random()}`, { kind: "user", text: d.content, attachments: d.attachments || [] });
            case "assistant.message_delta": {
                const list = this.list(sessionId), key = `msg-${d.messageId}`;
                if (d.parentToolCallId) return null;
                const item = list.index.get(key);
                if (!item) return this.upsert(sessionId, key, { kind: "assistant", text: d.deltaContent || "" });
                item.text += d.deltaContent || "";
                this.push({ sessionId, op: "append", key, text: d.deltaContent || "" });
                return item;
            }
            case "assistant.message":
                if (d.parentToolCallId || !d.content) return null;
                return this.upsert(sessionId, `msg-${d.messageId}`, { kind: "assistant", text: d.content });
            case "tool.execution_start":
                if (["ask_user", "report_intent"].includes(d.toolName)) return null;
                return this.upsert(sessionId, `tool-${d.toolCallId}`, { kind: "tool", name: d.toolName, detail: summary(d.toolName, d.arguments),
                    status: "running", nested: !!d.parentToolCallId });
            case "tool.execution_complete": {
                if (!this.list(sessionId).index.has(`tool-${d.toolCallId}`)) return null;
                const failed = !!d.error || d.success === false;
                return this.upsert(sessionId, `tool-${d.toolCallId}`, { status: failed ? "failed" : "done",
                    error: failed ? String(d.error?.message || d.error || "").slice(0, 300) : undefined });
            }
            case "subagent.started":
                return this.upsert(sessionId, `agent-${d.toolCallId || d.agentName}`, { kind: "info", text: d.agentDisplayName || d.agentName, info: "subagent" });
            case "session.compaction_complete":
                return this.upsert(sessionId, `compaction-${event.id}`, { kind: "info", info: "compaction" });
            case "vibe_studio.guard":
                return this.upsert(sessionId, `guard-${d.at}-${d.id}-${Math.random()}`, { kind: "guard", id: d.id, tool: d.tool, path: d.path, decision: d.decision || "deny" });
            case "vibe_studio.endGate":
                return this.upsert(sessionId, `end-${Date.now()}`, { kind: "endGate", failed: d.failed, alert: !!d.alert });
            case "vibe_studio.chat":
                return this.upsert(sessionId, "chat-start", { kind: "info", info: "chatStarted", text: [d.agent, d.model].filter(Boolean).join(" · ") });
            case "vibe_studio.chatClosed":
                return this.upsert(sessionId, `chat-end-${Date.now()}`, { kind: "info", info: "chatClosed", text: "" });
            case "vibe_studio.auto":
                return this.upsert(sessionId, `auto-${Date.now()}-${Math.random()}`, { kind: "info", info: d.kind === "question" ? "autoQuestion" : "autoPermission", text: d.detail || "" });
            case "vibe_studio.history":
                return this.upsert(sessionId, `history-${d.copy}`, { kind: "info", info: "history", text: `${d.path} → ${d.copy}` });
            case "session.idle":
                return this.upsert(sessionId, `idle-${event.id}`, { kind: "info", info: d.aborted ? "aborted" : "idle" });
            case "vibe_studio.paused":
                return this.upsert(sessionId, `paused-${Date.now()}`, { kind: "info", info: "paused" });
            case "session.error":
                return this.upsert(sessionId, `error-${event.id}`, { kind: "error", text: d.message || "" });
            default:
                return null;
        }
    }
    request(sessionId, request) {
        return this.upsert(sessionId, `request-${request.id}`, { kind: "request", request, answer: null });
    }
    answered(sessionId, id, answer) {
        return this.upsert(sessionId, `request-${id}`, { answer });
    }
}
