-- torture.sql — SQLite schema extraction torture fixture
-- Exercises EVERY SQLite capability in SQLITE_CAPABILITIES:
--   tables (typed/nullable/PK), single FK, composite FK, WITHOUT ROWID,
--   views, triggers (BEFORE/AFTER/INSTEAD OF, INSERT/UPDATE/DELETE),
--   indexes (plain, unique, partial WHERE, expression).
-- Deterministic names, no random/time-based data, no AUTOINCREMENT seeding.
-- Committed as plain-text DDL; materialized into a temp db at test setup.

-- ─────────────────────────────────────────────────────────────────────────────
-- departments — parent table for single-column FK
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE departments (
    dept_id   INTEGER PRIMARY KEY,
    name      TEXT    NOT NULL,
    budget    REAL,
    active    INTEGER NOT NULL DEFAULT 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- employees — single-column FK, typed columns, nullable default
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE employees (
    emp_id    INTEGER PRIMARY KEY,
    full_name TEXT    NOT NULL,
    email     TEXT,
    dept_id   INTEGER NOT NULL,
    salary    REAL    NOT NULL DEFAULT 0.0,
    hire_date TEXT,
    FOREIGN KEY (dept_id) REFERENCES departments (dept_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- projects — standalone table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE projects (
    project_id   INTEGER PRIMARY KEY,
    title        TEXT    NOT NULL,
    description  TEXT,
    budget       REAL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- assignments — COMPOSITE FK over (emp_id, dept_id) → employees.(emp_id, dept_id)
-- Demonstrates composite FK grouping (design §mapping).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE assignments (
    project_id INTEGER NOT NULL,
    emp_id     INTEGER NOT NULL,
    dept_id    INTEGER NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'contributor',
    PRIMARY KEY (project_id, emp_id, dept_id),
    FOREIGN KEY (emp_id, dept_id) REFERENCES employees (emp_id, dept_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log — audit table for triggers to write into
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
    log_id     INTEGER PRIMARY KEY,
    entity     TEXT    NOT NULL,
    action     TEXT    NOT NULL,
    old_val    TEXT,
    new_val    TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- counters — WITHOUT ROWID table (exercises extra.withoutRowid flag)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE counters (
    counter_name TEXT    NOT NULL,
    bucket       TEXT    NOT NULL DEFAULT 'default',
    value        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (counter_name, bucket)
) WITHOUT ROWID;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes — plain, unique, partial (WHERE), expression
-- ─────────────────────────────────────────────────────────────────────────────

-- Plain multi-column index
CREATE INDEX idx_emp_dept ON employees (dept_id, hire_date);

-- Unique index (origin='u' → also emitted as RawConstraint UNIQUE)
CREATE UNIQUE INDEX idx_emp_email ON employees (email);

-- Partial index (WHERE clause → extra.where)
CREATE INDEX idx_emp_active_dept ON employees (dept_id)
    WHERE hire_date IS NOT NULL;

-- Expression index (index_info.name = null → '(expr)' placeholder)
CREATE INDEX idx_emp_email_lower ON employees (lower(email));

-- ─────────────────────────────────────────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW active_departments AS
    SELECT d.dept_id, d.name, COUNT(e.emp_id) AS headcount
    FROM departments d
    LEFT JOIN employees e ON e.dept_id = d.dept_id
    WHERE d.active = 1
    GROUP BY d.dept_id, d.name;

CREATE VIEW employee_summary AS
    SELECT e.emp_id, e.full_name, d.name AS dept_name, e.salary
    FROM employees e
    JOIN departments d ON d.dept_id = e.dept_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers — BEFORE/AFTER, INSERT/UPDATE/DELETE, INSTEAD OF
-- ─────────────────────────────────────────────────────────────────────────────

-- BEFORE INSERT on employees — validation / audit
CREATE TRIGGER trg_emp_before_insert
    BEFORE INSERT ON employees
BEGIN
    INSERT INTO audit_log (entity, action, new_val)
        VALUES ('employees', 'INSERT', NEW.full_name);
END;

-- AFTER INSERT on employees — secondary audit
CREATE TRIGGER trg_emp_after_insert
    AFTER INSERT ON employees
BEGIN
    INSERT INTO audit_log (entity, action, new_val)
        VALUES ('employees', 'AFTER_INSERT', NEW.full_name);
END;

-- BEFORE UPDATE on employees — captures old salary
CREATE TRIGGER trg_emp_before_update
    BEFORE UPDATE ON employees
BEGIN
    INSERT INTO audit_log (entity, action, old_val, new_val)
        VALUES ('employees', 'UPDATE', OLD.full_name, NEW.full_name);
END;

-- AFTER DELETE on employees — records removal
CREATE TRIGGER trg_emp_after_delete
    AFTER DELETE ON employees
BEGIN
    INSERT INTO audit_log (entity, action, old_val)
        VALUES ('employees', 'DELETE', OLD.full_name);
END;

-- INSTEAD OF INSERT on the active_departments view — view trigger
CREATE TRIGGER trg_active_dept_instead_insert
    INSTEAD OF INSERT ON active_departments
BEGIN
    INSERT INTO departments (dept_id, name, active)
        VALUES (NEW.dept_id, NEW.name, 1);
END;

-- UPDATE OF <col> trigger — exercises the UPDATE OF branch in parseTriggerInfo (map.ts)
-- UPDATE OF normalises to the UPDATE event in the RawTriggerInfo.events array (S-1).
CREATE TRIGGER trg_emp_salary_update
    BEFORE UPDATE OF salary ON employees
BEGIN
    INSERT INTO audit_log (entity, action, old_val, new_val)
        VALUES ('employees', 'SALARY_UPDATE', CAST(OLD.salary AS TEXT), CAST(NEW.salary AS TEXT));
END;
