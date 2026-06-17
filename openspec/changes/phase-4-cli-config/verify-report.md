# Verification Report — phase-4-cli-config

**Change**: phase-4-cli-config
**Spec version**: cli-config (new, 11 requirements / 31 scenarios) + graph-storage (delta: 1 ADDED + 2 MODIFIED requirements)
**Mode**: Strict TDD (ACTIVE)
**Artifact store**: openspec
**Verdict**: PASS — archivable with ZERO carry-over (no CRITICAL, no WARNING).

---

## Gates (independently executed — not trusted from apply)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | CLEAN — exit 0, no output |
| Tests | npm test (vitest run) | 61 files / 882 tests / 882 passed / 0 failed / 0 skipped — exit 0 |
| Lint | npm run lint (eslint .) | CLEAN — 0 errors, 0 warnings — exit 0 |
| Integration (MSSQL E2E) | npm run test:integration | NOT RUN locally (no Docker, by design). 5 gated tests + 1 skip placeholder. Correctly EXCLUDED from npm test via vitest.config.ts exclude '**/*.integration.test.ts'. |

Apply-progress reported 882/882; independent re-run confirms 882/882. Numbers match exactly.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 30 (1.1-1.6, 2.1-2.4, 3.1-3.3, 4.1-4.3, 5.1-5.3, 6.1-6.5, 7.1-7.6) |
| Tasks complete [x] | 30 |
| Tasks incomplete [ ] | 0 |

All tasks marked done; code state matches each task Done claim (verified by reading source + tests).

