param(
    [string]$Installer,
    [string]$Artifacts = (Join-Path (Get-Location) 'dist\installer-ui')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + $env:PSModulePath
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
public static class InstallerWindow {
    public delegate bool Visitor(IntPtr window, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Visitor callback, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
    public static IntPtr Find(int process) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, data) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if (owner == process && IsWindowVisible(window) && Text(window).Contains("Vibe Studio")) { found = window; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static List<IntPtr> Children(IntPtr parent) {
        var result = new List<IntPtr>();
        EnumChildWindows(parent, (window, data) => { if (IsWindowVisible(window)) result.Add(window); return true; }, IntPtr.Zero);
        return result;
    }
    public static string Text(IntPtr window) {
        var text = new StringBuilder(32768); GetWindowText(window, text, text.Capacity); return text.ToString();
    }
    public static string Class(IntPtr window) {
        var text = new StringBuilder(256); GetClassName(window, text, text.Capacity); return text.ToString();
    }
    public static void Capture(IntPtr window, string path) {
        Rect rect; if (!GetWindowRect(window, out rect)) throw new Exception("Cannot measure the test installer window.");
        using (var bitmap = new Bitmap(rect.Right-rect.Left, rect.Bottom-rect.Top))
        using (var graphics = Graphics.FromImage(bitmap)) {
            var dc = graphics.GetHdc();
            try { if (!PrintWindow(window, dc, 2)) throw new Exception("Cannot capture the test installer window."); }
            finally { graphics.ReleaseHdc(dc); }
            bitmap.Save(path, ImageFormat.Png);
        }
    }
}
'@

$root = Split-Path $PSScriptRoot
if (-not $Installer) {
    $version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    $Installer = Join-Path $root "dist\Vibe Studio-Setup-$version-x64.exe"
}
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$Artifacts = [IO.Path]::GetFullPath($Artifacts)
New-Item -ItemType Directory -Force $Artifacts | Out-Null
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('vibe-installer-ui-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $temporary | Out-Null

function Get-VisibleText {
    param([IntPtr]$Window)
    return (@([InstallerWindow]::Children($Window) | ForEach-Object { [InstallerWindow]::Text($_) }) -join "`n").Replace('&', '')
}

function Wait-Text {
    param([IntPtr]$Window, [string]$Text, [int]$Timeout = 30)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt $Timeout) {
        if ((Get-VisibleText $Window).Contains($Text)) { return }
        Start-Sleep -Milliseconds 150
    }
    throw "Installer page not reached: $Text`n$(Get-VisibleText $Window)"
}

function Click-Control {
    param([IntPtr]$Window, [string]$Caption)
    $control = @([InstallerWindow]::Children($Window) | Where-Object {
        ([InstallerWindow]::Text($_)).Replace('&', '').TrimEnd(' ', '>') -eq $Caption.TrimEnd(' ', '>') -and
        ([InstallerWindow]::Class($_)) -match 'Button'
    })
    if ($control.Count -ne 1) { throw "Expected one control '$Caption', found $($control.Count)." }
    if (-not [InstallerWindow]::PostMessage($control[0], 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { throw "Cannot click $Caption" }
}

function Save-Page {
    param([IntPtr]$Window, [string]$Name)
    Start-Sleep -Milliseconds 150
    [InstallerWindow]::Capture($Window, (Join-Path $Artifacts "$Name.png"))
    [IO.File]::WriteAllText((Join-Path $Artifacts "$Name.txt"), (Get-VisibleText $Window))
}

$success = $false
try {
    foreach ($language in @('english', 'french')) {
        $installed = Join-Path $temporary $language
        $next = if ($language -eq 'english') { 'Next >' } else { 'Suivant >' }
        $accept = if ($language -eq 'english') { 'I accept the agreement' } else { "Je comprends et j'accepte les termes du contrat de licence" }
        $titles = if ($language -eq 'english') {
            @('Welcome to', 'License Agreement', 'Select Destination Location', 'Select Components', 'Select Additional Tasks', 'Ready to Install', 'Vibe Studio is ready')
        } else {
            @('Bienvenue dans', 'Accord de licence', 'Dossier de destination', 'Composants à installer', 'Tâches supplémentaires', 'Prêt à installer', 'Vibe Studio est prêt')
        }
        $id = '-smoke-ui-' + [guid]::NewGuid().ToString('N')
        $process = Start-Process -FilePath $Installer -ArgumentList @("/LANG=$language", '/NoShortcuts=1',
            "/TestInstall=$id", "/DIR=`"$installed`"", '/TYPE=offline', '/COMPONENTS=app', '/NORESTART',
            "/LOG=`"$(Join-Path $Artifacts "$language-install.log")`"") -PassThru
        $window = [IntPtr]::Zero
        try {
            $clock = [Diagnostics.Stopwatch]::StartNew()
            while ($window -eq [IntPtr]::Zero -and $clock.Elapsed.TotalSeconds -lt 30) {
                if ($process.HasExited) { throw "Test installer exited before showing its window ($($process.ExitCode))." }
                $owners = @($process.Id)
                $owners += @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Select-Object -ExpandProperty ProcessId)
                foreach ($owner in $owners) {
                    $window = [InstallerWindow]::Find($owner)
                    if ($window -ne [IntPtr]::Zero) { break }
                }
                if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
            }
            if ($window -eq [IntPtr]::Zero) { throw 'No test installer window appeared.' }
            Wait-Text $window $titles[0]
            Save-Page $window "$language-welcome"
            Write-Output "$language installer DPI: $([InstallerWindow]::GetDpiForWindow($window))"
            Click-Control $window $next
            Wait-Text $window $titles[1]
            Click-Control $window $accept
            Click-Control $window $next
            Wait-Text $window $titles[2]
            Click-Control $window $next
            Wait-Text $window $titles[3]
            Save-Page $window "$language-components"
            Click-Control $window $next
            Wait-Text $window $titles[4]
            Click-Control $window $next
            Wait-Text $window $titles[5]
            Save-Page $window "$language-ready"
            $installCaption = if ($language -eq 'english') { 'Install' } else { 'Installer' }
            Click-Control $window $installCaption
            $clock.Restart()
            $captured = $false
            while (-not (Get-VisibleText $window).Contains($titles[6])) {
                if ($clock.Elapsed.TotalSeconds -gt 300) { throw "Installation did not complete.`n$(Get-VisibleText $window)" }
                $text = Get-VisibleText $window
                if (-not $captured -and ($text.Contains('Preparing your tools') -or $text.Contains('Préparation de vos outils'))) {
                    Save-Page $window "$language-preparation"
                    $captured = $true
                }
                Start-Sleep -Milliseconds 100
            }
            Save-Page $window "$language-finished"
            $report = Get-Content (Join-Path $installed 'setup\installation-result.ini') -Raw
            if ($report -notmatch 'success=1') { throw 'No verified installation report.' }
            $finishCaption = if ($language -eq 'english') { 'Finish' } else { 'Terminer' }
            Click-Control $window $finishCaption
            if (-not $process.WaitForExit(30000)) { throw 'The test installer did not exit.' }
            if ($process.ExitCode -ne 0) { throw "Installer exit code $($process.ExitCode)." }
        } finally {
            $process.Refresh()
            if (-not $process.HasExited) {
                if ($window -ne [IntPtr]::Zero) {
                    [InstallerWindow]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                }
                Start-Sleep -Milliseconds 300
                $yes = if ($language -eq 'english') { 'Yes' } else { 'Oui' }
                $modal = [InstallerWindow]::Find($process.Id)
                if ($modal -ne [IntPtr]::Zero) {
                    $yesButton = @([InstallerWindow]::Children($modal) | Where-Object { ([InstallerWindow]::Text($_)).Replace('&', '') -eq $yes })
                    if ($yesButton.Count -eq 1) { [InstallerWindow]::PostMessage($yesButton[0], 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
                }
                if (-not $process.WaitForExit(10000)) {
                    & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F | Out-Null
                }
            }
            $uninstaller = Join-Path $installed 'unins000.exe'
            if (Test-Path -LiteralPath $uninstaller) {
                $uninstall = Start-Process $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -PassThru -Wait
                if ($uninstall.ExitCode -ne 0) { throw 'UI smoke uninstall failed.' }
                $clock.Restart()
                while ((Test-Path -LiteralPath $uninstaller) -and $clock.Elapsed.TotalSeconds -lt 30) { Start-Sleep -Milliseconds 100 }
                if (Test-Path -LiteralPath $uninstaller) { throw 'UI smoke uninstaller did not finish.' }
            }
        }
    }
    $success = $true
    Write-Output "Installer UI: French/English flow, real preparation, integrated results and targeted window captures verified. Artifacts: $Artifacts"
} finally {
    if ($success) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    else { Write-Warning "UI smoke diagnostics preserved: $temporary" }
}
