# MongoDB Extraction Specification

## Purpose

The concrete MongoDB `MongodbSchemaAdapter`: the FIFTH concrete `SchemaAdapter` and the first
schemaLESS engine. Where the SQL engines READ a catalog, this adapter INFERS structure by SAMPLING
documents. It samples each collection via `$sample` (size from config, default `100`), recursively
walks the sampled documents' KEYS into dotted field paths (`address.city`) and array element-type
encodings (`items[].sku`), MERGES the observed types per path into a union with a presence FREQUENCY,
and then DISCARDS the document values — only field NAMES, TYPES and frequencies survive. It extracts
indexes via `listIndexes`, carries top-level `$jsonSchema` validators in `extra`, declares a truthful
`MONGODB_CAPABILITIES` (collection/field/index supported; tables/columns/constraints/views/procedures/
functions/triggers/sequences NOT; `supportsBodies: false`; `supportsDependencyHints: false`), computes
a `fingerprint()` from `dbStats`, connects via a URI reference with a minimal read-only role
(`docs/permissions/mongodb.md`) plus an actionable `PermissionError`, and is golden-pinned over a fixed
torture dataset with a gated `mongo:7` Testcontainers end-to-end pipeline. Story: US-030.

This adapter lives under `src/adapters/engines/mongodb/` per ADR-004 (adapter outside core); the core
and the `SchemaAdapter` port MUST NOT change beyond the additive `RawField`/`RawObject.fields` model
path (schema-extraction). It loads its own `mongodb` driver via a LAZY dynamic `import()` (ADR-006). It
consumes the existing `graph-model`, `graph-normalization` and the SHIPPED `inferReferences` engine
(phase-9a) UNCHANGED. It is the CONSUMER that turns inference ON: MongoDB relationships exist ONLY as
`inferred_reference` edges — there are NO declared foreign keys.

> **Sampling is the SOLE structure source.** MongoDB has no catalog of fields. Field structure is a
> STATISTICAL inference over a finite sample, so it is honest only about what the sample observed:
> presence frequency is `count / sampleSize`, and a field absent from every sampled document is absent
> from the catalog. The committed torture dataset is FIXED and `$sample(size ≥ doc_count)` so the
> sample is the full collection and the golden is deterministic (ADR-008).
>
> **No body parsing.** `MONGODB_CAPABILITIES.supportsBodies` is `false`; there are no view/routine
> bodies to tokenize. The shared body tokenizer is NOT used by this adapter.

## Requirements

### Requirement: Extract collections via listCollections as RawObjects of kind collection

The mongodb adapter SHALL enumerate the connected database's user collections via `listCollections` and
emit each as a `RawObject` of `kind: 'collection'` carrying the connected database as its schema
(US-030). System collections (the `system.*` / `admin`/`local`/`config` internals) MUST be excluded. A
collection configured `off` by the resolved `ExtractionScope` MUST be absent from the catalog.

#### Scenario: User collections are extracted as collection objects

- GIVEN a MongoDB database with user collections and the internal `system.*` collections
- WHEN `extract(scope)` runs
- THEN the `RawCatalog` contains each user collection as a `RawObject` of `kind: 'collection'`
- AND no `system.*`/internal collection appears
- AND each collection carries the connected database as its schema

#### Scenario: A collection type set to off is absent

- GIVEN an `ExtractionScope` that sets collections to `off`
- WHEN `extract(scope)` runs
- THEN the returned `RawCatalog` contains NO collection object

### Requirement: Infer fields by sampling, merging observed types into a union with presence frequency

The mongodb adapter SHALL sample each collection with `$sample` using a size from config (default
`100`), recursively walk every sampled document's keys, and emit per distinct field path a `RawField`
(under `RawObject.fields`) carrying its observed dataType as a UNION of the BSON types seen and a
presence FREQUENCY equal to `observed-count / sampled-count` (US-030). A field observed with more than
one BSON type across the sample MUST carry the UNION of those types (not the first, not the last); a
field absent from some sampled documents MUST carry a frequency below `1.0`. Sampled documents MUST be
DISCARDED in memory after the type-merge — no document value survives into the `RawField`.

