import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { download } from "./downloads.mjs";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("The installer must be built on Windows x64.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = path.join(root, "scripts", "installer");
const cache = path.join(root, "dist", "installer-cache");
const manifest = JSON.parse(await readFile(path.join(source, "components.json"), "utf8"));
const appManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = appManifest.version;
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, stdio: "inherit", windowsHide: true, timeout: 600_000, ...options });
const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const expand = (archive, target) => run(powershell, ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:VIBE_ARCHIVE -DestinationPath $env:VIBE_TARGET -Force"],
{ env: { ...process.env, VIBE_ARCHIVE: archive, VIBE_TARGET: target } });

if (process.argv.includes("--tools")) {
    const setup = await download(manifest.compiler, path.join(cache, "inno-setup.exe"));
    // Inno Setup's own portable mode does not register file associations, shortcuts or an uninstaller.
    run(setup, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", "/PORTABLE=1",
        `/DIR=${path.join(cache, "inno")}`]);
    console.log(`Compiler ready: ${path.join(cache, "inno", "ISCC.exe")}`);
} else {
    const compiler = process.env.VIBE_STUDIO_ISCC || path.join(cache, "inno", "ISCC.exe");
    if (!existsSync(compiler)) throw new Error("Inno Setup compiler missing. Run npm run installer:tools, or set VIBE_STUDIO_ISCC to ISCC.exe.");
    const assets = path.join(root, "dist", "installer-assets");
    run(process.execPath, [path.join(root, "scripts", "package.mjs")]);
    const application = path.join(root, "dist", "Vibe Studio-win32-x64");
    const dependencies = path.join(application, "resources", "app", "node_modules");
    for (const name of Object.keys(appManifest.optionalDependencies)) {
        if (!existsSync(path.join(dependencies, name, "package.json"))) {
            throw new Error(`Installer SDK missing: ${name}. Restore npm dependencies with optional dependencies enabled.`);
        }
    }
    if (!existsSync(path.join(dependencies, "@github", "copilot-sdk-win32-x64", "prebuilds", "win32-x64", "copilot-runtime.exe"))) {
        throw new Error("Installer Copilot runtime missing. Restore npm optional dependencies for Windows x64.");
    }
    const python = path.join(application, "runtime", "python");
    await mkdir(python, { recursive: true });
    const archive = await download(manifest.python, path.join(cache, "python.zip"));
    expand(archive, python);
    const pipArgs = ["-m", "pip", "install", "--disable-pip-version-check", "--require-hashes", "--only-binary=:all:",
        "--platform=win_amd64", "--python-version=3.13", "--implementation=cp", "--abi=cp313", "--no-compile",
        "--target", path.join(python, "Lib", "site-packages"), "-r", path.join(source, "requirements.txt")];
    run(process.env.VIBE_STUDIO_BUILD_PYTHON || "python", pipArgs);
    await writeFile(path.join(python, "python313._pth"), "python313.zip\r\n.\r\nLib\\site-packages\r\nimport site\r\n");
    await cp(path.join(source, "sitecustomize.py"), path.join(python, "sitecustomize.py"));
    await cp(path.join(python, "python.exe"), path.join(python, "python3.exe"));
    run(path.join(python, "python.exe"), ["-c", "import yaml, jsonschema; print('Private Python dependencies ready')"]);
    const github = path.join(application, "runtime", "github");
    expand(await download(manifest.github, path.join(cache, "github.zip")), github);
    run(path.join(github, "bin", "gh.exe"), ["--version"]);
    const setupFiles = path.join(application, "setup");
    await mkdir(setupFiles, { recursive: true });
    for (const file of ["components.json", "install-tools.ps1", "tools-shell.ps1", "gemini"]) await cp(path.join(source, file), path.join(setupFiles, file), { recursive: true });
    await writeFile(path.join(application, "INSTALLATION.txt"), [
        `Vibe Studio ${version} - Windows x64, current user only.`,
        "Electron, Copilot and private Python are included. No system Python or Node.js is required.",
        "Optional tools require Internet and are private to this application; Windows PATH is not changed.",
        "Use the Vibe Studio tools shortcut for sign-in commands with the private tools.",
        "GitHub Copilot: gh auth login (the MIT-licensed GitHub CLI is included for sign-in).",
        "Claude: claude auth login. Codex: codex login. Gemini: gemini, then choose a sign-in method.",
        "Sign-in, subscriptions and access to private repositories remain personal.",
        "Git/APM do not install a kit into a project automatically.",
        "Project-specific dependencies, MCP servers, Docker and build tools are not included.",
        "User data remains in %APPDATA%\\Vibe Studio and is preserved by uninstall.",
        "Licences: resources\\app\\LICENSE; resources\\app\\THIRD-PARTY-NOTICES.txt;",
        "Electron: LICENSE and LICENSES.chromium.html; Python: runtime\\python\\LICENSE.txt.",
        "Python dependencies include their licences in runtime\\python\\Lib\\site-packages\\*.dist-info.",
        "Optional tools include their own notices. Claude Code is downloaded only when selected.",
        "",
    ].join("\r\n"));
    run(compiler, ["/Qp", `/DAppVersion=${version}`, `/DAppSource=${application}`, `/DOutputDir=${path.join(root, "dist")}`, `/DAssetsDir=${assets}`,
        path.join(source, "vibe-studio.iss")]);
    console.log(path.join(root, "dist", `Vibe Studio-Setup-${version}-x64.exe`));
}
