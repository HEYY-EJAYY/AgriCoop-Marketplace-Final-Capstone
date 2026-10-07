# Definition of Done Gate Checklist — Slice 0 Baseline

**Status vocabulary:** PASS means the gate was run and evidence exists. FAIL means it was run and did not meet the requirement. NOT DONE means it was not run or the current implementation has not yet been proven to satisfy it.

| Gate | Status | Evidence / reason |
|---:|---|---|
| 1. Every route loads with no console errors or failed network requests. | NOT DONE | No complete route-by-route browser/console/network run was performed in Slice 0. Wouter routes are listed in `SPEC_DIFF.md`; no screenshot or browser log evidence exists. |
| 2. Every button, link, form, and filter performs a real action; no dead controls/placeholders on production paths. | NOT DONE | No complete interactive control audit was run. |
| 3. Complete real-database E2E flows for Buyer, Seller/Farmer, Admin Officer, and SuperAdmin. | NOT DONE | No Playwright or equivalent full role-flow run was performed. |
| 4. Business rules enforced server-side and by RLS. | NOT DONE | Current server rules have partial coverage, but no live Supabase Postgres/RLS integration test was run. Inventory timing and three-party conversation gaps are documented in `SPEC_DIFF.md`. |
| 5. Realtime chat updates in a second browser window without refresh. | NOT DONE | No two-window browser test was run; current implementation uses in-process SSE, not the specified Supabase Realtime. |
| 6. Forms have validation, errors, loading, disabled submission, success, and graceful failure states. | NOT DONE | No complete form-state audit was run. |
| 7. Lists/pages have designed empty, loading, and error states. | NOT DONE | No complete page-state audit was run. |
| 8. TypeScript, lint, test, and build pass with zero errors. | FAIL | `pnpm check` PASS, `pnpm test` PASS, `pnpm build` PASS with a chunk-size warning, but lint is not configured (`LINT_NOT_CONFIGURED`). Therefore the whole gate is not satisfied. See `TEST_REPORT.md`. |
| 9. Playwright E2E tests cover and pass all four role flows. | NOT DONE | No Playwright suite or run exists in the baseline. |
| 10. RLS tests prove product/order/product-edit/cooperative isolation. | NOT DONE | No live Postgres or RLS test was run. The target RLS artifact is not proof of runtime enforcement. |
| 11. Lighthouse scores meet accessibility/best-practice/performance/SEO thresholds. | NOT DONE | No Lighthouse run was performed. |
| 12. Accessibility requirements pass. | NOT DONE | No keyboard, focus, contrast, label, alt-text, landmark, or touch-target audit was run. |
| 13. Responsive layouts pass at 375×812, 768×1024, 1280×720, and 1920×1080. | NOT DONE | No complete screenshot matrix was generated in Slice 0. |
| 14. Low-bandwidth performance is measured and acceptable. | NOT DONE | No slow-3G run or load-time/bundle budget report was produced. The build did emit a 752.20 kB JavaScript chunk warning, recorded in `TEST_REPORT.md`. |
| 15. Security requirements pass. | NOT DONE | No complete secrets, verification, rate-limit, audit-log, and safe-upload verification was run. Manus/tracking remnants and spec gaps are documented in `MANUS_AUDIT.md` and `SPEC_DIFF.md`. |
| 16. Visual polish matches supplied tokens and accessible plain-language design. | NOT DONE | No comparison against the supplied mockup tokens/fonts and no complete visual review was run. |
| 17. Vercel preview with Supabase, environment-only configuration, isolated seed, and demo accounts. | NOT DONE | The current runtime is not the fully migrated Next.js/Supabase Postgres application; no qualifying Vercel preview/E2E evidence was produced. |

## Slice 0 verified baseline checks

The following are separate baseline facts, not claims that the 17 final gates pass:

- `pnpm check`: PASS, exit code 0.
- `pnpm test`: PASS, 6 test files and 12 tests passed.
- `pnpm build`: PASS, exit code 0, with a large-chunk warning.
- Lint: NOT CONFIGURED.
- Baseline Git tag: `v0-baseline` at commit `6e63370f1ce4915721bd4e13dfe165fb3c461c68`.

## Required next step

Wait for review approval before Slice 1. Slice 1 should port the schema to Supabase Postgres with `auth_user_id` links and an isolated non-production seed path, then rerun the relevant checks and update this package.
