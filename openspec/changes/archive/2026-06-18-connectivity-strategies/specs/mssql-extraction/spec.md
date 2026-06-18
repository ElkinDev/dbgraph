# MSSQL Extraction Specification (delta — connectivity-strategies)

## Purpose

This delta ADDS external-tool connectivity to the SQL Server adapter so it can extract a catalog when
the target permits ONLY Windows Integrated Security (no explicit credential), which `tedious` cannot do
(ADR-006). It adds an `integrated` auth mode, a **sqlcmd** strategy and a **manual-dump** strategy, both
of which produce typed rows feeding the UNCHANGED `buildMssqlRawCatalog` (`map.ts`) and reuse the
existing `queries.ts` SQL constants verbatim (wrapped in `FOR JSON PATH`). It REINFORCES read-only across
the new external paths. The existing tedious path (SQL auth / NTLM with explicit credentials, see the
main spec) is UNCHANGED. Stories: US-027, US-031; ADR-004, ADR-006, ADR-008.

> **map.ts is the equivalence anchor.** The native, sqlcmd and manual-dump paths all converge on the
> SAME `buildMssqlRawCatalog(input: MssqlRowInput, scope)`. Each external path's only new code is the
> step that turns tool output into typed `MssqlRowInput` rows; the catalog assembly and its determinism
> (ADR-008) are reused, not duplicated.

## ADDED Requirements

### Requirement: integrated auth mode selects an external-tool strategy

The mssql adapter SHALL accept an `integrated` authentication mode carrying NO `user`, `password` or
`domain`. In this mode the native tedious strategy MUST be SKIPPED (it cannot perform integrated
security, ADR-006) and an external-tool strategy (sqlcmd first) MUST be selected through the connectivity
registry (see `connectivity`). The existing explicit-credential SQL-auth and NTLM paths MUST remain
unchanged and continue to use the native tedious driver. Strategy selection MUST happen INSIDE the single
`createMssqlSchemaAdapter` factory — no second public export is added.

#### Scenario: Integrated config drives the sqlcmd strategy

- GIVEN an mssql config whose authentication mode is `integrated` (no user/password/domain)
- WHEN `createMssqlSchemaAdapter(config)` runs on a machine with `sqlcmd` available
- THEN the native tedious strategy is skipped and the sqlcmd strategy is selected
- AND the returned adapter satisfies the unchanged `SchemaAdapter` port

#### Scenario: Explicit-credential config still uses the native driver

- GIVEN an mssql config with SQL or NTLM explicit credentials
- WHEN `createMssqlSchemaAdapter(config)` runs
- THEN the native tedious strategy is selected as before (behaviour unchanged)
- AND no second public factory export is introduced

### Requirement: sqlcmd strategy reuses queries.ts and feeds the unchanged map.ts

The sqlcmd strategy SHALL run the EXISTING `queries.ts` catalog SELECTs, each wrapped in
`FOR JSON PATH`, by invoking `sqlcmd` with integrated auth and JSON-friendly flags
(`-E -S <server> -d <db> -y 0 -h -1 -W`) via `node:child_process` (no shell interpolation of untrusted
input). It MUST reassemble the `FOR JSON` output that SQL Server splits across multiple stdout lines into
a single JSON document BEFORE parsing, parse it to the EXACT `MssqlRowInput` row shapes (`TableRow`,
`ColumnRow`, …), VALIDATE/normalize those rows at the strategy boundary before `map.ts`, and feed the
UNCHANGED `buildMssqlRawCatalog`. The resulting `RawCatalog` MUST be IDENTICAL to the native path's for
the same schema (ADR-008). Malformed or unparseable output MUST be rejected (falling to the next strategy
with a logged reason), never cast blindly.

#### Scenario: sqlcmd output reassembled and parsed to typed rows

- GIVEN a `FOR JSON PATH` result that `sqlcmd` emits split across several stdout lines
- WHEN the sqlcmd strategy processes stdout
- THEN it reassembles all lines into one JSON document before `JSON.parse`
- AND it parses the document into the exact `MssqlRowInput` row shapes

#### Scenario: sqlcmd path yields a catalog identical to the native path

- GIVEN the same SQL Server schema reachable by both the native driver and `sqlcmd`
- WHEN each strategy extracts at the same scope and the rows feed `buildMssqlRawCatalog`
- THEN the sqlcmd `RawCatalog` is byte-identical to the native `RawCatalog` (ADR-008)

#### Scenario: Malformed sqlcmd output is rejected, not cast

- GIVEN `sqlcmd` stdout that is not valid JSON for the expected row shapes
- WHEN the sqlcmd strategy parses it
- THEN it rejects the output (the strategy falls through with a logged reason)
- AND it does NOT cast the malformed data into typed rows

### Requirement: manual-dump strategy ingests one combined JSON offline

dbgraph SHALL provide a manual-dump strategy for environments where no tool can connect for it directly.
dbgraph MUST EMIT a runnable dump script composed from the existing `queries.ts` constants wrapped in
`FOR JSON PATH`; the USER runs that script themselves (e.g. `sqlcmd -E` or SSMS) and produces ONE combined
JSON file shaped `{ "tables": [...], "columns": [...], ... }` matching `MssqlRowInput`. dbgraph MUST
ingest that single file from a GITIGNORED local directory, validate it to the typed row shapes, and feed
the UNCHANGED `buildMssqlRawCatalog`, yielding the SAME `RawCatalog`. The strategy MUST itself issue no
write; the emitted script MUST contain only catalog SELECTs; the output directory MUST be gitignored
(schema and procedure source are sensitive).

#### Scenario: Combined JSON dump ingests to the same RawCatalog

- GIVEN a combined JSON file matching `MssqlRowInput` in the gitignored dump directory
- WHEN the manual-dump strategy ingests it
- THEN it validates the rows and feeds `buildMssqlRawCatalog`
- AND the resulting `RawCatalog` matches the native path for the same schema (an anonymized recorded dump is the golden, ADR-008)

#### Scenario: Emitted dump script is read-only and output is gitignored

- GIVEN the dump script emitted by dbgraph from `queries.ts` + `FOR JSON PATH`
- WHEN the script is inspected
- THEN it contains only catalog `SELECT` statements (no write verb)
- AND the local directory holding the produced JSON is gitignored

### Requirement: Read-only reinforced across the new external paths

The sqlcmd and manual-dump strategies SHALL preserve the INVIOLABLE read-only guarantee: they issue ONLY
the existing catalog SELECTs (from `queries.ts`, wrapped in `FOR JSON`) and MUST NOT issue any
`INSERT`/`UPDATE`/`DELETE`/`MERGE`/DDL. Their source under `src/adapters/engines/mssql/strategies/` MUST
fall within the existing engines write-verb scanner scope and pass it. No SQL Server validation-database
codename may be written into any strategy, fixture, dump, or doc.

#### Scenario: Strategy SQL passes the write-verb scanner

- GIVEN the mssql strategy source under `src/adapters/engines/mssql/strategies/`
- WHEN the existing engines write-verb scanner runs
- THEN it finds no executable write verb in any strategy's SQL and the scan passes

#### Scenario: No codename leaks into strategy artifacts

- GIVEN the strategies, their fixtures, the recorded dump golden and any docs
- WHEN they are inspected
- THEN none contains the validation-database codename (dumps are anonymized; the output directory is gitignored)
