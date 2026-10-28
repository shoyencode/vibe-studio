import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { replaceFile } from "../core/store.mjs";

const LIMIT = 400;

// Proposals waiting for the author, kept in the local profile so a review can be finished later.
export class ReviewQueue {
    constructor(directory) {
        this.directory = directory;
        this.cache = new Map();
    }
    file(kit) {
        const key = createHash("sha256").update(path.resolve(kit).toLowerCase()).digest("hex").slice(0, 32);
        return path.join(this.directory, `${key}.json`);
    }
    async read(kit) {
        if (this.cache.has(kit)) return this.cache.get(kit);
        let data;
        try { data = JSON.parse(await readFile(this.file(kit), "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        if (!data || data.directory !== path.resolve(kit) || !Array.isArray(data.items)) data = { directory: path.resolve(kit), round: 0, summary: null, items: [] };
        this.cache.set(kit, data);
        return data;
    }
    async write(kit, data) {
        data.items = data.items.slice(-LIMIT);
        await mkdir(this.directory, { recursive: true });
        const target = this.file(kit);
        await writeFile(`${target}.tmp`, JSON.stringify(data, null, 2));
        await replaceFile(`${target}.tmp`, target);
        this.cache.set(kit, data);
        return data;
    }
    async startRound(kit, purpose) {
        const data = await this.read(kit);
        data.round += 1;
        data.summary = null;
        data.purpose = purpose;
        return this.write(kit, data);
    }
    async add(kit, proposals) {
        const data = await this.read(kit);
        const created = proposals.map(({ proposal, title, target }) => ({ id: randomUUID(), round: data.round, kind: proposal.kind,
            title, target, proposal, status: "pending", createdAt: new Date().toISOString() }));
        data.items.push(...created);
        await this.write(kit, data);
        return created;
    }
    pending(data) { return data.items.filter(item => item.status === "pending"); }
    async decide(kit, id, status, patch = {}) {
        const data = await this.read(kit);
        const item = data.items.find(entry => entry.id === id);
        if (!item || item.status !== "pending") throw new Error("This proposal was already decided.");
        Object.assign(item, patch, { status, decidedAt: new Date().toISOString() });
        delete item.error;
        if (!this.pending(data).length && data.items.some(entry => entry.round === data.round && entry.status !== "pending")) data.summary = data.round;
        await this.write(kit, data);
        return item;
    }
    async fail(kit, id, error) {
        const data = await this.read(kit);
        const item = data.items.find(entry => entry.id === id);
        if (item) item.error = error;
        return this.write(kit, data);
    }
    async dismissSummary(kit) {
        const data = await this.read(kit);
        data.summary = null;
        return this.write(kit, data);
    }
    view(data) {
        const round = data.items.filter(item => item.round === data.round);
        const count = status => round.filter(item => item.status === status).length;
        return { round: data.round, purpose: data.purpose || null, summary: data.summary === data.round,
            items: data.items.filter(item => item.round === data.round || item.status === "pending"),
            counts: { accepted: count("accepted"), rejected: count("rejected"), pending: this.pending(data).length } };
    }
}
