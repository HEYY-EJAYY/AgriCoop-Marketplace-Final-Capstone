# Production SQL release plan

## Status and release gate

**Preparation only. No production SQL, migration, record change, Vercel setting, deployment, commit, or push is authorized or performed by this document.** The current production catalog is not remediated by local changes. Do not treat this plan as approval to execute.

The sequence below targets only the existing AgriCoop Supabase project. It does not create a project, replay the whole local migration directory, or drop/replace production data. Take a verified backup/PITR point and repeat the read-only catalog preflight immediately before any separately approved release.

The prior [`PRODUCTION_MIGRATION_RUNBOOK.md`](./PRODUCTION_MIGRATION_RUNBOOK.md) and [`PRODUCTION_DATABASE_MIGRATION.md`](./PRODUCTION_DATABASE_MIGRATION.md) contain historical assumptions that no longer match the inspected production catalog. This file is the current preparation record; the historical documents are not execution instructions.

## Production migration-history reconciliation

A read-only migration-history listing returned 25 rows, ending at `20261118071553`. The repeated names are real history rows, not permission to replay local files:

| Production version | Recorded name | Local source relationship |
|---|---|---|
| `20261016115411` | `enable_roles_rls_deny_api` | Related to `20261117100000_auth_profile_access.sql`; filename/version differ. |
| `20261016120149` | `create_agricoop_postgres_schema` | Related to `20261117105000_active_application_tables.sql`; filename/version differ. |
| `20261117120804` | `ux_inbox_and_indexes` | Same recorded name as the next row; local candidate is `20261117180000_ux_inbox_and_indexes.sql`. |
| `20261117120834` | `ux_inbox_and_indexes` | Duplicate recorded name/version row; do not replay based on name alone. |
| `20261117130342` | `avatars_and_profile_image_grants` | Related filename: `20261117200000_avatars_and_profile_image_grants.sql`. |
| `20261117134139` | `payment_fulfillment_coop_orders` | Related filename: `20261117210000_payment_fulfillment_coop_orders.sql`. |
| `20261117140340` | `payment_fulfillment_column_grants` | Related filename: `20261117211000_payment_fulfillment_column_grants.sql`. |
| `20261117155630` | `write_grants_and_profile_role_sync` | Related filename: `20261117220000_write_grants_and_profile_role_sync.sql`. |
| `20261118022327` | `system_payment_admin_only` | Related filename: `20261118022138_system_payment_admin_only.sql`. |
| `20261118031618` | `login_lookup_no_payment_columns` | Related filename: `20261118041000_login_lookup_no_payment_columns.sql`. |
| `20261118033253` | `registration_insert_column_contract` | Related filename: `20261118043000_registration_insert_column_contract.sql`. |
| `20261118043419` | `part2_registration_applications_order_archive` | Related filename: `20261118120000_part2_registration_applications_order_archive.sql`; repeated below. |
| `20261118043423` | `buyer_order_archive_channel` | Related filename: `20261118121000_buyer_order_archive_channel.sql`; repeated below. |
| `20261118043642` | `part2_registration_applications_order_archive` | Duplicate recorded name; do not replay the local file based on name alone. |
| `20261118043659` | `part2_notification_allowlist_coop_admin_apps` | No exact local filename; reconcile the deployed function/policy effects separately. |
| `20261118043701` | `buyer_order_archive_channel` | Duplicate recorded name; do not replay the local file based on name alone. |
| `20261118052138` | `part2_insert_grants_apps_and_products` | Related filename: `20261118130000_part2_insert_grants_apps_and_products.sql`. |
| `20261118053344` | `registration_cooperative_assign_guard` | Related filename: `20261118140000_registration_cooperative_assign_guard.sql`. |
| `20261118054212` | `registration_coop_assign_guard_fallthrough` | Related filename: `20261118141000_registration_coop_assign_guard_fallthrough.sql`. |
| `20261118055501` | `cooperative_address_soft_delete_duplicates` | Related filename: `20261118150000_cooperative_address_soft_delete_duplicates.sql`. |
| `20261118060859` | `product_listing_soft_delete` | Related filename: `20261118160000_product_listing_soft_delete.sql`. |
| `20261118063635` | `product_soft_delete_deleted_by_guard` | Related filename: `20261118170000_product_soft_delete_deleted_by_guard.sql`. |
| `20261118064951` | `buyer_server_cart_items` | Related filename: `20261118180000_buyer_server_cart_items.sql`. |
| `20261118070918` | `user_soft_delete_columns` | Related filename: `20261118190000_user_soft_delete_columns.sql`. |
| `20261118071553` | `products_update_owner_or_staff` | Related filename: `20261118200000_products_update_owner_or_staff.sql`; this is the last recorded production row. |

These are name-based crosswalks, not checksum or SQL-body equivalence proofs. In particular, the local earlier migrations below have no exact production `(version, name)` pair and must not be replayed as a batch:

