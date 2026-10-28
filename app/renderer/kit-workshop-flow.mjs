// Workshop flow: describe the mission, follow the AI, review proposals one at a time, then the round summary.
import { LANGUAGES, guidedSteps, translationStatus } from "/kit-authoring.mjs";

const form = { name: "", mission: "", files: [], language: null, location: null, open: false };
const git = { open: false, url: "" };

export function startScreen(ctx, parent) {
    const { el, button, t, state, api } = ctx;
    form.language ??= LANGUAGES.includes(ctx.lang()) ? ctx.lang() : "en";
    const box = el("form", undefined, "ws-start");
    box.addEventListener("submit", event => event.preventDefault());
    const lead = el("div", undefined, "ws-lead");
    lead.append(el("h1", t("ws.createTitle")), el("p", t("ws.createLead"), "muted"));
    const name = el("input"); name.value = form.name; name.required = true; name.maxLength = 120;
    name.addEventListener("input", () => { form.name = name.value; });
    const mission = el("textarea"); mission.rows = 7; mission.value = form.mission; mission.required = true; mission.maxLength = 8000;
    mission.placeholder = t("ws.missionPlaceholder");
    mission.addEventListener("input", () => { form.mission = mission.value; });
    const options = el("details", undefined, "ws-more"); options.open = form.open;
    options.addEventListener("toggle", () => { form.open = options.open; });
    const summary = el("summary", t("ws.options"));
    // The toggle event is asynchronous; a re-render in between would otherwise lose the click.
    summary.addEventListener("click", () => { form.open = !options.open; });
    const files = el("div", undefined, "ws-chips");
    for (const file of form.files) {
        const chip = el("span", undefined, "ws-chip");
        const remove = button("×", () => { form.files.splice(form.files.indexOf(file), 1); ctx.render(); }, "ws-chip-remove");
        remove.setAttribute("aria-label", t("attach.remove", { name: file.name }));
        chip.append(el("span", file.name, "mono"), remove); files.append(chip);
    }
    files.append(button(t("ws.addDocuments"), async () => {
        const result = await api("/files/choose");
        form.files.push(...(result?.files || []).filter(file => !form.files.some(item => item.path === file.path)));
        ctx.render();
    }));
    const language = el("select");
    for (const code of LANGUAGES) { const option = el("option", ctx.languageName(code)); option.value = code; language.append(option); }
    language.value = form.language;
    language.addEventListener("change", () => { form.language = language.value; });
    const where = el("div", undefined, "ws-row");
    where.append(el("span", form.location || state.status?.location || "", "mono ws-path"), button(t("ws.change"), async () => {
        const chosen = await api("/kits/workshop/location");
        if (chosen) { form.location = chosen; ctx.render(); }
    }, "quiet"));
    options.append(summary, ctx.field(t("ws.references"), files, t("ws.referencesHint")),
        ctx.field(t("ws.sourceLanguage"), language, t("ws.sourceLanguageHint")), ctx.field(t("ws.location"), where));
    const examples = el("span", undefined, "ws-examples");
    examples.append(el("span", t("ws.inspire")));
    for (const key of ["poc", "audit", "migration"]) examples.append(button(t(`ws.example.${key}`), () => {
        form.mission = t(`ws.example.${key}.text`);
        if (!form.name.trim()) form.name = t(`ws.example.${key}.name`);
        ctx.render();
    }, "quiet"));
    const create = withAI => async () => {
        if (!form.name.trim() || (withAI && !form.mission.trim())) { box.reportValidity(); return; }
        state.reviewOpen = true; state.leftPreparing = false;
        try {
            await ctx.call("/kits/workshop/create", { name: form.name, mission: form.mission, language: form.language,
                location: form.location, attachments: form.files.map(file => file.path), withAI });
            Object.assign(form, { name: "", mission: "", files: [], location: null });
        } catch (error) {
            if (ctx.kit()) { Object.assign(form, { name: "", mission: "", files: [], location: null }); ctx.aiFailure(error); }
            else throw error;
        }
    };
    const primary = button(t("ws.prepare"), create(true), "primary");
    primary.disabled = state.busy;
    const actions = el("div", undefined, "ws-spread");
    actions.append(examples, primary);
    const secondary = el("div", undefined, "ws-spread");
    secondary.append(ctx.aiLine(), button(t("ws.withoutAI"), create(false), "quiet"));
    box.append(lead, ctx.field(t("ws.kitName"), name), ctx.field(t("ws.mission"), mission), options, actions, secondary);
    parent.append(box);
    // Existing kits stay one click away, below the creation path.
    const others = el("section", undefined, "ws-start ws-others");
    const recent = state.status?.recent || [];
    others.append(el("h2", t("ws.existing")));
    if (recent.length) {
        const list = el("ul", undefined, "ws-recent");
        for (const item of recent) {
            const row = el("li"), text = el("div");
            text.append(el("strong", item.title || item.dir), el("small", item.dir, "mono"));
            row.append(text, button(t("ws.open"), () => ctx.call("/kits/workshop/open", { directory: item.dir })));
            list.append(row);
        }
        others.append(list);
    }
    const links = el("div", undefined, "ws-links");
    links.append(button(t("ws.openFolder"), () => ctx.call("/kits/workshop/open")), button(t("ws.importZip"), () => ctx.call("/kits/workshop/import")),
        button(t("ws.importGit"), () => { git.open = !git.open; ctx.render(); }));
    others.append(links);
    if (git.open) {
        const row = el("div", undefined, "ws-row ws-git"), url = el("input");
        url.type = "url"; url.value = git.url; url.placeholder = "https://github.com/owner/kit.git";
        url.addEventListener("input", () => { git.url = url.value; });
        row.append(ctx.field(t("ws.gitUrl"), url), button(t("ws.import"), async () => { await ctx.call("/kits/workshop/git", { url: git.url }); git.open = false; }));
        others.append(row);
    }
    parent.append(others);
}

