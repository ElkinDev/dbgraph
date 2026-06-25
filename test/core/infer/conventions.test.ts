/**
 * RED test: convention-based entity extraction and candidate target generation.
 * Spec: graph-normalization "Name-convention matching against real targets".
 * Design D5 — hand-rolled, zero-dep singular/plural set.
 * ADR-004 / ADR-007 / L-009 exact-set assertions.
 *
 * US-008
 */

import { describe, it, expect } from 'vitest';
import { extractEntity, candidateTargets } from '../../../src/core/infer/conventions.js';

// ─────────────────────────────────────────────────────────────────────────────
// extractEntity — pattern recognition (Task 1.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractEntity', () => {
  // ── <entity>_id pattern (snake, conv: 1.0) ────────────────────────────────

  it('recognizes <entity>_id snake pattern: customer_id → entity=customer, conv=1.0', () => {
    expect(extractEntity('customer_id')).toEqual({ entity: 'customer', conv: 1.0 });
  });

  it('recognizes <entity>Id camel pattern: customerId → entity=customer, conv=1.0', () => {
    expect(extractEntity('customerId')).toEqual({ entity: 'customer', conv: 1.0 });
  });

  it('recognizes id_<entity> prefix pattern: id_product → entity=product, conv=0.8', () => {
    expect(extractEntity('id_product')).toEqual({ entity: 'product', conv: 0.8 });
  });

  it('returns null for a plain name with no id pattern: name → null', () => {
    expect(extractEntity('name')).toBeNull();
  });

  it('returns null for bare "id" with no entity prefix/suffix', () => {
    expect(extractEntity('id')).toBeNull();
  });

  // ── Additional exact-set cases ────────────────────────────────────────────

  it('recognizes <entity>_id with a multi-word prefix: product_category_id', () => {
    expect(extractEntity('product_category_id')).toEqual({ entity: 'product_category', conv: 1.0 });
  });

  it('is case-folded: CUSTOMER_ID → entity=customer, conv=1.0', () => {
    const result = extractEntity('CUSTOMER_ID');
    expect(result).toEqual({ entity: 'customer', conv: 1.0 });
  });

  it('recognizes <entity>Id camel with multi-word prefix (lowercased entity)', () => {
    const result = extractEntity('productCategoryId');
    expect(result).not.toBeNull();
    expect(result?.conv).toBe(1.0);
    // entity is the lowercased portion before 'Id'
    expect(result?.entity).toBe('productcategory');
  });

  it('recognizes id_<entity> with multi-word suffix: id_product_category', () => {
    expect(extractEntity('id_product_category')).toEqual({ entity: 'product_category', conv: 0.8 });
  });

  it('is case-folded: ID_PRODUCT → entity=product, conv=0.8', () => {
    expect(extractEntity('ID_PRODUCT')).toEqual({ entity: 'product', conv: 0.8 });
  });

  it('returns null for "created_at" (ends with _at, not _id)', () => {
    expect(extractEntity('created_at')).toBeNull();
  });

  it('returns null for "status" (no id pattern)', () => {
    expect(extractEntity('status')).toBeNull();
  });

  it('returns null for "identifier" (contains id but not as a suffix/prefix pattern)', () => {
    expect(extractEntity('identifier')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// candidateTargets — hand-rolled plural/singular generation (D5, Task 1.3)
//
// D5 rules applied in order:
//   1. as-is (the entity name unchanged)
//   2. +s (append 's')
//   3. +es (append 'es')
//   4. -y→-ies (if ends in 'y', replace with 'ies') — appended after +es
//   5. singular (strip trailing 's', 'es', or convert 'ies'→'y')
// Result is DEDUPED (Set) maintaining insertion order; duplicates of earlier
// entries are dropped.
// ─────────────────────────────────────────────────────────────────────────────

describe('candidateTargets', () => {
  // ── customer: no trailing y, no trailing s/es/ies ─────────────────────────
  // as-is='customer', +s='customers', +es='customeres'
  // -y→-ies: not applicable (no trailing y)
  // singular: no trailing s/es/ies on 'customer' → nothing added
  // Deduped: ['customer', 'customers', 'customeres']
  it('pins the exact deduped set for "customer"', () => {
    expect(candidateTargets('customer')).toEqual(['customer', 'customers', 'customeres']);
  });

  // ── customers: trailing 's' ────────────────────────────────────────────────
  // as-is='customers', +s='customerss', +es='customerses'
  // -y→-ies: not applicable
  // singular: strip trailing 's' → 'customer'
  // Deduped: ['customers', 'customerss', 'customerses', 'customer']
  it('pins the exact deduped set for "customers" (includes singular "customer")', () => {
    const result = candidateTargets('customers');
    expect(result).toEqual(['customers', 'customerss', 'customerses', 'customer']);
    expect(result).toContain('customer'); // singular recovery
  });

  // ── category: trailing 'y' ────────────────────────────────────────────────
  // as-is='category', +s='categorys', +es='categoryes'
  // -y→-ies: 'categor' + 'ies' = 'categories'
  // singular: no trailing s/es/ies on 'category' → nothing
  // Deduped: ['category', 'categorys', 'categoryes', 'categories']
  it('pins the exact deduped set for "category" (includes "categories" via -y→-ies)', () => {
    const result = candidateTargets('category');
    expect(result).toEqual(['category', 'categorys', 'categoryes', 'categories']);
    expect(result).toContain('categories');
  });

  // ── product: no trailing special char ────────────────────────────────────
  // as-is='product', +s='products', +es='productes'
  // no -y, no trailing s/es/ies → no singular
  // Deduped: ['product', 'products', 'productes']
  it('generates set for "product" containing "products"', () => {
    const result = candidateTargets('product');
    expect(result).toEqual(['product', 'products', 'productes']);
    expect(result).toContain('product');
    expect(result).toContain('products');
  });

  // ── status: trailing 's' ──────────────────────────────────────────────────
  // as-is='status', +s='statuss', +es='statuses'
  // no trailing y
  // singular: strip trailing 's' → 'statu'
  // Deduped: ['status', 'statuss', 'statuses', 'statu']
  it('generates set for "status" including singular strip (statu)', () => {
    const result = candidateTargets('status');
    expect(result).toEqual(['status', 'statuss', 'statuses', 'statu']);
  });

  // ── categories: trailing 'ies' ────────────────────────────────────────────
  // as-is='categories', +s='categoriess', +es='categorieses'
  // no trailing single y
  // singular: 'ies'→'y' = 'category'
  // Deduped: ['categories', 'categoriess', 'categorieses', 'category']
  it('singularizes "categories" to "category" via -ies→-y', () => {
    const result = candidateTargets('categories');
    expect(result).toContain('category');
    expect(result).toEqual(['categories', 'categoriess', 'categorieses', 'category']);
  });

  // ── Dedup invariant ───────────────────────────────────────────────────────
  it('result is always deduped (no repeated entries)', () => {
    for (const name of ['customer', 'customers', 'category', 'product', 'status', 'categories']) {
      const result = candidateTargets(name);
      expect(new Set(result).size).toBe(result.length);
    }
  });

  // ── Determinism ───────────────────────────────────────────────────────────
  it('returns the same array for the same input across multiple calls', () => {
    expect(candidateTargets('customer')).toEqual(candidateTargets('customer'));
    expect(candidateTargets('category')).toEqual(candidateTargets('category'));
    expect(candidateTargets('customers')).toEqual(candidateTargets('customers'));
  });
});
