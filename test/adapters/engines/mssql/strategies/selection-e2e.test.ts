/**
 * selection-e2e.test.ts — Strategy selection end-to-end flow (mocked, no Docker).
 *
 * Spec connectivity "First viable strategy wins".
 * Spec mssql-extraction "integrated auth mode selects an external-tool strategy".
 * connectivity-strategies Batch F, task F6.3.
 *
 * Scenario 1 (happy path — integrated, sqlcmd wins):
 *   integrated config → NativeTedious.detect() returns unavailable (skipped) →
 *   SqlcmdStrategy.detect() + canConnect() succeed (mocked spawnSync) →
 *   runCatalog() returns data from the golden dump fixture →
 *   normalizeCatalog → SqliteGraphStore.upsertGraph → getNodesByKind('table') →
 *   asserts actual object qnames (L-009 — app.accounts, app.sessions).
 *
 * Scenario 2 (exhaustion — sqlcmd unavailable + no dump):
 *   integrated config → native skipped → sqlcmd unavailable → manual-dump
 *   unavailable → consented-install skipped → StrategyExhaustionError thrown →
 *   formatExhaustionError output presents BOTH fallback options (manual-dump path
 *   + guided install) and deferred-B2 notice.
 *
 * Uses the existing in-process patterns:
 *   - SpawnSyncFn injection seam in SqlcmdStrategy (no global child_process mock)
 *   - createMssqlSchemaAdapter deps overrides (NativeTedious, Sqlcmd, ManualDump,
 *     ConsentedInstall)
 *   - createSqliteGraphStore(':memory:') for a real in-memory persistence layer
 *
 * NO Docker required — all network calls are mocked.
 * TDD: RED → GREEN (F6.3).
 */

import { describe, it, expect } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { createMssqlSchemaAdapter, type MssqlSchemaAdapterDeps } from '../../../../../src/adapters/engines/mssql/factory.js';
import { SqlcmdStrategy, type SpawnSyncFn } from '../../../../../src/adapters/engines/mssql/strategies/sqlcmd.strategy.js';
import type { ConnectivityStrategy, DetectResult } from '../../../../../src/core/ports/connectivity-strategy.js';
import type { MssqlAdapterConfig } from '../../../../../src/core/ports/schema-adapter.js';
import { ConnectivityUnavailableError } from '../../../../../src/core/errors.js';
import { createSqliteGraphStore } from '../../../../../src/adapters/storage/sqlite/factory.js';
import { normalizeCatalog } from '../../../../../src/core/normalize/normalize.js';
import { formatExhaustionError } from '../../../../../src/cli/format/exhaustion.js';
import { DEFAULT_LEVELS } from '../../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../../src/core/model/capability.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Makes a minimal SpawnSyncReturns<Buffer> result. */
function makeSpawnResult(
  overrides: Partial<Omit<SpawnSyncReturns<Buffer>, 'error'>> & { error?: Error } = {},
): SpawnSyncReturns<Buffer> {
  const base: SpawnSyncReturns<Buffer> = {
    pid: 1,
    output: [],
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    status: 0,
    signal: null,
    ...overrides,
  };
  if (overrides.error !== undefined) {
    base.error = overrides.error;
  }
  return base;
}

