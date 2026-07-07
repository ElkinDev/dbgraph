# CLI & Config Specification

## Purpose

The human/script-facing command-line interface and the committeable, secret-safe configuration that
let the full `init → sync → query` flow run against any supported dialect WITHOUT writing code. This
is a DRIVING adapter under `src/cli/` (ADR-004): it imports ONLY the public core API (`src/index.ts`)
plus Node builtins and MUST NEVER import `src/adapters/**` directly. It covers the config model
(`dbgraph.config.json` parse/validate, `${env:VAR}` resolution, plaintext-credential rejection), the
six commands (`init`, `sync`, `status`, `query`, `explore`, `diff`), their exit-code contract, and the
PURE deterministic golden-pinned formatters (ADR-008) — the `explore` formatter being the SAME source
the Phase-5 MCP tool reuses. Stories: US-001..005 (init/sync/levels/filters/incremental), US-020
(query), US-021 (explore), US-022 (diff). The MCP server/tools, the MCP compact format, `affected`,
`install` and `watch` are OUT OF SCOPE (Phase 5 / deferred).

> **Read-only-against-target is INVIOLABLE.** No command issues any write, DDL or DML against the
> TARGET database — only catalog SELECTs via the adapter port. ZERO new runtime dependencies: the
> subcommand parser is hand-rolled and the `-i` wizard uses `node:readline`.

## Requirements

### Requirement: ConfigError and UnsupportedDialectError join the typed error set

The core SHALL define two new typed errors in `src/core/errors.ts` (exported via the barrels):
`ConfigError`, raised on an invalid, malformed or unsafe configuration, and `UnsupportedDialectError`,
raised when a requested dialect has no registered adapter. Both MUST carry an actionable message; the
CLI MUST map them to stable exit codes (see exit-code contract). They MUST sit alongside the existing
`ConnectionError`/`PermissionError` without redefining them. No `any` types; no `console.log` in core.

#### Scenario: Typed config errors exist and are exported

- GIVEN the core error module `src/core/errors.ts`
- WHEN its exports are inspected
- THEN `ConfigError` and `UnsupportedDialectError` are present as typed errors with actionable messages
- AND the existing `ConnectionError` and `PermissionError` are unchanged

### Requirement: Config model is a dialect-discriminated, env-only schema

`dbgraph.config.json` SHALL be a JSON document at the PROJECT ROOT with: a `dialect` discriminant
(one of the supported engines), a `connection` block, an `objects` block mapping each object type to
its indexing level (`off` | `metadata` | `full`), optional `include`/`exclude` glob arrays, and, for
MongoDB, a sampling configuration (structural only — keys + types, values never stored). Every
CONNECTION-IDENTITY field (host, port, database, user, domain, and any password/url) MUST be expressed
as a `${env:VAR}` reference using a GENERIC variable name (e.g. `DBGRAPH_DB_HOST`, never a project
codename). Parsing an invalid document (unknown dialect, missing required field, malformed level) MUST
reject with `ConfigError`.

#### Scenario: Valid config parses with env-only connection identity

- GIVEN a `dbgraph.config.json` whose `dialect` is supported and whose every connection-identity field is a `${env:VAR}` reference
- WHEN the config is parsed and validated
- THEN it loads successfully
- AND each connection-identity field is retained as an unresolved `${env:VAR}` reference

#### Scenario: Unknown dialect is rejected

- GIVEN a config whose `dialect` is not a supported engine
- WHEN the config is parsed
- THEN it rejects with `UnsupportedDialectError` naming the available dialects

#### Scenario: Malformed level or missing required field is rejected

- GIVEN a config with an object level outside `off|metadata|full` or a missing required field
- WHEN the config is parsed
- THEN it rejects with `ConfigError` naming the offending field

### Requirement: Plaintext credentials are rejected, env refs resolved at runtime

The config layer SHALL reject ANY inline/plaintext value in a connection-identity field: a literal
password, a literal host/port/user/domain, or a connection URL embedding credentials MUST raise
`ConfigError` rather than be accepted. At runtime, `${env:VAR}` references MUST be resolved from
`process.env`; a referenced variable that is unset MUST raise `ConfigError` naming the missing variable
(it MUST NOT silently resolve to empty). A resolved connection URL MUST NEVER be logged.

