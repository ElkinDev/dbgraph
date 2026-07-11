/**
 * Dist-level live-connect integration test — Batch 2 (shipped-artifact-fixes, Phase 3).
 *
 * WHY THIS TIER EXISTS (the masking-class closer):
 *   The interop defect fixed in Batch 1 (a raw `const { ConnectionPool } = await import('mssql')`
 *   that yields `undefined` → `new undefined()` in the SHIPPED bundled-CJS dist) was INVISIBLE to
 *   every existing suite. vitest loads `src` through its own module runner, which LIFTS a CommonJS
 *   package's named exports onto the ESM namespace top level — so `import('mssql')` under vitest
 *   exposes `ConnectionPool` directly and the raw destructure "works". Only Node's REAL CJS→ESM
 *   interop on the BUILT artifact reproduces the crash (the CJS module lands ONLY under `.default`).
 *
 *   This test therefore does NOT import `src`. It spawns a FRESH `node` child (process.execPath)
 *   with ZERO vitest involvement, `require()`s the BUILT `dist/index.cjs`, and drives
 *   `createMssqlSchemaAdapter` against a live SQL Server container. This is the only place Node's
 *   real interop is on the connection path — the highest-fidelity mechanism (design §"Dist-Level
 *   Test Mechanism", spawn option (a)). The unit RED (task 2.2) is its Docker-free proxy.
 *
 * DOUBLE GATE (self-skips cleanly so `npm test` stays CI-independent):
 *   - DBGRAPH_INTEGRATION=1 (Docker present) AND
 *   - a built `dist/index.cjs` exists (`dist/` is gitignored, not committed).
 *   With either absent the suite is SKIPPED — never failing — and the default `npm test` floor of
 *   3731 tests (incl. 4 skipped) holds. This file carries the `*.integration.test.ts` suffix, so
 *   `npm test` (vitest.config.ts) excludes it entirely; it runs only via `npm run test:integration`.
 *
 * Per-suite hookTimeout: 240 000 ms — SQL Server cold start + first image pull can take minutes.
 *
 * Spec: mssql-extraction "Live SQL Server connectivity is verified against the bundled dist, not
 * vitest-loaded src" (US-027). ADR-006 (lazy optional import), ADR-008 (deterministic catalog).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  startMssqlContainer,
  mssqlIntegrationEnabled,
} from '../../../fixtures/mssql/container.js';
import type { MssqlContainerHandle } from '../../../fixtures/mssql/container.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// test/adapters/engines/mssql/ → up 4 = repo root → dist/index.cjs (the SHIPPED barrel).
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DIST_ENTRY = join(REPO_ROOT, 'dist', 'index.cjs');
const DIST_BUILT = existsSync(DIST_ENTRY);

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 AND a built dist/index.cjs are required — dist-level live-connect test ' +
  'skipped. Run: npm run build && DBGRAPH_INTEGRATION=1 npm run test:integration';

/**
 * Result contract the spawned child writes to DBGRAPH_RESULT_FILE.
 * A temp FILE (not stdout) is used so no driver log line can corrupt the payload.
 */
interface ChildResult {
  readonly ok: boolean;
  readonly engine?: string;
  readonly schemas?: readonly string[];
  readonly objectCount?: number;
  readonly name?: string;
  readonly error?: string;
}

// The child runs OUTSIDE vitest, under `node -e`. It requires the built CJS barrel and exercises
// the real interop path. DEFAULT_LEVELS is inlined (the barrel exports only the *type*, not the
// runtime constant) so the child stays self-contained. Result → temp file, never stdout.
const CHILD_SCRIPT = `
const fs = require('node:fs');
const distEntry = process.env.DBGRAPH_DIST_ENTRY;
const resultFile = process.env.DBGRAPH_RESULT_FILE;
const config = JSON.parse(process.env.DBGRAPH_MSSQL_CONFIG);
const DEFAULT_LEVELS = {
  tables: 'full', columns: 'full', constraints: 'full', indexes: 'full', views: 'full',
  procedures: 'metadata', functions: 'metadata', triggers: 'full', sequences: 'metadata',
  collections: 'metadata', fields: 'metadata', statistics: 'off', sampling: 'off',
};
function emit(obj) { fs.writeFileSync(resultFile, JSON.stringify(obj)); }
(async () => {
  try {
    const mod = require(distEntry);
    if (typeof mod.createMssqlSchemaAdapter !== 'function') {
      throw new Error('dist barrel does not export createMssqlSchemaAdapter');
    }
    const adapter = await mod.createMssqlSchemaAdapter(config);
    const catalog = await adapter.extract({ levels: DEFAULT_LEVELS });
    await adapter.close();
    emit({
      ok: true,
      engine: catalog.engine,
      schemas: catalog.schemas,
      objectCount: Array.isArray(catalog.objects) ? catalog.objects.length : 0,
    });
    process.exit(0);
  } catch (err) {
    emit({ ok: false, name: err && err.name, error: (err && err.message) ? err.message : String(err) });
    process.exit(1);
  }
})();
`;

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

let handle: MssqlContainerHandle;

/**
 * Runs the BUILT dist through a fresh Node child and returns its parsed result.
 * A non-zero exit (the RED path) is EXPECTED to still leave a `{ ok: false, ... }`
 * payload in the result file, so the child's exit code is not asserted directly.
 */
async function runDistChild(config: MssqlContainerHandle['config']): Promise<ChildResult> {
  const outDir = mkdtempSync(join(tmpdir(), 'dbgraph-dist-connect-'));
  const outFile = join(outDir, 'result.json');
  try {
    try {
      await execFileAsync(process.execPath, ['-e', CHILD_SCRIPT], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DBGRAPH_DIST_ENTRY: DIST_ENTRY,
          DBGRAPH_RESULT_FILE: outFile,
          DBGRAPH_MSSQL_CONFIG: JSON.stringify(config),
        },
        timeout: 120_000,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      // A non-zero exit is the RED signal; the child still wrote its payload to the
      // result file before exiting. Read it below rather than trusting the exit code.
    }
    const raw = existsSync(outFile) ? readFileSync(outFile, 'utf-8') : '';
    if (raw.trim().length === 0) {
      return { ok: false, error: 'child produced no result file (spawn or require failed)' };
    }
    return JSON.parse(raw) as ChildResult;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gated suite
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!(mssqlIntegrationEnabled() && DIST_BUILT))(
  'MSSQL dist-level live connect — BUILT dist/index.cjs via real Node (masking-class closer, US-027)',
  () => {
    beforeAll(async () => {
      handle = await startMssqlContainer();
    }, 240_000);

    afterAll(async () => {
      if (handle !== undefined) await handle.stop();
    }, 60_000);

    it('bundled dist createMssqlSchemaAdapter connects live (SQL auth) and extracts a catalog — no new undefined()', async () => {
      const result = await runDistChild(handle.config);

      // GREEN: real Node interop resolved ConnectionPool (namespace ?? .default), the pool
      // connected to the live container, and a catalog was extracted. A pre-fix dist fails
      // here (ConnectionPool undefined → new undefined() → connectivity error, ok:false).
      expect(result.ok, `dist child did not connect/extract: ${JSON.stringify(result)}`).toBe(true);
      expect(result.engine).toBe('mssql');
      expect(result.schemas).toContain('dbo');
      expect(result.objectCount ?? 0).toBeGreaterThan(0);
    }, 120_000);
  },
);

// Placeholder keeps the file non-empty when the gate is off (vitest requires >= 1 test).
if (!(mssqlIntegrationEnabled() && DIST_BUILT)) {
  it.skip(SKIP_REASON, () => {});
}
