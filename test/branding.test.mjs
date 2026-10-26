import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("desktop and package use the Vibe Studio identity", async () => {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(manifest.name, "vibe-studio");
    assert.match(await readFile(path.join(root, "app/main.mjs"), "utf8"), /app\.setName\("Vibe Studio"\)/);
    assert.match(await readFile(path.join(root, "app/renderer/index.html"), "utf8"), /<title>Vibe Studio<\/title>/);
});

test("new schemas and reference contracts use the Vibe Studio filenames", async () => {
    for (const directory of ["core/schema", "test/fixtures/demo/.apm/skills/demo-0-start/assets",
        "test/fixtures/reference-kit/.apm/skills/poc-0-start/assets"]) {
        const name = directory === "core/schema" ? "vibe-studio.schema.json" : "vibe-studio.json";
        await access(path.join(root, directory, name));
        if (directory !== "core/schema") {
            const contract = JSON.parse(await readFile(path.join(root, directory, name), "utf8"));
            assert.equal(contract.protocolVersion, 2);
        }
    }
});
