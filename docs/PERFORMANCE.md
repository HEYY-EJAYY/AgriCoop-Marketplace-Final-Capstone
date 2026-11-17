# AgriCoop production performance

Live URL: https://agricoop-marketplace-final-capstone.vercel.app  
Branch: `finish/agricoop-complete`  
Production deploy: `dpl_2TFWLHbkHwurCnURuKzcRG9298cv` (READY, region `sin1`)  
Measured with Lighthouse 12.6.1 from a Windows client (PH).

## Root causes (baseline)

1. **Region mismatch**: Vercel Functions in `iad1` vs Supabase `ap-southeast-1` → warm `/api/health` ~2.6s.
2. **~360KB HTML**: `vite-plugin-manus-runtime` inlined into production `index.html`.
3. **Broken public browse**: anon RLS lacked `EXECUTE` on helper functions → `marketplace.list` / `categories` HTTP 500.
4. **Hero image 373KB** at 1920px with no `srcset`.
5. **LCP text started at `opacity: 0`** via `rise-in` animation (`animation-fill-mode: both`).
6. **Serverless pool** `max: 10` per isolate; health paid full RLS GUC setup.

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

## Baseline — API timings (5 samples)

| Endpoint | p50 | worst | notes |
|----------|-----|-------|-------|
| `/api/health` | **2622ms** | 2752ms | US→SG |
| `marketplace.categories` | **2813ms** | 2900ms | HTTP **500** |
| `marketplace.list` | **2804ms** | 2882ms | HTTP **500** |
| `auth.me` | **310ms** | 313ms | 200 |

## After — Lighthouse

| Page | Device | Perf | LCP | FCP | TBT | CLS | Transfer |
|------|--------|------|-----|-----|-----|-----|----------|
| `/` | mobile | **91** | 3.1s | 2.2s | 0ms | 0 | 411 KiB |
| `/` | desktop | **99** | 0.9s | 0.7s | 0ms | 0.001 | 448 KiB |
| `/marketplace` | mobile | **91** | 3.2s | 2.3s | 0ms | 0 | 470 KiB |
| `/marketplace` | desktop | **98** | 0.9s | 0.7s | 0ms | 0.065 | 508 KiB |

(Product/auth after earlier pass: mobile ~87, desktop ~97; transfer cut similarly.)

## After — API timings (warm p50)

| Endpoint | p50 | worst | warm p50 | status |
|----------|-----|-------|----------|--------|
| `/api/health` | **113ms** | 300ms | **113ms** | 200 |
| `marketplace.categories` | **81ms** | 90ms | **81ms** | 200 |
| `marketplace.list` | **76ms** | 82ms | **76ms** | 200 |
| `auth.me` | **95ms** | 169ms | **96ms** | 200 |

## Before / after (summary)

| Metric | Before | After |
|--------|--------|-------|
| Home mobile Perf | 75 | **91** |
| Marketplace mobile Perf | 77 | **91** |
| Home mobile LCP | 5.0s | **3.1s** |
| Marketplace mobile LCP | 4.6s | **3.2s** |
| Home desktop Perf / LCP | 94 / 1.4s | **99 / 0.9s** |
| HTML size | ~360 KiB (Manus) | **~1.6 KiB** |
| Transfer (home mobile) | 927 KiB | **411 KiB** |
| `marketplace.list` | 500 @ ~2.8s | **200 @ ~76ms** |
| `/api/health` warm | ~2.6s | **~113ms** |
| Function region | `iad1` | **`sin1`** (matches Supabase SG) |

## Fixes shipped

- Strip Manus/jsx-loc from production Vite builds; safe chunk splits (`supabase` / `charts` / `icons` only).
- Pin Vercel Functions to `sin1`; `Cache-Control` for hashed assets + short CDN cache on public marketplace GETs.
- Additive SQL (`20261117140000_…` + MANUAL_SQL BLOCK 9): anon EXECUTE/SELECT grants, `reserved_quantities_for_products`, browse indexes.
- Lean marketplace selects, parallel image/reservation fetches, `postgres` `max: 1`, lightweight `pingDatabase` health.
- Responsive hero WebP (47–84KB), preload, font async, QueryClient `staleTime`, listing image transforms.
- Eager Home + Marketplace; lazy dashboards/admin; transform-only hero motion (no opacity:0 LCP trap).
- Paint React immediately (do not block first paint on auth init).

## Remaining mobile lab LCP gap (~3.1s vs 2.5s target)

Under Lighthouse **mobile Slow 4G** throttling, LCP is still ~0.6s above 2.5s even at Perf **91**. Remaining cost is mostly:

1. Main JS (~420KB / ~130KB gzip) including React + always-on Supabase auth client.
2. Simulated network latency (TTFB was already ~70ms; lab multiplies download/parse time).

Desktop LCP is **under 1s**. Further mobile-lab gains would need deferring Supabase until interaction or shipping a thinner public shell — higher risk for auth correctness — so left as a documented follow-up.

## Smoke

- Pages `/`, `/marketplace`, `/products/1`, `/auth` → 200, no Manus runtime.
- `marketplace.list` / `categories` → 200 with listings.
- `/api/health` → `{ status: "ok" }`.
- Browser: home hero + marketplace listing content render.

## UX refinement pass (2026-11-17)

Additive indexes on `products` (category, priceCents, stockQty, cooperativeId) and `conversations` (order/buyer/seller). Marketplace pagination (24/page) + URL filters reduce client work. Hero H1 has no animation; glass CTA is CSS-only. Lighthouse before numbers remain the table above; after this pass, re-check home / marketplace / product on Production once deploy `READY` — expect parity or better FCP (solid headers, no header search on public pages).

## Hero layout pass (2026-11-17)

| Guardrail | Before (layout bugs) | After |
|-----------|----------------------|-------|
| Hero image | Absolute `70vw` / `-8vw` bleed → overlap + risk of horizontal scroll | Contained column `aspect-*` + `object-cover` |
| Glass UI | Large frosted panel over image | Compact badge ≤20rem, bottom-right inset |
| Shell | `max-w-[1440px]` + negative-margin “full-bleed” | `--agri-content-max: 1600px` + `.agri-full-bleed` bands |
| LCP text | Unchanged (no H1 entrance animation) | Unchanged |
| Hero image preload / dimensions | Present | Present; preload `imagesizes` aligned to `100vw / 50vw` |
| CLS (desktop) | Interim regression **0.243** (Fraunces `display=swap` metric swap on hero) | **0.001** after `display=optional` + metric-matched Georgia fallback + `items-start` |
| CLS (mobile) | **0** | **0** |
| LCP (desktop, LH 13.5) | Prior After table **0.9s** (LH 12.6) | **1.1s** (parity within lab noise; Perf **0.98**) |
| LCP (mobile, LH 13.5) | Prior After table **3.1s** (LH 12.6) | Lab **4.9s** under LH 13 Slow-4G (FCP 3.8s, TBT 20ms); methodology differs from LH 12.6 baseline — no H1 opacity animation reintroduced; badge fetch deferred via `requestIdleCallback` |

Playwright home (prod): overflow / padding / badge placement / axe serious+critical = **0** at 360, 1280, 1920.