export function preparingScreen(ctx, parent) {
    const { el, button, t, state } = ctx;
    const draft = state.status.draft || {}, kit = ctx.kit();
    const actions = [];
    if (draft.busy) actions.push(button(t("convo.pause"), () => ctx.call("/kits/draft/pause", {}, { spin: false })));
    if (draft.status === "paused") actions.push(button(t("convo.resume"), () => ctx.call("/kits/draft/resume", {}, { spin: false }), "primary"));
    actions.push(button(t("ws.backToKit"), () => { state.leftPreparing = true; ctx.render(); }, "quiet"));
    parent.append(ctx.head(t("ws.preparingTitle"), `${kit.contract.kit.name} · ${state.status.ai?.harness || ""} · ${draft.model || ""}`, ...actions));
    const box = el("div", undefined, "ws-working");
    const tasks = draft.tasks?.length ? draft.tasks : [{ label: t("ws.taskMission"), status: "done" }, { label: t("ws.taskWorking"), status: draft.busy ? "doing" : "done" }];
    const list = el("ol", undefined, "ws-tasks");
    for (const task of tasks) {
        const item = el("li", undefined, `ws-task ${task.status}`);
        item.append(el("span", undefined, "ws-task-mark"), el("span", task.label));
        item.setAttribute("aria-label", `${task.label} · ${t(`ws.task.${task.status}`)}`);
        list.append(item);
    }
    box.append(list);
    for (const request of draft.requests || []) {
        const ask = el("div", undefined, "ws-ask");
        ask.append(el("span", t("ws.aiQuestion"), "ws-ask-label"), ctx.requestNode(request));
        box.append(ask);
    }
    if (draft.status === "paused") box.append(el("p", t("ws.paused"), "muted"));
    if (draft.error) {
        box.append(el("p", draft.error, "error"));
        const row = el("div", undefined, "ws-row");
        row.append(button(t("ws.closeAI"), () => ctx.call("/kits/draft/close", {}, { spin: false })), button(t("ws.openSettings"), () => ctx.openSettings(), "quiet"));
        box.append(row);
    }
    box.append(el("small", t("ws.nothingSaved")));
    parent.append(box);
}

const BEFORE = { title: "title", description: "summary", result: "returns" };

