# Design: Phase 1 — Graph Core

> Technical design (the architectural HOW) for the `phase-1-graph-core` change.
> Scope: domain model, GraphStore port, SQLite adapter, normalizer, query engine.
> All decisions are ADR-traceable. Strict TDD (config `strict_tdd: true`) governs implementation order.

## 0. Reconciliation note (naming)

The proposal (`proposal.md`) names the normalizer module `src/core/normalizer`. This design and the
tasks/apply phases use **`src/core/normalize/`** (matches the design directive and reads as a verb
package consistent with `query/`). Treat `normalize/` as canonical; the proposal's `normalizer` is the
same module. No other divergence from the proposal exists.

---

## 1. Architecture approach

**Pattern: Hexagonal (ports & adapters), ADR-004.** The core is a pure, infrastructure-free hexagon.
Two driven ports are owned by core (`GraphStore`, `Logger`); the SQLite implementation is a driven
adapter loaded by a factory. No driving adapters (MCP/CLI) exist yet — Phase 1 ships only the hexagon
plus one storage adapter and the public programmatic API.

**Layering & dependency direction (NON-NEGOTIABLE, ADR-004 + `dbgraph-conventions`):**

```
                 ┌─────────────────────────────────────────────┐
                 │            src/index.ts  (public API)         │
                 └───────────────┬───────────────────────────────┘
                                 │ re-exports
        ┌────────────────────────▼────────────────────────┐
        │                  src/core                         │   imports NOTHING below this line
        │  model/  ports/  normalize/  query/  errors.ts    │   (no adapters, no drivers, no mcp/cli)
        │  index.ts (core public surface)                   │
        └───────▲───────────────────────────────▲──────────┘
                │ type-only: ports + model       │ type-only: ports + model
        ┌───────┴──────────────┐         (future: src/mcp, src/cli — not in Phase 1)
        │ src/adapters/storage │
        │   /sqlite            │  imports better-sqlite3 via dynamic import()
        └──────────────────────┘
```

Rules enforced (and how — see §8):
- `src/core/**` imports nothing from `src/adapters`, `src/mcp`, `src/cli`, nor any DB driver.
- `src/adapters/storage/sqlite/**` imports only **types/ports from `src/core`** and `better-sqlite3`
  (via dynamic `import()` so the driver is never pulled into a core-only consumer).
- Public surface is exported ONLY through `src/core/index.ts` (core API) and `src/index.ts` (package API).

**Determinism (ADR-008) is a first-class architectural constraint, not a test detail.** Every output the
graph produces — node IDs, edge IDs, normalized arrays, query results — MUST be byte-stable for the same
input, so golden files are possible. This drives the ID strategy (§3.4) and ordering rules (§5, §6).

