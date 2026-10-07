# Baseline Test Report — Migration Slice 0

**Run date:** 2026-10-07 18:36 (Asia/Taipei)
**Commit:** `6e63370f1ce4915721bd4e13dfe165fb3c461c68`
**Tag:** `v0-baseline`

## `pnpm check`

Command:

```text
$ pnpm check
```

Raw output:

```text
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.patchedDependencies", "pnpm.overrides". See https://pnpm.io/settings for the new home of each setting.
> agricoop-marketplace@1.0.0 check /home/ubuntu/agricoop-marketplace
> tsc --noEmit
EXIT_CODE=0
```

**Result: PASS.**

## `pnpm test`

Command:

```text
$ pnpm test
```

Raw output:

```text
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.patchedDependencies", "pnpm.overrides". See https://pnpm.io/settings for the new home of each setting.
> agricoop-marketplace@1.0.0 test /home/ubuntu/agricoop-marketplace
> vitest run
 RUN  v2.1.9 /home/ubuntu/agricoop-marketplace
 ✓ server/auth.logout.test.ts (1)
 ✓ server/authz.test.ts (2)
 ✓ server/credentials.test.ts (1)
 ✓ server/marketplaceRules.test.ts (5)
 ✓ server/reportCsv.test.ts (2)
 ✓ server/serverCredentials.test.ts (1)
 Test Files  6 passed (6)
 Tests  12 passed (12)
 Start at  10:36:03
 Duration  1.12s (transform 378ms, setup 0ms, collect 1.17s, tests 27ms, environment 2ms, prepare 733ms)
EXIT_CODE=0
```

**Result: PASS.**

Actual counts: **6 test files, 12 tests, 12 passed, 0 failed, 0 skipped.**

## `pnpm build`

Command:

```text
$ pnpm build
```

Raw output:

```text
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.patchedDependencies", "pnpm.overrides". See https://pnpm.io/settings for the new home of each setting.
> agricoop-marketplace@1.0.0 build /home/ubuntu/agricoop-marketplace
> vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
vite v7.1.9 building for production...
✓ 1760 modules transformed.
../dist/public/index.html                 368.25 kB │ gzip: 105.74 kB
../dist/public/assets/index-lKLmot9O.css   99.58 kB │ gzip:  17.49 kB
../dist/public/assets/index-Cq8ZCWVe.js   752.20 kB │ gzip: 208.04 kB
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Using build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit to change this warning.
✓ built in 4.84s
  dist/index.js  50.2kb
⚡ Done in 7ms
EXIT_CODE=0
```

**Result: PASS with a performance warning.** The main JavaScript chunk is 752.20 kB uncompressed / 208.04 kB gzip.

## Lint

The command was checked through `package.json`:

```text
lint_script=MISSING
LINT_NOT_CONFIGURED
```

**Result: NOT DONE.** There is no `lint` script and no lint command was run.

## Commands not run in Slice 0

The following were not run and are therefore **NOT DONE**, not passes:

- Playwright end-to-end tests;
- Supabase Postgres/RLS integration tests;
- Lighthouse audits;
- mobile/desktop screenshot matrix;
- slow-3G/load-time test;
- clean-clone install/build/test run;
- Vercel preview validation against the fully migrated business runtime.
