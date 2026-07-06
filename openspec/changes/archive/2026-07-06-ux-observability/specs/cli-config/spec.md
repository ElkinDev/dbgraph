# Delta for CLI & Config

Change: `ux-observability` — make `dbgraph sync` observable and correct the stale top-level help banner.

Story framing: the observable-sync clause attaches to **US-005** (sync / incremental) as a user-facing-output obligation; determinism/purity constraints follow **US-004/US-005** (deterministic presentation). No new story is minted — the silence is a wiring/output gap in an existing command, not a new capability.

## MODIFIED Requirements

### Requirement: sync is incremental by fingerprint, --full forces a rebuild

`dbgraph sync` SHALL be incremental: it MUST compare the adapter's `fingerprint()` against the last
snapshot's stored fingerprint and SKIP extraction entirely when they are equal; otherwise it MUST
`extract → normalize → upsert` changed and new objects (by `body_hash`), DELETE objects removed from
the source, and write a new snapshot via `putSnapshot` (US-005). `sync --full` MUST force a complete
re-extraction and rebuild regardless of the fingerprint. Every sync that extracts MUST record a
snapshot with per-object-type counts.

`dbgraph sync` MUST also be OBSERVABLE: it MUST NOT run silent. It SHALL emit human-readable PROGRESS
(at minimum: extraction started/skipped, delta computed, upsert/delete applied, snapshot written) and a
final SUMMARY (per-object-type counts, upserted/deleted delta, drift state, snapshot id/fingerprint)
through the injected `Logger`. The summary text MUST be produced by a PURE, deterministic, golden-pinnable
formatter (ADR-008): for the same inputs it MUST be byte-identical. Elapsed TIMING is NOT part of the
pinned formatter output — timing flows through the `Logger` seam so the golden body stays deterministic.
The logger and formatter MUST emit ONLY counts, phase names, timings, drift state and snapshot metadata —
they MUST NOT emit any connection-string value, resolved secret, or sampled data value. Diagnostics MUST
go to STDERR; where a command supports `--json`, the machine payload on STDOUT MUST remain byte-identical
(observability MUST NOT pollute parseable output). The observable output MUST NOT change any command's
exit code. A `--quiet`/`-q` flag MUST suppress info/progress while preserving warn/error; the default
level is verbose (info/progress shown).
(Previously: the requirement only mandated the persisted snapshot — `sync` emitted NOTHING to stdout/stderr and ran silent.)

#### Scenario: Unchanged fingerprint skips extraction

- GIVEN an existing graph whose last snapshot fingerprint equals the adapter's current `fingerprint()`
- WHEN `dbgraph sync` runs
- THEN extraction is skipped and the existing graph is preserved unchanged
- AND it emits a human-readable line stating the index is already up to date (no silent exit)

#### Scenario: Changed source applies only the delta and records a snapshot

- GIVEN an existing graph and a source with one procedure modified and one object deleted
- WHEN `dbgraph sync` runs
- THEN only the changed/new objects are upserted (verifiable by counter) and the deleted object's node and edges are removed
- AND a new snapshot is written with per-type counts recording the deletion

#### Scenario: --full forces a complete rebuild

- GIVEN an existing graph whose fingerprint is unchanged
- WHEN `dbgraph sync --full` runs
- THEN a complete re-extraction and rebuild occurs regardless of the fingerprint

#### Scenario: sync emits a deterministic golden-pinned summary

- GIVEN a sync that extracts and applies a known delta over the same inputs
- WHEN the summary is rendered by the pure formatter
- THEN it lists per-type counts, upserted/deleted totals, drift state and the snapshot id/fingerprint
- AND re-running with identical inputs yields byte-identical summary text (matches the golden), with elapsed timing NOT present in the pinned body

#### Scenario: sync output never leaks secrets or sampled data

- GIVEN a sync run whose resolved connection identity contains a secret and whose source rows contain data values
- WHEN the logger and formatter output is captured
- THEN it contains ONLY counts, phase names, timings, drift state and snapshot metadata
- AND it contains NO connection-string value, NO resolved secret, and NO sampled data value

#### Scenario: --json payloads stay byte-identical and diagnostics go to STDERR

- GIVEN a command that supports `--json` run before and after this change with identical inputs
- WHEN its output streams are compared
- THEN the STDOUT machine payload is byte-identical to before (existing `--json` goldens unchanged)
- AND all human-readable diagnostics/progress are written to STDERR only, never to STDOUT

#### Scenario: --quiet suppresses progress but keeps warnings and errors

- GIVEN `dbgraph sync --quiet`
- WHEN the sync runs and a warning or error condition occurs
- THEN info/progress lines are suppressed
- AND warn/error lines are still emitted to STDERR

#### Scenario: Observable output does not change exit codes

- GIVEN any command run with the observable logger wired
- WHEN it completes (success, negative result, or error)
- THEN its exit code is IDENTICAL to the pre-change exit-code contract (0/1/2/3/4 unchanged), the added I/O affecting output only

### Requirement: CLI top-level help/usage banner accurately describes every command

The CLI's top-level `--help`/usage banner (`USAGE_TEXT`) SHALL describe each command accurately and
consistently with that command's actual behavior. In particular, the `install` line MUST reflect the
MULTI-AGENT reality — `install` wires the `dbgraph-mcp` server into EVERY supported agent (Claude Code,
Cursor, Gemini CLI, VS Code, opencode, Codex CLI) per the single `AGENT_TABLE` source of truth — and MUST
NOT describe it as wiring only a single specific agent (it MUST NOT say "Claude Desktop"). The banner's
supported-agent wording MUST stay consistent with `install`'s `MANUAL_SNIPPET` supported-agents list. A
unit test MUST pin the banner text against the multi-agent reality.
(Previously: there was no requirement on banner accuracy, and the `install` line read "Wire dbgraph-mcp into the Claude Desktop config" — stale single-agent text describing a multi-agent command.)

#### Scenario: install banner line describes the multi-agent reality

- GIVEN the top-level `dbgraph --help` / `USAGE_TEXT`
- WHEN the `install` line is inspected
- THEN it describes wiring `dbgraph-mcp` for supported MCP agents (multi-agent), with `--remove` to undo
- AND it does NOT mention "Claude Desktop" or any single specific agent as the only target

#### Scenario: Banner agent wording stays consistent with install's source of truth

- GIVEN the banner text and `install`'s `MANUAL_SNIPPET` supported-agents list
- WHEN both are compared
- THEN the banner's notion of supported agents is consistent with the `AGENT_TABLE`/`MANUAL_SNIPPET` six-agent set
- AND a unit test pins the banner text so a future single-agent regression fails the build
