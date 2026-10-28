import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { KitSubmission, submitKit } from "../app/kit-submission.mjs";

test("submission requires explicit confirmation and local validation before GitHub", async () => {
    let calls = 0;
    const submission = new KitSubmission({ repository: "owner/catalog", run: async () => { calls++; }, validate: async () => ({ valid: false }) });
    await assert.rejects(submission.submit({}), /confirmation/);
    await assert.rejects(submission.submit({ confirmed: true, id: "demo", version: "1.0.0", directory: "." }), /validation failed/);
    assert.equal(calls, 0);
    await assert.rejects(submitKit(".", { readKit: () => assert.fail("must confirm before reading") }), /confirmation/);
});
test("submission uses only isolated checkout Git and cleans it up", async t => {
    const root = await mkdtemp(path.resolve(".submission-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = path.join(root, "source"), profile = path.join(root, "profile");
    await mkdir(path.join(source, ".git"), { recursive: true });
    await writeFile(path.join(source, ".git", "config"), "unchanged");
    await writeFile(path.join(source, "apm.yml"), "name: demo\nversion: 1.0.0\n");
    const calls = [];
    const submission = new KitSubmission({ repository: "owner/catalog", directory: profile, validate: async () => ({ valid: true }),
        run: async (command, args, options) => {
            calls.push({ command, args, options });
            assert.equal(options.shell, false);
            assert.ok(options.cwd.startsWith(profile));
            if (command === "gh" && args[0] === "repo") await mkdir(path.join(options.cwd, "catalog"));
            return command === "gh" && args[0] === "pr" ? "https://github.com/owner/catalog/pull/42" : "";
        } });
    assert.deepEqual(await submitKit(source, { repository: "owner/catalog", directory: profile, confirmed: true,
        maintainer: "tester", readKit: async () => ({ package: { name: "demo", version: "1.0.0" } }),
        validate: submission.validate, run: submission.run }),
        { url: "https://github.com/owner/catalog/pull/42" });
    assert.equal(await readFile(path.join(source, ".git", "config"), "utf8"), "unchanged");
    assert.deepEqual(calls[0].args, ["auth", "status", "--hostname", "github.com"]);
    await assert.rejects(readFile(path.join(calls[0].options.cwd, "catalog", "kits", "demo", "apm.yml")), /ENOENT/);
});
