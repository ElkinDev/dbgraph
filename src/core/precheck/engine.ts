/**
 * runPrecheck — precheck engine, task 4.3 / Batch D (phase-5-mcp-server).
 * Spec: match extracted identifiers to graph → aggregate getImpact → PrecheckView.
 * Design: PURE core (store, ddl) → PrecheckView; tags confidence:'parsed';
 *   reports unmatched identifiers; deduplicates impact across multiple statements.
 *
 * ADR-004: imports ONLY core query fns + core ports. NO adapters, NO cli, NO mcp.
 * ADR-007: no node-sql-parser. ADR-008: deterministic output.
 *
 * Placement: src/core/precheck/ — neutral module consumed by BOTH
 *   src/mcp/tools/precheck.ts AND src/cli/commands/affected.ts via the barrel.
 *   Neither cli nor mcp imports the other (ADR-004 boundary preserved).
 */

import type { GraphStore } from '../ports/graph-store.js';
import type { NodeKind } from '../model/node.js';
import { NODE_KINDS } from '../model/node.js';
import { getImpact } from '../query/impact.js';
import { extractIdentifiers } from './extract.js';
import type { PrecheckView, PrecheckItem, PrecheckImpactSection } from '../present/precheck.js';

// ─────────────────────────────────────────────────────────────────────────────
// resolveIdentifiers — match each extracted identifier against the graph
// ─────────────────────────────────────────────────────────────────────────────

interface ResolveResult {
  readonly matched: PrecheckItem[];
  readonly unmatched: string[];
}

/**
 * Tries to resolve each identifier against the graph by calling
 * getNodeByQName across all NodeKind values. The FIRST match wins.
 * Tags every matched item with confidence:'parsed'.
 */
