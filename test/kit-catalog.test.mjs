import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { KitCatalog, validateCatalog } from "../app/kit-catalog.mjs";

const bytes = Buffer.from("verified ZIP fixture");
const entry = { id: "demo", name: "Demo", description: "Example", version: "1.0.1", protocolVersion: 2,
    minVibeStudio: "3.0.0", license: "MIT", maintainer: "maintainer",
    url: "https://github.com/owner/catalog/releases/download/kit-demo-v1.0.1/demo.zip",
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, size: bytes.length };
const index = { schemaVersion: 1, entries: [entry] };
async function workspace(t) {
    const directory = await mkdtemp(path.resolve(".catalog-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}
test("absent repository disables catalog without requests", async () => {
    const catalog = new KitCatalog({ fetch: () => assert.fail("network"), version: "3.0.0" });
    assert.equal((await catalog.list()).enabled, false);
    await assert.rejects(catalog.download(entry), /disabled/);
});
test("catalog validation rejects unexpected fields, duplicates and foreign archives", () => {
    assert.equal(validateCatalog(index, "owner/catalog").length, 1);
    for (const patch of [{ size: 0 }, { sha256: "bad" }, { protocolVersion: 3 }, { version: "1.0.1-beta" },
        { unexpected: true }, { id: ["demo"] }, { sha256: [entry.sha256] },
        { url: entry.url.replace("owner/catalog", "attacker/catalog") }, { i18n: { en: { script: "bad" } } }])
        assert.throws(() => validateCatalog({ schemaVersion: 1, entries: [{ ...entry, ...patch }] }, "owner/catalog"));
    assert.throws(() => validateCatalog({ schemaVersion: 1, entries: [entry, entry] }, "owner/catalog"), /Duplicate/);
});
test("fetch implementations ignoring abort still have a bounded deadline", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const catalog = new KitCatalog({ repository: "owner/catalog", fetch: () => new Promise(() => {}) });
    const pending = catalog.bytes("https://api.github.com/repos/owner/catalog/contents/index.json", 100);
    t.mock.timers.tick(30_000);
    await assert.rejects(pending, /timed out/);
});
test("download follows only approved GitHub asset CDN redirects", async t => {
    let calls = 0;
    const catalog = new KitCatalog({ repository: "owner/catalog", directory: await workspace(t), fetch: async url => {
        calls++;
        if (calls === 1) return new Response(null, { status: 302,
            headers: { location: "https://release-assets.githubusercontent.com/github-production-release-asset/1/demo.zip" } });
        assert.match(url, /^https:\/\/release-assets.githubusercontent.com\//);
        return new Response(bytes);
    } });
    assert.deepEqual(await readFile(await catalog.download(entry)), bytes);
});
test("anonymous index requests cache locally and clearly label offline errors", async t => {
    let calls = 0;
    const catalog = new KitCatalog({ repository: "owner/catalog", directory: await workspace(t), version: "3.0.0",
        fetch: async (url, options) => {
            calls++;
            assert.equal(options.credentials, "omit");
            assert.equal(options.redirect, "manual");
            assert.ok(options.signal);
            assert.match(url, /^https:\/\/api.github.com/);
            if (calls > 1) throw new Error("offline");
            return new Response(JSON.stringify(index));
        } });
    assert.equal((await catalog.list()).cached, false);
    assert.equal((await catalog.list()).cached, true);
    const offline = await catalog.list({ refresh: true });
    assert.equal(offline.cached, true);
    assert.match(offline.error, /showing cached entries.*offline/);
});
test("downloads verify checksum and size and reject unsafe redirects", async t => {
    const catalog = new KitCatalog({ repository: "owner/catalog", directory: await workspace(t),
        fetch: async () => new Response(bytes) });
    const archive = await catalog.download(entry);
    assert.deepEqual(await readFile(archive), bytes);
    await assert.rejects(catalog.download({ ...entry, sha256: `sha256:${"0".repeat(64)}` }), /verification/);
    catalog.fetch = async () => new Response(null, { status: 302, headers: { location: "https://evil.example/archive.zip" } });
    await assert.rejects(catalog.download(entry), /Untrusted/);
    catalog.fetch = async () => new Response(bytes);
    await assert.rejects(catalog.download({ ...entry, size: bytes.length - 1 }), /size limit/);
});
test("compatible patch updates are automatic, minor and major require confirmation", async () => {
    const catalog = new KitCatalog({ repository: "owner/catalog", version: "3.0.0" });
    catalog.list = async () => ({ entries: [entry] });
    const manifest = { id: "demo", version: "1.0.0", source: { type: "catalog", repository: "owner/catalog" } };
    assert.equal((await catalog.updateFor(manifest)).automatic, true);
    assert.equal(await catalog.updateFor({ ...manifest, source: "git" }), null);
    for (const version of ["1.1.0", "2.0.0"]) {
        catalog.list = async () => ({ entries: [{ ...entry, version }] });
        assert.equal((await catalog.updateFor(manifest)).requiresConfirmation, true);
    }
    catalog.list = async () => ({ entries: [{ ...entry, minVibeStudio: "99.0.0" }] });
    assert.equal(await catalog.updateFor(manifest), null);
});
