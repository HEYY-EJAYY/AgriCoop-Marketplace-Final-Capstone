import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error("This account seed may only run locally, never in production or Vercel.");
}

const requiredEnvironment = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SEED_SUPERADMIN_1_EMAIL",
  "SEED_SUPERADMIN_1_PASSWORD",
  "SEED_SUPERADMIN_2_EMAIL",
  "SEED_SUPERADMIN_2_PASSWORD",
  "SEED_BUYER_EMAIL",
  "SEED_BUYER_PASSWORD",
  "SEED_SELLER_EMAIL",
  "SEED_SELLER_PASSWORD",
  "SEED_OFFICER_EMAIL",
  "SEED_OFFICER_PASSWORD",
] as const;
const missingEnvironment = requiredEnvironment.filter(name => !process.env[name]?.trim());
if (missingEnvironment.length) {
  throw new Error(`Missing required local seed variables: ${missingEnvironment.join(", ")}`);
}

const [{ and, eq, isNull, or, sql }, schema, { getDb }, { supabaseAdmin }] = await Promise.all([
  import("drizzle-orm"),
  import("../drizzle/schema.js"),
  import("../server/db.js"),
  import("../server/clients.js"),
]);

const db = await getDb();
if (!db) throw new Error("Database initialization failed.");

type Role = "buyer" | "seller" | "admin" | "superadmin";
type AccountSpec = {
  role: Role;
  emailVariable: typeof requiredEnvironment[number];
  passwordVariable: typeof requiredEnvironment[number];
  cooperativeId: number | null;
  legacyEmail?: string;
  displayName?: string;
  setVerificationApproved?: boolean;
};

const accountSpecs: AccountSpec[] = [
  {
    role: "superadmin",
    emailVariable: "SEED_SUPERADMIN_1_EMAIL",
    passwordVariable: "SEED_SUPERADMIN_1_PASSWORD",
    cooperativeId: null,
  },
  {
    role: "superadmin",
    emailVariable: "SEED_SUPERADMIN_2_EMAIL",
    passwordVariable: "SEED_SUPERADMIN_2_PASSWORD",
    cooperativeId: null,
  },
  {
    role: "buyer",
    emailVariable: "SEED_BUYER_EMAIL",
    passwordVariable: "SEED_BUYER_PASSWORD",
    cooperativeId: null,
    legacyEmail: "lorelie.buyer@agricoop.demo",
    displayName: "Lorelie",
    setVerificationApproved: true,
  },
  {
    role: "seller",
    emailVariable: "SEED_SELLER_EMAIL",
    passwordVariable: "SEED_SELLER_PASSWORD",
    cooperativeId: 2,
    legacyEmail: "shane.seller@agricoop.demo",
    displayName: "Shane",
    setVerificationApproved: true,
  },
  {
    role: "admin",
    emailVariable: "SEED_OFFICER_EMAIL",
    passwordVariable: "SEED_OFFICER_PASSWORD",
    cooperativeId: 2,
    legacyEmail: "celeste.admin@agricoop.demo",
    displayName: "Cherry",
    setVerificationApproved: true,
  },
];

type Account = AccountSpec & { email: string; password: string };
const accounts: Account[] = accountSpecs.map(spec => ({
  ...spec,
  email: process.env[spec.emailVariable]!.trim(),
  password: process.env[spec.passwordVariable]!,
}));

