import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Updates, newerVersion } from "../app/updates.mjs";

async function fixture(t, { installed = true } = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibe-updates-"));
    const binary = Buffer.from("licensed fictional installer fixture");
    const hash = createHash("sha256").update(binary).digest("hex");
    const state = { version: "v2.2.0", hash, binary, size: binary.length, calls: [], fail: false, redirect: false };
    const server = createServer((request, response) => {
        state.calls.push(request.url);
        if (state.fail) { response.writeHead(404).end(); return; }
        if (state.empty && request.url.endsWith("/releases/latest")) { response.writeHead(404).end(); return; }
        if (state.empty && request.url.startsWith("/repos/fixture/app/releases?")) { response.writeHead(200).end("[]"); return; }
        if (state.rateLimit) { response.writeHead(403, { "x-ratelimit-remaining": "0" }).end(); return; }
        if (state.redirect) { response.writeHead(302, { Location: "https://untrusted.invalid/payload" }).end(); return; }
        const url = new URL(request.url, "http://localhost");
        if (state.downloadRedirect && url.pathname.includes("/releases/download/")) {
            response.writeHead(302, { Location: state.downloadRedirect }).end(); return;
        }
        const data = url.pathname.endsWith("/releases/latest") ? { tag_name: state.version, prerelease: !!state.prerelease,
            assets: [{ name: `Vibe-Studio-Setup-${state.version.slice(1)}-x64.exe`, size: state.size,
                digest: state.missingDigest ? null : `sha256:${state.hash}`, state: "uploaded" }] } : null;
        response.writeHead(200);
        response.end(data ? JSON.stringify(data) : state.binary);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
    const fetchLocal = (url, options) => {
        assert.ok(["https://api.github.com", "https://github.com", "https://release-assets.githubusercontent.com"].includes(new URL(url).origin));
        assert.equal(options.credentials, "omit");
        assert.equal(options.redirect, "manual");
        return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}${new URL(url).search}`, options);
    };
    const options = { source: { repository: "fixture/app" }, version: "2.1.1", directory, fetch: fetchLocal, installed };
    return { updates: new Updates(options), options, state, binary };
}

test("stable update versions compare numerically and never select prereleases or downgrades", () => {
    assert.equal(newerVersion("v2.10.0", "2.9.9"), true);
    for (const value of ["v2.1.1", "1.99.0", "2.2.0-beta.1", "garbage", "02.3.0"]) assert.equal(newerVersion(value, "2.1.1"), false);
});

test("the installed release and older releases report no newer update", async t => {
    const f = await fixture(t);
    for (const version of ["v2.1.1", "v2.0.0"]) {
        f.state.version = version;
        const result = await f.updates.check(true);
        assert.equal(result.status, "current");
        assert.equal(result.error, undefined);
    }
});

test("an empty public release list is current, but an inaccessible repository remains an error", async t => {
    const f = await fixture(t);
    f.state.empty = true;
    const result = await f.updates.check(true);
    assert.equal(result.status, "current");
    assert.equal(result.error, undefined);
    assert.ok(f.state.calls.includes("/repos/fixture/app/releases?per_page=1"));
    const cached = new Updates(f.options);
    const count = f.state.calls.length;
    assert.equal((await cached.check()).status, "current");
    assert.equal(f.state.calls.length, count);
    f.state.fail = true;
    assert.match((await f.updates.check(true)).error, /404.*Public access/);
});

test("public GitHub release checks coalesce, survive restart and retry private-repository failures explicitly", async t => {
    const f = await fixture(t);
    const values = await Promise.all([f.updates.check(), f.updates.check()]);
    assert.equal(values[0].status, "available");
    assert.equal(f.state.calls.length, 1);
    const next = new Updates(f.options);
    assert.equal((await next.check()).version, "2.2.0");
    assert.equal(f.state.calls.length, 1, "do not poll within a day");
    f.state.fail = true;
    assert.match((await next.check(true)).error, /404.*Public access/);
    f.state.fail = false;
    assert.equal((await next.check(true)).status, "available");
});

test("GitHub rate limits and prereleases are explicit; no update source means no network", async t => {
    const f = await fixture(t);
    f.state.rateLimit = true;
    assert.match((await f.updates.check(true)).error, /rate limit/);
    f.state.rateLimit = false; f.state.prerelease = true;
    assert.match((await f.updates.check(true)).error, /stable release/);
    const disabled = new Updates({ ...f.options, source: undefined });
    const count = f.state.calls.length;
    assert.equal((await disabled.check()).status, "disabled");
    assert.equal(f.state.calls.length, count);
    assert.throws(() => new Updates({ ...f.options, source: { repository: "../unsafe" } }), /Invalid GitHub/);
});

test("only GitHub's release CDN redirects are followed and missing digests block download", async t => {
    const f = await fixture(t);
    f.state.downloadRedirect = "https://release-assets.githubusercontent.com/fixture/installer";
    assert.equal((await f.updates.download()).status, "ready");
    const next = new Updates(f.options);
    f.state.downloadRedirect = "https://untrusted.invalid/payload";
    await assert.rejects(next.download(), /outside the trusted/);
    f.state.missingDigest = true;
    const count = f.state.calls.filter(url => url.includes("/releases/download/")).length;
    await assert.rejects(next.download(), /checksum/);
    assert.equal(f.state.calls.filter(url => url.includes("/releases/download/")).length, count);
});

test("installer bytes and SHA256 are verified again before launch; portable never downloads an installer", async t => {
    const f = await fixture(t);
    assert.equal((await f.updates.download()).status, "ready");
    const file = await f.updates.verifiedInstaller();
    assert.deepEqual(await readFile(file), f.binary);
    assert.equal((await f.updates.check(true)).status, "ready");
    await writeFile(file, Buffer.alloc(f.binary.length, 0));
    await assert.rejects(f.updates.verifiedInstaller(), /changed/);
    const portable = new Updates({ ...f.options, installed: false });
    assert.equal((await portable.check()).installed, false);
    await assert.rejects(portable.download(), /portable/);
});

test("invalid checksum, truncated installer and redirects never become a ready update", async t => {
    const f = await fixture(t);
    f.state.hash = "0".repeat(64);
    await assert.rejects(f.updates.download(), /verification failed/);
    assert.equal(f.updates.status().status, "error");
    f.state.hash = createHash("sha256").update(f.binary).digest("hex");
    f.state.size++;
    await assert.rejects(f.updates.download(), /verification failed/);
    f.state.redirect = true;
    assert.equal((await f.updates.check(true)).status, "error");
});
