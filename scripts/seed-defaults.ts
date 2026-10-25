import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const [{ eq }, { products, users }, { getDb }, { supabaseAdmin }] = await Promise.all([
  import("drizzle-orm"),
  import("../drizzle/schema"),
  import("../server/db"),
  import("../server/clients"),
]);
const db = await getDb();
if (!db) throw new Error("Unable to connect to the configured database.");

const accounts = [
  { emailKey: "SEED_SUPERADMIN_1_EMAIL", passwordKey: "SEED_SUPERADMIN_1_PASSWORD", name: "Joan Athan Nelle Cahiyang", role: "superadmin" as const },
  { emailKey: "SEED_SUPERADMIN_2_EMAIL", passwordKey: "SEED_SUPERADMIN_2_PASSWORD", name: "Erol Daguinod", role: "superadmin" as const },
  { emailKey: "SEED_OFFICER_EMAIL", passwordKey: "SEED_OFFICER_PASSWORD", name: "Cooperative Officer", role: "admin" as const },
  { emailKey: "SEED_BUYER_EMAIL", passwordKey: "SEED_BUYER_PASSWORD", name: "Marketplace Buyer", role: "buyer" as const },
  { emailKey: "SEED_SELLER_EMAIL", passwordKey: "SEED_SELLER_PASSWORD", name: "Marketplace Seller", role: "seller" as const },
];

const authUsers = [];
for (const account of accounts) {
  const email = process.env[account.emailKey]?.trim();
  const password = process.env[account.passwordKey];
  if (!email) throw new Error(`Missing ${account.emailKey} in .env.local.`);
  if (!password) throw new Error(`Missing ${account.passwordKey} in .env.local.`);

  let existingAuthUser;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to inspect Supabase Auth users: ${error.message}`);
    existingAuthUser = data.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
    if (existingAuthUser || data.users.length < 1000) break;
  }

  const result = existingAuthUser
    ? await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
        email,
        password,
        email_confirm: true,
        user_metadata: { name: account.name, role: account.role },
      })
    : await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: account.name, role: account.role },
      });
  if (result.error || !result.data.user) throw new Error(`Unable to provision ${account.emailKey}: ${result.error?.message ?? "unknown error"}`);

  const userRecord = {
    openId: result.data.user.id,
    name: account.name,
    email,
    loginMethod: "supabase",
    role: account.role,
    approvalStatus: "approved" as const,
  };
  const existingAppUser = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (existingAppUser) {
    await db.update(users).set(userRecord).where(eq(users.id, existingAppUser.id));
    authUsers.push({ role: account.role, email, id: existingAppUser.id });
  } else {
    const [created] = await db.insert(users).values(userRecord).returning({ id: users.id });
    authUsers.push({ role: account.role, email, id: created.id });
  }
}

const seller = authUsers.find(account => account.role === "seller");
if (!seller) throw new Error("The seller account was not provisioned.");
const sellerId = seller.id;
const sellerRecord = (await db.select().from(users).where(eq(users.id, sellerId)).limit(1))[0];
if (!sellerRecord) throw new Error("The seeded seller is missing from the application database.");

const catalog = [
  { name: "Rice", category: "Crop Production, Cereal Grain", variety: "Jasmine, Dinorado, Sinandomeng, brown, glutinous", unit: "kg", priceCents: 4000, description: "Staple food from paddy fields for daily consumption and food processing. Available varieties: Jasmine, Dinorado, Sinandomeng, brown, glutinous. Estimated price: P40-P70 per kg." },
  { name: "Corn", category: "Cereal Grain", variety: "Yellow, white, sweet, glutinous, popcorn", unit: "kg", priceCents: 2000, description: "For human consumption, animal feed, and industrial food production. Available varieties: Yellow, white, sweet, glutinous, popcorn. Estimated price: P20-P50 per kg." },
  { name: "Coconut", category: "Plantation Crop", variety: "Tall, dwarf, hybrid", unit: "piece", priceCents: 2000, description: "Used for coconut oil, copra, milk, water, and household products. Available varieties: Tall, dwarf, hybrid. Estimated price: P20-P45 per piece." },
  { name: "Banana", category: "Fruit Crop", variety: "Lakatan, Latundan, Saba, Cavendish, Senorita", unit: "kg", priceCents: 4000, description: "For fresh eating, cooking, chips, and processed foods. Available varieties: Lakatan, Latundan, Saba, Cavendish, Senorita. Estimated price: P40-P100 per kg." },
  { name: "Mango", category: "Fruit Crop", variety: "Carabao, Indian, Pico, Katchamita", unit: "kg", priceCents: 6000, description: "Eaten fresh or made into juice, dried fruit, and jam. Available varieties: Carabao, Indian, Pico, Katchamita. Estimated price: P60-P150 per kg." },
  { name: "Pineapple", category: "Fruit Crop", variety: "Smooth Cayenne, Queen, Red Spanish, MD-2", unit: "piece", priceCents: 4000, description: "For fresh eating, juice, canned fruit, and processing. Available varieties: Smooth Cayenne, Queen, Red Spanish, MD-2. Estimated price: P40-P100 per piece." },
  { name: "Sugarcane", category: "Industrial Crop", variety: "Commercial varieties, high-sugar varieties, chewing sugarcane", unit: "metric ton", priceCents: 200000, description: "Used for sugar, molasses, ethanol, and by-products. Available varieties: commercial varieties, high-sugar varieties, chewing sugarcane. Estimated price: P2,000-P4,000 per metric ton." },
  { name: "Coffee", category: "Beverage Crop", variety: "Arabica, Robusta, Liberica (Barako), Excelsa", unit: "kg", priceCents: 15000, description: "Beans harvested, dried, processed, and roasted. Available varieties: Arabica, Robusta, Liberica (Barako), Excelsa. Estimated price: P150-P400 per kg (green beans)." },
  { name: "Cacao", category: "Industrial and Beverage Crop", variety: "Forastero, Criollo, Trinitario", unit: "kg", priceCents: 10000, description: "Used for cocoa powder, cocoa butter, and chocolate. Available varieties: Forastero, Criollo, Trinitario. Estimated price: P100-P250 per kg (dried beans)." },
  { name: "Cassava", category: "Root and Tuber Crop", variety: "Sweet, bitter, industrial", unit: "kg", priceCents: 1500, description: "A food crop and raw material for starch, flour, and animal feed. Available varieties: sweet, bitter, industrial. Estimated price: P15-P35 per kg." },
];

for (const product of catalog) {
  const values = {
    ...product,
    sellerId,
    cooperativeId: sellerRecord.cooperativeId,
    stockQty: 100,
    minOrderQty: 1,
    qualityGrade: "standard" as const,
    status: "published" as const,
    verificationStatus: "approved" as const,
    visibility: "visible" as const,
  };
  const existing = (await db.select().from(products).where(eq(products.name, product.name)).limit(1))[0];
  if (existing) {
    await db.update(products).set(values).where(eq(products.id, existing.id));
  } else {
    await db.insert(products).values(values);
  }
}

await db.$client.end();
console.log(`Seeded ${accounts.length} default accounts and ${catalog.length} visible products. Passwords were not printed or stored in source.`);
