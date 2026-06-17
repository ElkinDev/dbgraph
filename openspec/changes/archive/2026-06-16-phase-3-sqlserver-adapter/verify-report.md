# Verify Report — phase-3-sqlserver-adapter

**Verdict: FAIL** (2 CRITICAL, 2 WARNING, 2 SUGGESTION)
Date: 2026-06-16 · Mode: Strict TDD (vitest) · Artifact store: openspec

## Gate results

| Gate | Result | Evidence |
|------|--------|----------|
| npm test (unit, run 1) | PASS — 538/538, 37 files | deterministic |
| npm test (unit, run 2) | PASS — 538/538, 37 files | byte-stable across runs |
| npm run lint | PASS — clean | eslint, no output |
| npx tsc --noEmit | PASS — exit 0 | no type errors |
| DBGRAPH_INTEGRATION=1 npm run test:integration | PASS — 39/39, 3 files | container RAN (real SQL Server 2022) |
| US-031 security scanner | PASS — 8/8 | scans engines/**, mssql SELECTs clean |

Integration container CONFIRMATION: Docker 29.5.3 present. The mcr.microsoft.com/mssql/server:2022-latest
container actually STARTED and served TDS (image cached; no multi-minute pull). All three integration files
executed — none skipped. Verified by direct ad-hoc probes that connected to the live container and queried
sys.sql_expression_dependencies and sys.sql_modules. Integration test count: 39.

---

## CRITICAL

### C-1 — Trigger fires_on edge points to a phantom stub, NOT to the parent table (US-007)

This is the lead finding and the reason US-007 "done" is NOT fully real.

Spec lines 222-236 REQUIRE: an AFTER UPDATE trigger on table T (=orders) yields a fires_on relationship
FROM the trigger TO T with event=UPDATE, timing AFTER. The implementation produces a fires_on edge whose
destination is a phantom table node named after the trigger ITSELF, not orders.

Root cause — src/adapters/engines/mssql/map.ts:541:
    table: { schema: mod.schema_name, name: mod.object_name }
mod.object_name is the TRIGGER name (trg_audit_order_update), used as the parent-table name.
SQL_MSSQL_TRIGGER_EVENTS (queries.ts:220) already selects tr.parent_id AS parent_object_id, and
TriggerEventRow.parent_object_id exists (map.ts:142) — but the parent id is never resolved to the table
name. The normalizer (reference-resolver.ts:192-203) then calls resolveOrStub('table', schema,
trg_audit_order_update), finds no such table, and creates a STUB.

Empirical evidence (live container, normalized graph):
- The graph holds TWO nodes with qname dbo.trg_audit_order_update: one real trigger and one phantom table (stub).
- The single fires_on edge is: trigger trg_audit_order_update --UPDATE--> table trg_audit_order_update (the stub). It does NOT reach orders.
- normResult.stubs contains exactly { qname: dbo.trg_audit_order_update, kind: table }.

Impact: dbgraph core value proposition — surfacing what fires on a table — is broken for triggers. An
UPDATE-impact query on orders would NEVER surface this trigger.

Why the suite missed it: e2e.integration.test.ts:139-148 asserts only firesOnEdges.length >= 1 (an edge
EXISTS), never its DESTINATION. The wrong-target edge passes.

Fix: In buildModules (map.ts), build an object_id -> {schema,name} table map from input.tables and resolve
triggerEventMap parent via TriggerEventRow.parent_object_id into trigger.table. Add an integration assertion
that the fires_on dst is the orders table node (kind table, qname dbo.orders) and that normResult.stubs
contains NO node named after a trigger. Regenerate goldens atomically.

### C-2 — Apply learning L-008 is a FALSE NEGATIVE; its deferral premise is factually wrong (US-007)

The apply agent recorded L-008 (docs/learnings.md:176-182; apply-progress L-008; e2e.integration.test.ts:151-159):
"sys.sql_expression_dependencies does not track DML targets inside trigger bodies on SQL Server 2022 …
writes_to from trigger bodies is best-effort."

This is FACTUALLY INCORRECT, proven against the live SQL Server 2022 container:
- sys.sql_expression_dependencies DOES return trg_audit_order_update -> audit_log with a RESOLVED referenced_id = 791673868 (non-null).
- The adapter extracted catalog DOES contain writes_to(trg_audit_order_update -> audit_log) with access=write, confidence=parsed — the spec required edge (spec line 236) IS produced.

Good news: the feared silent trigger write drop does NOT occur — the writes_to half of the spec scenario
is satisfied. The PROBLEM: a real, satisfiable spec scenario was wrongly documented as a SQL-Server
limitation and its test assertion REMOVED (e2e test stops at "trigger node present"). Per the ZERO-carry-over
standard, an unverifiable claim presented as a platform limitation without a spec deferral is itself
CRITICAL — and here it is not even a real limitation. The spec carries NO deferral for trigger writes_to.

Fix: (a) Correct/retract L-008 (the dep view DOES track this DML target on 2022). (b) Restore the
spec-mandated assertion: a writes_to edge from trg_audit_order_update to the audit_log table node with
parsed confidence. (c) Record the residual HONEST boundary accurately: the tokenizer only RECLASSIFIES
edges already returned by sys.sql_expression_dependencies (map.ts:547 depMap.get(mod.object_name)); it never
tokenizes a body to DISCOVER a write target the dep view omits. For the torture schema the dep view is
complete, so this is not a defect today — but it is the real (narrower) limitation, replacing L-008.

---

## WARNING

### W-1 — Trigger fires_on edge target is unasserted in tests (US-027, ADR-008)

e2e.integration.test.ts asserts edge existence only, never endpoints. This is what allowed C-1 to ship
green. Even after C-1 is fixed, the test must pin the dst (and the absence of trigger-named stubs) or the
regression recurs silently. The RawCatalog golden does not guard this either: golden-raw-catalog.json pins
the RawCatalog where trigger.table.name is the bug source — the golden currently ENSHRINES the wrong value.

### W-2 — RawTriggerInfo.table semantics violated at the adapter boundary (US-027)

core/model/catalog.ts:63-67 documents RawTriggerInfo.table as the target table (the table the trigger fires
on). The mssql adapter populates it with the trigger own identity. This is a contract violation at the
adapter->core seam even before normalization. Any future consumer of RawObject.trigger.table inherits the
wrong value. Fix belongs with C-1.

---

## SUGGESTION

### S-1 — L-007 (CREATE TABLE for the DDL fingerprint test) is acceptable; keep, document boundary

fingerprint.integration.test.ts:92-116 uses CREATE TABLE (not ALTER TABLE) to prove US-009 fingerprint
changes on DDL (spec 268-272). VALID: CREATE TABLE is a DDL operation and the spec scenario says "e.g.
adding a column or OBJECT". Passed against the live container (COUNT(*) over sys.objects increments
deterministically; sub-second reliable). No change required. Optionally add a DROP case to broaden coverage.

### S-2 — Trigger body could feed write-target discovery independent of the dep view (future, NOT this phase)

Recorded so it is not lost: design (ADR-007) deliberately scopes a full T-SQL parser OUT. The current
reclassify-dep-view-edges approach is correct for the committed scope. IF a future schema has a trigger
whose DML target is genuinely absent from sys.sql_expression_dependencies, the body text is available and
extractWriteTargets already exists — a bounded enhancement, not a Phase-3 obligation. Do NOT implement now.

---

## Spec requirement walk (requirement -> evidence)

| Requirement (spec) | Status | Evidence |
|---|---|---|
| Tables/columns: type/nullability/default/computed | PASS | extract.integration computed col; COLUMNS join computed_columns/default_constraints |
| PK/FK (composite)/unique/check | PASS | composite FK FK_order_items_product (2 cols); map.ts groups by fk_id |
| Indexes: clustered/nonclustered/filtered/included | PASS | idx_orders_active filtered + INCLUDE; map.ts separates included, typeDesc/where in extra |
| Views/procs/functions/triggers + bodies per level | PASS | view body at full; metadata/off gating; scalar(FN) vs TVF(IF) distinguished |
| Sequences | PASS | order_seq; buildSequences |
| MS_Description -> comment | PASS | products table + product_name column; buildCommentMap |
| Truthful CapabilityMatrix (procs/funcs/seqs=true) | PASS | capabilities.ts; 21 tests; differs from SQLite |
| Parsed reads_from/writes_to from a PROC | PASS | live: sp_place_order writes_to orders+order_items, reads_from products — all parsed, REAL targets |
| hasDynamicSql on EXEC/sp_executesql proc | PASS | sp_dynamic_search hasDynamicSql=true, NO speculative deps |
| Trigger fires_on (event+timing) to its table | FAIL (C-1) | event/timing captured; fires_on dst = phantom stub, not orders |
| Trigger writes_to audit (parsed) | PASS | live: writes_to(trigger->audit_log) parsed IS produced (refutes L-008); unasserted (W-1) |
| Dynamic SQL flagged, never guessed | PASS | scenarios met; design boundary honest |
| fingerprint one query, DDL-moves/DML-stable | PASS | single aggregate; INSERT stable, CREATE TABLE changes (live) |
| Read-only by construction (scanner) | PASS | security-scan 8/8 |
| Minimal VIEW DEFINITION login doc | PASS | docs/permissions/mssql.md: VIEW DEFINITION + CONNECT, no db_datareader, verify+revoke+TLS+troubleshooting |
| PermissionError actionable | PASS | error-mapper.test.ts 17 tests; 229 -> PermissionError + docs link |
| Connectivity SQL/NTLM; Kerberos unsupported | PASS | factory.test.ts SQL+NTLM + Kerberos->ConnectionError |
| Missing driver names npm i mssql | PASS | factory-missing-driver.test.ts |
| Torture fixture reviewable .sql, full matrix | PASS | torture.sql plain text; 100% matrix |
| Golden RawCatalog + E2E deterministic | PASS (caveat W-1) | byte-identical second run (live) both goldens; golden enshrines C-1 wrong trigger.table |
| CI gated, never blocks matrix, never touches the validation database | PASS | test job unchanged (22/24, ubuntu+windows, v6/v6); mssql-integration separate, ubuntu-only, no needs, ephemeral |

## Hexagonal & wiring
- src/core imports zero mssql/tedious (grep clean). PASS.
- createMssqlSchemaAdapter joined ONLY at src/index.ts:19 (ADR-004). PASS.
- US-031 scanner green over engines/mssql/**. PASS.

## Deviations sanity
- L-007 (CREATE TABLE DDL test): acceptable — see S-1.
- vitest config split VERIFIED both ways: npm test excludes **/*.integration.test.ts (538 unit);
  test:integration includes only test/**/*.integration.test.ts (39). Disjoint; both clean.
