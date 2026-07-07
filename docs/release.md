# Release runbook — v1.0.0

This is the ordered checklist for cutting a dbgraph release. Every step is
labeled **LOCAL** or **USER-GATED**.

- **LOCAL** — agent-executable and reversible. Touches only the working tree and
  local commits. Fires nothing external.
- **USER-GATED** — user-only, irreversible and/or cost-bearing (CI minutes, a
  macOS build leg, a public npm artifact, a public repository). Carries an
  inline ⚠️ warning.

> **Honesty guard (read first).** Agents MUST NOT execute any USER-GATED step.
> No LOCAL / agent-executable step in this repository pushes a tag, dispatches
> `release.yml`, runs `npm publish`, flips repository visibility, or removes
> `private: true`. Those actions are the USER's to trigger, in the order below.
> This runbook DOCUMENTS the gated steps; it does not perform them.

---

## Phase 0 — State check (LOCAL, read-only)

Verify the working state before doing anything else. All of these are read-only
inspections; none change the repository.

- [ ] `npm test` is green (`vitest run`, full suite).
- [ ] `git status` is clean (no uncommitted changes).
- [ ] You are on the intended branch (release prep landed on `v1-prep`).
- [ ] Both version literals read `1.0.0`:
  - `package.json` → `"version": "1.0.0"`
  - `src/index.ts` → `DBGRAPH_VERSION = '1.0.0'`
  - The always-on drift guard `test/bin/version-single-source.test.ts` asserts
    `package.json.version === DBGRAPH_VERSION === '1.0.0'` and goes RED if they
    ever diverge.
- [ ] `node dist/cli.js --version` prints `1.0.0` after `npm run build`.

## Phase 1 — LOCAL-done checklist (already completed, reversible)

These were done LOCALLY by the release-prep change (`phase-9.5d-release`) and are
fully reversible — nothing external was fired.

- [x] Version bumped to `1.0.0` at both sources of truth (`package.json.version`,
      `src/index.ts` `DBGRAPH_VERSION`).
- [x] Only the current-version asserts moved to `1.0.0`; mechanism/dynamic/
      historical version sites (esbuild `define` inputs, the `9.9.9` override
      proof, dynamic `pkgVersion` smoke readers, benchmark rows) left unchanged.
- [x] `CHANGELOG.md` `## [1.0.0]` entry authored, truthful, no unshipped claims.
- [x] Drift guard (`version-single-source.test.ts`) and npm-pack whitelist gate
      (`npm-pack-whitelist.test.ts`) green under `npm test`.
- [x] `private: true` left UNTOUCHED; no tag pushed; nothing published.

## Phase 2 — USER-GATED steps (execute in order)

> Every step below is USER-GATED. Do not proceed to the next until the current
> one is verified. Read each ⚠️ banner before acting.

### Step U1 — Merge the `closeout` PR into `main` (USER-GATED)

> ⚠️ **Cost / irreversibility.** Merging mutates the shared `main` history and
> may trigger the CI workflow (`ci.yml`) on `main`, consuming CI minutes.
> Reverting a merged PR requires a follow-up revert commit.

- Review and merge the outstanding `closeout` PR so `main` carries the closed-out
  work this release builds on.

### Step U2 — Land `v1-prep` on `main` (USER-GATED)

> ⚠️ **Cost / irreversibility.** Pushing `v1-prep` and merging its PR mutates
> shared history and runs CI on the PR and on `main`, consuming CI minutes.

- Push `v1-prep`, open a PR, get it reviewed, and merge it into `main`. After
  this, `main` holds the `1.0.0` version and the release artifacts.

### Step U3 — PRE-TAG verification: `repository.url` vs npm scope (USER-GATED decision)

> ⚠️ **Resolve BEFORE tagging.** This is a verification item, not an automated
> edit. Do NOT auto-change either value.

- `package.json` `repository.url` points at `github.com/ElkinDev/dbgraph`, while
  the npm publish scope is `@niklerk23/dbgraph`. These do not match, which can
  break provenance / release linkage.
- **Surfaced, not decided:** confirm the canonical repository and npm scope with
  the owner and align them by hand before tagging. This runbook changes neither
  value automatically.

### Step U4 — Tag `v1.0.0` from `main` (USER-GATED)

> ⚠️ **Fires CI and is effectively irreversible.** Pushing the `v1.0.0` tag
> triggers `.github/workflows/release.yml`:
> - builds the **win-x64** and **linux-x64** SEA binary legs,
> - the **macOS** leg is PRESENT-BUT-DORMANT (no-op, produces no artifact),
> - generates SHA256SUMS and a provenance / artifact attestation,
> - runs `gh release create` to publish a GitHub Release.
>
> This BURNS CI quota. The provenance attestation is written to the public
> transparency log and is PERMANENT — deleting the tag and Release later does not
> remove it. Confirm Step U3 is resolved first.

- Tag `main` as `v1.0.0` and push the tag only when you intend to spend CI quota
  and cut a public GitHub Release.

### Step U5 — Publish to npm, removing `private: true` in the SAME step (USER-GATED)

> ⚠️ **Irreversible version number.** `npm publish` makes `@niklerk23/dbgraph@1.0.0`
> public. `npm unpublish` is allowed only within 72h and only if nothing depends
> on it, and the version number can NEVER be reused. Publishing is a deliberate,
> non-reusable act.

- npm refuses to publish a package with `private: true`. Remove `private: true`
  from `package.json` **in this same step**, immediately before `npm publish` —
  never earlier — so the package is not left publishable while unattended.
- Order within this step: (1) remove `private: true`, (2) `npm publish`,
  (3) if you abort before publishing, re-add `private: true`.

### Step U6 — Flip the repository public (USER-GATED, deferred)

> ⚠️ **Irreversible exposure.** Flipping the GitHub repository to public exposes
> full history. Clones, forks and caches made during the public window PERSIST
> even after flipping back to private.

- This is deferred and is the owner's call. Do it only when the public surface
  (history, secrets scan, docs) has been reviewed.

---

## Phase 3 — Rollback / abort (honest limits)

| Step | Abort action | Honest caveat |
|------|--------------|---------------|
| Tag pushed (U4) | `git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0` | GitHub KEEPS the Actions run history; the Release and provenance attestation are NOT auto-deleted (`gh release delete` for the Release; the attestation is in the public transparency log — permanent). |
| `npm publish` (U5) | `npm unpublish @niklerk23/dbgraph@1.0.0` | Allowed only < 72h AND if nothing depends on it; the version number can NEVER be reused. |
| `private: true` removed (U5) | Re-add `private: true` before publishing | Moot once published. |
| Repository flipped public (U6) | Flip back to private | Clones / forks / caches made during the public window persist. |
| This phase's LOCAL edits | Revert the two version literals + moved asserts to `0.0.0`; delete `CHANGELOG.md`, `docs/release.md`, and the two new tests | Fully reversible — nothing external was fired. |

## Phase 4 — Post-release verification (after U4/U5)

Run these only after the gated steps above have been fired by the user.

- [ ] **Release binary smoke.** Download the win-x64 and linux-x64 SEA binaries
      from the GitHub Release, verify each SHA256 against `SHA256SUMS`, and run
      `--version` → expect `1.0.0`.
- [ ] **npm install smoke.** In a clean directory, `npm install @niklerk23/dbgraph`
      and run `dbgraph --version` → expect `1.0.0`.
- [ ] **macOS leg.** Record that the macOS build leg produced NO artifact this
      release (dormant / no-op); only win-x64 and linux-x64 binaries exist.
