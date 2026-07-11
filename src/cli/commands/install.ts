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

/**
 * Resolves a PROJECT-scoped config path (US-038, phase-7-docs, Decision #1).
 *
 * Joins the given relative segments onto the project root (cwd) using the
 * platform-explicit joiner — pathWin32.join on win32, pathPosix.join elsewhere —
 * so the separators are deterministic regardless of the host OS this code runs on
 * (ADR-008; the node:path host-default join is banned by convention). The segments
 * come from an agent row's `projectPath` (e.g. codex → ['.codex','config.toml']).
 */
export function resolveProjectConfigPath(
  platform: string,
  cwd: string,
  segs: readonly string[],
): string {
  return platform === 'win32'
    ? pathWin32.join(cwd, ...segs)
    : pathPosix.join(cwd, ...segs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent table types (US-038 — phase-9.5a)
// ─────────────────────────────────────────────────────────────────────────────

/** The config-file format each agent uses. */
export type AgentFormat = 'mcpServers' | 'vscode' | 'opencode' | 'codex-toml';

/** Environment variable record injected from the caller. */
export type Env = Record<string, string | undefined>;

/**
 * The outcome of processing one AGENT_TABLE row in a single runInstall pass.
 *
 * 'unsupported' is RETAINED as DORMANT machinery (US-038, phase-7-docs): it is the
 * action reported at project scope for any FUTURE agent whose project-scoped config
 * location cannot be verified (a row with no `projectPath`). As of 2026-07-06 NO
 * shipped agent uses it — all 6 rows (incl. Codex) have a `projectPath`.
 */
export type AgentAction =
  | 'installed'
  | 'already'
  | 'removed'
  | 'absent'
  | 'skipped'
  | 'unsupported';

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
  /**
   * PROJECT-scoped config path segments relative to the project root (cwd), used by
   * `install --project` (US-038). Joined via {@link resolveProjectConfigPath}.
   * ABSENT ⇒ the agent has no verified project scope and is reported 'unsupported'
   * under `--project` (dormant — no shipped row is absent as of 2026-07-06).
   */
  readonly projectPath?: readonly string[];
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
// VS Code writers — servers key, {type:'stdio', command, args}
// ─────────────────────────────────────────────────────────────────────────────

/** The shape of VS Code's servers entry. */
interface VsCodeServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
}

/** The shape of the VS Code mcp.json config file (partial). */
interface VsCodeMcpConfig {
  servers?: Record<string, VsCodeServerEntry>;
  [key: string]: unknown;
}

/**
 * Produces the updated VS Code config object with the dbgraph-mcp entry merged in.
 * Uses the `servers` key (NOT `mcpServers`) with entry shape `{type:'stdio', command, args}`.
 * If the entry already exists with identical values, returns the input unchanged (idempotent).
 */
export function mergeVsCodeConfig(
  config: Record<string, unknown>,
  entry: McpServerEntry,
): Record<string, unknown> {
  const existing = config as VsCodeMcpConfig;
  const servers = existing.servers ?? {};

  const current = servers[MCP_ENTRY_NAME];
  if (
    current !== undefined &&
    current.type === 'stdio' &&
    current.command === entry.command &&
    JSON.stringify(current.args) === JSON.stringify(entry.args)
  ) {
    return config;
  }

  return {
    ...existing,
    servers: {
      ...servers,
      [MCP_ENTRY_NAME]: { type: 'stdio', command: entry.command, args: entry.args },
    },
  };
}

/**
 * Produces the updated VS Code config object with the dbgraph-mcp entry removed.
 * Drops the `servers` key when it empties (mirrors removeMcpConfig → undefined pattern).
 * Other servers entries are preserved.
 */
export function removeVsCodeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const existing = config as VsCodeMcpConfig;
  const servers = existing.servers;
  if (servers === undefined || servers[MCP_ENTRY_NAME] === undefined) {
    return config;
  }

  const { [MCP_ENTRY_NAME]: _removed, ...remaining } = servers;
  void _removed;

  return {
    ...existing,
    servers:
      Object.keys(remaining).length === 0
        ? undefined
        : remaining,
  };
}

