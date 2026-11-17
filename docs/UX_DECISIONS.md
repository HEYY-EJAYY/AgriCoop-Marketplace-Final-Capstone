# AgriCoop UX decisions (refinement pass)

Branch: `finish/agricoop-complete`  
Date: 2026-11-17

Decisions made where the mission left room for judgment. Conventions follow Shopee/Lazada where they fit a cooperative F2F marketplace.

---

## Navigation maps (final)

### Logged out (desktop)
| Zone | Items |
|------|--------|
| Left | Logo + AgriCoop title |
| Center | Marketplace · How It Works · Support |
| Right | Login · Join AgriCoop (primary) |

**Removed from logged-out header:** search bar, cart/basket icon, logout, account menus.

### Buyer
Center: Marketplace · My Orders · Messages · Support  
Right: Cart (badge area) · Notifications · `Name | Buyer` profile menu

### Seller
Center: Marketplace · Seller Center · Messages · Support  
Right: Notifications · `Name | Seller` profile menu

### Officer Admin (`admin`)
Center: Dashboard · Moderation · Orders · Users · Support & Tickets  
Right: Notifications · `Name | Officer Admin` profile menu

### SuperAdmin
Center: Dashboard · Users & Roles · Moderation · Orders · System · Audit Logs  
Right: Notifications · `Name | SuperAdmin` profile menu

### Profile menu (all signed-in roles)
1. My Profile (`/profile`)  
2. My Workspace (`/dashboard`)  
3. Messages (`/messages`)  
4. Support (`/support`)  
5. —  
6. Log Out (last)

### Mobile bottom nav
- Guests: Home · Browse · Join  
- Buyer: Home · Browse · Cart · Orders · Account  
- Seller: Home · Browse · Center · Messages · Account  
- Admin/SuperAdmin: Home · Dash · Tickets · Messages · Account  

---

## Messaging vs Support vs Tickets

| Channel | Route | Data | Who |
|---------|-------|------|-----|
| Order / trade Messages | `/messages` | `conversations` with seller/order/product/quotation | Buyer ↔ Seller only |
| Platform Support | `/support` | `conversations` with no seller/order/product/quotation | User ↔ Officer Admin / SuperAdmin |
| Tickets | `/support-tickets` | `supportTickets` + messages | Formal tracked cases |

**Access decision:** Officers do **not** read private buyer–seller order chats. Platform support threads remain visible to officers. Soft-delete / pin / archive / read state lives in `threadStates` (per user) for conversations; ticket pin/archive/delete use ticket columns.

---

## Marketplace

- Search, category, cooperative, and sort live on the marketplace page (URL query params), not in the global header.
- Sort options: Price low→high, Price high→low, Stock (most available), By Cooperative, Category.
- Page size 24 with `page` in the URL.

---

## Hero

- Glass value card on the **right** on desktop; stacked under hero content on mobile.
- Hero H1 has **no** entrance animation (LCP-safe).

---

## Workspace fade

- Cause: full-screen loading overlays + translucent sticky headers.
- Fix: solid `#fffdf8` headers; in-layout `min-h-[40vh]` loaders; sticky Save/Cancel on profile/onboarding.

---

## Profile

- Single `/profile` for all roles: display name, contact, address, photo, password change.
- Email and role are read-only; role label uses Officer Admin for `admin`.