#### Scenario: Fixed dataset yields exact field types and frequencies

- GIVEN the committed torture dataset where `email` is a string in every document and `age` is an int in 87% of documents
- WHEN `extract(scope)` runs with `$sample(size ≥ doc_count)`
- THEN the collection's `fields` contain `email` with dataType `string` and frequency `1.0`
- AND `age` with dataType `int` and frequency `0.87`

#### Scenario: A field with mixed BSON types carries the union of those types

- GIVEN a collection where field `code` appears as an int in some documents and a string in others
- WHEN `extract(scope)` runs
- THEN `code` carries a UNION dataType encoding BOTH `int` and `string`
- AND its frequency reflects its presence across the sample

### Requirement: Represent nested documents as dotted paths and arrays by element type

The mongodb adapter SHALL flatten nested document structure into DOTTED field paths and encode array
membership by ELEMENT type (US-030). A nested sub-document key MUST be emitted as `parent.child` (e.g.
`address.city`); an array field MUST be emitted with an element-type encoding (e.g. `items[].sku` for
an array of sub-documents), NOT as an opaque `array` leaf that loses its element structure.

#### Scenario: Nested document keys become dotted field paths

- GIVEN a collection whose documents contain `{ address: { city: "..." } }`
- WHEN `extract(scope)` runs
- THEN a `RawField` with path `address.city` is present carrying its observed type and frequency
- AND no field value (e.g. the literal city string) is carried

#### Scenario: Array elements are encoded by element type

- GIVEN a collection whose documents contain `{ items: [ { sku: "..." } ] }`
- WHEN `extract(scope)` runs
- THEN a `RawField` encoding the array element path `items[].sku` is present with its observed type
- AND the array structure is represented by element type (not collapsed to an opaque `array` leaf)

### Requirement: Sampled values are NEVER persisted — only names, types and frequencies

The mongodb adapter SHALL guarantee that the `RawCatalog` it returns contains field NAMES, TYPES and
FREQUENCIES ONLY, and contains NO document VALUE from any sampled document (US-030; dbgraph-security).
Document values MUST be discarded in memory immediately after the type-merge. This adapter's source
falls under the existing engines write-verb scanner over `src/adapters/engines/**`; no fixture document
value may appear in the resulting index.

#### Scenario: RawCatalog carries field metadata but no document values

- GIVEN the torture dataset containing distinctive document values (e.g. a unique email address literal)
- WHEN `extract(scope)` runs and the catalog is serialized
- THEN the serialized `RawCatalog` contains the field NAMES, union TYPES and frequencies
- AND NO sampled document VALUE (e.g. the unique email literal) appears anywhere in it

#### Scenario: No fixture value reaches the persisted index

- GIVEN the full pipeline persisting the torture extraction into a `.db`
- WHEN the resulting index is inspected for known fixture document values
- THEN no sampled document value appears in the persisted `.db`

### Requirement: Extract indexes via listIndexes

The mongodb adapter SHALL extract each collection's indexes via `listIndexes` and emit each as a
`RawIndex` capturing whether it is UNIQUE and whether it is COMPOUND (its ordered key membership)
(US-030). A compound index MUST be represented as ONE index with its ordered keys preserved (not split
per key); a unique index MUST be marked unique. The default `_id` index MUST be attributed consistently
(not double-counted).

#### Scenario: Unique and compound indexes are extracted

- GIVEN a collection with a unique single-key index and a compound two-key index
- WHEN `extract(scope)` runs
- THEN the unique index is present and marked unique
- AND the compound index is present as ONE index with its ordered keys preserved

### Requirement: Carry top-level $jsonSchema validators in extra

The mongodb adapter SHALL, when a collection declares a `$jsonSchema` validator, carry its TOP-LEVEL
`required` list and `properties` in the collection's `extra` (US-030). Deep nesting of the validator
beyond the top level is OUT OF SCOPE and MUST NOT be walked. A collection without a validator MUST
simply carry no validator metadata (absence is not an error).

#### Scenario: Top-level $jsonSchema required and properties are carried in extra

