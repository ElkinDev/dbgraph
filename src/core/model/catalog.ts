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
  // Routines: ordinal-ordered call parameters (procedure/function only). OPTIONAL — an engine
  // with a parameter catalog (mssql/pg/mysql) populates it; an engine without one (sqlite)
  // leaves it UNSET (honest absence, "unknown" ≠ "known-zero"). DOG-2 §3.1 D2.
  readonly parameters?: readonly RawParameter[];
  readonly extra?: Readonly<Record<string, unknown>>; // engine-specific passthrough → payload
}

/**
 * A single routine call parameter — the durable adapter→core contract (mirrors the
 * RoutineParameter accessor view in node.ts). DOG-2 §3.1 D2. dataType is the RAW engine
 * type STRING, composed IDENTICALLY to the SAME engine's COLUMN dataType (NO cross-engine
 * normalization). direction/hasDefault are sourced ONLY from a real catalog signal.
 */
export interface RawParameter {
  readonly name: string;
  readonly dataType: string;
  readonly direction: 'in' | 'out' | 'inout';
  readonly hasDefault?: boolean;                 // OMITTED where the catalog cannot express it
  readonly ordinal: number;                      // 1-based, contiguous over emitted params
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
  // `target.kind` is LOAD-BEARING (DOG-1): when it is a routine (`procedure`/`function`)
  // the normalizer emits a `calls` edge resolved to the real routine node instead of the
  // default read/write-over-`table` branch. mssql sets it from the catalog (`ref.type`) and
  // carries `confidence: 'declared'`; pg/mysql set it from the body tokenizer (`parsed`).
  // Every non-routine target leaves `kind` unset and keeps the existing read/write logic.
  readonly target: { schema: string | null; name: string; kind?: NodeKind };
  readonly access: 'read' | 'write';            // read/write classification (US-007)
  readonly confidence: 'declared' | 'parsed';   // declared (catalog dep view) vs parsed (body)
  // DOG-3 (design D1/D2; schema-extraction): OPTIONAL source-column SET a view CONSUMES from
  // this dependency's target table. An engine with a view-column catalog (mssql, pg) populates
  // it per view dependency the catalog sources; an engine without one (mysql, sqlite) leaves it
  // UNSET — honest absence ("unknown" ≠ "known-zero"; a whole-object / `SELECT *` reference is
  // also UNSET). SOURCE-column SET only, provenance `declared` — NEVER inferred, never
  // body-parsed, never an output↔source mapping (ADR-007). The normalizer stamps it sorted-unique
  // as `attrs.dstColumns` on the view→table `depends_on` edge; UNSET → byte-identical object grain.
  readonly columns?: readonly string[];
}
