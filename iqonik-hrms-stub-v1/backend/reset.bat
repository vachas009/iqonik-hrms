@echo off
setlocal enabledelayedexpansion

REM ================================
REM  RESET SCRIPT FOR HRMS BACKEND
REM ================================

:: Create logs folder if not exists
if not exist logs mkdir logs

:: Generate timestamp for unique log file
for /f "tokens=1-4 delims=/ " %%a in ("%date%") do (
    set d=%%d-%%b-%%c
)
for /f "tokens=1-2 delims=:." %%a in ("%time%") do (
    set t=%%a-%%b
)
set logfile=logs\reset_!d!_!t!.log

echo ====================================== >> %logfile%
echo RESET started at %date% %time% >> %logfile%
echo ====================================== >> %logfile%

echo [1/7] Resetting DB schema... >> %logfile%
"%PG%" -h %PGHOST% -p %PGPORT% -U %PGUSER% -d %DB% -c "DO $$DECLARE r RECORD; BEGIN FOR r IN (SELECT format('%I.%I', schemaname, tablename) fq FROM pg_tables WHERE schemaname='public') LOOP EXECUTE 'TRUNCATE TABLE '||r.fq||' RESTART IDENTITY CASCADE'; END LOOP; END$$;" >> %logfile% 2>&1

echo [2/7] Running migrations... >> %logfile%
"%PG%" -h %PGHOST% -p %PGPORT% -U %PGUSER% -d %DB% -c "
-- Employees auto code generator
CREATE OR REPLACE FUNCTION generate_emp_code()
RETURNS TEXT AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(employee_id FROM 3) AS INT)), 0) + 1
    INTO next_num
  FROM employees;
  RETURN 'IQ' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    status TEXT DEFAULT 'uploaded',
    content BYTEA,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (employee_id, doc_type)
);

-- Document Signatures
CREATE TABLE IF NOT EXISTS document_signatures (
    id SERIAL PRIMARY KEY,
    document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_email TEXT NOT NULL,
    provider TEXT NOT NULL,
    otp_hash TEXT,
    status TEXT DEFAULT 'pending',
    aadhaar_last4 CHAR(4),
    created_at TIMESTAMP DEFAULT NOW(),
    accepted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_doc_signer
  ON document_signatures(document_id, signer_email);
" >> %logfile% 2>&1

echo [3/7] Seeding roles and permissions... >> %logfile%
"%PG%" -h %PGHOST% -p %PGPORT% -U %PGUSER% -d %DB% -c "
INSERT INTO permissions(code,description) VALUES
('EMPLOYEE_CREATE','Create employees'),('EMPLOYEE_VIEW','View employees'),('EMPLOYEE_DEACTIVATE','Deactivate employees'),
('OFFER_CREATE','Create offers'),('OFFER_VIEW','View offers'),('ATTENDANCE_PUNCH','Punch attendance'),
('ATTENDANCE_APPROVE','Approve attendance'),('INCENTIVE_APPROVE','Approve incentives'),
('PAYROLL_RUN','Run payroll'),('PAYROLL_VIEW','View payroll')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO roles(name) VALUES('admin') ON CONFLICT(name) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='admin' ON CONFLICT DO NOTHING;

INSERT INTO users(name,email,phone) VALUES('Founder','founder@iqonik.in','9876500000')
ON CONFLICT(email) DO NOTHING;

INSERT INTO user_roles(user_id,role_id)
SELECT u.id,r.id FROM users u JOIN roles r ON r.name='admin'
WHERE u.email='founder@iqonik.in' ON CONFLICT DO NOTHING;

INSERT INTO employees(user_id,employee_id,doj,status)
SELECT u.id, generate_emp_code(), CURRENT_DATE,'active'
FROM users u
WHERE u.email='founder@iqonik.in'
AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id=u.id);
" >> %logfile% 2>&1

echo [4/7] Creating onboarding doc slots... >> %logfile%
"%PG%" -h %PGHOST% -p %PGPORT% -U %PGUSER% -d %DB% -c "
INSERT INTO employee_docs (employee_id, doc_type)
SELECT e.employee_id, d.doc_type
FROM employees e
JOIN (VALUES
  ('photo'), ('aadhaar_front'), ('aadhaar_back'),
  ('pan'), ('ssc'), ('inter'), ('grad'), ('postgrad'),
  ('relieving1'), ('relieving2'), ('relieving3')
) d(doc_type) ON TRUE
WHERE e.email IS NOT NULL
ON CONFLICT DO NOTHING;
" >> %logfile% 2>&1

echo [5/7] Restarting backend...
taskkill /F /IM node.exe >> %logfile% 2>&1
start "" cmd /c "cd /d D:\IQONIK Applications\HRMS\iqonik-hrms-stub-v1\backend && npm run dev >> %logfile% 2>&1"

timeout /t 10 >nul

echo [6/7] Testing login API...
curl -s -X POST http://127.0.0.1:8080/auth/login -H "Content-Type: application/json" -d "{\"email\":\"founder@iqonik.in\"}" >> %logfile% 2>&1

echo [7/7] Generating ID & Business Cards...
node src/utils/generateAllCards.js >> %logfile% 2>&1

echo ====================================== >> %logfile%
echo RESET COMPLETE - Backend running on 8080 >> %logfile%
echo Log file: %logfile% >> %logfile%
echo ====================================== >> %logfile%

echo.
echo ======================================
echo RESET COMPLETE - Backend running on 8080
echo Log file: %logfile%
echo ======================================

pause
