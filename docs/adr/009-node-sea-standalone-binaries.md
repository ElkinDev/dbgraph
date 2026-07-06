# ADR-009: Standalone binaries via Node SEA

**Status:** Accepted · **Date:** 2026-07-06 · **Refines:** ADR-006 (bundling clause), ADR-008 (determinism)

**Context:** US-037 asks for a single-file, self-contained CLI a user runs with NO Node.js and NO
`node_modules` (codegraph parity). Phase 9.5b removed the last native module from the local index
(the `node:sqlite` storage seam), making a native-free binary possible. Two toolchains were on the
table: `bun build --compile` and Node SEA (single executable applications). ADR-006 had earlier
written "static bundling in the binaries" for the drivers, which conflicts with ADR-006's own
"works without any driver installed" guarantee and with keeping the 5 drivers optional.

**Decision:**
1. Build standalone binaries with **Node SEA**, not `bun build --compile`: one toolchain, alignment
   with the 9.5b `node:sqlite` seam, no second runtime, an official Node feature.
2. Pin the build+embed Node to **24 LTS** (exact patch in `.nvmrc`) so `node:sqlite` needs NO
   runtime flag (`--experimental-sqlite` was dropped after 23.4) and output is deterministic (ADR-008).
3. **Refine ADR-006's "static bundling in the binaries" clause:** the 5 DB drivers and
   `better-sqlite3` are NOT statically bundled. They stay `external`, lazy, and optional (dynamic
   import) — exactly as on the npm path. The binary's guaranteed capability is READ/serve of an
   already-indexed graph on the in-binary `node:sqlite` — zero drivers required. Live extraction from
   the binary loads a driver only when present, resolved from `$CWD/node_modules` → `NODE_PATH` →
   global; absent → the existing `npm i <driver>` error.
4. The binary defaults its local-index store to `node:sqlite`; the npm default stays
   `better-sqlite3` (byte-identical, ADR-008).

**Consequences:** the small external-driver surface is preserved; "works without any driver
installed" holds for the binary; binary size ≈ the Node runtime (~tens of MB); SEA is experimental
(stability 1.1) so the Node pin is load-bearing across minors; drivers for live extraction are the
user's `npm i`, not shipped; only ADR-006's single bundling sentence is superseded — ADR-006's
pure-JS-driver and lazy-optional decisions stand. macOS + arm64 binaries and any actual release
publication are deferred (9.5d, CI-quota-blocked).
