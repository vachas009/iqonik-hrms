import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import pkg from 'pg';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const { Pool } = pkg;

/* ---------- Helpers ---------- */
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/* ---------- App & DB ---------- */
const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(morgan('tiny'));

// serve static files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use(express.static(path.join(process.cwd(), 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/* ---------- Auth Middleware ---------- */
function authRequired(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Missing Authorization' });
  try {
    req.user = jwt.verify(header.replace(/^Bearer\s+/i, ''), process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requirePermission(code) {
  return (req, res, next) => {
    const perms = asArray(req?.user?.permissions);
    if (!perms.includes(code)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

/* ---------- Multer Config for Docs ---------- */
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const empId = req.empId || 'temp';
    const empDir = path.join(uploadDir, empId);
    if (!fs.existsSync(empDir)) fs.mkdirSync(empDir, { recursive: true });
    cb(null, empDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + ext);
  }
});
const upload = multer({ storage });

/* ---------- Extract Employee ID from Token ---------- */
function extractEmpId(req, res, next) {
  try {
    const token = req.body.token || req.query.token || req.headers['x-doc-token'];
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.empId = payload.empId;
    next();
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Invalid/expired token' });
  }
}

/* ---------- Health ---------- */
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* ============================================================
   EMPLOYEE ONBOARDING & DOCS
   ============================================================ */

// Create employee (basic onboarding)
app.post('/employees', authRequired, requirePermission('EMPLOYEE_CREATE'), async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name & email required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert or reuse user
    const { rows: userRows } = await client.query(
      `INSERT INTO users (id, name, email)
         VALUES (uuid_generate_v4(), $1, $2)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [name, email]
    );
    const userId = userRows[0].id;

    // 2. Insert employee if not exists
    const { rows: empRows } = await client.query(
      `INSERT INTO employees (id, user_id, code, status)
         VALUES (uuid_generate_v4(), $1, generate_emp_code(), 'pre_join')
       ON CONFLICT (user_id) DO NOTHING
       RETURNING code, status`,
      [userId]
    );

    await client.query('COMMIT');

    if (empRows.length === 0) {
      return res.status(400).json({ error: 'Employee already exists for this user' });
    }

    const emp = empRows[0];
    res.status(201).json({ employee_code: emp.code, status: emp.status, user_id: userId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'failed to create employee' });
  } finally {
    client.release();
  }
});

// Employee: Upload documents
app.post(
  '/api/employee/upload-docs',
  extractEmpId,
  upload.fields([
    { name: 'aadhar', maxCount: 1 },
    { name: 'pan', maxCount: 1 },
    { name: 'bank', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const empId = req.empId;
      const files = req.files;
      if (!files) return res.status(400).json({ error: 'No files uploaded' });

      const queries = [];
      for (const [type, fileArr] of Object.entries(files)) {
        const file = fileArr[0];
        const relativePath = path.relative(process.cwd(), file.path);
        queries.push(
          pool.query(
            `INSERT INTO employee_docs (id, employee_id, doc_type, file_path, status)
             VALUES (uuid_generate_v4(), $1, $2, $3, 'pending')
             ON CONFLICT (employee_id, doc_type)
             DO UPDATE SET file_path=EXCLUDED.file_path, uploaded_at=now(), status='pending'`,
            [empId, type, relativePath]
          )
        );
      }
      await Promise.all(queries);
      await pool.query(`UPDATE employees SET status='docs_submitted' WHERE id=$1`, [empId]);
      res.json({ message: 'Documents uploaded successfully' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Doc upload failed' });
    }
  }
);

// HR: View pending docs
app.get('/api/hr/docs/pending', authRequired, requirePermission('DOCS_REVIEW'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.employee_id, e.code AS emp_code, u.name AS emp_name,
              d.doc_type, d.file_path, d.status, d.uploaded_at
       FROM employee_docs d
       JOIN employees e ON d.employee_id = e.id
       JOIN users u ON e.user_id = u.id
       WHERE d.status = 'pending'
       ORDER BY d.uploaded_at ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch pending docs' });
  }
});

// HR: Approve/Reject doc
app.post('/api/hr/docs/update', authRequired, requirePermission('DOCS_REVIEW'), async (req, res) => {
  const { docId, action } = req.body;
  if (!docId || !['approved','rejected'].includes(action)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  try {
    await pool.query(
      `UPDATE employee_docs SET status=$1, reviewed_at=now() WHERE id=$2`,
      [action, docId]
    );
    res.json({ message: `Document ${action}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

/* ============================================================
   LEAVE MANAGEMENT
   ============================================================ */

// Employee: Apply leave
app.post('/api/leave/apply', authRequired, async (req, res) => {
  try {
    const { leave_type_id, start_date, end_date, reason } = req.body;
    if (!leave_type_id || !start_date || !end_date)
      return res.status(400).json({ error: 'Missing fields' });

    const { rows } = await pool.query(
      `INSERT INTO leaves (id, employee_id, leave_type_id, start_date, end_date, reason, status, created_at)
       VALUES (uuid_generate_v4(), (SELECT id FROM employees WHERE user_id=$1), $2, $3, $4, $5, 'PENDING', now())
       RETURNING *`,
      [req.user.id, leave_type_id, start_date, end_date, reason]
    );
    res.json({ message: 'Leave request submitted', leave: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to apply leave' });
  }
});

// Employee: Leave balances
app.get('/api/leave/balance', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT lt.name, lb.allocated, lb.used, (lb.allocated - lb.used) AS balance
       FROM leave_balances lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       WHERE lb.employee_id = (SELECT id FROM employees WHERE user_id=$1)`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

// Manager: Pending leave requests
app.get('/api/leave/pending', authRequired, requirePermission('LEAVE_APPROVE'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, u.name AS employee_name, lt.name AS leave_type, l.start_date, l.end_date, l.reason, l.status
       FROM leaves l
       JOIN employees e ON e.id = l.employee_id
       JOIN users u ON e.user_id = u.id
       JOIN leave_types lt ON lt.id = l.leave_type_id
       WHERE e.manager_id = $1 AND l.status='PENDING'`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch pending leaves' });
  }
});

// Manager: Approve/Reject leave (with balance + attendance update)
app.put('/api/leave/:id/status', authRequired, requirePermission('LEAVE_APPROVE'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['APPROVED', 'REJECTED'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch leave details
    const { rows } = await client.query(`SELECT * FROM leaves WHERE id=$1 AND status='PENDING'`, [id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Leave not found or already processed' });
    }

    const leave = rows[0];

    // Update leave row
    await client.query(
      `UPDATE leaves SET status=$1, approver_id=$2, approved_at=now() WHERE id=$3`,
      [status, req.user.id, id]
    );

    if (status === 'APPROVED') {
      // 1️⃣ Update leave balance
      await client.query(
        `UPDATE leave_balances
         SET used = used + (DATE($2) - DATE($1) + 1), updated_at = now()
         WHERE employee_id=$3 AND leave_type_id=$4`,
        [leave.start_date, leave.end_date, leave.employee_id, leave.leave_type_id]
      );

      // 2️⃣ Mark attendance
      await client.query(
        `INSERT INTO attendance_days (id, employee_id, date, status, approved)
         SELECT uuid_generate_v4(), $1, d::date, 'Leave', true
         FROM generate_series($2::date, $3::date, interval '1 day') d
         ON CONFLICT (employee_id, date)
         DO UPDATE SET status='Leave', approved=true`,
        [leave.employee_id, leave.start_date, leave.end_date]
      );
    }

    await client.query('COMMIT');
    res.json({ message: `Leave ${status}` });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Failed to update leave' });
  } finally {
    client.release();
  }
});

/* ============================================================
   ATTENDANCE MANAGEMENT
   ============================================================ */

// Employee: My attendance
app.get('/api/attendance/my', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.date, a.status, a.approved
       FROM attendance_days a
       JOIN employees e ON a.employee_id = e.id
       WHERE e.user_id=$1
       ORDER BY a.date DESC LIMIT 60`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Manager: Team attendance
app.get('/api/attendance/team', authRequired, requirePermission('ATTENDANCE_APPROVE'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.name, a.date, a.status, a.approved
       FROM attendance_days a
       JOIN employees e ON a.employee_id = e.id
       JOIN users u ON e.user_id = u.id
       WHERE e.manager_id=$1
       ORDER BY a.date DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch team attendance' });
  }
});

// HR: Refresh monthly rollup
app.post('/api/hr/attendance/refresh', authRequired, requirePermission('HR_MANAGE'), async (req, res) => {
  try {
    const { month } = req.body || {};
    const sql = month
      ? `SELECT refresh_attendance_monthly($1)`
      : `SELECT refresh_attendance_monthly()`;
    const params = month ? [month] : [];
    await pool.query(sql, params);
    res.json({ message: `Attendance rollup refreshed for ${month || 'current month'}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to refresh rollup' });
  }
});

// HR: Payroll summary
app.get('/api/hr/payroll-summary', authRequired, requirePermission('HR_VIEW'), async (req, res) => {
  try {
    const { month } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM payroll_attendance_summary WHERE month=$1`,
      [month]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch payroll summary' });
  }
});

/* ---------- Global Error ---------- */
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ IQONIK HRMS backend listening on ${PORT}`));
