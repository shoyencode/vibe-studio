import test from "node:test";
import assert from "node:assert/strict";
import { Conversations } from "../app/conversations.mjs";
import { updateMetrics } from "../core/metrics.mjs";

test("unrecognised integration namespaces are not converted into application messages or usage", () => {
    const conversation = new Conversations();
    conversation.event("s", { type: "other_integration.user", data: { content: "Unrelated message" } });
    assert.deepEqual(conversation.items("s"), []);
    const previous = { inputTokens: 10 };
    assert.equal(updateMetrics(previous, { type: "other_integration.usage", data: { inputTokens: 50 } }), previous);
});

test("the conversation keeps messages, tools and requests of each session, and streams changes", () => {
    const pushed = [];
    const c = new Conversations(change => pushed.push(change));
    c.event("s1", { type: "vibe_studio.launch", data: { runId: "r1", step: "1-write-note", prompt: "Run…" } });
    c.event("s1", { type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "Bon" } });
    c.event("s1", { type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "jour" } });
    c.event("s1", { type: "assistant.message", data: { messageId: "m1", content: "Bonjour." } });
    c.event("s1", { type: "tool.execution_start", data: { toolCallId: "t1", toolName: "powershell", arguments: { command: "Get-Date" } } });
    c.event("s1", { type: "tool.execution_start", data: { toolCallId: "t2", toolName: "ask_user", arguments: {} } });
    c.event("s1", { type: "tool.execution_complete", data: { toolCallId: "t1", success: true } });
    c.event("s1", { type: "assistant.message_delta", data: { messageId: "m2", deltaContent: "inner", parentToolCallId: "t9" } });
    c.request("s1", { id: "q1", kind: "question", question: "?" });
    c.answered("s1", "q1", { answer: "A" });
    c.event("s1", { type: "session.idle", id: "e1", data: {} });
    c.event("s2", { type: "vibe_studio.user", data: { content: "Autre" } });
    const items = c.items("s1");
    assert.deepEqual(items.map(i => i.kind), ["launch", "assistant", "tool", "request", "info"]);
    assert.equal(items[1].text, "Bonjour.");
    assert.deepEqual([items[2].detail, items[2].status], ["Get-Date", "done"]);
    assert.deepEqual(items[3].answer, { answer: "A" });
    assert.equal(c.items("s2")[0].text, "Autre");
    assert.deepEqual(pushed.filter(p => p.sessionId === "s1").map(p => p.op),
        ["add", "add", "append", "update", "add", "update", "add", "update", "add"]);
});

test("a long session keeps its most recent items", () => {
    const c = new Conversations();
    for (let i = 0; i < 700; i++) c.event("s", { type: "tool.execution_start", data: { toolCallId: `t${i}`, toolName: "view", arguments: { path: `f${i}` } } });
    const items = c.items("s");
    assert.equal(items.length, 600);
    assert.equal(items[0].detail, "f100");
    c.event("s", { type: "tool.execution_complete", data: { toolCallId: "t0", success: true } });
    assert.equal(c.items("s").length, 600, "a completed tool that was dropped is not added again");
});
