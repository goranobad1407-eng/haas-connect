$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$bundleRoot = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"

Write-Host "Building production NSIS installer..."
Push-Location $repoRoot
try {
  & npm.cmd run tauri -- build --bundles nsis
  if ($LASTEXITCODE -ne 0) {
    throw "Installer build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $bundleRoot)) {
  throw "Installer bundle folder was not created: $bundleRoot"
}

$installer = Get-ChildItem -LiteralPath $bundleRoot -Filter "*-setup.exe" -File |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "Could not find NSIS installer in $bundleRoot"
}

$rootCopyPath = Join-Path $repoRoot $installer.Name
Copy-Item -LiteralPath $installer.FullName -Destination $rootCopyPath -Force

$bundleSize = $installer.Length
$rootCopySize = (Get-Item -LiteralPath $rootCopyPath).Length

if ($bundleSize -ne $rootCopySize) {
  throw "Installer copy size mismatch: bundle=$bundleSize root=$rootCopySize"
}

Write-Host "Installer bundle: $($installer.FullName)"
Write-Host "Installer root copy: $rootCopyPath"
Write-Host "Installer size: $rootCopySize bytes"
