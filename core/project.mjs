import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RunStore, projectKey, activeStates, alive } from "./store.mjs";
import { UserError as Error, localize } from "./errors.mjs";
import { t, pick, phaseText } from "./i18n.mjs";
import { Runner, runHash } from "./runner.mjs";
import { launchPrompt, REPORT_TOOL, reportSchema } from "./prompt.mjs";
import { HARNESSES } from "./adapters/index.mjs";
import { decide, prepareRules, historyRule, relativeTo, tasksInProgress, writesOf, describeRules } from "./guards.mjs";
import { updateMetrics } from "./metrics.mjs";
import { pythonExecutable } from "./runtime.mjs";
import { normalizeModels, declaredModels, policyModels, validateSelection, appliedSettings, producerOf, productionProvenance, producerFamily, reportedSettings } from "./models.mjs";
import { automaticBuildStep, automaticallyCompletedBuild } from "./journey.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const taskStatuses = new Set(["todo", "in_progress", "done", "blocked"]);
const localUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?(\/[^\s"'<>^|&]*)?$/;

// Runs the generic Python bridge of the core on a project.
export function bridge(project, command, input = {}) {
    return new Promise((resolve, reject) => {
        const child = execFile(pythonExecutable(), [path.join(directory, "bridge.py"), command, "--project", project],
            { windowsHide: true, timeout: 60_000, maxBuffer: 10_000_000, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
            (error, stdout, stderr) => {
                if (error) {
                    let failure = new Error("bridge.unavailable");
                    try {
                        const detail = JSON.parse(stderr);
                        if (detail.code) failure = new Error(detail.code, { ...(detail.vars || {}), message: detail.error });
                    } catch { /* Non-JSON output is not exposed. */ }
                    reject(failure);
                    return;
                }
                try { resolve(JSON.parse(stdout)); } catch { reject(new Error("bridge.invalid")); }
            });
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify(input));
    });
}

// The default browser of the machine opens a declared local address, without a shell.
export function openInBrowser(url) {
    const [command, args] = process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
        : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
        child.once("error", reject);
        child.once("spawn", () => { child.unref(); resolve(); });
    });
}