#### Scenario: Inline plaintext credential is rejected

- GIVEN a config where a password, host, or a credential-bearing URL is written as a literal value (not `${env:VAR}`)
- WHEN the config is parsed or written
- THEN it rejects with `ConfigError` instructing the user to use a `${env:VAR}` reference

#### Scenario: Env references resolve from process.env at runtime

- GIVEN a valid config with `${env:DBGRAPH_DB_HOST}` and the variable set in `process.env`
- WHEN the connection identity is resolved for a command
- THEN each reference is replaced by its `process.env` value
- AND the resolved connection URL is never written to any log or stdout

#### Scenario: Missing environment variable fails loudly

- GIVEN a valid config referencing `${env:DBGRAPH_DB_PASSWORD}` that is unset in `process.env`
- WHEN the connection identity is resolved
- THEN it rejects with `ConfigError` naming the missing variable
- AND it does NOT resolve to an empty or partial credential

### Requirement: init writes a root config and gitignores the local index

`dbgraph init` SHALL validate the target connection and then write `dbgraph.config.json` at the project
ROOT containing NO secrets (`${env:VAR}` only), append `.dbgraph/` to the project `.gitignore` (the
local index and local state are NEVER committed), and run the first `sync`; on success it MUST exit 0
(US-001). The non-interactive form MUST accept `--dialect` and the connection inputs as flags. The
written config MUST place every connection-identity flag value behind a generated generic `${env:VAR}`
reference (the literal value is NOT written to disk).

#### Scenario: Non-interactive init writes root config, gitignores .dbgraph, syncs

- GIVEN `dbgraph init --dialect sqlite --url ./fixture.db`
- WHEN it runs successfully
- THEN it validates the connection, writes `dbgraph.config.json` at the project root with `${env:VAR}` references only (no secrets)
- AND `.dbgraph/` is appended to the project `.gitignore`
- AND the first sync runs and the command exits 0

#### Scenario: init never writes a plaintext credential to disk

- GIVEN an `init` invocation whose connection flags carry literal credential values
- WHEN the config is written
- THEN the values are stored as generated `${env:VAR}` references, never as literals in `dbgraph.config.json`

### Requirement: Interactive init is capability-driven and byte-identical to flags

`dbgraph init -i` SHALL run a `node:readline` wizard whose object-type choices are driven by the
chosen dialect's `CapabilityMatrix`: it MUST offer ONLY object types the matrix declares supported
(SQLite offers no procedures; MongoDB offers no triggers) and MUST NOT offer unsupported types
(US-002). If the user types a literal credential at the connection step, the wizard MUST reject it and
require a `${env:VAR}` reference. The config emitted by `init -i` MUST be BYTE-IDENTICAL to the config
emitted by `init` with the equivalent flags.

#### Scenario: Wizard offers only CapabilityMatrix-declared object types

- GIVEN a dialect whose `CapabilityMatrix` declares procedures unsupported (e.g. SQLite)
- WHEN the wizard reaches the object-type step
- THEN it offers only the supported object types
- AND it does NOT offer procedures (or any type the matrix declares unsupported)

#### Scenario: Wizard rejects a literal credential

- GIVEN the wizard's connection step
- WHEN the user types a literal password instead of a `${env:VAR}` reference
- THEN the wizard rejects the input and re-prompts for a `${env:VAR}` reference

#### Scenario: Interactive and flag forms emit byte-identical config

- GIVEN a wizard run and an `init` run with the equivalent flags producing the same choices
- WHEN both write `dbgraph.config.json`
- THEN the two files are BYTE-IDENTICAL (ADR-008)

### Requirement: sync is incremental by fingerprint, --full forces a rebuild

`dbgraph sync` SHALL be incremental: it MUST compare the adapter's `fingerprint()` against the last
snapshot's stored fingerprint and SKIP extraction entirely when they are equal; otherwise it MUST
`extract → normalize → upsert` changed and new objects (by `body_hash`), DELETE objects removed from
the source, and write a new snapshot via `putSnapshot` (US-005). `sync --full` MUST force a complete
re-extraction and rebuild regardless of the fingerprint. Every sync that extracts MUST record a
snapshot with per-object-type counts.

