-- PostgreSQL torture fixture — exercises 100% of the PG capability matrix.
-- Deterministic, no random data. Applied by Testcontainers harness (container.ts).
-- All names are deterministic (no now(), no random()).
--
-- Objects exercised:
--   schemas           : public (default), app, reporting
--   tables            : app.products, app.orders, app.order_items, app.audit_log
--   identity column   : app.audit_log.audit_id GENERATED ALWAYS AS IDENTITY
--   generated column  : app.order_items.total_price GENERATED ALWAYS AS (qty * unit_price) STORED
--   composite FK      : app.order_items (product_id) -> app.products (product_id)
--   PK/UNIQUE/CHECK   : every table has PK; products has UNIQUE; orders has CHECK
--   sequence          : app.order_seq
--   partial index     : idx_orders_active WHERE status = 'active'
--   expression index  : idx_products_name_lower ON lower(name)
--   INCLUDE index     : idx_orders_customer_inc INCLUDE (status)
--   view              : reporting.v_order_summary (reads app.orders + app.order_items)
--   materialized view : reporting.mv_product_stats (reads app.products + app.order_items)
--   function (writer) : app.fn_place_order — writes app.orders + app.order_items, reads app.products
--   function (dynamic): app.fn_dynamic_search — uses EXECUTE format(...) (hasDynamicSql=true)
--   procedure         : app.proc_cancel_order — writes app.orders
--   trigger function  : app.audit_fn — writes app.audit_log (plain, non-dynamic)
--   trigger (AFTER UPDATE): app.trg_audit_order_update — EXECUTE FUNCTION app.audit_fn()
--   COMMENT ON        : app.products table + app.products.name column
--
-- US-028, ADR-008: deterministic, no volatile OIDs in goldens.

-- ─────────────────────────────────────────────────────────────────────────────
-- Schemas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS reporting;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sequence
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE app.order_seq
    AS bigint
    START WITH 1000
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 9999999
    NO CYCLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.products (
    product_id   int            NOT NULL,
    name         varchar(120)   NOT NULL,
    unit_price   numeric(10, 2) NOT NULL,
    is_active    boolean        NOT NULL DEFAULT true,
    CONSTRAINT PK_products     PRIMARY KEY (product_id),
    CONSTRAINT UQ_products_name UNIQUE (name),
    CONSTRAINT CK_products_price CHECK (unit_price >= 0)
);

CREATE TABLE app.orders (
    order_id    int          NOT NULL,
    customer_id int          NOT NULL,
    status      varchar(20)  NOT NULL DEFAULT 'pending',
    CONSTRAINT PK_orders     PRIMARY KEY (order_id),
    CONSTRAINT CK_orders_status CHECK (status IN ('pending', 'active', 'cancelled'))
);

CREATE TABLE app.order_items (
    item_id    int            NOT NULL,
    order_id   int            NOT NULL,
    product_id int            NOT NULL,
    qty        int            NOT NULL,
    unit_price numeric(10, 2) NOT NULL,
    total_price numeric(10, 2) GENERATED ALWAYS AS (qty * unit_price) STORED,
    CONSTRAINT PK_order_items  PRIMARY KEY (item_id),
    CONSTRAINT FK_items_order  FOREIGN KEY (order_id) REFERENCES app.orders (order_id),
    CONSTRAINT FK_items_product FOREIGN KEY (product_id) REFERENCES app.products (product_id)
);

CREATE TABLE app.audit_log (
    audit_id   int          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id   int          NOT NULL,
    old_status varchar(20),
    new_status varchar(20)  NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Partial index: only active orders
CREATE INDEX idx_orders_active
    ON app.orders (status)
    WHERE status = 'active';

-- Expression index: case-insensitive product lookup
CREATE INDEX idx_products_name_lower
    ON app.products (lower(name));

-- INCLUDE index: covering index with non-key included columns (PG11+)
CREATE INDEX idx_orders_customer_inc
    ON app.orders (customer_id)
    INCLUDE (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE app.products IS 'Product catalog with pricing.';
COMMENT ON COLUMN app.products.name IS 'Human-readable product name, globally unique.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW reporting.v_order_summary AS
SELECT
    o.order_id,
    o.customer_id,
    o.status,
    COUNT(oi.item_id) AS item_count,
    SUM(oi.total_price) AS total_amount
FROM app.orders o
LEFT JOIN app.order_items oi ON oi.order_id = o.order_id
GROUP BY o.order_id, o.customer_id, o.status;

-- Materialized view: exercises relkind='m' path → kind:'view' + extra.materialized:true
CREATE MATERIALIZED VIEW reporting.mv_product_stats AS
SELECT
    p.product_id,
    p.name,
    COUNT(oi.item_id)  AS order_count,
    SUM(oi.qty)        AS total_qty
FROM app.products p
LEFT JOIN app.order_items oi ON oi.product_id = p.product_id
GROUP BY p.product_id, p.name;

-- ─────────────────────────────────────────────────────────────────────────────
-- Functions and Procedures
-- ─────────────────────────────────────────────────────────────────────────────

-- Function that writes TWO tables and reads ONE (for parsed edge assertions)
CREATE OR REPLACE FUNCTION app.fn_place_order(
    p_order_id    int,
    p_customer_id int,
    p_product_id  int,
    p_qty         int
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_price numeric(10,2);
BEGIN
    -- reads app.products
    SELECT unit_price INTO v_price
    FROM app.products
    WHERE product_id = p_product_id;

    -- writes app.orders
    INSERT INTO app.orders (order_id, customer_id, status)
    VALUES (p_order_id, p_customer_id, 'pending');

    -- writes app.order_items
    INSERT INTO app.order_items (item_id, order_id, product_id, qty, unit_price)
    VALUES (p_order_id * 100, p_order_id, p_product_id, p_qty, v_price);
END;
$$;

-- Function with dynamic EXECUTE statement (hasDynamicSql=true, no fabricated edges)
CREATE OR REPLACE FUNCTION app.fn_dynamic_search(p_status varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_sql text;
BEGIN
    v_sql := format('SELECT order_id FROM app.orders WHERE status = %L', p_status);
    EXECUTE v_sql;
END;
$$;

-- Trigger FUNCTION (plain, non-dynamic — EXECUTE FUNCTION in trigger DDL is NOT dynamic)
CREATE OR REPLACE FUNCTION app.audit_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- writes app.audit_log
    INSERT INTO app.audit_log (order_id, old_status, new_status)
    VALUES (OLD.order_id, OLD.status, NEW.status);
    RETURN NEW;
END;
$$;

-- Procedure (PG11+) that writes app.orders
CREATE OR REPLACE PROCEDURE app.proc_cancel_order(p_order_id int)
LANGUAGE plpgsql
AS $$
BEGIN
    -- writes app.orders
    UPDATE app.orders SET status = 'cancelled' WHERE order_id = p_order_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger
-- ─────────────────────────────────────────────────────────────────────────────

-- AFTER UPDATE trigger: fires_on app.orders with event=UPDATE, timing=AFTER
-- EXECUTE FUNCTION clause must NOT be flagged as dynamic SQL
CREATE TRIGGER trg_audit_order_update
    AFTER UPDATE ON app.orders
    FOR EACH ROW
    EXECUTE FUNCTION app.audit_fn();
