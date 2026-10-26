import test from "node:test";
import assert from "node:assert/strict";
import { openHarnessLogin } from "../app/harness-login.mjs";

test("every harness opens its own fixed login command in a visible Windows terminal", async () => {
    for (const [id, command, args] of [
        ["copilot", "gh", ["auth", "login", "--hostname", "github.com", "--web"]],
        ["claude", "claude", ["auth", "login"]], ["codex", "codex", ["login"]], ["gemini", "gemini", []],
    ]) {
        let invocation;
        const result = await openHarnessLogin(id, { platform: "win32", home: "C:\\Users\\O'Brien",
            locate: async name => { assert.equal(name, command); return `C:\\Tools\\O'Brien\\${name}.cmd`; },
            run: async (...values) => { invocation = values; },
        });
        assert.deepEqual(result, { opened: true });
        assert.equal(invocation[0], "powershell.exe");
        assert.equal(invocation[2].windowsHide, true, "only the short-lived launcher is hidden");
        const launch = invocation[1].at(-1);
        assert.match(launch, /Start-Process/);
        assert.match(launch, /'-NoExit'/);
        const encoded = launch.match(/'-EncodedCommand', '([^']+)'/)[1];
        const script = Buffer.from(encoded, "base64").toString("utf16le");
        assert.equal(script, `Set-Location -LiteralPath 'C:\\Users\\O''Brien'; & 'C:\\Tools\\O''Brien\\${command}.cmd' ${args.map(arg => `'${arg}'`).join(" ")}`);
        assert.doesNotMatch(script, /token|password/i);
    }
});

test("invalid providers, missing tools and terminal failures are surfaced", async () => {
    const options = { platform: "win32", locate: async () => null, run: async () => assert.fail("must not launch") };
    await assert.rejects(openHarnessLogin("copilot; exit", options), error => error.key === "harness.unsupported");
    await assert.rejects(openHarnessLogin("copilot", options), error => error.key === "harness.missing");
    await assert.rejects(openHarnessLogin("copilot", { ...options, platform: "linux" }), error => error.key === "harness.loginPlatform");
    await assert.rejects(openHarnessLogin("copilot", { platform: "win32", locate: async () => "gh.exe",
        run: async () => { throw new Error("Terminal unavailable"); } }), /Terminal unavailable/);
});
