import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { KitWorkbench } from "../app/kit-workbench.mjs";
import { createKit, saveKit, exportKit, installKit, readInstalled } from "../core/kit-workshop.mjs";

test("kit patch updates wait for active work, preserve data and journal application", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "kit-update-integration-"));
    try {
        const source = path.join(directory, "source"), projectDir = path.join(directory, "project"), profile = path.join(directory, "profile");
        await mkdir(projectDir); await mkdir(profile);
        let model = await createKit(source, { id: "update-kit", name: "Update test", template: "blank" });
        await installKit(source, projectDir, { source: { type: "catalog", repository: "example/kits", id: "update-kit" } });
        await writeFile(path.join(projectDir, "client-notes.md"), "keep");
        model.metadata.version = "0.1.1";
        model = await saveKit(source, model);
        const archive = path.join(directory, "update.zip");
        await exportKit(source, archive);
        const entry = { id: "update-kit", version: model.metadata.version };
        const project = { project: projectDir, sessions: new Map(), chats: new Map([["busy", { busy: true }]]),
            store: { read: async () => ({ runs: [] }) }, runner: { busy: () => false, status: () => [] } };
        const workbench = new KitWorkbench({ directory: profile, repository: "example/kits", version: "3.0.0",
            project: () => project, openProject: async () => ({}), harness: () => ({}), onChange: () => {}, translate: key => key });
        let checks = 0;
        workbench.catalog = { updateFor: async () => { checks++; return { entry, automatic: true }; }, download: async () => archive };
        await workbench.checkUpdates();
        assert.equal(workbench.updateState.applied, undefined);
        assert.notEqual((await readInstalled(projectDir)).version, entry.version);
        project.chats.clear();
        await workbench.applyPendingPatch();
        assert.equal((await readInstalled(projectDir)).version, entry.version);
        assert.equal(workbench.updateState.applied, true);
        assert.equal(await readFile(path.join(projectDir, "client-notes.md"), "utf8"), "keep");
        assert.equal(JSON.parse(await readFile(path.join(profile, "kit-updates.json"), "utf8"))[0].automatic, true);
        const before = checks;
        await workbench.checkUpdates();
        assert.equal(checks, before, "automatic catalog checks are daily, not every snapshot");
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test("minor updates require explicit application and refuse mismatched catalog payloads", async () => {
    const workbench = new KitWorkbench({ directory: os.tmpdir(), project: () => null, harness: () => ({}), onChange: () => {}, translate: key => key });
    workbench.updateState = { automatic: false, entry: { id: "kit", version: "1.1.0" } };
    let applied = false;
    workbench.applyUpdate = async () => { applied = true; };
    await workbench.applyPendingPatch();
    assert.equal(applied, false);
    assert.throws(() => workbench.verifyEntry({ contract: { kit: { id: "another" } }, metadata: { version: "1.1.0" } }, workbench.updateState.entry), /does not match/);
});
