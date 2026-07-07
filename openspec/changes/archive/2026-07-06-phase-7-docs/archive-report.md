# Archive Report — phase-7-docs

**Project**: dbgraph
**Change**: `phase-7-docs`
**Branch**: `closeout`
**Artifact store**: openspec (files)
**Archived**: 2026-07-06
**Verdict at archive**: PASS — 0 CRITICAL / 0 WARNING / 2 SUGGESTION
**Shipped commits**: `05b38bd` (SDD planning — proposal, spec, design, tasks; live 6-agent project-config matrix verification), `3a2b65f` (feat(install) — `--project` flag across all 6 agents, US-038, Batch 1 code), `052d6e9` (docs(readme) — rewrite for shipped reality: matrix, quickstart, MCP, troubleshooting, limitations), `d594c25` (docs — CONTRIBUTING and SECURITY), `a9be4db` (docs(github) — issue and PR templates)

---

## Executive Summary

`phase-7-docs` (US-038) closes two gaps: a functional one (`dbgraph install` only wired agent config at
user-home scope, with no project-scoped option) and a documentation one (README/CONTRIBUTING/SECURITY/
issue-templates had drifted from the shipped multi-agent, multi-dialect reality). Batch 1 shipped
`--project` — re-rooting all 6 agents' config resolution to the project directory, live-verified against
each agent's official docs on 2026-07-06, with Codex's project scope carrying a trust-caveat summary
line because Codex only loads project MCP servers for trusted projects. Batches 2–4 rewrote the public
docs set with a content-free, spec-cited style (every feature-matrix cell and every CLI example traces to
a canonical spec) and added the missing CONTRIBUTING/SECURITY/GitHub templates. The verifier found 10/10
spec scenarios behaviorally COMPLIANT (exact-byte-pinned tests), the full gate green (tsc clean, lint
0/0, 2952/2952 tests, up from a 2907 baseline), zero golden drift, and nothing pushed. Zero CRITICAL,
zero WARNING findings. Safe to archive.

---

## What Shipped

| Area | Change |
|------|--------|
| `src/cli/commands/install.ts` | Modified. Adds the `--project` boolean flag; re-roots per-agent config-path resolution to `cwd` (default) instead of user-home; CREATE-when-absent semantics (opt-in departure from the default skip-if-absent); Codex project writes reuse the existing `mergeCodexToml` writer and append a trust-caveat suffix to the summary line; global (no-flag) path is byte-identical/unchanged (verified by diff against the else-branch). |
| `src/cli/cli.ts` | Modified. `USAGE_TEXT` `install` line extended to mention `--project` alongside `--remove`. |
| `src/cli/dispatch.ts`, `src/cli/parse/args.ts` | Modified. `project` added to `BOOLEAN_LONG_FLAGS` / dispatch wiring so `--project`/`--project --remove` parse correctly. |
| `test/cli/commands/install.test.ts` | Extended. New F.4–F.9 scenarios: Cursor absent-file create, idempotent merge preserving unrelated keys, Codex exact-byte TOML + trust-caveat, dormant unsupported-agent path (synthetic seam), `--remove --project` never-deletes + absent-is-no-op, `${env:VAR}` preservation, unchanged global path. |
| `test/cli/cli.test.ts` | Extended. Banner pin extended to assert the exact `--project`-inclusive `install` line text. |
| `README.md` | Rewritten. Feature-matrix (24 cells, each cited to its canonical spec: sqlite-extraction, mssql-extraction, pg-extraction, mysql-extraction, mongodb-extraction), quickstart, MCP tool overview, troubleshooting (F-1..F-7 only), Limitations section (no overclaim: "runs from source today", version 0.0.0). |
| `CONTRIBUTING.md` | New. Dev setup, strict-TDD pointer (config.yaml `strict_tdd: true`), `.nvmrc`/`engines.node` pins, test/lint/format script inventory. |
| `SECURITY.md` | New. Read-only-against-target invariant, credential handling, no-published-release-yet disclosure. |
| `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md` | New. Bug report requests `dbgraph doctor` content-free output (spec-justified); PR template pins the tsc/lint/vitest/leak-scan gate + openspec SDD checklist + conventional-commit requirement. |
| `openspec/changes/phase-7-docs/tasks.md` | Progress tracking (26/26 `[x]` across 4 batches). |

Definition of Done: 7/7 items `[x]`. Tasks: 26/26 across 4 batches (Batch 1: 11 code+test tasks; Batches
2–4: 15 docs-verification tasks). Checkbox state matches shipped commits (independently re-verified by
sdd-verify).

---

