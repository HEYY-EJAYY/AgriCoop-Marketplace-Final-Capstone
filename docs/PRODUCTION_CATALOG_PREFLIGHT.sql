-- READ-ONLY catalog inventory for DBA review before preparing production migrations.
-- Run against the existing Supabase project only with owner approval. Every statement
-- below is SELECT-only against catalogs or Storage bucket metadata; no changes are made.

-- Schemas and schema-level privileges.
SELECT
  n.nspname AS schema_name,
  r.rolname AS role_name,
  has_schema_privilege(r.rolname, n.oid, 'USAGE') AS has_usage,
  has_schema_privilege(r.rolname, n.oid, 'CREATE') AS has_create
FROM pg_namespace AS n
CROSS JOIN pg_roles AS r
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY n.nspname, r.rolname;

-- Relations, owners, and row-level security flags.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind AS relation_kind,
  pg_get_userbyid(c.relowner) AS owner_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY n.nspname, c.relname;

-- Columns, exact PostgreSQL types, nullability, identity/generated status, and defaults.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attnum AS ordinal_position,
  a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  NOT a.attnotnull AS is_nullable,
  a.attidentity AS identity_kind,
  a.attgenerated AS generated_kind,
  pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_attribute AS a
JOIN pg_class AS c ON c.oid = a.attrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, a.attnum;

-- Primary keys, foreign keys, unique/check/exclusion constraints, and validation state.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_kind,
  pg_get_constraintdef(con.oid, true) AS definition,
  con.convalidated AS is_validated,
  con.condeferrable AS is_deferrable,
  con.condeferred AS initially_deferred
FROM pg_constraint AS con
JOIN pg_class AS c ON c.oid = con.conrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
ORDER BY n.nspname, c.relname, con.conname;

-- Index definitions, including unique and partial indexes.
SELECT
  n.nspname AS schema_name,
  t.relname AS table_name,
  i.relname AS index_name,
  ix.indisprimary AS is_primary,
  ix.indisunique AS is_unique,
  ix.indisvalid AS is_valid,
  pg_get_indexdef(i.oid) AS definition
FROM pg_index AS ix
JOIN pg_class AS i ON i.oid = ix.indexrelid
JOIN pg_class AS t ON t.oid = ix.indrelid
JOIN pg_namespace AS n ON n.oid = t.relnamespace
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
ORDER BY n.nspname, t.relname, i.relname;

-- Enum labels in order.
SELECT
  n.nspname AS schema_name,
  t.typname AS enum_name,
  e.enumsortorder AS label_order,
  e.enumlabel AS label
FROM pg_type AS t
JOIN pg_namespace AS n ON n.oid = t.typnamespace
JOIN pg_enum AS e ON e.enumtypid = t.oid
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
ORDER BY n.nspname, t.typname, e.enumsortorder;

-- Policies and their predicates; an empty result means no cataloged policies.
SELECT
  schemaname AS schema_name,
  tablename AS table_name,
  policyname AS policy_name,
  permissive,
  roles,
  cmd AS command,
  qual AS using_expression,
  with_check AS check_expression
FROM pg_policies
WHERE schemaname IN ('public', 'agricoop_app', 'storage')
ORDER BY schemaname, tablename, policyname;

-- Effective relation privileges for Supabase application roles.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  r.rolname AS role_name,
  has_table_privilege(r.rolname, c.oid, 'SELECT') AS can_select,
  has_table_privilege(r.rolname, c.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.rolname, c.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.rolname, c.oid, 'DELETE') AS can_delete,
  has_table_privilege(r.rolname, c.oid, 'TRUNCATE') AS can_truncate,
  has_table_privilege(r.rolname, c.oid, 'REFERENCES') AS can_reference,
  has_table_privilege(r.rolname, c.oid, 'TRIGGER') AS can_trigger
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN pg_roles AS r
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY n.nspname, c.relname, r.rolname;

-- Sequence ownership and effective sequence privileges.
SELECT
  n.nspname AS schema_name,
  s.relname AS sequence_name,
  pg_get_userbyid(s.relowner) AS owner_name,
  t.relname AS owned_table,
  a.attname AS owned_column,
  r.rolname AS role_name,
  has_sequence_privilege(r.rolname, s.oid, 'USAGE') AS can_use,
  has_sequence_privilege(r.rolname, s.oid, 'SELECT') AS can_select,
  has_sequence_privilege(r.rolname, s.oid, 'UPDATE') AS can_update
FROM pg_class AS s
JOIN pg_namespace AS n ON n.oid = s.relnamespace
LEFT JOIN pg_depend AS dep
  ON dep.classid = 'pg_class'::regclass
 AND dep.objid = s.oid
 AND dep.refclassid = 'pg_class'::regclass
 AND dep.deptype IN ('a', 'i')
LEFT JOIN pg_class AS t ON t.oid = dep.refobjid
LEFT JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attnum = dep.refobjsubid
CROSS JOIN pg_roles AS r
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
  AND s.relkind = 'S'
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY n.nspname, s.relname, r.rolname;

-- Non-default privilege entries configured for future objects.
SELECT
  owner_role.rolname AS owner_role,
  n.nspname AS schema_name,
  d.defaclobjtype AS object_kind,
  grantor.rolname AS grantor_role,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee_role,
  acl.privilege_type,
  acl.is_grantable
FROM pg_default_acl AS d
JOIN pg_roles AS owner_role ON owner_role.oid = d.defaclrole
LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
LEFT JOIN pg_roles AS grantor ON grantor.oid = acl.grantor
LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
WHERE n.nspname IS NULL OR n.nspname IN ('public', 'agricoop_app', 'storage')
ORDER BY owner_role.rolname, n.nspname, d.defaclobjtype, grantee_role, acl.privilege_type;

-- Function security attributes and ACLs; function source is intentionally omitted.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_userbyid(p.proowner) AS owner_name,
  l.lanname AS language,
  p.prosecdef AS is_security_definer,
  p.proconfig AS function_settings,
  COALESCE(p.proacl::text, '<default ACL>') AS function_acl
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_language AS l ON l.oid = p.prolang
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
ORDER BY n.nspname, p.proname, identity_arguments;

-- Trigger definitions and enabled/disabled state.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  pg_get_triggerdef(t.oid, true) AS definition
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'agricoop_app', 'storage')
  AND NOT t.tgisinternal
ORDER BY n.nspname, c.relname, t.tgname;

-- Existing Storage bucket settings (no object names or contents are exposed).
SELECT
  id AS bucket_id,
  name AS bucket_name,
  public AS is_public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE id IN ('product-images', 'payment-proofs')
ORDER BY id;

-- Role attributes used to distinguish database roles from application roles.
SELECT
  rolname AS role_name,
  rolsuper AS is_superuser,
  rolinherit AS inherits_privileges,
  rolcreaterole AS can_create_role,
  rolcreatedb AS can_create_database,
  rolcanlogin AS can_login,
  rolbypassrls AS bypasses_rls
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY rolname;