- RawColumn.extra intersection (L-004): spec-compatible — normalizer ignores unknown fields; no core change.
- L-008: WRONG — see C-2.

## Story integrity
- US-027 (adapter): DONE for catalog extraction and proc edges.
- US-007 (body parsing + trigger fires_on): NOT fully real — writes_to works, fires_on TARGET broken (C-1). Cannot be marked done.
- US-009 (fingerprint): DONE (live-proven). US-031: DONE. US-033: DONE. US-034: DONE.

## Required before archive
1. Fix C-1 (resolve trigger parent table from parent_object_id; regenerate goldens atomically).
2. Fix C-2 (retract/correct L-008; restore writes_to(trigger->audit_log) assertion).
3. Address W-1/W-2 (assert fires_on dst + no trigger-named stub; honor RawTriggerInfo.table contract).
4. Re-run all gates incl. integration; confirm goldens regenerated intentionally.

next_recommended: sdd-apply (remediation) — NOT archive.

---

# Re-verification (Batch D) — 2026-06-16

Verdict: PASS (0 CRITICAL, 0 WARNING, 2 SUGGESTION carried forward as future-scope only).
Mode: Strict TDD (vitest). Artifact store: openspec. ZERO carry-over standard applied.

Re-verify of the Batch D remediation. All 4 prior findings (C-1, C-2, W-1, W-2) were re-checked against source AND empirically against the live SQL Server 2022 container. All four are genuinely fixed. Gates are green and byte-deterministic across two runs each.

