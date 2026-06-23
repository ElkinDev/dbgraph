/**
 * install command handler — phase-9.5a (multi-agent install, US-038).
 * Spec: dbgraph install idempotently wires the agent MCP config (US-024/US-038).
 * Design: AGENT_TABLE drives a multi-pass loop; each row owns its cross-platform path +
 *   pure merge/remove pair. Writers reuse existing mergeMcpConfig/removeMcpConfig for
 *   mcpServers-family agents. runInstall body is format-blind (raw text in/out).
 *
 * Key design points:
 *   - fs/path operations injected as a seam (FsSeam) so unit tests run without touching the real FS.
 *   - resolveConfigPath(platform, env): detects claude_desktop_config.json path per OS (kept for compat).
 *   - mergeMcpConfig(rawJson, entry): adds mcpServers.dbgraph-mcp entry idempotently (object-level).
 *   - removeMcpConfig(rawJson): removes only the dbgraph-mcp entry, leaves others intact (object-level).
 *   - AGENT_TABLE: typed source of truth; adding a 7th agent = one row + one test.
 *   - homeRoot(platform, env): centralises USERPROFILE (win32) / HOME (posix) choice.
 *   - When NO agent detected: print manual snippet, exit 0 (NOT a failure — US-024 preserved).
 *
 * ADR-004: imports ONLY from node builtins. The CLI dispatch calls this with the real FS.
 *   NEVER imports src/mcp/** or src/adapters/**.
 */

