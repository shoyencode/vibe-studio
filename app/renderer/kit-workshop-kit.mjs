// Kit view: outline on the left, one plain page per step, presentation and languages, display in another language.
import { LANGUAGES, guidedSteps, translationStatus } from "/kit-authoring.mjs";
import { expertPage, expertStepPage } from "./kit-workshop-expert.mjs";

function menu(ctx) {
    const { el, button, t } = ctx;
    const details = el("details", undefined, "ws-menu");
    const summary = el("summary", "⋯"); summary.setAttribute("aria-label", t("ws.moreActions")); summary.title = t("ws.moreActions");
    const list = el("div", undefined, "ws-menu-list");
    const item = (label, action) => button(label, async () => { details.open = false; await action(); });
    list.append(item(t("ws.share"), () => shareDialog(ctx)), item(t("ws.revealFolder"), () => ctx.api("/kits/workshop/reveal")),
        item(t("ws.closeKit"), () => ctx.call("/kits/workshop/close", {}, { spin: false })));
    details.append(summary, list);
    details.addEventListener("toggle", () => {
        if (!details.open) return;
        const close = event => {
            if (details.contains(event.target)) return;
            details.open = false;
            document.removeEventListener("click", close, true);
        };
        setTimeout(() => document.addEventListener("click", close, true));
    });
    return details;
}

function shareDialog(ctx) {
    const { el, t, state } = ctx;
    const choices = el("div", undefined, "ws-choices");
    const choice = (value, title, hint, disabled) => {
        const label = el("label", undefined, "ws-choice"), input = el("input"), text = el("span");
        input.type = "radio"; input.name = "share"; input.value = value; input.disabled = disabled; input.checked = value === "zip";
        text.append(el("strong", title), el("small", hint));
        label.append(input, text); choices.append(label);
    };
    choice("zip", t("ws.shareZip"), t("ws.shareZipHint"), false);
    choice("catalog", t("ws.shareCatalog"), state.status.catalog ? t("ws.shareCatalogHint") : t("ws.shareCatalogOff"), !state.status.catalog);
    ctx.dialog(t("ws.share"), choices, [{ label: t("ws.continue"), primary: true, run: () => {
        const value = choices.querySelector("input:checked")?.value;
        return value === "catalog" ? ctx.call("/kits/submit").then(result => { if (result?.url) ctx.showNotice([el("span", t("author.submitted")), " ", ctx.button(result.url, () => ctx.api("/link", { url: result.url }))]); })
            : ctx.call("/kits/workshop/export");
    } }]);
}

function header(ctx) {
    const { el, button, t, state } = ctx;
    const kit = ctx.kit(), authoring = ctx.authoring(), shown = ctx.shown();
    const name = shown === authoring.sourceLanguage ? kit.contract.kit.name : kit.contract.kit.i18n?.[shown]?.name || kit.contract.kit.name;
    const sub = el("div", undefined, "ws-row");
    const validation = state.status.validation;
    if (state.expert) sub.append(el("small", `${kit.contract.kit.id} · ${kit.metadata.version}`, "mono"));
    if (!validation || validation.valid) sub.append(ctx.statusLine("ok", t("ws.ready")));
    else sub.append(button(t("ws.issues", { n: validation.errors.length }), () => { state.issuesOpen = !state.issuesOpen; ctx.render(); }, "quiet ws-status err"));
    const actions = [];
    if (authoring.languages.length > 1) {
        const select = el("select");
        for (const code of authoring.languages) { const option = el("option", ctx.languageName(code)); option.value = code; select.append(option); }
        select.value = shown;
        select.addEventListener("change", () => { state.display = select.value; ctx.render(); });
        const label = el("label", undefined, "ws-inline"); label.append(el("span", t("ws.language")), select);
        select.setAttribute("aria-label", t("ws.language"));
        actions.push(label);
    }
    const mode = el("div", undefined, "segmented ws-mode"); mode.setAttribute("role", "group"); mode.setAttribute("aria-label", t("ws.mode"));
    for (const [value, label] of [[false, t("ws.simple")], [true, t("ws.expert")]]) {
        const control = button(label, () => { state.expert = value; state.stepTab = "step"; if (!value && ["config", "rules", "models", "json"].includes(state.page)) state.page = "presentation"; ctx.render(); });
        control.setAttribute("aria-pressed", String(state.expert === value)); mode.append(control);
    }
    actions.push(mode, button(t("ws.test"), async () => {
        const result = await ctx.call("/kits/workshop/test");
        if (result) window.dispatchEvent(new CustomEvent("kit-project-opened"));
    }), menu(ctx));
    return ctx.head(name, sub, ...actions);
}

