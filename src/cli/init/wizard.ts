/**
 * Interactive -i wizard — task 3.1 (phase-4-cli-config).
 *
 * Driven by the dialect's CapabilityMatrix (via capabilitiesFor from the barrel —
 * ADR-004: cli NEVER imports adapters directly). Offers ONLY object types listed
 * in CapabilityMatrix.supported. Connection-identity fields MUST be ${env:VAR}
 * references; a literal value triggers a re-prompt instead of a hard throw.
 *
 * Secret / password prompts: the readline interface is created with terminal:false,
 * which means readline itself does NOT echo input back to the output stream. The
 * wizard writes explicit prompt labels to the output writable and reads answers via
 * an async line iterator. This is the correct cross-platform approach (tested on
 * Windows): readline.question() does NOT work reliably with Readable.from()-backed
 * streams in tests because Readable.from() emits all lines synchronously before any
 * question() callback can be registered, causing an immediate 'readline was closed'
 * error. The async-iterator approach consumes lines lazily, one per iteration step.
 *
 * See docs/learnings.md: "wizard readline: async iterator vs question() for testability"
 *
 * ZERO new runtime deps: only node:readline + node builtins.
 *
 * ADR-004: imports ONLY from ../../index.js (public barrel) + node builtins.
 */

import * as readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { capabilitiesFor } from '../../index.js';
import type { CapabilityMatrix, NodeKind } from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type Level = 'off' | 'metadata' | 'full';

export type WizardResult =
  | {
      readonly dialect: 'sqlite';
      readonly file: string;
      readonly offeredKinds: readonly NodeKind[];
      readonly levels: Partial<Record<NodeKind, Level>>;
    }
  | {
      readonly dialect: 'mssql';
      readonly server: string;
      readonly database: string;
      readonly user: string;
      readonly password: string;
      readonly port?: string;
      readonly domain?: string;
      readonly offeredKinds: readonly NodeKind[];
      readonly levels: Partial<Record<NodeKind, Level>>;
    };

export interface WizardOptions {
  /** Injected readable for testing — defaults to process.stdin */
  input?: Readable;
  /** Injected writable for testing — defaults to process.stdout */
  output?: Writable;
  /** Override the capability matrix lookup (for tests) */
  capabilitiesOverride?: CapabilityMatrix;
}

// ─────────────────────────────────────────────────────────────────────────────
// Env-ref validation
// ─────────────────────────────────────────────────────────────────────────────

const ENV_REF_RE = /^\$\{env:[A-Z_][A-Z0-9_]*\}$/;

