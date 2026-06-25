# E6 — Security

Goal: the project's public posture — verifiable by code, not by promises.
References: §4.9. Cross-cutting: these stories produce tests/gates that apply to the WHOLE repo.

---

### US-031 — Read-only by construction
**As** a database owner, **I want** a verifiable guarantee that dbgraph cannot write, **so that** I can connect it to real environments without fear.
**Phase:** cross-cutting (gate from Phase 2 on) · **Depends on:** US-026 · **Status:** ☐ partial (phase-2-sqlite-extraction; mssql confirmed in phase-3-sqlserver-adapter — scanner runs over engines/** and includes all mssql SQL files; all 8/8 scanner tests pass including mssql)

**Acceptance criteria:**
- No public API of core or adapters accepts or builds DDL/DML: a test scans ALL SQL embedded in adapters and fails on write verbs. ✓ (scanner implemented in `test/adapters/engines/security-scan.test.ts`; negative control probe verified; mongodb adapter confirmed in phase-9b-mongodb Batch 4 — `driver.ts`/`map.ts`/`sample-walk.ts` carry only `listCollections`/`$sample`/`find`/`listIndexes`/`command` read ops; scanner stays green)
- Integration tests run with a user WITHOUT write permissions: connection opened `{readonly:true, fileMustExist:true}`; write-through test verifies INSERT is rejected. ✓ (SQLite only — per-engine permission docs pending later engines)
- **MongoDB — values-never-persisted**: sampled document values are DISCARDED in memory after the type-merge pass; only the `Map<path,{types:Set<string>;count:number}>` accumulator survives. A DISCARD invariant test (Batch 4, phase-9b-mongodb) feeds a sentinel value and asserts it appears NOWHERE in the resulting `RawField[]`. ☑ (Batch 4, phase-9b-mongodb); integration sentinel assertion pending Batch 7.
- The README documents this guarantee and how to audit it. ☐ pending

_Note: scanner and readonly enforcement done in Phase 2 for SQLite. Per-engine permission documentation (`docs/permissions/sqlite.md` etc.) pending per-engine work in Phase 3+. README security documentation pending Phase 4._

### US-032 — Secrets by reference only
**As** a user, **I want** it to be IMPOSSIBLE to leave plaintext credentials in the config, **so that** I could even commit `.dbgraph/config.json` if I wanted to.
**Phase:** 4 · **Depends on:** US-001 · **Status:** ☐ pending

**Acceptance criteria:**
- The config writer rejects URLs with literal passwords (heuristic: credentials embedded in the URL that are not `${env:...}`), with a message teaching the correct form.
- `${env:VAR}` resolution happens in memory at connect time only; no log ever prints the resolved URL (no-leak test on the connection-error path).
- `.dbgraph/` is added to `.gitignore` by `init` even when the config has no secrets (the schema itself is sensitive).

### US-033 — Minimal permissions and actionable errors
**As** a user without DBA privileges, **I want** to know exactly which permission is missing and how to request it, **so that** I do not give up during installation.
**Phase:** 3 onwards (per adapter) · **Depends on:** US-027 · **Status:** ☐ partial (mssql + pg + mysql + mongodb permission docs done)

**Acceptance criteria:**
- For every supported engine there is a `docs/permissions/<engine>.md` with the MINIMAL read-only user script (no data access when statistics/sampling are off). ✓ mssql: `docs/permissions/mssql.md` created. ✓ pg: `docs/permissions/pg.md` created (phase-8a-pg). ✓ mysql: `docs/permissions/mysql.md` created (phase-8b-mysql). ✓ mongodb: `docs/permissions/mongodb.md` created (phase-9b-mongodb Batch 6) — minimal role is the built-in `read` role on the target database (`listCollections`/`find`/`listIndexes`/`dbStats`; no `clusterMonitor`; no write/admin grant).
- Given a missing catalog permission at runtime, the error names the permission, the object that required it, and links to the corresponding doc. ✓ mssql: error-mapper maps error 229 / "permission denied" → PermissionError with VIEW DEFINITION + docs link. ✓ pg: error-mapper maps SQLSTATE 42501 → PermissionError naming SELECT privilege + `docs/permissions/pg.md` link (phase-8a-pg). ✓ mysql: error-mapper maps errno 1044/1142/1143/1370 → PermissionError naming the privilege + `docs/permissions/mysql.md` link (phase-8b-mysql). ✓ mongodb: error-mapper maps MongoDB error code 13 / Unauthorized → PermissionError naming `listCollections, find, listIndexes, dbStats` privileges + `docs/permissions/mongodb.md` link (phase-9b-mongodb Batch 3; doc-link assertion in `test/adapters/engines/mongodb/error-mapper.test.ts`).
- Verified in integration: a user with minimal permissions extracts the full torture schema; one without `VIEW DEFINITION` (mssql) / `USAGE` (pg) / `SELECT` on `information_schema` (mysql) receives the expected actionable error. ☐ pending (integration with restricted user not yet added; full extraction under SA in torture tests passes; mongodb restricted-user integration pending Batch 7)
