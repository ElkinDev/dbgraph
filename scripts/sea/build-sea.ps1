<#
.SYNOPSIS
  Assembles the win-x64 Node SEA binary: esbuild bundle -> SEA blob -> postject inject.

.DESCRIPTION
  Windows-native SEA assembly (design D8, phase-9.5c). Runs the SAME logical steps as the
  Linux build-sea.sh; only the postject host Node differs per platform.

  Pipeline:
    1. bundle : <node> scripts/sea/build-bundle.mjs               -> build/sea/dbgraph.cjs
    2. blob   : <node> --experimental-sea-config sea-config.json  -> build/sea/dbgraph.blob
    3. copy   : copy the PINNED node.exe                          -> dist/bin/dbgraph-win-x64.exe
    4. sign   : signtool remove /s (BEST-EFFORT; NOT required — Batch 0.5)
    5. inject : postject NODE_SEA_BLOB @ NODE_SEA_FUSE_...         -> the exe becomes the binary

  Batch 0 empirical constants (design.md "Batch 0 — empirical findings"):
    - pinned Node ....... 24.18.0 (node:sqlite needs NO flag; determinism anchor)
    - sentinel fuse ..... NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    - signtool remove ... NOT required for the exe to run (best-effort if available)
    - the "signature seems corrupted" postject warning is EXPECTED and benign (code
      signing is explicitly out of scope; SmartScreen may warn on first run — the exe runs).

.PARAMETER NodeExe
  Path to the PINNED Node 24.18.0 executable to EMBED. Defaults to $env:DBGRAPH_BUILD_NODE,
  else `node` on PATH. The embedded runtime IS this executable — it MUST be the pinned build.
#>
[CmdletBinding()]
param(
  [string]$NodeExe = $(if ($env:DBGRAPH_BUILD_NODE) { $env:DBGRAPH_BUILD_NODE } else { 'node' })
)

$ErrorActionPreference = 'Stop'

# Repo root = two levels up from scripts/sea/.
# Nested Join-Path for Windows PowerShell 5.1 (its Join-Path takes ONE child segment).
$repoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path
Set-Location $repoRoot

# Resolve the pinned Node executable and report its version (embedded runtime).
$nodeCmd = Get-Command $NodeExe -ErrorAction Stop
$nodePath = $nodeCmd.Source
$nodeVersion = (& $nodePath --version).Trim()
Write-Host "Embedding Node runtime: $nodePath ($nodeVersion)"
if ($nodeVersion -notlike 'v24.*') {
  Write-Warning "Pinned build Node is 24.18.0 (.nvmrc). Embedding $nodeVersion may reintroduce the node:sqlite ExperimentalWarning and breaks the determinism pin."
}

$blobPath = Join-Path $repoRoot 'build\sea\dbgraph.blob'
$outDir = Join-Path $repoRoot 'dist\bin'
$exePath = Join-Path $outDir 'dbgraph-win-x64.exe'
$seaConfig = Join-Path $repoRoot 'scripts\sea\sea-config.json'
$postjectCli = Join-Path $repoRoot 'node_modules\postject\dist\cli.js'
$fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

# 1. esbuild bundle -> build/sea/dbgraph.cjs
Write-Host '[1/5] esbuild bundle...'
& $nodePath (Join-Path $repoRoot 'scripts\sea\build-bundle.mjs')
if ($LASTEXITCODE -ne 0) { throw "bundle step failed ($LASTEXITCODE)" }

# 2. SEA blob -> build/sea/dbgraph.blob
Write-Host '[2/5] SEA blob (node --experimental-sea-config)...'
& $nodePath --experimental-sea-config $seaConfig
if ($LASTEXITCODE -ne 0) { throw "sea-config step failed ($LASTEXITCODE)" }
if (-not (Test-Path $blobPath)) { throw "blob not produced at $blobPath" }

# 3. copy the pinned node.exe -> dist/bin/dbgraph-win-x64.exe
Write-Host '[3/5] copy pinned node.exe -> dbgraph-win-x64.exe...'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item -Force $nodePath $exePath

# 4. signtool remove /s (BEST-EFFORT — Batch 0.5: not required for the exe to run)
Write-Host '[4/5] signtool remove /s (best-effort)...'
$signtool = Get-Command signtool -ErrorAction SilentlyContinue
if ($signtool) {
  try {
    & $signtool.Source remove /s $exePath
    Write-Host '      signature stripped.'
  } catch {
    Write-Warning "      signtool remove failed (non-fatal, Batch 0.5): $_"
  }
} else {
  Write-Host '      signtool not installed — skipping (not required, Batch 0.5).'
}

# 5. postject inject the blob at the sentinel fuse.
Write-Host '[5/5] postject inject...'
& $nodePath $postjectCli $exePath NODE_SEA_BLOB $blobPath --sentinel-fuse $fuse
if ($LASTEXITCODE -ne 0) { throw "postject inject failed ($LASTEXITCODE)" }

Write-Host ''
Write-Host "SEA binary ready: $exePath"
Write-Host '(The "signature seems corrupted" postject warning above is expected and benign.)'
