# Proposal: UX Observability — Fix the Silent `sync` + Accurate Help Text

## Intent

`dbgraph sync` runs SILENT. The CLI command path opens connections via `openConnections(projectRoot)`
WITHOUT passing a logger, so the parameter falls back to `noopLogger` (`src/infra/open-connections.ts:71`),
and `runSync` (`src/cli/commands/sync.ts`) does the full extract → delta → upsert → snapshot work but
returns only `{ type: 'success' }` — it emits NOTHING to stdout. A user ran a real-DB sync against a live
database and saw nothing ("finalizó sin mensajes"): no progress, no counts, no timing, no drift, no
resulting node/edge totals. For a command that can take seconds-to-minutes against a remote DB, zero
feedback is a trust-breaking UX defect (Phase-6 UX finding). Unlike `status`/`query`/`explore`/`diff`,
which all `process.stdout.write(result.output)`, `sync` is the ONE long-running command with no output.

A second, smaller defect rides along (9.5a SUGGESTION-1): the top-level `USAGE_TEXT` banner in
`src/cli/cli.ts:36` still describes `install` as "Wire dbgraph-mcp into the Claude Desktop config".
That text is STALE — `install` became multi-agent in 9.5a (US-038): `AGENT_TABLE` in
`src/cli/commands/install.ts` now wires SIX agents (Claude Code, Cursor, Gemini CLI, VS Code, opencode,
Codex CLI). The help lies about what the command does.

**Why now**: this is the FIRST closeout change. The CLI is feature-complete and on `main`; the only thing
between it and a credible 1.0 distribution is that it is not observable. We fix observability before we
package binaries (9.5c), write Phase-7 docs, or run the AI benchmark (US-035) — because every one of those
downstream activities will exercise `sync` and inherit the silence if we don't fix it first.

**Success looks like**: `dbgraph sync` prints real progress and a final summary (per-kind counts, upserted/
deleted delta, drift, timing) through a wired console `Logger` adapter; the help banner accurately describes
the multi-agent `install`; NO secrets or sampled values ever appear in logs; existing command tests and all
`--json` outputs are byte-unchanged; `tsc` + lint + `npm test` are clean — all proven LOCALLY (no CI burn).

## Scope

### In Scope

- **A console `Logger` adapter** implementing the existing `Logger` port
  (`src/core/ports/logger.ts`: `debug`/`info`/`warn`/`error`, each `(msg, meta?)`). It writes
  human-readable lines to a STREAM SEAM (injected `write(text: string): void`, default `process.stderr.write`)
  so unit tests capture output without touching real stdio. Lives in the CLI layer (it is a presentation
  adapter, NOT core) — likely `src/cli/log/console-logger.ts`.
- **Wire that logger into the CLI command path** so the long-running commands become observable. Minimum:
  `handleSync` passes a real logger to `openConnections(...)` AND `runSync` accepts + uses an injected
  `Logger` to emit progress (extract started, delta computed, upsert/delete applied, snapshot written) and
  a final summary. Peers that call `openConnections` (`status`, `query`, `explore`, `diff`, `affected`)
  pass the same logger so adapter strategy-selection transparency (which `openConnections` already forwards
  to the mssql adapter) surfaces instead of vanishing into noop.
- **A structured `sync` summary via a PURE formatter**. `sync` currently has NO formatter and NO `output`
  (it is the only command without one). Add a pure, deterministic, golden-pinnable formatter for the sync
  summary — counts per kind, upserted/deleted totals, drift state, snapshot id/fingerprint — following the
  established `present/`-style shape (`lines[] → join('\n') + '\n'`, no `Date.now()`, no `process.env`).
  Timing (elapsed ms) is NOT part of the pinned formatter — it flows through the logger seam so the golden
  stays deterministic (ADR-008).
- **A verbosity contract**: a `--quiet`/`-q` flag (suppress info/progress, keep warn/error) and respect a
  reasonable default level. `--json` (where a command supports it) MUST remain machine-clean — diagnostics
  go to STDERR, structured/`--json` payloads stay on STDOUT, so logging never pollutes parseable output.
- **Fix the `cli.ts` help/usage banner**: replace the "Claude Desktop config" line with text reflecting the
  six-agent reality, kept consistent with `install.ts`'s `MANUAL_SNIPPET` supported-agents list.

### Out of Scope

- Standalone binaries / packaging / distribution tooling — that is the NEXT closeout change (9.5c).
- The AI benchmark (US-035) and Phase-7 docs — later closeout changes.
- New commands, or changing extraction / delta / snapshot BEHAVIOR. `sync` keeps the exact same algorithm
  and exit codes; we only make it SPEAK.
