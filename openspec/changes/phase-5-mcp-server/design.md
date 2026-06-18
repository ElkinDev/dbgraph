# Design: Phase 5 — MCP Server

## Technical Approach

A DRIVING adapter under `src/mcp/` (mirrors the Phase-4 CLI, ADR-004) importing ONLY `src/index.ts`
+ Node builtins + `@modelcontextprotocol/sdk`. 6 tools map ~1:1 to the public API; 2 NEW orchestrators
(`object`, `precheck`) compose existing store reads — zero `graph-query` change. Every byte of tool
output comes from a PURE, golden-pinned `src/core/present/` formatter (ADR-008). The COMPACT line
grammar is authored in `docs/format-spec.md` FIRST, with token budgets measured on the SQLite torture
fixture (`test/fixtures/sqlite/`) before being pinned. Strict TDD: every formatter, the precheck
extractor, the install merge, and the instructions string are RED goldens before code; tools are
proven via an in-process `InMemoryTransport` SDK harness over the torture fixture.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
|1|Line grammar|`name(col TYPE [PK\|FK→ref][NN], …) [Nidx, Ntrg!]`; edge lines `→ qname [kind]` / `← qname [kind]`; sections `OBJECT`/`COLUMNS`/`RELATED`/`WRITES`. `detail`: brief=header+counts, normal=+grouped neighbors, full=+bodyHash/level/`hasDynamicSql` ⚠. Bare qname when `schema===null` (SQLite). Pagination `offset`+`limit`+`hasMore`|verbose JSON; per-tool ad-hoc text|extends `formatExplore`; `!` flags hidden trigger logic (the value lever); SQLite has no schema prefix|
|2|Token budgets|EMPIRICAL: render each tool×detail over the torture fixture, count `ceil(chars/4)`, record in `docs/format-spec.md` table; budgets **TBD until measured** then pinned|guessing budgets|char/4 is the documented LLM approximation; the fixture is the only committed real corpus|
|3|Formatters|All PURE in `src/core/present/`, re-exported via `src/core/index.ts`; orchestrators assemble view structs then call them|store calls inside formatters|ADR-004 (`present/` imports core types only); ADR-008 determinism; reuse with CLI|
|4|`openConnections` move|Relocate to NEUTRAL `src/infra/open-connections.ts`; re-export via `src/index.ts`; CLI + MCP import the barrel|duplicate it in mcp; ADR exception|cli↔mcp boundary forbids MCP importing `src/cli/**`; infra MAY import adapter factories (it is the composition seam)|
|5|Precheck engine|PURE `extractIdentifiers(ddl)` reusing the MSSQL `tokenizer.ts` `[\w.]+` + bracket-strip patterns for `ALTER TABLE`/`CREATE\|DROP INDEX`/`ADD\|DROP COLUMN`; match via `getNodeByQName`/`search`; aggregate `getImpact` deduped; tag `confidence:'parsed'`|`node-sql-parser`|zero new dep (ADR-007); ~90% coverage; unit-testable in isolation|
|6|`object` orchestrator|`getNodeByQName`→ `getNeighbors` over `has_column`/`has_index`/`has_constraint`/`fires_on` → `ObjectView` struct → `formatObject`|new core query|composes existing reads only; no `graph-query` delta|
|7|Server shape|`src/mcp/server.ts` (`#!/usr/bin/env node`, `StdioServerTransport`); `ListTools`/`CallTool` handlers; one tool-name→`{schema, run}` table; `DbgraphError`→MCP error; static `initialize` instructions from `src/mcp/instructions.ts`|SDK high-level helpers unverified|mirrors CLI dispatch table; APPLY VERIFIES the SDK stdio + `InMemoryTransport` API against the pinned version|
|8|SDK + packaging|`@modelcontextprotocol/sdk` PINNED exact as a `dependency`; third tsup entry `mcp: src/mcp/server.ts` (esm, shebang banner, `clean:false`); `package.json` `"bin": { "dbgraph-mcp": "./dist/mcp.js" }`|loose semver|ONLY new runtime dep (ADR-007); pin → APPLY confirms API|
|9|`dbgraph install`|`resolveConfigPath(platform, env)`: win `%APPDATA%\Claude\claude_desktop_config.json`, linux `~/.config/Claude/…`; idempotent `mergeMcpConfig` adds `mcpServers.dbgraph`; `--remove` deletes the key; print manual snippet when path absent. fs/path injected as a seam|spawn an installer|pure-ish core unit-testable; US-024 minimum viable (Claude only)|
|10|Boundary test|Extend `test/cli/boundaries.test.ts` (or sibling) so `src/mcp/**` fails on any `/adapters/` or `/cli/` specifier or DB driver; keep negative-control planted import|new tool|reuses the regex scanner already proven|

