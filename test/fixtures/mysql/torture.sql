-- MySQL torture fixture — exercises 100% of the MYSQL_CAPABILITIES matrix.
-- Deterministic, no random data. Applied by Testcontainers harness (container.ts).
-- MySQL 8.0.16+ required (CHECK constraints via CHECK_CONSTRAINTS; functional indexes 8.0.13+).
-- schema == database: all objects live in the connected database (no separate schema objects).
--
-- Objects exercised (100% MYSQL_CAPABILITIES coverage):
--   tables            : products, orders, order_items, audit_log
--   AUTO_INCREMENT     : audit_log.audit_id INT AUTO_INCREMENT PRIMARY KEY (NO sequence)
--   generated column  : order_items.total_price GENERATED ALWAYS AS (qty * unit_price) STORED
--   composite FK      : order_items (order_id, product_id) -> orders/products
--   CHECK constraint  : products CHECK (unit_price >= 0) (8.0.16+)
--   PK / UNIQUE       : every table has PK; products has UNIQUE on name
--   functional index  : idx_products_name_lower ON products ((LOWER(name))) — EXPRESSION path
--   composite index   : idx_order_items_composite ON order_items (order_id, product_id) — SEQ_IN_INDEX
--   prefix index      : idx_products_name_prefix ON products (name(10)) — SUB_PART path
--   view              : v_order_summary — reads orders + order_items
--   procedure (writer): proc_place_order — writes orders + order_items, reads products
--   function (writer) : fn_audit_write — writes audit_log (static write, no reads)
--   dynamic routine   : proc_dynamic_query — PREPARE/EXECUTE; ONLY ref to orders inside prepared string
--   trigger           : trg_after_order_update AFTER UPDATE ON orders
--   comments          : TABLE_COMMENT on products; COLUMN_COMMENT on products.name
--
-- US-029, ADR-008: deterministic, no volatile IDs in goldens.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE products (
    product_id  INT            NOT NULL,
    name        VARCHAR(120)   NOT NULL,
    unit_price  NUMERIC(10, 2) NOT NULL,
    is_active   TINYINT(1)     NOT NULL DEFAULT 1,
    CONSTRAINT PK_products       PRIMARY KEY (product_id),
    CONSTRAINT UQ_products_name  UNIQUE (name),
    CONSTRAINT CK_products_price CHECK (unit_price >= 0)
) COMMENT 'Product catalog with pricing.';

CREATE TABLE orders (
    order_id    INT         NOT NULL,
    customer_id INT         NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    CONSTRAINT PK_orders PRIMARY KEY (order_id)
);

CREATE TABLE order_items (
    item_id     INT            NOT NULL,
    order_id    INT            NOT NULL,
    product_id  INT            NOT NULL,
    qty         INT            NOT NULL,
    unit_price  NUMERIC(10, 2) NOT NULL,
    total_price NUMERIC(10, 2) GENERATED ALWAYS AS (qty * unit_price) STORED,
    CONSTRAINT PK_order_items   PRIMARY KEY (item_id),
    CONSTRAINT FK_items_order   FOREIGN KEY (order_id)   REFERENCES orders (order_id),
    CONSTRAINT FK_items_product FOREIGN KEY (product_id) REFERENCES products (product_id)
);

CREATE TABLE audit_log (
    audit_id   INT          NOT NULL AUTO_INCREMENT,
    order_id   INT          NOT NULL,
    old_status VARCHAR(20),
    new_status VARCHAR(20)  NOT NULL,
    CONSTRAINT PK_audit_log PRIMARY KEY (audit_id)
);

-- Column comment via ALTER COLUMN workaround (MySQL uses MODIFY to add COMMENT)
ALTER TABLE products
    MODIFY COLUMN name VARCHAR(120) NOT NULL COMMENT 'Human-readable product name, globally unique.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Functional (expression) index: EXPRESSION path in STATISTICS (MySQL 8.0.13+)
CREATE INDEX idx_products_name_lower
    ON products ((LOWER(name)));

-- Composite index: SEQ_IN_INDEX > 1 for order of columns
CREATE INDEX idx_order_items_composite
    ON order_items (order_id, product_id);

-- Prefix index: SUB_PART path in STATISTICS
CREATE INDEX idx_products_name_prefix
    ON products (name(10));

-- ─────────────────────────────────────────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW v_order_summary AS
SELECT
    o.order_id,
    o.customer_id,
    o.status,
    COUNT(oi.item_id)     AS item_count,
    SUM(oi.total_price)   AS total_amount
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.order_id
GROUP BY o.order_id, o.customer_id, o.status;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stored Procedures and Functions
-- ─────────────────────────────────────────────────────────────────────────────

-- Procedure that writes TWO tables (orders + order_items) and reads ONE (products).
-- Edge assertions: writes_to orders, writes_to order_items, reads_from products.
-- EXACTLY 3 edges, 2 writes + 1 read, no phantom, no self.
CREATE PROCEDURE proc_place_order(
    IN p_order_id    INT,
    IN p_customer_id INT,
    IN p_product_id  INT,
    IN p_qty         INT
)
BEGIN
    DECLARE v_price NUMERIC(10, 2);

    SELECT unit_price INTO v_price
    FROM products
    WHERE product_id = p_product_id;

    INSERT INTO orders (order_id, customer_id, status)
    VALUES (p_order_id, p_customer_id, 'pending');

    INSERT INTO order_items (item_id, order_id, product_id, qty, unit_price)
    VALUES (p_order_id * 100, p_order_id, p_product_id, p_qty, v_price);
END;

-- Function that writes ONE table (audit_log), zero reads.
-- Edge assertions: writes_to audit_log, 0 reads_from.
CREATE FUNCTION fn_audit_write(
    p_order_id  INT,
    p_old_status VARCHAR(20),
    p_new_status VARCHAR(20)
) RETURNS INT
DETERMINISTIC
BEGIN
    INSERT INTO audit_log (order_id, old_status, new_status)
    VALUES (p_order_id, p_old_status, p_new_status);
    RETURN ROW_COUNT();
END;

-- Procedure with PREPARE/EXECUTE: the ONLY reference to orders is INSIDE the
-- prepared string literal. After maskDynamicStrings that reference is masked.
-- Edge assertions: hasDynamicSql:true, deps.length === 0 (zero edges).
CREATE PROCEDURE proc_dynamic_query(
    IN p_status VARCHAR(20)
)
BEGIN
    SET @sql = CONCAT('SELECT order_id FROM orders WHERE status = ', QUOTE(p_status));
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- AFTER UPDATE trigger on orders — timing: AFTER, event: UPDATE, table: orders
CREATE TRIGGER trg_after_order_update
    AFTER UPDATE ON orders
    FOR EACH ROW
BEGIN
    INSERT INTO audit_log (order_id, old_status, new_status)
    VALUES (OLD.order_id, OLD.status, NEW.status);
END;
