/**
 * manual-dump.strategy.ts — ConnectivityStrategy for offline manual dump ingest.
 *
 * This strategy is for air-gapped or no-tool environments where neither the
 * native tedious driver nor sqlcmd can connect directly. Instead, the operator
 * runs the emitted dump script (from dump-emitter.ts) against the SQL Server
 * instance themselves (via SSMS or sqlcmd -E) and saves the combined JSON output
 * to the gitignored .dbgraph/dumps/ directory.
 *
 * Strategy behaviour:
 *   detect()     — available if the configured dump file exists and is readable.
 *   canConnect() — true if the dump file is present and parses as valid JSON;
 *                  false if missing or unparseable (connection probe, no throw).
 *   runCatalog() — reads the combined JSON file, validates it via json-rows.ts,
 *                  feeds buildMssqlRawCatalog UNCHANGED, returns RawCatalog.
 *   close()      — no-op (no async resource to release).
 *
 * Dump file format (MssqlRowInput shape):
 *   {
 *     "tables": [...],
 *     "columns": [...],
 *     "keyConstraints": [...],
 *     "foreignKeys": [...],
 *     "checkConstraints": [...],
 *     "indexes": [...],
 *     "modules": [...],
 *     "triggerEvents": [...],
 *     "sequences": [...],
 *     "extendedProperties": [...],
 *     "dependencies": [...]
 *   }
 *
 * Security:
 *   - Issues NO write verb — read-only (reads a local file only).
 *   - The dump directory (.dbgraph/dumps/) is gitignored (R8).
 *   - No credential is ever passed or logged.
 *
 * Spec mssql-extraction "manual-dump strategy ingests one combined JSON offline".
 * connectivity-strategies Batch D, task D4.2.
 */

import { existsSync, readFileSync as defaultReadFileSync } from 'node:fs';
import type { ConnectivityStrategy, DetectResult } from '../../../../core/ports/connectivity-strategy.js';
import type { RawCatalog } from '../../../../core/model/catalog.js';
import type { ExtractionScope } from '../../../../core/model/capability.js';
import type { MssqlAdapterConfig } from '../../../../core/ports/schema-adapter.js';
import { buildMssqlRawCatalog } from '../map.js';
import { parseJsonRows, type RawJsonInput } from './json-rows.js';
import { DUMP_DIR, DUMP_FILE } from './dump-emitter.js';

// ─────────────────────────────────────────────────────────────────────────────
// ReadFileFn — injectable seam for node:fs.readFileSync (enables testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injectable read-file function seam.
 * In production this is node:fs.readFileSync.
 * Tests inject a mock that returns controlled content.
 */
export type ReadFileFn = (path: string, encoding: 'utf-8') => string;

// ─────────────────────────────────────────────────────────────────────────────
// Default dump path
// ─────────────────────────────────────────────────────────────────────────────

/** The default combined dump file path (relative to the project root). */
export const DEFAULT_DUMP_PATH = `${DUMP_DIR}/${DUMP_FILE}`;

// ─────────────────────────────────────────────────────────────────────────────
// ManualDumpStrategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a pre-produced combined JSON dump of the SQL Server catalog from a
 * gitignored local file, validates it via json-rows.ts, and feeds the
 * UNCHANGED buildMssqlRawCatalog to produce a RawCatalog.
 *
 * The dump file must have been produced by running the emitted script from
 * dump-emitter.ts against the target SQL Server instance.
 *
 * @param config   - MssqlAdapterConfig (used for identity; no live connection made).
 * @param dumpPath - Path to the combined JSON dump file (default: .dbgraph/dumps/mssql-dump.json).
 * @param readFile - Injectable readFileSync seam (default: node:fs.readFileSync).
 */
export class ManualDumpStrategy implements ConnectivityStrategy {
  readonly id = 'manual-dump';

  private readonly config: MssqlAdapterConfig;
  private readonly dumpPath: string;
  private readonly readFile: ReadFileFn;

  constructor(
    config: MssqlAdapterConfig,
    dumpPath: string = DEFAULT_DUMP_PATH,
    readFile: ReadFileFn = defaultReadFileSync,
  ) {
    this.config = config;
    this.dumpPath = dumpPath;
    this.readFile = readFile;
  }

