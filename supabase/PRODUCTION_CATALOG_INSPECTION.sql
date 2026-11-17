
-- READ-ONLY catalog inspection for the EXISTING production Supabase project.
--
-- Before running: verify the project name and project reference in the Supabase
-- Dashboard, then open SQL Editor from that same project. SQL cannot independently
-- prove which Supabase project the editor is connected to. Do not rely on hostname.
--
-- 1. Confirm this is the existing production project in Dashboard.
-- 2. Open that project's SQL Editor and paste this entire file.
-- 3. Run it once; it returns one row per catalog section.
-- 4. Export or copy the section results for reconciliation. Do not include
--    unrelated Dashboard values or credentials when sharing the results.
--
-- This file is one SELECT statement. It reads PostgreSQL/Supabase catalogs and
-- bucket configuration only. It never reads application rows, Storage objects,
-- credentials, environment variables, or database connection strings.
--
-- It does not run or simulate migrations and does not change schema, data,
-- grants, RLS, functions, triggers, or Storage configuration.
--
-- Optional migration-history and Storage metadata tables are checked before
-- querying. Missing schemas, tables, or objects are reported as absent.

WITH
user_schemas AS (
  SELECT
    n.oid,
    n.nspname,
    n.nspowner
  FROM pg_namespace AS n
  WHERE n.nspname <> 'information_schema'
    AND n.nspname !~ '^pg_'
),

user_relations AS (
  SELECT
    s.nspname AS schema_name,
    c.oid AS relation_oid,
    c.relname AS relation_name,
    c.relkind,
    c.relowner,
    c.relrowsecurity,
    c.relforcerowsecurity,
    c.relacl
  FROM pg_class AS c
  JOIN user_schemas AS s
    ON s.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
),

role_targets AS (
  SELECT DISTINCT
    r.oid,
    r.rolname
  FROM pg_roles AS r
  WHERE r.rolname IN (
    'anon',
    'authenticated',
    'service_role',
    'postgres',
    'authenticator',
    current_user,
    session_user
  )
),

