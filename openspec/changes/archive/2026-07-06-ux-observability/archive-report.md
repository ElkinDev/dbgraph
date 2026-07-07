# Archive Report — ux-observability

**Project**: dbgraph
**Change**: `ux-observability`
**Branch**: `closeout`
**Artifact store**: openspec (files)
**Archived**: 2026-07-06
**Verdict at archive**: PASS — 0 CRITICAL / 3 WARNING (proof-strength/process, accepted non-blocking) / 5 SUGGESTION
**Verified commits**: `0db4edd` (Batch 1 — console logger + `--quiet` parse), `e98eb08` (Batch 2 — `formatSyncSummary` + `runSync` wiring, load-bearing), `0c2f819` (Batch 3 — banner fix)

---

## Executive Summary

`dbgraph sync` previously ran silent (no progress, no summary) because the CLI dispatch path never
passed a real `Logger` into `openConnections`/`runSync`, and `runSync` had no formatter or output at all.
This change wires the EXISTING `Logger` port into the CLI composition seam (no new port, no new
dependency — ADR-004/ADR-007), adds a pure golden-pinned `formatSyncSummary`, threads it through BOTH
`runSync` callers (`dispatch.ts handleSync` and `init.ts syncAfterInit`), adds a `--quiet`/`-q` verbosity
flag, and fixes the stale "Claude Desktop" single-agent wording in the top-level `--help` banner to match
the multi-agent `install` reality (9.5a SUGGESTION-1). The verifier found 10/10 spec scenarios compliant
with passing tests, the full local gate green (tsc clean, lint 0/0, 2855/2855 tests), zero `test/golden`
drift, and the MCP path untouched. Zero CRITICAL findings. Safe to archive.

---

## What Shipped

| Area | Change |
|------|--------|
| `src/cli/log/console-logger.ts` | New. `createConsoleLogger({ write?, level? })` → `Logger`; DUMB sink over an injectable write-seam (default `process.stderr.write`); level suppression (`'warn'` hides debug/info, keeps warn/error). |
| `src/cli/format/sync.ts` | New. Pure `formatSyncSummary(view: SyncSummary): string` — golden-pinned, sorted per-kind counts, upserted/deleted totals, drift state, snapshot id/fingerprint. NO timing in the pinned body (ADR-008/D4). |
| `src/cli/commands/sync.ts` | Modified. `SyncOptions` gains `logger?: Logger` (default `noopLogger`, back-compat); `runSync` now returns `Promise<SyncSummary>` (was `HandlerOutcome`), logs phase transitions. |
| `src/cli/dispatch.ts` | Modified. `handleSync` builds the console logger from `--quiet`/`-q`, passes it to `openConnections` + `runSync`, writes `formatSyncSummary(...)` to STDOUT. Sibling handlers (`status`/`query`/`explore`/`diff`/`affected`) pass the same logger so adapter strategy-selection diagnostics surface on STDERR. |
| `src/cli/commands/init.ts` | Modified. `syncAfterInit` (the SECOND `runSync` caller, previously discarded the result silently) now threads a logger and writes the formatted summary — post-init sync is observable too. |
| `src/cli/cli.ts` | Modified. `USAGE_TEXT` `install` line replaced with multi-agent phrasing consistent with `install.ts`'s `MANUAL_SNIPPET`; no more "Claude Desktop". |
| `src/cli/parse/args.ts` | Modified. `'quiet'` added to `BOOLEAN_LONG_FLAGS` so `--quiet` does not greedily consume the next token. |
| `test/cli/**` | New/extended: `log/console-logger.test.ts`, `format/sync.test.ts` (golden), `commands/sync.test.ts` (migrated + non-leakage), `commands/init.test.ts`, `dispatch.test.ts`, `parse/args.test.ts`, `cli.test.ts` (banner pin), `e2e.test.ts` (`--json` byte-identity). |

Definition of Done: 7/7 items `[x]`. Tasks: 14/14 numbered tasks `[x]` across 3 batches. Checkbox state
matches code state (independently re-verified by sdd-verify).

---

## Validation (as measured by sdd-verify)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (strict, no `any`) | PASS — exit 0 |
| `npm run lint` (`eslint .`) | PASS — exit 0, 0 errors / 0 warnings |
| `npx vitest run` | PASS — exit 0, **2855 passed / 2855**, 166 test files, 0 failed, 0 skipped |
| `test/golden` drift (`git diff test/golden/`) | PASS — none; no golden/snapshot file touched by any of the 3 commits |
| ADR-004 import graph | PASS — console-logger imports only the `Logger` type + Node builtins; `format/sync` imports nothing; no adapter-into-core, no core-into-cli |
| MCP path | UNTOUCHED — no `src/mcp` or `src/adapters/mcp` file touched by the 3 commits; `openConnections` signature unchanged (logger defaults to `noopLogger`); all MCP suites green |

