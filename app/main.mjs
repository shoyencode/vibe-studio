// Vibe Studio desktop application: main process. Hosts the core, the Copilot harness and the window; the window talks to it by IPC only.
import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, net, Notification, protocol, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Project } from "../core/project.mjs";
import { CopilotHarness } from "../core/adapters/copilot.mjs";
import { HARNESSES, availableHarnesses, createHarness } from "../core/adapters/index.mjs";
import { localize, UserError } from "../core/errors.mjs";
import { phaseText, t } from "../core/i18n.mjs";
import { Conversations } from "./conversations.mjs";
import { AttachmentInbox } from "./attachments.mjs";
import { autoApprove } from "./permission-policy.mjs";
import { profilePath } from "./profile.mjs";
import { configureRuntime } from "../core/runtime.mjs";
import { openHarnessLogin } from "./harness-login.mjs";
import { TaskbarActivity } from "./taskbar-activity.mjs";
import { activeStates, replaceFile } from "../core/store.mjs";
import { Updates } from "./updates.mjs";
import { KitWorkbench } from "./kit-workbench.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
if (app.isPackaged) configureRuntime(path.dirname(process.execPath));
const files = { renderer: path.join(here, "renderer"), core: path.join(here, "..", "core") };
// Shared modules the window imports from the core, nothing else.
const coreAssets = new Set(["/i18n.mjs", "/markdown.mjs", "/journey.mjs", "/kit-authoring.mjs"]);
const types = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".wav": "audio/wav" };

