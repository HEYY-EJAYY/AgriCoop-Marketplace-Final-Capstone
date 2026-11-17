# AgriCoop UX decisions (UI/UX refinement)

Branch: `finish/agricoop-complete`  
Updated: 2026-11-17

## Navigation maps

### Logged out (desktop, single row)
| Zone | Items |
|------|--------|
| Left | Logo + AgriCoop title |
| Center | Marketplace · How It Works · Support |
| Right | Login · Join AgriCoop (primary) |

No search bar, cart, account menu, or log out when logged out.

### Buyer
Marketplace · My Orders · Messages · Support | cart + notifications + `Name | Buyer` menu

### Seller
Marketplace · Seller Center · Messages · Support | notifications + `Name | Seller` menu

### Officer Admin (`admin`)
Dashboard · Moderation · Orders · Users · Support & Tickets | notifications + `Name | Officer Admin` menu

### SuperAdmin
Dashboard · Users & Roles · Moderation · Orders · System · Audit Logs | notifications + `Name | SuperAdmin` menu

Profile menu (all roles): My Profile · My Workspace · Messages · Support · Log Out (last).

Mobile: hamburger **overlay** + bottom nav (role-aware). Guests get Home / Browse / Join.

### Mobile menu (overlay) — root cause

**Cause:** `MobileNavDrawer` rendered as an in-flow block under the sticky header (`border-t` panel inside `<header>`). Opening it grew the header and pushed page content down (layout shift).

**Fix:** One shared `MobileMenuOverlay` for logged-out and all four roles (also wired into `WorkspaceHeader`). `position: fixed` + `100dvh` backdrop/panel, body scroll lock with scrollbar-gap compensation, Esc / backdrop / link / resize-to-desktop close, focus trap + return to toggle, `aria-expanded` / `aria-controls`. Page under the menu does not reflow.

## Messaging vs Support vs Tickets

| System | Route | Data | Who |
|--------|-------|------|-----|
| Order inquiries / Messages | `/messages` | `conversations` with seller/order/product/quotation | Buyer ↔ seller only |
| Platform Support | `/support` | `conversations` with no seller/order/product/quotation | User ↔ officers |
| Tickets | `/support-tickets` | `supportTickets` | User + staff queue |

Per-user pin / archive / read / soft-delete live in `agricoop_app.threadStates` (`channel` = `conversation` | `ticket` | `support`). One user’s archive or delete never hides the thread for the other participant.

## Privacy assumption (trade chats)

Officers and SuperAdmins **cannot** read private buyer–seller order chats via normal inbox APIs. Access is limited to the buyer and seller on the thread (`canAccessConversation`). There is **no silent admin bypass**. An explicit dispute escalation path (logged) is not implemented yet; until it exists, staff must use Support/Tickets channels only.

## Marketplace

URL params: `q`, `category`, `cooperativeId`, `sort` (`price_asc` | `price_desc` | `stock_desc` | `cooperative` | `category`), `page` (24 per page). Price sorts hit the API; other sorts are client-side after fetch.

## Hero

**Root causes fixed (2026-11-17):**
1. Glass card covered the image because it was a large absolute panel (`~22rem`) over an overflowing hero image.
2. Image overlapped text because desktop media used `absolute … right-[-8vw] w-[70vw]` outside the grid column.
3. Layout felt narrow / uneven because content capped at `1440px` while marketplace “full-bleed” used negative margins inside the padded shell (not true viewport bands).

**Current rules:**
- Hero is a real `lg:grid-cols-2` with a contained `aspect-*` image (`object-cover`); no vw overflow, no absolute bleed image.
- Glass badge is compact (`≤20rem`, ~bottom-right inset `24px` desktop / stacked under image on mobile), frosted with solid fallback, real listing count + featured name from `marketplace.list`.
- Primary CTAs live in the text column at every breakpoint so the badge never owns the only path to Marketplace.
- Hero H1 has **no** opacity/entrance animation.

## Layout width

One shared token: CSS `--agri-content-max: 100rem` (1600px) + `.agri-shell` / `shellContainerClass`. Full-bleed bands use `.agri-full-bleed` / `data-full-bleed` with an inner `.agri-shell`. Navbar and footer use the same shell. Avoid `100vw` for horizontal sizing (`overflow-x: clip` on `html`/`body` as a guard).

## Workspace

Solid `#f8f5ee` / `#fffdf8` backgrounds (no translucent fade). Workspace mains use `shellContainerClass`. Profile / onboarding Save actions use sticky bars.