## Validation (as measured by sdd-verify, re-confirmed at archive)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (strict, no `any`) | PASS — exit 0 |
| `npm run lint` (`eslint .`) | PASS — exit 0, 0 errors / 0 warnings |
| `npm test` (`vitest run`) | PASS — 2952 passed / 2952, 0 failed, 0 skipped, 172 files (baseline 2907 → 2952) |
| Leak-scan (`test/security/no-secret-leak.test.ts`, part of `npm test`) | PASS — green |
| `test/golden` drift | PASS — none; no golden/snapshot/fixture file touched |
| Files touched vs. design's File Changes table | PASS — exactly the 15 files listed (impl + tests + docs + `.github/*` + `tasks.md`) |

---

## Spec Compliance (from verify-report.md)

10/10 scenarios COMPLIANT (exact-byte-pinned passing tests) — see the Spec Compliance Matrix in
`verify-report.md` for the full per-scenario test citation. Adversarial code review independently
confirmed: (a) the global (no-`--project`) install path is byte-identical to pre-change behavior, (b) 3
pinned verbatim strings byte-match spec/code/test/README/live `--help`, (c) `--remove --project` can
never delete a file (no unlink/rm primitive exists in `install.ts`), (d) `${env:VAR}` indirection passes
through unexpanded, (e) the dormant unsupported-agent branch is unreachable in production (all 6
`AGENT_TABLE` rows carry `projectPath`) and reachable only via an injected test seam.

## Docs Audit (measured by sdd-verify)

24 feature-matrix cells checked against their cited canonical specs (SQLite ×8, SQL Server ×8, PostgreSQL
×6, MySQL ×7, MongoDB ×9) — 24/24 traced correctly. 3/3 content-free CLI examples run via source entry
(`--version`, `--help`, `doctor`) exit 0 and match documented behavior. No-overclaim grep across
README/CONTRIBUTING/SECURITY/templates: zero hits for `download|release|stable|phase 0|pre-alpha|do not
use` in an overclaiming sense (the 5 `release` hits are all negated/qualified, e.g. "no published release
yet"). Troubleshooting section cites only F-1..F-7, matching `docs/findings/connectivity-environments.md`
and the connectivity specs.

## Issues Found (carried from verify-report.md, preserved verbatim)

CRITICAL: None. WARNING: None.

SUGGESTIONS (non-blocking):

1. **Pre-existing doubled-shebang bug in `dist/cli.js`** (the Node shebang appears twice, breaking `node
   dist/cli.js`). NOT introduced by this phase — it is a build-tooling defect (out of scope for
   `phase-7-docs`); the content-free CLI examples were verified via the source entry
   (`npx tsx src/cli/cli.ts`) instead, and the README does not overclaim (it states "runs from source
   today", no published binary). **Disposition**: recorded as a follow-up fix queued by the orchestrator
   for a future change — not remediated as part of this archive.
2. **Spec-delta promotion deferred to archive**: the design's File Changes table listed
   `openspec/specs/mcp-server/spec.md` and `openspec/specs/cli-config/spec.md` as "Modify (delta)", but
   the canonical files were unchanged at verify time — the deltas lived under
   `openspec/changes/phase-7-docs/specs/` per the openspec convention, pending `sdd-archive`.
   **Disposition**: promoted in this archive — see "Specs Merged to Main" below. This SUGGESTION is now
   resolved.

---

## Specs Merged to Main

| Domain | Action | Canonical path |
|--------|--------|----------------|
| `mcp-server` | Updated — 1 ADDED requirement inlined into the base `## Requirements` list (no dated subsection) | `openspec/specs/mcp-server/spec.md` |
| `cli-config` | Updated — 1 MODIFIED requirement replaced in place under the existing dated provenance section | `openspec/specs/cli-config/spec.md` |

### Merge detail — mcp-server

**ADDED**: `### Requirement: dbgraph install --project scopes agent config to the project directory` (7
scenarios: absent-file create, idempotent merge preserving unrelated keys, Codex exact-TOML +
trust-caveat, dormant future-agent exclusion, `--remove --project` never-deletes, `--remove --project`
absent-is-no-op, `${env:VAR}` preservation).

Placement rule followed: `mcp-server/spec.md` carries **no** dated `## Requirements Added by …`
subsection anywhere in the file — every requirement, including the original US-024 "dbgraph install
idempotently wires the agent MCP config" (which itself absorbed the 9.5a multi-agent expansion in
place, inline, with no dated header), lives directly under the single base `## Requirements` list. This
matches the LOCAL precedent already established in this exact file (consistent with how `graph-storage`'s
9.5b merge also inlined new requirements with no dated subsection, per the convention note recorded in the
`ux-observability` archive report). Per that local convention, the new requirement was inserted directly
into the base list — immediately after `### Requirement: dbgraph install idempotently wires the agent MCP
config` and before `### Requirement: dbgraph affected mirrors precheck via the CLI` — since it is a direct
extension of the install requirement it now sits beside. No dated subsection was created in this file.

### Merge detail — cli-config

**MODIFIED in place**: `### Requirement: CLI top-level help/usage banner accurately describes every
command`. This requirement was itself added earlier the SAME day (2026-07-06) by the `ux-observability`
archive, which appended it under a new dated section `## Requirements Added by ux-observability
(2026-07-06)` (the file's own established convention for ADDED requirements — see that archive's merge
detail). `phase-7-docs`'s delta marks it MODIFIED (extending the `install` line contract to also require
the `--project` mention), so per the task instruction the existing requirement body was replaced in place
with the delta's extended text — including its updated `(Previously: ...)` provenance line, which now
correctly describes the IMMEDIATELY PRIOR (ux-observability-era) text ("documented only `--remove`") as
the baseline being superseded — while the **section provenance heading itself was left unchanged**
(`## Requirements Added by ux-observability (2026-07-06)` still stands, since that is where this
requirement structurally lives; a second dated section was NOT created for the same-day, same-section
follow-on edit). The requirement gained one new scenario (`install banner line documents the --project
flag with the exact text`, pinning the literal banner string), for 3 scenarios total (was 2).

