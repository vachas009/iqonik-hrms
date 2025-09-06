import jwt from 'jsonwebtoken';

const token = jwt.sign(
  {
    id: 'f81d6345-fbf6-4a4f-8b93-2097c71f987f',   // HR user UUID from your DB
    permissions: ['HR_VIEW', 'DOCS_REVIEW', 'HR_MANAGE']
  },
  'iqonik-super-secret-key',   // must match JWT_SECRET in your .env
  { expiresIn: '1h' }
);

console.log('HR/Admin Token:\n');
console.log(token);
