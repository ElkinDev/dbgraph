# MySQL — Minimal Read-Only User

dbgraph extracts catalog metadata only. It issues `SELECT` queries over `information_schema`
and **never reads user-table data**. The permissions below reflect that:
a `SELECT` grant on `information_schema` is the only privilege needed to read object definitions,
view bodies (`VIEW_DEFINITION`), and routine bodies (`ROUTINE_DEFINITION`).

> **Note on routine and view body visibility**: `information_schema.VIEWS.VIEW_DEFINITION` and
> `information_schema.ROUTINES.ROUTINE_DEFINITION` are server-reparsed/normalized forms of the
> original DDL. Access to these columns requires that the executing user either owns the object
> OR has the `SHOW VIEW` / `SELECT` privilege on `information_schema`. Under the minimal grant
> below, view and routine bodies of objects owned by **other definers** may be `NULL` or truncated
> by the server's internal limit (`max_sp_recursion_depth`, `information_schema_stats_expiry`).
> The integration suite (Batch 7) validates the exact `mysql:8` row shapes and pins the golden.
> If bodies return `NULL` for objects you own, ensure the definer matches the connected user or
> run `SHOW CREATE VIEW` / `SHOW CREATE PROCEDURE` as a privileged user to inspect the DDL.

## What each grant does

| Permission | Scope | Why it is needed |
|-----------|-------|-----------------|
| `CREATE USER … IDENTIFIED BY` | Server | Creates the MySQL user (authentication principal) with an explicit password. |
| `GRANT SELECT ON information_schema.*` | Server | Lets the user read ALL `information_schema` virtual tables: `TABLES`, `COLUMNS`, `TABLE_CONSTRAINTS`, `KEY_COLUMN_USAGE`, `REFERENTIAL_CONSTRAINTS`, `CHECK_CONSTRAINTS`, `STATISTICS`, `VIEWS`, `ROUTINES`, `TRIGGERS`. Without this, catalog queries return empty results or raise error 1044/1142. |

`SELECT` on `information_schema` is a **metadata-only** privilege. It does **not** allow reading
user-table rows (DML access requires `SELECT` on the target user schema, not `information_schema`).
`information_schema` itself is a virtual read-only system schema — no DDL is possible.

## Minimal user script

Run this once as a user with `CREATE USER` and `GRANT OPTION` privileges on the target server:

```sql
-- ── Step 1: Create the server-level user ──────────────────────────────────────
-- Replace <StrongPassword!123> with a password that meets your security policy.
-- Replace 'dbgraph_reader'@'%' with the appropriate host restriction if needed.
CREATE USER 'dbgraph_reader'@'%' IDENTIFIED BY '<StrongPassword!123>';

-- ── Step 2: Grant catalog read access ────────────────────────────────────────
-- information_schema is a server-provided virtual schema; this SELECT grant
-- covers ALL tables in it (TABLES, COLUMNS, STATISTICS, VIEWS, ROUTINES,
-- TRIGGERS, TABLE_CONSTRAINTS, KEY_COLUMN_USAGE, REFERENTIAL_CONSTRAINTS,
-- CHECK_CONSTRAINTS, etc.).
GRANT SELECT ON information_schema.* TO 'dbgraph_reader'@'%';

-- ── No other grants are required. ────────────────────────────────────────────
-- NO SELECT on user tables — catalog metadata only.
-- NO INSERT, UPDATE, DELETE, CREATE, DROP, or any write privilege.
-- NO SUPER, PROCESS, REPLICATION, or any elevated attribute.
FLUSH PRIVILEGES;
```

This user is sufficient to extract the **full torture schema** (catalog metadata only).
dbgraph reads `information_schema.TABLES`, `COLUMNS`, `TABLE_CONSTRAINTS`,
`KEY_COLUMN_USAGE`, `REFERENTIAL_CONSTRAINTS`, `CHECK_CONSTRAINTS`, `STATISTICS`,
`VIEWS`, `ROUTINES`, and `TRIGGERS` — all virtual tables readable via the `SELECT` grant above.

## How to verify the grant set

```sql
-- Run as a privileged user on the target server
SHOW GRANTS FOR 'dbgraph_reader'@'%';
-- Expected: GRANT SELECT ON `information_schema`.* TO `dbgraph_reader`@`%`

-- Verify the user can connect and query the catalog
SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE();
-- Expected: a non-negative integer (0 if the connected database is empty)

-- Verify catalog privilege directly
SELECT HAS_TABLE_PRIVILEGE('dbgraph_reader', 'information_schema.TABLES', 'SELECT');
-- Expected: 1
```

## How to revoke access

```sql
-- Revoke the catalog grant
REVOKE SELECT ON information_schema.* FROM 'dbgraph_reader'@'%';

-- Drop the user once all privileges are revoked
DROP USER 'dbgraph_reader'@'%';

FLUSH PRIVILEGES;
```

## Production TLS guidance

For production environments (outside Testcontainers / local dev):

- Set `ssl: true` in `MysqlAdapterConfig` to require an encrypted connection.
- Configure `require_secure_transport = ON` on the server and install a CA-signed certificate.
- Do NOT set `ssl: false` in production — plaintext connections expose credentials to
  network interception.
- Rotate the `dbgraph_reader` password regularly. Avoid embedding it in source
  control; use a secrets manager and reference it as `${env:DBGRAPH_MYSQL_PASSWORD}` in
  `.dbgraph/config.json` (see US-032).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `PermissionError: MySQL permission denied: user lacks access to the database …` | User denied access to the database (errno 1044). | Run `GRANT SELECT ON information_schema.* TO 'dbgraph_reader'@'%';` and `FLUSH PRIVILEGES;`. |
| `PermissionError: MySQL permission denied: missing SELECT privilege on the required catalog table …` | User lacks SELECT on a specific `information_schema` table (errno 1142). | Confirm the `GRANT SELECT ON information_schema.*` grant was applied and flushed. |
| `PermissionError: MySQL permission denied: missing column-level privilege …` | Column-level restriction on a catalog table (errno 1143). | Grant SELECT at the table level (`information_schema.*`), not column level. |
| `PermissionError: MySQL permission denied: missing EXECUTE or catalog privilege on a routine …` | Missing access to `information_schema.ROUTINES` (errno 1370). | Re-apply `GRANT SELECT ON information_schema.* TO 'dbgraph_reader'@'%';`. |
| `ConnectionError: MySQL authentication failed` | Wrong password or user does not exist. | Check the user name, password, and host in `MysqlAdapterConfig`. |
| `ConnectionError: MySQL database not found` | The database in `MysqlAdapterConfig` does not exist. | Verify `database` matches an existing MySQL database (`SHOW DATABASES;`). |
| `ConnectionError: MySQL host is not permitted to connect` | Host restriction on the user account (errno 1130). | Create the user with the correct host: `CREATE USER 'dbgraph_reader'@'<host>' ...`. |
| `ConnectionError: MySQL connection failed: host/port unreachable …` | Network: firewall, wrong port, or server not running. | Check `host`/`port` in `MysqlAdapterConfig`; default port is 3306. |
| `NULL` view or routine bodies | Object owned by a different definer; reparsed body unavailable. | Ensure the connected user owns the objects, or use `SHOW CREATE VIEW` / `SHOW CREATE PROCEDURE` as a privileged user. |
