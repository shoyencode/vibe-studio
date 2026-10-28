// Expert view: technical values, rules and the raw contract, with the same validation as the simple view.
import { rulesOf } from "/kit-authoring.mjs";
import { createSchemaEditor } from "./kit-schema-editor.mjs";

const clone = value => value === undefined ? undefined : structuredClone(value);
const lines = value => value.split("\n").map(line => line.trim()).filter(Boolean);

function editorFor(ctx) {
    const { state } = ctx;
    if (!state.schema) {
        if (!state.schemaLoading) {
            state.schemaLoading = true;
            ctx.api("/kits/schema").then(schema => { state.schema = schema; ctx.render(); }).catch(ctx.showError).finally(() => { state.schemaLoading = false; });
        }
        return null;
    }
    return createSchemaEditor({ el: ctx.el, button: ctx.button, t: ctx.t, schema: state.schema });
}

function draftFor(ctx, key, initial) {
    const { state } = ctx;
    if (state.expertDraft?.key !== key) state.expertDraft = { key, value: initial() };
    return state.expertDraft;
}

// Patch operations for top-level or nested values that may be added, replaced or removed.
function changes(base, before, after) {
    const ops = [];
    for (const [key, value] of Object.entries(after)) {
        const had = before[key] !== undefined, has = value !== undefined && value !== null;
        if (had && !has) ops.push({ op: "remove", path: `${base}/${key}` });
        else if (has && JSON.stringify(value) !== JSON.stringify(before[key])) ops.push({ op: had ? "replace" : "add", path: `${base}/${key}`, value });
    }
    return ops;
}

function saveRow(ctx, operations, reset) {
    const { el, button, t, state } = ctx;
    const row = el("div", undefined, "ws-row ws-footer");
    const save = button(t("ws.save"), async () => {
        const ops = operations();
        if (!ops.length) { reset(); ctx.render(); return; }
        await ctx.apply({ kind: "contract.patch", operations: ops }, { spin: true });
        reset(); ctx.render();
    }, "primary");
    row.append(button(t("launch.cancel"), () => { reset(); ctx.render(); }), save);
    save.disabled = state.busy;
    return row;
}

function diagnostics(ctx) {
    const { el, t, state } = ctx;
    const validation = state.status.validation;
    const line = el("div", undefined, "ws-diag");
    if (!validation || validation.valid) line.append(ctx.statusLine("ok", t("ws.contractValid")), el("small", t("ws.contractValidHint")));
    else line.append(ctx.statusLine("err", t("ws.issues", { n: validation.errors.length })), el("small", t("ws.contractInvalidHint")));
    return line;
}

