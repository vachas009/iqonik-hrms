-- 1. Truncate all tables
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public') LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;

-- 2. Insert permissions
INSERT INTO permissions(code, description) VALUES
('EMPLOYEE_CREATE','Create employees'),
('EMPLOYEE_VIEW','View employees'),
('EMPLOYEE_DEACTIVATE','Deactivate employees'),
('OFFER_CREATE','Create offers'),
('OFFER_VIEW','View offers'),
('ATTENDANCE_PUNCH','Punch attendance'),
('ATTENDANCE_APPROVE','Approve attendance'),
('INCENTIVE_APPROVE','Approve incentives'),
('PAYROLL_RUN','Run payroll'),
('PAYROLL_VIEW','View payroll')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

-- 3. Create admin role
INSERT INTO roles(name) VALUES('admin')
ON CONFLICT(name) DO NOTHING;

-- 4. Assign all permissions to admin
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name='admin'
ON CONFLICT DO NOTHING;

-- 5. Create founder user
INSERT INTO users(name, email, phone, password, status)
VALUES('Founder','founder@iqonik.in','9876500000',
'$2b$10$6dSWbVH5YF1G1Kv.5rnSGuk/uM6p6jtiB.wmRpvCsLTdSw7zwfBca',  -- hash for admin123
'active')
ON CONFLICT(email) DO NOTHING;

-- 6. Assign admin role to founder
INSERT INTO user_roles(user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.name='admin'
WHERE u.email='founder@iqonik.in'
ON CONFLICT DO NOTHING;

-- 7. Insert into employees
INSERT INTO employees(user_id, doj, status)
SELECT u.id, CURRENT_DATE, 'active'
FROM users u
WHERE u.email='founder@iqonik.in'
AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id);