/**
 * Raw-text wrapper for VS Code config.
 * Parses JSON, applies mergeVsCodeConfig, serializes back.
 * Returns input unchanged when already in desired state.
 */
function mergeVsCodeText(content: string, entry: McpServerEntry): string {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const updated = mergeVsCodeConfig(config, entry);
  if (updated === config) return content;
  return JSON.stringify(updated, null, 2) + '\n';
}

/**
 * Raw-text wrapper for VS Code config — remove path.
 */
function removeVsCodeText(content: string): string {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const updated = removeVsCodeConfig(config);
  if (updated === config) return content;
  return JSON.stringify(updated, null, 2) + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// opencode writers — mcp key, {type:'local', command:[cmd,...args]} (ARRAY command)
// ─────────────────────────────────────────────────────────────────────────────

/** The shape of an opencode mcp entry — command is a combined array, NO args field. */
interface OpenCodeServerEntry {
  type: 'local';
  command: string[];
}

/** The shape of the opencode config file (partial). */
interface OpenCodeConfig {
  mcp?: Record<string, OpenCodeServerEntry>;
  [key: string]: unknown;
}

/**
 * Produces the updated opencode config object with the dbgraph-mcp entry merged in.
 * Uses the `mcp` key with entry shape `{type:'local', command:[cmd,...args]}`.
 * command is DERIVED from [entry.command, ...entry.args] — NO `args` field written.
 * If the entry already exists with identical values, returns the input unchanged (idempotent).
 */
export function mergeOpenCodeConfig(
  config: Record<string, unknown>,
  entry: McpServerEntry,
): Record<string, unknown> {
  const existing = config as OpenCodeConfig;
  const mcp = existing.mcp ?? {};
  const derivedCommand = [entry.command, ...entry.args];

  const current = mcp[MCP_ENTRY_NAME];
  if (
    current !== undefined &&
    current.type === 'local' &&
    JSON.stringify(current.command) === JSON.stringify(derivedCommand)
  ) {
    return config;
  }

  return {
    ...existing,
    mcp: {
      ...mcp,
      [MCP_ENTRY_NAME]: { type: 'local', command: derivedCommand },
    },
  };
}

/**
 * Produces the updated opencode config object with the dbgraph-mcp entry removed.
 * Drops the `mcp` key when it empties.
 * Other mcp entries are preserved.
 */
export function removeOpenCodeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const existing = config as OpenCodeConfig;
  const mcp = existing.mcp;
  if (mcp === undefined || mcp[MCP_ENTRY_NAME] === undefined) {
    return config;
  }

  const { [MCP_ENTRY_NAME]: _removed, ...remaining } = mcp;
  void _removed;

  return {
    ...existing,
    mcp:
      Object.keys(remaining).length === 0
        ? undefined
        : remaining,
  };
}

/**
 * Raw-text wrapper for opencode config.
 * Parses JSON, applies mergeOpenCodeConfig, serializes back.
 */
function mergeOpenCodeText(content: string, entry: McpServerEntry): string {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const updated = mergeOpenCodeConfig(config, entry);
  if (updated === config) return content;
  return JSON.stringify(updated, null, 2) + '\n';
}

/**
 * Raw-text wrapper for opencode config — remove path.
 */
function removeOpenCodeText(content: string): string {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const updated = removeOpenCodeConfig(config);
  if (updated === config) return content;
  return JSON.stringify(updated, null, 2) + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// Codex TOML micro-writer (in-house, ADR-007 — bounded to the fixed block)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The fixed, byte-deterministic render of the Codex TOML block.
 * Stable key order: command then args.
 * args serialized with a single space after the comma.
 * No trailing newline (the merge/remove functions add it as needed).
 */
export const CODEX_RENDER =
  '[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]';

/** The header line that marks the start of our block. */
const CODEX_HEADER = '[mcp_servers.dbgraph-mcp]';

/**
 * Returns the line index of the CODEX_HEADER in the given lines array,
 * or -1 if not found.
 */
function findCodexHeaderLine(lines: string[]): number {
  return lines.findIndex((l) => l === CODEX_HEADER);
}

/**
 * Given the lines array and the index of the CODEX_HEADER line,
 * returns the exclusive end index of the block (the index of the next
 * top-level table header line, or lines.length if we reach EOF).
 */
function findCodexBlockEnd(lines: string[], headerIdx: number): number {
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*\[/.test(line)) {
      return i;
    }
  }
  return lines.length;
}