`dbgraph sync` MUST also be OBSERVABLE: it MUST NOT run silent. It SHALL emit human-readable PROGRESS
(at minimum: extraction started/skipped, delta computed, upsert/delete applied, snapshot written) and a
final SUMMARY (per-object-type counts, upserted/deleted delta, drift state, snapshot id/fingerprint)
through the injected `Logger`. The summary text MUST be produced by a PURE, deterministic, golden-pinnable
formatter (ADR-008): for the same inputs it MUST be byte-identical. Elapsed TIMING is NOT part of the
pinned formatter output — timing flows through the `Logger` seam so the golden body stays deterministic.
The logger and formatter MUST emit ONLY counts, phase names, timings, drift state and snapshot metadata —
they MUST NOT emit any connection-string value, resolved secret, or sampled data value. Diagnostics MUST
go to STDERR; where a command supports `--json`, the machine payload on STDOUT MUST remain byte-identical
(observability MUST NOT pollute parseable output). The observable output MUST NOT change any command's
exit code. A `--quiet`/`-q` flag MUST suppress info/progress while preserving warn/error; the default
level is verbose (info/progress shown).
(Previously: the requirement only mandated the persisted snapshot — `sync` emitted NOTHING to stdout/stderr and ran silent.)

#### Scenario: Unchanged fingerprint skips extraction

- GIVEN an existing graph whose last snapshot fingerprint equals the adapter's current `fingerprint()`
- WHEN `dbgraph sync` runs
- THEN extraction is skipped and the existing graph is preserved unchanged
- AND it emits a human-readable line stating the index is already up to date (no silent exit)

#### Scenario: Changed source applies only the delta and records a snapshot

- GIVEN an existing graph and a source with one procedure modified and one object deleted
- WHEN `dbgraph sync` runs
- THEN only the changed/new objects are upserted (verifiable by counter) and the deleted object's node and edges are removed
- AND a new snapshot is written with per-type counts recording the deletion

#### Scenario: --full forces a complete rebuild

- GIVEN an existing graph whose fingerprint is unchanged
- WHEN `dbgraph sync --full` runs
- THEN a complete re-extraction and rebuild occurs regardless of the fingerprint

#### Scenario: sync emits a deterministic golden-pinned summary

- GIVEN a sync that extracts and applies a known delta over the same inputs
- WHEN the summary is rendered by the pure formatter
- THEN it lists per-type counts, upserted/deleted totals, drift state and the snapshot id/fingerprint
- AND re-running with identical inputs yields byte-identical summary text (matches the golden), with elapsed timing NOT present in the pinned body

#### Scenario: sync output never leaks secrets or sampled data

- GIVEN a sync run whose resolved connection identity contains a secret and whose source rows contain data values
- WHEN the logger and formatter output is captured
- THEN it contains ONLY counts, phase names, timings, drift state and snapshot metadata
- AND it contains NO connection-string value, NO resolved secret, and NO sampled data value

#### Scenario: --json payloads stay byte-identical and diagnostics go to STDERR

- GIVEN a command that supports `--json` run before and after this change with identical inputs
- WHEN its output streams are compared
- THEN the STDOUT machine payload is byte-identical to before (existing `--json` goldens unchanged)
- AND all human-readable diagnostics/progress are written to STDERR only, never to STDOUT

#### Scenario: --quiet suppresses progress but keeps warnings and errors

- GIVEN `dbgraph sync --quiet`
- WHEN the sync runs and a warning or error condition occurs
- THEN info/progress lines are suppressed
- AND warn/error lines are still emitted to STDERR

#### Scenario: Observable output does not change exit codes

- GIVEN any command run with the observable logger wired
- WHEN it completes (success, negative result, or error)
- THEN its exit code is IDENTICAL to the pre-change exit-code contract (0/1/2/3/4 unchanged), the added I/O affecting output only

### Requirement: status reports counts, last snapshot and live drift

