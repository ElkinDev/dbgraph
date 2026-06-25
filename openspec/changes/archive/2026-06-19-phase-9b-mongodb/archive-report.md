# Archive Report — phase-9b-mongodb

**Project**: dbgraph
**Branch**: phases-9-and-9-5
**Archived**: 2026-06-22
**Verdict at archive**: PASS — 0 CRITICAL / 0 WARNING / 3 cosmetic SUGGESTION

## Executive Summary

phase-9b-mongodb is closed. The MongoDB sampling adapter ships as the fifth and final Nucleo-5 engine
(`sqlite + mssql + pg + mysql + mongodb`). All 38 tasks across 7 batches landed. Full gate green:
`tsc --noEmit` clean, lint 0/0, 2593/2593 unit tests (162 files), SQL normalize goldens byte-identical,
258/258 Docker-gated integration tests against a real `mongo:7` container. Zero CRITICAL, zero WARNING.
The 3 cosmetic SUGGESTIONs were resolved during archiving: SUGGESTION-1 (the fingerprint formula
contradiction) was reconciled in the merged canonical spec (`openspec/specs/mongodb-extraction/spec.md`)
and in `openspec/specs/schema-extraction/spec.md`; SUGGESTION-2 and SUGGESTION-3 (stale JSDoc/inline
comments in code) are tracked as deferred cosmetic items for a future cleanup pass.

## What Shipped

### New Capability: `mongodb-extraction`

Adapter location: `src/adapters/engines/mongodb/` (9 focused files; no `strategies/` tree).

**Extraction mechanics**
- `$sample`-based collection/field/index extraction; `sampleSize` default `100`.
- BSON type-map (`type-map.ts`): objectId→`'objectId'`; int/long→`'int'`; double/decimal128→`'numeric'`;
  string→`'string'`; bool→`'bool'`; date→`'date'`; null→`'null'`; array→`'<elemType>[]'` (recurse
  element); object→dotted-path recursion; unknown BSON→`'unknown'` (no throw).
- Union `dataType` (sorted, e.g. `numeric|string`) + presence `frequency = count / sampled`.
- Nested→dotted paths (`address.city`); arrays→element-type encoding (`items[].sku`).
- **Sampled VALUES are NEVER persisted**: documents are discarded in memory after the type-merge; only
  the path→{types,count} accumulator survives; asserted by a sentinel-value test.
- `$jsonSchema` top-level `required` + `properties` carried in collection `extra` (deep nesting out of scope).
- System collections (`system.*`/admin/local/config) excluded.

**Core model additions** (additive, SQL goldens byte-identical)
- `RawField { name, dataType: string, frequency, nullable? }` + `RawObject.fields?: readonly RawField[]`
  in `src/core/model/catalog.ts`.
- `FieldPayload` accessor view in `src/core/model/node.ts`.
- `buildFieldNode` + `fields` branch in `src/core/normalize/normalize.ts` (gated on
  `obj.fields !== undefined && scope.levels.fields !== 'off'`; SQL engines never set `fields` →
  branch provably inert → SQL golden diff empty before and after integration run).

**Inference**
- `inferReferences` fires AUTOMATICALLY via `hasCollectionOrFieldNode` — no `scope.inferRelationships`
  needed. Source field `customer_id` (`dataType: 'objectId'`) → entity `customer` → candidate
  `customers` → target `customers._id` (`dataType: 'objectId'`); `compatible('objectId','objectId')`
  = `oid` family → edge emitted. Produces `inferred_reference` edges with `confidence: 'inferred'`
  and numeric `score`. `_id` is target-only (bare `id` → null entity). No declared FK edges for Mongo.

**Config + connectivity**
- `MongodbAdapterConfig`: `uri: string` (`${env:VAR}` reference, env-only), `database: string`,
  `sampleSize?: number` (default `100`), `tls?: boolean`. No `schema?`, no host/port/user/password.
- `${env:VAR}` URI resolved by `resolve-secrets.ts` (the easy-to-forget step — landed).
- Literal URI rejected at parse time (`isEnvRef` check).

**Fingerprint**
- Formula: `sha256(collections|indexes)` (64-char hex).
- `objects` (document count) is intentionally EXCLUDED — it changes on every DML, which would make
  the fingerprint data-sensitive and break the stable-across-data-only-changes contract.
- This is the verified-correct shipped behavior; the formula deviation from planning docs (which
  erroneously listed `|objects`) was caught during integration testing against the live `mongo:7`
  container and corrected in task 7.4. The canonical specs now reflect the shipped formula.
- Changes on collection/index DDL; stable on data-only changes.

**Permissions**
- `docs/permissions/mongodb.md`: built-in `read` role on target database. Privileges: `dbStats`,
  `listCollections`, `listIndexes`, `find` (`$sample`). No write or admin grants.
- Missing privilege → typed actionable `PermissionError` naming the privilege and linking to the doc.

**6 dispatch touch points wired**
1. `schema.ts` — `SUPPORTED_DIALECTS` + `MongodbSource` + `DbgraphConfig` member.
2. `parse-config.ts` — `parseMongodbSource` + `case 'mongodb'`.
3. `resolve-secrets.ts` — `resolveMongodbSource` + `case 'mongodb'`.
4. `open-connections.ts` — `mongodb` branch + adapter union.
5. `index.ts` — `capabilitiesFor('mongodb')` + barrel exports (factory, probe, capabilities).
6. `errors.ts` — `UnsupportedDialectError` message updated to `sqlite, mssql, pg, mysql, mongodb`.
   `exit-code.ts` UNCHANGED; exit-code-4 mapping verified via `instanceof` regression assertion.

