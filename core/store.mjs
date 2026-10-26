// Journal of the steps launched on a project: one JSON file per project, written atomically under a lock.
import { mkdir, open, readFile, rename, unlink, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { UserError as Error } from "./errors.mjs";

export const activeStates = new Set(["running", "waiting", "pausing", "paused"]);

// Windows refuses a rename while another process (antivirus, indexer, another session) holds the file briefly.
const transientCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
const retryDelays = [25, 50, 100, 200, 400, 800];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function replaceFile(temporary, target, { rename: renameFile = rename, delays = retryDelays } = {}) {
    for (let attempt = 0; ; attempt++) {
        try { return await renameFile(temporary, target); }
        catch (error) {
            if (!transientCodes.has(error.code) || attempt >= delays.length) throw error;
            await wait(delays[attempt]);
        }
    }
}

export function alive(pid) {
    if (!Number.isInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; if (error.code === "EPERM") return true; throw error; }
}

export async function projectKey(project) {
    let canonical = await realpath(project);
    if (process.platform === "win32") canonical = canonical.toLowerCase();
    return createHash("sha256").update(canonical).digest("hex");
}

export class RunStore {
    constructor(directory, { rename: renameFile = rename, delays = retryDelays } = {}) {
        this.directory = directory;
        this.pending = Promise.resolve();
        this.renameFile = renameFile;
        this.delays = delays;
    }
    async replace(temporary, target) {
        try { return await replaceFile(temporary, target, { rename: this.renameFile, delays: this.delays }); }
        catch (error) {
            if (transientCodes.has(error.code)) {
                const busy = new Error("journal.busy");
                busy.cause = error;
                throw busy;
            }
            throw error;
        }
    }
    async read() {
        try {
            const data = JSON.parse(await readFile(path.join(this.directory, "runs.json"), "utf8"));
            if (data.version !== 1 || !Array.isArray(data.runs)) throw new Error("journal.incompatible");
            return data;
        } catch (error) {
            if (error.code === "ENOENT") return { version: 1, runs: [] };
            throw error;
        }
    }
    change(update) {
        const result = this.pending.then(() => this.transact(update));
        this.pending = result.catch(() => {}); // The caller still receives the rejected result.
        return result;
    }
    async transact(update) {
        await mkdir(this.directory, { recursive: true });
        const lockPath = path.join(this.directory, "write.lock");
        let lock;
        try { lock = await open(lockPath, "wx", 0o600); }
        catch (error) {
            if (error.code === "EEXIST") throw new Error("journal.locked");
            throw error;
        }
        const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
        try {
            const data = await this.read();
            const result = await update(data);
            const file = await open(temporary, "wx", 0o600);
            try { await file.writeFile(JSON.stringify(data, null, 2)); await file.sync(); }
            finally { await file.close(); }
            await this.replace(temporary, path.join(this.directory, "runs.json"));
            return result;
        } finally {
            await lock.close();
            await unlink(lockPath);
            await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
        }
    }
    async begin({ sessionId, step, unit, model, contextTier, contextBudget, reasoningEffort, requestedReasoningEffort, effortVerified,
        agent, requestedModel, requestedContextTier, modelVerified, contextVerified, modelFamily, inputHashes }, runtimePid = process.pid) {
        return this.change(data => {
            const now = new Date().toISOString();
            for (const run of data.runs) {
                if (!activeStates.has(run.status)) continue;
                if (run.sessionId === sessionId || !alive(run.runtimePid)) {
                    // A new launch in the same session supersedes its previous step; the host process must still be alive for another one.
                    run.status = run.sessionId === sessionId ? "unconfirmed" : "interrupted";
                    run.endedAt = now;
                    continue;
                }
                throw new Error("run.otherSession");
            }
            const run = {
                id: randomUUID(), sessionId, step, unit, model, ...(contextTier ? { contextTier } : {}), agent, runtimePid,
                ...(requestedModel ? { requestedModel, requestedContextTier, modelVerified: !!modelVerified, contextVerified: !!contextVerified } : {}),
                ...(contextBudget ? { contextBudget } : {}),
                ...(reasoningEffort ? { reasoningEffort, requestedReasoningEffort, effortVerified: !!effortVerified } : {}),
                ...(modelFamily ? { modelFamily } : {}),
                ...(inputHashes ? { inputHashes } : {}),
                status: "running", startedAt: now, evidence: [],
            };
            data.runs.push(run);
            return run;
        });
    }
    async update(id, sessionId, patch, { reopen = false } = {}) {
        return this.change(data => {
            const run = data.runs.find(item => item.id === id && item.sessionId === sessionId);
            if (!run) throw new Error("run.notInSession");
            if (!activeStates.has(run.status)) {
                const latest = data.runs.findLast(item => item.sessionId === sessionId);
                if (!reopen || latest?.id !== id) throw new Error("run.notActive");
                delete run.endedAt;
                run.reopenedAt = new Date().toISOString();
            }
            Object.assign(run, patch);
            return run;
        });
    }
    async close(id) {
        return this.change(data => {
            const run = data.runs.find(item => item.id === id);
            if (!run || !activeStates.has(run.status)) throw new Error("run.notRunning");
            run.status = "unconfirmed";
            run.endedAt = new Date().toISOString();
            run.closedBy = "user";
            return run;
        });
    }
}
