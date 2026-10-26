import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AttachmentInbox } from "../app/attachments.mjs";
import { autoApprove } from "../app/permission-policy.mjs";
import { updateMetrics } from "../core/metrics.mjs";
import { nextJourneyStep, automaticallyCompletedBuild } from "../core/journey.mjs";
import { replaceFile } from "../core/store.mjs";
import { Conversations } from "../app/conversations.mjs";
import { t } from "../core/i18n.mjs";
import { UserError, localize } from "../core/errors.mjs";

test("French interface copy uses a neutral register", () => {
    for (const key of ["feedback.intro", "convo.intro", "convo.you", "convo.waiting", "active.waiting",
        "run.waiting", "launch.notice", "autopilot.on", "chat.ready", "convo.autoQuestion", "startup.profileFailed"]) {
        assert.doesNotMatch(t("fr", key), /\b(tu|toi|ton|ta|tes|vous|votre|vos)\b/i, key);
    }
    assert.equal(t("fr", "journey.unmeasured"), "Non relevée");
    assert.equal(t("en", "journey.unmeasured"), "Not measured");
    assert.equal(t("fr", "convo.previousSessions", { n: 2 }), "Anciennes conversations (2)");
    assert.equal(t("fr", "convo.history", { text: "archive" }), "Version précédente conservée : archive");
});

test("interface keys use English by default and retain separate French translations", () => {
    for (const [key, english] of [
        ["convo.previousSessions", "Previous conversations (2)"],
        ["journey.automatic", "Automatically completed"],
        ["sound.orbital", "Orbital station"],
        ["sound.telegraph", "Telegraph"],
        ["sound.analogNoir", "Analog noir"],
        ["sound.piano", "Recorded acoustic piano"],
        ["sound.guitar", "Recorded acoustic guitar"],
    ]) assert.equal(t(undefined, key, { n: 2 }), english, `${key} defaults to English`);
});

test("cost marker diagnostics retain the exit code and cause through both translation layers", () => {
    const failure = new UserError("costs.scriptFailed", { exitCode: "2", detail: "Session metadata is not available." });
    const wrapped = new UserError("costs.markFailed", { message: localize(failure, "fr") });
    assert.match(localize(wrapped, "fr"), /code 2/);
    assert.match(localize(wrapped, "fr"), /Session metadata is not available\./);
    assert.match(localize(wrapped, "fr"), /Aucune consigne/);
    assert.match(failure.message, /exit 2/);
});

test("build auto-completion never substitutes for manual approvals or validates an interrupted round", () => {
    const kit = { contract: { modules: { tasks: { buildStep: "construct" } }, steps: [{ id: "construct" }] },
        tasks: { "1": { sections: [{ tasks: [{ status: "done" }] }] } } };
    const run = { step: "construct", unit: 1, status: "produced", reported: "produced", evidence: [{ path: "tasks.md" }] };
    assert.equal(automaticallyCompletedBuild(kit, run), true);
    for (const status of ["running", "paused", "interrupted", "error", "unconfirmed"])
        assert.equal(automaticallyCompletedBuild(kit, { ...run, status }), false, status);
    assert.equal(automaticallyCompletedBuild(kit, { ...run, evidence: [] }), false);
    assert.equal(automaticallyCompletedBuild(kit, { ...run, endGate: { alert: true } }), false);
    kit.tasks["1"].sections[0].tasks[0].status = "todo";
    assert.equal(automaticallyCompletedBuild(kit, run), false);
    assert.equal(automaticallyCompletedBuild(kit, { ...run, completion: { automatic: true } }), true, "later feedback does not erase a completed round");
    kit.contract.steps[0].approves = ["review.md"];
    assert.equal(automaticallyCompletedBuild(kit, { ...run, completion: { automatic: true } }), false);
});