- A pluggable log-format framework, log files, log levels config, JSON-structured logs, or a third-party
  logging dependency (ADR-007 — no new packages for this).
- Reworking the MCP server's logging (the MCP adapter is not a human-facing console; this change is
  CLI-observability only).

## Capabilities

### Modified Capabilities

- **`cli-config`** (primary owner). It owns the command set, the exit-code contract, the help/usage text,
  and the `sync`/`status` output requirements. Two deltas:
  - The existing `sync is incremental by fingerprint` requirement gains a user-facing-output clause:
    `sync` MUST emit progress + a deterministic summary (counts/delta/drift) through the injected logger
    and a pure formatter — closing the gap that the requirement today only mandates the persisted snapshot,
    never any console output.
  - A new/updated requirement for the top-level help/usage banner accuracy (the `install` line MUST match
    the multi-agent reality).
- **`mcp-server`** — verify-only, likely NO change. `openConnections` is shared composition consumed by both
  CLI and MCP; the design phase MUST confirm wiring a CLI logger does not alter the MCP path (MCP keeps
  noop or its own logger). Flag here so spec/design checks it explicitly.

### New Capabilities

- None. The `Logger` PORT already exists (`src/core/ports/logger.ts`); we add an ADAPTER for it, which is
  not a new contract.

## Approach

Port-already-exists, adapter-and-wiring (ADR-004 hexagonal). The seam is clean and already half-built:

1. **`Logger` port (core, unchanged)** → **console adapter (CLI layer)**. The adapter takes a stream-write
   seam in its constructor (`{ write?, level? }`, default stderr + `info`) so it is unit-testable via
   captured output — no real stdout in tests (dbgraph-testing). It NEVER imports core internals beyond the
   `Logger` type; it is a thin presentation adapter.
2. **Pass the logger at the composition seam.** `openConnections(projectRoot, logger)` already accepts an
   optional logger (defaults to noop for back-compat) and already forwards it to the mssql adapter for
   strategy-selection transparency. The CLI dispatch handlers stop relying on the noop default and pass a
   real console logger. This single change makes adapter-level diagnostics visible for ALL commands.
3. **`runSync` emits through the logger + returns a structured summary.** `runSync` gains an injected
   `Logger` (default noop, so existing unit tests that call it without a logger stay green) and logs phase
   transitions. It builds a typed `SyncSummary` (counts, upserted, deleted, drift, snapshot id/fingerprint)
   and the handler renders it via the new PURE `formatSyncSummary` formatter, then writes the result —
   mirroring how `handleStatus` writes `result.output`. Timing is logged via the seam, kept OUT of the
   pinned formatter so the golden is byte-deterministic (ADR-008).
4. **Content-safety by construction.** Per dbgraph-security and the content-free `doctor` precedent: the
   logger and formatter emit ONLY counts, names of phases, timings, drift state, and snapshot metadata —
   NEVER connection-string values, resolved secrets, or sampled data values. `openConnections` already
   documents "resolved secrets are NEVER logged"; we preserve that invariant and add a test asserting no
   secret/value leakage in captured log output.
5. **Verbosity + stream discipline.** `--quiet` lowers the level; diagnostics go to STDERR so `--json`
   payloads on STDOUT remain machine-clean and byte-identical (the existing `--json` golden tests are the
   regression net here).
6. **Help banner** is a one-line text edit in `cli.ts` `USAGE_TEXT`, with a unit assertion that the banner
   text matches the six-agent reality (no "Claude Desktop").

This deliberately reuses the EXISTING port and the EXISTING `openConnections` logger parameter rather than
inventing new plumbing — the silence is a wiring omission, not a missing capability.

### User Story Framing

