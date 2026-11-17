# Staging-only read-only database preflight

## Status

The repository documents a staging verification procedure, but no isolated staging project or staging credentials/configuration have been confirmed. No Supabase project was contacted for this procedure.

[`supabase/PRODUCTION_CATALOG_PREFLIGHT.sql`](../supabase/PRODUCTION_CATALOG_PREFLIGHT.sql) is a read-only catalog inventory, but it is not staging-only: it has no explicit project identity gate and does not report migration history, the profile-verification bucket, its relevant Storage policies, or effective role memberships. Do not treat it as a safe staging-target guard.

The new [`supabase/staging/profile_verification_read_only_preflight.sql`](../supabase/staging/profile_verification_read_only_preflight.sql) is one read-only `WITH ... SELECT` statement. It inspects only system catalogs, the Supabase migration-history catalog, bucket metadata, and Storage policy definitions. It does not read application table rows, environment settings, Auth identities, or Storage objects. It contains no migration DDL or data-changing statements.

## Project-identity limitation

Supabase SQL Editor does not provide a documented, trustworthy SQL setting for the current project ref. The script therefore **does not claim to identify its database independently**. Before opening SQL Editor, the operator must verify the selected project in the Supabase Dashboard and provide three explicit refs in the script:

- The expected staging project ref.
- The project ref shown in the currently selected Dashboard project.
- The known production project ref.

The report gate passes only when the Dashboard-confirmed ref matches the expected staging ref, the ref values are valid project-ref formats, the operator marks the Dashboard check complete, and the staging ref differs from the known production ref. It does not echo the refs. This guard fails closed on untouched placeholders. It is an operator-verified guard, not a cryptographic database identity assertion; never infer staging from the hostname.

## Manual procedure

1. In Supabase Dashboard, select the intended isolated staging project. Open its project settings/general information and independently confirm its project name and project ref. Compare them with the owner-maintained production project ref and verify that the two refs differ. Do not use a hostname or connection string as the sole evidence.
2. Keep the Dashboard open on that staging project. Open SQL Editor from that same project and confirm the project selector still identifies staging.
3. Open `supabase/staging/profile_verification_read_only_preflight.sql` locally. Replace its three project-ref placeholders with the values just verified and change `FALSE::boolean` to `TRUE::boolean`. Do not add credentials or URLs.
4. Read the script before running it. It must remain a single `WITH ... SELECT` statement. Run it in the staging SQL Editor only.
5. Inspect the first `project_gate` result. Proceed with the report only if its status is `PASS`. On `STOP`, a missing version column, a query error, or any mismatch, stop and do not run migrations. The other report sections are marked blocked when the gate fails.
6. Review the sections for target migration versions, relation/column definitions, enum labels, constraints/indexes, RLS flags/policies, effective/schema/column/sequence grants, functions and their definitions/owners/security settings, role memberships/BYPASSRLS, triggers, bucket settings, and all `storage.objects` policies (including generic policies that may affect this bucket).
7. Compare the output with both migration preconditions and the expected private-bucket configuration. The report is inspection evidence only; it neither approves nor applies either migration or the bucket setup script.
8. Do not paste credentials, user data, Auth UUIDs, database URLs, or secrets into the SQL Editor or the report. The query intentionally does not select application rows, migration SQL bodies, or Storage objects. Function and policy definitions are included because they are required for review; inspect them locally and redact any unexpected sensitive literal before sharing the report.
9. Close SQL Editor without running any migration or setup SQL. Keep the sanitized report with the staging review record.

The preflight is designed for PostgreSQL catalogs as exposed by Supabase. If expected catalog relations or columns are absent, it may report a missing object or stop with an error; do not modify the script to bypass a failed check. Reconcile the exact staging catalog manually before deciding whether either migration is compatible.

## Remaining prerequisites

- An isolated staging Supabase project must be created/selected by the project owner; this task did not create one or verify that one exists.
- The operator must know both the staging and production project refs from the Dashboard/owner records.
- `20261117100000_auth_profile_access.sql`, `20261117120000_profile_verification_submissions.sql`, and `supabase/storage/profile_verification_bucket.sql` remain unexecuted drafts.
- The preflight does not test the application's request transaction, `auth.uid()`, actual login role switching, or signed Storage URL behavior. Those require a separate authorized application-context test after catalog review.