- GIVEN a collection with a `$jsonSchema` validator declaring top-level `required` and `properties`
- WHEN `extract(scope)` runs
- THEN the collection's `extra` carries the top-level `required` list and `properties`
- AND nested validator structure beyond the top level is NOT walked

#### Scenario: A collection without a validator carries no validator metadata

- GIVEN a collection with no `$jsonSchema` validator
- WHEN `extract(scope)` runs
- THEN the collection is present and carries no validator metadata (absence is not an error)

### Requirement: Inferred relationships are produced with confidence inferred and a score

The mongodb extraction path SHALL be consumed with the SHIPPED `inferReferences` engine ON, so that
`<entity>_id` field names produce `inferred_reference` edges to the target collection's `_id` field
(US-030; US-008). Each such edge MUST carry `kind: 'inferred_reference'`, `confidence: 'inferred'` and
a numeric `score`; its endpoints MUST be the SOURCE `field` node and the target collection's `_id`
`field` node (column-grain endpoints). Inference is AUTOMATICALLY triggered by the presence of a
`collection`/`field` node. These are the ONLY relationships MongoDB produces — there are no declared
foreign keys.

#### Scenario: orders.customer_id infers a reference to customers._id

- GIVEN sampled `collection` nodes `orders` (with a `customer_id` field) and `customers` (with an `_id` field) of compatible type
- WHEN the mongodb path runs with inference ON
- THEN an `inferred_reference` edge exists from the `orders.customer_id` field node to the `customers._id` field node
- AND it carries `confidence: 'inferred'` and a numeric `score`
- AND no declared `references` edge is produced for MongoDB

#### Scenario: Inference fires automatically from the presence of a collection/field node

- GIVEN a `RawCatalog` containing `collection` and `field` nodes and no declared references
- WHEN the pipeline runs
- THEN `inferReferences` is triggered automatically (the collection/field node alone enables it)
- AND any emitted relationship is an `inferred_reference` with a score (never a `parsed` or `declared` edge)

### Requirement: Truthful MongoDB CapabilityMatrix

The mongodb adapter's `CapabilityMatrix` (`MONGODB_CAPABILITIES`) SHALL truthfully report that MongoDB
supports `collection`, `field` and `index`, and SHALL report `table`, `column`, `constraint`, `view`,
`procedure`, `function`, `trigger` and `sequence` as UNSUPPORTED, with `supportsBodies: false` and
`supportsDependencyHints: false` (US-030; E5 common criterion). The adapter MUST NOT emit any object of
a type its matrix declares unsupported, and 100% of the matrix MUST be exercised by the torture dataset.

#### Scenario: Matrix declares collection, field and index supported and the SQL types unsupported

- GIVEN `MONGODB_CAPABILITIES`
- WHEN the supported types are queried
- THEN `collection`, `field` and `index` are reported SUPPORTED
- AND `table`, `column`, `constraint`, `view`, `procedure`, `function`, `trigger` and `sequence` are reported UNSUPPORTED

#### Scenario: Matrix reports supportsBodies false and supportsDependencyHints false

- GIVEN `MONGODB_CAPABILITIES`
- WHEN `supportsBodies` and `supportsDependencyHints` are read
- THEN both are `false` (no bodies to tokenize; no catalog dependency hints — relationships are inferred only)

### Requirement: Connectivity via a URI reference, database and optional sampleSize and tls

The mongodb adapter SHALL connect via the `mongodb` driver using a connection URI, a target database
and an optional `sampleSize?` (default `100`) and optional `tls?` (US-030). The URI MUST be supplied by
reference as `${env:VAR}` (env-only, never a literal in config — US-032 alignment) because it may embed
credentials. There is NO `schema?` field — the connected database is the extraction scope. When the
database is unreachable or authentication fails, the adapter MUST reject with the existing typed
`ConnectionError` carrying an actionable message — it MUST NOT surface an opaque driver error.

#### Scenario: Connects with a URI reference and default sample size

- GIVEN a mongodb config with a `${env:VAR}` URI and a database and no `sampleSize`
- WHEN `connect()` is called
- THEN it establishes a usable connection and `extract` samples with the default size `100`

