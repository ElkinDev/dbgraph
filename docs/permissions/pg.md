# PostgreSQL — Minimal Read-Only Role

dbgraph extracts catalog metadata only. It issues `SELECT` queries over `pg_catalog`
system catalogs and **never reads user data**. The permissions below reflect that:
`CONNECT` lets the role open a connection; `USAGE` on the target schema(s) lets the role
see the objects inside them; the catalog views (`pg_catalog`, `information_schema`) are
**world-readable by default in PostgreSQL** — no explicit grant is needed for them.
No table-data access (`SELECT` on user tables) is required when statistics and sampling
are off.

> **Note on routine and view body access**: reading the source definition of a function,
> procedure, or view body via `pg_get_functiondef` / `pg_get_viewdef` requires that the
> executing role is either the **owner** of the object or a member of a role that owns it,
> OR that `pg_proc.prosrc` / `pg_get_functiondef` is publicly readable (which is the
> default in most configurations). If extraction returns `NULL` bodies, grant role
> membership or ownership on the relevant objects. Exact grants are validated against
> `postgres:16` in the integration suite (Batch 7).

## What each grant does

| Permission | Scope | Why it is needed |
|-----------|-------|-----------------|
| `CREATE ROLE … NOSUPERUSER LOGIN` | Cluster | Creates the PostgreSQL role (authentication principal). `NOSUPERUSER` enforces the minimal-privilege posture. |
| `GRANT CONNECT ON DATABASE …` | Database | Lets the role open a connection to the target database. Without this, the role is refused at the authentication step. |
| `GRANT USAGE ON SCHEMA …` | Schema | Lets the role look up objects in the target schema(s). Without `USAGE`, object existence queries return empty results even if catalog rows are present. |
| `pg_catalog` / `information_schema` | Cluster | World-readable by default — **no explicit grant required**. All `pg_namespace`, `pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`, `pg_proc`, `pg_trigger`, `pg_sequence`, and related catalog queries run without extra permissions. |

`CONNECT` + `USAGE` are metadata-only permissions. They do **not** allow reading
user rows — only schema structure (DDL, not DML access).

## Minimal role script

Run this once as a superuser on the target cluster:

```sql
-- ── Step 1: Create the cluster-level role ────────────────────────────────────
-- Replace <StrongPassword!123> with a password that meets your security policy.
CREATE ROLE dbgraph_reader
    WITH NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT LOGIN
         PASSWORD '<StrongPassword!123>';

-- ── Step 2: Grant connection to the target database ───────────────────────────
-- Replace "your_database" with the name of the database to extract.
GRANT CONNECT ON DATABASE your_database TO dbgraph_reader;

-- ── Step 3: Grant schema visibility ─────────────────────────────────────────
-- Repeat for each schema that should be included in the extraction.
-- Replace "public" with the actual schema name(s).
GRANT USAGE ON SCHEMA public TO dbgraph_reader;

-- ── pg_catalog and information_schema are world-readable — no grant needed. ──
-- NO SELECT on user tables — not required when statistics/sampling is off.
-- NO SUPERUSER, CREATEDB, CREATEROLE, or any elevated attribute.
```

This role is sufficient to extract the **full torture schema** (catalog metadata only).
dbgraph reads `pg_namespace`, `pg_class`, `pg_attribute`, `pg_attrdef`,
`pg_constraint`, `pg_index`, `pg_proc`, `pg_trigger`, `pg_sequence`,
`obj_description`, and `col_description` — all catalog objects that are world-readable
by default in a standard PostgreSQL installation.

## How to verify the grant set

```sql
-- Run as superuser on the target database
\c your_database
SELECT grantee, privilege_type, table_catalog
FROM   information_schema.role_table_grants
WHERE  grantee = 'dbgraph_reader'
ORDER  BY privilege_type;

-- Verify connection privilege
SELECT has_database_privilege('dbgraph_reader', 'your_database', 'CONNECT');
-- Expected: true

-- Verify schema visibility
SELECT has_schema_privilege('dbgraph_reader', 'public', 'USAGE');
-- Expected: true
```

## How to revoke access

```sql
-- Revoke schema visibility
REVOKE USAGE ON SCHEMA public FROM dbgraph_reader;

-- Revoke database connection
REVOKE CONNECT ON DATABASE your_database FROM dbgraph_reader;

-- Drop the role once all privileges are revoked
DROP ROLE dbgraph_reader;
```

## Production TLS guidance

For production environments (outside Testcontainers / local dev):

- Set `ssl: true` in `PgAdapterConfig` to require an encrypted connection.
- Configure `sslmode=verify-full` on the server and install a CA-signed certificate.
- Do NOT set `ssl: false` in production — plaintext connections expose credentials to
  network interception.
- Rotate the `dbgraph_reader` password regularly. Avoid embedding it in source
  control; use a secrets manager and reference it as `${env:DBGRAPH_PG_PASSWORD}` in
  `.dbgraph/config.json` (see US-032).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `PermissionError: Grant SELECT on the required catalog objects …` | Role lacks `USAGE` on the target schema, or a catalog view is restricted. | Run `GRANT USAGE ON SCHEMA <schema> TO dbgraph_reader;` and re-run extraction. |
| `ConnectionError: PostgreSQL authentication failed` | Wrong password or role does not have `LOGIN`. | Check the password and ensure the role was created with `LOGIN`. |
| `ConnectionError: PostgreSQL database not found` | The database name in `PgAdapterConfig` does not exist. | Verify `database` in the config matches an existing database (`\l` in psql). |
| `ConnectionError: PostgreSQL connection failed` | Host/port unreachable, or `pg_hba.conf` blocks the connection. | Check `host`/`port`, firewall rules, and the `pg_hba.conf` entry for the role. |
| `NULL` function/view bodies | Role is not the owner and `pg_get_functiondef` returns `NULL`. | Grant role membership on the object owner, or temporarily set the object owner to `dbgraph_reader`. |
