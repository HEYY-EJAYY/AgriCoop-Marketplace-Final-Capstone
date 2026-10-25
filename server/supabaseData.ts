import { supabase, supabaseAdmin } from "./clients.js";

export type SupabaseCooperativeRow = {
  cooperative_id: string;
  name: string;
  location: string | null;
  created_at: string;
};

export type SupabaseProductRow = {
  product_id: string;
  seller_id: string;
  product_name: string;
  category: string | null;
  price: number;
  unit: string | null;
  description: string | null;
  status: string | null;
  created_at: string;
};

export type SupabaseInventoryRow = {
  inventory_id: string;
  product_id: string;
  stock_quantity: number;
  last_updated: string;
};

export type SupabaseMarketplaceProduct = SupabaseProductRow & {
  stock_quantity: number;
  seller_name: string | null;
  cooperative_name: string | null;
};

export type SupabaseMarketplaceListing = {
  product: {
    id: string;
    sellerId: string;
    cooperativeId: string | null;
    name: string;
    category: string;
    variety: string;
    description: string;
    unit: string;
    priceCents: number;
    stockQty: number;
    minOrderQty: number;
    qualityGrade: "standard";
    status: "published";
    verificationStatus: "approved";
    visibility: "visible";
    primaryImageUrl: null;
  };
  sellerName: string | null;
  cooperativeName: string | null;
};

const PUBLIC_PRODUCT_STATUSES = new Set(["active", "available", "approved", "published", "visible"]);

export function isPublicSupabaseProductStatus(status: string | null | undefined) {
  return PUBLIC_PRODUCT_STATUSES.has(status?.trim().toLowerCase() ?? "");
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function throwSupabaseError(operation: string, error: { message: string } | null) {
  if (error) throw new Error(`Supabase ${operation} failed.`);
}

export async function listSupabaseCooperatives(): Promise<SupabaseCooperativeRow[]> {
  const { data, error } = await supabaseAdmin
    .from("cooperatives")
    .select("cooperative_id,name,location,created_at")
    .order("name", { ascending: true });
  throwSupabaseError("cooperative lookup", error);
  return (data ?? []) as SupabaseCooperativeRow[];
}

export async function findSupabaseCooperative(cooperativeId: string): Promise<SupabaseCooperativeRow | null> {
  const { data, error } = await supabaseAdmin
    .from("cooperatives")
    .select("cooperative_id,name,location,created_at")
    .eq("cooperative_id", cooperativeId)
    .maybeSingle();
  throwSupabaseError("cooperative lookup", error);
  return (data as SupabaseCooperativeRow | null) ?? null;
}

export async function findOrCreateSupabaseCooperative(name: string): Promise<SupabaseCooperativeRow> {
  const existing = await supabaseAdmin
    .from("cooperatives")
    .select("cooperative_id,name,location,created_at")
    .eq("name", name)
    .maybeSingle();
  throwSupabaseError("cooperative lookup", existing.error);
  if (existing.data) return existing.data as SupabaseCooperativeRow;

  const created = await supabaseAdmin
    .from("cooperatives")
    .insert({ name, location: "Not specified" })
    .select("cooperative_id,name,location,created_at")
    .single();
  throwSupabaseError("cooperative creation", created.error);
  if (!created.data) throw new Error("Supabase cooperative creation returned no record.");
  return created.data as SupabaseCooperativeRow;
}

export async function getSupabaseRoleId(roleName: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("roles")
    .select("role_id")
    .eq("role_name", roleName)
    .maybeSingle();
  throwSupabaseError("role lookup", error);
  if (!data) throw new Error("The requested Supabase role is not configured.");
  return Number(data.role_id);
}

export async function createSupabaseProfile(input: {
  userId: string;
  fullName: string;
  email: string;
  roleId: number;
  cooperativeId: string | null;
  accountStatus: "approved" | "pending";
}) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .insert({
      user_id: input.userId,
      full_name: input.fullName,
      email: input.email,
      role_id: input.roleId,
      cooperative_id: input.cooperativeId,
      account_status: input.accountStatus,
    })
    .select("user_id,full_name,email,role_id,cooperative_id,account_status")
    .single();
  throwSupabaseError("profile creation", error);
  if (!data) throw new Error("Supabase profile creation returned no record.");
  return data;
}