#### Scenario: URI must be supplied by env reference, not a literal

- GIVEN a mongodb config whose URI is a literal string rather than `${env:VAR}`
- WHEN the config is parsed
- THEN it is rejected (the URI must be an `${env:VAR}` reference, env-only)

#### Scenario: Authentication failure raises an actionable ConnectionError

- GIVEN a mongodb config with invalid credentials in its URI
- WHEN `connect()` is called
- THEN it SHALL reject with the typed `ConnectionError`
- AND the message is actionable and does NOT surface an opaque driver error

### Requirement: fingerprint via dbStats stable on data-only changes

The mongodb adapter's `fingerprint()` SHALL derive a drift fingerprint from `dbStats`, hashing the
`collections`, `indexes` and `objects` counts with SHA-256 (US-009; E5 common criterion). It MUST NOT
walk every document. The fingerprint MUST CHANGE when collection or index DDL changes (a collection or
index is created or dropped) and MUST remain STABLE across data-only changes that do not alter the
collection or index set.

#### Scenario: fingerprint changes on collection or index DDL

- GIVEN a connected mongodb adapter with a computed fingerprint
- WHEN a collection or an index is created or dropped
- THEN a subsequent `fingerprint()` returns a different value

#### Scenario: fingerprint is stable across data-only changes

- GIVEN a connected mongodb adapter with a computed fingerprint
- WHEN only documents change (inserted/updated/deleted, no collection or index DDL)
- THEN a subsequent `fingerprint()` returns the same value

### Requirement: Read-only by construction — sampling and metadata reads only

The mongodb adapter SHALL issue read-only operations ONLY (`$sample`/`find`, `listCollections`,
`listIndexes` and read `command`s such as `dbStats`) and MUST NOT issue any write or admin-mutating
operation through its connection (US-031). The read-only posture is enforced by the minimal-privilege
role below plus the existing engines write-verb scanner over `src/adapters/engines/**`; the mongodb
adapter MUST NOT introduce code that fails that scan.

#### Scenario: Adapter issues only read operations

- GIVEN the mongodb adapter connected to a source database
- WHEN it extracts or fingerprints
- THEN every operation it issues is read-only (`$sample`/`find`, `listCollections`, `listIndexes`, read `command`)
- AND no insert/update/delete/admin-mutating operation is issued

#### Scenario: mongodb adapter passes the engines write-verb scanner

- GIVEN the mongodb adapter source under `src/adapters/engines/mongodb/**`
- WHEN the existing engines write-verb scanner runs
- THEN it finds no executable write operation in the adapter
- AND the scan passes

### Requirement: Minimal read-only role documented with actionable PermissionError

The repository SHALL ship `docs/permissions/mongodb.md` containing a MINIMAL read-only role granting
only what sampling-based metadata extraction needs (`read` on the target database) and MUST NOT require
write or admin grants (US-033). When the connected role lacks a privilege required at runtime, the
adapter SHALL reject with the existing typed `PermissionError`; the message MUST be actionable — it MUST
name the missing privilege and MUST point to `docs/permissions/mongodb.md` — and the adapter MUST NOT
degrade to a partial or silent catalog.

#### Scenario: Permission doc ships the minimal read-only role

- GIVEN the repository
- WHEN `docs/permissions/mongodb.md` is inspected
- THEN it contains a role granting only `read` on the target database
- AND it does NOT require write or admin grants

#### Scenario: Missing privilege yields a typed, actionable PermissionError

- GIVEN a role WITHOUT a privilege required to sample or read metadata
- WHEN `extract(scope)` attempts to read
- THEN it SHALL reject with the typed `PermissionError`
- AND the message names the missing privilege and links to `docs/permissions/mongodb.md`
- AND the adapter does NOT return a partial or silent catalog

### Requirement: Missing mongodb driver names the install command

Because `mongodb` is an optional dependency loaded via a dynamic `import()` (ADR-006), when the package
is absent the adapter factory SHALL fail with an error whose message contains the exact install command
(`npm i mongodb`), per the schema-extraction port contract and the E5 common criterion.

#### Scenario: Absent mongodb driver names npm i mongodb