**Sync vs async port (DECISION — async). ADR-004/ADR-005.** `better-sqlite3` is synchronous, but the port
is the swap seam to `node:sqlite` / bun:sqlite for the self-contained binaries (ADR-005 explicitly: "the
`GraphStore` port absorbs the driver duality"). `node:sqlite` and several future drivers expose async or
async-capable surfaces. Choosing **async (`Promise`-returning) signatures** future-proofs the seam without
touching call sites later (Phase 9.5 binary swap). The SQLite adapter wraps its synchronous calls in
already-resolved promises — zero runtime cost, full type compatibility. Rejected: sync signatures (would
force a breaking port change when node:sqlite's async API lands, defeating the swap purpose).

---

## 2. Module layout & public API surface

```
src/
  index.ts                      # package public API — re-exports from core only
  core/
    index.ts                    # core public surface (barrel; the ONLY core export point)
    errors.ts                   # typed error classes (§7)
    model/
      node.ts                   # NodeKind, GraphNode, IndexLevel, ObjectTypeLevels
      edge.ts                   # EdgeKind, EdgeConfidence, GraphEdge
      catalog.ts                # RawCatalog + RawObject shapes (the durable adapter contract)
      capability.ts             # CapabilityMatrix, ExtractionScope
      graph.ts                  # NormalizedGraph, NormalizationResult, StubInfo
      index.ts                  # model barrel (re-exported by core/index.ts)
    ports/
      graph-store.ts            # GraphStore port (async) + supporting param/result types
      logger.ts                 # Logger port
      index.ts                  # ports barrel
    normalize/
      normalize.ts              # normalizeCatalog(raw, scope): NormalizationResult
      id.ts                     # deterministic node/edge ID derivation (§3.4)
      reference-resolver.ts     # FK/dependency resolution, stub creation
      levels.ts                 # off/metadata/full application to payload + FTS flag
      index.ts
    query/
      neighbors.ts              # getNeighbors (US-013 semantics)
      impact.ts                 # getImpact (US-014 semantics)
      path.ts                   # findJoinPath (US-015 semantics)
      search.ts                 # search (FTS, US-011 semantics)
      index.ts
  adapters/
    storage/
      sqlite/
        sqlite-graph-store.ts   # SqliteGraphStore implements GraphStore
        schema.ts               # DDL constant + schema_version (§3)
        migrations.ts           # forward-only migration runner (§3.3)
        factory.ts              # createSqliteGraphStore(opts): Promise<GraphStore>  (dynamic import)
        index.ts
test/
  fixtures/
    catalog-minimal.json        # 2 tables, 1 FK, 1 view, 1 trigger (US-006 AC #1)
    catalog-composite-fk.json   # composite FK (US-006 AC #2)
    catalog-dangling-ref.json   # view over dropped table → stub missing:true (US-006 AC #3)
    catalog-excluded.json       # FK to excluded object → stub excluded:true (US-004 model)
    catalog-cyclic.json         # cycle for impact depth-cap test
    catalog-rw-edges.json       # proc reads b / writes a, dynamic-sql module (US-007 model)
  golden/
    normalize/*.json            # normalized graph snapshots (deterministic)
    query/*.json                # neighbors/impact/path/search snapshots
  core/                         # unit tests mirror src/core layout
  adapters/storage/sqlite/      # adapter round-trip tests (real better-sqlite3, in-memory or tmp file)
```

### Public API surface

`src/core/index.ts` exports (the contract other layers may import):

- **Model types**: `NodeKind`, `EdgeKind`, `EdgeConfidence`, `GraphNode`, `GraphEdge`, `IndexLevel`,
  `ObjectTypeLevels`, `CapabilityMatrix`, `ExtractionScope`, `RawCatalog`, `RawObject`,
  `NormalizedGraph`, `NormalizationResult`, `StubInfo`.
- **Ports**: `GraphStore` (+ its param/result types: `NeighborQuery`, `NeighborGroups`,
  `ImpactQuery`, `ImpactResult`, `PathQuery`, `PathResult`, `SearchQuery`, `SearchHit`,
  `SnapshotRecord`, `UpsertResult`), `Logger`.
- **Functions**: `normalizeCatalog`, `getNeighbors`, `getImpact`, `findJoinPath`, `search`.
- **Errors**: `DbgraphError` (base), `NormalizationError`, `StorageError`, `SchemaVersionError`,
  `QueryError`, `NotFoundError`.

`src/index.ts` (package surface) re-exports the core barrel plus `DBGRAPH_VERSION`. The SQLite adapter
factory (`createSqliteGraphStore`) is exported from `src/index.ts` as the sanctioned way to obtain a
`GraphStore` — but it lives in `adapters/`, so **core never imports it**; only the package root wires it.

> Boundary consequence: `src/index.ts` is the ONLY place core and adapter are joined. This keeps the
> hexagon clean while giving package consumers a one-import entry point.

---

## 3. SQLite schema (DDL) — `graph-storage`

ADR-005 mandates `.dbgraph/dbgraph.db` with `nodes`, `edges`, `nodes_fts` (FTS5), `snapshots`, `meta`.
`body_hash` (ADR-005) enables Phase-4 incremental sync. All DDL lives in `schema.ts` as a single
ordered statement list, applied inside one transaction at store open.

### 3.1 Tables

```sql
-- nodes: one row per graph node (real or stub).
CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,        -- deterministic ID (§3.4)
  kind        TEXT NOT NULL,           -- NodeKind union value
  schema_name TEXT,                    -- nullable for engine-less kinds (database/collection roots)
  name        TEXT NOT NULL,           -- object/local name
  qname       TEXT NOT NULL,           -- fully-qualified canonical name (drives ID + dedupe)
  level       TEXT NOT NULL,           -- 'off' | 'metadata' | 'full' applied to THIS node
  missing     INTEGER NOT NULL DEFAULT 0,  -- 1 = stub for a referenced-but-absent object
  excluded    INTEGER NOT NULL DEFAULT 0,  -- 1 = stub for a filtered-out object (US-004)
  body_hash   TEXT,                    -- ADR-005; null unless level='full' and object has a body
  payload     TEXT NOT NULL            -- JSON: kind-specific structured fields (§2 decision)
);
CREATE INDEX IF NOT EXISTS idx_nodes_kind  ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_qname ON nodes(qname);

-- edges: directed, typed relationship between two node IDs.
CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,        -- deterministic ID (§3.4)
  kind        TEXT NOT NULL,           -- EdgeKind union value
  src_id      TEXT NOT NULL REFERENCES nodes(id),
  dst_id      TEXT NOT NULL REFERENCES nodes(id),
  confidence  TEXT NOT NULL,           -- 'declared' | 'parsed' | 'inferred'
  score       REAL,                    -- only for confidence='inferred' (US-008, Phase 9); null otherwise
  attrs       TEXT NOT NULL            -- JSON: edge attrs (join columns, event=UPDATE, aggregated flag…)
);
CREATE INDEX IF NOT EXISTS idx_edges_src  ON edges(src_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_dst  ON edges(dst_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);

-- nodes_fts: FTS5 search surface. (§3.2)
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id UNINDEXED,        -- join key back to nodes.id; not tokenized
  qname,               -- qualified name (typo-tolerant entity lookup, US-011)
  comment,             -- catalog comments/descriptions (US-011 AC #2)
  body,                -- normalized body text ONLY when node.level='full' (US-003/US-011)
  tokenize = 'unicode61 remove_diacritics 2'
);

-- snapshots: one row per sync (US-009 model; written in Phase 4, schema ready now).
CREATE TABLE IF NOT EXISTS snapshots (
  id            TEXT PRIMARY KEY,      -- deterministic per (engine, taken_at) or caller-supplied
  taken_at      TEXT NOT NULL,         -- ISO-8601 UTC
  engine        TEXT NOT NULL,
  engine_version TEXT,
  fingerprint   TEXT NOT NULL,         -- ADR-005 drift fingerprint
  counts        TEXT NOT NULL          -- JSON: per-NodeKind counts
);
CREATE INDEX IF NOT EXISTS idx_snapshots_taken_at ON snapshots(taken_at);

-- meta: key/value store for schema_version, engine, levels, etc.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 3.2 FTS5 — what is indexed and why

- **Indexed (tokenized) columns:** `qname`, `comment`, `body`. These are the three things US-011 must
  match: approximate names, comments/descriptions, and bodies (the last only at `full` level).
- **`id` is `UNINDEXED`** — it is a join key back to `nodes`, never a search target.
- **Population rule (level-aware, §5.4):** every non-`off` node gets an FTS row with `qname` + `comment`.
  The `body` column is populated ONLY when `node.level === 'full'`; at `metadata`/`off` the `body` cell is
  empty, so a body-term search cannot match a metadata-only node — satisfying US-003 ("body NOT in FTS at
  metadata"). `off` nodes get no FTS row at all.
- **Tokenizer:** `unicode61 remove_diacritics 2` gives accent- and case-insensitive matching. Typo
  tolerance (US-011 `search("custmer")`) is delivered by the query layer using FTS prefix tokens + an
  optional trigram fallback computed in TypeScript (no extra dependency); see §6.4.
- **Sync rule:** `nodes_fts` is maintained by the adapter's upsert/delete paths (not SQLite triggers) so
  the adapter controls determinism and the level gating. Documented in `schema.ts`.

### 3.3 Schema versioning & forward-only migrations

- `meta('schema_version')` holds an integer (`'1'` for this change).
- `migrations.ts` exports an ordered array `MIGRATIONS: { version: number; up: (db) => void }[]`.
- On open: read current version from `meta` (absent ⇒ 0), run every migration with `version > current`
  in order inside a single transaction, then write the new version. **Forward-only** — no `down`.
  Rationale (ADR-008 determinism + ADR-005 local-only): the index is a derived cache; a backward-incompatible
  change ships a higher version and a fresh rebuild, never a risky in-place downgrade.
- If `current > max(known)` (DB written by a newer dbgraph), throw `SchemaVersionError` with the
  observed vs supported versions and the remediation ("re-sync to rebuild the index").

### 3.4 Deterministic node & edge IDs (DECISION — qualified-name-based stable IDs)

**Decision: derive IDs deterministically from kind + canonical qualified name (NOT surrogate
auto-increment).** ADR-008 requires byte-for-byte reproducible output so golden files are possible.

- **Node ID** = `sha1(kind + ' ' + canonicalQName)` rendered as lowercase hex.
  - `canonicalQName` = the fully-qualified, case-folded name produced by `id.ts` (engine quoting and
    bracketing stripped; segments joined by `.`; e.g. `table:dbo.orders` → hash). The `kind` prefix
    prevents collisions between, say, a table and a view sharing a name in different namespaces.
  - Stubs reuse the SAME derivation from the referenced qname, so a later real extraction of that object
    lands on the SAME node ID and naturally "upgrades" the stub (idempotent upsert).
- **Edge ID** = `sha1(kind + ' ' + src_id + ' ' + dst_id + ' ' + discriminator)`.
  - `discriminator` distinguishes otherwise-parallel edges: for `references` it is the ordered
    `srcColumn>dstColumn` pair (so each column pair in a composite FK is a distinct edge); for `fires_on`
    it is the event (`INSERT|UPDATE|DELETE`); empty for edges that cannot duplicate (e.g. the aggregated
    table→table edge, where discriminator = `'aggregate'`).

**Why hash, not the raw qname as PK:** keeps PK width fixed and opaque, avoids quoting/Unicode edge cases
leaking into keys, and gives a uniform 40-char ID across every kind. **Why not surrogate INTEGER PK:**
auto-increment IDs depend on insertion order and prior DB state → non-deterministic → golden files churn
on every run (the exact failure ADR-008 forbids). The hash is a pure function of semantic identity.

> `id.ts` is the single source of truth for canonicalization + hashing; both `normalize/` and any future
> incremental-sync path call it, so IDs stay consistent. `sha1` comes from Node's built-in `crypto` — no
> new dependency (ADR-007).

---

## 4. Domain model — exact TypeScript types (`graph-model`)

### 4.1 Node kinds & nodes

```ts
// model/node.ts
export type NodeKind =
  | 'database'
  | 'schema'
  | 'table'
  | 'column'
  | 'constraint'   // PK / FK / UNIQUE / CHECK (subtype in payload)
  | 'index'
  | 'view'
  | 'procedure'
  | 'function'
  | 'trigger'
  | 'sequence'
  | 'collection'   // MongoDB
  | 'field';       // MongoDB sampled field

export type IndexLevel = 'off' | 'metadata' | 'full';

// Per-object-type level configuration (ADR-003 defaults live in code, not here).
export interface ObjectTypeLevels {
  tables: IndexLevel;
  columns: IndexLevel;
  constraints: IndexLevel;
  indexes: IndexLevel;
  views: IndexLevel;
  procedures: IndexLevel;
  functions: IndexLevel;
  triggers: IndexLevel;
  sequences: IndexLevel;
  collections: IndexLevel;
  fields: IndexLevel;
  statistics: IndexLevel;   // off by default (ADR-003)
  sampling: IndexLevel;     // off by default (ADR-003)
}

export interface GraphNode {
  readonly id: string;            // deterministic (§3.4)
  readonly kind: NodeKind;
  readonly schema: string | null; // namespace; null for roots / engine-less kinds
  readonly name: string;          // local name
  readonly qname: string;         // canonical fully-qualified name
  readonly level: IndexLevel;     // level applied to THIS node
  readonly missing: boolean;      // stub for absent referenced object
  readonly excluded: boolean;     // stub for filtered-out object (US-004)
  readonly bodyHash: string | null;
  readonly payload: NodePayload;  // kind-specific structured fields — see §4.4
}
```

### 4.2 Edge kinds & edges

```ts
// model/edge.ts
export type EdgeKind =
  | 'references'          // FK column→column AND aggregated table→table (attrs.aggregate=true)
  | 'depends_on'          // view/proc depends on object (e.g. view → table)
  | 'reads_from'          // proc/trigger/view READS a table/column (US-007)
  | 'writes_to'           // proc/trigger WRITES a table/column (US-007)
  | 'fires_on'            // trigger → table, attrs.event = INSERT|UPDATE|DELETE
  | 'has_column'          // table/view → column (containment)
  | 'has_index'           // table → index
  | 'has_constraint'      // table → constraint
  | 'in_index'            // index → column (membership, ordered)
  | 'inferred_reference'; // TYPE ONLY in Phase 1; populated by Phase 9 (US-008)

export type EdgeConfidence = 'declared' | 'parsed' | 'inferred';

export interface GraphEdge {
  readonly id: string;             // deterministic (§3.4)
  readonly kind: EdgeKind;
  readonly src: string;            // node id
  readonly dst: string;            // node id
  readonly confidence: EdgeConfidence;
  readonly score: number | null;   // only when confidence='inferred'
  readonly attrs: EdgeAttrs;       // join columns, event, aggregate flag, ordinal…
}

export interface EdgeAttrs {
  readonly srcColumn?: string;       // references / reads_from / writes_to at column grain
  readonly dstColumn?: string;       // references target column
  readonly event?: 'INSERT' | 'UPDATE' | 'DELETE';  // fires_on
  readonly aggregate?: boolean;      // true on the single table→table references edge
  readonly ordinal?: number;         // in_index / has_column ordering
  readonly constraintName?: string;  // groups the per-column edges of one composite FK
}
```

> `inferred_reference` and the `score` field exist in the TYPE system now (proposal: "`inferred_reference`
> TYPE only") so the storage schema and query code are forward-compatible, but the Phase-1 normalizer NEVER
> emits inferred edges (deterministic, ADR-008 — no guessing on the sync path).

### 4.3 Capability matrix & extraction scope

```ts
// model/capability.ts
export interface CapabilityMatrix {
  readonly engine: string;                  // 'mssql' | 'pg' | 'mysql' | 'mongodb' | 'sqlite' | …
  readonly supported: ReadonlySet<NodeKind>; // object types this engine can produce
  readonly defaultLevels: ObjectTypeLevels;  // ADR-003 defaults specialized per engine
  readonly supportsBodies: boolean;          // can it return proc/trigger source?
  readonly supportsDependencyHints: boolean; // can it report read/write deps cheaply?
}

export interface ExtractionScope {
  readonly levels: ObjectTypeLevels;        // effective (config-resolved) levels
  readonly include?: readonly string[];     // glob patterns (Phase 4 applies; model honors stubs)
  readonly exclude?: readonly string[];
}
```

`ExtractionScope` is the normalizer's second argument: it carries the effective levels (off/metadata/full)
the normalizer must apply (§5.4) and the include/exclude patterns that produce `excluded:true` stubs.

### 4.4 Node payload — DECISION: generic JSON with a discriminated *accessor* layer

**Decision: `payload` is stored as generic JSON (`NodePayload`) and surfaced through a per-kind
discriminated TypeScript view, NOT as a hard closed union baked into the storage row.**

```ts
// model/node.ts — payload is structurally typed per kind via a discriminated union of *views*,
// but persisted as opaque JSON so adapters can carry engine-specific extras without a schema change.
export type NodePayload = Readonly<Record<string, unknown>>;

// Typed views (compile-time ergonomics over the JSON):
export interface TablePayload   { rowCountEstimate?: number; comment?: string }
export interface ColumnPayload  { dataType: string; nullable: boolean; default?: string | null;
                                  ordinal: number; comment?: string }
export interface ConstraintPayload { type: 'PK' | 'FK' | 'UNIQUE' | 'CHECK'; definition?: string;
                                      columns: readonly string[] }
export interface IndexPayload   { unique: boolean; columns: readonly string[]; method?: string }
export interface RoutinePayload { signature?: string; returns?: string;
                                  body?: string;            // present only when level='full'
                                  hasDynamicSql: boolean;   // US-007 / US-014 propagation
                                  comment?: string }
export interface TriggerPayload { timing?: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
                                  events: readonly ('INSERT'|'UPDATE'|'DELETE')[];
                                  body?: string; hasDynamicSql: boolean; comment?: string }
```

**Rationale.** The `RawCatalog`/payload contract must outlive Phase 1 and serve 5 heterogeneous engines
(SQL dialects + MongoDB) whose object types and per-type attributes diverge (MSSQL filegroups, PG
partitioning, Mongo sampled types). A **hard closed discriminated union persisted to the column** would
force a schema migration and a core type change every time any one engine needs an extra attribute —
violating the "contract outlives Phase 1" requirement and creating cross-engine coupling. **Generic JSON
storage + typed accessor views** gives:
- compile-time ergonomics where we read payloads (query/format code narrows by `kind`),
- zero schema churn when an engine adds an attribute (it rides inside the JSON),
- determinism preserved (JSON is serialized with sorted keys, §5.6).

Rejected alternative — **hard typed-per-kind column union**: cleaner at first glance but couples the
storage schema and the core model to every engine's quirks; each new engine = breaking change. The
accessor approach keeps the *contract* (the documented fields above) typed and stable while the *transport*
stays open. The documented view interfaces ARE the contract engines must honor; extra keys are tolerated,
documented keys are mandatory for the kinds that have them.

### 4.5 RawCatalog — the durable adapter→core contract

This shape is what every future engine adapter (Phase 3/5) produces and feeds to `normalizeCatalog`. It is
designed now for all five planned engines and every object type the brief enumerates.

```ts
// model/catalog.ts
export interface RawCatalog {
  readonly engine: string;
  readonly engineVersion?: string;
  readonly schemas: readonly string[];          // namespaces discovered
  readonly objects: readonly RawObject[];        // every extracted object, any kind
}

export interface RawObject {
  readonly kind: NodeKind;
  readonly schema: string | null;
  readonly name: string;
  // Structural children (tables/views): columns, constraints, indexes.
  readonly columns?: readonly RawColumn[];
  readonly constraints?: readonly RawConstraint[];
  readonly indexes?: readonly RawIndex[];
  // Routines/triggers: body (level-gated) + dependency hints + dynamic-sql blindness flag.
  readonly signature?: string;
  readonly returns?: string;
  readonly body?: string;                        // adapter SHOULD omit unless level requires it
  readonly hasDynamicSql?: boolean;              // US-007: declared blindness, not hidden
  readonly trigger?: RawTriggerInfo;             // timing + events + target table
  readonly dependencies?: readonly RawDependency[]; // read/write hints (US-007)
  readonly comment?: string;                     // catalog comment/description
  readonly extra?: Readonly<Record<string, unknown>>; // engine-specific passthrough → payload
}

export interface RawColumn {
  readonly name: string; readonly dataType: string; readonly nullable: boolean;
  readonly default?: string | null; readonly ordinal: number; readonly comment?: string;
}
export interface RawConstraint {
  readonly name: string; readonly type: 'PK' | 'FK' | 'UNIQUE' | 'CHECK';
  readonly columns: readonly string[];
  readonly references?: { schema: string | null; table: string;
                          columns: readonly string[] };   // FK target (column order aligns with `columns`)
  readonly definition?: string;                  // CHECK expression, etc.
}
export interface RawIndex {
  readonly name: string; readonly unique: boolean; readonly columns: readonly string[];
  readonly method?: string;
}
export interface RawTriggerInfo {
  readonly timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  readonly events: readonly ('INSERT' | 'UPDATE' | 'DELETE')[];
  readonly table: { schema: string | null; name: string };
}
export interface RawDependency {
  readonly target: { schema: string | null; name: string; kind?: NodeKind };
  readonly access: 'read' | 'write';             // read/write classification (US-007)
  readonly confidence: 'declared' | 'parsed';    // declared (catalog dep view) vs parsed (body)
}
```

Coverage check against the brief's object list — tables, columns, constraints, indexes, views, procedures,
functions, triggers, sequences (all via `RawObject.kind` + structural children), collections/fields
(Mongo, via `kind` + `extra` for sampled types), **comments** (`comment` on object & column), **bodies
optional by level** (`body`, omitted unless level demands), **dependency hints with read/write
classification** (`RawDependency.access`), **`has_dynamic_sql`** (`hasDynamicSql`). The contract is
complete for Phase 1 and extensible (via `extra`) for engine quirks without breaking changes.

### 4.6 Normalization result

```ts
// model/graph.ts
export interface NormalizedGraph {
  readonly nodes: readonly GraphNode[];   // deterministically ordered (§5.6)
  readonly edges: readonly GraphEdge[];   // deterministically ordered (§5.6)
}
export interface StubInfo {
  readonly id: string; readonly qname: string; readonly kind: NodeKind;
  readonly reason: 'missing' | 'excluded';
  readonly referencedBy: string;          // node id that forced the stub
}
export interface NormalizationResult {
  readonly graph: NormalizedGraph;
  readonly stubs: readonly StubInfo[];     // US-006 AC #3 — reported, never silent
  readonly warnings: readonly string[];    // e.g. dropped duplicate, unknown ref kind
}
```

---

## 5. Normalizer algorithm (`graph-normalization`)

Entry point: `normalizeCatalog(raw: RawCatalog, scope: ExtractionScope): NormalizationResult`.
Pure function, no I/O (it does not touch the store — that is the caller's job, §10). Order matters for
determinism (ADR-008).

### 5.1 Pipeline (ordered)

1. **Input validation.** Verify `raw.engine` non-empty; every `RawObject` has a `kind ∈ NodeKind` and a
   `name`; FK constraints with `references` have aligned `columns`/`references.columns` lengths. On a
   structural violation throw `NormalizationError` (actionable: which object, which field). Unknown but
   non-fatal issues (e.g. an unrecognized dependency target kind) become `warnings`, not throws.
2. **Filter pass (exclude).** Apply `scope.exclude`/`scope.include` glob patterns to the object set. An
   object that fails the filter is NOT dropped silently if something references it — instead it is a
   candidate for an `excluded:true` stub (created in step 5 only if actually referenced). Objects with
   no inbound reference are simply omitted.
3. **Primary node creation.** For each surviving object compute its canonical qname + ID (`id.ts`) and
   build the `GraphNode` with level applied (§5.4). Create containment edges (`has_column`,
   `has_index`, `has_constraint`, `in_index`) and child column/constraint/index nodes. De-dup by node ID
   (two objects mapping to the same ID ⇒ keep first, emit a warning).
4. **Reference resolution (ordered).** Resolution order is fixed for determinism:
   **(a)** declared FK constraints → `references` edges, **(b)** trigger targets → `fires_on`,
   **(c)** dependencies → `depends_on` / `reads_from` / `writes_to`. For each reference, resolve the
   target by canonical qname against the node map built in step 3.
5. **Stub creation.** A reference whose target is not in the node map gets a stub node:
   - target was filtered out in step 2 ⇒ stub with `excluded:true`;
   - target genuinely absent (e.g. view over a dropped table) ⇒ stub with `missing:true`.
   Stub ID is derived from the target qname (§3.4) so a future real extraction upgrades it. Every stub is
   recorded in `result.stubs` with its `referencedBy` (US-006 AC #3: "reports it in the result").
6. **Deterministic ordering & serialization** (§5.6).

### 5.2 Composite FK handling (US-006 AC #2)

For an FK constraint over N column pairs:
- emit **one `references` edge per column pair** (`attrs.srcColumn`/`dstColumn`/`constraintName`,
  `confidence: 'declared'`), ID discriminated by the column pair so all N are distinct;
- emit **exactly ONE aggregated `references` edge** at table→table grain (`attrs.aggregate=true`,
  discriminator `'aggregate'`, `constraintName` set). This is the edge `getNeighbors`/`findJoinPath`
  traverse at table level; the per-column edges carry the precise join columns for US-015.

### 5.3 Reads/writes & dynamic SQL (US-007 model)

From `RawDependency[]`: `access:'read'` → `reads_from`; `access:'write'` → `writes_to`; `confidence`
maps straight through (`declared`|`parsed`). A `RawObject` with `hasDynamicSql:true` sets
`payload.hasDynamicSql=true` on its node so `getImpact` can propagate the blindness warning (US-014 AC #4).
Phase 1 only normalizes dependency hints the adapter already provides; it does NOT parse SQL bodies
(that is Phase 3 extraction). The model and edges are ready so Phase 3 plugs in without core changes.

### 5.4 Level application (off / metadata / full)

Per node, the effective level comes from `scope.levels` for that object's kind:
- **`off`** — the object produces **no node and no FTS row** (and therefore no edges that would dangle into
  it become stubs only if some *other* indexed object references it). For child types specifically
  (e.g. `indexes:'off'`): no index nodes, no `has_index`/`in_index` edges — `dbgraph_object` later reports
  "indexes not indexed by configuration" (US-003 AC #4).
- **`metadata`** — node exists with structural payload (signature, columns, edges) but **`payload.body`
  is omitted, `bodyHash` is null, and the FTS `body` column is empty** (US-003 AC #1). Reads/writes and
  other edges still exist.
- **`full`** — node includes the normalized `body`, `bodyHash = sha1(normalizedBody)` (ADR-005), and the
  FTS `body` column is populated (US-003 AC #2 / US-011 body search).

`levels.ts` centralizes this so the rule is applied identically everywhere and is unit-testable in
isolation. The node's `level` field records the level actually applied (so consumers can say so explicitly).

### 5.5 Body normalization (for `bodyHash` determinism, ADR-005/008)

When a body is indexed at `full`, it is normalized before hashing/storing: trim trailing whitespace per
line, normalize line endings to `\n`, drop a trailing newline. This keeps `bodyHash` stable across
extraction environments (CRLF vs LF) so incremental sync (Phase 4) and golden files don't churn. (No SQL
re-formatting — that would be lossy and engine-specific; only whitespace canonicalization.)

### 5.6 Deterministic ordering (ADR-008)

- **Nodes** sorted by `(kind, qname, id)`.
- **Edges** sorted by `(kind, src, dst, attrs.constraintName ?? '', attrs.srcColumn ?? '', id)`.
- **JSON payload/attrs** serialized with **sorted object keys** (a small stable-stringify helper in
  `id.ts`/a shared util) so byte output is identical run to run.
- Arrays inside payloads (columns, index members) preserve their `ordinal`; where no ordinal exists they
  are sorted by name. Result: same `RawCatalog` → identical `NormalizationResult` bytes → golden files hold.

---

## 6. Query algorithms (`graph-query`)

All query functions take a `GraphStore` (the port) plus a typed query object and return typed results.
They are pure orchestration over port reads — no driver knowledge. Each is independently golden-tested.

### 6.1 `getNeighbors(store, q: NeighborQuery): NeighborGroups` — US-013

- Load outbound and inbound edges for `q.nodeId` (port: `getEdgesFrom` / `getEdgesTo`), optionally filtered
  by `q.kinds`.
- Group by `EdgeKind` AND direction → `{ references: { out: [...], in: [...] }, depends_on: {...},
  reads_from, writes_to, fires_on, … }`. Each entry carries the neighbor node (resolved via `getNode`) and
  the edge attrs. **Inferred edges are returned in a separate `inferred` group** with their `score`
  (US-013 AC #2) — distinct from declared, never mixed.
- Deterministic: groups in a fixed kind order; within a group, neighbors sorted by `(qname, id)`.

### 6.2 `getImpact(store, q: ImpactQuery): ImpactResult` — US-014

The blast-radius traversal. Default `depth = 3`.

- **Traversal:** BFS from `q.nodeId` over the *impact edge set*, following edges in the impact direction:
  for a target node X, what depends on / writes to / reads X. Concretely we walk **inbound**
  `writes_to`, `reads_from`, `depends_on`, and `references` edges (who points AT this node), plus the
  containment edges so a column-level start (`impact("orders.status")`) escalates to its table and to
  indexes/constraints containing it (US-014 AC #1: "indexes containing it, FKs, views selecting it…").
- **Read vs write separation (AC #2):** maintain two result chains. An edge of kind `writes_to` (or a
  `references`/constraint touching the column in a way that can corrupt) contributes to **write impact**;
  `reads_from` / `depends_on` (views selecting it) contribute to **read impact**. The classification is by
  edge kind, recorded per hop.
- **Visible dependency chains (AC #1):** results are returned as **paths `a→b→c`**, not a flat set. Each
  impacted node carries the chain of edges that reached it (predecessor recorded during BFS). This is the
  difference between "what breaks" and "why it breaks".
- **Depth cap + truncation warning (AC #3):** stop expanding beyond `depth`; if any node was reached at the
  boundary and had unexpanded edges, set `result.truncated = true` with a warning naming the cutoff.
- **Cycle safety:** a `visited` set keyed by node ID prevents infinite walks on cyclic schemas (proposal
  risk: "impact-closure cycles / unbounded walk"; tested on `catalog-cyclic.json`).
- **Dynamic-SQL propagation (AC #4):** if ANY node on ANY surfaced chain has `payload.hasDynamicSql`,
  set `result.dynamicSqlWarning = true` ("impact possibly incomplete").
- Deterministic: BFS frontier processed in sorted `(kind, qname, id)` order; chains and the final node list
  sorted stably.

```ts
export interface ImpactResult {
  readonly readImpact: readonly ImpactChain[];   // chains that break on READ
  readonly writeImpact: readonly ImpactChain[];  // chains that may corrupt on WRITE
  readonly truncated: boolean;
  readonly dynamicSqlWarning: boolean;
}
export interface ImpactChain {
  readonly nodes: readonly string[];   // node ids a→b→c (start … impacted)
  readonly edges: readonly EdgeKind[]; // edge kind per hop (length = nodes.length-1)
}
```

### 6.3 `findJoinPath(store, q: PathQuery): PathResult` — US-015

- **Shortest path** between two table nodes over `references` edges (declared now; `inferred_reference`
  becomes traversable in Phase 9 — the code already accepts an `allowInferred` flag, default false).
- BFS at table grain over **aggregated** `references` edges (both directions — a join works either way).
  For each hop on the found path, resolve the matching **per-column** `references` edge(s) to emit the
  **exact join columns** (`srcColumn = dstColumn`) for that hop (US-015 AC #1).
- **No route (AC #3):** return `{ found:false, nearest: { from:[…], to:[…] } }` listing the closest
  neighbors of each endpoint (one BFS hop) so the agent gets a useful next step.
- **Inferred-only route (AC #2):** if a path exists only when `allowInferred` is on, mark
  `result.inferred = true`. In Phase 1 this is structurally supported but always false (no inferred edges).
- Deterministic: BFS explores neighbors in sorted order; ties broken by `(qname, id)` so "the shortest
  path" is a single stable path, not an arbitrary one.

```ts
export interface PathResult {
  readonly found: boolean;
  readonly hops?: readonly JoinHop[];   // present when found
  readonly inferred?: boolean;
  readonly nearest?: { from: readonly string[]; to: readonly string[] }; // when not found
}
export interface JoinHop {
  readonly fromTable: string; readonly toTable: string;
  readonly joinColumns: readonly { from: string; to: string }[];
}
```

### 6.4 `search(store, q: SearchQuery): SearchHit[]` — US-011 / FTS semantics

- Delegates to the port's `searchFts(query, opts)` (the adapter runs FTS5 MATCH). Query semantics:
  - tokenize the user term; build an FTS5 query using **prefix tokens** (`custmer*`) for typo/partial
    tolerance, OR-combined across `qname`/`comment`/`body` columns.
  - results ranked by FTS5 `bm25()`; each hit includes node `kind`, `qname`, and the matched column.
  - **body matches only surface for `full` nodes** because metadata/off nodes have an empty `body` cell
    (§3.2) — enforced by data, not by query branching.
- **Typo fallback (US-011 `search("custmer")`):** if prefix-token FTS returns nothing, the query layer
  runs a bounded Levenshtein/trigram rank over candidate `qname`s fetched from the port (computed in
  TypeScript — no new dependency, ADR-007). Threshold and cap are constants; deterministic ordering by
  `(score, qname)`.
- Pagination: `q.limit`/`q.offset`; the port returns a `total` for `declared total` (US-011 AC #3).

---

## 7. Error types & Logger port

### 7.1 Typed errors (`core/errors.ts`)

Following `dbgraph-conventions` ("typed error classes per category … actionable … never bare strings"):

```ts
export class DbgraphError extends Error {            // base; carries a stable `code`
  constructor(message: string, readonly code: string) { super(message); this.name = new.target.name; }
}
export class NormalizationError extends DbgraphError { /* code 'E_NORMALIZE' — which object/field failed */ }
export class StorageError       extends DbgraphError { /* code 'E_STORAGE'   — wraps driver failures */ }
export class SchemaVersionError extends DbgraphError { /* code 'E_SCHEMA_VERSION' — observed vs supported */ }
export class QueryError         extends DbgraphError { /* code 'E_QUERY'     — bad query params */ }
export class NotFoundError      extends DbgraphError { /* code 'E_NOT_FOUND' — unknown node id/qname */ }
```

Each constructor takes the structured context (e.g. `NotFoundError(nodeId)`) and produces an actionable
message (what was looked up + the likely fix, e.g. "re-sync to rebuild the index"). The connection/permission
errors named in the convention skill belong to the *adapter* layer in later phases; Phase 1 core ships the
five above. No error is ever a bare string; nothing is swallowed.

### 7.2 Logger port (`core/ports/logger.ts`)

```ts
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
```

Core uses the injected `Logger` (never `console.log` — convention skill). A no-op default logger lives in
core so functions can take an optional logger without null checks. Security note (`dbgraph-security`): no
log line ever includes a resolved connection URL — relevant once adapters connect (Phase 3+); Phase 1 has
nothing to leak but the port shape forbids it by being message+meta only.

---

## 8. Boundary enforcement (DECISION — repo test, no new dependency)

**Decision: enforce the hexagonal import rule with a dependency-free vitest test, NOT an eslint
boundary plugin.** ADR-007 mandates a CLOSED canonical dependency list and written justification for any
addition; `dbgraph-security` repeats it. An eslint plugin (`eslint-plugin-boundaries` / `import/no-restricted-paths`)
would add a dependency whose only job is enforcing one rule we can assert directly. The `dbgraph-security`
skill ALREADY establishes the pattern ("a repo test scans all embedded adapter SQL for write verbs and
FAILS the build"), so a sibling import-scanning test is idiomatic and consistent.

`test/core/boundaries.test.ts`:
- glob every file under `src/core/**`;
- parse import/`from` specifiers (simple regex over `import ... from '...'` + dynamic `import('...')`);
- FAIL if any specifier resolves to `src/adapters`, `src/mcp`, `src/cli`, or any known DB driver
  (`better-sqlite3`, `mssql`, `pg`, `mysql2`, `mongodb`);
- also assert `src/adapters/storage/sqlite/**` imports nothing from `src/mcp`/`src/cli`.

Rejected alternative — eslint plugin: rejected on ADR-007 grounds (new dep, audit surface) and because the
test gives the same guarantee with zero supply-chain cost and lives next to the security SQL-scan test.
Trade-off accepted: the test is slightly less "live" in the editor than an eslint rule, but it runs in
`npm test`/CI (the gate that matters) and adds nothing to the dependency tree.

---

## 9. Test strategy mapping (strict TDD — config `strict_tdd: true`)

`dbgraph-testing`: ALL of `src/core` is strict TDD (red → green → refactor); golden files pin every output
format; fixtures live at `test/fixtures/catalog-*.json`. The tasks phase MUST order work red-before-green.

### 9.1 Fixtures (inputs) and golden files (expected outputs)

| Fixture (`test/fixtures/`) | Shape | Drives |
|---|---|---|
| `catalog-minimal.json` | 2 tables, 1 FK, 1 view, 1 trigger | US-006 AC #1 — node/edge presence, `fires_on`, `depends_on` |
| `catalog-composite-fk.json` | one 2-column FK | US-006 AC #2 — per-column edges + 1 aggregated edge |
| `catalog-dangling-ref.json` | view over a dropped table | US-006 AC #3 — `missing:true` stub + reported |
| `catalog-excluded.json` | FK to a filtered-out table + `exclude` scope | US-004 model — `excluded:true` stub |
| `catalog-cyclic.json` | proc/view cycle | US-014 — depth cap + visited set, no infinite walk |
| `catalog-rw-edges.json` | proc reads B / writes A; one `hasDynamicSql` module | US-007 model + US-014 dynamic-sql warning |
| `catalog-levels.json` | same procs at metadata vs full | US-003 — body/FTS gating |

Golden layout: `test/golden/normalize/<fixture>.json` (full `NormalizationResult`) and
`test/golden/query/<case>.json` (neighbors/impact/path/search results). Goldens are deterministic JSON
(sorted keys, §5.6); changing one is a deliberate act (testing skill).

### 9.2 Red → green order the tasks phase should follow

1. **Model + errors** (types compile; trivial guards) — failing type/assert tests first.
2. **`id.ts`** determinism — test SAME qname → SAME id, kind disambiguation, stub upgrade equality.
3. **`levels.ts`** — off/metadata/full effects on payload + FTS flag (pure, table-driven test).
4. **Normalizer** — one failing test per US-006 AC (minimal → composite FK → dangling stub → excluded
   stub), each pinned by a `normalize/` golden; reads/writes + dynamic-sql from `catalog-rw-edges`.
5. **SQLite adapter** — round-trip tests against REAL `better-sqlite3` (in-memory `:memory:` or a tmp
   file, NOT mocked — testing skill): upsert a normalized graph, read back per id/kind, neighbor/edge
   reads, FTS search, snapshot persist/list, meta get/set, migration from version 0.
6. **Query engine** — neighbors (US-013) → impact read/write/depth/cycle/dynamic-sql (US-014) → path with
   join columns + no-route + nearest (US-015) → FTS search incl. typo fallback (US-011). Each golden-pinned.
7. **Boundary test** (§8) and the public-API barrel test (exports exist & are stable).

Every story AC in scope maps to ≥1 test (testing skill: "acceptance criteria … map to at least one test").

---

## 10. Sequence diagram — normalize → persist → query

```
Caller (test / future CLI)        normalizeCatalog        GraphStore (SqliteGraphStore)        SQLite (better-sqlite3)
        |                              |                            |                                   |
        |  raw: RawCatalog             |                            |                                   |
        |  scope: ExtractionScope      |                            |                                   |
        |----------------------------->|                            |                                   |
        |                              | validate + filter          |                                   |
        |                              | create nodes (id.ts)       |                                   |
        |                              | resolve refs (FK/dep/trig) |                                   |
        |                              | create stubs (missing/excl)|                                   |
        |                              | apply levels (levels.ts)   |                                   |
        |                              | sort + stable-serialize    |                                   |
        |   NormalizationResult        |                            |                                   |
        |<-----------------------------|                            |                                   |
        |                                                           |                                   |
        |  createSqliteGraphStore(opts)  (adapters/.../factory.ts — dynamic import 'better-sqlite3')    |
        |---------------------------------------------------------->| open db                           |
        |                                                           | run migrations (meta.schema_ver)  |
        |                                                           |---------------------------------->| PRAGMA + DDL (txn)
        |   GraphStore                                              |<----------------------------------|
        |<----------------------------------------------------------|                                   |
        |                                                           |                                   |
        |  store.upsertGraph(result.graph)                          |                                   |
        |---------------------------------------------------------->| begin txn                         |
        |                                                           | upsert nodes/edges + nodes_fts    |
        |                                                           | (level-gated FTS body)            |
        |                                                           |---------------------------------->| INSERT/UPSERT rows
        |   UpsertResult { nodes, edges }                           |<----------------------------------| commit
        |<----------------------------------------------------------|                                   |
        |                                                           |                                   |
        |  getImpact(store, { nodeId, depth:3 })                    |                                   |
        |---------------------------------------------------------->| getNode / getEdgesTo (BFS hops)   |
        |                                                           |---------------------------------->| SELECT (indexed)
        |   ImpactResult { readImpact, writeImpact, truncated,      |<----------------------------------|
        |                  dynamicSqlWarning }                      |                                   |
        |<----------------------------------------------------------|                                   |
```

Key boundary fact visible in the flow: `normalizeCatalog` is pure and store-agnostic; the **factory** is the
only place the driver is loaded (dynamic `import('better-sqlite3')`), so a core-only consumer (and the
boundary test) never pulls the native module. Query functions speak ONLY the `GraphStore` port.

---

## 11. GraphStore port API (`core/ports/graph-store.ts`)

Async signatures (§1 decision). Sufficient for bulk upsert, per-kind/per-id reads, neighbor/edge
traversal, FTS, snapshots, and meta.

```ts
export interface GraphStore {
  // lifecycle
  close(): Promise<void>;
  schemaVersion(): Promise<number>;

  // bulk write — upsert a whole normalized graph in one transaction (idempotent on deterministic ids)
  upsertGraph(graph: NormalizedGraph): Promise<UpsertResult>;
  deleteNodes(ids: readonly string[]): Promise<number>;   // cascades edges + fts (Phase 4 incremental)

  // reads — per id / per kind
  getNode(id: string): Promise<GraphNode | null>;
  getNodesByKind(kind: NodeKind): Promise<readonly GraphNode[]>;
  getNodeByQName(kind: NodeKind, qname: string): Promise<GraphNode | null>;

  // edges / traversal
  getEdgesFrom(nodeId: string, kinds?: readonly EdgeKind[]): Promise<readonly GraphEdge[]>;
  getEdgesTo(nodeId: string, kinds?: readonly EdgeKind[]): Promise<readonly GraphEdge[]>;

  // FTS
  searchFts(query: string, opts?: { limit?: number; offset?: number })
    : Promise<{ hits: readonly SearchHit[]; total: number }>;

  // snapshots (US-009 model; written in Phase 4)
  putSnapshot(s: SnapshotRecord): Promise<void>;
  listSnapshots(): Promise<readonly SnapshotRecord[]>;

  // meta
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

export interface UpsertResult { readonly nodes: number; readonly edges: number }
export interface SearchHit {
  readonly id: string; readonly kind: NodeKind; readonly qname: string;
  readonly column: 'qname' | 'comment' | 'body'; readonly score: number;
}
export interface SnapshotRecord {
  readonly id: string; readonly takenAt: string; readonly engine: string;
  readonly engineVersion?: string; readonly fingerprint: string;
  readonly counts: Readonly<Record<string, number>>;
}
```

`getEdgesFrom`/`getEdgesTo` are the only traversal primitives the query layer needs — `getNeighbors`,
`getImpact`, and `findJoinPath` are implemented on top of them in `src/core/query` (no extra port methods),
keeping the port minimal and the algorithms unit-testable against an in-memory fake `GraphStore` as well as
the real adapter.

---

## 12. ADR traceability summary

| Decision (this design) | ADR |
|---|---|
| Pure core hexagon; ports owned by core; driver only in adapter via dynamic import; boundary enforced | ADR-004 |
| `.dbgraph/dbgraph.db`; nodes/edges/nodes_fts(FTS5)/snapshots/meta; `body_hash`; port absorbs driver duality (async seam) | ADR-005 |
| off/metadata/full per object type; ADR-003 defaults (triggers full, procs/functions metadata, stats/sampling off); CapabilityMatrix drives them | ADR-003 |
| Deterministic IDs, stable ordering, sorted-key JSON, body whitespace normalization → golden files possible; no LLM/guessing on sync path | ADR-008 |
| Boundary test (not eslint plugin) + reusing the security SQL-scan test pattern; `better-sqlite3` from closed list, sha1 from built-in crypto (no new deps) | ADR-006 / ADR-007 |
