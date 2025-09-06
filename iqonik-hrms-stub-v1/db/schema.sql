-- IQONIK HRMS: PostgreSQL Schema (v1)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users & RBAC
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Employees
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  code TEXT UNIQUE,
  manager_id UUID NULL REFERENCES users(id),
  location_id TEXT,
  doj DATE,
  dol DATE,
  status TEXT NOT NULL DEFAULT 'pre_join', -- pre_join | active | inactive
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- CTC structure
CREATE TABLE IF NOT EXISTS ctc_structures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  basic NUMERIC(12,2) NOT NULL DEFAULT 0,
  hra NUMERIC(12,2) NOT NULL DEFAULT 0,
  special NUMERIC(12,2) NOT NULL DEFAULT 0,
  pf_base NUMERIC(12,2) NOT NULL DEFAULT 0,
  esi_applicable BOOLEAN NOT NULL DEFAULT false,
  pt_state TEXT,
  tax_regime TEXT CHECK (tax_regime IN ('old','new')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance_days (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  in_time TIMESTAMP NULL,
  out_time TIMESTAMP NULL,
  source TEXT, -- gps | qr | web | ip
  geofence_ok BOOLEAN,
  status TEXT DEFAULT 'present', -- present | absent | leave | wfh
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON attendance_days(employee_id, date);

-- Leaves
CREATE TABLE IF NOT EXISTS leaves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- CL | SL | PL etc
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  approver_id UUID NULL REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Incentives
CREATE TABLE IF NOT EXISTS incentives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- YYYY-MM
  amount NUMERIC(12,2) NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  approved_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Payroll
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period TEXT NOT NULL, -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'draft', -- draft | posted
  processed_by UUID REFERENCES users(id),
  posted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  earnings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  deductions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  net_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, employee_id)
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NULL REFERENCES employees(id) ON DELETE SET NULL,
  type TEXT NOT NULL, -- offer | appointment | nda | policy | relieving
  file_url TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  esign_status TEXT,
  esign_txn_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_email TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  position TEXT,
  ctc_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_name TEXT NOT NULL DEFAULT 'default',
  pdf_url TEXT,
  esign_status TEXT NOT NULL DEFAULT 'pending',
  esign_txn_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NULL,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts TIMESTAMP NOT NULL DEFAULT NOW()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_employees_updated ON employees;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