## Gate results (re-run)

| Gate | Result | Evidence |
|------|--------|----------|
| npm test (unit, run 1) | PASS 540/540, 37 files | exit 0; 538 to 540 = +2 map unit assertions (W-2) |
| npm test (unit, run 2) | PASS 540/540, 37 files | exit 0; identical to run 1 (deterministic) |
| npm run lint (eslint) | PASS clean | exit 0, no output |
| npx tsc --noEmit | PASS clean | exit 0, no type errors |
| DBGRAPH_INTEGRATION=1 test:integration (run 1) | PASS 47/47, 3 files | exit 0; container RAN (33.2s tests) |
| DBGRAPH_INTEGRATION=1 test:integration (run 2) | PASS 47/47, 3 files | exit 0; 35.5s; goldens byte-identical |

Integration count: 47 (was 39 before Batch D; +8 endpoint/restored assertions). Unit count: 540 (was 538; +2 map.ts unit assertions). Both deltas match apply-progress exactly. No out-of-scope churn.

Container CONFIRMATION: Testcontainers boots mcr.microsoft.com/mssql/server:2022-latest per run (beforeAll, hookTimeout 240s) and stops it afterAll. Both integration runs executed all 3 files (extract, fingerprint, e2e); none skipped. Multi-second test phases (33 to 35s) confirm real connections, not skips.

