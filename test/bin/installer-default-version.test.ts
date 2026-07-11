/**
 * Installer default-version drift guard — release-hygiene invariant (mssql-config-hardening M6).
 *
 * The `curl | sh` / `irm | iex` installers each carry a HARDCODED default version used when the
 * caller passes no `--version` / `-Version`. If that default drifts below `package.json.version`,
 * a no-arg install fetches a stale (or missing) release. The historical defect was exactly this:
 * both installers still defaulted to `0.1.0` while the package shipped `1.1.0`.
 *
 * This guard reads FILES ONLY (the two installer scripts + `package.json` on disk) — no build
 * artifact, no network, no spawn — so it runs UNCONDITIONALLY in `npm test`. When the `1.1.1`
 * release cut bumps `package.json`, this test goes RED until BOTH installer defaults are bumped
 * too: it turns "someone forgot to bump the installer" into a fail-closed build error forever.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
  version: string;
};

describe('installer default-version drift guard (always-on)', () => {
  it('install.sh DEFAULT_VERSION matches package.json version', () => {
    const sh = readFileSync(join(repoRoot, 'install.sh'), 'utf-8');
    const m = sh.match(/DEFAULT_VERSION='([^']+)'/);
    expect(m?.[1]).toBe(pkg.version);
  });

  it('install.ps1 default $Version matches package.json version', () => {
    const ps1 = readFileSync(join(repoRoot, 'install.ps1'), 'utf-8');
    // param(... [string]$Version = $(if ($env:DBGRAPH_VERSION) {...} else { '1.1.0' }) ...)
    const m = ps1.match(
      /\$Version\s*=\s*\$\(if \(\$env:DBGRAPH_VERSION\).*?else \{\s*'([^']+)'\s*\}/s,
    );
    expect(m?.[1]).toBe(pkg.version);
  });
});
