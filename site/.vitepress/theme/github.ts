// GitHub indicators shown on the home page. The same code runs at build time (fallback values)
// and in the browser (live values, cached for an hour to respect the anonymous API limit).
export const REPOSITORY = "shoyencode/vibe-studio";
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases/latest`;

export interface GitHubStats {
    version: string | null;
    published: string | null;
    downloads: number | null;
    stars: number | null;
    forks: number | null;
    openIssues: number | null;
    pushed: string | null;
    ci: "success" | "failure" | "running" | null;
    ciUrl: string | null;
    license: string | null;
    installer: string | null;
    portable: string | null;
    fetchedAt: string | null;
}

export const EMPTY: GitHubStats = {
    version: null, published: null, downloads: null, stars: null, forks: null, openIssues: null, pushed: null,
    ci: null, ciUrl: null, license: null, installer: null, portable: null, fetchedAt: null,
};

interface Release { draft: boolean; prerelease: boolean; tag_name: string; published_at: string; assets: { name: string; download_count: number; browser_download_url: string }[] }

async function json(path: string, token?: string): Promise<any> {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, { headers });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    return response.json();
}

// Each source fails independently: an unavailable value stays null and is shown as unavailable, never invented.
export async function fetchStats(token?: string): Promise<GitHubStats> {
    const [repo, releases, runs] = await Promise.allSettled([
        json("", token), json("/releases?per_page=100", token), json("/actions/workflows/ci.yml/runs?branch=main&per_page=1", token),
    ]);
    const stats: GitHubStats = { ...EMPTY, fetchedAt: new Date().toISOString() };
    if (repo.status === "fulfilled") {
        const value = repo.value;
        Object.assign(stats, { stars: value.stargazers_count, forks: value.forks_count, openIssues: value.open_issues_count,
            pushed: value.pushed_at, license: value.license?.spdx_id ?? null });
    }
    if (releases.status === "fulfilled" && Array.isArray(releases.value)) {
        const list = releases.value as Release[];
        stats.downloads = list.reduce((total, release) => total + release.assets.reduce((sum, asset) => sum + asset.download_count, 0), 0);
        const latest = list.find(release => !release.draft && !release.prerelease);
        if (latest) {
            stats.version = latest.tag_name.replace(/^v/, "");
            stats.published = latest.published_at;
            stats.installer = latest.assets.find(asset => /^Vibe-Studio-Setup-.+-x64\.exe$/.test(asset.name))?.browser_download_url ?? null;
            stats.portable = latest.assets.find(asset => /^Vibe-Studio-.+-win32-x64\.zip$/.test(asset.name))?.browser_download_url ?? null;
        }
    }
    if (runs.status === "fulfilled") {
        const run = runs.value.workflow_runs?.[0];
        if (run) {
            stats.ci = run.status !== "completed" ? "running" : run.conclusion === "success" ? "success" : "failure";
            stats.ciUrl = run.html_url;
        }
    }
    return stats;
}

const CACHE_KEY = "vibe-studio-site:github";
const CACHE_MS = 60 * 60 * 1000;

export async function liveStats(): Promise<GitHubStats | null> {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_MS) return cached;
    } catch { /* A corrupted cache is replaced. */ }
    try {
        const stats = await fetchStats();
        // Keep the cache only when the main sources answered, so a rate-limited visit retries later.
        if (stats.version !== null || stats.stars !== null) localStorage.setItem(CACHE_KEY, JSON.stringify(stats));
        return stats;
    } catch { return null; }
}

// Live values win field by field; build-time values fill the gaps.
export function merge(fallback: GitHubStats, live: GitHubStats | null): GitHubStats & { live: boolean } {
    if (!live) return { ...fallback, live: false };
    const result = { ...fallback, live: true } as GitHubStats & { live: boolean };
    for (const key of Object.keys(EMPTY) as (keyof GitHubStats)[]) if (live[key] !== null) (result as any)[key] = live[key];
    return result;
}
