/**
 * MongoDB error mapper.
 * Maps a caught error from a mongodb MongoClient connect or operation call to a
 * typed ConnectionError, PermissionError, or ConnectivityUnavailableError per
 * the design error-mapping table.
 *
 * Design §error-mapper.ts (Decision §2):
 *   code 18 / codeName AuthenticationFailed → ConnectionError (auth: check URI credentials)
 *   code 13 / codeName Unauthorized         → PermissionError (names privilege + docs/permissions/mongodb.md)
 *   MongoServerSelectionError name           → ConnectionError (verify URI host + reachability)
 *   ECONNREFUSED / ETIMEDOUT / ENOTFOUND     → ConnectionError (network unreachable)
 *   MODULE_NOT_FOUND                         → ConnectivityUnavailableError (npm i mongodb)
 *   else                                     → ConnectionError (actionable fallback)
 *
 * Content-free summaries (NO host/URI in message); raw cause on error.cause only.
 *
 * This function is PURE: same input -> same output, no side effects.
 * NO top-level mongodb import (ADR-006). Reads only err.code / err.codeName / err.name.
 *
 * US-030 (MongoDB adapter), US-033 (actionable PermissionError),
 * mongodb-extraction spec "Authentication failure raises an actionable ConnectionError",
 * mongodb-extraction spec "Missing privilege yields a typed actionable PermissionError".
 */

import { ConnectionError, PermissionError, ConnectivityUnavailableError } from '../../../core/errors.js';
import { buildConnectivityOutcome } from '../_shared/connectivity-outcome.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MONGODB_NPM_DOC_URL = 'https://www.npmjs.com/package/mongodb';
const MONGODB_DUMP_PATH = '.dbgraph/dumps/mongodb-dump.json';

/** Read-only queries surfaced in the run-it-yourself connectivity option. */
const MONGODB_READ_COMMANDS: readonly string[] = [
  'db.runCommand({ listCollections: 1 })',
  'db.getCollectionNames().forEach(c => { db[c].aggregate([{ $sample: { size: 100 } }]) })',
  'db.getCollectionNames().forEach(c => { db[c].getIndexes() })',
  'db.runCommand({ dbStats: 1 })',
];

function buildMongodbConnectivityOutcome(summary: string): ConnectivityUnavailableError {
  const outcome = buildConnectivityOutcome({
    engine: 'mongodb',
    summary,
    attempts: [],
    runItYourselfQueries: MONGODB_READ_COMMANDS,
    installTool: 'mongodb',
    installDocUrl: MONGODB_NPM_DOC_URL,
    dumpPath: MONGODB_DUMP_PATH,
  });
  return new ConnectivityUnavailableError(outcome);
}

// ─────────────────────────────────────────────────────────────────────────────
// Error shape helpers
// ─────────────────────────────────────────────────────────────────────────────

function getNumericCode(err: unknown): number | undefined {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return typeof e['code'] === 'number' ? e['code'] : undefined;
  }
  return undefined;
}

function getStringCode(err: unknown): string {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return typeof e['code'] === 'string' ? e['code'] : '';
  }
  return '';
}

function getErrorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// mapMongoError — pure function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps any caught error from mongodb to a typed error.
 * Never re-throws — always returns a typed error.
 *
 * @param cause - The raw error caught from client.connect() or any driver operation.
 */
export function mapMongoError(
  cause: unknown,
): ConnectionError | PermissionError | ConnectivityUnavailableError {
  const numericCode = getNumericCode(cause);
  const stringCode = getStringCode(cause);
  const errorName = getErrorName(cause);

  // ── MODULE_NOT_FOUND — missing mongodb driver ─────────────────────────────
  // This must be checked first as it produces a ConnectivityUnavailableError.
  if (stringCode === 'MODULE_NOT_FOUND') {
    return buildMongodbConnectivityOutcome(
      "Required driver 'mongodb' is not installed. Run: npm i mongodb",
    );
  }

  // ── Authentication failure (code 18 / AuthenticationFailed) ───────────────
  // MongoServerError with code 18: authentication credentials are wrong.
  // Map to ConnectionError (auth failure — fix the URI credentials).
  if (numericCode === 18) {
    return new ConnectionError(
      'MongoDB authentication failed. Check the credentials in the URI (MongodbAdapterConfig).',
      cause,
    );
  }

  // ── Unauthorized / insufficient role (code 13 / Unauthorized) ─────────────
  // MongoServerError with code 13: the role lacks the required privilege.
  // Map to PermissionError naming the needed privileges + docs link (US-033).
  if (numericCode === 13) {
    return new PermissionError(
      'MongoDB permission denied. The role lacks required privileges (listCollections, find, listIndexes, dbStats). ' +
        'Grant the read role on the target database. ' +
        'See docs/permissions/mongodb.md for the minimal read-only role.',
      cause,
    );
  }

  // ── Server selection timeout / bad host ───────────────────────────────────
  // MongoServerSelectionError: host not reachable, connection timed out, or
  // the URI specifies a host that cannot be reached at all.
  if (errorName === 'MongoServerSelectionError') {
    return new ConnectionError(
      'MongoDB server selection failed. Verify the URI host and port are reachable (MongodbAdapterConfig).',
      cause,
    );
  }

  // ── Network-level system errors ───────────────────────────────────────────
  // ECONNREFUSED, ETIMEDOUT, ENOTFOUND — OS-level errors meaning the host is
  // unreachable or the connection was refused.
  if (
    stringCode === 'ECONNREFUSED' ||
    stringCode === 'ETIMEDOUT' ||
    stringCode === 'ENOTFOUND'
  ) {
    return new ConnectionError(
      'MongoDB connection failed: host or port unreachable. ' +
        'Verify the URI host and port in MongodbAdapterConfig.',
      cause,
    );
  }

  // ── Generic fallback — actionable, content-free ───────────────────────────
  return new ConnectionError(
    'MongoDB connection error. Verify the URI and database in MongodbAdapterConfig.',
    cause,
  );
}
