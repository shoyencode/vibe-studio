// Kit workshop: describe a mission, review the AI draft one proposal at a time, refine the kit, translate it, expert view.
// Extends the existing Operate surface: same tokens, controls and conversation components as the rest of Vibe Studio.
import { createContext } from "./kit-workshop-common.mjs";
import { preparingScreen, reviewScreen, startScreen, summaryScreen } from "./kit-workshop-flow.mjs";
import { kitScreen } from "./kit-workshop-kit.mjs";

export function createKitWorkshopUI(base) {
    const ctx = createContext(base);
    const { el, button, t, state } = ctx;
    let catalog = null, catalogError = null, eventTimer = null;

    function screen() {
        const kit = ctx.kit(), status = state.status;
        if (!kit) return "start";
        const draft = status.draft, review = status.review;
        if (draft && (draft.busy || ["pausing", "paused", "error"].includes(draft.status)) && !state.leftPreparing && !review.counts.pending) return "preparing";
        if (review.counts.pending && state.reviewOpen) return "review";
        if (review.summary && !draft?.busy) return "summary";
        return "kit";
    }

    function official(parent) {
        const box = el("div", undefined, "ws-catalog");
        const top = el("div", undefined, "ws-spread");
        top.append(el("h1", t("author.catalog")), button(t("header.refresh"), async () => {
            catalogError = null;
            try { catalog = await base.api("/kits/catalog", { refresh: true }); }
            catch (error) { catalogError = error.message; }
            base.render();
        }));
        box.append(top, el("p", t("author.catalogHint"), "muted"));
        if (catalogError) box.append(el("p", catalogError, "error"));
        if (!catalog) { box.append(el("p", t("author.catalogLoad"), "muted")); parent.append(box); return; }
        if (catalog.disabled) { box.append(el("p", t("author.catalogDisabled"), "muted")); parent.append(box); return; }
        if (catalog.error) box.append(el("p", catalog.error, "error"));
        if (catalog.cached) box.append(el("p", t("author.cached"), "muted"));
        const entries = catalog.kits || [];
        if (!entries.length) box.append(el("p", t("author.noOfficial"), "muted"));
        const list = el("ul", undefined, "project-list");
        for (const entry of entries) {
            const row = el("li"), detail = el("div");
            detail.append(el("strong", `${entry.name} · ${entry.version}`), el("p", entry.description),
                el("small", `${entry.license} · ${entry.maintainer} · Vibe Studio ≥ ${entry.minVibeStudio}`));
            const install = button(t("author.install"), () => ctx.dialog(t("author.install"), el("p", t("author.installHint", { name: entry.name })), [{
                label: t("author.install"), primary: true,
                run: async () => { const result = await ctx.call("/kits/catalog/install", { id: entry.id }); if (result) window.dispatchEvent(new CustomEvent("kit-project-opened")); },
            }]));
            install.disabled = state.busy;
            row.append(detail, install); list.append(row);
        }
        box.append(list);
        parent.append(box);
    }

    function workshop(parent) {
        if (!state.status) { parent.append(el("p", t("ws.loading"), "muted")); return; }
        const container = el("div", undefined, "ws");
        container.setAttribute("aria-busy", String(state.busy));
        const current = screen();
        container.dataset.screen = current;
        if (current === "start") startScreen(ctx, container);
        else if (current === "preparing") preparingScreen(ctx, container);
        else if (current === "review") reviewScreen(ctx, container);
        else if (current === "summary") summaryScreen(ctx, container);
        else kitScreen(ctx, container);
        if (state.busy) {
            const live = el("p", t("author.working"), "sr-only"); live.setAttribute("role", "status"); container.append(live);
        }
        parent.append(container);
    }

    return {
        get section() { return state.section; },
        set section(value) { state.section = value; },
        render(parent) {
            if (state.section === "workshop") workshop(parent);
            else if (state.section === "catalog") official(parent);
        },
        async refresh() { await ctx.refreshStatus(); },
        // Conversation changes of the drafting session (questions, messages) refresh the workshop, without stealing focus.
        event(sessionId) {
            if (!state.status?.draft || state.status.draft.sessionId !== sessionId) return false;
            clearTimeout(eventTimer);
            eventTimer = setTimeout(() => { void ctx.refreshStatus().then(() => { if (state.section === "workshop") ctx.renderSoon(); }).catch(base.showError); }, 150);
            return true;
        },
        async goto(sessionId) {
            await ctx.refreshStatus();
            if (state.status?.draft?.sessionId !== sessionId) return false;
            state.section = "workshop"; state.leftPreparing = false;
            return true;
        },
        async loadCatalog() {
            try { catalog = await base.api("/kits/catalog"); }
            catch (error) { catalogError = error.message; }
        },
        renderSoon: () => ctx.renderSoon(),
        typing: () => ctx.typing(),
    };
}
