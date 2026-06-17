# ADR-007: npm supply chain

**Status:** Accepted · **Date:** 2026-06-11

**Context:** A typosquat in a tool that connects to databases is a disaster. Explicit project
requirement: official repositories only.

**Decision:** official registry (`registry.npmjs.org`, verified on the machine); CLOSED list of
canonical packages (ADR-006 drivers + `@modelcontextprotocol/sdk` + toolchain);
`package-lock.json` committed; `npm ci` in CI; Dependabot + `npm audit` as gates; every new
dependency is justified in writing in its PR.

**Consequences:** minimal, audited dependency surface; releases with provenance.