const productCatalog = [
  { name: "Rice", category: "Crop Production, Cereal Grain", variety: "Jasmine, Dinorado, Sinandomeng, brown, glutinous", unit: "kg", priceCents: 4000, description: "Staple food from paddy fields for daily consumption and food processing. Available varieties: Jasmine, Dinorado, Sinandomeng, brown, glutinous. Estimated price: P40-P70 per kg." },
  { name: "Corn", category: "Cereal Grain", variety: "Yellow, white, sweet, glutinous, popcorn", unit: "kg", priceCents: 2000, description: "For human consumption, animal feed, and industrial food production. Available varieties: Yellow, white, sweet, glutinous, popcorn. Estimated price: P20-P50 per kg." },
  { name: "Coconut", category: "Plantation Crop", variety: "Tall, dwarf, hybrid", unit: "piece", priceCents: 2000, description: "Used for coconut oil, copra, milk, water, and household products. Available varieties: Tall, dwarf, hybrid. Estimated price: P20-P45 per piece." },
  { name: "Banana", category: "Fruit Crop", variety: "Lakatan, Latundan, Saba, Cavendish, Senorita", unit: "kg", priceCents: 4000, description: "For fresh eating, cooking, chips, and processed foods. Available varieties: Lakatan, Latundan, Saba, Cavendish, Senorita. Estimated price: P40-P100 per kg." },
  { name: "Sugarcane", category: "Industrial Crop", variety: "Commercial varieties, high-sugar varieties, chewing sugarcane", unit: "metric ton", priceCents: 200000, description: "Used for sugar, molasses, ethanol, and by-products. Available varieties: commercial varieties, high-sugar varieties, chewing sugarcane. Estimated price: P2,000-P4,000 per metric ton." },
  { name: "Cassava", category: "Root and Tuber Crop", variety: "Sweet, bitter, industrial", unit: "kg", priceCents: 1500, description: "A food crop and raw material for starch, flour, and animal feed. Available varieties: sweet, bitter, industrial. Estimated price: P15-P35 per kg." },
  { name: "Pineapple", category: "Fruit Crop", variety: "Smooth Cayenne, Queen, Red Spanish, MD-2", unit: "piece", priceCents: 4000, description: "For fresh eating, juice, canned fruit, and processing. Available varieties: Smooth Cayenne, Queen, Red Spanish, MD-2. Estimated price: P40-P100 per piece." },
  { name: "Mango", category: "Fruit Crop", variety: "Carabao, Indian, Pico, Katchamita", unit: "kg", priceCents: 6000, description: "Eaten fresh or made into juice, dried fruit, and jam. Available varieties: Carabao, Indian, Pico, Katchamita. Estimated price: P60-P150 per kg." },
  { name: "Coffee", category: "Beverage Crop", variety: "Arabica, Robusta, Liberica (Barako), Excelsa", unit: "kg", priceCents: 15000, description: "Beans harvested, dried, processed, and roasted. Available varieties: Arabica, Robusta, Liberica (Barako), Excelsa. Estimated price: P150-P400 per kg (green beans)." },
  { name: "Cacao", category: "Industrial and Beverage Crop", variety: "Forastero, Criollo, Trinitario", unit: "kg", priceCents: 10000, description: "Used for cocoa powder, cocoa butter, and chocolate. Available varieties: Forastero, Criollo, Trinitario. Estimated price: P100-P250 per kg (dried beans)." },
] as const;

async function findAuthUser(email: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Unable to inspect Supabase Auth accounts.");
    const found = data.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
    if (found || data.users.length < 1000) return found;
  }
}

async function findProfileByEmail(email: string, role: Role) {
  const rows = await db.select().from(schema.users)
    .where(and(eq(schema.users.email, email), eq(schema.users.role, role)))
    .limit(2);
  if (rows.length > 1) throw new Error(`Multiple app-user rows match role ${role}; resolve the duplicate before seeding.`);
  return rows[0];
}

async function findProfileByRoleAndCooperative(role: Role, cooperativeId: number | null) {
  const cooperativeCondition = cooperativeId === null
    ? isNull(schema.users.cooperativeId)
    : eq(schema.users.cooperativeId, cooperativeId);
  const rows = await db.select().from(schema.users)
    .where(and(eq(schema.users.role, role), cooperativeCondition))
    .limit(2);
  if (rows.length > 1) throw new Error(`Multiple app-user rows match role ${role} and its cooperative; resolve the duplicate before seeding.`);
  return rows[0];
}

async function countBusinessReferences(userId: number) {
  const [productRows, orderRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(eq(schema.products.sellerId, userId)),
    db.select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(or(eq(schema.orders.buyerId, userId), eq(schema.orders.sellerId, userId))),
  ]);
  return Number(productRows[0]?.count ?? 0) + Number(orderRows[0]?.count ?? 0);
}

