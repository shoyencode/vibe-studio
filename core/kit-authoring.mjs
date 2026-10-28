// Kit authoring operations shared by the main process and the window: no Node APIs.
// A proposal is a structured change in business vocabulary. The AI submits proposals; the author accepts them.
// Manual edits in the workshop use the same operations, so every change follows one validated path.
export const AUTHORING_FILE = ".apm/vibe-studio-authoring.json";
export const LANGUAGES = ["fr", "en", "de", "es", "it", "pt", "nl"];
export const PROPOSAL_KINDS = ["kit", "units", "step.add", "step.update", "step.remove", "step.move", "rule.add", "translation", "languages", "contract.patch"];
const MARK = "<!-- vibe-studio:instructions -->", END = "<!-- /vibe-studio:instructions -->";
const UNIT_DEFAULTS = { fr: ["Élément", "Éléments"], en: ["Item", "Items"], de: ["Element", "Elemente"], es: ["Elemento", "Elementos"],
    it: ["Elemento", "Elementi"], pt: ["Elemento", "Elementos"], nl: ["Element", "Elementen"] };
const COOPERATION = `## Working with Vibe Studio

- When the launch context gives a run id, call \`vibe_studio_report\` after loading this skill, before each question, at each task status change, and at the end with the paths written.
- Ask the user with \`ask_user\`, one question per call. A report is never an approval.
- Never record an approval on behalf of the user.
- Stop at the end of this step and name the next one.
`;

export class AuthoringError extends Error {
    constructor(key, vars = {}, detail = "") {
        super(detail || `${key} ${JSON.stringify(vars)}`);
        this.key = `authoring.${key}`;
        this.vars = vars;
    }
}
const fail = (key, vars, detail) => { throw new AuthoringError(key, vars, detail); };
const clone = value => structuredClone(value);
const text = (value, field, max = 4000) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) fail("text", { field }, `${field} must be a non-empty text of at most ${max} characters.`);
    return value.trim();
};
const optionalText = (value, field, max) => value === undefined ? undefined : text(value, field, max);
const list = (value, field) => {
    if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== "string" || !item.trim() || item.length > 120))
        fail("list", { field }, `${field} must be a list of at most 20 short names.`);
    return [...new Set(value.map(item => item.trim()))];
};
const bool = (value, field) => {
    if (value !== undefined && typeof value !== "boolean") fail("boolean", { field }, `${field} must be true or false.`);
    return value;
};

export function hashText(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value)) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash.toString(16).padStart(8, "0");
}

export function slugify(value, fallback = "step") {
    const slug = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
    return slug || fallback;
}

// A document named by the author becomes a portable file name; folders are generated, never typed.
export function documentFile(value) {
    const base = String(value || "").split(/[\\/]/).filter(Boolean).at(-1) || "";
    const name = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "")
        .replace(/^[.-]+/, "").slice(0, 80);
    if (!name) fail("document", { name: value }, `Invalid document name: ${value}`);
    return /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : `${name}.md`;
}
export const documentName = pattern => String(pattern).split("/").filter(Boolean).at(-1) || String(pattern);

export function authoringOf(model) {
    let data = {};
    try { data = JSON.parse(model?.files?.[AUTHORING_FILE] || "{}") || {}; } catch { data = {}; }
    const found = new Set();
    const collect = value => {
        if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === "object") {
            if (value.i18n && typeof value.i18n === "object") for (const language of Object.keys(value.i18n)) if (LANGUAGES.includes(language)) found.add(language);
            Object.values(value).forEach(collect);
        }
    };
    collect(model?.contract);
    const source = LANGUAGES.includes(data.sourceLanguage) ? data.sourceLanguage : "en";
    const declared = Array.isArray(data.languages) ? data.languages.filter(language => LANGUAGES.includes(language)) : [];
    return {
        version: 1, mission: typeof data.mission === "string" ? data.mission : "", sourceLanguage: source,
        languages: [...new Set([source, ...declared, ...found])],
        translations: data.translations && typeof data.translations === "object" ? data.translations : {},
    };
}
const encodeAuthoring = authoring => `${JSON.stringify(authoring, null, 2)}\n`;