- GIVEN the `mongodb` package is not installed
- WHEN the adapter attempts to load it via dynamic import
- THEN the raised error message MUST contain the exact `npm i mongodb` command

### Requirement: Committed torture dataset materialized via gated Testcontainers

The repository SHALL provide a committed, FIXED MongoDB torture dataset (a reviewable plain-text seed
under `test/fixtures/mongodb/`) that exercises 100% of the MongoDB capability matrix and, at minimum: a
field present in every document, a field present in only some documents, a mixed-BSON-type field, a
nested sub-document, an array of sub-documents, a unique index, a compound index, a `$jsonSchema`
validator, and an `<entity>_id` field that infers a reference to a target collection's `_id` (US-030).
The integration setup MUST materialize this seed into an ephemeral `mongo:7` Testcontainers instance,
sampling with `$sample(size ≥ doc_count)` so the sample is the full dataset. Integration tests are
GATED by `DBGRAPH_INTEGRATION=1` (NOT mere Docker presence) and MUST skip-with-reason when not set, so
the unit matrix never runs containers.

#### Scenario: Fixture is a reviewable seed exercising the required torture objects

- GIVEN the mongodb torture dataset in the repository
- WHEN the committed artifact is inspected
- THEN it is a plain-text reviewable seed (not a binary database dump)
- AND it contains an always-present field, a sometimes-present field, a mixed-type field, a nested sub-document, an array of sub-documents, a unique index, a compound index, a `$jsonSchema` validator and an `<entity>_id` reference field
- AND 100% of the MongoDB capability matrix is exercised

#### Scenario: Integration setup uses an ephemeral container and skips without DBGRAPH_INTEGRATION

- GIVEN the mongodb integration test
- WHEN `DBGRAPH_INTEGRATION=1` is set and Docker is available
- THEN setup materializes the seed into an ephemeral `mongo:7` Testcontainers instance and samples with `$sample(size ≥ doc_count)`
- AND WHEN `DBGRAPH_INTEGRATION` is not set the integration test is skipped with an explicit reason (the unit matrix never runs containers)

### Requirement: Golden-pinned RawCatalog and end-to-end pipeline with inferred edges

There SHALL be a deterministic golden test pinning the `RawCatalog` extracted from the fixed torture
dataset: serialized via the existing `stableStringify`, it MUST be byte-identical across runs (ADR-008),
which is achievable because the dataset is FIXED and `$sample(size ≥ doc_count)`. There SHALL ALSO be an
end-to-end test driving the full pipeline — seed → materialize → adapter `extract` → `normalizeCatalog`
(with inference ON) → `SqliteGraphStore` upsert → query — whose `inferred_reference` edges are pinned by
BOTH endpoints and count (L-009). Asserting only that an edge exists is insufficient; the golden MUST
pin the exact source and destination field qnames AND the edge count. The mongodb CI job
(`mongodb-integration`, `DBGRAPH_INTEGRATION=1`) MUST be gated and MUST NOT block the unit matrix.

#### Scenario: RawCatalog golden is deterministic and byte-identical

- GIVEN the materialized fixed torture dataset
- WHEN the adapter `extract` output is serialized via `stableStringify`
- THEN it matches the golden `RawCatalog` file
- AND a second extraction on the same fixture with `$sample(size ≥ doc_count)` produces byte-identical output (ADR-008)

#### Scenario: Pipeline pins inferred edges by exact endpoints and count

- GIVEN the materialized torture dataset
- WHEN the pipeline runs extract → `normalizeCatalog` (inference ON) → `SqliteGraphStore` upsert → query
- THEN the `inferred_reference` edge from `orders.customer_id` to `customers._id` is asserted by BOTH endpoint qnames
- AND the total inferred-edge count is pinned (existence-only assertions are insufficient — L-009)

#### Scenario: mongodb CI job is gated and never blocks the unit matrix

- GIVEN the `mongodb-integration` job in CI
- WHEN the unit matrix runs
- THEN it does NOT depend on the gated `mongodb-integration` job
- AND the `mongodb-integration` job uses only an ephemeral `mongo:7` container
