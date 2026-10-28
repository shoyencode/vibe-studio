// Shared helpers of the kit workshop screens: state, server calls and form controls in the Vibe Studio vocabulary.
import { authoringOf, issueLocation, issueMessage } from "/kit-authoring.mjs";

export const NATIVE = { fr: "Français", en: "English", de: "Deutsch", es: "Español", it: "Italiano", pt: "Português", nl: "Nederlands" };

export function createContext(base) {
    const { el, button, t, api, showError, render } = base;
    const state = { section: "projects", status: null, busy: false, page: "presentation", expert: false, display: null,
        reviewOpen: true, leftPreparing: false, editing: null, stepTab: "step", issuesOpen: false, expertDraft: null,
        rulesEditing: false, jsonDraft: null, jsonCheck: null, deferred: false, wasBusy: false, kitDirectory: null };
    const ctx = { ...base, state };
    ctx.kit = () => state.status?.current || null;
    ctx.authoring = () => authoringOf(ctx.kit());
    ctx.source = () => ctx.authoring().sourceLanguage;
    ctx.shown = () => state.display && ctx.authoring().languages.includes(state.display) ? state.display : ctx.source();
    ctx.typing = () => {
        const active = document.activeElement;
        return !!active?.closest?.(".ws") && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && !["checkbox", "radio", "button"].includes(active.type)));
    };
    ctx.renderSoon = () => { if (ctx.typing()) state.deferred = true; else render(); };
    document.addEventListener("focusout", () => {
        if (state.deferred) setTimeout(() => { if (!ctx.typing() && state.deferred) { state.deferred = false; render(); } }, 0);
    });
    ctx.refreshStatus = async () => {
        const next = await api("/kits/workshop/status");
        const directory = next.current?.directory || null;
        if (directory !== state.kitDirectory) Object.assign(state, { kitDirectory: directory, page: "presentation", display: null, expertDraft: null,
            jsonDraft: null, jsonCheck: null, editing: null, issuesOpen: false, rulesEditing: false });
        const busyNow = !!next.draft?.busy;
        if (state.wasBusy && !busyNow && next.review && !next.review.items.some(item => item.round === next.review.round)) base.showNotice(t("ws.noProposals"));
        state.wasBusy = busyNow;
        state.status = next;
        return next;
    };
    ctx.call = async (route, input = {}, { spin = true } = {}) => {
        if (spin) { state.busy = true; ctx.renderSoon(); }
        try { const result = await api(route, input); await ctx.refreshStatus(); return result; }
        catch (error) { await ctx.refreshStatus().catch(() => {}); throw ctx.explainError(error); }
        finally { if (spin) state.busy = false; ctx.renderSoon(); }
    };
    ctx.apply = (proposal, options = { spin: false }) => ctx.call("/kits/workshop/apply", { proposal }, options);
    ctx.ai = async (purpose, input = {}) => {
        state.reviewOpen = true; state.leftPreparing = false; state.editing = null;
        try { return await ctx.call("/kits/ai/request", { purpose, ...input }); }
        catch (error) { ctx.aiFailure(error); return null; }
    };
    ctx.aiFailure = error => {
        base.showNotice([el("span", t("ws.aiUnavailable", { message: error.message })), " ",
            button(t("ws.openSettings"), () => base.openSettings())], true);
    };
    ctx.explain = (issue, contract) => {
        const where = issueLocation(issue, contract);
        const { key, vars } = issueMessage(issue);
        const placeKey = `ws.where.${where.kind}`;
        const place = where.kind === "step" ? t("ws.where.step", { n: where.index + 1, title: where.title })
            : t(placeKey) === placeKey ? where.kind : t(placeKey);
        return { place, field: where.field, step: where.step, message: key ? t(`ws.issue.${key}`, vars) : vars.message };
    };
    ctx.explainError = error => {
        if (!error?.issues?.length || !ctx.kit()) return error;
        const lines = error.issues.slice(0, 4).map(issue => {
            const item = ctx.explain(issue, ctx.kit().contract);
            return `${item.place}${item.field ? ` › ${item.field}` : ""} : ${item.message}`;
        });
        return Object.assign(new Error([error.message, ...lines].join("\n")), { issues: error.issues });
    };
    ctx.head = (title, subtitle, ...actions) => {
        const node = el("div", undefined, "ws-head"), text = el("div", undefined, "ws-grow");
        text.append(el("h1", title));
        if (subtitle) text.append(typeof subtitle === "string" ? el("small", subtitle) : subtitle);
        node.append(text, ...actions.filter(Boolean));
        return node;
    };
    ctx.statusLine = (kind, label) => el("span", label, `ws-status ${kind}`);
    let fieldId = 0;
    ctx.field = (label, control, hint) => {
        // A <label> only wraps a single form control; it would rename and trigger any button inside a group.
        const single = ["INPUT", "SELECT", "TEXTAREA"].includes(control.tagName);
        const node = el(single ? "label" : "div", undefined, "ws-field");
        const caption = el("span", label, "ws-label");
        node.append(caption);
        if (hint) node.append(el("small", hint));
        if (single) control.setAttribute("aria-label", label);
        else {
            caption.id = `ws-field-${++fieldId}`;
            node.setAttribute("role", "group");
            node.setAttribute("aria-labelledby", caption.id);
        }
        node.append(control);
        return node;
    };
    ctx.text = (value, commit, { multiline = false, rows = 3, mono = false, placeholder = "", required = false } = {}) => {
        const input = el(multiline ? "textarea" : "input");
        if (multiline) input.rows = rows;
        input.value = value ?? "";
        if (mono) input.classList.add("mono");
        if (placeholder) input.placeholder = placeholder;
        input.addEventListener("change", () => {
            const next = input.value.trim();
            if (next === String(value ?? "").trim() || (required && !next)) { if (required && !next) input.value = value ?? ""; return; }
            Promise.resolve(commit(next)).catch(error => { input.value = value ?? ""; showError(error); });
        });
        return input;
    };
    ctx.toggle = (label, checked, change, disabled = false) => {
        const node = el("label", undefined, "switch ws-switch"), box = el("input");
        box.type = "checkbox"; box.setAttribute("role", "switch"); box.checked = checked; box.disabled = disabled;
        box.addEventListener("change", () => Promise.resolve(change(box.checked)).catch(error => { box.checked = !box.checked; showError(error); }));
        node.append(box, el("span", label));
        return node;
    };
    ctx.dialog = (title, body, actions) => {
        const dialog = document.querySelector("#confirmation"), content = document.querySelector("#confirm-content");
        const heading = el("h2", title); heading.id = "confirm-title";
        const row = el("div", undefined, "actions");
        const cancel = button(t("launch.cancel"), () => dialog.close());
        row.append(cancel);
        for (const action of actions) row.append(button(action.label, async () => {
            if (action.validate && !action.validate()) return;
            dialog.close();
            await action.run();
        }, action.primary ? "primary" : undefined));
        content.replaceChildren(heading, ...[body].flat().filter(Boolean), row);
        dialog.showModal();
        (content.querySelector("input:not([type=radio]), textarea, select") || cancel).focus();
    };
    ctx.modelDialog = async () => {
        let options;
        try { options = await api("/kits/ai/options"); }
        catch (error) { ctx.aiFailure(error); return; }
        const selection = state.status?.ai?.selection || {};
        const controls = base.modelControls(options, selection.model || options.defaultModel, selection.contextTier || "default");
        ctx.dialog(t("ws.aiModel"), [el("p", t("ws.aiModelHint"), "muted"), controls.node, controls.hint,
            base.catalogNotice(options, async () => { await api("/kits/ai/options", { refresh: true }); await ctx.modelDialog(); })], [{
            label: t("ws.save"), primary: true,
            run: () => ctx.call("/kits/ai/select", { model: controls.model.value, contextTier: controls.context.value, reasoningEffort: controls.effort.value }, { spin: false }),
        }]);
    };
    ctx.aiLine = () => {
        const line = el("small", undefined, "ws-ai-line");
        const ai = state.status?.ai || {};
        line.append(document.createTextNode(t("ws.aiLine", { harness: ai.harness || "", model: ai.selection?.model || t("ws.defaultModel") })), " ",
            button(t("ws.change"), () => ctx.modelDialog(), "quiet"));
        return line;
    };
    ctx.languageName = code => NATIVE[code] || code;
    return ctx;
}
