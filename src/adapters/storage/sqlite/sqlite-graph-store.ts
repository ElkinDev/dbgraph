/**
 * SQLite implementation of the GraphStore port.
 * Design §2, §3, §11 — adapts the WritableSqliteHandle synchronous API to the async GraphStore port.
 * All synchronous calls are wrapped in already-resolved Promises (zero runtime cost per design).
 *
 * Boundary note: this adapter is under src/adapters/storage/sqlite/ and is EXEMPT from the
 * write-verb security scan that targets src/adapters/engines/* (source-extraction paths).
 * The local index MUST write to its own .dbgraph database file by design (ADR-005).
 *
 * Phase 9.5b: `import type { Database as Db, Statement }` REMOVED.
 * Constructor now takes a `WritableSqliteHandle`; all statement fields are `StatementHandle`.
 * The concrete driver never leaks into this file — only factory.ts selects it.
 */

import type { WritableSqliteHandle, StatementHandle } from './handle.js';
import type { GraphStore, UpsertResult, SearchHit, SnapshotRecord, SnapshotObjectRow } from '../../../core/ports/graph-store.js';
import type { GraphNode, NodeKind, NodePayload, IndexLevel } from '../../../core/model/node.js';
import type { GraphEdge, EdgeKind, EdgeConfidence, EdgeAttrs } from '../../../core/model/edge.js';
import type { NormalizedGraph } from '../../../core/model/graph.js';
import { StorageError } from '../../../core/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Row types (internal — not exported)
// ─────────────────────────────────────────────────────────────────────────────

interface NodeRow {
  id: string;
  kind: string;
  schema_name: string | null;
  name: string;
  qname: string;
  level: string;
  missing: number;
  excluded: number;
  body_hash: string | null;
  payload: string;
}

interface EdgeRow {
  id: string;
  kind: string;
  src_id: string;
  dst_id: string;
  confidence: string;
  score: number | null;
  attrs: string;
}

interface SnapshotRow {
  id: string;
  taken_at: string;
  engine: string;
  engine_version: string | null;
  fingerprint: string;
  counts: string;
}

interface MetaRow {
  value: string;
}

interface SnapshotObjectDbRow {
  snapshot_id: string;
  node_id: string;
  kind: string;
  qname: string;
  body_hash: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row ↔ domain mappers
// ─────────────────────────────────────────────────────────────────────────────

function rowToNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    kind: row.kind as NodeKind,
    schema: row.schema_name,
    name: row.name,
    qname: row.qname,
    level: row.level as IndexLevel,
    missing: row.missing === 1,
    excluded: row.excluded === 1,
    bodyHash: row.body_hash,
    payload: JSON.parse(row.payload) as NodePayload,
  };
}

function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    kind: row.kind as EdgeKind,
    src: row.src_id,
    dst: row.dst_id,
    confidence: row.confidence as EdgeConfidence,
    score: row.score,
    attrs: JSON.parse(row.attrs) as EdgeAttrs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SqliteGraphStore
// ─────────────────────────────────────────────────────────────────────────────

export class SqliteGraphStore implements GraphStore {
  private readonly handle: WritableSqliteHandle;

  // Prepared statements cached for performance.
  private readonly stmtUpsertNode: StatementHandle;
  private readonly stmtUpsertEdge: StatementHandle;
  private readonly stmtUpsertFts: StatementHandle;
  private readonly stmtDeleteFts: StatementHandle;
  private readonly stmtGetNode: StatementHandle;
  private readonly stmtGetNodesByKind: StatementHandle;
  private readonly stmtGetNodeByQName: StatementHandle;
  private readonly stmtGetEdgesFrom: StatementHandle;
  private readonly stmtGetEdgesTo: StatementHandle;
  private readonly stmtDeleteNodeEdges: StatementHandle;
  private readonly stmtDeleteNodeFts: StatementHandle;
  private readonly stmtDeleteNode: StatementHandle;
  private readonly stmtGetMeta: StatementHandle;
  private readonly stmtSetMeta: StatementHandle;
  private readonly stmtPutSnapshot: StatementHandle;
  private readonly stmtListSnapshots: StatementHandle;
  private readonly stmtGetSchemaVersion: StatementHandle;
  private readonly stmtInsertSnapshotObject: StatementHandle;
  private readonly stmtGetSnapshotObjects: StatementHandle;

