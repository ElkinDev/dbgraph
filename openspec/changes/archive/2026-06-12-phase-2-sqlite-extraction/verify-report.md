# Verification Report -- phase-2-sqlite-extraction

Change: phase-2-sqlite-extraction
Mode: Strict TDD (vitest, npm test)
Verifier standard: ZERO carry-over -- findings concrete and fixable, or non-existent.
Date: 2026-06-12 . Machine: Node 22.19.0, Windows 11

## Verdict: PASS WITH WARNINGS

All gates green and deterministic; every spec requirement has passing behavioral evidence; the 4
documented deviations are genuine strengthenings (deviation 2 empirically confirmed: the DESIGN text
was wrong, not the implementation). No CRITICAL issues.

## Gates (this machine)

- npm test pass 1: PASS 379 passed / 26 files
- npm test pass 2: PASS 379 passed / 26 files (deterministic, identical)
- npm run lint: PASS clean
- npx tsc --noEmit: PASS exit 0
- git status --short: PASS clean tree

Parity test RAN (not skipped): Node 22.19 has node-sqlite; skipIf guard fired; both drivers produced
byte-identical stableStringify(RawCatalog).

## Spec Compliance Matrix -- schema-extraction (port)

- Port type is driver-free -- boundaries.test.ts schema-adapter driver-free -- COMPLIANT
- Exposes dialect + matrix -- boundaries.test.ts test-double; factory.test.ts dialect=sqlite -- COMPLIANT
- extract requires prior connect -- factory returns already-open adapter; no adapter-level reject test -- PARTIAL (W-3)
- close is idempotent -- factory.test.ts close idempotent -- COMPLIANT
- Missing source file to ConnectionError -- factory.test.ts file-not-exist + message-mentions-path -- COMPLIANT
- Corrupt source to ConnectionError -- factory.test.ts not-a-valid-db (header-validation PRAGMA, dev 4) -- COMPLIANT
- Missing driver names install command -- message exists factory.ts 67-70; NO test triggers failed import -- UNTESTED (W-1)
- off-level type absent -- extract.test.ts off-scope type absent -- COMPLIANT
- metadata omits body -- extract.test.ts metadata scope body absent -- COMPLIANT
- catalog feeds normalizer -- e2e.test.ts normalizeCatalog nodes+edges -- COMPLIANT
- write through adapter conn fails -- 6.3 asserts via PARALLEL connection; behavior empirically TRUE both drivers -- PARTIAL (W-2)
- matrix matches emitted types -- capabilities.test.ts; golden has no unsupported-type object -- COMPLIANT
- fingerprint one cheap query -- factory.test.ts sha256 of PRAGMA schema_version -- COMPLIANT
- unparseable body flagged not guessed -- extract.test.ts trigger empty deps; matrix flag false -- COMPLIANT
- full body parsing out of scope -- spec annotates deferral; deps empty always -- COMPLIANT (deferral annotated)

## Spec Compliance Matrix -- sqlite-extraction (adapter)

- Tables/columns via table_info, sqlite_* excluded -- extract.test.ts -- COMPLIANT
- FK single-column -- extract.test.ts employees single FK -- COMPLIANT
- FK composite keeps pairs -- extract.test.ts assignments ONE composite FK; golden fk_assignments_0 -- COMPLIANT
- Index unique marked unique -- extract.test.ts unique=true -- COMPLIANT
- Index partial captured -- extract.test.ts extra.where populated -- COMPLIANT
- Index expression captured -- extract.test.ts (expr) placeholder, no fake column -- COMPLIANT
- View body at full -- extract.test.ts full scope body included -- COMPLIANT
- Trigger carries firing event -- extract.test.ts BEFORE/AFTER/INSTEAD OF + events + target -- COMPLIANT
- Views/triggers metadata omits body -- extract.test.ts metadata body absent -- COMPLIANT
- Matrix declares unsupported types -- capabilities.test.ts proc/func/seq/collection unsupported -- COMPLIANT
- No unsupported objects emitted -- golden contains only table/view/trigger -- COMPLIANT
- Driver duality identical catalogs -- parity.test.ts byte-identical RAN on Node 22.19 -- COMPLIANT
- Driver duality skip-with-reason Node 20 -- parity.test.ts skipIf + documented skip block -- COMPLIANT (deferral annotated)
- Read-only on connection / write fails -- empirically SQLITE_READONLY / ERR_SQLITE_ERROR -- PARTIAL (W-2)
- Scanner injected verb fails scan -- NEGATIVE-CONTROL ATTACK PERFORMED live: real probe under engines/ failed scan naming DELETE+INSERT+location; probe removed, scan green -- COMPLIANT
- Scanner verbs in literals/comments no false-positive -- security-scan.test.ts updated_at/line/block -- COMPLIANT
- Scanner storage exempt -- security-scan.test.ts storage exempt -- COMPLIANT
- fingerprint changes on DDL -- factory.test.ts ALTER changes fingerprint -- COMPLIANT
- fingerprint stable across DML -- factory.test.ts INSERT stable -- COMPLIANT
- fingerprint one cheap query -- single PRAGMA, sha256 formula -- COMPLIANT
- Torture reviewable .sql -- torture.sql plain DDL; no .db committed -- COMPLIANT
- Torture setup materializes temp db -- materialize.ts, no container -- COMPLIANT
- Torture exercises every supported type -- golden has all types incl composite FK / partial / expr index -- COMPLIANT
- Golden E2E reaches query layer -- e2e.test.ts neighbors/impact/path/search return -- COMPLIANT
- Golden E2E pinned + deterministic -- e2e.test.ts golden match + byte-identical second run -- COMPLIANT
- Honest minimal hints unparseable flagged -- extract.test.ts empty deps; matrix false -- COMPLIANT
- Honest minimal hints full parsing deferred -- spec annotates deferral to US-027 Phase 3 -- COMPLIANT (deferral annotated)

