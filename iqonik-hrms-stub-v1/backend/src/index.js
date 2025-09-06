import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import pkg from 'pg';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const { Pool } = pkg;

/* ---------- Helpers ---------- */
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const randomPwd = () => crypto.randomBytes(4).toString('hex'); // 8-char random

/* ---------- App & DB ---------- */
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('tiny'));

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
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    try {
      const empId = req.empId;
      if (!empId) return cb(new Error('Missing employee ID for upload'), null);

      const { rows } = await pool.query(`SELECT code FROM employees WHERE id=$1`, [empId]);
      const empCode = rows[0]?.code || empId;

      const empDir = path.join(uploadDir, empCode);
      if (!fs.existsSync(empDir)) fs.mkdirSync(empDir, { recursive: true });

      cb(null, empDir);
    } catch (err) {
      cb(err, null);
    }
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + ext);
  },
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
   AUTHENTICATION
   ============================================================ */
// Register new user
app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [name, email]
    );
    const userId = rows[0].id;

    const emp = await pool.query(
      `INSERT INTO employees (user_id, code, status, password)
       VALUES ($1, generate_emp_code(), 'active', $2)
       ON CONFLICT (user_id) DO UPDATE SET password=EXCLUDED.password
       RETURNING id, code`,
      [userId, hashed]
    );

    res.status(201).json({
      message: 'User registered',
      user_id: userId,
      employee_id: emp.rows[0].id,
      code: emp.rows[0].code,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.email, u.name,
              e.id AS employee_id, e.password, e.manager_id,
              json_agg(rp.permission_code) AS permissions
       FROM users u
       JOIN employees e ON e.user_id = u.id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE u.email=$1
       GROUP BY u.id, e.id`,
      [email]
    );

    if (rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password || '');
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.user_id, empId: user.employee_id, permissions: user.permissions.filter(Boolean) },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.user_id,
        empId: user.employee_id,
        name: user.name,
        email: user.email,
        permissions: user.permissions.filter(Boolean),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* ============================================================
   EMPLOYEE ONBOARDING & DOCS
   ============================================================ */
app.post('/employees', authRequired, requirePermission('EMPLOYEE_CREATE'), async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name & email required' });

  try {
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (name, email) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [name, email]
    );
    const userId = userRows[0].id;

    const { rows: empRows } = await pool.query(
      `INSERT INTO employees (user_id, code, status)
       VALUES ($1, generate_emp_code(), 'pre_join')
       RETURNING id, code`,
      [userId]
    );
    const emp = empRows[0];

    res.status(201).json({ employee_code: emp.code, user_id: userId, employee_id: emp.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to create employee' });
  }
});

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

      const { rows } = await pool.query(`SELECT code FROM employees WHERE id=$1`, [empId]);
      const empCode = rows[0]?.code || empId;

      const queries = [];
      for (const [type, fileArr] of Object.entries(files)) {
        const file = fileArr[0];
        const relativePath = path.join('uploads', empCode, path.basename(file.path));
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

app.post('/api/hr/docs/update', authRequired, requirePermission('DOCS_REVIEW'), async (req, res) => {
  const { docId, action } = req.body;
  if (!docId || !['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE employee_docs SET status=$1, reviewed_at=now() WHERE id=$2 RETURNING employee_id`,
      [action, docId]
    );
    const empId = rows[0].employee_id;

    const { rows: check } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status!='approved') AS pending
       FROM employee_docs WHERE employee_id=$1`,
      [empId]
    );

    if (parseInt(check[0].pending) === 0) {
      const rawPwd = randomPwd();
      const hashedPwd = await bcrypt.hash(rawPwd, 10);
      await pool.query(`UPDATE employees SET status='active', password=$2 WHERE id=$1`, [
        empId,
        hashedPwd,
      ]);
      console.log(`✅ Employee ${empId} activated with password: ${rawPwd}`);
    }

    res.json({ message: `Document ${action}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

/* ============================================================
   LEAVE MANAGEMENT
   ============================================================ */
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

app.get('/api/leave/balance', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT lt.name, lb.allocated, lb.used
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

app.put('/api/leave/:id/status', authRequired, requirePermission('LEAVE_APPROVE'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const { rows } = await pool.query(
      `UPDATE leaves SET status=$1, approver_id=$2, approved_at=now()
       WHERE id=$3 AND status='PENDING'
       RETURNING *`,
      [status, req.user.id, id]
    );
    if (rows.length === 0) return res.status(400).json({ error: 'Not found or already processed' });
    res.json({ message: `Leave ${status}`, leave: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update leave' });
  }
});

/* ============================================================
   ATTENDANCE MANAGEMENT
   ============================================================ */
app.get('/api/attendance/my', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.date, a.status
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

app.get('/api/attendance/team', authRequired, requirePermission('ATTENDANCE_APPROVE'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.name, a.date, a.status
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

app.post('/api/hr/attendance/refresh', authRequired, requirePermission('HR_MANAGE'), async (req, res) => {
  try {
    const { month } = req.body || {};
    const sql = month ? `SELECT refresh_attendance_monthly($1)` : `SELECT refresh_attendance_monthly()`;
    const params = month ? [month] : [];
    await pool.query(sql, params);
    res.json({ message: `Attendance rollup refreshed for ${month || 'current month'}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to refresh rollup' });
  }
});

app.get('/api/hr/payroll-summary', authRequired, requirePermission('HR_VIEW'), async (req, res) => {
  try {
    const { month } = req.query;
    const { rows } = await pool.query(`SELECT * FROM payroll_attendance_summary WHERE month=$1`, [month]);
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
