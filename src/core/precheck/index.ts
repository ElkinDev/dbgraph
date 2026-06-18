/**
 * Precheck core barrel — re-exports the public API of src/core/precheck/.
 * Both src/mcp/tools/precheck.ts and src/cli/commands/affected.ts consume
 * these via the main barrel (src/core/index.ts → src/index.ts).
 *
 * ADR-004: neutral module — imports only core query fns + ports.
 */

export { extractIdentifiers } from './extract.js';
export { runPrecheck } from './engine.js';
