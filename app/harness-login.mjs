import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { HARNESSES } from "../core/adapters/index.mjs";
import { UserError } from "../core/errors.mjs";

const execute = promisify(execFile);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

// Authentication stays in the provider's terminal, never in the renderer or IPC.
export async function openHarnessLogin(id, { locate, platform = process.platform, run = execute, home = os.homedir() } = {}) {
    const info = HARNESSES.find(item => item.id === id);
    if (!info) throw new UserError("harness.unsupported");
    if (platform !== "win32") throw new UserError("harness.loginPlatform");
    const executable = await locate(info.loginCommand);
    if (!executable) throw new UserError("harness.missing", { name: info.loginCommand });
    const script = `Set-Location -LiteralPath ${quote(home)}; & ${quote(executable)} ${info.loginArgs.map(quote).join(" ")}`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `$ErrorActionPreference = 'Stop'; Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-NoExit', '-EncodedCommand', '${encoded}')`],
    { windowsHide: true, timeout: 10000 });
    return { opened: true };
}
