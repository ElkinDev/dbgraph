---
name: Bug report
about: Report a problem with dbgraph
title: ''
labels: bug
assignees: ''
---

## What happened

A clear description of the bug — what you did, and what went wrong.

## Steps to reproduce

1. …
2. …
3. …

## Expected behavior

What you expected to happen instead.

## `dbgraph doctor` output

Run `dbgraph doctor` and paste its full output below. This report is **content-free by
design** — it contains no schema name, object identifier, query result, or secret, so it
is safe to paste in a public issue (see `openspec/specs/connectivity-diagnostics/spec.md`
— "dbgraph doctor reports diagnostics content-free").

```text
(paste `dbgraph doctor` output here)
```

## Environment

- **dbgraph version** (`dbgraph --version`):
- **OS** (e.g. Windows 11, Ubuntu 24.04, macOS 15):
- **Node.js version** (`node --version`):
- **Database engine** (sqlite / mssql / postgres / mysql / mongodb) and version:

## Additional context

Logs (with any secrets redacted), screenshots, or anything else that helps. Never paste
credentials — dbgraph references secrets only as `${env:VAR}`.
