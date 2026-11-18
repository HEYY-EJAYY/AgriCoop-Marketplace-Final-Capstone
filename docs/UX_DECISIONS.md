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
Dashboard · Support & Tickets | notifications + avatar/`Name | Officer Admin` menu  
Body tabs on `/dashboard`: Moderation · Orders · Users (`?tab=`; default Moderation)

### SuperAdmin
Dashboard · System · Audit Logs | notifications + avatar/`Name | SuperAdmin` menu  
Same body tabs on `/dashboard` (permissions unchanged; SuperAdmin still gets role/coop controls inside Users)

**Assumption:** Moderation / Orders / Users belong in the dashboard body (spreadsheet-style tabs), not the main nav — nav hash targets never matched real panels.

Profile menu (all roles): My Profile · My Workspace · Messages · Support · Log Out (last). Avatar photo when set; initials fallback on error/missing.

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

### Listing images — root cause (second report)

**Not bad seed data.** Live `products.primaryImageUrl` / `productImages` rows already pointed at real `product-images` object URLs (HTTP 200).  
**Real cause:** client `optimizeListingImageUrl` rewrote object URLs to Supabase `/storage/v1/render/image/…` (Image Transformation). That endpoint returns **403** on this project, so every card `onError` fell back to the marketing **hero** asset (`IMAGE_FALLBACK` / hero path).  
**Fix:** shared `ProductImage` + `resolveProductImageSrc` keep object/public URLs (repair any render URLs), forbid hero paths, use `/images/product-default.svg` (or catalog crop icon) only — never the hero. Cash disclaimer sentence removed from UI (method labels kept).

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

### Marketing boxed shell (2026-11-18)

**Root cause (stretched Home / How It Works / Support):** After the full-width pass, marketing pages reused `.agri-shell` with `--agri-content-max: 100%`, so content ran edge-to-edge on ultra-wide screens. Side gutters were tiny and could look uneven with classic scrollbar occupancy.

**Fix:** One shared marketing container:
- Tokens: `--agri-marketing-max: 80rem` (1280px), `--agri-marketing-pad: clamp(1rem, 4vw, 3rem)`
- Class: `.agri-marketing-shell` (`margin-inline: auto`, equal `padding-inline`)
- Applied to Home, How It Works (`/about`), Support content, and **PublicHeader / PublicFooter** inner rows so those pages share one grid
- Section / hero / footer **bands** stay `.agri-full-bleed` (viewport edge-to-edge); only inner content is boxed
- `html { scrollbar-gutter: stable; }` to reduce one-sided scrollbar shift (avoid `100vw`)

**Unchanged (by design):** marketplace, cart, checkout, auth form column, and dashboards keep `.agri-shell` (full-width small gutters).

**Unequal / mismatched padding report:**
| Surface | Notes |
|---------|--------|
| Marketplace / product / coop / checkout | Content uses `.agri-shell` gutters; header/footer use marketing pad — content and chrome do not share the same max-width grid |
| Auth | Same as above (content shell unchanged) |
| WorkspaceHeader pages (dashboard, orders, …) | Still `.agri-shell`; not on the marketing grid |
| Home / About / Support | Left = right within 1px under the marketing token |

### Logged-out Support nav (2026-11-18)

**Root cause:** `/support` used `WorkspaceHeader` (title workspace chrome) instead of `PublicHeader` / `PageFrame`. Logged-out `WorkspaceHeader` previously rendered center links but **no Login / Join**. During `useAuth().loading`, Support returned a full-page spinner with **no header at all**. Separately, `PublicHeader`’s `HeaderRightActions` also hid Login/Join while `loading`, so public routes could flash an empty right rail.

**Fix:** Support (and other public guest shells: product detail, cooperative, messages/profile guest, 404) use `PageFrame` → `PublicHeader`. While auth is loading, show logged-out center links + Login/Join (same size). Join → `/auth?register=1`. `aria-current="page"` on active center links. Mobile overlay already exposed Login/Join; keep that on every public route.

## Layout width (app shell)

App / marketplace token: CSS `--agri-content-max: 100%` + `.agri-shell` / `shellContainerClass`. Full-bleed bands use `.agri-full-bleed` / `data-full-bleed` with an inner shell. Avoid `100vw` for horizontal sizing (`overflow-x: clip` on `html`/`body` as a guard).

## Workspace

Solid `#f8f5ee` / `#fffdf8` backgrounds (no translucent fade). Workspace mains use `shellContainerClass`. Profile / onboarding Save actions use sticky bars.

### Profile photo upload — root cause

Storage upload via service role could succeed, but `UPDATE agricoop_app.users SET "profileImageUrl"` failed because `authenticated` previously had **SELECT-only** on that column.  
**Fix:** GRANT UPDATE/INSERT on `profileImageUrl`; public `avatars` bucket (2 MB, jpeg/png/webp) + owner-folder policies; client resize ≤512px + compress; server validates ≤2 MB after compression; nav + profile show the new URL immediately with initials fallback.

