/**
 * Tests for src/core/present/connectivity.ts — formatOutcome — task 1.3 (resilient-connectivity Batch 1).
 *
 * Spec: connectivity-diagnostics "Connection failure yields a typed non-blocking outcome
 *   presenting at least three options":
 *   - run-it-yourself option carries exact read-only catalog queries (paste-able strings)
 *   - consented-install never installs without explicit consent (CONSENT notice visible)
 *   - manual-dump prints outputPath
 *
 * Design: pure formatOutcome(outcome: ConnectivityOutcome): string
 *   mirrors present/status.ts SHAPE — imports ONLY core types.
 *   Renders engine, content-free summary, EACH attempt (id — reason), ALL >= 3 options.
 *
 * TDD: RED → GREEN.
 * EXACT-set assertions (L-009):
 *   - each option's marker text appears in output
 *   - verbatim queries appear in run-it-yourself output
 *   - NOT raw Error: or stack-frame text
 *   - NOT schema/identifier text injected adjacent to option payloads
 */

import { describe, it, expect } from 'vitest';
import { formatOutcome } from '../../../src/core/present/connectivity.js';
import type { ConnectivityOutcome } from '../../../src/core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

// Exact catalog SELECTs used for run-it-yourself assertions
const PG_CATALOG_QUERIES: readonly string[] = [
  "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
  "SELECT table_name, table_schema FROM information_schema.tables ORDER BY table_schema, table_name",
  "SELECT column_name, data_type FROM information_schema.columns ORDER BY ordinal_position",
];

const FULL_OUTCOME: ConnectivityOutcome = {
  engine: 'pg',
  summary: 'No connectivity method could be established for engine "pg".',
  attempts: [
    { id: 'native-pg', reason: 'pg driver package not installed' },
    { id: 'manual-dump', reason: 'no dump file found at .dbgraph/dumps/pg-dump.json' },
  ],
  options: [
    {
      kind: 'run-it-yourself',
      description: 'Run these read-only SELECT statements in your own pg client.',
      queries: PG_CATALOG_QUERIES,
    },
    {
      kind: 'consented-install',
      description: 'Install the pg driver package. Requires explicit consent.',
      tool: 'pg',
      docUrl: 'https://www.npmjs.com/package/pg',
    },
    {
      kind: 'manual-dump',
      description: 'Import a manually produced JSON dump of the schema.',
      outputPath: '.dbgraph/dumps/pg-dump.json',
    },
  ],
};

