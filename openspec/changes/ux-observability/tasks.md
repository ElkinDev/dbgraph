# Tasks: UX Observability — Wire the Console Logger, Speak the Sync Summary

Standing header (every task): STRICT TDD (RED→GREEN→refactor; the failing test PRECEDES the code). HEXAGONAL
(ADR-004): the `Logger` PORT in `src/core/ports/logger.ts` is UNCHANGED; the console adapter lives in the CLI
layer (`src/cli/log/`), the pure summary formatter alongside the existing `src/cli/format/status.ts` + `diff.ts`.
DETERMINISM (ADR-008): timing flows through the logger SEAM, NEVER into the pinned formatter. CONTENT-SAFETY
(dbgraph-security, HARD): logger + formatter emit ONLY counts, phase names, timing, drift state, and snapshot
id/fingerprint — NEVER a connection-string value, resolved secret, or sampled data value. STREAM DISCIPLINE:
diagnostics/progress → STDERR via the injected write-seam; `--json`/machine payloads stay on STDOUT, BYTE-IDENTICAL.
Strict TS, NO `any`. EXACT / golden-pinned assertions (`.toBe` / `.toStrictEqual`); existence-only `.toBeDefined()`
is FORBIDDEN. English; conventional commits referencing US-005 (observable-sync) / US-004 (deterministic
presentation). NO CI for this change (96% quota) — the LOCAL gate (`npx tsc --noEmit` + `npm run lint` 0/0 +
`npm test`) is the ONLY safety net; nothing is pushed past `closeout`.

RESOLVED design decisions — apply MUST NOT re-litigate these (from design.md §Architecture Decisions / Open Questions):
- **`createConsoleLogger({ write?, level? })` → `Logger`** in `src/cli/log/console-logger.ts` (D1/D2): a DUMB sink
  formatting `level msg [meta]` lines to an INJECTABLE write-seam (default `(t) => { process.stderr.write(t); }`).
  Tests capture via the seam — NO real stdio. Content-safety depends on callers passing ONLY count/phase scalars
  into `meta`; the adapter never inspects or resolves config.
- **`LogLevel = 'debug' | 'info' | 'warn' | 'error'`** (D7): default level `'info'`; `--quiet` lowers to `'warn'`
  (suppresses debug/info/progress, KEEPS warn/error). Suppression is level-based inside the adapter.
- **`formatSyncSummary(view: SyncSummary): string`** PURE in `src/cli/format/sync.ts` (D3): mirrors
  `format/status.ts` shape (`lines[].join('\n') + '\n'`, sorted kinds, no `Date.now()` / `process.env`). Per-kind
  counts + upserted/deleted totals + drift state + snapshot id/fingerprint. **NO timing in the pinned body** (D4).
- **`SyncSummary`** shape (design §Interfaces): `{ mode: 'full'|'incremental'|'skipped'; counts: Record<string,number>;
  upserted: number; deleted: number; hasDrift: boolean; snapshotId: string; fingerprint: string }`. Skipped path
  returns `{ mode:'skipped', counts:{}, upserted:0, deleted:0, hasDrift:false, snapshotId:'', fingerprint:liveFingerprint }`.
- **`runSync` returns `SyncSummary`** (D5, was `HandlerOutcome {type:'success'}`); `SyncOptions` gains `logger?: Logger`
  defaulting to `noopLogger` (D6 — back-compat, mirrors `openConnections`). `runSync` logs phases via the logger and
  builds the summary; it does NOT format or write I/O.
- **TWO callers of `runSync`** (Open Question, verified via grep): `dispatch.ts handleSync` AND `init.ts syncAfterInit`.
  BOTH must build a logger, pass it to `openConnections` + `runSync`, and write `formatSyncSummary(...)` to STDOUT —
  else post-init sync stays silent. `cli.ts` still receives `{type:'success'}` from the HANDLER (exit codes unchanged).
- **`--quiet`/`-q`** (D7): `-q` already parses as a boolean short flag (`parse/args.ts` L80–83); `--quiet` MUST be
  added to `BOOLEAN_LONG_FLAGS` (L29) or it greedily consumes the next token as a value. `handleSync` reads
  `args.flags['quiet'] === true || args.flags['q'] === true`.
- **Banner** (D8): `cli.ts` `USAGE_TEXT` install line (L36) "Wire dbgraph-mcp into the Claude Desktop config" →
  multi-agent phrasing consistent with `install.ts`'s `MANUAL_SNIPPET` ("Supported agents: Claude Code, Cursor,
  Gemini CLI, VS Code, opencode, Codex CLI" — single source of truth). MUST NOT say "Claude Desktop".

