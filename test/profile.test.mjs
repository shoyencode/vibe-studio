import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { profilePath } from "../app/profile.mjs";
import { t } from "../core/i18n.mjs";

test("the default profile uses Vibe Studio without creating an empty profile", async t => {
    const base = await mkdtemp(path.join(process.cwd(), ".profile-test-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    assert.equal(profilePath(base), path.join(base, "Vibe Studio"));
    assert.deepEqual(await readdir(base), []);
});

test("an override never inspects the default profile", async t => {
    const base = await mkdtemp(path.join(process.cwd(), ".profile-test-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const unavailableAppData = path.join(base, "not-a-directory");
    await writeFile(unavailableAppData, "must never be inspected");
    const override = path.join(base, "isolated");
    await mkdir(override);
    assert.equal(profilePath(unavailableAppData, override), override);
    assert.equal(profilePath(unavailableAppData, path.relative(process.cwd(), override)), override);
    assert.deepEqual(await readdir(override), []);
});

test("selecting an existing Vibe Studio profile preserves its files without scanning sibling directories", async t => {
    const base = await mkdtemp(path.join(process.cwd(), ".profile-test-"));
    t.after(() => rm(base, { recursive: true, force: true }));
    const current = path.join(base, "Vibe Studio"), other = path.join(base, "Unrelated application");
    await mkdir(current); await mkdir(other);
    const preferences = '{"theme":"dark","conversationHistory":false}';
    await writeFile(path.join(current, "preferences.json"), preferences);
    await writeFile(path.join(other, "preferences.json"), "must not be read");
    assert.equal(profilePath(base), current);
    assert.equal(await readFile(path.join(current, "preferences.json"), "utf8"), preferences);
    assert.deepEqual((await readdir(base)).sort(), ["Unrelated application", "Vibe Studio"]);
});

test("both interface languages identify Vibe Studio", () => {
    for (const language of ["en", "fr"]) {
        for (const key of ["kit.extension", "about.vibeStudio", "about.vibeStudioIntro", "about.version", "versions.title", "projects.intro", "guards.intro"]) {
            assert.match(t(language, key, { version: "0.3.0", kit: "demo", app: "0.3.0" }), /Vibe Studio/);
        }
    }
});
