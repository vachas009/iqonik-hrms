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
const ok   = (res, data) => res.json({ ok: true, data });
const oops = (res, e, code = 500) => { console.error(e); res.status(code).json({ ok:false, error: e.message || String(e) }); };

const toMonthBounds = (yyyyMm) => {
  const [y, m] = yyyyMm.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end   = new Date(Date.UTC(y, m, 1)); // exclusive
  return { start, end };
};

/* ---------- App & DB ---------- */
const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(morgan('tiny'));

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const PUBLIC_ROOT = path.join(process.cwd(), 'public');

if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// static
app.use('/uploads', express.static(UPLOAD_ROOT));
app.use(express.static(PUBLIC_ROOT));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_ROOT, 'index.html')));

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
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const empId = req.empId || 'temp';
    const empDir = path.join(UPLOAD_ROOT, empId);
    if (!fs.existsSync(empDir)) fs.mkdirSync(empDir, { recursive: true });
    cb(null, empDir);
  },
  filename: function (_req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + ext);
  }
});
const upload = multer({ storage });

/* ---------- Extract Employee ID from token (for doc uploads) ---------- */
function extractEmpId(req, res, next) {
  try {
    const token = req.body.token || req.query.token || req.headers['x-doc-token'];
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.empId = payload.empId; // token should contain { empId }
    next();
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Invalid/expired token' });
  }
}

/* ---------- Health ---------- */
app.get('/health', (_req, res) => ok(res, { ts: new Date().toISOString() }));

/* ============================================================
   EMPLOYEE ONBOARDING & DOCUMENTS (uses users, employees, documents)
   ============================================================ */

// Create employee (basic onboarding) — matches schema fields
app.post('/employees', authRequired, requirePermission('EMPLOYEE_CREATE'), async (req, res) => {
  const { name, email, phone } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name & email required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `INSERT INTO users (name, email, phone)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = NOW()
       RETURNING id`,
      [name, email, phone || null]
    );
    const userId = userRows[0].id;

    // simple code like EMP-AB12CD34
    const empCode = 'EMP-' + (Math.random().toString(36).slice(2,10)).toUpperCase();

    const { rows: empRows } = await client.query(
      `INSERT INTO employees (user_id, code, status)
       VALUES ($1, $2, 'pre_join')
       ON CONFLICT (user_id) DO NOTHING
       RETURNING id, code, status`,
      [userId, empCode]
    );

    await client.query('COMMIT');

    if (!empRows.length) {
      return res.status(200).json({ message: 'Employee already exists', user_id: userId });
    }
    const emp = empRows[0];
    res.status(201).json({ user_id: userId, employee_id: emp.id, employee_code: emp.code, status: emp.status });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'failed to create employee' });
  } finally {
    client.release();
  }
});

