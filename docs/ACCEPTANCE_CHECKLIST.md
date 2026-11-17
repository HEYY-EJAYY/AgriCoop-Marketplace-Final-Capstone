# Production acceptance checklist

All items **PENDING** until you verify in the existing production project.

| # | Area | Steps | Expected | Status |
|---|---|---|---|---|
| 1 | Auth + role resolution | Sign in as Buyer, Seller, Admin, SuperAdmin | Correct role/coop; suspended blocked | PENDING |
| 2 | Cooperative isolation | Admin A tries Admin B coop orders/proofs/options | Denied | PENDING |
| 3 | Buyer purchase | Browse → cart → checkout → order | One transaction + one payments row per order | PENDING |
| 4 | Seller product workflow | Create → images ≤10 → submit → hide/show | Re-enters review on material change | PENDING |
| 5 | Product review | Admin approve/reject | Marketplace visibility updates; seller notified | PENDING |
| 6 | Payment proof | Buyer HMAC upload → finalize → Admin review | Magic-byte/size enforced; no participant review | PENDING |
| 7 | Inventory | Concurrent orders near stock limit; cancel | No oversell; cancel releases reservation | PENDING |
| 8 | Order transitions | Seller confirm/ready; Admin complete/cancel | Seller cannot complete/cancel | PENDING |
| 9 | Payment options | `/admin/payment-options` CRUD + QR | Coop-scoped; QR ≠ payment proof | PENDING |
| 10 | Messaging / notifications | Message + wait ≤30s | Polling updates; SSE optional | PENDING |
| 11 | No cross-coop access | Cross-coop resources | Forbidden | PENDING |
| 12 | Financial uniqueness | Inspect transactions/payments/proofs per order | One transaction; one payments; ≤1 active proof | PENDING |
| 13 | Audit logs | `/admin/audit-logs` as Admin vs SuperAdmin | Coop vs platform scope | PENDING |
| 14 | Critical errors | Browser console + Vercel logs during smoke | No secret leakage / 5xx storms | PENDING |
