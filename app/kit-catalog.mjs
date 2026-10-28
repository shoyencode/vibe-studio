import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const repositoryPattern = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;
const maxArchive = 100 * 1024 ** 2;
const fields = ["id", "name", "description", "i18n", "version", "protocolVersion", "minVibeStudio", "license", "maintainer", "url", "sha256", "size"];
const parts = value => typeof value === "string" && semver.test(value) ? value.split(".").map(Number) : null;
const compare = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; };

export function validateCatalog(index, repository) {
    if (!index || Object.keys(index).some(key => !["schemaVersion", "entries"].includes(key))
        || index.schemaVersion !== 1 || !Array.isArray(index.entries) || index.entries.length > 1000)
        throw new Error("Invalid catalog index.");
    const identities = new Set();
    for (const entry of index.entries) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)
            || Object.keys(entry).some(key => !fields.includes(key))
            || fields.filter(key => key !== "i18n").some(key => !(key in entry)))
            throw new Error("Invalid catalog entry fields.");
        if (typeof entry.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) || !parts(entry.version) || !parts(entry.minVibeStudio)
            || entry.protocolVersion !== 2 || typeof entry.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(entry.sha256)
            || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > maxArchive)
            throw new Error("Invalid catalog identity, compatibility, checksum or size.");
        for (const key of ["name", "description", "license", "maintainer"])
            if (typeof entry[key] !== "string" || !entry[key].trim() || entry[key].length > 4000)
                throw new Error(`Invalid catalog ${key}.`);
        if (entry.i18n !== undefined) {
            if (!entry.i18n || typeof entry.i18n !== "object" || Array.isArray(entry.i18n)) throw new Error("Invalid catalog translations.");
            for (const [language, translation] of Object.entries(entry.i18n)) {
                if (!/^[a-z]{2}$/.test(language) || !translation || typeof translation !== "object" || Array.isArray(translation)
                    || Object.keys(translation).some(key => !["name", "description"].includes(key))
                    || Object.values(translation).some(value => typeof value !== "string" || !value.trim() || value.length > 4000))
                    throw new Error("Invalid catalog translation.");
            }
        }
        const prefix = `https://github.com/${repository}/releases/download/kit-${entry.id}-v${entry.version}/`;
        if (typeof entry.url !== "string" || !entry.url.startsWith(prefix)
            || !/^[A-Za-z0-9_.-]+\.zip$/.test(entry.url.slice(prefix.length)))
            throw new Error("Catalog archive must be a repository-bound GitHub release ZIP.");
        const identity = `${entry.id}@${entry.version}`;
        if (identities.has(identity)) throw new Error("Duplicate catalog version.");
        identities.add(identity);
    }
    return index.entries;
}