export async function listSupabaseProducts(category?: string): Promise<SupabaseProductRow[]> {
  let query = supabaseAdmin
    .from("products")
    .select("product_id,seller_id,product_name,category,price,unit,description,status,created_at")
    .order("created_at", { ascending: false });
  if (category && category !== "all") query = query.eq("category", category);
  const { data, error } = await query;
  throwSupabaseError("product lookup", error);
  return (data ?? []) as SupabaseProductRow[];
}

export async function getSupabaseInventory(productIds: string[]): Promise<SupabaseInventoryRow[]> {
  if (productIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("inventory")
    .select("inventory_id,product_id,stock_quantity,last_updated")
    .in("product_id", productIds);
  throwSupabaseError("inventory lookup", error);
  return (data ?? []) as SupabaseInventoryRow[];
}

export async function listSupabaseMarketplace(category?: string, sort: "asc" | "desc" = "asc"): Promise<SupabaseMarketplaceListing[]> {
  let query = supabase
    .from("products")
    .select("product_id,seller_id,product_name,category,price,unit,description,status,created_at");
  if (category && category !== "all") query = query.eq("category", category);
  const { data, error } = await query;
  throwSupabaseError("marketplace lookup", error);

  const rows = ((data ?? []) as SupabaseProductRow[]).filter(row => isPublicSupabaseProductStatus(row.status));
  const inventories = await getSupabaseInventory(rows.map(row => row.product_id));
  const inventoryByProduct = new Map(inventories.map(row => [row.product_id, row.stock_quantity]));
  const sellerIds = Array.from(new Set(rows.map(row => row.seller_id)));
  const profiles = sellerIds.length
    ? await supabaseAdmin.from("profiles").select("user_id,full_name,cooperative_id").in("user_id", sellerIds)
    : { data: [], error: null };
  throwSupabaseError("seller lookup", profiles.error);
  const profileById = new Map((profiles.data ?? []).map(row => [row.user_id, row]));
  const cooperativeIds = Array.from(new Set((profiles.data ?? []).map(row => row.cooperative_id).filter((id): id is string => Boolean(id))));
  const cooperatives = cooperativeIds.length
    ? await supabaseAdmin.from("cooperatives").select("cooperative_id,name").in("cooperative_id", cooperativeIds)
    : { data: [], error: null };
  throwSupabaseError("cooperative lookup", cooperatives.error);
  const cooperativeById = new Map((cooperatives.data ?? []).map(row => [row.cooperative_id, row.name]));

  const listings = rows.map(row => {
    const profile = profileById.get(row.seller_id);
    const numericPrice = Number(row.price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) return null;
    const categoryName = row.category?.trim() || "General";
    return {
      product: {
        id: row.product_id,
        sellerId: row.seller_id,
        cooperativeId: profile?.cooperative_id ?? null,
        name: row.product_name,
        category: categoryName,
        variety: categoryName,
        description: row.description ?? "",
        unit: row.unit ?? "unit",
        priceCents: Math.round(numericPrice * 100),
        stockQty: Math.max(0, Number(inventoryByProduct.get(row.product_id) ?? 0)),
        minOrderQty: 1,
        qualityGrade: "standard" as const,
        status: "published" as const,
        verificationStatus: "approved" as const,
        visibility: "visible" as const,
        primaryImageUrl: null,
      },
      sellerName: profile?.full_name ?? null,
      cooperativeName: profile?.cooperative_id ? cooperativeById.get(profile.cooperative_id) ?? null : null,
    } satisfies SupabaseMarketplaceListing;
  }).filter((listing): listing is SupabaseMarketplaceListing => listing !== null);

  return listings.sort((left, right) => sort === "asc"
    ? left.product.priceCents - right.product.priceCents
    : right.product.priceCents - left.product.priceCents);
}

export async function getSupabaseMarketplaceProduct(productId: string): Promise<SupabaseMarketplaceListing | null> {
  if (!isUuid(productId)) return null;
  const listings = await listSupabaseMarketplace();
  return listings.find(listing => listing.product.id === productId) ?? null;
}

export async function listSupabaseMarketplaceCategories(): Promise<Array<{ category: string }>> {
  const listings = await listSupabaseMarketplace();
  return Array.from(new Set(listings.map(listing => listing.product.category)))
    .sort((a, b) => a.localeCompare(b))
    .map(category => ({ category }));
}
