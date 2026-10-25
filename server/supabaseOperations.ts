import { supabaseAdmin } from "./clients.js";
import {
  mapSupabaseAccountStatus,
  mapSupabaseRole,
} from "./supabaseProfiles.js";
import { getSupabaseRoleId } from "./supabaseData.js";
import {
  archiveSupabaseProduct,
  listSupabaseSellerProducts,
  SUPABASE_PRODUCT_ACTIVE_STATUS,
  SUPABASE_PRODUCT_ARCHIVED_STATUS,
} from "./supabaseCommerce.js";
import {
  getSupabaseInventory,
  isUuid,
  type SupabaseInventoryRow,
} from "./supabaseData.js";

function throwOperationError(
  operation: string,
  error: { message: string } | null
) {
  if (error) throw new Error(`Supabase ${operation} failed.`);
}

async function getCooperativeMembers(cooperativeId: string) {
  const profiles = await supabaseAdmin
    .from("profiles")
    .select("user_id,full_name,email,role_id,cooperative_id,account_status")
    .eq("cooperative_id", cooperativeId)
    .order("full_name", { ascending: true });
  throwOperationError("cooperative member lookup", profiles.error);
  const roles = await supabaseAdmin.from("roles").select("role_id,role_name");
  throwOperationError("role lookup", roles.error);
  const roleById = new Map(
    (roles.data ?? []).map(row => [row.role_id, row.role_name])
  );
  return (profiles.data ?? []).map(profile => ({
    id: profile.user_id,
    name: profile.full_name,
    email: profile.email,
    role: mapSupabaseRole(roleById.get(profile.role_id ?? -1)) ?? "buyer",
    approvalStatus: mapSupabaseAccountStatus(profile.account_status),
    cooperativeId: profile.cooperative_id,
  }));
}

async function getCooperativeProductIds(cooperativeId: string) {
  const members = await getCooperativeMembers(cooperativeId);
  if (!members.length)
    return { members, products: [], productIds: [] as string[] };
  const products = await supabaseAdmin
    .from("products")
    .select(
      "product_id,seller_id,product_name,category,price,unit,description,status,created_at"
    )
    .in(
      "seller_id",
      members.map(member => member.id)
    );
  throwOperationError("cooperative product lookup", products.error);
  return {
    members,
    products: products.data ?? [],
    productIds: (products.data ?? []).map(product => product.product_id),
  };
}

