/**
 * dbgraph install command test — task 5.1 / Batch E (phase-5-mcp-server).
 * Spec: dbgraph install idempotently wires the agent MCP config (US-024).
 *   - resolveConfigPath: win32 → %APPDATA%\Claude\…, linux/macos → ~/.config/Claude/…
 *   - mergeMcpConfig: idempotent — re-running does not duplicate
 *   - removeMcpConfig: --remove leaves other entries intact
 *   - runInstall: no config detected → prints snippet, exits 0
 *   - fs/path INJECTED as a seam (FsSeam) — no real FS touched in unit tests
 *
 * TDD: RED (module not found) → GREEN → verify all cases.
 * ADR-004: install.ts imports ONLY node builtins.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveConfigPath,
  mergeMcpConfig,
  removeMcpConfig,
  runInstall,
  MCP_ENTRY_NAME,
  MANUAL_SNIPPET,
  AGENT_TABLE,
  homeRoot,
  mergeVsCodeConfig,
  removeVsCodeConfig,
  mergeOpenCodeConfig,
  removeOpenCodeConfig,
  mergeCodexToml,
  removeCodexToml,
  CODEX_RENDER,
  type FsSeam,
  type McpServerEntry,
  type AgentFormat,
  type AgentDescriptor,
  type Env,
  type AgentAction,
  type AgentResult,
} from '../../../src/cli/commands/install.js';

// ─────────────────────────────────────────────────────────────────────────────
// Suite: resolveConfigPath
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveConfigPath', () => {
  it('win32 resolves to APPDATA/Claude/claude_desktop_config.json', () => {
    const path = resolveConfigPath('win32', { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' });
    expect(path).toBe('C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
  });

  it('linux resolves to a path containing .config, Claude, and the config filename', () => {
    const path = resolveConfigPath('linux', { HOME: '/home/test' });
    expect(path).toBeDefined();
    // normalize separators for cross-platform assertion
    const normalized = (path ?? '').replace(/\\/g, '/');
    expect(normalized).toContain('.config/Claude');
    expect(normalized).toMatch(/claude_desktop_config\.json$/);
  });

  it('darwin resolves to a path containing .config, Claude, and the config filename', () => {
    const path = resolveConfigPath('darwin', { HOME: '/Users/test' });
    expect(path).toBeDefined();
    const normalized = (path ?? '').replace(/\\/g, '/');
    expect(normalized).toContain('.config/Claude');
    expect(normalized).toMatch(/claude_desktop_config\.json$/);
  });

  it('win32 with missing APPDATA returns undefined', () => {
    const path = resolveConfigPath('win32', {});
    expect(path).toBeUndefined();
  });

  it('linux with missing HOME returns undefined', () => {
    const path = resolveConfigPath('linux', {});
    expect(path).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: mergeMcpConfig (PURE — no I/O)
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeMcpConfig', () => {
  const entry: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };

  it('adds the entry when mcpServers is absent', () => {
    const result = mergeMcpConfig({}, entry);
    const servers = (result as { mcpServers: Record<string, McpServerEntry> }).mcpServers;
    expect(servers[MCP_ENTRY_NAME]).toEqual(entry);
  });

  it('adds the entry when mcpServers exists but entry is absent', () => {
    const config = { mcpServers: { 'other-mcp': { command: 'other', args: [] } } };
    const result = mergeMcpConfig(config, entry);
    const servers = (result as { mcpServers: Record<string, McpServerEntry> }).mcpServers;
    expect(servers[MCP_ENTRY_NAME]).toEqual(entry);
    expect(servers['other-mcp']).toBeDefined();
  });

  it('does NOT duplicate the entry when it already exists (idempotent)', () => {
    const config = { mcpServers: { [MCP_ENTRY_NAME]: entry } };
    const result = mergeMcpConfig(config, entry);
    // Should return the SAME reference (no-op)
    expect(result).toBe(config);
  });

  it('replaces entry when command differs', () => {
    const old = { command: 'old-command', args: [] };
    const config = { mcpServers: { [MCP_ENTRY_NAME]: old } };
    const result = mergeMcpConfig(config, entry);
    const servers = (result as { mcpServers: Record<string, McpServerEntry> }).mcpServers;
    expect(servers[MCP_ENTRY_NAME]).toEqual(entry);
    // Should NOT be the same reference
    expect(result).not.toBe(config);
  });

  it('preserves other top-level config keys', () => {
    const config = { someOtherKey: 42, mcpServers: {} };
    const result = mergeMcpConfig(config, entry);
    expect((result as Record<string, unknown>)['someOtherKey']).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: removeMcpConfig (PURE — no I/O)
// ─────────────────────────────────────────────────────────────────────────────

describe('removeMcpConfig', () => {
  const entry: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };

  it('removes the entry when present', () => {
    const config = { mcpServers: { [MCP_ENTRY_NAME]: entry } };
    const result = removeMcpConfig(config);
    const servers = (result as { mcpServers?: Record<string, McpServerEntry> }).mcpServers;
    expect(servers).toBeUndefined();
  });

  it('preserves other mcpServers entries', () => {
    const config = {
      mcpServers: {
        [MCP_ENTRY_NAME]: entry,
        'other-mcp': { command: 'other', args: [] },
      },
    };
    const result = removeMcpConfig(config);
    const servers = (result as { mcpServers: Record<string, McpServerEntry> }).mcpServers;
    expect(servers[MCP_ENTRY_NAME]).toBeUndefined();
    expect(servers['other-mcp']).toBeDefined();
  });

  it('is a no-op when entry is absent (returns same ref)', () => {
    const config = { mcpServers: { 'other-mcp': { command: 'other', args: [] } } };
    const result = removeMcpConfig(config);
    expect(result).toBe(config);
  });

  it('is a no-op on empty config (returns same ref)', () => {
    const config = {};
    const result = removeMcpConfig(config);
    expect(result).toBe(config);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake FS seam builder
// ─────────────────────────────────────────────────────────────────────────────

function makeFakeFs(
  files: Record<string, string> = {},
): { seam: FsSeam; written: Record<string, string> } {
  const written: Record<string, string> = {};
  const seam: FsSeam = {
    readFile(path: string): string {
      const content = files[path] ?? written[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    writeFile(path: string, content: string): void {
      written[path] = content;
    },
    exists(path: string): boolean {
      return (files[path] !== undefined) || (written[path] !== undefined);
    },
  };
  return { seam, written };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite: runInstall — full integration via seam
// ─────────────────────────────────────────────────────────────────────────────

describe('runInstall — no agent detected', () => {
  it('prints manual snippet and exits 0 when APPDATA is missing on win32', async () => {
    const output: string[] = [];
    const { seam } = makeFakeFs();

    const result = await runInstall({
      platform: 'win32',
      env: {},
      fs: seam,
      write: (t) => output.push(t),
    });

    expect(result.type).toBe('success');
    expect(output.join('')).toContain('manually');
  });

  it('prints manual snippet and exits 0 when config file does not exist', async () => {
    const output: string[] = [];
    const { seam } = makeFakeFs(); // no files

    const result = await runInstall({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      fs: seam,
      write: (t) => output.push(t),
    });

    expect(result.type).toBe('success');
    expect(output.join('')).toBe(MANUAL_SNIPPET);
  });
});

describe('runInstall — install', () => {
  it('writes the entry when config exists with empty mcpServers', async () => {
    const configPath = 'C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
    const output: string[] = [];
    const { seam, written } = makeFakeFs({ [configPath]: JSON.stringify({}) });

    const result = await runInstall({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      fs: seam,
      write: (t) => output.push(t),
    });

    expect(result.type).toBe('success');
    const savedRaw = written[configPath];
    expect(savedRaw).toBeDefined();
    const saved = JSON.parse(savedRaw ?? '{}') as {
      mcpServers: Record<string, McpServerEntry>;
    };
    expect(saved.mcpServers[MCP_ENTRY_NAME]).toBeDefined();
    expect(saved.mcpServers[MCP_ENTRY_NAME]?.command).toBe('npx');
  });

  it('idempotent — second install does NOT write again (same reference)', async () => {
    const configPath = 'C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
    const existingContent = JSON.stringify({
      mcpServers: {
        [MCP_ENTRY_NAME]: { command: 'npx', args: ['-y', 'dbgraph-mcp'] },
      },
    });
    const { seam, written } = makeFakeFs({ [configPath]: existingContent });
    const writeSpy = vi.fn(seam.writeFile.bind(seam));
    seam.writeFile = writeSpy;

    await runInstall({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      fs: seam,
      write: () => {},
    });

    // writeFile should NOT be called because the entry already exists
    expect(writeSpy).not.toHaveBeenCalled();
    // The file content should be unchanged
    expect(written[configPath]).toBeUndefined();
  });

  it('installs even when config file is malformed JSON (starts fresh)', async () => {
    // Use win32 with a known APPDATA so the path is deterministic on all OSes
    const configPath = 'C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
    const { seam, written } = makeFakeFs({ [configPath]: 'not valid json {{{{' });

    await runInstall({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      fs: seam,
      write: () => {},
    });

    const savedRaw2 = written[configPath];
    expect(savedRaw2).toBeDefined();
    const saved = JSON.parse(savedRaw2 ?? '{}') as {
      mcpServers: Record<string, McpServerEntry>;
    };
    expect(saved.mcpServers[MCP_ENTRY_NAME]).toBeDefined();
  });
});

describe('runInstall — --remove', () => {
  it('removes the entry when present', async () => {
    const configPath = 'C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
    const existingContent = JSON.stringify({
      mcpServers: {
        [MCP_ENTRY_NAME]: { command: 'npx', args: ['-y', 'dbgraph-mcp'] },
        'other-mcp': { command: 'other', args: [] },
      },
    });
    const { seam, written } = makeFakeFs({ [configPath]: existingContent });
    const output: string[] = [];

    const result = await runInstall({
      remove: true,
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      fs: seam,
      write: (t) => output.push(t),
    });

    expect(result.type).toBe('success');
    const savedRaw3 = written[configPath];
    expect(savedRaw3).toBeDefined();
    const saved = JSON.parse(savedRaw3 ?? '{}') as {
      mcpServers?: Record<string, McpServerEntry>;
    };
    expect(saved.mcpServers?.[MCP_ENTRY_NAME]).toBeUndefined();
    // other-mcp must still be there
    expect(saved.mcpServers?.['other-mcp']).toBeDefined();
  });

  it('--remove is a no-op when entry is absent', async () => {
    const configPath = 'C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
    const existingContent = JSON.stringify({ mcpServers: {} });
    const { seam, written } = makeFakeFs({ [configPath]: existingContent });

    const result = await runInstall({
      remove: true,
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      fs: seam,
      write: () => {},
    });

    expect(result.type).toBe('success');
    // No write because no change
    expect(written[configPath]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A.1: Types compile — AgentDescriptor construction
// ─────────────────────────────────────────────────────────────────────────────

describe('A.1: AgentDescriptor and related types', () => {
  it('AgentFormat is a union of the four format strings', () => {
    const formats: AgentFormat[] = ['mcpServers', 'vscode', 'opencode', 'codex-toml'];
    expect(formats).toHaveLength(4);
  });

  it('AgentAction is a union of the five action strings', () => {
    const actions: AgentAction[] = ['installed', 'already', 'removed', 'absent', 'skipped'];
    expect(actions).toHaveLength(5);
  });

  it('AgentResult can be constructed with required fields', () => {
    const result: AgentResult = { agent: 'cursor', action: 'installed', path: '/home/u/.cursor/mcp.json' };
    expect(result.agent).toBe('cursor');
    expect(result.action).toBe('installed');
    expect(result.path).toBe('/home/u/.cursor/mcp.json');
  });

  it('AgentResult path is optional', () => {
    const result: AgentResult = { agent: 'cursor', action: 'skipped' };
    expect(result.path).toBeUndefined();
  });

  it('AgentDescriptor literal compiles and has all required fields', () => {
    const descriptor: AgentDescriptor = {
      id: 'test-agent',
      displayName: 'Test Agent',
      resolvePath: () => '/some/path',
      format: 'mcpServers',
      merge: (content: string, entry: McpServerEntry) => content + JSON.stringify(entry),
      remove: (content: string) => content,
    };
    expect(descriptor.id).toBe('test-agent');
    expect(descriptor.displayName).toBe('Test Agent');
    expect(descriptor.format).toBe('mcpServers');
    expect(typeof descriptor.resolvePath).toBe('function');
    expect(typeof descriptor.merge).toBe('function');
    expect(typeof descriptor.remove).toBe('function');
  });

  it('Env type accepts Record<string, string | undefined>', () => {
    const env: Env = { HOME: '/home/u', MISSING: undefined };
    expect(env['HOME']).toBe('/home/u');
    expect(env['MISSING']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A.2: homeRoot helper
// ─────────────────────────────────────────────────────────────────────────────

describe('A.2: homeRoot helper', () => {
  it('win32 returns USERPROFILE', () => {
    expect(homeRoot('win32', { USERPROFILE: 'C:\\Users\\u' })).toBe('C:\\Users\\u');
  });

  it('linux returns HOME', () => {
    expect(homeRoot('linux', { HOME: '/home/u' })).toBe('/home/u');
  });

  it('win32 returns undefined when USERPROFILE is missing', () => {
    expect(homeRoot('win32', {})).toBeUndefined();
  });

  it('linux returns undefined when HOME is missing', () => {
    expect(homeRoot('linux', {})).toBeUndefined();
  });

  it('win32 returns undefined when USERPROFILE is empty string', () => {
    expect(homeRoot('win32', { USERPROFILE: '' })).toBeUndefined();
  });

  it('posix (darwin) returns HOME', () => {
    expect(homeRoot('darwin', { HOME: '/Users/u' })).toBe('/Users/u');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A.3: AGENT_TABLE — exact paths and resolvePath for all three Batch A rows
// ─────────────────────────────────────────────────────────────────────────────

describe('A.3: AGENT_TABLE rows — claude-code, cursor, gemini', () => {
  const claudeRow = AGENT_TABLE.find((r) => r.id === 'claude-code');
  const cursorRow = AGENT_TABLE.find((r) => r.id === 'cursor');
  const geminiRow = AGENT_TABLE.find((r) => r.id === 'gemini');

  // ── claude-code ─────────────────────────────────────────────────────────────
  it('claude-code row exists', () => {
    expect(claudeRow).toBeDefined();
  });

  it('claude-code format is mcpServers', () => {
    expect(claudeRow?.format).toBe('mcpServers');
  });

  it('claude-code win32 path uses APPDATA', () => {
    const p = claudeRow?.resolvePath('win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' });
    expect(p).toBe('C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
  });

  it('claude-code posix path uses HOME', () => {
    const p = claudeRow?.resolvePath('linux', { HOME: '/home/u' });
    expect(p).toBe('/home/u/.config/Claude/claude_desktop_config.json');
  });

  it('claude-code win32 returns undefined when APPDATA missing', () => {
    expect(claudeRow?.resolvePath('win32', {})).toBeUndefined();
  });

  it('claude-code posix returns undefined when HOME missing', () => {
    expect(claudeRow?.resolvePath('linux', {})).toBeUndefined();
  });

  // ── cursor ───────────────────────────────────────────────────────────────────
  it('cursor row exists', () => {
    expect(cursorRow).toBeDefined();
  });

  it('cursor format is mcpServers', () => {
    expect(cursorRow?.format).toBe('mcpServers');
  });

  it('cursor win32 path: USERPROFILE\\.cursor\\mcp.json', () => {
    const p = cursorRow?.resolvePath('win32', { USERPROFILE: 'C:\\Users\\u' });
    expect(p).toBe('C:\\Users\\u\\.cursor\\mcp.json');
  });

  it('cursor posix path: HOME/.cursor/mcp.json', () => {
    const p = cursorRow?.resolvePath('linux', { HOME: '/home/u' });
    expect(p).toBe('/home/u/.cursor/mcp.json');
  });

  it('cursor win32 returns undefined when USERPROFILE missing', () => {
    expect(cursorRow?.resolvePath('win32', {})).toBeUndefined();
  });

  it('cursor posix returns undefined when HOME missing', () => {
    expect(cursorRow?.resolvePath('linux', {})).toBeUndefined();
  });

  // ── gemini ───────────────────────────────────────────────────────────────────
  it('gemini row exists', () => {
    expect(geminiRow).toBeDefined();
  });

  it('gemini format is mcpServers', () => {
    expect(geminiRow?.format).toBe('mcpServers');
  });

  it('gemini win32 path: USERPROFILE\\.gemini\\settings.json', () => {
    const p = geminiRow?.resolvePath('win32', { USERPROFILE: 'C:\\Users\\u' });
    expect(p).toBe('C:\\Users\\u\\.gemini\\settings.json');
  });

  it('gemini posix path: HOME/.gemini/settings.json', () => {
    const p = geminiRow?.resolvePath('linux', { HOME: '/home/u' });
    expect(p).toBe('/home/u/.gemini/settings.json');
  });

  it('gemini win32 returns undefined when USERPROFILE missing', () => {
    expect(geminiRow?.resolvePath('win32', {})).toBeUndefined();
  });

  it('gemini posix returns undefined when HOME missing', () => {
    expect(geminiRow?.resolvePath('linux', {})).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A.4: RAW-TEXT merge/remove for mcpServers-family rows
// ─────────────────────────────────────────────────────────────────────────────

describe('A.4: RAW-TEXT merge/remove for mcpServers rows', () => {
  const DEFAULT_ENTRY: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };
  const EXPECTED_TEXT = JSON.stringify({ mcpServers: { 'dbgraph-mcp': { command: 'npx', args: ['-y', 'dbgraph-mcp'] } } }, null, 2) + '\n';

  const rows = ['claude-code', 'cursor', 'gemini'] as const;

  for (const rowId of rows) {
    describe(`row: ${rowId}`, () => {
      const getRow = () => AGENT_TABLE.find((r) => r.id === rowId)!;

      it('merge into empty object produces exact serialized text', () => {
        const row = getRow();
        const result = row.merge('{}\n', DEFAULT_ENTRY);
        expect(result).toBe(EXPECTED_TEXT);
      });

      it('merge into empty string (malformed) also produces exact serialized text', () => {
        const row = getRow();
        // empty string parses as error → treated as {} then merged
        const result = row.merge('', DEFAULT_ENTRY);
        expect(result).toBe(EXPECTED_TEXT);
      });

      it('merge when entry already present returns input UNCHANGED (idempotent)', () => {
        const row = getRow();
        const result = row.merge(EXPECTED_TEXT, DEFAULT_ENTRY);
        expect(result).toBe(EXPECTED_TEXT);
      });

      it('merge preserves planted other-mcp entry (EXACT-set)', () => {
        const row = getRow();
        const withOther = JSON.stringify({ mcpServers: { 'other-mcp': { command: 'other', args: [] } } }, null, 2) + '\n';
        const result = row.merge(withOther, DEFAULT_ENTRY);
        const parsed = JSON.parse(result) as { mcpServers: Record<string, McpServerEntry> };
        expect(parsed.mcpServers['dbgraph-mcp']).toEqual(DEFAULT_ENTRY);
        expect(parsed.mcpServers['other-mcp']).toEqual({ command: 'other', args: [] });
        expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
      });

      it('remove deletes only dbgraph-mcp, preserves other-mcp (EXACT-set)', () => {
        const row = getRow();
        const withBoth = JSON.stringify({
          mcpServers: {
            'dbgraph-mcp': DEFAULT_ENTRY,
            'other-mcp': { command: 'other', args: [] },
          },
        }, null, 2) + '\n';
        const result = row.remove(withBoth);
        const parsed = JSON.parse(result) as { mcpServers: Record<string, McpServerEntry> };
        expect(parsed.mcpServers['dbgraph-mcp']).toBeUndefined();
        expect(parsed.mcpServers['other-mcp']).toEqual({ command: 'other', args: [] });
      });

      it('remove when only dbgraph-mcp entry was present drops mcpServers key', () => {
        const row = getRow();
        const result = row.remove(EXPECTED_TEXT);
        const parsed = JSON.parse(result) as { mcpServers?: unknown };
        expect(parsed.mcpServers).toBeUndefined();
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// A.5 / A.6: Multi-pass runInstall — Cursor + Gemini integration + regression
// ─────────────────────────────────────────────────────────────────────────────

describe('A.5/A.6: runInstall multi-pass loop — Cursor + Gemini integration', () => {
  const DEFAULT_ENTRY: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };

  it('win32: Cursor config gets dbgraph-mcp entry when file exists', async () => {
    const cursorPath = 'C:\\Users\\u\\.cursor\\mcp.json';
    const { seam, written } = makeFakeFs({ [cursorPath]: JSON.stringify({}) });
    const output: string[] = [];

    const result = await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: (t) => output.push(t),
    });

    expect(result.type).toBe('success');
    const saved = JSON.parse(written[cursorPath]!) as { mcpServers: Record<string, McpServerEntry> };
    expect(saved.mcpServers['dbgraph-mcp']).toEqual(DEFAULT_ENTRY);
  });

  it('posix: Cursor config gets dbgraph-mcp entry when file exists', async () => {
    const cursorPath = '/home/u/.cursor/mcp.json';
    const { seam, written } = makeFakeFs({ [cursorPath]: JSON.stringify({}) });

    await runInstall({
      platform: 'linux',
      env: { HOME: '/home/u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[cursorPath]!) as { mcpServers: Record<string, McpServerEntry> };
    expect(saved.mcpServers['dbgraph-mcp']).toEqual(DEFAULT_ENTRY);
  });

  it('win32: Gemini config gets dbgraph-mcp entry when file exists', async () => {
    const geminiPath = 'C:\\Users\\u\\.gemini\\settings.json';
    const { seam, written } = makeFakeFs({ [geminiPath]: JSON.stringify({}) });

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[geminiPath]!) as { mcpServers: Record<string, McpServerEntry> };
    expect(saved.mcpServers['dbgraph-mcp']).toEqual(DEFAULT_ENTRY);
  });

  it('posix: Gemini config gets dbgraph-mcp entry when file exists', async () => {
    const geminiPath = '/home/u/.gemini/settings.json';
    const { seam, written } = makeFakeFs({ [geminiPath]: JSON.stringify({}) });

    await runInstall({
      platform: 'linux',
      env: { HOME: '/home/u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[geminiPath]!) as { mcpServers: Record<string, McpServerEntry> };
    expect(saved.mcpServers['dbgraph-mcp']).toEqual(DEFAULT_ENTRY);
  });

  it('absent config file is skipped — no file created (absent)', async () => {
    // Cursor config does NOT exist; env present but file absent
    const { seam, written } = makeFakeFs({});
    const output: string[] = [];

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: (t) => output.push(t),
    });

    // No files written for Cursor (or anything — all absent)
    expect(Object.keys(written)).toHaveLength(0);
    // Manual snippet printed
    expect(output.join('')).toBe(MANUAL_SNIPPET);
  });

  it('one detected agent among several absent ones configures ONLY the detected one', async () => {
    // Only Cursor file exists
    const cursorPath = 'C:\\Users\\u\\.cursor\\mcp.json';
    const { seam, written } = makeFakeFs({ [cursorPath]: JSON.stringify({}) });
    const output: string[] = [];

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: (t) => output.push(t),
    });

    // Only cursor was written
    expect(Object.keys(written)).toHaveLength(1);
    expect(written[cursorPath]).toBeDefined();
    // No file created for gemini (absent)
    const geminiPath = 'C:\\Users\\u\\.gemini\\settings.json';
    expect(written[geminiPath]).toBeUndefined();
  });

  it('all env vars unset — prints MANUAL_SNIPPET', async () => {
    const { seam } = makeFakeFs({});
    const output: string[] = [];

    await runInstall({
      platform: 'win32',
      env: {},
      fs: seam,
      write: (t) => output.push(t),
    });

    expect(output.join('')).toBe(MANUAL_SNIPPET);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A.6: Claude Code regression — EXISTING suite still passes after table refactor
// ─────────────────────────────────────────────────────────────────────────────

describe('A.6 regression: Claude Code install via AGENT_TABLE loop', () => {
  const claudePath = 'C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
  const env = { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' };
  const DEFAULT_ENTRY: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };

  it('idempotent re-install does not write again', async () => {
    const existingContent = JSON.stringify({ mcpServers: { [MCP_ENTRY_NAME]: DEFAULT_ENTRY } });
    const { seam, written } = makeFakeFs({ [claudePath]: existingContent });
    const writeSpy = vi.fn(seam.writeFile.bind(seam));
    seam.writeFile = writeSpy;

    await runInstall({ platform: 'win32', env, fs: seam, write: () => {} });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(written[claudePath]).toBeUndefined();
  });

  it('--remove removes only dbgraph-mcp and preserves other-mcp', async () => {
    const existingContent = JSON.stringify({
      mcpServers: {
        [MCP_ENTRY_NAME]: DEFAULT_ENTRY,
        'other-mcp': { command: 'other', args: [] },
      },
    });
    const { seam, written } = makeFakeFs({ [claudePath]: existingContent });

    await runInstall({ remove: true, platform: 'win32', env, fs: seam, write: () => {} });

    const saved = JSON.parse(written[claudePath]!) as { mcpServers: Record<string, McpServerEntry> };
    expect(saved.mcpServers[MCP_ENTRY_NAME]).toBeUndefined();
    expect(saved.mcpServers['other-mcp']).toBeDefined();
  });

  it('malformed JSON starts fresh and installs', async () => {
    const { seam, written } = makeFakeFs({ [claudePath]: 'not valid json {{{{' });

    await runInstall({ platform: 'win32', env, fs: seam, write: () => {} });

    const saved = JSON.parse(written[claudePath]!) as { mcpServers: Record<string, McpServerEntry> };
    expect(saved.mcpServers[MCP_ENTRY_NAME]).toEqual(DEFAULT_ENTRY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.1: mergeVsCodeConfig / removeVsCodeConfig — servers key, {type:'stdio',…}
// ─────────────────────────────────────────────────────────────────────────────

describe('B.1: mergeVsCodeConfig / removeVsCodeConfig', () => {
  const DEFAULT_ENTRY: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };

  it('fresh add yields servers[dbgraph-mcp] === { type:stdio, command, args }', () => {
    const result = mergeVsCodeConfig({}, DEFAULT_ENTRY);
    const servers = (result as { servers: Record<string, unknown> }).servers;
    expect(servers['dbgraph-mcp']).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] });
  });

  it('fresh add does NOT produce a mcpServers key (servers-vs-mcpServers)', () => {
    const result = mergeVsCodeConfig({}, DEFAULT_ENTRY);
    expect((result as Record<string, unknown>)['mcpServers']).toBeUndefined();
  });

  it('re-add returns the SAME reference (idempotent)', () => {
    const existing: Record<string, unknown> = {
      servers: { 'dbgraph-mcp': { type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] } },
    };
    const result = mergeVsCodeConfig(existing, DEFAULT_ENTRY);
    expect(result).toBe(existing);
  });

  it('planted servers.other is preserved EXACT-set after merge', () => {
    const config: Record<string, unknown> = {
      servers: { other: { type: 'stdio', command: 'other', args: [] } },
    };
    const result = mergeVsCodeConfig(config, DEFAULT_ENTRY);
    const servers = (result as { servers: Record<string, unknown> }).servers;
    expect(servers['dbgraph-mcp']).toBeDefined();
    expect(servers['other']).toEqual({ type: 'stdio', command: 'other', args: [] });
    expect(Object.keys(servers)).toHaveLength(2);
  });

  it('remove deletes ONLY dbgraph-mcp (planted other preserved)', () => {
    const config: Record<string, unknown> = {
      servers: {
        'dbgraph-mcp': { type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] },
        other: { type: 'stdio', command: 'other', args: [] },
      },
    };
    const result = removeVsCodeConfig(config);
    const servers = (result as { servers: Record<string, unknown> }).servers;
    expect(servers['dbgraph-mcp']).toBeUndefined();
    expect(servers['other']).toEqual({ type: 'stdio', command: 'other', args: [] });
  });

  it('remove drops servers key when dbgraph-mcp was the only entry', () => {
    const config: Record<string, unknown> = {
      servers: { 'dbgraph-mcp': { type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] } },
    };
    const result = removeVsCodeConfig(config);
    expect((result as Record<string, unknown>)['servers']).toBeUndefined();
  });

  it('remove on empty config returns same ref (no-op)', () => {
    const config: Record<string, unknown> = {};
    expect(removeVsCodeConfig(config)).toBe(config);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.2: AGENT_TABLE — vscode row paths
// ─────────────────────────────────────────────────────────────────────────────

describe('B.2: AGENT_TABLE vscode row', () => {
  const vsRow = AGENT_TABLE.find((r) => r.id === 'vscode');

  it('vscode row exists', () => {
    expect(vsRow).toBeDefined();
  });

  it('vscode format is vscode', () => {
    expect(vsRow?.format).toBe('vscode');
  });

  it('vscode win32 path: USERPROFILE\\.vscode\\mcp.json', () => {
    const p = vsRow?.resolvePath('win32', { USERPROFILE: 'C:\\Users\\u' });
    expect(p).toBe('C:\\Users\\u\\.vscode\\mcp.json');
  });

  it('vscode posix path: HOME/.vscode/mcp.json', () => {
    const p = vsRow?.resolvePath('linux', { HOME: '/home/u' });
    expect(p).toBe('/home/u/.vscode/mcp.json');
  });

  it('vscode win32 returns undefined when USERPROFILE absent', () => {
    expect(vsRow?.resolvePath('win32', {})).toBeUndefined();
  });

  it('vscode posix returns undefined when HOME absent', () => {
    expect(vsRow?.resolvePath('linux', {})).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B.3: VS Code integration via runInstall
// ─────────────────────────────────────────────────────────────────────────────

describe('B.3: runInstall — VS Code integration', () => {
  it('win32: written bytes contain servers.dbgraph-mcp with type:stdio and NO mcpServers key', async () => {
    const vsPath = 'C:\\Users\\u\\.vscode\\mcp.json';
    const { seam, written } = makeFakeFs({ [vsPath]: JSON.stringify({}) });

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[vsPath]!) as Record<string, unknown>;
    const servers = saved['servers'] as Record<string, unknown>;
    expect(servers).toBeDefined();
    expect(servers['dbgraph-mcp']).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] });
    expect(saved['mcpServers']).toBeUndefined();
  });

  it('posix: written bytes contain servers.dbgraph-mcp with type:stdio and NO mcpServers key', async () => {
    const vsPath = '/home/u/.vscode/mcp.json';
    const { seam, written } = makeFakeFs({ [vsPath]: JSON.stringify({}) });

    await runInstall({
      platform: 'linux',
      env: { HOME: '/home/u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[vsPath]!) as Record<string, unknown>;
    const servers = saved['servers'] as Record<string, unknown>;
    expect(servers['dbgraph-mcp']).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] });
    expect(saved['mcpServers']).toBeUndefined();
  });

  it('idempotent re-run writes nothing', async () => {
    const vsPath = 'C:\\Users\\u\\.vscode\\mcp.json';
    const existingContent = JSON.stringify({
      servers: { 'dbgraph-mcp': { type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] } },
    }, null, 2) + '\n';
    const { seam, written } = makeFakeFs({ [vsPath]: existingContent });
    const writeSpy = vi.fn(seam.writeFile.bind(seam));
    seam.writeFile = writeSpy;

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(written[vsPath]).toBeUndefined();
  });

  it('--remove deletes only dbgraph-mcp, planted servers.other preserved', async () => {
    const vsPath = 'C:\\Users\\u\\.vscode\\mcp.json';
    const existingContent = JSON.stringify({
      servers: {
        'dbgraph-mcp': { type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] },
        other: { type: 'stdio', command: 'other', args: [] },
      },
    }, null, 2) + '\n';
    const { seam, written } = makeFakeFs({ [vsPath]: existingContent });

    await runInstall({
      remove: true,
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[vsPath]!) as { servers: Record<string, unknown> };
    expect(saved.servers['dbgraph-mcp']).toBeUndefined();
    expect(saved.servers['other']).toEqual({ type: 'stdio', command: 'other', args: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.1: mergeOpenCodeConfig / removeOpenCodeConfig — mcp key, array command
// ─────────────────────────────────────────────────────────────────────────────

describe('C.1: mergeOpenCodeConfig / removeOpenCodeConfig', () => {
  const DEFAULT_ENTRY: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };

  it('fresh add yields mcp[dbgraph-mcp] with type:local and array command', () => {
    const result = mergeOpenCodeConfig({}, DEFAULT_ENTRY);
    const mcp = (result as { mcp: Record<string, unknown> }).mcp;
    expect(mcp['dbgraph-mcp']).toEqual({ type: 'local', command: ['npx', '-y', 'dbgraph-mcp'] });
  });

  it('command is an ARRAY (Array.isArray is true)', () => {
    const result = mergeOpenCodeConfig({}, DEFAULT_ENTRY);
    const mcp = (result as { mcp: Record<string, unknown> }).mcp;
    const entry = mcp['dbgraph-mcp'] as Record<string, unknown>;
    expect(Array.isArray(entry['command'])).toBe(true);
  });

  it('written entry has NO args field', () => {
    const result = mergeOpenCodeConfig({}, DEFAULT_ENTRY);
    const mcp = (result as { mcp: Record<string, unknown> }).mcp;
    const entry = mcp['dbgraph-mcp'] as Record<string, unknown>;
    expect(entry['args']).toBeUndefined();
  });

  it('re-add returns the SAME reference (idempotent)', () => {
    const existing: Record<string, unknown> = {
      mcp: { 'dbgraph-mcp': { type: 'local', command: ['npx', '-y', 'dbgraph-mcp'] } },
    };
    const result = mergeOpenCodeConfig(existing, DEFAULT_ENTRY);
    expect(result).toBe(existing);
  });

  it('planted mcp.other is preserved EXACT-set after merge', () => {
    const config: Record<string, unknown> = {
      mcp: { other: { type: 'local', command: ['other'] } },
    };
    const result = mergeOpenCodeConfig(config, DEFAULT_ENTRY);
    const mcp = (result as { mcp: Record<string, unknown> }).mcp;
    expect(mcp['dbgraph-mcp']).toBeDefined();
    expect(mcp['other']).toEqual({ type: 'local', command: ['other'] });
    expect(Object.keys(mcp)).toHaveLength(2);
  });

  it('remove deletes ONLY dbgraph-mcp (planted mcp.other preserved)', () => {
    const config: Record<string, unknown> = {
      mcp: {
        'dbgraph-mcp': { type: 'local', command: ['npx', '-y', 'dbgraph-mcp'] },
        other: { type: 'local', command: ['other'] },
      },
    };
    const result = removeOpenCodeConfig(config);
    const mcp = (result as { mcp: Record<string, unknown> }).mcp;
    expect(mcp['dbgraph-mcp']).toBeUndefined();
    expect(mcp['other']).toEqual({ type: 'local', command: ['other'] });
  });

  it('remove drops mcp key when dbgraph-mcp was the only entry', () => {
    const config: Record<string, unknown> = {
      mcp: { 'dbgraph-mcp': { type: 'local', command: ['npx', '-y', 'dbgraph-mcp'] } },
    };
    const result = removeOpenCodeConfig(config);
    expect((result as Record<string, unknown>)['mcp']).toBeUndefined();
  });

  it('remove on empty config returns same ref (no-op)', () => {
    const config: Record<string, unknown> = {};
    expect(removeOpenCodeConfig(config)).toBe(config);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.2: AGENT_TABLE — opencode row paths
// ─────────────────────────────────────────────────────────────────────────────

describe('C.2: AGENT_TABLE opencode row', () => {
  const ocRow = AGENT_TABLE.find((r) => r.id === 'opencode');

  it('opencode row exists', () => {
    expect(ocRow).toBeDefined();
  });

  it('opencode format is opencode', () => {
    expect(ocRow?.format).toBe('opencode');
  });

  it('opencode win32 path: USERPROFILE\\.config\\opencode\\opencode.json', () => {
    const p = ocRow?.resolvePath('win32', { USERPROFILE: 'C:\\Users\\u' });
    expect(p).toBe('C:\\Users\\u\\.config\\opencode\\opencode.json');
  });

  it('opencode posix path: HOME/.config/opencode/opencode.json', () => {
    const p = ocRow?.resolvePath('linux', { HOME: '/home/u' });
    expect(p).toBe('/home/u/.config/opencode/opencode.json');
  });

  it('opencode win32 returns undefined when USERPROFILE absent', () => {
    expect(ocRow?.resolvePath('win32', {})).toBeUndefined();
  });

  it('opencode posix returns undefined when HOME absent', () => {
    expect(ocRow?.resolvePath('linux', {})).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C.3: opencode integration via runInstall
// ─────────────────────────────────────────────────────────────────────────────

describe('C.3: runInstall — opencode integration', () => {
  it('win32: written bytes contain mcp.dbgraph-mcp with type:local and array command', async () => {
    const ocPath = 'C:\\Users\\u\\.config\\opencode\\opencode.json';
    const { seam, written } = makeFakeFs({ [ocPath]: JSON.stringify({}) });

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[ocPath]!) as Record<string, unknown>;
    const mcp = saved['mcp'] as Record<string, unknown>;
    expect(mcp).toBeDefined();
    const entry = mcp['dbgraph-mcp'] as Record<string, unknown>;
    expect(entry['type']).toBe('local');
    expect(Array.isArray(entry['command'])).toBe(true);
    expect(entry['command']).toEqual(['npx', '-y', 'dbgraph-mcp']);
    expect(entry['args']).toBeUndefined();
  });

  it('posix: written bytes contain mcp.dbgraph-mcp with array command', async () => {
    const ocPath = '/home/u/.config/opencode/opencode.json';
    const { seam, written } = makeFakeFs({ [ocPath]: JSON.stringify({}) });

    await runInstall({
      platform: 'linux',
      env: { HOME: '/home/u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[ocPath]!) as Record<string, unknown>;
    const mcp = saved['mcp'] as Record<string, unknown>;
    const entry = mcp['dbgraph-mcp'] as Record<string, unknown>;
    expect(entry['command']).toEqual(['npx', '-y', 'dbgraph-mcp']);
  });

  it('idempotent re-run writes nothing', async () => {
    const ocPath = 'C:\\Users\\u\\.config\\opencode\\opencode.json';
    const existingContent = JSON.stringify({
      mcp: { 'dbgraph-mcp': { type: 'local', command: ['npx', '-y', 'dbgraph-mcp'] } },
    }, null, 2) + '\n';
    const { seam, written } = makeFakeFs({ [ocPath]: existingContent });
    const writeSpy = vi.fn(seam.writeFile.bind(seam));
    seam.writeFile = writeSpy;

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(written[ocPath]).toBeUndefined();
  });

  it('--remove deletes only dbgraph-mcp, planted mcp.other preserved', async () => {
    const ocPath = 'C:\\Users\\u\\.config\\opencode\\opencode.json';
    const existingContent = JSON.stringify({
      mcp: {
        'dbgraph-mcp': { type: 'local', command: ['npx', '-y', 'dbgraph-mcp'] },
        other: { type: 'local', command: ['other'] },
      },
    }, null, 2) + '\n';
    const { seam, written } = makeFakeFs({ [ocPath]: existingContent });

    await runInstall({
      remove: true,
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    const saved = JSON.parse(written[ocPath]!) as { mcp: Record<string, unknown> };
    expect(saved.mcp['dbgraph-mcp']).toBeUndefined();
    expect(saved.mcp['other']).toEqual({ type: 'local', command: ['other'] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.1: CODEX_RENDER constant — byte-exact assertion
// ─────────────────────────────────────────────────────────────────────────────

describe('D.1: CODEX_RENDER constant', () => {
  it('renders the exact 3-line block byte-for-byte', () => {
    const expected = '[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]';
    expect(CODEX_RENDER).toBe(expected);
  });

  it('contains the header on the first line', () => {
    expect(CODEX_RENDER.split('\n')[0]).toBe('[mcp_servers.dbgraph-mcp]');
  });

  it('contains command = "npx" on the second line', () => {
    expect(CODEX_RENDER.split('\n')[1]).toBe('command = "npx"');
  });

  it('contains args with single space after comma on the third line', () => {
    expect(CODEX_RENDER.split('\n')[2]).toBe('args = ["-y", "dbgraph-mcp"]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.2: mergeCodexToml — block-boundary detection, idempotency, byte-deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe('D.2: mergeCodexToml', () => {
  // The CODEX_RENDER block as it appears after a fresh insert into a non-empty file
  const BLOCK = '[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]';

  it('appends CODEX_RENDER into an empty file (single trailing newline)', () => {
    const result = mergeCodexToml('');
    expect(result).toBe(BLOCK + '\n');
  });

  it('appends CODEX_RENDER with exactly one blank line before when file is non-empty', () => {
    const existing = '[other]\nkey = "val"\n';
    const result = mergeCodexToml(existing);
    expect(result).toBe(existing + '\n' + BLOCK + '\n');
  });

  it('is idempotent when block is already present (byte-equal) — returns input UNCHANGED', () => {
    const content = '[other]\nkey = "val"\n\n' + BLOCK + '\n';
    const result = mergeCodexToml(content);
    expect(result).toBe(content);
  });

  it('idempotent: exactly ONE [mcp_servers.dbgraph-mcp] header after merge', () => {
    const content = '[other]\nkey = "val"\n\n' + BLOCK + '\n';
    const result = mergeCodexToml(content);
    const count = (result.match(/^\[mcp_servers\.dbgraph-mcp\]/gm) ?? []).length;
    expect(count).toBe(1);
  });

  it('inserts into a file with another [mcp_servers.*] block — keeps that block intact', () => {
    const existing = '[mcp_servers.other-server]\ncommand = "other"\n';
    const result = mergeCodexToml(existing);
    expect(result).toContain('[mcp_servers.other-server]');
    expect(result).toContain('command = "other"');
    expect(result).toContain('[mcp_servers.dbgraph-mcp]');
  });

  it('replaces a DIFFERING existing block (preserving the rest verbatim)', () => {
    const stale = '[other]\nfoo = 1\n\n[mcp_servers.dbgraph-mcp]\ncommand = "old"\n\n[tail]\nbar = 2\n';
    const result = mergeCodexToml(stale);
    // Stale block replaced
    expect(result).not.toContain('command = "old"');
    expect(result).toContain('command = "npx"');
    // Surrounding blocks preserved
    expect(result).toContain('[other]');
    expect(result).toContain('[tail]');
    // Exactly one header
    const count = (result.match(/^\[mcp_servers\.dbgraph-mcp\]/gm) ?? []).length;
    expect(count).toBe(1);
  });

  it('re-running on the merged output returns it UNCHANGED (double-idempotency)', () => {
    const once = mergeCodexToml('[other]\nk = 1\n');
    const twice = mergeCodexToml(once);
    expect(twice).toBe(once);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.3: removeCodexToml — block removal, adjacent blocks untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('D.3: removeCodexToml', () => {
  const BLOCK = '[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]';

  it('returns content unchanged when block is absent', () => {
    const content = '[other]\nkey = "val"\n';
    expect(removeCodexToml(content)).toBe(content);
  });

  it('removes the block leaving only [other] with no orphan blank lines', () => {
    // file: [other]\nk=1\n\n[mcp_servers.dbgraph-mcp]\n...\n
    const content = '[other]\nk = 1\n\n' + BLOCK + '\n';
    const result = removeCodexToml(content);
    expect(result).not.toContain('[mcp_servers.dbgraph-mcp]');
    expect(result).toContain('[other]');
    // no double blank line
    expect(result).not.toMatch(/\n\n\n/);
    // single trailing newline
    expect(result.endsWith('\n')).toBe(true);
  });

  it('removes block and preserves a following [other] block', () => {
    const content = BLOCK + '\n\n[other]\nk = 1\n';
    const result = removeCodexToml(content);
    expect(result).not.toContain('[mcp_servers.dbgraph-mcp]');
    expect(result).toContain('[other]');
    expect(result).toContain('k = 1');
  });

  it('preserves an adjacent [mcp_servers.other-server] block', () => {
    const content = '[mcp_servers.other-server]\ncmd = "x"\n\n' + BLOCK + '\n';
    const result = removeCodexToml(content);
    expect(result).not.toContain('[mcp_servers.dbgraph-mcp]');
    expect(result).toContain('[mcp_servers.other-server]');
    expect(result).toContain('cmd = "x"');
  });

  it('removing when block is the only content yields a single trailing newline', () => {
    const content = BLOCK + '\n';
    const result = removeCodexToml(content);
    expect(result).toBe('\n');
  });

  it('is a no-op on empty string', () => {
    expect(removeCodexToml('')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.4: AGENT_TABLE — codex row paths
// ─────────────────────────────────────────────────────────────────────────────

describe('D.4: AGENT_TABLE codex row', () => {
  const codexRow = AGENT_TABLE.find((r) => r.id === 'codex');

  it('codex row exists', () => {
    expect(codexRow).toBeDefined();
  });

  it('codex format is codex-toml', () => {
    expect(codexRow?.format).toBe('codex-toml');
  });

  it('codex win32 path: USERPROFILE\\.codex\\config.toml', () => {
    const p = codexRow?.resolvePath('win32', { USERPROFILE: 'C:\\Users\\u' });
    expect(p).toBe('C:\\Users\\u\\.codex\\config.toml');
  });

  it('codex posix path: HOME/.codex/config.toml', () => {
    const p = codexRow?.resolvePath('linux', { HOME: '/home/u' });
    expect(p).toBe('/home/u/.codex/config.toml');
  });

  it('codex win32 returns undefined when USERPROFILE absent', () => {
    expect(codexRow?.resolvePath('win32', {})).toBeUndefined();
  });

  it('codex posix returns undefined when HOME absent', () => {
    expect(codexRow?.resolvePath('linux', {})).toBeUndefined();
  });

  it('codex row merge ignores the JSON entry param (fixed render)', () => {
    // merge with any entry should produce the fixed CODEX_RENDER block
    const entry: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };
    const result = codexRow?.merge('', entry) ?? '';
    expect(result).toContain('[mcp_servers.dbgraph-mcp]');
    expect(result).toContain('command = "npx"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D.5: codex integration via runInstall
// ─────────────────────────────────────────────────────────────────────────────

describe('D.5: runInstall — codex integration', () => {
  const BLOCK = '[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]';

  it('win32: written bytes contain [mcp_servers.dbgraph-mcp] block', async () => {
    const codexPath = 'C:\\Users\\u\\.codex\\config.toml';
    const { seam, written } = makeFakeFs({ [codexPath]: '' });

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    expect(written[codexPath]).toContain('[mcp_servers.dbgraph-mcp]');
    expect(written[codexPath]).toContain('command = "npx"');
    expect(written[codexPath]).toContain('args = ["-y", "dbgraph-mcp"]');
  });

  it('posix: written bytes contain [mcp_servers.dbgraph-mcp] block', async () => {
    const codexPath = '/home/u/.codex/config.toml';
    const { seam, written } = makeFakeFs({ [codexPath]: '' });

    await runInstall({
      platform: 'linux',
      env: { HOME: '/home/u' },
      fs: seam,
      write: () => {},
    });

    expect(written[codexPath]).toContain('[mcp_servers.dbgraph-mcp]');
    expect(written[codexPath]).toContain('command = "npx"');
  });

  it('existing [other] block is preserved alongside the new block', async () => {
    const codexPath = 'C:\\Users\\u\\.codex\\config.toml';
    const existing = '[other]\nkey = "val"\n';
    const { seam, written } = makeFakeFs({ [codexPath]: existing });

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    expect(written[codexPath]).toContain('[other]');
    expect(written[codexPath]).toContain('[mcp_servers.dbgraph-mcp]');
  });

  it('idempotent re-run writes nothing (next === raw)', async () => {
    const codexPath = 'C:\\Users\\u\\.codex\\config.toml';
    const existingContent = '\n' + BLOCK + '\n';
    const { seam, written } = makeFakeFs({ [codexPath]: existingContent });
    const writeSpy = vi.fn(seam.writeFile.bind(seam));
    seam.writeFile = writeSpy;

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(written[codexPath]).toBeUndefined();
  });

  it('empty/absent-content codex file produces a valid single-block render (codex fallback is empty string)', async () => {
    const codexPath = 'C:\\Users\\u\\.codex\\config.toml';
    // The parse-error fallback for codex-toml is '' (not '{}')
    const { seam, written } = makeFakeFs({ [codexPath]: 'not-toml-at-all{{{{' });

    await runInstall({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    // mergeCodexToml('not-toml...') treats it as non-matching content and appends
    // the block — OR detects no header and appends. Either way, the block appears once.
    const count = (written[codexPath]?.match(/^\[mcp_servers\.dbgraph-mcp\]/gm) ?? []).length;
    expect(count).toBe(1);
  });

  it('--remove deletes exactly the block, no other content removed', async () => {
    const codexPath = 'C:\\Users\\u\\.codex\\config.toml';
    const existingContent = '[other]\nk = 1\n\n' + BLOCK + '\n';
    const { seam, written } = makeFakeFs({ [codexPath]: existingContent });

    await runInstall({
      remove: true,
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\u' },
      fs: seam,
      write: () => {},
    });

    expect(written[codexPath]).not.toContain('[mcp_servers.dbgraph-mcp]');
    expect(written[codexPath]).toContain('[other]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E.1: Full cross-platform path matrix — all 6 agents × {win32, posix}
// ─────────────────────────────────────────────────────────────────────────────

describe('E.1: full path matrix — all 6 agents × {win32, posix}', () => {
  interface PathCase {
    id: string;
    win32: { env: Record<string, string>; expected: string };
    posix: { env: Record<string, string>; expected: string };
    missingWin32Env: Record<string, string>;
    missingPosixEnv: Record<string, string>;
  }

  const cases: PathCase[] = [
    {
      id: 'claude-code',
      win32: {
        env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
        expected: 'C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json',
      },
      posix: {
        env: { HOME: '/home/u' },
        expected: '/home/u/.config/Claude/claude_desktop_config.json',
      },
      missingWin32Env: {},
      missingPosixEnv: {},
    },
    {
      id: 'cursor',
      win32: {
        env: { USERPROFILE: 'C:\\Users\\u' },
        expected: 'C:\\Users\\u\\.cursor\\mcp.json',
      },
      posix: {
        env: { HOME: '/home/u' },
        expected: '/home/u/.cursor/mcp.json',
      },
      missingWin32Env: {},
      missingPosixEnv: {},
    },
    {
      id: 'gemini',
      win32: {
        env: { USERPROFILE: 'C:\\Users\\u' },
        expected: 'C:\\Users\\u\\.gemini\\settings.json',
      },
      posix: {
        env: { HOME: '/home/u' },
        expected: '/home/u/.gemini/settings.json',
      },
      missingWin32Env: {},
      missingPosixEnv: {},
    },
    {
      id: 'vscode',
      win32: {
        env: { USERPROFILE: 'C:\\Users\\u' },
        expected: 'C:\\Users\\u\\.vscode\\mcp.json',
      },
      posix: {
        env: { HOME: '/home/u' },
        expected: '/home/u/.vscode/mcp.json',
      },
      missingWin32Env: {},
      missingPosixEnv: {},
    },
    {
      id: 'opencode',
      win32: {
        env: { USERPROFILE: 'C:\\Users\\u' },
        expected: 'C:\\Users\\u\\.config\\opencode\\opencode.json',
      },
      posix: {
        env: { HOME: '/home/u' },
        expected: '/home/u/.config/opencode/opencode.json',
      },
      missingWin32Env: {},
      missingPosixEnv: {},
    },
    {
      id: 'codex',
      win32: {
        env: { USERPROFILE: 'C:\\Users\\u' },
        expected: 'C:\\Users\\u\\.codex\\config.toml',
      },
      posix: {
        env: { HOME: '/home/u' },
        expected: '/home/u/.codex/config.toml',
      },
      missingWin32Env: {},
      missingPosixEnv: {},
    },
  ];

  for (const c of cases) {
    describe(`agent: ${c.id}`, () => {
      const getRow = () => AGENT_TABLE.find((r) => r.id === c.id)!;

      it(`win32 exact path pin`, () => {
        const row = getRow();
        const p = row.resolvePath('win32', c.win32.env);
        expect(p).toBe(c.win32.expected);
      });

      it(`posix exact path pin`, () => {
        const row = getRow();
        const p = row.resolvePath('linux', c.posix.env);
        expect(p).toBe(c.posix.expected);
      });

      it(`win32 returns undefined when env var missing`, () => {
        const row = getRow();
        expect(row.resolvePath('win32', c.missingWin32Env)).toBeUndefined();
      });

      it(`posix returns undefined when env var missing`, () => {
        const row = getRow();
        expect(row.resolvePath('linux', c.missingPosixEnv)).toBeUndefined();
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// E.2: Full multi-agent integration matrix via runInstall — all 6 × {win32, posix}
// ─────────────────────────────────────────────────────────────────────────────

describe('E.2: full 6-agent integration matrix via runInstall', () => {
  const DEFAULT_ENTRY: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };

  const win32Paths = {
    claude: 'C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json',
    cursor: 'C:\\Users\\u\\.cursor\\mcp.json',
    gemini: 'C:\\Users\\u\\.gemini\\settings.json',
    vscode: 'C:\\Users\\u\\.vscode\\mcp.json',
    opencode: 'C:\\Users\\u\\.config\\opencode\\opencode.json',
    codex: 'C:\\Users\\u\\.codex\\config.toml',
  };

  const posixPaths = {
    claude: '/home/u/.config/Claude/claude_desktop_config.json',
    cursor: '/home/u/.cursor/mcp.json',
    gemini: '/home/u/.gemini/settings.json',
    vscode: '/home/u/.vscode/mcp.json',
    opencode: '/home/u/.config/opencode/opencode.json',
    codex: '/home/u/.codex/config.toml',
  };

  const win32Env = { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\u' };
  const posixEnv = { HOME: '/home/u' };

  // Build the initial file content for each agent
  function win32InitialFiles(): Record<string, string> {
    return {
      [win32Paths.claude]: JSON.stringify({}),
      [win32Paths.cursor]: JSON.stringify({}),
      [win32Paths.gemini]: JSON.stringify({}),
      [win32Paths.vscode]: JSON.stringify({}),
      [win32Paths.opencode]: JSON.stringify({}),
      [win32Paths.codex]: '',
    };
  }

  function posixInitialFiles(): Record<string, string> {
    return {
      [posixPaths.claude]: JSON.stringify({}),
      [posixPaths.cursor]: JSON.stringify({}),
      [posixPaths.gemini]: JSON.stringify({}),
      [posixPaths.vscode]: JSON.stringify({}),
      [posixPaths.opencode]: JSON.stringify({}),
      [posixPaths.codex]: '',
    };
  }

  it('win32: ONE pass writes format-correct entry for ALL 6 agents', async () => {
    const { seam, written } = makeFakeFs(win32InitialFiles());

    await runInstall({ platform: 'win32', env: win32Env, fs: seam, write: () => {} });

    // mcpServers family (3)
    for (const key of ['claude', 'cursor', 'gemini'] as const) {
      const saved = JSON.parse(written[win32Paths[key]]!) as { mcpServers: Record<string, McpServerEntry> };
      expect(saved.mcpServers['dbgraph-mcp']).toEqual(DEFAULT_ENTRY);
    }
    // vscode — servers key with {type:stdio}
    const vsSaved = JSON.parse(written[win32Paths.vscode]!) as { servers: Record<string, unknown> };
    expect(vsSaved.servers['dbgraph-mcp']).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] });
    expect((JSON.parse(written[win32Paths.vscode]!) as Record<string, unknown>)['mcpServers']).toBeUndefined();
    // opencode — mcp key with array command
    const ocSaved = JSON.parse(written[win32Paths.opencode]!) as { mcp: Record<string, unknown> };
    const ocEntry = ocSaved.mcp['dbgraph-mcp'] as Record<string, unknown>;
    expect(ocEntry['type']).toBe('local');
    expect(ocEntry['command']).toEqual(['npx', '-y', 'dbgraph-mcp']);
    expect(ocEntry['args']).toBeUndefined();
    // codex — TOML block
    expect(written[win32Paths.codex]).toContain('[mcp_servers.dbgraph-mcp]');
    expect(written[win32Paths.codex]).toContain('command = "npx"');
    expect(written[win32Paths.codex]).toContain('args = ["-y", "dbgraph-mcp"]');
  });

  it('posix: ONE pass writes format-correct entry for ALL 6 agents', async () => {
    const { seam, written } = makeFakeFs(posixInitialFiles());

    await runInstall({ platform: 'linux', env: posixEnv, fs: seam, write: () => {} });

    for (const key of ['claude', 'cursor', 'gemini'] as const) {
      const saved = JSON.parse(written[posixPaths[key]]!) as { mcpServers: Record<string, McpServerEntry> };
      expect(saved.mcpServers['dbgraph-mcp']).toEqual(DEFAULT_ENTRY);
    }
    const vsSaved = JSON.parse(written[posixPaths.vscode]!) as { servers: Record<string, unknown> };
    expect(vsSaved.servers['dbgraph-mcp']).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] });
    const ocSaved = JSON.parse(written[posixPaths.opencode]!) as { mcp: Record<string, unknown> };
    expect((ocSaved.mcp['dbgraph-mcp'] as Record<string, unknown>)['command']).toEqual(['npx', '-y', 'dbgraph-mcp']);
    expect(written[posixPaths.codex]).toContain('[mcp_servers.dbgraph-mcp]');
  });

  it('win32: SECOND pass writes NOTHING to ANY file (fully idempotent across all formats)', async () => {
    // Pre-populate with already-merged content (simulates the state after a first install)
    const TOML_MERGED = '[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]\n';
    const alreadyMergedFiles: Record<string, string> = {
      [win32Paths.claude]: JSON.stringify({ mcpServers: { 'dbgraph-mcp': DEFAULT_ENTRY } }, null, 2) + '\n',
      [win32Paths.cursor]: JSON.stringify({ mcpServers: { 'dbgraph-mcp': DEFAULT_ENTRY } }, null, 2) + '\n',
      [win32Paths.gemini]: JSON.stringify({ mcpServers: { 'dbgraph-mcp': DEFAULT_ENTRY } }, null, 2) + '\n',
      [win32Paths.vscode]: JSON.stringify({ servers: { 'dbgraph-mcp': { type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] } } }, null, 2) + '\n',
      [win32Paths.opencode]: JSON.stringify({ mcp: { 'dbgraph-mcp': { type: 'local', command: ['npx', '-y', 'dbgraph-mcp'] } } }, null, 2) + '\n',
      [win32Paths.codex]: TOML_MERGED,
    };
    const { seam, written } = makeFakeFs(alreadyMergedFiles);
    const writeSpy = vi.fn(seam.writeFile.bind(seam));
    seam.writeFile = writeSpy;

    // Second pass (content already matches — should write nothing)
    await runInstall({ platform: 'win32', env: win32Env, fs: seam, write: () => {} });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(Object.keys(written)).toHaveLength(0);
  });

  it('win32: --remove over all 6 deletes EXACTLY the dbgraph-mcp entry and leaves planted other entries intact', async () => {
    // Plant "other" entries in each file
    const filesWithOther: Record<string, string> = {
      [win32Paths.claude]: JSON.stringify({ mcpServers: { 'dbgraph-mcp': DEFAULT_ENTRY, 'other-mcp': { command: 'other', args: [] } } }),
      [win32Paths.cursor]: JSON.stringify({ mcpServers: { 'dbgraph-mcp': DEFAULT_ENTRY, 'other-mcp': { command: 'other', args: [] } } }),
      [win32Paths.gemini]: JSON.stringify({ mcpServers: { 'dbgraph-mcp': DEFAULT_ENTRY, 'other-mcp': { command: 'other', args: [] } } }),
      [win32Paths.vscode]: JSON.stringify({ servers: { 'dbgraph-mcp': { type: 'stdio', command: 'npx', args: ['-y', 'dbgraph-mcp'] }, other: { type: 'stdio', command: 'other', args: [] } } }),
      [win32Paths.opencode]: JSON.stringify({ mcp: { 'dbgraph-mcp': { type: 'local', command: ['npx', '-y', 'dbgraph-mcp'] }, other: { type: 'local', command: ['other'] } } }),
      [win32Paths.codex]: '[mcp_servers.other-server]\ncmd = "x"\n\n[mcp_servers.dbgraph-mcp]\ncommand = "npx"\nargs = ["-y", "dbgraph-mcp"]\n',
    };
    const { seam, written } = makeFakeFs(filesWithOther);

    await runInstall({ remove: true, platform: 'win32', env: win32Env, fs: seam, write: () => {} });

    // mcpServers family
    for (const key of ['claude', 'cursor', 'gemini'] as const) {
      const saved = JSON.parse(written[win32Paths[key]]!) as { mcpServers: Record<string, unknown> };
      expect(saved.mcpServers['dbgraph-mcp']).toBeUndefined();
      expect(saved.mcpServers['other-mcp']).toBeDefined();
    }
    // vscode
    const vsSaved = JSON.parse(written[win32Paths.vscode]!) as { servers: Record<string, unknown> };
    expect(vsSaved.servers['dbgraph-mcp']).toBeUndefined();
    expect(vsSaved.servers['other']).toBeDefined();
    // opencode
    const ocSaved = JSON.parse(written[win32Paths.opencode]!) as { mcp: Record<string, unknown> };
    expect(ocSaved.mcp['dbgraph-mcp']).toBeUndefined();
    expect(ocSaved.mcp['other']).toBeDefined();
    // codex
    expect(written[win32Paths.codex]).not.toContain('[mcp_servers.dbgraph-mcp]');
    expect(written[win32Paths.codex]).toContain('[mcp_servers.other-server]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E.3: No-secrets assertion — written entries contain ONLY the expected keys
// ─────────────────────────────────────────────────────────────────────────────

describe('E.3: written entries carry no secrets', () => {
  const DEFAULT_ENTRY: McpServerEntry = { command: 'npx', args: ['-y', 'dbgraph-mcp'] };

  it('mcpServers entry has ONLY command and args keys', () => {
    const row = AGENT_TABLE.find((r) => r.id === 'claude-code')!;
    const text = row.merge('{}', DEFAULT_ENTRY);
    const parsed = JSON.parse(text) as { mcpServers: Record<string, Record<string, unknown>> };
    const entry = parsed.mcpServers['dbgraph-mcp']!;
    expect(Object.keys(entry).sort()).toEqual(['args', 'command']);
  });

  it('vscode entry has ONLY type, command, and args keys', () => {
    const row = AGENT_TABLE.find((r) => r.id === 'vscode')!;
    const text = row.merge('{}', DEFAULT_ENTRY);
    const parsed = JSON.parse(text) as { servers: Record<string, Record<string, unknown>> };
    const entry = parsed.servers['dbgraph-mcp']!;
    expect(Object.keys(entry).sort()).toEqual(['args', 'command', 'type']);
    expect(entry['type']).toBe('stdio');
  });

  it('opencode entry has ONLY type and command (array) keys — no args', () => {
    const row = AGENT_TABLE.find((r) => r.id === 'opencode')!;
    const text = row.merge('{}', DEFAULT_ENTRY);
    const parsed = JSON.parse(text) as { mcp: Record<string, Record<string, unknown>> };
    const entry = parsed.mcp['dbgraph-mcp']!;
    expect(Object.keys(entry).sort()).toEqual(['command', 'type']);
    expect(entry['type']).toBe('local');
    expect(Array.isArray(entry['command'])).toBe(true);
  });

  it('codex TOML block has ONLY command and args TOML keys — no extra keys', () => {
    const row = AGENT_TABLE.find((r) => r.id === 'codex')!;
    const text = row.merge('', DEFAULT_ENTRY);
    // Should not contain any token/credential-looking strings
    expect(text).not.toContain('token');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('password');
    expect(text).not.toContain('key');
    // Should contain exactly command and args
    expect(text).toContain('command = "npx"');
    expect(text).toContain('args = ["-y", "dbgraph-mcp"]');
    // Exactly 3 non-empty lines in the block
    const blockLines = text.split('\n').filter((l) => l.trim() !== '');
    expect(blockLines).toHaveLength(3);
  });

  it('no written entry contains a credential or token field for any agent', () => {
    const credentialPatterns = ['token', 'secret', 'password', 'apikey', 'api_key', 'credential'];
    for (const row of AGENT_TABLE) {
      const text = row.merge('{}', DEFAULT_ENTRY);
      for (const pattern of credentialPatterns) {
        expect(text.toLowerCase()).not.toContain(pattern);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E.4: MANUAL_SNIPPET wording + per-agent summary line format
// ─────────────────────────────────────────────────────────────────────────────

describe('E.4: MANUAL_SNIPPET names all 6 agents + per-agent summary', () => {
  it('MANUAL_SNIPPET names Claude Code', () => {
    expect(MANUAL_SNIPPET).toContain('Claude Code');
  });

  it('MANUAL_SNIPPET names Cursor', () => {
    expect(MANUAL_SNIPPET).toContain('Cursor');
  });

  it('MANUAL_SNIPPET names Gemini CLI', () => {
    expect(MANUAL_SNIPPET).toContain('Gemini CLI');
  });

  it('MANUAL_SNIPPET names VS Code', () => {
    expect(MANUAL_SNIPPET).toContain('VS Code');
  });

  it('MANUAL_SNIPPET names opencode', () => {
    expect(MANUAL_SNIPPET).toContain('opencode');
  });

  it('MANUAL_SNIPPET names Codex CLI', () => {
    expect(MANUAL_SNIPPET).toContain('Codex CLI');
  });

  it('zero-agent path outputs exactly MANUAL_SNIPPET (exact-equality preserved)', async () => {
    const output: string[] = [];
    const { seam } = makeFakeFs({});

    await runInstall({
      platform: 'win32',
      env: {},
      fs: seam,
      write: (t) => output.push(t),
    });

    expect(output.join('')).toBe(MANUAL_SNIPPET);
  });

  it('detected run prints per-agent summary line in format: {displayName} → {action} ({path})', async () => {
    const claudePath = 'C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
    const { seam } = makeFakeFs({ [claudePath]: JSON.stringify({}) });
    const output: string[] = [];

    await runInstall({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
      fs: seam,
      write: (t) => output.push(t),
    });

    const summary = output.join('');
    // Summary should contain the display name, arrow, action, and path
    expect(summary).toContain('Claude Code');
    expect(summary).toContain('→');
    expect(summary).toContain('installed');
    expect(summary).toContain(claudePath);
  });

  it('summary line contains the installed path in parentheses', async () => {
    const claudePath = 'C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
    const { seam } = makeFakeFs({ [claudePath]: JSON.stringify({}) });
    const output: string[] = [];

    await runInstall({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
      fs: seam,
      write: (t) => output.push(t),
    });

    expect(output.join('')).toContain(`(${claudePath})`);
  });
});
