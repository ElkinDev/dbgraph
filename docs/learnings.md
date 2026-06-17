# Learnings — append-only log

Every agent (human or AI) that discovers a gotcha, a bug with its root cause, or unexpected
behavior records it HERE before closing their task. Recurring learnings get PROMOTED into the
skills under `.claude/skills/` so no future agent repeats the mistake.

Entry format:

```
## YYYY-MM-DD — <short title>
- **Context:** what was being done
- **What failed / what surprised us:**
- **Root cause:**
- **Derived rule:** (if any — skill candidate)
```

---

## 2026-06-11 — Golden file line endings on Windows (JSON, git CRLF warning)
- **Context:** Task 4.1 — writing golden JSON files from `normalizeCatalog` output on Windows.
- **What surprised us:** Git warns "LF will be replaced by CRLF" when staging JSON files, raising concern that the golden assertion (file vs `JSON.stringify`) would fail on the second run.
- **Root cause:** Git converts LF→CRLF in the object store but does NOT rewrite the working tree file unless `.gitattributes` forces it. Node.js `readFileSync` reads raw bytes; `JSON.stringify` always emits LF. Verified: 0 CR bytes in golden files on disk after commit.
- **Derived rule:** Do not add `*.json text eol=lf` to `.gitattributes` preemptively — it would churn `package-lock.json`. Only add it if golden tests start failing due to line-ending mismatch.
- **Outcome (2026-06-12):** The predicted failure materialized on GitHub windows-latest runners (fresh checkout with `core.autocrlf=true` → goldens materialized as CRLF → 6 byte-comparison failures). Fixed with repo-wide `.gitattributes` (`* text=auto eol=lf`, `*.db -text`); renormalization produced ZERO blob churn (everything was already LF in the object store — the churn fear was unfounded). Reproduced and proven locally with `git clone --config core.autocrlf=true` before/after. Rule PROMOTED to the `dbgraph-testing` skill.

## 2026-06-16 — Vitest 10s default hookTimeout too tight for native-module cold starts (CI flake)
- **Context:** CI run on commit 79cba3e — `test (windows-latest, 22.x)` failed with "Hook timed out in 10000ms" in `test/adapters/engines/sqlite/factory.test.ts > SqliteSchemaAdapter lifecycle`. The very next commit (25dd62a, a superset) passed the same job — proving it FLAKY, not a regression.
- **Root cause:** the `beforeAll` hook calls `materializeTorture()` which, on the FIRST better-sqlite3 native-module load on a cold Windows runner, exceeded Vitest's default 10s hook timeout. Local runs (warm native module) never reproduce it.
- **Derived rule:** for a project with native DB drivers, set sane global ceilings in `vitest.config.ts` (`hookTimeout: 30000`, `testTimeout: 15000`) — high enough to absorb cold native/IO setup, low enough to still catch a genuine hang. Container-backed integration suites set their OWN per-suite timeouts (SQL Server startup is 20-40s — the default would guarantee failure). NEVER diagnose a CI-only flake from local runs alone; pull the failed job log via `gh run view <id> --log-failed` (token: Actions:read).

## 2026-06-11 — exactOptionalPropertyTypes: spread-conditional for optional fields
- **Context:** Task 3.4 / 4.x — passing `obj.body` (type `string | undefined`) to `applyLevel({ body?: string })`.
- **What failed:** `exactOptionalPropertyTypes: true` treats `field?: T` and `field: T | undefined` as distinct. Passing `{ body: obj.body }` where `obj.body: string | undefined` is a type error.
- **Root cause:** The distinction is intentional — absent property vs present-but-undefined are semantically different under strict optional property checking.
- **Derived rule:** Use conditional spread: `...(obj.body !== undefined ? { body: obj.body } : {})`. This produces a present-string property or no property at all, matching `field?: string` exactly.