/**
 * Idempotently inserts or replaces the CODEX_RENDER block in the given
 * TOML content (line-oriented — NOT a general TOML parser).
 *
 * - Block absent  → append with exactly one blank separator line (when
 *                   file is non-empty) and a single trailing \n.
 * - Block present and byte-equal to CODEX_RENDER → return content unchanged.
 * - Block present and differing → replace the block region only.
 */
export function mergeCodexToml(content: string): string {
  // Split preserving trailing newline: if content ends with \n the last element
  // of split is an empty string — we handle that carefully.
  const lines = content.split('\n');

  // If the last element is '' it is the artifact of a trailing newline — track
  // whether the original content had one so we can preserve it.
  const hadTrailingNewline = content.endsWith('\n') || content === '';

  // Working copy without the trailing '' sentinel
  const workLines = hadTrailingNewline && lines[lines.length - 1] === ''
    ? lines.slice(0, -1)
    : [...lines];

  const headerIdx = findCodexHeaderLine(workLines);

  if (headerIdx === -1) {
    // Block absent — append
    const renderLines = CODEX_RENDER.split('\n');
    if (workLines.length === 0 || (workLines.length === 1 && workLines[0] === '')) {
      // Empty file (or just whitespace)
      return CODEX_RENDER + '\n';
    }
    // Non-empty — ensure exactly one blank separator line
    const result = [...workLines, '', ...renderLines, ''];
    return result.join('\n');
  }

  // Block present — check if it is already byte-equal to CODEX_RENDER
  const blockEndIdx = findCodexBlockEnd(workLines, headerIdx);
  const blockLines = workLines.slice(headerIdx, blockEndIdx);
  const currentBlock = blockLines.join('\n');

  if (currentBlock === CODEX_RENDER) {
    // Already byte-equal — return unchanged (idempotent)
    return content;
  }

  // Block differs — replace only the block region
  const renderLines = CODEX_RENDER.split('\n');
  const before = workLines.slice(0, headerIdx);
  const after = workLines.slice(blockEndIdx);

  const result = [...before, ...renderLines, ...after, ''];
  return result.join('\n');
}

/**
 * Removes the CODEX_RENDER block (header → block-end) from content.
 * Collapses a resulting double blank line. Keeps a single trailing \n.
 * Other [mcp_servers.*] blocks and all other content are preserved verbatim.
 */