function factList(ctx, rows) {
    const list = ctx.el("dl", undefined, "ws-facts");
    for (const [label, value] of rows) {
        if (value === undefined || value === null || value === "") continue;
        list.append(ctx.el("dt", label));
        const cell = ctx.el("dd");
        cell.append(...[value].flat().map(entry => typeof entry === "string" ? document.createTextNode(entry) : entry));
        list.append(cell);
    }
    return list;
}
const names = (ctx, values) => (values || []).map(value => ctx.el("span", value, "mono ws-doc"));

function proposalBody(ctx, item) {
    const { el, t } = ctx, kit = ctx.kit(), proposal = item.proposal;
    const unit = kit.contract.units?.plural?.toLowerCase() || t("ws.elements");
    const yesNo = value => value === undefined ? undefined : t(value ? "ws.yes" : "ws.no");
    const nodes = [];
    if (item.kind === "step.add") {
        if (proposal.description) nodes.push(el("p", proposal.description));
        nodes.push(factList(ctx, [[t("ws.repeated"), proposal.repeat ? t("ws.repeatYes", { plural: unit }) : undefined],
            [t("ws.uses"), names(ctx, proposal.uses)], [t("ws.produces"), names(ctx, proposal.produces)],
            [t("ws.validation"), proposal.approval ? t("ws.validationYes") : t("ws.validationNo")], [t("ws.result"), proposal.result]]));
    } else if (item.kind === "step.update" || item.kind === "kit" || item.kind === "units") {
        const step = guidedSteps(kit).find(entry => entry.id === proposal.step);
        const before = key => {
            if (item.kind === "kit") return { name: kit.contract.kit.name, description: kit.contract.kit.description, about: kit.contract.kit.about }[key];
            if (item.kind === "units") return kit.contract.units?.[key];
            if (!step) return "";
            if (key in BEFORE) return step[BEFORE[key]];
            if (key === "uses" || key === "produces") return step[key].map(entry => entry.name).join(", ");
            if (key === "repeat" || key === "approval") return yesNo(step[key]);
            return step[key];
        };
        const keys = ["title", "description", "result", "name", "about", "label", "plural", "uses", "produces", "repeat", "approval"].filter(key => proposal[key] !== undefined);
        const compare = el("div", undefined, "ws-compare");
        for (const key of keys) {
            const after = Array.isArray(proposal[key]) ? proposal[key].join(", ") : typeof proposal[key] === "boolean" ? yesNo(proposal[key]) : proposal[key];
            const row = el("div", undefined, "ws-compare-row");
            row.append(el("span", t(item.kind === "kit" && key === "description" ? "ws.description" : `ws.field.${key}`), "ws-label"), el("span", before(key) || "—", "ws-before"), el("span", after, "ws-after"));
            compare.append(row);
        }
        if (keys.length) {
            const heading = el("div", undefined, "ws-compare-row ws-compare-head");
            heading.append(el("span"), el("span", t("ws.before")), el("span", t("ws.after")));
            compare.prepend(heading); nodes.push(compare);
        }
    } else if (item.kind === "step.remove") nodes.push(el("p", t("ws.removeStepHint")));
    else if (item.kind === "step.move") nodes.push(el("p", t("ws.moveStepHint", { position: proposal.position })));
    else if (item.kind === "rule.add") nodes.push(factList(ctx, [[t("ws.ruleKind"), t(`ws.rule.${proposal.rule}`)], [t("ws.field.description"), proposal.description],
        [t("ws.documents"), names(ctx, proposal.files)], [t("ws.commands"), names(ctx, proposal.commands)]]));
    else if (item.kind === "contract.patch") nodes.push(el("pre", JSON.stringify(proposal.operations, null, 2), "ws-code"));
    if (proposal.instructions) {
        const more = el("details", undefined, "ws-more");
        more.append(el("summary", t("ws.showInstructions")), ctx.markdownBlock(proposal.instructions));
        nodes.push(more);
    }
    return nodes;
}

