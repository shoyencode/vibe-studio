import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function pythonExecutable({ env = process.env, installDir, platform = process.platform, exists = existsSync } = {}) {
    if (env.VIBE_STUDIO_PYTHON) return env.VIBE_STUDIO_PYTHON;
    const bundled = installDir && path.join(installDir, "runtime", "python", "python.exe");
    return platform === "win32" && bundled && (exists(bundled) || exists(path.dirname(bundled))) ? bundled : "python";
}

// This changes only Vibe Studio and its children, never the Windows user/system environment.
export function configureRuntime(installDir, { env = process.env, platform = process.platform, exists = existsSync, read = readFileSync } = {}) {
    if (platform !== "win32") return;
    const metadata = path.join(installDir, "tools", "external-tools.json");
    const external = exists(metadata) ? JSON.parse(read(metadata, "utf8")) : { externalBins: [], gitBash: "" };
    if (!Array.isArray(external.externalBins) || !external.externalBins.every(dir => typeof dir === "string" && path.win32.isAbsolute(dir)) ||
        typeof external.gitBash !== "string" || (external.gitBash && !path.win32.isAbsolute(external.gitBash))) {
        throw new Error("Invalid Vibe Studio external-tools.json. Repair the installation before starting.");
    }
    const python = pythonExecutable({ env, installDir, platform, exists });
    if (python !== "python") env.VIBE_STUDIO_PYTHON = python;
    const dirs = [
        path.join(installDir, "runtime", "python"),
        path.join(installDir, "runtime", "github", "bin"),
        path.join(installDir, "tools", "git", "cmd"),
        path.join(installDir, "tools", "apm"),
        path.join(installDir, "tools", "claude"),
        path.join(installDir, "tools", "codex"),
        path.join(installDir, "tools", "gemini", "node_modules", ".bin"),
        path.join(installDir, "tools", "node"),
        ...external.externalBins,
    ].filter(exists);
    const key = Object.keys(env).find(key => key.toLowerCase() === "path") || "PATH";
    env[key] = [...dirs, env[key] || ""].join(";");
    const privateBash = path.join(installDir, "tools", "git", "bin", "bash.exe");
    const bash = exists(privateBash) ? privateBash : external.gitBash;
    if (!env.CLAUDE_CODE_GIT_BASH_PATH && bash && exists(bash)) env.CLAUDE_CODE_GIT_BASH_PATH = bash;
}
