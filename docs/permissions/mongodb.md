# MongoDB — Minimal Read-Only Role

dbgraph extracts schema structure by sampling documents and reading collection metadata.
It issues **read-only operations** (`listCollections`, `$sample`, `listIndexes`, `dbStats`)
and **never reads documents into the persisted index** — sampled values are discarded in
memory after the type-merge pass. The role below reflects that: the MongoDB built-in
`read` role on the target database is the only grant required.

> **Note on `$jsonSchema` validators**: reading a collection's `$jsonSchema` validator is
> done via `db.command({ listCollections: 1, filter: { name: <collection> } })`, which is
> covered by the `read` role (specifically the `listCollections` privilege action). No
> extra grant is needed to access validator metadata.

> **Note on `clusterMonitor`**: `dbStats` executed at the **database** level
> (`db.runCommand({ dbStats: 1 })`) is covered by the built-in `read` role and does NOT
> require `clusterMonitor` (which is a cluster-level privilege). Only `serverStatus` or
> cluster-wide `dbStats` calls would need it.

## What each privilege covers

| Privilege action | Granted by | Why it is needed |
|-----------------|-----------|-----------------|
| `listCollections` | `read` role | `listCollections` command — discovers all non-system collections in the target database; also retrieves `$jsonSchema` validators via the options sub-document. |
| `find` (via `$sample`) | `read` role | `aggregate([{ $sample: { size } }])` — samples documents from each collection to infer field types and presence frequency. |
| `listIndexes` | `read` role | `listIndexes` command — discovers unique and compound indexes per collection. |
| `dbStats` (database level) | `read` role | `db.runCommand({ dbStats: 1 })` — returns `collections`, `indexes`, and `objects` counts used to compute the `fingerprint()` hash. |

The `read` built-in role covers all four privilege actions above. No write, DDL, or
administrative grant is required.

## Minimal role script

Run this once as a user with the `userAdmin` or `userAdminAnyDatabase` role on the target
cluster:

```js
// ── Step 1: Switch to the target database ─────────────────────────────────────
// Replace "your_database" with the name of the database to extract.
use your_database

// ── Step 2: Create the read-only user ─────────────────────────────────────────
// Replace <StrongPassword!123> with a password that meets your security policy.
db.createUser({
  user: "dbgraph_reader",
  pwd: "<StrongPassword!123>",
  roles: [
    { role: "read", db: "your_database" }
  ]
})

// ── No other roles are required. ──────────────────────────────────────────────
// NO readWrite, readAnyDatabase, dbAdmin, clusterMonitor, or any write role.
// NO insert, update, delete, create, drop, or any write operation.
```

This role is sufficient to extract the **full torture schema** (structural sampling only):
`listCollections`, `aggregate([{ $sample }])`, `listIndexes`, and `db.command({ dbStats: 1 })`
all run without error under the `read` role on the target database.

## How to verify the grant set

```js
// Run as the dbgraph_reader user (or as an admin to inspect)
use your_database

// Verify connection and basic read access
db.runCommand({ connectionStatus: 1 })
// Expected: { authInfo: { authenticatedUsers: [{ user: "dbgraph_reader", db: "your_database" }], ... } }

// Verify listCollections works
db.runCommand({ listCollections: 1, nameOnly: true })
// Expected: { cursor: { ..., firstBatch: [ ... ] }, ok: 1 }

// Verify dbStats works (needed for fingerprint())
db.runCommand({ dbStats: 1 })
// Expected: { db: "your_database", collections: N, ..., ok: 1 }
```

As an admin, verify the role assignment directly:

```js
use your_database
db.getUser("dbgraph_reader")
// Expected: { ..., roles: [ { role: "read", db: "your_database" } ], ... }
```

## How to revoke access

```js
use your_database

// Remove the user (drops the role assignment along with the user)
db.dropUser("dbgraph_reader")
```

## Production TLS guidance

For production environments (outside Testcontainers / local dev):

- Set `tls: true` in `MongodbAdapterConfig` to require an encrypted connection.
- Configure `net.tls.mode: requireTLS` on the server and install a CA-signed certificate.
- Do NOT set `tls: false` in production — plaintext connections expose credentials to
  network interception.
- Rotate the `dbgraph_reader` password regularly. Avoid embedding it in source control;
  use a secrets manager and reference it as `${env:DBGRAPH_MONGO_URI}` in
  `.dbgraph/config.json` (see US-032). The full URI (including credentials) is carried
  in the `uri` field and resolved from the environment at connect time only.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `PermissionError: MongoDB permission denied. The role lacks required privileges (listCollections, find, listIndexes, dbStats). …` | The connected user does not have the `read` role on the target database (MongoDB error code 13 / Unauthorized). | Run `db.grantRolesToUser("dbgraph_reader", [{ role: "read", db: "your_database" }])` and retry extraction. See the minimal role script above. |
| `ConnectionError: MongoDB authentication failed. …` | Wrong password or the user does not exist on the authentication database. | Verify the user name, password, and authentication database in the URI (`MongodbAdapterConfig`). |
| `ConnectionError: MongoDB server selection failed. …` | Host not reachable, connection timed out, or the URI specifies an unreachable replica-set member. | Verify the URI host and port in `MongodbAdapterConfig`; check firewall rules and that `mongod` is running. |
| `ConnectionError: MongoDB connection failed: host or port unreachable. …` | OS-level network error (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`). | Check `host`/`port` in the URI; ensure the MongoDB server is running and reachable from the client host. |
| Empty extraction (zero collections) | User connected but has no `listCollections` privilege on the target database (unusual if `read` role was granted). | Confirm the `read` role was granted on the CORRECT database name (case-sensitive). Run `db.getUser("dbgraph_reader")` to inspect. |