`dbgraph status` SHALL report per-object-kind counts from the persisted graph, the last snapshot
(timestamp, engine version, per-type counts), how many objects were excluded by filters, and whether
the adapter's LIVE `fingerprint()` differs from the last stored snapshot fingerprint (drift). Output
MUST be produced by a PURE deterministic formatter (US-004, US-005).

#### Scenario: status surfaces counts, last snapshot and drift

- GIVEN a persisted graph with a last snapshot whose stored fingerprint differs from the live `fingerprint()`
- WHEN `dbgraph status` runs
- THEN it prints per-kind counts, the last snapshot details and a DRIFT indication (live differs from stored)
- AND it reports how many objects were excluded by filters

### Requirement: query is backed by core search with a stable JSON contract

`dbgraph query <term>` SHALL search the persisted graph through the core `search` primitive and print
each hit with its type and qualified name (US-020). With `--json` the output MUST be STABLE
(deterministic, byte-identical for the same graph and term, ADR-008) and machine-parseable. The command
MUST exit 1 when there are ZERO results (otherwise exit 0).

#### Scenario: query prints hits with type and qualified name

- GIVEN a graph containing matches for the term `orders`
- WHEN `dbgraph query orders` runs
- THEN each hit is printed with its type and qualified name and the command exits 0

#### Scenario: --json emits stable machine-parseable output

- GIVEN a graph and a term with matches
- WHEN `dbgraph query orders --json` runs twice
- THEN both invocations emit byte-identical, parseable JSON (ADR-008)

#### Scenario: zero results exits 1

- GIVEN a term that matches nothing in the graph
- WHEN `dbgraph query <term>` runs
- THEN it exits with code 1

### Requirement: explore output comes from a pure formatter shared with the MCP tool

