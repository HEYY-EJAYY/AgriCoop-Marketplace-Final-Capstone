const PAYMONGO_API = "https://api.paymongo.com/v1";

export async function createPaymongoPaymentIntent(input: { amountCents: number; orderId: number; method: "gcash" | "maya" | "gotyme" | "qrph" }) {
  const secret = process.env.PAYMONGO_SECRET_KEY;
  if (!secret) throw new Error("PAYMONGO_SECRET_KEY is not configured");
  const allowedMethod = input.method === "maya" ? "paymaya" : input.method;
  const response = await fetch(`${PAYMONGO_API}/payment_intents`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { attributes: { amount: input.amountCents, currency: "PHP", payment_method_allowed: [allowedMethod], description: `Order #${input.orderId}`, metadata: { orderId: String(input.orderId) } } } }),
  });
  if (!response.ok) throw new Error(`PayMongo Payment Intent failed (${response.status})`);
  const body = await response.json() as { data?: { id?: string } };
  return { paymentIntentId: body.data?.id ?? null };
}
