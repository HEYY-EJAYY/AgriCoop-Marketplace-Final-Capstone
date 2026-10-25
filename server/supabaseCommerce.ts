import { supabaseAdmin } from "./clients.js";
import {
  getSupabaseInventory,
  isPublicSupabaseProductStatus,
  isUuid,
  loadSupabaseSellerProfiles,
  type SupabaseInventoryRow,
  type SupabaseProductRow,
} from "./supabaseData.js";
import type { SupabaseDatabase } from "./supabaseTypes.js";

type SupabaseProductWithInventory = SupabaseProductRow & {
  stockQty: number;
  sellerName: string | null;
  cooperativeId: string | null;
  sellerRoleName: string | null;
  sellerApproved: boolean;
};

export const SUPABASE_PRODUCT_ACTIVE_STATUS = "available";
export const SUPABASE_PRODUCT_ARCHIVED_STATUS = "archived";

function throwCommerceError(
  operation: string,
  error: { message: string } | null
) {
  if (error) throw new Error(`Supabase ${operation} failed.`);
}

function moneyToCents(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("The database contains an invalid monetary value.");
  return Math.round(amount * 100);
}

async function loadProducts(
  productIds?: string[]
): Promise<SupabaseProductWithInventory[]> {
  let query = supabaseAdmin
    .from("products")
    .select(
      "product_id,seller_id,product_name,category,price,unit,description,status,created_at"
    );
  if (productIds) {
    if (!productIds.length) return [];
    query = query.in("product_id", productIds);
  }
  const products = await query;
  throwCommerceError("product lookup", products.error);
  const rows = products.data ?? [];
  const inventory = await getSupabaseInventory(rows.map(row => row.product_id));
  const inventoryByProduct = new Map(
    inventory.map(row => [row.product_id, row.stock_quantity])
  );
  const sellerIds = Array.from(new Set(rows.map(row => row.seller_id)));
  const profileById = await loadSupabaseSellerProfiles(sellerIds);
  return rows.map(row => {
    const profile = profileById.get(row.seller_id);
    return {
      ...row,
      stockQty: Math.max(
        0,
        Number(inventoryByProduct.get(row.product_id) ?? 0)
      ),
      sellerName: profile?.full_name ?? null,
      cooperativeId: profile?.cooperative_id ?? null,
      sellerRoleName: profile?.roleName ?? null,
      sellerApproved: profile?.isApproved ?? false,
    };
  });
}

function productManagementView(product: SupabaseProductWithInventory) {
  const publicProduct = isPublicSupabaseProductStatus(product.status);
  return {
    id: product.product_id,
    sellerId: product.seller_id,
    cooperativeId: product.cooperativeId,
    name: product.product_name,
    category: product.category ?? "General",
    variety: product.category ?? "General",
    description: product.description ?? "",
    unit: product.unit ?? "unit",
    priceCents: moneyToCents(product.price),
    stockQty: product.stockQty,
    minOrderQty: 1,
    qualityGrade: "standard" as const,
    status: product.status ?? SUPABASE_PRODUCT_ARCHIVED_STATUS,
    verificationStatus: publicProduct
      ? "approved"
      : (product.status ?? "pending"),
    visibility: publicProduct ? "visible" : "hidden",
    primaryImageUrl: null,
    sellerName: product.sellerName,
  };
}

export async function listSupabaseSellerProducts(sellerId: string) {
  const products = (await loadProducts()).filter(
    product => product.seller_id === sellerId
  );
  return products.map(productManagementView);
}

export type SupabaseProductWriteInput = {
  sellerId: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  priceCents: number;
  stockQty: number;
  status?: "available" | "archived";
};

