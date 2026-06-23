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
