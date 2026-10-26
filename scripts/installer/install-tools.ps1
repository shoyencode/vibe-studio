param(
    [string]$Root,
    [string]$Stage,
    [string]$Components = '',
    [string]$ResultFile,
    [string]$Source = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + $env:PSModulePath
$script:CurrentTool = 'app'
$script:CurrentPhase = 'detect'
$script:ToolResults = [ordered]@{}

function Write-ToolProgress {
    param(
        [ValidateSet('app', 'git', 'apm', 'claude', 'codex', 'gemini', 'node')][string]$Name,
        [ValidateSet('detect', 'reuse', 'download', 'verify', 'extract', 'install', 'check', 'complete', 'error')][string]$Phase,
        [ValidateRange(-1, 100)][int]$Percent = -1
    )
    $script:CurrentTool = $Name
    if ($Phase -ne 'error') { $script:CurrentPhase = $Phase }
    [Console]::Out.WriteLine("VIBE|$Name|$Phase|$Percent")
    [Console]::Out.Flush()
}

function Write-ToolOutput {
    param([string]$Text)
    foreach ($line in ($Text -split '\r?\n')) { Write-Host "[tool] $line" }
}

function Copy-Download {
    param([IO.Stream]$InputStream, [IO.Stream]$OutputStream, [long]$Length = -1)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $buffer = New-Object byte[] 65536
    $received = 0L
    $lastUpdate = 0L
    $initial = if ($Length -gt 0) { 0 } else { -1 }
    Write-ToolProgress $script:CurrentTool 'download' $initial
    while ($true) {
        $remaining = 300000 - [int]$clock.ElapsedMilliseconds
        if ($remaining -le 0) { throw 'Download timed out.' }
        $read = $InputStream.ReadAsync($buffer, 0, $buffer.Length)
        if (-not $read.Wait($remaining)) { throw 'Download timed out.' }
        $count = $read.GetAwaiter().GetResult()
        if ($count -eq 0) { break }
        $OutputStream.Write($buffer, 0, $count)
        $received += $count
        if ($clock.ElapsedMilliseconds - $lastUpdate -ge 250) {
            $percent = if ($Length -gt 0) { [int][Math]::Min(100, [Math]::Floor(100.0 * $received / $Length)) } else { -1 }
            Write-ToolProgress $script:CurrentTool 'download' $percent
            $lastUpdate = $clock.ElapsedMilliseconds
        }
    }
    if ($Length -ge 0 -and $received -ne $Length) { throw 'Incomplete download: the response size does not match Content-Length.' }
    if ($Length -gt 0) { Write-ToolProgress $script:CurrentTool 'download' 100 }
}

function Invoke-Tool {
    param([string]$File, [string[]]$Arguments, [int]$Timeout = 300)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $quoted = @($Arguments | ForEach-Object {
        if ($_ -notmatch '[\s"]') { $_ }
        elseif ($_ -match '^(-[A-Za-z]+)=(.*)$') { $Matches[1] + '="' + $Matches[2].Replace('"', '\"') + '"' }
        else { '"' + $_.Replace('"', '\"') + '"' }
    }) -join ' '
    if ($File -match '\.(cmd|bat)$') {
        $info.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $quoted = '/d /s /c ""' + $File + '" ' + $quoted + '"'
    }
    $info.Arguments = $quoted
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        try { $started = $process.Start() }
        catch { throw "Cannot start ${File}: $($_.Exception.Message)" }
        if (-not $started) { throw "Cannot start $File" }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($Timeout * 1000)) {
            & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F | Out-Null
            throw "Timed out: $File"
        }
        $output = $stdout.Result + $stderr.Result
        if ($process.ExitCode -ne 0) { throw "$File exited with code $($process.ExitCode): $output" }
        return $output.Trim()
    } finally { $process.Dispose() }
}

function Get-CompatibleTool {
    param([string]$Name, [version]$Minimum)
    foreach ($command in @(Get-Command "$Name.exe", "$Name.cmd" -CommandType Application -ErrorAction SilentlyContinue)) {
        try {
            $output = Invoke-Tool $command.Source @('--version') 15
            if ($output -match '(\d+\.\d+\.\d+)') {
                $version = [version]$Matches[1]
                if ($version -ge $Minimum -and $version.Major -eq $Minimum.Major -and
                    ($Minimum.Major -gt 0 -or $version.Minor -eq $Minimum.Minor)) {
                    return $command.Source
                }
            }
        } catch {
            Write-ToolOutput "Ignored incompatible $Name at $($command.Source): $_"
        }
    }
    return $null
}