`dbgraph explore <qname>` SHALL render an entity bundle (the node plus its neighbors via the core
`getNeighbors` primitive) through a PURE, deterministic formatter, supporting `--detail brief|normal|full`
(US-021). That formatter MUST be the SINGLE source the Phase-5 MCP `explore` tool will reuse ("same
source, same golden"): the CLI MUST NOT carry its own divergent rendering. Output for a given graph,
qname and detail level MUST be byte-identical on re-run and pinned by a golden test.

#### Scenario: explore renders the entity bundle at the requested detail

- GIVEN a graph containing `dbo.orders`
- WHEN `dbgraph explore dbo.orders --detail normal` runs
- THEN it prints the entity bundle (node plus grouped neighbors) at `normal` detail
- AND `brief` and `full` produce correspondingly less/more detail from the same formatter

#### Scenario: explore output is deterministic and golden-pinned

- GIVEN the same graph, qname and detail level
- WHEN `dbgraph explore` runs twice
- THEN the two outputs are byte-identical and match the golden file (ADR-008)

#### Scenario: explore formatter is the single source for the future MCP tool

- GIVEN the explore formatter
- WHEN its rendering is invoked
- THEN it is a PURE function of (entity bundle, detail level) reusable by the Phase-5 MCP tool with no CLI-only branching

### Requirement: diff compares snapshots per object and is CI-gate usable

`dbgraph diff <snapA> <snapB>` (and `dbgraph diff --last`, comparing the two most recent snapshots)
SHALL produce a per-object diff grouped by object type: ADDED, REMOVED and MODIFIED objects (US-022).
For MODIFIED objects it MUST show WHAT changed (e.g. a column added, a column type altered, a procedure
body changed — detected by `body_hash` difference). The command MUST exit 0 when there are NO changes
and exit 1 when there ARE changes, so it is usable as a CI gate. Output MUST come from a PURE
deterministic formatter.

#### Scenario: diff groups added/removed/modified by type

- GIVEN two snapshots differing by an added table, a removed view and a procedure whose body changed
- WHEN `dbgraph diff <snapA> <snapB>` runs
- THEN it lists the added table, the removed view and the modified procedure grouped by object type
- AND the modified procedure entry states WHAT changed (body changed by hash)

#### Scenario: --last compares the two most recent snapshots

- GIVEN at least two snapshots in the local index
- WHEN `dbgraph diff --last` runs
- THEN it compares the two most recent snapshots and reports their per-object diff

#### Scenario: exit code reflects presence of changes

- GIVEN two snapshots with no differences
- WHEN `dbgraph diff` runs
- THEN it exits 0
- AND WHEN the snapshots differ it exits 1 (CI-gate usable)

### Requirement: CLI exit codes are a stable contract

The CLI SHALL map outcomes to STABLE exit codes (US-001): 0 success; 1 a query/diff "negative" result
(zero query hits, or diff found changes); 2 a connection failure whose message distinguishes "DNS does
not resolve" / "connection refused" / "timeout"; 3 a permission failure (`PermissionError`) whose
message names the EXACT missing permission and how to grant it; 4 an unsupported dialect
(`UnsupportedDialectError`) listing the available dialects. A `ConfigError` MUST surface a clear,
actionable message and a non-zero exit.

#### Scenario: Unreachable host exits 2 with a distinguishing message

- GIVEN an `init`/`sync` against an unreachable host
- WHEN the command runs
- THEN it exits 2 and the message distinguishes DNS-not-resolved vs connection-refused vs timeout

#### Scenario: Missing permission exits 3 naming the permission

- GIVEN a login lacking the required catalog permission (`PermissionError`)
- WHEN a command runs
- THEN it exits 3 and the message names the exact missing permission and how to grant it

#### Scenario: Unsupported dialect exits 4 listing dialects

- GIVEN an unsupported `--dialect`
- WHEN `init` runs
- THEN it exits 4 and lists the available dialects

### Requirement: CLI never imports an adapter directly (boundary enforced)

The `src/cli/**` source tree SHALL import ONLY the public core API (`src/index.ts`) and Node builtins;
it MUST NOT import `src/adapters/**` directly (ADR-004). A boundary test MUST FAIL the build if any
CLI module imports an adapter, driver, MCP or storage-internal symbol.

#### Scenario: Boundary test fails on a direct adapter import

- GIVEN the `src/cli/**` source tree analysed by the boundary test
- WHEN any CLI module imports from `src/adapters/**` (or a driver/storage internal)
- THEN the boundary test FAILS the build
- AND when the CLI imports only `src/index.ts` and Node builtins the boundary test passes

---

## Requirements Added by connectivity-strategies (2026-06-18)

> These requirements add config and UX surface for integrated-security and external-tool connectivity.
> The existing credential-required modes (SQL auth, NTLM) are UNCHANGED. Identity fields remain
> `${env:VAR}`-only; integrated mode carries no credential to resolve; resolved values are never logged.
> Stories: US-001, US-033; ADR-004.

### Requirement: integrated SQL Server auth mode requires no credentials

The config layer SHALL accept an `integrated` SQL Server authentication mode that carries NO `user`,
`password` or `domain`. `parseConfig` MUST NOT require any credential field for this mode (it MUST NOT
reject an integrated source for missing `user`/`password`), and `resolveSecrets` MUST skip the absent
credential fields (resolving only the fields that are present, e.g. `server`/`database`/`port`). The
existing SQL-auth and NTLM modes — which DO require `${env:VAR}` credentials — MUST parse and resolve
UNCHANGED. The plaintext-rejection rule still applies to whatever identity fields ARE present.

#### Scenario: Integrated config parses without credentials

- GIVEN an mssql config in `integrated` mode with `server`/`database` as `${env:VAR}` and no user/password/domain
- WHEN `parseConfig` validates it
- THEN it parses successfully without demanding any credential field

#### Scenario: resolveSecrets skips absent credential fields

- GIVEN a parsed integrated-mode config
- WHEN `resolveSecrets` runs
- THEN it resolves only the present identity fields and skips the absent user/password/domain
- AND no credential value is logged

#### Scenario: Existing credentialed modes are unchanged

- GIVEN an mssql config in SQL-auth or NTLM mode
- WHEN it is parsed and resolved
- THEN credential fields are still required as `${env:VAR}` references and resolved exactly as before
- AND a missing referenced variable still fails loudly with `ConfigError`

### Requirement: Exhausted strategies present manual-dump and guided-install options

When connectivity is exhausted (the typed `StrategyExhaustionError`, see `connectivity`), the CLI SHALL
present the user TWO actionable options rather than failing opaquely: (a) the MANUAL-DUMP path — print
the emitted dump script (or its location) and state exactly where to place the produced JSON for ingest;
and (b) a GUIDED install (B1) — print the OFFICIAL Microsoft/winget install instructions behind an
EXPLICIT consent notice. The CLI MUST NOT execute any installer automatically. It MUST state CLEARLY that
AUTOMATED installer execution (B2) is DEFERRED to a follow-up — phrased as an acknowledged limitation,
not a hidden gap.

#### Scenario: Exhaustion presents both options actionably

- GIVEN an integrated-mode run where every connectivity strategy is exhausted
- WHEN the CLI handles the `StrategyExhaustionError`
- THEN it presents the manual-dump path (the emitted script and the gitignored location for the output JSON)
- AND it presents a guided-install option printing official install instructions behind a consent notice

#### Scenario: Guided install prints instructions only, never auto-executes

- GIVEN the guided-install (B1) option is shown
- WHEN the user views it
- THEN only official install instructions (winget/official URL) are printed behind an explicit consent notice
- AND no installer is executed automatically

#### Scenario: Automated install is stated as a deferred limitation

- GIVEN the exhaustion UX
- WHEN the install option is presented
- THEN it states clearly that AUTOMATED installer execution (B2) is DEFERRED to a follow-up
- AND it is phrased as an acknowledged limitation, not a hidden gap

## Requirements Added by ux-observability (2026-07-06)

> This delta closes the observable-sync gap folded into the "sync is incremental by fingerprint" MODIFIED
> requirement above (US-005 user-facing-output obligation) and adds ONE new requirement: top-level
> help/usage banner accuracy. The `install` line in `cli.ts`'s `USAGE_TEXT` had drifted stale after 9.5a
> made `install` multi-agent; this requirement pins the banner to the six-agent reality and to `install`'s
> `MANUAL_SNIPPET` source of truth. Stories: US-038; ADR-004 (no CLI import of `src/adapters/**`).

### Requirement: CLI top-level help/usage banner accurately describes every command

The CLI's top-level `--help`/usage banner (`USAGE_TEXT`) SHALL describe each command accurately and
consistently with that command's actual behavior. In particular, the `install` line MUST reflect the
MULTI-AGENT reality — `install` wires the `dbgraph-mcp` server into EVERY supported agent (Claude Code,
Cursor, Gemini CLI, VS Code, opencode, Codex CLI) per the single `AGENT_TABLE` source of truth — and MUST
NOT describe it as wiring only a single specific agent (it MUST NOT say "Claude Desktop"). The `install`
line MUST ALSO document the `--project` flag (project-scoped config) alongside `--remove`. The banner's
supported-agent wording MUST stay consistent with `install`'s `MANUAL_SNIPPET` supported-agents list. A
unit test MUST pin the banner text against the multi-agent reality AND against the `--project` mention.
(Previously: the `install` line documented only `--remove` — "Wire dbgraph-mcp into supported MCP agents (--remove to undo)" — with no mention of the `--project` scope flag.)

#### Scenario: install banner line describes the multi-agent reality

- GIVEN the top-level `dbgraph --help` / `USAGE_TEXT`
- WHEN the `install` line is inspected
- THEN it describes wiring `dbgraph-mcp` for supported MCP agents (multi-agent), with `--remove` to undo
- AND it does NOT mention "Claude Desktop" or any single specific agent as the only target

#### Scenario: install banner line documents the --project flag with the exact text

- GIVEN the top-level `dbgraph --help` / `USAGE_TEXT`
- WHEN the `install` line is inspected
- THEN it reads exactly `  install   Wire dbgraph-mcp into supported MCP agents (--project for project scope, --remove to undo)` (two leading spaces, `install`, three spaces — same column alignment as the other command lines)
- AND a unit test pins this line so dropping the `--project` mention fails the build

#### Scenario: Banner agent wording stays consistent with install's source of truth

- GIVEN the banner text and `install`'s `MANUAL_SNIPPET` supported-agents list
- WHEN both are compared
- THEN the banner's notion of supported agents is consistent with the `AGENT_TABLE`/`MANUAL_SNIPPET` six-agent set
- AND a unit test pins the banner text so a future single-agent regression fails the build
