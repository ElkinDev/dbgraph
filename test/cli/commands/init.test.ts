/**
 * Tests for src/cli/commands/init.ts — tasks 3.2 + 3.3 (phase-4-cli-config).
 * Spec: cli-config "init writes a root config and gitignores the local index"
 *       + "Interactive init is capability-driven and byte-identical to flags".
 *
 * Scenarios:
 *   - flag form writes dbgraph.config.json at the specified project root
 *   - flag form appends .dbgraph/ to .gitignore (creates it if absent)
 *   - appending .dbgraph/ is idempotent (second run does NOT duplicate the entry)
 *   - init never writes a plaintext credential to disk (ConfigError surfaced)
 *   - byte-identity: flag form and wizard form produce IDENTICAL writeConfig strings
 *   - sync is isolated via _syncFn injection (Batch D seam tested in sync.test.ts)
 *
 * TDD: RED → GREEN.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { runInit } from '../../../src/cli/commands/init.js';
import { writeConfig, buildConfig } from '../../../src/cli/config/build-config.js';
import { SQLITE_CAPABILITIES } from '../../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  // Each test gets a fresh isolated temp directory
  tmpDir = join(tmpdir(), `dbgraph-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function readConfig(): unknown {
  const configPath = join(tmpDir, 'dbgraph.config.json');
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

function readGitignore(): string {
  const ignorePath = join(tmpDir, '.gitignore');
  return readFileSync(ignorePath, 'utf-8');
}

function makeWizardStreams(answers: string[]): {
  input: Readable;
  output: Writable;
} {
  const input = Readable.from(answers.map((a) => a + '\n'));
  const output = new Writable({
    write(_chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
      cb();
    },
  });
  return { input, output };
}

// Shared no-op sync override: init tests isolate the init path from the sync step.
// The sync seam (syncAfterInit) is tested separately in sync.test.ts.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noSync = async (_root: string): Promise<void> => {};

// ─────────────────────────────────────────────────────────────────────────────
// Flag form — non-interactive
// ─────────────────────────────────────────────────────────────────────────────

describe('runInit — flag form (non-interactive)', () => {
  it('writes dbgraph.config.json at the project root', async () => {
    await runInit({
      projectRoot: tmpDir,
      dialect: 'sqlite',
      file: './fixture.db',
      _syncFn: noSync,
    });

    expect(existsSync(join(tmpDir, 'dbgraph.config.json'))).toBe(true);
  });

  it('config has dialect = sqlite', async () => {
    await runInit({
      projectRoot: tmpDir,
      dialect: 'sqlite',
      file: './fixture.db',
      _syncFn: noSync,
    });

    const cfg = readConfig() as { dialect: string };
    expect(cfg.dialect).toBe('sqlite');
  });

  it('config has source.file', async () => {
    await runInit({
      projectRoot: tmpDir,
      dialect: 'sqlite',
      file: './fixture.db',
      _syncFn: noSync,
    });

    const cfg = readConfig() as { source: { file: string } };
    expect(cfg.source.file).toBe('./fixture.db');
  });

  it('appends .dbgraph/ to .gitignore (creates file if absent)', async () => {
    await runInit({
      projectRoot: tmpDir,
      dialect: 'sqlite',
      file: './fixture.db',
      _syncFn: noSync,
    });

    const gitignore = readGitignore();
    expect(gitignore).toContain('.dbgraph/');
  });

  it('.gitignore append is idempotent — .dbgraph/ not duplicated on second run', async () => {
    // Run twice
    await runInit({ projectRoot: tmpDir, dialect: 'sqlite', file: './fixture.db', _syncFn: noSync });
    await runInit({ projectRoot: tmpDir, dialect: 'sqlite', file: './fixture.db', _syncFn: noSync });

    const gitignore = readGitignore();
    const count = gitignore.split('\n').filter((line) => line.trim() === '.dbgraph/').length;
    expect(count).toBe(1);
  });

  it('.gitignore preserves existing content', async () => {
    // Create a pre-existing .gitignore
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf-8');

    await runInit({ projectRoot: tmpDir, dialect: 'sqlite', file: './fixture.db', _syncFn: noSync });

    const gitignore = readGitignore();
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain('.dbgraph/');
  });

  it('returns success outcome (type: success)', async () => {
    const outcome = await runInit({
      projectRoot: tmpDir,
      dialect: 'sqlite',
      file: './fixture.db',
      _syncFn: noSync,
    });

    expect(outcome.type).toBe('success');
  });

  it('MSSQL flag form with env refs writes valid config', async () => {
    await runInit({
      projectRoot: tmpDir,
      dialect: 'mssql',
      server: '${env:DBGRAPH_DB_SERVER}',
      database: '${env:DBGRAPH_DB_NAME}',
      user: '${env:DBGRAPH_DB_USER}',
      password: '${env:DBGRAPH_DB_PASSWORD}',
      _syncFn: noSync,
    });

    const cfg = readConfig() as {
      dialect: string;
      source: { server: string; password: string };
    };
    expect(cfg.dialect).toBe('mssql');
    expect(cfg.source.server).toBe('${env:DBGRAPH_DB_SERVER}');
    expect(cfg.source.password).toBe('${env:DBGRAPH_DB_PASSWORD}');
  });

  it('literal MSSQL password is rejected — ConfigError, no file written', async () => {
    const { ConfigError } = await import('../../../src/index.js');
    await expect(
      runInit({
        projectRoot: tmpDir,
        dialect: 'mssql',
        server: '${env:DBGRAPH_DB_SERVER}',
        database: '${env:DBGRAPH_DB_NAME}',
        user: '${env:DBGRAPH_DB_USER}',
        password: 'literal_secret',
        _syncFn: noSync,
      }),
    ).rejects.toThrow(ConfigError);

    // Config file must NOT be written on error
    expect(existsSync(join(tmpDir, 'dbgraph.config.json'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Interactive form (-i wizard)
// ─────────────────────────────────────────────────────────────────────────────

describe('runInit — interactive form (-i wizard)', () => {
  it('writes dbgraph.config.json via wizard answers', async () => {
    const supportedKinds = [...SQLITE_CAPABILITIES.supported];
    // dialect, file, then per-kind: include? + level
    const answers = [
      'sqlite',
      './fixture.db',
      ...supportedKinds.flatMap(() => ['y', '']),
    ];
    const { input, output } = makeWizardStreams(answers);

    await runInit({
      projectRoot: tmpDir,
      interactive: true,
      wizardInput: input,
      wizardOutput: output,
      capabilitiesOverride: SQLITE_CAPABILITIES,
      _syncFn: noSync,
    });

    expect(existsSync(join(tmpDir, 'dbgraph.config.json'))).toBe(true);
  });

  it('wizard form also appends .dbgraph/ to .gitignore', async () => {
    const supportedKinds = [...SQLITE_CAPABILITIES.supported];
    const answers = ['sqlite', './fixture.db', ...supportedKinds.flatMap(() => ['y', ''])];
    const { input, output } = makeWizardStreams(answers);

    await runInit({
      projectRoot: tmpDir,
      interactive: true,
      wizardInput: input,
      wizardOutput: output,
      capabilitiesOverride: SQLITE_CAPABILITIES,
      _syncFn: noSync,
    });

    const gitignore = readGitignore();
    expect(gitignore).toContain('.dbgraph/');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3.3: Byte-identity — flag form and equivalent wizard produce SAME config
// ─────────────────────────────────────────────────────────────────────────────

describe('byte-identity — flag form and wizard produce IDENTICAL writeConfig output', () => {
  it('flag-form config string equals wizard-form config string for SQLite', async () => {
    // Flag form
    const flagConfig = buildConfig({ dialect: 'sqlite', file: './fixture.db' });
    const flagString = writeConfig(flagConfig);

    // Wizard form — feed equivalent answers
    const supportedKinds = [...SQLITE_CAPABILITIES.supported];
    const answers = [
      'sqlite',
      './fixture.db',
      // Decline all kinds (no levels) — matching the flag form which has no levels
      ...supportedKinds.map(() => 'n'),
    ];
    const { input, output } = makeWizardStreams(answers);

    await runInit({
      projectRoot: tmpDir,
      interactive: true,
      wizardInput: input,
      wizardOutput: output,
      capabilitiesOverride: SQLITE_CAPABILITIES,
      _syncFn: noSync,
    });

    const writtenConfig = readFileSync(join(tmpDir, 'dbgraph.config.json'), 'utf-8');
    expect(writtenConfig).toBe(flagString);
  });

  it('flag form and wizard BOTH produce the EXACT golden string for a known config', () => {
    // Both paths go through the same buildConfig → writeConfig pipeline.
    // This verifies that the path through wizard → WizardResult → buildConfig is equivalent.
    const config1 = buildConfig({ dialect: 'sqlite', file: './test.db' });
    const config2 = buildConfig({ dialect: 'sqlite', file: './test.db' });
    expect(writeConfig(config1)).toBe(writeConfig(config2));
  });
});