export function expertStepPage(ctx, parent, step) {
    const { el, button, t, state } = ctx;
    const kit = ctx.kit(), index = step.index, raw = kit.contract.steps[index];
    const guards = raw.guards || {};
    const rulesCount = Object.keys(guards).filter(key => key !== "end").length, endCount = (guards.end || []).length;
    const box = el("div", undefined, "ws-page ws-expert");
    box.append(el("h2", raw.title));
    const tabs = el("div", undefined, "segmented"); tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", t("ws.expertTabs"));
    for (const [key, label] of [["step", t("ws.tab.step")], ["rules", t("ws.tab.rules", { n: rulesCount })], ["end", t("ws.tab.end", { n: endCount })]]) {
        const control = button(label, () => { state.stepTab = key; state.expertDraft = null; ctx.render(); });
        control.setAttribute("aria-pressed", String(state.stepTab === key)); tabs.append(control);
    }
    box.append(tabs);
    const reset = () => { state.expertDraft = null; };
    if (state.stepTab === "step") {
        const draft = draftFor(ctx, `step:${raw.id}`, () => clone(raw)).value;
        const grid = el("div", undefined, "ws-grid2"), preview = el("pre", undefined, "ws-code");
        const update = () => { preview.textContent = JSON.stringify(Object.fromEntries(Object.entries(draft).filter(([key]) => !["i18n", "guards", "variants"].includes(key))), null, 2); };
        const input = (label, key, { mono = true, list = false } = {}) => {
            const control = el(list ? "textarea" : "input");
            if (list) control.rows = 3;
            control.value = list ? (draft[key] || []).join("\n") : draft[key] ?? "";
            if (mono) control.classList.add("mono");
            control.addEventListener("input", () => {
                if (list) { const values = lines(control.value); if (values.length || key !== "approves") draft[key] = values; else delete draft[key]; }
                else if (key === "agent") draft.agent = control.value.trim() || null;
                else draft[key] = control.value.trim();
                update();
            });
            return ctx.field(label, control, list ? t("ws.onePerLine") : undefined);
        };
        const select = (label, key, options) => {
            const control = el("select");
            for (const [value, text] of options) { const option = el("option", text); option.value = value; control.append(option); }
            control.value = draft[key] ?? "";
            control.addEventListener("change", () => { if (control.value) draft[key] = control.value; else delete draft[key]; update(); });
            return ctx.field(label, control);
        };
        grid.append(input(t("ws.x.id"), "id"), input(t("ws.x.skill"), "skill"), input(t("ws.x.agent"), "agent"),
            select(t("ws.x.scope"), "scope", [["project", t("ws.x.scopeProject")], ["unit", t("ws.x.scopeUnit")]]),
            input(t("ws.x.requires"), "requires", { list: true }), input(t("ws.x.outputs"), "outputs", { list: true }),
            input(t("ws.x.approves"), "approves", { list: true }),
            select(t("ws.x.context"), "contextTier", [["", t("ws.x.contextDefault")], ["long_context", t("ws.x.contextLong")]]));
        const flags = el("div", undefined, "ws-switches");
        for (const [key, label] of [["configures", t("ws.x.configures")], ["requiresBuiltUnit", t("ws.x.requiresBuilt")]])
            flags.append(ctx.toggle(label, !!draft[key], value => { if (value) draft[key] = true; else delete draft[key]; update(); }));
        update();
        const layout = el("div", undefined, "ws-expert-layout"), left = el("div"), right = el("aside");
        left.append(grid, flags, diagnostics(ctx), saveRow(ctx, () => JSON.stringify(draft) === JSON.stringify(raw) ? [] : [{ op: "replace", path: `/steps/${index}`, value: draft }], reset));
        right.append(el("h3", t("ws.contractPreview")), preview, button(t("ws.openRaw"), () => { state.page = "json"; ctx.render(); }, "quiet"));
        layout.append(left, right); box.append(layout);
    } else {
        const editor = editorFor(ctx);
        if (!editor) { box.append(el("p", t("ws.loading"), "muted")); parent.append(box); return; }
        const end = state.stepTab === "end";
        const draft = draftFor(ctx, `step:${raw.id}:${state.stepTab}`, () => end ? clone(guards.end || []) : clone(Object.fromEntries(Object.entries(guards).filter(([key]) => key !== "end"))));
        const def = end ? state.schema.$defs.guards.properties.end : { ...state.schema.$defs.guards, properties: Object.fromEntries(Object.entries(state.schema.$defs.guards.properties).filter(([key]) => key !== "end")) };
        box.append(el("p", t(end ? "ws.endHint" : "ws.stepRulesHint"), "muted"),
            editor.editor(def, draft.value, value => { draft.value = value; }, end ? "end" : "guards"));
        box.append(saveRow(ctx, () => {
            const next = end ? { ...Object.fromEntries(Object.entries(guards).filter(([key]) => key !== "end")), ...(draft.value.length ? { end: draft.value } : {}) }
                : { ...draft.value, ...(guards.end ? { end: guards.end } : {}) };
            const empty = !Object.keys(next).length;
            if (JSON.stringify(next) === JSON.stringify(guards)) return [];
            return [raw.guards ? (empty ? { op: "remove", path: `/steps/${index}/guards` } : { op: "replace", path: `/steps/${index}/guards`, value: next })
                : { op: "add", path: `/steps/${index}/guards`, value: next }];
        }, reset));
    }
    parent.append(box);
}

