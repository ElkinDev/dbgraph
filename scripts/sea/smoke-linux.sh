#!/usr/bin/env bash
#
# smoke-linux.sh — the Node-LESS container smoke for the linux-x64 SEA binary
# (design D9, phase-9.5c, spec R2/R3). The STRONGEST proof of "no Node, no
# node_modules required": the ONLY executable in the container is the binary, and the
# ONLY sqlite is the one compiled into it (in-binary node:sqlite).
#
# Runs `--version`, `--help`, and init->sync->query on a fixture, asserting the query
# output is BYTE-IDENTICAL to the committed golden (ADR-008). SKIPS cleanly when the
# linux binary has not been built (opt-in local gate — never blocks npm test).
#
# The fixture source.db is created on the HOST via node:sqlite (fixture prep only, NOT
# the binary run). The image is a Node-LESS debian:bookworm-slim (glibc parity with the
# node:24-bookworm-slim build image).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$REPO_ROOT/dist/bin/dbgraph-linux-x64"
GOLDEN="$REPO_ROOT/test/bin/golden/query-orders.txt"
IMAGE="${DBGRAPH_SMOKE_IMAGE:-debian:bookworm-slim}"
NODE_IMAGE="${DBGRAPH_LINUX_IMAGE:-node:24.18.0-bookworm-slim}"

if [ ! -f "$BIN" ]; then
  echo "SKIP: $BIN not found — run 'npm run build:sea:linux' first."
  exit 0
fi

# Windows git-bash (MSYS): docker needs mixed-mode host paths (C:/...) and NO POSIX
# path mangling. On a real Linux host cygpath is absent → paths pass through unchanged.
if command -v cygpath >/dev/null 2>&1; then
  export MSYS_NO_PATHCONV=1
  hostpath() { cygpath -m "$1"; }
else
  hostpath() { printf '%s' "$1"; }
fi

# package.json version via grep/sed (portable — no host node, avoids Win/POSIX path skew).
VERSION="$(grep -m1 '"version"' "$REPO_ROOT/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" 2>/dev/null || true' EXIT
cp "$BIN" "$WORK/dbgraph"
chmod +x "$WORK/dbgraph"

WORKM="$(hostpath "$WORK")"
drun() { MSYS_NO_PATHCONV=1 docker run --rm -v "${WORKM}:/work" -w /work "$IMAGE" "$@"; }

# Fixture source db (customers/orders) — created INSIDE a node container writing to the
# mounted /work, so no host node and no Windows/POSIX path skew (fixture prep only, NOT
# the binary run). This is the controlled schema behind the committed query golden.
MSYS_NO_PATHCONV=1 docker run --rm -v "${WORKM}:/work" -w /work "$NODE_IMAGE" \
  node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/work/source.db'); db.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL); CREATE INDEX idx_orders_customer ON orders(customer_id);'); db.close();"

fail=0
echo "== Node-less container smoke: $IMAGE =="

# 0. Prove the container has NO node.
if drun sh -c 'command -v node >/dev/null 2>&1'; then
  echo "FAIL: node IS present in the smoke image (must be node-less)"; fail=1
else
  echo "PASS: container has no node"
fi

# 1. --version == package.json version.
v="$(drun /work/dbgraph --version)"
if [ "$v" = "$VERSION" ]; then echo "PASS: --version == $VERSION"; else echo "FAIL: --version got [$v] want [$VERSION]"; fail=1; fi

# 2. --help prints the usage banner.
if drun /work/dbgraph --help | head -n 1 | grep -q '^dbgraph — database schema graph indexer'; then
  echo "PASS: --help banner"
else
  echo "FAIL: --help banner"; fail=1
fi

# 3. init -> sync (init runs the first sync on the in-binary node:sqlite).
if drun /work/dbgraph init --dialect sqlite --file /work/source.db --driver node:sqlite >/dev/null; then
  echo "PASS: init -> sync exit 0"
else
  echo "FAIL: init -> sync"; fail=1
fi

# 4. query <term> byte-identical to the committed golden (ADR-008).
drun /work/dbgraph query orders > "$WORK/q.out" 2>/dev/null || true
if cmp -s "$WORK/q.out" "$GOLDEN"; then
  echo "PASS: query byte-identical to golden"
else
  echo "FAIL: query golden mismatch"; diff "$GOLDEN" "$WORK/q.out" || true; fail=1
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "LINUX NODE-LESS SMOKE: GREEN"
else
  echo "LINUX NODE-LESS SMOKE: RED"; exit 1
fi
