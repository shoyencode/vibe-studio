import { mkdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ATTACHMENT_LIMITS } from "../core/project.mjs";
import { UserError } from "../core/errors.mjs";

export class AttachmentInbox {
    constructor(directory, thumbnail = () => null) {
        this.directory = directory; this.thumbnail = thumbnail; this.chosen = new Set(); this.staged = new Set();
    }
    pick(list) {
        if (!Array.isArray(list)) return [];
        if (list.length > ATTACHMENT_LIMITS.count) throw new UserError("attach.tooMany", { n: ATTACHMENT_LIMITS.count });
        for (const file of list) if (!this.chosen.has(file)) throw new UserError("attach.notChosen");
        return list;
    }
    async describe(file, name = path.basename(file)) {
        const info = await stat(file);
        if (!info.isFile()) throw new UserError("attach.missing", { name });
        if (info.size > ATTACHMENT_LIMITS.bytes) throw new UserError("attach.tooLarge", { name, mb: ATTACHMENT_LIMITS.bytes / 1048576 });
        const preview = await this.thumbnail(file);
        this.chosen.add(file);
        return { path: file, name, size: info.size, preview };
    }
    async import(list) {
        if (!Array.isArray(list) || list.length > ATTACHMENT_LIMITS.count) throw new UserError("attach.tooMany", { n: ATTACHMENT_LIMITS.count });
        const files = [];
        for (const item of list) {
            if (typeof item.path === "string" && item.path) { files.push(await this.describe(item.path)); continue; }
            const name = path.basename(String(item.name || "image.png"));
            if (!(item.bytes instanceof Uint8Array)) throw new UserError("attach.invalid");
            if (item.bytes.byteLength > ATTACHMENT_LIMITS.bytes) throw new UserError("attach.tooLarge", { name, mb: ATTACHMENT_LIMITS.bytes / 1048576 });
            const folder = path.join(this.directory, randomUUID());
            await mkdir(folder, { recursive: true });
            const file = path.join(folder, name.replace(/[^\p{L}\p{N} ._-]/gu, "-"));
            await writeFile(file, item.bytes);
            this.staged.add(file);
            files.push(await this.describe(file, name));
        }
        return files;
    }
    async cleanup() {
        for (const file of this.staged) { await rm(file, { force: true }); await rmdir(path.dirname(file)); }
        this.staged.clear();
    }
}
