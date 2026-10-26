import { UserError } from "./errors.mjs";

const positive = value => Number.isSafeInteger(value) && value > 0 ? value : undefined;
const tokensOf = tier => positive(tier?.tokens ?? tier?.maxContextWindowTokens ?? tier?.max_context_window_tokens);
const efforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

// Unknown limits stay unknown. In particular, a large standard window is not an extended-context capability.
export function normalizeModels(models = []) {
    const seen = new Set();
    return models.filter(model => typeof model?.id === "string" && model.id.trim() && !seen.has(model.id) && seen.add(model.id))
        .map(model => {
            const tiers = [...(Array.isArray(model.contextTiers) ? model.contextTiers : []),
                ...(Array.isArray(model.supportedContextTiers) ? model.supportedContextTiers : [])];
            const standard = tiers.find(tier => tier?.id === "default");
            const extended = tiers.find(tier => (typeof tier === "string" ? tier : tier?.id) === "long_context");
            const prices = model.billing?.tokenPrices;
            const limits = model.capabilities?.limits;
            const standardInput = positive(standard?.maxInputTokens) ?? positive(prices?.maxPromptTokens ?? prices?.contextMax);
            const longInput = positive(extended?.maxInputTokens) ?? positive(prices?.longContext?.maxPromptTokens ?? prices?.longContext?.contextMax);
            // The provider's maximum window may describe the extended tier, not the standard tier.
            const standardTokens = tokensOf(standard) ?? (!extended && !prices?.longContext ? positive(limits?.max_context_window_tokens) : undefined);
            const longTokens = tokensOf(extended);
            const contextTiers = [{ id: "default", ...(standardTokens ? { tokens: standardTokens } : {}),
                ...(standardInput ? { maxInputTokens: standardInput } : {}) }];
            if (extended || prices?.longContext)
                contextTiers.push({ id: "long_context", ...(longTokens ? { tokens: longTokens } : {}),
                    ...(longInput ? { maxInputTokens: longInput } : {}) });
            const supportedReasoningEfforts = [...new Set((Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [])
                .map(item => typeof item === "string" ? item : item?.reasoningEffort).filter(item => efforts.has(item)))];
            const defaultReasoningEffort = supportedReasoningEfforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : undefined;
            return { id: model.id, name: model.name || model.displayName || model.id, contextTiers,
                ...(supportedReasoningEfforts.length ? { supportedReasoningEfforts, ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}) } : {}) };
        });
}

export function modelFamily(model, harness) {
    const id = String(model || "").toLowerCase();
    if (/(^|[/_.-])(claude|anthropic)([/_.-]|$)/.test(id)) return "anthropic";
    if (/(^|[/_.-])(gpt|openai|o[134])([/_.-]|$)/.test(id)) return "openai";
    if (/(^|[/_.-])(gemini|google)([/_.-]|$)/.test(id)) return "google";
    if (harness === "claude") return "anthropic";
    if (harness === "codex") return "openai";
    if (harness === "gemini") return "google";
    return "unknown";
}

export function policyFor(kit, step, agent, family = "unknown") {
    const policies = kit?.contract?.modelPolicies;
    const policy = policies?.steps?.[step?.id] || policies?.agents?.[agent?.name] || policies?.default;
    return policy?.byProducerFamily?.[family] || policy || null;
}

export function declaredModels(kit, agents = []) {
    if (!kit?.contract) return [];
    const policies = kit.contract.modelPolicies;
    const ids = new Set();
    const add = policy => {
        for (const model of policy?.models || []) ids.add(model);
        for (const entry of Object.values(policy?.byProducerFamily || {})) for (const model of entry.models || []) ids.add(model);
    };
    add(policies?.default);
    for (const policy of Object.values(policies?.agents || {})) add(policy);
    for (const policy of Object.values(policies?.steps || {})) add(policy);
    const names = new Set([...(kit.contract.steps || []).map(step => step.agent), ...Object.keys(policies?.agents || {})]);
    for (const agent of agents) if (names.has(agent.name) && typeof agent.model === "string") ids.add(agent.model);
    return normalizeModels([...ids].map(id => ({ id })));
}

export function policyModels({ kit, step, agent, family, models, harness, source }) {
    const policy = policyFor(kit, step, agent, family);
    const defaultId = policy?.default || agent?.model || harness.defaultModel?.() || models[0]?.id;
    const candidates = policy?.models || (defaultId ? [defaultId] : []);
    const allowed = [], switches = [], mapping = new Map();
    for (const id of candidates) {
        let target = models.find(model => model.id === id);
        if (!target && source !== "kit" && harness.resolveModel) {
            const mapped = harness.resolveModel(id);
            target = models.find(model => model.id === mapped);
            if (target) switches.push({ from: id, to: target.id });
        }
        if (!target) continue;
        mapping.set(id, target.id);
        if (!allowed.some(model => model.id === target.id)) allowed.push(target);
    }
    const defaultModel = mapping.get(defaultId) || allowed[0]?.id || null;
    if (defaultModel && !mapping.has(defaultId)) switches.push({ from: defaultId, to: defaultModel });
    return { models: allowed, defaultModel, requestedDefault: defaultId, modelSwitches: switches };
}

