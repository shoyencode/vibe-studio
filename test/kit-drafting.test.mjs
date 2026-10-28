import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { KitDrafting, PROPOSE_TOOL, PROGRESS_TOOL, draftingHooks } from "../app/kit-drafting.mjs";

test("drafting only reads the kit: every write and shell command is refused before it runs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "kit-guards-"));
    try {
        const hooks = draftingHooks(directory);
        const check = (toolName, toolArgs) => hooks.onPreToolUse({ toolName, toolArgs });
        for (const [tool, args] of [["write_file", { path: ".apm/skills/start/SKILL.md", content: "Draft" }], ["edit", { path: "apm.yml", new_str: "x" }],
            ["create", { path: "notes.md", file_text: "x" }], ["powershell", { command: "Get-Content apm.yml" }]]) {
            const verdict = await check(tool, args);
            assert.equal(verdict.permissionDecision, "deny", tool);
            assert.match(verdict.permissionDecisionReason, new RegExp(PROPOSE_TOOL));
        }
        assert.equal(await check("view", { path: path.join(directory, "apm.yml") }), undefined);
        assert.equal((await check("view", { path: path.join(os.tmpdir(), "secret.txt") })).permissionDecision, "deny");
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test("drafting exposes proposal and progress tools, instructs once and keeps one session through pause/resume", async () => {
    const sent = [], received = [];
    let options;
    const session = { sessionId: "draft-1", current: async () => ({ modelId: "known" }),
        send: async (text, attachments) => { sent.push({ text, attachments }); }, abort: async () => {}, disconnect: async () => {} };
    const engine = { models: async () => [{ id: "known" }], status: () => ({ harness: "fake" }),
        openStep: async input => { options = input; return session; } };
    const drafting = new KitDrafting({ harness: () => engine });
    await drafting.start(os.tmpdir(), {}, { language: "fr", onPropose: async input => { received.push(input); return "1 proposal(s) queued"; } });
    assert.deepEqual(options.tools.map(tool => tool.name), [PROPOSE_TOOL, PROGRESS_TOOL]);
    assert.equal(options.mode, "interactive");
    assert.equal(await options.tools[0].handler({ proposals: [{ kind: "kit" }] }), "1 proposal(s) queued");
    assert.equal(received.length, 1);
    await options.tools[1].handler({ tasks: [{ label: "Lire la mission", status: "done" }, { label: "Proposer les étapes", status: "doing" }, { label: 3, status: "x" }] });
    assert.deepEqual(drafting.status().tasks.map(task => task.label), ["Lire la mission", "Proposer les étapes"]);
    await drafting.say("Mission: audit", [{ path: "C:/docs/brief.pdf", name: "brief.pdf" }]);
    assert.match(sent[0].text, /Write every title, description and instruction in French/);
    assert.deepEqual(sent[0].attachments, [{ type: "file", path: "C:/docs/brief.pdf", displayName: "brief.pdf" }]);
    await assert.rejects(drafting.say("overlap"), /still working/);
    await drafting.pause();
    assert.equal(drafting.status().status, "pausing");
    await assert.rejects(drafting.resume(), /acknowledge/);
    options.onEvent({ type: "session.idle", data: { aborted: true } });
    assert.equal(drafting.status().status, "paused");
    await drafting.resume();
    assert.doesNotMatch(sent[1].text, /Write every title/, "instructions are sent once per session");
    options.onEvent({ type: "session.idle", data: {} });
    assert.equal(drafting.status().status, "ready");
    await drafting.close();
    assert.equal(drafting.status(), null);
});

test("a proposal handler error is returned to the AI as a failure, and unavailable models are refused", async () => {
    let options;
    const engine = { models: async () => [{ id: "known" }], status: () => ({ harness: "fake" }),
        openStep: async input => { options = input; return { sessionId: "s", send: async () => {}, abort: async () => {}, disconnect: async () => {} }; } };
    const drafting = new KitDrafting({ harness: () => engine });
    await assert.rejects(drafting.start(os.tmpdir(), { model: "guessed" }, { language: "en", onPropose: async () => "" }), /not available|unavailable/i);
    await drafting.start(os.tmpdir(), {}, { language: "en", onPropose: async () => { throw new Error("Submit between 1 and 30 proposals."); } });
    assert.deepEqual(await options.tools[0].handler({}), { resultType: "failure", textResultForLlm: "Submit between 1 and 30 proposals." });
    engine.models = async () => { throw new Error("Sign-in required"); };
    await assert.rejects(drafting.options(), /Sign-in required/);
});