async function resolveIdentifiers(
  store: GraphStore,
  identifiers: readonly string[],
): Promise<ResolveResult> {
  const matched: PrecheckItem[] = [];
  const unmatched: string[] = [];

  for (const id of identifiers) {
    let found = false;
    for (const kind of NODE_KINDS as readonly NodeKind[]) {
      const node = await store.getNodeByQName(kind, id);
      if (node !== null) {
        matched.push({ qname: node.qname, kind: node.kind, confidence: 'parsed' });
        found = true;
        break;
      }
    }
    if (!found) {
      unmatched.push(id);
    }
  }

  return { matched, unmatched };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildImpactSection — aggregate getImpact across matched objects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each matched object, runs getImpact and aggregates the results into
 * the PrecheckImpactSection structure. Deduplicates by qname within each bucket.
 *
 * Mapping of ImpactResult chains to PrecheckImpactSection:
 *   - writeImpact chains → writers (first non-root node in each chain)
 *   - readImpact chains  → readers (first non-root node in each chain)
 *   - nodes with kind 'trigger' found in any chain → triggers
 *   - nodes with kind 'index' or 'constraint' → constraintsAndIndexes
 *   - whatToTest: deduplicated list of qnames of all impacted objects
 *
 * All items carry confidence:'parsed'.
 */
async function buildImpactSection(
  store: GraphStore,
  matchedItems: readonly PrecheckItem[],
): Promise<PrecheckImpactSection> {
  const triggersMap = new Map<string, PrecheckItem>();
  const writersMap  = new Map<string, PrecheckItem>();
  const readersMap  = new Map<string, PrecheckItem>();
  const ciMap       = new Map<string, PrecheckItem>();  // constraints + indexes
  const whatToTestSet = new Set<string>();

  for (const item of matchedItems) {
    // Look up the node id so we can call getImpact
    let nodeId: string | null = null;
    for (const kind of NODE_KINDS as readonly NodeKind[]) {
      const node = await store.getNodeByQName(kind, item.qname);
      if (node !== null) {
        nodeId = node.id;
        break;
      }
    }
    if (nodeId === null) continue;

    const impact = await getImpact(store, { nodeId, depth: 3 });

    // Resolve each chain's node ids to qname + kind
    const resolveNode = async (id: string): Promise<{ qname: string; kind: string } | null> => {
      const node = await store.getNode(id);
      return node !== null ? { qname: node.qname, kind: node.kind } : null;
    };

    // Walk write chains
    for (const chain of impact.writeImpact) {
      // Skip the first node (that's the pivot itself); collect the rest
      for (let i = 1; i < chain.nodes.length; i++) {
        const id = chain.nodes[i];
        if (id === undefined) continue;
        const n = await resolveNode(id);
        if (n === null) continue;
        const pItem: PrecheckItem = { qname: n.qname, kind: n.kind, confidence: 'parsed' };
        whatToTestSet.add(n.qname);
        if (n.kind === 'trigger') {
          triggersMap.set(n.qname, pItem);
        } else if (n.kind === 'index' || n.kind === 'constraint') {
          ciMap.set(n.qname, pItem);
        } else {
          writersMap.set(n.qname, pItem);
        }
      }
    }

    // Walk read chains
    for (const chain of impact.readImpact) {
      for (let i = 1; i < chain.nodes.length; i++) {
        const id = chain.nodes[i];
        if (id === undefined) continue;
        const n = await resolveNode(id);
        if (n === null) continue;
        const pItem: PrecheckItem = { qname: n.qname, kind: n.kind, confidence: 'parsed' };
        whatToTestSet.add(n.qname);
        if (n.kind === 'trigger') {
          triggersMap.set(n.qname, pItem);
        } else if (n.kind === 'index' || n.kind === 'constraint') {
          ciMap.set(n.qname, pItem);
        } else {
          readersMap.set(n.qname, pItem);
        }
      }
    }
  }

  return {
    triggers: [...triggersMap.values()].sort((a, b) => a.qname.localeCompare(b.qname)),
    writers: [...writersMap.values()].sort((a, b) => a.qname.localeCompare(b.qname)),
    readers: [...readersMap.values()].sort((a, b) => a.qname.localeCompare(b.qname)),
    constraintsAndIndexes: [...ciMap.values()].sort((a, b) => a.qname.localeCompare(b.qname)),
    whatToTest: [...whatToTestSet].sort(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runPrecheck — public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts identifiers from `ddl`, matches them against the graph,
 * aggregates `getImpact` across all matched objects, and returns a
 * `PrecheckView` ready for `formatPrecheck`.
 *
 * Every matched item and impact item carries `confidence: 'parsed'`.
 * Identifiers that match no graph node appear in `unmatchedIdentifiers`.
 * Impact sections are deduplicated across all statements.
 *
 * @param store  The open GraphStore (read-only; no writes issued).
 * @param ddl    Raw DDL string (one or more statements).
 * @returns      PrecheckView with matchedObjects, impact, unmatchedIdentifiers.
 */
export async function runPrecheck(store: GraphStore, ddl: string): Promise<PrecheckView> {
  if (ddl.trim() === '') {
    return {
      matchedObjects: [],
      impact: {
        triggers: [],
        writers: [],
        readers: [],
        constraintsAndIndexes: [],
        whatToTest: [],
      },
      unmatchedIdentifiers: [],
    };
  }

  // Step 1: extract identifiers from DDL
  const identifiers = extractIdentifiers(ddl);

  // Step 2: resolve identifiers against the graph
  const { matched, unmatched } = await resolveIdentifiers(store, identifiers);

  // Step 3: deduplicate matched objects by qname
  const matchedMap = new Map<string, PrecheckItem>();
  for (const item of matched) {
    matchedMap.set(item.qname, item);
  }
  const dedupedMatched = [...matchedMap.values()].sort((a, b) => a.qname.localeCompare(b.qname));

  // Step 4: aggregate impact across all matched objects
  const impactSection = await buildImpactSection(store, dedupedMatched);

  return {
    matchedObjects: dedupedMatched,
    impact: impactSection,
    unmatchedIdentifiers: [...new Set(unmatched)].sort(),
  };
}