  // ── detect() ───────────────────────────────────────────────────────────────

  /**
   * Returns available:true if the configured dump file exists and is readable.
   * Returns available:false with a detail message if the file is missing.
   *
   * Never throws — all errors are converted to { available: false, detail }.
   */
  async detect(): Promise<DetectResult> {
    try {
      if (!existsSync(this.dumpPath)) {
        return {
          available: false,
          detail: `manual-dump: dump file not found at ${this.dumpPath}. ` +
            `Run the emitted dump script and save the output to this path.`,
        };
      }
      return { available: true };
    } catch (e) {
      return {
        available: false,
        detail: `manual-dump: error checking dump file at ${this.dumpPath}: ${(e as Error).message}`,
      };
    }
  }

  // ── canConnect() ───────────────────────────────────────────────────────────

  /**
   * Returns true if the dump file exists AND parses as valid JSON.
   * Returns false if the file is missing, unreadable, or not valid JSON.
   * Never throws.
   */
  async canConnect(): Promise<boolean> {
    try {
      const content = this.readFile(this.dumpPath, 'utf-8');
      JSON.parse(content); // throws on invalid JSON
      return true;
    } catch {
      return false;
    }
  }

  // ── runCatalog() ───────────────────────────────────────────────────────────

  /**
   * Reads the combined JSON dump file, validates all 11 families via json-rows.ts,
   * and calls buildMssqlRawCatalog UNCHANGED.
   *
   * The dump must be a JSON object shaped as MssqlRowInput. BIT fields may be
   * 0/1 (as emitted by sqlcmd FOR JSON) or true/false — json-rows.ts normalises both.
   *
   * @throws Error if the file cannot be read, contains invalid JSON, or fails validation.
   */
  async runCatalog(scope: ExtractionScope): Promise<RawCatalog> {
    // ── Read ──────────────────────────────────────────────────────────────────
    let content: string;
    try {
      content = this.readFile(this.dumpPath, 'utf-8');
    } catch (e) {
      throw new Error(
        `manual-dump: failed to read dump file at ${this.dumpPath}: ${(e as Error).message}`,
        { cause: e },
      );
    }

    // ── Parse ─────────────────────────────────────────────────────────────────
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error(
        `manual-dump: failed to parse JSON from ${this.dumpPath}: ${(e as Error).message}`,
        { cause: e },
      );
    }

    // ── Validate the shape (must be an object with all 11 family keys) ────────
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `manual-dump: dump file must be a JSON object with 11 family keys (MssqlRowInput shape), ` +
        `but got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      );
    }

    const rawInput = parsed as Record<string, unknown>;

    // Validate all 11 families are present (json-rows will validate the rows themselves)
    const required = [
      'tables', 'columns', 'keyConstraints', 'foreignKeys', 'checkConstraints',
      'indexes', 'modules', 'triggerEvents', 'sequences', 'extendedProperties', 'dependencies',
    ] as const;

    for (const key of required) {
      if (!(key in rawInput)) {
        throw new Error(
          `manual-dump: dump file is missing required family "${key}". ` +
          `Ensure the file was produced from the complete emitted dump script.`,
        );
      }
    }

    // ── Validate/coerce all rows via the shared json-rows boundary ────────────
    const jsonInput: RawJsonInput = {
      tables:             rawInput['tables'],
      columns:            rawInput['columns'],
      keyConstraints:     rawInput['keyConstraints'],
      foreignKeys:        rawInput['foreignKeys'],
      checkConstraints:   rawInput['checkConstraints'],
      indexes:            rawInput['indexes'],
      modules:            rawInput['modules'],
      triggerEvents:      rawInput['triggerEvents'],
      sequences:          rawInput['sequences'],
      extendedProperties: rawInput['extendedProperties'],
      dependencies:       rawInput['dependencies'],
    };

    const rowInput = parseJsonRows(jsonInput);

    // ── Feed the UNCHANGED buildMssqlRawCatalog ───────────────────────────────
    return buildMssqlRawCatalog(rowInput, scope);
  }

  // ── close() ────────────────────────────────────────────────────────────────

  /**
   * No-op — manual-dump holds no async resources.
   */
  async close(): Promise<void> {
    // intentionally empty — no pool, no process, no handle to release
  }
}
