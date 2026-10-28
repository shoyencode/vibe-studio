import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as kits from "../core/kit-workshop.mjs";
import { KitCatalog } from "./kit-catalog.mjs";
import { submitKit } from "./kit-submission.mjs";
import { KitDrafting } from "./kit-drafting.mjs";
import { ReviewQueue } from "./kit-review.mjs";
import { replaceFile } from "../core/store.mjs";
import { newerVersion } from "./updates.mjs";
import { AUTHORING_FILE, LANGUAGES, applyProposal, authoringOf, guidedSteps, proposalTarget, rulesOf, slugify, translationStatus } from "../core/kit-authoring.mjs";

const EDITABLE = {
    "step.add": ["title", "description", "result", "repeat", "approval", "uses", "produces", "instructions"],
    "step.update": ["title", "description", "result", "repeat", "approval", "uses", "produces", "instructions"],
    kit: ["name", "description", "about"], units: ["label", "plural"], translation: ["text"],
};
const LANGUAGE_NAMES = { fr: "French", en: "English", de: "German", es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch" };

export class KitWorkbench {
    constructor({ directory, repository, version, fetch, dialog, window, harness, harnessName = () => "", project, openProject, onEvent, onChange,
        cancelRequests, translate, translateIn = (language, key) => key, documents, pick = files => files, reveal = async () => {} }) {
        Object.assign(this, { directory, repository, version, dialog, window, harness, harnessName, project, openProject, onChange, translateIn, documents, pick, reveal });
        this.t = translate;
        this.catalog = new KitCatalog({ repository, directory: path.join(directory, "kit-catalog"), version, fetch });
        this.drafting = new KitDrafting({ harness, onEvent, onChange, cancelRequests });
        this.review = new ReviewQueue(path.join(directory, "kit-reviews"));
        this.current = null; this.locked = false; this.updateState = null; this.lastCheck = 0; this.validation = null;
        this.recentsFile = path.join(directory, "kit-workshop.json");
        this.aiFile = path.join(directory, "kit-ai.json");
        this.aiSelection = null;
    }
    async recent() {
        try { return JSON.parse(await readFile(this.recentsFile, "utf8")); }
        catch (error) { if (error.code === "ENOENT") return []; throw error; }
    }
    async remember(model) {
        if (this.drafting.status() && this.drafting.status().directory !== model.directory) await this.drafting.close();
        this.current = model;
        this.validation = await kits.validateKit(model.directory)
            .catch(error => ({ valid: false, errors: [{ path: "/", message: error.message }] }));
        const recent = (await this.recent()).filter(item => item.dir.toLowerCase() !== model.directory.toLowerCase());
        recent.unshift({ dir: model.directory, title: model.contract.kit.name });
        await mkdir(this.directory, { recursive: true });
        await writeFile(`${this.recentsFile}.tmp`, JSON.stringify(recent.slice(0, 12), null, 2));
        await replaceFile(`${this.recentsFile}.tmp`, this.recentsFile);
        this.onChange(); return model;
    }
    requireKit() {
        if (!this.current) throw new Error("Open or create a kit first.");
        return this.current;
    }
    async idle() {
        const project = this.project();
        const runs = project ? (await project.store.read()).runs : [];
        return !this.drafting.status()?.busy && (!project || (!runs.some(run => ["running", "waiting", "pausing", "paused"].includes(run.status) && project.sessions.has(run.sessionId)) && ![...project.chats.values()].some(chat => chat.busy)
            && !project.runner.busy() && !project.runner.status().some(service => ["waiting", "starting", "running", "stopping"].includes(service.status))));
    }
    async exclusive(action) {
        if (this.locked) throw new Error("Finish the current kit operation first.");
        this.locked = true;
        try { return await action(); }
        finally { this.locked = false; }
    }
    async chooseDirectory(key) {
        const result = await this.dialog.showOpenDialog(this.window(), { title: this.t(key), properties: ["openDirectory", "createDirectory"] });
        return result.canceled ? null : result.filePaths[0];
    }
    async confirm(titleKey, detailKey) {
        const title = this.t(titleKey);
        const result = await this.dialog.showMessageBox(this.window(), { type: "warning", title, message: title, detail: this.t(detailKey),
            buttons: [this.t("launch.cancel"), this.t(titleKey)], defaultId: 0, cancelId: 0, noLink: true });
        return result.response === 1;
    }
    async temporary(action) {
        await mkdir(path.join(this.directory, "kit-staging"), { recursive: true });
        const temporary = await mkdtemp(path.join(this.directory, "kit-staging", "package-"));
        try { return await action(temporary); }
        finally { await rm(temporary, { recursive: true, force: true }); }
    }
    async install(source, projectDir, options = {}) {
        if (!await this.idle()) throw new Error("Stop active AI sessions and project services before installing or updating a kit.");
        const result = await kits.installKit(source, projectDir, { ...options, backupDir: path.join(this.directory, "kit-backups") });
        if (this.project()?.project === projectDir) await this.openProject(projectDir);
        return result;
    }
    async officialInstall(id) {
        if (!await this.idle()) throw new Error("Stop active work before installing a kit.");
        const catalog = await this.catalog.list({ refresh: true });
        const entry = catalog.kits.find(kit => kit.id === id);
        if (!entry) throw new Error("This official kit is not in the current catalog.");
        if (entry.protocolVersion !== 2 || newerVersion(entry.minVibeStudio, this.version))
            throw new Error("This kit requires a newer compatible version of Vibe Studio.");
        if (!await this.confirm("author.install", "author.trust")) return null;
        const target = await this.chooseDirectory("author.chooseProject");
        if (!target) return null;
        const archive = await this.catalog.download(entry);
        await this.temporary(async directory => {
            const model = await kits.importKit(archive, path.join(directory, "kit"));
            this.verifyEntry(model, entry);
            await this.install(path.join(directory, "kit"), target, { source: { type: "catalog", repository: this.repository, id: entry.id, sha256: entry.sha256 } });
        });
        return this.openProject(target);
    }
    verifyEntry(model, entry) {
        if (model.contract.kit.id !== entry.id || model.metadata.version !== entry.version)
            throw new Error("The downloaded kit identity or version does not match its catalog entry.");
    }
    async installed() {
        const project = this.project();
        if (!project) return null;
        try { return JSON.parse(await readFile(path.join(project.project, ".agents", "vibe-studio-kit.json"), "utf8")); }
        catch (error) { if (error.code === "ENOENT") return null; throw error; }
    }
    async checkUpdates(force = false) {
        if (this.locked) return this.updateState;
        const projectDir = this.project()?.project;
        if (!projectDir) return null;
        if (!force && Date.now() - this.lastCheck < 86400000) return this.updateState;
        this.lastCheck = Date.now();
        try {
            const manifest = await this.installed();
            if (manifest?.source?.type !== "catalog" || manifest.source.repository !== this.repository) {
                this.updateState = null; return null;
            }
            const update = await this.catalog.updateFor(manifest);
            if (this.project()?.project !== projectDir) return null;
            this.updateState = update ? { ...update, version: update.entry.version, project: projectDir } : null;
            await this.applyPendingPatch();
        } catch (error) { this.updateState = { error: error.message, project: projectDir }; }
        this.onChange(); return this.updateState;
    }
    async applyPendingPatch() {
        if (!this.updateState?.automatic || this.updateState.applied || this.updateState.error || !await this.idle() || this.locked) return;
        try { await this.applyUpdate(false); }
        catch (error) {
            this.updateState = { ...this.updateState, automatic: false, error: error.message };
            this.onChange();
        }
    }
    async applyUpdate(allowModified) {
        const state = this.updateState;
        if (!state?.entry || state.project !== this.project()?.project) throw new Error("Check for a kit update first.");
        return this.exclusive(async () => {
            if (!await this.idle()) throw new Error("Stop active work before updating a kit.");
            const current = await this.installed();
            const update = await this.catalog.updateFor(current);
            if (!update || update.entry.version !== state.version) throw new Error("The kit update changed. Check again before installing.");
            const archive = await this.catalog.download(update.entry);
            await this.temporary(async directory => {
                const source = path.join(directory, "kit");
                const model = await kits.importKit(archive, source);
                this.verifyEntry(model, update.entry);
                await this.install(source, state.project, { allowModified, source: { type: "catalog", repository: this.repository, id: update.entry.id, sha256: update.entry.sha256 } });
            });
            this.updateState = { ...state, applied: true };
            const journal = path.join(this.directory, "kit-updates.json");
            let entries = [];
            try { entries = JSON.parse(await readFile(journal, "utf8")); }
            catch (error) { if (error.code !== "ENOENT") throw error; }
            entries.push({ at: new Date().toISOString(), project: state.project, id: state.entry.id, version: state.version, automatic: !allowModified });
            await writeFile(`${journal}.tmp`, JSON.stringify(entries, null, 2));
            await replaceFile(`${journal}.tmp`, journal);
            this.onChange(); return this.updateState;
        });
    }
    async authoringStatus() {
        const draft = this.drafting.status();
        const items = draft ? this.items(draft.sessionId) : [];
        const review = this.current ? this.review.view(await this.review.read(this.current.directory)) : null;
        return {
            current: this.current, recent: await this.recent(), validation: this.validation, review,
            draft: draft && draft.directory === this.current?.directory ? {
                status: draft.status, busy: draft.busy, tasks: draft.tasks || [], error: draft.error || draft.pauseError || null,
                model: draft.model, sessionId: draft.sessionId,
                requests: items.filter(item => item.kind === "request" && !item.answer),
                message: items.findLast(item => item.kind === "assistant")?.text || "",
            } : null,
            ai: { harness: this.harnessName(), selection: await this.aiChoice() },
            location: path.join(this.documents || this.directory, "Vibe Studio", "Kits"), catalog: !!this.repository,
        };
    }
    async aiChoice() {
        if (this.aiSelection) return this.aiSelection;
        try { this.aiSelection = JSON.parse(await readFile(this.aiFile, "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; this.aiSelection = {}; }
        return this.aiSelection;
    }
    async selectAi(input) {
        const options = await this.drafting.options();
        const selection = { model: input.model, contextTier: input.contextTier || "default", ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}) };
        if (!options.models.some(model => model.id === selection.model)) throw new Error("This model is not available for the connected harness.");
        await mkdir(this.directory, { recursive: true });
        await writeFile(`${this.aiFile}.tmp`, JSON.stringify(selection, null, 2));
        await replaceFile(`${this.aiFile}.tmp`, this.aiFile);
        this.aiSelection = selection;
        if (this.drafting.status() && !this.drafting.status().busy) await this.drafting.close();
        this.onChange();
        return selection;
    }
    async uniqueDirectory(base) {
        for (let n = 1; n < 100; n++) {
            const candidate = n === 1 ? base : `${base}-${n}`;
            try { await stat(candidate); } catch (error) { if (error.code === "ENOENT") return candidate; throw error; }
        }
        throw new Error("Choose another kit name.");
    }
    // Creates a kit from a mission: identifiers, folders and configuration are generated; the AI then drafts the journey.
    async create({ name, mission, language, location, attachments = [], withAI = true }) {
        if (typeof name !== "string" || !name.trim() || name.length > 120) throw new Error("Enter a kit name.");
        if (withAI && (typeof mission !== "string" || !mission.trim() || mission.length > 8000)) throw new Error("Describe the mission.");
        const source = LANGUAGES.includes(language) ? language : "en";
        const id = slugify(name, "kit");
        const parent = typeof location === "string" && location ? location : path.join(this.documents || this.directory, "Vibe Studio", "Kits");
        const directory = await this.uniqueDirectory(path.join(parent, id));
        if (this.drafting.status()) await this.drafting.close();
        let model = await kits.createKit(directory, { id, name: name.trim(), template: "blank" });
        model.files = { ...model.files, [AUTHORING_FILE]: JSON.stringify({ version: 1, sourceLanguage: source,
            languages: [source, source === "en" ? "fr" : "en"], mission: (mission || "").trim(), translations: {} }) };
        const say = key => this.translateIn(source, key);
        const excerpt = (mission || "").trim().split(/(?<=[.!?])\s/)[0].slice(0, 300) || name.trim();
        const changes = {};
        for (const proposal of [
            { kind: "kit", description: excerpt, ...(mission?.trim() ? { mission: mission.trim() } : {}) },
            { kind: "step.update", step: model.contract.steps[0].id, title: say("ws.configureTitle"), description: say("ws.configureSummary"),
                result: say("ws.configureResult"), instructions: say("ws.configureInstructions") },
        ]) {
            model = applyProposal(model, proposal);
            Object.assign(changes, model.changes);
        }
        changes[AUTHORING_FILE] = model.files[AUTHORING_FILE];
        const saved = await kits.saveKit(directory, { metadata: model.metadata, contract: model.contract }, changes);
        await this.remember(saved);
        if (withAI) await this.aiRequest("draft", { attachments });
        return this.current;
    }
    async applyChange(proposal) {
        const kit = this.requireKit();
        const fresh = await kits.readKit(kit.directory);
        const next = applyProposal(fresh, proposal);
        const check = await kits.validateModel(kit.directory, next);
        if (!check.valid) throw Object.assign(new Error(check.errors.map(error => `${error.path}: ${error.message}`).join("\n")),
            { key: "authoring.invalid", vars: {}, errors: check.errors });
        return this.remember(await kits.saveKit(kit.directory, { metadata: next.metadata, contract: next.contract }, next.changes));
    }
    // Tool handler: proposals are checked against the kit and the pending ones before the author sees them.
    async receiveProposals(directory, input) {
        if (!this.current || this.current.directory !== directory) throw new Error("The kit was closed. Stop.");
        const list = input?.proposals;
        if (!Array.isArray(list) || !list.length || list.length > 30) throw new Error("Submit between 1 and 30 proposals.");
        let model = await kits.readKit(directory);
        for (const item of this.review.pending(await this.review.read(directory))) {
            try { model = applyProposal(model, item.proposal); } catch { /* A conflicting pending proposal is reported at acceptance. */ }
        }
        const queued = [], errors = [];
        for (const [index, raw] of list.entries()) {
            try {
                if (!raw || typeof raw !== "object") throw new Error("A proposal must be an object.");
                const { summary, ...proposal } = raw;
                if (typeof summary !== "string" || !summary.trim()) throw new Error("summary is required.");
                const target = proposalTarget(model, proposal);
                const next = applyProposal(model, proposal);
                const check = await kits.validateModel(directory, next);
                if (!check.valid) throw new Error(check.errors.slice(0, 5).map(error => `${error.path}: ${error.message}`).join("; "));
                model = next;
                queued.push({ proposal, title: summary.trim().slice(0, 300), target: String(target || "").slice(0, 200) });
            } catch (error) { errors.push(`Proposal ${index + 1}: ${error.message}`); }
        }
        if (queued.length) await this.review.add(directory, queued);
        this.onChange();
        return [`${queued.length} proposal(s) queued for the author's review.`, ...(errors.length ? ["Not queued, fix and resubmit:", ...errors] : [])].join("\n");
    }
    async reviewItem(id) {
        const kit = this.requireKit();
        const item = (await this.review.read(kit.directory)).items.find(entry => entry.id === id);
        if (!item || item.status !== "pending") throw new Error("This proposal was already decided.");
        return item;
    }
    async accept(id, edited) {
        const kit = this.requireKit(), item = await this.reviewItem(id);
        let proposal = item.proposal;
        if (edited && typeof edited === "object") {
            proposal = { ...proposal };
            for (const key of EDITABLE[item.kind] || []) if (edited[key] !== undefined) proposal[key] = edited[key];
        }
        try { await this.applyChange(proposal); }
        catch (error) { await this.review.fail(kit.directory, id, error.message); this.onChange(); throw error; }
        await this.review.decide(kit.directory, id, "accepted", proposal === item.proposal ? {} : { proposal });
        this.onChange();
        return { accepted: true };
    }
    async reject(id) {
        const kit = this.requireKit();
        await this.reviewItem(id);
        await this.review.decide(kit.directory, id, "rejected");
        this.onChange();
        return { rejected: true };
    }
    async acceptAll() {
        const kit = this.requireKit();
        let accepted = 0;
        for (const item of this.review.pending(await this.review.read(kit.directory))) {
            await this.accept(item.id);
            accepted++;
        }
        return { accepted };
    }
    async ensureDrafting() {
        const kit = this.requireKit(), status = this.drafting.status();
        if (status?.directory === kit.directory) return;
        if (status) await this.drafting.close();
        const authoring = authoringOf(kit);
        await this.drafting.start(kit.directory, await this.aiChoice(), { language: authoring.sourceLanguage,
            onPropose: input => this.receiveProposals(kit.directory, input) });
    }
    kitContext() {
        const kit = this.requireKit(), authoring = authoringOf(kit);
        return JSON.stringify({
            name: kit.contract.kit.name, description: kit.contract.kit.description || "", language: authoring.sourceLanguage,
            repeatedElement: kit.contract.units ? { label: kit.contract.units.label, plural: kit.contract.units.plural } : null,
            steps: guidedSteps(kit).map(step => ({ id: step.id, title: step.title, description: step.summary, result: step.returns,
                configures: step.configures, repeat: step.repeat, approval: step.approval, uses: step.uses.map(item => item.name),
                produces: step.produces.map(item => item.name), instructions: step.instructions.slice(0, 1500) })),
            rules: rulesOf(kit.contract).map(rule => ({ id: rule.entry.id, kind: rule.kind, description: rule.entry.description || "", step: rule.step })),
        }, null, 1);
    }
    // One request to the drafting AI. Each request opens a review round; alternatives stay in the current round.
    async aiRequest(purpose, input = {}) {
        const kit = this.requireKit(), authoring = authoringOf(kit);
        const source = LANGUAGE_NAMES[authoring.sourceLanguage];
        let request;
        if (purpose === "draft") {
            request = `Mission described by the author:\n${authoring.mission || kit.contract.kit.description}\n\nPropose a complete kit for this mission: a clear kit description, the journey steps after the configuration step with their documents, repetition, approvals and full instructions, the name of the repeated element when a step repeats, and useful safety rules. Start with ${"vibe_studio_progress"}.`;
        } else if (purpose === "improve") {
            const step = kit.contract.steps.find(item => item.id === input.step);
            if (!step) throw new Error("Unknown step.");
            request = `Improve the step "${step.title}" (id ${step.id}). Author request: ${String(input.text || "make it clearer and more complete, especially its instructions").slice(0, 4000)}\nPropose step.update changes for this step, and other changes only when they are required.`;
        } else if (purpose === "translate") {
            const language = input.language;
            if (!LANGUAGES.includes(language) || language === authoring.sourceLanguage) throw new Error("Choose a translation language.");
            const texts = translationStatus(kit, language).filter(item => item.status !== "validated").map(item => ({ key: item.key, text: item.source }));
            if (!texts.length) throw new Error("Every text is already translated.");
            request = `Translate these kit texts from ${source} into ${LANGUAGE_NAMES[language]}. Submit one proposal of kind "translation" per text, with language "${language}", the given key and the translated text. Keep the meaning and tone; keep document names unchanged. Do not change anything else.\n${JSON.stringify(texts, null, 1)}`;
        } else if (purpose === "fix") {
            const issues = (this.validation?.errors || []).slice(0, 30);
            if (!issues.length) throw new Error("The kit has no problem to fix.");
            request = `The kit has these validation problems:\n${issues.map(issue => `- ${issue.path}: ${issue.message}`).join("\n")}\nPropose the smallest changes that fix them. Use contract.patch only when no business-level proposal can fix the problem.`;
        } else if (purpose === "alternative") {
            const item = (await this.review.read(kit.directory)).items.find(entry => entry.id === input.id);
            if (!item) throw new Error("Unknown proposal.");
            request = `The author rejected this proposal: ${item.title}\n${JSON.stringify(item.proposal)}\nPropose a different alternative for the same need.`;
        } else throw new Error("Unknown AI request.");
        await this.ensureDrafting();
        if (purpose !== "alternative") await this.review.startRound(kit.directory, purpose);
        const attachments = purpose === "draft" ? this.pick(input.attachments || []) : [];
        await this.drafting.say(`Current kit:\n${this.kitContext()}\n\n${request}`, attachments);
        this.onChange();
        return { started: true };
    }
    routes() {
        return {
            "/kits/workshop/status": () => this.authoringStatus(),
            "/kits/workshop/create": input => this.exclusive(() => this.create(input)),
            "/kits/workshop/location": async () => {
                const result = await this.dialog.showOpenDialog(this.window(), { title: this.t("ws.location"), properties: ["openDirectory", "createDirectory"] });
                return result.canceled ? null : result.filePaths[0];
            },
            "/kits/workshop/apply": input => this.exclusive(() => this.applyChange(input.proposal)),
            "/kits/workshop/close": async () => { await this.drafting.close(); this.current = null; this.validation = null; this.onChange(); return { closed: true }; },
            "/kits/workshop/reveal": () => this.reveal(this.requireKit().directory),
            "/kits/review/accept": input => this.exclusive(() => this.accept(input.id, input.edited)),
            "/kits/review/reject": input => this.exclusive(() => this.reject(input.id)),
            "/kits/review/accept-all": () => this.exclusive(() => this.acceptAll()),
            "/kits/review/alternative": input => this.exclusive(async () => { await this.reject(input.id); return this.aiRequest("alternative", { id: input.id }); }),
            "/kits/review/summary": async () => { await this.review.dismissSummary(this.requireKit().directory); this.onChange(); return { dismissed: true }; },
            "/kits/ai/request": input => this.aiRequest(input.purpose, input),
            "/kits/ai/options": input => this.drafting.options(!!input.refresh),
            "/kits/ai/select": input => this.selectAi(input),
            ...this.baseRoutes(),
        };
    }
    baseRoutes() {
        return {
            "/kits/schema": () => readFile(new URL("../core/schema/vibe-studio.schema.json", import.meta.url), "utf8").then(JSON.parse),
            "/kits/workshop/open": input => this.exclusive(async () => {
                const directory = input.directory && (await this.recent()).some(item => item.dir === input.directory)
                    ? input.directory : await this.chooseDirectory("author.open");
                return directory ? this.remember(await kits.readKit(directory)) : null;
            }),
            "/kits/workshop/save": input => this.exclusive(async () => {
                const directory = this.requireKit().directory;
                return this.remember(await kits.saveKit(directory, input.model));
            }),
            "/kits/workshop/validate": () => this.exclusive(() => kits.validateKit(this.requireKit().directory)),
            "/kits/workshop/check": input => kits.validateModel(this.requireKit().directory, input.model),
            "/kits/workshop/export": () => this.exclusive(async () => {
                const current = this.requireKit();
                const result = await this.dialog.showSaveDialog(this.window(), { title: this.t("author.export"), defaultPath: `${current.contract.kit.id}.zip`, filters: [{ name: "ZIP", extensions: ["zip"] }] });
                return result.canceled ? null : kits.exportKit(current.directory, result.filePath);
            }),
            "/kits/workshop/import": () => this.exclusive(async () => {
                const result = await this.dialog.showOpenDialog(this.window(), { title: this.t("author.importZip"), properties: ["openFile"], filters: [{ name: "ZIP", extensions: ["zip"] }] });
                if (result.canceled) return null;
                const directory = await this.chooseDirectory("author.chooseEmpty");
                return directory ? this.remember(await kits.importKit(result.filePaths[0], directory)) : null;
            }),
            "/kits/workshop/git": input => this.exclusive(async () => {
                const directory = await this.chooseDirectory("author.chooseEmpty");
                return directory ? this.remember(await kits.importGit(input.url, directory)) : null;
            }),
            "/kits/workshop/test": () => this.exclusive(async () => {
                if (!await this.confirm("author.try", "author.trust")) return null;
                const target = await this.chooseDirectory("author.chooseProject");
                if (!target) return null;
                await this.install(this.requireKit().directory, target, { source: { type: "local" } });
                return this.openProject(target);
            }),
            "/kits/catalog": input => this.catalog.list(input),
            "/kits/catalog/install": input => this.exclusive(() => this.officialInstall(input.id)),
            "/kits/submit": () => this.exclusive(async () => {
                if (!this.repository) throw new Error("Configure the official catalog repository before submitting a kit.");
                const validation = await kits.validateKit(this.requireKit().directory);
                if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
                if (!await this.confirm("author.submit", "author.submitHint")) return null;
                return submitKit(this.requireKit().directory, { repository: this.repository, confirmed: true, directory: path.join(this.directory, "kit-submissions") });
            }),
            "/kits/draft/pause": () => this.drafting.pause(),
            "/kits/draft/resume": () => this.drafting.resume(),
            "/kits/draft/close": () => this.drafting.close(),
            "/kits/updates/check": () => this.checkUpdates(true),
            "/kits/updates/apply": async input => {
                if (!await this.confirm("author.update", "author.updateConfirm")) return null;
                return this.applyUpdate(input.allowModified === true);
            },
        };
    }
}
