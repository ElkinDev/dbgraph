-- SQL Server torture fixture — exercises 100% of the MSSQL capability matrix.
-- Deterministic, no random data. Applied by Testcontainers harness (container.ts).
-- Each DDL statement that requires its own batch is separated by GO.
--
-- Objects exercised:
--   tables            : products, orders, order_items, audit_log, regions
--   computed column   : orders.total_amount = (quantity * unit_price)
--   composite FK      : order_items (product_id, region_id) -> products (product_id, region_id)
--   PK/UNIQUE/CHECK   : every table has PK; products has UNIQUE; orders has CHECK
--   filtered index    : idx_orders_active WITH INCLUDE (customer_id)
--   view              : v_order_summary
--   scalar function   : fn_discount_price
--   table-valued fn   : fn_orders_by_region (inline TVF)
--   sequence          : dbo.order_seq
--   extended property : MS_Description on products table + product_name column
--   stored proc       : sp_place_order -- writes orders + order_items, reads products
--   AFTER UPDATE trig : trg_audit_order_update -- writes audit_log
--   dynamic SQL proc  : sp_dynamic_search -- uses sp_executesql
--
-- All names are deterministic (no NEWID(), no GETDATE() in DDL).
-- US-027, ADR-008.

CREATE SEQUENCE dbo.order_seq
    AS bigint
    START WITH 1000
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 9999999
    NO CYCLE
GO

CREATE TABLE dbo.regions (
    region_id   int          NOT NULL,
    region_name nvarchar(80) NOT NULL,
    CONSTRAINT PK_regions PRIMARY KEY (region_id)
)
GO

CREATE TABLE dbo.products (
    product_id   int            NOT NULL,
    region_id    int            NOT NULL,
    product_name nvarchar(120)  NOT NULL,
    unit_price   decimal(10, 2) NOT NULL,
    is_active    bit            NOT NULL CONSTRAINT DF_products_active DEFAULT (1),
    CONSTRAINT PK_products     PRIMARY KEY (product_id, region_id),
    CONSTRAINT UQ_products_name UNIQUE      (product_name),
    CONSTRAINT CK_products_price CHECK      (unit_price >= 0),
    CONSTRAINT FK_products_region FOREIGN KEY (region_id)
        REFERENCES dbo.regions (region_id)
)
GO

CREATE TABLE dbo.orders (
    order_id     int              NOT NULL,
    customer_id  int              NOT NULL,
    status       nvarchar(20)     NOT NULL CONSTRAINT DF_orders_status DEFAULT ('pending'),
    quantity     int              NOT NULL,
    unit_price   decimal(10, 2)   NOT NULL,
    total_amount AS (quantity * unit_price),
    CONSTRAINT PK_orders   PRIMARY KEY (order_id),
    CONSTRAINT CK_orders_qty CHECK (quantity > 0)
)
GO

CREATE TABLE dbo.order_items (
    order_id   int NOT NULL,
    product_id int NOT NULL,
    region_id  int NOT NULL,
    qty        int NOT NULL,
    CONSTRAINT PK_order_items PRIMARY KEY (order_id, product_id, region_id),
    CONSTRAINT FK_order_items_order   FOREIGN KEY (order_id)
        REFERENCES dbo.orders (order_id),
    CONSTRAINT FK_order_items_product FOREIGN KEY (product_id, region_id)
        REFERENCES dbo.products (product_id, region_id)
)
GO

CREATE TABLE dbo.audit_log (
    audit_id    int          NOT NULL IDENTITY(1,1),
    order_id    int          NOT NULL,
    old_status  nvarchar(20) NULL,
    new_status  nvarchar(20) NULL,
    changed_at  datetime2    NOT NULL CONSTRAINT DF_audit_changed_at DEFAULT (GETUTCDATE()),
    CONSTRAINT PK_audit_log PRIMARY KEY (audit_id)
)
GO

CREATE NONCLUSTERED INDEX idx_orders_active
    ON dbo.orders (status)
    INCLUDE (customer_id)
    WHERE status = 'active'
GO

CREATE NONCLUSTERED INDEX idx_audit_order
    ON dbo.audit_log (order_id)
GO

EXEC sys.sp_addextendedproperty
    @name       = N'MS_Description',
    @value      = N'Product catalog with regional pricing.',
    @level0type = N'SCHEMA', @level0name = N'dbo',
    @level1type = N'TABLE',  @level1name = N'products'
GO

EXEC sys.sp_addextendedproperty
    @name       = N'MS_Description',
    @value      = N'Human-readable product name, globally unique.',
    @level0type = N'SCHEMA', @level0name = N'dbo',
    @level1type = N'TABLE',  @level1name = N'products',
    @level2type = N'COLUMN', @level2name = N'product_name'
GO

CREATE VIEW dbo.v_order_summary AS
SELECT
    o.order_id,
    o.customer_id,
    o.status,
    o.total_amount,
    COUNT(oi.product_id) AS item_count
FROM dbo.orders o
LEFT JOIN dbo.order_items oi ON oi.order_id = o.order_id
GROUP BY o.order_id, o.customer_id, o.status, o.total_amount
GO

CREATE FUNCTION dbo.fn_discount_price (
    @price    decimal(10, 2),
    @discount decimal(5, 4)
)
RETURNS decimal(10, 2)
AS
BEGIN
    RETURN @price * (1 - @discount)
END
GO

CREATE FUNCTION dbo.fn_orders_by_region (
    @region_id int
)
RETURNS TABLE
AS
RETURN (
    SELECT
        o.order_id,
        o.customer_id,
        o.status,
        o.total_amount
    FROM dbo.orders o
    JOIN dbo.order_items oi ON oi.order_id = o.order_id
    WHERE oi.region_id = @region_id
)
GO

CREATE PROCEDURE dbo.sp_place_order
    @order_id    int,
    @customer_id int,
    @product_id  int,
    @region_id   int,
    @qty         int
AS
BEGIN
    SET NOCOUNT ON

    DECLARE @price decimal(10, 2)
    SELECT @price = unit_price
    FROM dbo.products
    WHERE product_id = @product_id AND region_id = @region_id

    INSERT INTO dbo.orders (order_id, customer_id, status, quantity, unit_price)
    VALUES (@order_id, @customer_id, 'pending', @qty, @price)

    INSERT INTO dbo.order_items (order_id, product_id, region_id, qty)
    VALUES (@order_id, @product_id, @region_id, @qty)
END
GO

CREATE TRIGGER dbo.trg_audit_order_update
ON dbo.orders
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON

    INSERT INTO dbo.audit_log (order_id, old_status, new_status)
    SELECT
        i.order_id,
        d.status AS old_status,
        i.status AS new_status
    FROM inserted i
    JOIN deleted d ON d.order_id = i.order_id
    WHERE i.status <> d.status
END
GO

CREATE PROCEDURE dbo.sp_dynamic_search
    @status nvarchar(20)
AS
BEGIN
    SET NOCOUNT ON

    DECLARE @sql nvarchar(500)
    SET @sql = N'SELECT order_id, customer_id, status FROM dbo.orders WHERE status = @p_status'

    EXEC sp_executesql @sql, N'@p_status nvarchar(20)', @p_status = @status
END
GO
