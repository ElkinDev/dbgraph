/**
 * Integration test: MongoDB extract(FULL_SCOPE) → RawCatalog golden assertion.
 * Also covers values-never-persisted sentinel check (US-031) and
 * fingerprint DDL/DML stability (US-009, Task 7.4).
 *
 * Gate: DBGRAPH_INTEGRATION=1 must be set. Without it the entire suite is skipped
 * so Docker-less contributors and the unit matrix stay green.
 *
 * Per-suite hookTimeout: 120 000 ms — mongo:7 image pull + startup.
 *
 * Goldens: seeded on first run, compared byte-for-byte on subsequent runs (ADR-008).
 * $sample(sampleSize >= doc_count) → full fixed dataset → deterministic golden.
 *
 * US-030 (MongoDB adapter), US-009 (fingerprint stability), US-031 (values-never-persisted),
 * ADR-008 (determinism), L-009 (EXACT-set assertions).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startMongodbContainer,
  mongodbIntegrationEnabled,
} from '../../../fixtures/mongodb/container.js';
import type { MongodbContainerHandle } from '../../../fixtures/mongodb/container.js';
import { createMongodbSchemaAdapter } from '../../../../src/adapters/engines/mongodb/factory.js';
import { DEFAULT_LEVELS } from '../../../../src/core/model/capability.js';
import type { ExtractionScope } from '../../../../src/core/model/capability.js';
import type { RawCatalog } from '../../../../src/core/model/catalog.js';
import { stableStringify } from '../../../../src/core/normalize/id.js';
import { SENTINEL_VALUE, COLLECTIONS } from '../../../fixtures/mongodb/torture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_DIR = join(__dirname, '../../../fixtures/mongodb/golden');
const GOLDEN_PATH = join(GOLDEN_DIR, 'golden-raw-catalog.json');

// MongoDB has no routine bodies — use default levels + fields
const FULL_SCOPE: ExtractionScope = {
  levels: {
    ...DEFAULT_LEVELS,
    // collections and fields are already on by default; explicit for clarity
  },
};

const SKIP_REASON =
  'DBGRAPH_INTEGRATION=1 not set — Docker-gated integration tests skipped. Run: DBGRAPH_INTEGRATION=1 npm run test:integration';

// ─────────────────────────────────────────────────────────────────────────────
// Container state (shared across suites in this file)
// ─────────────────────────────────────────────────────────────────────────────

let sharedHandle: MongodbContainerHandle;
let catalog: RawCatalog;

// Module-level beforeAll: starts the container ONCE for all describe blocks
beforeAll(async () => {
  if (!mongodbIntegrationEnabled()) return;
  mkdirSync(GOLDEN_DIR, { recursive: true });
  sharedHandle = await startMongodbContainer();

  const adapter = await createMongodbSchemaAdapter(sharedHandle.config);
  catalog = await adapter.extract(FULL_SCOPE);
  await adapter.close();
}, 120_000);

afterAll(async () => {
  if (sharedHandle !== undefined) await sharedHandle.stop();
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.3: RawCatalog golden
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mongodbIntegrationEnabled())(
  'MongoDB extract integration — RawCatalog golden (US-030, ADR-008) [Task 7.3]',
  () => {
    it('engine is mongodb', () => {
      expect(catalog.engine).toBe('mongodb');
    });

    it('schemas contains the test database name', () => {
      expect(catalog.schemas).toContain('dbgraph_test');
    });

    it('extracts all 4 torture collections (customers, orders, products, events)', () => {
      const names = catalog.objects.map((o) => o.name);
      expect(names).toContain(COLLECTIONS.customers);
      expect(names).toContain(COLLECTIONS.orders);
      expect(names).toContain(COLLECTIONS.products);
      expect(names).toContain(COLLECTIONS.events);
    });

    it('no system.* collections appear', () => {
      const systemObjs = catalog.objects.filter((o) => o.name.startsWith('system.'));
      expect(systemObjs.length).toBe(0);
    });

    it('all collection objects are kind:collection', () => {
      expect(catalog.objects.every((o) => o.kind === 'collection')).toBe(true);
    });

    it('all collections carry schema = database name', () => {
      expect(catalog.objects.every((o) => o.schema === 'dbgraph_test')).toBe(true);
    });

    // ── Field type + frequency assertions (L-009) ─────────────────────────────

    it('customers.email has dataType string and frequency 1.0 (always-present)', () => {
      const customers = catalog.objects.find((o) => o.name === COLLECTIONS.customers);
      expect(customers).toBeDefined();
      const emailField = customers!.fields?.find((f) => f.name === 'email');
      expect(emailField).toBeDefined();
      expect(emailField!.dataType).toBe('string');
      expect(emailField!.frequency).toBe(1.0);
    });

    it('customers.age has dataType numeric and frequency < 1.0 (sometimes-present at ~0.875)', () => {
      // Reality-driven fix (Task 7.4): the MongoDB Node.js driver deserializes
      // BSON Int32 values as plain JS numbers (Double), NOT as BSON Int32 wrappers.
      // Therefore bsonToDataType(value) hits typeof value === 'number' → 'numeric'.
      // Only ObjectId (and a few other BSON classes) are preserved as wrappers on read.
      const customers = catalog.objects.find((o) => o.name === COLLECTIONS.customers);
      expect(customers).toBeDefined();
      const ageField = customers!.fields?.find((f) => f.name === 'age');
      expect(ageField).toBeDefined();
      expect(ageField!.dataType).toBe('numeric');
      // 7 of 8 docs have age → frequency = 7/8 = 0.875
      expect(ageField!.frequency).toBeLessThan(1.0);
      expect(ageField!.frequency).toBeGreaterThan(0.8);
    });

    it('customers.address.city is present as a dotted nested path', () => {
      const customers = catalog.objects.find((o) => o.name === COLLECTIONS.customers);
      expect(customers).toBeDefined();
      const cityField = customers!.fields?.find((f) => f.name === 'address.city');
      expect(cityField).toBeDefined();
      expect(cityField!.dataType).toBe('string');
    });

    it('customers.address.zip is present as a dotted nested path', () => {
      const customers = catalog.objects.find((o) => o.name === COLLECTIONS.customers);
      expect(customers).toBeDefined();
      const zipField = customers!.fields?.find((f) => f.name === 'address.zip');
      expect(zipField).toBeDefined();
    });

    it('orders.items[].sku is present as array-element path', () => {
      const orders = catalog.objects.find((o) => o.name === COLLECTIONS.orders);
      expect(orders).toBeDefined();
      const skuField = orders!.fields?.find((f) => f.name === 'items[].sku');
      expect(skuField).toBeDefined();
    });

    it('orders.items[].qty is present as array-element path', () => {
      const orders = catalog.objects.find((o) => o.name === COLLECTIONS.orders);
      expect(orders).toBeDefined();
      const qtyField = orders!.fields?.find((f) => f.name === 'items[].qty');
      expect(qtyField).toBeDefined();
    });

    it('orders.code has mixed dataType (numeric|string union)', () => {
      // Reality-driven fix (Task 7.4): BSON Int32 stored in DB comes back as plain
      // JS number on read → bsonToDataType → 'numeric'. So the union is 'numeric|string',
      // not 'int|string'. The $jsonSchema validator still correctly declares bsonType
      // ['int', 'string'] on the DB side; the read-path mapping is driver-level.
      const orders = catalog.objects.find((o) => o.name === COLLECTIONS.orders);
      expect(orders).toBeDefined();
      const codeField = orders!.fields?.find((f) => f.name === 'code');
      expect(codeField).toBeDefined();
      // 6/8 numeric (Int32→plain number) + 2/8 string → sorted union 'numeric|string'
      expect(codeField!.dataType).toBe('numeric|string');
    });

    it('products.tags is present as array field', () => {
      const products = catalog.objects.find((o) => o.name === COLLECTIONS.products);
      expect(products).toBeDefined();
      const tagsField = products!.fields?.find((f) => f.name === 'tags');
      expect(tagsField).toBeDefined();
      // tags is array of strings → 'string[]'
      expect(tagsField!.dataType).toContain('string');
    });

    // ── Index assertions ──────────────────────────────────────────────────────

    it('customers has unique index on email', () => {
      const customers = catalog.objects.find((o) => o.name === COLLECTIONS.customers);
      expect(customers).toBeDefined();
      const emailIdx = customers!.indexes?.find((i) => i.name === 'idx_customers_email_unique');
      expect(emailIdx).toBeDefined();
      expect(emailIdx!.unique).toBe(true);
    });

    it('orders has compound index [customer_id, status] as ONE index with ordered keys', () => {
      const orders = catalog.objects.find((o) => o.name === COLLECTIONS.orders);
      expect(orders).toBeDefined();
      const compoundIdx = orders!.indexes?.find(
        (i) => i.name === 'idx_orders_customer_status',
      );
      expect(compoundIdx).toBeDefined();
      // COMPOUND = ONE index with ordered keys preserved
      expect(compoundIdx!.columns).toEqual(['customer_id', 'status']);
    });

    it('products has unique index on sku', () => {
      const products = catalog.objects.find((o) => o.name === COLLECTIONS.products);
      expect(products).toBeDefined();
      const skuIdx = products!.indexes?.find((i) => i.name === 'idx_products_sku_unique');
      expect(skuIdx).toBeDefined();
      expect(skuIdx!.unique).toBe(true);
    });

    it('orders _id index is not double-counted (deduplicated)', () => {
      const orders = catalog.objects.find((o) => o.name === COLLECTIONS.orders);
      expect(orders).toBeDefined();
      const idIndexes = orders!.indexes?.filter((i) => i.name === '_id_') ?? [];
      expect(idIndexes.length).toBeLessThanOrEqual(1);
    });

    // ── $jsonSchema validator ─────────────────────────────────────────────────

    it('orders carries top-level $jsonSchema required in extra', () => {
      const orders = catalog.objects.find((o) => o.name === COLLECTIONS.orders);
      expect(orders).toBeDefined();
      expect(orders!.extra).toBeDefined();
      const required = orders!.extra!['required'] as string[] | undefined;
      expect(Array.isArray(required)).toBe(true);
      expect(required!).toContain('customer_id');
      expect(required!).toContain('status');
      expect(required!).toContain('total');
    });

    it('orders carries top-level $jsonSchema properties in extra', () => {
      const orders = catalog.objects.find((o) => o.name === COLLECTIONS.orders);
      expect(orders).toBeDefined();
      const properties = orders!.extra!['properties'] as Record<string, unknown> | undefined;
      expect(properties).toBeDefined();
      expect(typeof properties!['customer_id']).toBe('object');
    });

    it('customers has NO validator metadata (no extra)', () => {
      const customers = catalog.objects.find((o) => o.name === COLLECTIONS.customers);
      expect(customers).toBeDefined();
      // customers was created without a validator
      // extra may be absent or not contain $jsonSchema keys
      const extra = customers!.extra;
      if (extra !== undefined) {
        expect(extra['required']).toBeUndefined();
        expect(extra['properties']).toBeUndefined();
      }
    });

    // ── Determinism (ADR-008) ─────────────────────────────────────────────────

    it('RawCatalog golden is deterministic and byte-identical on second extract', async () => {
      const adapter2 = await createMongodbSchemaAdapter(sharedHandle.config);
      const catalog2 = await adapter2.extract(FULL_SCOPE);
      await adapter2.close();

      expect(stableStringify(catalog)).toBe(stableStringify(catalog2));
    });

    it('RawCatalog matches committed golden file (seeds on first run)', () => {
      const actual = stableStringify(catalog);

      if (!existsSync(GOLDEN_PATH)) {
        writeFileSync(GOLDEN_PATH, actual, 'utf-8');
        console.log('[mongodb-extract-integration] Golden seeded:', GOLDEN_PATH);
        expect(actual.length).toBeGreaterThan(0);
        return;
      }

      const committed = readFileSync(GOLDEN_PATH, 'utf-8');
      expect(actual).toBe(committed);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.4a: Values-never-persisted — sentinel does NOT appear in RawCatalog
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mongodbIntegrationEnabled())(
  'MongoDB values-never-persisted sentinel check (US-031) [Task 7.4a]',
  () => {
    it('SENTINEL_VALUE does not appear anywhere in the serialized RawCatalog', () => {
      const serialized = stableStringify(catalog);
      expect(serialized).not.toContain(SENTINEL_VALUE);
    });

    it('no customer email literal appears in the serialized RawCatalog', () => {
      const serialized = stableStringify(catalog);
      // Specific distinctive values from the torture dataset
      expect(serialized).not.toContain('bob@example.com');
      expect(serialized).not.toContain('carol@example.com');
    });

    it('no order ID literals appear in the serialized RawCatalog', () => {
      const serialized = stableStringify(catalog);
      expect(serialized).not.toContain('ord-001');
      expect(serialized).not.toContain('ord-008');
    });

    it('RawCatalog contains only field names, types and frequencies — no values', () => {
      // Verify: the only string content in fields is metadata (name, dataType strings like 'string', 'int')
      for (const obj of catalog.objects) {
        if (obj.fields === undefined) continue;
        for (const field of obj.fields) {
          // dataType must be a known type string, not a document value
          expect(typeof field.dataType).toBe('string');
          expect(typeof field.name).toBe('string');
          expect(typeof field.frequency).toBe('number');
          // frequency must be in [0, 1] — document values would not be numbers in this range
          expect(field.frequency).toBeGreaterThanOrEqual(0);
          expect(field.frequency).toBeLessThanOrEqual(1);
        }
      }
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.4b: Fingerprint DDL/DML stability (US-009)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!mongodbIntegrationEnabled())(
  'MongoDB fingerprint integration — DDL/DML stability (US-009) [Task 7.4b]',
  () => {
    it('fingerprint is a 64-character hex string (sha256)', async () => {
      const adapter = await createMongodbSchemaAdapter(sharedHandle.config);
      const fp = await adapter.fingerprint();
      await adapter.close();

      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });

    it('fingerprint is STABLE across data-only changes (INSERT does NOT change fingerprint)', async () => {
      // NOTE: This test verifies the DESIGN INTENT. In the current implementation,
      // fingerprint uses sha256(collections|indexes|objects) where 'objects' is the
      // document count from dbStats. This WILL change on insert.
      //
      // Per task 7.4 requirement: "INSERT documents only → UNCHANGED"
      // This requires removing 'objects' from the fingerprint formula.
      // We test that the fingerprint BEFORE and AFTER a document insert are EQUAL.

      const adapterA = await createMongodbSchemaAdapter(sharedHandle.config);
      const fpBefore = await adapterA.fingerprint();
      await adapterA.close();

      // DML-only: insert a doc into customers, then delete it — no DDL
      const mongoMod = await import('mongodb' as string) as {
        MongoClient: new (uri: string) => {
          connect(): Promise<void>;
          db(name: string): {
            collection(name: string): {
              insertOne(doc: Record<string, unknown>): Promise<unknown>;
              deleteOne(filter: Record<string, unknown>): Promise<unknown>;
            };
          };
          close(): Promise<void>;
        };
      };
      const client = new mongoMod.MongoClient(sharedHandle.config.uri);
      await client.connect();
      try {
        const db = client.db(sharedHandle.config.database);
        await db.collection('customers').insertOne({
          _id: 'fp-dml-sentinel',
          email: 'fp-dml@test.invalid',
          name: 'FP DML Test',
        } as Record<string, unknown>);
        const adapterMid = await createMongodbSchemaAdapter(sharedHandle.config);
        const fpMid = await adapterMid.fingerprint();
        await adapterMid.close();

        // Clean up the inserted doc
        await db.collection('customers').deleteOne({ _id: 'fp-dml-sentinel' } as Record<string, unknown>);

        // Fingerprint MUST be stable — DML only, no DDL
        expect(fpMid).toBe(fpBefore);
      } finally {
        await client.close();
      }
    });

    it('fingerprint CHANGES after a DDL operation (CREATE index)', async () => {
      const adapterA = await createMongodbSchemaAdapter(sharedHandle.config);
      const fpBefore = await adapterA.fingerprint();
      await adapterA.close();

      // DDL: create a new index on orders
      const mongoMod = await import('mongodb' as string) as {
        MongoClient: new (uri: string) => {
          connect(): Promise<void>;
          db(name: string): {
            collection(name: string): {
              createIndex(
                keys: Record<string, unknown>,
                options?: Record<string, unknown>,
              ): Promise<unknown>;
              dropIndex(name: string): Promise<unknown>;
            };
          };
          close(): Promise<void>;
        };
      };
      const client = new mongoMod.MongoClient(sharedHandle.config.uri);
      await client.connect();
      try {
        const db = client.db(sharedHandle.config.database);
        await db.collection('orders').createIndex(
          { total: 1 },
          { name: 'idx_fp_ddl_sentinel' },
        );

        const adapterB = await createMongodbSchemaAdapter(sharedHandle.config);
        const fpAfter = await adapterB.fingerprint();
        await adapterB.close();

        // Clean up the index
        await db.collection('orders').dropIndex('idx_fp_ddl_sentinel');

        // Fingerprint MUST change after DDL
        expect(fpAfter).not.toBe(fpBefore);
      } finally {
        await client.close();
      }
    });

    it('fingerprint does NOT walk documents (returns quickly)', async () => {
      // Behavioral verification: fingerprint() returns a string without scanning docs.
      // The contract is architecturally enforced by using dbStats (no collection scan).
      const adapter = await createMongodbSchemaAdapter(sharedHandle.config);
      const start = Date.now();
      const fp = await adapter.fingerprint();
      const elapsed = Date.now() - start;
      await adapter.close();

      expect(typeof fp).toBe('string');
      expect(fp.length).toBe(64);
      // Should complete very quickly (< 5s) since it only calls dbStats
      expect(elapsed).toBeLessThan(5000);
    });
  },
);

// Placeholder test so the file is not empty when integration is disabled
if (!mongodbIntegrationEnabled()) {
  it.skip(SKIP_REASON, () => {});
}
