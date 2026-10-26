import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const day = 24 * 60 * 60 * 1000;
const maxInstaller = 2 * 1024 ** 3;

export function newerVersion(candidate, current) {
    const parse = value => /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)?.slice(1).map(Number);
    const next = parse(candidate), previous = parse(current);
    if (!next || !previous) return false;
    for (let i = 0; i < 3; i++) if (next[i] !== previous[i]) return next[i] > previous[i];
    return false;
}

export class Updates {
    constructor({ source, version, directory, fetch, installed = false }) {
        this.source = source;
        this.version = version;
        this.directory = directory;
        this.fetch = fetch;
        this.installed = installed;
        this.state = { status: source ? "idle" : "disabled", installed };
        if (source) {
            if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(source.repository)) throw new Error("Invalid GitHub update repository.");
            this.api = `https://api.github.com/repos/${source.repository}`;
            this.downloadOrigin = `https://github.com/${source.repository}/releases/download/`;
        }
    }
    status() { return { ...this.state }; }
    async response(url, timeout = 30_000, download = false) {
        const signal = AbortSignal.timeout(timeout);
        const allowed = new Set(download ? ["https://github.com", "https://release-assets.githubusercontent.com"] : ["https://api.github.com"]);
        for (let redirects = 0; ; redirects++) {
            const target = new URL(url);
            if (!allowed.has(target.origin) || target.username || target.password) throw new Error("Update URL is outside the trusted GitHub servers.");
            const response = await this.fetch(target.href, { redirect: "manual", credentials: "omit", signal,
                headers: { Accept: download ? "application/octet-stream" : "application/vnd.github+json" } });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                await response.body?.cancel();
                if (!download || redirects >= 4 || !response.headers.get("location")) throw new Error("Unexpected update redirect.");
                url = new URL(response.headers.get("location"), target).href;
                continue;
            }
            if (!response.ok) {
                await response.body?.cancel();
                if (response.headers.get("x-ratelimit-remaining") === "0") throw new Error("GitHub API rate limit reached. Try again later.");
                throw new Error(`GitHub HTTP ${response.status}. Public access to the repository and release assets is required.`);
            }
            return response;
        }
    }
    async json(url) {
        const response = await this.response(url);
        if (Number(response.headers.get("content-length")) > 2_000_000) throw new Error("Update metadata is too large.");
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > 2_000_000) throw new Error("Update metadata is too large.");
                chunks.push(Buffer.from(value));
            }
        } finally { await reader.cancel(); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    async check(force = false) {
        if (!this.source) return this.status();
        if (this.checking) return this.checking;
        this.checking = this.checkOnce(force).finally(() => { this.checking = null; });
        return this.checking;
    }
    async checkOnce(force) {
        const file = path.join(this.directory, "updates.json");
        if (!force && !this.state.checkedAt) {
            try {
                const saved = JSON.parse(await readFile(file, "utf8"));
                if (saved.source === JSON.stringify(this.source) && saved.current === this.version
                    && Number.isFinite(Date.parse(saved.state?.checkedAt))) {
                    this.state = { ...saved.state, installed: this.installed };
                    if (this.state.status === "ready") this.state.status = "available";
                }
            } catch (error) { if (error.code !== "ENOENT") this.state.error = `Update cache: ${error.message}`; }
        }
        if (!force && Date.now() - Date.parse(this.state.checkedAt) < day) return this.status();
        const checkedAt = new Date().toISOString();
        try {
            const release = await this.json(`${this.api}/releases/latest`);
            if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name) || release.draft || release.prerelease)
                throw new Error("No stable release metadata.");
            const releaseUrl = `https://github.com/${this.source.repository}/releases/tag/${encodeURIComponent(release.tag_name)}`;
            this.release = release;
            this.state = { status: newerVersion(release.tag_name, this.version) ? "available" : "current",
                version: release.tag_name.replace(/^v/, ""), releaseUrl, checkedAt, installed: this.installed };
            if (this.state.status === "available" && this.downloaded?.version === this.state.version) this.state.status = "ready";
        } catch (error) {
            this.state = { status: "error", checkedAt, installed: this.installed, error: String(error.message).slice(0, 400) };
        }
        await mkdir(this.directory, { recursive: true });
        await writeFile(file, JSON.stringify({ source: JSON.stringify(this.source), current: this.version, state: this.state }));
        return this.status();
    }
    async download() {
        if (!this.installed) throw new Error("Use the release page to update a portable copy.");
        if (this.downloading) return this.downloading;
        this.downloading = this.downloadOnce().finally(() => { this.downloading = null; });
        return this.downloading;
    }
    async downloadOnce() {
        await this.check(true);
        if (!["available", "ready"].includes(this.state.status)) throw new Error(this.state.error || "No newer release is available.");
        if (this.state.status === "ready") { await this.verifiedInstaller(); return this.status(); }
        const version = this.state.version, tag = this.release.tag_name;
        const filename = `Vibe-Studio-Setup-${version}-x64.exe`;
        let folder;
        try {
            const assets = (this.release.assets || []).filter(item => item.name === filename);
            if (assets.length !== 1 || assets[0].state !== "uploaded" || !/^sha256:[a-f0-9]{64}$/i.test(assets[0].digest)
                || !Number.isSafeInteger(assets[0].size) || assets[0].size <= 0 || assets[0].size > maxInstaller)
                throw new Error("Installer checksum or size is missing or invalid.");
            const asset = assets[0], sha256 = asset.digest.slice(7).toLowerCase();
            const url = `${this.downloadOrigin}${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
            const response = await this.response(url, 10 * 60_000, true);
            folder = await mkdtemp(path.join(this.directory, "update-"));
            const target = path.join(folder, filename), hash = createHash("sha256");
            const file = await open(target, "wx", 0o600), reader = response.body.getReader();
            let size = 0;
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.length;
                    if (size > asset.size) throw new Error("Installer download exceeds its declared size.");
                    hash.update(value);
                    await file.writeFile(value);
                }
                await file.sync();
            } finally { await reader.cancel(); await file.close(); }
            if (size !== asset.size || hash.digest("hex") !== sha256)
                throw new Error("Installer verification failed. Nothing has been executed.");
            if (this.downloaded) await rm(path.dirname(this.downloaded.path), { recursive: true, force: true });
            this.downloaded = { path: target, sha256, size, version };
            this.state = { ...this.state, status: "ready" };
            return this.status();
        } catch (error) {
            if (folder) await rm(folder, { recursive: true, force: true });
            this.state = { ...this.state, status: "error", error: String(error.message).slice(0, 400) };
            throw error;
        }
    }
    async verifiedInstaller() {
        if (!this.installed || !this.downloaded || this.state.status !== "ready") throw new Error("Download and verify the installer first.");
        const target = this.downloaded.path;
        try {
            const file = await open(target, "r"), hash = createHash("sha256");
            try {
                const info = await file.stat();
                if (info.size !== this.downloaded.size) throw new Error("Installer changed after download.");
                for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
                if (hash.digest("hex") !== this.downloaded.sha256) throw new Error("Installer changed after download.");
            } finally { await file.close(); }
        } catch (error) {
            this.downloaded = null;
            this.state = { ...this.state, status: "available", error: error.message };
            await rm(path.dirname(target), { recursive: true, force: true });
            throw error;
        }
        return target;
    }
}
