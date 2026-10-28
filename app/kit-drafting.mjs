import { normalizeModels, validateSelection, appliedSettings } from "../core/models.mjs";
import { relativeTo, writesOf, shellOf } from "../core/guards.mjs";
import { PROPOSAL_KINDS } from "../core/kit-authoring.mjs";

const LANGUAGE_NAMES = { fr: "French", en: "English", de: "German", es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch" };
export const PROPOSE_TOOL = "vibe_studio_propose", PROGRESS_TOOL = "vibe_studio_progress";

export function draftingInstructions(language) {
    return `You help an author design a Vibe Studio kit. A kit drives an AI-assisted mission as a journey of steps.
Each step has a title, a description of what it does, the documents it uses and produces, optional repetition for
each element of a list (for example each page or each scenario), optional approval of its documents by the user,
and instructions for the AI that will run the step.

Rules:
- Never edit files: file writes and shell commands are disabled. You may read the files of this kit folder.
- Submit every change with the ${PROPOSE_TOOL} tool. The author reviews proposals one by one; nothing is applied
  before acceptance. Make one proposal per meaningful change: one per step, one per rule.
- Publish a short plan with ${PROGRESS_TOOL} (3 to 6 tasks) and update it as you work.
- Ask the author with ask_user, one question at a time, only when the answer changes the kit. Never invent client facts.
- Write every title, description and instruction in ${LANGUAGE_NAMES[language] || "English"}, in plain business
  language without technical jargon. Document names are short file names such as scoping-note.md, without folders.
- Step instructions are written for the AI that will run the step: what to read, what to do, which questions to ask
  the user, which documents to write, and when to stop. Never let that AI approve a document on behalf of the user.
- The first step configures the project; keep it unless the author asks otherwise.
- When you have submitted everything, reply with a two-sentence summary and stop.`;
}

// Structured proposals: the application validates them against the kit before showing them to the author.
export const proposalSchema = {
    type: "object", required: ["proposals"],
    properties: {
        proposals: {
            type: "array", minItems: 1, maxItems: 30,
            items: {
                type: "object", required: ["kind", "summary"],
                properties: {
                    kind: { type: "string", enum: PROPOSAL_KINDS.filter(kind => kind !== "languages"),
                        description: "kit: name/description/about. units: label/plural of the repeated element. step.add, step.update (step id), step.remove (step id), step.move (step, position). rule.add: secrets, readOnly or confirmCommands. translation: language/key/text. contract.patch: expert JSON Pointer operations on the contract." },
                    summary: { type: "string", description: "One sentence, in the author's language, explaining why this change helps." },
                    step: { type: "string", description: "Existing step id, for step.update, step.remove and step.move." },
                    position: { type: "integer", description: "1-based position of the step in the journey." },
                    title: { type: "string" }, description: { type: "string", description: "What the step does, or the kit description." },
                    result: { type: "string", description: "What the step returns to the user." },
                    repeat: { type: "boolean", description: "Run the step once for each repeated element." },
                    approval: { type: "boolean", description: "The user must approve the documents produced by the step." },
                    uses: { type: "array", items: { type: "string" }, description: "Document names the step reads." },
                    produces: { type: "array", items: { type: "string" }, description: "Document names the step writes." },
                    instructions: { type: "string", description: "Markdown instructions for the AI running the step." },
                    name: { type: "string" }, about: { type: "string" }, label: { type: "string" }, plural: { type: "string" },
                    rule: { type: "string", enum: ["secrets", "readOnly", "confirmCommands"] }, reason: { type: "string" },
                    files: { type: "array", items: { type: "string" } }, commands: { type: "array", items: { type: "string" } },
                    language: { type: "string" }, key: { type: "string" }, text: { type: "string" },
                    operations: { type: "array", items: { type: "object", properties: { op: { type: "string" }, path: { type: "string" }, value: {} } } },
                },
            },
        },
    },
};
const progressSchema = {
    type: "object", required: ["tasks"],
    properties: { tasks: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", required: ["label", "status"],
        properties: { label: { type: "string" }, status: { type: "string", enum: ["todo", "doing", "done"] } } } } },
};

// Drafting sessions only read the kit; every change goes through a proposal reviewed by the author.
export function draftingHooks(directory) {
    return {
        onPreToolUse: async input => {
            const reject = reason => ({ permissionDecision: "deny", permissionDecisionReason: reason });
            if (shellOf(input.toolName, input.toolArgs) !== null)
                return reject(`Shell commands are disabled while drafting a kit. Submit changes with ${PROPOSE_TOOL}.`);
            const { files } = writesOf(input.toolName, input.toolArgs);
            if (files.length) return reject(`Files are never edited directly while drafting a kit. Submit changes with ${PROPOSE_TOOL}.`);
            for (const key of ["path", "file_path", "filePath"]) {
                const value = input.toolArgs && typeof input.toolArgs === "object" ? input.toolArgs[key] : null;
                if (typeof value === "string" && relativeTo(directory, value) === null) return reject("Only the files of this kit can be read.");
            }
            return undefined;
        },
    };
}

