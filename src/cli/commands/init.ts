/**
 * init command handler — tasks 3.2 + 3.3 (phase-4-cli-config).
 *
 * Both flag form and -i wizard paths funnel through the SINGLE buildConfig/writeConfig
 * pipeline from Batch A (ensuring byte-identical output — ADR-008, Decision 4).
 *
 * What init does:
 *   1. Build a DbgraphConfig via buildConfig (flag form) or runWizard → buildConfig (-i form).
 *   2. Serialize via writeConfig and write to PROJECT_ROOT/dbgraph.config.json.
 *   3. Append `.dbgraph/` to PROJECT_ROOT/.gitignore (idempotent, creates if absent).
 *   4. (Seam for Batch D) Call syncStub — a clean seam that Batch D will wire to the
 *      real sync engine. For now returns success immediately.
 *
 * ADR-004: imports ONLY from ../index.js (public barrel) + node builtins.
 * No adapter imports, no process.exit (cli.ts owns that).
 * Throws ConfigError on invalid input (propagated to cli.ts → exit code 2).
 */

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { buildConfig, writeConfig } from '../config/build-config.js';
import type { BuildConfigInput } from '../config/build-config.js';
import { runWizard } from '../init/wizard.js';
import type { CapabilityMatrix } from '../../index.js';
import type { HandlerOutcome } from '../dispatch.js';
import { openConnections } from '../../index.js';
import { runSync } from './sync.js';
import { createConsoleLogger } from '../log/console-logger.js';
import { formatSyncSummary } from '../format/sync.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public input types
// ─────────────────────────────────────────────────────────────────────────────

type NonInteractiveInit =
  | { dialect: 'sqlite'; file: string; driver?: 'better-sqlite3' | 'node:sqlite' }
  | {
      dialect: 'mssql';
      server: string;
      database: string;
      user: string;
      password: string;
      port?: string;
      domain?: string;
    };

type InteractiveInit = {
  interactive: true;
  wizardInput?: Readable;
  wizardOutput?: Writable;
  capabilitiesOverride?: CapabilityMatrix;
};

export type InitOptions = {
  projectRoot: string;
  /**
   * Overrides the sync step for testing. When provided, runInit calls this
   * instead of syncAfterInit. Use to isolate init tests from the sync path.
   * @internal test use only
   */
  _syncFn?: (projectRoot: string) => Promise<void>;
} & (
  | (NonInteractiveInit & { interactive?: false })
  | InteractiveInit
);

// ─────────────────────────────────────────────────────────────────────────────
// .gitignore writer (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

const GITIGNORE_ENTRY = '.dbgraph/';

/**
 * Appends `.dbgraph/` to the project .gitignore.
 * Idempotent: if the entry already exists as its own line, it is NOT duplicated.
 * Creates the .gitignore file if it does not exist.
 */