## Data Flow

```
CallTool(name,args) ─ src/mcp/server.ts
   │ openConnections(root)  [src/infra → barrel]
   ▼
tool.run(store, args) ── getNeighbors/getImpact/findJoinPath/search/getNodeByQName/listSnapshots
   │ assemble *View struct
   ▼
format{Explore,Search,Object,Related,Impact,Path,Status,Precheck}()  [PURE, src/core/present]
   ▼ compact text + {offset,limit,hasMore}
MCP CallToolResult.content[].text     (store/adapter closed in finally)
```

## Interfaces / Contracts

```ts
// src/core/present/* — all PURE, core-types-only, trailing newline, deterministic
formatSearch(v: SearchView, d): string          // SearchView { hits: SearchHit[]; total; offset; limit }
formatObject(v: ObjectView, d): string          // node + columns/indexes/constraints/triggers (NeighborGroups)
formatRelated(v: ExploreView, d): string         // MAY reuse ExploreView
formatImpact(v: ImpactView, d): string           // ImpactView { node; result: ImpactResult; resolve(id)->qname }
formatPath(v: PathView): string                  // PathResult + endpoint qnames
formatStatus(v: McpStatusView): string           // MCP variant of StatusView (+ drift)
formatPrecheck(v: PrecheckView): string          // matched objects + aggregated impact + confidence
export function extractIdentifiers(ddl: string): readonly string[]   // PURE, reuses tokenizer regex
```
`formatImpact` needs a node-id→qname resolver because `ImpactResult` chains carry node **ids**.

### In-process harness skeleton (`test/mcp/harness.ts`)
```ts
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a); await client.connect(b);
const r = await client.callTool({ name, arguments });
const text = (r.content[0] as { text: string }).text;   // golden-pinned per tool×detail
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `docs/format-spec.md` | Create | Grammar + measured per-tool/`detail` budgets (US-019) |
| `src/core/present/{search,object,related,impact,path,status,precheck}.ts` | Create | PURE formatters; re-export via `src/core/index.ts` |
| `src/infra/open-connections.ts` | Create (moved) | From `src/cli/config/`; re-exported via `src/index.ts` |
| `src/cli/config/open-connections.ts` | Delete | Replaced by infra; update CLI imports (`dispatch.ts`, `init.ts`) |
| `src/mcp/server.ts` | Create | stdio entry, tool table, error map, `initialize` |
| `src/mcp/instructions.ts` | Create | Static instructions string (US-018) |
| `src/mcp/precheck.ts` | Create | `extractIdentifiers` + match + `getImpact` aggregation |
| `src/cli/commands/{affected,install}.ts` + `dispatch.ts` | Create/Modify | `affected` (`--json`) over precheck core; `install`/`--remove` |
| `package.json` / `tsup.config.ts` | Modify | Pinned SDK dep; `dbgraph-mcp` bin; third entry |
| `test/cli/boundaries.test.ts` | Modify | Add `src/mcp/**` rule + negative control |
| `test/mcp/**`, `test/core/present/*.test.ts` | Create | Goldens, precheck/install units, in-process E2E |

## Testing Strategy

| Layer | What | Approach (TDD RED-first) |
|-------|------|--------------------------|
| Unit | each formatter | golden per detail over fixed `*View` structs (mirrors `explore-format.test.ts`) |
| Unit | `extractIdentifiers` | inline DDL strings (ALTER/INDEX/COLUMN, bracket/case); no DB |
| Unit | install merge | inject fs/path seam; idempotent add, `--remove`, manual fallback |
| Unit | instructions | golden string equality |
| E2E | 8 tools | `InMemoryTransport` harness over torture fixture; golden per tool×detail; tool-output text pinned byte-for-byte |
| Boundary | `src/mcp/**` | scanner + planted-import control |

## Migration / Rollout

Additive except the `openConnections` relocation (single-file move + import update; rollback = move
back). No data migration.

## Open Questions

- [ ] Exact pinned `@modelcontextprotocol/sdk` version + its `StdioServerTransport`/`InMemoryTransport`/`CallToolResult` shape — APPLY verifies against the pinned version before wiring tools (design assumes the documented shape).
- [ ] Final token budgets — filled in `docs/format-spec.md` AFTER the first fixture measurement.
