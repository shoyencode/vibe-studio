import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const folder = path.join(root, "dist", `Vibe Studio-${process.platform}-${process.arch}`);
const executable = path.join(folder, process.platform === "win32" ? "Vibe Studio.exe" : "Vibe Studio");
const profile = await mkdtemp(path.join(os.tmpdir(), "vibe-studio-portable-"));
await writeFile(path.join(profile, "preferences.json"), JSON.stringify({ notifications: false, sound: false, theme: "dark" }));
await writeFile(path.join(profile, "projects.json"), JSON.stringify([{ dir: profile, title: "Retained recent project" }]));
let desktop;
try {
    desktop = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], timeout: 60_000 });
    const page = await desktop.firstWindow();
    await page.getByRole("heading", { name: /Projects|Projets/, exact: true }).waitFor();
    assert.equal(await page.title(), "Vibe Studio");
    assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
    assert.equal(await desktop.evaluate(({ app }) => app.getName()), "Vibe Studio");
    assert.equal(await desktop.evaluate(({ app }) => app.getVersion()), manifest.version);
    assert.equal(await desktop.evaluate(({ app }) => app.getPath("userData")), profile);
    await page.getByText("Retained recent project", { exact: true }).waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    assert.equal(JSON.parse(await readFile(path.join(profile, "preferences.json"), "utf8")).theme, "dark");
    if (process.platform === "win32") {
        const handle = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
        execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
            path.join(root, "scripts", "smoke-icons.ps1"), "-Executable", executable,
            "-Icon", path.join(folder, "Vibe Studio.ico"), "-WindowHandle", handle], { stdio: "inherit", windowsHide: true });
        const appData = path.join(profile, "shortcut-appdata");
        const shortcut = path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Vibe Studio.lnk");
        await mkdir(path.dirname(shortcut), { recursive: true });
        const before = await desktop.evaluate(({ app, shell }, { appData, shortcut }) => {
            const original = app.getPath("appData");
            app.setPath("appData", appData);
            if (!shell.writeShortcutLink(shortcut, "create", { target: process.execPath, appUserModelId: "VibeStudio.Desktop",
                icon: process.execPath, iconIndex: 0 })) throw new Error("Could not create the disposable stale shortcut");
            return original;
        }, { appData, shortcut });
        try {
            const saved = await page.evaluate(() => window.vibeStudio.call("/preferences", { notifications: true }));
            assert.ok(!saved.error, saved.error);
            const link = await desktop.evaluate(({ shell }, shortcut) => shell.readShortcutLink(shortcut), shortcut);
            assert.equal(link.icon, path.join(folder, "Vibe Studio.ico"));
            assert.equal(link.target, executable);
            assert.equal(link.appUserModelId, "VibeStudio.Desktop");
            await page.evaluate(() => window.vibeStudio.call("/preferences", { notifications: false }));
        } finally { await desktop.evaluate(({ app }, before) => app.setPath("appData", before), before); }
        assert.throws(() => execFileSync(process.execPath, [path.join(root, "scripts", "package.mjs")],
            { cwd: root, encoding: "utf8", stdio: "pipe" }), error => {
            assert.equal(error.status, 1);
            assert.match(error.stderr, /Close the portable before packaging/);
            return true;
        });
    }
    console.log(`Real packaged executable: Vibe Studio ${manifest.version}, title, retained recents, dark theme and overwrite protection verified with an isolated profile; no AI session opened.`);
} finally {
    if (desktop) await desktop.close();
    await rm(profile, { recursive: true, force: true });
}
