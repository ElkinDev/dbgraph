# Verification Report — ux-observability

**Change**: `ux-observability`
**Branch**: `closeout`
**Artifact store**: openspec (files)
**Mode**: Strict TDD (`strict_tdd: true` in `openspec/config.yaml`)
**Verified commits**: `0db4edd` (Batch 1), `e98eb08` (Batch 2), `0c2f819` (Batch 3)

## Verdict: PASS

All MUST-level spec scenarios are behaviorally compliant with a passing test. The full local gate is green (tsc clean, lint 0/0, 2855/2855 tests). Both `runSync` callers are wired with tests that would fail if the wiring were removed. The summary formatter is pure and byte-deterministic, there is no `test/golden` drift, the MCP path is untouched, and ADR-004 boundaries are respected. Zero CRITICAL findings. Three WARNINGs (proof-strength / process, non-blocking) and five SUGGESTIONS.

## Gate (measured by the verifier)

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | PASS exit 0 — clean (strict, no `any`) |
| `npm run lint` (`eslint .`) | PASS exit 0 — 0 errors / 0 warnings |
| `npx vitest run` | PASS exit 0 — 2855 passed / 2855, 166 test files, 0 failed, 0 skipped |
| `test/golden` drift | PASS none — no golden/snapshot file touched by any of the 3 commits |

## Completeness

| Metric | Value |
|--------|-------|
| Numbered tasks (1.1 to 3.2) | 14 |
| Tasks complete [x] | 14 |
| Tasks incomplete | 0 |
| Definition-of-Done items [x] | 7 / 7 |

All tasks checked. Checkbox state matches code state.

## Spec Compliance Matrix

### cli-config MODIFIED: sync is incremental AND observable (US-005 / US-004)

| Scenario | Test (file > name) | Result |
|----------|--------------------|--------|
| Unchanged fingerprint skips extraction (plus already-up-to-date line, no silent exit) | sync.test.ts > "skips extraction when live fingerprint equals last snapshot fingerprint" + "returns mode:skipped and logs extraction skipped" + format/sync.test.ts > renders the already-up-to-date line for mode:skipped (exact .toBe golden) | COMPLIANT |
| Changed source applies only the delta and records a snapshot | sync.test.ts > "performs extraction when fingerprint differs" + "upserts new nodes and records a snapshot with counts" + "returns a full SyncSummary and logs extract to delta to snapshot phases" | PARTIAL — upsert proven; delete sub-claim (store.deleteNodes, summary.deleted) never exercised with deleted greater than 0 (W2) |
| --full forces a complete rebuild | sync.test.ts > "forces extraction even when fingerprint is unchanged" + "mode is full when --full forces extraction over an unchanged fingerprint" | COMPLIANT |
| sync emits a deterministic golden-pinned summary | format/sync.test.ts > "renders the exact golden string" (.toBe) + "is deterministic - same input yields byte-identical output" + "contains NO timing token" | COMPLIANT |
| sync output never leaks secrets or sampled data | sync.test.ts > "captured logger output + formatted summary contain ONLY counts/id/fingerprint - never the sentinel" (.not.toContain(SENTINEL) over captured + rendered) | PARTIAL — schema-name / identifier / sampled-value vectors covered; resolved-connection-secret half not exercised (W1) |
| --json payloads stay byte-identical and diagnostics go to STDERR | e2e.test.ts > "query --json writes ONLY the JSON payload to STDOUT ... byte-identical on re-run" (JSON.parse of full STDOUT + no [info]/[warn]/[error] + r1.stdout equals r2.stdout) + "affected --json also keeps STDOUT free" + console-logger.test.ts (STDERR seam) | COMPLIANT |
| --quiet suppresses progress but keeps warnings/errors | console-logger.test.ts > "--quiet level (warn): suppresses debug + info, STILL emits warn + error" (.toStrictEqual) + args.test.ts > "--quiet parses as boolean true" + dispatch.test.ts > "--quiet suppresses info progress on STDERR but STILL writes the summary to STDOUT" | COMPLIANT |
| Observable output does not change exit codes | dispatch.test.ts > "writes the formatted SyncSummary to STDOUT" (asserts outcome equals type:success) + e2e.test.ts (query --json code equals 0) | COMPLIANT |

### cli-config MODIFIED: top-level help/usage banner accuracy (US-038)

| Scenario | Test (file > name) | Result |
|----------|--------------------|--------|
| install banner line describes the multi-agent reality | cli.test.ts > "install line does NOT describe a single agent (Claude Desktop)" + "install line describes supported MCP agents (multi-agent), with --remove to undo" | COMPLIANT |
| Banner agent wording stays consistent with install source of truth | cli.test.ts > "banner agent wording is consistent with install MANUAL_SNIPPET" | COMPLIANT (loose — see S2) |

