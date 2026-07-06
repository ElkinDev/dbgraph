# Delta for CLI & Config

## ADDED Requirements

### Requirement: mcp verb accepts the HTTP transport flags across both entry seams

The `mcp` verb SHALL accept `--http`, `--port <N>` and `--host <H>` parsed by a SINGLE shared flag
parser wired into BOTH MCP entry seams — the SEA pre-dispatch layer (`sea-entry.planEntry`, which
intercepts `mcp` before `cli.ts` dispatch) AND the npm `dbgraph-mcp` bin auto-run guard. With `--http`
PRESENT the server starts in Streamable HTTP mode (see `mcp-http-transport`); with `--http` ABSENT the
server starts STDIO, byte-identical to today, through either seam. `--host` MUST require an explicit
value. An invalid flag value — a `--port` that is not a valid port number, or `--host` with no value —
MUST surface an actionable `ConfigError` and exit with code 2, consistent with the established
exit-code contract (`ConfigError` → 2; the added flags introduce NO new exit code). The `--http` flags
MUST NOT alter any other command's parsing or exit codes.

#### Scenario: --http starts HTTP mode through both seams

- GIVEN `dbgraph mcp --http` via the SEA route AND `dbgraph-mcp --http` via the npm bin
- WHEN each entry parses its argv
- THEN each starts the server in Streamable HTTP mode using the shared flag parser
- AND `--port`/`--host` values are threaded to the HTTP launcher identically for both seams

#### Scenario: Bare mcp stays byte-identical STDIO through both seams

- GIVEN `dbgraph mcp` (SEA) and `dbgraph-mcp` (npm bin) with no `--http`
- WHEN each entry parses its argv
- THEN each starts the STDIO server on the unchanged code path with no new output
- AND the STDIO behavior is byte-identical to before this change

#### Scenario: Invalid --port exits 2 with an actionable message

- GIVEN `dbgraph mcp --http --port notaport`
- WHEN the flags are parsed
- THEN it surfaces an actionable `ConfigError` naming the offending value
- AND the process exits with code 2 (established exit-code contract)

#### Scenario: --host without a value exits 2

- GIVEN `dbgraph mcp --http --host` with no value following
- WHEN the flags are parsed
- THEN it surfaces an actionable `ConfigError` requiring an explicit host value
- AND the process exits with code 2

### Requirement: CLI usage banner documents the mcp verb and its --http surface

The CLI's top-level `--help`/usage banner (`USAGE_TEXT`) SHALL include an `mcp` command line that
documents serving the MCP tools over STDIO by default and over Streamable HTTP via `--http`, using the
SAME column alignment as every other command line (two leading spaces; command-name field padded so
each description begins at the same column — descriptions start at character index 12, as the existing
`init`/`affected`/`doctor` lines do). A unit test MUST pin this line so dropping the `mcp`/`--http`
mention fails the build.

#### Scenario: mcp banner line is present with the exact aligned text

- GIVEN the top-level `dbgraph --help` / `USAGE_TEXT`
- WHEN the `mcp` line is inspected
- THEN it reads exactly `  mcp       Serve the MCP tools over stdio (default) or Streamable HTTP (--http)` (two leading spaces, `mcp`, seven spaces — description aligned at character index 12, matching the other command lines)
- AND a unit test pins this line so dropping the `--http` mention fails the build

#### Scenario: Adding the mcp line leaves the other command lines unchanged

- GIVEN the pre-change `USAGE_TEXT` command block
- WHEN the `mcp` line is added
- THEN every existing command line (`init`…`doctor`, including the pinned `install` line) is byte-identical to before
- AND only the new `mcp` line is introduced
