<!--
Thanks for contributing to dbgraph. Keep the description focused on WHAT changed and
WHY. See CONTRIBUTING.md for the full workflow.
-->

## Summary

What does this PR change, and why?

## Related

- User story / spec: (e.g. `US-xxx`, `openspec/specs/<capability>`)
- openspec change: (e.g. `openspec/changes/<change-name>/`, if applicable)

## Quality gate

All must pass before merge (see `CONTRIBUTING.md`):

- [ ] `npx tsc --noEmit` — clean under strict TypeScript (no `any`)
- [ ] `npm run lint` — 0 errors / 0 warnings
- [ ] `npm test` — all tests green (`vitest run`)
- [ ] Leak-scan clean — no secrets or denylisted identifiers (part of `npm test`; git hooks active via `npm run hooks:install`)

## Spec-driven development

- [ ] For a substantial change, the openspec cycle was followed (proposal → spec → design → tasks → apply → verify → archive), OR this change is small enough not to need it
- [ ] New behavior was written test-first (RED → GREEN → refactor) with exact/golden assertions

## Commit hygiene

- [ ] Commits follow Conventional Commits (`type(scope): summary`) and reference the user story where relevant
- [ ] No generated artifacts committed (`dist/`, `build/`, `.dbgraph/` are git-ignored)
