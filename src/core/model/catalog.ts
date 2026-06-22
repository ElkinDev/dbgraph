/**
 * RawCatalog — the durable adapter→core contract.
 * Design §4.5 — what every engine adapter produces and feeds to normalizeCatalog.
 * This file imports NOTHING from adapters, drivers, mcp, or cli (ADR-004).
 */

import type { NodeKind } from './node.js';

export interface RawCatalog {
  readonly engine: string;
  readonly engineVersion?: string;
  readonly schemas: readonly string[];          // namespaces discovered
  readonly objects: readonly RawObject[];        // every extracted object, any kind
}

export interface RawField {
  readonly name: string;
  readonly dataType: string;     // union form like 'int|string' (sorted) — NOT a types[] array
  readonly frequency: number;    // presence ratio 0.0–1.0 across sampled documents
  readonly nullable?: boolean;
}

export interface RawObject {
  readonly kind: NodeKind;
  readonly schema: string | null;
  readonly name: string;
  // Structural children (tables/views): columns, constraints, indexes.
  readonly columns?: readonly RawColumn[];
  readonly constraints?: readonly RawConstraint[];
  readonly indexes?: readonly RawIndex[];
  // Schemaless field structure (MongoDB / schemaless engines only).
  // SQL engines MUST leave this unset — the normalizer branch is provably inert.
  readonly fields?: readonly RawField[];
  // Routines/triggers: body (level-gated) + dependency hints + dynamic-sql blindness flag.
  readonly signature?: string;
  readonly returns?: string;
  readonly body?: string;                        // adapter SHOULD omit unless level requires it
  readonly hasDynamicSql?: boolean;              // US-007: declared blindness, not hidden
  readonly trigger?: RawTriggerInfo;             // timing + events + target table
  readonly dependencies?: readonly RawDependency[]; // read/write hints (US-007)
  readonly comment?: string;                     // catalog comment/description
  readonly extra?: Readonly<Record<string, unknown>>; // engine-specific passthrough → payload
}

export interface RawColumn {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly default?: string | null;
  readonly ordinal: number;
  readonly comment?: string;
}

export interface RawConstraint {
  readonly name: string;
  readonly type: 'PK' | 'FK' | 'UNIQUE' | 'CHECK';
  readonly columns: readonly string[];
  readonly references?: {
    schema: string | null;
    table: string;
    columns: readonly string[];  // FK target (column order aligns with `columns`)
  };
  readonly definition?: string;              // CHECK expression, etc.
}

export interface RawIndex {
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
  readonly method?: string;
}

export interface RawTriggerInfo {
  readonly timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  readonly events: readonly ('INSERT' | 'UPDATE' | 'DELETE')[];
  readonly table: { schema: string | null; name: string };
}

export interface RawDependency {
  readonly target: { schema: string | null; name: string; kind?: NodeKind };
  readonly access: 'read' | 'write';            // read/write classification (US-007)
  readonly confidence: 'declared' | 'parsed';   // declared (catalog dep view) vs parsed (body)
}