Per-batch GATE (ALL must pass before the next batch): `npx tsc --noEmit` clean (strict, no `any`) · `npm run lint`
0 errors / 0 warnings · `npm test` (`vitest run`) green. EVERY batch additionally re-proves the regression net:
existing `--json` goldens, status/diff/query formatters, exit-code suite, and the `test/security/no-secret-leak.test.ts`
gate stay GREEN. Diagnostics MUST appear on STDERR only — never STDOUT.

## Batch 1: Console `Logger` adapter + STDERR write-seam + `--quiet` parse (pure units, no wiring)

> Satisfies cli-config MODIFIED "sync is incremental … MUST be OBSERVABLE" (the logger-seam + verbosity half) and
> US-005's user-facing-output obligation. PURE adapter + parser change — NO wiring into commands yet, NO behavior
> change to any command. The write-seam is the load-bearing testability contract: tests capture output WITHOUT real
> stdio. Maps to spec scenarios "--quiet suppresses progress but keeps warnings and errors" and (foundation for)
> "--json payloads stay byte-identical and diagnostics go to STDERR".

- [x] 1.1 RED→GREEN `test/cli/log/console-logger.test.ts` (new) + `src/cli/log/console-logger.ts` (new): define
  `LogLevel` + `ConsoleLoggerOptions { write?, level? }` + `createConsoleLogger(opts?): Logger`. Inject a capturing
  `write: (t) => lines.push(t)` seam; assert `logger.info('extract…')` / `.warn(...)` / `.error(...)` emit a
  formatted `level msg` line through the seam (EXACT string, `.toBe`), and that `meta` count/phase scalars render
  deterministically (same input → same bytes). Assert the adapter satisfies the `Logger` port type (compile-level —
  assign to `Logger`). NO real `process.stderr` touched in the test. Spec scenario: "--json payloads stay
  byte-identical and diagnostics go to STDERR" (STDERR-seam half). Done: `npm test console-logger`.
- [x] 1.2 RED→GREEN `test/cli/log/console-logger.test.ts` (extend): level suppression. Default level `'info'` emits
  debug?(no)/info/warn/error per the contract; `createConsoleLogger({ write, level: 'warn' })` (the `--quiet` level)
  SUPPRESSES `debug` + `info` (zero seam writes) while STILL emitting `warn` + `error`. Assert captured line count +
  exact surviving lines (`.toStrictEqual` on the captured array). Spec scenario: "--quiet suppresses progress but
  keeps warnings and errors". Done: `npm test console-logger`.
- [x] 1.3 RED→GREEN `test/cli/parse/args.test.ts` (extend) + `src/cli/parse/args.ts`: add `'quiet'` to
  `BOOLEAN_LONG_FLAGS` (L29). RED first: assert `parseArgv(['sync','--quiet','extra']).flags['quiet'] === true` AND
  `positionals === ['extra']` (proves `--quiet` does NOT greedily consume the next token); assert `-q` already parses
  as `flags['q'] === true` (regression guard, no code change for `-q`). Spec scenario: "--quiet suppresses progress
  but keeps warnings and errors" (parse half). Done: `npm test args`.
- [x] 1.4 GATE (Batch 1): `npx tsc --noEmit` clean (no `any`); `npm run lint` 0/0; `npm test` full suite green. Confirm
  NO command behavior changed yet (dispatch/sync/init untouched) — the adapter + flag are dormant until Batch 2. Confirm
  the existing `--json`/status/diff/exit-code/no-secret-leak suites are UNCHANGED-green. Done: all three gate commands pass.

## Batch 2: `formatSyncSummary` (golden) + `runSync`→`SyncSummary` + wire BOTH callers + `--quiet` + safety/JSON regression

> Satisfies cli-config MODIFIED "sync … MUST emit a final SUMMARY through the injected Logger … produced by a PURE,
> deterministic, golden-pinnable formatter" (US-005 + US-004) and the content-safety + stream-discipline clauses. This
> is the load-bearing batch: it makes BOTH `runSync` callers observable, pins the summary golden, and proves no secret
> leak + `--json` byte-identity. The `HandlerOutcome → SyncSummary` return change touches the two callers + the existing
> `runSync` unit tests that assert `{type:'success'}` — ALL must be updated in this batch.

