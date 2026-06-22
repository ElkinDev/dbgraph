# Design: phase-9b-mongodb — MongoDB sampling adapter

## Technical Approach

Mirror the pg/mysql adapter SHAPE exactly: thin `MongodbSchemaAdapter` talking ONLY to one duck-typed `MongodbReadonlyDriver` seam (ADR-004); lazy `import('mongodb' as string)` confined to `factory.ts` + `probe.ts` (ADR-006); `createMongodbSchemaAdapter` the only join point. "Extraction" = `listCollections` + `collection.aggregate([{$sample}])` + `listIndexes` + `db.command({collMod/listCollections validator})`, NOT catalog SQL. Per collection: `$sample(size)` → walk each doc's keys into a `Map<path,{types:Set<string>;count:number}>` accumulator → after the pass compute `frequency=count/sampled` and `dataType=union(types)` → **DISCARD every document** (only the accumulator survives). Feed the SHARED normalize→store pipeline UNCHANGED; the `collection`/`field` node presence auto-fires `inferReferences`. The shared pipeline is one file richer in core (`catalog.ts`) + one normalizer branch — both additive and provably inert for the 4 SQL engines. NO `strategies/` tree (MSSQL-only machinery).

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|----------|--------|-----------------------|-----------|
| Field modeling | Typed `RawField` on `RawObject.fields?` → `'field'` nodes (PINNED, proposal) | (a) reuse `columns`; (b) generic `extra` blob | `'field'` kind + `levels.fields` + `getLevelForKind('field')` already exist but are DEAD; `RawColumn` has no `extra`, so frequency+union have no typed home; reusing `columns` makes the CapabilityMatrix lie. Cost: 1 core file + 1 normalizer branch. |
| Driver seam | Single `MongodbReadonlyDriver` interface, duck-typed `MongoClient` | strategy registry; direct `mongodb` import in adapter | Matches pg `PgReadonlyDriver`; keeps `mongodb` types out of core + adapter class (ADR-004/006); unit-testable with fake cursors. |
| Inference target | `<entity>_id` → target collection's `_id` field ONLY (W-1) | column-grain fan-out like SQL | `type-compat` already maps `objectid`+`_id`→`oid` family; `_id` is the sole PK-like target → far less ambiguous than SQL. No infer-engine change. |
| Determinism | Engine sorts fields by path; tests use `$sample(size ≥ count)` | random sample in tests | `$sample` is non-deterministic; size≥count returns the full fixed dataset, EXACT-set assertions (L-009) hold. |
| Values | Accumulate types only; assert no value reference escapes the walk | persist sample for debugging | dbgraph-security: sampled VALUES NEVER persisted. |

