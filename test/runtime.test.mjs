import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pythonExecutable, configureRuntime } from "../core/runtime.mjs";
import { verifyIntegrity } from "../scripts/installer/downloads.mjs";

test("Python overrides take priority without hiding invalid explicit paths", () => {
    const options = { installDir: "C:\\Vibe Studio", platform: "win32", exists: () => true };
    assert.equal(pythonExecutable({ ...options, env: { VIBE_STUDIO_PYTHON: "missing.exe" } }), "missing.exe");
    assert.match(pythonExecutable({ ...options, env: {} }), /runtime[\\/]python[\\/]python.exe$/);
    assert.equal(pythonExecutable({ ...options, env: {}, exists: () => false }), "python");
    assert.match(pythonExecutable({ ...options, env: {}, exists: file => /[\\/]python$/.test(file) }), /python.exe$/);
    assert.equal(pythonExecutable({ ...options, env: {}, platform: "linux" }), "python");
});

test("private tools affect only the supplied process environment, including Git Bash", () => {
    const original = process.env.VIBE_STUDIO_PYTHON;
    const read = () => '{"externalBins":[],"gitBash":""}';
    const env = { Path: "existing-tools", VIBE_STUDIO_PYTHON: "chosen-python", CLAUDE_CODE_GIT_BASH_PATH: "external-bash" };
    configureRuntime("C:\\Espaces et accents é", { env, platform: "win32", exists: () => true, read });
    assert.equal(env.VIBE_STUDIO_PYTHON, "chosen-python");
    assert.ok(env.Path.endsWith(";existing-tools"));
    assert.equal(env.PATH, undefined);
    assert.match(env.Path, /runtime[\\/]github[\\/]bin/);
    assert.match(env.Path, /tools[\\/]node/);
    assert.match(env.Path, /gemini[\\/]node_modules[\\/]\.bin/);
    assert.equal(env.CLAUDE_CODE_GIT_BASH_PATH, "external-bash");
    const fresh = { PATH: "original" };
    configureRuntime("install", { env: fresh, platform: "win32", exists: () => true, read });
    assert.match(fresh.CLAUDE_CODE_GIT_BASH_PATH, /git[\\/]bin[\\/]bash.exe$/);
    assert.equal(process.env.VIBE_STUDIO_PYTHON, original);
});

test("verified external tools survive a different launcher environment without modifying Windows PATH", () => {
    const env = { PATH: "clean-launcher" };
    const read = () => JSON.stringify({ externalBins: ["C:\\External tools"], gitBash: "C:\\Git\\bin\\bash.exe" });
    configureRuntime("install", { env, platform: "win32", read,
        exists: file => /external-tools\.json$/.test(file) || file.startsWith("C:\\") });
    assert.equal(env.PATH, "C:\\External tools;clean-launcher");
    assert.equal(env.CLAUDE_CODE_GIT_BASH_PATH, "C:\\Git\\bin\\bash.exe");
    assert.throws(() => configureRuntime("install", { env, platform: "win32", exists: () => true,
        read: () => '{"externalBins":["relative-directory"],"gitBash":""}' }), /Repair the installation/);
});

test("portable and non-Windows runtime configuration retain their historical fallback", () => {
    const env = { PATH: "original" };
    configureRuntime("portable", { env, platform: "win32", exists: () => false });
    assert.equal(env.VIBE_STUDIO_PYTHON, undefined);
    assert.equal(env.PATH, "original");
    configureRuntime("portable", { env, platform: "linux", exists: () => true });
    assert.deepEqual(env, { PATH: "original" });
});

test("download verification accepts pinned SHA256 and npm SHA512 and rejects tampering", () => {
    const bytes = Buffer.from("official payload");
    const hex = createHash("sha256").update(bytes).digest("hex");
    const base64 = createHash("sha512").update(bytes).digest("base64");
    verifyIntegrity(bytes, `sha256:${hex}`);
    verifyIntegrity(bytes, `sha512-${base64}`);
    assert.throws(() => verifyIntegrity(Buffer.from("tampered"), `sha256:${hex}`), /integrity mismatch/);
    assert.throws(() => verifyIntegrity(bytes, "md5:123"), /Unsupported/);
});