function isEnvRef(value: string): boolean {
  return ENV_REF_RE.test(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Line reader — wraps the async iterator for sequential question/answer flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thin wrapper that exposes a readline interface as a sequential "next line" reader.
 * Uses the async iterator protocol so lines are consumed lazily — one per call.
 * This is required for testability: Readable.from() emits all lines synchronously
 * before any readline.question() callback can fire, causing immediate close errors.
 * The async iterator consumes lazily and works correctly with both real TTYs and
 * injected test streams.
 */
class LineReader {
  private readonly _iter: AsyncIterator<string>;
  private readonly _out: Writable;

  constructor(rl: readline.Interface, out: Writable) {
    // readline.Interface implements AsyncIterable<string>; access the iterator directly.
    this._iter = (rl as unknown as AsyncIterable<string>)[Symbol.asyncIterator]();
    this._out = out;
  }

  /** Write a prompt to the output writable */
  prompt(text: string): void {
    this._out.write(text);
  }

  /**
   * Read the next line from the underlying stream.
   * Returns null when the stream ends (EOF).
   */
  async nextLine(): Promise<string | null> {
    const { value, done } = await this._iter.next();
    if (done === true || value === undefined) {
      return null;
    }
    return value.trim();
  }

  /**
   * Ask a question: write the prompt label then read the next line.
   */
  async ask(label: string): Promise<string> {
    this.prompt(label);
    const line = await this.nextLine();
    return line ?? '';
  }

  /**
   * Ask for a connection-identity field that MUST be a ${env:VAR} reference.
   * Re-prompts on literal values with a rejection message.
   * When isSecret is true, the prompt label is written but NO echo happens
   * (readline was created with terminal:false, so readline itself never echoes).
   */
  async askEnvRef(field: string, exampleVar: string, isSecret = false): Promise<string> {
    while (true) {
      const label = isSecret
        ? `  ${field} [hidden, enter \${env:VAR}]: `
        : `  ${field} (e.g. \${env:${exampleVar}}): `;
      this.prompt(label);
      const line = await this.nextLine();
      const value = line ?? '';

      if (isEnvRef(value)) {
        if (isSecret) {
          this.prompt('\n'); // move to next line after hidden input
        }
        return value;
      }

      this.prompt(
        `  [!] "${field}" must be a \${env:VAR} reference, not a literal value.\n` +
          `      Example: \${env:${exampleVar}}\n`,
      );
    }
  }

  /**
   * Ask whether to include an object type and at what level.
   * Returns null when user declines. Defaults to 'full' on empty/invalid input.
   */
  async askLevel(kind: NodeKind): Promise<Level | null> {
    const include = await this.ask(`  Include "${kind}" objects? [y/n]: `);
    if (include.toLowerCase().startsWith('n')) {
      return null;
    }
    const levelRaw = await this.ask(
      `  Level for "${kind}" [off/metadata/full, default: full]: `,
    );
    const level = levelRaw === '' ? 'full' : levelRaw;
    if (level === 'off' || level === 'metadata' || level === 'full') {
      return level;
    }
    return 'full';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main wizard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the interactive init wizard.
 *
 * Returns a WizardResult structurally identical to BuildConfigInput so the caller
 * (init.ts) can pass it directly to buildConfig() — ensuring byte-identity with
 * the flag form (ADR-008, task 3.3).
 *
 * For unit tests: inject `input` (Readable from Readable.from([...lines])) and
 * `output` (a Writable that captures output). The `capabilitiesOverride` bypasses
 * the real capabilitiesFor() call.
 */
export async function runWizard(options: WizardOptions = {}): Promise<WizardResult> {
  const inputStream = options.input ?? (process.stdin as unknown as Readable);
  const outputStream = options.output ?? (process.stdout as unknown as Writable);

  // Create readline with terminal:false so it NEVER echoes typed input.
  // Prompts are written explicitly via LineReader.prompt(). This is the
  // correct pattern for testing: readline with terminal:false does not echo,
  // the async-iterator consumption is lazy (unlike Readable.from bursting all
  // lines at once into readline.question() callbacks).
  const rl = readline.createInterface({
    input: inputStream,
    output: outputStream,
    terminal: false,
  });

  const reader = new LineReader(rl, outputStream);

  try {
    reader.prompt('dbgraph interactive init\n\n');

    // ── Step 1: dialect ──────────────────────────────────────────────────────
    const dialectRaw = await reader.ask('Dialect [sqlite/mssql]: ');
    const dialect = dialectRaw.toLowerCase();

    if (dialect !== 'sqlite' && dialect !== 'mssql') {
      throw new Error(`Unknown dialect: "${dialectRaw}". Supported: sqlite, mssql.`);
    }

    const matrix: CapabilityMatrix =
      options.capabilitiesOverride ?? capabilitiesFor(dialect);

    const supportedKinds = [...matrix.supported] as NodeKind[];

    if (dialect === 'sqlite') {
      // ── SQLite: file path ──────────────────────────────────────────────────
      const file = await reader.ask('SQLite file path: ');

      // ── Object type levels ─────────────────────────────────────────────────
      reader.prompt('\nObject types (based on SQLite capabilities):\n');
      const levels: Partial<Record<NodeKind, Level>> = {};
      for (const kind of supportedKinds) {
        const level = await reader.askLevel(kind);
        if (level !== null) {
          levels[kind] = level;
        }
      }

      return {
        dialect: 'sqlite',
        file,
        offeredKinds: supportedKinds,
        levels,
      };
    } else {
      // ── MSSQL: connection identity (all must be ${env:VAR}) ────────────────
      reader.prompt('\nMSSQL connection (all fields must be ${env:VAR} references):\n');

      const server = await reader.askEnvRef('server', 'DBGRAPH_DB_SERVER');
      const database = await reader.askEnvRef('database', 'DBGRAPH_DB_NAME');
      const user = await reader.askEnvRef('user', 'DBGRAPH_DB_USER');
      const password = await reader.askEnvRef('password', 'DBGRAPH_DB_PASSWORD', true);

      // Optional: port
      const portRaw = await reader.ask('  port (leave empty to skip): ');
      const port = portRaw === '' ? undefined : portRaw;

      // Optional: domain
      const domainRaw = await reader.ask('  domain (leave empty to skip): ');
      const domain = domainRaw === '' ? undefined : domainRaw;

      // ── Object type levels ─────────────────────────────────────────────────
      reader.prompt('\nObject types (based on MSSQL capabilities):\n');
      const levels: Partial<Record<NodeKind, Level>> = {};
      for (const kind of supportedKinds) {
        const level = await reader.askLevel(kind);
        if (level !== null) {
          levels[kind] = level;
        }
      }

      const result: {
        dialect: 'mssql';
        server: string;
        database: string;
        user: string;
        password: string;
        port?: string;
        domain?: string;
        offeredKinds: readonly NodeKind[];
        levels: Partial<Record<NodeKind, Level>>;
      } = {
        dialect: 'mssql',
        server,
        database,
        user,
        password,
        offeredKinds: supportedKinds,
        levels,
      };
      if (port !== undefined) result.port = port;
      if (domain !== undefined) result.domain = domain;
      return result;
    }
  } finally {
    rl.close();
  }
}
