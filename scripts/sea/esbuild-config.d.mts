/**
 * Type declarations for esbuild-config.mjs (build tooling; not part of the shipped
 * package). Lets the unit test consume the config-as-data with real types — no `any`,
 * no @ts-expect-error (strict). Kept in sync with esbuild-config.mjs manually.
 */

export const SEA_EXTERNAL: readonly string[];
export const SEA_TRANSITIVE_EXTERNAL: readonly string[];

export function versionDefine(version: string): { 'process.env.DBGRAPH_BUILD_VERSION': string };

export interface SeaBuildOptions {
  entryPoints: string[];
  outfile: string;
  bundle: boolean;
  platform: string;
  format: string;
  target: string;
  external: string[];
  define: Record<string, string>;
  minify: boolean;
  sourcemap: boolean;
  legalComments: string;
}

export function buildOptions(version: string): SeaBuildOptions;