function Assert-FileIntegrity {
    param($Asset, [string]$Destination)
    if ($Asset.integrity -notmatch '^(sha256|sha512)([:-])(.+)$') { throw 'Unsupported integrity.' }
    $algorithm = $Matches[1]
    $format = $Matches[2]
    $expected = $Matches[3]
    $hash = (Get-FileHash -LiteralPath $Destination -Algorithm $algorithm).Hash.ToLowerInvariant()
    if ($format -eq '-') {
        $hash = [Convert]::ToBase64String([byte[]]@(
            for ($i = 0; $i -lt $hash.Length; $i += 2) { [Convert]::ToByte($hash.Substring($i, 2), 16) }
        ))
    }
    if ($hash -cne $expected) { throw "Integrity mismatch: $($Asset.url)" }
}

function Get-VerifiedFile {
    param($Asset, [string]$Destination)
    if ($Asset.url -notmatch '^https://') { throw 'Downloads must use HTTPS.' }
    if (Test-Path -LiteralPath $Destination) {
        try {
            Write-ToolProgress $script:CurrentTool 'verify'
            Assert-FileIntegrity $Asset $Destination
            return
        } catch { Remove-Item -LiteralPath $Destination; Write-ToolOutput "Discarded invalid download: $_" }
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Add-Type -AssemblyName System.Net.Http
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromMinutes(5)
    $partial = $Destination + '.partial'
    try {
        Write-ToolProgress $script:CurrentTool 'download'
        $response = $client.GetAsync($Asset.url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try {
            $response.EnsureSuccessStatusCode() | Out-Null
            $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $file = [IO.File]::Create($partial)
            try {
                $length = if ($null -eq $response.Content.Headers.ContentLength) { -1L } else { [long]$response.Content.Headers.ContentLength }
                Copy-Download $stream $file $length
            } finally { $file.Dispose(); $stream.Dispose() }
        } finally { $response.Dispose() }
        Write-ToolProgress $script:CurrentTool 'verify'
        Assert-FileIntegrity $Asset $partial
        Move-Item -LiteralPath $partial -Destination $Destination -Force
    } finally {
        $client.Dispose()
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    }
}

function Install-Archive {
    param([string]$Name, $Asset)
    Write-ToolProgress $Name 'download'
    $target = Join-Path $Stage $Name
    $archive = Join-Path $Stage ($Name + [IO.Path]::GetExtension($Asset.url))
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    New-Item -ItemType Directory -Force $target | Out-Null
    Get-VerifiedFile $Asset $archive
    Write-ToolProgress $Name 'extract'
    if ($Name -eq 'git') {
        # This pinned SFX extracts beside itself into PortableGit; its -o switch is not supported.
        $unpacked = Join-Path $Stage 'PortableGit'
        if (Test-Path -LiteralPath $unpacked) { Remove-Item -LiteralPath $unpacked -Recurse -Force }
        Write-ToolOutput (Invoke-Tool $archive @('-y', '-gm2'))
        if (-not (Test-Path -LiteralPath (Join-Path $unpacked 'cmd\git.exe'))) { throw 'Git archive did not produce PortableGit.' }
        Remove-Item -LiteralPath $target
        Move-Item -LiteralPath $unpacked -Destination $target
    } elseif ($archive.EndsWith('.zip')) {
        Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
    } else {
        Write-ToolOutput (Invoke-Tool (Join-Path $env:SystemRoot 'System32\tar.exe') @('-xf', $archive, '-C', $target))
    }
    Remove-Item -LiteralPath $archive
    if ($Name -ne 'git') {
        $binary = @{'apm'='apm.exe'; 'node'='node.exe'; 'claude'='claude.exe'; 'codex'='codex.exe'}[$Name]
        $file = @(Get-ChildItem -LiteralPath $target -Filter $binary -Recurse -File)
        if ($file.Count -ne 1) { throw "Expected exactly one $binary in $Name." }
        if ($file[0].DirectoryName -ne $target) {
            $binaryDir = $file[0].DirectoryName
            Get-ChildItem -LiteralPath $binaryDir | Move-Item -Destination $target -Force
            if ($Name -eq 'codex') {
                $helpers = Join-Path (Split-Path $binaryDir) 'path'
                if (Test-Path -LiteralPath $helpers) { Get-ChildItem -LiteralPath $helpers | Move-Item -Destination $target -Force }
            }
        }
    }
    $bin = if ($Name -eq 'git') { Join-Path $target 'cmd' } else { $target }
    $env:PATH = $bin + ';' + $env:PATH
    return $target
}

function Install-SelectedTools {
    $script:ToolResults = [ordered]@{}
    if ($ResultFile -and (Test-Path -LiteralPath ($ResultFile + '.ini'))) { Remove-Item -LiteralPath ($ResultFile + '.ini') }
    Write-ToolProgress 'app' 'detect'
    $manifest = Get-Content -LiteralPath (Join-Path $Source 'components.json') -Raw | ConvertFrom-Json
    $selected = @($Components.Split(',') | Where-Object { $_ })
    foreach ($name in $selected) {
        if ($name -notin @('git', 'apm', 'claude', 'codex', 'gemini')) { throw "Unknown component: $name" }
    }
    $executable = Join-Path $Root 'Vibe Studio.exe'
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'Vibe Studio.exe'" |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath -eq $executable })
    if ($running.Count) { throw 'Close Vibe Studio before installing or updating, then retry.' }
    New-Item -ItemType Directory -Force $Stage | Out-Null
    $externalFile = Join-Path $Root 'tools\external-tools.json'
    $external = @{ externalBins = @(); gitBash = '' }
    if (Test-Path -LiteralPath $externalFile) {
        $previous = Get-Content -LiteralPath $externalFile -Raw | ConvertFrom-Json
        $external.externalBins = @($previous.externalBins | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
        $external.gitBash = $previous.gitBash
    }
    foreach ($dir in $external.externalBins) { $env:PATH = $dir + ';' + $env:PATH }
    foreach ($dir in @('git\cmd', 'apm', 'claude', 'codex', 'gemini\node_modules\.bin', 'node')) {
        $candidate = Join-Path $Root "tools\$dir"
        if (Test-Path -LiteralPath $candidate) { $env:PATH = $candidate + ';' + $env:PATH }
    }
    if (('claude' -in $selected -or 'apm' -in $selected) -and 'git' -notin $selected) {
        Write-ToolProgress 'git' 'detect'
        $git = Get-CompatibleTool 'git' ([version]'2.30.0')
        if ('apm' -in $selected -and -not $git) { throw 'APM requires Git. Select Git too, or install compatible Git first.' }
        $bash = if ($git) { Join-Path (Split-Path (Split-Path $git)) 'bin\bash.exe' } else { '' }
        if ('claude' -in $selected -and (-not $bash -or -not (Test-Path -LiteralPath $bash))) {
            throw 'Claude Code requires Git Bash. Select Git too, or install compatible Git for Windows first.'
        }
        if ($git -and -not $git.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) {
            $external.externalBins += Split-Path $git
            if ($bash -and (Test-Path -LiteralPath $bash)) { $external.gitBash = $bash }
        }
        $script:ToolResults['git'] = 'reused'
        Write-ToolProgress 'git' 'reuse'
    }
    $node = $null
    if ('gemini' -in $selected) {
        Write-ToolProgress 'node' 'detect'
        $node = Get-CompatibleTool 'node' ([version]'24.0.0')
        if (-not $node) {
            $node = Join-Path (Install-Archive 'node' $manifest.node) 'node.exe'
            Write-ToolProgress 'node' 'check'
            if (-not (Get-CompatibleTool 'node' ([version]'24.0.0'))) { throw 'Node.js did not pass its version check.' }
            $script:ToolResults['node'] = 'installed'
        } else {
            Write-ToolProgress 'node' 'reuse'
            $script:ToolResults['node'] = 'reused'
            if (-not $node.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) { $external.externalBins += Split-Path $node }
        }
    }
    $summary = @()
    foreach ($name in @('git', 'apm', 'claude', 'codex', 'gemini')) {
        if ($name -notin $selected) { continue }
        Write-ToolProgress $name 'detect'
        $minimum = if ($name -eq 'git') { [version]'2.30.0' } else { [version]$manifest.$name.version }
        $existing = Get-CompatibleTool $name $minimum
        if ($existing) {
            if ($name -eq 'git' -and 'claude' -in $selected) {
                $bash = Join-Path (Split-Path (Split-Path $existing)) 'bin\bash.exe'
                if (-not (Test-Path -LiteralPath $bash)) { $existing = $null }
            }
            if ($existing) {
                if (-not $existing.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) {
                    $external.externalBins += Split-Path $existing
                    if ($name -eq 'git') {
                        $bash = Join-Path (Split-Path (Split-Path $existing)) 'bin\bash.exe'
                        if (Test-Path -LiteralPath $bash) { $external.gitBash = $bash }
                    }
                }
                $summary += "$name`: reusing $existing"
                $script:ToolResults[$name] = 'reused'
                Write-ToolProgress $name 'reuse'
                continue
            }
        }
        if ($name -eq 'gemini') {
            $npm = Join-Path (Split-Path $node) 'node_modules\npm\bin\npm-cli.js'
            if (-not (Test-Path -LiteralPath $npm)) {
                $node = Join-Path (Install-Archive 'node' $manifest.node) 'node.exe'
                $npm = Join-Path (Split-Path $node) 'node_modules\npm\bin\npm-cli.js'
                Write-ToolProgress 'node' 'check'
                if (-not (Get-CompatibleTool 'node' ([version]'24.0.0'))) { throw 'Node.js did not pass its version check.' }
                $script:ToolResults['node'] = 'installed'
            }
            Write-ToolProgress 'gemini' 'install'
            $target = Join-Path $Stage 'gemini'
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
            New-Item -ItemType Directory -Force $target | Out-Null
            Copy-Item -Path (Join-Path $Source 'gemini\*') -Destination $target
            Write-ToolOutput (Invoke-Tool $node @($npm, 'ci', '--prefix', $target, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--fetch-retries=1', '--fetch-timeout=120000') 600)
            $env:PATH = (Join-Path $target 'node_modules\.bin') + ';' + $env:PATH
        } else {
            Install-Archive $name $manifest.$name | Out-Null
        }
        Write-ToolProgress $name 'check'
        if (-not (Get-CompatibleTool $name $minimum)) { throw "$name did not pass its version check." }
        $summary += "$name`: installed private version $($manifest.$name.version)"
        $script:ToolResults[$name] = 'installed'
        Write-ToolProgress $name 'complete'
    }
    $external.externalBins = @($external.externalBins | Select-Object -Unique)
    [IO.File]::WriteAllText((Join-Path $Stage 'external-tools.json'), ($external | ConvertTo-Json -Depth 3))
    if ($ResultFile) {
        $report = @('[installation]', 'success=1', '[tools]')
        foreach ($entry in $script:ToolResults.GetEnumerator()) { $report += "$($entry.Key)=$($entry.Value)" }
        [IO.File]::WriteAllLines(($ResultFile + '.ini'), [string[]]$report, [Text.Encoding]::ASCII)
    }
    Write-ToolProgress 'app' 'complete'
    return @(
        'Vibe Studio optional tools:'
        $summary
        ''
        'Personal sign-in is still required; no account or kit was configured.'
        'GitHub Copilot: gh auth login (or an existing Copilot sign-in)'
        'Claude Code: claude auth login'
        'Codex: codex login'
        'Gemini: gemini, then choose a sign-in method'
        'Use the Vibe Studio tools shortcut. Windows PATH is unchanged.'
    ) -join "`r`n"
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $summary = Install-SelectedTools
        [IO.File]::WriteAllText($ResultFile, $summary)
        Write-Output $summary
    } catch {
        Write-ToolProgress $script:CurrentTool 'error'
        [IO.File]::WriteAllText($ResultFile, "Optional tools were NOT installed successfully ($script:CurrentTool / $script:CurrentPhase).`r`n$_")
        Write-Error $_
        exit 1
    }
}