// Employee: Upload documents (writes to documents table)
app.post(
  '/api/employee/upload-docs',
  extractEmpId,
  upload.fields([
    { name: 'aadhar', maxCount: 1 },
    { name: 'pan',    maxCount: 1 },
    { name: 'bank',   maxCount: 1 },
    { name: 'photo',  maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const empId = req.empId;
      const files = req.files || {};
      const tasks = [];

      for (const [field, arr] of Object.entries(files)) {
        const f = arr[0];
        // produce a web URL under /uploads/<empId>/<filename>
        const fileUrl = '/uploads/' + empId + '/' + path.basename(f.path);
        tasks.push(pool.query(
          `INSERT INTO documents (employee_id, type, file_url)
           VALUES ($1, $2, $3)`,
          [empId, field, fileUrl]
        ));
      }

      if (!tasks.length) return res.status(400).json({ error: 'No files uploaded' });

      await Promise.all(tasks);
      // optionally move status from pre_join -> active after docs
      await pool.query(`UPDATE employees SET status='active', updated_at=NOW() WHERE id=$1 AND status='pre_join'`, [empId]);

      res.json({ ok: true, saved: Object.keys(files) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Doc upload failed' });
    }
  }
);

/* ============================================================
   LEAVE MANAGEMENT (uses leaves, attendance_days; no extra tables)
   ============================================================ */

// Employee: Apply leave (schema: leaves.type TEXT, status lowercase)
app.post('/api/leave/apply', authRequired, async (req, res) => {
  const { type, start_date, end_date, reason } = req.body || {};
  if (!type || !start_date || !end_date)
    return res.status(400).json({ error: 'type, start_date, end_date required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO leaves (employee_id, type, start_date, end_date, reason, status)
       VALUES ((SELECT id FROM employees WHERE user_id=$1), $2, $3, $4, $5, 'pending')
       RETURNING id, status`,
      [req.user.id, type, start_date, end_date, reason || null]
    );
    res.json({ ok: true, request_id: rows[0].id, status: rows[0].status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to apply leave' });
  }
});

// Employee: Leave balances (derived YTD; simple default allocations)
app.get('/api/leave/balance', authRequired, async (req, res) => {
  const ALLOC = { CL: 12, SL: 8, PL: 12 }; // tweak as desired
  try {
    const { rows } = await pool.query(
      `SELECT type,
              SUM( GREATEST(1, DATE_PART('day', (end_date - start_date)) + 1) ) AS days
       FROM leaves
       WHERE employee_id = (SELECT id FROM employees WHERE user_id=$1)
         AND status='approved'
         AND start_date >= DATE_TRUNC('year', NOW())
       GROUP BY type`,
      [req.user.id]
    );
    const used = Object.fromEntries(rows.map(r => [r.type, Number(r.days)]));
    const out = Object.entries(ALLOC).map(([t, alloc]) => ({
      type: t,
      allocated: alloc,
      used: used[t] || 0,
      remaining: alloc - (used[t] || 0),
    }));
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

// Manager: Pending leave requests (no leave_types table)
app.get('/api/leave/pending', authRequired, requirePermission('LEAVE_APPROVE'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, u.name AS employee_name, l.type AS leave_type,
              l.start_date, l.end_date, l.reason, l.status
       FROM leaves l
       JOIN employees e ON e.id = l.employee_id
       JOIN users u ON u.id = e.user_id
       WHERE e.manager_id = $1 AND l.status='pending'
       ORDER BY l.created_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch pending leaves' });
  }
});

// Manager: Approve/Reject + write to attendance_days (lowercase statuses)
app.put('/api/leave/:id/status', authRequired, requirePermission('LEAVE_APPROVE'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const s = String(status || '').toLowerCase();
  if (!['approved','rejected'].includes(s))
    return res.status(400).json({ error: 'status must be approved or rejected' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM leaves WHERE id=$1 AND status='pending' FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Leave not found or already processed' });
    }
    const leave = rows[0];

    await client.query(
      `UPDATE leaves SET status=$1, approver_id=$2 WHERE id=$3`,
      [s, req.user.id, id]
    );

    if (s === 'approved') {
      await client.query(
        `INSERT INTO attendance_days (employee_id, date, status, source, geofence_ok)
         SELECT $1, d::date, 'leave', 'web', true
         FROM generate_series($2::date, $3::date, interval '1 day') d
         ON CONFLICT (employee_id, date)
         DO UPDATE SET status='leave', source='web', geofence_ok=true`,
        [leave.employee_id, leave.start_date, leave.end_date]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, status: s });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Failed to update leave' });
  } finally {
    client.release();
  }
});

/* ============================================================
   ATTENDANCE (uses attendance_days)
   ============================================================ */

// Employee: My last 60 days
app.get('/api/attendance/my', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.date, a.status, a.source, a.geofence_ok
       FROM attendance_days a
       JOIN employees e ON a.employee_id = e.id
       WHERE e.user_id=$1
       ORDER BY a.date DESC
       LIMIT 60`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Manager: Team attendance (recent)
app.get('/api/attendance/team', authRequired, requirePermission('ATTENDANCE_APPROVE'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.name AS employee, a.date, a.status
       FROM employees e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN attendance_days a ON a.employee_id = e.id
       WHERE e.manager_id=$1
       ORDER BY u.name, a.date DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch team attendance' });
  }
});

/* ============================================================
   HR DASHBOARD: Refresh (ack) + Payroll summary (computed live)
   ============================================================ */

// Button ack (we compute live in the GET below)
app.post('/api/hr/attendance/refresh', authRequired, requirePermission('HR_MANAGE'), async (req, res) => {
  const { month } = req.body || {};
  if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required' });
  res.json({ ok: true, message: `Recalculated for ${month}` });
});

// Live payroll summary from attendance_days + latest ctc_structures
app.get('/api/hr/payroll-summary', authRequired, requirePermission('HR_VIEW'), async (req, res) => {
  const { month } = req.query || {};
  if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required' });

  const { start, end } = toMonthBounds(month);

  try {
    const { rows } = await pool.query(
      `WITH month_att AS (
         SELECT e.id AS employee_id,
                SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS presents,
                SUM(CASE WHEN a.status='leave'   THEN 1 ELSE 0 END) AS leaves,
                SUM(CASE WHEN a.status='absent'  THEN 1 ELSE 0 END) AS absents
         FROM employees e
         LEFT JOIN attendance_days a
           ON a.employee_id = e.id
          AND a.date >= $1::date
          AND a.date <  $2::date
         GROUP BY e.id
       ),
       latest_ctc AS (
         SELECT DISTINCT ON (c.employee_id)
                c.employee_id,
                (c.basic + c.hra + c.special) AS base_salary
         FROM ctc_structures c
         WHERE c.effective_from <= $1::date
         ORDER BY c.employee_id, c.effective_from DESC
       )
       SELECT u.name AS employee,
              COALESCE(l.base_salary,0)::numeric(12,2) AS base_salary,
              COALESCE(m.presents,0) AS presents,
              COALESCE(m.leaves,0)   AS leaves,
              COALESCE(m.absents,0)  AS absents
       FROM employees e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN month_att m ON m.employee_id = e.id
       LEFT JOIN latest_ctc l ON l.employee_id = e.id
       ORDER BY u.name`,
      [start, end]
    );

    const WORKING_DAYS = 26; // adjust for your policy
    const data = rows.map(r => ({
      employee: r.employee,
      base_salary: Number(r.base_salary),
      presents: Number(r.presents),
      leaves: Number(r.leaves),
      absents: Number(r.absents),
      payable_salary: Math.round(Number(r.base_salary) * (Math.max(0, Number(r.presents) + Number(r.leaves)) / WORKING_DAYS))
    }));

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to compute payroll summary' });
  }
});

/* ---------- 404 & Error ---------- */
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ IQONIK HRMS backend listening on ${PORT}`));
