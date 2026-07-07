# Delta for CLI & Config

> Added by graph-viz: registers the `viz` command (self-contained interactive HTML export + `--mermaid`
> ER diagram), its flags and exit-code contract, and pins its usage-banner line. Driving/presentation
> adapter only — imports ONLY the public core API (`src/index.ts`) and Node builtins, NEVER
> `src/adapters/**` (ADR-004). Read-only against the target is INVIOLABLE (viz reads the local index).
> Driven by the user's direct request to SEE the graph; no formal US-xxx assigned yet (see open questions).

## ADDED Requirements

### Requirement: viz command exports the graph and honors the exit-code contract

The CLI SHALL expose a `viz` command that BULK-reads the persisted graph and writes a SELF-CONTAINED
interactive HTML file to `--out` (default `graph.html`), OR — with `--mermaid` — emits a deterministic
Mermaid ER diagram. It MUST accept `--out <file>`, `--mermaid`, `--full`, and the view filter flags
`--schema`, `--min-degree`, `--kinds` and `--columns`. On success it MUST print a one-line confirmation
plus the output path and exit 0. An INVALID flag value OR a contradictory flag COMBINATION MUST surface a
`ConfigError` with an actionable message and exit with code 2 — consistent with the established exit-code
contract and the `mcp --port` / `--detail` validation precedent (the added flags introduce NO new exit
code). The command MUST import ONLY the public core API (`src/index.ts`) and Node builtins — NEVER
`src/adapters/**` (ADR-004).

#### Scenario: viz writes a self-contained HTML and exits 0

- GIVEN `dbgraph viz --out graph.html` over a persisted graph
- WHEN it runs successfully
- THEN it writes the self-contained HTML to `graph.html`, prints a one-line confirmation carrying the output path, and exits 0

#### Scenario: --mermaid emits the ER diagram

- GIVEN `dbgraph viz --mermaid`
- WHEN it runs
- THEN it emits the deterministic Mermaid ER text (tables + FK edges) and exits 0

#### Scenario: invalid flag value or combination exits 2 with an actionable message

- GIVEN an invalid `viz` invocation (e.g. a non-numeric `--min-degree`, or `--mermaid` combined with HTML-viewer-only flags)
- WHEN the flags are parsed
- THEN it surfaces a `ConfigError` naming the offending value/combination
- AND the process exits with code 2 (established exit-code contract)

#### Scenario: viz honors the CLI import boundary

- GIVEN the `viz` command source under `src/cli/**`
- WHEN the boundary test analyzes it
- THEN it imports only `src/index.ts` and Node builtins (no `src/adapters/**`) and the boundary test stays green

### Requirement: CLI usage banner documents the viz command with the exact alignment

The top-level `--help`/usage banner (`USAGE_TEXT`) SHALL include a `viz` command line whose DESCRIPTION
begins at CHARACTER INDEX 12 (two leading spaces, `viz`, seven spaces — the SAME column alignment as the
existing `mcp` / `object` / `install` lines) and that documents the self-contained HTML export plus the
`--mermaid` and `--out` flags. A unit test MUST pin this line so dropping the `viz` command (or its
`--mermaid` / `--out` mention) fails the build. Adding the `viz` line MUST leave every EXISTING command
line byte-identical.

#### Scenario: viz banner line is present with the exact aligned text

- GIVEN the top-level `dbgraph --help` / `USAGE_TEXT`
- WHEN the `viz` line is inspected
- THEN its description begins at character index 12 (`  viz` followed by seven spaces), matching every other command line
- AND the line documents the self-contained HTML export and the `--mermaid` / `--out` flags
- AND a unit test pins the line so dropping the `viz` command fails the build

#### Scenario: adding the viz line leaves other command lines unchanged

- GIVEN the pre-change `USAGE_TEXT` command block
- WHEN the `viz` line is added
- THEN every existing command line (`init`…`object`, including the pinned `mcp`/`install` lines) is byte-identical to before
- AND only the new `viz` line is introduced