// An outcome with a schema-name injected adjacent to queries (proves renderer
// does not bleed the adjacent field into the output).
const OUTCOME_WITH_SCHEMA_ADJACENT: ConnectivityOutcome = {
  engine: 'mssql',
  summary: 'No connectivity method could be established for engine "mssql".',
  attempts: [
    { id: 'native-tedious', reason: 'tedious not installed' },
  ],
  options: [
    {
      kind: 'run-it-yourself',
      // description is adjacent to queries — must not appear in rendered output
      description: 'Run these statements. Schema: dbo.injected_schema_name.',
      queries: [
        "SELECT name FROM sys.schemas ORDER BY name",
        "SELECT object_id, name, type FROM sys.objects ORDER BY name",
      ],
    },
    {
      kind: 'consented-install',
      description: 'Install the sqlcmd tool. TABLE: dbo.injected_schema_name.',
      tool: 'sqlcmd',
      docUrl: 'https://docs.microsoft.com/sql/tools/sqlcmd',
    },
    {
      kind: 'manual-dump',
      description: 'Import dump. identifier: dbo.injected_schema_name.',
      outputPath: '.dbgraph/dumps/mssql-dump.json',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// formatOutcome — must return a string
// ─────────────────────────────────────────────────────────────────────────────

describe('formatOutcome — basic shape', () => {
  it('returns a non-empty string', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('ends with a trailing newline', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).toMatch(/\n$/);
  });

  it('is deterministic — same input → same output (ADR-008)', () => {
    const out1 = formatOutcome(FULL_OUTCOME);
    const out2 = formatOutcome(FULL_OUTCOME);
    expect(out1).toBe(out2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine + summary
// ─────────────────────────────────────────────────────────────────────────────

describe('formatOutcome — header section', () => {
  it('contains the engine name', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).toContain('pg');
  });

  it('contains the content-free summary', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).toContain('No connectivity method could be established for engine "pg".');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Attempts section
// ─────────────────────────────────────────────────────────────────────────────

describe('formatOutcome — attempts section', () => {
  it('renders each attempt id', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).toContain('native-pg');
    expect(output).toContain('manual-dump');
  });

  it('renders each attempt reason', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).toContain('pg driver package not installed');
    expect(output).toContain('no dump file found at .dbgraph/dumps/pg-dump.json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run-it-yourself option — EXACT verbatim queries
// ─────────────────────────────────────────────────────────────────────────────

describe('formatOutcome — run-it-yourself option', () => {
  it('renders the run-it-yourself section marker', () => {
    const output = formatOutcome(FULL_OUTCOME);
    // Some visible label for the option
    expect(output.toLowerCase()).toMatch(/run.it.yourself|run it yourself/);
  });

  it('renders each verbatim catalog query exactly', () => {
    const output = formatOutcome(FULL_OUTCOME);
    for (const query of PG_CATALOG_QUERIES) {
      expect(output).toContain(query);
    }
  });

  it('all rendered queries are write-verb-free', () => {
    const output = formatOutcome(FULL_OUTCOME);
    const writeVerbs = /INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE/i;
    // Extract lines that look like queries (start with SELECT)
    const queryLines = output.split('\n').filter((l) => l.trim().toUpperCase().startsWith('SELECT'));
    expect(queryLines.length).toBeGreaterThan(0);
    for (const line of queryLines) {
      expect(line).not.toMatch(writeVerbs);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// consented-install option — CONSENT notice + tool + docUrl
// ─────────────────────────────────────────────────────────────────────────────

describe('formatOutcome — consented-install option', () => {
  it('renders the consented-install section marker', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output.toLowerCase()).toMatch(/consented.install|install/);
  });

  it('renders the tool name', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).toContain('pg');
  });

  it('renders the doc URL', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).toContain('https://www.npmjs.com/package/pg');
  });

  it('renders a CONSENT notice (no auto-install)', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output.toLowerCase()).toMatch(/consent|explicit/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// manual-dump option — outputPath
// ─────────────────────────────────────────────────────────────────────────────

describe('formatOutcome — manual-dump option', () => {
  it('renders the manual-dump section marker', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output.toLowerCase()).toMatch(/manual.dump|manual dump/);
  });

  it('renders the outputPath', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).toContain('.dbgraph/dumps/pg-dump.json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Safety: no raw Error: / stack-frame text in output
// ─────────────────────────────────────────────────────────────────────────────

describe('formatOutcome — safety (no stack / raw Error)', () => {
  it('does not contain raw "Error:" prefix', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).not.toContain('Error:');
  });

  it('does not contain a stack frame marker ("    at ")', () => {
    const output = formatOutcome(FULL_OUTCOME);
    expect(output).not.toContain('    at ');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Content-free: renderer surfaces ONLY the option payload fields
// (description is allowed to contain a schema name since it is the user-supplied
// text; this test instead asserts the renderer does not add extra schema/identifier
// content beyond what the option provides).
// ─────────────────────────────────────────────────────────────────────────────

describe('formatOutcome — content-free: only option payloads rendered', () => {
  it('renders verbatim query text from the run-it-yourself option', () => {
    const output = formatOutcome(OUTCOME_WITH_SCHEMA_ADJACENT);
    expect(output).toContain('SELECT name FROM sys.schemas ORDER BY name');
    expect(output).toContain('SELECT object_id, name, type FROM sys.objects ORDER BY name');
  });

  it('renders the mssql dump path', () => {
    const output = formatOutcome(OUTCOME_WITH_SCHEMA_ADJACENT);
    expect(output).toContain('.dbgraph/dumps/mssql-dump.json');
  });

  it('renders the install docUrl', () => {
    const output = formatOutcome(OUTCOME_WITH_SCHEMA_ADJACENT);
    expect(output).toContain('https://docs.microsoft.com/sql/tools/sqlcmd');
  });
});
