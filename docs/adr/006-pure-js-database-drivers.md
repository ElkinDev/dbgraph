# ADR-006: Connectivity with 100% JavaScript drivers

**Status:** Accepted · **Date:** 2026-06-11

**Context:** The dev machine does not allow installing system-level software (ODBC, OLE DB,
native clients). End users appreciate the same.

**Decision:** drivers that implement the engine's wire protocol in pure JS: `mssql`
(tedious/TDS), `pg`, `mysql2`, `mongodb`. Lazy loading via dynamic `import()` and
`optionalDependencies` on the npm path (installing dbgraph does not pull 5 drivers); static
bundling in the binaries.

**Consequences:** zero system prerequisites; SQL Server supports SQL auth and NTLM but NOT
Kerberos SSO (tedious limitation — document it); when a driver is missing, the error states the
exact install command.