function editForm(ctx, item) {
    const { el, t, state } = ctx, proposal = item.proposal;
    state.editing ??= { ...proposal };
    const draft = state.editing, box = el("div", undefined, "ws-edit");
    const input = (key, multiline, rows) => {
        const control = el(multiline ? "textarea" : "input");
        if (multiline) control.rows = rows || 3;
        control.value = Array.isArray(draft[key]) ? draft[key].join("\n") : draft[key] ?? "";
        control.addEventListener("input", () => { draft[key] = ["uses", "produces"].includes(key) ? control.value.split("\n").map(line => line.trim()).filter(Boolean) : control.value; });
        return ctx.field(t(`ws.field.${key}`), control, ["uses", "produces"].includes(key) ? t("ws.onePerLine") : undefined);
    };
    if (item.kind === "kit") box.append(input("name"), input("description", true), input("about", true, 5));
    else if (item.kind === "units") box.append(input("label"), input("plural"));
    else {
        box.append(input("title"), input("description", true), input("result"), input("uses", true), input("produces", true));
        const switches = el("div", undefined, "ws-switches");
        for (const key of ["repeat", "approval"]) {
            const node = ctx.toggle(t(`ws.field.${key}`), !!(draft[key] ?? false), value => { draft[key] = value; });
            switches.append(node);
        }
        box.append(switches, input("instructions", true, 10));
    }
    return box;
}

export function reviewScreen(ctx, parent) {
    const { el, button, t, state } = ctx;
    const review = state.status.review, kit = ctx.kit();
    const pending = review.items.filter(item => item.status === "pending");
    const item = pending[0];
    const listed = review.items;
    const index = listed.indexOf(item);
    const translation = item.kind === "translation";
    parent.append(ctx.head(t(translation ? "ws.reviewTranslationTitle" : "ws.reviewTitle"), kit.contract.kit.name,
        button(t("ws.later"), () => { state.reviewOpen = false; state.editing = null; ctx.render(); })));
    const queue = el("div", undefined, translation ? "ws-queue single" : "ws-queue");
    const decision = el("section", undefined, "ws-decision");
    decision.setAttribute("aria-label", t("ws.proposal"));
    const top = el("div", undefined, "ws-spread");
    top.append(el("small", t("ws.reviewCount", { n: index + 1, total: listed.length })),
        button(t(translation ? "ws.acceptAllTranslations" : "ws.acceptAll"), () => ctx.call("/kits/review/accept-all"), "quiet"));
    const progress = el("div", undefined, "ws-progress"), bar = el("i");
    bar.style.width = `${Math.round(100 * (listed.length - pending.length) / Math.max(1, listed.length))}%`;
    progress.append(bar); progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-valuemin", "0"); progress.setAttribute("aria-valuemax", String(listed.length));
    progress.setAttribute("aria-valuenow", String(listed.length - pending.length));
    decision.append(top, progress, el("span", t(`ws.kind.${item.kind}`), "ws-kind"));
    let translated;
    if (translation) {
        const status = translationStatus(kit, item.proposal.language).find(entry => entry.key === item.proposal.key);
        if (status?.status === "stale") decision.append(el("small", t("ws.updateAfterSource")));
        const pair = el("div", undefined, "ws-bilingual"), left = el("div"), right = el("div");
        left.append(el("span", `${ctx.languageName(ctx.source())} · ${t("ws.source")}`, "ws-label"), el("p", item.target || status?.source || ""));
        translated = el("textarea"); translated.rows = 4; translated.value = item.proposal.text;
        right.append(el("span", `${ctx.languageName(item.proposal.language)} · ${t("ws.proposedByAI")}`, "ws-label"), translated);
        translated.setAttribute("aria-label", ctx.languageName(item.proposal.language));
        pair.append(left, right); decision.append(pair);
    } else {
        decision.append(el("h2", item.target || item.proposal.title || kit.contract.kit.name), el("p", item.title, "muted"));
        if (state.editing && state.editing.__id === item.id) decision.append(editForm(ctx, item));
        else { state.editing = null; decision.append(...proposalBody(ctx, item)); }
    }
    if (item.error) decision.append(el("p", ctx.explainError(Object.assign(new Error(item.error), {})).message, "error"));
    const decide = el("div", undefined, "ws-decide"), right = el("div", undefined, "ws-row");
    const accept = edited => ctx.call("/kits/review/accept", { id: item.id, ...(edited ? { edited } : {}) }).then(() => { state.editing = null; });
    if (translation) {
        right.append(button(t("ws.skip"), () => ctx.call("/kits/review/reject", { id: item.id })),
            button(t("ws.validateTranslation"), () => accept(translated.value.trim() !== item.proposal.text ? { text: translated.value.trim() } : null), "primary"));
        decide.append(button(t("ws.otherTranslation"), () => ctx.call("/kits/review/alternative", { id: item.id }), "quiet"), right);
    } else if (state.editing?.__id === item.id) {
        right.append(button(t("launch.cancel"), () => { state.editing = null; ctx.render(); }),
            button(t("ws.acceptEdited"), () => { const { __id, ...edited } = state.editing; return accept(edited); }, "primary"));
        decide.append(el("span"), right);
    } else {
        if (["step.add", "step.update", "kit", "units"].includes(item.kind))
            right.append(button(t("ws.edit"), () => { state.editing = { ...item.proposal, __id: item.id }; ctx.render(); }));
        right.append(button(t("ws.reject"), () => ctx.call("/kits/review/reject", { id: item.id })), button(t("ws.accept"), () => accept(), "primary"));
        decide.append(button(t("ws.alternative"), () => ctx.call("/kits/review/alternative", { id: item.id }), "quiet"), right);
    }
    for (const control of decide.querySelectorAll("button")) control.disabled = state.busy;
    decision.append(decide);
    if (state.status.draft?.busy) {
        const working = el("p", undefined, "ws-working-line");
        working.append(ctx.spinner("running"), el("span", t("ws.aiStillWorking")));
        decision.append(working);
    }
    queue.append(decision);
    if (!translation) {
        const assembly = el("aside", undefined, "ws-assembly");
        assembly.setAttribute("aria-label", t("ws.assembly"));
        assembly.append(el("h2", t("ws.assembly")));
        for (const entry of listed) {
            const node = el("div", undefined, `ws-node ${entry === item ? "now" : entry.status}`);
            node.append(el("span", entry.target || entry.title), el("small", t(entry === item ? "ws.state.now" : `ws.state.${entry.status}`)));
            assembly.append(node);
        }
        queue.append(assembly);
    }
    parent.append(queue);
}