### mcp-server verify-only (no ADDED/MODIFIED/REMOVED)

| Conclusion | Evidence | Result |
|------------|----------|--------|
| Wiring a CLI logger MUST NOT alter the MCP path | No src/mcp or src/adapters/mcp file touched by the 3 commits; openConnections signature unchanged (logger defaults to noopLogger); all MCP suites green in the 2855-test run | CONFIRMED |
| Claude-Desktop wording belongs to cli-config, not mcp-server | Banner fix landed only in src/cli/cli.ts; no mcp-server spec text changed | CONFIRMED |

Compliance summary: 10/10 scenarios covered by passing tests — 8 fully COMPLIANT, 2 PARTIAL (proof-strength gaps, not violations).

## Adversarial Checks

| Check | Finding |
|-------|---------|
| formatSyncSummary purity / byte-determinism | PASS — grep for Date.now / process.env / Math.random / IO in format/sync.ts returns only doc-comments. snapshotId/fingerprint come from the input view; the golden pins exact bytes with fixed input. |
| BOTH callers wired (dispatch + init) | PASS — dispatch.ts handleSync (L131-146) and init.ts syncAfterInit (L117-127) each pass the logger to openConnections + runSync and write formatSyncSummary(summary) to STDOUT. Failing-if-removed tests: dispatch 2.5 asserts stdout equals formatSyncSummary(expected); init 2.6 asserts STDOUT contains Sync Summary + mode incremental. Grep confirms exactly two runSync callers and two formatSyncSummary write sites. |
| --json byte-identity would catch a stray STDOUT logger line | PASS — the e2e test runs JSON.parse over the FULL captured STDOUT (not a substring): any [info]-style line breaks JSON.parse and fails the test. Also asserts not.toContain [info]/[warn]/[error] and r1.stdout equals r2.stdout. |
| Content-safety sentinel over COMPLETE output | PARTIAL — sentinel planted in schema name, object identifier (name/qname) AND sampled value (payload.sampledValue); asserted .not.toContain(SENTINEL) over captured + rendered with positive controls. Resolved-connection-secret vector not planted (W1). |
| --quiet via level mechanism, suppressed case tested | PASS — suppression is level-based inside the adapter; suppressed case asserted with .toStrictEqual excluding [info]; enabled case (warn/error survive) also asserted. |
| ADR-004 import graph | PASS — console-logger imports only the Logger type from core/ports + node builtins; format/sync imports nothing; sync/dispatch/init import the barrel + CLI siblings + core ports. No adapter-into-core, no core-into-cli. |
| Golden drift (test/golden) | PASS — per-commit check: 0db4edd, e98eb08, 0c2f819 touch zero golden/snapshot files. |

## Documented Deviations — Evaluation

| Deviation | Evaluation |
|-----------|------------|
| noopLogger imported from core/ports/logger.js instead of the ../../index.js barrel | ACCEPT — importing the canonical core port module is ADR-004 compliant (cli-into-core allowed) and arguably a better single source. No behavioral impact. |
| Content-safety sentinel planted at the adapter seam instead of config resolution | ACCEPT with note (W1) — runSync structurally never receives the resolved connection identity, so it cannot leak a connection secret. openConnections is unchanged and documents that resolved secrets are NEVER logged; the now-live mssql strategy registry logs only strategy ids + static reasons (documented + unit-tested content-safe). Recommend a defense-in-depth test (S5). |
| Elapsed-timing lines deliberately not implemented | ACCEPT — the spec routes timing through the logger seam and keeps it OUT of the pinned formatter; MUST-level progress lines and all summary fields are implemented. Timing is optional (absent from Acceptance Criteria and the at-minimum progress list). |

## TDD Compliance (Strict TDD Mode)

| Check | Result | Details |
|-------|--------|---------|
| Formal TDD Cycle Evidence table present | WARN | No engram apply-progress artifact in openspec mode; TDD evidence is embedded as per-task RED-to-GREEN annotations + named test files in tasks.md. Not escalated to CRITICAL — substance independently verified. See W3. |
| Every task has a test file that EXISTS | PASS | 14/14 named test files present. |
| GREEN confirmed (tests pass on execution) | PASS | 2855/2855 pass. |
| Assertions exact (.toBe/.toStrictEqual), not existence-only | PASS | Goldens use exact-string .toBe; suppression + phase logs use .toStrictEqual; non-leakage uses .not.toContain over complete output with positive controls. |
| Old type:success coverage MIGRATED not deleted (2.3) | PASS | sync.test.ts migrated test + mssql.e2e.integration.test.ts updated to assert summary.mode/fingerprint. |