export async function getSupabaseOfficerOverview(cooperativeId: string) {
  const { members, products, productIds } =
    await getCooperativeProductIds(cooperativeId);
  const inventory = await getSupabaseInventory(productIds);
  const inventoryByProduct = new Map(
    inventory.map(row => [row.product_id, row.stock_quantity])
  );
  const sellerProducts = (
    await Promise.all(
      members
        .filter(member => member.role === "seller")
        .map(member => listSupabaseSellerProducts(member.id))
    )
  ).flat();

  const quotationItems = productIds.length
    ? await supabaseAdmin
        .from("quotation_items")
        .select(
          "quotation_item_id,quotation_id,product_id,requested_quantity,proposed_price"
        )
        .in("product_id", productIds)
    : { data: [], error: null };
  throwOperationError(
    "cooperative quotation item lookup",
    quotationItems.error
  );
  const quotationIds = Array.from(
    new Set((quotationItems.data ?? []).map(item => item.quotation_id))
  );
  const quotations = quotationIds.length
    ? await supabaseAdmin
        .from("quotations")
        .select("quotation_id,buyer_id,officer_id,status,created_at")
        .in("quotation_id", quotationIds)
    : { data: [], error: null };
  throwOperationError("cooperative quotation lookup", quotations.error);
  const buyerIds = Array.from(
    new Set((quotations.data ?? []).map(quotation => quotation.buyer_id))
  );
  const buyers = buyerIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("user_id,full_name")
        .in("user_id", buyerIds)
    : { data: [], error: null };
  throwOperationError("quotation buyer lookup", buyers.error);
  const buyerById = new Map(
    (buyers.data ?? []).map(buyer => [buyer.user_id, buyer.full_name])
  );
  const productById = new Map(
    products.map(product => [product.product_id, product])
  );
  const quotationById = new Map(
    (quotations.data ?? []).map(quotation => [
      quotation.quotation_id,
      quotation,
    ])
  );
  const quotationViews = (quotationItems.data ?? []).flatMap(item => {
    const quotation = quotationById.get(item.quotation_id);
    const product = productById.get(item.product_id);
    if (!quotation || !product) return [];
    return [
      {
        quotation: {
          id: quotation.quotation_id,
          buyerId: quotation.buyer_id,
          productId: product.product_id,
          requestedQty: Number(item.requested_quantity),
          quotedPriceCents:
            item.proposed_price === null
              ? null
              : Math.round(Number(item.proposed_price) * 100),
          status: quotation.status ?? "requested",
          createdAt: quotation.created_at,
        },
        productName: product.product_name,
        unit: product.unit ?? "unit",
        buyerName: buyerById.get(quotation.buyer_id) ?? null,
      },
    ];
  });

  const orderItems = productIds.length
    ? await supabaseAdmin
        .from("order_items")
        .select("order_item_id,order_id,product_id,quantity,subtotal")
        .in("product_id", productIds)
    : { data: [], error: null };
  throwOperationError("cooperative order item lookup", orderItems.error);
  const orderIds = Array.from(
    new Set((orderItems.data ?? []).map(item => item.order_id))
  );
  const orders = orderIds.length
    ? await supabaseAdmin
        .from("orders")
        .select(
          "order_id,buyer_id,officer_id,order_type,status,total_amount,created_at"
        )
        .in("order_id", orderIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  throwOperationError("cooperative order lookup", orders.error);
  const transactions = orderIds.length
    ? await supabaseAdmin
        .from("transactions")
        .select(
          "transaction_id,order_id,payment_method,payment_status,total_amount,paid_at,created_at"
        )
        .in("order_id", orderIds)
    : { data: [], error: null };
  throwOperationError("cooperative transaction lookup", transactions.error);

  return {
    members,
    products: sellerProducts,
    quotations: quotationViews,
    orders: orders.data ?? [],
    transactions: transactions.data ?? [],
    inventory: products.map(product => ({
      productId: product.product_id,
      name: product.product_name,
      stockQty: Number(inventoryByProduct.get(product.product_id) ?? 0),
      unit: product.unit ?? "unit",
    })),
    orderItems: orderItems.data ?? [],
  };
}

async function assertOfficerProductScope(officerId: string, productId: string) {
  const officer = await supabaseAdmin
    .from("profiles")
    .select("cooperative_id,role_id")
    .eq("user_id", officerId)
    .maybeSingle();
  throwOperationError("officer lookup", officer.error);
  if (!officer.data) throw new Error("Officer profile not found.");
  const roles = await supabaseAdmin.from("roles").select("role_id,role_name");
  throwOperationError("role lookup", roles.error);
  const officerRole = mapSupabaseRole(
    (roles.data ?? []).find(role => role.role_id === officer.data?.role_id)
      ?.role_name
  );
  if (officerRole !== "admin" && officerRole !== "superadmin")
    throw new Error(
      "Only cooperative officers can manage cooperative records."
    );
  if (officerRole !== "superadmin" && !officer.data?.cooperative_id)
    throw new Error(
      "Assign this officer to a cooperative before managing records."
    );
  const product = await supabaseAdmin
    .from("products")
    .select("product_id,seller_id")
    .eq("product_id", productId)
    .maybeSingle();
  throwOperationError("product scope lookup", product.error);
  if (!product.data) throw new Error("Product not found.");
  const seller = await supabaseAdmin
    .from("profiles")
    .select("cooperative_id")
    .eq("user_id", product.data.seller_id)
    .maybeSingle();
  throwOperationError("seller scope lookup", seller.error);
  if (
    officerRole !== "superadmin" &&
    seller.data?.cooperative_id !== officer.data?.cooperative_id
  )
    throw new Error("This record is outside your cooperative.");
  return {
    officerRole,
    cooperativeId: officer.data.cooperative_id,
    product: product.data,
  };
}

export async function reviewSupabaseProduct(
  officerId: string,
  productId: string,
  decision: "available" | "archived"
) {
  await assertOfficerProductScope(officerId, productId);
  const updated = await supabaseAdmin
    .from("products")
    .update({ status: decision })
    .eq("product_id", productId)
    .select("product_id")
    .maybeSingle();
  throwOperationError("product review", updated.error);
  if (!updated.data) throw new Error("Product review did not update a record.");
  return { success: true };
}

export async function updateSupabaseMemberStatus(
  officerId: string,
  targetUserId: string,
  accountStatus: "approved" | "suspended"
) {
  if (!isUuid(targetUserId)) throw new Error("Member identity is invalid.");
  const officer = await supabaseAdmin
    .from("profiles")
    .select("cooperative_id,role_id")
    .eq("user_id", officerId)
    .maybeSingle();
  throwOperationError("officer lookup", officer.error);
  const target = await supabaseAdmin
    .from("profiles")
    .select("cooperative_id")
    .eq("user_id", targetUserId)
    .maybeSingle();
  throwOperationError("member lookup", target.error);
  if (
    !target.data ||
    !officer.data?.cooperative_id ||
    target.data.cooperative_id !== officer.data.cooperative_id
  )
    throw new Error("This member is outside your cooperative.");
  const updated = await supabaseAdmin
    .from("profiles")
    .update({ account_status: accountStatus })
    .eq("user_id", targetUserId)
    .eq("cooperative_id", officer.data.cooperative_id)
    .select("user_id")
    .maybeSingle();
  throwOperationError("member status update", updated.error);
  if (!updated.data) throw new Error("Member status did not update.");
  return { success: true };
}

export async function reviewSupabaseQuotation(
  officerId: string,
  quotationId: string,
  decision: "responded" | "declined",
  proposedPriceCents?: number
) {
  if (!isUuid(quotationId)) throw new Error("Quotation identity is invalid.");
  if (
    decision === "responded" &&
    (!Number.isSafeInteger(proposedPriceCents) ||
      (proposedPriceCents ?? 0) <= 0)
  )
    throw new Error("A positive proposed price is required.");
  const quotation = await supabaseAdmin
    .from("quotations")
    .select("quotation_id,status")
    .eq("quotation_id", quotationId)
    .maybeSingle();
  throwOperationError("quotation lookup", quotation.error);
  if (!quotation.data || quotation.data.status !== "requested")
    throw new Error("That quotation is not awaiting a response.");
  const item = await supabaseAdmin
    .from("quotation_items")
    .select("quotation_item_id,product_id")
    .eq("quotation_id", quotationId)
    .maybeSingle();
  throwOperationError("quotation item lookup", item.error);
  if (!item.data) throw new Error("That quotation has no item.");
  await assertOfficerProductScope(officerId, item.data.product_id);
  const updatedItem = await supabaseAdmin
    .from("quotation_items")
    .update({
      proposed_price:
        decision === "responded" ? proposedPriceCents! / 100 : null,
    })
    .eq("quotation_item_id", item.data.quotation_item_id);
  throwOperationError("quotation item response", updatedItem.error);
  const updatedQuotation = await supabaseAdmin
    .from("quotations")
    .update({ officer_id: officerId, status: decision })
    .eq("quotation_id", quotationId)
    .eq("status", "requested")
    .select("quotation_id")
    .maybeSingle();
  throwOperationError("quotation response", updatedQuotation.error);
  if (!updatedQuotation.data)
    throw new Error("That quotation was updated by another request.");
  return { success: true };
}

const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  submitted: ["confirmed", "cancelled"],
  confirmed: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canAdvanceSupabaseOrder(
  currentStatus: string,
  nextStatus: string
) {
  return ORDER_STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

async function restoreInventoryChange(change: {
  inventoryId: string;
  quantity: number;
}) {
  const current = await supabaseAdmin
    .from("inventory")
    .select("stock_quantity")
    .eq("inventory_id", change.inventoryId)
    .maybeSingle();
  if (current.error || !current.data) return;
  await supabaseAdmin
    .from("inventory")
    .update({
      stock_quantity: Number(current.data.stock_quantity) + change.quantity,
      last_updated: new Date().toISOString(),
    })
    .eq("inventory_id", change.inventoryId);
}

export async function updateSupabaseOfficerOrder(
  officerId: string,
  orderId: string,
  nextStatus: "confirmed" | "ready" | "completed" | "cancelled"
) {
  if (!isUuid(orderId)) throw new Error("Order identity is invalid.");
  const order = await supabaseAdmin
    .from("orders")
    .select("order_id,status")
    .eq("order_id", orderId)
    .maybeSingle();
  throwOperationError("order lookup", order.error);
  if (!order.data) throw new Error("Order not found.");
  if (!canAdvanceSupabaseOrder(order.data.status ?? "", nextStatus))
    throw new Error("This order status transition is not valid.");
  const items = await supabaseAdmin
    .from("order_items")
    .select("order_item_id,product_id,quantity")
    .eq("order_id", orderId);
  throwOperationError("order item lookup", items.error);
  const productIds = Array.from(
    new Set((items.data ?? []).map(item => item.product_id))
  );
  for (const productId of productIds)
    await assertOfficerProductScope(officerId, productId);

  const deducted: Array<{ inventoryId: string; quantity: number }> = [];
  if (nextStatus === "completed") {
    const inventory = await getSupabaseInventory(productIds);
    const inventoryByProduct = new Map(
      inventory.map(row => [row.product_id, row])
    );
    try {
      for (const item of items.data ?? []) {
        const quantity = Number(item.quantity);
        const row = inventoryByProduct.get(item.product_id);
        if (!row || !Number.isSafeInteger(quantity) || quantity <= 0)
          throw new Error("Order inventory is invalid.");
        const updated = await supabaseAdmin
          .from("inventory")
          .update({
            stock_quantity: Number(row.stock_quantity) - quantity,
            last_updated: new Date().toISOString(),
          })
          .eq("inventory_id", row.inventory_id)
          .gte("stock_quantity", quantity)
          .select("inventory_id")
          .maybeSingle();
        throwOperationError("inventory deduction", updated.error);
        if (!updated.data)
          throw new Error("Insufficient inventory to complete this order.");
        deducted.push({ inventoryId: row.inventory_id, quantity });
      }
    } catch (error) {
      for (const change of deducted) await restoreInventoryChange(change);
      throw error;
    }
  }

  const updated = await supabaseAdmin
    .from("orders")
    .update({ status: nextStatus, officer_id: officerId })
    .eq("order_id", orderId)
    .eq("status", order.data.status ?? "")
    .select("order_id")
    .maybeSingle();
  throwOperationError("order status update", updated.error);
  if (!updated.data) {
    for (const change of deducted) await restoreInventoryChange(change);
    throw new Error("That order was updated by another request.");
  }
  return { success: true };
}

async function assertSystemAdmin(actorId: string) {
  const actor = await supabaseAdmin
    .from("profiles")
    .select("role_id")
    .eq("user_id", actorId)
    .maybeSingle();
  throwOperationError("administrator lookup", actor.error);
  if (!actor.data) throw new Error("Administrator profile not found.");
  if (actor.data.role_id === null)
    throw new Error("Administrator role is not configured.");
  const role = await supabaseAdmin
    .from("roles")
    .select("role_name")
    .eq("role_id", actor.data.role_id)
    .maybeSingle();
  throwOperationError("administrator role lookup", role.error);
  if (role.data?.role_name !== "system_admin")
    throw new Error("System administrator access is required.");
}

export async function getSupabaseAdminOverview() {
  const [profiles, products, orders, transactions, roles] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select(
        "user_id,full_name,email,role_id,cooperative_id,account_status,created_at"
      )
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("products")
      .select(
        "product_id,seller_id,product_name,category,price,unit,description,status,created_at"
      )
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("orders")
      .select(
        "order_id,buyer_id,officer_id,order_type,status,total_amount,created_at"
      )
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("transactions")
      .select(
        "transaction_id,order_id,payment_method,payment_status,gateway_reference,total_amount,paid_at,created_at"
      )
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("roles").select("role_id,role_name"),
  ]);
  throwOperationError("administrator profile overview", profiles.error);
  throwOperationError("administrator product overview", products.error);
  throwOperationError("administrator order overview", orders.error);
  throwOperationError("administrator transaction overview", transactions.error);
  throwOperationError("administrator role overview", roles.error);
  const roleById = new Map(
    (roles.data ?? []).map(role => [role.role_id, role.role_name])
  );
  const profileRows = (profiles.data ?? []).map(profile => ({
    ...profile,
    roleName: roleById.get(profile.role_id ?? -1) ?? null,
  }));
  // The live schema has no activity_logs table. Keep the field for the UI's
  // stable contract, but do not claim that activity events were recorded.
  return {
    profiles: profileRows,
    products: products.data ?? [],
    orders: orders.data ?? [],
    transactions: transactions.data ?? [],
    activityLogs: [],
  };
}

export async function updateSupabaseProfileAsAdmin(input: {
  actorId: string;
  targetUserId: string;
  roleName: "buyer" | "seller" | "coop_officer" | "system_admin";
  accountStatus: "approved" | "pending" | "suspended";
  cooperativeId: string | null;
}) {
  await assertSystemAdmin(input.actorId);
  if (!isUuid(input.targetUserId))
    throw new Error("Target user identity is invalid.");
  if (input.actorId === input.targetUserId && input.roleName !== "system_admin")
    throw new Error(
      "An administrator cannot remove their own system-admin role."
    );
  if (
    input.roleName !== "system_admin" &&
    input.cooperativeId === null &&
    input.roleName === "coop_officer"
  )
    throw new Error("A cooperative officer must be assigned to a cooperative.");
  const roleId = await getSupabaseRoleId(input.roleName);
  const updated = await supabaseAdmin
    .from("profiles")
    .update({
      role_id: roleId,
      account_status: input.accountStatus,
      cooperative_id: input.cooperativeId,
    })
    .eq("user_id", input.targetUserId)
    .select("user_id")
    .maybeSingle();
  throwOperationError("administrator profile update", updated.error);
  if (!updated.data) throw new Error("Target profile was not found.");
  return { success: true };
}
