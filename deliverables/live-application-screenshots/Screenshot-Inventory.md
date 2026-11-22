# Live Application Screenshot Inventory

Captured from the running AgriCoop Marketplace application at `http://127.0.0.1:3000/` (local development server, `npm run dev`) using Playwright-driven Chromium at 1920×1080 viewport with 2× device scale factor. All screenshots are genuine captures of the live UI — no mockups or generated images.

Capture date: 2026-11-22

| Figure | Title | Route | Account role used | Status | File |
|---|---|---|---|---|---|
| 4-2 | Dashboard sign-in gate | `/dashboard` (unauthenticated) | none (logged out) | Captured | `Figure-4-2-Dashboard-Sign-In-Gate.png` |
| 4-3 | Marketplace catalog populated with test listings | `/marketplace` | Buyer (Marketplace Buyer) | Captured | `Figure-4-3-Marketplace-Catalog.png` |
| 4-4 | Buyer checkout with seller-group selections | `/checkout` | Buyer (Marketplace Buyer) | Captured | `Figure-4-4-Buyer-Checkout.png` |
| 4-5 | Buyer order detail with payment and fulfillment state | `/orders/50` | Buyer (Marketplace Buyer) | Captured | `Figure-4-5-Buyer-Order-Detail.png` |
| 4-6 | Seller workspace | `/dashboard` | Seller (Marketplace Seller) | Captured | `Figure-4-6-Seller-Workspace.png` |
| 4-7 | Seller listing editor | `/dashboard` (Edit listing) | Seller (Marketplace Seller) | Captured | `Figure-4-7-Seller-Listing-Editor.png` |
| 4-8 | Cooperative Officer workspace | `/dashboard` | OfficerAdmin (Cooperative Officer) | Captured | `Figure-4-8-Cooperative-Officer-Workspace.png` |
| 4-9 | Scoped reporting and CSV exports | `/reports` | SuperAdmin (Joan Athan Nelle Cahiyang) | Captured | `Figure-4-9-Scoped-Reporting-CSV-Exports.png` |
| 4-10 | System Admin workspace | `/dashboard` | SuperAdmin (Joan Athan Nelle Cahiyang) | Captured | `Figure-4-10-System-Admin-Workspace.png` |
| 4-11 | System payment configuration | `/admin/payment-options` | OfficerAdmin (Cooperative Officer) | Captured | `Figure-4-11-System-Payment-Configuration.png` |
| 4-12 | Buyer–Seller conversation | `/messages` | Buyer (Marketplace Buyer) | Captured | `Figure-4-12-Buyer-Seller-Conversation.png` |

## Notes

- **4-2**: Captured before authentication; the dashboard renders the public "Sign in to access the tools assigned to your marketplace role" gate.
- **4-3**: Shows 4 published listings from 2 seller accounts across cooperatives, with the search box, category filter, cooperative filter, and price-sort control visible. Default sort (price low→high) is applied.
- **4-4**: Cart populated with one listing from "Marketplace Seller" and one from "QA8 Seller A", producing two seller groups at checkout. Each group shows its own payment choices (cash on pickup, cash on delivery, online payment state) and the order summary shows per-seller totals and the combined estimate. No order was submitted.
- **4-5**: Order #50 — status Completed, payment Paid (cash on pickup), with buyer/seller/cooperative details and status history.
- **4-9**: The scoped reporting UI with CSV export controls lives at `/reports` (linked from the admin sidebar as "Reports & Transactions"). Captured as SuperAdmin, which shows the platform-wide ("System administrator") reporting scope. Cooperative Officers see the same page scoped to "My cooperative".
- **4-10**: `/admin` is not a standalone route; the System Admin workspace is `/dashboard` rendered by `AdminDashboard` for the `superadmin` role (platform metrics, pending activity, user/cooperative/settings/health/audit navigation).
- **4-11**: `/admin/payment-options` is restricted by design to approved OfficerAdmin accounts (`user.role === "admin"`); SuperAdmin sees a "restricted" notice, so the authorized Cooperative Officer account was used. Platform-wide payment toggles and the system QR account are configured separately under SuperAdmin → Dashboard → Website & Platform Settings (`/dashboard?section=settings`).
- **4-12**: Buyer inbox shows the conversation thread list (order-linked buyer–seller chats) with an open conversation thread and message history.

## Test-data preparation performed

- Two approved, published QA listings (QA8 Rice A, QA8 Mango A) belonging to the previously soft-deleted QA8 Seller A account were restored to visible marketplace state so the catalog and checkout could demonstrate multiple sellers. The seller account was restored through the application's own SuperAdmin "Restore" control; listing rows were un-tombstoned directly in the database. No application code, schema, styling, or business logic was modified.
- No orders, messages, payment settings, or production records were created or altered for the captures. The checkout was left unsubmitted.
