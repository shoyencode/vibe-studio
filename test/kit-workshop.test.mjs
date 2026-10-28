import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    createKit, readKit, saveKit, validateKit, validateModel, exportKit, importKit,
    installKit, readInstalled, inspectInstallation,
} from "../core/kit-workshop.mjs";

test("workshop public API creates, edits, archives and installs a kit", async () => {
    const work = await mkdtemp(path.resolve(".kit-node-"));
    try {
        const directory = path.join(work, "kit");
        const model = await createKit(directory, { id: "example-kit", name: "Example", template: "blank" });
        assert.equal(model.directory, directory);
        assert.equal(model.metadata.name, "example-kit");
        assert.equal(model.contract.kit.name, "Example");
        assert.equal((await validateKit(directory)).valid, true);
        model.metadata.version = "0.1.1";
        await saveKit(directory, model);
        assert.equal((await readKit(directory)).metadata.version, "0.1.1");
        const zip = path.join(work, "kit.zip");
        assert.equal((await exportKit(directory, zip)).sha256.length, 64);
        const imported = path.join(work, "imported");
        assert.equal((await importKit(zip, imported)).metadata.name, "example-kit");
        const project = path.join(work, "project");
        assert.equal(await readInstalled(project), null);
        const manifest = await installKit(imported, project, { source: { type: "official" } });
        assert.equal(manifest.version, "0.1.1");
        assert.deepEqual((await readInstalled(project)).files, manifest.files);
        const owned = path.join(project, ".agents", "skills", "configure", "SKILL.md");
        await writeFile(owned, "locally edited");
        assert.equal((await inspectInstallation(imported, project)).modified.length, 1);
        await assert.rejects(installKit(imported, project), error => error.code === "kit.modified");
        assert.equal(await readFile(owned, "utf8"), "locally edited");
        await installKit(imported, project, { allowModified: true });
        assert.equal((await inspectInstallation(imported, project)).modified.length, 0);
    } finally {
        await rm(work, { recursive: true, force: true });
    }
});

test("workshop reports structural errors without overwriting a valid kit", async () => {
    const work = await mkdtemp(path.resolve(".kit-node-"));
    try {
        const directory = path.join(work, "kit");
        const model = await createKit(directory, { template: "demo" });
        model.contract.steps[1].skill = "../escape";
        const validation = await validateModel(directory, model);
        assert.equal(validation.valid, false);
        assert.ok(validation.errors.some(issue => issue.path === "/contract/steps/1/skill" && issue.message));
        assert.deepEqual(await validateKit(directory, { model }), validation);
        await assert.rejects(saveKit(directory, model), error =>
            error.code === "kit.invalid" && error.errors.some(issue =>
                issue.field === "/contract/steps/1/skill" && issue.path === issue.field));
        assert.equal((await validateKit(directory)).valid, true);
        assert.notEqual((await readKit(directory)).contract.steps[1].skill, "../escape");
    } finally {
        await rm(work, { recursive: true, force: true });
    }
});
