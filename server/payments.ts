const PAYMONGO_API = "https://api.paymongo.com/v1";

type PayMongoResponse = { data?: { id?: string; attributes?: { client_key?: string; status?: string; next_action?: { redirect?: { url?: string }; code?: { image_url?: string } } } } };

async function paymongoRequest(path: string, body: unknown) {
  const secret = process.env.PAYMONGO_SECRET_KEY;
  if (!secret) throw new Error("PAYMONGO_SECRET_KEY is not configured");
  const response = await fetch(`${PAYMONGO_API}${path}`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`PayMongo request failed (${response.status})`);
  return response.json() as Promise<PayMongoResponse>;
}

export async function createPaymongoPaymentIntent(input: { amountCents: number; orderId: number; method: "gcash" | "maya" | "gotyme" | "qrph" }) {
  const allowedMethod = input.method === "maya" ? "paymaya" : input.method === "gotyme" ? "qrph" : input.method;
  const intent = await paymongoRequest("/payment_intents", { data: { attributes: { amount: input.amountCents, currency: "PHP", payment_method_allowed: [allowedMethod], description: `Order #${input.orderId}`, metadata: { orderId: String(input.orderId) } } } });
  const intentId = intent.data?.id;
  const clientKey = intent.data?.attributes?.client_key;
  if (!intentId || !clientKey) return { paymentIntentId: intentId ?? null, redirectUrl: null, qrImageUrl: null };
  const paymentMethod = await paymongoRequest("/payment_methods", { data: { attributes: { type: allowedMethod } } });
  const paymentMethodId = paymentMethod.data?.id;
  if (!paymentMethodId) throw new Error("PayMongo did not return a payment method");
  const attached = await paymongoRequest(`/payment_intents/${intentId}/attach`, { data: { attributes: { payment_method: paymentMethodId, client_key: clientKey, return_url: `${process.env.APP_PUBLIC_URL ?? "http://localhost:3000"}/payment/complete?orderId=${input.orderId}` } } });
  const next = attached.data?.attributes?.next_action;
  return { paymentIntentId: intentId, redirectUrl: next?.redirect?.url ?? null, qrImageUrl: next?.code?.image_url ?? null };
}
