import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { UserError as Error } from "./errors.mjs";

const LOG_LINES = 200;
const READY_TIMEOUT = 240_000;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

const runners = new Set();
process.once("exit", () => { for (const runner of runners) runner.stopAll(); });

export const runHash = run => createHash("sha256").update(JSON.stringify(run?.services || [])).digest("hex");

export function portOpen(port, timeout = 800) {
    const probe = host => new Promise(resolve => {
        const socket = net.connect({ port, host });
        const done = value => { socket.destroy(); resolve(value); };
        socket.setTimeout(timeout, () => done(false));
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
    });
    // Dev servers bind either IPv4 or IPv6 localhost.
    return Promise.all([probe("127.0.0.1"), probe("::1")]).then(results => results.some(Boolean));
}

function killTree(pid) {
    try {
        if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        else process.kill(-pid, "SIGTERM");
    } catch { /* Already stopped. */ }
}

// Starts the services of poc.yml in order, waits for each port, keeps the last log lines, stops the process trees.
export class Runner {
    constructor(project, onChange = () => {}, { spawner = spawn, probe = portOpen, interval = 1000 } = {}) {
        this.project = project; this.onChange = onChange; this.spawner = spawner; this.probe = probe; this.interval = interval;
        this.services = new Map(); this.generation = 0;
        runners.add(this);
    }
    status() {
        return [...this.services.values()].map(({ name, cwd, command, port, url, status, startedAt, exitCode, reason }) =>
            ({ name, cwd, command, port: port ?? null, url: url ?? null, status, startedAt, exitCode: exitCode ?? null, reason: reason ?? null }));
    }
    logs(name) {
        const service = this.services.get(name);
        if (!service) throw new Error("app.unknownService", { name: String(name) });
        return { name, lines: service.lines };
    }
    busy() { return [...this.services.values()].some(s => ["starting", "running"].includes(s.status)); }
    async folder(cwd) {
        const target = path.resolve(this.project, cwd);
        let real;
        try { real = await realpath(target); } catch { throw new Error("app.cwdMissing", { cwd }); }
        if (real !== this.project && !real.startsWith(this.project + path.sep)) throw new Error("app.cwdOutside", { cwd });
        if (!(await stat(real)).isDirectory()) throw new Error("app.cwdMissing", { cwd });
        return real;
    }
    async start(run) {
        if (this.busy()) throw new Error("app.alreadyRunning");
        const services = run?.services || [];
        if (!services.length) throw new Error("app.noServices");
        const folders = [];
        for (const service of services) folders.push(await this.folder(service.cwd));
        const generation = ++this.generation;
        this.services = new Map(services.map(s => [s.name, { ...s, status: "waiting", lines: [] }]));
        this.onChange();
        void (async () => {
            for (const [index, spec] of services.entries()) {
                if (generation !== this.generation) return;
                const ok = await this.launch(this.services.get(spec.name), folders[index], generation);
                if (!ok) {
                    for (const rest of services.slice(index + 1)) this.set(this.services.get(rest.name), { status: "stopped", reason: "previous" });
                    return;
                }
            }
        })();
        return { started: true };
    }
    set(service, patch) { Object.assign(service, patch); this.onChange(); }
    log(service, chunk) {
        for (const line of chunk.toString("utf8").replace(ANSI, "").split(/\r?\n/)) {
            if (line.trim()) service.lines.push(line.slice(0, 500));
        }
        if (service.lines.length > LOG_LINES) service.lines.splice(0, service.lines.length - LOG_LINES);
    }
    async launch(service, cwd, generation) {
        if (service.port && await this.probe(service.port)) {
            this.set(service, { status: "external", reason: "portBusy" });
            return true;
        }
        this.set(service, { status: "starting", startedAt: new Date().toISOString(), lines: [] });
        let child;
        try {
            // The command is the one confirmed by the user in poc.yml; the system shell resolves npx, mvnw.cmd and the like.
            child = this.spawner(service.command, { cwd, shell: true, windowsHide: true, detached: process.platform !== "win32",
                env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", BROWSER: "none" } });
        } catch (error) {
            this.set(service, { status: "error", reason: String(error.message).slice(0, 200) });
            return false;
        }
        service.child = child;
        child.stdout?.on("data", chunk => this.log(service, chunk));
        child.stderr?.on("data", chunk => this.log(service, chunk));
        child.once("error", error => this.set(service, { status: "error", reason: String(error.message).slice(0, 200) }));
        child.once("exit", code => {
            service.child = null;
            if (service.status === "stopping") this.set(service, { status: "stopped" });
            else this.set(service, { status: code === 0 && !service.port ? "stopped" : "exited", exitCode: code });
        });
        if (!service.port) {
            await new Promise(resolve => setTimeout(resolve, 2 * this.interval));
            if (service.status === "starting") this.set(service, { status: "running" });
            return service.status === "running";
        }
        const deadline = Date.now() + READY_TIMEOUT;
        while (Date.now() < deadline) {
            if (generation !== this.generation || service.status !== "starting") return false;
            if (await this.probe(service.port)) { this.set(service, { status: "running" }); return true; }
            await new Promise(resolve => setTimeout(resolve, this.interval));
        }
        this.set(service, { status: "error", reason: "timeout" });
        return false;
    }
    stopAll() {
        this.generation++;
        for (const service of this.services.values()) {
            if (service.child?.pid) { service.status = "stopping"; killTree(service.child.pid); }
            else if (["waiting", "starting"].includes(service.status)) service.status = "stopped";
        }
        this.onChange();
        return { stopped: true };
    }
}