- [x] 2.1 RED→GREEN `test/cli/format/sync.test.ts` (new) + `src/cli/format/sync.ts` (new): define the `SyncSummary`
  interface (per RESOLVED shape) + PURE `formatSyncSummary(view): string`. Golden-pin the EXACT output string
  (`.toBe`) for a known delta view — per-kind counts (SORTED kinds), `upserted`/`deleted` totals, drift state, snapshot
  id + fingerprint; mirror `format/status.ts` line shape (`lines[].join('\n')+'\n'`). Assert determinism:
  `formatSyncSummary(view) === formatSyncSummary(view)` byte-for-byte (run1 `.toBe` run2). Assert NO timing token /
  no `ms`/elapsed substring appears in the output (ADR-008, D4). Add a `mode:'skipped'` golden line ("already up to
  date"). Spec scenario: "sync emits a deterministic golden-pinned summary". Done: `npx tsc --noEmit`; `npm test format/sync`.
- [x] 2.2 RED→GREEN `test/cli/commands/sync.test.ts` (extend) + `src/cli/commands/sync.ts`: change `SyncOptions` to add
  `logger?: Logger` (default `noopLogger` from `../../index.js`); change `runSync` return to `Promise<SyncSummary>`
  (build it in step 9/10: `mode` = `full?'full':'incremental'` on extract, `'skipped'` on the short-circuit;
  `counts` from `buildCounts`; `upserted = delta.toUpsert.length`; `deleted = delta.toDelete.length`;
  `hasDrift = storedFingerprint !== null && storedFingerprint !== liveFingerprint`; `snapshotId = snapshot.id`;
  `fingerprint = liveFingerprint`). Emit phase logs via the injected logger: `info('extract started'|'extraction skipped')`,
  `info('delta computed', {upserted, deleted})`, `info('snapshot written', {id})`. RED first: assert the returned
  `SyncSummary` fields with a fake adapter/store + a CAPTURING logger; assert the expected phase lines were logged (exact
  `.toStrictEqual` on captured array). Spec scenarios: "Changed source applies only the delta and records a snapshot",
  "Unchanged fingerprint skips extraction" (now emits an up-to-date line, no silent exit), "--full forces a complete
  rebuild". Done: `npx tsc --noEmit`; `npm test commands/sync`.
- [x] 2.3 UPDATE (RED expected, then GREEN) the EXISTING `runSync` assertions in `test/cli/commands/sync.test.ts` that
  read `outcome.type === 'success'` (the `describe('runSync — delta application')` "returns success outcome" case at
  ~L287–294, and any `{type:'success'}` reliance): replace with `SyncSummary` field assertions (`.mode`, `.counts`,
  `.upserted`, `.deleted`, `.fingerprint`). These tests MUST go RED on the signature change and GREEN once updated — do
  NOT delete coverage, MIGRATE it. Done: `npm test commands/sync` green.
- [x] 2.4 RED→GREEN `test/cli/commands/sync.test.ts` (extend) — content-safety NON-LEAKAGE: plant a SENTINEL secret
  (e.g. `'S3CR3T-SENTINEL'`) into the path that resolves connection identity (through REAL config resolution feeding
  the fake adapter/store, NOT hand-injected into `meta`), run a sync with a CAPTURING logger + capture the formatted
  summary, then assert the FULL captured output (all logger lines + the formatted summary) NEVER contains the sentinel,
  any connection-string value, or a sampled data value. Spec scenario: "sync output never leaks secrets or sampled
  data". Done: `npm test commands/sync`; `test/security/no-secret-leak.test.ts` still green.
- [x] 2.5 RED→GREEN `test/cli/dispatch.test.ts` (new or extend) + `src/cli/dispatch.ts`: `handleSync` builds
  `createConsoleLogger({ level: (args.flags['quiet'] === true || args.flags['q'] === true) ? 'warn' : 'info' })`,
  passes it to `openConnections(projectRoot, logger)` AND `runSync({ adapter, store, full, logger })`, then writes
  `formatSyncSummary(summary)` to `process.stdout` (mirroring `handleStatus`' `process.stdout.write(result.output)`).
  The other handlers that call `openConnections` (`handleStatus`/`handleQuery`/`handleExplore`/`handleAffected`/`handleDiff`)
  pass the SAME logger so adapter strategy-selection diagnostics surface on STDERR. RED: assert `handleSync` writes a
  non-empty STDOUT payload that equals `formatSyncSummary(<expected summary>)`, and that `--quiet` produces NO info
  progress on the captured STDERR seam while STDOUT summary is UNCHANGED. `handleSync` still returns `{type:'success'}`
  (exit code unchanged). Spec scenarios: "Observable output does not change exit codes", "--quiet suppresses progress
  but keeps warnings and errors". Done: `npx tsc --noEmit`; `npm test dispatch`.
- [x] 2.6 RED→GREEN `test/cli/commands/init.test.ts` (extend) + `src/cli/commands/init.ts`: thread a logger through the
  SECOND `runSync` caller. `syncAfterInit` builds a `createConsoleLogger(...)`, passes it to `openConnections` +
  `runSync`, and writes `formatSyncSummary(summary)` to `process.stdout` so post-init sync is OBSERVABLE (today it
  discards the result and runs silent). `syncAfterInit` return stays `Promise<void>` (result discarded after formatting)
  — source-compatible with `runInit`'s `_syncFn` seam. RED: assert that after `runInit` (real `syncAfterInit`, fake
  connections) a non-empty sync summary reaches STDOUT. Spec scenario: "sync emits a deterministic golden-pinned
  summary" (post-init path). Done: `npx tsc --noEmit`; `npm test commands/init`.
- [x] 2.7 RED→GREEN `test/cli/cli.test.ts` (extend) or `test/cli/e2e.test.ts`: confirm `--json` BYTE-IDENTITY +
  stream discipline. For a `--json`-supporting command (`query`/`affected`), assert STDOUT is byte-identical to the
  pre-change golden (existing `--json` goldens are the regression net) AND that human diagnostics/progress appear on the
  STDERR seam ONLY, never STDOUT. Spec scenario: "--json payloads stay byte-identical and diagnostics go to STDERR".
  Done: `npm test` (the `--json` suites pass UNCHANGED).
- [x] 2.8 GATE (Batch 2 — load-bearing): `npx tsc --noEmit` clean (no `any`); `npm run lint` 0/0; `npm test` full suite
  green INCLUDING the migrated `runSync` tests (2.3), the non-leakage test (2.4), the `--json` byte-identity (2.7), and
  the unchanged exit-code + `no-secret-leak` suites. Confirm `git diff` on existing `test/golden/**` / `--json` goldens
  is EMPTY (no re-bless) — ANY drift is a HARD STOP (observability leaked into a machine payload; investigate, do NOT
  re-bless). Spec scenarios: "--json payloads stay byte-identical…", "Observable output does not change exit codes".
  Done: all gate commands green; no golden re-bless.

## Batch 3: `cli.ts` banner fix + banner-text test (cheapest, isolated)

> Satisfies cli-config MODIFIED "CLI top-level help/usage banner accurately describes every command" (the `install`
> multi-agent line). One-line `USAGE_TEXT` edit + a pinning test. Zero behavioral risk; lands the 9.5a SUGGESTION-1.

- [x] 3.1 RED→GREEN `test/cli/cli.test.ts` (extend the existing `describe('cli — USAGE_TEXT')` block) +
  `src/cli/cli.ts`: edit the `install` line in `USAGE_TEXT` (L36) from "Wire dbgraph-mcp into the Claude Desktop config
  (--remove to undo)" to multi-agent phrasing consistent with `install.ts`'s `MANUAL_SNIPPET` (supported MCP agents,
  `--remove` to undo). RED first: assert `USAGE_TEXT` does NOT contain `'Claude Desktop'` AND describes the
  multi-agent `install` (e.g. contains `'agents'` / supported-agent wording) — pin so a future single-agent regression
  FAILS the build. Spec scenarios: "install banner line describes the multi-agent reality", "Banner agent wording stays
  consistent with install's source of truth". Done: `npm test cli`.
