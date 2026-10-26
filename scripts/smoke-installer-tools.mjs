import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureRuntime } from "../core/runtime.mjs";
import { resolveCodex, stdioTransport, RpcPeer } from "../core/adapters/codex.mjs";
import { resolveCommand } from "../core/adapters/gemini.mjs";

if (process.platform !== "win32") throw new Error("Optional tools smoke requires Windows.");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "vibe-private-tools-"));
const root = process.env.VIBE_STUDIO_SMOKE_TOOLS || path.join(temporary, "Vibe Studio é");
const stage = path.join(root, "tools");
const result = path.join(temporary, "result.txt");
const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
    CODEX_HOME: path.join(temporary, "codex"), GEMINI_CLI_HOME: path.join(temporary, "gemini"),
    CLAUDE_CONFIG_DIR: path.join(temporary, "claude"), CLAUDE_CODE_GIT_BASH_PATH: "",
    ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", OPENAI_API_KEY: "" };
for (const key of Object.keys(env)) if (key.toLowerCase() === "path" && key !== "PATH") delete env[key];
const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const run = (file, args) => execFileSync(file, args, { env, encoding: "utf8", windowsHide: true, timeout: 1_800_000 });
try {
    await Promise.all([env.CODEX_HOME, env.GEMINI_CLI_HOME, env.CLAUDE_CONFIG_DIR].map(dir => mkdir(dir, { recursive: true })));
    // Opt-in: this downloads proprietary Claude Code to a temporary test installation, never the distributable.
    const output = run(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.join(repo, "scripts", "installer", "install-tools.ps1"), "-Root", root, "-Stage", stage,
        "-Components", "git,apm,claude,codex,gemini", "-ResultFile", result]);
    console.log(output);
    assert.match(await readFile(result, "utf8"), /Personal sign-in is still required/);
    configureRuntime(root, { env });
    assert.match(run(path.join(stage, "git", "bin", "bash.exe"), ["--noprofile", "--norc", "-c", "git --version"]), /git version/);
    assert.match(run(path.join(stage, "claude", "claude.exe"), ["--version"]), /Claude/);
    const codex = resolveCodex({ env });
    assert.ok(codex);
    assert.match(run(codex.file, ["--version"]), /codex/);
    const transport = stdioTransport({ file: codex.file, env });
    const peer = new RpcPeer(transport);
    try {
        const initialized = await peer.request("initialize", {
            clientInfo: { name: "vibe-installer-smoke", version: "1.0.0" }, capabilities: { experimentalApi: true },
        }, 30_000);
        assert.ok(initialized);
    } finally { await transport.close(); }
    const gemini = resolveCommand("gemini", { env });
    assert.ok(gemini);
    assert.match(run(gemini.file, [...gemini.args, "--version"]), /\d+\.\d+\.\d+/);
    // A second pass must reuse these compatible private tools instead of downloading replacements.
    run(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.join(repo, "scripts", "installer", "install-tools.ps1"), "-Root", root,
        "-Stage", path.join(temporary, "unused-stage"), "-Components", "git,apm,claude,codex,gemini", "-ResultFile", result]);
    const reused = await readFile(result, "utf8");
    for (const name of ["git", "apm", "claude", "codex", "gemini"]) assert.ok(reused.includes(`${name}: reusing`), reused);
    console.log("Private optional tools: Git Bash, APM, Claude, native Codex/app-server, Gemini/Node and compatible-tool reuse verified without sign-in or AI prompts.");
} finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