/** Minimal always-unavailable stub that satisfies ConnectivityStrategy. */
function makeUnavailableStub(strategyId: string): new (config: MssqlAdapterConfig) => ConnectivityStrategy {
  return class Stub implements ConnectivityStrategy {
    readonly id = strategyId;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_config: MssqlAdapterConfig) {}
    async detect(): Promise<DetectResult> {
      return { available: false, detail: `${strategyId} unavailable (test stub)` };
    }
    async canConnect(): Promise<boolean> { return false; }
    async runCatalog(): Promise<never> {
      throw new Error(`${strategyId}: runCatalog called on unavailable stub`);
    }
    async close(): Promise<void> {}
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden data — mirrors the mssql-dump-golden.json fixture rows as FOR-JSON
// output that sqlcmd would produce (each family is a JSON array).
// These are the minimal fields required to produce a valid RawCatalog with
// the app.accounts + app.sessions schema objects.
// ─────────────────────────────────────────────────────────────────────────────

const GOLDEN_TABLES = JSON.stringify([
  { schema_name: 'app', table_name: 'accounts', object_id: 101 },
  { schema_name: 'app', table_name: 'sessions', object_id: 102 },
]);

const GOLDEN_COLUMNS = JSON.stringify([
  {
    schema_name: 'app', table_name: 'accounts', column_id: 1,
    column_name: 'account_id', data_type: 'int', max_length: 4,
    precision: 10, scale: 0, is_nullable: 0, is_computed: 0,
    computed_definition: null, default_definition: null,
  },
  {
    schema_name: 'app', table_name: 'accounts', column_id: 2,
    column_name: 'username', data_type: 'nvarchar', max_length: 100,
    precision: 0, scale: 0, is_nullable: 0, is_computed: 0,
    computed_definition: null, default_definition: null,
  },
  {
    schema_name: 'app', table_name: 'sessions', column_id: 1,
    column_name: 'session_id', data_type: 'uniqueidentifier', max_length: 16,
    precision: 0, scale: 0, is_nullable: 0, is_computed: 0,
    computed_definition: null, default_definition: '(newid())',
  },
  {
    schema_name: 'app', table_name: 'sessions', column_id: 2,
    column_name: 'account_id', data_type: 'int', max_length: 4,
    precision: 10, scale: 0, is_nullable: 0, is_computed: 0,
    computed_definition: null, default_definition: null,
  },
]);

const EMPTY_JSON = JSON.stringify([]);

/**
 * Builds a mocked SpawnSyncFn for SqlcmdStrategy that:
 *   - Returns status: 0 + WHERE-found stdout for the first call (detect → available).
 *   - Returns status: 0 for the second call (canConnect → true).
 *   - Returns golden catalog JSON for each of the 11 catalog families (runCatalog).
 */
function makeSqlcmdSpawnSync(): SpawnSyncFn {
  // Order of calls inside SqlcmdStrategy when used in the full E2E flow:
  //   Call 1: detect() → where/which sqlcmd
  //   Call 2: canConnect() → sqlcmd -E -S ... SELECT 1
  //   Calls 3–13: runCatalog → 11 catalog families (tables, columns, …, dependencies)
  const catalogResponses = [
    GOLDEN_TABLES,    // tables
    GOLDEN_COLUMNS,   // columns
    EMPTY_JSON,       // keyConstraints
    EMPTY_JSON,       // foreignKeys
    EMPTY_JSON,       // checkConstraints
    EMPTY_JSON,       // indexes
    EMPTY_JSON,       // modules
    EMPTY_JSON,       // triggerEvents
    EMPTY_JSON,       // sequences
    EMPTY_JSON,       // extendedProperties
    EMPTY_JSON,       // dependencies
  ];

  let callIdx = 0;

  // Parameters are intentionally unused — the mock drives behavior purely by call index.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mockFn: SpawnSyncFn = (_cmd, _argv, _opts): SpawnSyncReturns<Buffer> => {
    const idx = callIdx;
    callIdx += 1;

    if (idx === 0) {
      // detect(): where/which sqlcmd exits 0 — tool is available
      return makeSpawnResult({ status: 0, stdout: Buffer.from('sqlcmd\n') });
    }

    if (idx === 1) {
      // canConnect(): SELECT 1 exits 0 — connection succeeded
      return makeSpawnResult({ status: 0, stdout: Buffer.from('1\n') });
    }

    // runCatalog(): return the golden catalog family at the appropriate offset
    const catalogIdx = idx - 2; // offset by 2 (detect + canConnect)
    const jsonStr = catalogResponses[catalogIdx] ?? EMPTY_JSON;
    return makeSpawnResult({ status: 0, stdout: Buffer.from(jsonStr) });
  };

  return mockFn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: happy path — integrated config, sqlcmd wins, full pipeline
// ─────────────────────────────────────────────────────────────────────────────

const INTEGRATED_CONFIG: MssqlAdapterConfig = {
  server: 'CORPSERVER',
  database: 'AppDb',
  authentication: { type: 'integrated' },
};

const FULL_SCOPE: ExtractionScope = { levels: DEFAULT_LEVELS };

// ─────────────────────────────────────────────────────────────────────────────
// Typed stub helpers — MssqlSchemaAdapterDeps fields use exactOptionalPropertyTypes
// ─────────────────────────────────────────────────────────────────────────────

type NativeTediousCtor = NonNullable<MssqlSchemaAdapterDeps['NativeTedious']>;
type SqlcmdCtor = NonNullable<MssqlSchemaAdapterDeps['Sqlcmd']>;
type ManualDumpCtor = NonNullable<MssqlSchemaAdapterDeps['ManualDump']>;
type ConsentedInstallCtor = NonNullable<MssqlSchemaAdapterDeps['ConsentedInstall']>;

const NativeTediousStub = makeUnavailableStub('native-tedious') as NativeTediousCtor;
const ManualDumpStub = makeUnavailableStub('manual-dump') as ManualDumpCtor;
const ConsentedInstallStub = makeUnavailableStub('consented-install') as ConsentedInstallCtor;
const SqlcmdStub = makeUnavailableStub('sqlcmd') as SqlcmdCtor;

/** Builds a SqlcmdStrategy class that uses the mocked spawnSync (fresh per call). */
function buildMockedSqlcmdClass(): SqlcmdCtor {
  return class MockedSqlcmd extends SqlcmdStrategy {
    constructor(config: MssqlAdapterConfig) {
      super(config, makeSqlcmdSpawnSync());
    }
  } as SqlcmdCtor;
}

describe('selection E2E — integrated config, sqlcmd wins (F6.3 scenario 1)', () => {
  it('createMssqlSchemaAdapter returns a SchemaAdapter when sqlcmd is the winner', async () => {
    // NativeTedious is omitted for integrated (by buildMssqlStrategies logic).
    // We inject a SqlcmdStrategy with a fully mocked spawnSync so no real
    // child_process calls are made.
    const adapter = await createMssqlSchemaAdapter(INTEGRATED_CONFIG, {
      NativeTedious: NativeTediousStub,
      Sqlcmd: buildMockedSqlcmdClass(),
      ManualDump: ManualDumpStub,
      ConsentedInstall: ConsentedInstallStub,
    });

    expect(adapter.dialect).toBe('mssql');
    await adapter.close();
  });

  it('extract() returns a RawCatalog with engine mssql and two table objects', async () => {
    const adapter = await createMssqlSchemaAdapter(INTEGRATED_CONFIG, {
      NativeTedious: NativeTediousStub,
      Sqlcmd: buildMockedSqlcmdClass(),
      ManualDump: ManualDumpStub,
      ConsentedInstall: ConsentedInstallStub,
    });

    const rawCatalog = await adapter.extract(FULL_SCOPE);

    expect(rawCatalog.engine).toBe('mssql');
    const tableObjects = rawCatalog.objects.filter((o) => o.kind === 'table');
    expect(tableObjects.length).toBeGreaterThanOrEqual(2);

    await adapter.close();
  });

  it('normalizeCatalog produces graph nodes for app.accounts and app.sessions (L-009)', async () => {
    const adapter = await createMssqlSchemaAdapter(INTEGRATED_CONFIG, {
      NativeTedious: NativeTediousStub,
      Sqlcmd: buildMockedSqlcmdClass(),
      ManualDump: ManualDumpStub,
      ConsentedInstall: ConsentedInstallStub,
    });

    const rawCatalog = await adapter.extract(FULL_SCOPE);
    const normResult = normalizeCatalog(rawCatalog, FULL_SCOPE);

    const tableQNames = normResult.graph.nodes
      .filter((n) => n.kind === 'table')
      .map((n) => n.qname);

    expect(tableQNames).toContain('app.accounts');
    expect(tableQNames).toContain('app.sessions');

    await adapter.close();
  });

  it('SqliteGraphStore upsertGraph persists the catalog; getNodesByKind returns app.accounts + app.sessions', async () => {
    const adapter = await createMssqlSchemaAdapter(INTEGRATED_CONFIG, {
      NativeTedious: NativeTediousStub,
      Sqlcmd: buildMockedSqlcmdClass(),
      ManualDump: ManualDumpStub,
      ConsentedInstall: ConsentedInstallStub,
    });

    const rawCatalog = await adapter.extract(FULL_SCOPE);
    const normResult = normalizeCatalog(rawCatalog, FULL_SCOPE);

    // Persist to an in-memory SQLite store (no filesystem I/O)
    const store = await createSqliteGraphStore({ path: ':memory:' });
    await store.upsertGraph(normResult.graph);

    const tableNodes = await store.getNodesByKind('table');
    const tableQNames = tableNodes.map((n) => n.qname);

    expect(tableQNames).toContain('app.accounts');
    expect(tableQNames).toContain('app.sessions');

    await adapter.close();
    await store.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: exhaustion — sqlcmd unavailable + no dump file
// ─────────────────────────────────────────────────────────────────────────────

describe('selection E2E — exhaustion path (F6.3 scenario 2 → Batch 3 ConnectivityUnavailableError)', () => {
  it('throws ConnectivityUnavailableError when sqlcmd unavailable and no dump file (Batch 3)', async () => {
    // All strategies report unavailable — factory must throw ConnectivityUnavailableError.
    await expect(
      createMssqlSchemaAdapter(INTEGRATED_CONFIG, {
        NativeTedious: NativeTediousStub,
        Sqlcmd: SqlcmdStub,
        ManualDump: ManualDumpStub,
        ConsentedInstall: ConsentedInstallStub,
      }),
    ).rejects.toBeInstanceOf(ConnectivityUnavailableError);
  });

  it('ConnectivityUnavailableError.outcome.attempts lists sqlcmd and manual-dump (Batch 3)', async () => {
    const err = await createMssqlSchemaAdapter(INTEGRATED_CONFIG, {
      NativeTedious: NativeTediousStub,
      Sqlcmd: SqlcmdStub,
      ManualDump: ManualDumpStub,
      ConsentedInstall: ConsentedInstallStub,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectivityUnavailableError);
    const ex = err as ConnectivityUnavailableError;
    const attemptIds = ex.outcome.attempts.map((a) => a.id);
    expect(attemptIds).toContain('sqlcmd');
    expect(attemptIds).toContain('manual-dump');
  });

  it('formatExhaustionError (shim) output contains fallback options (manual-dump path + guided install — Batch 3)', async () => {
    // formatExhaustionError is now a shim that delegates to formatOutcome.
    // ConnectivityUnavailableError carries a StrategyExhaustionError-compatible
    // attempts list, but formatExhaustionError takes StrategyExhaustionError.
    // The shim is tested directly — we build a StrategyExhaustionError from the attempts.
    const { StrategyExhaustionError } = await import('../../../../../src/core/errors.js');
    const err = await createMssqlSchemaAdapter(INTEGRATED_CONFIG, {
      NativeTedious: NativeTediousStub,
      Sqlcmd: SqlcmdStub,
      ManualDump: ManualDumpStub,
      ConsentedInstall: ConsentedInstallStub,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectivityUnavailableError);
    const ex = err as ConnectivityUnavailableError;

    // Build a StrategyExhaustionError from the outcome's attempts to test the shim
    const shimInput = new StrategyExhaustionError(ex.outcome.attempts);
    const message = formatExhaustionError(shimInput);

    // The shim now delegates to formatOutcome — verify ≥3 options rendered
    expect(message).toContain('CONNECTIVITY UNAVAILABLE');
    expect(message).toContain('.dbgraph/dumps');
    expect(message).toContain('mssql-dump.json');
    expect(message).toContain('microsoft.com');
    expect(message).toContain('Option 1');
    expect(message).toContain('Option 2');
    expect(message).toContain('Option 3');
  });

  it('formatExhaustionError (shim) output includes strategy attempt ids (Batch 3)', async () => {
    const { StrategyExhaustionError } = await import('../../../../../src/core/errors.js');
    const err = await createMssqlSchemaAdapter(INTEGRATED_CONFIG, {
      NativeTedious: NativeTediousStub,
      Sqlcmd: SqlcmdStub,
      ManualDump: ManualDumpStub,
      ConsentedInstall: ConsentedInstallStub,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectivityUnavailableError);
    const ex = err as ConnectivityUnavailableError;

    const shimInput = new StrategyExhaustionError(ex.outcome.attempts);
    const message = formatExhaustionError(shimInput);

    // The formatted message should mention the strategies in the attempts section
    expect(message).toContain('sqlcmd');
  });
});