report AS (
  SELECT
    'execution_context'::text AS section,
    jsonb_build_object(
      'current_user_role', current_user,
      'session_user_role', session_user,
      'project_identity_verified_by_sql', false,
      'note', 'Verify the selected production project manually in Supabase Dashboard.'
    ) AS details,
    1 AS sort_order

  UNION ALL

  SELECT
    'schemas',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'owner', pg_get_userbyid(s.nspowner)
        )
        ORDER BY s.nspname
      )
      FROM user_schemas AS s
    ), '[]'::jsonb),
    2

  UNION ALL

  SELECT
    'schema_privileges',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'role', r.rolname,
          'usage', has_schema_privilege(r.rolname, s.oid, 'USAGE'),
          'create', has_schema_privilege(r.rolname, s.oid, 'CREATE')
        )
        ORDER BY s.nspname, r.rolname
      )
      FROM user_schemas AS s
      CROSS JOIN role_targets AS r
    ), '[]'::jsonb),
    3

  UNION ALL

  -- pg_namespace does not expose nspacl on supported PostgreSQL versions.
  -- Report effective schema privileges instead of expanding a nonexistent ACL.
  SELECT
    'schema_acl_entries',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'role', r.rolname,
          'usage', has_schema_privilege(r.rolname, s.nspname, 'USAGE'),
          'create', has_schema_privilege(r.rolname, s.nspname, 'CREATE')
        )
        ORDER BY s.nspname, r.rolname
      )
      FROM user_schemas AS s
      CROSS JOIN pg_roles AS r
      WHERE r.rolname IN (
        'anon',
        'authenticated',
        'service_role',
        'postgres',
        'authenticator',
        current_user,
        session_user
      )
    ), '[]'::jsonb),
    4

  UNION ALL

  SELECT
    'relations_and_rls',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', rel.schema_name,
          'relation', rel.relation_name,
          'kind', rel.relkind,
          'owner', pg_get_userbyid(rel.relowner),
          'rls_enabled', rel.relrowsecurity,
          'rls_forced', rel.relforcerowsecurity
        )
        ORDER BY rel.schema_name, rel.relation_name
      )
      FROM user_relations AS rel
    ), '[]'::jsonb),
    5

  UNION ALL

  SELECT
    'columns',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', rel.schema_name,
          'table', rel.relation_name,
          'ordinal', a.attnum,
          'column', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'nullable', NOT a.attnotnull,
          'identity_kind', a.attidentity,
          'generated_kind', a.attgenerated,
          'default_expression', pg_get_expr(d.adbin, d.adrelid)
        )
        ORDER BY rel.schema_name, rel.relation_name, a.attnum
      )
      FROM user_relations AS rel
      JOIN pg_attribute AS a
        ON a.attrelid = rel.relation_oid
      LEFT JOIN pg_attrdef AS d
        ON d.adrelid = a.attrelid
       AND d.adnum = a.attnum
      WHERE a.attnum > 0
        AND NOT a.attisdropped
    ), '[]'::jsonb),
    6

  UNION ALL

  SELECT
    'enum_labels',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'enum', t.typname,
          'label_order', e.enumsortorder,
          'label', e.enumlabel
        )
        ORDER BY s.nspname, t.typname, e.enumsortorder
      )
      FROM pg_type AS t
      JOIN user_schemas AS s
        ON s.oid = t.typnamespace
      JOIN pg_enum AS e
        ON e.enumtypid = t.oid
    ), '[]'::jsonb),
    7

  UNION ALL

  SELECT
    'constraints_and_foreign_keys',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', rel.schema_name,
          'table', rel.relation_name,
          'name', con.conname,
          'kind', con.contype,
          'definition', pg_get_constraintdef(con.oid, true),
          'validated', con.convalidated,
          'deferrable', con.condeferrable,
          'initially_deferred', con.condeferred
        )
        ORDER BY rel.schema_name, rel.relation_name, con.conname
      )
      FROM user_relations AS rel
      JOIN pg_constraint AS con
        ON con.conrelid = rel.relation_oid
    ), '[]'::jsonb),
    8

  UNION ALL

  SELECT
    'indexes',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', rel.schema_name,
          'table', rel.relation_name,
          'index', idx.relname,
          'primary', ix.indisprimary,
          'unique', ix.indisunique,
          'valid', ix.indisvalid,
          'definition', pg_get_indexdef(idx.oid)
        )
        ORDER BY rel.schema_name, rel.relation_name, idx.relname
      )
      FROM user_relations AS rel
      JOIN pg_index AS ix
        ON ix.indrelid = rel.relation_oid
      JOIN pg_class AS idx
        ON idx.oid = ix.indexrelid
    ), '[]'::jsonb),
    9

  UNION ALL

  SELECT
    'policies',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', p.schemaname,
          'table', p.tablename,
          'name', p.policyname,
          'permissive', p.permissive,
          'roles', p.roles,
          'command', p.cmd,
          'using_expression', p.qual,
          'check_expression', p.with_check
        )
        ORDER BY p.schemaname, p.tablename, p.policyname
      )
      FROM pg_policies AS p
      JOIN user_schemas AS s
        ON s.nspname = p.schemaname
    ), '[]'::jsonb),
    10

  UNION ALL

  SELECT
    'effective_relation_privileges',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', rel.schema_name,
          'relation', rel.relation_name,
          'role', r.rolname,
          'select', has_table_privilege(r.rolname, rel.relation_oid, 'SELECT'),
          'insert', has_table_privilege(r.rolname, rel.relation_oid, 'INSERT'),
          'update', has_table_privilege(r.rolname, rel.relation_oid, 'UPDATE'),
          'delete', has_table_privilege(r.rolname, rel.relation_oid, 'DELETE'),
          'truncate', has_table_privilege(r.rolname, rel.relation_oid, 'TRUNCATE'),
          'references', has_table_privilege(r.rolname, rel.relation_oid, 'REFERENCES'),
          'trigger', has_table_privilege(r.rolname, rel.relation_oid, 'TRIGGER')
        )
        ORDER BY rel.schema_name, rel.relation_name, r.rolname
      )
      FROM user_relations AS rel
      CROSS JOIN role_targets AS r
    ), '[]'::jsonb),
    11

  UNION ALL

  SELECT
    'relation_acl_entries',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', rel.schema_name,
          'relation', rel.relation_name,
          'grantor', pg_get_userbyid(acl.grantor),
          'grantee', CASE
            WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE grantee_role.rolname
          END,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        ORDER BY
          rel.schema_name,
          rel.relation_name,
          grantee_role.rolname,
          acl.privilege_type
      )
      FROM user_relations AS rel
      CROSS JOIN LATERAL aclexplode(
        COALESCE(rel.relacl, acldefault('r', rel.relowner))
      ) AS acl
      LEFT JOIN pg_roles AS grantee_role
        ON grantee_role.oid = acl.grantee
    ), '[]'::jsonb),
    12

  UNION ALL

  SELECT
    'column_privileges',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', c.table_schema,
          'table', c.table_name,
          'column', c.column_name,
          'grantee', c.grantee,
          'privilege', c.privilege_type,
          'grantable', c.is_grantable
        )
        ORDER BY
          c.table_schema,
          c.table_name,
          c.column_name,
          c.grantee,
          c.privilege_type
      )
      FROM information_schema.column_privileges AS c
      JOIN user_schemas AS s
        ON s.nspname = c.table_schema
      WHERE c.grantee IN (
        'PUBLIC',
        'anon',
        'authenticated',
        'service_role',
        'postgres',
        current_user,
        session_user
      )
    ), '[]'::jsonb),
    13

  UNION ALL

  SELECT
    'sequence_privileges',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'sequence', seq.relname,
          'owner', pg_get_userbyid(seq.relowner),
          'owned_table', owned.relname,
          'owned_column', a.attname,
          'role', r.rolname,
          'usage', has_sequence_privilege(r.rolname, seq.oid, 'USAGE'),
          'select', has_sequence_privilege(r.rolname, seq.oid, 'SELECT'),
          'update', has_sequence_privilege(r.rolname, seq.oid, 'UPDATE')
        )
        ORDER BY s.nspname, seq.relname, r.rolname
      )
      FROM pg_class AS seq
      JOIN user_schemas AS s
        ON s.oid = seq.relnamespace
      LEFT JOIN pg_depend AS dep
        ON dep.classid = 'pg_class'::regclass
       AND dep.objid = seq.oid
       AND dep.refclassid = 'pg_class'::regclass
       AND dep.deptype IN ('a', 'i')
      LEFT JOIN pg_class AS owned
        ON owned.oid = dep.refobjid
      LEFT JOIN pg_attribute AS a
        ON a.attrelid = owned.oid
       AND a.attnum = dep.refobjsubid
      CROSS JOIN role_targets AS r
      WHERE seq.relkind = 'S'
    ), '[]'::jsonb),
    14

  UNION ALL

  SELECT
    'sequence_acl_entries',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'sequence', seq.relname,
          'grantor', pg_get_userbyid(acl.grantor),
          'grantee', CASE
            WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE grantee_role.rolname
          END,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        ORDER BY
          s.nspname,
          seq.relname,
          grantee_role.rolname,
          acl.privilege_type
      )
      FROM pg_class AS seq
      JOIN user_schemas AS s
        ON s.oid = seq.relnamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(seq.relacl, acldefault('S', seq.relowner))
      ) AS acl
      LEFT JOIN pg_roles AS grantee_role
        ON grantee_role.oid = acl.grantee
      WHERE seq.relkind = 'S'
    ), '[]'::jsonb),
    15

  UNION ALL

  SELECT
    'default_privileges',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'owner_role', owner_role.rolname,
          'schema', s.nspname,
          'object_kind', d.defaclobjtype,
          'grantor', grantor_role.rolname,
          'grantee', CASE
            WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE grantee_role.rolname
          END,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        ORDER BY
          owner_role.rolname,
          s.nspname,
          d.defaclobjtype,
          grantee_role.rolname,
          acl.privilege_type
      )
      FROM pg_default_acl AS d
      JOIN pg_roles AS owner_role
        ON owner_role.oid = d.defaclrole
      LEFT JOIN user_schemas AS s
        ON s.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
      LEFT JOIN pg_roles AS grantor_role
        ON grantor_role.oid = acl.grantor
      LEFT JOIN pg_roles AS grantee_role
        ON grantee_role.oid = acl.grantee
      WHERE d.defaclnamespace = 0
         OR s.oid IS NOT NULL
    ), '[]'::jsonb),
    16

  UNION ALL

  SELECT
    'functions',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'name', p.proname,
          'identity_arguments', pg_get_function_identity_arguments(p.oid),
          'owner', pg_get_userbyid(p.proowner),
          'language', l.lanname,
          'security_definer', p.prosecdef,
          'volatility', p.provolatile,
          'search_path_setting', COALESCE((
            SELECT config.value
            FROM unnest(p.proconfig) AS config(value)
            WHERE config.value LIKE 'search_path=%'
            LIMIT 1
          ), '<not set>'),
          'acl', COALESCE(p.proacl::text, '<default ACL>')
        )
        ORDER BY
          s.nspname,
          p.proname,
          pg_get_function_identity_arguments(p.oid)
      )
      FROM pg_proc AS p
      JOIN user_schemas AS s
        ON s.oid = p.pronamespace
      JOIN pg_language AS l
        ON l.oid = p.prolang
      WHERE p.prokind IN ('f', 'p')
    ), '[]'::jsonb),
    17

  UNION ALL

  SELECT
    'function_privileges',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'function', p.proname,
          'identity_arguments', pg_get_function_identity_arguments(p.oid),
          'role', r.rolname,
          'execute', has_function_privilege(r.rolname, p.oid, 'EXECUTE')
        )
        ORDER BY
          s.nspname,
          p.proname,
          pg_get_function_identity_arguments(p.oid),
          r.rolname
      )
      FROM pg_proc AS p
      JOIN user_schemas AS s
        ON s.oid = p.pronamespace
      CROSS JOIN role_targets AS r
      WHERE p.prokind IN ('f', 'p')
    ), '[]'::jsonb),
    18

  UNION ALL

  SELECT
    'function_acl_entries',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'function', p.proname,
          'identity_arguments', pg_get_function_identity_arguments(p.oid),
          'grantor', pg_get_userbyid(acl.grantor),
          'grantee', CASE
            WHEN acl.grantee = 0 THEN 'PUBLIC'
            ELSE grantee_role.rolname
          END,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        ORDER BY
          s.nspname,
          p.proname,
          pg_get_function_identity_arguments(p.oid),
          grantee_role.rolname,
          acl.privilege_type
      )
      FROM pg_proc AS p
      JOIN user_schemas AS s
        ON s.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))
      ) AS acl
      LEFT JOIN pg_roles AS grantee_role
        ON grantee_role.oid = acl.grantee
      WHERE p.prokind IN ('f', 'p')
    ), '[]'::jsonb),
    19

  UNION ALL

  SELECT
    'triggers',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', rel.schema_name,
          'table', rel.relation_name,
          'name', t.tgname,
          'enabled_state', t.tgenabled,
          'row_level', (t.tgtype & 1) <> 0,
          'before', (t.tgtype & 2) <> 0,
          'insert_event', (t.tgtype & 4) <> 0,
          'delete_event', (t.tgtype & 8) <> 0,
          'update_event', (t.tgtype & 16) <> 0,
          'truncate_event', (t.tgtype & 32) <> 0,
          'instead_of', (t.tgtype & 64) <> 0,
          'function_schema', fn_schema.nspname,
          'function_name', fn.proname
        )
        ORDER BY rel.schema_name, rel.relation_name, t.tgname
      )
      FROM user_relations AS rel
      JOIN pg_trigger AS t
        ON t.tgrelid = rel.relation_oid
      JOIN pg_proc AS fn
        ON fn.oid = t.tgfoid
      JOIN pg_namespace AS fn_schema
        ON fn_schema.oid = fn.pronamespace
      WHERE NOT t.tgisinternal
    ), '[]'::jsonb),
    20

  UNION ALL

  -- Limit role inspection to roles relevant to this application's access model.
  -- Direct membership rows are included when either side involves a target role.
  -- Effective membership is evaluated only between target roles.
  SELECT
    'roles_and_memberships',
    jsonb_build_object(
      'roles',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'role', r.rolname,
            'login', r.rolcanlogin,
            'superuser', r.rolsuper,
            'bypass_rls', r.rolbypassrls,
            'inherit', r.rolinherit,
            'create_role', r.rolcreaterole,
            'create_database', r.rolcreatedb
          )
          ORDER BY r.rolname
        )
        FROM role_targets AS rt
        JOIN pg_roles AS r
          ON r.oid = rt.oid
      ), '[]'::jsonb),

      'memberships',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'member', member_role.rolname,
            'granted_role', granted_role.rolname,
            'admin_option', m.admin_option
          )
          ORDER BY member_role.rolname, granted_role.rolname
        )
        FROM pg_auth_members AS m
        JOIN pg_roles AS member_role
          ON member_role.oid = m.member
        JOIN pg_roles AS granted_role
          ON granted_role.oid = m.roleid
        WHERE EXISTS (
          SELECT 1
          FROM role_targets AS rt
          WHERE rt.oid = m.member
             OR rt.oid = m.roleid
        )
      ), '[]'::jsonb),

      'effective_memberships',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'member', member_role.rolname,
            'granted_role', granted_role.rolname,
            'is_member', pg_has_role(
              member_role.rolname,
              granted_role.oid,
              'MEMBER'
            )
          )
          ORDER BY member_role.rolname, granted_role.rolname
        )
        FROM role_targets AS member_role
        CROSS JOIN role_targets AS granted_role
        WHERE member_role.oid <> granted_role.oid
      ), '[]'::jsonb)
    ),
    21

  UNION ALL

  SELECT
    'migration_history',
    CASE
      WHEN to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_attribute AS a
         WHERE a.attrelid = to_regclass('supabase_migrations.schema_migrations')
           AND a.attname = 'version'
           AND a.attnum > 0
           AND NOT a.attisdropped
       )
      THEN jsonb_build_object(
        'source', 'supabase_migrations.schema_migrations',
        'versions_xml', query_to_xml(
          'SELECT version::text AS version,
                  version::text IN (
                    ''20261117100000'',
                    ''20261117105000'',
                    ''20261117110000'',
                    ''20261117120000''
                  ) AS target_migration
             FROM supabase_migrations.schema_migrations
            ORDER BY version::text',
          true,
          false,
          ''
        )::text
      )

      WHEN to_regclass('public.schema_migrations') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_attribute AS a
         WHERE a.attrelid = to_regclass('public.schema_migrations')
           AND a.attname = 'version'
           AND a.attnum > 0
           AND NOT a.attisdropped
       )
      THEN jsonb_build_object(
        'source', 'public.schema_migrations',
        'versions_xml', query_to_xml(
          'SELECT version::text AS version,
                  version::text IN (
                    ''20261117100000'',
                    ''20261117105000'',
                    ''20261117110000'',
                    ''20261117120000''
                  ) AS target_migration
             FROM public.schema_migrations
            ORDER BY version::text',
          true,
          false,
          ''
        )::text
      )

      ELSE jsonb_build_object(
        'status', 'MIGRATION_HISTORY_TABLE_OR_VERSION_COLUMN_NOT_FOUND'
      )
    END,
    22

  UNION ALL

  SELECT
    'storage_buckets',
    CASE
      WHEN to_regclass('storage.buckets') IS NULL
      THEN jsonb_build_object(
        'status', 'storage.buckets not found'
      )
      ELSE jsonb_build_object(
        'source', 'storage.buckets',
        'bucket_configuration_xml', query_to_xml(
          'SELECT id, name, public, file_size_limit, allowed_mime_types
             FROM storage.buckets
            ORDER BY id',
          true,
          false,
          ''
        )::text
      )
    END,
    23

  UNION ALL

  SELECT
    'security_function_definitions',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.nspname,
          'name', p.proname,
          'identity_arguments', pg_get_function_identity_arguments(p.oid),
          'owner', pg_get_userbyid(p.proowner),
          'security_definer', p.prosecdef,
          'search_path_setting', COALESCE((
            SELECT config.value
            FROM unnest(p.proconfig) AS config(value)
            WHERE config.value LIKE 'search_path=%'
            LIMIT 1
          ), '<not set>'),
          'definition', pg_get_functiondef(p.oid)
        )
        ORDER BY
          s.nspname,
          p.proname,
          pg_get_function_identity_arguments(p.oid)
      )
      FROM pg_proc AS p
      JOIN pg_namespace AS s
        ON s.oid = p.pronamespace
      WHERE (s.nspname = 'public' AND p.proname = 'get_my_role')
         OR (s.nspname = 'auth' AND p.proname = 'uid')
    ), '[]'::jsonb),
    24

  UNION ALL

  -- Inspect Storage object RLS policies separately from bucket configuration.
  SELECT
    'storage_object_policies',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'policy', p.policyname,
          'permissive', p.permissive,
          'roles', p.roles,
          'command', p.cmd,
          'using_expression', p.qual,
          'check_expression', p.with_check
        )
        ORDER BY p.policyname
      )
      FROM pg_policies AS p
      WHERE p.schemaname = 'storage'
        AND p.tablename = 'objects'
    ), '[]'::jsonb),
    25
)

SELECT
  section,
  details
FROM report
ORDER BY sort_order;
