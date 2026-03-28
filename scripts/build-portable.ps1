$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$srcTauriRoot = Join-Path $repoRoot "src-tauri"
$releaseRoot = Join-Path $srcTauriRoot "target\\release"
$portableRoot = Join-Path $repoRoot "portable-build"

$packageJson = Get-Content (Join-Path $repoRoot "package.json") | ConvertFrom-Json
$version = $packageJson.version
$portableName = "HAAS-CNC-Connect-portable-$version"
$portableDir = Join-Path $portableRoot $portableName
$zipPath = Join-Path $portableRoot "$portableName.zip"

Write-Host "Building frontend assets..."
Push-Location $repoRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Frontend build failed with exit code $LASTEXITCODE"
  }
  Write-Host "Building Tauri release executable..."
  & cargo build --manifest-path (Join-Path $srcTauriRoot "Cargo.toml") --release
  if ($LASTEXITCODE -ne 0) {
    throw "Cargo release build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $releaseRoot)) {
  throw "Tauri release output folder was not created: $releaseRoot"
}

$exe = Get-ChildItem -LiteralPath $releaseRoot -Filter "*.exe" -File |
  Where-Object { $_.Name -notlike "*-*" -or $_.Name -eq "haas-cnc-connect.exe" } |
  Sort-Object Name |
  Select-Object -First 1

if (-not $exe) {
  $exe = Get-ChildItem -LiteralPath $releaseRoot -Filter "*.exe" -File |
    Sort-Object Name |
    Select-Object -First 1
}

if (-not $exe) {
  throw "Could not find built executable in $releaseRoot"
}

New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null

if (Test-Path $portableDir) {
  $resolvedPortableDir = (Resolve-Path $portableDir).Path
  if (-not $resolvedPortableDir.StartsWith((Resolve-Path $portableRoot).Path)) {
    throw "Refusing to remove unexpected portable output path: $resolvedPortableDir"
  }
  Remove-Item -Recurse -Force -LiteralPath $portableDir
}

if (Test-Path $zipPath) {
  Remove-Item -Force -LiteralPath $zipPath
}

New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $portableDir $exe.Name)

$configSource = Join-Path $repoRoot "machines.json"
if (Test-Path $configSource) {
  Copy-Item -LiteralPath $configSource -Destination (Join-Path $portableDir "machines.json")
}

$docSource = Join-Path $repoRoot "PORTABLE_BUILD.md"
if (Test-Path $docSource) {
  Copy-Item -LiteralPath $docSource -Destination (Join-Path $portableDir "PORTABLE_BUILD.md")
}

Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath $zipPath -Force

Write-Host "Portable folder: $portableDir"
Write-Host "Portable zip:    $zipPath"