protocol.registerSchemesAsPrivileged([{ scheme: "vibe-studio", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName("Vibe Studio");
let profileStartupError = null;
try {
    app.setPath("userData", profilePath(app.getPath("appData"), app.commandLine.getSwitchValue("user-data-dir")));
}
catch (error) { profileStartupError = error; }
const APP_ID = "VibeStudio.Desktop";
const windowIcon = process.platform === "win32" && app.isPackaged
    ? path.join(path.dirname(process.execPath), "Vibe Studio.ico") : path.join(files.renderer, "logo.png");
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
if (!profileStartupError && !app.requestSingleInstanceLock()) app.quit();

let win = null, project = null, quitting = false;
let updates, workbench;
const taskbar = new TaskbarActivity(() => win);
let taskbarRuns = [], watchRevision = 0;
const pending = new Map();
function syncTaskbar() {
    const waiting = new Set([...pending.values()].map(item => item.sessionId));
    taskbar.setRunning(!!project && (taskbarRuns.some(run => ["running", "pausing"].includes(run.status)
        && project.sessions.has(run.sessionId) && !waiting.has(run.sessionId))
        || [...project.chats.values()].some(chat => chat.busy && !waiting.has(chat.sessionId))
        || project.runner.status().some(service => ["waiting", "starting", "stopping"].includes(service.status)))
        || !!workbench?.drafting.status()?.busy);
}
const conversations = new Conversations(item => send("vibe-studio:conversation", item));
const dataDir = () => app.getPath("userData");
const recentFile = () => path.join(dataDir(), "projects.json");
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const language = () => project?.language() || (app.getLocale().startsWith("fr") ? "fr" : "en");

// Preferences of the user on this computer, for every project.
const preferencesFile = () => path.join(dataDir(), "preferences.json");
const defaults = { sound: true, notifications: true, soundTheme: "chime", autopilot: false, approveAll: false, conversationHistory: true, theme: "system", harness: "copilot" };
const SOUND_THEMES = ["chime", "soft", "bell", "pop", "marimba", "arcade", "orbital", "telegraph", "analogNoir", "piano", "guitar"];
const AUTOPILOT_ANSWER = "Autopilot is on in Vibe Studio: the user is not available to answer. Choose the option you would recommend, write it down as an assumption where the skill records its work, and go on. Never record the approval of a deliverable on behalf of the user: leave it to approve later.";
const located = command => new Promise(resolve => execFile(process.platform === "win32" ? "where.exe" : "which", [command], { timeout: 4000, windowsHide: true },
    (error, stdout) => resolve(error ? null : String(stdout).split(/\r?\n/).find(Boolean) || null)));
let preferences = { ...defaults };
let preferenceWrites = Promise.resolve();
async function loadPreferences() {
    try { preferences = { ...defaults, ...JSON.parse(await readFile(preferencesFile(), "utf8")) }; } catch { preferences = { ...defaults }; }
    nativeTheme.themeSource = ["system", "light", "dark"].includes(preferences.theme) ? preferences.theme : "system";
}
async function savePreferences(input) {
    const before = preferences.autopilot;
    const next = { ...preferences };
    for (const key of ["sound", "notifications", "autopilot", "approveAll", "conversationHistory"]) if (typeof input[key] === "boolean") next[key] = input[key];
    if (SOUND_THEMES.includes(input.soundTheme)) next.soundTheme = input.soundTheme;
    if (["system", "light", "dark"].includes(input.theme)) next.theme = input.theme;
    if (typeof input.harness === "string" && input.harness !== preferences.harness) {
        if (!(await availableHarnesses()).some(h => h.id === input.harness && h.supported)) throw new UserError("harness.unsupported");
        await useHarness(input.harness);
        next.harness = input.harness;
    }
    if (before !== next.autopilot) await harness.setMode(next.autopilot ? "autopilot" : "interactive").catch(() => {});
    await mkdir(dataDir(), { recursive: true });
    await writeFile(`${preferencesFile()}.tmp`, JSON.stringify(next, null, 2));
    await replaceFile(`${preferencesFile()}.tmp`, preferencesFile());
    preferences = next;
    nativeTheme.themeSource = preferences.theme;
    if (preferences.notifications) ensureShortcut();
    // Enabling tool approval also releases pending permissions; guard confirmations remain explicit.
    if (autoApprove(preferences, false)) for (const [id, request] of pending) {
        if (request.kind !== "permission" || request.forced) continue;
        pending.delete(id);
        conversations.answered(request.sessionId, id, "approve");
        request.resolve("approve");
    }
    return preferences;
}
// Windows shows the notifications of an application that is not installed only when a Start menu shortcut carries its id.
function ensureShortcut() {
    if (process.platform !== "win32" || !app.isPackaged) return;
    const link = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Vibe Studio.lnk");
    try {
        const current = existsSync(link) ? shell.readShortcutLink(link) : null;
        if (current?.target === process.execPath && current?.appUserModelId === APP_ID
            && current?.icon === windowIcon && current?.iconIndex === 0) return;
        shell.writeShortcutLink(link, current ? "replace" : "create", { target: process.execPath, appUserModelId: APP_ID,
            description: "Vibe Studio", icon: windowIcon, iconIndex: 0 });
    } catch { /* Notifications then fall back to the flashing taskbar button. */ }
}

// Alerts: a sound in the window, and a Windows notification when the user is elsewhere.
function alert(kind, sessionId, body) {
    send("vibe-studio:alert", { kind, sessionId, sound: preferences.sound, theme: preferences.soundTheme });
    if (!win || win.isDestroyed() || win.isFocused()) return;
    win.flashFrame(true);
    if (!preferences.notifications || !Notification.isSupported()) return;
    const lang = language();
    const note = new Notification({ title: t(lang, `notify.${kind}`), body: String(body || "").slice(0, 240), silent: true,
        icon: path.join(files.renderer, "logo.png") });
    note.on("click", () => {
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show(); win.focus();
        send("vibe-studio:goto", { view: "conversation", sessionId });
    });
    note.show();
}
// The end of a step is seen in the journal: a run leaves the running or waiting state.
const lastStatus = new Map(), stopped = new Set();
async function watchRuns(silent = false) {
    if (!project) return;
    const observed = project, revision = ++watchRevision;
    const { runs } = await observed.store.read().catch(() => ({ runs: [] }));
    if (project !== observed || revision !== watchRevision) return;
    taskbarRuns = runs; syncTaskbar();
    for (const run of runs) {
        const before = lastStatus.get(run.id);
        lastStatus.set(run.id, run.status);
        if (silent || !before || !activeStates.has(before) || activeStates.has(run.status)) continue;
        if (stopped.delete(run.id)) continue;
        const step = project.lastKit?.contract?.steps.find(s => s.id === run.step);
        const title = (step ? phaseText(step, "title", language()) : run.step) + (run.unit ? ` · ${run.unit}` : "");
        alert(run.status === "error" ? "failed" : "ended", run.sessionId, title);
    }
}
// Files the user chose in the system dialog: only these can be attached.
const attachments = new AttachmentInbox(path.join(dataDir(), "attachments"), file => {
    if (!/\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(file)) return null;
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return null;
    const size = image.getSize(), scale = Math.min(112 / size.width, 80 / size.height, 1);
    return image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: "good" }).toDataURL();
});

// Questions and permissions of the AI are answered in the window: each one waits for an explicit click.
async function ask(kind, sessionId, payload) {
    const run = project && await project.runOf(sessionId);
    if (project?.pauseRequested(run)) return { answer: t(language(), "run.pauseRequired"), feedback: t(language(), "run.pauseRequired") };
    const id = randomUUID();
    return new Promise(resolve => {
        pending.set(id, { resolve, sessionId, kind, forced: !!payload.forced });
        syncTaskbar();
        conversations.request(sessionId, { id, kind, ...payload });
        send("vibe-studio:request", { id, kind, sessionId, ...payload });
        alert(kind, sessionId, kind === "question" ? payload.question : `${payload.detail || payload.intention || ""}`);
    });
}
function inside(root, target) {
    if (typeof target !== "string" || !target) return false;
    const relative = path.relative(root, path.resolve(root, target));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
}
function permissionText(request) {
    if (request.kind === "shell") return request.fullCommandText || request.intention || "";
    if (request.kind === "write") return request.fileName || "";
    if (request.kind === "read") return request.path || request.fileName || "";
    if (request.kind === "url") return request.url || "";
    if (request.kind === "mcp") return `${request.serverName || ""} ${request.toolName || ""}`.trim();
    return request.toolName || request.intention || "";
}
const ui = {
        permission: async ({ sessionId, request }) => {
            const draft = workbench?.drafting.status();
            if (draft?.sessionId === sessionId) {
                // Drafting only reads the kit; changes are proposals reviewed by the author.
                if (request.kind === "read" && inside(draft.directory, request.resolvedPath || request.path)) return "approve";
                return { reject: "Kit drafting only reads this kit. Submit changes with vibe_studio_propose." };
            }
            const forced = project?.takeForcedAsk(sessionId) || false;
            // Like Copilot CLI, reading inside the project folder needs no question; anything else waits for the user.
            if (!forced && request.kind === "read" && !request.managedApprovalRequired && project && inside(project.project, request.resolvedPath || request.path)) return "approve";
            // Autopilot approves the tools, except a confirmation imposed by a guard of the kit.
            if (autoApprove(preferences, forced)) {
                conversations.event(sessionId, { type: "vibe_studio.auto", data: { kind: "permission", detail: permissionText(request) } });
                return "approve";
            }
            const answer = await ask("permission", sessionId, { forced, permission: request.kind, detail: permissionText(request),
                intention: request.intention || "", canApproveForSession: request.canOfferSessionApproval !== false,
                diff: request.kind === "write" ? String(request.diff || "").slice(0, 20_000) : "" });
            return answer === "approve" || answer === "approve-session" ? answer : { reject: answer?.feedback || "Refused by the user in Vibe Studio." };
        },
        question: async ({ sessionId, request }) => {
            if (preferences.autopilot && request.allowFreeform !== false) {
                conversations.event(sessionId, { type: "vibe_studio.auto", data: { kind: "question", detail: request.question } });
                return { answer: AUTOPILOT_ANSWER, wasFreeform: true };
            }
            const answer = await ask("question", sessionId, { question: request.question, choices: request.choices || [],
                allowFreeform: request.allowFreeform !== false });
            return { answer: answer.answer, wasFreeform: !(request.choices || []).includes(answer.answer) };
        },
};
let harness = new CopilotHarness({ ui, cacheDir: path.join(dataDir(), "model-catalogs") });
const harnessName = () => HARNESSES.find(item => item.id === harness.status().harness)?.name || harness.status().harness;
// Changing harness closes the current one; it waits until no step and no conversation runs.
async function useHarness(id) {
    if (harness.status().harness === id) return;
    if (workbench?.drafting.status()?.busy || project && (project.sessions.size || project.chats.size)) throw new UserError("harness.busy");
    await workbench?.drafting.close();
    const next = await createHarness(id, { ui, cacheDir: path.join(dataDir(), "model-catalogs") });
    await harness.stop().catch(() => {});
    harness = next;
    if (project) project.harness = harness;
}

async function recent() {
    try { return JSON.parse(await readFile(recentFile(), "utf8")).filter(item => typeof item?.dir === "string"); } catch { return []; }
}
async function remember(dir, title) {
    const list = (await recent()).filter(item => item.dir.toLowerCase() !== dir.toLowerCase());
    list.unshift({ dir, title: title || path.basename(dir), openedAt: new Date().toISOString() });
    await mkdir(dataDir(), { recursive: true });
    await writeFile(recentFile(), JSON.stringify(list.slice(0, 12), null, 2));
}
async function openProject(dir) {
    const done = taskbar.begin("/projects/open");
    try {
        if (project) {
            const { runs } = await project.store.read();
            if (runs.some(run => activeStates.has(run.status) && project.sessions.has(run.sessionId))
                || [...project.chats.values()].some(chat => chat.busy) || project.runner.busy()
                || project.runner.status().some(service => ["starting", "running", "stopping"].includes(service.status))) throw new UserError("project.busy");
            await project.dispose();
        }
        project = await new Project(dir, { harness, dataDir: dataDir(), sessionMode: () => (preferences.autopilot ? "autopilot" : null),
            onSessionEvent: (sessionId, event) => {
                conversations.event(sessionId, event);
                if (["session.usage_checkpoint", "session.shutdown"].includes(event.type)) send("vibe-studio:costs", {});
                if (event.type === "session.idle" && project?.chats.has(sessionId)) alert("reply", sessionId, t(language(), "notify.replyBody"));
            } }).init();
        project.listeners.add(() => { send("vibe-studio:refresh", {}); void watchRuns(); });
        lastStatus.clear(); taskbarRuns = []; await watchRuns(true);
        const snapshot = await project.snapshot();
        await remember(project.project, typeof snapshot.kit?.title === "string" ? snapshot.kit.title : null);
        if (workbench) { workbench.lastCheck = 0; void workbench.checkUpdates(); }
        return { project: project.project };
    } finally { done(); }
}

// Attachments sent back by the window must be files the user chose, never a path typed by a script.
function pick(list) {
    return attachments.pick(list);
}
const routes = {
    "/projects": async () => ({ recent: await recent(), current: project?.project || null, language: language(), harness: harness.status(), harnessName: harnessName(), version: app.getVersion(), updates: updates?.status(), kitUpdate: workbench?.updateState }),
    "/projects/close": async () => {
        const runs = project ? (await project.store.read()).runs : [];
        if (project && (runs.some(run => activeStates.has(run.status) && project.sessions.has(run.sessionId)) || [...project.chats.values()].some(chat => chat.busy) || project.runner.busy()
            || project.runner.status().some(service => ["waiting", "starting", "running", "stopping"].includes(service.status)))) throw new UserError("project.busy");
        await project?.dispose();
        project = null; taskbarRuns = []; lastStatus.clear(); syncTaskbar();
        return { closed: true };
    },
    "/projects/choose": async () => {
        const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"], title: t(language(), "projects.choose") });
        if (result.canceled || !result.filePaths[0]) return { project: project?.project || null };
        return openProject(result.filePaths[0]);
    },
    "/projects/open": async input => {
        if (typeof input.dir !== "string" || !existsSync(input.dir)) throw new UserError("projects.missing");
        return openProject(input.dir);
    },
    "/projects/forget": async input => {
        const list = (await recent()).filter(item => item.dir !== input.dir);
        await writeFile(recentFile(), JSON.stringify(list, null, 2));
        return { recent: list };
    },
    "/snapshot": async () => {
        const snapshot = await need().snapshot();
        await harness.start().catch(error => { snapshot.harnessError = localize(error, language()) ?? error.message; });
        snapshot.runtime = harness.status();
        snapshot.vibeStudioVersion = app.getVersion();
        snapshot.harnessName = harnessName();
        snapshot.updates = updates?.status();
        return snapshot;
    },
    "/prepare": input => need().prepare(input),
    "/launch": input => need().launch(input.ticket, pick(input.attachments), { model: input.model, contextTier: input.contextTier, reasoningEffort: input.reasoningEffort }),
    "/close": input => { stopped.add(input.runId); return need().close(input.runId); },
    "/pause": input => need().pause(input.runId, sessionId => {
        for (const [id, request] of pending) {
            if (request.sessionId !== sessionId) continue;
            pending.delete(id);
            const answer = { feedback: t(language(), "convo.pauseCancelled"), answer: t(language(), "convo.pauseCancelled") };
            conversations.answered(sessionId, id, answer);
            request.resolve(answer);
        }
        syncTaskbar();
    }),
    "/resume": input => need().resume(input.runId),
    "/say": input => input.sessionId ? need().sayToChat(input.sessionId, input.text, pick(input.attachments)) : need().say(input.runId, input.text, pick(input.attachments)),
    "/chat/options": input => need().chatOptions(input),
    "/models/refresh": () => need().chatOptions({ refresh: true }),
    "/chat/start": input => need().chat(input),
    "/chat/close": input => need().closeChat(input.sessionId),
    "/harness/login": async input => {
        if (workbench?.drafting.status()?.busy || project && (project.sessions.size || project.chats.size)) throw new UserError("harness.busy");
        return openHarnessLogin(input.id, { locate: located });
    },
    "/harnesses": async input => {
        if (input?.refresh && !(project?.sessions.size || project?.chats.size || workbench?.drafting.status()?.busy)) await harness.stop();
        let login = null, error = null;
        try { login = (await harness.start()).login || null; } catch (failure) { error = localize(failure, language()) ?? String(failure?.message || failure); }
        const list = await availableHarnesses();
        return { selected: harness.status().harness, login, connected: harness.status().connected, error,
            list: await Promise.all(list.map(async ({ module, exportName, loginCommand, loginArgs, ...h }) => ({
                ...h, canLogin: process.platform === "win32", path: await located(h.command),
            }))) };
    },
    "/conversation": input => ({ items: conversations.items(input.sessionId), metrics: conversations.metrics(input.sessionId) }),
    "/answer": input => {
        const waiting = pending.get(input.id);
        if (!waiting) throw new UserError("request.gone");
        pending.delete(input.id);
        syncTaskbar();
        conversations.answered(waiting.sessionId, input.id, input.answer);
        waiting.resolve(input.answer);
        return { answered: true };
    },
    "/feedback": input => need().feedback({ ...input, attachments: pick(input.attachments) }),
    "/correction": input => need().correction(input),
    "/updates": () => updates.status(),
    "/updates/check": () => updates.check(true),
    "/updates/download": () => updates.download(),
    "/updates/install": async () => {
        const busy = () => project && (project.sessions.size || [...project.chats.values()].some(chat => chat.busy) || project.runner.busy());
        if (busy()) throw new UserError("updates.busy");
        const answer = await dialog.showMessageBox(win, { type: "question", title: "Vibe Studio",
            message: t(language(), "updates.confirm"), detail: t(language(), "updates.confirmDetail"),
            buttons: [t(language(), "updates.install"), t(language(), "launch.cancel")], defaultId: 1, cancelId: 1 });
        if (answer.response !== 0) return updates.status();
        if (busy()) throw new UserError("updates.busy");
        const installer = await updates.verifiedInstaller();
        await new Promise((resolve, reject) => {
            const child = spawn(installer, ["/CURRENTUSER", `/DIR=${path.dirname(process.execPath)}`],
                { detached: true, stdio: "ignore", windowsHide: false });
            child.once("error", reject);
            child.once("spawn", () => { child.unref(); resolve(); });
        });
        app.quit();
        return { launched: true };
    },
    "/files/choose": async () => {
        const result = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], title: t(language(), "attach.choose") });
        if (result.canceled) return { files: [] };
        if (result.filePaths.length > 10) throw new UserError("attach.tooMany", { n: 10 });
        return { files: await Promise.all(result.filePaths.map(file => attachments.describe(file))) };
    },
    "/preferences": input => {
        if (!input || !Object.keys(input).length) return preferences;
        const write = preferenceWrites.then(() => savePreferences(input));
        preferenceWrites = write.catch(() => {}); // The caller still receives the failure; the next write can proceed.
        return write;
    },
    "/approve": input => need().approve(input),
    "/reopen": input => need().reopen(input),
    "/guards/suspend": input => need().suspend(input.runId, input.id, !!input.suspended),
    "/costs": () => need().costs(),
    "/preview": input => need().preview(input),
    "/files/open": async input => {
        const file = await need().originalFile(input.path);
        const error = await shell.openPath(file);
        if (error) throw new UserError("files.openFailed", { message: error });
        return { opened: true };
    },
    "/app/start": input => need().appStart(input),
    "/app/stop": () => need().appStop(),
    "/app/logs": input => need().appLogs(input),
    "/app/open": input => need().appOpen(input),
    "/link": async input => {
        // Links found in deliverables: only web pages open, in the default browser.
        if (typeof input.url !== "string" || !/^https?:\/\//i.test(input.url)) throw new UserError("link.denied");
        await shell.openExternal(input.url);
        return { opened: true };
    },
};
function need() {
    if (!project) throw new UserError("project.none");
    return project;
}