- [x] 3.2 GATE (Batch 3 — final): `npx tsc --noEmit` clean; `npm run lint` 0/0; `npm test` full suite green. Confirm the
  banner change is text-only (no command/exit-code behavior touched) and ALL prior-batch suites remain green. Done: all
  three gate commands pass.

## Apply Batch Grouping (one sub-agent session each)

- **Batch 1** (1.1–1.4): `src/cli/log/console-logger.ts` (`createConsoleLogger` + STDERR write-seam + level suppression)
  + `parse/args.ts` `--quiet` long-flag entry. PURE units; NO command wiring; NO behavior change.
- **Batch 2** (2.1–2.8): `src/cli/format/sync.ts` (`formatSyncSummary` golden) + `src/cli/commands/sync.ts`
  (`runSync`→`SyncSummary` + logger) + wire BOTH callers (`dispatch.ts handleSync` + `init.ts syncAfterInit`) +
  `--quiet` in `handleSync` + content-safety non-leakage + migrate the old `{type:'success'}` `runSync` tests +
  `--json` byte-identity. The load-bearing batch.
- **Batch 3** (3.1–3.2): `cli.ts` `USAGE_TEXT` banner one-line fix + banner-pinning test. Cheapest, isolated.

> Ordering note: this follows DESIGN §Batch Ordering (adapter+parse → formatter+wiring → banner), which deliberately
> INVERTS the proposal's "banner first" suggestion — the banner is trivial and isolated, so it is deferred to last to
> keep Batches 1–2 focused on the load-bearing observability seam. Either order is correct; design's order is authoritative.

