import jwt from 'jsonwebtoken';

const token = jwt.sign(
  {
    id: 'f81d6345-fbf6-4a4f-8b93-2097c71f987f',   // Same or another user UUID
    permissions: ['EMPLOYEE_CREATE']
  },
  'iqonik-super-secret-key',
  { expiresIn: '1h' }
);

console.log('Employee Create Token:\n');
console.log(token);