## Data Flow

    factory(lazy import mongodb) → MongoClient.connect()
        │  (auth/role failure → mapMongoError → typed)
        ▼
    MongodbReadonlyDriver  ── listCollections ─┐
        │                  ── $sample(size) ───┤→ sampleCollections (walk→Map; DISCARD docs)
        │                  ── listIndexes ──────┤
        │                  ── command(validator)┘
        ▼
    buildMongodbRawCatalog(sampled, indexes, validators) → deterministic RawCatalog
        ▼
    normalizeCatalog (buildChildNodes `fields` branch → field nodes;
                      collection/field present → inferReferences fires) → graph+edges

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/model/catalog.ts` | Modify | Add `RawField { name; dataType; frequency; nullable? }` + `RawObject.fields?: readonly RawField[]`. |
| `src/core/model/node.ts` | Modify | Add `FieldPayload` accessor view (dataType, frequency, nullable?). NodeKind/levels already present. |
| `src/core/normalize/normalize.ts` | Modify | `buildFieldNode` + `fields` branch in `buildChildNodes` (mirror columns; gate `scope.levels.fields`). |
| `src/core/ports/schema-adapter.ts` | Modify | Add `MongodbAdapterConfig` + union member. |
| `src/core/errors.ts` | Modify | `UnsupportedDialectError` message → `sqlite, mssql, pg, mysql, mongodb`. |
| `src/infra/config/schema.ts` | Modify | `MongodbSource` + `'mongodb'` in `SUPPORTED_DIALECTS` + `DbgraphConfig` member. |
| `src/infra/config/parse-config.ts` | Modify | `parseMongodbSource` + `case 'mongodb'` (URI env-only). |
| `src/infra/config/resolve-secrets.ts` | Modify | `resolveMongodbSource` + `case 'mongodb'`. |
| `src/infra/open-connections.ts` | Modify | `mongodb` branch + adapter union member. |
| `src/index.ts` | Modify | Export `createMongodbSchemaAdapter`, `MongodbCapabilityProbe`, `MONGODB_CAPABILITIES`; `capabilitiesFor` `case 'mongodb'`. |
| `src/adapters/engines/mongodb/{driver,factory,mongodb-schema-adapter,map,capabilities,error-mapper,probe,type-map}.ts` | Create | The adapter (pg/mysql shape, no `strategies/`). |
| `package.json` | Modify | `mongodb` optionalDependency. |
| `docs/permissions/mongodb.md` | Create | Minimal read-only role (`read` on target DB); `dbStats`/`listCollections`/`listIndexes`/`find`($sample) privileges. |
| `docs/stories/05-adapters.md` | Modify | Refine US-030; reconcile US-031/033. |
| `test/fixtures/mongodb/container.ts`, `torture.ts`, `test/adapters/engines/mongodb/**` | Create | Container + programmatic torture + golden + E2E + inference integration. |
| `.github/workflows/ci.yml` | Modify | `mongodb-integration` job mirroring `pg-integration`. |

## Interfaces / Contracts

```ts
// schema-adapter.ts — URI-based; password lives inside the URI as ${env:VAR}
export interface MongodbAdapterConfig {
  readonly uri: string;          // mongodb://... ; ${env:VAR} resolved by caller
  readonly database: string;     // extraction scope (also schema name)
  readonly sampleSize?: number;  // default 100
  readonly tls?: boolean;
}
// driver.ts — the ONLY surface the adapter/map talk to
export interface MongodbReadonlyDriver {
  listCollections(): Promise<readonly { name: string; options?: Record<string, unknown> }[]>;
  sample(collection: string, size: number): Promise<readonly Record<string, unknown>[]>;
  listIndexes(collection: string): Promise<readonly Record<string, unknown>[]>;
  command(cmd: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
// type-map.ts — PINNED BSON→dataType (single source of truth)
// objectId→'objectId'; int|long→'int'; double|decimal128→'numeric'; string→'string';
// bool→'bool'; date→'date'; null→'null'; array→'<elemType>[]' (recurse element);
// object→nested via dotted-path recursion (address.city); missing key→absent (not counted);
// mixed across docs→sorted union 'a|b' (e.g. 'int|string'); unknown BSON→'unknown' (NO throw).
```

`MONGODB_CAPABILITIES`: engine `'mongodb'`; supported `{collection, field, index}`; `supportsBodies:false`; `supportsDependencyHints:false`; `defaultLevels: DEFAULT_LEVELS`. `fingerprint()`: `db.command({dbStats:1})` → `sha256(`${collections}|${indexes}|${objects}`)`. `map.ts`: `buildMongodbRawCatalog(sampledCollections, indexes, validators)` → sorted `RawCatalog` (collections as `RawObject` kind `collection`; fields in `.fields` sorted by path; `RawIndex` from `listIndexes`; top-level `$jsonSchema` in `extra`); `schema = database` (never null for Mongo).

## Inference

The mongo extract path does NOT need `scope.inferRelationships` — the `collection`/`field` nodes auto-trigger `inferReferences` (`hasCollectionOrFieldNode`). Source field `customer_id` (`dataType:'objectId'`) → entity `customer` → candidate `customers` → target `customers._id` field (`dataType:'objectId'`); `compatible('objectId','objectId')='oid'` family → edge emitted. `_id` itself yields no entity (bare `id` → null), so `_id` is target-only.

## Error Mapping (`error-mapper.ts`, PURE)

| mongodb error | Typed |
|---------------|-------|
| auth failure (code 18 / `AuthenticationFailed`) | `ConnectionError` (check URI credentials) |
| unauthorized / insufficient role (code 13 / `Unauthorized`) | `PermissionError` naming the privilege + `docs/permissions/mongodb.md` |
| bad host / `ECONNREFUSED` / timeout (`MongoServerSelectionError`) | `ConnectionError` (verify URI host + reachability) |
| missing driver (`MODULE_NOT_FOUND`) | `ConnectivityUnavailableError` (`npm i mongodb`) |

Content-free summaries (no host/URI in message); raw cause attached as `error.cause` only.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | type-merge/union, dotted-path + array-element walk, DISCARD invariant (no value escapes), `map.ts` ordering | RED→GREEN, fake cursors; assert accumulator-only |
| Unit | `RawField`/`FieldPayload`, `buildFieldNode`; **SQL goldens byte-identical** (SQL never sets `fields`) | golden re-run; the no-CI guarantee |
| Unit | error-mapper, capabilities, parse/resolve mongodb branch, exit-code-4 list | pure-fn tests |
| Integration | `mongo:7` torture → golden RawCatalog; inference edge `orders.customer_id→customers._id` EXACT endpoint+count (L-009) | Testcontainers, `$sample(size ≥ count)` |
| E2E | extract → store → query layer; assert NO fixture value in `.db`; write-verb scanner green over `engines/**` | gated `DBGRAPH_INTEGRATION=1` |

Torture (programmatic insert, mirroring mysql/container.ts but Mongo): `customers`, `orders` (with `customer_id`→`customers._id`, `$jsonSchema` validator), `products`, `events` (nested docs `address.city`, arrays `items[]`, a mixed-type field `int|string`), indexes. `mongodb-integration` CI job mirrors `pg-integration` (`needs: []`, never blocks the unit matrix).

## Migration / Rollout

No data migration. All 6 dispatch sites are additive (5th union/switch members). `RawField`/`buildFieldNode` are non-breaking (optional field, new branch). Cross-platform: this adapter has no host-path logic (URI-based), but any path use in fixtures MUST use explicit `path.win32`/`path.posix` (no-CI; the doctor `basename` bug). Rollback = clean diff revert.

## Batch Ordering (TDD)

1. `RawField`/`FieldPayload` + normalizer `fields` branch + prove SQL goldens byte-identical.
2. `MONGODB_CAPABILITIES` + `MongodbAdapterConfig`/`MongodbSource` + parse-config/resolve-secrets.
3. driver seam + error-mapper + factory + probe.
4. sampling + type-merge + DISCARD + `map.ts` (unit, fake cursors).
5. dispatch wiring (`open-connections`, `index.ts`, `errors.ts` list) + barrel + inference-on.
6. `docs/permissions/mongodb.md` + US-030/031/033 reconcile.
7. `mongo:7` Testcontainers torture + golden + E2E + inference integration + `mongodb-integration` CI job + `mongodb` optionalDependency.

## Open Questions

- None blocking. `sampleSize` default 100 (proposal); raise per collection only if `count<size` (then size=count for determinism in tests — handled by fixture).
