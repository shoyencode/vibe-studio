import { app, BrowserWindow, dialog, net, shell } from "electron";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = process.env.VIBE_STUDIO_SMOKE_APP || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = relative => import(pathToFileURL(path.join(repo, relative)).href);
const { CopilotHarness } = await load("core/adapters/copilot.mjs");
const { Project } = await load("core/project.mjs");
app.setPath("appData", process.env.VIBE_STUDIO_SMOKE_APPDATA);
app.setPath("userData", path.join(process.env.VIBE_STUDIO_SMOKE_APPDATA, "Vibe Studio"));
globalThis.smoke = { sessions: new Map(), sent: [], opened: [], selection: [], taskbar: [] };
const fetchResource = net.fetch.bind(net);
net.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.github.com/repos/")) {
        globalThis.smoke.updateRequests = (globalThis.smoke.updateRequests || 0) + 1;
        return globalThis.smoke.updateFailure ? new Response("Private", { status: 404 })
            : Response.json({ tag_name: "v99.0.0" });
    }
    return fetchResource(url, options);
};
const setProgressBar = BrowserWindow.prototype.setProgressBar;
BrowserWindow.prototype.setProgressBar = function (value, options) {
    globalThis.smoke.taskbar.push({ value, options });
    return setProgressBar.call(this, value, options);
};
const manifest = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
app.getVersion = () => manifest.version;
const setAppUserModelId = app.setAppUserModelId.bind(app);
app.setAppUserModelId = id => { globalThis.smoke.appId = id; setAppUserModelId(id); };
const originalInit = Project.prototype.init;
Project.prototype.init = async function () { globalThis.smoke.project = this; return originalInit.call(this); };
Object.assign(CopilotHarness.prototype, {
    async start() { globalThis.smoke.harness = this; return { login: "smoke" }; },
    status() { return { harness: "copilot", login: "smoke", connected: true }; },
    async models() { return [
        { id: "claude-sonnet-5.5", capabilities: { limits: { max_context_window_tokens: 1000000 } },
            supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium",
            billing: { tokenPrices: { maxPromptTokens: 200000, longContext: { maxPromptTokens: 936000 } } } },
        { id: "gpt-6-luna" }, { id: "claude-opus-5.5" },
    ]; },
    catalogStatus() { return { source: "live" }; },
    async refreshModels() { return this.models(); },
    async agents() { return [{ name: "demo-writer", userInvocable: true, model: "gpt-6-luna" }]; },
    async openStep(options) {
        const sessionId = `smoke-${globalThis.smoke.sessions.size + 1}`;
        const handle = { sessionId, options,
            async send(prompt, attachments) { globalThis.smoke.sent.push({ sessionId, prompt, attachments }); return `m-${globalThis.smoke.sent.length}`; },
            async abort() { options.onEvent({ type: "session.idle", id: `abort-${sessionId}-${Date.now()}`, data: { aborted: true } }); },
            async disconnect() {},
            async current() { return { modelId: options.model, contextTier: options.contextTier, reasoningEffort: options.reasoningEffort }; },
        };
        globalThis.smoke.sessions.set(sessionId, handle);
        return handle;
    },
    async setMode(mode) { globalThis.smoke.mode = mode; },
    async stop() {},
});
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.smoke.selection });
dialog.showMessageBoxSync = () => 0;
shell.openPath = async file => { globalThis.smoke.opened.push(file); return ""; };
shell.openExternal = async url => { globalThis.smoke.opened.push(url); };
process.argv.push(`--project=${process.env.VIBE_STUDIO_SMOKE_PROJECT}`);
await load("app/main.mjs");