### Assertion Quality Audit (Step 5f)

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| console-logger.test.ts | 34 | expect(logger).toBeDefined() | Type-only, paired with compile-level const-logger-Logger contract; behavior covered by 15+ real assertions in the same file | SUGGESTION |
| console-logger.test.ts | 216 | expect(level).toBe(warn) after const level LogLevel = warn | Borderline tautology used as a type-export compile guard; hides nothing | SUGGESTION |

Assertion quality: 0 CRITICAL, 0 WARNING, 2 SUGGESTION. No tautologies masking behavior, no ghost loops, no smoke-tests, no mock-heavy tests. Assertion strength is HIGH.

### Test Layer Distribution

| Layer | Tests | Notes |
|-------|-------|-------|
| Unit | console-logger, format/sync, parse/args, commands/sync (fakes) | Captured-output seam — no real stdio |
| Integration | dispatch (real sqlite via openConnections), commands/init (real syncAfterInit + fixture), e2e (runCli end-to-end) | In-repo sqlite fixtures; no external tools |
| E2E (browser/HTTP) | none | Not applicable (CLI); testcontainers integration available:false per config |

Changed-file coverage: Not available — vitest coverage-v8 not installed (coverage.available:false). Not a failure.

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 adapter home src/cli/log/console-logger.ts | Yes | |
| D2 diagnostics to STDERR via injected write seam | Yes | Default write to process.stderr; tests inject capturing seam |
| D3 formatter home src/cli/format/sync.ts, pure | Yes | lines joined with newline + trailing newline, sorted kinds |
| D4 timing NOT in pinned formatter | Yes | No timing token — asserted |
| D5 runSync returns SyncSummary, handler formats+writes | Yes | |
| D6 logger defaults to noopLogger (back-compat) | Yes | works-without-logger test green |
| D7 --quiet lowers to warn; quiet in BOOLEAN_LONG_FLAGS | Yes | parse/args.ts L29 |
| D8 banner text supported-agents phrasing, no Claude Desktop | Yes | cli.ts L36 |

## Issues Found

CRITICAL (must fix before archive): None.

WARNING (proof-strength / process gaps — not spec violations, not bugs; do not block archive):
- W1 — Connection-secret leak vector untested. The never-leak scenario is proven only for the schema-name / identifier / sampled-value vectors (planted at the adapter seam). No new test plants a sentinel in the RESOLVED CONNECTION IDENTITY and asserts the now-live logger STDERR is clean end-to-end. Mitigated structurally: runSync never sees connection secrets; openConnections is unchanged; the mssql strategy registry logs only strategy ids + static reasons (documented + unit-tested content-safe); the pre-existing test/security/no-secret-leak.test.ts gate is green.
- W2 — runSync delete branch / summary.deleted never asserted non-zero. Every runSync test path has deleted equal to 0, so the store.deleteNodes(delta.toDelete) branch and the deleted = delta.toDelete.length wiring into the summary are not exercised. computeDelta delete-decision logic is unit-tested separately (incremental.test.ts), but a regression in the sync-to-summary delete-count wiring would not be caught at this level.
- W3 — No formal TDD Cycle Evidence table. Openspec mode records progress via tasks.md per-task RED-to-GREEN annotations rather than an engram apply-progress artifact. Not escalated to CRITICAL because the TDD substance was independently verified.

SUGGESTION (nice to have):
- S1 — Replace or drop the two compile-level type-guard assertions in console-logger.test.ts (L34, L216); the behavior is already thoroughly covered.
- S2 — The banner-consistency test asserts both strings mention agents but does not pin that the SIX specific agents match between USAGE_TEXT and AGENT_TABLE/MANUAL_SNIPPET; a divergence in the agent set would not fail the build.
- S3 — --json byte-identity is proven via self-consistency (r1 equals r2) + full-STDOUT JSON.parse; a committed pre-change golden snapshot would additionally catch payload-shape regressions.
- S4 — Elapsed-timing observability is spec-optional and unimplemented; consider adding it later through the logger seam (keeping it out of the pinned formatter).
- S5 — Add a defense-in-depth end-to-end test that plants a sentinel secret in an mssql connection config and asserts the wired logger STDERR never contains it (addresses W1).

## Verdict

PASS — All MUST-level scenarios compliant with passing tests; gate fully green (tsc 0, lint 0/0, 2855/2855); both runSync callers observable with failing-if-removed tests; formatter pure; no golden drift; MCP path untouched; ADR-004 respected. No CRITICAL. Two proof-strength WARNINGs (W1 connection-secret vector, W2 delete-count wiring) plus W3 (TDD-evidence format) are non-blocking. Safe to archive; address W1 and W2 opportunistically.
