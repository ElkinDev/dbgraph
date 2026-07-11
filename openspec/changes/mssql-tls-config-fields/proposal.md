# Proposal: MSSQL TLS Config Fields (encrypt / trustServerCertificate)

> **PLANNING — proposal only.** No specs/design/tasks yet; a future cycle runs the full pipeline.
> Gap with a live repro. Smaller than it looks: the port + driver already support these fields.

## Intent

`dbgraph.config.json` cannot express TLS posture for SQL Server. `MssqlSource` (`schema.ts:35-44`) has no `encrypt`
or `trustServerCertificate`; `parseConfig` does not read them; `openConnections` does not thread them into
`createMssqlSchemaAdapter` (`open-connections.ts:184-192`). Because tedious defaults to `encrypt: true` and
validates the server certificate, dbgraph cannot live-sync against a SQL Server presenting a SELF-SIGNED
certificate — common in dev/QA and in restored/containerized instances.

**Verified live (out-of-repo):** against a container with a self-signed cert the connection was rejected;
`NODE_TLS_REJECT_UNAUTHORIZED` is ignored by tedious; the only workaround was minting a SAN certificate and setting
`NODE_EXTRA_CA_CERTS`.

**Key finding (verified in-repo):** the last mile ALREADY exists. The port type `MssqlAdapterConfig` carries
`encrypt?` and `trustServerCertificate?` (`schema-adapter.ts:58-59`), and `NativeTediousStrategy._buildPoolConfig`
already applies them to the tedious `options` (`native-tedious.strategy.ts:217-220`). The ONLY missing links are the
config schema, the parser, and the composition-root wiring — a much smaller change than "add TLS support".

## Scope

### In Scope
- Add optional `encrypt?` and `trustServerCertificate?` to `MssqlSource`.
- Parse them in `parseConfig`; thread them through `openConnections` into `createMssqlSchemaAdapter` (the port and
  tedious strategy already consume them).
- A SECURITY posture: `trustServerCertificate: true` weakens MITM protection → OFF by default, surfaced LOUDLY
  (doctor / sync summary) when enabled.

### Out of Scope (non-goals)
- CA-bundle / client-cert / custom trust-store config (env-based `NODE_EXTRA_CA_CERTS` remains the path for real CAs).
- TLS knobs for pg/mysql/mongodb (they already carry `ssl`/`tls`).
- Changing the tedious default (`encrypt: true` stays).

## Capabilities

> Contract for sdd-spec. Researched `openspec/specs/` — existing names used verbatim.

### New Capabilities
- None.

### Modified Capabilities
- `cli-config`: `MssqlSource` gains `encrypt` / `trustServerCertificate`; the parser accepts them. They are NON-secret
  booleans, not identity fields (see Open Questions on env-ref policy).
- `connectivity` (possible): document the TLS posture and the loud security-warning surface.

**Affected canonical specs:** `openspec/specs/cli-config/spec.md` (primary), `openspec/specs/connectivity/spec.md`
(posture/warning). The port (`mssql-extraction` / `schema-extraction`) is UNCHANGED — it already models these fields.

## Approach

Purely a config-surface + wiring change. Add the two optional booleans to `MssqlSource`; `parseConfig` reads them
(they are booleans, not `${env:VAR}` secrets — unlike identity fields); `openConnections` spreads them into the
`createMssqlSchemaAdapter` config, where the existing tedious strategy already maps them to `options.encrypt` /
`options.trustServerCertificate`. Add a loud warning wherever `trustServerCertificate: true` is active.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/infra/config/schema.ts` | Modified | `MssqlSource` gains `encrypt?` / `trustServerCertificate?` |
| `src/infra/config/parse-config.ts` | Modified | Parse + validate the two booleans |
| `src/infra/open-connections.ts` | Modified | Thread both into `createMssqlSchemaAdapter` |
| `src/core/present/doctor.ts` (or sync summary) | Modified | LOUD warning when `trustServerCertificate: true` |
| `openspec/specs/cli-config/spec.md` | Modified | Requirement + scenarios for the TLS fields + security note |

## Size Estimate

**S** — schema + parser + one wiring spread + a warning; the driver/port half already ships.

## Open Questions (for design)

- Plaintext booleans vs `${env:VAR}`: identity fields MUST be env-refs, but these are not secrets. Allow literal
  booleans (simplest), or require env-refs for consistency?
- Warning surface: doctor, sync summary, or both? (Cross-reference `doctor-dependency-catalog-health`.)
- Allow `encrypt: false` (disable TLS entirely), or only `trustServerCertificate: true` (encrypt but don't verify)?
  The latter covers the self-signed case with less exposure.
- The port comment says `trustServerCertificate` defaults "true for dev", but the strategy leaves it UNSET (tedious
  default = false). Reconcile the intended default in design.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Users enable `trustServerCertificate: true` in prod (MITM exposure) | Med | Off by default; LOUD doctor/summary warning; documented security note |
| Config surface drifts vs pg/mysql `ssl` shape | Low | Follow the existing optional-field pattern; document the mssql-specific naming (tedious terms) |
| Perceived as full "TLS support" (over-scoped) | Low | Proposal scopes to two booleans; CA trust stays env-based |

## Rollback Plan

Revert the two schema fields, their parsing, and the wiring spread; the port and tedious strategy already tolerate
their absence (conditional spread). No other change.

## Dependencies

- Existing port fields (`schema-adapter.ts:58-59`) + tedious application (`native-tedious.strategy.ts:217-220`) —
  already shipped.
- **Predecessor:** archived `mssql-config-hardening` (2026-07-11) explicitly DEFERRED these fields ("TLS config
  fields `trustServerCertificate`/`encrypt` — backlog") and hardened `parseMssqlSource` to reject plaintext on
  IDENTITY fields (server/database/user/password/port/domain). These TLS booleans are NOT identity fields — informing
  the env-ref Open Question above. This change is that deferred backlog item.

## Success Criteria

- [ ] `dbgraph.config.json` can set `trustServerCertificate: true` (and/or `encrypt`) for an mssql source and
      live-sync against a self-signed-cert server with NO SAN-cert / `NODE_EXTRA_CA_CERTS` workaround.
- [ ] Defaults are unchanged (`encrypt: true`, verification on) when the fields are omitted.
- [ ] Enabling `trustServerCertificate: true` emits a loud security warning (doctor and/or sync summary).