### Dependency bottlenecks

- **Batch 1 (1.1 adapter + write-seam) gates Batch 2 entirely.** `handleSync`/`syncAfterInit` (2.5/2.6) and the
  `runSync` capturing-logger tests (2.2/2.4) all construct `createConsoleLogger`. The INJECTABLE write-seam is the
  load-bearing testability contract — without it, observability tests would touch real stdio and could not assert
  STDOUT/STDERR discipline.
- **2.2 (`runSync`→`SyncSummary`) gates 2.3/2.5/2.6.** The return-type change ripples to BOTH callers AND the existing
  `runSync` unit tests; 2.3 MUST migrate the `{type:'success'}` assertions or the suite stays RED. The default
  `logger = noopLogger` (D6) is what keeps the MCP path and any non-updated caller green.
- **2.1 (`formatSyncSummary` golden) gates 2.5/2.6** (both callers write `formatSyncSummary(...)` to STDOUT). The golden
  must be byte-deterministic with NO timing (D4) or the wiring tests inherit a flaky golden.
- **TWO-caller bottleneck (HARD):** if only `handleSync` is wired and `syncAfterInit` (2.6) is forgotten, the FIRST
  post-init sync stays SILENT — defeating the change's primary purpose. Both 2.5 AND 2.6 are mandatory.
- **`--json` byte-identity (2.7) + non-leakage (2.4) are the no-CI safety net.** With no CI, a logger line accidentally
  hitting STDOUT (polluting a `--json` payload) or a leaked secret would otherwise ship undetected. These two tests +
  the existing `no-secret-leak` gate are load-bearing.
- **Batch 3 is independent** of Batches 1–2 (text-only) and could ship first; it is sequenced last only to keep the
  observability work contiguous.

## Definition of Done (tied to the proposal's Acceptance Criteria)

- [x] `dbgraph sync` prints visible PROGRESS (extract started/skipped, delta computed, snapshot written) and a final
  SUMMARY (per-kind counts, upserted/deleted delta, drift state, snapshot id/fingerprint) through the wired console
  logger + pure formatter — no more silent runs, from BOTH `handleSync` AND the post-init `syncAfterInit` path. — Batch 2 (2.2, 2.5, 2.6)
- [x] The sync summary is produced by a PURE deterministic formatter, golden-pinned (ADR-008); elapsed timing is NOT in
  the pinned body (timing flows through the logger seam). — Batch 2 (2.1)
- [x] The console logger is unit-tested via a CAPTURED-OUTPUT write-seam — no real stdout/stderr in tests. — Batch 1 (1.1, 1.2)
- [x] A test asserts NO secret, connection-string value, or sampled data value appears in captured logger/formatter
  output (dbgraph-security); the `no-secret-leak` gate stays green. — Batch 2 (2.4)
- [x] `--quiet`/`-q` suppresses info/progress while preserving warn/error; `--quiet` parses without consuming the next
  token. — Batch 1 (1.2, 1.3), Batch 2 (2.5)
- [x] All existing command tests pass (the migrated `runSync` `{type:'success'}` tests now assert `SyncSummary`); every
  `--json` output is BYTE-IDENTICAL to before, diagnostics on STDERR only; exit codes (0/1/2/3/4) unchanged. — Batch 2 (2.3, 2.7, 2.8)
- [x] The `cli.ts` help/usage banner describes `install` as multi-agent (NO "Claude Desktop"), consistent with
  `install.ts`'s `MANUAL_SNIPPET`; a unit test pins the banner so a single-agent regression fails the build. — Batch 3 (3.1)
- [x] `npx tsc --noEmit` strict clean (NO `any`); `npm run lint` 0 errors / 0 warnings; `npm test` green; no
  `test/golden`/`--json` re-bless — all proven LOCALLY (no CI burn), nothing pushed past `closeout`. — Batch 1 (1.4), Batch 2 (2.8), Batch 3 (3.2)