function sectionsPage(ctx, parent, title, hint, keys) {
    const { el, button, t, state } = ctx;
    const editor = editorFor(ctx), contract = ctx.kit().contract;
    const box = el("div", undefined, "ws-page ws-expert");
    box.append(el("h2", title), el("p", hint, "muted"));
    if (!editor) { box.append(el("p", t("ws.loading"), "muted")); parent.append(box); return; }
    const before = Object.fromEntries(keys.map(key => [key, contract[key]]));
    const draft = draftFor(ctx, `sections:${keys.join(",")}`, () => clone(before));
    for (const key of keys) {
        const section = el("section", undefined, "ws-section");
        const required = state.schema.required.includes(key);
        const top = el("div", undefined, "ws-spread");
        top.append(el("h3", t(`ws.x.section.${key}`)));
        if (draft.value[key] === undefined) {
            top.append(button(t("ws.enable"), () => { draft.value[key] = createSchemaEditor({ ...ctx, schema: state.schema }).initial(state.schema.properties[key]); ctx.render(); }));
            section.append(top);
        } else {
            if (!required) top.append(button(t("ws.disable"), () => { draft.value[key] = undefined; ctx.render(); }, "quiet"));
            section.append(top, editor.editor(state.schema.properties[key], draft.value[key], value => { draft.value[key] = value; }, key));
        }
        box.append(section);
    }
    box.append(diagnostics(ctx), saveRow(ctx, () => changes("", before, draft.value), () => { state.expertDraft = null; }));
    parent.append(box);
}

function rulesPage(ctx, parent) {
    const { el, button, t, state } = ctx;
    const contract = ctx.kit().contract;
    const box = el("div", undefined, "ws-page ws-expert");
    const top = el("div", undefined, "ws-spread");
    top.append(el("h2", t("ws.rules")), button(t(state.rulesEditing ? "ws.hideEditor" : "ws.editRules"), () => { state.rulesEditing = !state.rulesEditing; state.expertDraft = null; ctx.render(); }));
    box.append(top, el("p", t("ws.rulesHint"), "muted"));
    const list = el("ul", undefined, "ws-rules");
    for (const rule of rulesOf(contract)) {
        const item = el("li"), body = el("div");
        const technical = [rule.kind, ...(rule.entry.paths || []), ...(rule.entry.scripts || []), ...(rule.entry.commands || []), rule.entry.check, rule.entry.path].filter(Boolean);
        const where = rule.step ? contract.steps.findIndex(step => step.id === rule.step) : -1;
        body.append(el("strong", rule.entry.description || rule.entry.reason || rule.entry.id),
            el("small", [...technical, where >= 0 ? t("ws.where.step", { n: where + 1, title: contract.steps[where].title }) : t("ws.allSteps")].join(" · "), "mono"));
        item.append(el("span", rule.entry.id, "mono ws-rule-id"), body);
        if (rule.step) item.append(button(t("ws.edit"), () => { state.page = `step:${rule.step}`; state.stepTab = rule.kind === "end" ? "end" : "rules"; state.expertDraft = null; ctx.render(); }, "quiet"));
        list.append(item);
    }
    if (!list.children.length) box.append(el("p", t("ws.noRules"), "muted")); else box.append(list);
    if (state.rulesEditing) {
        const editor = editorFor(ctx);
        if (!editor) box.append(el("p", t("ws.loading"), "muted"));
        else {
            const draft = draftFor(ctx, "rules", () => clone(contract.guards || {}));
            box.append(editor.editor(state.schema.$defs.guards, draft.value, value => { draft.value = value; }, "guards"),
                saveRow(ctx, () => {
                    const empty = !Object.keys(draft.value).length;
                    if (JSON.stringify(draft.value) === JSON.stringify(contract.guards || {})) return [];
                    return [contract.guards ? (empty ? { op: "remove", path: "/guards" } : { op: "replace", path: "/guards", value: draft.value }) : { op: "add", path: "/guards", value: draft.value }];
                }, () => { state.expertDraft = null; state.rulesEditing = false; }));
        }
    }
    parent.append(box);
}