**Note**: this agent (sdd-archive) did NOT re-run these commands — no shell/Bash tool is available in this
session (file tools only: Read/Edit/Write/Glob). The numbers above are as measured and reported by
`sdd-verify` in `verify-report.md`. **Re-running the gate before the archive commit lands is still
required** (see "Pending Manual Steps" below) since the merge edits themselves (spec-only, no `src/**`
touched) do not risk the gate, but the change's own commits should be re-confirmed green on `closeout`
immediately prior to committing the archive.

---

## Spec Compliance (from verify-report.md)

10/10 scenarios covered by passing tests — 8 fully COMPLIANT, 2 PARTIAL (proof-strength gaps, not
violations, see Warnings below). `mcp-server` verify-only conclusions CONFIRMED: wiring a CLI logger does
not alter the MCP path; the "Claude Desktop" wording belongs to `cli-config`, not `mcp-server`.

## Warnings Accepted (non-blocking — do not block archive)

| ID | Finding | Disposition |
|----|---------|--------------|
| W1 | Connection-secret leak vector untested at the RESOLVED-CONNECTION-IDENTITY level (only schema-name/identifier/sampled-value vectors planted). | ACCEPTED — structurally mitigated: `runSync` never receives resolved connection identity; `openConnections` is unchanged and documents secrets are never logged; `test/security/no-secret-leak.test.ts` stays green. Tracked as S5 (defense-in-depth test) for opportunistic follow-up. |
| W2 | `runSync` delete branch / `summary.deleted` never asserted non-zero in this change's own tests. | ACCEPTED — `computeDelta` delete-decision logic is unit-tested separately (`incremental.test.ts`); the wiring gap is a proof-strength note, not a behavior gap. |
| W3 | No formal TDD Cycle Evidence table (openspec mode has no engram apply-progress artifact); TDD evidence lives as per-task RED→GREEN annotations in `tasks.md`. | ACCEPTED — TDD substance independently re-verified by sdd-verify (14/14 named test files exist, GREEN, exact assertions). |

SUGGESTIONS (S1–S5, nice-to-have, no functional impact) are preserved verbatim in the archived
`verify-report.md` and not repeated here.

---

## Specs Merged to Main

| Domain | Action | Canonical path |
|--------|--------|----------------|
| `cli-config` | Updated — 1 MODIFIED requirement replaced in place ("sync is incremental by fingerprint, --full forces a rebuild" gained the observability clause + 4 new scenarios, "(Previously: ...)" note preserved); 1 requirement appended under a new dated section (see below) | `openspec/specs/cli-config/spec.md` |
| `mcp-server` | No change — delta was verify-only (no ADDED/MODIFIED/REMOVED); confirmed the CLI-logger wiring does not alter the MCP path and the banner fix belongs entirely to `cli-config` | `openspec/specs/mcp-server/spec.md` |

### Merge detail — cli-config

1. **MODIFIED in place**: "### Requirement: sync is incremental by fingerprint, --full forces a rebuild"
   (lives in the base `## Requirements` section) — replaced with the delta's expanded text: added the
   OBSERVABLE paragraph (progress + summary + content-safety + stream-discipline + `--quiet` + exit-code
   invariant) and 4 new scenarios ("sync emits a deterministic golden-pinned summary", "sync output never
   leaks secrets or sampled data", "--json payloads stay byte-identical and diagnostics go to STDERR",
   "--quiet suppresses progress but keeps warnings and errors", "Observable output does not change exit
   codes" — 5 new, 2 existing scenarios extended/kept), preserving the `(Previously: ...)` note.
2. **Effectively ADDED**: "### Requirement: CLI top-level help/usage banner accurately describes every
   command" — the delta file grouped this under its own `## MODIFIED Requirements` header, but no
   requirement by this name existed anywhere in the canonical spec, so per the archive skill's
   name-matching rule it is treated as ADDED. Appended under a NEW dated section
   `## Requirements Added by ux-observability (2026-07-06)` at the end of the file — this follows the
   file's OWN established convention (it already carries a
   `## Requirements Added by connectivity-strategies (2026-06-18)` dated section from the prior archive)
   rather than inlining it into the base `## Requirements` list.

