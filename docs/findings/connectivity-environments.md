# Findings — External-Tool Connectivity in Restricted Environments

Source: Phase-6 real validation against a corporate SQL Server reachable ONLY via
Windows Integrated Security. These are the real-world breaks discovered when the
`sqlcmd` connectivity strategy was exercised against a live enterprise database
(not the CI Testcontainer). They are the basis for the **resilient-connectivity**
change (graceful degradation — the system must never throw a raw exception that
blocks the user).

> All examples below are GENERIC/synthetic. No real database, schema, object, or
> credential is recorded here (repo is codename-free; the leak-scanner enforces it).

## F-1 — Integrated Security is real and unavoidable
The target allows ONLY Windows Integrated Security (current session, no password);
the DBA will not issue a SQL login or any explicit credential. The pure-JS driver
(`tedious`) cannot do SSPI/Kerberos (ADR-006). **Conclusion validated:** the
connectivity-strategy system + an external tool (`sqlcmd -E`) is the correct path,
and shelling out does NOT violate "100% JS drivers". `sqlcmd -E` DID connect — the
integrated-auth assumption holds in practice.

## F-2 — `sqlcmd` has multiple variants with different rules
- **Legacy ODBC `sqlcmd`** (observed: v15.0.1300, `...\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE`).
- **`go-sqlcmd`** (the Go rewrite; different/stricter flag validation).
Detection must distinguish them; flag selection must adapt per variant + version.
We initially assumed go-sqlcmd from the error style — it was legacy. Assumptions
about the variant are unsafe; probe it.

## F-3 — Legacy sqlcmd flag mutual-exclusivities (surfaced only at runtime)
On legacy sqlcmd 15.x:
- `-W` (trim trailing spaces) is mutually exclusive with `-y`/`-Y`.
- `-h` (headers) is mutually exclusive with `-y 0`.
`-y 0` (unlimited var-type width) is REQUIRED to avoid truncating the large FOR JSON
value, so on legacy it must be used ALONE (no `-h`, no `-W`). A different variant/version
may have different rules. **These conflicts are NOT caught by CI** (see F-7).

## F-4 — Legacy sqlcmd FOR JSON output shape (measured, not assumed)
With `SET NOCOUNT ON` + `-y 0` (no `-h`) on legacy 15.x:
- Output lines are EXACTLY 2033 chars each — the FOR JSON server-side chunk size.
  `-y 0` does NOT wrap at the screen width; each 2033-char chunk is one line.
- **NO column-header line and NO dashes-separator line** — line 0 is already the JSON.
  (Our first fix wrongly assumed a header+separator to strip; the real output has none.)
- ZERO trailing-space padding.
Reassembly must therefore concatenate the chunk-lines **preserving content exactly**
(stripping a trailing `\r` only) — any `.trim()` corrupts content at chunk boundaries.

## F-5 — Output encoding: codepage vs UTF-8
Legacy sqlcmd emits in the console/ANSI codepage by default, NOT UTF-8. Proc/function
definitions containing non-ASCII characters (accented text, symbols) then corrupt when
decoded as UTF-8, breaking JSON parsing deep in the stream. Fix observed: force UTF-8
output codepage (`-f o:65001`) and decode as UTF-8. (`-u`/UTF-16 is an alternative.)
Encoding handling must be explicit, not assumed.

## F-6 — Reassembly fragility
The chunked FOR JSON output is split mid-token at arbitrary 2033-char boundaries. The
reassembler must: skip any leading non-JSON line defensively, drop blank lines and the
`(N rows affected)` trailer, and concatenate the rest WITHOUT trimming and WITHOUT
inserting separators. Malformed/partial output must produce an ACTIONABLE error
(what was received, first N chars) — not a raw `JSON.parse` stack trace.

## F-7 — CI coverage gap
The gated integration test exercises the FOR JSON SQL via `tedious` against a
Testcontainer — it validates SQL VALIDITY (e.g. the Msg 1033 derived-table-ORDER-BY
class) but NOT the sqlcmd transport: flag combos, output format, chunking, or encoding.
Those only surface on a real `sqlcmd` run. We need recorded real-output fixtures and/or
an opt-in CI lane with `sqlcmd` installed so the external-tool path is regression-tested.

## The problem to solve (resilient-connectivity)
Each break above currently manifests as an unhandled exception / stack trace that BLOCKS
the user mid-`sync`. The system should instead:
1. **Probe capabilities before a full run** — variant, version, a tiny FOR JSON round-trip
   to learn the real output shape + encoding for THIS environment — and adapt flags/parsing.
2. **Degrade gracefully** — on any connectivity/format/encoding/parse failure, fall back to
   the next strategy (manual-dump, guided install) and emit an ACTIONABLE message (what
   failed, the exact command tried, what to do next) — never a raw stack trace.
3. **Be variant/version-aware** — a flag/format/encoding profile per detected tool+version,
   extensible as new environments are reported.
4. **Let users report environments** — a structured way to capture an unrecognized
   environment (variant, version, sample output shape — content-free) so new profiles can
   be added. Possibly a `dbgraph doctor` self-test command.
5. **Be regression-tested** — recorded (anonymized) real-output fixtures per environment +
   an opt-in CI lane that installs `sqlcmd`.