export function validateSupabaseProductWrite(input: SupabaseProductWriteInput) {
  if (!isUuid(input.sellerId)) throw new Error("Seller identity is invalid.");
  if (input.name.trim().length < 2 || input.name.length > 160)
    throw new Error("Product name must be between 2 and 160 characters.");
  if (input.category.trim().length < 2 || input.category.length > 80)
    throw new Error("Product category is invalid.");
  if (!input.description.trim() || input.description.length > 1200)
    throw new Error("Product description is invalid.");
  if (!input.unit.trim() || input.unit.length > 40)
    throw new Error("Product unit is invalid.");
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents <= 0)
    throw new Error("Product price must be a positive whole number of cents.");
  if (!Number.isSafeInteger(input.stockQty) || input.stockQty < 0)
    throw new Error("Inventory quantity must be a non-negative whole number.");
}

async function writeInventory(productId: string, stockQty: number) {
  const current = await supabaseAdmin
    .from("inventory")
    .select("inventory_id")
    .eq("product_id", productId)
    .maybeSingle();
  throwCommerceError("inventory lookup", current.error);
  if (current.data) {
    const updated = await supabaseAdmin
      .from("inventory")
      .update({
        stock_quantity: stockQty,
        last_updated: new Date().toISOString(),
      })
      .eq("inventory_id", current.data.inventory_id);
    throwCommerceError("inventory update", updated.error);
  } else {
    const created = await supabaseAdmin.from("inventory").insert({
      product_id: productId,
      stock_quantity: stockQty,
      last_updated: new Date().toISOString(),
    });
    throwCommerceError("inventory creation", created.error);
  }
}

export async function createSupabaseProduct(input: SupabaseProductWriteInput) {
  validateSupabaseProductWrite(input);
  const created = await supabaseAdmin
    .from("products")
    .insert({
      seller_id: input.sellerId,
      product_name: input.name.trim(),
      category: input.category.trim(),
      description: input.description.trim(),
      unit: input.unit.trim(),
      price: input.priceCents / 100,
      status: input.status ?? SUPABASE_PRODUCT_ACTIVE_STATUS,
    })
    .select("product_id")
    .single();
  throwCommerceError("product creation", created.error);
  if (!created.data) throw new Error("Product creation returned no record.");
  try {
    await writeInventory(created.data.product_id, input.stockQty);
  } catch (error) {
    await supabaseAdmin
      .from("products")
      .delete()
      .eq("product_id", created.data.product_id)
      .eq("seller_id", input.sellerId);
    throw error;
  }
  return { success: true, productId: created.data.product_id };
}

export async function updateSupabaseProduct(
  input: SupabaseProductWriteInput & { productId: string }
) {
  validateSupabaseProductWrite(input);
  if (!isUuid(input.productId)) throw new Error("Product identity is invalid.");
  const current = await supabaseAdmin
    .from("products")
    .select(
      "product_id,seller_id,product_name,category,price,unit,description,status,created_at"
    )
    .eq("product_id", input.productId)
    .eq("seller_id", input.sellerId)
    .maybeSingle();
  throwCommerceError("product lookup", current.error);
  if (!current.data)
    throw new Error(
      "This product is unavailable or belongs to another seller."
    );
  const updated = await supabaseAdmin
    .from("products")
    .update({
      product_name: input.name.trim(),
      category: input.category.trim(),
      description: input.description.trim(),
      unit: input.unit.trim(),
      price: input.priceCents / 100,
      status: input.status ?? current.data.status,
    })
    .eq("product_id", input.productId)
    .eq("seller_id", input.sellerId);
  throwCommerceError("product update", updated.error);
  try {
    await writeInventory(input.productId, input.stockQty);
  } catch (error) {
    await supabaseAdmin
      .from("products")
      .update({
        product_name: current.data.product_name,
        category: current.data.category,
        description: current.data.description,
        unit: current.data.unit,
        price: current.data.price,
        status: current.data.status,
      })
      .eq("product_id", input.productId)
      .eq("seller_id", input.sellerId);
    throw error;
  }
  return { success: true };
}

export async function archiveSupabaseProduct(
  sellerId: string,
  productId: string
) {
  if (!isUuid(sellerId) || !isUuid(productId))
    throw new Error("Product identity is invalid.");
  const updated = await supabaseAdmin
    .from("products")
    .update({ status: SUPABASE_PRODUCT_ARCHIVED_STATUS })
    .eq("product_id", productId)
    .eq("seller_id", sellerId)
    .select("product_id")
    .maybeSingle();
  throwCommerceError("product archive", updated.error);
  if (!updated.data)
    throw new Error(
      "This product is unavailable or belongs to another seller."
    );
  return { success: true };
}

