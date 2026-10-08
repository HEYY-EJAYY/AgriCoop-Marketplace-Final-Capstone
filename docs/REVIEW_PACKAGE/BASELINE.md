# AgriCoop Migration Slice 0 — Baseline

**Date:** 2026-10-07 18:36 (Asia/Taipei)
**Repository:** `/home/ubuntu/agricoop-marketplace`
**Pre-work baseline tag:** `v0-baseline-pre-wip`
**Pre-work baseline commit:** `6e63370f1ce4915721bd4e13dfe165fb3c461c68`
**Part A baseline tag:** `v0-baseline` (created after the Part A documentation commit)
**Part A baseline commit:** see `git rev-parse v0-baseline^{}`; the verified final hash is reported with this handoff
**Commit subject:** Checkpoint: Restored after sandbox reset and re-applied the four-role Buyer/Seller/Admin/SuperAdmin model, approved-visible product gating, Seller submission controls, Admin moderation queue, F2F-only checkout policy, authenticated Buyer/Seller SSE support conversations, safe role/product migration, updated defense-demo seed data, deterministic credential tests, Supabase RLS target artifact, and README/environment handoff documentation.

## Scope respected

Slice 0 and Part A did not modify application source, schema, migrations, package dependencies, or runtime behavior. They only:

- preserved the original annotated baseline as `v0-baseline-pre-wip`;
- recorded the already-present application/runtime checkpoint state without changing behavior;
- ran the requested baseline commands;
- audited the repository against the migration specification; and
- added and updated this review package under `docs/REVIEW_PACKAGE/`.

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

## Package-manager configuration finding

`package.json` contains `pnpm.patchedDependencies` for the Wouter patch and `pnpm.overrides` for the Tailwind/Nanoid override. The installed pnpm 10.4.1 emitted this warning during checks and audit:

```text
The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.patchedDependencies", "pnpm.overrides".
```

The lockfile still contains the corresponding `overrides` and `patchedDependencies` sections, but future pnpm configuration belongs in `pnpm-workspace.yaml` (or another supported settings location). These entries were not removed in Part A because the brief explicitly says not to remove them yet.

## Repository metadata decision

- `.project-config.json`: **NO**, not tracked (`git ls-files .project-config.json` returned no output); it is ignored by `.gitignore`.
- `.manus-logs/`: **NO**, not tracked (`git ls-files .manus-logs` returned no output); log files are ignored by the repository patterns.

## GitHub push status

The requested destination is `https://github.com/HEYY-EJAYY/AgriCoop-Marketplace-Final-Capstone`. No push was performed because the secure GitHub connector is disabled in this session and no GitHub token was supplied. The existing `origin` remains the Manus artifact remote; it was not replaced and no remote content was overwritten.

Before a secure push, enable/connect the GitHub connector and confirm the target branch (default assumption: `main`).
