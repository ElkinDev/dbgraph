/**
 * Query module barrel.
 * Design §2 — public surface for the query package.
 * ADR-004: imports only from src/core; never from adapters/drivers/mcp/cli.
 */

export { getNeighbors } from './neighbors.js';
export { getImpact } from './impact.js';
export { findJoinPath } from './path.js';
export { search, LEVENSHTEIN_THRESHOLD, TYPO_CAP } from './search.js';
export type { SearchResult } from './search.js';