import { win32 as pathWin32, posix as pathPosix } from 'node:path';

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
    // Use path.win32.join so the result always has backslash separators,
    // regardless of the host OS this code runs on (fixes Linux CI).
    return pathWin32.join(appData, 'Claude', CLAUDE_CONFIG_FILE);
  }

  // Linux, macOS, and other POSIX platforms
  const home = env['HOME'];
  if (home === undefined || home === '') return undefined;
  // Use path.posix.join so the result always has forward-slash separators,
  // regardless of the host OS this code runs on.
  return pathPosix.join(home, '.config', 'Claude', CLAUDE_CONFIG_FILE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent table types (US-038 — phase-9.5a)
// ─────────────────────────────────────────────────────────────────────────────

/** The config-file format each agent uses. */
export type AgentFormat = 'mcpServers' | 'vscode' | 'opencode' | 'codex-toml';

/** Environment variable record injected from the caller. */
export type Env = Record<string, string | undefined>;

/** The outcome of processing one AGENT_TABLE row in a single runInstall pass. */
export type AgentAction = 'installed' | 'already' | 'removed' | 'absent' | 'skipped';

/** Per-agent result recorded by the multi-pass loop. */
export interface AgentResult {
  readonly agent: string;
  readonly action: AgentAction;
  readonly path?: string;
}

/**
 * One row in AGENT_TABLE.
 * merge/remove operate on RAW TEXT (parse→apply→serialize internally) so the
 * loop body is format-blind; the text layer detects no-op by string equality.
 */
export interface AgentDescriptor {
  readonly id: string;
  readonly displayName: string;
  resolvePath(platform: string, env: Env): string | undefined;
  readonly format: AgentFormat;
  merge(content: string, entry: McpServerEntry): string;
  remove(content: string): string;
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
// homeRoot helper — centralises USERPROFILE (win32) / HOME (posix) choice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the user's home-equivalent root directory for the given platform.
 * win32  → env.USERPROFILE
 * posix  → env.HOME
 * Returns undefined when the required variable is missing or empty.
 */
export function homeRoot(platform: string, env: Env): string | undefined {
  if (platform === 'win32') {
    const up = env['USERPROFILE'];
    if (up === undefined || up === '') return undefined;
    return up;
  }
  const home = env['HOME'];
  if (home === undefined || home === '') return undefined;
  return home;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw-text wrappers for the mcpServers-family rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps the existing object-level mergeMcpConfig into a raw-text operation.
 * Parses the JSON text, applies the merge, and serializes back.
 * If the text is empty or malformed, treats it as {}.
 * Returns the input text unchanged when the entry is already present (idempotent).
 */
function mergeMcpText(content: string, entry: McpServerEntry): string {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const updated = mergeMcpConfig(config, entry);
  if (updated === config) return content;
  return JSON.stringify(updated, null, 2) + '\n';
}

/**
 * Wraps the existing object-level removeMcpConfig into a raw-text operation.
 * Parses the JSON text, applies the remove, and serializes back.
 * Returns the input text unchanged when the entry is absent.
 */
function removeMcpText(content: string): string {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const updated = removeMcpConfig(config);
  if (updated === config) return content;
  return JSON.stringify(updated, null, 2) + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT_TABLE — single source of truth for all supported agents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed table of supported MCP agents.
 * Each row owns its cross-platform path resolution, config format, and
 * pure raw-text merge/remove pair.
 * To add a 7th agent: append one AgentDescriptor row + one test.
 */
export const AGENT_TABLE: readonly AgentDescriptor[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    format: 'mcpServers',
    resolvePath(platform: string, env: Env): string | undefined {
      // Reuses the exact resolveConfigPath logic — APPDATA on win32, HOME on posix
      return resolveConfigPath(platform, env);
    },
    merge(content: string, entry: McpServerEntry): string {
      return mergeMcpText(content, entry);
    },
    remove(content: string): string {
      return removeMcpText(content);
    },
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    format: 'mcpServers',
    resolvePath(platform: string, env: Env): string | undefined {
      const root = homeRoot(platform, env);
      if (root === undefined) return undefined;
      return platform === 'win32'
        ? pathWin32.join(root, '.cursor', 'mcp.json')
        : pathPosix.join(root, '.cursor', 'mcp.json');
    },
    merge(content: string, entry: McpServerEntry): string {
      return mergeMcpText(content, entry);
    },
    remove(content: string): string {
      return removeMcpText(content);
    },
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    format: 'mcpServers',
    resolvePath(platform: string, env: Env): string | undefined {
      const root = homeRoot(platform, env);
      if (root === undefined) return undefined;
      return platform === 'win32'
        ? pathWin32.join(root, '.gemini', 'settings.json')
        : pathPosix.join(root, '.gemini', 'settings.json');
    },
    merge(content: string, entry: McpServerEntry): string {
      return mergeMcpText(content, entry);
    },
    remove(content: string): string {
      return removeMcpText(content);
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Manual snippet (printed when no MCP agent config is detected)
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
 * Idempotently installs or removes the dbgraph-mcp server entry across all
 * detected MCP agents (Claude Code, Cursor, Gemini CLI, and future rows).
 *
 * Multi-pass loop over AGENT_TABLE:
 *   • resolvePath returns undefined → skipped (env var missing)
 *   • file does not exist           → absent  (agent not installed, no file created)
 *   • next === raw (no-op)          → already / absent (no write)
 *   • changed                       → write and record installed / removed
 *
 * When every result is {skipped, absent}: prints MANUAL_SNIPPET and exits 0
 * (US-024 preserved). Otherwise prints a per-agent summary.
 *
 * Never throws for missing agent — that is a soft failure with exit 0.
 * InstallOptions and InstallOutcome shapes are UNCHANGED (dispatch.ts unaffected).
 */
export async function runInstall(options: InstallOptions = {}): Promise<InstallOutcome> {
  const {
    remove = false,
    fs: fsSeam = realFsSeam,
    platform = process.platform,
    env = process.env as Record<string, string | undefined>,
    write = (text: string) => process.stdout.write(text),
  } = options;

  const results: AgentResult[] = [];

  // ── Multi-pass loop over AGENT_TABLE ──────────────────────────────────────
  for (const row of AGENT_TABLE) {
    const configPath = row.resolvePath(platform, env);

    // env var missing — skip this agent entirely
    if (configPath === undefined) {
      results.push({ agent: row.id, action: 'skipped' });
      continue;
    }

    // agent not installed (config file absent) — skip, never create the file
    if (!fsSeam.exists(configPath)) {
      results.push({ agent: row.id, action: 'absent' });
      continue;
    }

    // ── Read raw text (catch parse error → treat as empty per format) ───────
    let raw: string;
    try {
      raw = fsSeam.readFile(configPath);
    } catch {
      raw = row.format === 'codex-toml' ? '' : '{}';
    }

    // ── Apply merge or remove (pure, format-blind at this level) ────────────
    const next = remove ? row.remove(raw) : row.merge(raw, DEFAULT_MCP_ENTRY);

    if (next === raw) {
      // No change — already in desired state
      results.push({ agent: row.id, action: remove ? 'absent' : 'already', path: configPath });
    } else {
      fsSeam.writeFile(configPath, next);
      results.push({ agent: row.id, action: remove ? 'removed' : 'installed', path: configPath });
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────
  const allSkippedOrAbsent = results.every(
    (r) => r.action === 'skipped' || r.action === 'absent',
  );

  if (allSkippedOrAbsent) {
    write(MANUAL_SNIPPET);
  } else {
    for (const r of results) {
      if (r.action !== 'skipped' && r.action !== 'absent') {
        const row = AGENT_TABLE.find((t) => t.id === r.agent);
        const name = row?.displayName ?? r.agent;
        write(`${name} → ${r.action}${r.path !== undefined ? ` (${r.path})` : ''}\n`);
      }
    }
  }

  return { type: 'success' };
}