function banner(ctx) {
    const { el, button, t, state } = ctx;
    const review = state.status.review, draft = state.status.draft;
    if (review?.counts.pending) {
        const line = el("div", undefined, "ws-banner");
        line.append(el("span", t("ws.pendingBanner", { n: review.counts.pending })), button(t("ws.reviewNow"), () => { state.reviewOpen = true; ctx.render(); }, "primary"));
        return line;
    }
    if (draft?.busy || draft?.status === "paused") {
        const line = el("div", undefined, "ws-banner");
        const text = el("span", undefined, "ws-row"); text.append(ctx.spinner(draft.status === "paused" ? "paused" : "running"), el("span", t(draft.busy ? "ws.aiWorkingBanner" : "ws.paused")));
        line.append(text, button(t("ws.follow"), () => { state.leftPreparing = false; ctx.render(); }));
        return line;
    }
    return null;
}

function issuesPanel(ctx) {
    const { el, button, t, state } = ctx;
    const errors = state.status.validation?.errors || [];
    const box = el("section", undefined, "ws-issues"); box.setAttribute("aria-label", t("ws.issuesTitle"));
    const list = el("ul");
    for (const issue of errors.slice(0, 30)) {
        const item = ctx.explain(issue, ctx.kit().contract), row = el("li");
        row.append(el("strong", item.place + (item.field ? ` › ${item.field}` : "")), el("span", item.message));
        if (item.step) row.append(button(t("ws.goTo"), () => { state.page = `step:${item.step}`; ctx.render(); }, "quiet"));
        list.append(row);
    }
    const actions = el("div", undefined, "ws-row");
    actions.append(button(t("ws.fixWithAI"), () => ctx.ai("fix"), "primary"), button(t("ws.hide"), () => { state.issuesOpen = false; ctx.render(); }, "quiet"));
    box.append(el("h2", t("ws.issuesTitle")), list, actions);
    return box;
}

function outline(ctx) {
    const { el, button, t, state } = ctx;
    const kit = ctx.kit(), shown = ctx.shown(), source = ctx.source();
    const nav = el("nav", undefined, "ws-outline"); nav.setAttribute("aria-label", t("ws.outline"));
    const link = (key, label, number) => {
        const control = button("", () => { state.page = key; state.stepTab = "step"; state.expertDraft = null; state.rulesEditing = false; ctx.render(); });
        if (number !== undefined) control.append(el("span", String(number), "ws-n"));
        control.append(el("span", label));
        if (state.page === key) control.setAttribute("aria-current", "page");
        return control;
    };
    nav.append(el("span", t("ws.kit"), "ws-lbl"), link("presentation", t("ws.presentation")));
    if (state.expert) nav.append(link("config", t("ws.configuration")), link("rules", t("ws.rules")), link("models", t("ws.models")));
    nav.append(el("span", undefined, "ws-sep"), el("span", t("ws.journey"), "ws-lbl"));
    kit.contract.steps.forEach((step, index) => {
        const title = shown === source ? step.title : step.i18n?.[shown]?.title || step.title;
        nav.append(link(`step:${step.id}`, title, index + 1));
    });
    if (shown === source) {
        const add = button("", () => addStepDialog(ctx), "ws-add"); add.append(el("span", "+", "ws-n"), el("span", t("ws.addStep")));
        nav.append(add);
    }
    if (state.expert) nav.append(el("span", undefined, "ws-sep"), link("json", t("ws.rawContract"), "{ }"));
    return nav;
}

