// Harnesses Vibe Studio can drive. Each adapter is loaded only when the user chooses it (Settings > Harness).
export const HARNESSES = [
    { id: "copilot", name: "GitHub Copilot CLI", command: "copilot", module: "./copilot.mjs", exportName: "CopilotHarness",
        login: "gh auth login --hostname github.com --web", loginCommand: "gh", loginArgs: ["auth", "login", "--hostname", "github.com", "--web"], target: "copilot" },
    { id: "claude", name: "Claude Code", command: "claude", module: "./claude.mjs", exportName: "ClaudeHarness", login: "claude auth login", loginCommand: "claude", loginArgs: ["auth", "login"], target: "claude" },
    { id: "codex", name: "OpenAI Codex CLI", command: "codex", module: "./codex.mjs", exportName: "CodexHarness", login: "codex login", loginCommand: "codex", loginArgs: ["login"], target: "codex" },
    { id: "gemini", name: "Gemini CLI", command: "gemini", module: "./gemini.mjs", exportName: "GeminiHarness", login: "gemini", loginCommand: "gemini", loginArgs: [], target: "gemini" },
];

export async function createHarness(id, options = {}) {
    const info = HARNESSES.find(item => item.id === id) || HARNESSES[0];
    const module = await import(info.module);
    const Harness = module[info.exportName];
    if (!Harness) throw new Error(`Harness adapter ${info.id} is not available.`);
    return new Harness(options);
}

export async function availableHarnesses() {
    const list = [];
    for (const info of HARNESSES) {
        let supported = false;
        try { supported = !!(await import(info.module))[info.exportName]; } catch { supported = false; }
        list.push({ ...info, supported });
    }
    return list;
}
