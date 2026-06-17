---
name: dbgraph-conventions
description: Architecture and code conventions for dbgraph. Trigger - editing ANY file under src/. Enforces hexagonal dependency direction, naming, typed errors, and strict TypeScript.
---

# dbgraph conventions

## Dependency direction (hexagonal — ADR-004) — NON-NEGOTIABLE

- `src/core/**` imports NOTHING from `src/adapters`, `src/mcp`, `src/cli`, nor any DB driver.
- `src/adapters/**` import only types/ports from `src/core` and their own driver (dynamic `import()`).
- `src/mcp/**` and `src/cli/**` import only the public core API (`src/core/index.ts`).
- A violation of this rule is a blocking review finding, never a "fix later".

## Naming

- Files: kebab-case (`schema-adapter.ts`). Types/interfaces: PascalCase. Functions/vars: camelCase.
- Ports end in their role: `SchemaAdapter`, `GraphStore`, `Logger`. Implementations are prefixed
  by dialect: `MssqlSchemaAdapter`, `SqliteGraphStore`.

## Errors

- Typed error classes per category: `ConnectionError`, `PermissionError` (MUST carry the exact
  missing permission and a how-to-grant hint), `ConfigError`, `UnsupportedDialectError`.
- Never swallow errors; never throw bare strings; messages are actionable (what failed + what to do).

## TypeScript

- `strict` everywhere; `any` is forbidden (use `unknown` + narrowing).
- No `console.log` in core — use the `Logger` port.
- Public API surface is exported ONLY via `src/index.ts` / `src/core/index.ts`.