function addStepDialog(ctx) {
    const { el, t, state } = ctx;
    const title = el("input"); title.required = true; title.maxLength = 120;
    ctx.dialog(t("ws.addStep"), [el("p", t("ws.addStepHint"), "muted"), ctx.field(t("ws.field.title"), title)], [{
        label: t("ws.add"), primary: true, validate: () => title.reportValidity(),
        run: async () => {
            await ctx.apply({ kind: "step.add", title: title.value.trim() });
            const steps = ctx.kit().contract.steps;
            state.page = `step:${steps.at(-1).id}`; ctx.render();
        },
    }]);
}

function translationField(ctx, label, entry, multiline) {
    const { el, t } = ctx;
    const language = ctx.shown();
    const box = el("div", undefined, "ws-translation");
    const control = ctx.text(entry?.text || "", value => ctx.apply({ kind: "translation", language, key: entry.key, text: value }), { multiline, required: true });
    const top = el("div", undefined, "ws-spread");
    top.append(el("span", `${label} · ${ctx.languageName(language)}`, "ws-label"),
        ctx.statusLine(entry?.status === "validated" ? "ok" : "warn", t(`ws.translation.${entry?.status || "missing"}`)));
    control.setAttribute("aria-label", label);
    box.append(top, control, el("small", t("ws.sourceText", { text: entry?.source || "" })));
    return box;
}

function presentationPage(ctx, parent) {
    const { el, button, t, state } = ctx;
    const kit = ctx.kit(), authoring = ctx.authoring(), shown = ctx.shown();
    const box = el("form", undefined, "ws-page"); box.addEventListener("submit", event => event.preventDefault());
    box.append(el("h2", t("ws.presentation")));
    if (shown !== authoring.sourceLanguage) {
        const status = translationStatus(kit, shown), find = key => status.find(entry => entry.key === key);
        for (const [key, label, multiline] of [["kit.name", t("ws.kitName"), false], ["kit.description", t("ws.description"), true], ["kit.about", t("ws.about"), true],
            ["units.label", t("ws.unitLabel"), false], ["units.plural", t("ws.unitPlural"), false]])
            if (find(key)) box.append(translationField(ctx, label, find(key), multiline));
        parent.append(box); return;
    }
    if (kit.contract.steps.length === 1 && !state.status.draft?.busy) {
        const empty = el("div", undefined, "ws-callout");
        empty.append(el("p", t("ws.emptyJourney")), button(t("ws.prepare"), () => ctx.ai("draft"), "primary"));
        box.append(empty);
    }
    box.append(ctx.field(t("ws.kitName"), ctx.text(kit.contract.kit.name, value => ctx.apply({ kind: "kit", name: value }), { required: true })),
        ctx.field(t("ws.description"), ctx.text(kit.contract.kit.description || "", value => ctx.apply({ kind: "kit", description: value }), { multiline: true, required: true }), t("ws.descriptionHint")),
        ctx.field(t("ws.about"), ctx.text(kit.contract.kit.about || "", value => ctx.apply({ kind: "kit", about: value }), { multiline: true, rows: 4 }), t("ws.aboutHint")),
        ctx.field(t("ws.mission"), ctx.text(authoring.mission, value => ctx.apply({ kind: "kit", mission: value }), { multiline: true, rows: 4, required: true }), t("ws.missionHint")));
    if (kit.contract.units) {
        const row = el("div", undefined, "ws-grid2");
        row.append(ctx.field(t("ws.unitLabel"), ctx.text(kit.contract.units.label, value => ctx.apply({ kind: "units", label: value }), { required: true })),
            ctx.field(t("ws.unitPlural"), ctx.text(kit.contract.units.plural, value => ctx.apply({ kind: "units", plural: value }), { required: true })));
        box.append(el("h3", t("ws.repeatedElement")), el("small", t("ws.repeatedElementHint")), row);
    }
    box.append(el("h3", t("ws.languages")));
    const table = el("div", undefined, "ws-langs");
    const sourceCount = translationStatus(kit, authoring.sourceLanguage === "en" ? "fr" : "en").length;
    const sourceRow = el("div", undefined, "ws-line");
    sourceRow.append(el("strong", ctx.languageName(authoring.sourceLanguage)), el("small", t("ws.sourceCount", { n: sourceCount })), ctx.statusLine("ok", t("ws.source")));
    table.append(sourceRow);
    const pending = state.status.review?.items.filter(item => item.status === "pending" && item.kind === "translation") || [];
    for (const language of authoring.languages.filter(code => code !== authoring.sourceLanguage)) {
        const status = translationStatus(kit, language);
        const count = kind => status.filter(entry => entry.status === kind).length;
        const waiting = pending.filter(item => item.proposal.language === language).length;
        const row = el("div", undefined, "ws-line"), text = el("small");
        text.append(document.createTextNode(t("ws.langValidated", { n: count("validated"), total: status.length })));
        if (count("missing")) text.append(document.createTextNode(` · ${t("ws.langMissing", { n: count("missing") })}`));
        if (count("stale")) text.append(" · ", el("span", t("ws.langStale", { n: count("stale") }), "ws-warn"));
        const action = waiting ? button(t("ws.reviewTranslations", { n: waiting }), () => { state.reviewOpen = true; ctx.render(); })
            : count("missing") + count("stale") ? button(t("ws.prepareTranslation"), () => ctx.ai("translate", { language }))
                : ctx.statusLine("ok", t("ws.upToDate"));
        row.append(el("strong", ctx.languageName(language)), text, action);
        table.append(row);
    }
    box.append(table);
    const others = LANGUAGES.filter(code => !authoring.languages.includes(code));
    if (others.length) {
        const add = el("div", undefined, "ws-row"), select = el("select");
        for (const code of others) { const option = el("option", ctx.languageName(code)); option.value = code; select.append(option); }
        select.setAttribute("aria-label", t("ws.addLanguage"));
        add.append(select, button(t("ws.addLanguage"), () => ctx.apply({ kind: "languages", languages: [...authoring.languages, select.value] })));
        box.append(add);
    }
    parent.append(box);
}