**CI**
- `mongodb` under `optionalDependencies` in `package.json`.
- Gated `mongodb-integration` CI job (Linux, `needs: []`, `DBGRAPH_INTEGRATION=1`, ephemeral
  `mongo:7`, never blocks the unit matrix).

### Modified Capability: `schema-extraction`

Delta applied to `openspec/specs/schema-extraction/spec.md`:
- Supported dialects list now `sqlite, mssql, pg, mysql, mongodb` (5th dialect registered).
- `SchemaAdapterConfig` union gains `MongodbAdapterConfig` (URI form, no host/port/schema).
- `capabilitiesFor('mongodb')` recognized.
- `UnsupportedDialectError` message pinned as `sqlite, mssql, pg, mysql, mongodb`; exit-code-4
  mapping unchanged.
- `Optional RawField model path` requirement added (additive; SQL engines leave `fields` unset →
  byte-identical golden guarantee).

## Validation Summary

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0, clean) |
| `npm run lint` | PASS (0 errors / 0 warnings) |
| `npm test` | PASS — 2593/2593 (162 files) |
| SQL normalize goldens (`git diff --exit-code test/golden/normalize/`) | PASS — empty (no drift) |
| `DBGRAPH_INTEGRATION=1 npm run test:integration` | PASS — 258/258 (12 files, real `mongo:7`) |

**E2E graph golden** (`golden-e2e.json`):
- `nodeCount: 36`, `edgeCount: 33`, `inferredEdgeCount: 1`, `stubCount: 0`
- Single inferred edge: `orders.customer_id` → `customers._id`, `confidence: 'inferred'`
- `edgeKinds: [has_column, has_index, inferred_reference]`

**Values-never-persisted**: sentinel `sentinel@leak-check.invalid` asserted absent from serialized
`RawCatalog` AND from the persisted `.db` after `SqliteGraphStore.upsertGraph`. Write-verb scanner
green over all 9 `engines/mongodb/**` files.

**Reality-driven discoveries during integration**
- BSON `Int32` is deserialized as a plain JS `number` by the `mongodb` driver → mapped to `'numeric'`
  (not `'int'`) in the torture dataset's mixed-type field (`numeric|string` in golden).
- `dbStats.objects` changes on DML → `objects` excluded from fingerprint formula (see above).

## Stories Closed

| Story | Status |
|-------|--------|
| US-030 (MongoDB adapter + sampling) | DONE — fully implemented, gated E2E green |
| US-008 (inferReferences) | End-to-end complete via MongoDB consumer; inference now exercised by a real engine |
| US-031 (values-never-persisted, read-only) | Advanced for mongodb — sentinel test + scanner green |
| US-033 (permissions doc + PermissionError) | Advanced for mongodb — `docs/permissions/mongodb.md` shipped |
| US-034 (CI for integration engines) | Advanced — `mongodb-integration` gated job added |

## Nucleo-5 Milestone: COMPLETE

All five planned Nucleo-5 engines have shipped:

| Engine | Phase | Status |
|--------|-------|--------|
| `sqlite` | phase-2-sqlite-extraction | Archived |
| `mssql` | phase-3-sqlserver-adapter | Archived |
| `pg` | phase-8a-pg | Archived |
| `mysql` | phase-8b-mysql | Archived |
| `mongodb` | phase-9b-mongodb | **Archived (this change)** |

## Deferred / Tracked

**Cosmetic (non-blocking, from verify SUGGESTION-2 and SUGGESTION-3)**
- Stale class-level JSDoc in `src/adapters/engines/mongodb/mongodb-schema-adapter.ts` L10: the file
  header still states the fingerprint formula with `|objects`. The method-level JSDoc and the code are
  correct. One-line comment fix; deferred to a future cleanup pass.
- Stale inline comment in `test/adapters/engines/mongodb/extract.integration.test.ts` L340-346: the
  STABLE-across-data-only test comment still describes `|objects`. The assertion is correct. Comment-only
  drift; deferred.

**Phase-9a carry-overs (pre-existing, mongo-context notes)**
- W-1 multi-candidate fan-out: Mongo sidesteps it by design — `customer_id` is ObjectId-typed,
  yielding exactly one edge to `customers._id`; the fan-out risk remains for string-typed id fields.
- W-2 dedup grain: unchanged.
- S-1 threshold: vestigial.
- `findJoinPath` needs `allowInferred: true` to traverse `inferred_reference` edges (noted by Batch 7
  apply agent; tracked for a future query-layer change).

## Canonical Specs Updated

| Canonical Spec | Action |
|----------------|--------|
| `openspec/specs/mongodb-extraction/spec.md` | CREATED (new capability; SUGGESTION-1 applied: formula is `sha256(collections|indexes)`) |
| `openspec/specs/schema-extraction/spec.md` | MODIFIED (5th dialect registered; `RawField` model path requirement added) |

## Next Recommended Change

**`phase-9.5-distribution`** — self-contained binaries + multi-engine install (the last planned core
phase before v1.0).
