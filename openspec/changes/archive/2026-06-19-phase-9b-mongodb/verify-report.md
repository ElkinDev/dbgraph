# Verification Report — phase-9b-mongodb

**Change**: phase-9b-mongodb (MongoDB schema-extraction adapter — 5th, final Nucleo-5 engine)
**Mode**: Strict TDD (active)
**Branch**: phases-9-and-9-5 @ 5785258
**Date**: 2026-06-22
**Verdict**: PASS — clean. Ready for sdd-archive.

## Executive Summary

All seven batches landed correctly and the full gate is GREEN: tsc --noEmit clean, lint 0/0,
npm test 2593/2593 passing (162 files), SQL normalize goldens byte-identical, and the
Docker-gated mongo:7 integration 258/258 passing (12 files) against a REAL container. Every
priority scrutiny point is confirmed with execution evidence. 0 CRITICAL, 0 WARNING, 3 SUGGESTION
(all stale comments/spec text — cosmetic, non-blocking).

## Gate Output (exact)

| Gate | Command | Result |
|------|---------|--------|
| Type check | npx tsc --noEmit | PASS exit 0 (clean) |
| Lint | npm run lint (eslint) | PASS exit 0 — 0 errors / 0 warnings |
| Unit tests | npm test | PASS 2593 passed (2593) · 162 files · exit 0 |
| SQL goldens | git diff --exit-code test/golden/normalize/ | PASS exit 0 — EMPTY (no drift) |
| Integration | DBGRAPH_INTEGRATION=1 npm run test:integration | PASS 258 passed (258) · 12 files · exit 0 |

Unit count matches tasks 7.8 (2593/162); integration count matches tasks 7.8 (258/12).
Golden diff re-checked AFTER the integration run — still empty; mongodb goldens are committed
(not re-seeded), so the byte-identical assertions compared against committed files and passed.

## Priority Scrutiny Verdicts

### #1 Values-never-persisted (HIGHEST — security) — CONFIRMED CLEAN
- sample-walk.ts recordLeaf (L108-122) stores ONLY bsonToDataType(value) (a type STRING) and
  increments a count. The document VALUE is never stored. The returned RawField[] carries only
  name, dataType, frequency, nullable (L165-170).
- mongodb-schema-adapter.ts extract (L104-128) calls sampleCollections(docs) per collection and
  never retains docs — they fall out of scope after the type-merge. By construction no value survives.
- Behavioral proof (extract.integration.test.ts L285-321): sentinel sentinel@leak-check.invalid
  (planted as customer[0].email in torture.ts L154) is asserted ABSENT from the serialized RawCatalog;
  distinctive literals bob@example.com, ord-001 etc. also asserted absent.
- Persisted .db proof (inference.integration.test.ts L262-270): sentinel absent from the normalized
  graph after SqliteGraphStore.upsertGraph.
