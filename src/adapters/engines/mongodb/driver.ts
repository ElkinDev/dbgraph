/**
 * MongodbReadonlyDriver — async engine-local seam over mongodb MongoClient.
 * Design §driver.ts "single MongodbReadonlyDriver interface, duck-typed MongoClient".
 *
 * The adapter and map.ts talk ONLY to this interface — never to mongodb directly.
 * This mirrors pg/driver.ts and mysql/driver.ts but adapts to the MongoDB API:
 * listCollections(), aggregate([{$sample}]), listIndexes(), db.command().
 *
 * NO top-level mongodb import anywhere (ADR-006). The lazy import lives in factory.ts.
 * The adapter talks ONLY to MongodbReadonlyDriver (ADR-004).
 *
 * US-030 (MongoDB adapter), ADR-004 (seam keeps mongodb types out of core),
 * ADR-006 (lazy optional import).
 */

// ─────────────────────────────────────────────────────────────────────────────
// MongodbReadonlyDriver interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal async read-only handle for MongoDB catalog and sampling operations.
 *
 * listCollections — list all user-space collections with their options.
 * sample          — random-sample up to `size` documents from a collection.
 * listIndexes     — list all indexes for a collection.
 * command         — run a database command (e.g. dbStats, listCollections with validator).
 * close           — release the MongoClient connection.
 */
export interface MongodbReadonlyDriver {
  listCollections(): Promise<readonly { name: string; options?: Record<string, unknown> }[]>;
  sample(collection: string, size: number): Promise<readonly Record<string, unknown>[]>;
  listIndexes(collection: string): Promise<readonly Record<string, unknown>[]>;
  command(cmd: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Duck-typed seam interfaces (avoid importing mongodb at module level)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal cursor-like shape returned by mongodb collection operations.
 * Typed locally so we do NOT need to import mongodb in this file.
 */
export interface CursorLike<T = Record<string, unknown>> {
  toArray(): Promise<T[]>;
}

/**
 * Minimal duck-typed interface for a mongodb collection.
 * Typed locally — no top-level mongodb import.
 */
export interface CollectionLike {
  aggregate(pipeline: Record<string, unknown>[]): CursorLike;
  listIndexes(): CursorLike;
}

/**
 * Minimal duck-typed interface for a mongodb Db instance.
 * Typed locally — no top-level mongodb import.
 *
 * listCollections().toArray() returns collection info objects.
 * command(cmd) runs an administrative command (dbStats, etc.).
 * collection(name) accesses a named collection.
 */
export interface DbLike {
  listCollections(
    filter?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): CursorLike<{ name: string; options?: Record<string, unknown> }>;
  command(cmd: Record<string, unknown>): Promise<Record<string, unknown>>;
  collection(name: string): CollectionLike;
}

/**
 * Minimal duck-typed interface for a mongodb MongoClient.
 * Typed locally — no top-level mongodb import (ADR-006).
 *
 * connect() must be called before using the client.
 * db(name)  returns a Db instance for the named database.
 * close()   releases the connection.
 */
export interface MongoClientLike {
  connect(): Promise<void>;
  db(name: string): DbLike;
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory: wrap a connected MongoClient in MongodbReadonlyDriver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a connected MongoClient (or duck-typed fake in tests) in MongodbReadonlyDriver.
 * The client MUST already be connected (factory.ts calls client.connect() before
 * calling this function).
 *
 * API mapping:
 *   listCollections() → db.listCollections().toArray()
 *   sample(col, size) → db.collection(col).aggregate([{$sample:{size}}]).toArray()
 *   listIndexes(col)  → db.collection(col).listIndexes().toArray()
 *   command(cmd)      → db.command(cmd)
 *   close()           → client.close()
 *
 * @param client   - A connected MongoClient (or duck-typed MongoClientLike fake in tests).
 * @param database - The database name to bind the driver to.
 */
export function createMongodbReadonlyDriver(
  client: MongoClientLike,
  database: string,
): MongodbReadonlyDriver {
  const db = client.db(database);

  return {
    async listCollections(): Promise<readonly { name: string; options?: Record<string, unknown> }[]> {
      return db.listCollections().toArray();
    },

    async sample(
      collection: string,
      size: number,
    ): Promise<readonly Record<string, unknown>[]> {
      return db.collection(collection).aggregate([{ $sample: { size } }]).toArray();
    },

    async listIndexes(collection: string): Promise<readonly Record<string, unknown>[]> {
      return db.collection(collection).listIndexes().toArray();
    },

    async command(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
      return db.command(cmd);
    },

    async close(): Promise<void> {
      await client.close();
    },
  };
}