export function removeCodexToml(content: string): string {
  if (content === '') return '';

  const lines = content.split('\n');
  const hadTrailingNewline = content.endsWith('\n');
  const workLines = hadTrailingNewline && lines[lines.length - 1] === ''
    ? lines.slice(0, -1)
    : [...lines];

  const headerIdx = findCodexHeaderLine(workLines);
  if (headerIdx === -1) {
    // Block absent — no-op
    return content;
  }

  const blockEndIdx = findCodexBlockEnd(workLines, headerIdx);

  // Remove the block lines
  const before = workLines.slice(0, headerIdx);
  const after = workLines.slice(blockEndIdx);

  // Collapse consecutive blank lines into one (handles the separator blank)
  const combined = [...before, ...after];

  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of combined) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = isBlank;
  }

  // Strip leading blank lines
  while (collapsed.length > 0 && (collapsed[0] ?? '').trim() === '') {
    collapsed.shift();
  }

  // Ensure single trailing newline
  if (collapsed.length === 0) {
    return '\n';
  }

  // Remove trailing blank lines before adding the single trailing newline
  while (collapsed.length > 0 && (collapsed[collapsed.length - 1] ?? '').trim() === '') {
    collapsed.pop();
  }

  return collapsed.join('\n') + '\n';
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
    // Project scope (US-038): <cwd>/.mcp.json — LIVE-verified 2026-07-06.
    projectPath: ['.mcp.json'],
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
    // Project scope (US-038): <cwd>/.cursor/mcp.json — LIVE-verified 2026-07-06.
    projectPath: ['.cursor', 'mcp.json'],
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
    // Project scope (US-038): <cwd>/.gemini/settings.json — LIVE-verified 2026-07-06.
    projectPath: ['.gemini', 'settings.json'],
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
  {
    id: 'vscode',
    displayName: 'VS Code',
    format: 'vscode',
    // Project scope (US-038): <cwd>/.vscode/mcp.json — LIVE-verified 2026-07-06.
    projectPath: ['.vscode', 'mcp.json'],
    resolvePath(platform: string, env: Env): string | undefined {
      const root = homeRoot(platform, env);
      if (root === undefined) return undefined;
      return platform === 'win32'
        ? pathWin32.join(root, '.vscode', 'mcp.json')
        : pathPosix.join(root, '.vscode', 'mcp.json');
    },
    merge(content: string, entry: McpServerEntry): string {
      return mergeVsCodeText(content, entry);
    },
    remove(content: string): string {
      return removeVsCodeText(content);
    },
  },
  {
    id: 'opencode',
    displayName: 'opencode',
    format: 'opencode',
    // Project scope (US-038): <cwd>/opencode.json — LIVE-verified 2026-07-06.
    // NOTE: project location is the repo-root opencode.json (NOT ~/.config/opencode).
    projectPath: ['opencode.json'],
    resolvePath(platform: string, env: Env): string | undefined {
      const root = homeRoot(platform, env);
      if (root === undefined) return undefined;
      return platform === 'win32'
        ? pathWin32.join(root, '.config', 'opencode', 'opencode.json')
        : pathPosix.join(root, '.config', 'opencode', 'opencode.json');
    },
    merge(content: string, entry: McpServerEntry): string {
      return mergeOpenCodeText(content, entry);
    },
    remove(content: string): string {
      return removeOpenCodeText(content);
    },
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    format: 'codex-toml',
    // Project scope (US-038, Decision #5): <cwd>/.codex/config.toml — LIVE-verified
    // 2026-07-06. Reuses the SAME mergeCodexToml writer as global; the project file is
    // TRUST-GATED (the project must be trusted in ~/.codex/config.toml), so the codex
    // summary line carries a trust-caveat suffix (see runInstall project branch).
    projectPath: ['.codex', 'config.toml'],
    resolvePath(platform: string, env: Env): string | undefined {
      const root = homeRoot(platform, env);
      if (root === undefined) return undefined;
      return platform === 'win32'
        ? pathWin32.join(root, '.codex', 'config.toml')
        : pathPosix.join(root, '.codex', 'config.toml');
    },
    merge(content: string, entry: McpServerEntry): string {
      // The render is fixed — the JSON entry param is intentionally ignored
      // (ADR-007: Codex TOML is a bounded micro-writer with a fixed block shape).
      void entry;
      return mergeCodexToml(content);
    },
    remove(content: string): string {
      return removeCodexToml(content);
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Manual snippet (printed when no MCP agent config is detected)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The documented manual snippet printed when no MCP agent config is detected.
 * Supported agents: Claude Code, Cursor, Gemini CLI, VS Code, opencode, Codex CLI.
 * Kept in sync with the E.4 test exact-equality assertion.
 */
export const MANUAL_SNIPPET = `No supported MCP agent config was detected.

Supported agents: Claude Code, Cursor, Gemini CLI, VS Code, opencode, Codex CLI.

To install dbgraph manually, add the following to your agent's MCP configuration:

  For Claude Code, Cursor, and Gemini CLI (mcpServers JSON):
  {
    "mcpServers": {
      "dbgraph-mcp": {
        "command": "npx",
        "args": ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]
      }
    }
  }

  For VS Code (servers JSON):
  {
    "servers": {
      "dbgraph-mcp": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]
      }
    }
  }

  For opencode (mcp JSON):
  {
    "mcp": {
      "dbgraph-mcp": {
        "type": "local",
        "command": ["npx", "-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]
      }
    }
  }

  For Codex CLI (TOML, ~/.codex/config.toml):
  [mcp_servers.dbgraph-mcp]
  command = "npx"
  args = ["-y", "-p", "@elkindev/dbgraph", "dbgraph-mcp"]

Config file locations:
  Claude Code  — Windows: %APPDATA%\\Claude\\claude_desktop_config.json
                 Linux/macOS: ~/.config/Claude/claude_desktop_config.json
  Cursor       — ~/.cursor/mcp.json
  Gemini CLI   — ~/.gemini/settings.json
  VS Code      — ~/.vscode/mcp.json
  opencode     — ~/.config/opencode/opencode.json
  Codex CLI    — ~/.codex/config.toml
`;

// ─────────────────────────────────────────────────────────────────────────────
// Install options
// ─────────────────────────────────────────────────────────────────────────────

export interface InstallOptions {
  /** When true, removes the dbgraph-mcp entry instead of adding it. */
  readonly remove?: boolean;
  /**
   * When true, resolve config paths at PROJECT scope rooted at {@link cwd}
   * (US-038) — create-when-absent for supported agents — instead of user-home
   * scope. When false/omitted, behavior is byte-identical to the shipped global
   * install (Decision #4: absent ⇒ absent, never create).
   */
  readonly project?: boolean;
  /**
   * Project root for `--project` (defaults to process.cwd()). Injected as a seam
   * in unit tests. Ignored when {@link project} is false/omitted.
   */
  readonly cwd?: string;
  /** Injected FS seam (defaults to realFsSeam in production). */
  readonly fs?: FsSeam;
  /** Injected platform string (defaults to process.platform in production). */
  readonly platform?: string;
  /** Injected env record (defaults to process.env in production). */
  readonly env?: Record<string, string | undefined>;
  /** Output writer (defaults to process.stdout.write). */
  readonly write?: (text: string) => void;
  /**
   * Injected agent table (defaults to AGENT_TABLE). Test seam ONLY — lets a suite
   * exercise the DORMANT `unsupported` project path via a synthetic row that has no
   * `projectPath`. Production always uses the shipped AGENT_TABLE.
   */
  readonly agents?: readonly AgentDescriptor[];
}

export interface InstallOutcome {
  readonly type: 'success';
}

// ─────────────────────────────────────────────────────────────────────────────
// The MCP entry we install (consistent across platforms)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MCP_ENTRY: McpServerEntry = {
  command: 'npx',
  args: ['-y', '-p', '@elkindev/dbgraph', 'dbgraph-mcp'],
};

// ─────────────────────────────────────────────────────────────────────────────
// runInstall — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The verbatim trust-caveat suffix appended to Codex's PROJECT summary line
 * (US-038, Decision #5). Codex loads project MCP servers ONLY for TRUSTED projects,
 * so the summary must tell the user how to trust the project. Pinned by the
 * `mcp-server` spec scenario — a single-character drift fails the build.
 */
const CODEX_PROJECT_TRUST_SUFFIX =
  ' (requires trusted project: set trust_level in ~/.codex/config.toml)';

/**
 * Renders a single PROJECT-scope (`--project`) summary line for one agent result.
 *
 * Uses the agent id (not displayName) and project-scoped verbs. Codex's WRITTEN line
 * carries the trust-caveat suffix verbatim. A row that has no `projectPath` is
 * reported 'unsupported' with an actionable message (dormant — no shipped agent).
 * The GLOBAL (no-flag) summary format is UNCHANGED and handled separately.
 */
function projectSummaryLine(id: string, action: AgentAction): string {
  if (action === 'unsupported') {
    return `${id} → not supported with --project\n`;
  }
  const verb =
    action === 'installed'
      ? 'written'
      : action === 'removed'
        ? 'removed'
        : action === 'already'
          ? 'already present'
          : 'absent';
  const suffix = id === 'codex' && action === 'installed' ? CODEX_PROJECT_TRUST_SUFFIX : '';
  return `${id} → ${verb}${suffix}\n`;
}

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
 * PROJECT scope (US-038, `project: true`): paths re-root at {@link InstallOptions.cwd}
 * via {@link resolveProjectConfigPath}; absent supported files are CREATED (Decision #3,
 * install only — `--remove` never creates); Codex reuses the same TOML writer and its
 * written summary carries a trust-caveat suffix (Decision #5); a row with no
 * `projectPath` is reported 'unsupported' (dormant). GLOBAL scope is UNCHANGED and
 * byte-identical to today (Decision #4).
 *
 * Never throws for missing agent — that is a soft failure with exit 0.
 */
export async function runInstall(options: InstallOptions = {}): Promise<InstallOutcome> {
  const {
    remove = false,
    project = false,
    cwd = process.cwd(),
    fs: fsSeam = realFsSeam,
    platform = process.platform,
    env = process.env as Record<string, string | undefined>,
    write = (text: string) => process.stdout.write(text),
    agents = AGENT_TABLE,
  } = options;

  const results: AgentResult[] = [];

  // ── Multi-pass loop over the agent table ──────────────────────────────────
  for (const row of agents) {
    if (project) {
      // ── PROJECT scope (US-038) ────────────────────────────────────────────
      // Dormant: an agent with no verified project-scoped location — NEVER guess.
      if (row.projectPath === undefined) {
        results.push({ agent: row.id, action: 'unsupported' });
        continue;
      }

      const configPath = resolveProjectConfigPath(platform, cwd, row.projectPath);
      const fileExists = fsSeam.exists(configPath);

      // Remove NEVER creates an absent project file (Decision #6).
      if (!fileExists && remove) {
        results.push({ agent: row.id, action: 'absent', path: configPath });
        continue;
      }

      // Create-when-absent: seed '' so the merge-on-empty writer emits the minimal
      // valid doc, then write it (Decision #3). ZERO new writer code.
      let raw: string;
      if (!fileExists) {
        raw = '';
      } else {
        try {
          raw = fsSeam.readFile(configPath);
        } catch {
          raw = row.format === 'codex-toml' ? '' : '{}';
        }
      }

      const next = remove ? row.remove(raw) : row.merge(raw, DEFAULT_MCP_ENTRY);

      if (next === raw) {
        results.push({ agent: row.id, action: remove ? 'absent' : 'already', path: configPath });
      } else {
        fsSeam.writeFile(configPath, next);
        results.push({ agent: row.id, action: remove ? 'removed' : 'installed', path: configPath });
      }
    } else {
      // ── GLOBAL scope (UNCHANGED — byte-identical to shipped) ──────────────
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

      // ── Read raw text (catch parse error → treat as empty per format) ─────
      let raw: string;
      try {
        raw = fsSeam.readFile(configPath);
      } catch {
        raw = row.format === 'codex-toml' ? '' : '{}';
      }

      // ── Apply merge or remove (pure, format-blind at this level) ──────────
      const next = remove ? row.remove(raw) : row.merge(raw, DEFAULT_MCP_ENTRY);

      if (next === raw) {
        // No change — already in desired state
        results.push({ agent: row.id, action: remove ? 'absent' : 'already', path: configPath });
      } else {
        fsSeam.writeFile(configPath, next);
        results.push({ agent: row.id, action: remove ? 'removed' : 'installed', path: configPath });
      }
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────
  if (project) {
    // PROJECT summary: one line per agent (id-based verbs; Codex trust caveat).
    for (const r of results) {
      write(projectSummaryLine(r.agent, r.action));
    }
  } else {
    // GLOBAL summary — UNCHANGED.
    const allSkippedOrAbsent = results.every(
      (r) => r.action === 'skipped' || r.action === 'absent',
    );

    if (allSkippedOrAbsent) {
      write(MANUAL_SNIPPET);
    } else {
      for (const r of results) {
        if (r.action !== 'skipped' && r.action !== 'absent') {
          const row = agents.find((t) => t.id === r.agent);
          const name = row?.displayName ?? r.agent;
          write(`${name} → ${r.action}${r.path !== undefined ? ` (${r.path})` : ''}\n`);
        }
      }
    }
  }

  return { type: 'success' };
}