**Convention consistency note**: this is the same "replace in place, keep provenance heading" approach
used by the `ux-observability` archive for the `sync` requirement's MODIFIED merge; it was chosen here
over inventing a new dated subsection because the requirement being modified was added TODAY, in this
same file, under a heading that already accurately attributes it — stacking a second dated section for a
same-day amendment would fragment one requirement's history across two headings for no audit benefit.

---

## Archive Contents (current location, PRE-MOVE)

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/mcp-server/spec.md` | Present (delta — 1 ADDED requirement; merged to canonical, see above) |
| `specs/cli-config/spec.md` | Present (delta — 1 MODIFIED requirement; merged to canonical, see above) |
| `design.md` | Present |
| `tasks.md` | Present (26/26 tasks `[x]`; 4 batches; DoD 7/7 `[x]`) |
| `verify-report.md` | Present (PASS, 0 CRITICAL / 0 WARNING / 2 SUGGESTION, 2952/2952 tests) |
| `archive-report.md` | This file |

**GOTCHA (same as the `ux-observability` archive)**: `verify-report.md` and `archive-report.md` are
UNTRACKED in git (never `git add`-ed by earlier phases). A plain `git mv
openspec/changes/phase-7-docs openspec/changes/archive/2026-07-06-phase-7-docs` only relocates TRACKED
files — the two untracked `.md` files must be explicitly `git add`-ed (before or after the move) or they
will not travel with the rest of the folder.

---

## Closing Steps (executed on `closeout`)

```bash
cd /c/Users/ecardoso/dev/dbgraph

# 1. Move the change folder (git mv only relocates TRACKED files)
git mv openspec/changes/phase-7-docs openspec/changes/archive/2026-07-06-phase-7-docs

# 2. Explicitly add the untracked files so nothing is lost (the GOTCHA above)
git add openspec/changes/archive/2026-07-06-phase-7-docs/verify-report.md
git add openspec/changes/archive/2026-07-06-phase-7-docs/archive-report.md

# 3. Add the canonical spec edits
git add openspec/specs/mcp-server/spec.md
git add openspec/specs/cli-config/spec.md

# 4. Confirm nothing remains at the old path and the new folder is complete
git status

# 5. Re-confirm the local gate is green on closeout before committing
npx tsc --noEmit
npm run lint
npm test

# 6. Single conventional commit (no PR, no push, no gh, no AI attribution)
git commit -m "chore(sdd): archive phase-7-docs; sync mcp-server and cli-config canonical specs (US-038)"
```

---

## SDD Cycle

PLAN → SPEC → DESIGN → TASKS → APPLY (4 batches, commits `05b38bd` + `3a2b65f` + `052d6e9` + `d594c25` +
`a9be4db`) → VERIFY (PASS, 0C/0W/2S) → **ARCHIVE (this report; spec merge complete; physical move/commit
below)**.

Next recommended: fix the pre-existing `dist/cli.js` doubled-shebang bug (SUGGESTION-1) before any v1.0
binary ships — tracked as a follow-up, not part of this change's scope.