function documents(ctx, step, key, list, available) {
    const { el, button, t } = ctx;
    const box = el("div", undefined, "ws-docs");
    box.append(el("span", t(key === "uses" ? "ws.uses" : "ws.produces"), "ws-label"));
    const chips = el("div", undefined, "ws-chips");
    const save = next => ctx.apply({ kind: "step.update", step: step.id, [key]: next });
    for (const doc of list) {
        const chip = el("span", undefined, "ws-chip");
        const remove = button("×", () => save(list.filter(item => item !== doc).map(item => item.name)), "ws-chip-remove");
        remove.setAttribute("aria-label", t("ws.removeDocument", { name: doc.name }));
        remove.disabled = key === "produces" && list.length === 1;
        chip.append(el("span", doc.name, "mono"), remove); chips.append(chip);
    }
    const input = el("input"); input.setAttribute("list", `ws-docs-${key}`); input.placeholder = t("ws.documentName");
    input.setAttribute("aria-label", t(key === "uses" ? "ws.addUsed" : "ws.addProduced"));
    const options = el("datalist"); options.id = `ws-docs-${key}`;
    for (const name of available) { const option = el("option"); option.value = name; options.append(option); }
    const add = button(t("ws.add"), () => { const name = input.value.trim(); if (name) return save([...list.map(item => item.name), name]); });
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); add.click(); } });
    chips.append(input, options, add);
    box.append(chips);
    return box;
}