function assertPublicProduct(
  product: SupabaseProductWithInventory | undefined
): asserts product is SupabaseProductWithInventory {
  if (
    !product ||
    !isPublicSupabaseProductStatus(product.status) ||
    product.sellerRoleName !== "seller" ||
    !product.sellerApproved
  ) {
    throw new Error("The selected product is not currently listed.");
  }
}

type SupabaseQuotationHeader = Pick<
  SupabaseDatabase["public"]["Tables"]["quotations"]["Row"],
  "quotation_id" | "buyer_id" | "status" | "created_at"
>;
type SupabaseQuotationItem = Pick<
  SupabaseDatabase["public"]["Tables"]["quotation_items"]["Row"],
  "product_id" | "requested_quantity" | "proposed_price"
>;

function quotationView(
  quotation: SupabaseQuotationHeader,
  item: SupabaseQuotationItem,
  product: SupabaseProductWithInventory | undefined
) {
  return {
    quotation: {
      id: quotation.quotation_id,
      productId: item.product_id,
      buyerId: quotation.buyer_id,
      requestedQty: Number(item.requested_quantity),
      buyerNote: null,
      quotedPriceCents:
        item.proposed_price === null || item.proposed_price === undefined
          ? null
          : moneyToCents(item.proposed_price),
      sellerNote: null,
      status: quotation.status ?? "requested",
      createdAt: quotation.created_at,
      updatedAt: quotation.created_at,
      respondedAt: null,
    },
    productName: product?.product_name ?? "Unavailable product",
    unit: product?.unit ?? "unit",
    sellerName: product?.sellerName ?? null,
  };
}

export async function listSupabaseBuyerQuotations(buyerId: string) {
  const quotations = await supabaseAdmin
    .from("quotations")
    .select("quotation_id,buyer_id,officer_id,status,created_at")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });
  throwCommerceError("quotation lookup", quotations.error);
  const headers = quotations.data ?? [];
  if (!headers.length) return [];
  const items = await supabaseAdmin
    .from("quotation_items")
    .select(
      "quotation_item_id,quotation_id,product_id,requested_quantity,proposed_price"
    )
    .in(
      "quotation_id",
      headers.map(row => row.quotation_id)
    );
  throwCommerceError("quotation item lookup", items.error);
  const products = await loadProducts(
    Array.from(new Set((items.data ?? []).map(row => row.product_id)))
  );
  const productById = new Map(
    products.map(product => [product.product_id, product])
  );
  return headers.flatMap(header =>
    (items.data ?? [])
      .filter(item => item.quotation_id === header.quotation_id)
      .map(item =>
        quotationView(header, item, productById.get(item.product_id))
      )
  );
}

export async function createSupabaseQuotation(input: {
  buyerId: string;
  productId: string;
  requestedQty: number;
}) {
  if (
    !isUuid(input.productId) ||
    !Number.isSafeInteger(input.requestedQty) ||
    input.requestedQty <= 0
  )
    throw new Error("Quotation input is invalid.");
  const product = (await loadProducts([input.productId]))[0];
  assertPublicProduct(product);
  if (input.buyerId === product.seller_id)
    throw new Error("You cannot request a quotation for your own listing.");
  if (input.requestedQty > product.stockQty)
    throw new Error(
      `Only ${product.stockQty} ${product.unit ?? "unit"} are currently available.`
    );

  const header = await supabaseAdmin
    .from("quotations")
    .insert({ buyer_id: input.buyerId, status: "requested" })
    .select("quotation_id")
    .single();
  throwCommerceError("quotation creation", header.error);
  if (!header.data) throw new Error("Quotation creation returned no record.");
  const item = await supabaseAdmin
    .from("quotation_items")
    .insert({
      quotation_id: header.data.quotation_id,
      product_id: input.productId,
      requested_quantity: input.requestedQty,
      proposed_price: null,
    })
    .select("quotation_item_id")
    .single();
  if (item.error || !item.data) {
    await supabaseAdmin
      .from("quotations")
      .delete()
      .eq("quotation_id", header.data.quotation_id);
    throw new Error("Quotation items could not be saved.");
  }
  return { success: true, quotationId: header.data.quotation_id };
}

