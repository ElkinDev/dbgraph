<#
.SYNOPSIS
  Checksum-verifying Windows installer for the dbgraph SEA binary (US-037, design D11).

.DESCRIPTION
  PowerShell (irm | iex) installer. Downloads the binary + SHA256SUMS to a TEMP dir, computes
  the local SHA256, and compares it (case-insensitive) to the published checksum BEFORE placing
  the binary on the PATH dir. On ANY mismatch the partial download is deleted and the installer
  aborts non-zero BEFORE touching the install dir (FAIL CLOSED, spec R5) - a tampered/truncated
  binary can NEVER reach PATH.

  Pure PowerShell: Invoke-WebRequest + Get-FileHash only - NO runtime dependency (ADR-007). TLS
  1.2+ is enforced for the download. The asset name replicates scripts/install/asset-name.mjs
  (the shared, unit-tested contract). Installs to a user-local dir (no admin/sudo).

.EXAMPLE
  irm https://raw.githubusercontent.com/ElkinDev/dbgraph/main/install.ps1 | iex
.EXAMPLE
  .\install.ps1 -Version 0.1.0 -InstallDir "$env:LOCALAPPDATA\dbgraph\bin"
#>
[CmdletBinding()]
param(
  [string]$Version = $(if ($env:DBGRAPH_VERSION) { $env:DBGRAPH_VERSION } else { '0.1.0' }),
  [string]$InstallDir = $(if ($env:DBGRAPH_INSTALL_DIR) { $env:DBGRAPH_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'dbgraph\bin' }),
  [string]$Base = $(if ($env:DBGRAPH_DOWNLOAD_BASE) { $env:DBGRAPH_DOWNLOAD_BASE } else { '' }),
  [string]$Os = $(if ($env:DBGRAPH_OS) { $env:DBGRAPH_OS } else { 'win32' }),
  [string]$Arch = $(if ($env:DBGRAPH_ARCH) { $env:DBGRAPH_ARCH } else { '' }),
  [switch]$PrintPlan
)

$ErrorActionPreference = 'Stop'

# Honor the env toggle for print-plan (parity with install.sh's DBGRAPH_INSTALL_PRINT_PLAN).
if ($env:DBGRAPH_INSTALL_PRINT_PLAN) { $PrintPlan = $true }

# Enforce TLS 1.2+ for the download (older PowerShell defaults to TLS 1.0).
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  # Some hosts predate the enum member; TLS negotiation still proceeds with the platform default.
}

function Fail([string]$message) {
  [Console]::Error.WriteLine("install.ps1: $message")
  exit 1
}

# ---- Detect arch (overridable so a test can force the target) --------------------------------
if (-not $Arch) {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { $Arch = 'x64' }
    default { Fail "unsupported arch '$($env:PROCESSOR_ARCHITECTURE)'. Only x64 is shipped." }
  }
}

# ---- Asset name - replicates scripts/install/asset-name.mjs (the shared contract) ------------
$target = "$Os-$Arch"
switch ($target) {
  'win32-x64' { $asset = 'dbgraph-win-x64.exe' }
  default { Fail "unsupported target '$target'. Supported: win32/x64 (macOS deferred to 9.5d)." }
}

$defaultBase = "https://github.com/ElkinDev/dbgraph/releases/download/v$Version"
if (-not $Base) { $Base = $defaultBase }
$assetUrl = "$Base/$asset"
$sumsUrl = "$Base/SHA256SUMS"

if ($PrintPlan) {
  Write-Output "version=$Version"
  Write-Output "target=$target"
  Write-Output "asset=$asset"
  Write-Output "asset_url=$assetUrl"
  Write-Output "sums_url=$sumsUrl"
  Write-Output "install_dir=$InstallDir"
  exit 0
}

# ---- Temp workdir: partials live here and NEVER touch InstallDir ------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("dbgraph-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $tmpAsset = Join-Path $tmp $asset
  $tmpSums = Join-Path $tmp 'SHA256SUMS'

  if ($Base -match '^https?://') {
    # Remote release: download the asset and the SHA256SUMS over HTTPS.
    Invoke-WebRequest -Uri $assetUrl -OutFile $tmpAsset -UseBasicParsing
    Invoke-WebRequest -Uri $sumsUrl -OutFile $tmpSums -UseBasicParsing
  } else {
    # Local base dir (tests / offline mirror): copy the asset and SHA256SUMS from it.
    $localBase = $Base -replace '^file://', ''
    Copy-Item -LiteralPath (Join-Path $localBase $asset) -Destination $tmpAsset -Force
    Copy-Item -LiteralPath (Join-Path $localBase 'SHA256SUMS') -Destination $tmpSums -Force
  }

  # ---- Compute local SHA256 and read the published checksum for this asset --------------------
  $actual = (Get-FileHash -LiteralPath $tmpAsset -Algorithm SHA256).Hash.ToLowerInvariant()

  $expected = $null
  foreach ($line in Get-Content -LiteralPath $tmpSums) {
    if ($line -match '^\s*$') { continue }
    $parts = $line -split '\s+', 2
    if ($parts.Count -ge 2) {
      $fname = $parts[1].Trim().TrimStart('*')
      if ($fname -eq $asset) { $expected = $parts[0].Trim().ToLowerInvariant(); break }
    }
  }
  if (-not $expected) {
    Fail "no checksum entry for '$asset' in SHA256SUMS - refusing to install (fail closed)."
  }

  if ($actual -ne $expected) {
    # Delete the partial BEFORE any PATH placement.
    Remove-Item -LiteralPath $tmpAsset -Force -ErrorAction SilentlyContinue
    [Console]::Error.WriteLine("install.ps1: SHA256 MISMATCH for '$asset' - the download does not match the published checksum.")
    [Console]::Error.WriteLine("  expected: $expected")
    [Console]::Error.WriteLine("  actual:   $actual")
    Fail "refusing to install an unverified binary (fail closed). Nothing was placed on PATH."
  }

  # ---- Verified -> place on the install dir (only reached on a checksum MATCH) ----------------
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $dest = Join-Path $InstallDir 'dbgraph.exe'
  Move-Item -LiteralPath $tmpAsset -Destination $dest -Force

  Write-Output "install.ps1: verified SHA256 and installed dbgraph $Version -> $dest"
  $pathDirs = ($env:PATH -split ';') | ForEach-Object { $_.TrimEnd('\') }
  if ($pathDirs -notcontains $InstallDir.TrimEnd('\')) {
    Write-Output "install.ps1: add the install dir to your PATH (User scope):"
    Write-Output ('  setx PATH "' + $InstallDir + ';' + '$env:PATH"')
  }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
