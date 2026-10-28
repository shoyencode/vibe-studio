import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTHORING_FILE, applyProposal, authoringOf, guidedSteps, instructionsOf, issueLocation, issueMessage, slugify, translationStatus } from "../core/kit-authoring.mjs";
import { KitWorkbench } from "../app/kit-workbench.mjs";
import { readKit, validateKit } from "../core/kit-workshop.mjs";

const base = () => ({
    directory: "C:/kit", metadata: { name: "audit", version: "0.1.0", description: "Audit", license: "MIT" },
    files: { [AUTHORING_FILE]: JSON.stringify({ sourceLanguage: "fr", languages: ["fr", "en"], mission: "Auditer un site." }) },
    contract: {
        protocolVersion: 2, kit: { id: "audit", name: "Audit", description: "Audit", entrySkill: "configure" },
        config: { file: "project.yml", schema: "assets/project.schema.json", placeholders: { root: { pointer: "/paths/root", default: "work" } } },
        steps: [{ id: "0-configure", title: "Configurer le projet", skill: "configure", agent: null, scope: "project", configures: true, requires: [], outputs: ["project.yml"] }],
    },
});

test("business proposals generate identifiers, folders, approvals and instructions without technical input", () => {
    assert.equal(slugify("Analyser une page d’accueil"), "analyser-une-page-d-accueil");
    let model = applyProposal(base(), { kind: "step.add", title: "Cadrer l’audit", description: "Recueille le périmètre.", result: "Une note validée.",
        produces: ["Note de cadrage"], approval: true, instructions: "1. Lire la mission." });
    const [, framing] = model.contract.steps;
    assert.equal(framing.id, "1-cadrer-l-audit");
    assert.match(framing.skill, /^audit-1-cadrer-l-audit$/);
    assert.deepEqual(framing.outputs, ["{root}/Note-de-cadrage.md"]);
    assert.deepEqual(framing.approves, framing.outputs);
    assert.equal(model.contract.modules.approvals.script, "configure/scripts/validations.py");
    assert.equal(model.contract.guards.scriptOnly.id, "G01");
    assert.equal(instructionsOf(model, framing.skill), "1. Lire la mission.");
    assert.match(model.changes[`.apm/skills/${framing.skill}/SKILL.md`], /vibe_studio_report/);
    model = applyProposal(model, { kind: "step.add", title: "Analyser une page", repeat: true, uses: ["note-de-cadrage.md"], produces: ["constats.md"] });
    const analysis = model.contract.steps[2];
    assert.equal(analysis.scope, "unit");
    assert.deepEqual(model.contract.units, { id: "item", label: "Élément", plural: "Éléments", folder: "{root}/items/item-{n}" });
    assert.deepEqual(analysis.requires, ["{root}/Note-de-cadrage.md"], "a used document is matched with what an earlier step produces");
    assert.deepEqual(analysis.outputs, ["{unit}/constats.md"]);
    model = applyProposal(model, { kind: "step.update", step: analysis.id, repeat: false });
    assert.deepEqual(model.contract.steps[2].outputs, ["{root}/constats.md"]);
    assert.deepEqual(guidedSteps(model).map(step => step.title), ["Configurer le projet", "Cadrer l’audit", "Analyser une page"]);
});

