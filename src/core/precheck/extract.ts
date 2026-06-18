/**
 * extractIdentifiers — task 4.3 / Batch D (phase-5-mcp-server).
 * Spec: dbgraph_precheck extractor unit — conservative regex tokenizer.
 * Design: PURE; reuses MSSQL tokenizer.ts [\w.]+ + bracket-strip patterns for
 *   ALTER TABLE / CREATE|DROP INDEX / ADD|DROP COLUMN; case-insensitive, deduped.
 *
 * ADR-004: imports NOTHING from adapters, cli, mcp, or drivers. PURE function.
 * ADR-007: no node-sql-parser — conservative regex only.
 * ADR-008: deterministic — same ddl → same readonly string[].
 *
 * Placement: src/core/precheck/ — neutral module shared by BOTH MCP tool
 * (src/mcp/tools/precheck.ts) and CLI command (src/cli/commands/affected.ts)
 * via the barrel. Neither cli nor mcp imports the other (ADR-004 boundary).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Bracket / quote stripping (reuse tokenizer.ts pattern)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips bracket delimiters `[...]` and double-quote delimiters `"..."` from a
 * qualified name fragment and lowercases the result.
 * Reuses the same approach as MSSQL canonicalizeQName in tokenizer.ts.
 */
function stripDelimiters(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]/g, '$1')   // [schema] → schema
    .replace(/"([^"]*)"/g, '$1')       // "schema" → schema
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalize the entire DDL string: strip brackets, lowercase, keep [\w. ]+
// so the regexes below can match uniformly.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeDdl(ddl: string): string {
  // First strip bracket-quoted identifiers, replacing with their bare content
  // Then lowercase the result (so all pattern matching is case-insensitive)
  return ddl
    .replace(/\[([^\]]*)\]/g, '$1')   // [schema] or [name] → schema / name
    .replace(/"([^"]*)"/g, '$1')       // "schema" or "name" → schema / name
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Patterns — capture group 1 always = the identifier of interest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Matches ALTER TABLE <table_name> (case-insensitive on normalized input).
 * Captures the table name.
 */
const ALTER_TABLE_RE = /\balter\s+table\s+([\w.]+)/g;

/**
 * Matches ADD COLUMN <col_name> — captures the column name.
 */
const ADD_COLUMN_RE = /\badd\s+column\s+([\w.]+)/g;

/**
 * Matches DROP COLUMN <col_name> — captures the column name.
 */
const DROP_COLUMN_RE = /\bdrop\s+column\s+([\w.]+)/g;

/**
 * Matches CREATE [UNIQUE] INDEX <index_name> ON <table_name> — two captures:
 *   group 1 = index name, group 2 = table name.
 */
const CREATE_INDEX_RE = /\bcreate\s+(?:unique\s+)?index\s+([\w.]+)\s+on\s+([\w.]+)/g;

/**
 * Matches DROP INDEX <index_name> ON <table_name> — two captures:
 *   group 1 = index name, group 2 = table name.
 * Also handles SQL Server style: DROP INDEX <table>.<index> (no ON clause).
 */
const DROP_INDEX_ON_RE = /\bdrop\s+index\s+([\w.]+)\s+on\s+([\w.]+)/g;

/**
 * Matches DROP INDEX <table>.<index> (SQL Server style, no ON keyword).
 * Captures the dotted name as one string.
 */
const DROP_INDEX_BARE_RE = /\bdrop\s+index\s+([\w]+\.\w+)(?!\s+on\b)/g;

// ─────────────────────────────────────────────────────────────────────────────
// extractIdentifiers — PURE entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts qualified identifiers from DDL statements using conservative
 * regex patterns (ALTER TABLE, CREATE|DROP INDEX, ADD|DROP COLUMN).
 *
 * Returns a deduped, stable sorted readonly array of lowercased identifiers.
 * Bracket delimiters are stripped. Case is normalized to lowercase.
 *
 * Only recognized statement patterns yield identifiers — unrecognized DDL
 * produces no identifiers (SELECT, INSERT, etc. are silently ignored).
 *
 * @param ddl  Raw DDL string (one or more statements, separated by semicolons).
 * @returns    Readonly, deduped, sorted array of extracted identifiers.
 */
export function extractIdentifiers(ddl: string): readonly string[] {
  if (ddl.trim() === '') return [];

  const normalized = normalizeDdl(ddl);
  const collected = new Set<string>();

  // ── ALTER TABLE <table_name> ──────────────────────────────────────────────
  {
    ALTER_TABLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALTER_TABLE_RE.exec(normalized)) !== null) {
      if (m[1] !== undefined) {
        collected.add(stripDelimiters(m[1]));
      }
    }
  }

  // ── ADD COLUMN <col_name> ─────────────────────────────────────────────────
  {
    ADD_COLUMN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ADD_COLUMN_RE.exec(normalized)) !== null) {
      if (m[1] !== undefined) {
        collected.add(stripDelimiters(m[1]));
      }
    }
  }

  // ── DROP COLUMN <col_name> ───────────────────────────────────────────────
  {
    DROP_COLUMN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DROP_COLUMN_RE.exec(normalized)) !== null) {
      if (m[1] !== undefined) {
        collected.add(stripDelimiters(m[1]));
      }
    }
  }

  // ── CREATE [UNIQUE] INDEX <index_name> ON <table_name> ───────────────────
  {
    CREATE_INDEX_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CREATE_INDEX_RE.exec(normalized)) !== null) {
      if (m[1] !== undefined) collected.add(stripDelimiters(m[1]));
      if (m[2] !== undefined) collected.add(stripDelimiters(m[2]));
    }
  }

  // ── DROP INDEX <index_name> ON <table_name> ───────────────────────────────
  {
    DROP_INDEX_ON_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DROP_INDEX_ON_RE.exec(normalized)) !== null) {
      if (m[1] !== undefined) collected.add(stripDelimiters(m[1]));
      if (m[2] !== undefined) collected.add(stripDelimiters(m[2]));
    }
  }

  // ── DROP INDEX <table>.<index> (SQL Server bare style) ───────────────────
  {
    DROP_INDEX_BARE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DROP_INDEX_BARE_RE.exec(normalized)) !== null) {
      if (m[1] !== undefined) collected.add(stripDelimiters(m[1]));
    }
  }

  // Sort deterministically (ADR-008)
  return [...collected].sort();
}