function jsonPage(ctx, parent) {
    const { el, button, t, state } = ctx;
    const kit = ctx.kit();
    state.jsonDraft ??= JSON.stringify(kit.contract, null, 2);
    const box = el("div", undefined, "ws-page ws-expert ws-json-page");
    const top = el("div", undefined, "ws-spread"), actions = el("div", undefined, "ws-row");
    const save = button(t("ws.save"), async () => {
        const contract = JSON.parse(state.jsonDraft);
        await ctx.call("/kits/workshop/save", { model: { metadata: kit.metadata, contract } });
        state.jsonDraft = null; state.jsonCheck = null;
    }, "primary");
    actions.append(button(t("launch.cancel"), () => { state.jsonDraft = null; state.jsonCheck = null; ctx.render(); }), save);
    top.append(el("h2", t("ws.rawContract")), actions);
    const layout = el("div", undefined, "ws-expert-layout");
    const area = el("textarea", undefined, "mono ws-json"); area.value = state.jsonDraft; area.spellcheck = false; area.rows = 28;
    area.setAttribute("aria-label", t("ws.rawContract"));
    const aside = el("aside", undefined, "ws-json-diag");
    const draw = () => {
        aside.replaceChildren();
        const check = state.jsonCheck;
        save.disabled = state.busy || !!check?.parse || check?.valid === false;
        if (!check) { aside.append(ctx.statusLine("ok", t("ws.contractValid"))); return; }
        if (check.parse) { aside.append(ctx.statusLine("err", t("ws.jsonInvalid")), el("p", check.parse, "muted")); return; }
        if (check.valid) { aside.append(ctx.statusLine("ok", t("ws.contractValid"))); return; }
        aside.append(ctx.statusLine("err", t("ws.issues", { n: check.errors.length })));
        let parsed = kit.contract;
        try { parsed = JSON.parse(state.jsonDraft); } catch { /* Keep the saved contract for locations. */ }
        for (const issue of check.errors.slice(0, 20)) {
            const item = ctx.explain(issue, parsed), row = el("div", undefined, "ws-problem");
            row.append(el("strong", item.place + (item.field ? ` › ${item.field}` : "")), el("span", item.message, "muted"));
            aside.append(row);
        }
    };
    let timer;
    area.addEventListener("input", () => {
        state.jsonDraft = area.value;
        clearTimeout(timer);
        timer = setTimeout(async () => {
            let contract;
            try { contract = JSON.parse(area.value); }
            catch (error) { state.jsonCheck = { parse: error.message }; if (aside.isConnected) draw(); else ctx.renderSoon(); return; }
            try { state.jsonCheck = await ctx.api("/kits/workshop/check", { model: { metadata: kit.metadata, contract } }); }
            catch (error) { state.jsonCheck = { parse: error.message }; }
            if (aside.isConnected) draw(); else ctx.renderSoon();
        }, 500);
    });
    draw();
    layout.append(area, aside);
    box.append(top, el("p", t("ws.rawHint"), "muted"), layout);
    parent.append(box);
}

export function expertPage(ctx, parent, page) {
    const { t } = ctx;
    if (page === "config") sectionsPage(ctx, parent, t("ws.configuration"), t("ws.configurationHint"), ["config", "units", "deliverables", "modules"]);
    else if (page === "models") sectionsPage(ctx, parent, t("ws.models"), t("ws.modelsHint"), ["modelPolicies"]);
    else if (page === "rules") rulesPage(ctx, parent);
    else jsonPage(ctx, parent);
}