| Local file without an exact history pair | Current disposition |
|---|---|
| `20261117100000_auth_profile_access.sql` | Related production history exists under a different version/name; compare live policies and grants before deciding whether any portion is needed. |
| `20261117105000_active_application_tables.sql` | Related production history exists under a different version/name; production currently has the application tables, so do not recreate them. |
| `20261117110000_transaction_payment_option.sql` | No exact history row; confirm the column, FK, and index individually before any decision. |
| `20261117120000_profile_verification_submissions.sql` | No exact history row; the table and related production policy artifacts were present in the catalog, but file equivalence is unverified. |
| `20261117130000_app_security_helpers.sql` | No exact history row; helper names exist in production, but definitions and ACLs differ from current local requirements. |
| `20261117131000_marketplace_rls_grants.sql` | No exact history row; production has marketplace policies, but current grants/policy definitions are not equivalent by name alone. |
| `20261117132000_secure_audit_notification_writes.sql` | No exact history row; production has writer functions, but the live writer lacks the new server-only marker. |
| `20261117133000_payment_proofs_id_default.sql` | No exact history row; verify the live column default before considering it reflected. |
| `20261117140000_anon_marketplace_browse_perf.sql` | No exact history row; `reserved_quantities_for_products` exists, but do not replay without matching definition and ACL checks. |
| `20261117150000_orders_demo_seed_key.sql` | No exact history row; verify whether the seed-only column/index exists and whether any existing values conflict. |

The 19 later local files present during the prior comparison included eight Block 30–37 security/archive candidates with no matching production history, plus files whose version/name differs from production history. This workspace now also has Blocks 38–39. The sequence below is limited to the ten current local candidate files after the known production baseline. A missing history row is not evidence that an effect is absent; the migration preflights and a fresh catalog comparison are mandatory.

## Ordered candidate release sequence

Run each referenced SQL file as a separate, reviewed migration, in order. The files include their own transaction boundaries and pre/postflight checks. Do not concatenate them or record all files as a single migration. Stop on any failed preflight/postflight.

| Order | Local migration | Prerequisites and preflight | Effect / data impact | Rollback limitation |
|---:|---|---|---|---|
| 1 | [`20261118210000_thread_state_dedicated_archive_channels.sql`](../supabase/migrations/20261118210000_thread_state_dedicated_archive_channels.sql) | `agricoop_app."threadStates"` and `thread_states_channel_check` must exist; preserve the exact existing predicate. | Extends the check to allow `seller_order` and `quotation`; no rows are rewritten. | Restore the previous predicate only if no rows use either new value; otherwise rollback requires a reviewed data migration. |
| 2 | [`20261118220000_cooperative_association_listing_move.sql`](../supabase/migrations/20261118220000_cooperative_association_listing_move.sql) | Users, products, association requests and protected-user trigger/registration exception must exist; request fields and seller/cooperative/product columns must match the preflight. | Adds `moveExistingListings` defaulting false, narrows authenticated insert columns, revokes direct UPDATE, and installs the scoped approval/listing-move function in one transaction. Existing rows receive the default; approval later updates the selected Seller and optionally their listings. | Dropping the new column can lose review choices; restoring direct UPDATE reopens the confirmed bypass. Roll back only with a reviewed forward fix. |
| 3 | [`20261118230000_user_soft_delete_actor_guard.sql`](../supabase/migrations/20261118230000_user_soft_delete_actor_guard.sql) | Tombstone columns from `20261118190000_user_soft_delete_columns.sql`, RLS, and current identity/role/cooperative helpers must be present. | Adds the trigger enforcing trusted Admin/SuperAdmin tombstone attribution and scoped delete/restore. No rows are changed. | Removing the trigger re-enables self-delete, self-restore, or forged attribution; do not use as an operational rollback. |
| 4 | [`20261118231000_cooperative_association_request_guard.sql`](../supabase/migrations/20261118231000_cooperative_association_request_guard.sql) | Order 2’s `moveExistingListings`, all request review fields, users/cooperatives, actor helpers, and the one-pending-per-Seller unique index must exist. | Validates new requests at insert time; no existing rows are changed. | Removing the trigger permits malformed/forged requests; prefer a forward correction. |
| 5 | [`20261118240000_cooperative_admin_scope.sql`](../supabase/migrations/20261118240000_cooperative_admin_scope.sql) | `shares_cooperative(integer)`, cooperative table, active/deleted columns, and RLS must exist. | Limits cooperative reads to active cooperatives and staff writes to the assigned cooperative. No rows are changed. | Reverting the policies may reintroduce cross-cooperative writes; validate all Admin workflows before any rollback. |
| 6 | [`20261118250000_cooperative_association_review_security.sql`](../supabase/migrations/20261118250000_cooperative_association_review_security.sql) | Order 2 approval function, actor/cooperative helpers, all review columns, and request RLS must exist. | Installs scoped rejection and repeats the direct-UPDATE revoke; no rows are changed. Order 2 already revokes direct UPDATE before exposing approval, so no intermediate state grants direct review updates. | Dropping rejection and restoring UPDATE would reopen forged review fields. Keep direct UPDATE revoked. |
| 7 | [`20261118260000_authz_helper_hardening.sql`](../supabase/migrations/20261118260000_authz_helper_hardening.sql) | Users/profile/roles tables, tombstone/approval/cooperative columns, `auth.uid()`, role-sync and staff helpers must exist. | Makes deleted identities unresolved, gates staff role resolution on approval, and scopes role sync/profile visibility/review helpers. No rows are changed. | Restoring old helper bodies revives deleted-account and inactive-staff access; do not roll back by restoring old definitions. |
| 8 | [`20261118270000_anon_deleted_seller_browse.sql`](../supabase/migrations/20261118270000_anon_deleted_seller_browse.sql) | Users RLS and the required public/private user columns must exist; only intended public columns may be granted to `anon`. | Adds `deletedAt` as a filter-only column grant and excludes deleted sellers; no rows are changed. | Reverting the policy/grant may expose deleted sellers. |
| 9 | [`20261118280000_public_legacy_rls_hardening.sql`](../supabase/migrations/20261118280000_public_legacy_rls_hardening.sql) | `public.activity_logs`, `public.inventory`, `public.products`, expected columns, `public.get_my_role()`, and RLS must match the preflight. No other unexplained permissive inventory SELECT or activity-log INSERT policy may remain. | Revokes client legacy audit inserts and replaces unscoped inventory reads with visible-product/owner/staff scope. No rows are changed. Current application audit writes use `agricoop_app."auditLogs"`; no active source reference to legacy `public.activity_logs` was found. | Reverting restores forged legacy log inserts or broad stock visibility; legacy consumers must be identified before release. |
| — | **Deploy the compatible application revision** | Requires separate explicit deployment approval. Deploy after Orders 1–9 so its association RPCs and transaction-local audit marker are available. | The updated server sets `agricoop.server_audit_write` only in its audit-writer statement. Until Order 10, the prior DB writer remains compatible. | Use the preserved Vercel rollback target only as an application rollback; schema compatibility with that older revision is not yet demonstrated. |
| 10 | [`20261118290000_server_only_audit_writer.sql`](../supabase/migrations/20261118290000_server_only_audit_writer.sql) | Order 9, audit table and actor helpers, and the updated application revision must be present. Confirm the application release is live before this writer change. | Requires the server transaction-local marker for SECURITY DEFINER audit writes. No rows are changed; existing audit logging remains through the app writer. | Reverting removes the direct-call barrier. Rolling the application back to code that does not set the marker will break its audit writes; do not roll back independently. |