## Golden determinism (ADR-008)

Both goldens were hashed before and after integration run 2:
- golden-raw-catalog.json: cc149cd964fda8db...7dec91 IDENTICAL pre/post run 2
- golden-e2e.json: d2c1cb6db7a87175...406222 IDENTICAL pre/post run 2
- git status --porcelain on the golden dir remained CLEAN after both runs.

The goldens were regenerated in Batch D (commit b5e7d6c): the only diff vs the pre-Batch-D goldens is the flipped trigger target value (trigger now to orders; zero trigger-named stubs). git diff --stat shows each golden changed by exactly 1 line, the C-1 value flip, nothing else.

## Empirical live-container probe (replicates the prior verifier method)

A temporary probe test booted a FRESH torture container, ran the full pipeline (extract then normalizeCatalog), and asserted the trigger path directly. All 5 EMPIRICAL assertions PASSED, then the probe was removed (working tree clean, no pollution):

1. RawCatalog trigger.table equals schema dbo / name orders; timing AFTER; events include UPDATE; writes_to audit_log present with confidence parsed. PASS
2. Exactly ONE graph node carries qname dbo.trg_audit_order_update, and its kind is trigger (the prior bug produced TWO nodes sharing that qname, one trigger plus one phantom table). PASS
3. normResult.stubs contains NO dbo.trg_audit_order_update; NO table node is named after the trigger. (Prior verifier found exactly qname dbo.trg_audit_order_update kind table.) PASS
4. The single fires_on edge from the trigger has dst = the dbo.orders TABLE node (dst.kind table, dst.qname dbo.orders), and edge.attrs.event UPDATE. PASS
5. writes_to trigger to dbo.audit_log edge exists in the live graph. PASS

This is the exact inverse of the prior C-1/C-2 findings, proven against the live system.

## Per-finding confirmation

### C-1 Trigger fires_on now targets the PARENT TABLE: FIXED (confirmed)
- Source: map.ts buildModules now builds tableById (object_id to schema/name) from input.tables (map.ts:481-484), carries parentObjectId on each triggerEventMap entry (map.ts:491), and resolves trigger.table via tableById.get(te.parentObjectId) (map.ts:549-555). The previous table using mod.schema_name / mod.object_name (trigger own identity) is gone; it now appears ONLY as a defensive fallback that does not fire when sys.* is consistent.
- Empirical: probe assertions 2, 3, 4: one trigger node, zero stubs, fires_on dst = dbo.orders table node with attrs.event UPDATE. Confirmed against the live container.
- No two nodes share qname dbo.trg_audit_order_update; no stub node exists.

### C-2 L-008 false negative retracted; writes_to trigger to audit_log restored: FIXED (confirmed)
- Docs: docs/learnings.md:176-183 RETRACTS L-008 (sys.sql_expression_dependencies DOES track trigger DML targets on SQL Server 2022), records the real narrower boundary (tokenizer only reclassifies dep-view edges), and the corrected derived rule. No platform-limitation excuse remains.
- Tests: writes_to assertion RESTORED at both layers: extract.integration.test.ts:209-219 (RawCatalog dep, access write, target audit_log, confidence parsed) and e2e.integration.test.ts:223-241 (graph edge by trigger src id to audit_log dst id).
- Empirical: probe assertions 1 and 5: parsed write dep AND graph edge to dbo.audit_log present against the live container.

