const count = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

// Context occupancy is a snapshot; API usage is cumulative and must never be used as occupancy.
export function updateMetrics(previous = {}, event) {
    const data = event.data || {};
    const nested = !!event.agentId || !!data.parentToolCallId;
    if (event.type === "session.usage_info") {
        if (nested) return previous;
        return { ...previous, ...(count(data.tokenLimit) ? { tokenLimit: data.tokenLimit } : {}),
            ...(count(data.currentTokens) ? { currentTokens: data.currentTokens } : {}) };
    }
    if (!["assistant.usage", "vibe_studio.usage"].includes(event.type)) return previous;
    const next = { ...previous, ...(!nested && !data.aggregate && data.model ? { model: data.model } : {}) };
    for (const [key, value] of Object.entries({
        inputTokens: data.inputTokens, outputTokens: data.outputTokens,
        cacheReadTokens: data.cacheReadTokens ?? data.cachedInputTokens, cacheWriteTokens: data.cacheWriteTokens,
        credits: count(data.copilotUsage?.totalNanoAiu) ? data.copilotUsage.totalNanoAiu / 1e9 : undefined,
        premiumRequests: event.type === "assistant.usage" ? data.cost : undefined,
        costUsd: event.type === "vibe_studio.usage" ? data.costUsd : undefined,
    })) if (count(value)) next[key] = (previous[key] || 0) + value;
    if (!nested && count(data.contextWindow)) next.tokenLimit = data.contextWindow;
    return next;
}
