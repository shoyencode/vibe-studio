import { t as translate, pick, phaseText } from "/i18n.mjs";
import { parse, render as renderMarkdown } from "/markdown.mjs";
import { nextJourneyStep, automaticallyCompletedBuild } from "/journey.mjs";

const main = document.querySelector("#main");
const notice = document.querySelector("#notice");
const dialog = document.querySelector("#confirmation");
let state = null, projects = null, view = "projects", scenario = 1, costs, costsFor = null, costsLoading = false, configDraft, refreshTimer;
let preferredScenarioProject = null;
let costsAttemptFor = null, costsRequest = null;
let costsTimer = null, costsDirty = false, costsReadAt = 0;
let settingsTab = "config", highlight = null, historyOpen = false, inflight = null, refreshing = false;
// Reader stack: deliverables opened full page; origin is the space to return to.
let reading = [], origin = null;
const formValues = new Map();
const secondary = ["about", "settings"];
let appLog = null, appLogTimer = null, appAction = null, preferences = null, harnesses = null;
let noticeTimer;
let historyRevision = 0;
let updateState = null, updateWork = false;
function showNotice(content, error = false) {
    clearTimeout(noticeTimer);
    notice.className = content ? `notice${error ? " error" : ""}` : "";
    notice.setAttribute("role", error ? "alert" : "status");
    notice.replaceChildren(...(Array.isArray(content) ? content : content ? [content] : []));
    if (content && !error) armNotice();
}
function armNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { if (!notice.matches(":hover, :focus-within")) showNotice(""); else armNotice(); }, 5000);
}
notice.addEventListener("focusout", () => { if (noticeTimer && !notice.matches(".error")) armNotice(); });
function applyTheme() {
    document.documentElement.dataset.theme = preferences?.theme || "system";
}
const lang = () => pick(state?.language);
// Unit labels (scenario, topic…) come from the kit contract.
function unitVars() {
    const units = state?.kit?.contract?.units;
    const unit = units ? phaseText(units, "label", lang()) : translate(lang(), "unit.default");
    return { unit, units: units ? phaseText(units, "plural", lang()) : translate(lang(), "unit.defaultPlural"), unitLower: unit.toLowerCase() };
}
const t = (key, vars = {}) => translate(lang(), key, { ...unitVars(), ...vars });
const contract = () => state?.kit?.contract || { steps: [], modules: {} };
const ongoing = run => ["running", "waiting", "pausing", "paused"].includes(run?.status);
const modules = () => contract().modules || {};
const buildStep = () => modules().tasks?.buildStep || null;
const configStep = () => contract().steps.find(s => s.configures) || null;
function spacesFor() {
    if (!state?.kit) return ["journey", "conversation"];
    const m = modules();
    return ["journey", ...(contract().units ? ["scenarios"] : []), "conversation", ...(m.application ? ["application"] : []),
        "deliverables", ...(m.sources ? ["sources"] : []), ...(m.costs ? ["costs"] : [])];
}
const locale = () => lang() === "fr" ? "fr-FR" : "en-GB";

