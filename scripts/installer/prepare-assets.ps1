param(
    [Parameter(Mandatory = $true)][string]$Logo,
    [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $Destination | Out-Null
$source = [Drawing.Image]::FromFile($Logo)
try {
    foreach ($theme in @('light', 'dark')) {
        $bitmap = New-Object Drawing.Bitmap 492, 942
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $background = if ($theme -eq 'dark') { '#16243b' } else { '#edf3fc' }
        $line = if ($theme -eq 'dark') { '#385680' } else { '#b7cceb' }
        $pen = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml($line)), 2
        $accent = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#0969da'))
        try {
            $graphics.Clear([Drawing.ColorTranslator]::FromHtml($background))
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $graphics.DrawImage($source, 182, 144, 128, 128)
            $graphics.DrawLine($pen, 88, 610, 246, 610)
            $graphics.DrawLine($pen, 246, 610, 246, 734)
            $graphics.DrawLine($pen, 246, 734, 404, 734)
            foreach ($point in @(@(88, 610), @(246, 610), @(246, 734), @(404, 734))) {
                $graphics.FillEllipse($accent, ($point[0] - 7), ($point[1] - 7), 14, 14)
            }
            $bitmap.Save((Join-Path $Destination "wizard-$theme.png"), [Drawing.Imaging.ImageFormat]::Png)
        } finally { $accent.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
    $small = New-Object Drawing.Bitmap 96, 96
    $graphics = [Drawing.Graphics]::FromImage($small)
    try {
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($source, 0, 0, 96, 96)
        $small.Save((Join-Path $Destination 'wizard-small.png'), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $small.Dispose() }

    $images = @()
    foreach ($size in @(16, 24, 32, 48, 64, 128)) {
        $bitmap = New-Object Drawing.Bitmap $size, $size
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $stream = New-Object IO.MemoryStream
        try {
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($source, 0, 0, $size, $size)
            $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
            $images += @{ Size = $size; Bytes = $stream.ToArray() }
        } finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
    $file = [IO.File]::Create((Join-Path $Destination 'setup.ico'))
    $writer = New-Object IO.BinaryWriter $file
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
        $offset = 6 + 16 * $images.Count
        foreach ($image in $images) {
            $writer.Write([byte]$image.Size); $writer.Write([byte]$image.Size)
            $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$image.Bytes.Length); $writer.Write([uint32]$offset)
            $offset += $image.Bytes.Length
        }
        foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
    } finally { $writer.Dispose(); $file.Dispose() }
} finally { $source.Dispose() }