ipcMain.handle("vibe-studio:files", async (event, input) => {
    if (event.senderFrame?.url !== "vibe-studio://app/index.html") return { error: t(language(), "origin.denied") };
    const done = taskbar.begin("/files/import");
    try { return { files: await attachments.import(input) }; }
    catch (error) {
        console.error("[vibe_studio] attachments:", error);
        return { error: localize(error, language()) ?? String(error.message), code: error.key || null };
    } finally { done(); }
});
ipcMain.handle("vibe-studio:call", async (event, route, input = {}) => {
    if (event.senderFrame?.url && !event.senderFrame.url.startsWith("vibe-studio://app/")) return { error: t("en", "origin.denied") };
    const handler = routes[route];
    if (!handler) return { error: t(language(), "action.unknown") };
    const done = taskbar.begin(route);
    try {
        if (workbench?.locked && ["/launch", "/chat/start", "/say", "/resume", "/app/start", "/projects/open", "/projects/choose", "/projects/close"].includes(route))
            throw new UserError("author.busy");
        return { result: await handler(input && typeof input === "object" ? input : {}) };
    }
    catch (error) {
        const authored = typeof error?.key === "string" && error.key.startsWith("authoring.") && t(language(), error.key, error.vars || {}) !== error.key
            ? t(language(), error.key, error.vars || {}) : null;
        const known = localize(error, language()) ?? authored;
        if (!known && !Array.isArray(error?.errors)) console.error(`[vibe_studio] ${route}:`, error);
        // An unexpected error keeps its detail, so that it can be reported and fixed.
        return { error: known ?? `${t(language(), "error.action")} ${String(error?.message || error).slice(0, 400)}`, code: error.key || null,
            ...(Array.isArray(error?.errors) && error.errors.length ? { issues: error.errors.slice(0, 50) } : {}) };
    } finally { done(); }
});

