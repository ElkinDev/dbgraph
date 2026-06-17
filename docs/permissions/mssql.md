# SQL Server — Minimal Read-Only Login

dbgraph extracts catalog metadata only. It issues `SELECT` queries over `sys.*`
catalog views and **never reads user data**. The permissions below reflect that:
`VIEW DEFINITION` gives access to catalog definitions; `CONNECT` allows the login
to connect to the target database. No `db_datareader` or data permissions are
required when statistics and sampling are off.

## What each grant does

| Permission | Scope | Why it is needed |
|-----------|-------|-----------------|
| `CREATE LOGIN` | Server | Creates the SQL Server login (authentication principal). |
| `CREATE USER` | Database | Maps the login to the target database (authorization principal). |
| `GRANT CONNECT` | Database | Lets the user open a connection to the database. |
| `GRANT VIEW DEFINITION` | Database | Lets the user read the definition of all objects in `sys.*` (tables, columns, modules, indexes, constraints, extended properties, dependencies). Without this, `sys.sql_modules.definition` returns `NULL` and object metadata queries fail with error 229. |

`VIEW DEFINITION` is a metadata-only permission. It does **not** allow reading
user rows — only catalog definitions (DDL, not DML access).

## Minimal login script

Run this once as `sysadmin` (or `securityadmin` + `db_owner`) on the target instance:

```sql
-- ── Step 1: Create the server-level login ────────────────────────────────────
-- Replace <StrongPassword!123> with a password that meets your complexity policy.
CREATE LOGIN dbgraph_reader
    WITH PASSWORD = '<StrongPassword!123>';

-- ── Step 2: Map the login to the target database ─────────────────────────────
-- Replace [YourDatabase] with the name of the database to extract.
USE [YourDatabase];
GO

CREATE USER dbgraph_reader FOR LOGIN dbgraph_reader;

-- ── Step 3: Grant only what is needed ────────────────────────────────────────
GRANT CONNECT         TO dbgraph_reader;
GRANT VIEW DEFINITION TO dbgraph_reader;
-- NO db_datareader — not needed when statistics/sampling is off.
-- NO db_owner, sysadmin, or any elevated role.
GO
```

## How to verify the grant set

```sql
-- Run as sysadmin on the target database
USE [YourDatabase];
SELECT dp.permission_name, dp.state_desc, dp.class_desc
FROM   sys.database_permissions dp
JOIN   sys.database_principals pr ON pr.principal_id = dp.grantee_principal_id
WHERE  pr.name = 'dbgraph_reader'
ORDER  BY dp.permission_name;
-- Expected rows: CONNECT (GRANT), VIEW DEFINITION (GRANT)
```

## How to revoke access

```sql
USE [YourDatabase];
DROP USER dbgraph_reader;
GO
-- Revoke the server login if no longer needed in any database:
USE [master];
DROP LOGIN dbgraph_reader;
```

## Production TLS guidance

For production environments (outside Testcontainers / local dev):

- Set `encrypt: true` (default) and `trustServerCertificate: false`.
- Install a CA-signed TLS certificate on the SQL Server instance.
- Do NOT use `trustServerCertificate: true` in production — it disables certificate
  validation and exposes you to MITM attacks.
- Rotate the `dbgraph_reader` password regularly. Avoid embedding it in source
  control; use a secrets manager (Azure Key Vault, AWS Secrets Manager, etc.).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `PermissionError: VIEW DEFINITION denied on object …` | Login is missing `VIEW DEFINITION`. | Run `GRANT VIEW DEFINITION TO dbgraph_reader;` on the target database. |
| `ConnectionError: Login failed for user 'dbgraph_reader'` | Wrong password or login disabled. | Reset the password with `ALTER LOGIN dbgraph_reader WITH PASSWORD = '…';`. |
| `ConnectionError: self-signed certificate` | TLS validation failed in dev. | Set `trustServerCertificate: true` in `MssqlAdapterConfig` (dev only). |
| `ConnectionError: Kerberos SSO is unsupported` | Integrated Kerberos attempted. | Use `authentication.type: 'sql'` with explicit credentials. |
