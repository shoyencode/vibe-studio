import { defineLoader } from "vitepress";
import { EMPTY, fetchStats, type GitHubStats } from "./theme/github";

declare const data: GitHubStats;
export { data };

// Fallback indicators computed when the site is built; the page refreshes them live in the browser.
export default defineLoader({
    async load(): Promise<GitHubStats> {
        try { return await fetchStats(process.env.GITHUB_TOKEN); }
        catch { return EMPTY; }
    },
});
