/**
 * Tests for parseArgv — task 2.1 (phase-4-cli-config).
 * Spec: cli-config "CLI exit codes are a stable contract" — parser feeds all six commands.
 * Design Decision 4: hand-rolled tokenizer, pure function, ZERO new deps.
 * Scenarios:
 *   - known subcommands parsed correctly
 *   - --flag value style parsed
 *   - --flag=value style parsed
 *   - boolean flags (--json, --full, --last)
 *   - -i short flag
 *   - positional arguments captured
 *   - unknown command passes through (dispatch decides what to do with it)
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */

import { describe, it, expect } from 'vitest';
import { parseArgv } from '../../../src/cli/parse/args.js';

// ─────────────────────────────────────────────────────────────────────────────
// Basic command extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgv — subcommand extraction', () => {
  it('extracts the command name as first token', () => {
    const result = parseArgv(['init', '--dialect', 'sqlite']);
    expect(result.command).toBe('init');
  });

  it('extracts "sync" as command', () => {
    const result = parseArgv(['sync']);
    expect(result.command).toBe('sync');
  });

  it('extracts "status" as command', () => {
    const result = parseArgv(['status']);
    expect(result.command).toBe('status');
  });

  it('extracts "query" as command', () => {
    const result = parseArgv(['query', 'orders']);
    expect(result.command).toBe('query');
  });

  it('extracts "explore" as command', () => {
    const result = parseArgv(['explore', 'dbo.orders']);
    expect(result.command).toBe('explore');
  });

  it('extracts "diff" as command', () => {
    const result = parseArgv(['diff', '--last']);
    expect(result.command).toBe('diff');
  });

  it('returns empty string command when argv is empty', () => {
    const result = parseArgv([]);
    expect(result.command).toBe('');
  });

  it('passes unknown command through (dispatch decides)', () => {
    const result = parseArgv(['bogus']);
    expect(result.command).toBe('bogus');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --flag value style
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgv — --flag value style', () => {
  it('parses --dialect sqlite as flag with value', () => {
    const result = parseArgv(['init', '--dialect', 'sqlite']);
    expect(result.flags['dialect']).toBe('sqlite');
  });

  it('parses --detail normal as flag with value', () => {
    const result = parseArgv(['explore', 'dbo.orders', '--detail', 'normal']);
    expect(result.flags['detail']).toBe('normal');
  });

  it('does not include --dialect in positionals', () => {
    const result = parseArgv(['init', '--dialect', 'sqlite']);
    expect(result.positionals).not.toContain('--dialect');
    expect(result.positionals).not.toContain('sqlite');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --flag=value style
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgv — --flag=value style', () => {
  it('parses --dialect=mssql using = separator', () => {
    const result = parseArgv(['init', '--dialect=mssql']);
    expect(result.flags['dialect']).toBe('mssql');
  });

  it('parses --detail=full using = separator', () => {
    const result = parseArgv(['explore', 'dbo.orders', '--detail=full']);
    expect(result.flags['detail']).toBe('full');
  });

  it('handles --key=value-with-dashes', () => {
    const result = parseArgv(['init', '--url=./my-db.db']);
    expect(result.flags['url']).toBe('./my-db.db');
  });

  it('handles --key=value with embedded = (takes first = as separator)', () => {
    const result = parseArgv(['init', '--url=server=localhost']);
    expect(result.flags['url']).toBe('server=localhost');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Boolean flags
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgv — boolean flags', () => {
  it('--json is treated as boolean true', () => {
    const result = parseArgv(['query', 'orders', '--json']);
    expect(result.flags['json']).toBe(true);
  });

  it('--full is treated as boolean true', () => {
    const result = parseArgv(['sync', '--full']);
    expect(result.flags['full']).toBe(true);
  });

  it('--last is treated as boolean true', () => {
    const result = parseArgv(['diff', '--last']);
    expect(result.flags['last']).toBe(true);
  });

  it('boolean flag does not consume the next token as its value', () => {
    const result = parseArgv(['query', 'orders', '--json', 'extra']);
    expect(result.flags['json']).toBe(true);
    expect(result.positionals).toContain('extra');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Short flag -i
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgv — short flag -i', () => {
  it('-i is parsed as boolean flag i', () => {
    const result = parseArgv(['init', '-i']);
    expect(result.flags['i']).toBe(true);
  });

  it('-i does not consume the next token', () => {
    const result = parseArgv(['init', '-i', '--dialect', 'sqlite']);
    expect(result.flags['i']).toBe(true);
    expect(result.flags['dialect']).toBe('sqlite');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Positionals
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgv — positional arguments', () => {
  it('captures positionals after the command (non-flag tokens)', () => {
    const result = parseArgv(['query', 'orders']);
    expect(result.positionals).toEqual(['orders']);
  });

  it('captures multiple positionals', () => {
    const result = parseArgv(['diff', 'snap-1', 'snap-2']);
    expect(result.positionals).toEqual(['snap-1', 'snap-2']);
  });

  it('positionals are separate from flags', () => {
    const result = parseArgv(['explore', 'dbo.orders', '--detail', 'full']);
    expect(result.positionals).toEqual(['dbo.orders']);
    expect(result.flags['detail']).toBe('full');
  });

  it('positionals array is empty when there are none', () => {
    const result = parseArgv(['sync', '--full']);
    expect(result.positionals).toEqual([]);
  });

  it('positionals after boolean flags are captured', () => {
    const result = parseArgv(['query', '--json', 'orders']);
    expect(result.positionals).toContain('orders');
    expect(result.flags['json']).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mixed cases
// ─────────────────────────────────────────────────────────────────────────────

describe('parseArgv — mixed flags and positionals', () => {
  it('handles init with all flags: --dialect and -i', () => {
    const result = parseArgv(['init', '-i', '--dialect', 'mssql']);
    expect(result.command).toBe('init');
    expect(result.flags['i']).toBe(true);
    expect(result.flags['dialect']).toBe('mssql');
    expect(result.positionals).toEqual([]);
  });

  it('handles diff with two snapshot ids as positionals', () => {
    const result = parseArgv(['diff', 'snap-abc', 'snap-def']);
    expect(result.command).toBe('diff');
    expect(result.positionals).toEqual(['snap-abc', 'snap-def']);
  });

  it('returns empty flags object when no flags provided', () => {
    const result = parseArgv(['status']);
    expect(result.flags).toEqual({});
    expect(result.positionals).toEqual([]);
  });
});
