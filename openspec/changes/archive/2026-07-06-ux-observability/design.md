# Design: UX Observability — Wire the Console Logger, Speak the Sync Summary

## Technical Approach

Adapter-and-wiring over the EXISTING `Logger` port (ADR-004). The port and the
`openConnections(projectRoot, logger=noopLogger)` seam are already half-built; the silence is a
WIRING omission. We add (1) a console `Logger` adapter in the CLI layer over an injectable stream
seam, (2) a pure `formatSyncSummary` formatter alongside `format/status.ts`, (3) a `SyncSummary`
return from `runSync`, and (4) dispatch wiring that injects the logger and writes the summary.
Diagnostics → STDERR, structured/`--json` payloads → STDOUT (kept byte-identical). Banner is a
one-line string fix. Maps to proposal Approach steps 1–6.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| D1 | Adapter home | `src/cli/log/console-logger.ts` | `src/infra/` | Presentation adapter; CLI-only; ADR-004 keeps it out of core/infra. |
| D2 | Output stream | DIAGNOSTICS → **STDERR** via injected `write` seam (default `process.stderr.write`) | STDOUT; `console.*` | Keeps STDOUT clean so `--json` stays byte-identical; seam = captured-output tests, no real stdio. |
| D3 | Formatter home | `src/cli/format/sync.ts` | `src/core/present/` | Mirrors `format/status.ts`/`diff.ts`; CLI-only presentation; core present is the MCP variant. |
| D4 | Timing placement | Logged via seam, NOT in `formatSyncSummary` | Embed elapsed ms in summary | ADR-008: pinned golden must be byte-deterministic; `Date.now()` belongs to the logger seam. |
| D5 | `runSync` return | Return typed `SyncSummary` (replace `HandlerOutcome`); handler formats + writes | Format inside `runSync` | Keeps `runSync` pure of I/O; mirrors `runStatus` returning `{output}`; handler owns `process.stdout`. |
| D6 | Logger injection | `runSync` + handlers take `logger: Logger = noopLogger` | Mandatory param | Default-noop preserves back-compat (matches `openConnections`); MCP path + existing tests stay green. |
| D7 | Verbosity | `--quiet`/`-q` lowers level to warn; default level `info`→stderr | New `--verbose` levels | Minimal contract; proposal scope. Add `quiet` to `BOOLEAN_LONG_FLAGS` in `parse/args.ts` (`-q` already parses as boolean short flag). |
| D8 | Banner text | Match `install.ts` `MANUAL_SNIPPET` phrase ("Supported agents: Claude Code, Cursor, Gemini CLI, VS Code, opencode, Codex CLI") | Ad-hoc rewrite | Single source of truth; one assertion pins "no Claude Desktop". |

## Data Flow

```
runCli → dispatch → handleSync(args)
   │           creates ConsoleLogger({ write: stderr, level })  [D2/D7]
   ▼
openConnections(root, logger) ──► mssql adapter (strategy log)  [already forwards]
   ▼
runSync({adapter,store,full,logger})
   │  logger.info("extract…") / "delta…" / "snapshot…" + timing  → STDERR
   └─ returns SyncSummary (counts/upserted/deleted/drift/snapshot meta)
   ▼
handleSync: formatSyncSummary(summary)  [pure, golden]  → process.stdout.write  → STDOUT
```

