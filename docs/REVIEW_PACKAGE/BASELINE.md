# AgriCoop Migration Slice 0 — Baseline

**Date:** 2026-10-07 18:36 (Asia/Taipei)
**Repository:** `/home/ubuntu/agricoop-marketplace`
**Baseline tag:** `v0-baseline`
**Baseline commit:** `6e63370f1ce4915721bd4e13dfe165fb3c461c68`
**Commit subject:** Checkpoint: Restored after sandbox reset and re-applied the four-role Buyer/Seller/Admin/SuperAdmin model, approved-visible product gating, Seller submission controls, Admin moderation queue, F2F-only checkout policy, authenticated Buyer/Seller SSE support conversations, safe role/product migration, updated defense-demo seed data, deterministic credential tests, Supabase RLS target artifact, and README/environment handoff documentation.

## Scope respected

Slice 0 did not modify application source, schema, migrations, package dependencies, or runtime behavior. It only:

- created the annotated Git tag `v0-baseline` at the current HEAD;
- ran the requested baseline commands;
- audited the repository against the migration specification; and
- added this review package under `docs/REVIEW_PACKAGE/`.

The working tree already contained pre-existing changes before Slice 0 began, including auth/runtime edits and `docs/generated/`. Those changes were not altered by this slice.

## Baseline command results

| Command | Result | Evidence |
|---|---:|---|
| `pnpm check` | PASS | `TEST_REPORT.md`; exit code 0 |
| `pnpm test` | PASS | `TEST_REPORT.md`; 6 test files, 12 tests, all passed |
| `pnpm build` | PASS with warning | `TEST_REPORT.md`; exit code 0; Vite emitted a chunk-size warning |
| `pnpm lint` | NOT DONE | No `lint` script exists in `package.json` |

## Actual test inventory

- **Test files:** 6
- **Tests:** 12
- **Passed:** 12
- **Failed:** 0
- **Skipped:** 0

Files:

1. `server/auth.logout.test.ts`
2. `server/authz.test.ts`
3. `server/credentials.test.ts`
4. `server/marketplaceRules.test.ts`
5. `server/reportCsv.test.ts`
6. `server/serverCredentials.test.ts`

## Baseline build note

The build succeeds, but Vite reports a JavaScript chunk larger than 500 kB after minification:

- `dist/public/assets/index-Cq8ZCWVe.js`: 752.20 kB uncompressed, 208.04 kB gzip
- Suggested follow-up: route-level code splitting and manual chunking.

## GitHub push status

No push was performed. The GitHub repository URL has not yet been provided. Before any push, provide:

- the destination repository URL;
- the intended branch, if not `main`; and
- whether the existing remote should be preserved or replaced.
