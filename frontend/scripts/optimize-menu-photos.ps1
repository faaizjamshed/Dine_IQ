# Export the generated artwork as lightweight menu thumbnails; preserve originals.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$frontendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$photoDirectory = Join-Path $frontendRoot 'public\images\dishes\catalog'
$archiveDirectory = Join-Path $frontendRoot '.cache\menu-photo-originals'
New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null
$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'

Get-ChildItem -LiteralPath $photoDirectory -Filter '*.png' | ForEach-Object {
    $sourcePath = $_.FullName
    $exportPath = [System.IO.Path]::ChangeExtension($sourcePath, '.jpg')
    $archivePath = [System.IO.Path]::GetFullPath((Join-Path $archiveDirectory $_.Name))
    foreach ($targetPath in @($sourcePath, $exportPath, $archivePath)) {
        if (-not $targetPath.StartsWith($frontendRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Asset path must remain inside frontend: $targetPath"
        }
    }
    if (Test-Path -LiteralPath $archivePath) { throw "Original already archived: $archivePath" }
    $sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
    $thumbnail = New-Object System.Drawing.Bitmap 256,256
    $graphics = [System.Drawing.Graphics]::FromImage($thumbnail)
    $parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($sourceImage, 0, 0, 256, 256)
        $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),([long]88)
        $thumbnail.Save($exportPath, $jpegEncoder, $parameters)
    } finally {
        $parameters.Dispose()
        $graphics.Dispose()
        $thumbnail.Dispose()
        $sourceImage.Dispose()
    }
    Move-Item -LiteralPath $sourcePath -Destination $archivePath
}
Get-ChildItem -LiteralPath $photoDirectory -Filter '*.jpg' | Measure-Object Length -Sum