try {
const summary: Array<{ role: Role; email: string; status: "created" | "updated" }> = [];
let productsCreated = 0;
let productsSkipped = 0;
let archivedProductsSkipped = 0;

for (const account of accounts) {
  const targetAuthUser = await findAuthUser(account.email);
  const legacyAuthUser = account.legacyEmail
    ? await findAuthUser(account.legacyEmail)
    : undefined;
  const existingAuth = targetAuthUser ?? legacyAuthUser;
  const preferredExistingAuth = legacyAuthUser ?? targetAuthUser;
  let sourceProfile = preferredExistingAuth
    ? (await db.select().from(schema.users).where(eq(schema.users.openId, preferredExistingAuth.id)).limit(1))[0]
    : undefined;
  if (!sourceProfile && account.legacyEmail) {
    sourceProfile = await findProfileByEmail(account.legacyEmail, account.role);
  }
  if (!sourceProfile) {
    sourceProfile = await findProfileByEmail(account.email, account.role);
  }
  if (!sourceProfile && account.legacyEmail) {
    sourceProfile = await findProfileByRoleAndCooperative(account.role, account.cooperativeId);
  }

  if (!existingAuth && sourceProfile) {
    const references = await countBusinessReferences(sourceProfile.id);
    if (references > 0) {
      throw new Error(`Cannot create a replacement Auth identity for role ${account.role}: the existing app-user row is referenced by ${references} product/order record(s).`);
    }
  }

  const profileByTargetOpenId = targetAuthUser
    ? (await db.select().from(schema.users).where(eq(schema.users.openId, targetAuthUser.id)).limit(1))[0]
    : undefined;
  if (sourceProfile && profileByTargetOpenId && sourceProfile.id !== profileByTargetOpenId.id) {
    const references = await countBusinessReferences(sourceProfile.id);
    if (references > 0) {
      throw new Error(`Cannot merge role ${account.role}: the legacy app-user row is referenced by ${references} product/order record(s).`);
    }
    throw new Error(`Both legacy and target app-user rows exist for role ${account.role}; resolve the duplicate before seeding.`);
  }

  const mustReassignOpenId = Boolean(sourceProfile && existingAuth && sourceProfile.openId !== existingAuth.id);
  if (mustReassignOpenId) {
    const references = await countBusinessReferences(sourceProfile!.id);
    if (references > 0) {
      throw new Error(`Cannot move role ${account.role} to the target Auth identity: the existing app-user row is referenced by ${references} product/order record(s).`);
    }
    const conflictingProfile = (await db.select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.openId, existingAuth!.id))
      .limit(1))[0];
    if (conflictingProfile && conflictingProfile.id !== sourceProfile!.id) {
      throw new Error(`The target Auth identity is already linked to another app-user row for role ${account.role}.`);
    }
  }

  const authInput = {
    email: account.email,
    email_confirm: true,
    ...(account.displayName ? { user_metadata: { name: account.displayName, role: account.role } } : {}),
  };
  const authResult = existingAuth
    ? await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, authInput)
    : await supabaseAdmin.auth.admin.createUser({
        ...authInput,
        password: account.password,
        user_metadata: { name: account.displayName ?? account.email, role: account.role },
      });
  if (authResult.error || !authResult.data.user) {
    throw new Error(`Unable to provision the Auth account for role ${account.role}.`);
  }

  const userProfile = {
    openId: authResult.data.user.id,
    email: account.email,
    role: account.role,
    ...(account.displayName ? { name: account.displayName } : {}),
    approvalStatus: "approved" as const,
    ...(account.setVerificationApproved ? { verificationStatus: "approved" as const } : {}),
    ...(!sourceProfile ? {
      name: account.displayName ?? account.email,
      loginMethod: "supabase",
      cooperativeId: account.cooperativeId,
    } : {}),
  };

  if (sourceProfile) {
    await db.update(schema.users).set(userProfile).where(eq(schema.users.id, sourceProfile.id));
  } else {
    await db.insert(schema.users).values(userProfile);
  }

  summary.push({ role: account.role, email: account.email, status: existingAuth ? "updated" : "created" });
}

const sellerEmail = process.env.SEED_SELLER_EMAIL!.trim();
const seller = (await db.select({ id: schema.users.id, cooperativeId: schema.users.cooperativeId })
  .from(schema.users)
  .where(and(eq(schema.users.email, sellerEmail), eq(schema.users.role, "seller")))
  .limit(1))[0];
if (!seller) throw new Error("The configured seller profile was not found after account seeding.");

for (const product of productCatalog) {
  const existing = (await db.select({ id: schema.products.id, status: schema.products.status })
    .from(schema.products)
    .where(and(eq(schema.products.name, product.name), eq(schema.products.sellerId, seller.id)))
    .limit(1))[0];
  if (existing) {
    productsSkipped += 1;
    if (existing.status === "archived") archivedProductsSkipped += 1;
    continue;
  }

  await db.insert(schema.products).values({
    sellerId: seller.id,
    cooperativeId: seller.cooperativeId,
    name: product.name,
    category: product.category,
    variety: product.variety,
    description: product.description,
    unit: product.unit,
    priceCents: product.priceCents,
    stockQty: 100,
    minOrderQty: 1,
    qualityGrade: "standard",
    status: "published",
    verificationStatus: "approved",
    visibility: "visible",
  });
  productsCreated += 1;
}

console.log(JSON.stringify({
  usersByRole: summary,
  products: {
    catalogSize: productCatalog.length,
    created: productsCreated,
    skippedExisting: productsSkipped,
    skippedArchived: archivedProductsSkipped,
  },
}, null, 2));
} finally {
  await db.$client.end();
}