function stepPage(ctx, parent, id) {
    const { el, button, t, state } = ctx;
    const kit = ctx.kit(), steps = guidedSteps(kit), step = steps.find(entry => entry.id === id);
    if (!step) { state.page = "presentation"; presentationPage(ctx, parent); return; }
    if (state.expert) { expertStepPage(ctx, parent, step); return; }
    const box = el("form", undefined, "ws-page"); box.addEventListener("submit", event => event.preventDefault());
    const shown = ctx.shown();
    if (shown !== ctx.source()) {
        const status = translationStatus(kit, shown), find = field => status.find(entry => entry.key === `step:${step.id}.${field}`);
        box.append(el("h2", step.i18n?.[shown]?.title || step.title));
        for (const [field, label, multiline] of [["title", t("ws.field.title"), false], ["summary", t("ws.field.description"), true], ["returns", t("ws.field.result"), false]])
            if (find(field)) box.append(translationField(ctx, label, find(field), multiline));
        box.append(el("h3", t("ws.instructions")), el("p", t("ws.instructionsLanguage"), "muted"));
        parent.append(box); return;
    }
    const top = el("div", undefined, "ws-spread");
    top.append(el("h2", step.title), button(t("ws.improve"), () => improveDialog(ctx, step), "quiet"));
    box.append(top);
    if (step.configures) box.append(el("p", t("ws.configureNote"), "muted"));
    const save = patch => ctx.apply({ kind: "step.update", step: step.id, ...patch });
    box.append(ctx.field(t("ws.field.title"), ctx.text(step.title, value => save({ title: value }), { required: true })),
        ctx.field(t("ws.field.description"), ctx.text(step.summary, value => save({ description: value }), { multiline: true, required: true })),
        ctx.field(t("ws.field.result"), ctx.text(step.returns, value => save({ result: value }), { required: true })));
    const earlier = steps.slice(0, step.index).flatMap(entry => entry.produces.map(doc => doc.name));
    const docs = el("section", undefined, "ws-section");
    docs.append(el("h3", t("ws.documents")), documents(ctx, step, "uses", step.uses, [...new Set(earlier)]), documents(ctx, step, "produces", step.produces, []));
    box.append(docs);
    const switches = el("section", undefined, "ws-section ws-switches");
    const unit = (kit.contract.units?.label || t("ws.element")).toLowerCase();
    if (!step.configures) switches.append(ctx.toggle(t("ws.repeatEach", { label: unit }), step.repeat, value => save({ repeat: value })));
    switches.append(ctx.toggle(t("ws.userValidates"), step.approval, value => save({ approval: value })));
    box.append(switches);
    const instructions = el("section", undefined, "ws-section");
    instructions.append(el("h3", t("ws.instructions")), el("small", t("ws.instructionsHint")));
    const area = ctx.text(step.instructions, value => save({ instructions: value }), { multiline: true, rows: 12, required: true });
    area.classList.add("ws-prose"); area.setAttribute("aria-label", t("ws.instructions"));
    instructions.append(area);
    box.append(instructions);
    const footer = el("div", undefined, "ws-row ws-footer");
    const move = delta => ctx.apply({ kind: "step.move", step: step.id, position: step.index + 1 + delta });
    const up = button(t("ws.moveUp"), () => move(-1), "quiet"), down = button(t("ws.moveDown"), () => move(1), "quiet");
    up.disabled = step.index === 0; down.disabled = step.index === steps.length - 1;
    const remove = button(t("ws.removeStep"), () => ctx.dialog(t("ws.removeStep"), el("p", t("ws.removeStepConfirm", { title: step.title })), [{
        label: t("ws.removeStep"), run: async () => { await ctx.apply({ kind: "step.remove", step: step.id }); state.page = "presentation"; ctx.render(); },
    }]), "quiet ws-danger");
    remove.disabled = steps.length === 1;
    footer.append(up, down, remove);
    box.append(footer);
    parent.append(box);
}

function improveDialog(ctx, step) {
    const { el, t } = ctx;
    const request = el("textarea"); request.rows = 4; request.placeholder = t("ws.improvePlaceholder");
    ctx.dialog(t("ws.improve"), [el("p", t("ws.improveHint", { title: step.title }), "muted"), ctx.field(t("ws.improveRequest"), request)], [{
        label: t("ws.askAI"), primary: true, run: () => ctx.ai("improve", { step: step.id, text: request.value.trim() }),
    }]);
}

export function kitScreen(ctx, parent) {
    const { el, state } = ctx;
    parent.append(header(ctx));
    const notice = banner(ctx);
    if (notice) parent.append(notice);
    if (state.issuesOpen && state.status.validation && !state.status.validation.valid) parent.append(issuesPanel(ctx));
    const body = el("div", undefined, "ws-body");
    const page = el("div", undefined, "ws-editor");
    body.append(outline(ctx), page);
    parent.append(body);
    if (state.page.startsWith("step:")) stepPage(ctx, page, state.page.slice(5));
    else if (state.expert && ["config", "rules", "models", "json"].includes(state.page)) expertPage(ctx, page, state.page);
    else presentationPage(ctx, page);
}
