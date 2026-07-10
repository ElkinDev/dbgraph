/**
 * Task 2.1 — RED→GREEN: the GraphStore port gains the bulk read-only seam.
 *
 * Adds `getAllNodes(): Promise<readonly GraphNode[]>` and
 * `getAllEdges(): Promise<readonly GraphEdge[]>` to the `GraphStore` port (graph-storage
 * "Bulk read-only whole-graph traversal seam"). NO other port method changes.
 *
 * This is a TYPE-LEVEL pin (an implementer must satisfy the extended port) plus a runtime
 * check over a conforming in-memory double. ADR-004: the port imports only core model
 * types. L-009: exact assertions, no `.toBeDefined()`.
 */

import { describe, it, expect } from 'vitest';
import type { GraphStore } from '../../../src/core/ports/graph-store.js';
import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';

describe('GraphStore port — bulk read-only seam (task 2.1)', () => {
  it('declares getAllNodes and getAllEdges on the port (compile-time shape)', () => {
    type HasGetAllNodes = GraphStore extends { getAllNodes: unknown } ? true : false;
    type HasGetAllEdges = GraphStore extends { getAllEdges: unknown } ? true : false;
    // These resolve to `false` (a compile error on the tuple) if the port lacks a method.
    const shape: [HasGetAllNodes, HasGetAllEdges] = [true, true];
    expect(shape).toStrictEqual([true, true]);
  });

  it('pins the exact return types (readonly node/edge array promises)', () => {
    // Assignability check: a function of the declared signature must be assignable to the
    // port member type. tsc --noEmit fails here if the signature drifts.
    type NodesFn = GraphStore['getAllNodes'];
    type EdgesFn = GraphStore['getAllEdges'];
    const nodesFn: NodesFn = async (): Promise<readonly GraphNode[]> => [];
    const edgesFn: EdgesFn = async (): Promise<readonly GraphEdge[]> => [];
    expect(typeof nodesFn).toBe('function');
    expect(typeof edgesFn).toBe('function');
  });

  it('an in-memory implementer satisfies the extended port and returns everything', async () => {
    const node: GraphNode = {
      id: 'n1', kind: 'table', schema: 'main', name: 't', qname: 'main.t',
      level: 'full', missing: false, excluded: false, bodyHash: null, payload: {},
    };
    const edge: GraphEdge = {
      id: 'e1', kind: 'references', src: 'n1', dst: 'n1',
      confidence: 'declared', score: null, attrs: {},
    };

    // Typed as the full port — if getAllNodes/getAllEdges were missing, this object
    // literal would be a type error (excess) OR the port would not require them.
    const doubl: Pick<GraphStore, 'getAllNodes' | 'getAllEdges'> = {
      getAllNodes: () => Promise.resolve([node]),
      getAllEdges: () => Promise.resolve([edge]),
    };

    expect(await doubl.getAllNodes()).toStrictEqual([node]);
    expect(await doubl.getAllEdges()).toStrictEqual([edge]);
  });
});
