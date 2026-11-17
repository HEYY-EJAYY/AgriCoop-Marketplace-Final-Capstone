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

Mobile: hamburger drawer + bottom nav (role-aware). Guests get Home / Browse / Join.

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

Glass value card with CTA sits on the **right** on desktop and stacks under the hero on mobile. Hero H1 has **no** opacity/entrance animation.

## Workspace

Solid `#f8f5ee` / `#fffdf8` backgrounds (no translucent fade). Workspace mains use `shellContainerClass` (full width to 1440px). Profile / onboarding Save actions use sticky bars.
