/**
 * Token-accounting formula (US-035, design §Token accounting D9). ONE boundary, applied
 * IDENTICALLY to both conditions: prefer ACTUAL runtime usage when the agent reports it;
 * otherwise `ceil(len/4)` over the schema-bearing string, LABELED as an approximation.
 * Pure — counts ONLY the schema-bearing text handed in; framing/question are excluded upstream.
 */

export type TokenMode = 'actual' | 'approx';

export interface TokenCount {
  readonly mode: TokenMode;
  readonly schemaTokens: number;
}

export interface SchemaTokenInput {
  /** The schema-bearing text: the WITHOUT DDL dump, or the concat of WITH tool outputs. */
  readonly schemaText: string;
  /** Actual runtime-reported token usage for the schema-bearing content, when available. */
  readonly actual?: number;
}

const CHARS_PER_TOKEN = 4;

export function schemaTokens(input: SchemaTokenInput): TokenCount {
  if (typeof input.actual === 'number') {
    return { mode: 'actual', schemaTokens: input.actual };
  }
  return { mode: 'approx', schemaTokens: Math.ceil(input.schemaText.length / CHARS_PER_TOKEN) };
}
