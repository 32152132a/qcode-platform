[CmdletBinding()]
param(
    [string]$OpenCodeRepository = '',
    [string]$Source = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Source) { $Source = Join-Path $root 'docs/branding/qcode-icon.png' }
if (-not $OpenCodeRepository) { $OpenCodeRepository = Join-Path (Split-Path $root -Parent) 'qcode-opencode' }
$Source = (Resolve-Path -LiteralPath $Source).Path
$OpenCodeRepository = (Resolve-Path -LiteralPath $OpenCodeRepository).Path

Add-Type -AssemblyName System.Drawing

# Embed the supplied bitmap so favicon SVGs remain self-contained without redrawing it.
$encodedSource=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Source))
$svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,'+$encodedSource+'"/></svg>'
foreach($relative in @('apps/admin/public/brand-logo.svg','apps/server/public/brand-logo.svg')){
    [IO.File]::WriteAllText((Join-Path $root $relative),$svg,(New-Object Text.UTF8Encoding($false)))
}

function Export-SquarePng([Drawing.Image]$Image, [int]$Size, [string]$Path) {
    $bitmap = New-Object Drawing.Bitmap $Size, $Size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bitmap.SetResolution(96, 96)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($Image, (New-Object Drawing.Rectangle 0, 0, $Size, $Size))
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
        $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Export-PngIco([string[]]$PngPaths, [string]$Path) {
    $images = @($PngPaths | ForEach-Object { ,([IO.File]::ReadAllBytes($_)) })
    $stream = [IO.File]::Create($Path)
    $writer = New-Object IO.BinaryWriter $stream
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$images.Count)
        $offset = 6 + 16 * $images.Count
        for ($index = 0; $index -lt $images.Count; $index++) {
            $size = [int]([IO.Path]::GetFileNameWithoutExtension($PngPaths[$index]) -replace '\D', '')
            $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
            $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$images[$index].Length)
            $writer.Write([uint32]$offset)
            $offset += $images[$index].Length
        }
        foreach ($image in $images) { $writer.Write($image) }
    } finally {
        $writer.Dispose()
        $stream.Dispose()
    }
}

$image = [Drawing.Image]::FromFile($Source)
try {
    if ($image.Width -ne $image.Height) { throw 'The QCode brand source must be square.' }
    $platformBranding = Join-Path $root 'apps/server/public/branding'
    $clientBranding = Join-Path $root 'apps/client/branding'
    $openCodeBranding = Join-Path $OpenCodeRepository 'packages/app/public/branding'
    $openCodeDesktop = Join-Path $OpenCodeRepository 'packages/desktop/icons/prod'
    $sizes = @(16, 24, 32, 48, 64, 96, 128, 192, 256, 512)

    foreach ($directory in @($platformBranding, $clientBranding, $openCodeBranding)) {
        foreach ($size in $sizes) { Export-SquarePng $image $size (Join-Path $directory "qcode-$size.png") }
        Export-PngIco ($sizes | Where-Object { $_ -in @(16, 24, 32, 48, 64, 96, 128, 256) } | ForEach-Object { Join-Path $directory "qcode-$_.png" }) (Join-Path $directory 'qcode.ico')
    }

    Export-SquarePng $image 512 (Join-Path $openCodeDesktop 'icon.png')
    Export-SquarePng $image 512 (Join-Path $OpenCodeRepository 'packages/ui/src/assets/images/qcode.png')
    Export-PngIco ($sizes | Where-Object { $_ -in @(16, 24, 32, 48, 64, 96, 128, 256) } | ForEach-Object { Join-Path $openCodeBranding "qcode-$_.png" }) (Join-Path $openCodeDesktop 'icon.ico')
} finally {
    $image.Dispose()
}

Write-Output 'Generated QCode PNG and multi-size ICO assets.'
