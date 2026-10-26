import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { download } from "../scripts/installer/downloads.mjs";

test("download caches are verified, tampered caches are replaced, bad responses never become payloads", async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibe-download-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const payload = Buffer.from("official fixture");
    let requests = 0;
    const server = createServer((request, response) => {
        requests++;
        response.statusCode = request.url === "/missing" ? 404 : 200;
        response.end(payload);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const asset = { url: `http://127.0.0.1:${server.address().port}/fixture`, integrity: `sha256:${createHash("sha256").update(payload).digest("hex")}` };
    const destination = path.join(directory, "payload.zip");
    await download(asset, destination);
    await download(asset, destination);
    assert.equal(requests, 1);
    await writeFile(destination, "tampered");
    await download(asset, destination);
    assert.equal(requests, 2);
    assert.deepEqual(await readFile(destination), payload);
    await assert.rejects(download({ ...asset, url: asset.url.replace("/fixture", "/missing") }, path.join(directory, "missing.zip")), /404/);
    await assert.rejects(download({ ...asset, integrity: `sha256:${"0".repeat(64)}` }, path.join(directory, "bad.zip")), /integrity mismatch/);
    await assert.rejects(readFile(path.join(directory, "bad.zip")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(directory, "bad.zip.partial")), { code: "ENOENT" });
});

test("installer component sources are pinned HTTPS and Gemini's full npm graph has integrity", async () => {
    const manifest = JSON.parse(await readFile(new URL("../scripts/installer/components.json", import.meta.url)));
    for (const [name, asset] of Object.entries(manifest)) {
        assert.match(asset.version, /^\d+\.\d+\.\d+$/);
        assert.ok(asset.license, name);
        if (name === "gemini") continue;
        assert.match(asset.url, /^https:\/\//);
        assert.match(asset.integrity, /^(sha256:[0-9a-f]{64}|sha512-[A-Za-z0-9+/]+=*)$/);
        assert.ok(asset.url.includes(asset.version) || name === "git", `${name} URL must pin the version`);
    }
    const lock = JSON.parse(await readFile(new URL("../scripts/installer/gemini/package-lock.json", import.meta.url)));
    for (const [name, pkg] of Object.entries(lock.packages)) {
        if (!name) continue;
        assert.match(pkg.resolved, /^https:\/\/registry\.npmjs\.org\//, name);
        assert.match(pkg.integrity, /^sha512-/, name);
    }
    assert.equal(lock.packages["node_modules/@google/gemini-cli"].version, manifest.gemini.version);
});

test("Windows optional installer parses and checks real tool versions without account access", { skip: process.platform !== "win32" }, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibe-tools-check-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const fake = path.join(directory, "vibe-fixture.cmd");
    await writeFile(fake, "@echo off\r\necho fixture 3.2.1\r\n");
    await Promise.all([
        writeFile(path.join(directory, "git.cmd"), "@echo off\r\necho git version 2.30.0\r\n"),
        writeFile(path.join(directory, "apm.cmd"), "@echo off\r\necho apm 0.34.0\r\n"),
    ]);
    const externalGit = path.join(directory, "external-git", "cmd");
    await mkdir(externalGit, { recursive: true });
    await writeFile(path.join(externalGit, "git.cmd"), "@echo off\r\necho git version 2.30.0\r\n");
    const script = path.resolve("scripts", "installer", "install-tools.ps1").replaceAll("'", "''");
    const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const code = `. '${script}'; $env:PATH = '${directory.replaceAll("'", "''")}'; ` +
        "$found = Get-CompatibleTool 'vibe-fixture' ([version]'3.0.0'); if (-not $found) { throw 'Compatible tool not found' }; " +
        "if (Get-CompatibleTool 'vibe-fixture' ([version]'4.0.0')) { throw 'Incompatible version accepted' }; " +
        "if (Get-CompatibleTool 'vibe-fixture' ([version]'2.0.0')) { throw 'Untested major version accepted' }; " +
        "try { Get-VerifiedFile ([pscustomobject]@{url='http://insecure.invalid'}) 'unused'; throw 'HTTP accepted' } " +
        "catch { if ($_ -notmatch 'HTTPS') { throw } }; " +
        `$Root = '${directory.replaceAll("'", "''")}\\application'; $Stage = '${directory.replaceAll("'", "''")}\\offline'; $Components = ''; ` +
        `$ResultFile = '${directory.replaceAll("'", "''")}\\result.txt'; ` +
        "function Get-VerifiedFile { throw 'Offline base attempted a download' }; " +
        "$summary = Install-SelectedTools; if ($summary -notmatch 'Personal sign-in') { throw 'Missing offline result' }; " +
        "$Components = 'git,apm'; $summary = Install-SelectedTools; " +
        "if ($summary -notmatch 'git: reusing' -or $summary -notmatch 'apm: reusing') { throw 'Existing tools were not reused' }; " +
        "$metadata = Get-Content (Join-Path $Stage 'external-tools.json') -Raw | ConvertFrom-Json; " +
        "if (@($metadata.externalBins).Count -ne 1) { throw 'Reused tool directories were not recorded and deduplicated' }; " +
        "$report = Get-Content ($ResultFile + '.ini') -Raw; " +
        "if ($report -notmatch 'success=1' -or $report -notmatch 'git=reused' -or $report -notmatch 'apm=reused') { throw 'Verified results missing from report' }; " +
        `$env:PATH = '${externalGit.replaceAll("'", "''")};' + $env:PATH; $Components = 'apm'; Install-SelectedTools | Out-Null; ` +
        "$metadata = Get-Content (Join-Path $Stage 'external-tools.json') -Raw | ConvertFrom-Json; " +
        `if ('${externalGit.replaceAll("'", "''")}' -notin $metadata.externalBins) { throw 'Implicit external Git dependency was not recorded' }; ` +
        "$Components = 'unknown'; try { Install-SelectedTools; throw 'Unknown component accepted' } " +
        "catch { if ($_ -notmatch 'Unknown component:') { throw } }; " +
        "if (Test-Path ($ResultFile + '.ini')) { throw 'A failed retry kept an old success report' }; " +
        "function Get-CompatibleTool { return $null }; $Components = 'claude'; " +
        "try { Install-SelectedTools; throw 'Missing Git Bash accepted' } catch { if ($_ -notmatch 'requires Git Bash') { throw } }; " +
        "$Components = 'apm'; try { Install-SelectedTools; throw 'Missing Git accepted' } catch { if ($_ -notmatch 'requires Git') { throw } }; Write-Output 'OK'";
    const output = execFileSync(ps, ["-NoProfile", "-NonInteractive", "-Command", code], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    assert.match(output, /OK/);
    assert.match(output, /VIBE\|app\|detect\|-1/);
    assert.match(output, /VIBE\|git\|reuse\|-1/);
});

test("Windows download progress measures real bytes, stays indeterminate for unknown sizes and rejects truncation", { skip: process.platform !== "win32" }, () => {
    const script = path.resolve("scripts", "installer", "install-tools.ps1").replaceAll("'", "''");
    const code = `. '${script}'; ` +
        "$inputBytes = [IO.MemoryStream]::new([byte[]](1,2,3,4)); $outputBytes = [IO.MemoryStream]::new(); " +
        "try { Copy-Download $inputBytes $outputBytes 4; if ($outputBytes.Length -ne 4) { throw 'Bytes not copied' } } " +
        "finally { $inputBytes.Dispose(); $outputBytes.Dispose() }; " +
        "[Console]::WriteLine('UNKNOWN'); $inputBytes = [IO.MemoryStream]::new([byte[]](1,2,3,4)); $outputBytes = [IO.MemoryStream]::new(); " +
        "try { Copy-Download $inputBytes $outputBytes -1 } finally { $inputBytes.Dispose(); $outputBytes.Dispose() }; " +
        "[Console]::WriteLine('TRUNCATED'); $inputBytes = [IO.MemoryStream]::new([byte[]](1,2)); $outputBytes = [IO.MemoryStream]::new(); " +
        "try { try { Copy-Download $inputBytes $outputBytes 4; throw 'Truncated download accepted' } " +
        "catch { if ($_ -notmatch 'Incomplete download') { throw } } } finally { $inputBytes.Dispose(); $outputBytes.Dispose() }; " +
        "Write-ToolOutput 'VIBE|app|complete|100'";
    const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const output = execFileSync(ps, ["-NoProfile", "-NonInteractive", "-Command", code], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    const [known, rest] = output.split("UNKNOWN");
    const [unknown, truncated] = rest.split("TRUNCATED");
    assert.match(known, /VIBE\|app\|download\|0/);
    assert.match(known, /VIBE\|app\|download\|100/);
    assert.match(unknown, /VIBE\|app\|download\|-1/);
    assert.doesNotMatch(unknown, /download\|100/);
    assert.doesNotMatch(truncated, /download\|100/);
    assert.match(truncated, /\[tool\] VIBE\|app\|complete\|100/);
});

test("Windows installer branding is reproducible and keeps the source logo at its native resolution", { skip: process.platform !== "win32" }, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibe-branding-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        path.resolve("scripts", "installer", "prepare-assets.ps1"), "-Logo", path.resolve("app", "renderer", "logo.png"),
        "-Destination", directory];
    execFileSync(ps, args, { windowsHide: true, timeout: 30_000 });
    const files = ["setup.ico", "wizard-light.png", "wizard-dark.png", "wizard-small.png"];
    const before = await Promise.all(files.map(file => readFile(path.join(directory, file))));
    execFileSync(ps, args, { windowsHide: true, timeout: 30_000 });
    const after = await Promise.all(files.map(file => readFile(path.join(directory, file))));
    assert.deepEqual(after, before);
    const icon = before[0];
    assert.equal(icon.readUInt16LE(2), 1);
    assert.equal(icon.readUInt16LE(4), 6);
    assert.deepEqual(Array.from({ length: 6 }, (_, index) => icon[6 + index * 16]), [16, 24, 32, 48, 64, 128]);
    assert.equal(before[1].readUInt32BE(16), 492);
    assert.equal(before[1].readUInt32BE(20), 942);
    assert.equal(before[3].readUInt32BE(16), 96);
});
