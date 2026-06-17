/**
 * Logger port — design §7.2.
 * Core uses the injected Logger; never console.log (dbgraph-conventions).
 * A no-op default logger is exported so functions can take an optional logger
 * without null checks.
 */

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** No-op default logger — used when the caller does not inject one. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
