import { describe, it, expect } from "vitest";
import axios from "axios";

describe("Credential Validation", () => {
  it("validates Supabase Anon Key by fetching project settings or a public table", async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    expect(supabaseUrl).toBeDefined();
    expect(supabaseKey).toBeDefined();

    try {
      // Attempt to fetch from a standard Supabase REST endpoint
      const response = await axios.get(`${supabaseUrl}/rest/v1/cooperatives?select=count`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      // 200 means success, 404 means table doesn't exist yet but key is likely valid if not 401
      expect([200, 404]).toContain(response.status);
    } catch (error: any) {
      console.error("Supabase validation failed:", error.response?.data || error.message);
      throw new Error(`Supabase validation failed: ${error.response?.status} ${JSON.stringify(error.response?.data)}`);
    }
  });

  it("validates PayMongo Secret Key by fetching account details", async () => {
    const paymongoKey = process.env.PAYMONGO_SECRET_KEY;
    expect(paymongoKey).toBeDefined();

    try {
      const auth = Buffer.from(`${paymongoKey}:`).toString("base64");
      const response = await axios.get("https://api.paymongo.com/v1/webhooks", {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });
      expect(response.status).toBe(200);
    } catch (error: any) {
      console.error("PayMongo validation failed:", error.response?.data || error.message);
      throw new Error(`PayMongo validation failed: ${error.response?.status} ${JSON.stringify(error.response?.data)}`);
    }
  });
});
