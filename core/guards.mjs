// Guards of Vibe Studio: rules declared by a kit in its contract and imposed on the tools of the AI.
// decide() is pure: it receives the tool call and a context (patterns resolved, task list, run) and returns
// a decision for onPreToolUse. It never returns "allow": the permissions of the user stay in force.
import path from "node:path";

const WRITE_TOOLS = new Set(["create", "edit", "write", "str_replace_editor", "apply_patch", "write_file", "edit_file", "multi_edit"]);
const SHELL_TOOLS = new Set(["powershell", "bash", "shell", "run_in_terminal"]);
// Strong signals only: a guard must not block harmless text.
const SECRETS = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, /\bgithub_pat_[A-Za-z0-9_]{60,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/, /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/, /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\bsk-[A-Za-z0-9]{40,}\b/, /\bglpat-[A-Za-z0-9_-]{20,}\b/,
];
const SHELL_WRITE = /\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Clear-Content|del|erase|rm|rmdir|mv|cp|move|copy|ren|tee|sed\s+-i|truncate)\b|[^>]>>?\s*[^&\s]/i;

export function globToRegExp(pattern) {
    let body = "";
    for (let i = 0; i < pattern.length; i++) {
        if (pattern.startsWith("**/", i)) { body += "(?:.*/)?"; i += 2; }
        else if (pattern.startsWith("/**", i) && i + 3 === pattern.length) { body += "(?:/.*)?"; i += 2; }
        else if (pattern.startsWith("**", i)) { body += ".*"; i += 1; }
        else if (pattern[i] === "*") body += "[^/]*";
        else body += pattern[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${body}$`, "i");
}

// Project-relative path with forward slashes, or null for a path outside the project.
export function relativeTo(project, value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(project, value);
    const relative = path.relative(project, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
}

// Files a tool call writes, and the text it writes (for the secret guard).
// The runtime may pass the arguments of a tool as a raw string: apply_patch receives the patch itself.
export function normalizeArgs(toolName, args) {
    if (args && typeof args === "object") return args;
    if (typeof args !== "string") return {};
    if (SHELL_TOOLS.has(toolName)) return { command: args };
    try { const parsed = JSON.parse(args); if (parsed && typeof parsed === "object") return parsed; } catch { /* not JSON */ }
    return { input: args };
}

export function writesOf(toolName, rawArgs) {
    const args = normalizeArgs(toolName, rawArgs);
    const files = [], texts = [];
    let created = false;
    if (WRITE_TOOLS.has(toolName) || (toolName === "str_replace_based_edit_tool")) {
        for (const key of ["path", "file_path", "filePath", "target_file"]) if (typeof args[key] === "string") files.push(args[key]);
        for (const key of ["file_text", "content", "new_str", "newString", "text"]) if (typeof args[key] === "string") texts.push(args[key]);
        if (toolName === "create" || args.command === "create") created = true;
        if (typeof args.input === "string" || typeof args.patch === "string") {
            const patch = args.input ?? args.patch;
            for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gm)) files.push(match[1]);
            for (const match of patch.matchAll(/^\*\*\* Move to:\s*(.+?)\s*$/gm)) files.push(match[1]);
            texts.push(patch.split(/\r?\n/).filter(line => line.startsWith("+")).join("\n"));
        }
    }
    return { files, texts, created };
}

export function shellOf(toolName, rawArgs) {
    const args = normalizeArgs(toolName, rawArgs);
    return SHELL_TOOLS.has(toolName) && typeof args.command === "string" ? args.command : null;
}

// Paths a shell command mentions that match a pattern; only checked when the command writes.
function shellTouches(command, project, regexps) {
    if (!SHELL_WRITE.test(command)) return null;
    const normalised = command.replaceAll("\\", "/");
    const projectSlash = project.replaceAll("\\", "/").toLowerCase();
    for (const token of normalised.match(/"[^"]+"|'[^']+'|[^\s"';|&()]+/g) || []) {
        const value = token.replace(/^["']|["']$/g, "");
        const lower = value.toLowerCase();
        const relative = lower.startsWith(projectSlash) ? value.slice(projectSlash.length).replace(/^\/+/, "") : value.replace(/^\.\//, "");
        if (relative && regexps.some(regexp => regexp.test(relative) || regexp.test(`${relative}/x`))) return relative;
    }
    return null;
}

/**
 * @param input   { toolName, toolArgs, agentId }
 * @param context { project, rules, suspended: Set<id>, run, step, tasks: { inProgress: string[] } | null, allowedSkills: Set }
 * rules: list of { id, kind, regexps?, except?, reason, patterns? } prepared by prepareRules().
 * @returns { decision: "deny" | "ask", id, reason, path? } or null
 */
export function decide(input, context) {
    const { toolName } = input;
    const toolArgs = normalizeArgs(toolName, input.toolArgs);
    const active = context.rules.filter(rule => !context.suspended?.has(rule.id));
    const { files, texts } = writesOf(toolName, toolArgs);
    const relatives = files.map(file => relativeTo(context.project, file)).filter(Boolean);
    const command = shellOf(toolName, toolArgs);
    const matches = (rule, relative) => rule.regexps.some(r => r.test(relative)) && !(rule.except || []).some(r => r.test(relative));
    for (const rule of active) {
        switch (rule.kind) {
            case "readOnly":
            case "scriptOnly": {
                const hit = relatives.find(relative => matches(rule, relative))
                    ?? (command && !(rule.kind === "scriptOnly" && rule.scripts?.some(script => command.includes(script)))
                        ? shellTouches(command, context.project, rule.regexps) : null);
                if (hit) return { decision: "deny", id: rule.id, reason: rule.reason, path: hit };
                break;
            }
            case "forbidCreate": {
                const { created } = writesOf(toolName, toolArgs);
                const added = toolName === "apply_patch" || typeof toolArgs.input === "string"
                    ? [...String(toolArgs.input ?? toolArgs.patch ?? "").matchAll(/^\*\*\* Add File:\s*(.+?)\s*$/gm)].map(m => relativeTo(context.project, m[1])).filter(Boolean)
                    : created ? relatives : [];
                const hit = added.find(relative => matches(rule, relative));
                if (hit) return { decision: "deny", id: rule.id, reason: rule.reason, path: hit };
                break;
            }
            case "requireTaskInProgress": {
                if (!context.tasks || context.tasks.inProgress.length) break;
                const hit = relatives.find(relative => matches(rule, relative));
                if (hit) return { decision: "deny", id: rule.id, reason: rule.reason, path: hit };
                break;
            }
            case "secrets": {
                if (texts.some(text => SECRETS.some(regexp => regexp.test(text)))) return { decision: "deny", id: rule.id, reason: rule.reason };
                break;
            }
            case "confirmCommands": {
                if (command && rule.commands.some(regexp => regexp.test(command))) return { decision: "ask", id: rule.id, reason: rule.reason };
                break;
            }
            case "skills": {
                if (toolName !== "skill") break;
                const skill = String(toolArgs.skill || toolArgs.name || "");
                if (skill && !context.allowedSkills.has(skill)) return { decision: "deny", id: rule.id, reason: rule.reason, path: skill };
                break;
            }
            case "subagentsReadOnly": {
                if (!input.agentId) break;
                if (relatives.length || (command && SHELL_WRITE.test(command))) return { decision: "deny", id: rule.id, reason: rule.reason };
                break;
            }
            default:
                break;
        }
    }
    return null;
}

// Rules of the contract with their patterns resolved for one project, step and unit.
export function prepareRules(contract, step, resolve) {
    const rules = [];
    const add = (list, scope) => {
        for (const [kind, entries] of Object.entries(list || {})) {
            if (kind === "end" || kind === "singleTaskInProgress" || kind === "history") continue;
            for (const entry of Array.isArray(entries) ? entries : [entries]) {
                if (!entry?.id) continue;
                rules.push({
                    id: entry.id, kind, scope, reason: entry.reason || entry.id, description: entry.description || entry.reason || entry.id,
                    regexps: (entry.paths || []).map(p => globToRegExp(resolve(p))),
                    except: (entry.except || []).map(p => globToRegExp(resolve(p))),
                    scripts: entry.scripts || [], commands: (entry.commands || []).map(c => new RegExp(c, "i")),
                });
            }
        }
    };
    add(contract.guards, "permanent");
    if (step) add(step.guards, "step");
    return rules;
}

export function historyRule(contract, resolve) {
    const entry = contract.guards?.history;
    if (!entry?.id) return null;
    return { id: entry.id, regexps: (entry.paths || []).map(p => globToRegExp(resolve(p))), except: (entry.except || []).map(p => globToRegExp(resolve(p))),
        folder: resolve(entry.folder), reason: entry.reason || entry.id };
}

// Every rule the user can see in Vibe Studio, with its scope.
export function describeRules(contract, step) {
    const list = [];
    const add = (guards, scope) => {
        for (const [kind, entries] of Object.entries(guards || {})) {
            for (const entry of Array.isArray(entries) ? entries : [entries]) {
                if (entry?.id) list.push({ id: entry.id, kind, scope, description: entry.description || entry.reason || entry.id, i18n: entry.i18n });
            }
        }
    };
    add(contract.guards, "permanent");
    if (step) add(step.guards, "step");
    return list;
}

// Markers of a Markdown task list: ids in progress.
export function tasksInProgress(text) {
    return [...String(text).matchAll(/^\s*[-*]\s+\[~\]\s+\**([TRU][0-9]+[a-z]?)\**/gm)].map(match => match[1]);
}
