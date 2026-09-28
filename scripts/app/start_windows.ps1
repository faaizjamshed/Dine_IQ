param(
    [int]$Port = 5000,
    [string]$Bundle = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
Set-Location $projectRoot

if ([string]::IsNullOrWhiteSpace($Bundle)) {
    $Bundle = Join-Path $projectRoot "results\submission\serving-v3"
}
$bundlePath = (Resolve-Path $Bundle -ErrorAction Stop).Path
$env:DINEIQ_ARTIFACT_ROOT = $bundlePath
$env:DINEIQ_PORT = [string]$Port

$python = Join-Path $projectRoot ".venv311\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = (Get-Command python -ErrorAction Stop).Source
}

Write-Host "Starting DineIQ from verified bundle: $bundlePath"
Write-Host "Open http://127.0.0.1:$Port and check /api/health"
& $python -m app.serve
exit $LASTEXITCODE
