/**
 * MongoDB torture dataset — reviewable programmatic seed.
 * Design §"torture (programmatic insert, mirroring mysql/container.ts but Mongo)".
 *
 * Exercises 100% of MONGODB_CAPABILITIES:
 *   - customers  : ObjectId _id, unique email index, age (Int32 — sometimes-present ~0.875),
 *                  address.city nested sub-doc
 *   - orders     : ObjectId _id, ObjectId customer_id→customers._id reference;
 *                  $jsonSchema validator; compound [customer_id, status] index;
 *                  items[] array-of-subdocs; always-present + sometimes-present fields;
 *                  code field: MIXED TYPE (Int32 in some, string in others) → int|string union
 *   - products   : ObjectId _id, unique sku index; tags[] array of scalars
 *   - events     : ObjectId _id, mixed-type payload field (object|string)
 *
 * Sentinel leak-check value: 'sentinel@leak-check.invalid'
 * This distinctive email appears in a customer document; the integration test
 * asserts it is ABSENT from the serialized RawCatalog AND from the persisted .db.
 *
 * BSON type choices (reality-driven, pinned by Task 7.4 against mongo:7):
 *   - _id          : ObjectId → dataType 'objectId' → family 'oid'
 *   - customer_id  : ObjectId → dataType 'objectId' → family 'oid'
 *                    This ensures inference only matches customers._id (oid family),
 *                    NOT string-typed fields like email or name.
 *   - age          : Int32 → dataType 'int'  (7/8 docs present → freq ~0.875)
 *   - code         : Int32 in 6/8 orders, string in 2/8 → union 'int|string'
 *   - total        : plain JS number → BSON Double → dataType 'numeric'
 *
 * Dataset is FIXED so $sample(size >= doc_count) returns the full dataset
 * → deterministic golden (ADR-008).
 *
 * US-030 (torture fixture), ADR-008 (determinism), dbgraph-security (sentinel check).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel value (leak-check — NEVER appears in extracted metadata)
// ─────────────────────────────────────────────────────────────────────────────

/** Distinctive value that must NEVER appear in RawCatalog or persisted .db. */
export const SENTINEL_VALUE = 'sentinel@leak-check.invalid';

// ─────────────────────────────────────────────────────────────────────────────
// Collection names
// ─────────────────────────────────────────────────────────────────────────────