test("renames keep instructions, removals clean references and invalid proposals explain themselves", () => {
    let model = applyProposal(base(), { kind: "step.add", title: "Cadrer", produces: ["note.md"], instructions: "Lire." });
    model = applyProposal(model, { kind: "step.add", title: "Rapport", uses: ["note.md"], produces: ["rapport.md"] });
    const [, first, second] = model.contract.steps;
    model = applyProposal(model, { kind: "step.update", step: first.id, title: "Cadrer l’audit" });
    assert.equal(instructionsOf(model, first.skill), "Lire.");
    assert.match(model.files[`.apm/skills/${first.skill}/SKILL.md`], /# Cadrer l’audit/);
    model = applyProposal(model, { kind: "step.move", step: second.id, position: 2 });
    assert.equal(model.contract.steps[1].id, second.id);
    model = applyProposal(model, { kind: "step.remove", step: first.id });
    assert.deepEqual(model.contract.steps.find(step => step.id === second.id).requires, []);
    assert.equal(model.changes[`.apm/skills/${first.skill}/SKILL.md`], null);
    assert.throws(() => applyProposal(model, { kind: "step.update", step: "9-missing", title: "x" }), error => error.key === "authoring.unknownStep");
    assert.throws(() => applyProposal(model, { kind: "delete-everything" }), error => error.key === "authoring.kind");
    assert.throws(() => applyProposal(model, { kind: "step.update", step: second.id, produces: [] }), error => error.key === "authoring.produces");
    assert.throws(() => applyProposal(model, { kind: "step.update", step: "0-configure", repeat: true }), error => error.key === "authoring.configureRepeat");
    assert.throws(() => applyProposal(model, { kind: "contract.patch", operations: [{ op: "replace", path: "/kit/id", value: "other" }] }), error => error.key === "authoring.identity");
    assert.throws(() => applyProposal(model, { kind: "contract.patch", operations: [{ op: "add", path: "/__proto__/x", value: 1 }] }), error => error.key === "authoring.pointer");
});

test("translations are validated per text and become stale when the source text changes", () => {
    let model = applyProposal(base(), { kind: "step.add", title: "Cadrer", description: "Recueille le périmètre.", produces: ["note.md"] });
    const step = model.contract.steps[1];
    assert.equal(translationStatus(model, "en").find(entry => entry.key === `step:${step.id}.title`).status, "missing");
    assert.throws(() => applyProposal(model, { kind: "translation", language: "fr", key: `step:${step.id}.title`, text: "x" }), error => error.key === "authoring.language");
    model = applyProposal(model, { kind: "translation", language: "en", key: `step:${step.id}.title`, text: "Scope" });
    assert.equal(model.contract.steps[1].i18n.en.title, "Scope");
    assert.equal(translationStatus(model, "en").find(entry => entry.key === `step:${step.id}.title`).status, "validated");
    model = applyProposal(model, { kind: "step.update", step: step.id, title: "Cadrer l’audit" });
    assert.equal(translationStatus(model, "en").find(entry => entry.key === `step:${step.id}.title`).status, "stale");
    model = applyProposal(model, { kind: "languages", languages: ["en", "de"] });
    assert.deepEqual(authoringOf(model).languages, ["fr", "en", "de"]);
    assert.equal(authoringOf(model).sourceLanguage, "fr");
});

test("validation issues are located and explained in author terms", () => {
    const { contract } = base();
    assert.deepEqual(issueLocation({ path: "/contract/steps/0/scope" }, contract), { kind: "step", index: 0, step: "0-configure", title: "Configurer le projet", field: "scope" });
    assert.deepEqual(issueMessage({ message: "'page' is not one of ['project', 'unit']" }), { key: "enum", vars: { value: "page", allowed: "project, unit" } });
    assert.deepEqual(issueMessage({ message: "Missing kit file: .apm/skills/x/SKILL.md" }), { key: "missingFile", vars: { file: ".apm/skills/x/SKILL.md" } });
    assert.deepEqual(issueMessage({ message: "Something new" }), { key: null, vars: { message: "Something new" } });
});

test("AI proposals are checked, queued, accepted or rejected, and only accepted ones reach a valid kit", async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "kit-authoring-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const changes = [];
    const workbench = new KitWorkbench({ directory: path.join(directory, "profile"), documents: path.join(directory, "documents"),
        project: () => null, openProject: async () => ({}), harness: () => ({}), onChange: () => changes.push(1),
        translate: key => key, translateIn: (language, key) => ({ "ws.configureTitle": "Configurer le projet", "ws.configureSummary": "Configure.",
            "ws.configureResult": "project.yml.", "ws.configureInstructions": "1. Écrire project.yml." })[key] || key });
    const kit = await workbench.create({ name: "Audit d’accessibilité", mission: "Auditer un site public page par page.", language: "fr", withAI: false });
    assert.equal(kit.contract.kit.id, "audit-d-accessibilite");
    assert.equal(kit.contract.steps[0].title, "Configurer le projet");
    assert.equal(authoringOf(kit).mission, "Auditer un site public page par page.");
    assert.equal((await validateKit(kit.directory)).valid, true);
    const answer = await workbench.receiveProposals(kit.directory, { proposals: [
        { kind: "step.add", summary: "Cadrer avant d’analyser.", title: "Cadrer l’audit", produces: ["note-cadrage.md"], approval: true, instructions: "Demander le périmètre." },
        { kind: "step.add", summary: "Analyser chaque page.", title: "Analyser une page", repeat: true, uses: ["note-cadrage.md"], produces: ["constats.md"] },
        { kind: "step.update", summary: "Étape inconnue.", step: "9-nothing", title: "x" },
        { kind: "rule.add", summary: "Protéger les secrets.", rule: "secrets", description: "Aucun secret écrit dans le projet." },
    ] });
    assert.match(answer, /3 proposal\(s\) queued/);
    assert.match(answer, /Proposal 3: Unknown step/);
    let review = workbench.review.view(await workbench.review.read(kit.directory));
    assert.equal(review.counts.pending, 3);
    const [first, second, rule] = review.items;
    await workbench.accept(first.id);
    await workbench.reject(rule.id);
    await workbench.accept(second.id, { title: "Analyser une page du site" });
    const saved = await readKit(kit.directory);
    assert.deepEqual(saved.contract.steps.map(step => step.title), ["Configurer le projet", "Cadrer l’audit", "Analyser une page du site"]);
    assert.equal(saved.contract.guards.secrets, undefined, "a rejected proposal is never applied");
    assert.match(await readFile(path.join(kit.directory, ".apm", "skills", saved.contract.steps[1].skill, "SKILL.md"), "utf8"), /Demander le périmètre\./);
    assert.equal((await validateKit(kit.directory)).valid, true);
    review = workbench.review.view(await workbench.review.read(kit.directory));
    assert.deepEqual(review.counts, { accepted: 2, rejected: 1, pending: 0 });
    assert.equal(review.summary, true);
    await assert.rejects(workbench.accept(first.id), /already decided/);
    await assert.rejects(workbench.applyChange({ kind: "contract.patch", operations: [{ op: "replace", path: "/steps/1/scope", value: "page" }] }),
        error => error.key === "authoring.invalid" && error.errors.some(issue => issue.path === "/contract/steps/1/scope"));
    assert.equal((await readKit(kit.directory)).contract.steps[1].scope, "project", "an invalid change leaves the kit untouched");
});
