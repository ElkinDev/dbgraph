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
  type FsSeam,
  type McpServerEntry,
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
