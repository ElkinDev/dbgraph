/**
 * Shared fixture NodeMaps for infer-references unit tests.
 * Task 2.1 (Batch 2) — data only, no test logic.
 *
 * SQL fixture: dbo.customers / dbo.products / dbo.orders / dbo.invoices /
 *              dbo.customer / dbo.lines + PK constraint nodes.
 * Mongo fixture: orders collection + customer_id field (ObjectId),
 *                customers collection + _id field (ObjectId).
 *
 * All IDs are derived via the production nodeId/edgeId so qnames + ids
 * are byte-identical to what the real extractor would produce (ADR-008).
 *
 * ADR-004: imports only core model types + src/core/normalize/id.ts.
 * US-008
 */

import type { GraphNode } from '../../../src/core/model/node.js';
import type { GraphEdge } from '../../../src/core/model/edge.js';
import { nodeId, edgeId } from '../../../src/core/normalize/id.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — build typed GraphNode / GraphEdge objects
// ─────────────────────────────────────────────────────────────────────────────

function makeTable(schema: string, name: string): GraphNode {
  const qname = `${schema}.${name}`;
  return {
    id: nodeId('table', qname),
    kind: 'table',
    schema,
    name,
    qname,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: {},
  };
}

function makeColumn(
  schema: string,
  table: string,
  colName: string,
  dataType: string,
  ordinal: number,
): GraphNode {
  const qname = `${schema}.${table}.${colName}`;
  return {
    id: nodeId('column', qname),
    kind: 'column',
    schema,
    name: colName,
    qname,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: { dataType, nullable: false, ordinal, default: null },
  };
}

function makePkConstraint(
  schema: string,
  table: string,
  constraintName: string,
  columns: readonly string[],
): GraphNode {
  const qname = `${schema}.${table}.${constraintName}`;
  return {
    id: nodeId('constraint', qname),
    kind: 'constraint',
    schema,
    name: constraintName,
    qname,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: { type: 'PK', columns },
  };
}

// Mongo helpers — no schema prefix

function makeMongoConstraint(
  collection: string,
  constraintName: string,
  columns: readonly string[],
): GraphNode {
  // qname = 'collection.constraintName' so that stripping the last segment
  // gives the parent collection qname (used by the engine's PK indexer, D2).
  const qname = `${collection}.${constraintName}`;
  return {
    id: nodeId('constraint', qname),
    kind: 'constraint',
    schema: null,
    name: constraintName,
    qname,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: { type: 'PK', columns },
  };
}

function makeCollection(name: string): GraphNode {
  return {
    id: nodeId('collection', name),
    kind: 'collection',
    schema: null,
    name,
    qname: name,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: {},
  };
}