## 2026-06-12 — FTS5 ON CONFLICT not supported; use delete+reinsert for upserts
- **Context:** Task 5.2/5.3 — upserting FTS5 rows in `nodes_fts` alongside regular nodes.
- **What failed:** FTS5 virtual tables do not support `ON CONFLICT` or `INSERT OR REPLACE` — SQLite raises "table nodes_fts may not be modified" errors on conflicting inserts.
- **Root cause:** FTS5 is a virtual table with its own internal shadow tables; SQLite's built-in conflict handling does not apply to it.
- **Derived rule:** For FTS upserts: always `DELETE FROM nodes_fts WHERE id = @id` first, then `INSERT INTO nodes_fts ...`. Wrap both in a transaction with the main node upsert.

## 2026-06-12 — Import assertions (`assert`) deprecated in TS 6 / NodeNext; use `with`
- **Context:** Task 5.2–5.4 test file — importing JSON fixtures via `assert { type: 'json' }`.
- **What failed:** `tsc --noEmit` reports "Import assertions have been replaced by import attributes. Use 'with' instead of 'assert'." (TS 2880).
- **Root cause:** TypeScript 6 follows the finalized TC39 import attributes spec; `assert` was a Stage-2 proposal keyword that was replaced by `with` before standardization.
- **Derived rule:** Always use `import X from '...' with { type: 'json' }` for JSON imports (not `assert`). This project uses TypeScript 6.

## 2026-06-12 — NeighborGroups index signature requires explicit null-assertions in tests
- **Context:** Task 6.1 neighbors.ts — `NeighborGroups` is typed `{ [kind: string]: { out, in } }`.
- **What surprised us:** TypeScript treats index-signature access as `T | undefined`, requiring `!` assertions even after an `expect(x).toBeDefined()` narrowing — vitest's `expect` does not narrow TypeScript's type control flow.
- **Root cause:** TS control-flow analysis does not understand vitest's `expect(x).toBeDefined()` as a type guard.
- **Derived rule:** After `expect(x).toBeDefined()`, use `x!.field` in the same test body. This is idiomatic and correct; the assertion failure makes the `!` safe at runtime.

## 2026-06-12 — `fileURLToPath` required for Windows-safe ESM path resolution
- **Context:** Task 7.2 — boundary test needed to resolve project root from `import.meta.url`.
- **What failed:** `resolve(new URL(import.meta.url).pathname, '../../..')` doubles the drive letter on Windows (produces `C:\C:\Users\...`).
- **Root cause:** `URL.pathname` on Windows returns `/C:/Users/...` (with leading slash). `path.resolve` then prefixes the current drive letter, doubling it.
- **Derived rule:** Always use `fileURLToPath(import.meta.url)` from `node:url` to get a proper OS-native path from an ESM `import.meta.url`. Never use `new URL().pathname` directly for file system operations on Windows.

## 2026-06-12 — NormalizationResult shape change requires golden regeneration

