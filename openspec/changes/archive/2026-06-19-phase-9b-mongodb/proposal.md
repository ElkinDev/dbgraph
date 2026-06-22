# Proposal: phase-9b-mongodb — MongoDB schema-extraction adapter (5th, final Núcleo-5 engine)

## Intent
Ship the MongoDB adapter (US-030), the consumer that turns ON the shipped `inferReferences` engine (phase-9a). MongoDB is schemaLESS: structure is INFERRED by sampling documents, not read from a catalog. This completes Núcleo-5 (5 engines) with zero data risk: sampled VALUES are NEVER persisted — only inferred KEYS, TYPES, and presence frequencies.

## Scope
### In Scope
- `src/adapters/engines/mongodb/**` mirroring the pg/mysql SHAPE (capabilities, lazy `import('mongodb')`, error-mapper, factory, map, adapter class, probe.ts) + one duck-typed `MongodbReadonlyDriver` seam. NO `strategies/` tree.
- Sampling + inference: `$sample` (default 100), recursive key walk → dotted paths (`address.city`) + `items[].sku`; type-MERGE (union) + presence frequency; DISCARD values in memory after merge.
- **Field modeling — RESOLVED: typed `RawField` + `RawObject.fields?` → `'field'` nodes** (see Approach).
- `MongodbAdapterConfig` (URI-based) + `MongodbSource`; `MONGODB_CAPABILITIES`.
- 6 dispatch touch points (mongodb as 5th dialect); `mongodb` optionalDependency (lazy).
- Gated `mongo:7` Testcontainers + fixed torture dataset, golden RawCatalog + E2E + an inference integration test + `mongodb-integration` CI job; `docs/permissions/mongodb.md`.
### Out of Scope
- Binaries/distribution → phase-9.5. Deep `$jsonSchema` walking beyond top-level (carried in `extra`). Turning inference ON for SQL engines by default.

## Capabilities
### New Capabilities
- `mongodb-extraction`: sampling-based collection/field/index extraction, type-merge, frequency, values-never-persisted, inference-on consumption.
### Modified Capabilities
- `schema-extraction`: small delta — register `mongodb` in `SUPPORTED_DIALECTS`, `capabilitiesFor`, `UnsupportedDialectError` list, parse/open dispatch.

## Approach
Mirror pg/mysql adapter template. "Extraction" = `listCollections` + `listIndexes` + `$sample`, NOT catalog SQL. Per collection: walk sampled docs, accumulate per-path type sets + counts, emit `RawField{ path, types[], frequency }`; discard documents. Feed the SHARED normalize→store pipeline.

**Field decision (PINNED):** introduce `RawField` + `RawObject.fields?` → `'field'` nodes. The `'field'` NodeKind, `levels.fields`, and `getLevelForKind('field')` ALREADY exist but are DEAD — only `buildChildNodes` lacks a `fields` branch. `RawColumn` has NO `extra`, so frequency+union have no typed home there; reusing `columns` forces a `comment`/`dataType` hack AND makes the CapabilityMatrix lie (declares `field`, emits `column`). Cost: exactly ONE core file (`catalog.ts`) + ONE normalizer delta (`buildFieldNode`). Inference treats `field`==`column` (reads `payload.dataType`); the `collection` parent node alone fires `hasCollectionOrFieldNode`. SQL engines never set `fields` → byte-identical.

`MONGODB_CAPABILITIES`: supports `collection`, `field`, `index`; `supportsBodies:false`; `supportsDependencyHints:false`. `fingerprint()`: `dbStats` → sha256(collections|indexes|objects). Mongo refs are the ONLY relationships: `<entity>_id` → `<collection>._id`.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/engines/mongodb/**` | New | Adapter, capabilities, factory, map, probe, error-mapper |
| `src/core/model/catalog.ts` | Modified | Add `RawField` + `RawObject.fields?` |
| `src/core/normalize/normalize.ts` | Modified | `buildFieldNode` + `buildChildNodes` fields branch |
| `src/core/ports/schema-adapter.ts` | Modified | Add `MongodbAdapterConfig` union member |
| `src/infra/config/schema.ts` | Modified | `MongodbSource` + `'mongodb'` in `SUPPORTED_DIALECTS`/`DbgraphConfig` |
| `src/infra/{parse-config,open-connections}.ts`, `src/index.ts`, `src/core/errors.ts` | Modified | 5th-dialect dispatch + `MONGODB_CAPABILITIES` + error list |
| `package.json` | Modified | `mongodb` optionalDependency |
| `docs/permissions/mongodb.md`, `docs/stories/05-adapters.md` | New/Modified | Read-only role; refine US-030 |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `$sample` non-determinism in tests | High | FIXED torture dataset + `$sample(size ≥ doc_count)`; EXACT-set assertions (L-009) |
| Values leak into the index | Med | Discard-after-merge; test asserts NO fixture value in the .db; write-verb scanner covers `engines/**` |
| BSON→type mapping gaps | Med | Pinned BSON type-mapping table in spec; golden RawCatalog |
| Ref fan-out (W-1: `<e>_id`→`_id`) | Low | Mongo refs less ambiguous; target `_id` only; dedup grain `(src,dst,id)` unchanged |
| No CI mid-work; cross-platform paths | Med | Local Docker mongo is primary net; explicit `path.win32`/`path.posix` for ALL path logic |
| Core-model change (`RawField`) regresses SQL | Low | SQL engines never emit `fields`; existing goldens stay byte-identical |

## Rollback Plan
Revert the change branch commits. The 6 dispatch sites are additive (5th union/switch members); the `RawField` + `buildFieldNode` additions are non-breaking (optional field, new branch). No SQL golden or shipped behavior changes, so rollback is a clean diff revert with no data migration.

## Dependencies
- phase-9a-inference-engine (archived) — `inferReferences` + the `collection`/`field` auto-trigger.
- `mongodb` npm driver (optionalDependency, lazy). Docker for gated `mongo:7` integration.

## Success Criteria
- [ ] `mongodb` extracts collections, indexes, `$jsonSchema` (top-level in `extra`); fields as paths with union types + frequency.
- [ ] Sampled VALUES never reach the index (asserted); write-verb scanner green over `engines/**`.
- [ ] `inferReferences` fires automatically; `<entity>_id` → `<collection>._id` edges with EXACT endpoint+count assertions.
- [ ] Gated `mongo:7` E2E + golden RawCatalog deterministic via fixed dataset + `$sample(size ≥ count)`.
- [ ] 6 dispatch sites updated; `UnsupportedDialectError` lists `sqlite, mssql, pg, mysql, mongodb`; exit-code-4 guard intact.
- [ ] `docs/permissions/mongodb.md` ships minimal read-only role; actionable `PermissionError`.
