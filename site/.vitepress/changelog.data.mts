import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createMarkdownRenderer, defineLoader, type SiteConfig } from "vitepress";
import { REPOSITORY } from "./theme/github";

export interface ChangelogSection { kind: string; title: string; count: number; html: string }
export interface ChangelogVersion {
    version: string; id: string; date: string | null; intro: string; sections: ChangelogSection[];
    release: string | null; installer: string | null; portable: string | null;
}

declare const data: ChangelogVersion[];
export { data };

const KINDS: Record<string, string> = {
    "Added": "added", "Changed": "changed", "Changed (breaking)": "breaking", "Deprecated": "deprecated",
    "Removed": "removed", "Fixed": "fixed", "Security": "security",
};

// Release dates and assets come from GitHub; a version without a release falls back to its Git tag date.
async function releases(): Promise<Map<string, any>> {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    try {
        const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`, { headers });
        if (!response.ok) return new Map();
        const list = await response.json();
        return new Map(list.filter((item: any) => !item.draft).map((item: any) => [item.tag_name.replace(/^v/, ""), item]));
    } catch { return new Map(); }
}

function tagDate(version: string, root: string): string | null {
    try { return execFileSync("git", ["log", "-1", "--format=%aI", `v${version}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; }
    catch { return null; }
}

export default defineLoader({
    watch: ["../../CHANGELOG.md"],
    async load(): Promise<ChangelogVersion[]> {
        const config = (globalThis as any).VITEPRESS_CONFIG as SiteConfig;
        const root = path.resolve(config.srcDir, "..");
        const md = await createMarkdownRenderer(config.srcDir, config.markdown, config.site.base, config.logger);
        const published = await releases();
        const text = readFileSync(path.join(root, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
        const versions: ChangelogVersion[] = [];
        for (const block of text.split(/^## /m).slice(1)) {
            const [heading, ...lines] = block.split("\n");
            const version = heading.trim();
            const parts = lines.join("\n").split(/^### /m);
            const sections = parts.slice(1).map(part => {
                const [title, ...body] = part.split("\n");
                const content = body.join("\n").trim();
                const kind = KINDS[title.trim()] || (/^Migration/.test(title) ? "migration" : "other");
                return { kind, title: title.trim(), count: (content.match(/^\d+\. /gm) || []).length, html: md.render(content) };
            }).filter(section => section.html.trim());
            const intro = parts[0].trim();
            if (version === "Unreleased" && !sections.length && !intro) continue;
            const release = published.get(version);
            const asset = (pattern: RegExp) => release?.assets?.find((item: any) => pattern.test(item.name))?.browser_download_url ?? null;
            versions.push({
                version, id: version === "Unreleased" ? "unreleased" : `v${version.replace(/\./g, "-")}`,
                date: release?.published_at ?? (version === "Unreleased" ? null : tagDate(version, root)),
                intro: intro ? md.render(intro) : "", sections,
                release: release?.html_url ?? null,
                installer: asset(/^Vibe-Studio-Setup-.+-x64\.exe$/), portable: asset(/^Vibe-Studio-.+-win32-x64\.zip$/),
            });
        }
        return versions;
    },
});