export class KitDrafting {
    constructor({ harness, onEvent = () => {}, onChange = () => {}, cancelRequests = () => {} }) {
        this.harness = harness; this.onEvent = onEvent; this.onChange = onChange; this.cancelRequests = cancelRequests;
        this.current = null;
        this.pauseTimer = null;
    }
    status() {
        if (!this.current) return null;
        const { session, ...status } = this.current;
        return status;
    }
    async options(refresh = false) {
        const engine = this.harness();
        const models = normalizeModels(await (refresh && engine.refreshModels ? engine.refreshModels() : engine.models()));
        return { models, defaultModel: models.find(item => item.id === engine.defaultModel?.())?.id || models[0]?.id,
            catalog: engine.catalogStatus?.() || { source: "live" } };
    }
    async start(directory, selection, { language, onPropose, onProgress }) {
        if (this.current) throw new Error("Close the current drafting session first.");
        const options = await this.options();
        const chosen = validateSelection(options.models, { model: options.defaultModel, contextTier: "default" }, selection || {});
        const engine = this.harness();
        const tools = [
            { name: PROPOSE_TOOL, description: "Submit kit changes for the author's review. Nothing is applied before the author accepts it.",
                parameters: proposalSchema, skipPermission: true, defer: "never",
                handler: async input => { try { return await onPropose(input); } catch (error) { return { resultType: "failure", textResultForLlm: error.message }; } } },
            { name: PROGRESS_TOOL, description: "Publish the plan of the current drafting request as a short task list shown to the author.",
                parameters: progressSchema, skipPermission: true, defer: "never",
                handler: async input => {
                    const tasks = Array.isArray(input?.tasks) ? input.tasks.slice(0, 8).filter(task => typeof task?.label === "string" && ["todo", "doing", "done"].includes(task.status))
                        .map(task => ({ label: task.label.slice(0, 160), status: task.status })) : [];
                    if (this.current) { this.current.tasks = tasks; this.onChange(); }
                    onProgress?.(tasks);
                    return "Progress shown to the author.";
                } },
        ];
        const session = await engine.openStep({ project: directory, agent: null, ...chosen, tools, mode: "interactive",
            hooks: draftingHooks(directory),
            onEvent: event => {
                this.onEvent(session.sessionId, event);
                if (this.current?.sessionId !== session.sessionId) return;
                if (event.type === "session.idle") {
                    clearTimeout(this.pauseTimer);
                    this.current.busy = false;
                    this.current.status = this.current.status === "pausing" ? "paused" : "ready";
                }
                if (event.type === "session.error") {
                    clearTimeout(this.pauseTimer);
                    this.current.busy = false; this.current.status = "error";
                    this.current.error = String(event.data?.message || "").slice(0, 400);
                }
                this.onChange();
            } });
        this.current = { directory, session, sessionId: session.sessionId, busy: false, status: "ready", tasks: [], language,
            ...await appliedSettings(session, chosen, engine.status().harness).catch(async error => { await session.disconnect().catch(() => {}); throw error; }) };
        this.instructed = false;
        return this.status();
    }
    async say(text, attachments = []) {
        const current = this.current;
        if (!current || current.busy || ["paused", "pausing"].includes(current.status)) throw new Error("The AI is still working on the previous request.");
        if (typeof text !== "string" || !text.trim() || text.length > 60000) throw new Error("Enter a drafting request.");
        const prompt = this.instructed ? text : `${draftingInstructions(current.language)}\n\n${text}`;
        this.instructed = true;
        current.busy = true; current.status = "running"; current.tasks = []; delete current.error; delete current.pauseError;
        this.onChange();
        this.onEvent(current.sessionId, { type: "vibe_studio.user", data: { content: text, attachments } });
        try { await current.session.send(prompt, attachments.map(file => ({ type: "file", path: file.path, displayName: file.name }))); }
        catch (error) { current.busy = false; current.status = "error"; current.error = String(error.message || error).slice(0, 400); this.onChange(); throw error; }
    }
    async pause() {
        const current = this.current;
        if (!current?.busy) throw new Error("No drafting turn is running.");
        current.status = "pausing"; this.cancelRequests(current.sessionId); this.onChange();
        clearTimeout(this.pauseTimer);
        this.pauseTimer = setTimeout(() => {
            if (this.current === current && current.status === "pausing") {
                current.pauseError = "The harness did not acknowledge the pause. Retry Pause or close the drafting session.";
                this.onChange();
            }
        }, 30000);
        this.pauseTimer.unref?.();
        await current.session.abort();
    }
    async resume() {
        if (this.current?.status !== "paused") throw new Error("Wait for the harness to acknowledge the pause.");
        this.current.status = "ready";
        await this.say(`Continue the previous request from the current kit. Do not repeat proposals already submitted.`);
    }
    async close() {
        const current = this.current;
        if (!current) return;
        clearTimeout(this.pauseTimer);
        this.cancelRequests(current.sessionId);
        this.current = null;
        await current.session.abort().catch(() => {});
        await current.session.disconnect().catch(() => {});
        this.onChange();
    }
}