export async function decideSupabaseQuotation(input: {
  buyerId: string;
  quotationId: string;
  status: "accepted" | "declined";
}) {
  if (!isUuid(input.quotationId)) throw new Error("Quotation ID is invalid.");
  const updated = await supabaseAdmin
    .from("quotations")
    .update({ status: input.status })
    .eq("quotation_id", input.quotationId)
    .eq("buyer_id", input.buyerId)
    .eq("status", "responded")
    .select("quotation_id")
    .maybeSingle();
  throwCommerceError("quotation decision", updated.error);
  if (!updated.data)
    throw new Error(
      "That quotation is unavailable or no longer awaiting your decision."
    );
  return { success: true };
}

export async function createSupabaseOrder(input: {
  buyerId: string;
  items: Array<{ productId: string; quantity: number }>;
  quotationId?: string;
}) {
  if (
    !input.items.length ||
    input.items.some(
      item =>
        !isUuid(item.productId) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0
    )
  )
    throw new Error("Order items are invalid.");
  const uniqueIds = Array.from(
    new Set(input.items.map(item => item.productId))
  );
  const products = await loadProducts(uniqueIds);
  if (
    products.length !== uniqueIds.length ||
    products.some(product => !isPublicSupabaseProductStatus(product.status))
  )
    throw new Error(
      "One or more products are no longer available for purchase."
    );
  const productById = new Map(
    products.map(product => [product.product_id, product])
  );
  const sellerIds = new Set(products.map(product => product.seller_id));
  if (sellerIds.size !== 1)
    throw new Error("An order must contain products from one seller.");
  const lines = input.items.map(item => {
    const product = productById.get(item.productId);
    assertPublicProduct(product);
    if (item.quantity > product.stockQty)
      throw new Error(
        `Only ${product.stockQty} ${product.unit ?? "unit"} are currently available.`
      );
    const unitPriceCents = moneyToCents(product.price);
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPriceCents,
      subtotalCents: unitPriceCents * item.quantity,
    };
  });

  let quotedPriceCents: number | null = null;
  if (input.quotationId) {
    if (!isUuid(input.quotationId)) throw new Error("Quotation ID is invalid.");
    const quotation = await supabaseAdmin
      .from("quotations")
      .select("quotation_id,buyer_id,status")
      .eq("quotation_id", input.quotationId)
      .eq("buyer_id", input.buyerId)
      .maybeSingle();
    throwCommerceError("accepted quotation lookup", quotation.error);
    if (
      !quotation.data ||
      quotation.data.status !== "accepted" ||
      lines.length !== 1
    )
      throw new Error(
        "Only your accepted quotation can be used for this order."
      );
    const quotationItem = await supabaseAdmin
      .from("quotation_items")
      .select("product_id,requested_quantity,proposed_price")
      .eq("quotation_id", input.quotationId)
      .maybeSingle();
    throwCommerceError("accepted quotation item lookup", quotationItem.error);
    if (
      !quotationItem.data ||
      quotationItem.data.product_id !== lines[0].productId ||
      Number(quotationItem.data.requested_quantity) !== lines[0].quantity ||
      quotationItem.data.proposed_price === null
    )
      throw new Error("The order does not match the accepted quotation.");
    quotedPriceCents = moneyToCents(quotationItem.data.proposed_price);
    lines[0].unitPriceCents = quotedPriceCents;
    lines[0].subtotalCents = quotedPriceCents * lines[0].quantity;
  }
  const totalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const order = await supabaseAdmin
    .from("orders")
    .insert({
      buyer_id: input.buyerId,
      officer_id: null,
      order_type: lines.length === 1 ? "regular" : "bulk",
      status: "submitted",
      total_amount: totalCents / 100,
    })
    .select("order_id")
    .single();
  throwCommerceError("order creation", order.error);
  if (!order.data) throw new Error("Order creation returned no record.");
  const orderItems = await supabaseAdmin.from("order_items").insert(
    lines.map(line => ({
      order_id: order.data.order_id,
      product_id: line.productId,
      quantity: line.quantity,
      subtotal: line.subtotalCents / 100,
    }))
  );
  if (orderItems.error) {
    await supabaseAdmin
      .from("orders")
      .delete()
      .eq("order_id", order.data.order_id);
    throw new Error("Order items could not be saved.");
  }
  const transaction = await supabaseAdmin.from("transactions").insert({
    order_id: order.data.order_id,
    payment_method: "f2f",
    payment_status: "pending",
    gateway_reference: null,
    total_amount: totalCents / 100,
  });
  if (transaction.error) {
    await supabaseAdmin
      .from("order_items")
      .delete()
      .eq("order_id", order.data.order_id);
    await supabaseAdmin
      .from("orders")
      .delete()
      .eq("order_id", order.data.order_id);
    throw new Error("The transaction record could not be saved.");
  }
  return { success: true, orderId: order.data.order_id };
}

