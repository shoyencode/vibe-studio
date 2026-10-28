import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonExecutable } from "./runtime.mjs";

const helper = fileURLToPath(new URL("./kit-package.py", import.meta.url));
const fieldErrors = errors => (errors || []).map(error => ({ ...error, path: error.path || error.field || "/" }));

/**
 * Kit authoring model: {directory, metadata: <apm.yml mapping>, contract: <protocol v2>}.
 * All operations are asynchronous. Validation returns {valid, errors}, with
 * JSON-pointer field paths. Other failures reject with code and optional errors.
 * Saves generate missing skeletons, never overwrite authored skill/agent files.
 * Installs return the hashed manifest; allowModified explicitly confirms replacing
 * locally changed owned files. backupDir retains a complete pre-update snapshot.
 */
export function kitOperation(command, input) {
    return new Promise((resolve, reject) => {
        const child = execFile(pythonExecutable(), [helper, command], {
            windowsHide: true, timeout: command === "git" ? 180_000 : 120_000,
            maxBuffer: 12_000_000, encoding: "utf8",
            env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }, (error, stdout, stderr) => {
            if (error) {
                let detail;
                try { detail = JSON.parse(stderr); } catch { /* Keep subprocess diagnostics private. */ }
                reject(Object.assign(new Error(detail?.error || "Kit operation failed. Check Python and Git availability."), {
                    code: detail?.code || "kit.unavailable", errors: fieldErrors(detail?.errors),
                }));
                return;
            }
            try {
                const result = JSON.parse(stdout);
                if (result?.errors) result.errors = fieldErrors(result.errors);
                resolve(result);
            } catch { reject(new Error("Invalid kit helper response.")); }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify(input));
    });
}

export const readKit = directory => kitOperation("read", { directory: path.resolve(directory) });
export const createKit = (directory, options = {}) => kitOperation("create", { directory: path.resolve(directory), ...options });
export const saveKit = (directory, model, files) => kitOperation("save", { directory: path.resolve(directory), model, ...(files ? { files } : {}) });
// Unsaved validation checks structure/references without requiring missing generated
// skeletons to exist yet. It never writes to the kit directory.
export const validateModel = (directory, model) => kitOperation("validate-model", { directory: path.resolve(directory), model });
export const validateKit = (directory, options = {}) => options.model
    ? validateModel(directory, options.model)
    : kitOperation("validate", { directory: path.resolve(directory) });
export const exportKit = (directory, zip) => kitOperation("export", { directory: path.resolve(directory), zip: path.resolve(zip) });
export const importKit = (zip, directory) => kitOperation("import", { zip: path.resolve(zip), directory: path.resolve(directory) });
export const importGit = (url, directory) => kitOperation("git", { url, directory: path.resolve(directory) });
export const installKit = (directory, project, options = {}) => kitOperation("install", {
    ...options, directory: path.resolve(directory), project: path.resolve(project),
});
export const readInstalled = project => kitOperation("installed", { project: path.resolve(project) });
export const inspectInstallation = (directory, project) => kitOperation("inspect", {
    directory: directory ? path.resolve(directory) : null, project: path.resolve(project),
});
