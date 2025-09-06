-- =======================================
-- SEED DATA FOR IQONIK HRMS
-- =======================================

-- Reset (careful in prod!)
TRUNCATE users, employees, roles, permissions, role_permissions, user_roles,
         leave_types, leave_policies, leave_balances, leaves,
         attendance_days, attendance_monthly, salaries, payroll_lines, payroll_runs,
         employee_docs RESTART IDENTITY CASCADE;

-- ======================
-- USERS
-- ======================
INSERT INTO users (id, name, email)
VALUES
  (uuid_generate_v4(), 'HR Admin', 'hr@iqonik.com'),
  (uuid_generate_v4(), 'Manager One', 'manager@iqonik.com'),
  (uuid_generate_v4(), 'Employee Alpha', 'alpha@iqonik.com'),
  (uuid_generate_v4(), 'Employee Beta', 'beta@iqonik.com');

-- ======================
-- ROLES
-- ======================
INSERT INTO roles (id, name) VALUES
  (uuid_generate_v4(), 'HR'),
  (uuid_generate_v4(), 'Manager'),
  (uuid_generate_v4(), 'Employee');

-- ======================
-- PERMISSIONS
-- ======================
INSERT INTO permissions (id, code, description) VALUES
  (uuid_generate_v4(), 'DOCS_REVIEW', 'Review employee documents'),
  (uuid_generate_v4(), 'LEAVE_APPROVE', 'Approve employee leaves'),
  (uuid_generate_v4(), 'ATTENDANCE_APPROVE', 'Approve monthly attendance'),
  (uuid_generate_v4(), 'HR_MANAGE', 'Manage HR tasks'),
  (uuid_generate_v4(), 'HR_VIEW', 'View HR reports');

-- ======================
-- ROLE PERMISSIONS
-- (HR has all, Manager can approve, Employee minimal)
-- ======================
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE (r.name='HR')
UNION ALL
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('LEAVE_APPROVE','ATTENDANCE_APPROVE')
WHERE r.name='Manager';

-- ======================
-- EMPLOYEES
-- ======================
INSERT INTO employees (id, user_id, code, status, manager_id)
SELECT uuid_generate_v4(), u.id, 'HR001', 'active', NULL
FROM users u WHERE u.email='hr@iqonik.com';

INSERT INTO employees (id, user_id, code, status, manager_id)
SELECT uuid_generate_v4(), u.id, 'M001', 'active', NULL
FROM users u WHERE u.email='manager@iqonik.com';

INSERT INTO employees (id, user_id, code, status, manager_id)
SELECT uuid_generate_v4(), u.id, 'E001', 'active',
       (SELECT id FROM employees e JOIN users u2 ON e.user_id=u2.id WHERE u2.email='manager@iqonik.com')
FROM users u WHERE u.email='alpha@iqonik.com';

INSERT INTO employees (id, user_id, code, status, manager_id)
SELECT uuid_generate_v4(), u.id, 'E002', 'active',
       (SELECT id FROM employees e JOIN users u2 ON e.user_id=u2.id WHERE u2.email='manager@iqonik.com')
FROM users u WHERE u.email='beta@iqonik.com';

-- ======================
-- ASSIGN ROLES
-- ======================
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE (u.email='hr@iqonik.com' AND r.name='HR')
   OR (u.email='manager@iqonik.com' AND r.name='Manager')
   OR (u.email IN ('alpha@iqonik.com','beta@iqonik.com') AND r.name='Employee');

-- ======================
-- LEAVE TYPES & POLICIES
-- ======================
INSERT INTO leave_types (id, name) VALUES
  (uuid_generate_v4(), 'Sick'),
  (uuid_generate_v4(), 'Casual'),
  (uuid_generate_v4(), 'Earned');

INSERT INTO leave_policies (id, role_id, leave_type_id, yearly_allocation, carry_forward, encashable, year)
SELECT uuid_generate_v4(), r.id, lt.id, 12, true, false, EXTRACT(YEAR FROM now())
FROM roles r, leave_types lt
WHERE r.name='Employee';

-- Initialize leave balances
INSERT INTO leave_balances (id, employee_id, leave_type_id, allocated, used, carried_forward, updated_at)
SELECT uuid_generate_v4(), e.id, lt.id, 12, 0, 0, now()
FROM employees e, leave_types lt
WHERE e.code LIKE 'E%';

-- ======================
-- ATTENDANCE SAMPLE
-- ======================
INSERT INTO attendance_days (id, employee_id, date, status)
SELECT uuid_generate_v4(), e.id, current_date - i, CASE WHEN i%5=0 THEN 'Leave' ELSE 'Present' END
FROM generate_series(0,14) i
JOIN employees e ON e.code IN ('E001','E002');

-- ======================
-- SALARY STRUCTURE (simple stub)
-- ======================
INSERT INTO salaries (id, employee_id, base_salary)
SELECT uuid_generate_v4(), e.id, 30000
FROM employees e
WHERE e.code IN ('E001','E002');

