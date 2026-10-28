import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readdir, rm, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readKit, validateKit } from "../core/kit-workshop.mjs";

const execute = promisify(execFile);
const defaultRun = async (command, args, options) => (await execute(command, args, {
    ...options, shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024
})).stdout.trim();

export class KitSubmission {
    constructor({ repository, directory, run = defaultRun, validate }) {
        this.repository = repository;
        this.directory = directory;
        this.run = run;
        this.validate = validate;
    }

    async submit({ directory, id, version, confirmed = false, minVibeStudio = "3.0.0", maintainer }) {
        if (!confirmed) throw new Error("Explicit confirmation is required before creating a catalog pull request.");
        if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(this.repository || "")
            || this.repository.split("/").some(part => part === "." || part === ".."))
            throw new Error("A catalog GitHub repository must be configured.");
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
            || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(minVibeStudio))
            throw new Error("Invalid kit id or version.");
        if (typeof this.validate !== "function") throw new Error("Local kit validation is required.");
        const validation = await this.validate(directory);
        if (validation === false || validation?.valid === false || validation?.errors?.length)
            throw new Error("Kit validation failed; nothing was submitted.");
        const source = path.resolve(directory);
        // Only package inputs are copied; never copy a user's Git metadata or credentials.
        const allowed = new Set(["apm.yml", ".apm", "README.md", "LICENSE", "LICENSE.md"]);
        const verify = async folder => {
            for (const item of await readdir(folder, { withFileTypes: true })) {
                if (item.name === ".git" || item.name === ".env" || /(?:^|\.)(?:pem|key|pfx)$/i.test(item.name))
                    throw new Error("Sensitive or Git metadata is not allowed in a kit submission.");
                const file = path.join(folder, item.name), info = await lstat(file);
                if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error("Kit links and special files are not allowed.");
                if (info.isDirectory()) await verify(file);
            }
        };
        const files = (await readdir(source)).filter(name => allowed.has(name));
        for (const name of files) {
            const info = await lstat(path.join(source, name));
            if (info.isSymbolicLink()) throw new Error("Kit links are not allowed.");
            if (info.isDirectory()) await verify(path.join(source, name));
        }
        await mkdir(this.directory, { recursive: true });
        const workspace = await mkdtemp(path.join(this.directory, "kit-submission-"));
        if (workspace.startsWith(`${source}${path.sep}`)) {
            await rm(workspace, { recursive: true, force: true });
            throw new Error("Submission workspace must be outside the source kit.");
        }
        const checkout = path.join(workspace, "catalog");
        const invoke = (command, args, cwd = workspace) => this.run(command, args, { cwd, shell: false, timeout: 120_000 });
        try {
            await invoke("gh", ["auth", "status", "--hostname", "github.com"]);
            if (!maintainer) {
                const result = await invoke("gh", ["api", "user", "--jq", ".login"]);
                maintainer = String(result?.stdout ?? result).trim();
            }
            if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(maintainer))
                throw new Error("A valid GitHub maintainer login is required.");
            await invoke("gh", ["repo", "fork", this.repository, "--clone", "--", checkout]);
            const branch = `kit-${id}-${version}-${randomUUID()}`;
            await invoke("git", ["checkout", "-b", branch], checkout);
            const destination = path.join(checkout, "kits", id);
            await rm(destination, { recursive: true, force: true });
            await mkdir(destination, { recursive: true });
            for (const name of files) await cp(path.join(source, name), path.join(destination, name), { recursive: true, dereference: false });
            await verify(destination);
            const copied = await this.validate(destination);
            if (copied === false || copied?.valid === false || copied?.errors?.length)
                throw new Error("Copied kit validation failed.");
            await writeFile(path.join(destination, "catalog.json"), JSON.stringify({ maintainer, minVibeStudio }, null, 2));
            await invoke("git", ["add", "--", `kits/${id}`], checkout);
            const hooks = path.join(workspace, "empty-hooks");
            await mkdir(hooks);
            await invoke("git", ["-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false",
                "-c", "user.name=Vibe Studio", "-c", "user.email=vibe-studio@users.noreply.github.com",
                "commit", "-m", `feat(kits): submit ${id} ${version}\n\nCo-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`], checkout);
            await invoke("git", ["push", "--set-upstream", "origin", branch], checkout);
            const result = await invoke("gh", ["pr", "create", "--repo", this.repository, "--title", `Submit ${id} ${version}`,
                "--body", "Kit submission from Vibe Studio. Manual maintainer review is required before publication."], checkout);
            const url = String(result?.stdout ?? result).trim();
            if (!new RegExp(`^https://github\\.com/${this.repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/\\d+$`).test(url))
                throw new Error("GitHub did not return a catalog pull request URL.");
            return { url };
        } finally { await rm(workspace, { recursive: true, force: true }); }
    }
}

export async function submitKit(directory, options = {}) {
    if (!options.confirmed) throw new Error("Explicit confirmation is required before creating a catalog pull request.");
    const model = await (options.readKit || readKit)(directory);
    const metadata = model.package || model.metadata || model.apm || {};
    const submission = new KitSubmission({
        repository: options.repository,
        directory: options.directory || options.cacheDirectory || options.profileDirectory,
        run: options.run,
        validate: options.validate || validateKit,
    });
    if (!submission.directory) throw new Error("An isolated submission workspace directory is required.");
    return submission.submit({
        directory, id: options.id || metadata.name, version: options.version || metadata.version,
        confirmed: options.confirmed, minVibeStudio: options.minVibeStudio, maintainer: options.maintainer,
    });
}
