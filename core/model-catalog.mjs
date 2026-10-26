import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { normalizeModels } from "./models.mjs";

const version = 3;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export class ModelCatalog {
    constructor(directory, identity) {
        this.directory = directory;
        this.identity = identity;
        this.key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
        this.file = directory ? path.join(directory, `copilot-models-v${version}-${this.key}.json`) : null;
        this.models = null;
        this.metadata = { source: "kit" };
    }
    status() { return { ...this.metadata }; }
    failure(error) {
        this.metadata = { ...this.metadata, source: this.models ? "cache" : "kit",
            error: [this.cacheError, String(error?.message || error)].filter(Boolean).join(" ").slice(0, 300) };
    }
    async load() {
        if (!this.file) return;
        try {
            const saved = JSON.parse(await readFile(this.file, "utf8"));
            if (saved.version !== version || saved.identity !== this.key || !Array.isArray(saved.models) || !saved.models.length
                || typeof saved.fetchedAt !== "string" || !Number.isFinite(Date.parse(saved.fetchedAt)))
                throw new Error("Invalid model catalog cache.");
            const models = normalizeModels(saved.models);
            if (models.length !== saved.models.length || models.some((model, i) => JSON.stringify(model) !== JSON.stringify(saved.models[i])))
                throw new Error("Invalid model catalog cache capabilities.");
            this.models = models;
            this.metadata = { source: "cache", fetchedAt: saved.fetchedAt };
        } catch (error) {
            if (error.code !== "ENOENT") {
                this.cacheError = "The saved model catalog is invalid; retry to refresh it.";
                this.metadata.error = this.cacheError;
            }
        }
    }
    async accept(models) {
        const normalized = normalizeModels(models);
        if (!normalized.length) throw new Error("The runtime returned no models.");
        this.models = normalized;
        this.cacheError = null;
        this.metadata = { source: "live", fetchedAt: new Date().toISOString() };
        if (this.file) {
            try { await this.save(); }
            catch (error) { this.metadata.error = `Model catalog could not be saved: ${String(error?.message || error).slice(0, 230)}`; }
        }
        return this.models;
    }
    async save() {
        await mkdir(this.directory, { recursive: true });
        const pending = path.join(this.directory, `${this.key}-${randomUUID()}.pending`);
        try {
            const file = await open(pending, "wx", 0o600);
            try {
                await file.writeFile(JSON.stringify({ version, identity: this.key, fetchedAt: this.metadata.fetchedAt, models: this.models }));
                await file.sync();
            } finally { await file.close(); }
            for (let attempt = 0; ; attempt++) {
                try { await rename(pending, this.file); break; }
                catch (error) {
                    if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 6) throw error;
                    await wait(25 * 2 ** attempt);
                }
            }
        } finally { await unlink(pending).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    }
}
