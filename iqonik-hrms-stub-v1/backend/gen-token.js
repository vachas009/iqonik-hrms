import jwt from 'jsonwebtoken';

const token = jwt.sign(
  {
    id: 'f81d6345-fbf6-4a4f-8b93-2097c71f987f',
    permissions: ['EMPLOYEE_CREATE']
  },
  'iqonik-super-secret-key',
  { expiresIn: '1h' }
);

console.log(token);
