# Proposal: Connectivity Strategies — Integrated-Security & External-Tool Connectivity

## Intent

Phase 3 connects to SQL Server ONLY via `mssql` (tedious/TDS) with EXPLICIT credentials (SQL auth or NTLM).
But the real target — a corporate SQL Server — allows ONLY Windows **Integrated Security** (current session, no
password), and the DBA will NOT issue any SQL/explicit credential. `tedious` CANNOT do integrated security (it
needs native SSPI, ADR-006). dbgraph is therefore CURRENTLY UNABLE to extract that catalog, which BLOCKS Phase 6
(real validation) on this and every integrated-only machine. This change adds an engine-agnostic, transparent,
consent-based **connectivity-strategy system**: probe what can connect; when the native driver can't (integrated
security) or the engine isn't natively supported, scan the machine for already-installed external tools (e.g.
`sqlcmd -E`) and use them TRANSPARENTLY; if none, offer manual offline ingest OR — with EXPLICIT consent — guided
official install. All without violating "100% JS drivers", "no install", or read-only.

## Scope

### In Scope
- `ConnectivityStrategy` PORT in `src/core/ports/connectivity-strategy.ts` (uses only core types
  `RawCatalog`/`ExtractionScope` — ADR-004 clean; ZERO driver/tool imports). Methods: `canConnect`/`detect`,
  `runCatalog(scope) → RawCatalog`, plus identity for logging.
- SQL Server concrete strategies under `src/adapters/engines/mssql/strategies/`: **native-driver** (existing
  tedious path, used only with explicit creds), **sqlcmd** (`sqlcmd -E` integrated auth → `FOR JSON PATH` →
  typed rows → REUSED `map.ts`), **manual-dump** (offline ingest of one combined JSON), **guided-install**
  (prints official Microsoft/winget instructions; consent-gated, no automated execution).
- Engine-keyed ORDERED strategy registry + selection: native (if explicit creds) → detected external tools
  (sqlcmd first) → manual-dump → consented-install. Exhausting all → typed `StrategyExhaustionError` listing
  what was tried + why.
- Config: extend `MssqlSource`/`MssqlAdapterConfig` with an `integrated` auth mode (NO user/password/domain);
  `parse-config.ts` MUST NOT require credentials for it; `resolve-secrets.ts` skips absent fields.
- Wiring: `createMssqlSchemaAdapter` selects the strategy from config (backward-compatible — NO second public
  export); `src/infra/open-connections.ts` passes the `integrated` branch through.
- Dump-script EMITTER: composes `queries.ts` constants + `FOR JSON PATH` into a runnable script the user
  executes manually; output is one combined JSON matching `MssqlRowInput` under a GITIGNORED local dir.
- Transparency + logging via the `Logger` port ("native failed → sqlcmd found → using sqlcmd") with verbosity.
- Tests (strict TDD): mock `node:child_process` for `detect`/`canConnect`; mock stdout for `runCatalog`
  (incl. FOR JSON line-reassembly); a RECORDED ANONYMIZED JSON dump as the manual-dump golden.

### Out of Scope (deferred — NOT carry-over)
- Oracle and other engines (the port/registry support them; no engine code now).
- `node-odbc` native package; `Invoke-Sqlcmd` (PowerShell SqlServer module) strategy.
- AUTOMATED installer execution (B2) — first delivery is GUIDED-ONLY (B1).
- go-sqlcmd variant nuances beyond detection.

## Capabilities

### New Capabilities
- `connectivity`: the engine-agnostic strategy framework — the `ConnectivityStrategy` port, the ordered
  per-engine registry + selection algorithm, the probe/detect contract (≥3 SQL Server candidates: `sqlcmd`,
  `Invoke-Sqlcmd`, ODBC Driver, `bcp`, `osql`), transparent auto-selection + `Logger`-port logging,
  `StrategyExhaustionError`, the manual-dump JSON contract + dump-script emitter, the consent gate +
  guided-install recipe model, and read-only-on-EVERY-path enforcement.

### Modified Capabilities
- `mssql-extraction`: ADD an `integrated` auth mode (no explicit creds) selecting an external-tool strategy
  instead of tedious; ADD the sqlcmd/manual-dump/guided-install strategies feeding the UNCHANGED `map.ts`;
  REINFORCE read-only across the new external paths (write-verb scanner now covers `strategies/`).
- `cli-config`: `MssqlSource` gains the `integrated` auth mode; parse/resolve MUST NOT demand credentials for it.

## Approach

