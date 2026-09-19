# Payment integration notes

## Sources checked

1. PayMongo QR Ph documentation: https://docs.paymongo.com/docs/payment-acceptance-qr-ph
2. Xendit QR Ph documentation: https://docs.xendit.co/docs/qrph
3. PayMongo/Xendit comparison article: https://kscode.dev/qr-ph-payment-method-paymongo-xendit-payment-gateway/
4. Philippine QR Ph methods overview: https://hitpayapp.com/blog/qr-ph-gcash-maya-payment-methods-philippines

## Verified facts used for implementation

PayMongo supports sandbox/test environments and webhook-driven payment confirmation. Its QR Ph workflow uses a Payment Intent with `qrph` as an allowed payment method, then a QR-capable payment method is attached. The returned QR image is shown to the customer, and PayMongo sends `payment.paid` for successful payment, `payment.failed` for failed attempts, and `qrph.expired` when the dynamic QR expires. QR Ph can be scanned using participating banks and e-wallets including GCash, Maya, and GoTyme.

The user explicitly requires selectable GCash, Maya, GoTyme, and QR Ph options. The implementation must preserve F2F as a separate fallback method, represent checkout payment status as pending, paid, failed, or F2F-pending-confirmation, and synchronize order and transaction records through a verified webhook handler.

The current project is an Express 4 + React 19 + Vite + tRPC + Drizzle/MySQL application with Manus OAuth. It is not currently a Next.js + Supabase app. A true independent Vercel deployment therefore requires a dedicated Next.js/Supabase target or a documented migration branch; the current Manus project should not be falsely described as already using that stack.

## Credential validation

The user supplied a Supabase project identifier and PayMongo test secret. Supabase REST and PayMongo API validation tests both passed after using valid lightweight endpoints. The Supabase anon key is configured as `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the PayMongo test secret is configured as `PAYMONGO_SECRET_KEY`.

## Security constraints

Never expose `PAYMONGO_SECRET_KEY` in client code. Webhook requests must be signature-verified before updating records. Only server-side service credentials may perform administrative Supabase operations or seed demo data. Webhook handling must be idempotent so repeated payment events cannot duplicate transaction records.

## Current implementation status

The current MySQL schema has been extended with `orders.paymentStatus`, `orders.paymentMethod`, `transactions.paymentMethod`, and `transactions.externalId`. The migration was generated as `drizzle/0002_foamy_random.sql` and applied successfully. The payment client and Supabase client scaffolding are present; full checkout methods, webhook handling, custom auth, seed data, and independent Next.js deployment still require implementation.

> Note: GoTyme appears in the PayMongo QR Ph supported issuer list, while direct individual wallet support should be treated as provider/account dependent. The safe implementation is to expose GoTyme explicitly as a supported QR Ph selection in the UI and use PayMongo's documented `qrph` flow for the actual sandbox payment.

## Stack recommendation

Preserve the existing working Manus-hosted UI during this task and add the missing integrations without claiming a stack migration that has not been completed. If an independent Next.js + Supabase + Tailwind + Vercel deployment is mandatory, it should be created as a separate migration target with shared design and data-contract documentation rather than silently converting the current Express/Vite deployment in place.

## References

[1]: https://docs.paymongo.com/docs/payment-acceptance-qr-ph
[2]: https://docs.xendit.co/docs/qrph
[3]: https://kscode.dev/qr-ph-payment-method-paymongo-xendit-payment-gateway/
[4]: https://hitpayapp.com/blog/qr-ph-gcash-maya-payment-methods-philippines

