# AgriCoop production performance

Live URL: https://agricoop-marketplace-final-capstone.vercel.app  
Branch: `finish/agricoop-complete`  
Deployment: `dpl_2W3yp34FWwZTZyoydTr9MbihdkhX` (READY, region `sin1`)  
Measured with Lighthouse 12.6.1 from a Windows client (PH).

## What was slow

1. **Region mismatch**: Vercel Functions in `iad1` vs Supabase `ap-southeast-1` → warm `/api/health` ~2.6s.
2. **~360KB HTML**: `vite-plugin-manus-runtime` inlined into production `index.html`.
3. **Broken public browse**: anon RLS lacked `EXECUTE` on helper functions → `marketplace.list` / `categories` HTTP 500.
4. **372KB hero WebP** + opacity entrance animation delaying LCP.
5. **Auth gate before first paint** (fixed by rendering shell immediately).
6. **Serverless pool `max: 10`** per isolate.

## Baseline (before)

### Lighthouse

| Page | Device | Perf | LCP | FCP | TBT | CLS | Transfer |
|------|--------|------|-----|-----|-----|-----|----------|
| `/` | mobile | **75** | 5.0s | 3.2s | 0ms | 0 | 927 KiB |
| `/` | desktop | **94** | 1.4s | 1.0s | 0ms | 0 | 927 KiB |
| `/marketplace` | mobile | **77** | 4.6s | 3.1s | 0ms | 0.04 | 575 KiB |
| `/marketplace` | desktop | **95** | 1.3s | 1.0s | 0ms | 0.002 | 575 KiB |
| `/products/1` | mobile | **87** | 3.2s | 3.2s | 0ms | 0 | 490 KiB |
| `/auth` | mobile | **78** | 4.5s | 3.2s | 0ms | 0 | 554 KiB |

### API (5 samples, production)

| Endpoint | p50 | worst | notes |
|----------|-----|-------|-------|
| `/api/health` | **2622ms** | 2752ms | US→SG |
| `marketplace.categories` | **2813ms** | 2900ms | **HTTP 500** |
| `marketplace.list` | **2804ms** | 2882ms | **HTTP 500** |
| `auth.me` | **310ms** | 313ms | OK |

### Infra / DB

| Item | Before |
|------|--------|
| Vercel region | `iad1` |
| Supabase region | `ap-southeast-1` |
| `index.html` | ~360 KiB (Manus) |
| Marketplace EXPLAIN | ~0.26ms (tiny tables; seq scan OK at current scale) |

## Fixes shipped

- Strip Manus/jsx-loc from production Vite builds; safe chunk splits (`supabase` / `charts` / `icons` only)
- Eager Home + Marketplace; lazy admin/dashboard/auth/etc.; paint React before auth init
- Hero responsive WebP (47–84KB) + preload; transform-only entrance motion
- QueryClient `staleTime` 60s; listing image optimize helper; font async load
- `vercel.json` `regions: ["sin1"]`, immutable `/assets` Cache-Control, short CDN cache for public marketplace tRPC GETs
- `postgres` `max: 1`; leaner marketplace selects; parallel image/reservation fetches; lightweight `pingDatabase` health
- Additive SQL (`20261117140000` + MANUAL_SQL BLOCK 9): anon EXECUTE/SELECT grants, `reserved_quantities_for_products`, browse indexes

## After (production)

### Lighthouse (median of repeat mobile runs where noted)

| Page | Device | Perf | LCP | FCP | TBT | CLS | Transfer |
|------|--------|------|-----|-----|-----|-----|----------|
| `/` | mobile | **91–94** (median **91**) | 2.8–3.2s | 2.2–2.3s | 0ms | 0 | ~410 KiB |
| `/` | desktop | **99** | 0.9s | 0.6s | 0ms | 0.001 | 450 KiB |
| `/marketplace` | mobile | **91–94** | 2.6–3.1s | 2.3s | 0ms | ~0.03 | ~470 KiB |
| `/marketplace` | desktop | **99** | 0.6s | 0.5s | 0ms | 0.065 | 510 KiB |

Best mobile home LCP observed in this pass: **2.4s** (score **95**) before the final Marketplace-eager bundle tradeoff; current mobile lab LCP under Slow-4G throttle often lands **~2.6–3.2s**. Desktop LCP is well under 2.5s.

### API (warm p50)

| Endpoint | Before p50 | After warm p50 | After worst |
|----------|------------|----------------|-------------|
| `/api/health` | 2622ms | **99ms** | 323ms |
| `marketplace.categories` | 2813ms (500) | **77ms** (200) | 147ms |
| `marketplace.list` | 2804ms (500) | **75ms** (200) | 150ms |
| `auth.me` | 310ms | **92ms** | 108ms |

### Bundle / HTML

| Asset | Before | After |
|-------|--------|-------|
| `index.html` | ~360 KiB | **~1.6 KiB** (no Manus) |
| Home transfer | 927 KiB | **~410 KiB** |
| Marketplace transfer | 575 KiB | **~470 KiB** |

## Before / after summary

| Metric | Before | After |
|--------|--------|-------|
| Home mobile Perf | 75 | **91+** |
| Marketplace mobile Perf | 77 | **91+** |
| Home transfer | 927 KiB | ~410 KiB |
| HTML size | ~360 KiB | ~1.6 KiB |
| Health warm | 2622ms | **99ms** |
| Marketplace list warm | 2804ms / 500 | **75ms** / 200 |
| Function region | iad1 | **sin1** |

## Remaining blockers (mobile lab LCP &lt; 2.5s every run)

Under Lighthouse Slow-4G throttling, LCP still occasionally sits just above 2.5s because:

1. **Main JS ~487KB** (gzip ~148KB) includes React + Marketplace + Supabase client loaded on public pages for session.
2. **Google Fonts** still network-fetched (async, but compete on Slow-4G).
3. Lab variance: desktop / unthrottled LCP is consistently &lt;1s.

Further gains (not required for current ship): self-host subsetted fonts, defer Supabase until interaction on anonymous browse, image CDN for listing thumbs beyond Storage transforms.

## Smoke

- Pages `/`, `/marketplace`, `/products/1`, `/auth` → 200, no Manus, root mounts
- `/api/health` → 200 `{ status: "ok" }`
- `marketplace.list` / `categories` → 200 with listings
- Production deployment READY on `sin1`
