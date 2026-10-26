import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

if (process.platform !== "win32") throw new Error("Installer smoke requires Windows.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const installer = path.join(root, "dist", `Vibe Studio-Setup-${manifest.version}-x64.exe`);
const temporary = await mkdtemp(path.join(os.tmpdir(), "vibe-studio-installer-"));
const installed = path.join(temporary, "Application espaces é");
const profile = path.join(temporary, "profile");
const project = path.join(temporary, "project");
const testId = `-smoke-${randomUUID()}`;
const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const windowsPath = [path.join(process.env.SystemRoot, "System32"), process.env.SystemRoot].join(";");
const env = { ...process.env, PATH: windowsPath, VIBE_STUDIO_PYTHON: "", VIBE_STUDIO_PYTHON: "",
    COPILOT_HOME: path.join(temporary, "copilot"), GH_CONFIG_DIR: path.join(temporary, "github"),
    GH_TOKEN: "", GITHUB_TOKEN: "", COPILOT_GITHUB_TOKEN: "" };
// Avoid two differently-cased PATH entries in a Windows child environment.
for (const key of Object.keys(env)) if (key.toLowerCase() === "path" && key !== "PATH") delete env[key];
const run = (file, args, input) => execFileSync(file, args, { env, input, windowsHide: true, encoding: "utf8", timeout: 600_000 });
const persistedPath = () => run(powershell, ["-NoProfile", "-Command",
    "[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::GetEnvironmentVariable('Path','Machine')"]);
const originalPath = persistedPath();
const installArgs = ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/TYPE=offline", "/COMPONENTS=app",
    "/NoShortcuts=1", `/TestInstall=${testId}`, `/DIR=${installed}`, `/LOG=${path.join(temporary, "install.log")}`];
let desktop;
let succeeded = false;
async function uninstall() {
    const executable = path.join(installed, "unins000.exe");
    try { await stat(executable); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    run(executable, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]);
    for (let attempt = 0; attempt < 200; attempt++) {
        try { await stat(executable); }
        catch (error) { if (error.code === "ENOENT") return; throw error; }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("The test uninstaller did not finish removing its installation.");
}
try {
    await mkdir(profile, { recursive: true });
    await writeFile(path.join(profile, "preferences.json"), JSON.stringify({ theme: "dark", notifications: false, sound: false }));
    await writeFile(path.join(profile, "sentinel.txt"), "Preserve user data");
    await cp(path.join(root, "test", "fixtures", "demo"), project, { recursive: true });
    await writeFile(path.join(project, "demo.yml"), "project:\n  name: Installer smoke\n  language: en\npaths:\n  root: work\n");
    await mkdir(path.join(project, "work"), { recursive: true });
    await writeFile(path.join(project, "work", "note.md"), "# Note\n");
    run(installer, installArgs);
    assert.equal(persistedPath(), originalPath);
    assert.match(await readFile(path.join(installed, "setup", "installation-result.txt"), "utf8"), /Personal sign-in is still required/);
    assert.match(await readFile(path.join(installed, "setup", "installation-result.ini"), "utf8"), /success=1/);
    const initialLog = await readFile(path.join(temporary, "install.log"), "utf8");
    assert.match(initialLog, /VIBE\|app\|detect\|-1/);
    assert.match(initialLog, /VIBE\|app\|complete\|-1/);
    const python = path.join(installed, "runtime", "python", "python.exe");
    assert.match(run(python, ["-c", "import yaml, jsonschema; print('OK')"]), /OK/);
    // The embeddable runtime must also support a kit importing a module next to its script.
    await writeFile(path.join(project, "local_helper.py"), "VALUE = 'local imports work'\n");
    await writeFile(path.join(project, "check.py"), "import local_helper\nprint(local_helper.VALUE)\n");
    assert.match(run(python, [path.join(project, "check.py")]), /local imports work/);
    const bridge = path.join(installed, "resources", "app", "core", "bridge.py");
    const snapshot = JSON.parse(run(python, [bridge, "snapshot", "--project", project], "{}"));
    assert.equal(snapshot.valid, true);
    assert.equal(snapshot.title, "Installer smoke");
    // Kit-owned scripts must also work with the private interpreter and contract approval path.
    run(python, [path.join(project, ".apm", "skills", "demo-0-start", "scripts", "validations.py"),
        "record", "--project", project, "--path", "work/note.md", "--step", "1-write-note", "--by", "Installer smoke",
        "--file", "work/approvals.md"]);
    const approved = JSON.parse(run(python, [bridge, "snapshot", "--project", project], "{}"));
    assert.equal(approved.validations["work/note.md"].current, true);
    desktop = await _electron.launch({ executablePath: path.join(installed, "Vibe Studio.exe"),
        args: [`--user-data-dir=${profile}`], env, timeout: 60_000 });
    const page = await desktop.firstWindow();
    assert.equal(await page.title(), "Vibe Studio");
    assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(await desktop.evaluate(({ app }) => app.getVersion()), manifest.version);
    assert.equal(await desktop.evaluate(({ app }) => app.getPath("userData")), profile);
    const installedPython = await desktop.evaluate(() => process.env.VIBE_STUDIO_PYTHON);
    assert.equal(installedPython, python);
    const fromApp = await page.evaluate(async project => {
        const opened = await window.vibeStudio.call("/projects/open", { dir: project });
        if (opened.error) throw new Error(opened.error);
        return window.vibeStudio.call("/snapshot");
    }, project);
    assert.equal(fromApp.result.kit.valid, true);
    assert.throws(() => run(installer, installArgs), error => error.status !== 0);
    assert.match(await readFile(path.join(temporary, "install.log"), "utf8"), /Close Vibe Studio before/);
    await desktop.close();
    desktop = null;
    run(installer, installArgs);
    assert.equal(await readFile(path.join(profile, "sentinel.txt"), "utf8"), "Preserve user data");
    await uninstall();
    await assert.rejects(stat(path.join(installed, "Vibe Studio.exe")), { code: "ENOENT" });
    assert.equal(await readFile(path.join(profile, "sentinel.txt"), "utf8"), "Preserve user data");
    assert.equal(persistedPath(), originalPath);
    succeeded = true;
    console.log("Installer: offline base with no system Python/Node/Git, real Python imports and kit validation, installed Electron bridge, reinstall, uninstall and PATH/profile preservation verified.");
} catch (error) {
    console.error(`Installer diagnostics: ${temporary}`);
    throw error;
} finally {
    if (desktop) await desktop.close();
    // Remove only this smoke's registration, never an actual installation.
    try { await uninstall(); }
    catch (error) { console.error("Smoke uninstall cleanup failed:", error.message); if (succeeded) throw error; }
    if (succeeded && !process.env.VIBE_STUDIO_KEEP_INSTALLER_SMOKE) await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