Frame against **US-005** (sync / incremental) for the observable-sync requirement and **US-017/US-004**
(status / deterministic presentation) for the pure-formatter + determinism constraints. If the team prefers
an explicit observability story, note a NEW story (e.g. US-039 "CLI commands are observable") in the spec
phase; otherwise the delta attaches to US-005's sync requirement as a user-facing-output clause.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/cli/log/console-logger.ts` | New | Console `Logger` adapter over a stream-write seam (default stderr, `--quiet` aware) |
| `src/cli/format/sync.ts` (or `core/present/sync.ts`) | New | PURE deterministic `formatSyncSummary` (counts/delta/drift/snapshot) — design picks the exact home |
| `src/cli/commands/sync.ts` | Modified | `runSync` accepts injected `Logger` (default noop), logs phases, returns `SyncSummary` for the handler to format |
| `src/cli/dispatch.ts` | Modified | Handlers construct the console logger, pass it to `openConnections`, and `handleSync` writes the formatted summary |
| `src/cli/cli.ts` | Modified | `USAGE_TEXT` install line → multi-agent text; possibly thread a `--quiet` flag through `runCli` |
| `src/cli/parse/args.ts` | Modified (if needed) | Recognize `--quiet`/`-q` if not already parsed generically |
| `test/cli/**` | New/Modified | Captured-output tests for the console logger; golden for `formatSyncSummary`; banner assertion; secret/value non-leakage test; `--json` byte-identity regression |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Logger leaks secrets / connection-string values / sampled data | Med | Adapter+formatter emit ONLY counts/phases/timing/drift/snapshot meta; explicit non-leakage test over captured output; preserve `openConnections` "never log resolved secrets" invariant |
| Logging pollutes `--json` / structured STDOUT and breaks parseability | Med | Diagnostics to STDERR, payloads to STDOUT; `--quiet` path; existing `--json` golden tests act as the regression net |
| Non-deterministic sync summary breaks a golden (timing/timestamps) | Med | Timing flows through the logger seam, NOT the pinned formatter; formatter is pure (no `Date.now()`/`process.env`), same input → byte-identical |
| Changing `runSync`/`openConnections` signatures breaks MCP or other callers | Med | Both new logger params DEFAULT to noop (back-compat preserved exactly as `openConnections` does today); design verifies the MCP path is unaffected |
| Altering exit codes while adding output | Low | Exit codes stay owned by `cli.ts`/`exit-code.ts`; handlers keep returning the same `HandlerOutcome`; only added I/O |
| No CI for this branch (96% quota) | High (process) | LOCAL gate is the ONLY net — `npx tsc --noEmit` + `npm run lint` + `npm test` MUST be clean before the change accumulates on `closeout`; NO PR / NO main-push until CI refreshes |

## Acceptance Criteria

- [ ] `dbgraph sync` against a real DB prints visible PROGRESS and a final SUMMARY (per-kind counts,
      upserted/deleted delta, drift state, snapshot id/fingerprint) — no more silent runs.
- [ ] The sync summary is produced by a PURE deterministic formatter, golden-pinned (ADR-008); timing is
      NOT in the pinned output.
- [ ] The console logger is unit-tested via a CAPTURED-OUTPUT seam (no real stdout in tests).
- [ ] A test asserts NO secret, connection-string value, or sampled data value appears in captured log
      output (dbgraph-security).
- [ ] `--quiet`/`-q` suppresses info/progress while preserving warn/error.
- [ ] All existing command tests pass UNCHANGED; every `--json` output is byte-identical to before
      (diagnostics on stderr only).
- [ ] The `cli.ts` help/usage banner describes `install` as multi-agent (no "Claude Desktop"); a unit test
      pins the banner text against the six-agent reality.
- [ ] `npx tsc --noEmit`, `npm run lint`, and `npm test` are all clean LOCALLY. No PR opened, no push to
      `main` — the change accumulates on `closeout` for a later single merge.

## Recommended Apply Batch Ordering

1. **Batch 1 — Help banner fix (cheapest, isolated).** Edit `USAGE_TEXT`; add the banner-content unit test
   (RED→GREEN). Zero behavioral risk; lands the 9.5a SUGGESTION-1 immediately.
2. **Batch 2 — Console logger adapter + pure sync formatter (pure units first).** Build the captured-output
   logger and `formatSyncSummary` with their tests, including the golden and the secret/value non-leakage
   test. No wiring yet — pure, fully local.
3. **Batch 3 — Wiring.** Thread the logger through `openConnections` calls in `dispatch.ts`, give `runSync`
   the injected logger + `SyncSummary` return, write the formatted summary in `handleSync`, add `--quiet`.
   Then run the FULL local gate (`tsc` + lint + test) and confirm `--json` byte-identity.

## Rollback Plan

Fully additive at the contract level — the `Logger` port is unchanged and both new injection points default
to noop. Revert by deleting the console-logger adapter and `formatSyncSummary`, restoring the noop defaults
in `dispatch.ts`/`runSync`, and reverting the one-line `USAGE_TEXT` edit. No persisted-data, schema, or
exit-code changes to undo. Because nothing is pushed past `closeout`, rollback is a local `git` operation.

## Dependencies

- No new packages (ADR-007). Uses the existing `Logger` port, the existing `openConnections` logger param,
  and Node builtins for the stream seam.
- Developed LOCALLY on branch `closeout`. Gate: `npx tsc --noEmit` + `npm run lint` + `npm test`
  (no Docker, no integration containers needed). No PR / no main-push until CI quota refreshes.
