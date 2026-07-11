/**
 * NativeTediousStrategy — ConnectivityStrategy wrapping the existing
 * lazy import('mssql') / pool / mapMssqlError path from factory.ts.
 *
 * Design §"native-tedious strategy wraps the existing factory".
 *
 *   detect()      → { available: authentication.type !== 'integrated' }
 *                   (tedious cannot do Windows Integrated Security, ADR-006)
 *   canConnect()  → lazy import('mssql') + pool.connect() probe
 *   runCatalog()  → createMssqlReadonlyDriver + MssqlSchemaAdapter.extract() UNCHANGED
 *   close()       → pool.close() (idempotent)
 *
 * The factory logic (pool creation, error mapping) is preserved exactly here
 * so Batch C can rewrite factory.ts to become the registry selector without
 * changing behavior for explicit-credential configs.
 *
 * connectivity-strategies Batch B, task B2.1.
 */

import { ConnectionError } from '../../../../core/errors.js';
import type { ConnectivityStrategy, DetectResult } from '../../../../core/ports/connectivity-strategy.js';
import type { RawCatalog } from '../../../../core/model/catalog.js';
import type { ExtractionScope } from '../../../../core/model/capability.js';
import type { MssqlAdapterConfig } from '../../../../core/ports/schema-adapter.js';
import { createMssqlReadonlyDriver } from '../driver.js';
import { mapMssqlError } from '../error-mapper.js';
import { MssqlSchemaAdapter } from '../mssql-schema-adapter.js';
import { loadOptionalDriver } from '../../_shared/load-optional-driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Duck-typed pool interface (matches factory.ts pattern — no top-level mssql import)
// ─────────────────────────────────────────────────────────────────────────────

interface MssqlPool {
  connect(): Promise<this>;
  request(): {
    query(sql: string): Promise<{ recordset: Record<string, unknown>[] }>;
  };
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// NativeTediousStrategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injectable deps for {@link NativeTediousStrategy}. All optional — omit entirely
 * for production use.
 *
 * - `importModule` — inject a fake dynamic import so the interop resolution and the
 *   MODULE_NOT_FOUND path are unit-testable without a real mssql install. Routed
 *   through loadOptionalDriver's import seam, mirroring the pg/mysql2/mongodb
 *   factories (ADR-006).
 */
export interface NativeTediousStrategyDeps {
  readonly importModule?: (name: string) => unknown | Promise<unknown>;
}

/**
 * Wraps the existing mssql/tedious connection pool logic behind the
 * ConnectivityStrategy port.
 *
 * Skipped automatically by the registry when authentication.type === 'integrated'
 * because tedious cannot perform Windows Integrated Security (ADR-006).
 */
export class NativeTediousStrategy implements ConnectivityStrategy {
  readonly id = 'native-tedious';

  private _pool: MssqlPool | null = null;
  private _adapter: MssqlSchemaAdapter | null = null;

  constructor(
    private readonly _config: MssqlAdapterConfig,
    private readonly _deps: NativeTediousStrategyDeps = {},
  ) {}

  /**
   * Reports availability: tedious works only for explicit-credential configs.
   * Returns { available: false } for integrated auth (tedious cannot do SSPI).
   */
  async detect(): Promise<DetectResult> {
    if (this._config.authentication.type === 'integrated') {
      return { available: false, detail: 'tedious cannot perform Windows Integrated Security (ADR-006)' };
    }
    return { available: true };
  }

  /**
   * Attempts to connect via the mssql pool (lazy import + pool.connect()).
   * Returns false on connectivity failures (bad credentials, network, TLS).
   *
   * Re-throws ConnectionError for setup errors (missing driver package) because
   * those are not transient probe failures — they require user action (npm i mssql)
   * and should surface immediately rather than silently falling through to the next
   * strategy.
   */
  async canConnect(): Promise<boolean> {
    if (this._config.authentication.type === 'integrated') return false;
    try {
      await this._ensureConnected();
      return true;
    } catch (err) {
      // Missing driver is a setup error — re-throw so the caller sees it immediately.
      if (err instanceof ConnectionError && err.message.includes('npm i mssql')) {
        throw err;
      }
      return false;
    }
  }