export function validateSelection(models, defaults, selection = {}) {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new UserError("model.selectionInvalid");
    const model = Object.hasOwn(selection, "model") && selection.model !== undefined ? selection.model : defaults.model;
    if (!models.length) throw new UserError("model.none");
    const offered = models.find(item => item.id === model);
    if (!offered) throw new UserError("model.unavailable", { model: String(model) });
    const contextTier = Object.hasOwn(selection, "contextTier") && selection.contextTier !== undefined ? selection.contextTier
        : offered.contextTiers.some(tier => tier.id === defaults.contextTier) ? defaults.contextTier : "default";
    if (!offered.contextTiers.some(tier => tier.id === contextTier))
        throw new UserError("model.contextUnavailable", { model, contextTier: String(contextTier) });
    const effort = Object.hasOwn(selection, "reasoningEffort") && selection.reasoningEffort !== undefined
        ? selection.reasoningEffort : defaults.reasoningEffort;
    if (effort !== undefined && effort !== "" && !offered.supportedReasoningEfforts?.includes(effort))
        throw new UserError("model.effortUnavailable", { model, effort: String(effort) });
    const reasoningEffort = effort || offered.defaultReasoningEffort;
    const contextBudget = offered.contextTiers.find(tier => tier.id === contextTier)?.maxInputTokens
        || offered.contextTiers.find(tier => tier.id === contextTier)?.tokens;
    return { model, contextTier, ...(reasoningEffort ? { reasoningEffort } : {}), ...(contextBudget ? { contextBudget } : {}) };
}

// Adapters without introspection retain their requested settings, but never manufacture verified provenance.
export async function appliedSettings(session, requested, harness) {
    const current = typeof session.current === "function" ? await session.current() : null;
    const model = current?.modelId || current?.model?.id || (typeof current?.model === "string" ? current.model : null);
    const tier = current?.contextTier;
    return {
        model: model || requested.model, contextTier: ["default", "long_context"].includes(tier) ? tier : requested.contextTier,
        requestedModel: requested.model, requestedContextTier: requested.contextTier,
        ...(requested.contextBudget ? { contextBudget: requested.contextBudget } : {}),
        ...(requested.reasoningEffort ? { requestedReasoningEffort: requested.reasoningEffort } : {}),
        ...(current?.reasoningEffort || requested.reasoningEffort ? { reasoningEffort: current?.reasoningEffort || requested.reasoningEffort,
            effortVerified: !!current?.reasoningEffort } : {}),
        modelVerified: !!model, contextVerified: ["default", "long_context"].includes(tier),
        ...(model ? { modelFamily: modelFamily(model, harness) } : {}),
    };
}

export function producerOf(run) {
    if (!run?.modelVerified || !run.model) return null;
    return { model: run.model, family: run.modelFamily || modelFamily(run.model), ...(run.contextVerified ? { contextTier: run.contextTier } : {}) };
}

export function productionProvenance(kit, step, unit, runs, resolve) {
    const required = new Set((step.requires || []).map(pattern => resolve(pattern, kit, unit)));
    const review = kit.contract?.modules?.review;
    let producers = runs, paths = required;
    if (review?.reviewStep === step.id) {
        producers = runs.filter(run => run.step === review.buildStep && run.unit === unit);
        paths = new Set(producers.flatMap(run => (run.evidence || []).map(file => file.path)));
        const tasks = kit.contract.modules?.tasks?.file;
        if (tasks) paths.add(resolve(tasks, kit, unit));
        // Shared configuration/planning inputs are not the author of the implementation under review.
        if (!paths.size) return [...required].map(relative => kit.files.find(file => file.path === relative))
            .filter(file => file?.exists && file.hash).map(file => ({ path: file.path, hash: file.hash }));
    }
    return (kit.files || []).filter(file => file.exists && file.hash && paths.has(file.path)).map(file => {
        const run = [...producers].reverse().find(item => item.evidence?.some(evidence => evidence.path === file.path && evidence.hash === file.hash));
        const evidence = run?.evidence.find(item => item.path === file.path && item.hash === file.hash);
        const producer = evidence?.producer;
        return { path: file.path, hash: file.hash, ...(producer ? { producer } : {}) };
    });
}

export function reportedSettings(event, harness) {
    const data = event.data || {};
    if (event.agentId || data.parentToolCallId || data.aggregate) return {};
    if (!["assistant.usage", "vibe_studio.usage", "session.model_changed", "session.model_change"].includes(event.type)) return {};
    const model = data.modelId || (typeof data.model === "string" ? data.model : data.model?.id);
    const tier = data.contextTier;
    return { ...(model ? { model, modelVerified: true, modelFamily: modelFamily(model, harness) } : {}),
        ...(typeof data.reasoningEffort === "string" ? { reasoningEffort: data.reasoningEffort, effortVerified: true } : {}),
        ...(["default", "long_context"].includes(tier) ? { contextTier: tier, contextVerified: true } : {}) };
}

export function producerFamily(provenance) {
    const families = new Set(provenance.map(item => item.producer?.family || "unknown"));
    return families.size === 1 ? [...families][0] : "unknown";
}