test("atomic preference replacement retries transient Windows locks and exposes persistent failures", async () => {
    let attempts = 0;
    await replaceFile("pending", "preferences", { delays: [0, 0], rename: async () => {
        if (++attempts < 3) throw Object.assign(new Error("busy"), { code: "EPERM" });
    } });
    assert.equal(attempts, 3);
    const failed = Object.assign(new Error("locked"), { code: "EACCES" });
    await assert.rejects(replaceFile("pending", "preferences", { delays: [0], rename: async () => { throw failed; } }), error => error === failed);
});

test("Approve All approves tools in interactive mode, never guard confirmations", () => {
    for (const autopilot of [false, true]) for (const approveAll of [false, true]) {
        assert.equal(autoApprove({ autopilot, approveAll }, false), autopilot || approveAll);
        assert.equal(autoApprove({ autopilot, approveAll }, true), false);
    }
    assert.equal(autoApprove({}, false), false);
});

test("conversation consumption is cumulative and separate from the current context", () => {
    let metrics = updateMetrics({}, { type: "session.usage_info", data: { tokenLimit: 200000, currentTokens: 1234 } });
    metrics = updateMetrics(metrics, { type: "assistant.usage", data: { model: "main", inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 } });
    metrics = updateMetrics(metrics, { type: "assistant.usage", agentId: "child", data: { model: "child", inputTokens: 50, outputTokens: 20 } });
    metrics = updateMetrics(metrics, { type: "session.usage_info", agentId: "child", data: { tokenLimit: 4000, currentTokens: 300 } });
    assert.deepEqual(metrics, { tokenLimit: 200000, currentTokens: 1234, model: "main", inputTokens: 1050, outputTokens: 120, cacheReadTokens: 500 });
    metrics = updateMetrics(metrics, { type: "session.usage_info", data: { tokenLimit: 200000, currentTokens: 600 } });
    assert.equal(metrics.inputTokens, 1050, "compaction does not reset consumption");
    assert.equal(metrics.currentTokens, 600);
    metrics = updateMetrics(metrics, { type: "vibe_studio.usage", data: { model: "aggregate-child", aggregate: true, inputTokens: 10, outputTokens: 0 } });
    assert.equal(metrics.model, "main");
    assert.equal(metrics.inputTokens, 1060);
    assert.deepEqual(updateMetrics({}, { type: "assistant.usage", data: { inputTokens: -1, outputTokens: NaN } }), {});
});

test("conversation metrics survive the message limit and repeated usage events are not counted twice", () => {
    const changes = [], journal = new Conversations(item => changes.push(item));
    const event = { type: "assistant.usage", id: "usage-1", data: { model: "main", inputTokens: 40, outputTokens: 5 } };
    journal.event("s", event); journal.event("s", event);
    for (let i = 0; i < 650; i++) journal.event("s", { type: "vibe_studio.user", data: { content: `message-${i}` } });
    assert.equal(journal.metrics("s").inputTokens, 40);
    assert.equal(journal.items("s").length, 600);
    assert.equal(changes.filter(change => change.op === "metrics").length, 1);
    assert.deepEqual(journal.metrics("another-session"), {});
});

test("AI credits accumulate reported nano-AIU, including subagents, separately from premium requests and USD", () => {
    let metrics = updateMetrics({}, { type: "assistant.usage", data: { cost: 2, copilotUsage: { totalNanoAiu: 1250000000 } } });
    metrics = updateMetrics(metrics, { type: "assistant.usage", agentId: "child", data: { cost: 1, copilotUsage: { totalNanoAiu: 250000000 } } });
    assert.equal(metrics.credits, 1.5);
    assert.equal(metrics.premiumRequests, 3);
    metrics = updateMetrics(metrics, { type: "vibe_studio.usage", data: { costUsd: 0.15 } });
    assert.equal(metrics.costUsd, 0.15);
    assert.equal(metrics.credits, 1.5);
    assert.deepEqual(updateMetrics({}, { type: "assistant.usage", data: { cost: 0 } }), { premiumRequests: 0 }, "a multiplier is not an AI credit amount");
    assert.deepEqual(updateMetrics({}, { type: "assistant.usage", data: { copilotUsage: { totalNanoAiu: 0 } } }), { credits: 0 });
    assert.deepEqual(updateMetrics({}, { type: "assistant.usage", data: { copilotUsage: { totalNanoAiu: -1 }, cost: NaN } }), {});
    const journal = new Conversations();
    const event = { type: "assistant.usage", id: "credit-1", data: { copilotUsage: { totalNanoAiu: 1000000000 } } };
    journal.event("s", event); journal.event("s", event);
    assert.equal(journal.metrics("s").credits, 1);
});

