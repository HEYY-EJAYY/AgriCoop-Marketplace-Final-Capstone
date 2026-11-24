# Agent notes

## Workflow preferences

- After committing and pushing a fix to `finish/agricoop-complete`, deploy it to
  production immediately (user instruction: "always deploy when creating a fix").
- Deploy via Vercel: create a production deployment pinned to the exact commit
  SHA (`create_deployment` with `gitSource` github org/repo/ref/sha and
  `target: "production"`), wait for READY, verify the
  `agricoop-marketplace-final-capstone.vercel.app` alias, and smoke-test key
  routes. Project: `prj_LCxJgY2qeXdRNBgOnTeXvJbgXXDI`, team
  `team_LtSA5AC82wgxRFMGAzHCHIWR`.
- Local and production share the same Supabase DB — never run destructive
  tests, resets, or seeds against it.

## Verification

- `pnpm check` (tsc), `pnpm test` (vitest), `pnpm build` before committing.
- Playwright e2e specs are credential-gated via `QA8_*` env vars and skip
  without them.
