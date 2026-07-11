# Delta for mssql-extraction

> Bug 2 fix. Two NEW requirements — the interop-safe resolution contract and the dist-level
> verification tier. These sit alongside the existing "Missing mssql driver names the install command"
> requirement (both govern the ADR-006 dynamic `import('mssql')`), and do not modify it.

## ADDED Requirements

### Requirement: Optional mssql driver is resolved interop-safely across ESM and bundled CJS

The mssql adapter loads the optional `mssql` driver via a dynamic `import()` (ADR-006). Because the SHIPPED
artifact is a bundled CJS dist, `await import('mssql')` resolves under Node's CJS->ESM interop, which exposes
the CommonJS module ONLY under the namespace `.default` property. The native-tedious strategy MUST therefore
resolve `ConnectionPool` interop-safely — reading it from the module namespace OR from `.default` — matching
the existing pg / mysql2 / mongodb factory pattern. It MUST NOT destructure a named export directly off the
dynamic-import result, which yields `undefined` (and a `new undefined()` crash) in the bundled dist.

#### Scenario: ConnectionPool resolves when the driver arrives under `.default` (bundled-CJS shape)

- GIVEN the mssql module is provided in the bundled-CJS interop shape `{ default: { ConnectionPool } }`
- WHEN the native-tedious strategy loads the driver and builds a pool
- THEN it resolves `ConnectionPool` from `.default` and constructs a real pool (never `new undefined()`)

#### Scenario: ConnectionPool resolves when the driver exposes a top-level named export (ESM/vitest shape)

- GIVEN the mssql module exposes `ConnectionPool` at the namespace top level
- WHEN the strategy loads the driver
- THEN it resolves the same constructor without relying on `.default`

#### Scenario: Absent driver still names the install command (unchanged behavior)

- GIVEN the `mssql` package is not installed
- WHEN the strategy loads it via dynamic import
- THEN the raised `ConnectionError` message still contains the exact `npm i mssql` command

### Requirement: Live SQL Server connectivity is verified against the bundled dist, not vitest-loaded src

A gated integration test MUST exercise the BUNDLED `dist/index.cjs` `createMssqlSchemaAdapter` against a live
SQL Server container — NOT the vitest-loaded `src` — so that Node's real CJS->ESM interop is on the connection
path. This closes the masking class in which vitest lifts CommonJS named exports and hides a defect that only
manifests in the shipped artifact. The test MUST self-gate on `DBGRAPH_INTEGRATION=1` AND the presence of a
built `dist/`, skipping cleanly when either is absent so the default `npm test` gate is unaffected and remains
CI-independent (`dist/` is gitignored).

#### Scenario: Bundled dist connects live with SQL authentication

- GIVEN a running SQL Server container and a built `dist/index.cjs`
- WHEN `createMssqlSchemaAdapter(config)` from the DIST is invoked through real Node against the container with SQL auth
- THEN it establishes a usable connection and extracts a catalog (no `new undefined()` failure)

#### Scenario: Gate is skipped cleanly when the dist or Docker is absent

- GIVEN `DBGRAPH_INTEGRATION` is unset OR `dist/` has not been built
- WHEN the suite runs under the default `npm test`
- THEN the dist-level test is SKIPPED (never failing) and the suite floor of 3731 tests (incl. 4 skipped) holds
