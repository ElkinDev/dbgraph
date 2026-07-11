# Proposal: shipped-artifact-fixes

## Intent

`@elkindev/dbgraph@1.1.0` shipped with TWO confirmed defects that make it fail for real users. Fix both for `1.1.1`.

**Bug 1 (broken + security).** `dbgraph install` writes `npx -y dbgraph-mcp` into all 6 agents' MCP configs. No registry package named `dbgraph-mcp` exists (404 verified); the bin lives INSIDE `@elkindev/dbgraph` (`bin: { "dbgraph-mcp": "./dist/mcp.js" }`). Registry users get a broken command AND the free name is squattable — every agent would auto-execute a malicious package with `-y`.

**Bug 2 (broken connectivity).** The bundled CJS dist cannot connect live to SQL Server. `native-tedious.strategy.ts:160` does `const { ConnectionPool } = await import('mssql')`; under Node's real CJS->ESM interop in the bundle, `ConnectionPool` lives ONLY on `.default` -> `new undefined()` for every SQL-auth config. Masked because tests exercise `src` via vitest (which lifts CJS named exports), never the built dist.

## Scope

### In Scope
- Fix the install command to `npx -y -p @elkindev/dbgraph dbgraph-mcp` at every emission site + manual snippets + README + test goldens.
- Fix mssql to interop-safe driver resolution (match pg/mysql/mongodb); add an injectable import seam.
- Audit every optional-driver dynamic import (pg, mysql2, mongodb, better-sqlite3, node:sqlite) with a per-site verdict.
- Add a gated dist-level test that connects through the BUILT dist against a live container — closes the masking class.

### Out of Scope
- TLS config fields (`trustServerCertificate`/`encrypt`) — real gap, separate backlog change.
- Version bump / CHANGELOG / release steps — happen after this change archives.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `mcp-server`: `install` and `install --project` write the scoped `-p @elkindev/dbgraph` command.
- `mssql-extraction`: optional mssql driver resolved interop-safely; connectivity verified against the bundled artifact.

## Approach

Two-batch strict TDD. Batch 1: both fixes with fast Docker-free REDs (update npx goldens; inject a CJS-shape module for the interop). Batch 2: the dist-level masking-class closer — its own harness. Fixes match the codebase's existing interop-safe sibling pattern (ADR-006); no new abstractions, the shared `loadOptionalDriver` seam stays byte-identical.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/cli/commands/install.ts` | Modified | Entry + Codex render + manual snippets -> scoped npx |
| `README.md` | Modified | MCP section command string |
| `test/cli/commands/install.test.ts` | Modified | ~41 arg goldens updated |
| `src/adapters/engines/mssql/strategies/native-tedious.strategy.ts` | Modified | Interop-safe resolution + import seam |
| `test/adapters/engines/mssql/dist-connect.integration.test.ts` | New | Gated dist-level live-connect test |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| npx `-p` invocation doesn't resolve the bin | Low | Verified vs `package.json` bin map; live smoke in verify |
| Other drivers latent, not just mssql | Low | Full audit done: pg/mysql2/mongodb/sqlite already safe |
| `config.yaml` says integration unavailable | Med | Stale — `testcontainers` installed, integration suites run; dist test self-gates |

## Rollback Plan

Each fix is an isolated edit; revert the `install.ts` and strategy commits. Delta specs and the new test are additive — deleting the change folder + the new test file fully reverts.

## Dependencies

- Docker + `DBGRAPH_INTEGRATION=1` for Batch 2 (gated; skips cleanly otherwise).
- A local build (`npm run build`) so the dist-level test has an artifact.

## Success Criteria

- [ ] `npx -y -p @elkindev/dbgraph dbgraph-mcp` resolves and runs the bin from the published package.
- [ ] All 6 agents' written configs use the scoped command; goldens updated.
- [ ] Bundled dist connects live to SQL Server (SQL auth) — dist-level test GREEN.
- [ ] Full suite >= 3731 (incl. 4 skipped); lint + `tsc --noEmit` clean.