function makeField(collection: string, fieldName: string, dataType: string, ordinal: number): GraphNode {
  const qname = `${collection}.${fieldName}`;
  return {
    id: nodeId('field', qname),
    kind: 'field',
    schema: null,
    name: fieldName,
    qname,
    level: 'full',
    missing: false,
    excluded: false,
    bodyHash: null,
    payload: { dataType, nullable: false, ordinal, default: null },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL fixture NodeMap
// ─────────────────────────────────────────────────────────────────────────────
//
// Tables and columns:
//   dbo.customers     → col id (int)        + PK constraint on ['id']
//   dbo.products      → col id (int)        + PK constraint on ['id']
//   dbo.orders        → col customer_id (int), col status_id (int)  (no status* table)
//   dbo.invoices      → col customerId (int)  (camel conv → singular target)
//   dbo.customer      → col id (int)        + PK constraint on ['id'] (singular of customers)
//   dbo.lines         → col id_product (int)  (prefix conv → plural target)

const tCustomers = makeTable('dbo', 'customers');
const cCustomersId = makeColumn('dbo', 'customers', 'id', 'int', 1);
const pkCustomers = makePkConstraint('dbo', 'customers', 'pk_customers', ['id']);

const tProducts = makeTable('dbo', 'products');
const cProductsId = makeColumn('dbo', 'products', 'id', 'int', 1);
const pkProducts = makePkConstraint('dbo', 'products', 'pk_products', ['id']);

const tOrders = makeTable('dbo', 'orders');
const cOrdersCustomerId = makeColumn('dbo', 'orders', 'customer_id', 'int', 1);
const cOrdersStatusId = makeColumn('dbo', 'orders', 'status_id', 'int', 2);

const tInvoices = makeTable('dbo', 'invoices');
const cInvoicesCustomerId = makeColumn('dbo', 'invoices', 'customerId', 'int', 1);

// Singular target 'dbo.customer' for camelCase test
const tCustomer = makeTable('dbo', 'customer');
const cCustomerId = makeColumn('dbo', 'customer', 'id', 'int', 1);
const pkCustomer = makePkConstraint('dbo', 'customer', 'pk_customer', ['id']);

const tLines = makeTable('dbo', 'lines');
const cLinesIdProduct = makeColumn('dbo', 'lines', 'id_product', 'int', 1);

const SQL_NODES: readonly GraphNode[] = [
  tCustomers, cCustomersId, pkCustomers,
  tProducts, cProductsId, pkProducts,
  tOrders, cOrdersCustomerId, cOrdersStatusId,
  tInvoices, cInvoicesCustomerId,
  tCustomer, cCustomerId, pkCustomer,
  tLines, cLinesIdProduct,
];

/**
 * SQL-like fixture NodeMap containing customers/orders/products/invoices/lines
 * tables with their columns and PK constraint nodes.
 * Used by infer-references unit tests.
 */
export const sqlFixture: ReadonlyMap<string, GraphNode> = new Map(
  SQL_NODES.map((n) => [n.id, n]),
);

// ─────────────────────────────────────────────────────────────────────────────
// SQL fixture — type-incompatibility variant
// Same as sqlFixture but orders.customer_id is 'string' (incompatible with
// customers.id 'int') — proves the HARD REJECT in the engine.
// ─────────────────────────────────────────────────────────────────────────────

const cOrdersCustomerIdStr = makeColumn('dbo', 'orders', 'customer_id', 'string', 1);

const SQL_INCOMPAT_NODES: readonly GraphNode[] = [
  tCustomers, cCustomersId, pkCustomers,
  tProducts, cProductsId, pkProducts,
  tOrders, cOrdersCustomerIdStr, cOrdersStatusId,
  tInvoices, cInvoicesCustomerId,
  tCustomer, cCustomerId, pkCustomer,
  tLines, cLinesIdProduct,
];

/**
 * SQL fixture variant where orders.customer_id is typed 'string'.
 * Used to verify the type-incompatibility HARD REJECT (no edge emitted).
 */
export const sqlIncompatFixture: ReadonlyMap<string, GraphNode> = new Map(
  SQL_INCOMPAT_NODES.map((n) => [n.id, n]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Mongo-like fixture NodeMap
// ─────────────────────────────────────────────────────────────────────────────
//
// Collections:
//   orders     → field customer_id (ObjectId)
//   customers  → field _id (ObjectId)   ← treated as PK via constraint OR _id convention

// For Mongo _id PK detection we use a constraint node so the same PK-via-constraint
// path is exercised (D2). The _id field is the PK column.
const cOrders = makeCollection('orders');
const fOrdersCustomerId = makeField('orders', 'customer_id', 'ObjectId', 1);

const cCustomersCol = makeCollection('customers');
const fCustomersId = makeField('customers', '_id', 'ObjectId', 1);
// PK constraint in the Mongo-like fixture.
// For a MongoDB collection 'customers' (no schema, qname='customers'),
// the constraint qname must be 'customers.pk_customers' so that the engine
// can derive the parent table qname by stripping the last segment: 'customers'.
// We use the generic makeConstraintForMongo helper below.
const pkMongoCustomers = makeMongoConstraint('customers', 'pk_customers', ['_id']);

const MONGO_NODES: readonly GraphNode[] = [
  cOrders, fOrdersCustomerId,
  cCustomersCol, fCustomersId, pkMongoCustomers,
];

/**
 * Mongo-like fixture NodeMap containing orders/customers collections with
 * ObjectId fields. Proves the engine is engine-agnostic before Phase 9b.
 */
export const mongoFixture: ReadonlyMap<string, GraphNode> = new Map(
  MONGO_NODES.map((n) => [n.id, n]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for assertions (exported so tests can compose exact-set assertions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the concise shape needed for exact-set assertions.
 * Returns { src, dst, srcColumn, dstColumn, score } from a GraphEdge,
 * where src/dst are the QNAMES (not IDs) for readability.
 *
 * Note: src/dst in GraphEdge are node IDs; the test must compare IDs directly
 * OR use this helper with a nodes map to reverse-lookup. To keep fixtures
 * self-contained, we export raw helpers and let the test produce exact IDs.
 */
export interface EdgeShape {
  readonly src: string;       // node id of source column
  readonly dst: string;       // node id of dest column
  readonly srcColumn: string; // local column name
  readonly dstColumn: string; // local column name
  readonly score: number;
}

export function qnamesOf(edges: readonly GraphEdge[]): readonly EdgeShape[] {
  return edges.map((e) => ({
    src: e.src,
    dst: e.dst,
    srcColumn: e.attrs.srcColumn ?? '',
    dstColumn: e.attrs.dstColumn ?? '',
    score: e.score ?? 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export key node IDs for assertion convenience
// ─────────────────────────────────────────────────────────────────────────────

export const nodeIds = {
  // SQL
  colOrdersCustomerId: cOrdersCustomerId.id,
  colOrdersStatusId: cOrdersStatusId.id,
  colCustomersId: cCustomersId.id,
  colCustomerId: cCustomerId.id,       // dbo.customer.id (singular table)
  colProductsId: cProductsId.id,
  colInvoicesCustomerId: cInvoicesCustomerId.id,
  colLinesIdProduct: cLinesIdProduct.id,
  // type-incompat variant — same column name but different node (string type)
  colOrdersCustomerIdStr: cOrdersCustomerIdStr.id,
  // Mongo
  fieldOrdersCustomerId: fOrdersCustomerId.id,
  fieldCustomersId: fCustomersId.id,
} as const;

// Also export the declared-edge factory so tests can build existingEdges for dedup tests
export function makeDeclaredReferencesEdge(
  srcColId: string,
  dstColId: string,
  srcColumn: string,
  dstColumn: string,
): GraphEdge {
  return {
    id: edgeId('references', srcColId, dstColId, `${srcColumn}>${dstColumn}`),
    kind: 'references',
    src: srcColId,
    dst: dstColId,
    confidence: 'declared',
    score: null,
    attrs: { srcColumn, dstColumn },
  };
}