## Payment / fulfillment unification (2026-11-17)

### Step 0 — Conflicting flow (before fix)

1. **Marketplace cart** offered only `cash_pickup` / `cash_delivery` in a dropdown; `checkoutCartSchema` rejected `gcash`.
2. **Checkout** re-offered payment including **GCash** as a third radio and loaded coop `paymentOptions` QR — a second phase that could override the cart choice.
3. **After place order**, GCash buyers uploaded receipts from the Dashboard (third phase). Quoted orders stayed cash-only while the API accepted `gcash`.
4. Pickup/delivery were **conflated into cash method names**; there was no `fulfillmentMethod` column. Legacy ledger/`Activity` still showed `f2f`.

### Locked assumptions

- New orders store `cash_pickup` | `cash_delivery` | `online`. Display map: `online`/`gcash` → “Online Payment”; `f2f` → “Face-to-face (legacy)”. Never rewrite existing method values.
- Fulfillment is separate (`pickup` | `delivery` on the order). Listing flags: `allowsPickup`, `allowsDelivery` (default true), `acceptsOnlinePayment` (default false).
- Online Payment at checkout uses the **seller’s QR** (user columns), not coop admin QR options (those remain for admin tooling).
- Multi-seller cart allowed; one order per seller group; payment/fulfillment chosen per group. Online groups require a receipt path at create (private `payment-proofs`, buyer-prefixed).
- Timeline: additive `orderHistory` (+ keep `orderEvents` for stock/fulfillment). Cooperative page slug = `normalizedName`. Backfill NULL coop assignments to **SUTAFACO Cooperative** (exact name).
- Removed cash disclaimer sentence must not return. Design freeze: soft cards / existing tokens only.

## System payment (Admin / SuperAdmin only) (2026-11-18)

This supersedes the earlier assumption that checkout online payment uses the seller’s QR.

### Locked assumptions

- Online payment QR, account name, number, and instructions are cooperative-officer settings (`systemPaymentSettings`, `systemOnlinePaymentAccounts`). Seller `onlinePayment*` columns stay in the database and are not written or shown.
- Checkout offers online payment only when online is enabled and the active account has a QR. Buyers receive a short-lived signed QR URL. Anonymous users and sellers do not.
- Sellers see payment status as read-only, including “Waiting for payment confirmation” while unpaid. Officers verify receipts and record cash received. Sellers are notified for fulfillment, then again when an officer confirms payment.
- Listing flags `allowsPickup` and `allowsDelivery` stay seller-controlled. `acceptsOnlinePayment` is forced off on create/update and is not a marketplace badge.

## Part 2 — registration, Cooperative Admin applications, Add account, order archive (2026-11-18)

### Roles (no fifth role)
- Registration choices: **Buyer**, **Seller**, **Cooperative Admin**.
- **Cooperative Admin** is the existing application role `admin`, displayed as **Officer Admin**. Choosing it at signup never grants Admin privileges: the account is created as **Buyer** with `requestedRole = admin` and an application in `awaiting_documents`.
- After SuperAdmin approval, the user becomes `admin` (Officer Admin) with the **same global Admin powers as today**. Scoping Officer Admins to their own cooperative is **not** implemented in Part 2.

### Cooperatives at signup
- Searchable active-cooperative select + “My cooperative isn't listed” add-new. Required for Seller and Cooperative Admin; optional for Buyers.
- New cooperatives use Part 1 rules (normalize, Did you mean…?, rate limit, `source = 'user'`, `createdBy`). Anonymous visitors have no direct write access.

### Applications storage & notifications
- ID and proof images live in private bucket `coop-admin-applications`, path prefixed by Auth user id. Readable only by the uploader and SuperAdmin via signed URLs after server authz. Officer Admins / sellers / buyers cannot read others' files.
- Approve/reject notifies via the existing in-app `create_notification` path. **No app transactional email provider exists** beyond Supabase Auth (signup / recovery). Application decisions do not send a separate product email.

### Add account
- Admin may create Buyer and Seller. SuperAdmin may also create Officer Admin. Nobody creates SuperAdmin from the UI. Accounts are created email-confirmed with a set-password invitation; if email cannot be sent, the creating admin sees a one-time copyable link (never logged/stored).

### Buyer order archive
- Per-user `threadStates` channel `order`. Archiving never changes seller/admin views, order status, payment, or history. Orders are never deleted.

## Cooperative picker + soft delete (2026-11-18)

- One ARIA combobox labeled **Cooperative** (placeholder \"Choose a cooperative\"); no separate search field; no \"(optional)\" in the label. Required for Seller and Cooperative Admin applicants; optional for Buyers.
- Add-new collects **Address** (street/barangay) and **Location** (municipality/city + province). Server normalizes name+location; exact duplicate blocked; similar name prompts Yes use / No add mine with confirmation flag.
- Soft delete (deletedAt/deletedBy) for Admin/SuperAdmin only; deleted coops leave pickers but keep historical names on sellers/listings/orders. Sellers with a deleted coop must pick another before publishing.