- Write-verb scanner: security-scan.test.ts recurses src/adapters/engines/** (enginesDir L149/153),
  automatically covering all 9 mongodb files (driver/map/sample-walk included). Green within the 2593.

### #2 Byte-identical SQL goldens (no-CI safety net) — CONFIRMED
- git diff --exit-code test/golden/normalize/ empty BEFORE and AFTER the integration run.
- Why it holds: the fields branch in normalize.ts buildChildNodes (L320-325) is gated on
  obj.fields !== undefined AND scope.levels.fields !== off; SQL engines never set RawObject.fields
  (catalog.ts L33 documents this), so the branch is provably inert for sqlite/mssql/pg/mysql.
- RawField.dataType is a STRING union (catalog.ts L18), NOT a types[] array, so inferReferences
  consumes a field node identically to a column node — no SQL path perturbed.

### #3 fingerprint DDL-stable — CONFIRMED (the known-risk fix LANDED)
- mongodb-schema-adapter.ts fingerprint (L176-178) computes sha256 over the string collections|indexes
  — the objects count is EXCLUDED. The exclusion is documented in the method JSDoc (L145-154) and inline (L170-173).
- Behavioral proof (extract.integration.test.ts): 64-char hex (L331-337); STABLE on DML-only
  insert+delete — expect(fpMid).toBe(fpBefore) (L382); MOVES on CREATE index — expect(fpAfter).not.toBe(fpBefore)
  (L426); does not enumerate documents — returns under 5 s (L432-445). All green.
- NOTE: spec.md (L232-238), proposal.md (L28) and design.md (L78) still state the formula with the
  objects count AND require data-stability — an internal contradiction in the planning docs. tasks.md 7.4
  (L109) documents the resolution (remove objects). The IMPLEMENTATION is correct; the planning text is
  stale. Flagged SUGGESTION-1 for archive reconciliation.

### #4 Inferred edge correctness (L-009) — CONFIRMED (exactly ONE, exact endpoints)
- inference.integration.test.ts pins the edge orders.customer_id to customers._id by both endpoint
  node IDs (L107-129), asserts confidence inferred + numeric score > 0 (L131-148), toBe(1) total
  inferred-edge count (L173-181), no self-edge (L166-171), no declared/parsed edge (L150-160),
  stubs.length === 0 (L162-164).
- The ObjectId-based torture design yields exactly 1 (not string fan-out): customer_id is ObjectId
  (torture.ts L198-205) producing dataType objectId in the oid family, matching ONLY customers._id
  (also ObjectId); string fields (email/name) are str family and incompatible. The events collection
  deliberately uses NO ObjectId reference field (torture.ts L236-237) to avoid spurious edges.
- Committed golden-e2e.json PINS it: inferredEdgeCount:1, the single inferred edge has
  src dbgraph_test.orders.customer_id, dst dbgraph_test.customers._id, confidence inferred,
  kind inferred_reference; stubCount:0, nodeCount:36, edgeCount:33, fieldCount:25,
  edgeKinds [has_column, has_index, inferred_reference].

### #5 Determinism — CONFIRMED
- RawCatalog byte-stable across a second extraction (extract.integration.test.ts L257-263); E2E graph
  byte-stable across a second run (inference.integration.test.ts L274-281). Both compare via stableStringify.
- Sampling uses sampleSize 100 >= 8 docs (container.ts L207) so $sample returns the FULL fixed dataset.
  Fields sorted by path (sample-walk.ts L156, map.ts L226). Objects sorted by (kindRank, schema, name).

### #6 No strategies tree; thin adapter; single seam; lazy import — CONFIRMED
- No src/adapters/engines/mongodb/strategies/ directory (verified absent). 9 focused files only.
- driver.ts has NO top-level mongodb import — all duck-typed (MongoClientLike/DbLike/CollectionLike/CursorLike).
- Lazy import of mongodb (as string) confined to factory.ts (L87) and probe.ts (L91).
  createMongodbSchemaAdapter is the sole join point. The adapter class talks only to MongodbReadonlyDriver.

### #7 MONGODB_CAPABILITIES truthful + 7 touch points + exit-code guard — CONFIRMED
- capabilities.ts: supported {collection, field, index}; supportsBodies false; supportsDependencyHints
  false; engine mongodb; defaultLevels DEFAULT_LEVELS. SQL kinds excluded.
- Touch points: (1) schema.ts SUPPORTED_DIALECTS 5 dialects + MongodbSource + DbgraphConfig member;
  (2) parse-config.ts parseMongodbSource + case + literal-URI rejection via isEnvRef;
  (3) resolve-secrets.ts resolveMongodbSource + case (the easy-to-forget one — landed);
  (4) open-connections.ts mongodb branch + adapter union widened;
  (5) index.ts capabilitiesFor case mongodb + barrel exports (factory, probe, capabilities);
  (6) errors.ts UnsupportedDialectError message lists sqlite, mssql, pg, mysql, mongodb (5 dialects);
  (7) exit-code.ts UNCHANGED — UnsupportedDialectError maps to 4 via instanceof (L55).

### #8 mongodb optionalDependency + gated CI job — CONFIRMED
- package.json: mongodb ^7.3.0 in optionalDependencies (with mssql/mysql2/pg); dependencies block is
  {@modelcontextprotocol/sdk, better-sqlite3} ONLY — mongodb is NOT in dependencies (verified via node).
- .github/workflows/ci.yml: mongodb-integration job (L97-110) mirrors pg/mysql-integration; runs-on
  ubuntu-latest, ephemeral mongo:7, gate DBGRAPH_INTEGRATION 1, runs npm run test:integration.
  The test matrix job (L15-22) has NO needs: — cannot depend on the gated job. YAML well-formed (no tabs, 186 lines).

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 38 (across 7 batches) |
| Tasks complete [x] | 38 |
| Tasks incomplete [ ] | 0 |

All batch GATEs (tsc/lint/test/golden + batch-specific proofs) satisfied; Batch 7 final gate matches
the observed counts exactly.

## Spec Compliance Matrix

### mongodb-extraction

| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|------------------|--------|
| Extract collections as kind collection | user collections; system excluded | map.test.ts + integration L88-107 | COMPLIANT |
| | collections off -> absent | adapter L81-89 + map.test.ts | COMPLIANT |
| Infer fields (union + frequency) | email string 1.0, age 0.875 | extract.integration L111-133 | COMPLIANT |
| | mixed BSON -> union | type-map.test.ts + golden code numeric-string L164-175 | COMPLIANT |
| Dotted paths + array element encoding | address.city dotted | sample-walk.test.ts + integration L135-148 | COMPLIANT |
| | items[].sku element path | integration L150-162 | COMPLIANT |
| Sampled values NEVER persisted | sentinel absent from RawCatalog | extract.integration L288-320 | COMPLIANT |
| | no value in persisted .db | inference.integration L262-270 | COMPLIANT |
| Extract indexes via listIndexes | unique + compound ordered keys | integration L188-213 | COMPLIANT |
| | _id index not double-counted | map.ts dedup L138-158 + integration L215-220 | COMPLIANT |
| Top-level jsonSchema in extra | required + properties carried | integration L224-241 | COMPLIANT |
| | no validator -> no metadata | integration L243-253 | COMPLIANT |
| Inferred refs (inferred + score) | orders.customer_id -> customers._id | inference.integration L107-148 + unit infer-on-fields.test.ts | COMPLIANT |
| | fires automatically from collection/field | normalize.ts hasCollectionOrFieldNode L94-127 | COMPLIANT |
| Truthful CapabilityMatrix | collection/field/index supported, SQL not | capabilities.test.ts | COMPLIANT |
| | supportsBodies/DependencyHints false | capabilities.test.ts | COMPLIANT |
| Connectivity via URI ref + sampleSize/tls | default sample size | parse-config.test.ts + factory | COMPLIANT |
| | literal URI rejected | parse-config.ts L240-244 + test | COMPLIANT |
| | auth failure -> ConnectionError | error-mapper.test.ts (code 18) | COMPLIANT |
| fingerprint via dbStats DDL-stable | changes on DDL | extract.integration L388-430 | COMPLIANT |
| | stable on data-only | extract.integration L339-386 | COMPLIANT |
| Read-only by construction | only read ops; scanner green | security-scan.test.ts over engines/** | COMPLIANT |
| Minimal role + actionable PermissionError | doc ships read-only role | docs/permissions/mongodb.md (Batch 6) | COMPLIANT |
| | missing privilege -> typed error + doc link | error-mapper.ts L119-126 (code 13) + test | COMPLIANT |
| Missing driver names install command | npm i mongodb | factory.test.ts + error-mapper.ts L100-104 | COMPLIANT |
| Committed torture dataset via gated TC | reviewable seed, 100% matrix | torture.ts + container.ts | COMPLIANT |
| | gated; skips without DBGRAPH_INTEGRATION | mongodbIntegrationEnabled + skipIf | COMPLIANT |
| Golden RawCatalog + E2E inferred edges | byte-identical golden | extract.integration L257-277 | COMPLIANT |
| | pipeline pins endpoints + count | inference.integration L107-181 + golden-e2e.json | COMPLIANT |
| | CI job gated, never blocks matrix | ci.yml L97-110, test job no needs | COMPLIANT |

### schema-extraction (delta)

| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|------------------|--------|
| Optional RawField model path | RawObject.fields -> field nodes | catalog.test.ts + node.test.ts + normalize.test.ts | COMPLIANT |
| | SQL engines stay byte-identical | golden diff empty (gate) | COMPLIANT |
| Port includes mongodb variant, no shape change | union has MongodbAdapterConfig | schema-adapter.ts + tsc | COMPLIANT |
| | dispatch keys on dialect not shape | parse-config/open-connections switch on dialect | COMPLIANT |
| Supported dialects recognize mongodb | SUPPORTED_DIALECTS + capabilitiesFor | index.ts L74-75 + tests | COMPLIANT |
| | UnsupportedDialectError lists 5, maps to 4 | errors-mongodb.test.ts + exit-code-mongodb.test.ts | COMPLIANT |
| | message + assertion change together | Batch 5.3 (errors.ts L108) | COMPLIANT |

Compliance summary: all spec scenarios COMPLIANT — proven by passing unit + integration tests.

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Typed RawField on RawObject.fields -> field nodes | Yes | catalog.ts + normalize.ts buildFieldNode |
| Single MongodbReadonlyDriver seam, duck-typed | Yes | driver.ts, no top-level mongodb import |
| Inference target entity_id -> _id only (W-1) | Yes | ObjectId design yields exactly 1 edge |
| Determinism: sort fields, sample size >= count | Yes | sorted everywhere; sampleSize 100 >= 8 |
| Values: accumulate types only | Yes | recordLeaf stores type string only |
| fingerprint formula | Deviated (CORRECTLY) | design includes objects; impl uses collections|indexes per tasks 7.4 — the deviation IS the fix |
| No strategies/ tree | Yes | absent |
| 7 touch points | Yes | all wired incl. resolve-secrets |

## Issues Found

### CRITICAL (must fix before archive)
None.

### WARNING (should fix)
None.

### SUGGESTION (cosmetic — non-blocking; ideal for archive reconciliation)
1. Stale fingerprint formula in planning docs. spec.md (fingerprint requirement L232-238), proposal.md
   (L28) and design.md (L78) state the formula WITH the objects count and simultaneously require
   data-stability — an internal contradiction. The implementation correctly excludes objects per
   tasks.md 7.4. Recommend sdd-archive reconcile the merged main spec to the shipped formula so the
   source-of-truth spec is not self-contradictory.
2. Stale class-level JSDoc in mongodb-schema-adapter.ts L10: the file header still lists the fingerprint
   formula WITH the objects count. The method-level JSDoc (L143-154) and the code (L176-178) are correct.
   One-line header comment fix.
3. Stale inline comment in extract.integration.test.ts L340-346: the STABLE-across-data-only test
   comment block still describes the formula WITH objects as the current implementation. The assertion
   at L382 correctly demands stability and passes. Comment-only drift.

(All three are documentation/comment lag behind a correct implementation — zero behavioral impact.)

## Verdict

PASS. Full gate green (tsc clean, lint 0/0, 2593/2593 unit, SQL goldens byte-identical, 258/258 Docker
integration on real mongo:7). All eight priority scrutiny points confirmed with execution evidence —
most importantly values-never-persisted (#1), byte-identical SQL goldens (#2), DDL-stable fingerprint
with the objects count correctly excluded (#3), and exactly-one inferred edge with pinned endpoints (#4).
Zero CRITICAL, zero WARNING. The 3 SUGGESTIONs are stale comments/spec text that lag a correct
implementation. Ready for sdd-archive (which should also reconcile the merged spec fingerprint formula
per SUGGESTION-1).