function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function button(text, action, className) {
    const node = el("button", text, className); node.type = "button";
    node.addEventListener("click", () => Promise.resolve().then(action).catch(showError));
    return node;
}
const REFRESH_ICON = "M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z";
function refreshIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
    svg.setAttribute("class", "icon"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("fill", "currentColor"); path.setAttribute("d", REFRESH_ICON);
    svg.append(path); return svg;
}
function setBusy(control, busy) {
    control.classList.toggle("spinning", busy);
    if (busy) { control.setAttribute("aria-busy", "true"); control.setAttribute("aria-disabled", "true"); }
    else { control.removeAttribute("aria-busy"); control.removeAttribute("aria-disabled"); }
}
function refreshButton(text, action, className, busy = false) {
    const node = el("button", undefined, `with-icon${className ? ` ${className}` : ""}`); node.type = "button";
    node.append(refreshIcon(), el("span", text));
    setBusy(node, busy);
    node.addEventListener("click", async () => {
        if (node.getAttribute("aria-busy")) return;
        setBusy(node, true);
        const started = performance.now();
        try { await action(); } catch (error) { showError(error); }
        finally {
            // At least one full turn, so that a fast action is still visible.
            await new Promise(resolve => setTimeout(resolve, Math.max(0, 700 - (performance.now() - started))));
            setBusy(node, false);
        }
    });
    return node;
}
const APP_ICONS = { start: "M4.5 3.2v9.6L12.5 8z", pause: "M4 3h3v10H4zM9 3h3v10H9z", stop: "M4 4h8v8H4z", restart: REFRESH_ICON };
function iconSlot(d) {
    const slot = el("span", undefined, "btn-icon"); slot.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "14"); svg.setAttribute("height", "14"); svg.setAttribute("focusable", "false");
    const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("fill", "currentColor"); path.setAttribute("d", d);
    svg.append(path); slot.append(svg); return slot;
}
// A button whose icon becomes a spinner while it works: same label, same size.
function workButton(kind, text, action, className, busy) {
    const node = el("button", undefined, `with-icon${className ? ` ${className}` : ""}`); node.type = "button";
    const slot = iconSlot(APP_ICONS[kind]);
    if (busy) { slot.replaceChildren(el("span", undefined, "spinner")); node.setAttribute("aria-busy", "true"); node.setAttribute("aria-disabled", "true"); }
    node.append(slot, el("span", text));
    node.addEventListener("click", () => { if (!node.getAttribute("aria-busy")) Promise.resolve().then(action).catch(showError); });
    return node;
}
function confirmDialog(title, message, action) {
    return new Promise(resolve => {
        const content = document.querySelector("#confirm-content");
        const heading = el("h2", title); heading.id = "confirm-title";
        const actions = el("div", undefined, "actions");
        let answer = false;
        const cancel = button(t("launch.cancel"), () => dialog.close());
        actions.append(cancel, button(action, () => { answer = true; dialog.close(); }, "danger"));
        content.replaceChildren(heading, el("p", message), actions);
        dialog.addEventListener("close", () => resolve(answer), { once: true });
        dialog.showModal(); cancel.focus();
    });
}
const sizeText = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
// Files chosen in the system dialog, copied into the project when the form is sent.
function attachmentsField(list) {
    const box = el("div", undefined, "attachments");
    const draw = () => {
        box.replaceChildren(el("span", t("attach.label"), "field-label"));
        if (list.length) {
            const items = el("ul", undefined, "attachment-list");
            for (const file of list) {
                const row = el("li"), remove = button("×", () => { list.splice(list.indexOf(file), 1); draw(); }, "icon-button");
                remove.setAttribute("aria-label", t("attach.remove", { name: file.name })); remove.title = remove.getAttribute("aria-label");
                row.append(el("span", file.name), el("small", sizeText(file.size), "muted"), remove); items.append(row);
            }
            box.append(items);
        }
        const add = button(t("attach.add"), async () => {
            const { files } = await api("/files/choose");
            const additions = files.filter(file => !list.some(item => item.path === file.path));
            if (list.length + additions.length > 10) throw new Error(t("attach.tooMany", { n: 10 }));
            list.push(...additions);
            draw();
        });
        add.disabled = list.length >= 10;
        box.append(add, el("small", t("attach.hint"), "muted"));
    };
    draw();
    return box;
}
let audio = null;
const recordedClips = new Map();
// Each theme distinguishes a question or permission, a successful end and a failure.
export const SOUND_THEMES = {
    chime: { wave: "sine", step: 0.14, length: 0.35, gain: 0.2, notes: { ask: [660, 880], ended: [523, 659, 784], failed: [523, 392], reply: [784, 988] } },
    soft: { wave: "triangle", step: 0.2, length: 0.5, gain: 0.16, notes: { ask: [392, 494], ended: [330, 392, 494], failed: [392, 294], reply: [440, 554] } },
    bell: { wave: "sine", step: 0.22, length: 1.2, gain: 0.18, partials: [1, 2.76, 5.4], notes: { ask: [880, 1175], ended: [784, 988, 1319], failed: [698, 523], reply: [1047, 1319] } },
    pop: { wave: "square", step: 0.09, length: 0.08, gain: 0.08, notes: { ask: [880, 1320], ended: [660, 880, 1320], failed: [440, 330], reply: [990, 1320] } },
    marimba: { wave: "sine", step: 0.12, length: 0.28, gain: 0.22, partials: [1, 4], notes: { ask: [523, 784], ended: [392, 523, 659, 784], failed: [494, 392], reply: [659, 880] } },
    arcade: { wave: "square", step: 0.1, length: 0.16, gain: 0.055, notes: { ask: [587, 784, 1175], ended: [392, 523, 659, 1047], failed: [440, 349, 220], reply: [392, 523, 659, 1047] } },
    orbital: { wave: "sine", step: 0.14, length: 0.28, gain: 0.12, partials: [1, 2], glide: 1.18, notes: { ask: [740, 1109], ended: [370, 554, 740], failed: [370, 277], reply: [370, 554, 740] } },
    telegraph: { wave: "square", step: 0.09, length: 0.055, gain: 0.035, notes: { ask: [1047, 1047, 784], ended: [784, 1047, 1568], failed: [392, 392, 262], reply: [784, 1047, 1568] } },
    analogNoir: { wave: "sawtooth", step: 0.16, length: 0.26, gain: 0.045, partials: [1, 1.005], glide: 0.96, notes: { ask: [220, 293.665], ended: [146.832, 220, 293.665], failed: [220, 164.814], reply: [146.832, 220, 293.665] } },
    piano: { gain: 0.6, files: { ask: "sounds/piano-question.wav", ended: "sounds/piano-success.wav", failed: "sounds/piano-error.wav", reply: "sounds/piano-success.wav" } },
    guitar: { gain: 0.6, files: { ask: "sounds/guitar-question.wav", ended: "sounds/guitar-success.wav", failed: "sounds/guitar-error.wav", reply: "sounds/guitar-success.wav" } },
};
export function scheduleSound(audio, sound, kind) {
    const notes = sound.notes[kind === "question" || kind === "permission" ? "ask" : kind] || sound.notes.ask;
    const now = audio.currentTime + 0.02;
    notes.forEach((frequency, i) => {
        const start = now + i * sound.step;
        (sound.partials || [1]).forEach((ratio, n) => {
            const tone = audio.createOscillator(), gain = audio.createGain();
            tone.type = sound.wave; tone.frequency.setValueAtTime(frequency * ratio, start);
            if (sound.glide) tone.frequency.exponentialRampToValueAtTime(frequency * ratio * sound.glide, start + sound.length / (n + 1));
            const peak = sound.gain / (n + 1) / (n ? 2 : 1);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.length / (n + 1));
            tone.connect(gain).connect(audio.destination); tone.start(start); tone.stop(start + sound.length + 0.05);
        });
    });
}
export function scheduleRecordedSound(audio, buffer, volume) {
    const source = audio.createBufferSource(), gain = audio.createGain();
    source.buffer = buffer; gain.gain.value = volume;
    source.connect(gain).connect(audio.destination); source.start();
    return source;
}
async function chime(kind, theme = preferences?.soundTheme) {
    const sound = SOUND_THEMES[theme] || SOUND_THEMES.chime;
    try {
        audio ??= new AudioContext();
        if (sound.files) {
            const key = kind === "question" || kind === "permission" ? "ask" : kind;
            const url = new URL(sound.files[key] || sound.files.ask, import.meta.url).href;
            if (!recordedClips.has(url)) recordedClips.set(url, (async () => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Recorded sound could not be read (${response.status}).`);
                return audio.decodeAudioData(await response.arrayBuffer());
            })().catch(error => { recordedClips.delete(url); throw error; }));
            const buffer = await recordedClips.get(url);
            await audio.resume();
            scheduleRecordedSound(audio, buffer, sound.gain);
        } else scheduleSound(audio, sound, kind);
    } catch (error) {
        if (sound.files) showError(new Error(t("sound.loadFailed", { message: error.message })));
        // A missing audio device never suppresses the visual notification.
    }
}
function showError(error) {
    showNotice(error.message || t("error.generic"), true);
}
async function api(route, data = {}) {
    const answer = await window.vibeStudio.call(route, data);
    if (answer?.error) throw Object.assign(new Error(answer.error), { code: answer.code });
    return answer?.result;
}
function table(headers, rows, caption) {
    const wrap = el("div", undefined, "table-wrap"), t = el("table");
    if (caption) t.append(el("caption", caption));
    const head = el("thead"), tr = el("tr");
    for (const title of headers) { const th = el("th", title); th.scope = "col"; tr.append(th); }
    head.append(tr); t.append(head);
    const body = el("tbody");
    for (const row of rows) {
        const line = el("tr");
        for (const value of row) { const td = el("td"); td.append(value instanceof Node ? value : document.createTextNode(String(value ?? "—"))); line.append(td); }
        body.append(line);
    }
    t.append(body); wrap.append(t); return wrap;
}
function setPath(obj, keys, value) {
    let target = obj;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = value;
}
function getPath(obj, keys) { return keys.reduce((value, key) => value?.[key], obj); }
function defaults() {
    const value = structuredClone(state.kit.config && Object.keys(state.kit.config).length ? state.kit.config : state.kit.template);
    // Template values like "<client name>" are hints, not answers.
    const clear = node => {
        for (const [key, item] of Object.entries(node || {})) {
            if (typeof item === "string" && item.startsWith("<")) node[key] = "";
            else if (Array.isArray(item)) node[key] = item.filter(entry => !(typeof entry === "string" && entry.startsWith("<")));
            else if (item && typeof item === "object") clear(item);
        }
    };
    clear(value);
    return value;
}
function configuration() {
    configDraft ??= defaults();
    const form = el("form");
    form.addEventListener("submit", event => event.preventDefault());
    function fields(schema, keys, container) {
        for (const [key, spec] of Object.entries(schema.properties || {})) {
            if (spec.deprecated) continue;
            const route = [...keys, key], value = getPath(configDraft, route);
            if (spec.type === "object") {
                const group = el("fieldset"); group.append(el("legend", t(`label.${key}`, { message: key })));
                fields(spec, route, group); container.append(group); continue;
            }
            const label = el("label", t(`label.${key}`, { message: key }));
            let input;
            const isLanguage = "/" + route.join("/") === state.kit.contract?.config?.language;
            if (spec.enum || isLanguage) {
                input = el("select");
                for (const item of isLanguage ? ["fr", "en"] : spec.enum) {
                    const option = el("option", isLanguage ? (item === "fr" ? "Français" : "English") : t(`enum.${item}`, { message: item }));
                    option.value = item; input.append(option);
                }
                if (isLanguage && value && !["fr", "en"].includes(value)) {
                    const option = el("option", `${value} · ${t("language.unsupported")}`); option.value = value; option.disabled = true; input.append(option);
                }
            } else input = el(spec.type === "array" ? "textarea" : "input");
            input.dataset.path = route.join(".");
            input.dataset.kind = spec.type === "array" ? (spec.items?.type === "object" ? "json" : "lines")
                : spec.type === "boolean" ? "boolean"
                : spec.type === "number" || spec.type?.includes?.("number") ? "number" : "string";
            if (input.tagName === "INPUT") input.type = input.dataset.kind === "boolean" ? "checkbox" : input.dataset.kind === "number" ? "number" : "text";
            if (input.type === "number") { input.step = "any"; if (spec.minimum !== undefined) input.min = String(spec.minimum); }
            if (input.type === "checkbox") input.checked = value === true;
            else input.value = input.dataset.kind === "json" ? JSON.stringify(value || [], null, 2)
                : input.dataset.kind === "lines" ? (value || []).join("\n") : value ?? "";
            if (formValues.has(input.dataset.path)) {
                if (input.type === "checkbox") input.checked = formValues.get(input.dataset.path);
                else input.value = formValues.get(input.dataset.path);
            }
            if (isLanguage) {
                const validateLanguage = () => input.setCustomValidity(["fr", "en"].includes(input.value) ? "" : t("language.unsupported"));
                validateLanguage(); input.addEventListener("change", validateLanguage);
            }
            input.addEventListener("input", () => formValues.set(input.dataset.path, input.type === "checkbox" ? input.checked : input.value));
            if (schema.required?.includes(key) && input.type !== "checkbox") input.required = true;
            label.append(input); container.append(label);
        }
    }
    fields(state.kit.schema, [], form);
    const prepare = button(t("config.prepare"), () => {
        if (!form.reportValidity()) return;
        const candidate = structuredClone(configDraft);
        delete candidate.kit;
        for (const input of form.querySelectorAll("[data-path]")) {
            const kind = input.dataset.kind;
            const value = kind === "boolean" ? input.checked : kind === "number" ? (input.value === "" ? null : Number(input.value))
                : kind === "json" ? JSON.parse(input.value) : kind === "lines" ? input.value.split("\n").map(s => s.trim()).filter(Boolean) : input.value;
            setPath(candidate, input.dataset.path.split("."), value);
        }
        configDraft = candidate;
        return preparePhase(configStep()?.id, candidate);
    }, "primary");
    form.append(prepare);
    main.append(el("p", t("config.intro"), "muted"), form);
}
function resolve(pattern, number = scenario) {
    let value = pattern;
    if (value.includes("{unit}") && contract().units) value = value.replaceAll("{unit}", contract().units.folder);
    value = value.replaceAll("{n}", String(number));
    for (const [name, replacement] of Object.entries(state.kit.placeholders || {})) value = value.replaceAll(`{${name}}`, replacement);
    return value;
}
const fileState = path => state.kit.files.find(file => file.path === path);
const variantKey = phase => {
    const review = modules().review;
    return review && phase.id === review.buildStep ? "corrections" : review && phase.id === review.reviewStep ? "rereview" : null;
};
// Steps 5 and 6 change purpose with the review loop of the scenario: apply corrections, then review again.
function variantOf(phase, number = scenario) {
    const loop = state.kit.tasks?.[String(number)]?.loop, key = variantKey(phase);
    return loop && key && loop.step === key && phase.variants?.[key] ? { key, text: phase.variants[key], loop } : null;
}
function stepText(phase, field, number = scenario) { return phaseText(variantOf(phase, number)?.text || phase, field, lang()); }
function stepTitle(phase, number = scenario, suffix = "") {
    const variant = variantOf(phase, number), title = stepText(phase, "title", number) + suffix;
    return variant ? t(`variant.${variant.key}`, { title, count: variant.loop.open.length, round: variant.loop.round + 1 }) : title;
}
function phaseState(phase, number = scenario) {
    const last = state.runs.findLast(run => run.phase === phase.id && (phase.scope !== "scenario" || run.scenario === number));
    const missing = phase.requires.map(p => resolve(p, number)).filter(p => !fileState(p)?.exists);
    if (phase.requiresBuiltScenario && !(state.kit.builtScenarios || []).length) missing.push(t("phase.builtScenario"));
    const outputs = phase.outputs.map(p => resolve(p, number));
    const present = outputs.filter(p => fileState(p)?.exists);
    const blocked = !phase.configures && (!state.kit.valid || missing.length > 0);
    const running = ongoing(last);
    let done = !running && (last?.status === "produced" || (outputs.length > 0 && present.length === outputs.length));
    if (phase.id === buildStep()) {
        // The task list exists from planning on: the build is done when every task is done and the unit has evidence.
        const tasks = (state.kit.tasks?.[String(number)]?.sections || []).flatMap(section => section.tasks);
        done = !running && (state.kit.builtScenarios || []).includes(number) && tasks.length > 0 && tasks.every(task => task.status === "done");
    }
    if (variantOf(phase, number)) done = false;
    const approvals = (phase.approves || []).map(path => resolve(path, number));
    const automatic = automaticallyCompletedBuild(state.kit, last) && !variantOf(phase, number);
    const approved = automatic || approvals.length > 0 && approvals.every(path => state.kit.validations?.[path]?.current);
    const reopened = approvals.some(path => state.kit.validations?.[path]?.reopened);
    return { last, missing, outputs, present, blocked, done: approved || (!reopened && done), approved, automatic, reopened,
        approvalsDone: approvals.filter(path => state.kit.validations?.[path]?.current).length, approvalsTotal: approvals.length };
}
function nextPhase() {
    const next = nextJourneyStep(state.kit.catalog.phases, state.runs, scenario,
        { tasks: state.kit.tasks, review: modules().review, preferSelectedUnit: preferredScenarioProject === state.project }, phaseState);
    return next ? { phase: next.step, number: next.unit } : null;
}
function phaseTitle(phase, number = scenario) {
    return stepTitle(phase, number, phase.scope === "scenario" ? ` · ${scenarioTitle(number)}` : "");
}
function scenarioTitle(number) {
    const title = state.kit.unitTitles?.[String(number)];
    const name = title?.replace(/^(?:scenario|scénario|topic|sujet|unit|unité)\s+\d+\s*[:.\-–—·]\s*/i, "").trim();
    return t("scenario.n", { n: number }) + (name ? ` · ${name}` : "");
}
function scenarioButtons(withNew) {
    const numbers = [...(state.kit.scenarios || [])];
    const next = (numbers.at(-1) || 0) + 1;
    const canAdd = withNew && !state.kit.unitCatalog;
    if (!numbers.includes(scenario) && !(canAdd && scenario === next)) scenario = numbers[0] ?? next;
    const picker = el("div", undefined, "segmented"); picker.setAttribute("role", "group"); picker.setAttribute("aria-label", t("scenario.label"));
    const add = (label, number) => {
        const b = button(label, () => { scenario = number; preferredScenarioProject = state.project; render(); });
        b.setAttribute("aria-label", label);
        b.setAttribute("aria-pressed", String(number === scenario)); picker.append(b);
    };
    for (const number of numbers) add(scenarioTitle(number), number);
    if (canAdd) add(t("journey.newScenario", { n: next }), next);
    return picker;
}
const activeRun = () => state.runs.findLast(ongoing);
function spinner(status) {
    const node = el("span", undefined, status === "paused" ? "pause-mark" : ["running", "pausing"].includes(status) ? "spinner" : "attention");
    node.setAttribute("aria-hidden", "true");
    return node;
}
function activeCard(active, withScenarioLink) {
    const phase = state.kit.catalog.phases.find(p => p.id === active.phase);
    const card = el("section", undefined, `focus-card active-card active-${active.status}`);
    card.setAttribute("role", "status");
    const body = el("div");
    const label = el("p", undefined, "activity-label");
    label.append(spinner(active.status), document.createTextNode(t(`active.${active.status}`)));
    body.append(el("strong", phase ? phaseTitle(phase, active.scenario) : active.phase), label);
    const when = active.startedAt ? new Date(active.startedAt).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : null;
    body.append(el("small", t(`active.${active.status}Hint`) + (when ? ` ${t("active.since", { time: when })}.` : "")));
    const blocks = (active.blocks || []).length;
    if (blocks) {
        const link = button(t("active.blocks", { n: blocks }), () => openSettings("guards"), "guard-link");
        body.append(link);
    }
    if (active.endGate?.alert) body.append(el("small", t("active.endGate", { list: active.endGate.failed.join(", ") }), "error"));
    card.append(body);
    if (withScenarioLink && active.scenario) {
        card.append(button(t("active.openScenario"), () => { scenario = active.scenario; selectView("scenarios"); }));
    }
    return card;
}
function statusBadge(text, status) {
    return el("span", text, `status-badge badge-${status}`);
}
function approvalDate(value) {
    const french = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(value);
    const date = new Date(french ? `${french[3]}-${french[2]}-${french[1]}T${french[4] || "00"}:${french[5] || "00"}:00` : value);
    return Number.isFinite(date.getTime()) ? date : null;
}
function phaseRow(phase, current, number = scenario) {
    const info = phaseState(phase, number);
    const row = el("li", undefined, "register-entry"), text = el("div", undefined, "register-body");
    row.dataset.phase = phase.id;
    if (current) { row.classList.add("register-current"); row.setAttribute("aria-current", "step"); }
    const running = ongoing(info.last);
    const approvals = (phase.approves || []).map(path => state.kit.validations?.[resolve(path, number)])
        .filter(item => item?.current && item.date).map(item => ({ label: item.date, date: approvalDate(item.date) }))
        .sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
    const approvedAt = info.approved ? approvals.at(-1) : null;
    const modified = Math.max(0, ...info.present.map(path => fileState(path)?.modified || 0));
    const timestamp = approvedAt?.date || info.last?.endedAt || info.last?.startedAt || (modified ? modified * 1000 : null);
    const when = el(timestamp ? "time" : "span", timestamp ? new Date(timestamp).toLocaleString(locale(), {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    }) : "—", "register-date");
    if (timestamp) { when.dateTime = new Date(timestamp).toISOString(); when.title = new Date(timestamp).toLocaleString(locale()); }
    const status = info.automatic ? t("journey.automatic")
        : info.approved ? (approvedAt ? t("journey.approvedAt", { date: approvedAt.date?.toLocaleDateString(locale()) || approvedAt.label }) : t("validation.validated"))
        : running ? t(["pausing", "paused"].includes(info.last.status) ? `run.${info.last.status}` : info.last.status === "waiting" ? "journey.waiting" : "journey.running")
        : info.reopened ? t("validation.reopened")
        : info.blocked ? t("phase.prereqMissing")
        : ["error", "interrupted"].includes(info.last?.status) ? t(`run.${info.last.status}`)
        : info.last?.endGate?.alert ? t("run.unconfirmed")
        : info.done ? t("phase.filesPresent")
        : info.last ? t(`run.${info.last.status}`) : t("journey.upcoming");
    const tone = info.approved ? "approved" : running ? info.last.status
        : info.blocked || info.reopened ? "waiting" : info.last?.status === "error" ? "error" : "upcoming";
    const line = statusBadge(status, tone);
    if (!info.approved && info.approvalsDone) line.append(document.createTextNode(` · ${t("validation.partial", { n: info.approvalsDone, total: info.approvalsTotal })}`));
    text.append(el("strong", stepTitle(phase, number)));
    const summary = stepText(phase, "summary", number);
    if (summary) text.append(el("small", summary));
    if (info.blocked) text.append(el("small", !state.kit.valid ? t("phase.configureFirst") : t("phase.prereq", { list: info.missing.join(", ") }), "error"));
    if (info.present.length) {
        const links = el("div", undefined, "file-links");
        for (const path of info.present) links.append(readButton(path, path.split("/").at(-1)));
        text.append(links);
    }
    const blocks = running ? (info.last.blocks || []).length : 0;
    if (blocks) text.append(button(t("active.blocks", { n: blocks }), () => openSettings("guards"), "guard-link"));
    if (!info.approved && info.last?.endGate?.alert) text.append(el("small", t("active.endGate", { list: info.last.endGate.failed.join(", ") }), "error"));
    const action = button(t(running || info.automatic ? "convo.goto" : "phase.prepare"), async () => {
        if (running || info.automatic) {
            await loadConversation(info.last.sessionId);
            selectView("conversation");
        } else if (phase.configures) openSettings("config");
        else await preparePhase(phase.id, undefined, number);
    }, current ? "primary" : undefined);
    if (running && info.last.status === "running") action.textContent = t("journey.follow");
    action.disabled = !running && !info.automatic && (info.approved || state.runtime.busy || info.blocked);
    if (info.approved && !info.automatic) action.title = t("step.approved");
    const actions = el("div", undefined, "phase-actions"); actions.append(line, action);
    if (info.approved && !info.automatic) {
        const reopen = button(t("validation.reopen"), () => reopenDialog(phase, number));
        reopen.disabled = state.runtime.busy; actions.append(reopen);
    }
    row.append(when, text, actions);
    return row;
}
function goToPhase(id) {
    highlight = id; reading = []; origin = null;
    selectView("journey");
}
function openSettings(tab) { settingsTab = tab; selectView("settings"); }
function modelControls(options, initialModel, initialContext) {
    const node = el("div", undefined, "model-selection");
    const model = el("select"), context = el("select"), effort = el("select");
    model.setAttribute("aria-label", t("chat.model"));
    context.setAttribute("aria-label", t("launch.contextLabel"));
    const hint = el("small", "", "muted");
    const field = (label, input) => { const wrapper = el("label", label); wrapper.append(input); node.append(wrapper); };
    field(t("chat.model"), model); field(t("launch.contextLabel"), context);
    const effortField = el("label", t("launch.effort")); effortField.append(effort); node.append(effortField);
    effort.setAttribute("aria-label", t("launch.effort"));
    for (const item of options.models || []) {
        const option = el("option", item.name || item.id); option.value = item.id; model.append(option);
    }
    model.value = (options.models || []).some(item => item.id === initialModel) ? initialModel : options.models?.[0]?.id || "";
    const update = preferred => {
        const selected = options.models?.find(item => item.id === model.value);
        const retainedEffort = effort.value;
        effort.replaceChildren();
        const defaultEffort = el("option", t("launch.effortDefault", { effort: selected?.defaultReasoningEffort || t("launch.providerDefault") }));
        defaultEffort.value = ""; effort.append(defaultEffort);
        for (const value of selected?.supportedReasoningEfforts || []) {
            const option = el("option", value); option.value = value; effort.append(option);
        }
        effort.value = selected?.supportedReasoningEfforts?.includes(retainedEffort) ? retainedEffort : "";
        effortField.hidden = !selected?.supportedReasoningEfforts?.length;
        effort.disabled = effortField.hidden;
        const tiers = selected?.contextTiers?.length ? selected.contextTiers : [{ id: "default" }];
        context.replaceChildren();
        for (const tier of tiers) {
            const limit = Number.isFinite(tier.maxInputTokens) ? t("launch.inputBudget", { n: new Intl.NumberFormat(locale()).format(tier.maxInputTokens) })
                : Number.isFinite(tier.tokens) ? `${new Intl.NumberFormat(locale()).format(tier.tokens)} tokens` : t("convo.notReported");
            const option = el("option", `${t(tier.id === "long_context" ? "convo.longContext" : "convo.standardContext")} · ${limit}`);
            option.value = tier.id; context.append(option);
        }
        const retained = tiers.some(tier => tier.id === preferred);
        context.value = retained ? preferred : "default";
        context.disabled = !selected || tiers.length < 2;
        model.disabled = !selected;
        hint.textContent = !retained && preferred === "long_context" ? t("launch.contextReset") : "";
    };
    update(initialContext || "default");
    model.addEventListener("change", () => update(context.value));
    return { node, hint, model, context, effort };
}
function catalogNotice(options, retry) {
    const node = el("div", undefined, "catalog-status"); node.setAttribute("role", "status");
    const catalog = options.catalog;
    if (catalog?.source === "cache") {
        node.append(el("p", t("catalog.cached", { date: catalog.fetchedAt ? new Date(catalog.fetchedAt).toLocaleString(locale()) : t("convo.notReported") }), "muted"));
    } else if (catalog?.source === "kit") node.append(el("p", t("catalog.kit"), "muted"));
    if (catalog?.error) node.append(el("p", catalog.error, "error"));
    if (!options.models?.length) node.append(el("p", t("catalog.empty"), "error"));
    if (catalog?.source !== "live" || !options.models?.length) {
        node.append(button(t("catalog.retry"), retry));
    }
    return node;
}
async function preparePhase(phase, config, number = scenario, files = []) {
    const draft = await api("/prepare", { step: phase, unit: number, config });
    showNotice("");
    const content = document.querySelector("#confirm-content");
    content.replaceChildren();
    const title = el("h2", draft.step); title.id = "confirm-title";
    content.append(title);
    if (draft.summary) content.append(el("h3", t("launch.does")), el("p", draft.summary));
    if (draft.returns) content.append(el("h3", t("launch.returns")), el("p", draft.returns));
    content.append(el("h3", t("launch.title")), el("p", draft.agent));
    const controls = modelControls(draft, draft.model, draft.contextTier);
    content.append(controls.node, controls.hint, catalogNotice(draft, async () => {
        await api("/models/refresh");
        await preparePhase(phase, config, number, files);
    }));
    if (draft.modelSwitch) content.append(el("p", draft.models?.length > 1 ? t("launch.mappedModels") : draft.modelSwitch, "muted"));
    content.append(el("p", draft.notice));
    if (draft.shared) content.append(el("p", draft.shared, "muted"));
    content.append(el("code", draft.skill));
    if (draft.unit) content.append(el("p", scenarioTitle(draft.unit)));
    if (draft.config) content.append(el("pre", JSON.stringify(draft.config, null, 2)));
    content.append(attachmentsField(files));
    const actions = el("div", undefined, "actions");
    actions.append(button(t("launch.cancel"), () => dialog.close()));
    const launch = button(t("launch.confirm"), async () => {
        launch.disabled = true;
        try { const started = await api("/launch", { ticket: draft.ticket, attachments: files.map(file => file.path),
            model: controls.model.value, contextTier: controls.context.value, reasoningEffort: controls.effort.value }); dialog.close(); preferredScenarioProject = null;
            convo.sessionId = started.sessionId; view = "conversation"; await refresh(true); }
        catch (error) { dialog.close(); throw error; }
        finally { launch.disabled = false; }
    }, "primary");
    launch.disabled = !draft.models?.length;
    actions.append(launch); content.append(actions); dialog.showModal();
}
function feedbackDialog(number) {
    const content = document.querySelector("#confirm-content");
    const title = el("h2", t("feedback.title", { n: number })); title.id = "confirm-title";
    const form = el("form"); form.addEventListener("submit", event => event.preventDefault());
    const field = (label, input) => { const node = el("label", label); node.append(input); form.append(node); return input; };
    const text = field(t("feedback.text"), el("textarea")); text.required = true; text.maxLength = 600;
    const screen = field(t("feedback.screen"), el("input")); screen.maxLength = 120;
    const priority = field(t("feedback.priority"), el("select"));
    for (const value of ["high", "medium", "low"]) { const option = el("option", t(`feedback.${value}`)); option.value = value; priority.append(option); }
    priority.value = "medium";
    const files = [];
    form.append(attachmentsField(files));
    const actions = el("div", undefined, "actions");
    const save = button(t("feedback.save"), async () => {
        if (!form.reportValidity()) return;
        save.disabled = true;
        try {
            const result = await api("/feedback", { unit: number, text: text.value, screen: screen.value, priority: priority.value, attachments: files.map(file => file.path) });
            dialog.close(); showNotice(t("feedback.added", { id: result.id })); await refresh(true);
        } finally { save.disabled = false; }
    }, "primary");
    actions.append(button(t("launch.cancel"), () => dialog.close()), save);
    form.append(actions);
    content.replaceChildren(title, el("p", t("feedback.intro"), "muted"), form);
    dialog.showModal(); text.focus();
}
function readButton(path, label = t("files.read")) {
    const node = button(label, () => openReader(path));
    node.dataset.path = path;
    node.setAttribute("aria-label", `${t("files.read")} ${path}`);
    return node;
}
// Approval of a deliverable: shared in <root>/state/validations.md, outdated as soon as the file changes.
function validationCell(file) {
    const plan = file.path.match(/\/build\/scenario-(\d+)\/tasks\.md$/);
    if (plan) {
        const tasks = state.kit.tasks?.[plan[1]];
        if (!tasks?.approved) return el("span", t("validation.planPending"), "muted");
        const cell = el("div", undefined, "validation"), icon = chip("done");
        icon.setAttribute("aria-label", t("validation.validated")); icon.title = t("validation.validated");
        cell.append(icon, el("span", t("validation.plan", { approval: tasks.approval })));
        return cell;
    }
    const step = state.kit.approvable?.[file.path];
    if (!step || !file.exists) {
        const none = el("span", "—"); if (!step) none.title = t("validation.none"); return none;
    }
    const entry = state.kit.validations?.[file.path];
    const cell = el("div", undefined, "validation");
    if (entry?.current) {
        const icon = chip("done"); icon.setAttribute("aria-label", t("validation.validated")); icon.title = t("validation.validated");
        cell.append(icon, el("span", t("validation.done", { date: entry.date, by: entry.by })));
        if (entry.comment) cell.append(el("small", entry.comment, "note"));
        const approved = button(t("validation.validated"), () => {}); approved.disabled = true; cell.append(approved);
        return cell;
    }
    cell.append(entry?.reopened ? el("span", t("validation.reopened"), "muted")
        : entry ? el("span", t("validation.changed", { date: entry.date, by: entry.by }), "error") : el("span", t("validation.todo"), "muted"));
    const action = button(t(entry ? "validation.again" : "validation.approve"), () => approveDialog(file.path));
    action.setAttribute("aria-label", `${t(entry ? "validation.again" : "validation.approve")} ${file.path}`);
    cell.append(action);
    return cell;
}
function approveDialog(path) {
    const content = document.querySelector("#confirm-content");
    const title = el("h2", t("validation.title")); title.id = "confirm-title";
    const root = state.kit.config.paths?.root || "poc";
    const form = el("form"); form.addEventListener("submit", event => event.preventDefault());
    const label = el("label", t("validation.comment")), comment = el("textarea"); comment.maxLength = 300; label.append(comment); form.append(label);
    const actions = el("div", undefined, "actions");
    const save = button(t("validation.approve"), async () => {
        save.disabled = true;
        try {
            await api("/approve", { path, comment: comment.value });
            dialog.close(); showNotice(t("validation.added", { path }));
            await refresh(true);
        } finally { save.disabled = false; }
    }, "primary");
    actions.append(button(t("launch.cancel"), () => dialog.close()), save);
    form.append(actions);
    const file = el("p"); file.append(el("code", path));
    content.replaceChildren(title, file, el("p", t("validation.intro", { file: modules().approvals ? resolve(modules().approvals.file) : "" }), "muted"), form);
    dialog.showModal(); save.focus();
}
function reopenDialog(phase, number) {
    const content = document.querySelector("#confirm-content");
    const title = el("h2", t("validation.reopenTitle")); title.id = "confirm-title";
    const actions = el("div", undefined, "actions");
    const save = button(t("validation.reopen"), async () => {
        save.disabled = true;
        try {
            await api("/reopen", { step: phase.id, unit: number });
            dialog.close(); showNotice(t("validation.reopened")); await refresh(true);
        } finally { save.disabled = false; }
    }, "primary");
    actions.append(button(t("launch.cancel"), () => dialog.close()), save);
    content.replaceChildren(title, el("p", phaseTitle(phase, number)), el("p", t("validation.reopenHint")),
        el("pre", (phase.approves || []).map(path => resolve(path, number)).join("\n")), actions);
    dialog.showModal();
}
function openFileButton(path, original = false) {
    return button(t(original ? "files.original" : "files.open"), () => api("/files/open", { path }));
}
function documentActions(file) {
    const actions = el("div", undefined, "document-actions");
    if (/\.(md|txt|json|csv|ya?ml)$/i.test(file.path)) actions.append(readButton(file.path));
    actions.append(openFileButton(file.path));
    return actions;
}
async function openReader(path) {
    const result = await api("/preview", { path });
    if (!reading.length) origin = { view, scrollTop: main.scrollTop, focus: path };
    else reading.at(-1).scrollTop = main.scrollTop;
    reading.push({ path: result.path, content: result.content });
    render(); main.scrollTop = 0; main.focus();
}
function closeReader() {
    reading.pop();
    if (reading.length) { render(); main.scrollTop = reading.at(-1).scrollTop || 0; main.focus(); return; }
    const from = origin; origin = null;
    view = from?.view || view;
    render();
    main.scrollTop = from?.scrollTop || 0;
    (main.querySelector(`button[data-path="${CSS.escape(from?.focus || "")}"]`) || main).focus();
}
async function reloadReader() {
    const current = reading.at(-1);
    try { current.content = (await api("/preview", { path: current.path })).content; }
    catch (error) { showError(error); }
}
function resolveRelative(base, href) {
    const target = href.split("#")[0];
    if (!target) return null;
    const parts = base.split("/").slice(0, -1);
    for (const part of decodeURIComponent(target).split("/")) {
        if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/");
}
function readerView() {
    const current = reading.at(-1);
    const bar = el("div", undefined, "reader-bar");
    bar.append(button(`← ${t("reader.back")}`, closeReader), el("h2", current.path));
    const actions = el("div", undefined, "document-actions"); actions.append(openFileButton(current.path)); bar.append(actions);
    const article = el("article", undefined, "markdown"); article.setAttribute("aria-label", t("reader.label"));
    if (!current.content.trim()) article.append(el("p", t("reader.empty"), "muted"));
    else if (current.path.endsWith(".json")) {
        let text = current.content;
        try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Shown as received. */ }
        article.append(el("p", t("reader.json"), "muted"), el("pre", text));
    } else if (!current.path.endsWith(".md")) article.append(el("pre", current.content));
    else article.append(renderMarkdown(parse(current.content), document, {
        chip,
        imageText: (alt, src) => t("reader.image", { alt: alt || "—", src }),
        link: safe => {
            // The window cannot open tabs: web links open in the default browser through Vibe Studio.
            if (safe.kind === "external") return { kind: "app", href: safe.href, open: () => api("/link", { url: safe.href }).catch(showError) };
            if (safe.kind !== "relative") return safe;
            const target = resolveRelative(current.path, safe.href);
            const known = target && (state.kit?.files.some(f => f.path === target && f.exists) || state.kit?.conversions?.includes(target));
            return known ? { ...safe, open: () => openReader(target).catch(showError) } : safe;
        },
    }));
    main.append(bar, article);
}
function servesCell(serves, requirements = {}) {
    if (!serves) return "—";
    const cell = el("span");
    for (const part of serves.split(/(,\s*)/)) {
        const code = part.trim();
        if (/^,/.test(part) || !code) cell.append(document.createTextNode(part));
        else if (code.toLowerCase() === "setup") cell.append(document.createTextNode(t("tasks.setup")));
        else if (requirements[code]) { const abbr = el("abbr", code); abbr.title = `${code} · ${requirements[code]}`; cell.append(abbr); }
        else cell.append(document.createTextNode(part));
    }
    return cell;
}
async function readCosts() {
    const project = state?.project;
    if (costsRequest?.project === project) return costsRequest.promise;
    clearTimeout(costsTimer); costsTimer = null; costsDirty = false; costsReadAt = Date.now();
    const request = { project };
    costsRequest = request;
    costsLoading = true;
    request.promise = (async () => {
        try {
            const report = await api("/costs");
            if (costsRequest === request && state?.project === project) { costs = report; costsFor = project; }
        } finally {
            if (costsRequest === request) {
                costsLoading = false; costsRequest = null;
                if (["journey", "costs"].includes(view) && !reading.length && !dialog.open) render();
                if (costsDirty) scheduleCosts();
            }
        }
    })();
    return request.promise;
}
function scheduleCosts() {
    if (!state?.kit?.contract?.modules?.costs) return;
    costsDirty = true;
    if (costsTimer || costsRequest) return;
    const project = state.project;
    costsTimer = setTimeout(() => {
        costsTimer = null;
        if (state?.project === project && state?.kit?.contract?.modules?.costs) void readCosts().catch(showError);
    }, Math.max(1000, 5000 - (Date.now() - costsReadAt)));
}
setInterval(() => {
    if (state?.runs.some(run => ["running", "pausing"].includes(run.status)) || state?.chats?.some(chat => chat.busy)) scheduleCosts();
}, 10000);
const ICONS = { done: ["M3.5 8.5l3 3 6-7"], blocked: ["M4.5 4.5l7 7", "M11.5 4.5l-7 7"], todo: [] };
function chip(status) {
    const label = t(`task.${status}`, { message: status });
    const node = el("span", undefined, `status-icon status-${status}`);
    node.setAttribute("role", "img"); node.setAttribute("aria-label", label); node.title = label;
    if (status === "in_progress") { node.append(el("span", undefined, "spinner")); return node; }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("aria-hidden", "true");
    if (status === "todo") {
        const circle = document.createElementNS(svg.namespaceURI, "circle");
        for (const [k, v] of [["cx", 8], ["cy", 8], ["r", 6]]) circle.setAttribute(k, v);
        svg.append(circle);
    }
    for (const d of ICONS[status] || []) {
        const path = document.createElementNS(svg.namespaceURI, "path");
        path.setAttribute("d", d); svg.append(path);
    }
    node.append(svg);
    return node;
}
const clock = seconds => {
    const date = new Date(seconds * 1000), today = new Date().toDateString() === date.toDateString();
    return date.toLocaleString(locale(), today ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
function tasksSection() {
    const data = state.kit.tasks?.[String(scenario)];
    main.append(el("p", t("tasks.intro"), "muted"));
    if (!data) { main.append(el("p", t("tasks.none"))); return; }
    for (const warning of data.warnings) main.append(el("p", t(warning, { message: warning }), "error"));
    main.append(el("p", t("tasks.plan", { status: data.approval || t("tasks.planUnknown") }), data.approved ? "muted" : "error"));
    const all = data.sections.flatMap(section => section.tasks);
    if (!all.length) return;
    const count = status => all.filter(task => task.status === status).length;
    const done = count("done");
    const summary = el("div", undefined, "task-summary");
    const meter = el("progress"); meter.max = all.length; meter.value = done;
    meter.setAttribute("aria-label", t("tasks.meter", { done, total: all.length }));
    summary.append(el("strong", t("tasks.done", { done, total: all.length })), meter);
    const counts = el("p", undefined, "counts");
    for (const status of ["in_progress", "blocked", "todo", "done"]) {
        const item = el("span", undefined, "count"), icon = chip(status);
        if (!count(status)) icon.classList.add("idle");
        item.append(icon, el("span", String(count(status)))); counts.append(item);
    }
    summary.append(counts);
    main.append(summary);
    const current = all.filter(task => task.status === "in_progress");
    const blocked = all.filter(task => task.status === "blocked");
    const active = activeRun();
    const building = active?.phase === buildStep() && active.scenario === scenario;
    for (const task of [...current, ...blocked]) {
        const box = el("div", undefined, `current current-${task.status}`);
        const head = el("div", undefined, "current-head"); head.append(chip(task.status), el("strong", task.id));
        box.append(head, el("p", task.goal));
        if (task.note) box.append(el("small", task.note));
        main.append(box);
    }
    const next = building && !current.length ? all.find(task => task.status === "todo") : null;
    if (next) {
        const box = el("div", undefined, "current current-next");
        box.setAttribute("role", "status");
        const head = el("div", undefined, "current-head"); head.append(chip("todo"), el("strong", next.id));
        box.append(head, el("p", next.goal), el("small", t("tasks.nextHint")));
        main.append(box);
    }
    if (data.modified) main.append(el("p", t("tasks.updated", { time: clock(data.modified) }), "muted"));
    if (data.loop?.round) main.append(el("p", t("tasks.loop", { round: data.loop.round, open: data.loop.open.length, unreviewed: data.loop.unreviewed.length }), "muted"));
    const run = state.runs.findLast(item => item.phase === buildStep() && item.scenario === scenario && item.task);
    if (run) {
        const file = all.find(task => task.id === run.task.id);
        const when = new Date(run.task.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
        main.append(el("p", t("tasks.reported", { id: run.task.id, status: t(`task.${run.task.status}`).toLowerCase(), time: when }), "muted"));
        if (file && file.status !== run.task.status) main.append(el("p", t("tasks.mismatch", { status: t(`task.${file.status}`), id: file.id }), "muted"));
    }
    main.append(el("p", t("tasks.legend"), "muted"));
    for (const section of data.sections) {
        const finished = section.tasks.filter(task => task.status === "done").length;
        main.append(el("h3", `${section.title} · ${finished}/${section.tasks.length}`));
        const list = table([t("tasks.col.status"), t("tasks.col.task"), t("tasks.col.goal"), t("tasks.col.serves"), t("correction.actions")], section.tasks.map(task => {
            const goal = el("div"); goal.append(el("span", task.goal));
            if (task.note) goal.append(el("small", task.note, "note"));
            const actions = el("div", undefined, "correction-actions");
            if (/^R\d+[a-z]?$/.test(task.id)) {
                const disabled = state.runs.some(run => ongoing(run) && run.scenario === scenario) || state.chats?.some(chat => chat.busy);
                for (const [action, handler] of [
                    ["edit", () => correctionDialog(task)],
                    ["validate", () => changeCorrection(task, "validate")],
                    ["delete", () => changeCorrection(task, "delete")],
                ]) {
                    if (action === "validate" && task.status === "done") continue;
                    const control = button(t(`correction.${action}`), handler);
                    control.disabled = !!disabled;
                    control.title = t(disabled ? "feedback.busy" : "correction.manual");
                    actions.append(control);
                }
            }
            return [chip(task.status), task.id, goal, servesCell(task.serves, data.requirements), actions];
        }));
        list.querySelector("table").classList.add("tasks");
        main.append(list);
    }
    async function changeCorrection(task, action, changes = {}) {
        if (action !== "edit" && !await confirmDialog(t(`correction.${action}`), t(`correction.${action}Confirm`, { id: task.id }), t(`correction.${action}`))) return;
        await api("/correction", { unit: scenario, id: task.id, revision: task.revision, action, ...changes });
        await refresh(true);
    }
    function correctionDialog(task) {
        const content = document.querySelector("#confirm-content");
        const title = el("h2", `${t("correction.edit")} · ${task.id}`); title.id = "confirm-title";
        const form = el("form"); form.addEventListener("submit", event => event.preventDefault());
        const field = (name, control) => {
            const label = el("label", t(name)); control.setAttribute("aria-label", t(name));
            label.append(control); form.append(label); return control;
        };
        const text = field("feedback.text", el("textarea")); text.required = true;
        text.maxLength = task.feedback ? 600 : 6000; text.value = task.feedback?.text ?? task.body;
        let screen, priority;
        if (task.feedback) {
            screen = field("feedback.screen", el("input")); screen.maxLength = 120; screen.value = task.feedback.screen;
            priority = field("feedback.priority", el("select"));
            for (const value of ["high", "medium", "low"]) { const option = el("option", t(`feedback.${value}`)); option.value = value; priority.append(option); }
            priority.value = task.feedback.priority;
        }
        const actions = el("div", undefined, "actions");
        actions.append(button(t("launch.cancel"), () => dialog.close()), button(t("correction.save"), async () => {
            if (!form.reportValidity()) return;
            await api("/correction", { unit: scenario, id: task.id, revision: task.revision, action: "edit",
                text: text.value, ...(task.feedback ? { screen: screen.value, priority: priority.value } : {}) });
            dialog.close(); await refresh(true);
        }, "primary"));
        form.append(actions);
        content.replaceChildren(title, el("p", t("correction.manual"), "muted"), form); dialog.showModal();
    }
    const conv = data.convergence;
    if (conv.rows) main.append(el("p", t("tasks.walkthrough", { filled: conv.filled, rows: conv.rows }), "muted"));
}
function journeyIndicators(active) {
    const strip = el("div", undefined, "indicator-strip");
    strip.setAttribute("role", "group"); strip.setAttribute("aria-label", t("journey.live"));
    const cell = (id, label, value, action, attention = false) => {
        const node = button(undefined, action, `indicator-cell${attention ? " indicator-attention" : ""}`);
        node.dataset.indicator = id;
        node.append(el("span", label, "indicator-label"), el("strong", value));
        strip.append(node);
    };
    const sessions = new Set([...state.runs, ...(state.chats || [])].map(item => item.sessionId));
    const pending = [...waitingRequests].filter(([, id]) => sessions.has(id));
    const busyChat = state.chats?.findLast(chat => chat.busy);
    cell("session", t("journey.session"), t(["pausing", "paused"].includes(active?.status) ? `run.${active.status}` : active || busyChat ? "journey.running" : "journey.idle"), async () => {
        const sessionId = active?.sessionId || busyChat?.sessionId;
        if (sessionId) await loadConversation(sessionId);
        selectView("conversation");
    });
    cell("questions", t("journey.questions"), pending.length ? t("journey.pending", { n: pending.length })
        : active?.status === "waiting" ? t("journey.waiting") : t("journey.noQuestions"), async () => {
        const sessionId = pending.at(-1)?.[1] || active?.sessionId;
        if (sessionId) await loadConversation(sessionId);
        selectView("conversation");
    }, pending.length > 0 || active?.status === "waiting");
    const guardRun = active || state.runs.find(item => item.id === state.guards?.runId);
    cell("guards", t("guards.tab"), t("journey.blocks", { n: (guardRun?.blocks || []).length }), () => openSettings("guards"));
    const credits = costsFor === state.project && costs?.sessionCount > 0 ? costs?.total?.usage?.credits : null;
    const consumption = Number.isFinite(credits) ? t("journey.credits", {
        n: new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(credits),
    }) : t("journey.unmeasured");
    cell("costs", t("journey.consumption"), consumption, () => selectView("costs"));
    const costCell = strip.lastElementChild;
    if (!modules().costs) {
        costCell.disabled = true;
        costCell.lastElementChild.textContent = t("journey.costsUnavailable");
    } else costCell.append(el("span", t("space.costs"), "indicator-link"));
    return strip;
}
function journeyView() {
    const phases = state.kit.catalog.phases;
    const active = activeRun();
    const suggestion = active ? null : nextPhase();
    if (suggestion && preferredScenarioProject !== state.project) scenario = suggestion.number;
    const picker = scenarioButtons(true);
    const extraActivePhase = active?.scenario && active.scenario !== scenario ? phases.find(phase => phase.id === active.phase) : null;
    const current = phase => active ? phase.id === active.phase && (phase.scope !== "scenario" || active.scenario === scenario)
        : phase.id === suggestion?.phase.id && (phase.scope !== "scenario" || suggestion.number === scenario);
    const surface = el("section", undefined, "journey");
    surface.setAttribute("aria-label", t("space.journey"));
    const displayed = phases.map(phase => phaseState(phase));
    if (extraActivePhase) displayed.push(phaseState(extraActivePhase, active.scenario));
    const approved = displayed.filter(info => info.approved).length;
    surface.append(el("p", t("journey.summary", {
        n: approved, total: displayed.length, files: state.kit.files.filter(file => file.exists).length,
    }), "journey-summary muted"), journeyIndicators(active));
    const scroll = el("div", undefined, "journey-scroll");
    scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", t("journey.register"));
    const list = el("ol", undefined, "register");
    if (extraActivePhase) {
        const row = phaseRow(extraActivePhase, true, active.scenario);
        row.querySelector("strong").textContent = phaseTitle(extraActivePhase, active.scenario);
        list.append(row);
    }
    let block = null;
    for (const phase of phases) {
        if (phase.scope !== "scenario") { list.append(phaseRow(phase, current(phase))); continue; }
        if (!block) {
            const item = el("li", undefined, "scenario-block");
            block = el("ol", undefined, "register");
            item.append(el("h2", t("journey.scenarios")), picker, block);
            const title = state.kit.unitTitles?.[String(scenario)];
            if (title) item.insertBefore(el("p", scenarioTitle(scenario), "scenario-title"), block);
            list.append(item);
        }
        block.append(phaseRow(phase, current(phase)));
    }
    scroll.append(list);
    if (state.runs.length) {
        const details = el("details", undefined, "history"); details.open = historyOpen;
        details.addEventListener("toggle", () => { historyOpen = details.open; });
        details.append(el("summary", t("journey.history", { n: state.runs.length })),
            table([t("journey.col.step"), t("journey.col.scenario"), t("journey.col.status"), ""], state.runs.slice(-20).reverse().map(r => {
                const own = true;
                const canClose = ongoing(r);
                const phase = phases.find(p => p.id === r.phase);
                return [phase ? phaseText(phase, "title", lang()) : r.phase, r.scenario ? scenarioTitle(r.scenario) : "—", t(`run.${r.status}`) + (own ? "" : t("journey.otherSession")),
                    canClose ? button(t("journey.close"), async () => {
                        if (!await confirmDialog(t("journey.close"), t("journey.closeConfirm"), t("journey.close"))) return;
                        await api("/close", { runId: r.id }); await refresh(true);
                    }) : ""];
            })));
        scroll.append(details);
    }
    surface.append(scroll); main.append(surface);
}
function scenariosView() {
    const numbers = state.kit.scenarios || [];
    const plan = state.kit.catalog.phases.find(p => p.scope === "scenario");
    if (!numbers.length) {
        main.append(el("p", t("scenarios.none")));
        if (plan) main.append(button(phaseText(plan, "title", lang()), () => goToPhase(plan.id), "primary"));
        return;
    }
    const active = activeRun();
    if (active?.scenario) main.append(activeCard(active, active.scenario !== scenario));
    main.append(scenarioButtons(false));
    const following = state.kit.catalog.phases.filter(p => p.scope === "scenario").find(p => !phaseState(p).done);
    const head = el("div", undefined, "scenario-head");
    if (following && active?.scenario !== scenario) head.append(button(t("scenarios.next", { title: stepTitle(following) }), () => goToPhase(following.id), "primary"));
    if ((state.kit.builtScenarios || []).includes(scenario) && state.kit.tasks?.[String(scenario)]) {
        const add = button(t("feedback.add"), () => feedbackDialog(scenario));
        add.disabled = active?.scenario === scenario;
        if (add.disabled) add.title = t("feedback.busy");
        head.append(add);
    }
    const folder = resolve("{unit}/"), files = contract().units ? state.kit.files.filter(f => f.path.startsWith(folder) && f.exists) : [];
    if (files.length) {
        const links = el("div", undefined, "file-links"); links.setAttribute("role", "group"); links.setAttribute("aria-label", t("scenarios.files"));
        links.append(el("span", t("scenarios.files"), "muted"));
        for (const file of files) links.append(readButton(file.path, file.path.split("/").at(-1)));
        head.append(links);
    }
    main.append(head);
    tasksSection();
}
function deliverablesView() {
    main.append(el("p", t("deliverables.intro"), "muted"));
    if (state.kit.valid && !Object.keys(state.kit.approvable || {}).length) main.append(el("p", t("validation.update"), "muted"));
    if (state.kit.validationWarning) main.append(el("p", t(state.kit.validationWarning), "error"));
    const producers = new Map();
    for (const phase of state.kit.catalog.phases) {
        const numbers = phase.scope === "scenario" ? (state.kit.scenarios?.length ? state.kit.scenarios : [1]) : [1];
        for (const number of numbers) for (const pattern of phase.outputs) {
            const path = resolve(pattern, number);
            if (!producers.has(path)) producers.set(path, phase);
        }
    }
    const glob = pattern => new RegExp("^" + resolve(pattern).split("**").map(part => part.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$");
    const groups = (contract().deliverables?.groups || []).map(g => ({ ...g, matchers: g.patterns.map(glob) }));
    const group = path => groups.find(g => g.matchers.some(m => m.test(path)))?.id || "other";
    const titles = Object.fromEntries(groups.map(g => [g.id, phaseText(g, "title", lang())]));
    for (const key of [...groups.map(g => g.id), "other"]) {
        const files = state.kit.files.filter(file => group(file.path) === key)
            .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
        if (!files.length) continue;
        main.append(el("h3", titles[key] || t("deliverables.group.other")));
        const wrap = table([t("files.deliverable"), t("files.status"), t("files.validation"), t("files.view")], files.map(file => {
            const producer = producers.get(file.path);
            const status = file.exists ? t("files.present")
                : t("deliverables.missing") + (producer ? ` · ${t("deliverables.producedBy", { step: phaseText(producer, "title", lang()) })}` : "");
            return [file.path, status, validationCell(file), file.exists ? documentActions(file) : "—"];
        }));
        wrap.querySelectorAll("tbody tr").forEach((row, index) => { if (!files[index].exists) row.classList.add("missing"); });
        wrap.querySelector("table").classList.add("files");
        main.append(wrap);
    }
}
function sourcesView() {
    const folder = resolve(modules().sources.folder);
    main.append(el("p", t("sources.intro", { folder }), "muted"));
    if (state.kit.sources.length) main.append(table([t("sources.col.source"), t("sources.col.type")],
        state.kit.sources.map(s => [s.name, s.directory ? t("sources.folder") : t("sources.file")])));
    else main.append(el("p", t("sources.none")));
    const importPhase = state.kit.catalog.phases.find(p => p.id === modules().sources.importStep);
    if (importPhase) main.append(button(t("sources.import"), () => goToPhase(importPhase.id)));
    main.append(el("h3", t("sources.inventory")));
    const inventory = state.kit.inventory;
    if (!inventory) { main.append(el("p", t("sources.notImported"), "muted")); return; }
    const root = modules().sources.inventory ? resolve(modules().sources.inventory).split("/").slice(0, -1).join("/") : "";
    const number = value => new Intl.NumberFormat(locale()).format(value);
    const row = (label, item, nested) => {
        const warnings = [...(item.warnings || []), ...(item.warning ? [item.warning] : [])].join(" ; ");
        const path = item.convertedPath || (item.converted ? (root ? `${root}/${item.converted}` : item.converted) : null);
        const actions = el("div", undefined, "document-actions");
        if (path && item.convertedExists !== false && state.kit.conversions?.includes(path)) {
            actions.append(readButton(path), openFileButton(path));
        }
        if (item.originalPath) {
            const original = openFileButton(item.originalPath, true);
            original.disabled = !item.originalExists;
            if (original.disabled) original.title = t("files.missing");
            actions.append(original);
        } else if (nested) actions.append(el("span", t("sources.noOriginal"), "unavailable"));
        return [el("span", label, nested ? "nested" : undefined), item.type || "—",
            item.converted ? t("sources.chars", { n: number(item.chars || 0) }) : t("sources.notConverted"), warnings || "—",
            actions.childNodes.length ? actions : "—"];
    };
    const rows = [];
    for (const entry of inventory.sources || []) {
        rows.push(row(entry.path, entry, false));
        for (const item of entry.embedded || []) rows.push(row(t("sources.embedded", { name: item.name }), item, true));
    }
    main.append(table([t("sources.col.document"), t("sources.col.type"), t("sources.col.size"), t("sources.col.warnings"), t("sources.col.read")], rows));
    for (const error of inventory.errors || []) main.append(el("p", `${error.path}: ${error.error}`, "error"));
}
function costsView() {
    main.append(el("p", t("costs.intro"), "muted"), refreshButton(t("costs.read"), readCosts, "primary", costsLoading));
    if (!costs) { main.append(el("p", costsLoading ? t("costs.loading") : t("costs.none"), "muted")); return; }
    const number = value => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value);
    main.append(el("p", t("costs.when", { date: new Date(costs.generated_at).toLocaleString(locale()), n: costs.sessionCount })));
    if (!costs.sessionCount) main.append(el("p", t("costs.noSession"), "error"));
    else main.append(el("p", t("costs.total", { credits: number(costs.total.usage.credits) })));
    if (costs.budget) main.append(el("p", `${costs.budget.over ? t("costs.budgetOver") : costs.budget.percent >= 80 ? t("costs.budget80") : ""}${t("costs.budget", { consumed: number(costs.budget.consumed), credits: number(costs.budget.credits) })}`, costs.budget.percent >= 80 || costs.budget.over ? "error" : ""));
    if (costs.malformed_lines || costs.malformed_marks) main.append(el("p", t("costs.malformed"), "error"));
    main.append(table([t("costs.col.step"), t("journey.col.scenario"), t("costs.col.authors"), t("costs.col.credits"), t("costs.col.tokens"), t("costs.col.models"), t("costs.col.method")], costs.rows.map(r => [
        phaseText(state.kit.catalog.phases.find(phase => phase.id === r.phase), "title", lang()) || r.phase,
        r.scenario ? scenarioTitle(r.scenario) : "—", (r.authors || []).join(", ") || t("costs.unknownAuthor"), number(r.usage.credits),
        `${number(r.usage.input_tokens)} / ${number(r.usage.output_tokens)} / ${number(r.usage.cache_read_tokens + r.usage.cache_write_tokens)}`,
        (r.models_observed || []).join(", ") || t("costs.notObserved"), r.method.split(", ").map(m => t(`method.${m}`, { message: m })).join(", "),
    ])));
}
function kitStatus() {
    const runtime = state.runtime || {};
    const harness = runtime.login ? t("projects.connected", { login: runtime.login }) : state.harnessError || t("projects.notConnected");
    main.append(table([t("kit.col.item"), t("kit.col.value")], [[t("kit.extension"), `Vibe Studio ${state.vibeStudioVersion || "?"}`],
        [t("kit.kit"), `${phaseText(state.kit.kit, "name", lang())} · ${state.kit.kit.id} ${state.kit.kit.version || "?"}`],
        [t("kit.contract"), "vibe-studio.json"], [t("kit.harness"), `${state.harnessName || "Copilot CLI"} · ${harness}`],
        [t("kit.config"), state.kit.valid ? t("kit.valid") : t("kit.invalid")], [t("kit.mcp"), t("kit.mcpNote")]], t("kit.caption")));
    if (state.kit.errors.length) main.append(el("pre", (state.kit.errorItems || []).map(item => t(item.code, item)).join("\n") || state.kit.errors.join("\n")));
    main.append(el("h3", t("kit.packages")), table([t("kit.package"), t("kit.version")], state.kit.packages.map(p => [p.name, p.version])));
    main.append(el("p", t("kit.mcpDeclared", { list: state.kit.mcpNames.join(", ") || t("kit.mcpNone") }), "muted"));
    main.append(el("p", t("kit.update"), "muted"));
}
// About: what the kit is and does, read from its contract, and what Vibe Studio adds.
function aboutView() {
    main.append(updateControls(true));
    const kit = contract().kit || {};
    const name = phaseText(kit, "name", lang()) || state.kit.kit?.id;
    main.append(el("h3", t("about.kit", { name })));
    const facts = el("p", `${state.kit.kit?.id || kit.id || ""} ${state.kit.kit?.version || ""}`.trim(), "muted");
    main.append(facts);
    const description = phaseText(kit, "description", lang());
    if (description) main.append(el("p", description, "lead"));
    const about = phaseText(kit, "about", lang());
    if (about) main.append(markdownBlock(about));
    const steps = contract().steps || [];
    if (steps.length) {
        main.append(el("h3", t("about.steps")));
        main.append(table([t("about.col.step"), t("about.col.does"), t("about.col.returns")], steps.map((step, i) => {
            const title = el("div", undefined, "about-step"); title.append(el("strong", `${i + 1}. ${phaseText(step, "title", lang())}`));
            if (step.scope === "unit") title.append(el("small", t("about.perUnit"), "muted"));
            return [title, phaseText(step, "summary", lang()) || "—", phaseText(step, "returns", lang()) || "—"];
        })));
    }
    main.append(el("h3", t("about.vibeStudio")));
    const list = el("ol", undefined, "about-list");
    for (const key of ["about.a1", "about.a2", "about.a3", "about.a4", "about.a5"]) list.append(el("li", t(key)));
    main.append(el("p", t("about.vibeStudioIntro")), list, el("p", t("about.version", { version: state.vibeStudioVersion || "?" }), "muted"));
}
function updateControls(full = false) {
    const info = updateState || { status: "idle" };
    const box = el("section", undefined, "update-status");
    box.setAttribute("aria-label", t("updates.title")); box.setAttribute("aria-busy", String(updateWork));
    const message = info.status === "error" ? t("updates.error", { message: info.error })
        : t(`updates.${info.status}`, { version: info.version || "" });
    box.append(el("p", message, info.status === "error" ? "error" : undefined));
    const work = async route => {
        if (updateWork) return;
        updateWork = true; render();
        try { updateState = await api(route); }
        finally {
            updateWork = false;
            updateState = await api("/updates");
            if (state) state.updates = updateState;
            if (projects) projects.updates = updateState;
            render();
        }
    };
    const actions = el("div", undefined, "actions");
    const add = (label, action) => { const control = button(t(label), action); control.disabled = updateWork; actions.append(control); };
    if (info.status !== "disabled" && (full || info.status === "error" || info.status === "idle")) add("updates.check", () => work("/updates/check"));
    if (info.status === "available" && info.installed) add("updates.download", () => work("/updates/download"));
    if (info.status === "ready" && info.installed) add("updates.install", () => work("/updates/install"));
    if (info.releaseUrl) add("updates.release", () => api("/link", { url: info.releaseUrl }));
    if (updateWork) actions.append(el("span", t("updates.working"), "muted"));
    box.append(actions); return box;
}
function settingsView() {
    const personal = ["appearance", "alerts", "harness"].includes(settingsTab);
    const scopes = el("div", undefined, "segmented settings-scopes");
    scopes.setAttribute("role", "group"); scopes.setAttribute("aria-label", t("settings.scope"));
    for (const [id, tab] of [["personal", "appearance"], ["project", "config"]]) {
        const b = button(t(`settings.${id}`), () => { settingsTab = tab; render(); });
        b.setAttribute("aria-pressed", String(personal === (id === "personal"))); scopes.append(b);
    }
    main.append(scopes, el("p", t(personal ? "settings.personalHint" : "settings.projectHint"), "muted"));
    const tabs = el("div", undefined, "segmented"); tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", t("space.settings"));
    for (const tab of personal ? ["appearance", "alerts", "harness"] : ["config", "guards", "kit"]) {
        const b = button(["guards", "alerts", "harness"].includes(tab) ? t(`${tab}.tab`) : t(`settings.${tab}`), () => { settingsTab = tab; render(); });
        b.setAttribute("aria-pressed", String(settingsTab === tab)); tabs.append(b);
    }
    main.append(tabs);
    if (settingsTab === "appearance") appearanceView(); else if (settingsTab === "config") configuration(); else if (settingsTab === "guards") guardsView(); else if (settingsTab === "alerts") alertsView(); else if (settingsTab === "harness") harnessView(); else kitStatus();
}
function appearanceView() {
    if (!ensurePreferences()) return;
    const label = el("label", t("theme.label")), select = el("select");
    label.htmlFor = "theme-choice"; select.id = "theme-choice";
    for (const value of ["system", "light", "dark"]) {
        const option = el("option", t(`theme.${value}`)); option.value = value; select.append(option);
    }
    select.value = preferences.theme || "system";
    select.addEventListener("change", async () => {
        try { preferences = await api("/preferences", { theme: select.value }); applyTheme(); }
        catch (error) { select.value = preferences.theme || "system"; showError(error); }
    });
    const field = el("div", undefined, "preferences"); field.append(label, select); main.append(field);
}
// Alerts: preferences of this computer, for every project.
function alertsView() {
    main.append(el("p", t("alerts.intro"), "muted"));
    if (!preferences) { void api("/preferences").then(value => { preferences = value; render(); }).catch(showError); return; }
    const form = el("form", undefined, "preferences"); form.addEventListener("submit", event => event.preventDefault());
    for (const key of ["sound", "notifications"]) {
        const label = el("label", undefined, "check"), box = el("input"); box.type = "checkbox"; box.checked = !!preferences[key];
        box.addEventListener("change", async () => { preferences = await api("/preferences", { [key]: box.checked }); });
        const text = el("span"); text.append(el("strong", t(`alerts.${key}`)), el("small", t(`alerts.${key}Hint`), "muted"));
        label.append(box, text); form.append(label);
    }
    const themeLabel = el("label", t("alerts.theme")), theme = el("select");
    theme.setAttribute("aria-label", t("alerts.theme"));
    for (const id of Object.keys(SOUND_THEMES)) { const option = el("option", t(`sound.${id}`)); option.value = id; theme.append(option); }
    theme.value = preferences.soundTheme || "chime";
    theme.addEventListener("change", async () => {
        theme.disabled = true;
        try { preferences = await api("/preferences", { soundTheme: theme.value }); await chime("question", theme.value); }
        catch (error) { theme.value = preferences.soundTheme || "chime"; showError(error); }
        finally { theme.disabled = false; }
    });
    themeLabel.append(theme);
    const tests = el("div", undefined, "actions");
    for (const kind of ["question", "ended", "failed"]) tests.append(button(t(`alerts.test.${kind}`), () => chime(kind, theme.value)));
    form.append(themeLabel, tests);
    main.append(form);
}
// Harness: the agent runtime that runs the steps. Only harnesses with an adapter in Vibe Studio can be chosen.
function harnessView() {
    main.append(el("p", t("harness.intro"), "muted"));
    if (!harnesses) { void api("/harnesses").then(value => { harnesses = value; render(); }).catch(showError); main.append(el("p", t("harness.loading"), "muted")); return; }
    const form = el("form", undefined, "preferences harness-list"); form.addEventListener("submit", event => event.preventDefault());
    const group = el("fieldset"); group.append(el("legend", t("harness.choose")));
    for (const item of harnesses.list) {
        const row = el("div", undefined, "harness-row");
        const label = el("label", undefined, `check${item.supported ? "" : " unavailable"}`), radio = el("input");
        radio.type = "radio"; radio.name = "harness"; radio.value = item.id; radio.checked = harnesses.selected === item.id; radio.disabled = !item.supported;
        radio.addEventListener("change", async () => {
            try { preferences = await api("/preferences", { harness: item.id }); }
            catch (error) { showError(error); }
            harnesses = null; render();
        });
        const text = el("span");
        const selected = harnesses.selected === item.id;
        const state_ = !item.supported ? t("harness.notSupported")
            : selected ? (harnesses.connected ? t("projects.connected", { login: harnesses.login || item.name }) : harnesses.error || t("projects.notConnected"))
            : t("harness.supported");
        const where = item.id === "copilot" ? t("harness.builtIn") : item.path ? t("harness.found", { path: item.path }) : t("harness.notFound");
        text.append(el("strong", item.name), el("small", [where, state_].join(" · "), "muted"));
        if (item.supported) {
            const how = el("small", undefined, "muted"); how.append(document.createTextNode(`${t("harness.signIn")} `), el("code", item.login), document.createTextNode(` · ${t("harness.kitTarget")} `), el("code", `apm install --target ${item.target}`));
            text.append(how);
        }
        label.append(radio, text); row.append(label);
        if (item.supported && item.canLogin) {
            const connect = button(t("harness.connect"), async () => {
                connect.disabled = true;
                try {
                    await api("/harness/login", { id: item.id });
                    showNotice(t("harness.loginOpened", { name: item.name }));
                } finally { connect.disabled = false; }
            });
            connect.setAttribute("aria-label", t("harness.connectTo", { name: item.name }));
            row.append(connect);
        }
        group.append(row);
    }
    form.append(group, el("p", t("harness.note"), "muted"),
        refreshButton(t("harness.detect"), async () => { harnesses = await api("/harnesses", { refresh: true }); await refresh(true); }));
    main.append(form);
}
// Guards: the rules of the kit imposed on the AI, the actions they blocked and the suspensions decided by the user.
function guardsView() {
    main.append(el("p", t("guards.intro"), "muted"));
    const rules = state.guards?.rules || [];
    if (!rules.length) { main.append(el("p", t("guards.none"))); return; }
    const run = state.runs.find(item => item.id === state.guards.runId) || null;
    const blocks = new Map();
    for (const block of run?.blocks || []) blocks.set(block.id, (blocks.get(block.id) || 0) + 1);
    const suspended = new Set(run?.suspended || []);
    const rows = list => list.map(rule => {
        const status = el("div");
        if (suspended.has(rule.id)) status.append(el("small", t("guards.suspended"), "note"));
        if (blocks.get(rule.id)) status.append(el("small", t("guards.blocks", { n: blocks.get(rule.id) }), "muted"));
        let action = "";
        if (run) action = suspended.has(rule.id)
            ? button(t("guards.restore"), async () => { await api("/guards/suspend", { runId: run.id, id: rule.id, suspended: false }); await refresh(true); })
            : button(t("guards.suspend"), async () => {
                if (!await confirmDialog(t("guards.suspend"), t("guards.suspendConfirm", { id: rule.id }), t("guards.suspend"))) return;
                await api("/guards/suspend", { runId: run.id, id: rule.id, suspended: true }); await refresh(true);
            });
        return [el("code", rule.id), rule.description, status, action];
    });
    const columns = [t("guards.col.id"), t("guards.col.rule"), t("guards.col.state"), t("guards.col.action")];
    const permanent = rules.filter(rule => rule.scope === "permanent");
    if (permanent.length) main.append(el("h3", t("guards.permanent")), table(columns, rows(permanent)));
    main.append(el("h3", t("guards.step")));
    const step = rules.filter(rule => rule.scope === "step" && rule.kind !== "end"), end = rules.filter(rule => rule.kind === "end");
    if (!run) main.append(el("p", t("guards.noStep"), "muted"));
    else {
        if (step.length) main.append(table(columns, rows(step)));
        if (end.length) main.append(el("h3", t("guards.end")), table(columns, rows(end)));
        if (run.endGate?.alert) main.append(el("p", t("active.endGate", { list: run.endGate.failed.join(", ") }), "error"));
    }
    main.append(el("p", t("guards.outside"), "muted"));
}
function appStatus(service) {
    const node = el("span", undefined, `app-status app-${service.status}`);
    if (["starting", "stopping"].includes(service.status)) node.append(spinner("running"));
    else node.append(el("span", undefined, "dot"));
    node.append(document.createTextNode(t(`app.status.${service.status}`, { code: service.exitCode ?? "?" })));
    return node;
}
async function readLogs() {
    if (!appLog || view !== "application") { clearInterval(appLogTimer); appLogTimer = null; return; }
    const target = main.querySelector("pre.app-logs");
    if (!target) return;
    try {
        const { lines } = await api("/app/logs", { name: appLog });
        const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 24;
        target.textContent = lines.length ? lines.join("\n") : t("app.noLogs");
        if (atBottom) target.scrollTop = target.scrollHeight;
    } catch { /* The next tick retries. */ }
}
function confirmRun(restart) {
    const app = state.app;
    const content = document.querySelector("#confirm-content");
    const title = el("h2", t("app.confirmTitle")); title.id = "confirm-title";
    content.replaceChildren(title, el("p", t("app.confirmIntro"), "muted"));
    content.append(table([t("app.col.service"), t("app.col.folder"), t("app.col.command")], app.configured.map(s => [s.name, s.cwd, el("code", s.command)])));
    const actions = el("div", undefined, "actions");
    const go = button(t("app.confirm"), async () => { dialog.close(); await startApp(restart, true); }, "primary");
    actions.append(button(t("launch.cancel"), () => dialog.close()), go);
    content.append(actions); dialog.showModal();
}
async function appWork(kind, work) {
    if (appAction) return;
    appAction = kind; if (view === "application") render();
    const started = performance.now();
    try { await work(); }
    finally {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 700 - (performance.now() - started))));
        appAction = null;
        await refresh(true).catch(showError);
    }
}
async function startApp(restart = false, confirmed = false) {
    if (!state.app.approved && !confirmed) { confirmRun(restart); return; }
    await appWork(restart ? "restart" : "start", () => api("/app/start", { hash: state.app.hash, restart }));
}
function applicationView() {
    const app = state.app;
    main.append(el("p", t("app.intro"), "muted"));
    if (!app.configured.length) { main.append(el("p", t("app.none"))); return; }
    const services = app.services.length ? app.services : app.configured.map(s => ({ ...s, status: "stopped" }));
    const live = services.some(s => ["waiting", "starting", "running", "stopping"].includes(s.status));
    const ready = services.every(s => ["running", "external"].includes(s.status));
    const starting = services.some(s => ["waiting", "starting"].includes(s.status)), stopping = services.some(s => s.status === "stopping");
    const bar = el("div", undefined, "actions app-actions");
    if (!live || starting || appAction === "start") bar.append(workButton("start", t("app.start"), () => startApp(), "primary", appAction === "start" || (starting && appAction !== "restart")));
    if (live || appAction === "stop") {
        bar.append(workButton("stop", t("app.stop"), () => appWork("stop", () => api("/app/stop", {})), undefined, appAction === "stop" || stopping));
        if (!starting || appAction === "restart") bar.append(workButton("restart", t("app.restart"), () => startApp(true), undefined, appAction === "restart"));
    }
    if (app.open) {
        const open = button(t("app.open"), () => api("/app/open", { url: app.open }), ready ? "primary" : undefined);
        if (!ready) { open.disabled = true; open.title = t("app.notReady"); }
        bar.append(open);
    }
    main.append(bar);
    main.append(table([t("app.col.service"), t("app.col.status"), t("app.col.address"), ""], services.map(s => {
        const status = el("div"); status.append(appStatus(s));
        if (s.reason) status.append(el("small", t(`app.reason.${s.reason}`, { port: s.port ?? "", message: s.reason }), "note"));
        let address = s.port ? `:${s.port}` : "—";
        if (s.url) {
            address = el("a", s.url); address.href = s.url;
            address.addEventListener("click", event => { event.preventDefault(); api("/app/open", { url: s.url }).catch(showError); });
        }
        const logs = app.services.length ? button(appLog === s.name ? t("app.hideLogs") : t("app.logs"), () => {
            appLog = appLog === s.name ? null : s.name; render();
        }) : "";
        return [s.name, status, address, logs];
    })));
    if (appLog && app.services.some(s => s.name === appLog)) {
        main.append(el("h3", t("app.logsOf", { name: appLog })));
        const pre = el("pre", t("app.noLogs"), "app-logs"); pre.setAttribute("aria-live", "off"); main.append(pre);
        void readLogs();
        appLogTimer ??= setInterval(readLogs, 2000);
    }
    main.append(el("p", t("app.note"), "muted"));
}
const views = { about: aboutView, journey: journeyView, scenarios: scenariosView, conversation: conversationView, application: applicationView, deliverables: deliverablesView, sources: sourcesView, costs: costsView, settings: settingsView };
function focusSignature(node) {
    return `${node.tagName}|${node.dataset.indicator || node.getAttribute("aria-label") || node.textContent.trim()}|${node.closest("[data-phase]")?.dataset.phase || ""}`;
}
function captureFocus() {
    const node = document.activeElement;
    if (!node || node === main || node === document.body) return null;
    const root = main.contains(node) ? main : document.querySelector("#navigation").contains(node) ? document.querySelector("#navigation") : null;
    if (!root) return null;
    const signature = focusSignature(node);
    return { root, tag: node.tagName, signature, index: [...root.querySelectorAll(node.tagName)].filter(n => focusSignature(n) === signature).indexOf(node) };
}
function restoreFocus(saved) {
    if (!saved || (document.activeElement && document.activeElement !== document.body)) return;
    const same = [...saved.root.querySelectorAll(saved.tag)].filter(n => focusSignature(n) === saved.signature);
    (same[saved.index] || same[0])?.focus({ preventScroll: true });
}
function render() {
    const saved = captureFocus();
    renderView();
    restoreFocus(saved);
}
function renderView() {
    if (view === "projects" || !state) { renderProjects(); return; }
    const numbers = state.kit?.scenarios || [];
    if (numbers.length && !numbers.includes(scenario) && (state.kit.unitCatalog || scenario !== numbers.at(-1) + 1)) scenario = numbers[0];
    const scrollTop = main.scrollTop;
    const registerScrollTop = main.querySelector(".journey-scroll")?.scrollTop || 0;
    const transcriptScrollTop = main.querySelector(".conversation-transcript")?.scrollTop || 0;
    main.replaceChildren(); main.setAttribute("aria-busy", "false");
    document.body.classList.toggle("reading", reading.length > 0);
    if (!views[view] || ![...spacesFor(), ...secondary].includes(view)) view = "journey";
    const navigation = document.querySelector("#navigation"); navigation.replaceChildren();
    if (matchMedia("(max-width: 620px)").matches) {
        const label = el("label", t("nav.label")), select = el("select");
        for (const space of [...spacesFor(), ...secondary]) { const option = el("option", t(`space.${space}`)); option.value = space; select.append(option); }
        select.value = view; select.addEventListener("change", () => selectView(select.value)); label.append(select); navigation.append(label);
    } else {
        const running = activeRun();
        const host = running ? "conversation" : null;
        const appLive = state.app?.services.find(s => s.status === "starting") || state.app?.services.find(s => s.status === "running");
        const entry = space => {
            const b = button(t(`space.${space}`), () => selectView(space)); if (view === space) b.setAttribute("aria-current", "page");
            if (space === "application" && appLive) {
                const mark = appLive.status === "starting" ? spinner("running") : el("span", undefined, "app-dot");
                mark.classList.add("nav-mark"); mark.setAttribute("aria-hidden", "true"); b.append(mark);
            }
            if (space === host) {
                const mark = spinner(pendingRequests().length ? "waiting" : running.status); mark.classList.add("nav-mark"); b.append(mark);
                b.setAttribute("aria-label", `${t(`space.${space}`)} · ${t(["pausing", "paused"].includes(running.status) ? `run.${running.status}` : "active.nav")}`);
            }
            return b;
        };
        for (const space of spacesFor()) navigation.append(entry(space));
        const more = el("div", undefined, "nav-secondary");
        for (const space of secondary) more.append(entry(space));
        navigation.append(more);
    }
    projectLabel();
    const active = state.runs.findLast(ongoing);
    document.documentElement.lang = lang();
    document.querySelector("#refresh-label").textContent = t("header.refresh");
    showVersions();
    document.querySelector("nav").setAttribute("aria-label", t("nav.aria"));
    document.querySelector("#activity").textContent = active ? t(`run.${active.status}`) : "";
    if (reading.length && state.kit) { readerView(); main.scrollTop = scrollTop; return; }
    const heading = el("h1", t(`space.${view}`));
    if (view === "conversation") heading.classList.add("conversation-title");
    main.append(heading);
    if (state.updates) updateState = state.updates;
    if (view !== "about" && ["available", "ready"].includes(updateState?.status)) main.append(updateControls());
    if (!state.kit && view !== "conversation") { main.append(el("p", state.error, "error"), el("p", t("kit.missing"))); return; }
    views[view]();
    const register = main.querySelector(".journey-scroll");
    if (register) register.scrollTop = registerScrollTop;
    const transcript = main.querySelector(".conversation-transcript");
    if (transcript) transcript.scrollTop = transcriptScrollTop;
    if (state.lastError) showError(new Error(state.lastError));
    main.scrollTop = scrollTop;
    if (highlight) {
        main.querySelector(`li[data-phase="${CSS.escape(highlight)}"]`)?.scrollIntoView({ block: "center" });
        highlight = null;
    }
}
function selectView(next) { view = next; if (next === "conversation") convo.shown = null; render(); main.scrollTop = 0; main.focus(); }
async function refresh(force = false) {
    // An automatic refresh in flight does not swallow a manual one: wait for it, then refresh again.
    if (inflight) { await inflight.catch(() => {}); if (!force) return; }
    const run = (async () => {
        projects = await api("/projects");
        state = projects.current ? adapt(await api("/snapshot")) : null;
        if (!state) view = "projects";
        if (costsAttemptFor !== (state?.project || null)) {
            clearTimeout(costsTimer); costsTimer = null; costsDirty = false; costsReadAt = 0;
            costs = null; costsFor = null; costsRequest = null; costsLoading = false; costsAttemptFor = null;
        }
        if (reading.length && state) await reloadReader();
        if (force || (!dialog.open && !document.activeElement?.closest("form"))) render();
        if (state?.kit?.contract?.modules?.costs && costsAttemptFor !== state.project) {
            costsAttemptFor = state.project;
            void readCosts().catch(showError);
        }
    })();
    inflight = run;
    try { await run; } finally { if (inflight === run) inflight = null; }
}
async function manualRefresh() {
    if (refreshing) return;
    const control = document.querySelector("#refresh");
    refreshing = true;
    setBusy(control, true);
    const started = performance.now();
    try { await refresh(true); }
    catch (error) { showError(error); }
    finally {
        // At least one full turn, so that a fast refresh is still visible.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 700 - (performance.now() - started))));
        refreshing = false;
        setBusy(control, false);
    }
}
document.querySelector("#refresh").addEventListener("click", manualRefresh);
matchMedia("(max-width: 620px)").addEventListener("change", () => render());
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && reading.length && !dialog.open) { event.preventDefault(); closeReader(); }
});
// The view adapter exposes generic units as scenarios and steps as phases.
function adapt(snapshot) {
    const kit = snapshot.kit;
    if (kit) {
        kit.catalog = { phases: kit.contract.steps.map(s => ({ ...s, scope: s.scope === "unit" ? "scenario" : "project", requiresBuiltScenario: !!s.requiresBuiltUnit })) };
        kit.scenarios = kit.units; kit.builtScenarios = kit.builtUnits; kit.config ??= {};
    }
    snapshot.runs = snapshot.runs.map(run => ({ ...run, phase: run.step, scenario: run.unit }));
    snapshot.runtime = { ...snapshot.runtime, busy: snapshot.runs.some(ongoing) };
    return snapshot;
}
function showVersions() {
    const kit = state?.kit?.kit;
    const lines = [];
    if (kit) lines.push(kit.version ? `${kit.id} ${kit.version}` : kit.id);
    const version = state?.vibeStudioVersion || projects?.version;
    if (version) lines.push(`Vibe Studio ${version}`);
    const node = document.querySelector("#versions");
    node.replaceChildren(...lines.map(line => el("span", line)));
    node.title = kit ? t("versions.title", { kit: `${kit.id} ${kit.version || "?"}`, app: version || "?" }) : "";
}
function projectLabel() {
    const node = document.querySelector("#project");
    if (!state) { node.replaceChildren(el("strong", t("projects.add"))); node.title = ""; return; }
    const name = (typeof state.kit?.title === "string" && state.kit.title) || state.project.split(/[\\/]/).filter(Boolean).at(-1);
    node.replaceChildren(el("strong", name), el("small", t("projects.switch")));
    node.title = state.project;
}

// Projects: the home of Vibe Studio.
function renderProjects() {
    main.replaceChildren(); main.setAttribute("aria-busy", "false");
    document.body.classList.remove("reading");
    document.documentElement.lang = lang();
    document.querySelector("#navigation").replaceChildren();
    projectLabel();
    document.querySelector("#refresh-label").textContent = t("header.refresh");
    showVersions();
    document.querySelector("#activity").textContent = "";
    main.append(el("h1", t("space.projects")), el("p", t("projects.intro"), "muted"));
    if (projects?.updates) updateState = projects.updates;
    main.append(updateControls(true));
    const harness = projects?.harness;
    main.append(el("p", t("projects.harness", { name: projects?.harnessName || "Copilot", state: harness?.login ? t("projects.connected", { login: harness.login }) : t("projects.notConnected") }), "muted"));
    const add = button(t("projects.add"), async () => { await api("/projects/choose"); view = "journey"; await refresh(true); }, "primary");
    main.append(add);
    const list = projects?.recent || [];
    main.append(el("h3", t("projects.recent")));
    if (!list.length) { main.append(el("p", t("projects.none"), "muted")); return; }
    const items = el("ul", undefined, "project-list");
    for (const item of list) {
        const row = el("li"), text = el("div");
        text.append(el("strong", item.title || item.dir), el("small", item.dir, "muted"));
        const actions = el("div", undefined, "actions");
        const current = item.dir === projects.current;
        actions.append(button(t(current ? "projects.back" : "projects.open"), async () => {
            if (!current) await api("/projects/open", { dir: item.dir });
            view = "journey"; await refresh(true);
        }, current ? "primary" : undefined));
        if (item.dir !== projects.current) actions.append(button(t("projects.forget"), async () => { await api("/projects/forget", { dir: item.dir }); await refresh(true); }));
        row.append(text, actions); items.append(row);
    }
    main.append(items);
}

// Conversation: what the AI does in the session of a step, and the questions and permissions it waits for.
const convo = { sessionId: null, items: [], metrics: {}, nodes: new Map(), follow: true, shown: null };
const messageDrafts = new Map();
const messageDraft = () => {
    const key = `${state.project}:${convo.sessionId}`;
    if (!messageDrafts.has(key)) messageDrafts.set(key, { text: "", files: [], sending: false });
    return messageDrafts.get(key);
};
const pendingRequests = () => convo.items.filter(item => item.kind === "request" && !item.answer);
const waitingRequests = new Map();
async function loadConversation(sessionId) {
    convo.sessionId = sessionId; convo.loaded = sessionId;
    const result = sessionId ? await api("/conversation", { sessionId }) : { items: [], metrics: {} };
    if (convo.sessionId !== sessionId) return;
    convo.items = result.items; convo.metrics = result.metrics || {};
    for (const [key, id] of waitingRequests) if (id === sessionId) waitingRequests.delete(key);
    for (const item of convo.items) if (item.kind === "request" && !item.answer) waitingRequests.set(item.key, sessionId);
}
function conversationSessions() {
    const seen = new Set();
    const steps = state.runs.slice().reverse().filter(run => run.sessionId && !seen.has(run.sessionId) && seen.add(run.sessionId)).slice(0, 8)
        .map(run => {
            const step = state.kit?.catalog.phases.find(p => p.id === run.phase);
            return { sessionId: run.sessionId, run, label: (step ? phaseText(step, "title", lang()) : run.phase) + (run.scenario ? ` · ${scenarioTitle(run.scenario)}` : "") };
        });
    const time = value => new Date(value).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    const chats = (state.chats || []).slice().reverse().map(chat => ({ sessionId: chat.sessionId, chat, label: t("convo.chatLabel", { time: time(chat.startedAt) }) }));
    return [...chats, ...steps].sort((a, b) => Date.parse((b.chat || b.run).startedAt) - Date.parse((a.chat || a.run).startedAt));
}
function ensurePreferences() {
    if (preferences) return true;
    void api("/preferences").then(value => { preferences = value; applyTheme(); render(); }).catch(showError);
    return false;
}
function convoToolbar() {
    const bar = el("div", undefined, "convo-toolbar");
    const switches = el("div", undefined, "conversation-switches");
    for (const key of preferences?.autopilot ? ["autopilot"] : ["autopilot", "approveAll"]) {
        const toggle = el("label", undefined, "switch"), box = el("input");
        box.type = "checkbox"; box.setAttribute("role", "switch"); box.checked = !!preferences?.[key]; box.disabled = !preferences;
        box.addEventListener("change", async () => {
            box.disabled = true;
            try { preferences = await api("/preferences", { [key]: box.checked }); render(); }
            catch (error) { box.checked = !!preferences?.[key]; box.disabled = false; showError(error); }
        });
        const text = el("span"); text.append(el("strong", t(`${key}.label`)), el("small", t(`${key}.${preferences?.[key] ? "on" : "off"}`), "muted"));
        toggle.append(box, text); switches.append(toggle);
    }
    bar.append(switches, button(t("chat.new"), newChatDialog));
    if (preferences?.autopilot) bar.classList.add("autopilot-on");
    return bar;
}
function conversationMetrics() {
    const entry = (state.chats || []).find(item => item.sessionId === convo.sessionId) || state.runs.findLast(item => item.sessionId === convo.sessionId);
    const metrics = { ...entry?.metrics, ...convo.metrics };
    const number = value => typeof value === "number" ? new Intl.NumberFormat(locale()).format(value) : t("convo.notReported");
    const selectedEffort = entry?.requestedReasoningEffort || entry?.reasoningEffort;
    const selectedTier = entry?.requestedContextTier || entry?.contextTier;
    const values = [
        ["convo.model", metrics.model || entry?.model || t("convo.notReported")],
        ["launch.effort", (selectedEffort || t("convo.notReported")) + (selectedEffort && !entry.effortVerified ? ` · ${t("convo.selected")}` : "")
            + (entry?.effortVerified && entry.reasoningEffort !== selectedEffort ? ` · ${t("convo.reportedEffort", { effort: entry.reasoningEffort })}` : "")],
        ["convo.selectedContext", `${selectedTier ? t(selectedTier === "long_context" ? "convo.longContext" : "convo.standardContext") : t("convo.notReported")} · ${number(entry?.contextBudget)}${entry?.contextBudget ? " tokens" : ""}`],
        ["convo.context", `${t(entry?.contextTier === "long_context" ? "convo.longContext" : "convo.standardContext")} · ${
            typeof metrics.currentTokens === "number" ? `${number(metrics.currentTokens)} / ` : ""}${number(metrics.tokenLimit)}${typeof metrics.tokenLimit === "number" ? " tokens" : ""}`],
        ["convo.tokens", `${t("convo.input")} ${number(metrics.inputTokens)} · ${t("convo.output")} ${number(metrics.outputTokens)}`],
        ["convo.cache", `${t("convo.read")} ${number(metrics.cacheReadTokens)} · ${t("convo.written")} ${number(metrics.cacheWriteTokens)}`],
        ["convo.credits", typeof metrics.credits === "number" ? new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(metrics.credits) : t("convo.notReported")],
        ...(typeof metrics.premiumRequests === "number" ? [["convo.premiumRequests", number(metrics.premiumRequests)]] : []),
        ...(typeof metrics.costUsd === "number" ? [["convo.costUsd", new Intl.NumberFormat(locale(), { style: "currency", currency: "USD" }).format(metrics.costUsd)]] : []),
    ];
    const box = el("dl", undefined, "conversation-metrics");
    box.title = t("convo.metricsHint");
    for (const [label, value] of values) { const field = el("div"); field.append(el("dt", t(label)), el("dd", value)); box.append(field); }
    return box;
}
function attachmentTray(files, remove) {
    const list = el("ul", undefined, "attachment-tray");
    for (const file of files) {
        const item = el("li", undefined, "attachment-card");
        if (file.preview) { const image = el("img"); image.src = file.preview; image.alt = file.name; item.append(image); }
        else item.append(el("span", file.name.split(".").at(-1).slice(0, 8).toUpperCase(), "attachment-type"));
        const text = el("span", file.name, "attachment-name");
        if (typeof file.size === "number") text.append(el("small", sizeText(file.size)));
        item.append(text);
        if (remove) {
            const action = button("×", () => remove(file), "icon-button");
            action.setAttribute("aria-label", t("attach.remove", { name: file.name })); item.append(action);
        }
        list.append(item);
    }
    return list;
}
function composer(chat, run) {
    const draft = messageDraft(), sessionId = convo.sessionId;
    const form = el("form", undefined, "composer"); form.addEventListener("submit", event => event.preventDefault());
    const tray = el("div"), label = el("label", t("convo.message")), input = el("textarea");
    input.rows = 2; input.maxLength = 4000; input.value = draft.text;
    input.addEventListener("input", () => { draft.text = input.value; });
    label.append(input);
    const draw = () => {
        tray.replaceChildren(attachmentTray(draft.files, file => { draft.files.splice(draft.files.indexOf(file), 1); draw(); }));
        if (form.isConnected && view === "conversation" && convo.sessionId === sessionId && convo.follow) requestAnimationFrame(toBottom);
    };
    const addFiles = files => {
        const additions = files.filter(file => !draft.files.some(item => item.path === file.path));
        if (draft.files.length + additions.length > 10) throw new Error(t("attach.tooMany", { n: 10 }));
        draft.files.push(...additions); draw();
    };
    const importing = async work => {
        if (draft.sending) return;
        draft.importing = (draft.importing || 0) + 1; sendIt.disabled = true; add.disabled = true;
        try { await work(); }
        finally {
            draft.importing--; sendIt.disabled = draft.sending || !!draft.importing; add.disabled = draft.sending || !!draft.importing;
            if (!form.isConnected && view === "conversation" && convo.sessionId === sessionId) render();
        }
    };
    const importFiles = files => importing(async () => {
        if (draft.files.length + files.length > 10) throw new Error(t("attach.tooMany", { n: 10 }));
        const result = await window.vibeStudio.importFiles(files);
        if (result.error) throw new Error(result.error);
        addFiles(result.files);
    });
    const sendIt = button(t("convo.send"), async () => {
        if (draft.sending || draft.importing || (!draft.text.trim() && !draft.files.length)) return;
        draft.sending = true; sendIt.disabled = true; input.disabled = true; add.disabled = true;
        try {
            await api("/say", { ...(chat ? { sessionId: chat.sessionId } : { runId: run.id }), text: draft.text, attachments: draft.files.map(file => file.path) });
            draft.text = ""; draft.files = [];
            if (convo.sessionId === sessionId && form.isConnected) { input.value = ""; draw(); input.focus(); }
        } finally {
            draft.sending = false; sendIt.disabled = false; input.disabled = false; add.disabled = false;
            if (!form.isConnected && view === "conversation" && convo.sessionId === sessionId) render();
        }
    }, "primary");
    sendIt.disabled = draft.sending || draft.importing; input.disabled = draft.sending;
    const add = button(t("attach.add"), () => importing(async () => {
        addFiles((await api("/files/choose")).files);
    }));
    add.disabled = draft.sending || draft.importing;
    const actions = el("div", undefined, "composer-actions"); actions.append(sendIt, add, el("small", t("attach.chatHint"), "muted"));
    input.addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); sendIt.click(); } });
    input.addEventListener("paste", event => {
        const files = [...(event.clipboardData?.files || [])];
        if (!files.length || draft.sending) return;
        event.preventDefault(); void importFiles(files).catch(showError);
    });
    form.addEventListener("dragover", event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); event.dataTransfer.dropEffect = "copy"; form.classList.add("drop-target");
    });
    form.addEventListener("dragleave", event => { if (!form.contains(event.relatedTarget)) form.classList.remove("drop-target"); });
    form.addEventListener("drop", event => {
        event.preventDefault(); form.classList.remove("drop-target");
        if (!draft.sending) void importFiles([...event.dataTransfer.files]).catch(showError);
    });
    const fields = el("div", undefined, "composer-fields");
    fields.append(tray, label, el("small", t(chat ? "chat.hint" : "convo.messageHint"), "muted"));
    form.append(fields, actions); draw();
    return form;
}
async function newChatDialog() {
    const options = await api("/chat/options");
    const content = document.querySelector("#confirm-content");
    const title = el("h2", t("chat.title")); title.id = "confirm-title";
    const form = el("form"); form.addEventListener("submit", event => event.preventDefault());
    const field = (label, input) => { const node = el("label", label); node.append(input); form.append(node); return input; };
    const agent = field(t("chat.agent"), el("select"));
    const none = el("option", t("launch.defaultAgent")); none.value = ""; agent.append(none);
    for (const item of options.agents) { const option = el("option", item.name); option.value = item.name; option.title = item.description; agent.append(option); }
    const controls = modelControls(options, options.defaultModel, "default");
    form.append(controls.node, controls.hint, catalogNotice(options, async () => {
        await api("/models/refresh"); await newChatDialog();
    }));
    const actions = el("div", undefined, "actions");
    const start = button(t("chat.start"), async () => {
        start.disabled = true;
        try {
            const { sessionId } = await api("/chat/start", { model: controls.model.value, contextTier: controls.context.value, reasoningEffort: controls.effort.value, agent: agent.value });
            dialog.close(); convo.sessionId = sessionId; convo.loaded = null; selectView("conversation"); await refresh(true);
        } finally { start.disabled = false; }
    }, "primary");
    start.disabled = !options.models?.length;
    actions.append(button(t("launch.cancel"), () => dialog.close()), start);
    form.append(actions);
    content.replaceChildren(title, el("p", t("chat.intro"), "muted"), form);
    dialog.showModal();
}
function conversationView() {
    main.append(el("p", t("convo.intro"), "muted"));
    ensurePreferences();
    const controls = el("div", undefined, "conversation-controls");
    controls.append(convoToolbar());
    const sessions = conversationSessions();
    if (!convo.sessionId && sessions.length) convo.sessionId = sessions[0].sessionId;
    if (convo.sessionId && convo.loaded !== convo.sessionId) { void loadConversation(convo.sessionId).then(render).catch(showError); return; }
    const first = convo.shown !== convo.sessionId;
    convo.shown = convo.sessionId;
    if (sessions.length) {
        const picker = el("div", undefined, "segmented"); picker.setAttribute("role", "group"); picker.setAttribute("aria-label", t("convo.sessions"));
        const choice = entry => {
            const b = button(entry.label, async () => { await loadConversation(entry.sessionId); render(); });
            b.setAttribute("aria-pressed", String(entry.sessionId === convo.sessionId)); return b;
        };
        picker.append(el("span", t("convo.latest"), "muted"), choice(sessions[0]));
        if (sessions.length > 1) {
            const history = el("details", undefined, "conversation-history");
            history.open = preferences?.conversationHistory !== false;
            let wanted = history.open;
            const summary = el("summary", t("convo.previousSessions", { n: sessions.length - 1 }));
            const older = el("div", undefined, "segmented");
            for (const entry of sessions.slice(1)) older.append(choice(entry));
            history.append(summary, older);
            history.addEventListener("toggle", async () => {
                if (!history.isConnected || !preferences || history.open === wanted) return;
                const before = preferences.conversationHistory;
                wanted = history.open;
                const revision = ++historyRevision;
                preferences = { ...preferences, conversationHistory: wanted };
                try {
                    const saved = await api("/preferences", { conversationHistory: wanted });
                    if (revision === historyRevision) preferences = saved;
                } catch (error) {
                    if (revision === historyRevision) {
                        wanted = before; history.open = before;
                        preferences = { ...preferences, conversationHistory: before };
                    }
                    showError(error);
                }
            });
            picker.append(history);
            const selected = sessions.slice(1).find(entry => entry.sessionId === convo.sessionId);
            if (selected) picker.append(el("small", t("convo.consulting", { name: selected.label }), "muted"));
        }
        controls.append(picker);
    }
    const chat = (state.chats || []).find(item => item.sessionId === convo.sessionId) || null;
    const run = chat ? null : state.runs.findLast(item => item.sessionId === convo.sessionId);
    const live = chat ? true : ongoing(run);
    const paused = run && ["pausing", "paused"].includes(run.status);
    let stepHead;
    if (chat) {
        const head = el("div", undefined, "convo-head");
        const label = el("span", undefined, "activity-label");
        if (chat.busy || pendingRequests().length) label.append(spinner(pendingRequests().length ? "waiting" : "running"));
        label.append(document.createTextNode(t(chat.busy ? "chat.busy" : "chat.ready")));
        head.append(label, button(t("chat.close"), async () => {
            if (!await confirmDialog(t("chat.close"), t("chat.closeConfirm"), t("chat.close"))) return;
            await api("/chat/close", { sessionId: chat.sessionId }); await refresh(true);
        }));
        controls.append(head);
    }
    if (run) {
        const head = el("div", undefined, "convo-head");
        const label = el("span", undefined, "activity-label");
        if (live) label.append(spinner(pendingRequests().length ? "waiting" : "running"));
        label.append(document.createTextNode(t(`run.${run.status}`)));
        head.append(label);
        if (live) {
            const actions = el("div", undefined, "convo-actions");
            const resume = run.status === "paused";
            actions.append(workButton(resume ? "start" : "pause", t(resume ? "convo.resume" : run.status === "pausing" && !run.pauseError ? "run.pausing" : "convo.pause"), async () => {
                await api(resume ? "/resume" : "/pause", { runId: run.id }); await refresh(true);
            }, resume ? "primary" : undefined, run.status === "pausing" && !run.pauseError));
            actions.append(button(t("convo.stop"), async () => {
                if (!await confirmDialog(t("convo.stop"), t("convo.stopConfirm"), t("convo.stop"))) return;
                await api("/close", { runId: run.id }); await refresh(true);
            }));
            head.append(actions);
        }
        stepHead = head;
        if (paused) controls.append(el("p", t("convo.pauseHint"), "muted"));
        if (run.pauseError) controls.append(el("p", run.pauseError, "error"));
    }
    const log = el("div", undefined, "convo"); log.setAttribute("role", "log"); log.setAttribute("aria-live", "polite");
    convo.nodes = new Map();
    if (!convo.items.length) log.append(el("p", t(chat ? "chat.empty" : "convo.none"), "convo-empty muted"));
    for (const item of convo.items) log.append(convoNode(item));
    const shell = el("div", undefined, "conversation-shell"), thread = el("div", undefined, "conversation-thread");
    const transcript = el("div", undefined, "conversation-transcript");
    transcript.tabIndex = 0; transcript.setAttribute("role", "region"); transcript.setAttribute("aria-label", t("space.conversation"));
    transcript.append(controls, log);
    if (stepHead) thread.append(stepHead);
    thread.append(transcript);
    if (live && !paused) thread.append(composer(chat, run));
    shell.append(thread);
    if (convo.sessionId) {
        const aside = el("aside", undefined, "conversation-details"); aside.setAttribute("aria-label", t("convo.details")); aside.tabIndex = 0;
        aside.append(conversationMetrics()); shell.append(aside);
    }
    main.append(shell);
    if (first || convo.follow) requestAnimationFrame(toBottom);
}
const parsedMarkdown = new Map();
function parsed(text) {
    let tree = parsedMarkdown.get(text);
    if (!tree) {
        tree = parse(text);
        parsedMarkdown.set(text, tree);
        if (parsedMarkdown.size > 300) parsedMarkdown.delete(parsedMarkdown.keys().next().value);
    }
    return tree;
}
function markdownBlock(text) {
    const box = el("div", undefined, "markdown");
    box.append(renderMarkdown(parsed(text || ""), document, {
        chip, imageText: (alt, src) => t("reader.image", { alt: alt || "—", src }),
        link: safe => safe.kind === "external" ? { kind: "app", href: safe.href, open: () => api("/link", { url: safe.href }).catch(showError) } : null,
    }));
    return box;
}
function toolIcon(status) {
    if (status === "running") { const node = el("span", undefined, "status-icon status-in_progress"); node.append(el("span", undefined, "spinner")); return node; }
    return chip(status === "failed" ? "blocked" : "done");
}
function convoNode(item) {
    let node;
    if (item.kind === "launch") {
        node = el("details", undefined, "convo-item convo-launch");
        node.append(el("summary", t("convo.launch")), el("pre", item.text));
    } else if (item.kind === "user") {
        node = el("div", undefined, "convo-item convo-user");
        node.setAttribute("aria-label", t("convo.you"));
        node.append(attachmentTray(item.attachments || []), el("p", item.text));
    } else if (item.kind === "assistant") {
        node = el("div", undefined, "convo-item convo-assistant");
        node.append(markdownBlock(item.text));
    } else if (item.kind === "tool") {
        node = el("div", undefined, `convo-item convo-tool${item.nested ? " nested" : ""}`);
        node.append(toolIcon(item.status), el("code", item.name), el("span", item.detail || "", "muted"));
        if (item.error) node.append(el("small", item.error, "error"));
    } else if (item.kind === "info") {
        const text = item.info === "subagent" ? t("convo.subagent", { name: item.text }) : t(`convo.${item.info}`, { text: item.text });
        node = el("p", text, "convo-item convo-info muted");
    } else if (item.kind === "guard") {
        node = el("div", undefined, "convo-item convo-guard");
        node.append(el("strong", t(item.decision === "ask" ? "convo.guardAsk" : "convo.guard", { id: item.id })), el("code", item.tool || ""), el("span", item.path || "", "muted"));
    } else if (item.kind === "endGate") {
        node = el("p", t(item.alert ? "convo.endGateAlert" : "convo.endGate", { list: (item.failed || []).join(", ") }), `convo-item convo-info${item.alert ? " error" : " muted"}`);
    } else if (item.kind === "error") {
        node = el("p", item.text, "convo-item error");
    } else if (item.kind === "request") {
        node = requestNode(item);
    } else node = el("div");
    convo.nodes.set(item.key, node);
    return node;
}
function answerText(item) {
    const answer = item.answer;
    if (item.request.kind === "question") return t("convo.answered", { answer: answer?.answer ?? "" });
    return answer === "approve" ? t("convo.allowed") : answer === "approve-session" ? t("convo.allowedSession")
        : `${t("convo.refused")}${answer?.feedback ? ` · ${answer.feedback}` : ""}`;
}
function requestNode(item) {
    const request = item.request;
    if (item.answer) {
        // Once answered, a request shrinks to one line so that the work stays readable.
        const what = request.kind === "question" ? request.question : `${t(`convo.perm.${request.permission}`, { message: request.permission })} · ${request.detail || request.intention || ""}`;
        const node = el("p", undefined, "convo-item convo-request-done");
        node.append(el("span", what, "what"), el("span", answerText(item), "answer"));
        node.title = what;
        return node;
    }
    const node = el("section", undefined, "convo-item convo-request");
    node.setAttribute("aria-label", t(request.kind === "question" ? "convo.question" : "convo.permission"));
    if (request.kind === "question") node.append(markdownBlock(request.question));
    else {
        node.append(el("strong", t(`convo.perm.${request.permission}`, { message: request.permission })));
        if (request.intention) node.append(el("p", request.intention, "muted"));
        if (request.detail && !request.intention?.includes(request.detail)) node.append(el("pre", request.detail));
        if (request.diff) {
            const diff = el("details", undefined, "diff"); diff.append(el("summary", t("convo.diff")), el("pre", request.diff));
            node.append(diff);
        }
    }
    const answer = async value => {
        node.querySelectorAll("button, input, textarea").forEach(control => { control.disabled = true; });
        await api("/answer", { id: request.id, answer: value });
    };
    const actions = el("div", undefined, "actions");
    if (request.kind === "question") {
        for (const choice of request.choices || []) actions.append(button(choice, () => answer({ answer: choice })));
        node.append(actions);
        if (request.allowFreeform || !(request.choices || []).length) {
            const form = el("form", undefined, "freeform"); form.addEventListener("submit", event => event.preventDefault());
            const label = el("label", t("convo.freeform")), input = el("textarea"); input.rows = 2; label.append(input);
            form.append(label, button(t("convo.answer"), () => input.value.trim() ? answer({ answer: input.value.trim() }) : null, "primary"));
            node.append(form);
        }
    } else {
        actions.append(button(t("convo.approve"), () => answer("approve"), "primary"));
        if (request.canApproveForSession) actions.append(button(t("convo.approveSession"), () => answer("approve-session")));
        const reason = el("input"); reason.placeholder = t("convo.rejectReason"); reason.setAttribute("aria-label", t("convo.rejectReason"));
        actions.append(button(t("convo.reject"), () => answer({ feedback: reason.value.trim() || undefined })), reason);
        node.append(actions);
    }
    return node;
}
function onConversation(change) {
    if (change.op === "metrics" || change.item?.kind === "launch" || change.item?.kind === "error"
        || ["idle", "aborted", "paused", "chatClosed"].includes(change.item?.info)) scheduleCosts();
    if (change.op === "metrics") {
        if (change.sessionId === convo.sessionId) {
            convo.metrics = change.metrics;
            if (view === "conversation" && !reading.length) main.querySelector(".conversation-metrics")?.replaceWith(conversationMetrics());
        }
        return;
    }
    if (change.op === "add" && change.item.kind === "request" && !change.item.answer) waitingRequests.set(change.item.key, change.sessionId);
    if (change.op === "update" && change.patch?.answer) waitingRequests.delete(change.key);
    if (view === "journey" && !reading.length && (change.item?.kind === "request" || change.patch?.answer)) render();
    if (!waitingRequests.size) lastAttention = "";
    if (change.sessionId !== convo.sessionId) { if (change.op === "add" && change.item.kind === "launch") void loadConversation(change.sessionId); attention(); return; }
    if (change.op === "add") convo.items.push(change.item);
    const item = convo.items.find(entry => entry.key === (change.key || change.item.key));
    if (change.op === "append" && item) item.text += change.text;
    if (change.op === "update" && item) Object.assign(item, change.patch);
    if (view !== "conversation" || reading.length) { attention(); return; }
    const log = main.querySelector(".convo");
    if (!log) return;
    const atBottom = convo.follow;
    clearTimeout(streamTimer);
    if (change.op === "append") {
        log.setAttribute("aria-busy", "true");
        streamTimer = setTimeout(() => log.setAttribute("aria-busy", "false"), 1500);
    } else log.setAttribute("aria-busy", "false");
    if (change.op === "add") { log.querySelector(".convo-empty")?.remove(); log.append(convoNode(change.item)); }
    else if (item) {
        const old = convo.nodes.get(item.key);
        // While a message streams, plain text is enough; Markdown is rendered when the message is complete.
        if (change.op === "append" && old?.classList.contains("convo-assistant")) old.replaceChildren(el("p", item.text, "streaming"));
        else if (old) old.replaceWith(convoNode(item));
    }
    if (atBottom) requestAnimationFrame(toBottom);
    if (change.op === "update" && change.patch?.answer !== undefined) render();
}
let streamTimer;
function toBottom() {
    const transcript = main.querySelector(".conversation-transcript");
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
    convo.follow = true;
}
// The conversation follows new messages while the user stays at its end; scrolling up stops it, coming back resumes it.
const scrollTimers = new WeakMap();
document.addEventListener("scroll", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    target.classList.add("is-scrolling");
    clearTimeout(scrollTimers.get(target));
    scrollTimers.set(target, setTimeout(() => { target.classList.remove("is-scrolling"); scrollTimers.delete(target); }, 700));
    if (target.classList.contains("conversation-transcript"))
        convo.follow = target.scrollHeight - target.scrollTop - target.clientHeight < 48;
}, { capture: true, passive: true });
let lastAttention = "";
function attention() {
    if (!waitingRequests.size || view === "conversation") return;
    const key = [...waitingRequests.keys()].join("|");
    if (lastAttention === key) return;
    lastAttention = key;
    showNotice([el("span", t("convo.waiting")), " ", button(t("convo.goto"), async () => {
        const sessionId = [...waitingRequests.values()].at(-1);
        await loadConversation(sessionId); showNotice(""); selectView("conversation");
    })]);
}

async function boot() {
    window.vibeStudio.on("vibe-studio:refresh", payload => {
        if (payload?.opened) { view = "journey"; void refresh(true).catch(showError); return; }
        clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(showError), 300);
    });
    window.vibeStudio.on("vibe-studio:conversation", onConversation);
    window.vibeStudio.on("vibe-studio:costs", scheduleCosts);
    window.vibeStudio.on("vibe-studio:request", () => attention());
    window.vibeStudio.on("vibe-studio:alert", alertInfo => { if (alertInfo?.sound) chime(alertInfo.kind, alertInfo.theme); });
    window.vibeStudio.on("vibe-studio:goto", async target => {
        if (!state) return;
        if (target?.sessionId) await loadConversation(target.sessionId).catch(() => {});
        showNotice("");
        reading = []; selectView("conversation");
    });
    document.querySelector("#project").addEventListener("click", () => { reading = []; selectView("projects"); });
    try { preferences = await api("/preferences"); applyTheme(); } catch (error) { showError(error); }
    await refresh(true).catch(showError);
    if (state) { view = "journey"; render(); }
}
await boot();
