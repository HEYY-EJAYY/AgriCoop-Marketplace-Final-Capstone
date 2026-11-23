/**
 * Removes disposable QA data created by e2e/checkout-workflow.spec.ts:
 *  - the two "QA Fixture *" paymentOptions (coop 1) and their QR issue reports
 *  - orders whose ids are passed as arguments (the spec records each created
 *    order id in scripts/_qa-order-id.txt)
 *
 * Usage: DATABASE_URL=... node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs scripts/qa-fixture-cleanup.mts [orderId ...]
 * Or read ids from scripts/_qa-order-id.txt when no args are given.
 */
import postgres from "postgres";
import { readFileSync, existsSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

let orderIds = process.argv.slice(2).map(Number).filter(Number.isInteger);
if (!orderIds.length && existsSync("scripts/_qa-order-id.txt")) {
  orderIds = readFileSync("scripts/_qa-order-id.txt", "utf8")
    .split(/[\s,]+/).map(Number).filter(Number.isInteger);
}

const sql = postgres(url, { prepare: false });
const fixtureOptions = await sql`
  select id from agricoop_app."paymentOptions" where "displayName" like 'QA Fixture %'`;
const optIds = fixtureOptions.map(r => r.id as number);

await sql.begin(async tx => {
  if (orderIds.length) {
    await tx`delete from agricoop_app."paymentEvents" where "paymentId" in (select id from agricoop_app.payments where "orderId" = any(${orderIds}))`;
    await tx`delete from agricoop_app."paymentProofs" where "orderId" = any(${orderIds})`;
    await tx`delete from agricoop_app.payments where "orderId" = any(${orderIds})`;
    await tx`delete from agricoop_app.transactions where "orderId" = any(${orderIds})`;
    await tx`delete from agricoop_app."orderItems" where "orderId" = any(${orderIds})`;
    await tx`delete from agricoop_app."orderHistory" where "orderId" = any(${orderIds})`;
    await tx`delete from agricoop_app."orderEvents" where "orderId" = any(${orderIds})`;
    await tx`delete from agricoop_app."qrIssueReports" where "orderId" = any(${orderIds})`;
    await tx`delete from agricoop_app."conversationMessages" where "conversationId" in (select id from agricoop_app.conversations where "orderId" = any(${orderIds}))`;
    await tx`delete from agricoop_app."threadStates" where "threadId" in (select id from agricoop_app.conversations where "orderId" = any(${orderIds}))`;
    await tx`delete from agricoop_app.conversations where "orderId" = any(${orderIds})`;
    await tx`delete from agricoop_app.orders where id = any(${orderIds})`;
    await tx`delete from agricoop_app.notifications where "relatedEntityType" = 'order' and "relatedEntityId" = any(${orderIds})`;
  }
  if (optIds.length) {
    await tx`delete from agricoop_app."qrIssueReports" where "paymentOptionId" = any(${optIds})`;
    await tx`delete from agricoop_app."paymentOptions" where id = any(${optIds})`;
    await tx`delete from agricoop_app.notifications where type = 'qr_issue_reported'`;
  }
});

const left = await sql`
  select
    (select count(*) from agricoop_app.orders where id = any(${orderIds.length ? orderIds : [0]})) as orders_left,
    (select count(*) from agricoop_app."paymentOptions" where id = any(${optIds.length ? optIds : [0]})) as opts_left,
    (select count(*) from agricoop_app."qrIssueReports" where "paymentOptionId" = any(${optIds.length ? optIds : [0]})) as reports_left`;
console.log("orders requested:", orderIds.join(",") || "none", "| fixture options:", optIds.join(",") || "none");
console.log("VERIFY", JSON.stringify(left[0]));
await sql.end();
