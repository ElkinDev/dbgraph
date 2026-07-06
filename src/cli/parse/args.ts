/**
 * Hand-rolled subcommand argument parser — task 2.1 (phase-4-cli-config).
 * Design Decision 4: ZERO new runtime deps; a pure tokenizer.
 *
 * Supports:
 *   --flag value     (long flag with space-separated value)
 *   --flag=value     (long flag with = separator — first = only)
 *   --json           (boolean long flags: json, full, last)
 *   -i               (short boolean flag)
 *   positionals      (non-flag tokens after the command)
 *
 * Pure function: no I/O, no process access, deterministic (ADR-008).
 */

/** Result type of parseArgv. */
export interface ParsedArgs {
  /** The subcommand name (first positional token), or '' if argv is empty. */
  readonly command: string;
  /** Non-flag tokens after the command (e.g. search term, snapshot ids, qname). */
  readonly positionals: readonly string[];
  /** Parsed flags: value is a string for --flag value / --flag=value, true for booleans. */
  readonly flags: Readonly<Record<string, string | true>>;
}

/**
 * Boolean-only long flags — these do NOT consume the next token as a value.
 * Short flags are always boolean.
 */
const BOOLEAN_LONG_FLAGS = new Set(['json', 'full', 'last', 'quiet']);

/**
 * Parses a raw argv array (already sliced — do NOT include node / script path).
 * Returns a ParsedArgs with command, positionals, and flags.
 *
 * @param argv - e.g. process.argv.slice(2)
 */
export function parseArgv(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) {
    return { command: '', positionals: [], flags: {} };
  }

  const [commandToken, ...rest] = argv;
  const command = commandToken ?? '';

  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (token === undefined) {
      i++;
      continue;
    }

    if (token.startsWith('--')) {
      // Long flag: --flag or --flag=value
      const withoutDashes = token.slice(2);
      const eqIdx = withoutDashes.indexOf('=');

      if (eqIdx !== -1) {
        // --flag=value form — first = is the separator
        const key = withoutDashes.slice(0, eqIdx);
        const value = withoutDashes.slice(eqIdx + 1);
        flags[key] = value;
      } else if (BOOLEAN_LONG_FLAGS.has(withoutDashes)) {
        // Known boolean flag — does NOT consume next token
        flags[withoutDashes] = true;
      } else {
        // --flag value form — next token is the value if it does not start with -
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[withoutDashes] = next;
          i++; // consume the value token
        } else {
          // No value following — treat as boolean
          flags[withoutDashes] = true;
        }
      }
    } else if (token.startsWith('-') && token.length === 2) {
      // Short flag: -i (always boolean in this CLI)
      const key = token.slice(1);
      flags[key] = true;
    } else {
      // Positional argument
      positionals.push(token);
    }

    i++;
  }

  return { command, positionals, flags };
}
