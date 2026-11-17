# AgriCoop production performance

Live URL: https://agricoop-marketplace-final-capstone.vercel.app  
Branch: `finish/agricoop-complete`  
Measured from a Windows client (PH) with Lighthouse 12.6.1.

## Root causes (baseline)

1. **Region mismatch**: Vercel Functions were in `iad1` (US East) while Supabase is in `ap-southeast-1` (Singapore). Warm `/api/health` ~2.6s.
2. **~360KB HTML**: `vite-plugin-manus-runtime` inlined a huge debug runtime into production `index.html`.
3. **Large JS**: main vendor chunk ~850KB+ before splitting; Manus + unsplit deps inflated transfer.
4. **Broken public browse**: anon RLS lacked `EXECUTE` on `shares_cooperative` / `is_superadmin` / `is_staff` and column `SELECT` on `users`, so `marketplace.list` / `categories` returned HTTP 500 (extra retries / failed UX).
5. **Serverless pool**: `postgres` client `max: 10` was too high per isolate.

## Baseline — Lighthouse

| Page | Device | Perf | LCP | FCP | TBT | CLS | Transfer |
|------|--------|------|-----|-----|-----|-----|----------|
| `/` | mobile | **75** | 5.0s | 3.2s | 0ms | 0 | 927 KiB |
| `/` | desktop | **94** | 1.4s | 1.0s | 0ms | 0 | 927 KiB |
| `/marketplace` | mobile | **77** | 4.6s | 3.1s | 0ms | 0.04 | 575 KiB |
| `/marketplace` | desktop | **95** | 1.3s | 1.0s | 0ms | 0.002 | 575 KiB |
| `/products/1` | mobile | **87** | 3.2s | 3.2s | 0ms | 0 | 490 KiB |
| `/products/1` | desktop | **97** | 1.0s | 1.0s | 0ms | 0 | 490 KiB |
| `/auth` | mobile | **78** | 4.5s | 3.2s | 0ms | 0 | 554 KiB |
| `/auth` | desktop | **95** | 1.4s | 1.0s | 0ms | 0 | 554 KiB |

Raw JSON under `.local/lh-*-baseline.json` (local only, not committed).

## Baseline — API timings (5 samples each, production)

| Endpoint | p50 | worst | notes |
|----------|-----|-------|-------|
| `/api/health` | **2622ms** | 2752ms | DB round-trip US→SG |
| `marketplace.categories` | **2813ms** | 2900ms | **HTTP 500** (RLS grants) |
| `marketplace.list` | **2804ms** | 2882ms | **HTTP 500** (RLS grants) |
| `auth.me` | **310ms** | 313ms | 200 OK (no DB listing work) |

## Baseline — infrastructure

| Layer | Value |
|-------|-------|
| Vercel function region (before) | `iad1` |
| Supabase project region | `ap-southeast-1` |
| Mismatch | **Yes — ~180–250ms+ RTT plus cold start amplification** |
| Production `index.html` | ~360 KiB (Manus runtime inlined) |
| DB EXPLAIN (marketplace join) | ~0.26ms exec as owner; tiny tables; seq scan OK at current scale |
| Missing browse helpers for anon | `shares_cooperative`, `is_superadmin`, `is_staff` EXECUTE |

## Baseline — bundle (pre-fix build)

Largest concerns from production assets / prior `vite build`:

- Inlined Manus runtime inside `index.html` (~350KB+)
- Main app/vendor JS historically ~850KB gzipped poorly when unsplit
- Lazy routes already present in `App.tsx` (Dashboard/Reports/etc.)

## Fixes applied

See after section once redeployed. Summary of code/infra changes:

- Strip Manus/jsx-loc plugins from production Vite builds; manualChunks for react/data/supabase/charts/icons
- `vercel.json` `regions: ["sin1"]` + project `serverlessFunctionRegion: sin1`
- Cache-Control for hashed `/assets/*`, images, and short CDN cache for public marketplace tRPC GETs
- QueryClient `staleTime` 60s; marketplace query staleTimes; hero preload + font async; listing image width/height/lazy + Storage transform URLs
- `postgres` `max: 1`; marketplace select fewer columns + parallel image/reservation fetches
- Additive SQL: anon EXECUTE/SELECT grants, `reserved_quantities_for_products`, browse indexes (`20261117140000_…` + MANUAL_SQL BLOCK 9)

## After — Lighthouse

_To be filled after Production deploy._

## After — API timings

_To be filled after Production deploy._

## Before / after (summary)

_To be filled after Production deploy._
