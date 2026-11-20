# RLS Policy Matrix

Prepared policies live in `supabase/migrations/20261117131000_marketplace_rls_grants.sql` and
`20261117132000_secure_audit_notification_writes.sql`. Application authz in `server/authz.ts` remains mandatory.

## Helpers (SECURITY DEFINER, `search_path = ''`)

| Function | Purpose | EXECUTE |
|---|---|---|
| `agricoop_app.current_app_user_id()` | Auth UUID → app user id | anon, authenticated |
| `agricoop_app.current_app_role()` | App role text | authenticated |
| `agricoop_app.current_app_cooperative_id()` | Actor coop | authenticated |
| `agricoop_app.is_staff()` / `is_superadmin()` / `shares_cooperative(id)` | Scope checks | authenticated |
| `agricoop_app.write_audit_log(...)` | Append-only audit | authenticated (pins actor) |
| `agricoop_app.create_notification(...)` | Cross-user notify with type/relationship checks | authenticated |
| `agricoop_app.guard_users_protected_columns()` | Trigger: block self role/approval/coop changes | trigger only |

## Table matrix

| Table | anon | buyer | seller | admin (coop) | superadmin | Notes |
|---|---|---|---|---|---|---|
| cooperatives | SELECT active | SELECT active | SELECT active | SELECT (+inactive via staff) | ALL | Create/update SA only |
| users | SELECT id/name for approved sellers | self + public sellers | self + public sellers | self + coop peers | all | Protected cols + trigger |
| products | approved+visible+published | same | own + public | coop scope | all | |
| productImages | via product visibility | same | own product write | read coop | all | |
| quotations | — | own R/W decide | own respond | — | read | |
| orders | — | own R + pay update | own + confirm/ready | coop complete/cancel | all | App enforces transitions |
| orderItems / orderEvents / transactions | — | via order | via order | via order | all | |
| paymentOptions | — | active checkout read | active read | coop manage | all | Account numbers only on authorized checkout/admin paths |
| paymentProofs | — | own insert/select | — | review non-participants | review | Partial unique pending/verified |
| payments / paymentEvents | — | own read | own read | coop manage | all | Created by app with order (Phase 4) |
| conversations / messages | — | participant | participant | seller's coop | all | |
| cooperativeAssociationRequests | — | — | own request | coop review | all | |
| notifications | — | own R + mark-read | own | own | own | INSERT only via definer fn |
| supportTickets / messages | — | own R + reply/reopen (`…20261202000000`) | own R + reply/reopen | coop R/W | all | Owner UPDATE added for reply flow |
| auditLogs | — | — | — | SELECT coop | SELECT all | INSERT via definer/trigger only |
| profileVerificationSubmissions | — | own | own | review coop | all | Policies from draft `…120000` |

## Rationale

1. **Defense in depth:** RLS correct whether login role can `SET ROLE` or not; tRPC still authorizes.
2. **No `GRANT ALL`:** column/table privileges match actual router operations.
3. **Cross-user notifications** cannot use self-insert RLS; definer function validates type + relationship.
4. **Audit append-only:** no UPDATE/DELETE grants; actor pinned inside `write_audit_log`.
5. **Anon browse** limited to approved visible products + active cooperatives + public seller names.
