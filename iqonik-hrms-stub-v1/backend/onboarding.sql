-- Roles & Permissions
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE role_permissions (
    role_id INT REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Users
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(15),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_roles (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    role_id INT REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Employees
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    employee_id VARCHAR(20) UNIQUE NOT NULL,
    doj DATE,
    status VARCHAR(20) DEFAULT 'pre_join'
);

-- Employee Docs
CREATE TABLE employee_docs (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(20) REFERENCES employees(employee_id) ON DELETE CASCADE,
    doc_type VARCHAR(50) NOT NULL,
    file_path TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    uploaded_at TIMESTAMP
);

-- Attendance
CREATE TABLE attendance_days (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(20) REFERENCES employees(employee_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    in_time TIMESTAMP,
    out_time TIMESTAMP,
    status VARCHAR(20) DEFAULT 'present',
    source VARCHAR(20),
    geofence_ok BOOLEAN DEFAULT FALSE,
    UNIQUE(employee_id, date)
);

-- Incentives
CREATE TABLE incentives (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(20) REFERENCES employees(employee_id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL, -- YYYY-MM
    amount NUMERIC(10,2) NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    approved_by INT
);

-- Payroll
CREATE TABLE payroll_runs (
    id SERIAL PRIMARY KEY,
    period VARCHAR(7) NOT NULL, -- YYYY-MM
    status VARCHAR(20) DEFAULT 'draft',
    processed_by INT,
    created_at TIMESTAMP DEFAULT NOW(),
    posted_at TIMESTAMP
);

CREATE TABLE payroll_lines (
    id SERIAL PRIMARY KEY,
    run_id INT REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id VARCHAR(20) REFERENCES employees(employee_id) ON DELETE CASCADE,
    earnings_json JSONB DEFAULT '{}'::jsonb,
    deductions_json JSONB DEFAULT '{}'::jsonb,
    net_pay NUMERIC(10,2) DEFAULT 0,
    UNIQUE(run_id, employee_id)
);

-- Offers
CREATE TABLE offers (
    id SERIAL PRIMARY KEY,
    candidate_email VARCHAR(100) NOT NULL,
    candidate_name VARCHAR(100) NOT NULL,
    position VARCHAR(100),
    ctc_json JSONB DEFAULT '{}'::jsonb,
    template_name VARCHAR(50),
    esign_status VARCHAR(20) DEFAULT 'pending',
    esign_txn_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Documents + Signatures
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(20) REFERENCES employees(employee_id) ON DELETE CASCADE,
    file_name VARCHAR(255),
    mime_type VARCHAR(100),
    doc_type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'uploaded',
    content BYTEA,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE document_signatures (
    id SERIAL PRIMARY KEY,
    document_id INT REFERENCES documents(id) ON DELETE CASCADE,
    signer_email VARCHAR(100),
    provider VARCHAR(50),
    otp_hash VARCHAR(64),
    status VARCHAR(20) DEFAULT 'otp_sent',
    aadhaar_last4 CHAR(4),
    created_at TIMESTAMP DEFAULT NOW(),
    accepted_at TIMESTAMP
);