test("the next step follows the last launch rather than the first incomplete step", () => {
    const steps = ["configure", "spec", "plan", "build", "review", "compliance"].map(id => ({ id }));
    let next = nextJourneyStep(steps, [{ step: "plan", unit: 4 }], 1);
    assert.deepEqual(next, { step: steps[3], unit: 4 });
    next = nextJourneyStep(steps, [{ step: "spec" }], 1, {}, step => ({ blocked: step.id === "plan" }));
    assert.equal(next.step.id, "plan", "a missing prerequisite does not select an unrelated step");
    next = nextJourneyStep(steps, [{ step: "spec" }], 2, {}, step => ({ approved: step.id === "plan" }));
    assert.equal(next.step.id, "build", "approved steps are not offered");
    assert.equal(nextJourneyStep(steps, [{ step: "compliance" }], 1), null, "no restart at the beginning");
    next = nextJourneyStep(steps, [], 1, {}, step => ({ done: step.id === "configure" }));
    assert.equal(next.step.id, "spec");
});

test("the next step retains the kit's review correction loop", () => {
    const steps = [{ id: "build" }, { id: "review" }, { id: "compliance" }];
    const next = nextJourneyStep(steps, [{ step: "review", unit: 2 }], 1,
        { tasks: { 2: { loop: { step: "corrections" } } }, review: { buildStep: "build", reviewStep: "review" } });
    assert.deepEqual(next, { step: steps[0], unit: 2 });
});

test("explicitly choosing another scenario does not follow the preceding scenario's run", () => {
    const steps = [{ id: "configure" }, { id: "plan" }, { id: "build" }];
    const next = nextJourneyStep(steps, [{ step: "build", unit: 4 }], 5,
        { preferSelectedUnit: true }, step => ({ done: step.id === "configure" }));
    assert.deepEqual(next, { step: steps[1], unit: 5 });
});

test("pasted files are staged under their name, chosen files stay untouched, and paths need a user import", async t => {
    const base = await mkdtemp(path.join(os.tmpdir(), "vibe_studio-inbox-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const file = path.join(base, "document.txt"); await writeFile(file, "document");
    const inbox = new AttachmentInbox(path.join(base, "staged"));
    assert.throws(() => inbox.pick([file]), error => error.key === "attach.notChosen");
    const chosen = await inbox.import([{ path: file }]);
    assert.deepEqual(inbox.pick(chosen.map(file => file.path)), [file]);
    const pasted = await inbox.import([{ name: "clipboard.png", bytes: new Uint8Array([1, 2, 3]) }]);
    assert.equal(path.basename(pasted[0].path), "clipboard.png");
    assert.equal(pasted[0].size, 3);
    assert.deepEqual(await readFile(pasted[0].path), Buffer.from([1, 2, 3]));
    await assert.rejects(inbox.import(Array.from({ length: 11 }, () => ({ path: file }))), error => error.key === "attach.tooMany");
    await assert.rejects(inbox.import([{ name: "bad.png", bytes: "arbitrary data" }]), error => error.key === "attach.invalid");
    await assert.rejects(inbox.import([{ name: "huge.png", bytes: new Uint8Array(25 * 1024 * 1024 + 1) }]), error => error.key === "attach.tooLarge");
    await inbox.cleanup();
    await assert.rejects(readFile(pasted[0].path), error => error.code === "ENOENT");
    assert.equal(await readFile(file, "utf8"), "document", "the original is not temporary");
});
