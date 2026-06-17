---
name: dbgraph-security
description: Security rules for dbgraph. Trigger - touching adapters, connection handling, configuration, or dependencies. Enforces read-only by construction, env-only secrets, and the closed dependency list.
---

# dbgraph security

## Read-only by construction — THE core guarantee

- Adapters emit ONLY catalog/system-view SELECT queries. No INSERT/UPDATE/DELETE/ALTER/CREATE/
  DROP/TRUNCATE/MERGE, no non-catalog EXEC. A repo test scans all embedded adapter SQL for
  write verbs and FAILS the build on a hit.
- No public API of core or adapters accepts or builds DDL/DML. Integration tests run with a
  user that CANNOT write — a write attempt fails the test by permission.

## Secrets

- Connection strings only by reference: `${env:VAR}`. The config writer REJECTS plaintext
  credentials. Resolution happens in memory at connect time only.
- No log line ever prints a resolved URL (test the connection-error path for leaks).
- `init` adds `.dbgraph/` to `.gitignore` always — the schema itself is sensitive information.

## Data

- MongoDB sampling persists ONLY keys and observed types; values are discarded in memory.
  A test asserts no fixture values appear in the resulting index file.
- Statistics/sampling are opt-in (`off` by default) — see ADR-003.

## Dependencies (ADR-007)

- Closed canonical list: `mssql`, `pg`, `mysql2`, `mongodb`, `better-sqlite3`,
  `@modelcontextprotocol/sdk`, plus dev toolchain. Official npm registry only.
- Any NEW dependency requires written justification in the PR and a lockfile diff review.