  // FTS read statements cached once per instance (F-7)
  private readonly stmtFtsSearch: StatementHandle;
  private readonly stmtFtsCount: StatementHandle;
  private readonly stmtFtsMatchBody: StatementHandle;
  private readonly stmtFtsMatchComment: StatementHandle;

  constructor(handle: WritableSqliteHandle) {
    this.handle = handle;

    this.stmtUpsertNode = handle.prepare(`
      INSERT INTO nodes (id, kind, schema_name, name, qname, level, missing, excluded, body_hash, payload)
      VALUES (@id, @kind, @schema_name, @name, @qname, @level, @missing, @excluded, @body_hash, @payload)
      ON CONFLICT(id) DO UPDATE SET
        kind       = excluded.kind,
        schema_name= excluded.schema_name,
        name       = excluded.name,
        qname      = excluded.qname,
        level      = excluded.level,
        missing    = excluded.missing,
        excluded   = excluded.excluded,
        body_hash  = excluded.body_hash,
        payload    = excluded.payload
    `);

    this.stmtUpsertEdge = handle.prepare(`
      INSERT INTO edges (id, kind, src_id, dst_id, confidence, score, attrs)
      VALUES (@id, @kind, @src_id, @dst_id, @confidence, @score, @attrs)
      ON CONFLICT(id) DO UPDATE SET
        kind      = excluded.kind,
        src_id    = excluded.src_id,
        dst_id    = excluded.dst_id,
        confidence= excluded.confidence,
        score     = excluded.score,
        attrs     = excluded.attrs
    `);

    // FTS5 does not support ON CONFLICT — delete + reinsert pattern.
    this.stmtUpsertFts = handle.prepare(`
      INSERT INTO nodes_fts (id, qname, comment, body) VALUES (@id, @qname, @comment, @body)
    `);
    this.stmtDeleteFts = handle.prepare(`DELETE FROM nodes_fts WHERE id = @id`);

    this.stmtGetNode = handle.prepare(`SELECT * FROM nodes WHERE id = ?`);
    this.stmtGetNodesByKind = handle.prepare(`SELECT * FROM nodes WHERE kind = ? ORDER BY qname, id`);
    this.stmtGetNodeByQName = handle.prepare(`SELECT * FROM nodes WHERE kind = ? AND qname = ?`);

    // getEdgesFrom/To with optional kind filter handled via two statements each.
    this.stmtGetEdgesFrom = handle.prepare(`SELECT * FROM edges WHERE src_id = ? ORDER BY kind, dst_id, id`);
    this.stmtGetEdgesTo   = handle.prepare(`SELECT * FROM edges WHERE dst_id = ? ORDER BY kind, src_id, id`);

    this.stmtDeleteNodeEdges = handle.prepare(`
      DELETE FROM edges WHERE src_id = ? OR dst_id = ?
    `);
    this.stmtDeleteNodeFts = handle.prepare(`DELETE FROM nodes_fts WHERE id = ?`);
    this.stmtDeleteNode    = handle.prepare(`DELETE FROM nodes WHERE id = ?`);

    this.stmtGetMeta = handle.prepare(`SELECT value FROM meta WHERE key = ?`);
    this.stmtSetMeta = handle.prepare(`
      INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    this.stmtPutSnapshot = handle.prepare(`
      INSERT INTO snapshots (id, taken_at, engine, engine_version, fingerprint, counts)
      VALUES (@id, @taken_at, @engine, @engine_version, @fingerprint, @counts)
      ON CONFLICT(id) DO UPDATE SET
        taken_at       = excluded.taken_at,
        engine         = excluded.engine,
        engine_version = excluded.engine_version,
        fingerprint    = excluded.fingerprint,
        counts         = excluded.counts
    `);

    this.stmtListSnapshots = handle.prepare(
      `SELECT * FROM snapshots ORDER BY rowid ASC`,
    );

    this.stmtGetSchemaVersion = handle.prepare(
      `SELECT value FROM meta WHERE key = 'schema_version'`,
    );

    // snapshot_objects manifest — phase-4-cli-config Batch F (Decision 3)
    // INSERT INTO snapshot_objects via SELECT from nodes (same transaction as putSnapshot).
    this.stmtInsertSnapshotObject = handle.prepare(`
      INSERT INTO snapshot_objects (snapshot_id, node_id, kind, qname, body_hash)
      SELECT ?, id, kind, qname, body_hash
      FROM nodes
      WHERE missing = 0 AND excluded = 0
      ORDER BY qname, id
    `);

    this.stmtGetSnapshotObjects = handle.prepare(`
      SELECT snapshot_id, node_id, kind, qname, body_hash
      FROM snapshot_objects
      WHERE snapshot_id = ?
      ORDER BY qname, node_id
    `);

    // FTS read statements — prepared once here to match the cached-statement pattern (F-7)
    this.stmtFtsSearch = handle.prepare(`
      SELECT
        n.id,
        n.kind,
        n.qname,
        bm25(nodes_fts) AS bm25_score
      FROM nodes_fts
      JOIN nodes n ON n.id = nodes_fts.id
      WHERE nodes_fts MATCH ?
      ORDER BY bm25_score ASC
      LIMIT ? OFFSET ?
    `);

    this.stmtFtsCount = handle.prepare(`
      SELECT COUNT(*) as cnt
      FROM nodes_fts
      WHERE nodes_fts MATCH ?
    `);

    this.stmtFtsMatchBody = handle.prepare(
      `SELECT 1 FROM nodes_fts WHERE id = ? AND nodes_fts MATCH 'body:' || ?`,
    );

    this.stmtFtsMatchComment = handle.prepare(
      `SELECT 1 FROM nodes_fts WHERE id = ? AND nodes_fts MATCH 'comment:' || ?`,
    );
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this.handle.close();
  }

  async schemaVersion(): Promise<number> {
    try {
      const row = this.stmtGetSchemaVersion.get() as MetaRow | undefined;
      return row !== undefined ? parseInt(row.value, 10) : 0;
    } catch (e) {
      throw new StorageError('schemaVersion failed', e);
    }
  }

  // ─── bulk write ─────────────────────────────────────────────────────────────

  async upsertGraph(graph: NormalizedGraph): Promise<UpsertResult> {
    let nodeCount = 0;
    let edgeCount = 0;

    const upsert = this.handle.transaction(() => {
      for (const node of graph.nodes) {
        // Extract comment from payload for FTS population (design §3.2).
        const payloadObj = node.payload as Record<string, unknown>;
        const comment =
          typeof payloadObj['comment'] === 'string' ? payloadObj['comment'] : '';

        // FTS: delete existing row then reinsert (FTS5 has no ON CONFLICT).
        // Only non-'off' nodes get an FTS row; 'off' nodes have no node at all per design.
        this.stmtDeleteFts.run({ id: node.id });

        this.stmtUpsertNode.run({
          id: node.id,
          kind: node.kind,
          schema_name: node.schema,
          name: node.name,
          qname: node.qname,
          level: node.level,
          missing: node.missing ? 1 : 0,
          excluded: node.excluded ? 1 : 0,
          body_hash: node.bodyHash,
          payload: JSON.stringify(node.payload),
        });

        // Level-gated FTS population (design §3.2, §5.4):
        // - metadata: qname + comment indexed, body empty
        // - full: qname + comment + body indexed
        // - off: no FTS row (off nodes have no node row either — normalizer omits them)
        if (node.level !== 'off') {
          const ftsBody = node.level === 'full' && node.bodyHash !== null
            ? (payloadObj['body'] as string | undefined) ?? ''
            : '';

          this.stmtUpsertFts.run({
            id: node.id,
            qname: node.qname,
            comment,
            body: ftsBody,
          });
        }

        nodeCount++;
      }

      for (const edge of graph.edges) {
        this.stmtUpsertEdge.run({
          id: edge.id,
          kind: edge.kind,
          src_id: edge.src,
          dst_id: edge.dst,
          confidence: edge.confidence,
          score: edge.score,
          attrs: JSON.stringify(edge.attrs),
        });
        edgeCount++;
      }
    });

    try {
      upsert();
    } catch (e) {
      throw new StorageError('upsertGraph failed', e);
    }

    return { nodes: nodeCount, edges: edgeCount };
  }

  async deleteNodes(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;

    let deleted = 0;
    const del = this.handle.transaction(() => {
      for (const id of ids) {
        this.stmtDeleteNodeEdges.run(id, id);
        this.stmtDeleteNodeFts.run(id);
        const info = this.stmtDeleteNode.run(id);
        deleted += info.changes;
      }
    });

    try {
      del();
    } catch (e) {
      throw new StorageError('deleteNodes failed', e);
    }

    return deleted;
  }

  // ─── reads ───────────────────────────────────────────────────────────────────

  async getNode(id: string): Promise<GraphNode | null> {
    try {
      const row = this.stmtGetNode.get(id) as NodeRow | undefined;
      return row !== undefined ? rowToNode(row) : null;
    } catch (e) {
      throw new StorageError('getNode failed', e);
    }
  }

  async getNodesByKind(kind: NodeKind): Promise<readonly GraphNode[]> {
    try {
      const rows = this.stmtGetNodesByKind.all(kind) as NodeRow[];
      return rows.map(rowToNode);
    } catch (e) {
      throw new StorageError('getNodesByKind failed', e);
    }
  }

  async getNodeByQName(kind: NodeKind, qname: string): Promise<GraphNode | null> {
    try {
      const row = this.stmtGetNodeByQName.get(kind, qname) as NodeRow | undefined;
      return row !== undefined ? rowToNode(row) : null;
    } catch (e) {
      throw new StorageError('getNodeByQName failed', e);
    }
  }

  // ─── edges / traversal ──────────────────────────────────────────────────────

  async getEdgesFrom(
    nodeId: string,
    kinds?: readonly EdgeKind[],
  ): Promise<readonly GraphEdge[]> {
    try {
      const rows = this.stmtGetEdgesFrom.all(nodeId) as EdgeRow[];
      const edges = rows.map(rowToEdge);
      if (kinds !== undefined && kinds.length > 0) {
        const kindSet = new Set<string>(kinds);
        return edges.filter((e) => kindSet.has(e.kind));
      }
      return edges;
    } catch (e) {
      throw new StorageError('getEdgesFrom failed', e);
    }
  }

  async getEdgesTo(
    nodeId: string,
    kinds?: readonly EdgeKind[],
  ): Promise<readonly GraphEdge[]> {
    try {
      const rows = this.stmtGetEdgesTo.all(nodeId) as EdgeRow[];
      const edges = rows.map(rowToEdge);
      if (kinds !== undefined && kinds.length > 0) {
        const kindSet = new Set<string>(kinds);
        return edges.filter((e) => kindSet.has(e.kind));
      }
      return edges;
    } catch (e) {
      throw new StorageError('getEdgesTo failed', e);
    }
  }

  // ─── FTS ────────────────────────────────────────────────────────────────────

  async searchFts(
    query: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{ hits: readonly SearchHit[]; total: number }> {
    const limit = opts?.limit ?? 20;
    const offset = opts?.offset ?? 0;

    // Build FTS5 MATCH query: use the query as-is (the query layer handles tokenization/prefix).
    // bm25() returns negative values; we negate to get a positive score for ranking.
    try {
      const rows = this.stmtFtsSearch.all(query, limit, offset) as Array<{
        id: string;
        kind: string;
        qname: string;
        bm25_score: number;
      }>;

      const countRow = this.stmtFtsCount.get(query) as { cnt: number };

      // Determine which column matched using per-column FTS highlight.
      const hits: SearchHit[] = rows.map((row) => {
        const col = this.detectMatchedColumn(row.id, query);
        return {
          id: row.id,
          kind: row.kind as NodeKind,
          qname: row.qname,
          column: col,
          score: -row.bm25_score, // negate: higher is better
        };
      });

      return { hits, total: countRow.cnt };
    } catch (e) {
      throw new StorageError('searchFts failed', e);
    }
  }

  /**
   * Detects which FTS column matched the query by running column-specific MATCH queries.
   * Returns 'qname' | 'comment' | 'body' (falls back to 'qname' if indeterminate).
   * Statements are prepared once in the constructor (F-7).
   */
  private detectMatchedColumn(
    nodeId: string,
    query: string,
  ): 'qname' | 'comment' | 'body' {
    try {
      const checkBody = this.stmtFtsMatchBody.get(nodeId, query);
      if (checkBody !== undefined) return 'body';

      const checkComment = this.stmtFtsMatchComment.get(nodeId, query);
      if (checkComment !== undefined) return 'comment';

      return 'qname';
    } catch {
      return 'qname';
    }
  }

  // ─── snapshots ──────────────────────────────────────────────────────────────

  async putSnapshot(s: SnapshotRecord): Promise<void> {
    // Write the snapshot row AND the snapshot_objects manifest in ONE transaction
    // (Design Decision 3 — manifest is a faithful photograph of current nodes at snapshot time).
    const writeSnapshotAndManifest = this.handle.transaction(() => {
      this.stmtPutSnapshot.run({
        id: s.id,
        taken_at: s.takenAt,
        engine: s.engine,
        engine_version: s.engineVersion ?? null,
        fingerprint: s.fingerprint,
        counts: JSON.stringify(s.counts),
      });
      // Populate snapshot_objects from current visible nodes (missing=0 AND excluded=0).
      this.stmtInsertSnapshotObject.run(s.id);
    });

    try {
      writeSnapshotAndManifest();
    } catch (e) {
      throw new StorageError('putSnapshot failed', e);
    }
  }

  async getSnapshotObjects(snapshotId: string): Promise<readonly SnapshotObjectRow[]> {
    try {
      const rows = this.stmtGetSnapshotObjects.all(snapshotId) as SnapshotObjectDbRow[];
      return rows.map((row) => ({
        snapshotId: row.snapshot_id,
        nodeId: row.node_id,
        kind: row.kind,
        qname: row.qname,
        bodyHash: row.body_hash,
      }));
    } catch (e) {
      throw new StorageError('getSnapshotObjects failed', e);
    }
  }

  async listSnapshots(): Promise<readonly SnapshotRecord[]> {
    try {
      const rows = this.stmtListSnapshots.all() as SnapshotRow[];
      return rows.map((row) => ({
        id: row.id,
        takenAt: row.taken_at,
        engine: row.engine,
        ...(row.engine_version !== null ? { engineVersion: row.engine_version } : {}),
        fingerprint: row.fingerprint,
        counts: JSON.parse(row.counts) as Record<string, number>,
      }));
    } catch (e) {
      throw new StorageError('listSnapshots failed', e);
    }
  }

  // ─── meta ────────────────────────────────────────────────────────────────────

  async getMeta(key: string): Promise<string | null> {
    try {
      const row = this.stmtGetMeta.get(key) as MetaRow | undefined;
      return row !== undefined ? row.value : null;
    } catch (e) {
      throw new StorageError('getMeta failed', e);
    }
  }

  async setMeta(key: string, value: string): Promise<void> {
    try {
      this.stmtSetMeta.run(key, value);
    } catch (e) {
      throw new StorageError('setMeta failed', e);
    }
  }
}
