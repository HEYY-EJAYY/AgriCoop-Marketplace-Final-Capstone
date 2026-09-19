import express from "express";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { orders, transactions } from "../drizzle/schema";

export const webhookRouter = express.Router();

function verifySignature(payload: Buffer, header: string, secret: string) {
  const parts = new Map(header.split(",").map(part => {
    const [key, ...rest] = part.trim().split("=");
    return [key, rest.join("=")];
  }));
  const timestamp = parts.get("t");
  const signature = parts.get("te") || parts.get("li");
  if (!timestamp || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function getOrderId(payment: any) {
  const value = payment?.metadata?.orderId ?? payment?.description ?? "";
  const match = String(value).match(/(?:Order\s*#|orderId[=:])?\s*(\d+)/i);
  const orderId = Number(match?.[1]);
  return Number.isInteger(orderId) && orderId > 0 ? orderId : null;
}

webhookRouter.post("/paymongo", express.raw({ type: "application/json" }), async (req, res) => {
  const signatureHeader = String(req.headers["paymongo-signature"] ?? "");
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;

  const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  if (!signatureHeader || !webhookSecret || !verifySignature(payload, signatureHeader, webhookSecret)) return res.status(400).send("Invalid PayMongo signature");

  try {
    const event = JSON.parse(payload.toString("utf8"));
    const db = await getDb();
    if (!db) return res.status(500).send("Database unavailable");

    const payment = event.data?.attributes ?? {};
    const orderId = getOrderId(payment);
    const status = event.type === "payment.paid" ? "paid" : event.type === "payment.failed" ? "failed" : null;
    if (orderId && status) {
      await db.update(orders).set({ paymentStatus: status }).where(eq(orders.id, orderId));
      await db.update(transactions).set({ status, externalId: payment.id ?? null }).where(and(eq(transactions.orderId, orderId), eq(transactions.paymentMethod, "paymongo")));
    }

    res.status(200).send("Webhook processed");
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).send("Internal server error");
  }
});