Compliance summary: 35/35 scenarios covered; 32 COMPLIANT (3 annotated phase-deferrals), 2 PARTIAL
(test-quality, behavior correct), 1 UNTESTED (missing-driver message).

## TDD Compliance

- TDD Evidence reported: YES -- apply-progress has Batch A + B TDD Cycle Evidence tables
- All core/adapter units have tests: YES -- 9 test files map to mappers/factory/adapter/security/parity/e2e
- RED confirmed (files exist): YES -- every referenced test file exists and was read
- GREEN confirmed (tests pass): YES -- 379/379 pass twice
- Git history shows test commits: YES -- test(sqlite) golden / test(security) scanner / test(sqlite) parity / test(sqlite) e2e -- TDD discipline auditable
- Triangulation adequate: YES -- FK single/composite/none; indexes plain/unique/partial/expr/autoindex-skip; trigger BEFORE/AFTER/INSTEAD OF
- Negative controls bite: YES -- scanner negative control RE-PROVEN live this session

Note: mapper feature+test landed in b19ac97; extract.test.ts authored RED-first per the apply-progress
evidence table. Commit granularity bundles some red+green, but RED-first discipline is documented and
assertion quality corroborates real behavioral tests.

## Assertion Quality Audit

Scanned all 9 change test files. No banned patterns: no tautologies, no orphan empty-array checks
(projects-no-FK pairs with single+composite FK), no type-only-alone assertions, no ghost loops (loops
iterate non-empty collections asserted elsewhere), no smoke-only tests. ConnectionError asserts both
instanceof AND code equals E_CONNECTION. Assertion quality: ALL assertions verify real behavior.

## Coherence -- 9 Locked Design Decisions

- D1 Port async, factory owns open: YES -- schema-adapter.ts has no open(); factory returns open adapter
- D2 Driver selection explicit, no silent fallback: YES -- factory.ts 46 default; version-gate throws ConnectionError
- D3 Minimal ReadonlyDriver engine-local seam: YES -- driver.ts two adapters; single extraction path; not shared with storage
- D4 Read-only + error mapping E_CONNECTION/E_PERMISSION: YES -- factory.ts mapOpenError; errors extend DbgraphError with cause
- D5 Trigger hints Phase-2-honest, supportsDependencyHints false: YES -- deps empty; matrix flag false; deferral annotated
- D6 Deterministic RawCatalog ordering: YES -- map.ts compareObjects; parity + stableStringify prove byte-identity
- data-flow / file-changes / fingerprint formula / fixture form: YES -- sha256(schema_version); committed .sql materialized; file table matches

### Audit of the 4 Documented Deviations

1. KIND_RANK adds database (rank 0) -- SPEC-COMPATIBLE. Required for exhaustive NodeKind record;
   database never appears in SQLite catalogs. Cosmetic.

2. UNIQUE origin semantics correction -- EMPIRICALLY CONFIRMED THE DESIGN WAS WRONG. Materialized the
   torture db and ran PRAGMA index_list(employees): CREATE UNIQUE INDEX idx_emp_email reports origin=c
   (NOT u). A separate demo (b TEXT UNIQUE inline) produced origin=u as sqlite_autoindex_t_1 (skipped
   by name). The design literal emit-when-origin=u would emit NOTHING for the user-visible unique
   index. Applied rule (unique=1 AND NOT autoindex to UNIQUE constraint) is correct; golden shows
   idx_emp_email UNIQUE on email. Spec scenarios still satisfied. Documented in apply-progress +
   learnings.md 76-81. Genuine strengthening.

3. Scanner SQL-indicator pre-filter -- SPEC-COMPATIBLE strengthening. Prevents false positives on TS
   event-enum string literals while preserving detection of real SQL write verbs (re-proven live:
   injected DELETE/INSERT still caught).

4. Factory validation PRAGMA after open -- SPEC-COMPATIBLE strengthening. better-sqlite3 defers header
   validation until first query; the post-open PRAGMA schema_version makes corrupt-file detection eager
   (satisfies Corrupt-source-raises-ConnectionError). Documented learnings.md 90-95.

All 4 deviations are genuine strengthenings, spec-compatible, NOT scope drift.

## Hexagonal / Out-of-Scope

- src/core has ZERO driver/adapter/mcp/cli IMPORTS (boundary test green; grep hits in core are comments
  or the driver string-literal TYPE union, not imports).