  /**
   * Runs the full catalog extraction using MssqlSchemaAdapter.extract() UNCHANGED.
   * Reuses the already-connected pool from canConnect() if available.
   */
  async runCatalog(scope: ExtractionScope): Promise<RawCatalog> {
    await this._ensureConnected();
    const adapter = this._adapter;
    if (adapter === null) {
      throw new ConnectionError(
        'NativeTediousStrategy: adapter not initialized after _ensureConnected()',
      );
    }
    return adapter.extract(scope);
  }

  /**
   * Delegates fingerprint computation to MssqlSchemaAdapter.fingerprint().
   * Reuses the already-connected adapter (or connects first if needed).
   */
  async fingerprint(): Promise<string> {
    await this._ensureConnected();
    const adapter = this._adapter;
    if (adapter === null) {
      throw new ConnectionError(
        'NativeTediousStrategy: adapter not initialized after _ensureConnected()',
      );
    }
    return adapter.fingerprint();
  }

  /**
   * Releases the connection pool. Idempotent.
   */
  async close(): Promise<void> {
    if (this._adapter !== null) {
      await this._adapter.close();
      this._adapter = null;
    }
    this._pool = null;
  }

  // ─── Private: pool initialization ──────────────────────────────────────────

  private async _ensureConnected(): Promise<void> {
    if (this._adapter !== null) return; // already connected

    // Step 1: Lazy import mssql via the centralized optional-driver seam (design D7).
    // Off-SEA this is byte-identical to `await import('mssql')`; under SEA it resolves
    // via createRequire (CWD → NODE_PATH → global). ADR-006 — optional dependency.
    let mssqlMod: unknown;
    try {
      mssqlMod = await loadOptionalDriver(
        'mssql',
        this._deps.importModule !== undefined ? { importModule: this._deps.importModule } : {},
      );
    } catch (cause) {
      throw new ConnectionError(
        "Required driver 'mssql' is not installed. Run: npm i mssql",
        cause,
      );
    }

    // Step 2: Resolve ConnectionPool INTEROP-SAFELY (design §"Fix interop at the mssql
    // call site"). The SHIPPED artifact is a bundled CJS dist: `await import('mssql')`
    // resolves under Node's CJS→ESM interop, which exposes the CommonJS module ONLY under
    // `.default`. A raw `const { ConnectionPool } = mssqlMod` yields undefined → a
    // `new undefined()` crash. Read from the namespace OR `.default`, matching the
    // pg/mysql2/mongodb factories (ADR-006).
    const mod = mssqlMod as Record<string, unknown>;
    const ConnectionPool =
      (mod['ConnectionPool'] as (new (cfg: unknown) => MssqlPool) | undefined) ??
      ((mod['default'] as Record<string, unknown> | undefined)?.['ConnectionPool'] as
        | (new (cfg: unknown) => MssqlPool)
        | undefined);
    if (ConnectionPool === undefined) {
      throw new ConnectionError(
        "Failed to load ConnectionPool from the 'mssql' module. Try: npm i mssql",
      );
    }

    // Step 3: Build pool config
    const poolConfig = this._buildPoolConfig();

    // Step 4: Connect the pool, map errors
    let pool: MssqlPool;
    try {
      const instance = new ConnectionPool(poolConfig);
      pool = await instance.connect();
    } catch (cause) {
      throw mapMssqlError(cause);
    }

    // Step 4: Wrap in driver + adapter
    this._pool = pool;
    const driver = createMssqlReadonlyDriver(pool);
    this._adapter = new MssqlSchemaAdapter(driver);
  }

  private _buildPoolConfig(): Record<string, unknown> {
    const auth = this._config.authentication;

    const baseConfig: Record<string, unknown> = {
      server: this._config.server,
      database: this._config.database,
      options: {
        ...(this._config.port !== undefined ? { port: this._config.port } : {}),
        ...(this._config.encrypt !== undefined ? { encrypt: this._config.encrypt } : { encrypt: true }),
        ...(this._config.trustServerCertificate !== undefined
          ? { trustServerCertificate: this._config.trustServerCertificate }
          : {}),
      },
    };

    if (auth.type === 'sql') {
      baseConfig['user'] = auth.user;
      baseConfig['password'] = auth.password;
    } else if (auth.type === 'ntlm') {
      baseConfig['domain'] = auth.domain;
      baseConfig['user'] = auth.user;
      baseConfig['password'] = auth.password;
    }
    // integrated: no credentials — handled by detect() returning available: false

    return baseConfig;
  }
}
