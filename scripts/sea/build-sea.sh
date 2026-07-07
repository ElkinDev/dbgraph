#!/usr/bin/env bash
#
# build-sea.sh — assembles the linux-x64 Node SEA binary INSIDE the Docker container
# (design D8/D9, phase-9.5c). Runs the SAME logical steps as build-sea.ps1; only the
# postject host Node differs (the container's glibc Node 24).
#
# Pipeline (executed with the repo bind-mounted at the cwd):
#   0. fetch the linux esbuild binary into an ISOLATED /tmp prefix (NOT the mounted
#      node_modules) and point esbuild at it via ESBUILD_BINARY_PATH. The mount carries
#      the HOST platform's @esbuild/<host> binary; installing into the mount would
#      REPLACE it and break the host build. postject is pure JS/wasm (os/cpu "any") so
#      the mounted copy runs as-is.
#   1. bundle : node scripts/sea/build-bundle.mjs              -> build/sea/dbgraph.cjs
#   2. blob   : node --experimental-sea-config sea-config.json -> build/sea/dbgraph.blob
#   3. copy   : cp $(command -v node)                          -> dist/bin/dbgraph-linux-x64
#   4. inject : postject NODE_SEA_BLOB @ NODE_SEA_FUSE_...     -> the binary
#
# Batch 0 constants: pinned Node 24.18.0; fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2.
# Determinism (ADR-008/R6): the bundle + blob are byte-reproducible on the pinned Node.

set -euo pipefail

FUSE='NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
ESBUILD_VERSION="${DBGRAPH_ESBUILD_VERSION:-0.28.1}"

echo "[linux-sea] node $(node --version) on $(uname -m)"

# 0. Provision the linux esbuild binary into an ISOLATED /tmp prefix (never the mounted
#    node_modules) and point esbuild at it via ESBUILD_BINARY_PATH. This leaves the
#    host's mounted node_modules (and its @esbuild/<host> binary) untouched.
ESBUILD_TOOLS='/tmp/dbgraph-esbuild'
echo "[linux-sea] provisioning isolated linux esbuild@${ESBUILD_VERSION}..."
mkdir -p "$ESBUILD_TOOLS"
npm install --no-save --no-package-lock --no-audit --no-fund --prefix "$ESBUILD_TOOLS" "@esbuild/linux-x64@${ESBUILD_VERSION}" >/tmp/npm-esbuild.log 2>&1 || {
  echo "[linux-sea] esbuild install failed:"; cat /tmp/npm-esbuild.log; exit 1;
}
export ESBUILD_BINARY_PATH="$ESBUILD_TOOLS/node_modules/@esbuild/linux-x64/bin/esbuild"
test -x "$ESBUILD_BINARY_PATH" || { echo "[linux-sea] esbuild binary not found at $ESBUILD_BINARY_PATH"; exit 1; }

# 1. esbuild bundle
echo "[linux-sea] [1/4] esbuild bundle..."
node scripts/sea/build-bundle.mjs

# 2. SEA blob
echo "[linux-sea] [2/4] SEA blob..."
node --experimental-sea-config scripts/sea/sea-config.json
test -f build/sea/dbgraph.blob || { echo "blob not produced"; exit 1; }

# 3. copy the container's pinned linux node
echo "[linux-sea] [3/4] copy node -> dist/bin/dbgraph-linux-x64..."
mkdir -p dist/bin
cp "$(command -v node)" dist/bin/dbgraph-linux-x64

# 4. postject inject (pure JS/wasm — mounted copy is cross-platform)
echo "[linux-sea] [4/4] postject inject..."
node node_modules/postject/dist/cli.js dist/bin/dbgraph-linux-x64 NODE_SEA_BLOB build/sea/dbgraph.blob --sentinel-fuse "$FUSE"
chmod +x dist/bin/dbgraph-linux-x64

echo "[linux-sea] SEA binary ready: dist/bin/dbgraph-linux-x64"
