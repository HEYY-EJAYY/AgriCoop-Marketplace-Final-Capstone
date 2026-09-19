import { describe, expect, it } from "vitest";
import axios from "axios";
import crypto from "node:crypto";

describe("server integration credentials", () => {
  it("validates the Supabase service role key against the Auth admin endpoint", async () => {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(baseUrl).toBeTruthy();
    expect(serviceRoleKey).toBeTruthy();

    const response = await axios.get(`${baseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey}` },
      validateStatus: () => true,
    });
    expect(response.status).toBe(200);
  });

  it("validates webhook signature configuration is usable for HMAC verification", () => {
    const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
    expect(webhookSecret).toBeTruthy();
    const payload = JSON.stringify({ id: "evt_test", type: "payment.paid" });
    const signature = crypto.createHmac("sha256", webhookSecret!).update(payload).digest("hex");
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });
});

