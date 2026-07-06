/**
 * build-linux-docker — runs the linux-x64 SEA assembly inside Docker (design D9, phase-9.5c).
 *
 * `docker run --rm -v <repo>:/work -w /work node:24.18.0-bookworm-slim bash
 * scripts/sea/build-sea.sh` on a glibc base (the SAME steps as build-sea.ps1). A
 * cross-platform Node orchestrator is used instead of a paired .ps1/.sh so a single
 * `npm run build:sea:linux` works from any host shell (design listed .(ps1|sh); this
 * .mjs subsumes both). Output: dist/bin/dbgraph-linux-x64 (gitignored).
 *
 * The image pins the exact build Node (24.18.0, Batch 0 / ADR-009). Override the image
 * via DBGRAPH_LINUX_IMAGE if a mirror/tag differs.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const image = process.env['DBGRAPH_LINUX_IMAGE'] ?? 'node:24.18.0-bookworm-slim';

const args = [
  'run',
  '--rm',
  '-v',
  `${repoRoot}:/work`,
  '-w',
  '/work',
  image,
  'bash',
  'scripts/sea/build-sea.sh',
];

console.log(`docker ${args.join(' ')}`);
const result = spawnSync('docker', args, { stdio: 'inherit' });

if (result.error) {
  console.error('Failed to launch docker:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
