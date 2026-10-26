// Builds the portable Vibe Studio: a folder to unzip anywhere, no installer and no administrator rights.
// Usage: npm run package (from the repository root). Output: dist/Vibe Studio-<platform>-<arch>/ and its zip on Windows.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const assets = path.join(root, "dist", "installer-assets");
if (process.platform === "win32") {
    const output = path.join(root, "dist");
    const running = JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command",
        "$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress"],
    { encoding: "utf8", windowsHide: true }));
    const inUse = running.filter(item => item.ExecutablePath.toLowerCase().startsWith(output.toLowerCase() + path.sep));
    if (inUse.length) throw new Error(`Close the portable before packaging: ${inUse.map(item => `${item.ExecutablePath} (PID ${item.ProcessId})`).join(", ")}`);
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts", "installer", "prepare-assets.ps1"), "-Logo", path.join(root, "app", "renderer", "logo.png"),
        "-Destination", assets], { stdio: "inherit", windowsHide: true });
}
const [folder] = await packager({
    dir: root, out: path.join(root, "dist"), overwrite: true, prune: true,
    platform: process.platform, arch: process.arch, name: "Vibe Studio", executableName: "Vibe Studio",
    appVersion: manifest.version, appCopyright: "Copyright (c) 2026 Vibe Studio contributors (MIT)",
    ...(process.platform === "win32" ? { icon: path.join(assets, "setup.ico") } : {}),
    win32metadata: { CompanyName: "Vibe Studio", FileDescription: "Vibe Studio", ProductName: "Vibe Studio", InternalName: "vibe-studio" },
    // The Copilot runtime of the SDK is started from its files: they must stay outside an ASAR archive.
    asar: false,
    // The Claude Code binary bundled with its SDK (proprietary, about 300 MB) is not redistributed: the adapter uses the
    // Claude Code installed by the user (claude on the PATH).
    ignore: [/^\/test(\/|$)/, /^\/dist(\/|$)/, /^\/scripts(\/|$)/, /^\/README\.md$/,
        /^\/(?:\.test-|\.profile-test-)[^/]+(\/|$)/,
        /^\/npm-debug\.log[^/]*$/,
        /^\/(?:docs|\.github|\.impeccable|\.venv|__pycache__)(\/|$)/, /^\/(?:\.gitignore|requirements\.txt|CHANGELOG\.md)$/,
        /(^|\/)__pycache__(\/|$)/, /\.pyc$/, /^\/\.env(?:\.|$)/,
        /^\/node_modules\/@anthropic-ai\/claude-agent-sdk-[^/]+(\/|$)/],
});
if (process.platform === "win32") await cp(path.join(assets, "setup.ico"), path.join(folder, "Vibe Studio.ico"));
await writeFile(path.join(folder, "README.txt"), [
    `Vibe Studio ${manifest.version}, portable version.`,
    "",
    "1. Unzip this folder anywhere in your user space (no administrator rights needed).",
    "2. Requirements on the computer: Python 3.11+ with pyyaml and jsonschema, and a Copilot CLI login (copilot login).",
    "3. Start Vibe Studio.exe, then open the folder of a project where a kit is installed with APM.",
    "",
    "Updates: close Vibe Studio, then replace the folder. Preferences, recent projects and journals stay in %APPDATA%\\Vibe Studio.",
    "",
].join("\r\n"));
if (process.platform === "win32") {
    const zip = `${folder}.zip`;
    execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${folder}\\*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
    console.log(zip);
}
console.log(folder);