`--json` payloads (query/affected/status) keep flowing to STDOUT untouched; the logger never writes
STDOUT, so existing `--json` goldens stay byte-identical.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/cli/log/console-logger.ts` | Create | `createConsoleLogger({ write?, level? })` → `Logger`; formats `level msg [meta]` lines to the seam; suppresses below level. |
| `src/cli/format/sync.ts` | Create | Pure `formatSyncSummary(view: SyncSummary): string` — `lines[].join('\n')+'\n'`, sorted kinds, NO timing. |
| `src/cli/commands/sync.ts` | Modify | `SyncOptions` gains `logger?: Logger`; `runSync` logs phases + returns `SyncSummary` (build summary in step 9/10; include drift = stored≠live, snapshot id/fingerprint, upserted/deleted counts). |
| `src/cli/dispatch.ts` | Modify | `handleSync` builds logger from `args.flags['quiet']`/`['q']`, passes to `openConnections` + `runSync`, writes `formatSyncSummary(...)` to stdout; other handlers pass the same logger to `openConnections`. |
| `src/cli/commands/init.ts` | Modify | `syncAfterInit` is the SECOND `runSync` caller (currently discards the result, silent). Thread a logger to `openConnections` + `runSync` so post-init sync is also observable; write `formatSyncSummary(...)` to stdout. Return type widens from `HandlerOutcome` to `SyncSummary` is source-compatible (result discarded). |
| `src/cli/cli.ts` | Modify | One-line `USAGE_TEXT` install line → supported-agents phrasing (D8). |
| `src/cli/parse/args.ts` | Modify | Add `'quiet'` to `BOOLEAN_LONG_FLAGS`. |

## Interfaces / Contracts

```ts
// src/cli/log/console-logger.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface ConsoleLoggerOptions {
  write?: (text: string) => void; // default: (t) => { process.stderr.write(t); }
  level?: LogLevel;               // default 'info'; '--quiet' → 'warn'
}
export function createConsoleLogger(opts?: ConsoleLoggerOptions): Logger;

// src/cli/format/sync.ts — input shape (timing intentionally absent, D4)
export interface SyncSummary {
  readonly mode: 'full' | 'incremental' | 'skipped'; // skipped = fingerprint match
  readonly counts: Readonly<Record<string, number>>; // per-kind
  readonly upserted: number;
  readonly deleted: number;
  readonly hasDrift: boolean;
  readonly snapshotId: string;
  readonly fingerprint: string;
}
export function formatSyncSummary(view: SyncSummary): string;
```

`runSync` returns `SyncSummary` (skipped path returns `{mode:'skipped', counts:{}, upserted:0,
deleted:0, hasDrift:false, snapshotId:'', fingerprint:liveFingerprint}` or the last snapshot meta).
The `HandlerOutcome` to `cli.ts` stays `{type:'success'}` — exit codes unchanged.

## Content-Safety (HARD constraint)

The adapter writes ONLY the `msg`/`meta` it is given; callers pass ONLY counts, phase names, timing,
drift, snapshot id/fingerprint — NEVER resolved config, URIs, credentials, or sampled values.
`openConnections`' "resolved secrets are NEVER logged" invariant is preserved (no new logging of
`resolved`). Meta objects MUST be count/phase scalars only.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Console logger | Captured-output seam: inject `write`, assert lines + level suppression (`--quiet` hides info, keeps warn/error). |
| Unit | `formatSyncSummary` | Golden-pinned byte-identical string (ADR-008); no timing in output. |
| Unit | `runSync` emits summary | Fake adapter/store + noop/captured logger; assert returned `SyncSummary` + phase logs. |
| Unit | Non-leakage (security) | Plant sentinel secret in config; assert it NEVER appears in captured logger output. |
| Unit | Banner | Assert `USAGE_TEXT` does NOT contain "Claude Desktop" and lists supported agents. |
| Regression | `--json` / status / exit codes | Existing goldens stay green; diagnostics on STDERR only. |

## Migration / Rollout

No migration. Fully additive at the contract level — both injection points default to noop. Revert =
delete adapter + formatter, restore noop defaults, revert the one-line banner edit. No schema/exit-code
changes. Local-only on `closeout` (no CI; gate = `tsc --noEmit` + lint + `npm test`).

## Batch Ordering (TDD)

1. **Console `Logger` adapter** + STDERR write-seam + capture/level tests + `--quiet` parse.
2. **`formatSyncSummary`** + `runSync` `SyncSummary` wiring + dispatch logger injection + observable-sync, golden, and content-safety tests; confirm `--json` byte-identity.
3. **`cli.ts` banner fix** + banner-text test.

## Open Questions

- [ ] `runSync` has TWO callers: `dispatch.ts` `handleSync` AND `init.ts` `syncAfterInit` (verified via grep). The latter currently discards the result and runs silently. Decision: make BOTH observable (thread a logger + write the summary). The `HandlerOutcome → SyncSummary` return-type change is source-compatible at both sites because neither uses fields of the old `{type}` union beyond discarding it — `cli.ts` still receives `{type:'success'}` from the handler, not from `runSync`. No callers outside `src/cli/**`.