export function summaryScreen(ctx, parent) {
    const { el, button, t, state } = ctx;
    const review = state.status.review, kit = ctx.kit(), authoring = ctx.authoring();
    parent.append(ctx.head(t("ws.summaryTitle"), kit.contract.kit.name));
    const box = el("div", undefined, "ws-summary");
    box.append(el("p", t("ws.summaryLead")));
    const tally = el("div", undefined, "ws-tally");
    for (const key of ["accepted", "rejected", "pending"]) {
        const cell = el("div"); cell.append(el("strong", String(review.counts[key])), el("small", t(`ws.count.${key}`))); tally.append(cell);
    }
    box.append(tally);
    const next = el("div", undefined, "ws-next");
    for (const language of authoring.languages.filter(code => code !== authoring.sourceLanguage)) {
        const todo = translationStatus(kit, language).filter(entry => entry.status !== "validated").length;
        const line = el("div", undefined, "ws-line"), text = el("span");
        text.append(el("strong", ctx.languageName(language)), el("small", todo ? t("ws.toTranslate", { n: todo }) : t("ws.translated")));
        line.append(text, todo ? button(t("ws.prepareTranslation"), () => ctx.ai("translate", { language })) : ctx.statusLine("ok", t("ws.upToDate")));
        next.append(line);
    }
    const valid = state.status.validation?.valid;
    const check = el("div", undefined, "ws-line"), text = el("span");
    text.append(el("strong", t("ws.verification")), el("small", valid ? t("ws.noProblem") : t("ws.issues", { n: state.status.validation?.errors?.length || 0 })));
    check.append(text, valid ? ctx.statusLine("ok", t("ws.ready")) : button(t("ws.fixWithAI"), () => ctx.ai("fix")));
    next.append(check);
    box.append(next);
    const row = el("div", undefined, "ws-row ws-end");
    row.append(button(t("ws.openKit"), () => ctx.call("/kits/review/summary", {}, { spin: false }), "primary"));
    box.append(row);
    parent.append(box);
}
