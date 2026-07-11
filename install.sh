#!/usr/bin/env sh
# ─────────────────────────────────────────────────────────────────────────────────────────────
# install.sh — checksum-verifying POSIX installer for the dbgraph SEA binary (US-037, design D11).
#
# Usage (curl | sh):
#   curl -fsSL https://raw.githubusercontent.com/ElkinDev/dbgraph/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --version 0.1.0 --install-dir "$HOME/.local/bin"
#
# FAIL-CLOSED CONTRACT (D11, spec R5): the binary + SHA256SUMS are downloaded to a TEMP dir,
# the local SHA256 is computed and compared (case-insensitive) to the published checksum, and
# ONLY on a match is the binary placed on the PATH dir. On ANY mismatch the partial download is
# deleted and the installer aborts non-zero BEFORE touching the install dir — a tampered or
# truncated binary can NEVER reach PATH.
#
# Pure shell: uses curl/wget + sha256sum/shasum + awk/tr only — NO runtime dependency (ADR-007).
# The asset name replicates scripts/install/asset-name.mjs (the shared, unit-tested contract).
# Windows users install with install.ps1; this script targets linux (macOS is deferred to 9.5d).
# ─────────────────────────────────────────────────────────────────────────────────────────────
set -eu

DEFAULT_VERSION='1.1.0'
VERSION="${DBGRAPH_VERSION:-$DEFAULT_VERSION}"
INSTALL_DIR="${DBGRAPH_INSTALL_DIR:-$HOME/.local/bin}"
BASE="${DBGRAPH_DOWNLOAD_BASE:-}"
OS_OVERRIDE="${DBGRAPH_OS:-}"
ARCH_OVERRIDE="${DBGRAPH_ARCH:-}"
PRINT_PLAN="${DBGRAPH_INSTALL_PRINT_PLAN:-}"

print_help() {
  cat <<'EOF'
install.sh — download and install the dbgraph binary (verifies SHA256 before PATH).

Options:
  --version <v>        release version to install (default: pinned)
  --install-dir <dir>  where to place the binary (default: $HOME/.local/bin)
  --base <url|dir>     download base (default: the GitHub Release for the version)
  --os <os>            override detected OS (linux)
  --arch <arch>        override detected arch (x64)
  --print-plan         print the resolved asset/URL and exit (no download)
  -h, --help           show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
    --version=*) VERSION="${1#*=}"; shift ;;
    --install-dir) INSTALL_DIR="${2:?--install-dir needs a value}"; shift 2 ;;
    --install-dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    --base) BASE="${2:?--base needs a value}"; shift 2 ;;
    --base=*) BASE="${1#*=}"; shift ;;
    --os) OS_OVERRIDE="${2:?--os needs a value}"; shift 2 ;;
    --os=*) OS_OVERRIDE="${1#*=}"; shift ;;
    --arch) ARCH_OVERRIDE="${2:?--arch needs a value}"; shift 2 ;;
    --arch=*) ARCH_OVERRIDE="${1#*=}"; shift ;;
    --print-plan) PRINT_PLAN=1; shift ;;
    -h|--help) print_help; exit 0 ;;
    *) echo "install.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── Detect os/arch (overridable so an unusual uname or a test can force the target) ──────────
os="$OS_OVERRIDE"
if [ -z "$os" ]; then
  case "$(uname -s)" in
    Linux) os='linux' ;;
    Darwin) os='darwin' ;;
    *) echo "install.sh: unsupported OS '$(uname -s)'. This installer targets linux; on Windows use install.ps1." >&2; exit 1 ;;
  esac
fi

arch="$ARCH_OVERRIDE"
if [ -z "$arch" ]; then
  case "$(uname -m)" in
    x86_64|amd64) arch='x64' ;;
    *) echo "install.sh: unsupported arch '$(uname -m)'. Only x64 is shipped." >&2; exit 1 ;;
  esac
fi

# ── Asset name — replicates scripts/install/asset-name.mjs (the shared contract) ─────────────
case "$os-$arch" in
  linux-x64) asset='dbgraph-linux-x64' ;;
  *) echo "install.sh: unsupported target '$os/$arch'. Supported: linux/x64 (macOS deferred to 9.5d)." >&2; exit 1 ;;
esac

default_base="https://github.com/ElkinDev/dbgraph/releases/download/v${VERSION}"
base="${BASE:-$default_base}"
asset_url="$base/$asset"
sums_url="$base/SHA256SUMS"

if [ -n "$PRINT_PLAN" ]; then
  echo "version=$VERSION"
  echo "target=$os-$arch"
  echo "asset=$asset"
  echo "asset_url=$asset_url"
  echo "sums_url=$sums_url"
  echo "install_dir=$INSTALL_DIR"
  exit 0
fi

# ── Temp workdir: partials live here and NEVER touch INSTALL_DIR ─────────────────────────────
tmp="$(mktemp -d 2>/dev/null || mktemp -d -t dbgraph.XXXXXX)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT INT TERM

# fetch <src> <dest>: local dir/file:// → copy; http(s) → curl/wget.
fetch() {
  src="$1"
  dest="$2"
  case "$src" in
    http://*|https://*)
      if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$src" -o "$dest"
      elif command -v wget >/dev/null 2>&1; then
        wget -qO "$dest" "$src"
      else
        echo "install.sh: neither curl nor wget is available to download $src" >&2
        exit 1
      fi
      ;;
    file://*) cp "${src#file://}" "$dest" ;;
    *) cp "$src" "$dest" ;;
  esac
}

fetch "$asset_url" "$tmp/$asset"
fetch "$sums_url" "$tmp/SHA256SUMS"

# ── Compute the local SHA256 of the downloaded asset ─────────────────────────────────────────
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
else
  echo "install.sh: no sha256 tool (sha256sum/shasum) available — cannot verify. Aborting (fail closed)." >&2
  exit 1
fi

# Expected checksum: the line in SHA256SUMS whose filename column equals the asset (tolerate a
# leading '*' binary-mode marker).
expected="$(awk -v a="$asset" '{ f=$2; sub(/^\*/, "", f); if (f == a) print $1 }' "$tmp/SHA256SUMS" | head -n 1)"
if [ -z "$expected" ]; then
  echo "install.sh: no checksum entry for '$asset' in SHA256SUMS — refusing to install (fail closed)." >&2
  exit 1
fi

actual_lc="$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')"
expected_lc="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"

if [ "$actual_lc" != "$expected_lc" ]; then
  rm -f "$tmp/$asset" # delete the partial BEFORE any PATH placement
  echo "install.sh: SHA256 MISMATCH for '$asset' — the download does not match the published checksum." >&2
  echo "  expected: $expected_lc" >&2
  echo "  actual:   $actual_lc" >&2
  echo "install.sh: refusing to install an unverified binary (fail closed). Nothing was placed on PATH." >&2
  exit 1
fi

# ── Verified → place on the PATH dir (only reached on a checksum MATCH) ──────────────────────
mkdir -p "$INSTALL_DIR"
dest="$INSTALL_DIR/dbgraph"
mv "$tmp/$asset" "$dest"
chmod +x "$dest"

echo "install.sh: verified SHA256 and installed dbgraph $VERSION -> $dest"
case ":${PATH:-}:" in
  *":$INSTALL_DIR:"*) : ;;
  *)
    echo "install.sh: add the install dir to your PATH:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