### W-1 Edge endpoints now asserted by destination qname: FIXED (confirmed)
- e2e.integration.test.ts: fires_on dst dbo.orders + kind table (188-203); no stub + no trigger-named table node (206-217); writes_to trigger to audit_log by ids (223-241); sp_place_order writes_to dst qnames dbo.orders + dbo.order_items (125-140); sp_place_order reads_from dst qname dbo.products (154-168). All by DESTINATION qname, not mere existence.
- extract.integration.test.ts: trigger.table endpoint (190-198), no phantom (201-206), writes_to dep (209-219).

### W-2 RawTriggerInfo.table contract honored; DB-free map unit test: FIXED (confirmed)
- map.test.ts:381-391 asserts (no DB) trigger.table.name orders and schema dbo; map.test.ts:395-401 asserts no phantom table named after the trigger.
- The fixtures genuinely exercise resolution: trigger-events.json has parent_object_id 1001 and tables.json maps object_id 1001 to orders, so the unit test proves parent_object_id to tableById resolution, not a hardcoded literal. Contract at core/model/catalog.ts:63-67 (table = target table) is now satisfied at the adapter to core seam.

## Additional checks (all PASS)

- US-007 (docs/stories/02-graph-core.md): now genuinely done. Line 24 asserts BOTH fires_on trigger to orders event UPDATE AND writes_to trigger to audit_log confidence parsed, both empirically verified; line 27 retracts the false L-008 note. Acceptance criteria match reality.
- Skill promotion (.claude/skills/dbgraph-testing/SKILL.md): L-009 endpoint-assertion rule present (assert src qname, dst qname, no wrong-target/stub variant) AND false-negative policy (never drop a spec assertion without explicit deferral; undocumented removal = CRITICAL).
- .atl/skill-registry.md: dbgraph-testing compact rules updated with L-009 + false-negative rule (lines 48-54), keeps the orchestrator-injected standards in sync.
- L-009 added to docs/learnings.md:185-191.
- Regression scope (item 9): git diff --stat over the Batch D range shows ONLY map.ts (+22), the 3 test files, 2 goldens (1 line each), docs (learnings/story/skill/registry), and openspec artifacts. NO out-of-scope source files touched. The 538 to 540 unit delta = exactly the 2 new map assertions; the 39 to 47 integration delta = the 8 endpoint/restored assertions.

## Spec compliance: the two previously-failing rows now PASS

| Requirement (spec 222-236) | Prior | Now | Evidence |
|---|---|---|---|
| Trigger fires_on (event+timing) to its parent table | FAIL (C-1) | PASS | live: fires_on dst = dbo.orders table node, attrs.event UPDATE, timing AFTER |
| Trigger writes_to audit (parsed) | PASS but unasserted (W-1) | PASS + asserted | live: writes_to trigger to audit_log edge + parsed dep, endpoint-asserted both layers |

All other spec rows from the original report remain PASS (unchanged code paths; re-confirmed green by the 47/47 integration run).

## SUGGESTIONS (carried forward, NOT blockers)

- S-1 (L-007 CREATE TABLE for the DDL fingerprint test): acceptable, no change required.
- S-2 (trigger-body write-target discovery independent of the dep view): explicitly future-scope (ADR-007 scopes a full T-SQL parser OUT); NOT a Phase-3 obligation. Correctly recorded as the real narrower boundary in the corrected L-008.

## Verdict

PASS. ZERO carry-over. All gates green and byte-deterministic across two runs each (540 unit, 47 integration). C-1, C-2, W-1, W-2 all genuinely fixed and empirically confirmed against the live SQL Server 2022 container. US-007 is now genuinely satisfied (both trigger fires_on to dbo.orders AND writes_to trigger to audit_log work). No residual findings. Change is ready for archive.

next_recommended: sdd-archive.
