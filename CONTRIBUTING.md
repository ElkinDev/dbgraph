# Contributing to dbgraph

Thanks for helping build dbgraph. This project is developed **spec-first** and
**test-first**; the sections below describe the exact workflow and the quality gate
every change must pass. All claims here are grounded in `package.json`, `openspec/` and
the repository's git hooks — not convention from memory.

## Setup

Requires **Node.js >= 22** (`package.json` `engines.node`). The repository pins
`24.18.0` in `.nvmrc` as the Node version used for the SEA (single-executable) binary
builds.

```bash
npm ci
npm run hooks:install   # wires the leak-scan git hooks (see "Leak-scan" below)
```

`npm run hooks:install` sets `core.hooksPath` to `scripts/git-hooks`, activating the
`pre-commit` and `commit-msg` leak-scan hooks. Run it once after cloning.

## The quality gate (run before every commit)

Every change MUST pass all four checks. Documentation-only changes still run them (the
leak-scanner is part of the test suite).

| Check | Command | Requirement |
|-------|---------|-------------|
| Type-check | `npx tsc --noEmit` | Clean under strict TypeScript. No `any`. |
| Lint | `npm run lint` | 0 errors / 0 warnings (`eslint .`). |
| Tests | `npm test` | All tests green (`vitest run`). |
| Leak-scan | (part of `npm test`) | No secrets or denylisted identifiers in tracked files. |

`npm run format` (`prettier --write .`) is available to auto-format.

## Test tiers

The three tiers are **separate** — only the unit tier runs by default.

- **Unit** — `npm test` (`vitest run`). The default matrix: fast, hermetic, no Docker,
  no network. This is the tier the quality gate above runs.
- **Integration** — `npm run test:integration`
  (`vitest run --config vitest.integration.config.ts`). Materializes real databases via
  Docker/Testcontainers (`testcontainers` is a devDependency). These tests are **gated**
  by the `DBGRAPH_INTEGRATION=1` environment variable and skip-with-reason when it is
  unset, so the unit matrix never starts a container
  (`openspec/specs/mongodb-extraction/spec.md`).
- **Binary smoke** — `npm run smoke:binary`
  (`vitest run --config vitest.smoke.config.ts`). Exercises the built single-file binary
  with `node_modules` absent (`openspec/specs/binary-distribution/spec.md`). Separate
  from `npm test`.

There is also an **opt-in `sqlcmd` CI lane** planned for the SQL Server external-tool
transport, whose flag/encoding/chunking breaks do not surface in the default matrix
(`docs/findings/connectivity-environments.md` F-7).

## Strict TDD

This repository practices **strict test-driven development** (`openspec/config.yaml`
`strict_tdd: true`; `rules.apply` — "STRICT TDD — failing test first for everything
under `src/core`"). For each unit of behavior:

1. **RED** — write the failing test first, with a `RED → GREEN` header comment stating
   the behavior under test.
2. **GREEN** — write the minimum code to make it pass.
3. **REFACTOR** — clean up with the test still green.

Assertions are exact/golden-pinned (`.toBe` / `.toStrictEqual`); existence-only
assertions (`.toBeDefined()`) are not accepted where an exact value is knowable.

## Spec-driven development (openspec)

Substantial changes go through the **openspec** cycle before implementation. Each change
lives under `openspec/changes/<change-name>/` and moves through:

```
proposal → spec → design → tasks → apply → verify → archive
```

Capability specs are the source of truth and live under `openspec/specs/<capability>/`.
Specs use Given/When/Then scenarios with RFC-2119 keywords and reference user-story IDs
(`US-xxx`). See `openspec/config.yaml` for the per-phase rules.

## Commits and branches

- **Conventional commits.** Use `type(scope): summary`, e.g.
  `feat(install): ...`, `docs(readme): ...`, `fix(mssql): ...`. Reference the user story
  (`US-xxx`) where relevant. Do not add tool/AI attribution.
- **Branches.** Work on a dedicated branch per change — do not commit directly to the
  default branch.
- **Never commit generated artifacts.** `dist/`, `build/`, `coverage/`, `.dbgraph/` and
  `.env` are git-ignored (`.gitignore`); the graph index and build outputs are never
  committed.
- Everything public is written in **English** (`openspec/config.yaml`).

## Leak-scan

Secrets are referenced only as `${env:VAR}` and never written to disk as literals.
Internal infrastructure names / codenames must never reach the repository. Two layers
enforce this:

- **Git hooks** (`scripts/git-hooks/pre-commit`, `commit-msg`) scan staged additions and
  the commit message against a git-ignored `.leakscan-denylist.local` file. A match is
  reported only by its entry index — the term itself is never echoed.
- **The leak-scan test** (`test/security/no-secret-leak.test.ts`, part of `npm test`)
  scans every tracked text file for inline URL credentials (a `user:password@` segment
  embedded in a connection URL) and for denylisted identifiers supplied via
  `LEAKSCAN_DENYLIST` or `.leakscan-denylist.local`.

If a commit is blocked, remove the flagged content — do not weaken the scanner.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) for how to report it privately.
