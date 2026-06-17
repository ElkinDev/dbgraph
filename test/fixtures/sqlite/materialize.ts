/**
 * materializeTorture() — writes torture.sql into a temp on-disk SQLite database.
 * Returns the path to the materialized file and a cleanup() function to unlink it.
 *
 * Design §testing "Torture fixture": materialize into os.tmpdir(), open WRITABLE,
 * exec the DDL, close; adapter tests then open it READ-ONLY.
 * :memory: is NOT used because the parity test must compare two INDEPENDENT
 * driver opens of the SAME on-disk bytes.
 */

import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TORTURE_SQL_PATH = join(__dirname, 'torture.sql');

export interface MaterializedDb {
  /** Absolute path to the materialized temp database file. */
  readonly path: string;
  /** Unlinks the temp file. Safe to call even if the file is already gone. */
  cleanup(): void;
}

/**
 * Creates a fresh on-disk SQLite database by executing torture.sql.
 * Each call produces a uniquely named temp file so parallel tests are safe.
 */
export function materializeTorture(): MaterializedDb {
  const path = join(tmpdir(), `dbgraph-torture-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

  const sql = readFileSync(TORTURE_SQL_PATH, 'utf-8');

  const db = new Database(path);
  db.exec(sql);
  db.close();

  return {
    path,
    cleanup(): void {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    },
  };
}