export async function listSupabaseBuyerOrders(buyerId: string) {
  const orders = await supabaseAdmin
    .from("orders")
    .select(
      "order_id,buyer_id,officer_id,order_type,status,total_amount,created_at"
    )
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });
  throwCommerceError("order lookup", orders.error);
  const headers = orders.data ?? [];
  if (!headers.length) return [];
  const items = await supabaseAdmin
    .from("order_items")
    .select("order_item_id,order_id,product_id,quantity,subtotal")
    .in(
      "order_id",
      headers.map(row => row.order_id)
    );
  throwCommerceError("order item lookup", items.error);
  const productRows = await loadProducts(
    Array.from(new Set((items.data ?? []).map(row => row.product_id)))
  );
  const productById = new Map(
    productRows.map(product => [product.product_id, product])
  );
  const transactions = await supabaseAdmin
    .from("transactions")
    .select("order_id,payment_method,payment_status,total_amount")
    .in(
      "order_id",
      headers.map(row => row.order_id)
    );
  throwCommerceError("transaction lookup", transactions.error);
  const transactionByOrder = new Map(
    (transactions.data ?? []).map(row => [row.order_id, row])
  );
  return headers.map(header => {
    const orderItems = (items.data ?? []).filter(
      item => item.order_id === header.order_id
    );
    const productsForOrder = orderItems
      .map(item => productById.get(item.product_id))
      .filter((product): product is SupabaseProductWithInventory =>
        Boolean(product)
      );
    const seller = productsForOrder[0];
    const transaction = transactionByOrder.get(header.order_id);
    return {
      order: {
        id: header.order_id,
        buyerId: header.buyer_id,
        sellerId: seller?.seller_id ?? null,
        cooperativeId: seller?.cooperativeId ?? null,
        orderType: header.order_type,
        status: header.status,
        paymentStatus: transaction?.payment_status ?? "pending",
        paymentMethod: transaction?.payment_method ?? "f2f",
        totalCents: moneyToCents(header.total_amount),
        buyerNote: null,
        completedAt: null,
        createdAt: header.created_at,
        updatedAt: header.created_at,
      },
      sellerName: seller?.sellerName ?? null,
      cooperativeName: null,
      items: orderItems.map(item => ({
        item: {
          id: item.order_item_id,
          orderId: item.order_id,
          productId: item.product_id,
          quantity: Number(item.quantity),
          unitPriceCents:
            Number(item.quantity) > 0
              ? moneyToCents(item.subtotal) / Number(item.quantity)
              : 0,
          createdAt: header.created_at,
          updatedAt: header.created_at,
        },
        productName:
          productById.get(item.product_id)?.product_name ??
          "Unavailable product",
        unit: productById.get(item.product_id)?.unit ?? "unit",
      })),
    };
  });
}