### Post-migration verification

After each file, require its in-file postflight to pass. After the sequence, rerun the read-only [`PRODUCTION_CATALOG_INSPECTION.sql`](../supabase/PRODUCTION_CATALOG_INSPECTION.sql) and verify:

- Authenticated has no UPDATE privilege on any `cooperativeAssociationRequests` column; the approval/rejection functions are executable only by authenticated users and enforce cooperative scope.
- New request inserts cannot set review fields; tombstone fields are protected by the actor guard.
- Deleted users resolve to no application identity or staff role; inactive staff cannot use review or role-sync helpers.
- Anonymous seller queries can read only the required public columns and cannot return soft-deleted sellers.
- Anonymous and authenticated cannot insert forged `public.activity_logs` rows, and inventory policies contain only the expected product visibility rule.
- The audit writer rejects a direct authenticated RPC call without the marker and accepts the compatible server path. Confirm this on an isolated database before any production execution.
- Storage buckets and Storage object policies remain unchanged; this SQL sequence does not alter Storage.

## Exposure, environment, and release blockers

- The repository has no `supabase/config.toml` or `PGRST_DB_SCHEMAS` setting. Production's PostgREST exposed-schema setting therefore remains unverified. Before release, inspect the existing project's API settings and keep `agricoop_app` unexposed unless there is a specific reviewed requirement; do not infer exposure from schema existence.
- Preview must not use a production-scoped `SUPABASE_SERVICE_ROLE_KEY` or production `SUPABASE_URL`. The previous Vercel variable inventory also found Preview lacks `DATABASE_URL`. Do not add production database/service credentials to Preview; use an isolated backend for authenticated Preview, or keep it frontend-only and ensure server routes fail closed. No Vercel settings were changed.
- Production still has the reported association direct-update, tombstone attribution, deleted identity, inactive-staff, legacy audit insert, and broad inventory-policy issues until separately approved SQL is applied and verified.
- The existing rollback deployment is `dpl_3aQhfyBhAtYxc3WUbtyzhjf57Hkp` (source SHA `47cbe65096c4da5762555b92654ed3983e73dbaf`). It remains a Vercel rollback target, but compatibility with the secured database schema and Order 10 is unverified. A production-ready rollback requires a compatibility check or a separately tested forward-fix revision.
- No SQL statement in this document is approved to execute. The complete candidate SQL is in the linked migration files; each requires separate review and explicit production authorization.
