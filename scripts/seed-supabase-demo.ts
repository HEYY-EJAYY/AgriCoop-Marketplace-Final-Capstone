import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const isUuid = (value: string | undefined) =>
  Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
  );

if (process.env.NODE_ENV === "production")
  throw new Error(
    "The Supabase development seed refuses to run in production."
  );
if (process.env.SUPABASE_SEED_ALLOW_WRITE !== "true") {
  throw new Error(
    "Set SUPABASE_SEED_ALLOW_WRITE=true explicitly before running the development seed."
  );
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sellerId = process.env.SUPABASE_DEV_SELLER_ID;
if (!url || !serviceRoleKey)
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
  );
if (!isUuid(sellerId))
  throw new Error(
    "SUPABASE_DEV_SELLER_ID must be the UUID of an approved seller profile."
  );

void (async () => {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profile = await client
    .from("profiles")
    .select("user_id,role_id,account_status")
    .eq("user_id", sellerId)
    .maybeSingle();
  if (profile.error)
    throw new Error("Could not validate the development seller profile.");
  if (!profile.data)
    throw new Error("The development seller profile does not exist.");
  if (profile.data.role_id === null)
    throw new Error("The development seller profile has no role.");
  const role = await client
    .from("roles")
    .select("role_name")
    .eq("role_id", profile.data.role_id)
    .maybeSingle();
  if (
    role.error ||
    role.data?.role_name !== "seller" ||
    !["approved", "active"].includes(
      (profile.data.account_status ?? "").toLowerCase()
    )
  ) {
    throw new Error(
      "SUPABASE_DEV_SELLER_ID must belong to an approved seller profile."
    );
  }

  const demoProducts = [
    {
      product_name: "Development Rice",
      category: "Grains",
      description:
        "Development-only sample listing for local acceptance testing.",
      unit: "kg",
      price: 85,
      status: "available",
      stock_quantity: 100,
    },
    {
      product_name: "Development Corn",
      category: "Grains",
      description:
        "Development-only sample listing for local acceptance testing.",
      unit: "kg",
      price: 72,
      status: "available",
      stock_quantity: 80,
    },
  ] as const;

  let createdProducts = 0;
  let updatedInventory = 0;
  for (const demo of demoProducts) {
    const existing = await client
      .from("products")
      .select("product_id")
      .eq("seller_id", sellerId)
      .eq("product_name", demo.product_name)
      .maybeSingle();
    if (existing.error)
      throw new Error("Could not look up the development product.");

    let productId = existing.data?.product_id;
    if (!productId) {
      const created = await client
        .from("products")
        .insert({
          seller_id: sellerId,
          product_name: demo.product_name,
          category: demo.category,
          description: demo.description,
          unit: demo.unit,
          price: demo.price,
          status: demo.status,
        })
        .select("product_id")
        .single();
      if (created.error || !created.data)
        throw new Error("Could not create the development product.");
      productId = created.data.product_id;
      createdProducts += 1;
    }

    const inventory = await client
      .from("inventory")
      .select("inventory_id")
      .eq("product_id", productId)
      .maybeSingle();
    if (inventory.error)
      throw new Error("Could not look up development inventory.");
    const inventoryWrite = inventory.data
      ? await client
          .from("inventory")
          .update({
            stock_quantity: demo.stock_quantity,
            last_updated: new Date().toISOString(),
          })
          .eq("inventory_id", inventory.data.inventory_id)
      : await client.from("inventory").insert({
          product_id: productId,
          stock_quantity: demo.stock_quantity,
          last_updated: new Date().toISOString(),
        });
    if (inventoryWrite.error)
      throw new Error("Could not save development inventory.");
    updatedInventory += 1;
  }

  console.log(
    `Supabase development seed complete: ${createdProducts} products created, ${updatedInventory} inventory rows written.`
  );
})();
