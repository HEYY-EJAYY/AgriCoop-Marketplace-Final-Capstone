-- READ-ONLY STAGING PREFLIGHT ONLY.
-- Replace all three project-ref placeholders after manually verifying the
-- currently selected project in its Supabase Dashboard. Set the boolean to
-- TRUE only after confirming the dashboard project ref and project name.
-- This file contains one SELECT statement and never reads application rows.
-- It does not execute, simulate, or apply either migration.
--
-- Supabase SQL Editor does not expose a documented, trustworthy project-ref
-- setting to SQL. The project identity gate therefore requires independent
-- operator confirmation and compares the entered dashboard ref to the
-- explicitly supplied staging and production refs. A hostname is not used.

WITH operator_confirmation AS (
  SELECT
    'REPLACE_WITH_STAGING_PROJECT_REF'::text AS expected_staging_ref,
    'REPLACE_WITH_CURRENT_DASHBOARD_PROJECT_REF'::text AS dashboard_project_ref,
    'REPLACE_WITH_KNOWN_PRODUCTION_PROJECT_REF'::text AS known_production_ref,
    FALSE::boolean AS dashboard_identity_manually_verified
),
project_gate AS (
  SELECT
    dashboard_identity_manually_verified
      AND expected_staging_ref ~ '^[a-z0-9]{20}$'
      AND dashboard_project_ref ~ '^[a-z0-9]{20}$'
      AND known_production_ref ~ '^[a-z0-9]{20}$'
      AND expected_staging_ref = dashboard_project_ref
      AND expected_staging_ref <> known_production_ref AS may_inspect,
    CASE
      WHEN NOT dashboard_identity_manually_verified
        THEN 'STOP: dashboard project identity was not manually verified'
      WHEN expected_staging_ref !~ '^[a-z0-9]{20}$'
        OR dashboard_project_ref !~ '^[a-z0-9]{20}$'
        OR known_production_ref !~ '^[a-z0-9]{20}$'
        THEN 'STOP: replace all project-ref placeholders with valid project refs'
      WHEN expected_staging_ref = known_production_ref
        THEN 'STOP: the expected staging project ref matches the known production ref'
      WHEN expected_staging_ref <> dashboard_project_ref
        THEN 'STOP: the current Dashboard project ref does not match the expected staging ref'
      ELSE 'PASS: operator-confirmed staging ref differs from the known production ref'
    END AS gate_message
  FROM operator_confirmation
),
wanted_relations(schema_name, relation_name) AS (
  VALUES
    ('agricoop_app', 'users'),
    ('agricoop_app', 'cooperatives'),
    ('agricoop_app', 'auditLogs'),
    ('agricoop_app', 'notifications'),
    ('agricoop_app', 'profileVerificationSubmissions'),
    ('public', 'profiles'),
    ('public', 'roles'),
    ('auth', 'users'),
    ('storage', 'buckets'),
    ('storage', 'objects')
),
relation_oids AS (
  SELECT
    wanted.schema_name,
    wanted.relation_name,
    n.oid AS namespace_oid,
    c.oid AS relation_oid,
    c.relkind,
    c.relowner,
    c.relrowsecurity,
    c.relforcerowsecurity
  FROM wanted_relations AS wanted
  LEFT JOIN pg_namespace AS n ON n.nspname = wanted.schema_name
  LEFT JOIN pg_class AS c
    ON c.relnamespace = n.oid
   AND c.relname = wanted.relation_name
),
relevant_functions AS (
  SELECT
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_userbyid(p.proowner) AS owner_name,
    l.lanname AS language,
    p.prosecdef AS is_security_definer,
    p.proconfig AS function_settings,
    COALESCE(p.proacl::text, '<default ACL>') AS function_acl,
    pg_get_functiondef(p.oid) AS definition
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_language AS l ON l.oid = p.prolang
  WHERE p.prokind IN ('f', 'p')
    AND (
      (n.nspname = 'auth' AND p.proname IN ('uid', 'jwt'))
      OR (
        n.nspname = 'agricoop_app'
        AND p.proname IN (
          'get_my_role',
          'can_review_profile_verification_user',
          'guard_profile_verification_user_update'
        )
      )
    )
),
report AS (
  SELECT
    'project_gate'::text AS section,
    jsonb_build_object(
      'status', CASE WHEN gate.may_inspect THEN 'PASS' ELSE 'STOP' END,
      'message', gate.gate_message,
      'dashboard_identity_manually_verified',
        (SELECT dashboard_identity_manually_verified FROM operator_confirmation),
      'project_refs_echoed', FALSE
    ) AS details,
    0 AS sort_order
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'migration_history',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
        THEN jsonb_build_object('status', 'HISTORY_TABLE_NOT_FOUND')
      WHEN NOT EXISTS (
        SELECT 1
        FROM pg_attribute AS a
        WHERE a.attrelid = to_regclass('supabase_migrations.schema_migrations')
          AND a.attname = 'version'
          AND a.attnum > 0
          AND NOT a.attisdropped
      ) THEN jsonb_build_object('status', 'HISTORY_TABLE_HAS_NO_VERSION_COLUMN')
      ELSE jsonb_build_object(
        'status', 'HISTORY_TABLE_FOUND',
        'target_versions_xml', query_to_xml(
          'SELECT version::text AS version
             FROM supabase_migrations.schema_migrations
            WHERE version::text IN (''20261117100000'', ''20261117120000'')
            ORDER BY version::text',
          TRUE,
          FALSE,
          ''
        )::text
      )
    END,
    1
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'relations_and_rls',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', rel.schema_name,
          'relation', rel.relation_name,
          'exists', rel.relation_oid IS NOT NULL,
          'kind', rel.relkind,
          'owner', CASE WHEN rel.relation_oid IS NOT NULL THEN pg_get_userbyid(rel.relowner) END,
          'rls_enabled', rel.relrowsecurity,
          'rls_forced', rel.relforcerowsecurity
        ) ORDER BY rel.schema_name, rel.relation_name)
        FROM relation_oids AS rel
      ), '[]'::jsonb)
    END,
    2
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'columns',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', rel.schema_name,
          'table', rel.relation_name,
          'ordinal', a.attnum,
          'column', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'nullable', NOT a.attnotnull,
          'identity', a.attidentity,
          'generated', a.attgenerated,
          'default', pg_get_expr(d.adbin, d.adrelid)
        ) ORDER BY rel.schema_name, rel.relation_name, a.attnum)
        FROM relation_oids AS rel
        JOIN pg_attribute AS a ON a.attrelid = rel.relation_oid
        LEFT JOIN pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped
      ), '[]'::jsonb)
    END,
    3
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'enum_labels',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', n.nspname,
          'enum', t.typname,
          'label_order', e.enumsortorder,
          'label', e.enumlabel
        ) ORDER BY n.nspname, t.typname, e.enumsortorder)
        FROM pg_type AS t
        JOIN pg_namespace AS n ON n.oid = t.typnamespace
        JOIN pg_enum AS e ON e.enumtypid = t.oid
        WHERE (n.nspname = 'agricoop_app'
               AND t.typname IN ('user_role', 'user_approval_status', 'user_verification_status'))
           OR (n.nspname = 'public' AND t.typname IN ('user_role', 'user_approval_status'))
      ), '[]'::jsonb)
    END,
    4
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'constraints_and_indexes',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE jsonb_build_object(
        'constraints', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'schema', rel.schema_name,
            'table', rel.relation_name,
            'name', con.conname,
            'kind', con.contype,
            'definition', pg_get_constraintdef(con.oid, TRUE),
            'validated', con.convalidated,
            'deferrable', con.condeferrable,
            'initially_deferred', con.condeferred
          ) ORDER BY rel.schema_name, rel.relation_name, con.conname)
          FROM relation_oids AS rel
          JOIN pg_constraint AS con ON con.conrelid = rel.relation_oid
        ), '[]'::jsonb),
        'indexes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'schema', rel.schema_name,
            'table', rel.relation_name,
            'name', idx.relname,
            'primary', ix.indisprimary,
            'unique', ix.indisunique,
            'valid', ix.indisvalid,
            'definition', pg_get_indexdef(idx.oid)
          ) ORDER BY rel.schema_name, rel.relation_name, idx.relname)
          FROM relation_oids AS rel
          JOIN pg_index AS ix ON ix.indrelid = rel.relation_oid
          JOIN pg_class AS idx ON idx.oid = ix.indexrelid
        ), '[]'::jsonb)
      )
    END,
    5
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'policies',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', pol.schemaname,
          'table', pol.tablename,
          'name', pol.policyname,
          'permissive', pol.permissive,
          'roles', pol.roles,
          'command', pol.cmd,
          'using', pol.qual,
          'with_check', pol.with_check
        ) ORDER BY pol.schemaname, pol.tablename, pol.policyname)
        FROM pg_policies AS pol
        WHERE (pol.schemaname = 'agricoop_app'
               AND pol.tablename IN ('users', 'auditLogs', 'notifications', 'profileVerificationSubmissions'))
           OR (pol.schemaname = 'public' AND pol.tablename IN ('profiles', 'roles'))
           OR (pol.schemaname = 'storage' AND pol.tablename = 'objects')
      ), '[]'::jsonb)
    END,
    6
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'effective_grants',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE jsonb_build_object(
        'schema_privileges', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'schema', n.nspname,
            'role', r.rolname,
            'usage', has_schema_privilege(r.rolname, n.oid, 'USAGE'),
            'create', has_schema_privilege(r.rolname, n.oid, 'CREATE')
          ) ORDER BY n.nspname, r.rolname)
          FROM pg_namespace AS n
          CROSS JOIN pg_roles AS r
          WHERE n.nspname IN ('public', 'agricoop_app', 'auth', 'storage', 'supabase_migrations')
            AND r.rolname IN ('anon', 'authenticated', 'service_role', current_user, session_user)
        ), '[]'::jsonb),
        'table_privileges', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'schema', rel.schema_name,
            'table', rel.relation_name,
            'role', r.rolname,
            'select', has_table_privilege(r.rolname, rel.relation_oid, 'SELECT'),
            'insert', has_table_privilege(r.rolname, rel.relation_oid, 'INSERT'),
            'update', has_table_privilege(r.rolname, rel.relation_oid, 'UPDATE'),
            'delete', has_table_privilege(r.rolname, rel.relation_oid, 'DELETE'),
            'truncate', has_table_privilege(r.rolname, rel.relation_oid, 'TRUNCATE')
          ) ORDER BY rel.schema_name, rel.relation_name, r.rolname)
          FROM relation_oids AS rel
          JOIN pg_roles AS r
            ON r.rolname IN ('anon', 'authenticated', 'service_role', current_user, session_user)
          WHERE rel.relation_oid IS NOT NULL
            AND rel.relkind IN ('r', 'p', 'v', 'm', 'f')
        ), '[]'::jsonb),
        'column_grants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'schema', c.table_schema,
            'table', c.table_name,
            'column', c.column_name,
            'grantee', c.grantee,
            'privilege', c.privilege_type,
            'grantable', c.is_grantable
          ) ORDER BY c.table_schema, c.table_name, c.column_name, c.grantee, c.privilege_type)
          FROM information_schema.column_privileges AS c
          WHERE (c.table_schema = 'agricoop_app'
                 AND c.table_name IN ('users', 'auditLogs', 'notifications', 'profileVerificationSubmissions'))
            AND c.grantee IN ('anon', 'authenticated', 'service_role', current_user, session_user, 'PUBLIC')
        ), '[]'::jsonb),
        'sequences', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'schema', n.nspname,
            'sequence', s.relname,
            'owner', pg_get_userbyid(s.relowner),
            'role', r.rolname,
            'usage', has_sequence_privilege(r.rolname, s.oid, 'USAGE'),
            'select', has_sequence_privilege(r.rolname, s.oid, 'SELECT'),
            'update', has_sequence_privilege(r.rolname, s.oid, 'UPDATE')
          ) ORDER BY n.nspname, s.relname, r.rolname)
          FROM pg_class AS s
          JOIN pg_namespace AS n ON n.oid = s.relnamespace
          CROSS JOIN pg_roles AS r
          WHERE s.relkind = 'S'
            AND n.nspname IN ('agricoop_app', 'public')
            AND r.rolname IN ('anon', 'authenticated', 'service_role', current_user, session_user)
        ), '[]'::jsonb),
        'default_privileges', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'owner', owner_role.rolname,
            'schema', n.nspname,
            'object_kind', d.defaclobjtype,
            'grantor', grantor_role.rolname,
            'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          ) ORDER BY owner_role.rolname, n.nspname, d.defaclobjtype,
                     grantee_role.rolname, acl.privilege_type)
          FROM pg_default_acl AS d
          JOIN pg_roles AS owner_role ON owner_role.oid = d.defaclrole
          LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
          CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
          LEFT JOIN pg_roles AS grantor_role ON grantor_role.oid = acl.grantor
          LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
          WHERE n.nspname IS NULL
             OR n.nspname IN ('public', 'agricoop_app', 'auth', 'storage', 'supabase_migrations')
        ), '[]'::jsonb)
      )
    END,
    7
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'functions',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', fn.schema_name,
          'name', fn.function_name,
          'arguments', fn.identity_arguments,
          'owner', fn.owner_name,
          'language', fn.language,
          'security_definer', fn.is_security_definer,
          'settings_search_path', fn.function_settings,
          'acl', fn.function_acl,
          'definition', fn.definition
        ) ORDER BY fn.schema_name, fn.function_name, fn.identity_arguments)
        FROM relevant_functions AS fn
      ), '[]'::jsonb)
    END,
    8
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'role_membership_and_bypass',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE jsonb_build_object(
        'role_attributes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'role', r.rolname,
            'login', r.rolcanlogin,
            'superuser', r.rolsuper,
            'bypassrls', r.rolbypassrls,
            'inherits', r.rolinherit
          ) ORDER BY r.rolname)
          FROM pg_roles AS r
          WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres', current_user, session_user)
        ), '[]'::jsonb),
        'direct_memberships', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'member', member_role.rolname,
            'granted_role', granted_role.rolname,
            'admin_option', membership.admin_option
          ) ORDER BY member_role.rolname, granted_role.rolname)
          FROM pg_auth_members AS membership
          JOIN pg_roles AS member_role ON member_role.oid = membership.member
          JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
          WHERE member_role.rolname IN (current_user, session_user)
             OR granted_role.rolname IN (current_user, session_user)
        ), '[]'::jsonb),
        'membership_checks', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'role', candidate.rolname,
            'session_user_is_member', pg_has_role(session_user, candidate.oid, 'MEMBER'),
            'current_user_is_member', pg_has_role(current_user, candidate.oid, 'MEMBER')
          ) ORDER BY candidate.rolname)
          FROM pg_roles AS candidate
          WHERE candidate.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
        ), '[]'::jsonb)
      )
    END,
    9
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'triggers',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', rel.schema_name,
          'table', rel.relation_name,
          'name', trigger.tgname,
          'enabled_state', trigger.tgenabled,
          'definition', pg_get_triggerdef(trigger.oid, TRUE)
        ) ORDER BY rel.schema_name, rel.relation_name, trigger.tgname)
        FROM relation_oids AS rel
        JOIN pg_trigger AS trigger ON trigger.tgrelid = rel.relation_oid
        WHERE NOT trigger.tgisinternal
      ), '[]'::jsonb)
    END,
    10
  FROM project_gate AS gate

  UNION ALL

  SELECT
    'identity_document_bucket',
    CASE
      WHEN NOT gate.may_inspect THEN jsonb_build_object('status', 'BLOCKED_BY_PROJECT_GATE')
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'exists', TRUE,
          'bucket_name', b.name,
          'private', NOT b.public,
          'file_size_limit', b.file_size_limit,
          'allowed_mime_types', b.allowed_mime_types
        ) ORDER BY b.name)
        FROM storage.buckets AS b
        WHERE b.id = 'profile-verification-documents'
           OR b.name = 'profile-verification-documents'
      ), '[]'::jsonb)
    END,
    11
  FROM project_gate AS gate
)
SELECT
  section,
  details
FROM report
ORDER BY sort_order;