const skillPath = skill => `.apm/skills/${skill}/SKILL.md`;
export function instructionsOf(model, skill) {
    const document = model?.files?.[skillPath(skill)];
    if (typeof document !== "string") return "";
    const start = document.indexOf(MARK), end = document.indexOf(END);
    if (start >= 0 && end > start) return document.slice(start + MARK.length, end).trim();
    return document.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}
export function skillDocument(skill, title, instructions, previous) {
    const front = typeof previous === "string" && previous.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---/)?.[0].replace(/^\uFEFF/, "");
    const frontmatter = front || `---\nname: ${skill}\ndescription: ${JSON.stringify(title)}\n---`;
    return `${frontmatter}\n\n# ${title}\n\n${MARK}\n${instructions.trim()}\n${END}\n\n${COOPERATION}`;
}

export function guidedSteps(model) {
    return (model?.contract?.steps || []).map((step, index) => ({
        id: step.id, index, title: step.title, summary: step.summary || "", returns: step.returns || "", skill: step.skill,
        configures: !!step.configures, repeat: step.scope === "unit", approval: (step.approves || []).length > 0,
        uses: (step.requires || []).map(pattern => ({ pattern, name: documentName(pattern) })),
        produces: (step.outputs || []).map(pattern => ({ pattern, name: documentName(pattern) })),
        instructions: instructionsOf(model, step.skill), i18n: step.i18n || {},
    }));
}

const guardEntries = guards => Object.entries(guards || {}).flatMap(([kind, entries]) =>
    (Array.isArray(entries) ? entries : [entries]).filter(entry => entry && typeof entry === "object").map(entry => ({ kind, entry })));
export function rulesOf(contract) {
    return [...guardEntries(contract?.guards).map(item => ({ ...item, step: null })),
        ...(contract?.steps || []).flatMap(step => guardEntries(step.guards).map(item => ({ ...item, step: step.id })))];
}

// Every text shown to a kit user, keyed by stable identifiers.
export function translatableTexts(contract) {
    const items = [];
    const add = (key, target, field, owner) => {
        if (target && typeof target[field] === "string" && target[field].trim()) items.push({ key, target, field, owner });
    };
    for (const field of ["name", "description", "about"]) add(`kit.${field}`, contract.kit, field, { kind: "kit" });
    if (contract.units) for (const field of ["label", "plural"]) add(`units.${field}`, contract.units, field, { kind: "units" });
    for (const step of contract.steps || []) for (const field of ["title", "summary", "returns"]) add(`step:${step.id}.${field}`, step, field, { kind: "step", step: step.id });
    for (const group of contract.deliverables?.groups || []) add(`group:${group.id}.title`, group, "title", { kind: "group" });
    for (const { entry, step } of rulesOf(contract)) add(`rule:${entry.id}.description`, entry, "description", { kind: "rule", step });
    return items;
}
export const sourceText = item => item.target[item.field];
export const translatedText = (item, language) => item.target.i18n?.[language]?.[item.field] || "";

export function translationStatus(model, language) {
    const records = authoringOf(model).translations[language] || {};
    return translatableTexts(model.contract).map(item => {
        const translated = translatedText(item, language), record = records[item.key];
        const status = !translated ? "missing" : record && record.source !== hashText(sourceText(item)) ? "stale" : "validated";
        return { key: item.key, field: item.field, owner: item.owner, source: sourceText(item), text: translated, status };
    });
}

