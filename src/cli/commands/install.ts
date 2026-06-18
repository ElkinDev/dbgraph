/**
 * install command handler — task 5.1 / Batch E (phase-5-mcp-server).
 * Spec: dbgraph install idempotently wires the agent MCP config (US-024).
 * Design Decision 9: resolve config path, idempotent merge, --remove, manual snippet fallback.
 *
 * Key design points:
 *   - fs/path operations injected as a seam (FsSeam) so unit tests run without touching the real FS.
 *   - resolveConfigPath(platform, env): detects claude_desktop_config.json path per OS.
 *   - mergeMcpConfig(rawJson, entry): adds mcpServers.dbgraph-mcp entry idempotently.
 *   - removeMcpConfig(rawJson): removes only the dbgraph-mcp entry, leaves others intact.
 *   - When path not found: print manual snippet, exit 0 (NOT a failure).
 *
 * ADR-004: imports ONLY from node builtins. The CLI dispatch calls this with the real FS.
 *   NEVER imports src/mcp/** or src/adapters/**.
 */

import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// File-system seam — injected to make unit tests FS-free
// ─────────────────────────────────────────────────────────────────────────────

export interface FsSeam {
  /** Read a file as UTF-8. Throws if not found. */
  readFile(path: string): string;
  /** Write a file as UTF-8. Creates parent directories implicitly (seam contract). */
  writeFile(path: string, content: string): void;
  /** Returns true if the path exists (file or directory). */
  exists(path: string): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real FS seam — used by the CLI dispatch in production
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const realFsSeam: FsSeam = {
  readFile(path: string): string {
    return readFileSync(path, 'utf-8');
  },
  writeFile(path: string, content: string): void {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, content, 'utf-8');
  },
  exists(path: string): boolean {
    return existsSync(path);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Config path resolution
// ─────────────────────────────────────────────────────────────────────────────

/** The entry name in mcpServers that this tool installs. */
export const MCP_ENTRY_NAME = 'dbgraph-mcp';

/** The expected relative config path inside the Claude config directory. */
const CLAUDE_CONFIG_FILE = 'claude_desktop_config.json';

/**
 * Resolves the platform-specific path to Claude Code's MCP configuration file.
 *
 * Windows: %APPDATA%\Claude\claude_desktop_config.json
 * Linux/macOS: ~/.config/Claude/claude_desktop_config.json
 *
 * Returns undefined when the required environment variable is not set
 * (e.g. APPDATA is missing on Windows, HOME is missing on Linux).
 */
export function resolveConfigPath(
  platform: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (platform === 'win32') {
    const appData = env['APPDATA'];
    if (appData === undefined || appData === '') return undefined;
    return join(appData, 'Claude', CLAUDE_CONFIG_FILE);
  }

  // Linux, macOS, and other POSIX platforms
  const home = env['HOME'];
  if (home === undefined || home === '') return undefined;
  return join(home, '.config', 'Claude', CLAUDE_CONFIG_FILE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Config JSON shape
// ─────────────────────────────────────────────────────────────────────────────

/** The MCP server entry we add to mcpServers. */
export interface McpServerEntry {
  command: string;
  args: string[];
}

/** The shape of the config file (partial — only what we care about). */
interface ClaudeDesktopConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotent merge / remove helpers (PURE — no I/O)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produces the updated config object with the dbgraph-mcp entry merged in.
 * If the entry already exists with the SAME command+args, returns the input unchanged.
 * This makes the operation idempotent: re-running install does not duplicate the entry.
 */
export function mergeMcpConfig(
  config: Record<string, unknown>,
  entry: McpServerEntry,
): Record<string, unknown> {
  const existing = config as ClaudeDesktopConfig;
  const servers = existing.mcpServers ?? {};

  const current = servers[MCP_ENTRY_NAME];
  if (
    current !== undefined &&
    current.command === entry.command &&
    JSON.stringify(current.args) === JSON.stringify(entry.args)
  ) {
    // Already present with identical values — no-op
    return config;
  }

  return {
    ...existing,
    mcpServers: {
      ...servers,
      [MCP_ENTRY_NAME]: entry,
    },
  };
}

/**
 * Produces the updated config object with the dbgraph-mcp entry removed.
 * If the entry does not exist, returns the input unchanged.
 * Other mcpServers entries are preserved.
 */
export function removeMcpConfig(config: Record<string, unknown>): Record<string, unknown> {
  const existing = config as ClaudeDesktopConfig;
  const servers = existing.mcpServers;
  if (servers === undefined || servers[MCP_ENTRY_NAME] === undefined) {
    return config;
  }

  const { [MCP_ENTRY_NAME]: _removed, ...remaining } = servers;
  void _removed;

  return {
    ...existing,
    mcpServers:
      Object.keys(remaining).length === 0
        ? undefined
        : remaining,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual snippet (printed when no Claude agent is detected)
// ─────────────────────────────────────────────────────────────────────────────

/** The documented manual snippet for manual installation. */
export const MANUAL_SNIPPET = `No supported MCP agent config was detected.

To install dbgraph manually, add the following to your MCP configuration:

{
  "mcpServers": {
    "dbgraph-mcp": {
      "command": "npx",
      "args": ["-y", "dbgraph-mcp"]
    }
  }
}

For Claude Code (claude.ai), the config file is typically located at:
  Windows: %APPDATA%\\Claude\\claude_desktop_config.json
  Linux/macOS: ~/.config/Claude/claude_desktop_config.json
`;

// ─────────────────────────────────────────────────────────────────────────────
// Install options
// ─────────────────────────────────────────────────────────────────────────────

export interface InstallOptions {
  /** When true, removes the dbgraph-mcp entry instead of adding it. */
  readonly remove?: boolean;
  /** Injected FS seam (defaults to realFsSeam in production). */
  readonly fs?: FsSeam;
  /** Injected platform string (defaults to process.platform in production). */
  readonly platform?: string;
  /** Injected env record (defaults to process.env in production). */
  readonly env?: Record<string, string | undefined>;
  /** Output writer (defaults to process.stdout.write). */
  readonly write?: (text: string) => void;
}

export interface InstallOutcome {
  readonly type: 'success';
}

// ─────────────────────────────────────────────────────────────────────────────
// The MCP entry we install (consistent across platforms)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MCP_ENTRY: McpServerEntry = {
  command: 'npx',
  args: ['-y', 'dbgraph-mcp'],
};

// ─────────────────────────────────────────────────────────────────────────────
// runInstall — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Idempotently installs or removes the dbgraph-mcp server entry from the
 * Claude Code MCP configuration file.
 *
 * When no config file path can be resolved (missing APPDATA/HOME) or the
 * config file does not exist yet: prints the manual snippet and exits 0.
 *
 * Never throws for missing agent — that is a soft failure with exit 0.
 * Throws for FS errors (permission denied, malformed JSON).
 */
export async function runInstall(options: InstallOptions = {}): Promise<InstallOutcome> {
  const {
    remove = false,
    fs: fsSeam = realFsSeam,
    platform = process.platform,
    env = process.env as Record<string, string | undefined>,
    write = (text: string) => process.stdout.write(text),
  } = options;

  // ── Resolve the config path ────────────────────────────────────────────────
  const configPath = resolveConfigPath(platform, env);

  if (configPath === undefined || !fsSeam.exists(configPath)) {
    write(MANUAL_SNIPPET);
    return { type: 'success' };
  }

  // ── Read existing config (or start with empty object) ─────────────────────
  let rawConfig: Record<string, unknown>;
  try {
    rawConfig = JSON.parse(fsSeam.readFile(configPath)) as Record<string, unknown>;
  } catch {
    // Malformed JSON or empty file — start fresh
    rawConfig = {};
  }

  // ── Apply merge or remove ──────────────────────────────────────────────────
  let updated: Record<string, unknown>;
  if (remove) {
    updated = removeMcpConfig(rawConfig);
    write(`dbgraph-mcp entry removed from ${configPath}\n`);
  } else {
    updated = mergeMcpConfig(rawConfig, DEFAULT_MCP_ENTRY);
    write(`dbgraph-mcp installed at ${configPath}\n`);
  }

  // ── Write back (only when the config actually changed) ────────────────────
  if (updated !== rawConfig) {
    fsSeam.writeFile(configPath, JSON.stringify(updated, null, 2) + '\n');
  } else {
    if (!remove) {
      write('dbgraph-mcp was already installed (no changes made)\n');
    } else {
      write('dbgraph-mcp entry was not present (no changes made)\n');
    }
  }

  return { type: 'success' };
}
