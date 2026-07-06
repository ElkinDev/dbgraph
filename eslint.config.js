import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// ─────────────────────────────────────────────────────────────────────────────
// src/core host-independence guard.
//
// node:path (and 'path') resolve `basename`, `join`, `dirname`, … against the
// HOST OS separator. In code whose OUTPUT must be host-independent that silently
// mangles or leaks paths — e.g. on Linux `basename('C:\\Users\\alice\\x')` returns
// the whole Windows string, embedded username and all. Three shipped bugs trace
// back to exactly this class; CI-ubuntu used to catch them, Windows-only dev is
// blind to it. src/core is pure and host-independent by contract (ADR-004 /
// ADR-008), so it must never reach for the host-default members.
//
// The explicit-platform namespaces (`win32`, `posix`) stay allowed — choosing a
// separator on purpose is the sanctioned pattern. For "just the last segment"
// use a host-independent helper that splits on both separators (see
// present/doctor.ts `lastPathSegment`).
// ─────────────────────────────────────────────────────────────────────────────
const HOST_DEPENDENT_PATH_MEMBERS = [
  'default',
  'basename',
  'join',
  'dirname',
  'resolve',
  'relative',
  'extname',
  'normalize',
  'sep',
  'delimiter',
];

const PATH_GUARD_MESSAGE =
  "Host-dependent 'node:path' members are banned in src/core: their result depends " +
  'on the host OS separator, so they mangle/leak paths across platforms. Use the ' +
  "explicit 'win32' or 'posix' namespaces, or a host-independent helper that splits " +
  "on both separators (see present/doctor.ts 'lastPathSegment').";

const pathGuard = (name) => ({
  name,
  importNames: HOST_DEPENDENT_PATH_MEMBERS,
  message: PATH_GUARD_MESSAGE,
});

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Host-independence guard — scoped to the pure core only.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [pathGuard('node:path'), pathGuard('path')] }],
    },
  },
);
