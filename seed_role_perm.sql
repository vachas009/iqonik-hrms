\set csvfile 'D:/IQONIK Applications/HRMS/iqonik-hrms-stub-v1/db/seed/role_permissions.csv'
\echo Seeding role→permission from :csvfile

BEGIN;
CREATE TABLE IF NOT EXISTS seed_role_perm(role_name text, permission_code text);
\copy seed_role_perm(role_name,permission_code) FROM :'csvfile' CSV HEADER;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM seed_role_perm s
JOIN roles r ON r.name = s.role_name
JOIN permissions p ON p.code = s.permission_code
ON CONFLICT DO NOTHING;

DROP TABLE seed_role_perm;
COMMIT;
\echo Done.