**Approach A** (recommended by exploration). A driver-free `ConnectivityStrategy` port in core; concrete
strategies as adapters under `src/adapters/engines/mssql/strategies/`; a per-engine ordered registry chosen
inside the SINGLE `createMssqlSchemaAdapter` factory. The linchpin: `buildMssqlRawCatalog` (`map.ts`) is
already tedious-free and consumes plain typed rows (`TableRow`, `ColumnRow`, …, all exported) — the sqlcmd and
manual-dump strategies parse `FOR JSON PATH` output into those SAME rows and feed `map.ts` UNCHANGED; `queries.ts`
SQL constants are reused verbatim (wrapped in `FOR JSON PATH`). Shelling out via `node:child_process` (Node
builtin, ZERO new npm deps) is NOT a "native driver" — it is a separate OS process, like invoking `git` — so
ADR-006 stays intact; consent gates the only install path, honoring "no install"; external strategies run ONLY
the catalog SELECTs, preserving read-only. Decided resolutions baked in: port location (R1), `integrated` config
without creds (R2), single factory (R3), strategy order + `StrategyExhaustionError` (R4), combined-JSON manual
dump + emitter (R5), guided-install B1 only (R6), transparent-but-logged selection (R7), read-only inviolable +
gitignored dump + anonymized docs/codename rule (R8).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/ports/connectivity-strategy.ts` | New | Driver-free `ConnectivityStrategy` port (core types only) |
| `src/core/errors.ts` + barrel | Modified | Add `StrategyExhaustionError` (lists strategies tried + why) |
| `src/adapters/engines/mssql/strategies/` | New | native, sqlcmd, manual-dump, guided-install + ordered registry |
| `src/adapters/engines/mssql/map.ts` | Reused | UNCHANGED — fed by sqlcmd/manual-dump parsed rows |
| `src/adapters/engines/mssql/queries.ts` | Reused | SQL constants wrapped in `FOR JSON PATH` for sqlcmd/emitter |
| `src/adapters/engines/mssql/*factory*` | Modified | `createMssqlSchemaAdapter` selects strategy (back-compat) |
| `src/infra/config/schema.ts` + `parse-config.ts` + `resolve-secrets.ts` | Modified | `integrated` mode; no creds required/resolved |
| `src/infra/open-connections.ts` | Modified | Pass `integrated` branch to the factory (seam, lines 79-91) |
| dump-script emitter (mssql) | New | Composes `queries.ts` + `FOR JSON` → runnable manual-dump script |
| `.gitignore` | Modified | Gitignore the local manual-dump output dir (schema + proc source are sensitive) |
| `test/` unit + golden | New | Mocked `child_process`/stdout; recorded ANONYMIZED JSON dump golden |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `FOR JSON` output split across stdout lines | High | Reassemble ALL stdout lines before `JSON.parse`; golden test pins a multi-line capture |
| `MssqlSource` union change breaks existing config | Med | `integrated` is ADDITIVE; existing SQL/NTLM configs parse unchanged; round-trip test |
| sqlcmd version multiplicity (legacy ODBC vs go-sqlcmd) | Med | Detect by capability not version; `-y 0 -h -1 -W`; on parse failure fall to next strategy + log |
| Unsafe row casting from untyped JSON | Med | Validate/normalize JSON → typed rows at the strategy boundary BEFORE `map.ts`; reject malformed |
| Shelling out misread as violating ADR-006 | Low | Documented: `child_process` is a separate process (like `git`), not a wire-protocol driver |
| External/manual path leaks a write | Low | Strategies issue ONLY catalog SELECTs; write-verb scanner extended to `strategies/`; read-only test per path |
| Dump file or docs leak the validation-database codename | Low | Dump dir gitignored; docs anonymized; codename NEVER written (R8) |

## Rollback Plan

Additive and back-compatible. Revert by deleting `src/core/ports/connectivity-strategy.ts`, the
`src/adapters/engines/mssql/strategies/` folder + dump emitter, removing the `integrated` arm from `schema.ts`/
`parse-config.ts`/`resolve-secrets.ts`, restoring the `open-connections.ts` mssql branch, and dropping
`StrategyExhaustionError`. `map.ts`, `queries.ts`, the existing tedious path, core, storage, query and the
SQLite adapter remain untouched and green; existing SQL-auth/NTLM configs keep working.

## Dependencies

- ZERO new npm deps — detection and external-tool execution use `node:child_process` (Node builtin);
  ADR-006 "100% JS drivers" and ADR-007 closed list both honored.
- Consumes existing contracts UNCHANGED: `buildMssqlRawCatalog` (`map.ts`), `queries.ts`, `RawCatalog`,
  `ExtractionScope`, the `Logger` port, `createMssqlSchemaAdapter`, `parse-config`/`resolve-secrets`.
- External, OPTIONAL at runtime: an installed tool (`sqlcmd`, already present on the dev machine via SSMS).

## Recommended Apply Batch Ordering

1. Port + `StrategyExhaustionError` + config `integrated` mode (schema/parse/resolve).
2. sqlcmd strategy (`-E`, FOR JSON reassembly, JSON→typed rows) reusing `map.ts` + `queries.ts`.
3. Ordered registry + selection in `createMssqlSchemaAdapter`; `open-connections.ts` wiring.
4. Manual-dump strategy + dump-script emitter + gitignored output dir + recorded golden.
5. Guided-install strategy (consent gate, official-source recipe) + `Logger`-port transparency/verbosity.
6. Tests / boundary (read-only-on-all-paths, write-verb scan over `strategies/`) / lint sweep.

## Success Criteria

- [ ] `ConnectivityStrategy` port in core imports ONLY core types (no driver/tool/`child_process`) — ADR-004 clean.
- [ ] `integrated` mssql config parses/resolves WITHOUT any user/password/domain; existing SQL/NTLM configs unchanged.
- [ ] On an integrated-only machine, `createMssqlSchemaAdapter` auto-detects `sqlcmd`, connects via `-E`, and
      extracts the catalog through the UNCHANGED `map.ts` (sqlcmd output → typed rows).
- [ ] ≥3 SQL Server external-tool candidates are probed via `child_process` (no shell interpolation, short timeout).
- [ ] Strategy order honored; exhausting all raises `StrategyExhaustionError` listing what was tried + why.
- [ ] Manual-dump: emitter produces a runnable script; one combined JSON matching `MssqlRowInput` ingests to the
      SAME `RawCatalog`; an ANONYMIZED recorded dump is the golden (byte-identical, ADR-008).
- [ ] Guided-install prints OFFICIAL install instructions only (no automated execution), behind an explicit consent gate.
- [ ] Selection is transparent yet LOGGED via the `Logger` port with a verbosity control.
- [ ] Read-only on EVERY path: only catalog SELECTs issued; write-verb scanner covers `strategies/` and passes;
      dump output gitignored; no validation-database codename written anywhere.
- [ ] ZERO new npm dependencies; existing tedious path and SQLite adapter remain green.
