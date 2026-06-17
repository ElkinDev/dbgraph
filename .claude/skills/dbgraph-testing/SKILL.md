---
name: dbgraph-testing
description: Testing methodology for dbgraph. Trigger - writing or modifying tests, or writing code that requires them. Enforces strict TDD in core, golden files for output formats, and container-based integration for adapters.
---

# dbgraph testing

## Where strict TDD applies (red → green → refactor)

- ALL of `src/core` (normalizer, query engine, inference) and every output format.
- The failing test exists BEFORE the implementation. Minimal code to green, then refactor.
- Pure logic with deterministic input/output — no excuses.

## Golden files

- Every MCP tool / CLI output format is pinned by golden files (vitest snapshots).
- Changing a golden is a DELIBERATE act: the PR must state the token-budget impact and update
  `docs/format-spec.md` accordingly. Same graph → same output, byte for byte.
- Byte comparisons require byte-deterministic CHECKOUTS: `.gitattributes` forces `eol=lf`
  repo-wide (and `-text` for binary fixtures). Never weaken a golden assertion to "ignore line
  endings" — fix the environment, not the assertion (learning L-001: CI windows runners use
  `core.autocrlf=true` and will CRLF-ify a fresh checkout without the attribute).
- Local tests passing does NOT prove a fresh checkout passes. To reproduce CI-Windows conditions:
  `git clone --config core.autocrlf=true <repo> /tmp/repro && npm ci && npm test`.
- Golden files are NECESSARY but NOT SUFFICIENT for graph correctness. Goldens serialize the
  whole graph and will enshrine a bug if the bug was present when the golden was seeded.
  Always add targeted endpoint assertions (see rule below) for every semantically critical edge.

## Edge/graph endpoint assertions — MANDATORY (L-009, promoted 2026-06-16)

An edge that connects the WRONG nodes is invisible to existence-only assertions and to goldens
seeded while the bug was present. Existence-only checks let bugs ship green.

For every semantically critical edge kind (`fires_on`, `writes_to`, `reads_from`, `references`),
the test MUST assert:
1. `src` node qname (e.g. `dbo.trg_audit_order_update`)
2. `dst` node qname (e.g. `dbo.orders`)
3. That no wrong-target/stub variant exists at the destination

Pattern:
```ts
const srcNode = graph.nodes.find((n) => n.name === 'trg_audit_order_update' && n.kind === 'trigger');
const firesOnEdge = graph.edges.find((e) => e.kind === 'fires_on' && e.src === srcNode!.id);
const dstNode = graph.nodes.find((n) => n.id === firesOnEdge!.dst);
expect(dstNode!.qname).toBe('dbo.orders');               // dst is the parent TABLE
expect(dstNode!.kind).toBe('table');
expect(stubs.find((s) => s.qname === 'dbo.trg_audit_order_update')).toBeUndefined(); // no phantom stub
```

Context: an existence-only fires_on test (`edges.length >= 1`) let a phantom trigger stub (C-1)
pass green CI for an entire verify cycle. The golden was seeded with the wrong value and
enshrined the bug. Only the verifier probing the live container caught it.

## False negatives — NEVER drop a spec assertion without explicit deferral

- NEVER drop a spec-mandated assertion because a platform limitation is SUSPECTED.
- ALWAYS verify empirically against the live system BEFORE concluding a dep view has a gap.
- If an assertion must be deferred, it MUST be tracked as a spec deferral with justification.
- Undocumented assertion removal is treated as CRITICAL by the verifier (C-2 precedent).

## Adapters: integration-first

- Adapters are tested against their REAL engine ("torture schema" in Testcontainers; SQLite
  uses a committed fixture file). NEVER mock the driver in integration tests — a mock will not
  warn you that a catalog view returns NULL where you did not expect it.
- Each torture schema exercises EVERY object type the adapter's CapabilityMatrix declares.
- Integration runs use a user WITHOUT write permissions (see dbgraph-security).
- Container suites set `hookTimeout` >= 240 000 ms on `beforeAll` (SQL Server cold start).
- Gate integration with `DBGRAPH_INTEGRATION=1` env flag, not Docker presence.

## Conventions

- Fixtures: `test/fixtures/catalog-*.json` (synthetic catalogs for core tests).
- Structure: Arrange-Act-Assert; one behavior per test; test names describe the behavior.
- Acceptance criteria from `docs/stories/` map to at least one test each.