export class KitCatalog {
    constructor({ repository, directory, version, fetch = globalThis.fetch }) {
        if (repository && (!repositoryPattern.test(repository) || repository.split("/").some(part => part === "." || part === "..")))
            throw new Error("Invalid catalog GitHub repository.");
        this.repository = repository;
        this.directory = directory;
        this.version = version;
        this.fetch = fetch;
    }
    async bytes(url, limit, download = false) {
        const signal = AbortSignal.timeout(30_000);
        // A deadline also bounds injected fetch implementations that ignore AbortSignal.
        let timer;
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Catalog request timed out.")), 30_000); });
        const request = async () => {
            for (let redirects = 0; ; redirects++) {
                const target = new URL(url);
                const allowed = download ? ["https://github.com", "https://release-assets.githubusercontent.com"] : ["https://api.github.com"];
                if (!allowed.includes(target.origin) || target.username || target.password) throw new Error("Untrusted catalog server.");
                const response = await this.fetch(target.href, { signal, redirect: "manual", credentials: "omit",
                    headers: { Accept: download ? "application/octet-stream" : "application/vnd.github.raw+json" } });
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    await response.body?.cancel();
                    if (!download || redirects >= 4 || !response.headers.get("location")) throw new Error("Unexpected catalog redirect.");
                    url = new URL(response.headers.get("location"), target).href;
                    continue;
                }
                if (!response.ok) {
                    await response.body?.cancel();
                    throw new Error(response.headers.get("x-ratelimit-remaining") === "0" ? "GitHub catalog rate limit reached."
                        : `GitHub catalog HTTP ${response.status}; a public repository is required.`);
                }
                if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("Catalog response exceeds size limit."); }
                const reader = response.body.getReader(), chunks = [];
                let size = 0;
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        size += value.length;
                        if (size > limit) throw new Error("Catalog response exceeds size limit.");
                        chunks.push(Buffer.from(value));
                    }
                } finally { await reader.cancel(); }
                return Buffer.concat(chunks);
            }
        };
        try { return await Promise.race([request(), deadline]); } finally { clearTimeout(timer); }
    }
    async list({ refresh = false } = {}) {
        if (!this.repository) return { enabled: false, disabled: true, kits: [], entries: [], cached: false };
        let saved;
        const cache = path.join(this.directory, "kit-catalog.json");
        try {
            saved = JSON.parse(await readFile(cache, "utf8"));
            if (saved.repository !== this.repository || !Number.isFinite(saved.checkedAt)) saved = null;
            else validateCatalog(saved.index, this.repository);
        } catch { saved = null; }
        if (!refresh && saved && Date.now() - saved.checkedAt < 86400_000)
            return { enabled: true, disabled: false, kits: saved.index.entries, entries: saved.index.entries, cached: true, checkedAt: saved.checkedAt };
        try {
            const index = JSON.parse((await this.bytes(`https://api.github.com/repos/${this.repository}/contents/index.json?ref=catalog-index`, 2_000_000)).toString("utf8"));
            const entries = validateCatalog(index, this.repository), checkedAt = Date.now();
            await mkdir(this.directory, { recursive: true });
            await writeFile(cache, JSON.stringify({ repository: this.repository, index, checkedAt }));
            return { enabled: true, disabled: false, kits: entries, entries, cached: false, checkedAt };
        } catch (error) {
            return { enabled: true, disabled: false, kits: saved?.index.entries || [], entries: saved?.index.entries || [], cached: Boolean(saved), stale: Boolean(saved),
                error: `Catalog unavailable${saved ? "; showing cached entries" : ""}: ${error.message}` };
        }
    }
    async download(entry) {
        if (!this.repository) throw new Error("Kit catalog is disabled.");
        validateCatalog({ schemaVersion: 1, entries: [entry] }, this.repository);
        const bytes = await this.bytes(entry.url, entry.size, true);
        if (bytes.length !== entry.size || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== entry.sha256)
            throw new Error("Kit archive checksum or size verification failed.");
        await mkdir(this.directory, { recursive: true });
        const folder = await mkdtemp(path.join(this.directory, "kit-download-"));
        const target = path.join(folder, `${entry.id}-${entry.version}.zip`);
        try {
            const file = await open(target, "wx", 0o600);
            try { await file.writeFile(bytes); } finally { await file.close(); }
            return target;
        } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
    }
    async updateFor(manifest) {
        if (!manifest || !parts(manifest.version) || !this.repository) return null;
        const source = manifest.source;
        if (!(source === "catalog" || source?.type === "catalog")) return null;
        if (source?.repository && source.repository !== this.repository) return null;
        const current = parts(manifest.version), app = parts(this.version);
        if (!app) return null;
        const { entries } = await this.list();
        const entry = entries.filter(item => item.id === manifest.id && item.protocolVersion === 2
            && compare(parts(item.minVibeStudio), app) <= 0 && compare(parts(item.version), current) > 0)
            .sort((a, b) => compare(parts(b.version), parts(a.version)))[0];
        if (!entry) return null;
        const next = parts(entry.version), change = next[0] !== current[0] ? "major" : next[1] !== current[1] ? "minor" : "patch";
        return { entry, change, automatic: change === "patch", requiresConfirmation: change !== "patch" };
    }
}
