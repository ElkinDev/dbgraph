/**
 * Tests for src/cli/init/wizard.ts — task 3.1 (phase-4-cli-config).
 * Spec: cli-config "Interactive init is capability-driven and byte-identical to flags".
 *
 * The wizard reads CapabilityMatrix.supported via capabilitiesFor() (Decision 6);
 * connection identity fields MUST be ${env:VAR} references (Decision 5);
 * literal credentials trigger a re-prompt, never a hard throw.
 * Secret prompts use output:null on the readline interface (no echo).
 *
 * Answer sequence per dialect:
 *   SQLite: dialect, file, then per-kind: include?(y/n) + level?(empty=full)
 *   MSSQL:  dialect, server, database, user, password, port, domain,
 *           then per-kind: include?(y/n) + level?(empty=full)
 *
 * TDD: RED → GREEN.
 */

import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { runWizard, type WizardResult } from '../../../src/cli/init/wizard.js';
import {
  SQLITE_CAPABILITIES,
  MSSQL_CAPABILITIES,
  type CapabilityMatrix,
} from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a Readable that emits lines from `answers` array followed by EOF,
 * and a Writable that captures all output.
 */
function makeStreams(answers: string[]): {
  input: Readable;
  output: Writable;
  getOutput: () => string;
} {
  const input = Readable.from(answers.map((a) => a + '\n'));
  const chunks: Buffer[] = [];
  const output = new Writable({
    write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  return { input, output, getOutput: () => Buffer.concat(chunks).toString() };
}

/**
 * Build the answer sequence for object type levels.
 * Each kind needs 2 answers: include? (y/n) + level (empty = default full).
 * If include = 'n', no level question is asked.
 */
function kindAnswers(
  matrix: CapabilityMatrix,
  includeAll = true,
): string[] {
  const result: string[] = [];
  for (const _kind of matrix.supported) {
    result.push(includeAll ? 'y' : 'n'); // include?
    if (includeAll) {
      result.push(''); // level — empty = full
    }
  }
  return result;
}

/**
 * Build the full SQLite answer sequence.
 * dialect, file, then kind answers.
 */
function sqliteAnswers(
  file: string,
  matrix: CapabilityMatrix,
  includeAll = true,
): string[] {
  return ['sqlite', file, ...kindAnswers(matrix, includeAll)];
}

/**
 * Build the full MSSQL answer sequence.
 * dialect, server, database, user, password, port (empty), domain (empty), then kind answers.
 */
function mssqlAnswers(
  opts: {
    server?: string;
    database?: string;
    user?: string;
    password?: string;
    port?: string;
    domain?: string;
    includeAll?: boolean;
  },
  matrix: CapabilityMatrix,
): string[] {
  return [
    'mssql',
    opts.server ?? '${env:DBGRAPH_DB_SERVER}',
    opts.database ?? '${env:DBGRAPH_DB_NAME}',
    opts.user ?? '${env:DBGRAPH_DB_USER}',
    opts.password ?? '${env:DBGRAPH_DB_PASSWORD}',
    opts.port ?? '',
    opts.domain ?? '',
    ...kindAnswers(matrix, opts.includeAll ?? true),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability matrix exports from barrel (sanity check)
// ─────────────────────────────────────────────────────────────────────────────

describe('barrel exports — SQLITE_CAPABILITIES / MSSQL_CAPABILITIES', () => {
  it('exports SQLITE_CAPABILITIES with the sqlite engine name', () => {
    expect(SQLITE_CAPABILITIES.engine).toBe('sqlite');
  });

  it('exports MSSQL_CAPABILITIES with the mssql engine name', () => {
    expect(MSSQL_CAPABILITIES.engine).toBe('mssql');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SQLite wizard — capability-driven object type offering
// ─────────────────────────────────────────────────────────────────────────────

describe('runWizard — SQLite: offers only CapabilityMatrix-supported types', () => {
  it('wizard completes and returns a WizardResult with dialect=sqlite', async () => {
    const answers = sqliteAnswers('./fixture.db', SQLITE_CAPABILITIES);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: SQLITE_CAPABILITIES });
    expect(result.dialect).toBe('sqlite');
  });

  it('result includes the provided file path', async () => {
    const answers = sqliteAnswers('./my-db.db', SQLITE_CAPABILITIES);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: SQLITE_CAPABILITIES });
    expect(result.dialect).toBe('sqlite');
    if (result.dialect === 'sqlite') {
      expect(result.file).toBe('./my-db.db');
    }
  });

  it('offered kinds do NOT include procedure (not in SQLite matrix)', async () => {
    const answers = sqliteAnswers('./fixture.db', SQLITE_CAPABILITIES);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: SQLITE_CAPABILITIES });
    expect(result.offeredKinds).not.toContain('procedure');
  });

  it('offered kinds only contain kinds from the SQLite supported set', async () => {
    const answers = sqliteAnswers('./fixture.db', SQLITE_CAPABILITIES);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: SQLITE_CAPABILITIES });
    for (const kind of result.offeredKinds) {
      expect(SQLITE_CAPABILITIES.supported.has(kind)).toBe(true);
    }
  });

  it('includes all offered kinds in result.levels when user accepts all', async () => {
    const answers = sqliteAnswers('./fixture.db', SQLITE_CAPABILITIES, true);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: SQLITE_CAPABILITIES });
    for (const kind of result.offeredKinds) {
      expect(result.levels[kind]).toBeDefined();
    }
  });

  it('levels object is empty when user declines all kinds', async () => {
    const answers = sqliteAnswers('./fixture.db', SQLITE_CAPABILITIES, false);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: SQLITE_CAPABILITIES });
    expect(Object.keys(result.levels)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MSSQL wizard — includes procedure (present in MSSQL matrix)
// ─────────────────────────────────────────────────────────────────────────────

describe('runWizard — MSSQL: includes procedure in offered kinds', () => {
  it('mssql wizard offers procedure in offeredKinds', async () => {
    const answers = mssqlAnswers({}, MSSQL_CAPABILITIES);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: MSSQL_CAPABILITIES });
    expect(result.offeredKinds).toContain('procedure');
  });

  it('mssql wizard does NOT offer collection (not in MSSQL matrix)', async () => {
    const answers = mssqlAnswers({}, MSSQL_CAPABILITIES);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: MSSQL_CAPABILITIES });
    expect(result.offeredKinds).not.toContain('collection');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Credential validation — literal credential triggers re-prompt, not crash
// ─────────────────────────────────────────────────────────────────────────────

describe('runWizard — MSSQL: literal credential triggers re-prompt', () => {
  it('wizard re-prompts when a literal password is entered, then accepts env ref', async () => {
    // Insert literal password BEFORE the correct env ref — wizard should re-prompt
    const kindCount = MSSQL_CAPABILITIES.supported.size;
    const answers = [
      'mssql',
      '${env:DBGRAPH_DB_SERVER}',
      '${env:DBGRAPH_DB_NAME}',
      '${env:DBGRAPH_DB_USER}',
      's3cr3t_literal',             // literal → re-prompt
      '${env:DBGRAPH_DB_PASSWORD}', // corrected
      '',                           // port (empty)
      '',                           // domain (empty)
      ...Array(kindCount * 2).fill('').map((_, i) => (i % 2 === 0 ? 'y' : '')),
    ];
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: MSSQL_CAPABILITIES });
    expect(result.dialect).toBe('mssql');
    if (result.dialect === 'mssql') {
      expect(result.password).toBe('${env:DBGRAPH_DB_PASSWORD}');
    }
  });

  it('literal server triggers re-prompt, wizard accepts corrected env ref', async () => {
    const kindCount = MSSQL_CAPABILITIES.supported.size;
    const answers = [
      'mssql',
      'literal-server.corp.local',  // literal → re-prompt
      '${env:DBGRAPH_DB_SERVER}',   // corrected
      '${env:DBGRAPH_DB_NAME}',
      '${env:DBGRAPH_DB_USER}',
      '${env:DBGRAPH_DB_PASSWORD}',
      '',                           // port (empty)
      '',                           // domain (empty)
      ...Array(kindCount * 2).fill('').map((_, i) => (i % 2 === 0 ? 'y' : '')),
    ];
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: MSSQL_CAPABILITIES });
    expect(result.dialect).toBe('mssql');
    if (result.dialect === 'mssql') {
      expect(result.server).toBe('${env:DBGRAPH_DB_SERVER}');
    }
  });

  it('re-prompt message contains env:VAR guidance', async () => {
    const kindCount = MSSQL_CAPABILITIES.supported.size;
    const answers = [
      'mssql',
      '${env:DBGRAPH_DB_SERVER}',
      '${env:DBGRAPH_DB_NAME}',
      '${env:DBGRAPH_DB_USER}',
      's3cr3t_literal',             // literal password → re-prompt
      '${env:DBGRAPH_DB_PASSWORD}', // corrected
      '',
      '',
      ...Array(kindCount * 2).fill('').map((_, i) => (i % 2 === 0 ? 'y' : '')),
    ];
    const { input, output, getOutput } = makeStreams(answers);
    await runWizard({ input, output, capabilitiesOverride: MSSQL_CAPABILITIES });
    const text = getOutput();
    // The rejection message must contain ${env: guidance
    expect(text).toMatch(/\$\{env:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Secret masking — output:null on readline means NO echo at all
// ─────────────────────────────────────────────────────────────────────────────

describe('runWizard — secret masking', () => {
  it('password value is NOT echoed to the output writable', async () => {
    const secretEnvRef = '${env:DBGRAPH_DB_PASSWORD}';
    const answers = mssqlAnswers({ password: secretEnvRef }, MSSQL_CAPABILITIES);
    const { input, output, getOutput } = makeStreams(answers);
    await runWizard({ input, output, capabilitiesOverride: MSSQL_CAPABILITIES });
    const outputText = getOutput();
    // The literal typed password value must NOT appear in the captured output
    // (readline runs with output:null — nothing is echoed back from readline itself;
    // wizard writes prompts manually but never writes the typed value)
    expect(outputText).not.toContain(secretEnvRef);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WizardResult shape — structurally compatible with BuildConfigInput
// ─────────────────────────────────────────────────────────────────────────────

describe('runWizard — WizardResult shape is compatible with BuildConfigInput', () => {
  it('sqlite result has dialect and file properties', async () => {
    const answers = sqliteAnswers('./test.db', SQLITE_CAPABILITIES, false);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: SQLITE_CAPABILITIES });
    expect(result.dialect).toBe('sqlite');
    expect('file' in result).toBe(true);
  });

  it('mssql result has dialect, server, database, user, password properties', async () => {
    const answers = mssqlAnswers({}, MSSQL_CAPABILITIES, );
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: MSSQL_CAPABILITIES });
    expect(result.dialect).toBe('mssql');
    if (result.dialect === 'mssql') {
      expect(result.server).toBe('${env:DBGRAPH_DB_SERVER}');
      expect(result.database).toBe('${env:DBGRAPH_DB_NAME}');
      expect(result.user).toBe('${env:DBGRAPH_DB_USER}');
      expect(result.password).toBe('${env:DBGRAPH_DB_PASSWORD}');
    }
  });

  it('optional port is undefined when left empty', async () => {
    const answers = mssqlAnswers({ port: '' }, MSSQL_CAPABILITIES);
    const { input, output } = makeStreams(answers);
    const result = await runWizard({ input, output, capabilitiesOverride: MSSQL_CAPABILITIES });
    expect(result.dialect).toBe('mssql');
    if (result.dialect === 'mssql') {
      expect(result.port).toBeUndefined();
    }
  });
});
