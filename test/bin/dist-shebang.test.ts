/**
 * dist-shebang regression guard — locks the tsup bin output to EXACTLY ONE shebang.
 *
 * The bug: tsup emitted the `dbgraph` / `dbgraph-mcp` bins with TWO `#!/usr/bin/env node`
 * lines — esbuild PRESERVES the source-file shebang, and a `banner: { js: '#!...' }` in
 * tsup.config.ts ADDED a second one. Node strips only the line-1 shebang, so line 2 was
 * parsed as JS → SyntaxError, and `node dist/cli.js` (and the npm-published bin) was DEAD.
 * The fix removed the redundant banner; this guard makes the regression impossible to ship
 * silently.
 *
 * D12 (CI-independence): the dist/ bundle is a BUILT ARTIFACT. This suite SKIPS cleanly
 * when dist/ is absent (the win-binary.smoke skip pattern), so `npm test` stays green with
 * NO build present. When a build IS present (local `npm run build`, or any CI job that
 * builds before testing), every assertion runs — including a real spawn of the bin.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', '..', 'dist');
const cliBin = join(distDir, 'cli.js');
const mcpBin = join(distDir, 'mcp.js');
const indexLib = join(distDir, 'index.js');

/** Both bins must exist for the guard to run; otherwise there is no artifact to check. */
const distBuilt = existsSync(cliBin) && existsSync(mcpBin);

const SHEBANG = '#!/usr/bin/env node';

/** Splits on LF after stripping CR, so the check is stable regardless of line endings. */
function lines(path: string): string[] {
  return readFileSync(path, 'utf-8').replace(/\r\n/g, '\n').split('\n');
}

describe.skipIf(!distBuilt)('dist bins carry exactly one shebang (build regression guard)', () => {
  for (const [name, path] of [
    ['cli.js', cliBin],
    ['mcp.js', mcpBin],
  ] as const) {
    it(`${name} has the shebang on line 1 and nowhere else`, () => {
      const ls = lines(path);
      expect(ls[0]).toBe(SHEBANG);
      // The second line must NOT be a duplicate shebang (the exact bug we are guarding).
      expect(ls[1]).not.toBe(SHEBANG);
      // And there is exactly ONE shebang line in the whole file.
      expect(ls.filter((l) => l === SHEBANG)).toHaveLength(1);
    });
  }

  it('the library entry (index.js) has NO shebang — it is not an executable', () => {
    // Guarded on presence: index.js is always emitted alongside the bins, but stay defensive.
    if (!existsSync(indexLib)) return;
    expect(lines(indexLib).filter((l) => l === SHEBANG)).toHaveLength(0);
  });

  it('node dist/cli.js --version prints 1.1.0 and exits 0 (bin actually runs)', () => {
    const r = spawnSync(process.execPath, [cliBin, '--version'], { encoding: 'utf-8' });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout.trim()).toBe('1.1.0');
    // A returned double-shebang would surface here as a parse-time SyntaxError.
    expect(r.stderr).not.toMatch(/SyntaxError/);
  });

  it('node dist/cli.js --help prints the usage banner and exits 0', () => {
    const r = spawnSync(process.execPath, [cliBin, '--help'], { encoding: 'utf-8' });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('dbgraph — database schema graph indexer');
  });

  it('node --check dist/mcp.js parses without a SyntaxError (mcp bin boots)', () => {
    const r = spawnSync(process.execPath, ['--check', mcpBin], { encoding: 'utf-8' });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stderr).not.toMatch(/SyntaxError/);
  });
});
