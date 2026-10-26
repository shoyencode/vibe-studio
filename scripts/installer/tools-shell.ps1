$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + $env:PSModulePath
$root = Split-Path $PSScriptRoot
$metadata = Join-Path $root 'tools\external-tools.json'
if (Test-Path -LiteralPath $metadata) {
    $external = Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json
    foreach ($dir in $external.externalBins) {
        if (Test-Path -LiteralPath $dir -PathType Container) { $env:PATH = $dir + ';' + $env:PATH }
    }
    if (-not $env:CLAUDE_CODE_GIT_BASH_PATH -and $external.gitBash -and (Test-Path -LiteralPath $external.gitBash)) {
        $env:CLAUDE_CODE_GIT_BASH_PATH = $external.gitBash
    }
}
foreach ($dir in @('runtime\python', 'runtime\github\bin', 'tools\git\cmd', 'tools\apm', 'tools\claude', 'tools\codex', 'tools\gemini\node_modules\.bin', 'tools\node')) {
    $candidate = Join-Path $root $dir
    if (Test-Path -LiteralPath $candidate) { $env:PATH = $candidate + ';' + $env:PATH }
}
if (-not $env:VIBE_STUDIO_PYTHON) {
    $env:VIBE_STUDIO_PYTHON = if ($env:VIBE_STUDIO_PYTHON) { $env:VIBE_STUDIO_PYTHON } else { Join-Path $root 'runtime\python\python.exe' }
}
$bash = Join-Path $root 'tools\git\bin\bash.exe'
if (-not $env:CLAUDE_CODE_GIT_BASH_PATH -and (Test-Path -LiteralPath $bash)) { $env:CLAUDE_CODE_GIT_BASH_PATH = $bash }
Write-Host 'Vibe Studio tools (private environment; Windows PATH is unchanged).'
Write-Host 'GitHub Copilot: gh auth login | Claude: claude auth login | Codex: codex login | Gemini: gemini'
Write-Host 'Project kits: cd <project>; apm install'
Set-Location $env:USERPROFILE