export const COLLECTIONS = {
  customers: 'customers',
  orders: 'orders',
  products: 'products',
  events: 'events',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// BSON type interfaces (duck-typed, no top-level mongodb import — ADR-006)
// ─────────────────────────────────────────────────────────────────────────────

interface ObjectIdLike {
  _bsontype: 'ObjectId';
  toString(): string;
}

interface Int32Like {
  _bsontype: 'Int32';
  value: number;
}

interface MongodbBsonModule {
  ObjectId: new (id?: string) => ObjectIdLike;
  Int32: new (value: number) => Int32Like;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed data factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts the fixed torture dataset into the given MongoDB database.
 * Uses a seed-only connection (never reused by the adapter under test).
 * Uses BSON ObjectId for _id and customer_id fields to achieve correct
 * type inference (objectId → 'oid' family, not mixed with string fields).
 *
 * @param db - A connected mongodb Db instance.
 */
export async function applyTortureSeed(db: {
  collection: (name: string) => {
    insertMany: (docs: Record<string, unknown>[]) => Promise<unknown>;
    createIndex: (
      keys: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  command: (cmd: Record<string, unknown>) => Promise<Record<string, unknown>>;
  createCollection: (
    name: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
}): Promise<void> {
  // Load BSON types lazily from mongodb driver (ADR-006)
  const mongoMod = await import('mongodb' as string) as MongodbBsonModule;
  const { ObjectId, Int32 } = mongoMod;

  // ── Fixed ObjectId values for the 8 customers (deterministic — ADR-008) ────
  // Using fixed hex strings so the seed is reproducible and the golden is stable.
  const custIds = [
    new ObjectId('000000000000000000000001'),
    new ObjectId('000000000000000000000002'),
    new ObjectId('000000000000000000000003'),
    new ObjectId('000000000000000000000004'),
    new ObjectId('000000000000000000000005'),
    new ObjectId('000000000000000000000006'),
    new ObjectId('000000000000000000000007'),
    new ObjectId('000000000000000000000008'),
  ];

  const ordIds = [
    new ObjectId('000000000000000000000011'),
    new ObjectId('000000000000000000000012'),
    new ObjectId('000000000000000000000013'),
    new ObjectId('000000000000000000000014'),
    new ObjectId('000000000000000000000015'),
    new ObjectId('000000000000000000000016'),
    new ObjectId('000000000000000000000017'),
    new ObjectId('000000000000000000000018'),
  ];

  const prodIds = [
    new ObjectId('000000000000000000000021'),
    new ObjectId('000000000000000000000022'),
    new ObjectId('000000000000000000000023'),
    new ObjectId('000000000000000000000024'),
    new ObjectId('000000000000000000000025'),
    new ObjectId('000000000000000000000026'),
    new ObjectId('000000000000000000000027'),
    new ObjectId('000000000000000000000028'),
  ];

  const evtIds = [
    new ObjectId('000000000000000000000031'),
    new ObjectId('000000000000000000000032'),
    new ObjectId('000000000000000000000033'),
    new ObjectId('000000000000000000000034'),
    new ObjectId('000000000000000000000035'),
    new ObjectId('000000000000000000000036'),
    new ObjectId('000000000000000000000037'),
    new ObjectId('000000000000000000000038'),
  ];

  // ── customers ─────────────────────────────────────────────────────────────
  // 8 documents. email is always present (frequency=1.0).
  // age is Int32 and present in 7/8 documents (~0.875 frequency — sometimes-present field).
  // address.city is a nested sub-document field (always present).
  // SENTINEL_VALUE is the first customer's email — must not leak into RawCatalog.
  // _id is ObjectId → dataType 'objectId'
  const customers: Record<string, unknown>[] = [
    { _id: custIds[0], email: SENTINEL_VALUE,      name: 'Alice Smith',  age: new Int32(30), address: { city: 'New York',     zip: '10001' } },
    { _id: custIds[1], email: 'bob@example.com',   name: 'Bob Jones',    age: new Int32(25), address: { city: 'Los Angeles',  zip: '90001' } },
    { _id: custIds[2], email: 'carol@example.com', name: 'Carol White',  age: new Int32(35), address: { city: 'Chicago',      zip: '60601' } },
    { _id: custIds[3], email: 'dave@example.com',  name: 'Dave Brown',   age: new Int32(28), address: { city: 'Houston',      zip: '77001' } },
    { _id: custIds[4], email: 'eve@example.com',   name: 'Eve Davis',    age: new Int32(32), address: { city: 'Phoenix',      zip: '85001' } },
    { _id: custIds[5], email: 'frank@example.com', name: 'Frank Miller', age: new Int32(45), address: { city: 'Philadelphia', zip: '19101' } },
    { _id: custIds[6], email: 'grace@example.com', name: 'Grace Wilson',                     address: { city: 'San Antonio',  zip: '78201' } }, // age absent → freq < 1
    { _id: custIds[7], email: 'heidi@example.com', name: 'Heidi Moore',  age: new Int32(29), address: { city: 'San Diego',    zip: '92101' } },
  ];
  await db.collection(COLLECTIONS.customers).insertMany(customers);
  // UNIQUE single-key index on email
  await db.collection(COLLECTIONS.customers).createIndex(
    { email: 1 },
    { unique: true, name: 'idx_customers_email_unique' },
  );

  // ── orders ─────────────────────────────────────────────────────────────────
  // customer_id is ObjectId referencing customers._id → inferred_reference edge.
  // Both have dataType 'objectId' → family 'oid' → ONLY customers._id matches
  // (other customers fields like email/name are 'string' → 'str' family, incompatible).
  // items[] is an array of sub-documents → items[].sku + items[].qty paths.
  // code field: Int32 in 6/8 orders, string in 2/8 → union 'int|string'
  // $jsonSchema validator with top-level required + properties.
  // COMPOUND index on [customer_id, status].
  await db.createCollection(COLLECTIONS.orders, {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'customer_id', 'status', 'total'],
        properties: {
          _id:         { bsonType: 'objectId' },
          customer_id: { bsonType: 'objectId' },
          status:      { bsonType: 'string', enum: ['pending', 'shipped', 'cancelled'] },
          // total: double or int (0.00 is stored as BSON Double, but 0 can be ambiguous)
          total:       { bsonType: ['double', 'int', 'long'] },
          items:       { bsonType: 'array' },
          // code: int (BSON Int32) OR string (mixed-type field for type-union test)
          code:        { bsonType: ['int', 'string'] },
        },
      },
    },
  });

  const orders: Record<string, unknown>[] = [
    { _id: ordIds[0], customer_id: custIds[0], status: 'pending',   total: 99.99,  items: [{ sku: 'SKU-A', qty: new Int32(2) }, { sku: 'SKU-B', qty: new Int32(1) }], code: new Int32(1001) },
    { _id: ordIds[1], customer_id: custIds[1], status: 'shipped',   total: 149.50, items: [{ sku: 'SKU-C', qty: new Int32(3) }],                                       code: new Int32(1002) },
    { _id: ordIds[2], customer_id: custIds[2], status: 'cancelled', total: 0.00,   items: [],                                                                           code: 'CANC-003' },
    { _id: ordIds[3], customer_id: custIds[3], status: 'pending',   total: 75.00,  items: [{ sku: 'SKU-D', qty: new Int32(1) }],                                       code: new Int32(1004) },
    { _id: ordIds[4], customer_id: custIds[4], status: 'shipped',   total: 220.00, items: [{ sku: 'SKU-E', qty: new Int32(2) }, { sku: 'SKU-F', qty: new Int32(2) }], code: new Int32(1005) },
    { _id: ordIds[5], customer_id: custIds[5], status: 'pending',   total: 55.25,  items: [{ sku: 'SKU-G', qty: new Int32(1) }],                                       code: new Int32(1006) },
    { _id: ordIds[6], customer_id: custIds[6], status: 'shipped',   total: 310.00, items: [{ sku: 'SKU-H', qty: new Int32(4) }],                                       code: 'PROM-007' },
    { _id: ordIds[7], customer_id: custIds[7], status: 'cancelled', total: 0.00,   items: [],                                                                           code: new Int32(1008) },
  ];
  await db.collection(COLLECTIONS.orders).insertMany(orders);
  // COMPOUND two-key index on [customer_id, status]
  await db.collection(COLLECTIONS.orders).createIndex(
    { customer_id: 1, status: 1 },
    { name: 'idx_orders_customer_status' },
  );

  // ── products ───────────────────────────────────────────────────────────────
  // sku is always present; tags[] is array of scalars; price is Double.
  const products: Record<string, unknown>[] = [
    { _id: prodIds[0], sku: 'SKU-A', name: 'Widget Alpha',   price: 19.99, tags: ['electronics', 'sale']    },
    { _id: prodIds[1], sku: 'SKU-B', name: 'Widget Beta',    price: 29.99, tags: ['electronics']            },
    { _id: prodIds[2], sku: 'SKU-C', name: 'Gadget Gamma',   price: 49.99, tags: ['gadgets', 'featured']    },
    { _id: prodIds[3], sku: 'SKU-D', name: 'Gadget Delta',   price: 39.99, tags: ['gadgets']                },
    { _id: prodIds[4], sku: 'SKU-E', name: 'Device Epsilon', price: 99.99, tags: ['devices', 'premium']     },
    { _id: prodIds[5], sku: 'SKU-F', name: 'Device Zeta',    price: 79.99, tags: ['devices']                },
    { _id: prodIds[6], sku: 'SKU-G', name: 'Tool Eta',       price: 14.99, tags: ['tools']                  },
    { _id: prodIds[7], sku: 'SKU-H', name: 'Tool Theta',     price: 24.99, tags: ['tools', 'sale']          },
  ];
  await db.collection(COLLECTIONS.products).insertMany(products);
  // UNIQUE single-key index on sku
  await db.collection(COLLECTIONS.products).createIndex(
    { sku: 1 },
    { unique: true, name: 'idx_products_sku_unique' },
  );

  // ── events ─────────────────────────────────────────────────────────────────
  // payload is a mixed-type field: object for some events, string for others.
  // type is always present.
  // NOTE: events use simple numeric order_id values (not ObjectId) to avoid
  // producing spurious inference edges from payload.order_id.
  const events: Record<string, unknown>[] = [
    { _id: evtIds[0], type: 'page_view', payload: { url: '/home',          referrer: '/search' } },
    { _id: evtIds[1], type: 'click',     payload: 'button#cta' },
    { _id: evtIds[2], type: 'purchase',  payload: { amount: 99.99 } },
    { _id: evtIds[3], type: 'login',     payload: 'user:alice' },
    { _id: evtIds[4], type: 'page_view', payload: { url: '/product/SKU-A', referrer: '/home' } },
    { _id: evtIds[5], type: 'click',     payload: 'nav#menu' },
    { _id: evtIds[6], type: 'purchase',  payload: { amount: 220.00 } },
    { _id: evtIds[7], type: 'logout',    payload: 'user:bob' },
  ];
  await db.collection(COLLECTIONS.events).insertMany(events);
}
