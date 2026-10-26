param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$Icon,
    [UInt64]$WindowHandle = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VibeIconProbe {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")]
    public static extern bool DrawIconEx(IntPtr dc, int x, int y, IntPtr icon, int width, int height, uint step, IntPtr brush, uint flags);
}
'@
function Render-Icon([IntPtr]$Handle) {
    $bitmap = [Drawing.Bitmap]::new(32, 32)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([Drawing.Color]::White)
        $dc = $graphics.GetHdc()
        try {
            if (-not [VibeIconProbe]::DrawIconEx($dc, 0, 0, $Handle, 32, 32, 0, [IntPtr]::Zero, 3)) {
                throw 'Windows could not draw the application icon.'
            }
        } finally { $graphics.ReleaseHdc($dc) }
    } finally { $graphics.Dispose() }
    return $bitmap
}
function Assert-SameIcon([Drawing.Bitmap]$Actual, [Drawing.Bitmap]$Expected, [string]$Label) {
    if ($Actual.Width -ne $Expected.Width -or $Actual.Height -ne $Expected.Height) {
        throw "$Label icon dimensions differ from the brand icon."
    }
    $difference = 0
    for ($y = 0; $y -lt $Expected.Height; $y++) {
        for ($x = 0; $x -lt $Expected.Width; $x++) {
            $actualPixel = $Actual.GetPixel($x, $y)
            $expectedPixel = $Expected.GetPixel($x, $y)
            $difference += [Math]::Abs([int]$actualPixel.R - $expectedPixel.R) +
                [Math]::Abs([int]$actualPixel.G - $expectedPixel.G) +
                [Math]::Abs([int]$actualPixel.B - $expectedPixel.B)
        }
    }
    $meanError = $difference / (32 * 32 * 3)
    # Chromium can resample a different ICO frame for its window; the PE resource must match exactly.
    $limit = if ($Label -eq 'Executable') { 0 } else { 8 }
    if ($meanError -gt $limit) { throw "$Label brand icon differs (mean channel error $meanError, limit $limit)." }
}
$expectedIcon = [Drawing.Icon]::new($Icon, 32, 32)
$expected = Render-Icon $expectedIcon.Handle
$large = [IntPtr[]]::new(1)
$small = [IntPtr[]]::new(1)
try {
    if ([VibeIconProbe]::ExtractIconEx($Executable, 0, $large, $small, 1) -lt 1 -or $large[0] -eq [IntPtr]::Zero) {
        throw 'The application executable does not contain an icon.'
    }
    $bitmap = Render-Icon $large[0]
    try { Assert-SameIcon $bitmap $expected 'Executable' } finally { $bitmap.Dispose() }
    if ($WindowHandle) {
        $windowIcon = [VibeIconProbe]::SendMessage([IntPtr]::new([long]$WindowHandle), 0x007F, [IntPtr]::new(1), [IntPtr]::Zero)
        if ($windowIcon -eq [IntPtr]::Zero) { throw 'The running application window has no large icon.' }
        $bitmap = Render-Icon $windowIcon
        try { Assert-SameIcon $bitmap $expected 'Running window' } finally { $bitmap.Dispose() }
    }
    'Vibe Studio brand icon verified in the executable and requested running window.'
} finally {
    if ($large[0] -ne [IntPtr]::Zero) { [VibeIconProbe]::DestroyIcon($large[0]) | Out-Null }
    if ($small[0] -ne [IntPtr]::Zero) { [VibeIconProbe]::DestroyIcon($small[0]) | Out-Null }
    $expected.Dispose()
    $expectedIcon.Dispose()
}