**Convention note (deviation observed, resolved)**: two prior archives disagree on where ADDED
requirements land — `graph-storage`'s 9.5b merge inlined new requirements directly into the base
`## Requirements` list (no dated subsection), while `cli-config`'s and `mssql-extraction`'s
connectivity-strategies merge used a dated `## Requirements Added by {change} ({date})` subsection. I
followed the LOCAL precedent already present in the exact file being edited (`cli-config` already has a
dated section) for consistency within that file's own history, rather than the `graph-storage` file's
different local precedent. The `Purpose` section of `cli-config/spec.md` was intentionally left
UNCHANGED (it is already stale re: `affected`/`install`/MCP being "out of scope" — a pre-existing
staleness from before this change, not introduced by it), matching how the connectivity-strategies merge
also left `Purpose` untouched. This diverges from the `graph-storage` merge, which DID rewrite its
`Purpose` paragraph — that curatorial choice was not repeated here to avoid scope creep into stale text
unrelated to this change's two requirements.

---

## Archive Contents (current location, PRE-MOVE)

| Artifact | Status |
|----------|--------|
| `proposal.md` | Present |
| `specs/cli-config/spec.md` | Present (delta — MODIFIED sync requirement + banner requirement; merged to canonical, see above) |
| `specs/mcp-server/spec.md` | Present (delta — verify-only, no requirement changes) |
| `design.md` | Present (8 architecture decisions D1–D8; data flow; file changes table) |
| `tasks.md` | Present (14/14 tasks `[x]`; 3 batches; DoD 7/7 `[x]`) |
| `verify-report.md` | Present (PASS, 0 CRITICAL / 3 WARNING / 5 SUGGESTION, 2855/2855 tests) |
| `archive-report.md` | This file |

**GOTCHA carried forward from task brief**: `verify-report.md` and `archive-report.md` are UNTRACKED in
git (never `git add`-ed by earlier phases). A plain `git mv openspec/changes/ux-observability
openspec/changes/archive/2026-07-06-ux-observability` only relocates TRACKED files — the two untracked
`.md` files must be explicitly `git add`-ed (before or after the move) or they will NOT travel with the
rest and will appear to git as new untracked files at the old path / missing from the new one.

---

## Closing Steps (executed by the orchestrator, 2026-07-06)

The sdd-archive agent's toolset was Read/Edit/Write/Glob only (no shell/git), so the physical folder
move, gate re-confirmation, and commit were executed by the orchestrator immediately after this report
was written — same split as the `2026-06-19-phase-9.5b-graphstore-node-sqlite` archive. The exact
commands executed on `closeout`:

```powershell
cd C:\Users\ecardoso\dev\dbgraph

# 1. Move the change folder (git mv only relocates TRACKED files)
git mv openspec/changes/ux-observability openspec/changes/archive/2026-07-06-ux-observability

# 2. Explicitly add the two untracked files so nothing is lost (the GOTCHA above)
git add openspec/changes/archive/2026-07-06-ux-observability/verify-report.md
git add openspec/changes/archive/2026-07-06-ux-observability/archive-report.md

# 3. Add the canonical spec edit
git add openspec/specs/cli-config/spec.md

# 4. Confirm nothing remains at the old path and the new folder is complete
git status
# Expect: renames for proposal.md/design.md/tasks.md/specs/**, new file adds for verify-report.md +
# archive-report.md, and a modified openspec/specs/cli-config/spec.md. Nothing left under
# openspec/changes/ux-observability/.

# 5. Re-confirm the local gate is still green on closeout (spec-only edits, but re-confirm before commit)
npx tsc --noEmit
npm run lint
npm test
# Expect: tsc exit 0; lint 0 errors/0 warnings; vitest 2855/2855 passed, 0 failed, 0 skipped.

# 6. Single conventional commit (NO PR, NO push, NO gh, NO AI attribution)
git commit -m "chore(sdd): archive ux-observability; sync cli-config canonical spec (US-005)"
```

Everything else specified in the task (spec merge into `openspec/specs/cli-config/spec.md`, this
archive report, and the exact git/gate commands above) has been completed or fully specified.

---

## SDD Cycle

PLAN → SPEC → DESIGN → TASKS → APPLY (3 batches, commits `0db4edd` + `e98eb08` + `0c2f819`) → VERIFY
(PASS) → **ARCHIVE (spec merge + report complete; physical move/commit pending shell execution — see
above)**.

Next recommended: none from this change's scope. The proposal explicitly deferred packaging/binaries
(9.5c), the AI benchmark (US-035) and Phase-7 docs to later closeout changes — those remain the natural
follow-ups on branch `closeout` once this archive is physically committed.