- SchemaAdapter port is driver-free (boundary test bites).
- Factory joined ONLY at src/index.ts (single new public export createSqliteSchemaAdapter).
- No leakage: no other engines, no MCP, no CLI, no config plumbing, no inference, no full SQL body
  parsing (deps empty, supportsDependencyHints false per D5). Matches proposal Out-of-Scope.

## Story Integrity

- US-026 done WITH .sql supersede note (05-adapters.md 22-27). OK
- US-031 partial accurate: scanner + readonly done, README security docs pending (06-security.md 13-17). OK
- US-009 partial note accurate: SQLite fingerprint done, Phase-1 snapshots done (02-graph-core.md 39). OK
- README E5 counts: 4 pending / 1 done (stories/README.md 39). OK

## Post-Apply Repo Facts (verified)

- CI matrix Node 22.x/24.x, Node 20 dropped -- .github/workflows/ci.yml 17. OK
- ADR-001 amendment -- docs/adr/001-typescript-node-stack.md 15-16 (Node 20 EOL, node-sqlite bonus). OK
- learnings.md CI-matrix EOL entry -- docs/learnings.md 117-121. OK
- .gitattributes governs goldens -- text=auto eol=lf, *.db -text. OK
- engines.node >=22 (package.json 9). OK
- Suite green AND deterministic on this machine (379 twice). CI confirmation is orchestrator job.

## Issues Found

CRITICAL (block archive): None.

WARNING (should fix; do NOT block archive):

W-1 UNTESTED spec scenario: schema-extraction Missing-driver-names-install-command has NO runtime test.
The actionable message exists (factory.ts 67-70) but no test exercises a failed dynamic import. Under
ZERO carry-over this should be (a) a test forcing the import failure, or (b) annotated as a
phase-deferral in the spec. Neither exists. Fix: add a test stubbing the dynamic import to throw,
asserting ConnectionError whose message contains the install command.

W-2 test-quality on a correct behavior: Read-only write-through (6.3) is BEHAVIORALLY CORRECT --
empirically proved INSERT through the factory open style throws SQLITE_READONLY (better-sqlite3) and
ERR_SQLITE_ERROR (node-sqlite), the exact connection the factory opens. BUT the test
(factory.test.ts 234-251) asserts via a SEPARATELY opened parallel connection, and the companion test
only checks the adapter exposes no exec. The spec scenario says through THAT adapter connection. Fix:
expose a test-only hook to the adapter ReadonlyDriver (or have the factory accept a pre-built driver)
so the write attempt goes through the actual adapter connection. Not blocking.

W-3 test-quality / lifecycle scenario: schema-extraction extract-requires-prior-connect is satisfied
BY CONSTRUCTION (the factory never returns an unconnected adapter; no public way to build a
SqliteSchemaAdapter without a live driver). No negative test exists because the scenario is
structurally unreachable via the public API. Defensible, but the spec phrases it as a runtime reject.
Fix: add a one-line spec note that this is a by-construction guarantee (factory-owned lifecycle), OR
construct SqliteSchemaAdapter with a closed driver and assert the failure mode.

SUGGESTION (nice to have):

S-1: The UPDATE-OF-column to UPDATE normalization branch in parseTriggerInfo (map.ts 374-375) is not
exercised -- the torture fixture has no UPDATE OF trigger. Plain UPDATE trigger covers the spec
scenario; adding an UPDATE OF trigger to torture.sql would close the branch (re-freeze golden).

S-2: factory.test.ts 69-85 (node-sqlite on unsupported Node) is a self-described no-op on Node >=22.5
and gives false coverage for the version-gate ConnectionError path. Consider injecting a fake Node
version so the gate error message is asserted on a simulated old Node, as design D2 intends.

## Next Recommended

sdd-archive -- no CRITICAL issues block archive. The 3 warnings are test-quality hardening on
already-correct behaviors plus one untested actionable-message path; the orchestrator may fix
W-1/W-2/W-3 in a small follow-up or accept them as documented residual test debt before archiving.

---

## Orchestrator re-check (Batch C remediation) — 2026-06-12

All 5 findings resolved and verified directly by the orchestrator (gates + code inspection):
- W-1: `factory-missing-driver.test.ts` proves the actionable install-command message via mocked MODULE_NOT_FOUND (3 tests).
- W-2: readonly write-through now exercised through the adapter's OWN `ReadonlyDriver` instance via a typed `@internal` test accessor (3 tests).
- W-3: lifecycle guard implemented — `extract()` after `close()` throws `ConnectionError` with actionable message; `close()` idempotent (verified at sqlite-schema-adapter.ts:66-69, 93-94; 3 tests).
- S-1: `UPDATE OF` trigger added to torture.sql; goldens regenerated atomically (13→14 objects / 53→54 nodes), byte-identical on re-runs (4 assertions).
- S-2: version gate genuinely testable on any runtime via mocked availability helper (4 tests).

Gates re-run by the orchestrator: 394/394 tests, lint clean, tsc clean, tree clean.

**Final verdict: PASS — zero carry-over.** Ready for archive.