- **Context:** W-1 remediation — adding `omitted: readonly OmittedKindInfo[]` field to `NormalizationResult`.
- **What surprised us:** Existing golden files did not include `omitted` (the field didn't exist when they were written). Adding a new top-level field to a type that is fully serialized by goldens breaks all golden assertions.
- **Root cause:** Golden files capture `JSON.stringify(result, null, 2)` — the full object. Any structural addition to the result type appears in the serialized output and breaks byte-identity with the old golden.
- **Derived rule:** When a result type gains a new field, delete and regenerate all affected goldens atomically in the same commit. Include an explicit statement in the commit message that the regeneration was intentional (not an accidental golden change).

## 2026-06-12 — NodeKind values vs ObjectTypeLevels keys are not 1:1

- **Context:** W-1 `buildOmittedKinds()` — mapping `scope.levels.indexes` (off) to NodeKind `'index'`.
- **What surprised us:** `ObjectTypeLevels` keys use plural nouns (`tables`, `indexes`, `procedures`) while `NodeKind` values use singular nouns (`table`, `index`, `procedure`). `statistics` and `sampling` have no corresponding `NodeKind` at all.
- **Root cause:** The level config is per-object-type-category (a configuration concept); NodeKind is a graph domain type. They intentionally use different naming conventions.
- **Derived rule:** Maintain an explicit mapping table when bridging `ObjectTypeLevels` keys to `NodeKind` values. Do not assume a simple toLowerCase/singularize transform will work.

## 2026-06-11 — ESLint no-unused-vars does not honor _ prefix without explicit config
- **Context:** Task 4.x — `resolveOrStub` had a `_warnings: string[]` parameter reserved for future use.
- **What failed:** `@typescript-eslint/no-unused-vars` does not suppress `_`-prefixed args by default; `argsIgnorePattern` is not configured in this project.
- **Root cause:** The default rule config does not include an args ignore pattern.
- **Derived rule:** Remove truly unused parameters rather than prefixing with `_`. If future use is anticipated, add a TODO comment and the `argsIgnorePattern` config entry. Do not rely on `_` prefix alone.

## 2026-06-12 — SQLite PRAGMA index_list origin='c' vs origin='u' (UNIQUE index semantics)

- **Context:** Task 4.4 — `extractUniqueConstraints()` filtering by `origin='u'` caused a test failure.
- **What failed:** `CREATE UNIQUE INDEX idx_emp_email ON employees(email)` has `origin='c'` (created), NOT `origin='u'`. The test expected the named index to appear as a UNIQUE constraint but it was filtered out.
- **Root cause:** `origin='u'` in PRAGMA index_list means the index was auto-created by an INLINE `UNIQUE` constraint in the CREATE TABLE DDL — these always have names like `sqlite_autoindex_*`. `origin='c'` means an explicit `CREATE UNIQUE INDEX` statement. The design used `origin='u'` as the filter criterion, which is incorrect for user-named UNIQUE indexes.
- **Derived rule:** To emit user-named UNIQUE indexes as RawConstraint{type:'UNIQUE'}, filter on `unique=1 AND NOT autoindex name` (regardless of origin). Skip `sqlite_autoindex_*` names for both the index object and any constraint derived from it.

## 2026-06-12 — NodeKind includes 'database' but DEFAULT_LEVELS and CapabilityMatrix omit it

- **Context:** Task 4.7 — KIND_RANK Record<NodeKind, number> must cover all NodeKind values including 'database'.
- **What failed:** tsc error: Property 'database' is missing in type '{ schema: number; table: number; ... }'.
- **Root cause:** NodeKind = 'database' | 'schema' | ... but ObjectTypeLevels keys and SQLite capabilities do not include 'database' (SQLite has no database-level objects in the catalog). The Record<NodeKind, number> mapping must still include it.
- **Derived rule:** When creating a Record<NodeKind, V> map, include ALL NodeKind values even those irrelevant to the current adapter. Assign them a rank/value that places them outside the normal range (e.g., rank 0 for 'database' in KIND_RANK so it sorts first if it ever appears).

## 2026-06-12 — better-sqlite3 defers database header validation until first query

- **Context:** Task 5.1 — factory error mapping for corrupt/non-SQLite files.
- **What failed:** `new Database(file, { readonly: true, fileMustExist: true })` succeeds even for files that are NOT valid SQLite databases. The error only surfaces on the first `prepare(...).all()` call.
- **Root cause:** better-sqlite3 binds the file descriptor at construction but defers the SQLite header check until the first statement execution.
- **Derived rule:** After opening a database with better-sqlite3, always issue a cheap validation query (`PRAGMA schema_version`) before returning the handle to the caller. Wrap BOTH the open AND the validation in the same try/catch to produce a single, correctly classified error.

## 2026-06-12 — node:sqlite `readOnly` option vs `SQLITE_OPEN_READONLY` flag (Node 22.5+)

- **Context:** Task 5.1 — `openWithNodeSqlite` setting read-only flags.
- **What discovered:** The documented Node 22.5 API for `node:sqlite` uses `{ readOnly: true }` as the options key (camelCase). The TypeScript types for node:sqlite are not available as a normal `@types/` package — the module is declared in `@types/node` for Node >= 22. Since we cannot use a static type import without conditional compilation, we type the constructor as `unknown` and cast.
- **Derived rule:** For node:sqlite, use `{ readOnly: true }` (camelCase). Type the `DatabaseSync` constructor as `unknown` and cast to a local interface to avoid importing node:sqlite types that may not be present on Node < 22.

## 2026-06-12 — Write-verb scanner must use SQL-indicator filter to avoid false positives on TypeScript string literals

- **Context:** Task 7.1 — security scanner flagged `events.add('DELETE')` in map.ts.
- **What failed:** `'DELETE'` is a valid TypeScript string literal (trigger event enum value), NOT a SQL query. The scanner's raw word-boundary check on all string literals flagged it.
- **Root cause:** TypeScript source files mix SQL string constants with non-SQL string values. A word-boundary regex alone cannot distinguish `'DELETE'` (enum value) from `"DELETE FROM ..."` (SQL query).
- **Derived rule:** Before applying the write-verb regex, check that the literal contains at least one SQL structural keyword (SELECT, FROM, WHERE, PRAGMA, INTO, VALUES, etc.). Single-word or non-SQL strings pass through. This eliminates false positives from enum/union string values while preserving detection of actual SQL write verbs.

## 2026-06-12 — ReadonlyDriver.all() returns readonly — double-cast needed for internal row types

- **Context:** Tasks 4.2–4.7 — casting `readonly Record<string, unknown>[]` to internal PRAGMA row types.
- **What failed:** tsc error: The type 'readonly Record<string, unknown>[]' is 'readonly' and cannot be assigned to the mutable type 'MasterRow[]' even with `as MasterRow[]`.
- **Root cause:** `ReadonlyDriver.all()` returns `readonly Record<string,unknown>[]`. Direct `as InternalType[]` fails because the readonly modifier conflicts with mutable array. TypeScript requires going through `unknown` first.
- **Derived rule:** For PRAGMA/query result casts in adapter code, always use `as unknown as TargetType[]` — NOT `as TargetType[]` directly. This is the L-002 pattern (double-cast through unknown for readonly→mutable).

## 2026-06-12 — CI matrix carried an EOL Node version; ABI-mismatch false signal when reproducing
- **Context:** CI jobs on Node 20.x (ubuntu+windows) failed after the phase-2 batches landed; Node 22.x jobs were green.
- **What surprised us:** Local reproduction with `npx node@20 node_modules/vitest/vitest.mjs run` failed with `better_sqlite3.node was compiled against a different Node.js version` — a FALSE signal: node_modules was installed under Node 22, so the native ABI cannot be shared across majors. Running the suite under a different Node major than the one that installed node_modules proves nothing about CI (CI does a fresh `npm ci` per job).
- **Root cause (decision-level):** Node 20 reached end-of-life on 2026-04-30. A pre-v0.1 project spending CI capacity on an EOL runtime is a matrix design error regardless of the specific failure.
- **Derived rule:** (1) The CI matrix tracks SUPPORTED LTS lines only — review it when Node lines change status (next: Node 22 EOL April 2027). (2) Never run the test suite under a Node major different from the one that installed node_modules — native modules give ABI false signals; reproduce with a fresh install under the target major instead. (3) `engines.node` and the CI matrix must move together.

## 2026-06-12 — Batch C remediation: vi.mock hoist intercepts dynamic import in ESM

- **Context:** W-1: factory.ts uses `await import('better-sqlite3')` inside a try/catch. Testing the MODULE_NOT_FOUND path requires making that import throw without modifying source.
- **What worked:** `vi.mock('better-sqlite3', factory)` in a dedicated test file. Vitest hoists vi.mock calls to the top of the module graph; the factory function runs before any import in the file. The throwing factory propagates as if the module does not exist. Isolated to its own file to avoid contaminating tests in the same suite that need the real better-sqlite3.
- **Derived rule:** For dynamic import failure paths in ESM, use a separate test file with `vi.mock` throwing in its factory. Shared test files must not carry module-level mocks unless all tests in that file need them.

## 2026-06-12 — Batch C remediation: vi.spyOn module export requires MockInstance<() => T> type

- **Context:** S-2: spying on `isNodeSqliteAvailable` (exported function) from the driver module. `vi.spyOn` return type is generic; tsc rejects the old two-argument `MockInstance<Args, Return>` form in Vitest 4.x.
- **What worked:** `MockInstance<() => boolean>` — single type argument that is the function signature. The constraint is `Procedure | Constructable`, and `() => boolean` satisfies `Procedure`.
- **Derived rule:** When typing a spy in Vitest 4.x, use `MockInstance<() => ReturnType>` for zero-arg functions. Check `@vitest/spy` dist types if in doubt — the interface is `MockInstance<T extends Procedure | Constructable>`.

## 2026-06-16 — US-031 scanner false-positive on JSDoc apostrophes (L-003)

- **Context:** Task 2.3 — tokenizer.ts JSDoc comments described write-verb patterns using apostrophes (e.g. "the table's qualified name").
- **What failed:** The US-031 scanner single-quote regex matched the apostrophe in possessive phrases and extracted the subsequent comment text as a SQL string literal. That text contained write-verb names from the comment (INSERT, UPDATE, etc.), triggering a false violation.
- **Root cause:** The scanner extracts ALL single-quoted content, including apostrophes in possessive phrases within JSDoc. The SQL-indicator filter applies AFTER extraction, and the comment text passed the filter because it contained SQL-like keywords from the pattern descriptions.
- **Derived rule (L-003):** Avoid apostrophes/possessives in JSDoc comments of files under src/adapters/engines/**. Write "the target qualified name" not "the target's qualified name". Use dashes or rephrasing instead.

## 2026-06-16 — RawColumn has no extra field — computed column via intersection (L-004)

- **Context:** Task 2.4 — mssql map.ts surfaces computed column info as column-level metadata.
- **What was discovered:** `RawColumn` in core/model/catalog.ts has no `extra` field. Adding extra to `RawColumn` directly would violate YAGNI and require changing the core model.
- **Solution:** Use a TypeScript intersection `RawColumn & { extra?: Readonly<Record<string, unknown>> }` at the adapter boundary. Tests cast via `as unknown as { extra?: Record<string, unknown> }`. The extra property passes through as an intersection property; the normalizer ignores unknown fields.
- **Derived rule (L-004):** Do not add `extra` to `RawColumn` in core. Adapter-local column extensions use intersection types at the adapter boundary. Same pattern applies to `RawIndex` (which also lacks `extra` in the core model).

## 2026-06-12 — Batch C remediation: golden regeneration discipline (S-1)

- **Context:** Adding a trigger to torture.sql changes the RawCatalog object count (13→14) and the E2E golden (53→54 nodes). The golden-freeze test immediately fails with a diff showing the count delta.
- **Process that worked:** (1) Add the fixture change, (2) run tests to CONFIRM RED (golden mismatch), (3) delete both goldens, (4) run both golden tests to reseed, (5) run a SECOND time to confirm deterministic, (6) commit all four changed files (torture.sql + two goldens + new tests) in a single atomic commit.
- **Derived rule:** Golden regeneration MUST be atomic — fixture change, golden files, and new tests land in the same commit. Never commit a fixture change without the regenerated goldens in the same commit; it leaves the repo in a RED state.

## 2026-06-16 — SQL Server: CREATE/ALTER PROC/FUNC/TRIGGER must be first statement in batch (L-006)

- **Context:** Task 4.2 / Batch C — `applyTortureSql` sent the entire torture.sql as a single batch to SQL Server via mssql.
- **What failed:** `RequestError: 'CREATE/ALTER PROCEDURE' must be the first statement in a query batch.` All integration tests in beforeAll failed.
- **Root cause:** SQL Server requires CREATE PROCEDURE, CREATE FUNCTION, CREATE TRIGGER, and CREATE VIEW to each be the FIRST statement in their query batch. Sending all DDL in one go (or splitting on semicolons) is insufficient.
- **Solution:** Split on GO (the standard T-SQL batch separator) in the test harness. torture.sql must have GO between each module-creating statement.
- **Derived rule (L-006):** Every torture.sql for SQL Server must use GO as a batch separator between CREATE PROCEDURE / CREATE TRIGGER / CREATE FUNCTION / CREATE VIEW statements. The test harness splits on `^\s*GO\s*$` (case-insensitive, line-anchored) and executes each batch separately.

## 2026-06-16 — SQL Server fingerprint: CREATE TABLE more reliable than ALTER TABLE for DDL test (L-007)

- **Context:** Task 4.4 — fingerprint DDL sensitivity test using ALTER TABLE ADD COLUMN.
- **What failed:** After ALTER TABLE dbo.regions ADD region_code, `sys.objects.modify_date` did not change within the same timestamp second, so fingerprint (sha256(MAX(modify_date)|COUNT(*))) stayed identical.
- **Root cause:** SQL Server's `modify_date` precision is datetime2 (~100ns) but the fingerprint was computed within the same second as the ALTER. Additionally, some ALTER TABLE operations may not update `modify_date` on the parent table in all SQL Server 2022 builds.
- **Solution:** Use CREATE TABLE (adds a new row → COUNT(*) increments deterministically) instead of ALTER TABLE for the DDL fingerprint test.
- **Derived rule (L-007):** When testing fingerprint DDL sensitivity against SQL Server, prefer operations that change COUNT(*) in sys.objects (CREATE/DROP object) over operations that only change modify_date (ALTER). COUNT change is sub-second reliable; modify_date change may race the fingerprint query.

## 2026-06-16 — L-008 RETRACTED: sys.sql_expression_dependencies DOES track trigger DML targets on SQL Server 2022

- **Context:** Task 4.5 / 4.3 originally recorded a "platform limitation" after observing that writes_to(trigger→audit_log) appeared unreliable during initial testing.
- **What the verifier proved (empirically, against the live container):** sys.sql_expression_dependencies DOES return trg_audit_order_update → audit_log with a RESOLVED referenced_id (non-null). The adapter's dep view IS complete for the torture schema. The writes_to(trigger→audit_log, confidence:parsed) edge IS emitted by the adapter correctly.
- **Root cause of the original false negative:** The platform limitation claim was made WITHOUT verifying it against the live system. The spec-mandated writes_to assertion was dropped to make the test pass — a false negative. The correct resolution was to verify the claim empirically FIRST, then decide.
- **What IS the real (narrower) boundary:** The tokenizer only RECLASSIFIES edges already returned by sys.sql_expression_dependencies (map.ts depMap.get). It does NOT discover write targets that the dep view omits. For the torture schema the dep view is complete, so this is not a gap today. If a future schema has a trigger whose DML target is absent from the dep view, the body text is available (extractWriteTargets exists in tokenizer.ts) — but that is a future enhancement (S-2 in the verify report), not a Phase-3 obligation.
- **Fix applied (Batch D):** (a) Removed the false platform limitation text above. (b) Restored the writes_to(trigger→audit_log, confidence:parsed) assertion in both extract.integration.test.ts and e2e.integration.test.ts. (c) Updated goldens atomically.
- **Derived rule (L-008, CORRECTED):** Do NOT invent platform limitations to excuse a dropped test assertion. Always verify empirically against the live system BEFORE concluding a dependency view has a gap. An existence-only check that drops a spec-mandated assertion IS a false negative regardless of confidence level. Verify claims; do not assume.

## 2026-06-16 — Edge/graph tests must assert BOTH endpoints, not mere existence (L-009)

- **Context:** Batch D remediation — C-1 (phantom trigger stub) passed CI green for an entire verify cycle because the fires_on test only checked `firesOnEdges.length >= 1`, never checking the destination.
- **What failed:** An existence-only edge assertion let a semantically wrong edge pass. The fires_on edge pointed to a phantom stub table named after the trigger (not the orders table it actually fires on). The golden files enshrined the wrong value. CI was green. The defect was only caught by the verifier probing the live container.
- **Root cause:** Testing that an edge EXISTS is not enough. An edge from A to the wrong B is structurally valid — it just carries the wrong semantics. Only an endpoint assertion (assert both src qname AND dst qname) catches this.
- **Fix pattern:** For every semantically critical edge kind (fires_on, writes_to, reads_from, references), the test MUST assert: (1) src node qname, (2) dst node qname, (3) that no wrong-target variant exists. Golden files serialize the whole graph and are necessary but NOT sufficient — add targeted endpoint assertions for every edge that matters.
- **Derived rule (L-009, PROMOTED to dbgraph-testing skill):** Edge/graph tests MUST assert endpoints (both src AND dst qnames), never mere existence. An existence-only assertion let a phantom-stub trigger target (C-1) pass green CI. Golden files that serialize the whole graph are necessary but not sufficient; add targeted endpoint assertions for every semantically critical edge (fires_on, writes_to, reads_from, references).

## 2026-06-17 — readline.question() fails with Readable.from() in test environments; use async iterator (L-010)
- **Context:** Task 3.1 — wizard.ts injecting a `Readable.from([...lines])` stream for unit tests.
- **What failed:** `readline.createInterface({ output: null })` fires `close` immediately (readline requires a writable output). Using `output: someWritable` with `terminal: false` also failed: `Readable.from()` emits ALL lines synchronously before any `rl.question()` callback is registered, causing immediate "readline was closed" error on the second question.
- **Root cause:** `Readable.from()` creates an async generator-backed stream that emits all buffered items in the same microtask burst. `readline.question()` relies on a future 'line' event that fires AFTER the callback is registered. But with `Readable.from`, all 'line' events fire before the first `question()` callback has a chance to queue.
- **Solution:** Use the async iterator API (`for await (const line of rl)` or `rl[Symbol.asyncIterator]()`) instead of `rl.question()`. The async iterator consumes lines lazily — one per iteration step — regardless of how quickly the underlying stream emits them. Create readline with `terminal: false` and a real (non-null) output writable. Write prompt labels manually via `outputWritable.write(label)` before each `nextLine()` call.
- **Derived rule (L-010):** For testable readline wizards: (1) use `readline.createInterface({ terminal: false, input, output })` — never `output: null`; (2) use the async iterator (`rl[Symbol.asyncIterator]()`) for sequential line reading; (3) write prompt labels to the output writable directly, NOT via `rl.question(label, ...)`. This pattern works with both real TTYs (non-null output is fine) and injected `Readable.from()` test streams.

## 2026-06-16 — mssql 12.x ships no bundled type declarations (L-005)
- **Context:** Task 3.3 — factory.ts uses `await import('mssql')` inside a try/catch. tsc reported TS7016 "Could not find a declaration file for module 'mssql'".
- **What failed:** `mssql@12.5.5` does not ship a `types` field in package.json and there is no `@types/mssql` package. Direct `await import('mssql') as SomeType` causes tsc error.
- **Root cause:** mssql 12.x removed bundled type declarations and no DefinitelyTyped package covers it.
- **Solution:** Cast through unknown: `await import('mssql' as string) as unknown as LocalDuckType`. The `as string` suppresses the static module resolution, `as unknown as` allows casting to our local duck-typed interface. Mirrors the `node:sqlite` pattern in sqlite/factory.ts.
- **Derived rule (L-005):** For optional dependencies without bundled types and no @types package, use `import('packageName' as string) as unknown as LocalInterface`. Define a minimal duck-typed local interface. Do NOT add @types packages just for optional deps.