function nextNumber(contract) {
    return Math.max(0, ...contract.steps.map(step => Number.parseInt(step.id, 10)).filter(Number.isFinite)) + 1;
}
function unitPrefix(step) { return step.scope === "unit" ? "{unit}" : "{root}"; }
function hasRoot(contract) { return !!contract.config?.placeholders?.root; }
function outputPattern(contract, step, name) {
    const prefix = step.scope === "unit" ? "{unit}" : hasRoot(contract) ? "{root}" : "";
    return prefix ? `${prefix}/${documentFile(name)}` : documentFile(name);
}
// A document used by a step is matched with what an earlier step produces; otherwise it is a document provided by the user.
function inputPattern(contract, step, name) {
    const wanted = documentFile(name).toLowerCase();
    const index = contract.steps.indexOf(step);
    const producers = contract.steps.filter((other, position) => other !== step && (index < 0 || position < index));
    for (const other of [...producers].reverse()) {
        const match = (other.outputs || []).find(pattern => documentName(pattern).toLowerCase() === wanted);
        if (match) return match;
    }
    const any = contract.steps.flatMap(other => other.outputs || []).find(pattern => documentName(pattern).toLowerCase() === wanted);
    if (any) return any;
    if (contract.config?.file && contract.config.file.toLowerCase() === wanted) return contract.config.file;
    return hasRoot(contract) ? `{root}/${documentFile(name)}` : documentFile(name);
}
function rescope(contract, step, unit) {
    step.scope = unit ? "unit" : "project";
    const swap = pattern => unit ? pattern.replace(/^\{root\}\//, "{unit}/").replace(/^(?!\{)/, "{unit}/")
        : pattern.replace(/^\{unit\}\//, hasRoot(contract) ? "{root}/" : "");
    step.outputs = (step.outputs || []).map(swap);
    if (step.approves?.length) step.approves = step.approves.map(swap);
}
function ensureUnits(contract, authoring, label, plural) {
    if (!contract.units) {
        const [singular, many] = UNIT_DEFAULTS[authoring.sourceLanguage] || UNIT_DEFAULTS.en;
        contract.units = { id: "item", label: label || singular, plural: plural || many,
            folder: hasRoot(contract) ? "{root}/items/item-{n}" : "items/item-{n}" };
    }
    if (label) contract.units.label = label;
    if (plural) contract.units.plural = plural;
}
function ensureApprovals(contract) {
    contract.modules ??= {};
    if (contract.modules.approvals) return;
    const file = hasRoot(contract) ? "{root}/approvals.md" : "approvals.md";
    contract.modules.approvals = { script: `${contract.kit.entrySkill}/scripts/validations.py`, file };
    contract.guards ??= {};
    if (!contract.guards.scriptOnly) contract.guards.scriptOnly = {
        id: nextRuleId(contract), paths: [file], scripts: ["validations.py"],
        reason: `Vibe Studio guard: approvals are written only by validations.py after the user approved.`,
        description: "Approvals are written only by the approval script.",
    };
}
function nextRuleId(contract) {
    const used = new Set(rulesOf(contract).map(rule => rule.entry.id));
    for (let n = 1; n < 100; n++) { const id = `G${String(n).padStart(2, "0")}`; if (!used.has(id)) return id; }
    fail("rules", {}, "Too many rules.");
}
function uniqueSkill(contract, base, files) {
    const used = new Set([contract.kit.entrySkill, ...contract.steps.map(step => step.skill)]);
    let candidate = base.slice(0, 60).replace(/-+$/, ""), n = 2;
    while (used.has(candidate) || files[skillPath(candidate)] !== undefined) candidate = `${base.slice(0, 56).replace(/-+$/, "")}-${n++}`;
    return candidate;
}
function findStep(contract, ref) {
    const step = contract.steps.find(item => item.id === ref);
    if (!step) fail("unknownStep", { step: String(ref) }, `Unknown step: ${ref}. Use an existing step id.`);
    return step;
}

function updateStep(next, step, proposal, write) {
    const { contract } = next;
    const title = optionalText(proposal.title, "title", 120);
    if (title) step.title = title;
    const summary = optionalText(proposal.description, "description", 1000);
    if (summary) step.summary = summary;
    const returns = optionalText(proposal.result, "result", 500);
    if (returns) step.returns = returns;
    const repeat = bool(proposal.repeat, "repeat");
    const approval = bool(proposal.approval, "approval") ?? (step.approves || []).length > 0;
    if (repeat !== undefined && repeat !== (step.scope === "unit")) {
        if (step.configures && repeat) fail("configureRepeat", {}, "The configuration step cannot be repeated.");
        if (repeat) ensureUnits(contract, next.authoring);
        rescope(contract, step, repeat);
    }
    if (proposal.produces !== undefined) {
        const names = list(proposal.produces, "produces");
        if (!names.length) fail("produces", {}, "A step produces at least one document.");
        step.outputs = names.map(name => outputPattern(contract, step, name));
    }
    if (proposal.uses !== undefined) step.requires = list(proposal.uses, "uses").map(name => inputPattern(contract, step, name));
    if (approval) { ensureApprovals(contract); step.approves = [...step.outputs]; }
    else delete step.approves;
    if (proposal.instructions !== undefined) {
        const instructions = text(proposal.instructions, "instructions", 40000);
        write(skillPath(step.skill), skillDocument(step.skill, step.title, instructions, next.files[skillPath(step.skill)]));
    } else if (title && next.files[skillPath(step.skill)]?.includes(MARK)) {
        write(skillPath(step.skill), skillDocument(step.skill, step.title, instructionsOf(next, step.skill), next.files[skillPath(step.skill)]));
    }
}

function pointerParts(path) {
    if (typeof path !== "string" || !path.startsWith("/")) fail("pointer", { path: String(path) }, `Invalid JSON pointer: ${path}`);
    return path.slice(1).split("/").map(part => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}
function patchContract(contract, operations) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 50) fail("patch", {}, "Provide 1 to 50 patch operations.");
    for (const operation of operations) {
        const parts = pointerParts(operation?.path);
        if (!parts.length || parts.some(part => ["__proto__", "constructor", "prototype"].includes(part))) fail("pointer", { path: operation?.path });
        const key = parts.pop();
        let parent = contract;
        for (const part of parts) {
            parent = parent?.[Array.isArray(parent) ? Number(part) : part];
            if (parent === undefined || parent === null || typeof parent !== "object") fail("pointer", { path: operation.path }, `Path not found: ${operation.path}`);
        }
        if (operation.op === "remove") {
            if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
        } else if (["add", "replace"].includes(operation.op)) {
            if (operation.value === undefined) fail("patch", {}, "add and replace need a value.");
            if (Array.isArray(parent)) {
                const index = key === "-" ? parent.length : Number(key);
                if (!Number.isInteger(index) || index < 0 || index > parent.length) fail("pointer", { path: operation.path });
                if (operation.op === "add") parent.splice(index, 0, clone(operation.value)); else parent[index] = clone(operation.value);
            } else parent[key] = clone(operation.value);
        } else fail("patch", {}, `Unsupported patch operation: ${operation?.op}`);
    }
}

/**
 * Applies one proposal to a model {metadata, contract, files} and returns the next model with `changes`,
 * the authored files to write (content) or delete (null). Throws AuthoringError for an invalid proposal.
 */
export function applyProposal(model, proposal) {
    if (!proposal || typeof proposal !== "object" || !PROPOSAL_KINDS.includes(proposal.kind))
        fail("kind", { kind: String(proposal?.kind) }, `Unknown proposal kind. Use one of: ${PROPOSAL_KINDS.join(", ")}.`);
    const next = { ...model, metadata: clone(model.metadata), contract: clone(model.contract), files: { ...model.files } };
    next.authoring = authoringOf(model);
    const authoringBefore = JSON.stringify(next.authoring);
    const changes = {};
    const write = (path, content) => { changes[path] = content; if (content === null) delete next.files[path]; else next.files[path] = content; };
    const { contract } = next;
    switch (proposal.kind) {
        case "kit": {
            const name = optionalText(proposal.name, "name", 120), description = optionalText(proposal.description, "description", 1000);
            if (name) contract.kit.name = name;
            if (description) { contract.kit.description = description; next.metadata.description = description; }
            if (proposal.about !== undefined) {
                if (proposal.about === "") delete contract.kit.about; else contract.kit.about = text(proposal.about, "about", 8000);
            }
            if (proposal.mission !== undefined) next.authoring.mission = text(proposal.mission, "mission", 8000);
            if (!name && !description && proposal.about === undefined && proposal.mission === undefined) fail("empty", {}, "The proposal changes nothing.");
            break;
        }
        case "units":
            ensureUnits(contract, next.authoring, optionalText(proposal.label, "label", 60), optionalText(proposal.plural, "plural", 60));
            break;
        case "step.add": {
            const title = text(proposal.title, "title", 120);
            const n = nextNumber(contract);
            let id = `${n}-${slugify(title)}`;
            while (contract.steps.some(step => step.id === id)) id = `${Number.parseInt(id, 10) + 1}-${slugify(title)}`;
            const step = { id, title, skill: uniqueSkill(contract, `${contract.kit.id}-${n}-${slugify(title)}`, next.files),
                agent: null, scope: "project", requires: [], outputs: [] };
            const position = proposal.position === undefined ? contract.steps.length : Number(proposal.position) - 1;
            if (!Number.isInteger(position)) fail("position", {}, "position must be a step number.");
            contract.steps.splice(Math.max(0, Math.min(contract.steps.length, position)), 0, step);
            const produces = proposal.produces === undefined ? [`${slugify(title, "document")}.md`] : proposal.produces;
            updateStep(next, step, { ...proposal, produces, instructions: proposal.instructions ?? proposal.description ?? title }, write);
            break;
        }
        case "step.update": {
            const step = findStep(contract, proposal.step);
            const fields = ["title", "description", "result", "repeat", "approval", "produces", "uses", "instructions"];
            if (!fields.some(field => proposal[field] !== undefined)) fail("empty", {}, "The proposal changes nothing.");
            updateStep(next, step, proposal, write);
            break;
        }
        case "step.remove": {
            const step = findStep(contract, proposal.step);
            if (contract.steps.length === 1) fail("lastStep", {}, "A kit keeps at least one step.");
            const modules = contract.modules || {};
            if (Object.values(modules).some(module => ["buildStep", "reviewStep", "importStep"].some(key => module?.[key] === step.id)))
                fail("stepInUse", { step: step.title }, "A module still uses this step.");
            contract.steps.splice(contract.steps.indexOf(step), 1);
            const removed = new Set(step.outputs || []);
            for (const other of contract.steps) other.requires = (other.requires || []).filter(pattern => !removed.has(pattern));
            if (contract.modelPolicies?.steps) delete contract.modelPolicies.steps[step.id];
            const stillUsed = step.skill === contract.kit.entrySkill || contract.steps.some(other => other.skill === step.skill)
                || rulesOf(contract).some(rule => (rule.entry.skills || []).includes(step.skill));
            if (!stillUsed && next.files[skillPath(step.skill)] !== undefined) write(skillPath(step.skill), null);
            for (const record of Object.values(next.authoring.translations)) for (const key of Object.keys(record)) if (key.startsWith(`step:${step.id}.`)) delete record[key];
            break;
        }
        case "step.move": {
            const step = findStep(contract, proposal.step), position = Number(proposal.position) - 1;
            if (!Number.isInteger(position)) fail("position", {}, "position must be a step number.");
            contract.steps.splice(contract.steps.indexOf(step), 1);
            contract.steps.splice(Math.max(0, Math.min(contract.steps.length, position)), 0, step);
            break;
        }
        case "rule.add": {
            const description = text(proposal.description, "description", 300);
            const kinds = { secrets: [], readOnly: ["files"], confirmCommands: ["commands"] };
            if (!Object.hasOwn(kinds, proposal.rule)) fail("rule", { rule: String(proposal.rule) }, "rule must be secrets, readOnly or confirmCommands.");
            const id = nextRuleId(contract);
            const entry = { id, reason: `Vibe Studio guard ${id}: ${optionalText(proposal.reason, "reason", 500) || description}`, description };
            if (proposal.rule === "readOnly") {
                const names = list(proposal.files, "files");
                if (!names.length) fail("files", {}, "readOnly needs at least one document.");
                entry.paths = names.map(name => inputPattern(contract, null, name));
            }
            if (proposal.rule === "confirmCommands") {
                const commands = list(proposal.commands, "commands");
                for (const command of commands) { try { new RegExp(command); } catch { fail("command", { command }, `Invalid command pattern: ${command}`); } }
                entry.commands = commands;
            }
            contract.guards ??= {};
            const existing = contract.guards[proposal.rule];
            contract.guards[proposal.rule] = existing ? [...(Array.isArray(existing) ? existing : [existing]), entry] : entry;
            break;
        }
        case "translation": {
            const language = proposal.language;
            if (!LANGUAGES.includes(language) || language === next.authoring.sourceLanguage) fail("language", { language: String(language) }, "Translate into a supported language other than the source language.");
            const item = translatableTexts(contract).find(entry => entry.key === proposal.key);
            if (!item) fail("textKey", { key: String(proposal.key) }, `Unknown text key: ${proposal.key}`);
            item.target.i18n ??= {};
            item.target.i18n[language] = { ...item.target.i18n[language], [item.field]: text(proposal.text, "text", 8000) };
            if (!next.authoring.languages.includes(language)) next.authoring.languages.push(language);
            next.authoring.translations[language] = { ...next.authoring.translations[language],
                [item.key]: { status: "validated", source: hashText(sourceText(item)) } };
            break;
        }
        case "languages": {
            if (!Array.isArray(proposal.languages) || proposal.languages.some(language => !LANGUAGES.includes(language))) fail("language", {}, "Unsupported language.");
            next.authoring.languages = [...new Set([next.authoring.sourceLanguage, ...proposal.languages])];
            break;
        }
        case "contract.patch": {
            patchContract(contract, proposal.operations);
            if (contract.kit?.id !== model.contract.kit.id || contract.kit?.entrySkill !== model.contract.kit.entrySkill)
                fail("identity", {}, "The kit identifier and entry skill cannot be changed by a patch.");
            break;
        }
    }
    if (JSON.stringify(next.authoring) !== authoringBefore || !next.files[AUTHORING_FILE]) write(AUTHORING_FILE, encodeAuthoring(next.authoring));
    return { metadata: next.metadata, contract, files: next.files, directory: model.directory, changes };
}

// Short, human description of a proposal for review lists.
export function proposalTarget(model, proposal) {
    if (proposal.kind.startsWith("step.") && proposal.kind !== "step.add") return model.contract.steps.find(step => step.id === proposal.step)?.title || proposal.step;
    if (proposal.kind === "step.add") return proposal.title;
    if (proposal.kind === "translation") {
        const item = translatableTexts(model.contract).find(entry => entry.key === proposal.key);
        return item ? sourceText(item) : proposal.key;
    }
    if (proposal.kind === "rule.add") return proposal.description || proposal.rule;
    return model.contract.kit.name;
}

// Locates a validation issue in the author's terms: "Step 2 · Analyse a page › Scope".

// Locates a validation issue in the author's terms: "Step 2 · Analyse a page › Scope".
export function issueLocation(issue, contract) {
    const parts = String(issue.path || issue.field || "/").split("/").filter(Boolean);
    if (parts[0] === "contract") parts.shift();
    if (parts[0] === "steps" && /^\d+$/.test(parts[1] || "")) {
        const index = Number(parts[1]), step = contract?.steps?.[index];
        return { kind: "step", index, step: step?.id, title: step?.title || "", field: parts.slice(2).join(" › ") };
    }
    return { kind: parts[0] || "kit", field: parts.slice(1).join(" › ") };
}
export function issueMessage(issue) {
    const message = String(issue.message || "");
    let match;
    if ((match = message.match(/^'(.*)' is not one of \[(.*)\]$/))) return { key: "enum", vars: { value: match[1], allowed: match[2].replaceAll("'", "") } };
    if (message === "A required field is missing.") return { key: "required", vars: {} };
    if (/does not match/.test(message)) return { key: "pattern", vars: {} };
    if ((match = message.match(/^Missing kit file: (.+)$/))) return { key: "missingFile", vars: { file: match[1] } };
    if ((match = message.match(/^Unknown placeholder: (.+)$/))) return { key: "placeholder", vars: { name: match[1] } };
    if (message === "Unknown step reference.") return { key: "stepRef", vars: {} };
    if (message === "Step ids must be unique.") return { key: "uniqueStep", vars: {} };
    if (message === "Unit-scoped steps require units.") return { key: "units", vars: {} };
    if (/is too short|should be non-empty|minItems/.test(message)) return { key: "empty", vars: {} };
    return { key: null, vars: { message } };
}