---

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | OK | apply-progress carries TDD Cycle Evidence tables for Batches B-F (A/G summarized) |
| All tasks have tests | OK | Every task maps to a test file under test/cli/**, test/core/present/**, or test/adapters/storage/sqlite/** |
| RED confirmed (test files exist) | OK | All referenced test files exist on disk |
| GREEN confirmed (tests pass) | OK | 882/882 pass on independent re-run |
| Triangulation adequate | OK | diff engine, computeDelta, exit-code, formatters all triangulated with multiple distinct-value cases |
| Safety net for modified files | OK | Store/migration changes ran the pre-existing sqlite + boundary suites green |

---

## Assertion Quality Audit (Step 5f) — L-009 discipline

Scanned all test files created/modified by the change. No tautologies, no ghost loops, no assertion-without-production-call, no smoke-only tests.

Endpoint-identity (L-009) is asserted with ACTUAL content, not existence/counts:
- test/cli/diff/engine.test.ts — "changed" asserts exact nodeId, kind, oldBodyHash to newBodyHash; "all three simultaneously" asserts EXACT nodeId arrays for added/removed/changed; "comparison is by nodeId not qname" proves identity semantics.
- test/cli/sync/incremental.test.ts — asserts exact toDelete/toUpsert id sets (not counts).
- test/cli/format/diff.test.ts — MODIFIED asserts specific qname dbo.sp_calc + kind + "definition changed (hash)"; golden pins procedure dbo.sp_calc.
- test/adapters/storage/sqlite/sqlite-graph-store.test.ts — "manifest rows match the actual node data" checks row.kind===node.kind, row.qname===node.qname, row.bodyHash===node.bodyHash per row.

Assertion quality: All assertions verify real behavior. 0 CRITICAL, 0 WARNING.

---

## Spec Compliance Matrix — cli-config (31 scenarios)

| Requirement | Scenario | Test (file > case) | Result |
|-------------|----------|--------------------|--------|
| Typed errors join set | Errors exist and exported | test/core/errors.test.ts + barrel.test.ts | COMPLIANT |
| Config model env-only | Valid config parses, env-only identity | parse-config.test.ts | COMPLIANT |
| Config model env-only | Unknown dialect rejected | parse-config.test.ts to UnsupportedDialectError | COMPLIANT |
| Config model env-only | Malformed level / missing field | parse-config.test.ts to ConfigError names field | COMPLIANT |
| Plaintext rejected / env resolved | Inline plaintext rejected | build-config.test.ts (literal host/user/password to ConfigError) | COMPLIANT |
| Plaintext rejected / env resolved | Env refs resolve at runtime | resolve-secrets.test.ts (all identity fields) | COMPLIANT |
| Plaintext rejected / env resolved | Missing env var fails loudly | resolve-secrets.test.ts (unset to ConfigError naming var; never empty) | COMPLIANT |
| init writes root config + gitignore | Non-interactive writes config, gitignores .dbgraph, syncs | init.test.ts + e2e.test.ts | COMPLIANT |
| init writes root config + gitignore | Never writes plaintext to disk | init.test.ts (literal pwd to ConfigError, no file written) | COMPLIANT |
| Interactive init capability-driven | Wizard offers only CapabilityMatrix types | wizard.test.ts (SQLite no procedure; MSSQL no collection) | COMPLIANT |
| Interactive init capability-driven | Wizard rejects literal credential | wizard.test.ts (re-prompt + env:VAR guidance) | COMPLIANT |
| Interactive init capability-driven | Interactive equals flag form (byte-identical) | init.test.ts byte-identity | COMPLIANT |
| sync incremental + --full | Unchanged fingerprint skips extraction | sync.test.ts + e2e.test.ts (2nd sync no new snapshot) | COMPLIANT |
| sync incremental + --full | Changed source applies only delta + records snapshot | incremental.test.ts (exact id sets) + sync.test.ts | COMPLIANT |
| sync incremental + --full | --full forces rebuild | sync.test.ts (--full skips fingerprint short-circuit) | COMPLIANT |
| status counts + snapshot + drift | status surfaces counts, last snapshot, DRIFT, excluded | format/status.test.ts + status.test.ts + e2e.test.ts | COMPLIANT |
| query stable JSON | query prints hits type+qname (exit 0) | query.test.ts + e2e.test.ts | COMPLIANT |
| query stable JSON | --json stable byte-identical | query.test.ts + e2e.test.ts (run1===run2) | COMPLIANT |
| query stable JSON | Zero results exits 1 | query.test.ts (negative) + exit-code.test.ts (negative to 1) | COMPLIANT |
| explore pure shared formatter | Renders bundle at requested detail | explore.test.ts + explore-format.test.ts (brief/normal/full) | COMPLIANT |
| explore pure shared formatter | Deterministic + golden-pinned | explore-format.test.ts (per-level run1===run2 + structural goldens) | COMPLIANT |
| explore pure shared formatter | Single source for MCP (pure fn) | explore-format.test.ts purity + core/boundaries.test.ts (core/present import-clean) | COMPLIANT |
| diff per-object CI gate | Groups added/removed/modified by type | diff/engine.test.ts + format/diff.test.ts | COMPLIANT |
| diff per-object CI gate | --last compares two most recent | diff.test.ts (--last) + e2e.test.ts | COMPLIANT |
| diff per-object CI gate | Exit reflects changes (0 none / 1 changes) | diff.test.ts + e2e.test.ts (no-change to success, mutation to negative) | COMPLIANT |
| Exit codes contract | Unreachable host exits 2 distinguishing msg | exit-code.test.ts (DNS/refused/timeout variants to 2); msg origin in Phase-3 mssql error-mapper | COMPLIANT |
| Exit codes contract | Missing permission exits 3 | exit-code.test.ts (PermissionError to 3) | COMPLIANT |
| Exit codes contract | Unsupported dialect exits 4 | exit-code.test.ts (UnsupportedDialectError to 4) | COMPLIANT |
| CLI never imports adapter | Boundary test fails on direct adapter import | test/cli/boundaries.test.ts (negative-control proves scanner bites) | COMPLIANT |

cli-config compliance: all 31 scenarios COMPLIANT.

## Spec Compliance Matrix — graph-storage delta

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Per-object manifest (ADDED) | putSnapshot writes one row per object | sqlite-graph-store.test.ts (one row per visible node) | COMPLIANT |
| Per-object manifest (ADDED) | Two manifests support per-object diff | diff/engine.test.ts + diff.test.ts (changed to MODIFIED) | COMPLIANT |
| Per-object manifest (ADDED) | Manifest is local-index only | INSERT...SELECT FROM nodes (local DB only); target read-only enforced by engines write-verb scanner (green) | COMPLIANT |
| Schema versioning (MODIFIED) | Current schema opens no-op | schema.test.ts (v2 opens no-op) | COMPLIANT |
| Schema versioning (MODIFIED) | Existing v1 index, NO data loss | schema.test.ts (real v1 file DB + sentinel node to auto-migrate v2, node survives) | COMPLIANT |
| Snapshot persistence (MODIFIED) | Sync writes retrievable snapshot + manifest | sqlite-graph-store.test.ts | COMPLIANT |
| Snapshot persistence (MODIFIED) | Per-object diff supported (deferral lifted) | diff.test.ts + engine.test.ts | COMPLIANT |

graph-storage compliance: 7/7 scenarios COMPLIANT. Overall: 38/38 scenarios COMPLIANT.

---

## Checkpoint Verification (launch-prompt list)

1. Every requirement has implementation AND a test — YES (matrix above, no UNTESTED).
2. Commands (init/sync/status/query/explore/diff) — all wired in dispatch.ts, all behaviors tested. init writes root config + appends .dbgraph/ to .gitignore; init -i capability-driven; byte-identical config proven. query exit 1 on zero results proven. diff exit 0/1 proven. explore via shared core/present formatter.
3. Exit-code contract (0/1/2/3/4) — mapper covers all typed errors + outcomes; unit-tested for every code.
4. graph-storage delta — snapshot_objects(snapshot_id,node_id,kind,qname,body_hash) + idx; CURRENT_SCHEMA_VERSION 1 to 2 auto-migrate; v1 no-data-loss test PRESENT and passing; putSnapshot writes manifest INSIDE the same db.transaction(); getSnapshotObjects additive (no signature break).
5. Determinism (ADR-008) — formatters pure (no Date.now/process/Math.random); explore/query/diff/status determinism asserted (run1===run2). E2E asserts query --json + status byte-identical on re-run.
6. L-009 discipline — diff/sync/manifest tests assert ACTUAL endpoints (qname, nodeId, body_hash old to new), not counts/existence. See Assertion Quality Audit.
7. Hexagonal boundaries (ADR-004) — test/cli/boundaries.test.ts bites on planted /adapters/, better-sqlite3, mssql imports; test/core/boundaries.test.ts enforces core (incl. src/core/present/) imports nothing outward. Both green. src/core/present/explore.ts imports ONLY ../model/node.js + ../ports/graph-store.js.
8. Security — secrets + ALL identity fields are env:VAR only (build-config requireEnvRef; resolve-secrets); plaintext to ConfigError; resolved config never logged (no logging path exists; resolveSecrets is pure); target DB read-only (engines write-verb scanner security-scan.test.ts green); repo leak-scanner test/security/no-secret-leak.test.ts green.
9. Zero new runtime deps — git diff initial..HEAD on package.json: ONLY bin added + build script to tsup. dependencies (better-sqlite3) + optionalDependencies (mssql) UNCHANGED. CONFIRMED.
10. --help behavior — dbgraph --help / -h prints USAGE to stdout, exit 0 (correct). BARE dbgraph (no subcommand, no flag) to "Unknown command" + usage on stderr, exit 2. ASSESSED: NOT a spec violation — no cli-config scenario mandates bare-invocation exit 0; Decision 9 explicitly maps unknown-command to exit 2 + usage. Classified SUGGESTION. NOT CRITICAL or WARNING.

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 auto-migrate v1 to v2 | Yes | appended forward migration; pre-v2 diff degrades gracefully |
| D2 explore formatter location | Deviated (SANCTIONED) | Moved to src/core/present/explore.ts by orchestrator override; design.md still says src/cli/format/explore.ts (STALE — launch note: reconciled before archive). NOT a finding. |
| D3 manifest written by store at putSnapshot | Yes | INSERT...SELECT FROM nodes WHERE missing=0 AND excluded=0 |
| D4 hand-rolled parser, one config builder | Yes | byte-identity proven |
| D5 env:VAR identity, plaintext rejected | Yes | requireEnvRef + resolveSecrets |
| D6 capabilitiesFor via barrel | Yes | wizard reads matrix without adapter import |
| D7 boundary test | Yes | biting negative-control |
| D8 tsup two entries + bin | Yes | library cleans, cli does not (L-018) |
| D9 exit-code contract | Yes | centralized in cli.ts; handlers throw/return |

---

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix): None.

SUGGESTION (non-blocking):
1. Stale design.md path: Decision 2 still names src/cli/format/explore.ts; implementation correctly uses src/core/present/explore.ts. Reconcile design.md at archive (already flagged in launch note as pre-archive reconciliation; not a deviation).
2. Golden style: explore/diff/query golden tests assert structural fragments via regex + determinism (run1===run2) rather than a byte-exact stored snapshot. Pins meaningful content and determinism; a stored golden file would be marginally stricter. Acceptable under ADR-008 as implemented.
3. E2E cross-sync diff assertion toMatch(/ADDED|e2e_mutated_view/i) uses an OR. Endpoint identity is fully pinned at unit level (formatter asserts exact qname; engine asserts exact nodeId arrays) and the E2E also asserts type===negative, so NOT an L-009 gap — but tightening the E2E to require the qname would be marginally stronger.
4. Bare dbgraph (no args) exits 2 (unknown command). --help correctly exits 0. Optional nicety: route bare invocation to help/exit 0. Not a spec violation.
5. UnsupportedDialectError message hardcodes "Available dialects: sqlite, mssql." rather than deriving from a registry — fine for two dialects; revisit when a third is added.

---

## Verdict

PASS — archivable with ZERO carry-over.

All three gates green on independent execution (tsc clean, 882/882 tests, 0 lint errors/warnings). All 38 spec scenarios (cli-config 31 + graph-storage 7) are COMPLIANT with passing tests proving runtime behavior. Hexagonal boundaries, ADR-008 determinism, security (env-only + read-only target + leak-scanner), v1 to v2 no-data-loss, and zero-new-runtime-deps are all verified. The Strict-TDD assertion-quality audit found no trivial/meaningless assertions and confirmed L-009 endpoint discipline. No CRITICAL and no WARNING findings exist; the five SUGGESTIONS are informational and do not block archive.

Recommended next phase: sdd-archive.