function createWindow() {
    win = new BrowserWindow({
        width: 1280, height: 860, minWidth: 820, minHeight: 560, title: "Vibe Studio", show: false,
        icon: windowIcon,
        webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
            autoplayPolicy: "no-user-gesture-required" },
    });
    win.removeMenu();
    taskbar.sync();
    win.once("ready-to-show", () => win.show());
    win.on("focus", () => win.flashFrame(false));
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.on("close", event => {
        if (quitting) return;
        const running = !!workbench?.drafting.status()?.busy || (project && ([...project.sessions.keys()].length > 0 || project.runner.busy()));
        if (!running) return;
        const choice = dialog.showMessageBoxSync(win, { type: "warning", buttons: [t(language(), "quit.confirm"), t(language(), "launch.cancel")],
            defaultId: 1, cancelId: 1, message: t(language(), "quit.title"), detail: t(language(), "quit.detail") });
        if (choice !== 0) event.preventDefault();
    });
    win.loadURL("vibe-studio://app/index.html");
}

app.whenReady().then(async () => {
    if (profileStartupError) {
        dialog.showErrorBox("Vibe Studio", t(app.getLocale().startsWith("fr") ? "fr" : "en",
            "startup.profileFailed", { message: profileStartupError.message }));
        app.exit(1); return;
    }
    await loadPreferences();
    const manifest = JSON.parse(await readFile(path.join(here, "..", "package.json"), "utf8"));
    workbench = new KitWorkbench({ directory: dataDir(), repository: manifest.vibeStudio?.kits?.repository, version: app.getVersion(),
        translate: (key, vars) => t(language(), key, vars), translateIn: (lang, key, vars) => t(lang, key, vars),
        harnessName, documents: app.getPath("documents"), pick: list => attachments.pick(list), reveal: dir => shell.openPath(dir),
        fetch: (url, options) => net.fetch(url, options), dialog, window: () => win, harness: () => harness,
        project: () => project, openProject, onEvent: (sessionId, event) => conversations.event(sessionId, event),
        onChange: () => { syncTaskbar(); send("vibe-studio:workshop", {}); send("vibe-studio:refresh", {}); },
        cancelRequests: sessionId => {
            for (const [id, request] of pending) {
                if (request.sessionId !== sessionId) continue;
                pending.delete(id);
                const answer = { feedback: t(language(), "convo.pauseCancelled"), answer: t(language(), "convo.pauseCancelled") };
                conversations.answered(sessionId, id, answer); request.resolve(answer);
            }
            syncTaskbar();
        } });
    workbench.items = sessionId => conversations.items(sessionId);
    workbench.metrics = sessionId => conversations.metrics(sessionId);
    Object.assign(routes, workbench.routes());
    setInterval(() => { void workbench.checkUpdates(); void workbench.applyPendingPatch(); }, 60_000).unref();
    updates = new Updates({ source: manifest.vibeStudio?.updates, version: app.getVersion(),
        directory: path.join(dataDir(), "updates"), fetch: (url, options) => net.fetch(url, options),
        installed: app.isPackaged && process.platform === "win32" && process.arch === "x64"
            && existsSync(path.join(path.dirname(process.execPath), "unins000.exe")) });
    if (preferences.harness !== "copilot") await useHarness(preferences.harness).catch(() => { preferences.harness = "copilot"; });
    if (preferences.notifications) ensureShortcut();
    protocol.handle("vibe-studio", request => {
        const { host, pathname } = new URL(request.url);
        if (host !== "app") return new Response("Not found", { status: 404 });
        const base = coreAssets.has(pathname) ? files.core : files.renderer;
        const target = path.normalize(path.join(base, decodeURIComponent(pathname)));
        if (!target.startsWith(base + path.sep) || !existsSync(target)) return new Response("Not found", { status: 404 });
        return net.fetch(pathToFileURL(target).toString()).then(response => new Response(response.body, {
            headers: { "Content-Type": types[path.extname(target)] || "application/octet-stream", "X-Content-Type-Options": "nosniff" } }));
    });
    createWindow();
    if (app.isPackaged) {
        const check = () => updates.check().then(() => send("vibe-studio:refresh", {}))
            .catch(error => console.error("[vibe_studio] updates:", error));
        void check();
        setInterval(check, 24 * 60 * 60 * 1000).unref();
    }
    const start = process.argv.find(arg => arg.startsWith("--project="))?.slice(10);
    if (start) win.webContents.once("did-finish-load", () => openProject(start).then(() => send("vibe-studio:refresh", { opened: true })).catch(() => {}));
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("before-quit", () => { quitting = true; taskbar.dispose(); });
app.on("window-all-closed", async () => {
    taskbar.dispose();
    for (const waiting of pending.values()) waiting.resolve({ feedback: "Vibe Studio was closed." });
    pending.clear();
    await project?.dispose().catch(() => {});
    await workbench?.drafting.close().catch(error => console.error("[vibe_studio] drafting close:", error));
    await harness.stop().catch(() => {});
    await attachments.cleanup().catch(error => console.error("[vibe_studio] attachment cleanup:", error));
    app.quit();
});