// Agents report paths as they see them: absolute, with backslashes, or relative to the project.
export function projectRelative(project, value) {
    if (typeof value !== "string") return "";
    const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(project, value);
    const relative = path.relative(project, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return value.replaceAll("\\", "/");
    return relative.split(path.sep).join("/");
}

// Same placeholder rules as the bridge: {unit} is the unit folder, {n} its number, other names come from the snapshot.
export function resolvePattern(pattern, kit, unit) {
    let value = pattern;
    if (value.includes("{unit}") && kit?.contract?.units) value = value.replaceAll("{unit}", kit.contract.units.folder);
    if (unit != null) value = value.replaceAll("{n}", String(unit));
    for (const [name, replacement] of Object.entries(kit?.placeholders || {})) value = value.replaceAll(`{${name}}`, replacement);
    return value;
}

const harnessLabel = id => HARNESSES.find(item => item.id === id)?.name || id || "Copilot";
export const ATTACHMENT_LIMITS = { count: 10, bytes: 25 * 1024 * 1024 };
const attachmentName = name => String(name).normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(-80) || "file";
const originalFormats = new Set([".md", ".txt", ".json", ".csv", ".yml", ".yaml", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf"]);

export function approvedStep(step, kit, unit) {
    const files = (step.approves || []).map(pattern => resolvePattern(pattern, kit, unit));
    return files.length > 0 && files.every(file => kit.validations?.[file]?.current);
}

// The review module can change the purpose of its build and review steps.
export function stepVariant(step, kit, unit) {
    const review = kit?.contract?.modules?.review;
    const loop = kit?.tasks?.[String(unit)]?.loop;
    const key = review && step.id === review.buildStep ? "corrections" : review && step.id === review.reviewStep ? "rereview" : null;
    if (!loop || !key || loop.step !== key || !step.variants?.[key]) return null;
    return { key, text: step.variants[key], loop };
}

// Every row of the findings table of a review has a decision, when the table has a decision column.
export function reviewDecided(text) {
    const lines = text.split(/\r?\n/);
    let inFindings = false, column = -1;
    for (const line of lines) {
        if (/^##\s/.test(line)) { inFindings = /^##\s+(Findings|Constats)/i.test(line); column = -1; continue; }
        if (!inFindings || !line.trim().startsWith("|")) continue;
        const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
        if (column < 0) { column = cells.findIndex(cell => /^d[ée]cision/i.test(cell)); continue; }
        if (cells.every(cell => /^:?-+:?$/.test(cell))) continue;
        if (column >= 0 && !cells[column]) return false;
    }
    return true;
}

export class Project {
    constructor(dir, { harness, adapter = bridge, dataDir, opener = openInBrowser, runnerOptions, onSessionEvent = () => {}, sessionMode = () => null } = {}) {
        if (!harness) throw new Error("harness.none");
        this.dir = dir; this.harness = harness; this.adapter = adapter; this.dataDir = dataDir; this.opener = opener;
        this.runnerOptions = runnerOptions; this.onSessionEvent = onSessionEvent; this.sessionMode = sessionMode;
        this.chats = new Map(); this.forcedAsks = new Map();
        this.metricEvents = new Map();
        this.listeners = new Set(); this.confirmations = new Map(); this.queues = new Map();
        this.sessions = new Map(); this.lastError = null; this.lastKit = null;
        this.stepControls = new Map();
    }
    async init() {
        this.project = await realpath(this.dir);
        this.store = new RunStore(path.join(this.dataDir, "projects", await projectKey(this.project)));
        this.runner = new Runner(this.project, () => this.notify(), this.runnerOptions);
        // A step whose host process died, or whose session this host no longer drives, cannot be followed any more.
        const { runs } = await this.store.read();
        if (runs.some(run => activeStates.has(run.status) && !this.hosted(run))) {
            await this.store.change(journal => {
                for (const run of journal.runs) if (activeStates.has(run.status) && !this.hosted(run)) {
                    run.status = "interrupted"; run.endedAt = new Date().toISOString();
                }
            });
        }
        return this;
    }
    hosted(run) { return alive(run.runtimePid) && (run.runtimePid !== process.pid || this.sessions.has(run.sessionId)); }
    pauseRequested(run) { return ["pausing", "paused"].includes(run?.status) || this.stepControls.get(run?.sessionId)?.kind === "pause"; }
    notify() { for (const listener of this.listeners) listener(); }
    language() { return pick(this.lastKit?.language); }
    async kit() {
        const kit = await this.adapter(this.project, "snapshot");
        this.lastKit = kit;
        return kit;
    }
    async snapshot() {
        let kit = null, error = null;
        try { kit = await this.kit(); } catch (failure) { error = localize(failure, this.language()) ?? failure.message; }
        if (kit) this.watch(kit.valid ? kit.placeholders?.root || "" : "");
        const { runs } = await this.store.read();
        const projected = runs.map(run => {
            let status = run.status;
            if (activeStates.has(status) && !this.hosted(run)) status = "interrupted";
            if (!activeStates.has(status) && !automaticallyCompletedBuild(kit, run) && run.evidence?.length && kit && run.evidence.some(e => !kit.files.some(f => f.path === e.path && f.hash && f.hash === e.hash)))
                status = "unconfirmed";
            return { ...run, status };
        });
        const run = kit?.application || null;
        const hash = runHash(run);
        const app = { services: this.runner.status(), configured: (run?.services || []).map(s => ({ ...s })), open: run?.open || null,
            hash, approved: (await this.approvedRun()) === hash, declared: !!kit?.contract?.modules?.application };
        const active = projected.findLast(item => activeStates.has(item.status)) || null;
        const language = this.language();
        const rules = kit?.contract ? describeRules(kit.contract, kit.contract.steps.find(s => s.id === active?.step))
            .map(rule => ({ ...rule, description: rule.i18n?.[language]?.description ?? rule.description, i18n: undefined })) : [];
        return { project: this.project, language, runtime: this.harness.status(), kit, runs: projected, app, error,
            guards: { rules, runId: active?.id || null }, chats: this.chatList(), lastError: this.lastError };
    }
    async modelCatalog(kit, agents, { refresh = false } = {}) {
        let offered, failure;
        try {
            offered = refresh && this.harness.refreshModels ? await this.harness.refreshModels() : await this.harness.models();
        } catch (error) {
            if (error.key !== "harness.network") throw error;
            failure = error.message;
        }
        let catalog = this.harness.catalogStatus?.() || { source: offered?.length ? "live" : "kit" };
        if (failure) catalog = { source: "kit", error: failure };
        const models = catalog.source === "kit" ? declaredModels(kit, agents) : normalizeModels(offered || []);
        return { models, catalog };
    }
    async chatOptions({ refresh = false } = {}) {
        const kit = await this.kit().catch(() => null);
        const agents = await this.harness.agents(this.project);
        const { models, catalog } = await this.modelCatalog(kit, agents, { refresh });
        const preferred = this.harness.defaultModel?.();
        return { models, defaultModel: models.find(model => model.id === preferred)?.id || models[0]?.id || null,
            agents: agents.filter(agent => agent.userInvocable !== false).map(({ name, description }) => ({ name, description: description || "" })), catalog };
    }
    async prepare(input) {
        const snapshot = await this.snapshot();
        if (!snapshot.kit) throw new Error("bridge.unreadable", { message: snapshot.error });
        const contract = snapshot.kit.contract;
        if (snapshot.runs.some(run => activeStates.has(run.status))) throw new Error("step.busy");
        const step = contract.steps.find(s => s.id === input.step);
        if (!step) throw new Error("step.unknown");
        const unit = step.scope === "unit" ? input.unit : null;
        if (step.scope === "unit" && (!Number.isSafeInteger(unit) || unit < 1)) throw new Error("unit.positive");
        if (step.scope === "unit" && snapshot.kit.unitCatalog && !snapshot.kit.units?.includes(unit)) throw new Error("unit.invalid");
        if (approvedStep(step, snapshot.kit, unit)) throw new Error("step.approved");
        const previous = snapshot.runs.findLast(run => run.step === step.id && run.unit === unit);
        if (automaticallyCompletedBuild(snapshot.kit, previous) && !stepVariant(step, snapshot.kit, unit)) throw new Error("step.approved");
        let candidate;
        if (step.configures) {
            candidate = input.config || snapshot.kit.config;
            const check = await this.adapter(this.project, "validate", { config: candidate });
            if (!check.valid) throw new Error("config.errors", { message: (check.errorItems || []).map(item => t(this.language(), item.code, item)).join("\n") || check.errors.join("\n") });
        } else {
            if (!snapshot.kit.valid) throw new Error("config.invalidBefore");
            const missing = step.requires.map(p => resolvePattern(p, snapshot.kit, unit))
                .filter(p => !snapshot.kit.files.some(f => f.path === p && f.exists));
            if (missing.length) throw new Error("prereq.missing", { list: missing.join(", ") });
            if (step.requiresBuiltUnit && !(snapshot.kit.builtUnits || []).length) throw new Error("prereq.built");
        }
        const variant = step.scope === "unit" ? stepVariant(step, snapshot.kit, unit) : null;
        const agents = await this.harness.agents(this.project);
        const agent = step.agent ? agents.find(a => a.name === step.agent) : null;
        if (step.agent && (!agent || agent.userInvocable === false)) throw new Error("agent.unavailable", { agent: step.agent });
        const catalogOptions = await this.modelCatalog(snapshot.kit, agents);
        const provenance = productionProvenance(snapshot.kit, step, unit, snapshot.runs, resolvePattern);
        const choices = policyModels({ kit: snapshot.kit, step, agent, family: producerFamily(provenance),
            models: catalogOptions.models, harness: this.harness, source: catalogOptions.catalog.source });
        const { models, defaultModel: plannedModel, modelSwitches } = choices;
        if (!plannedModel) throw new Error(catalogOptions.models.length ? "model.unavailable" : "model.none",
            { model: choices.requestedDefault || "" });
        const modelSwitch = modelSwitches.length ? modelSwitches.map(item =>
            t(this.language(), "launch.modelSwitch", { ...item, harness: this.harness.status().harness })).join("\n") : null;
        const target = models.find(model => model.id === plannedModel);
        const longOffered = target.contextTiers.some(tier => tier.id === "long_context");
        const contextTier = step.contextTier === "long_context" && longOffered ? "long_context" : "default";
        const ticket = randomUUID();
        this.confirmations.clear();
        this.confirmations.set(ticket, { step, unit, variant, candidate, plannedModel, contextTier, agent, models, provenance,
            skillPath: snapshot.kit.skills[step.skill], fileState: snapshot.kit.files,
            kitState: JSON.stringify([snapshot.kit.kit, snapshot.kit.contract, snapshot.kit.skillHashes]), expires: Date.now() + 120_000 });
        const language = this.language();
        const source = variant?.text || step;
        const title = variant ? t(language, `variant.${variant.key}`, { title: phaseText(source, "title", language),
            count: variant.loop.open.length, round: variant.loop.round + 1 }) : phaseText(step, "title", language);
        return { ticket, step: title, skill: step.skill, unit, model: plannedModel, contextTier, modelSwitch, modelSwitches,
            models, catalog: catalogOptions.catalog,
            agent: step.agent || t(language, "launch.defaultAgent"), config: candidate,
            summary: phaseText(source, "summary", language) || null, returns: phaseText(source, "returns", language) || null,
            context: step.contextTier === "long_context"
                ? t(language, longOffered ? "launch.longContext" : "launch.longContextUnavailable", { model: plannedModel }) : null,
            notice: t(language, "launch.notice", { harness: harnessLabel(this.harness.status().harness) }) };
    }
    // Files chosen by the user are copied into the project, so that every later session and the team can read them.
    async attach(files, unit) {
        const list = Array.isArray(files) ? files.filter(file => typeof file === "string" && file) : [];
        if (!list.length) return [];
        if (list.length > ATTACHMENT_LIMITS.count) throw new Error("attach.tooMany", { n: ATTACHMENT_LIMITS.count });
        const kit = this.lastKit || await this.kit();
        for (const file of list) {
            const info = await stat(file).catch(() => null);
            if (!info?.isFile()) throw new Error("attach.missing", { name: path.basename(file) });
            if (info.size > ATTACHMENT_LIMITS.bytes) throw new Error("attach.tooLarge", { name: path.basename(file), mb: ATTACHMENT_LIMITS.bytes / 1048576 });
        }
        const folder = Number.isInteger(unit) && kit?.contract?.units
            ? resolvePattern("{unit}/attachments", kit, unit) : path.posix.join(kit?.placeholders?.root || "", "attachments");
        const target = path.join(this.project, folder);
        await mkdir(target, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
        const taken = new Set(await readdir(target).catch(() => []));
        const copied = [];
        for (const file of list) {
            const ext = path.extname(file), base = attachmentName(path.basename(file, ext));
            let name = `${stamp}-${base}${ext.toLowerCase()}`;
            for (let n = 2; taken.has(name); n++) name = `${stamp}-${base}-${n}${ext.toLowerCase()}`;
            taken.add(name);
            await copyFile(file, path.join(target, name));
            copied.push({ path: path.posix.join(folder.replaceAll("\\", "/"), name), name: path.basename(file) });
        }
        return copied;
    }
    async launch(ticket, files = [], selection = {}) {
        const draft = this.confirmations.get(ticket);
        this.confirmations.delete(ticket);
        if (!draft || draft.expires < Date.now()) throw new Error("confirm.expired");
        if (Array.isArray(files) && files.length > ATTACHMENT_LIMITS.count) throw new Error("attach.tooMany", { n: ATTACHMENT_LIMITS.count });
        const kit = await this.kit();
        if (approvedStep(draft.step, kit, draft.unit)) throw new Error("step.approved");
        const previous = (await this.store.read()).runs.findLast(run => run.step === draft.step.id && run.unit === draft.unit);
        if (automaticallyCompletedBuild(kit, previous) && !stepVariant(draft.step, kit, draft.unit)) throw new Error("step.approved");
        if (JSON.stringify(kit.files) !== JSON.stringify(draft.fileState)) throw new Error("launch.filesChanged");
        if (JSON.stringify([kit.kit, kit.contract, kit.skillHashes]) !== draft.kitState) throw new Error("launch.kitChanged");
        const chosen = validateSelection(draft.models, { model: draft.plannedModel, contextTier: draft.contextTier }, selection);
        // A new session per step: a clean context costs less and keeps each step measured on its own.
        const session = await this.harness.openStep({
            project: this.project, agent: draft.agent?.name || null, ...chosen,
            tools: [{ name: REPORT_TOOL, description: "Report the progress of a step launched from Vibe Studio, and the status of the tasks of a unit. Never a human approval.",
                parameters: reportSchema, skipPermission: true, defer: "never",
                handler: async (input, invocation) => {
                    try { return JSON.stringify(await this.report(input, invocation?.sessionId ?? session.sessionId)); }
                    catch (error) { return { resultType: "failure", textResultForLlm: `Report not recorded: ${error.message}` }; }
                } }],
            onEvent: event => { void this.event(session.sessionId, event); this.onSessionEvent(session.sessionId, event); },
            hooks: this.guardHooks(() => session.sessionId), mode: this.sessionMode() || undefined,
        });
        this.sessions.set(session.sessionId, session);
        let run;
        try {
            const applied = await appliedSettings(session, chosen, this.harness.status().harness);
            run = await this.store.begin({ sessionId: session.sessionId, step: draft.step.id, unit: draft.unit,
                ...applied, agent: draft.agent?.name || null,
                inputHashes: Object.fromEntries(draft.fileState.filter(file => file.hash).map(file => [file.path, file.hash])) });
        } catch (error) {
            this.sessions.delete(session.sessionId);
            await session.disconnect().catch(() => {});
            throw error;
        }
        let attachments = [];
        try {
            // Never spend AI credits before the kit has attributed this exact session and run.
            if (kit.contract.modules?.costs && this.harness.status().harness === "copilot") {
                try { await this.adapter(this.project, "mark", { step: draft.step.id, unit: draft.unit, sessionId: session.sessionId, runId: run.id }); }
                catch (failure) { throw new Error("costs.markFailed", { message: localize(failure, this.language()) ?? failure.message }); }
                await this.store.update(run.id, session.sessionId, { costMark: { recorded: true, at: new Date().toISOString() } });
            }
            attachments = await this.attach(files, draft.unit);
        }
        catch (error) {
            await this.store.update(run.id, session.sessionId, { status: "error", endedAt: new Date().toISOString() }).catch(() => {});
            this.sessions.delete(session.sessionId);
            await session.disconnect().catch(() => {});
            throw error;
        }
        let prompt = launchPrompt({ kit, draft, run, sessionId: session.sessionId, projectDir: this.project });
        if (attachments.length) prompt += `\n\nAttachments given by the user for this step, copied into the project (read them before you start):\n${attachments.map(a => `- ${a.path} (${a.name})`).join("\n")}`;
        this.onSessionEvent(session.sessionId, { type: "vibe_studio.launch", data: { runId: run.id, step: draft.step.id, unit: draft.unit, prompt } });
        try {
            const messageId = await session.send(prompt, attachments.map(a => ({ type: "file", path: path.join(this.project, a.path), displayName: a.name })));
            run = await this.store.update(run.id, session.sessionId, { messageId });
        } catch (error) {
            await this.store.update(run.id, session.sessionId, { status: "error", endedAt: new Date().toISOString() });
            this.sessions.delete(session.sessionId);
            await session.disconnect().catch(() => {});
            throw error;
        }
        this.notify();
        return { runId: run.id, sessionId: session.sessionId };
    }
    // A free conversation with the AI, outside the journey: no step, no report, permanent guards only.
    async chat(input = {}) {
        const options = await this.chatOptions();
        const chosen = validateSelection(options.models, { model: options.defaultModel, contextTier: "default" }, input);
        let agent = null;
        if (typeof input.agent === "string" && input.agent) {
            const found = (await this.harness.agents(this.project)).find(item => item.name === input.agent);
            if (!found || found.userInvocable === false) throw new Error("agent.unavailable", { agent: input.agent });
            agent = found.name;
        }
        const session = await this.harness.openStep({ project: this.project, agent, ...chosen, tools: [],
            onEvent: event => { void this.event(session.sessionId, event); this.onSessionEvent(session.sessionId, event); },
            hooks: this.guardHooks(() => session.sessionId), mode: this.sessionMode() || undefined });
        let applied;
        try { applied = await appliedSettings(session, chosen, this.harness.status().harness); }
        catch (error) { await session.disconnect().catch(() => {}); throw error; }
        const chat = { sessionId: session.sessionId, session, ...applied, agent, busy: false, startedAt: new Date().toISOString() };
        this.chats.set(session.sessionId, chat);
        this.onSessionEvent(session.sessionId, { type: "vibe_studio.chat", data: { ...applied, agent } });
        this.notify();
        return { sessionId: session.sessionId };
    }
    async closeChat(sessionId) {
        const chat = this.chats.get(sessionId);
        if (!chat) throw new Error("run.notHosted");
        this.chats.delete(sessionId);
        await chat.session.abort().catch(() => {});
        await chat.session.disconnect().catch(() => {});
        this.onSessionEvent(sessionId, { type: "vibe_studio.chatClosed", data: {} });
        this.notify();
        return { closed: true };
    }
    chatList() {
        return [...this.chats.values()].map(({ session, ...chat }) => chat);
    }
    async sayToChat(sessionId, text, files = []) {
        const chat = this.chats.get(sessionId);
        if (!chat) throw new Error("run.notHosted");
        return this.sendMessage(chat.session, text, files);
    }
    // A message typed by the user in the conversation of a running step.
    async say(runId, text, files = []) {
        const run = (await this.store.read()).runs.find(item => item.id === runId);
        const session = run && this.sessions.get(run.sessionId);
        if (!session) throw new Error("run.notHosted");
        return this.sendMessage(session, text, files, run.unit);
    }
    async sendMessage(session, text, files = [], unit) {
        if (typeof text !== "string" || (!text.trim() && !files.length)) throw new Error("say.empty");
        const attachments = await this.attach(files, unit);
        let prompt = text.trim();
        if (attachments.length) prompt += `\n\nAttachments given by the user (read them):\n${attachments.map(a => `- ${a.path} (${a.name})`).join("\n")}`;
        const chat = this.chats.get(session.sessionId);
        const run = chat ? null : await this.runOf(session.sessionId);
        const previous = chat || run;
        if (this.pauseRequested(run)) throw new Error("run.pauseRequired");
        if (previous) {
            const applied = await appliedSettings(session, { model: previous.requestedModel || previous.model,
                contextTier: previous.requestedContextTier || previous.contextTier || "default",
                reasoningEffort: previous.requestedReasoningEffort || previous.reasoningEffort,
                contextBudget: previous.contextBudget }, this.harness.status().harness);
            if (chat) Object.assign(chat, applied);
            else await this.store.change(data => Object.assign(data.runs.find(item => item.id === run.id), applied));
        }
        const messageId = await session.send(prompt, attachments.map(a => ({ type: "file", path: path.join(this.project, a.path), displayName: a.name })));
        this.onSessionEvent(session.sessionId, { type: "vibe_studio.user", data: { content: text.trim(), attachments } });
        return { messageId };
    }
    async approvedRun() {
        try { return JSON.parse(await readFile(path.join(this.store.directory, "run-approved.json"), "utf8")).hash; } catch { return null; }
    }
    async appStart(input) {
        const kit = await this.kit();
        if (!kit.valid) throw new Error("config.invalidBefore");
        const run = kit.application;
        // The commands shown to the user are the ones started: a change in the configuration needs a new confirmation.
        if (input.hash !== runHash(run)) throw new Error("app.changed");
        await mkdir(this.store.directory, { recursive: true });
        await writeFile(path.join(this.store.directory, "run-approved.json"), JSON.stringify({ hash: input.hash, at: new Date().toISOString() }));
        if (input.restart && this.runner.busy()) {
            this.runner.stopAll();
            for (const service of run?.services || []) {
                for (let i = 0; service.port && i < 20 && await this.runner.probe(service.port); i++) await new Promise(r => setTimeout(r, 500));
            }
        }
        return this.runner.start(run);
    }
    appStop() { return this.runner.stopAll(); }
    appLogs(input) { return this.runner.logs(input.name); }
    async appOpen(input) {
        const kit = await this.kit();
        const run = kit.valid ? kit.application : null;
        // Only an address declared in the configuration opens, and only a local one.
        const known = new Set([run?.open, ...(run?.services || []).map(s => s.url)].filter(Boolean));
        if (typeof input.url !== "string" || !known.has(input.url) || !localUrl.test(input.url)) throw new Error("app.urlUnknown");
        try { await this.opener(input.url); } catch { throw new Error("app.openFailed", { url: input.url }); }
        return { opened: input.url };
    }
    async approve(input) {
        if (typeof input.path !== "string" || !input.path) throw new Error("approve.forbidden");
        const comment = typeof input.comment === "string" ? input.comment.trim() : "";
        if (comment.length > 300) throw new Error("approve.comment");
        const result = await this.adapter(this.project, "approve", { path: input.path, comment });
        this.notify();
        return result;
    }
    async reopen(input) {
        const kit = await this.kit();
        const step = kit.contract.steps.find(step => step.id === input.step);
        if (!step || !approvedStep(step, kit, input.unit)) throw new Error("reopen.notApproved");
        const { runs } = await this.store.read();
        if (runs.some(run => activeStates.has(run.status))) throw new Error("step.busy");
        const result = await this.adapter(this.project, "reopen", { step: step.id, unit: input.unit });
        this.notify();
        return result;
    }
    async originalFile(relative) {
        if (typeof relative !== "string" || !originalFormats.has(path.extname(relative).toLowerCase())) throw new Error("files.formatDenied");
        const kit = await this.kit();
        if (!kit.files.some(file => file.path === relative && file.exists) && !kit.conversions?.includes(relative)
            && !kit.originals?.includes(relative)) throw new Error("preview.forbidden");
        const file = await realpath(path.resolve(this.project, relative));
        const inside = path.relative(this.project, file);
        if (inside.startsWith("..") || path.isAbsolute(inside) || !(await stat(file)).isFile()) throw new Error("preview.forbidden");
        return file;
    }
    async feedback(input) {
        if (!Number.isSafeInteger(input.unit) || input.unit < 1) throw new Error("unit.positive");
        const { runs } = await this.store.read();
        // The agent may be writing the task list: wait for the step on this unit to end.
        if (runs.some(run => run.unit === input.unit && activeStates.has(run.status) && this.hosted(run))) throw new Error("feedback.busy");
        if (typeof input.text !== "string" || !input.text.trim()) throw new Error("feedback.invalid");
        const attachments = await this.attach(input.attachments, input.unit);
        const result = await this.adapter(this.project, "feedback", { unit: input.unit, text: input.text, screen: input.screen || "", priority: input.priority,
            attachments: attachments.map(a => a.path) });
        this.notify();
        return result;
    }
    async correction(input) {
        if (!Number.isSafeInteger(input.unit) || input.unit < 1) throw new Error("unit.positive");
        const { runs } = await this.store.read();
        if (runs.some(run => run.unit === input.unit && activeStates.has(run.status))) throw new Error("feedback.busy");
        if (![...this.chats.values()].every(chat => !chat.busy)) throw new Error("feedback.busy");
        const result = await this.adapter(this.project, "correction", {
            unit: input.unit, id: input.id, action: input.action, text: input.text, revision: input.revision,
            priority: input.priority, screen: input.screen,
        });
        this.notify();
        return result;
    }
    costs() { return this.adapter(this.project, "costs"); }
    preview(input) { return this.adapter(this.project, "preview", { path: input.path }); }
    async pause(runId, cancelRequests = () => {}) {
        const run = (await this.store.read()).runs.find(item => item.id === runId);
        const session = run && this.sessions.get(run.sessionId);
        if (!session) throw new Error("run.notHosted");
        if (this.stepControls.has(run.sessionId)) throw new Error("run.controlBusy");
        if (!["running", "waiting", "pausing"].includes(run.status)) throw new Error("run.notRunning");
        const control = { kind: "pause" };
        this.stepControls.set(run.sessionId, control);
        let timer;
        const idle = new Promise((resolve, reject) => { control.resolve = resolve; control.reject = reject; });
        idle.catch(() => {}); // Abort or journal failure may happen before the idle promise is awaited.
        try {
            await this.store.update(run.id, run.sessionId, { status: "pausing", pauseError: null, pauseRequestedAt: new Date().toISOString() });
            this.notify();
            timer = setTimeout(() => control.reject(new Error("run.pauseTimeout")), 30000);
            await cancelRequests(run.sessionId);
            await Promise.all([session.abort(), idle]);
            return { paused: true, sessionId: run.sessionId };
        } catch (error) {
            await this.store.change(data => {
                const saved = data.runs.find(item => item.id === run.id);
                if (saved?.status === "pausing") saved.pauseError = localize(error, this.language()) ?? String(error.message);
            });
            this.notify();
            throw error;
        } finally {
            clearTimeout(timer);
            if (this.stepControls.get(run.sessionId) === control) this.stepControls.delete(run.sessionId);
        }
    }
    async resume(runId) {
        const run = (await this.store.read()).runs.find(item => item.id === runId);
        const session = run && this.sessions.get(run.sessionId);
        if (!session) throw new Error("run.notHosted");
        if (this.stepControls.has(run.sessionId)) throw new Error("run.controlBusy");
        if (run.status !== "paused") throw new Error("run.notPaused");
        const control = { kind: "resume" };
        this.stepControls.set(run.sessionId, control);
        try {
            await this.store.update(run.id, run.sessionId, { status: "running", resumedAt: new Date().toISOString(), pauseError: null });
            const result = await this.sendMessage(session, t(this.language(), "convo.resumePrompt"), []);
            this.notify();
            return { ...result, sessionId: run.sessionId };
        } catch (error) {
            await this.store.change(data => {
                const saved = data.runs.find(item => item.id === run.id);
                if (saved?.status === "running") saved.status = "paused";
            });
            this.notify();
            throw error;
        } finally {
            if (this.stepControls.get(run.sessionId) === control) this.stepControls.delete(run.sessionId);
        }
    }
    async close(runId) {
        const { runs } = await this.store.read();
        const run = runs.find(item => item.id === runId);
        if (!run) throw new Error("step.unknown");
        const session = this.sessions.get(run.sessionId);
        if (this.stepControls.get(run.sessionId)?.kind === "resume") throw new Error("run.controlBusy");
        await this.store.close(runId);
        this.stepControls.get(run.sessionId)?.reject?.(new Error("run.notActive"));
        if (session) { await session.abort().catch(() => {}); }
        this.notify();
        return { closed: true };
    }
    async report(input, sessionId) {
        if (!["started", "waiting", "produced", "error"].includes(input.status)) throw new Error("report.status", { status: input.status });
        if (input.task && (!/^[TRU][0-9]+[a-z]?$/.test(input.task.id ?? "") || !taskStatuses.has(input.task.status))) throw new Error("report.task");
        await this.queues.get(sessionId);
        const { runs } = await this.store.read();
        const latest = runs.findLast(item => item.sessionId === sessionId);
        if (!latest || latest.id !== input.runId) throw latest ? new Error("report.runId", { runId: latest.id }) : new Error("report.noLaunch");
        if (this.pauseRequested(latest)) throw new Error("run.pauseRequired");
        if (input.task?.status === "in_progress") {
            const rule = this.stepGuard(latest, "singleTaskInProgress");
            if (rule) {
                const others = (await this.tasksOf(latest)).filter(id => id !== input.task.id);
                if (others.length) { await this.blocked(latest, { id: rule.id, tool: REPORT_TOOL, path: others.join(", ") }); throw new Error("guard.refused", { reason: `${rule.reason} (${others.join(", ")})` }); }
            }
        }
        let task;
        if (input.task) {
            task = { id: input.task.id, status: input.task.status, written: false };
            if (!Number.isInteger(latest.unit)) task.reason = t("en", "task.noUnit");
            else {
                // Vibe Studio writes the marker itself, so one report keeps the task list and the screen in step.
                try {
                    const result = await this.adapter(this.project, "task", { unit: latest.unit, id: input.task.id, status: input.task.status });
                    task.written = true; task.changed = result.written; task.file = result.path;
                } catch (error) { task.reason = error.message; }
            }
        }
        const kit = await this.kit();
        const evidence = [], ignored = [];
        for (const p of input.paths || []) {
            const relative = projectRelative(this.project, p);
            const file = kit.files.find(f => f.path === relative && f.hash);
            if (file) {
                const previous = [...runs].reverse().flatMap(run => run.evidence || [])
                    .find(item => item.path === file.path && item.hash === file.hash);
                // Reporting an unchanged input is not proof that the current model authored it.
                const producer = previous?.producer || (latest.inputHashes && latest.inputHashes[file.path] !== file.hash ? producerOf(latest) : null);
                evidence.push({ path: file.path, hash: file.hash, ...(producer ? { producer } : {}) });
            } else ignored.push(p);
        }
        const patch = { reported: input.status };
        if (evidence.length) patch.evidence = [...(latest.evidence || []).filter(old => !evidence.some(item => item.path === old.path)), ...evidence];
        if (input.status === "waiting") patch.status = "waiting";
        else if (!activeStates.has(latest.status) || input.status === "started") patch.status = "running";
        if (input.task) patch.task = { id: input.task.id, status: input.task.status, at: new Date().toISOString() };
        const reopened = !activeStates.has(latest.status);
        await this.store.update(latest.id, sessionId, patch, { reopen: true });
        this.notify();
        const notes = [];
        if (ignored.length) notes.push("Ignored paths: only deliverable files known to Vibe Studio count as evidence.");
        if (task?.written) notes.push(`Marker of ${task.id} set in ${task.file}: do not edit it yourself.`);
        else if (task) notes.push(`Marker of ${task.id} not written (${task.reason}). Set it yourself in the task list.`);
        return { recorded: true, reopened, evidence: evidence.map(e => e.path), ignored, task,
            note: notes.length ? notes.join(" ") : undefined, validation: "Human decisions stay in the deliverables and with the user." };
    }
    // Events of the session of a step: waiting for the user, back to work, end of the step.
    event(sessionId, event) {
        if (["assistant.usage", "vibe_studio.usage", "session.usage_info"].includes(event.type)) {
            const key = event.id || event.data?.apiCallId;
            if (key) {
                if (!this.metricEvents.has(sessionId)) this.metricEvents.set(sessionId, new Set());
                if (this.metricEvents.get(sessionId).has(key)) return Promise.resolve();
                this.metricEvents.get(sessionId).add(key);
            }
        }
        const chat = this.chats.get(sessionId);
        if (chat) {
            Object.assign(chat, reportedSettings(event, this.harness.status().harness));
            chat.metrics = updateMetrics(chat.metrics, event);
            const busy = ["session.idle", "session.error"].includes(event.type) ? false
                : ["assistant.turn_start", "user.message"].includes(event.type) ? true : chat.busy;
            if (busy !== chat.busy) { chat.busy = busy; this.notify(); }
            return Promise.resolve();
        }
        const queue = (this.queues.get(sessionId) || Promise.resolve()).then(async () => {
            const run = (await this.store.read()).runs.findLast(item => item.sessionId === sessionId);
            const settings = reportedSettings(event, this.harness.status().harness);
            if (run && Object.keys(settings).length) {
                await this.store.change(data => Object.assign(data.runs.find(item => item.id === run.id), settings));
            }
            if (run && ["assistant.usage", "vibe_studio.usage", "session.usage_info"].includes(event.type)) {
                await this.store.change(data => {
                    const saved = data.runs.find(item => item.id === run.id);
                    saved.metrics = updateMetrics(saved.metrics, event);
                });
            }
            if (!run || !activeStates.has(run.status)) { this.notify(); return; }
            if (this.pauseRequested(run)) {
                const nested = !!event.agentId || !!event.data?.parentToolCallId;
                if (!nested && event.type === "session.error") {
                    await this.store.update(run.id, sessionId, { status: "interrupted", endedAt: new Date().toISOString() });
                    this.stepControls.get(sessionId)?.reject?.(new Error("run.pauseFailed", { message: event.data?.message || "" }));
                } else if (!nested && event.type === "session.idle" && run.status !== "paused") {
                    await this.store.update(run.id, sessionId, { status: "paused", pausedAt: new Date().toISOString(), pauseError: null });
                    this.onSessionEvent(sessionId, { type: "vibe_studio.paused", data: {} });
                    this.stepControls.get(sessionId)?.resolve?.();
                }
                this.notify();
                return;
            }
            if (["permission.requested", "user_input.requested", "elicitation.requested", "exit_plan_mode.requested"].includes(event.type)) {
                await this.store.update(run.id, sessionId, { status: "waiting" });
            } else if ((event.type === "assistant.turn_start" || event.type.endsWith(".completed")) && run.status === "waiting") {
                await this.store.update(run.id, sessionId, { status: "running" });
            } else if (event.type === "session.idle" || event.type === "session.error") {
                let status = event.type === "session.error" || event.data?.aborted ? "interrupted"
                    : run.reported === "error" ? "error"
                    : run.reported === "produced" && run.evidence.length ? "produced" : "unconfirmed";
                const endedAt = new Date().toISOString();
                let completion;
                if (status === "produced" && automaticBuildStep(this.lastKit, run.step)) {
                    const failed = await this.endChecks(run);
                    if (failed.length) status = "unconfirmed";
                    else if (automaticallyCompletedBuild(this.lastKit, { ...run, status, endGate: null })) completion = { automatic: true, at: endedAt };
                    await this.store.update(run.id, sessionId, { endGate: { ...run.endGate, failed: failed.map(check => check.id), alert: failed.length > 0 } });
                }
                await this.store.update(run.id, sessionId, { status, endedAt, ...(completion ? { completion } : {}) });
            }
            this.notify();
        }).catch(error => {
            this.lastError = localize(error, this.language()) ?? error.message;
            this.notify();
        });
        this.queues.set(sessionId, queue);
        return queue;
    }
    // ----- Guards: rules of the kit contract imposed on the tools of the AI in the sessions of Vibe Studio.
    async runOf(sessionId) { return (await this.store.read()).runs.findLast(item => item.sessionId === sessionId) || null; }
    stepOf(run) { return this.lastKit?.contract?.steps.find(s => s.id === run?.step) || null; }
    stepGuard(run, kind) {
        const entry = this.stepOf(run)?.guards?.[kind];
        return entry?.id && !(run.suspended || []).includes(entry.id) ? entry : null;
    }
    async tasksOf(run) {
        const file = this.lastKit?.contract?.modules?.tasks?.file;
        if (!file || !Number.isInteger(run?.unit)) return [];
        try { return tasksInProgress(await readFile(path.join(this.project, resolvePattern(file, this.lastKit, run.unit)), "utf8")); } catch { return []; }
    }
    takeForcedAsk(sessionId) {
        const count = this.forcedAsks.get(sessionId) || 0;
        if (!count) return false;
        if (count === 1) this.forcedAsks.delete(sessionId); else this.forcedAsks.set(sessionId, count - 1);
        return true;
    }
    chatRun(sessionId) {
        const chat = this.chats.get(sessionId);
        return chat ? { id: null, chat: true, sessionId, step: null, unit: null, status: "running", suspended: [] } : null;
    }
    async blocked(run, block) {
        const entry = { at: new Date().toISOString(), ...block };
        if (run.chat) { this.onSessionEvent(run.sessionId, { type: "vibe_studio.guard", data: entry }); return; }
        try { await this.store.update(run.id, run.sessionId, { blocks: [...(run.blocks || []), entry].slice(-100) }, { reopen: true }); } catch { /* The journal keeps going. */ }
        this.onSessionEvent(run.sessionId, { type: "vibe_studio.guard", data: entry });
        this.notify();
    }
    guardHooks(sessionIdOf) {
        return {
            onPreToolUse: async input => {
                const kit = this.lastKit, run = (await this.runOf(sessionIdOf())) || this.chatRun(sessionIdOf());
                if (this.pauseRequested(run)) return { permissionDecision: "deny", permissionDecisionReason: t(this.language(), "run.pauseRequired") };
                if (!kit?.contract || !run) return undefined;
                const step = this.stepOf(run), resolve = pattern => resolvePattern(pattern, kit, run.unit);
                const suspended = new Set(run.suspended || []);
                const rules = prepareRules(kit.contract, step, resolve);
                const own = new Set([step?.skill, ...(step?.guards?.skills?.skills || [])]);
                const forbidden = new Set(kit.contract.steps.map(s => s.skill).filter(skill => !own.has(skill)));
                const needsTasks = rules.some(rule => rule.kind === "requireTaskInProgress" && !suspended.has(rule.id)) && writesOf(input.toolName, input.toolArgs).files.length;
                const tasks = needsTasks ? { inProgress: await this.tasksOf(run) } : null;
                const allowedSkills = { has: skill => !forbidden.has(skill) };
                const verdict = decide(input, { project: this.project, rules, suspended, tasks, allowedSkills });
                if (verdict) {
                    // A confirmation imposed by a guard is asked to the user even in autopilot.
                    if (verdict.decision === "ask") this.forcedAsks.set(run.sessionId, (this.forcedAsks.get(run.sessionId) || 0) + 1);
                    await this.blocked(run, { id: verdict.id, tool: input.toolName, path: verdict.path || null, decision: verdict.decision });
                    return { permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason };
                }
                await this.keepHistory(input, kit, run, suspended);
                return undefined; // never "allow": the permissions of the user stay in force
            },
            onAgentStop: async input => {
                const run = await this.runOf(sessionIdOf());
                if (!run || !activeStates.has(run.status) || this.pauseRequested(run)) return undefined; // Pausing must not trigger another turn through end checks.
                const failed = await this.endChecks(run);
                if (!failed.length) return undefined;
                const count = run.endGate?.count || 0;
                if (count >= 2) {
                    await this.store.update(run.id, run.sessionId, { endGate: { count, failed: failed.map(f => f.id), alert: true } }, { reopen: true }).catch(() => {});
                    this.onSessionEvent(run.sessionId, { type: "vibe_studio.endGate", data: { failed: failed.map(f => f.id), alert: true } });
                    this.notify();
                    return undefined;
                }
                await this.store.update(run.id, run.sessionId, { endGate: { count: count + 1, failed: failed.map(f => f.id) } }, { reopen: true }).catch(() => {});
                this.onSessionEvent(run.sessionId, { type: "vibe_studio.endGate", data: { failed: failed.map(f => f.id), alert: false } });
                return { decision: "block", reason: ["Vibe Studio checked the end of the step and something is missing:", ...failed.map(f => `- ${f.id}: ${f.reason}`)].join("\n") };
            },
        };
    }
    async endChecks(run) {
        const kit = await this.kit().catch(() => this.lastKit);
        const step = kit?.contract?.steps.find(s => s.id === run.step);
        const failed = [];
        const fresh = (await this.runOf(run.sessionId)) || run;
        for (const check of step?.guards?.end || []) {
            if ((fresh.suspended || []).includes(check.id)) continue;
            const file = check.path ? path.join(this.project, resolvePattern(check.path, kit, run.unit)) : null;
            const content = file ? await readFile(file, "utf8").catch(() => null) : null;
            let ok = true;
            if (check.check === "reported") ok = ["produced", "error"].includes(fresh.reported);
            else if (check.check === "noTaskInProgress") ok = content === null || tasksInProgress(content).length === 0;
            else if (check.check === "modified") ok = !!file && await stat(file).then(s => s.mtimeMs >= Date.parse(run.startedAt) - 1000).catch(() => false);
            else if (check.check === "planStatus") ok = content !== null && /^(?:Plan status|Statut du plan)\s*:/im.test(content);
            else if (check.check === "reviewDecided") ok = content !== null && /^Review round:/im.test(content) && reviewDecided(content);
            if (!ok) failed.push(check);
        }
        return failed;
    }
    // A deliverable rewritten in full is copied to the history folder first (rule on working files).
    async keepHistory(input, kit, run, suspended) {
        const rule = historyRule(kit.contract, pattern => resolvePattern(pattern, kit, run.unit));
        if (!rule || suspended.has(rule.id)) return;
        const { files, created } = writesOf(input.toolName, input.toolArgs);
        if (!created) return;
        for (const file of files) {
            const relative = relativeTo(this.project, file);
            if (!relative || !rule.regexps.some(r => r.test(relative)) || rule.except.some(r => r.test(relative))) continue;
            const source = path.join(this.project, relative);
            if (!(await stat(source).then(s => s.isFile()).catch(() => false))) continue;
            const folder = path.join(this.project, rule.folder);
            await mkdir(folder, { recursive: true });
            const ext = path.extname(relative), name = path.basename(relative, ext);
            const taken = new Set(await readdir(folder).catch(() => []));
            let n = 1; while (taken.has(`${name}-v${n}${ext}`)) n++;
            await copyFile(source, path.join(folder, `${name}-v${n}${ext}`));
            this.onSessionEvent(run.sessionId, { type: "vibe_studio.history", data: { path: relative, copy: `${rule.folder}/${name}-v${n}${ext}` } });
        }
    }
    // Suspends or restores a guard until the end of the step; each change is traced in the journal.
    async suspend(runId, id, suspended) {
        const run = (await this.store.read()).runs.find(item => item.id === runId);
        if (!run || !activeStates.has(run.status)) throw new Error("run.notActive");
        const known = describeRules(this.lastKit?.contract || {}, this.stepOf(run)).some(rule => rule.id === id);
        if (!known) throw new Error("guard.unknown");
        const list = new Set(run.suspended || []);
        if (suspended) list.add(id); else list.delete(id);
        await this.store.update(run.id, run.sessionId, { suspended: [...list],
            suspensions: [...(run.suspensions || []), { id, suspended: !!suspended, at: new Date().toISOString() }] });
        this.notify();
        return { suspended: [...list] };
    }
    watch(root) {
        if (this.watcher) return;
        let timer;
        try {
            this.watcher = fsWatch(path.join(this.project, root), { recursive: true }, () => {
                clearTimeout(timer);
                timer = setTimeout(() => this.notify(), 500);
            });
            this.watcher.on("error", () => this.unwatch());
        } catch { this.watcher = null; }
    }
    unwatch() { this.watcher?.close(); this.watcher = null; }
    async dispose() {
        for (const control of this.stepControls.values()) control.reject?.(new Error("run.notHosted"));
        this.unwatch();
        this.runner.stopAll();
        for (const session of this.sessions.values()) await session.disconnect().catch(() => {});
        this.sessions.clear();
        for (const chat of this.chats.values()) await chat.session.disconnect().catch(() => {});
        this.chats.clear();
    }
}
