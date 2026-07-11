# Security Policy

dbgraph indexes a database's **catalog** (its structural metadata) into a local graph
served to AI agents. Its security posture is enforced by construction and by tests, not
by convention. Every statement below traces to a canonical spec.

## Security posture

### Read-only by construction

No dbgraph command issues any write, DDL or DML against the **target** database — only
catalog `SELECT`s (and, for MongoDB, `$sample`/`listCollections`/`listIndexes` reads)
through the adapter port. This is inviolable
(`openspec/specs/cli-config/spec.md` — "Read-only-against-target is INVIOLABLE";
`openspec/specs/mcp-server/spec.md` — the target database stays strictly read-only). A
repository write-verb scanner fails the build if any executable write verb appears under
`src/adapters/engines/**` (`openspec/specs/sqlite-extraction/spec.md` — "Write-verb
scanner over engines"). Each engine also documents a **minimal read-only role** so
dbgraph never needs write or admin grants.

### Secrets are referenced, never stored

Every connection-identity field (host, port, user, password, URL) is expressed as a
`${env:VAR}` reference and resolved from `process.env` at runtime. A literal/plaintext
credential is **rejected** with an actionable error, and a resolved connection URL is
**never logged** (`openspec/specs/cli-config/spec.md` — "Plaintext credentials are
rejected, env refs resolved at runtime"). `dbgraph init` writes only `${env:VAR}`
references to `dbgraph.config.json` — never a literal secret.

### Sampled values are never persisted

For MongoDB, structure is inferred by sampling documents, but the sampled **values are
discarded in memory** immediately after the type-merge: only field names, types and
presence frequencies survive into the graph
(`openspec/specs/cli-config/spec.md` — MongoDB sampling is "structural only ... values
never stored"; `openspec/specs/mongodb-extraction/spec.md` — "Sampled values are NEVER
persisted"). No document value reaches the persisted index.

### Diagnostics are content-free

`dbgraph doctor` reports connectivity capabilities — driver presence, detected CLI tools
and versions, ODBC presence, the resolved environment profile and chosen strategy — with
**no schema name, object identifier, query result, or secret** in the output, so it is
safe to paste into a public bug report
(`openspec/specs/connectivity-diagnostics/spec.md` — "dbgraph doctor reports diagnostics
content-free"). Tool paths are reduced to a basename so a username embedded in a path is
never surfaced (`src/core/present/doctor.ts`).

### Storage is local-only

The graph is persisted in a local SQLite + FTS5 index (`.dbgraph/`) on the developer's
machine (`openspec/specs/graph-storage/spec.md`). The local index is git-ignored and
never committed (`.gitignore`); there is no telemetry and nothing is sent off the
machine.

### No codenames or secrets in the repository

A leak-scanner enforces that no inline URL credential (a `user:password@` segment inside
a connection URL) and no denylisted internal identifier is ever committed — via git hooks
(`scripts/git-hooks/pre-commit`, `commit-msg`) and a test
(`test/security/no-secret-leak.test.ts`) that scans every tracked text file. See
[CONTRIBUTING.md](CONTRIBUTING.md#leak-scan).

## Reporting a vulnerability

If you discover a security issue, please report it **privately** through GitHub's
coordinated-disclosure channel rather than a public issue:

- **Do not** open a public issue, discussion, or pull request for anything
  security-sensitive.
- Report it privately via **GitHub Private Vulnerability Reporting** on this repository
  (**Security** tab → **Report a vulnerability**). This opens a private advisory visible
  only to you and the maintainers.
- Include the affected version or commit, the impact, and clear reproduction steps.
- Please allow a reasonable window for a fix before any public disclosure.

### Supported versions

The latest published release line receives security fixes; older versions are not
supported. Please confirm an issue reproduces on the current release before reporting.
