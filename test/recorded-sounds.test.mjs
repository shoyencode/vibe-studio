import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const folder = new URL("../app/renderer/sounds/", import.meta.url);

test("approved recorded instrument clips retain licence, source provenance and exact output hashes", async () => {
    const manifest = JSON.parse(await readFile(new URL("recorded-manifest.json", folder), "utf8"));
    assert.equal(manifest.source.license, "CC-BY-3.0");
    assert.match(await readFile(new URL("CC-BY-3.0.txt", folder), "utf8"), /Attribution 3\.0/);
    assert.equal(manifest.source.files.length, 14);
    assert.equal(manifest.files.length, 6);
    for (const source of manifest.source.files) {
        assert.match(source.sha256, /^[a-f0-9]{64}$/);
        assert.ok(source.size > 1000);
    }
    for (const file of manifest.files) {
        const bytes = await readFile(new URL(file.file, folder));
        assert.equal(bytes.length, file.bytes);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
        assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
        assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
        assert.equal(bytes.readUInt16LE(20), 1, "uncompressed PCM");
        assert.equal(bytes.readUInt16LE(22), 2);
        assert.equal(bytes.readUInt32LE(24), 44100);
        assert.equal(bytes.readUInt16LE(34), 16);
        assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
        const duration = (bytes.length - 44) / (44100 * 2 * 2);
        assert.ok(duration >= 1 && duration < 2);
        assert.ok(Math.abs(duration - file.seconds) <= 1 / 44100);
        let peak = 0;
        for (let index = 44; index < bytes.length; index += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(index) / 32768));
        assert.ok(peak > .54 && peak < .56, `${file.file}: peak ${peak}`);
    }
});
