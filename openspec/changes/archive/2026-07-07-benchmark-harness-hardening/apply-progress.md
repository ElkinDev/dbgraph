# Apply Progress: benchmark-harness-hardening

Status: **DONE** — all 9 tasks (B1.1–B1.6, B2.1–B2.3) complete; 6/6 Definition-of-Done items traced.
Branch: `v1-prep` (local only, nothing pushed). Artifact store: openspec (files).
Mode: STRICT TDD for the pure helpers (RED observed before GREEN).

## Batch B1 — CODE + STRICT TDD (committed)

- Commit: **8555cb4** `feat(benchmark): add harness-checks coverage + manifest-hash module, wire build-packets abort and score stamp` (amended from the initial 023ce1d — see the NUL-byte discovery below).
- Baseline before: HEAD 139a0c3, clean tree, `npm test` = 3229.
- RED evidence: `npx vitest run test/benchmark/harness-checks.test.ts` → `Error: Cannot find module '../../benchmark/harness-checks.ts'` (0 tests, suite failed) BEFORE the module existed.
- GREEN evidence: same command after writing the module → 17 passed.
- Files:
  - `benchmark/harness-checks.ts` (NEW, pure, no `fs`/`crypto`/`Database`) — `deriveCoverageTargets` (D2/D2-shape: impact `whatToTest` is a FLAT string array), `verifyDumpCoverage` (D3: membership in the CREATE-defined `kind:name` set; schema/quote-stripped, case-insensitive; `REFERENCES` does not cover), `joinManifestHashes` (D4/OQ1: `ok`/`mismatch`/`empty-raw`/`missing-in-manifest`, no throw, leak-safe result shape).
  - `benchmark/build-packets.ts` (MODIFY) — imports the helpers; after `assertPacketPair`, `verifyDumpCoverage(ddlDump, deriveCoverageTargets(...))`, throws the pinned `SELF-CHECK FAILED: <qid> (<family>) — DDL dump does not define target object(s): KIND <name>` on miss.
  - `benchmark/score.ts` (MODIFY) — `RawRecord.promptSha256?`, `ConditionResult.promptSha256` (with the FROZEN attestation comment); reads `packets/manifest.json` (default benchmarkDir-relative, `--manifest` override, missing FILE → throw); joins + stamps additively; `mismatch`/`missing-in-manifest` → collect + fail loudly (exit 1, no scored file); `empty-raw` → warn + stamp; `ok` → stamp. `aggregate.json` untouched.
  - `test/benchmark/harness-checks.test.ts` (NEW) — 17 EXACT `.toStrictEqual` units, inline literals only, imports ONLY the pure module, no stage path / no `benchmark/runs` string / no new `fixtures/*.json` (independence guard stays green).
- B1 gate: tsc clean · lint 0/0 · `npm test` 3246 (3229 + 17) · independence guard green · zero run artifacts · leak-scan clean (pre-commit hook passed).

## Batch B2 — VERIFICATION (proof only, no new code commit)

- **B2.1 byte-identity**: pre-change bytes captured aside (runs/ gitignored). Re-scored both committed runs with the default frozen manifest — exit 0 each. `aggregate.json` BYTE-IDENTICAL: torture `sha256=0ebbc9be…44a`, explore `sha256=458d70ac…192` (pre == post). `scored/per-question.json` gained ONLY `promptSha256` per condition (prior field VALUES byte-identical). All 10 (qid,condition) per run = `empty-raw` → WARNED + STAMPED the frozen hash; ZERO `mismatch`/`missing-in-manifest`; stamped values equal the manifest.
- **B2.2 poisoned-db negative proof**: real db regenerated packets byte-identical to frozen (manifest `sha256=dfbe1c44…`), confirming determinism + correct source. Poisoned copy (`DROP TABLE assignments`) → `build-packets --db poison.db --out <scratch>` exited **1** with `SELF-CHECK FAILED: column-type-assignments.dept_id (column-type) — DDL dump does not define target object(s): TABLE assignments` (names qid+family+bare object, NO composed value). `benchmark/packets/` left byte-identical to pre-smoke (scratch out-dirs used throughout).
- **B2.3 final gate**: tsc clean · lint 0/0 · `npm test` 3246 GREEN (185 files) · independence green · aggregate byte-identical both runs · no `questions.yaml`/N/scoring/protocol/`src`/`dist` byte moved · leak-scan clean · NOTHING pushed (no origin ref, local commits only).

## Discovery / Gotcha

- **NUL-byte separators (fixed):** the initial commit 023ce1d stored `harness-checks.ts` and `score.ts` with raw NUL bytes (0x00) as the Map-key separators between `${qid}` and `${condition}` (2 and 3 NULs respectively). The code was functionally correct (NUL used consistently on set+get, all 3246 tests + B2.1 stamping passed), but NUL bytes made git classify the files as BINARY — so the pre-commit leak-scan (which greps `git diff` added text lines) SILENTLY SKIPPED them. Replaced every NUL with an ASCII space (semantics identical; qids/conditions contain no spaces), re-ran the full gate (green, byte-identity preserved), and amended to 8555cb4 so both files are proper UTF-8 text and the leak-scan actually covers them. Lesson: verify new/edited source files are text (`file`/`git diff --numstat`) before trusting a leak-scan pass.

## Next

Hand off to `sdd-verify`. tasks.md + apply-progress.md updated on disk (openspec); intentionally uncommitted per B2.3 "no new commit expected" (proof-only batch).