function ensureGitignored(projectRoot: string): void {
  const gitignorePath = join(projectRoot, '.gitignore');

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    // Check whether the entry already exists as an exact line
    const lines = content.split('\n').map((l) => l.trim());
    if (lines.includes(GITIGNORE_ENTRY)) {
      return; // Already present — idempotent, do nothing
    }
    // Append to existing file. Ensure we start on a new line.
    const suffix = content.endsWith('\n') ? '' : '\n';
    appendFileSync(gitignorePath, `${suffix}${GITIGNORE_ENTRY}\n`, 'utf-8');
  } else {
    // Create fresh .gitignore with just the entry
    writeFileSync(gitignorePath, `${GITIGNORE_ENTRY}\n`, 'utf-8');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync seam (Batch D wires the real engine here)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the first incremental sync after init.
 * Delegates to openConnections (the single source for config → adapter + store wiring)
 * and then calls runSync.
 *
 * OBSERVABILITY (ux-observability, US-005): this is the SECOND runSync caller. It builds a
 * console Logger (progress → STDERR), passes it to openConnections + runSync, and writes the
 * PURE-formatted SyncSummary to STDOUT — so the FIRST post-init sync is observable instead of
 * running silent. The return stays Promise<void> (the summary is written, then discarded) —
 * source-compatible with runInit's _syncFn seam.
 *
 * ADR-004: only imports via the public barrel + CLI-layer siblings + node builtins.
 * Security: never logs resolved URLs; openConnections handles resolution internally, and the
 * logger/formatter emit ONLY counts, phase names, drift state and snapshot metadata.
 */
export async function syncAfterInit(projectRoot: string): Promise<void> {
  const logger = createConsoleLogger({ level: 'info' });
  const { adapter, store } = await openConnections(projectRoot, logger);
  try {
    const summary = await runSync({ adapter, store, full: false, logger });
    process.stdout.write(formatSyncSummary(summary));
  } finally {
    await adapter.close();
    await store.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WizardResult → BuildConfigInput adapter
// ─────────────────────────────────────────────────────────────────────────────

import type { WizardResult } from '../init/wizard.js';

/**
 * Converts a WizardResult to a BuildConfigInput.
 * Both are structurally identical — this is a type-level adapter that ensures
 * TypeScript is satisfied without duplicating the conversion logic.
 */
function wizardResultToBuildInput(result: WizardResult): BuildConfigInput {
  if (result.dialect === 'sqlite') {
    return { dialect: 'sqlite', file: result.file };
  }
  const base: BuildConfigInput = {
    dialect: 'mssql',
    server: result.server,
    database: result.database,
    user: result.user,
    password: result.password,
  };
  const mssql = base as {
    dialect: 'mssql';
    server: string;
    database: string;
    user: string;
    password: string;
    port?: string;
    domain?: string;
  };
  if (result.port !== undefined) mssql.port = result.port;
  if (result.domain !== undefined) mssql.domain = result.domain;
  return mssql;
}

// ─────────────────────────────────────────────────────────────────────────────
// runInit — public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes the init command.
 *
 * Non-interactive: takes flags directly → buildConfig → write.
 * Interactive (-i): runs wizard → WizardResult → buildConfig → write.
 * Both paths call the SAME buildConfig/writeConfig — byte-identical guarantee.
 *
 * Throws ConfigError if any identity field is plaintext (propagated from buildConfig).
 * Returns HandlerOutcome { type: 'success' } on success.
 */
export async function runInit(options: InitOptions): Promise<HandlerOutcome> {
  const { projectRoot } = options;

  let buildInput: BuildConfigInput;

  if ('interactive' in options && options.interactive === true) {
    // ── Interactive path (-i wizard) ─────────────────────────────────────────
    const wizardOpts: Parameters<typeof runWizard>[0] = {};
    if (options.wizardInput !== undefined) wizardOpts.input = options.wizardInput;
    if (options.wizardOutput !== undefined) wizardOpts.output = options.wizardOutput;
    if (options.capabilitiesOverride !== undefined) {
      wizardOpts.capabilitiesOverride = options.capabilitiesOverride;
    }
    const wizardResult = await runWizard(wizardOpts);
    buildInput = wizardResultToBuildInput(wizardResult);
  } else {
    // ── Non-interactive path (flags) ─────────────────────────────────────────
    const opts = options as NonInteractiveInit & { interactive?: false; projectRoot: string };
    if (opts.dialect === 'sqlite') {
      buildInput = {
        dialect: 'sqlite',
        file: opts.file,
        ...(opts.driver !== undefined ? { driver: opts.driver } : {}),
      };
    } else {
      buildInput = {
        dialect: 'mssql',
        server: opts.server,
        database: opts.database,
        user: opts.user,
        password: opts.password,
        ...(opts.port !== undefined ? { port: opts.port } : {}),
        ...(opts.domain !== undefined ? { domain: opts.domain } : {}),
      };
    }
  }

  // ── Build + write config ───────────────────────────────────────────────────
  // buildConfig throws ConfigError if any identity field is plaintext.
  // writeConfig serializes with deterministic key order (ADR-008).
  const config = buildConfig(buildInput);
  const configString = writeConfig(config);
  const configPath = join(projectRoot, 'dbgraph.config.json');
  writeFileSync(configPath, configString, 'utf-8');

  // ── .gitignore writer ──────────────────────────────────────────────────────
  ensureGitignored(projectRoot);

  // ── First sync (Batch D seam) ──────────────────────────────────────────────
  // Use injected _syncFn if provided (test isolation), otherwise call the real seam.
  const syncFn = options._syncFn ?? syncAfterInit;
  await syncFn(projectRoot);

  return { type: 'success' };
}
