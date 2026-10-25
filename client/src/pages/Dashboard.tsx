import { useAuth } from "@/_core/hooks/useAuth";
import { WorkspaceHeader } from "@/components/AgriShell";
import { goToAuth } from "@/const";
import { formatDateManila } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { PRODUCT_UNITS } from "../../../shared/productOptions";
import {
  BarChart3,
  Check,
  ClipboardList,
  FileText,
  Leaf,
  Loader2,
  Package,
  Plus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

const peso = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    cents / 100
  );
const when = (value: Date | string | null) => formatDateManila(value);

function Status({ value }: { value: string | null | undefined }) {
  const normalized = value ?? "unknown";
  return (
    <span className={`status-pill status-${normalized}`}>
      {normalized.replaceAll("_", " ")}
    </span>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="agri-card p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-bold text-[#66806b]">{label}</p>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf4e9] text-[#4c834d]">
          <Icon size={18} />
        </span>
      </div>
      <p className="mt-4 font-display text-3xl font-bold text-[#254f37]">
        {value}
      </p>
    </div>
  );
}

function Empty({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="py-9 text-center">
      <Icon className="mx-auto text-[#a0b796]" size={29} />
      <h3 className="mt-3 font-bold text-[#3d5e49]">{title}</h3>
      <p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-[#6d7d70]">
        {body}
      </p>
    </div>
  );
}

function LoadingWorkspace() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f8f5ee]">
      <Loader2 className="animate-spin text-[#4e8257]" />
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingWorkspace />;
  if (!user)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f8f5ee] p-4">
        <div className="agri-card max-w-md p-8 text-center">
          <Leaf className="mx-auto text-[#68924d]" />
          <h1 className="mt-4 font-display text-3xl font-bold text-[#244e36]">
            Your AgriCoop workspace
          </h1>
          <p className="mt-3 leading-7 text-[#647568]">
            Sign in to access the tools assigned to your marketplace role.
          </p>
          <button className="agri-button mt-6" onClick={goToAuth}>
            Sign in to AgriCoop
          </button>
        </div>
      </div>
    );
  return <>{children}</>;
}

function Onboarding() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [name, setName] = useState(user?.name ?? "");
  const update = trpc.account.updateProfile.useMutation({
    onSuccess: async () => {
      toast.success("Your profile has been saved.");
      await utils.auth.me.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ name });
  };
  return (
    <>
      <WorkspaceHeader
        title="Complete your profile"
        description="Keep your display name current for cooperative marketplace activity."
      />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <form onSubmit={submit} className="agri-card p-6 sm:p-8">
          <h1 className="font-display text-3xl font-bold text-[#244e36]">
            Your profile
          </h1>
          <p className="mt-3 leading-7 text-[#647568]">
            The live Supabase profile table stores your name, email, role,
            approval status, and cooperative assignment. Contact and address
            fields need an approved schema change before they can be saved.
          </p>
          <label className="field-label mt-6">
            Display name
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              className="field-control"
              required
              maxLength={120}
            />
          </label>
          <button disabled={update.isPending} className="agri-button mt-7">
            {update.isPending && <Loader2 className="animate-spin" size={17} />}{" "}
            Save profile
          </button>
        </form>
      </main>
    </>
  );
}

function BuyerDashboard() {
  const utils = trpc.useUtils();
  const { data: orders = [], isLoading } =
    trpc.supabaseOrders.buyerMine.useQuery();
  const { data: quotations = [] } =
    trpc.supabaseQuotations.buyerMine.useQuery();
  const refresh = () => {
    void utils.supabaseQuotations.buyerMine.invalidate();
    void utils.supabaseOrders.buyerMine.invalidate();
  };
  const decideQuotation = trpc.supabaseQuotations.decide.useMutation({
    onSuccess: () => {
      toast.success("Quotation decision saved.");
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const placeQuotedOrder = trpc.supabaseOrders.create.useMutation({
    onSuccess: () => {
      toast.success("Order placed at the quoted unit price.");
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  return (
    <>
      <WorkspaceHeader
        title="Buyer workspace"
        description="Track direct orders, quotation requests, and face-to-face coordination."
      />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          <Metric
            label="Orders placed"
            value={String(orders.length)}
            icon={ClipboardList}
          />
          <Metric
            label="Open quotations"
            value={String(
              quotations.filter(row => row.quotation.status === "requested")
                .length
            )}
            icon={FileText}
          />
          <Metric
            label="Completed orders"
            value={String(
              orders.filter(row => row.order.status === "completed").length
            )}
            icon={Check}
          />
        </div>
        <section className="mt-8 grid gap-8 xl:grid-cols-[1.25fr_.75fr]">
          <div className="agri-card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold text-[#264f37]">
                  Your orders
                </h2>
                <p className="mt-1 text-sm text-[#6a796e]">
                  Seller confirmations and fulfillment updates appear here.
                </p>
              </div>
              <Link
                href="/marketplace"
                className="agri-ghost text-sm no-underline"
              >
                Browse listings
              </Link>
            </div>
            <div className="mt-5 space-y-3">
              {isLoading ? (
                <Loader2 className="mx-auto my-10 animate-spin text-[#5d8a5e]" />
              ) : orders.length ? (
                orders.map(row => (
                  <div
                    className="rounded-2xl border border-[#e3e9de] p-4"
                    key={row.order.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-[#30573e]">
                          Order #{row.order.id} ·{" "}
                          {row.sellerName || "Farm seller"}
                        </p>
                        <p className="mt-1 text-xs text-[#6d7d70]">
                          {row.order.orderType} order ·{" "}
                          {when(row.order.createdAt)}
                        </p>
                      </div>
                      <Status value={row.order.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.items.map(item => (
                        <span
                          key={item.item.id}
                          className="rounded-lg bg-[#f0f5ed] px-2.5 py-1.5 text-xs text-[#45614e]"
                        >
                          {item.productName} × {item.item.quantity} {item.unit}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-[#edf0e9] pt-3">
                      <p className="font-display font-bold text-[#27573a]">
                        {peso(row.order.totalCents)}
                      </p>
                      <p className="text-xs text-[#6c7a70]">
                        {row.order.paymentStatus}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <Empty
                  icon={ClipboardList}
                  title="No orders yet"
                  body="Explore local cooperative listings and submit your first order when ready."
                />
              )}
            </div>
          </div>
          <div className="agri-card p-5 sm:p-6">
            <h2 className="font-display text-2xl font-bold text-[#264f37]">
              Quotation requests
            </h2>
            <p className="mt-1 text-sm text-[#6a796e]">
              A transparent first step before an order.
            </p>
            <div className="mt-5 space-y-3">
              {quotations.length ? (
                quotations.map(row => (
                  <div
                    key={row.quotation.id}
                    className="rounded-xl bg-[#f2f6ef] p-4"
                  >
                    <div className="flex justify-between gap-2">
                      <p className="font-bold text-[#315640]">
                        {row.productName}
                      </p>
                      <Status value={row.quotation.status} />
                    </div>
                    <p className="mt-1 text-xs text-[#728076]">
                      {row.quotation.requestedQty} {row.unit} from{" "}
                      {row.sellerName || "farm seller"}
                    </p>
                    {row.quotation.quotedPriceCents !== null && (
                      <p className="mt-3 font-display text-lg font-bold text-[#2c603f]">
                        {peso(row.quotation.quotedPriceCents)} per {row.unit}
                      </p>
                    )}
                    {row.quotation.status === "responded" && (
                      <div className="mt-3 flex gap-2">
                        <button
                          className="agri-button px-3 py-2 text-xs"
                          disabled={decideQuotation.isPending}
                          onClick={() =>
                            decideQuotation.mutate({
                              quotationId: row.quotation.id,
                              status: "accepted",
                            })
                          }
                        >
                          Accept quote
                        </button>
                        <button
                          className="agri-ghost px-3 py-2 text-xs"
                          disabled={decideQuotation.isPending}
                          onClick={() =>
                            decideQuotation.mutate({
                              quotationId: row.quotation.id,
                              status: "declined",
                            })
                          }
                        >
                          Decline quote
                        </button>
                      </div>
                    )}
                    {row.quotation.status === "accepted" && (
                      <button
                        className="agri-button mt-3 px-3 py-2 text-xs"
                        disabled={placeQuotedOrder.isPending}
                        onClick={() =>
                          placeQuotedOrder.mutate({
                            items: [
                              {
                                productId: row.quotation.productId,
                                quantity: row.quotation.requestedQty,
                              },
                            ],
                            quotationId: row.quotation.id,
                          })
                        }
                      >
                        Place order at quoted price
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <Empty
                  icon={FileText}
                  title="No quotations yet"
                  body="Request a quotation from any available product in the marketplace."
                />
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

type ProductForm = {
  name: string;
  category: string;
  description: string;
  unit: string;
  price: string;
  stock: string;
};
const emptyProductForm = (): ProductForm => ({
  name: "",
  category: "",
  description: "",
  unit: "kg",
  price: "",
  stock: "",
});

function SupabaseSellerDashboard() {
  const utils = trpc.useUtils();
  const {
    data: products = [],
    isLoading,
    error,
  } = trpc.supabaseProducts.mine.useQuery();
  const [form, setForm] = useState<ProductForm>(emptyProductForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const refresh = () => {
    void utils.supabaseProducts.mine.invalidate();
    void utils.marketplace.list.invalidate();
  };
  const create = trpc.supabaseProducts.create.useMutation({
    onSuccess: () => {
      toast.success("Product saved to Supabase.");
      setForm(emptyProductForm());
      refresh();
    },
    onError: problem => toast.error(problem.message),
  });
  const update = trpc.supabaseProducts.update.useMutation({
    onSuccess: () => {
      toast.success("Product and inventory updated.");
      setEditingId(null);
      refresh();
    },
    onError: problem => toast.error(problem.message),
  });
  const archive = trpc.supabaseProducts.archive.useMutation({
    onSuccess: () => {
      toast.success("Product archived.");
      refresh();
    },
    onError: problem => toast.error(problem.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      name: form.name,
      category: form.category,
      description: form.description,
      unit: form.unit,
      priceCents: Math.round(Number(form.price) * 100),
      stockQty: Number(form.stock),
      status: "available",
    });
  };
  return (
    <>
      <WorkspaceHeader
        title="Farmer workspace"
        description="Manage products and inventory stored in the Supabase marketplace tables."
      />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-2xl border border-[#dce8d5] bg-[#f1f6ee] p-4 text-sm leading-6 text-[#4a6651]">
          This workspace uses only the verified live fields: product name,
          category, description, unit, price, status, and inventory quantity.
          Variety, product images, quality grades, and minimum-order fields are
          not present in the current database schema.
        </div>
        {error && (
          <div className="mb-6 rounded-xl bg-[#fff1ec] p-4 text-sm text-[#a34838]">
            {error.message}
          </div>
        )}
        <section className="grid gap-7 lg:grid-cols-[360px_1fr]">
          <form onSubmit={submit} className="agri-card h-fit p-5">
            <h2 className="font-display text-2xl font-bold text-[#264f37]">
              Add product
            </h2>
            <label className="field-label mt-4">
              Product name
              <input
                required
                className="field-control"
                value={form.name}
                onChange={event =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
            <label className="field-label mt-4">
              Category
              <input
                required
                className="field-control"
                value={form.category}
                onChange={event =>
                  setForm({ ...form, category: event.target.value })
                }
              />
            </label>
            <label className="field-label mt-4">
              Description
              <textarea
                required
                className="field-control min-h-28"
                value={form.description}
                onChange={event =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </label>
            <label className="field-label mt-4">
              Unit
              <select
                className="field-control"
                value={form.unit}
                onChange={event =>
                  setForm({ ...form, unit: event.target.value })
                }
              >
                {PRODUCT_UNITS.map(unit => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label mt-4">
              Price (PHP)
              <input
                required
                min="0.01"
                step="0.01"
                type="number"
                className="field-control"
                value={form.price}
                onChange={event =>
                  setForm({ ...form, price: event.target.value })
                }
              />
            </label>
            <label className="field-label mt-4">
              Stock quantity
              <input
                required
                min="0"
                step="1"
                type="number"
                className="field-control"
                value={form.stock}
                onChange={event =>
                  setForm({ ...form, stock: event.target.value })
                }
              />
            </label>
            <button
              className="agri-button mt-5 w-full"
              disabled={create.isPending}
            >
              {create.isPending ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Plus size={16} />
              )}{" "}
              Save product
            </button>
          </form>
          <div className="agri-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold text-[#264f37]">
                  Your Supabase products
                </h2>
                <p className="mt-1 text-sm text-[#6a796e]">
                  Inventory quantity is stored separately in the inventory
                  table.
                </p>
              </div>
              <span className="rounded-full bg-[#edf3e9] px-3 py-1 text-xs font-bold text-[#487249]">
                {products.length} records
              </span>
            </div>
            <div className="mt-5 space-y-3">
              {isLoading ? (
                <Loader2 className="mx-auto my-10 animate-spin text-[#5d8a5e]" />
              ) : products.length ? (
                products.map(product =>
                  editingId === product.id ? (
                    <form
                      key={product.id}
                      onSubmit={event => {
                        event.preventDefault();
                        update.mutate({
                          productId: product.id,
                          name: form.name,
                          category: form.category,
                          description: form.description,
                          unit: form.unit,
                          priceCents: Math.round(Number(form.price) * 100),
                          stockQty: Number(form.stock),
                          status:
                            product.status === "archived"
                              ? "archived"
                              : "available",
                        });
                      }}
                      className="rounded-xl border-2 border-[#abd19e] bg-[#f2f8ef] p-4"
                    >
                      <p className="font-bold text-[#315640]">
                        Editing {product.name}
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <input
                          required
                          className="field-control"
                          value={form.name}
                          onChange={event =>
                            setForm({ ...form, name: event.target.value })
                          }
                        />
                        <input
                          required
                          className="field-control"
                          value={form.category}
                          onChange={event =>
                            setForm({ ...form, category: event.target.value })
                          }
                        />
                        <textarea
                          required
                          className="field-control sm:col-span-2"
                          value={form.description}
                          onChange={event =>
                            setForm({
                              ...form,
                              description: event.target.value,
                            })
                          }
                        />
                        <input
                          required
                          min="0.01"
                          step="0.01"
                          type="number"
                          className="field-control"
                          value={form.price}
                          onChange={event =>
                            setForm({ ...form, price: event.target.value })
                          }
                        />
                        <input
                          required
                          min="0"
                          step="1"
                          type="number"
                          className="field-control"
                          value={form.stock}
                          onChange={event =>
                            setForm({ ...form, stock: event.target.value })
                          }
                        />
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          className="agri-button px-3 py-2 text-xs"
                          disabled={update.isPending}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="agri-ghost px-3 py-2 text-xs"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div
                      key={product.id}
                      className="rounded-xl border border-[#e2e9dd] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-[#315640]">
                            {product.name}
                          </p>
                          <p className="mt-1 text-xs text-[#6d7d70]">
                            {product.category} · {product.unit} ·{" "}
                            {peso(product.priceCents)}
                          </p>
                        </div>
                        <Status value={product.status} />
                      </div>
                      <p className="mt-3 text-sm text-[#65766b]">
                        {product.description}
                      </p>
                      <p className="mt-3 text-xs font-bold text-[#45614e]">
                        Stock: {product.stockQty} {product.unit}
                      </p>
                      <div className="mt-4 flex gap-2">
                        <button
                          className="agri-ghost px-3 py-2 text-xs"
                          onClick={() => {
                            setEditingId(product.id);
                            setForm({
                              name: product.name,
                              category: product.category,
                              description: product.description,
                              unit: product.unit,
                              price: String(product.priceCents / 100),
                              stock: String(product.stockQty),
                            });
                          }}
                        >
                          Edit
                        </button>
                        {product.status !== "archived" && (
                          <button
                            className="text-xs font-bold text-[#a34838]"
                            onClick={() =>
                              archive.mutate({ productId: product.id })
                            }
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </div>
                  )
                )
              ) : (
                <Empty
                  icon={Package}
                  title="No Supabase products"
                  body="Create a product using the fields supported by the existing database schema."
                />
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function SupabaseOfficerDashboard() {
  const utils = trpc.useUtils();
  const {
    data: overview,
    isLoading,
    error,
  } = trpc.supabaseOfficer.overview.useQuery();
  const refresh = () => void utils.supabaseOfficer.overview.invalidate();
  const memberStatus = trpc.supabaseOfficer.updateMemberStatus.useMutation({
    onSuccess: () => {
      toast.success("Member status updated.");
      refresh();
    },
    onError: problem => toast.error(problem.message),
  });
  const productReview = trpc.supabaseOfficer.reviewProduct.useMutation({
    onSuccess: () => {
      toast.success("Product status updated.");
      refresh();
      void utils.marketplace.list.invalidate();
    },
    onError: problem => toast.error(problem.message),
  });
  const quotationReview = trpc.supabaseOfficer.reviewQuotation.useMutation({
    onSuccess: () => {
      toast.success("Quotation response saved.");
      refresh();
    },
    onError: problem => toast.error(problem.message),
  });
  const orderStatus = trpc.supabaseOfficer.updateOrderStatus.useMutation({
    onSuccess: () => {
      toast.success("Order status updated.");
      refresh();
    },
    onError: problem => toast.error(problem.message),
  });
  if (isLoading) return <LoadingWorkspace />;
  if (error)
    return (
      <>
        <WorkspaceHeader
          title="Cooperative officer workspace"
          description="Manage records within your assigned cooperative."
        />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-2xl bg-[#fff1ec] p-5 text-sm text-[#a34838]">
            {error.message}
          </div>
        </main>
      </>
    );
  return (
    <>
      <WorkspaceHeader
        title="Cooperative officer workspace"
        description="Review cooperative members, product availability, quotations, and order fulfillment from Supabase records."
      />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-5">
          <Metric
            label="Members"
            value={String(overview?.members.length ?? 0)}
            icon={Users}
          />
          <Metric
            label="Products"
            value={String(overview?.products.length ?? 0)}
            icon={Package}
          />
          <Metric
            label="Quotations"
            value={String(overview?.quotations.length ?? 0)}
            icon={FileText}
          />
          <Metric
            label="Orders"
            value={String(overview?.orders.length ?? 0)}
            icon={ClipboardList}
          />
          <Metric
            label="Transactions"
            value={String(overview?.transactions.length ?? 0)}
            icon={BarChart3}
          />
        </div>
        <section className="mt-8 grid gap-8 xl:grid-cols-2">
          <div className="agri-card p-5">
            <h2 className="font-display text-2xl font-bold text-[#264f37]">
              Members
            </h2>
            <div className="mt-4 space-y-2">
              {overview?.members.map(member => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f2f6ef] p-3"
                >
                  <div>
                    <p className="font-bold text-[#315640]">
                      {member.name || member.email || member.id}
                    </p>
                    <p className="text-xs text-[#718174]">
                      {member.role} · {member.approvalStatus}
                    </p>
                  </div>
                  {member.role !== "admin" && member.role !== "superadmin" && (
                    <button
                      className="agri-ghost px-3 py-2 text-xs"
                      onClick={() =>
                        memberStatus.mutate({
                          userId: member.id,
                          accountStatus:
                            member.approvalStatus === "approved"
                              ? "suspended"
                              : "approved",
                        })
                      }
                    >
                      {member.approvalStatus === "approved"
                        ? "Suspend"
                        : "Approve"}
                    </button>
                  )}
                </div>
              ))}
              {!overview?.members.length && (
                <Empty
                  icon={Users}
                  title="No cooperative members"
                  body="No profiles are currently assigned to this cooperative."
                />
              )}
            </div>
          </div>
          <div className="agri-card p-5">
            <h2 className="font-display text-2xl font-bold text-[#264f37]">
              Products and inventory
            </h2>
            <div className="mt-4 space-y-2">
              {overview?.products.map(product => (
                <div
                  key={product.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f2f6ef] p-3"
                >
                  <div>
                    <p className="font-bold text-[#315640]">{product.name}</p>
                    <p className="text-xs text-[#718174]">
                      {product.stockQty} {product.unit} · {product.status}
                    </p>
                  </div>
                  <button
                    className="agri-ghost px-3 py-2 text-xs"
                    onClick={() =>
                      productReview.mutate({
                        productId: product.id,
                        decision:
                          product.status === "archived"
                            ? "available"
                            : "archived",
                      })
                    }
                  >
                    {product.status === "archived" ? "Activate" : "Archive"}
                  </button>
                </div>
              ))}
              {!overview?.products.length && (
                <Empty
                  icon={Package}
                  title="No cooperative products"
                  body="No seller products are currently assigned to this cooperative."
                />
              )}
            </div>
          </div>
          <div className="agri-card p-5">
            <h2 className="font-display text-2xl font-bold text-[#264f37]">
              Quotation queue
            </h2>
            <div className="mt-4 space-y-3">
              {overview?.quotations.map(row => (
                <div
                  key={row.quotation.id}
                  className="rounded-xl border border-[#e2e9dd] p-4"
                >
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-bold text-[#315640]">
                        {row.productName}
                      </p>
                      <p className="text-xs text-[#718174]">
                        {row.buyerName || "Buyer"} ·{" "}
                        {row.quotation.requestedQty} {row.unit}
                      </p>
                    </div>
                    <Status value={row.quotation.status} />
                  </div>
                  {row.quotation.status === "requested" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        className="agri-button px-3 py-2 text-xs"
                        onClick={() => {
                          const value = window.prompt(
                            "Proposed price per unit (PHP):"
                          );
                          const price = value
                            ? Math.round(Number(value) * 100)
                            : 0;
                          if (price > 0)
                            quotationReview.mutate({
                              quotationId: row.quotation.id,
                              decision: "responded",
                              proposedPriceCents: price,
                            });
                        }}
                      >
                        Respond
                      </button>
                      <button
                        className="text-xs font-bold text-[#a34838]"
                        onClick={() =>
                          quotationReview.mutate({
                            quotationId: row.quotation.id,
                            decision: "declined",
                          })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!overview?.quotations.length && (
                <Empty
                  icon={FileText}
                  title="No quotation requests"
                  body="Quotation records will appear here when buyers submit requests."
                />
              )}
            </div>
          </div>
          <div className="agri-card p-5">
            <h2 className="font-display text-2xl font-bold text-[#264f37]">
              Order fulfillment
            </h2>
            <div className="mt-4 space-y-3">
              {overview?.orders.map(order => (
                <div
                  key={order.order_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f2f6ef] p-3"
                >
                  <div>
                    <p className="font-bold text-[#315640]">
                      Order {order.order_id}
                    </p>
                    <p className="text-xs text-[#718174]">
                      {order.order_type} · PHP{" "}
                      {Number(order.total_amount).toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Status value={order.status} />
                    {order.status !== "completed" &&
                      order.status !== "cancelled" && (
                        <button
                          className="agri-ghost px-3 py-2 text-xs"
                          onClick={() => {
                            const next =
                              order.status === "submitted"
                                ? "confirmed"
                                : order.status === "confirmed"
                                  ? "ready"
                                  : "completed";
                            if (order.status)
                              orderStatus.mutate({
                                orderId: order.order_id,
                                status: next,
                              });
                          }}
                        >
                          Advance
                        </button>
                      )}
                  </div>
                </div>
              ))}
              {!overview?.orders.length && (
                <Empty
                  icon={ClipboardList}
                  title="No orders"
                  body="Orders associated with this cooperative will appear here."
                />
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function SupabaseAdminDashboard() {
  const utils = trpc.useUtils();
  const {
    data: overview,
    isLoading,
    error,
  } = trpc.supabaseAdmin.overview.useQuery();
  const updateProfile = trpc.supabaseAdmin.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Profile status updated.");
      void utils.supabaseAdmin.overview.invalidate();
    },
    onError: problem => toast.error(problem.message),
  });
  if (isLoading) return <LoadingWorkspace />;
  if (error)
    return (
      <>
        <WorkspaceHeader
          title="System administration"
          description="Manage verified Supabase profiles and records."
        />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-2xl bg-[#fff1ec] p-5 text-sm text-[#a34838]">
            {error.message}
          </div>
        </main>
      </>
    );
  return (
    <>
      <WorkspaceHeader
        title="System administration"
        description="Cross-cooperative oversight backed by Supabase PostgreSQL records."
      />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-5">
          <Metric
            label="Profiles"
            value={String(overview?.profiles.length ?? 0)}
            icon={Users}
          />
          <Metric
            label="Products"
            value={String(overview?.products.length ?? 0)}
            icon={Package}
          />
          <Metric
            label="Orders"
            value={String(overview?.orders.length ?? 0)}
            icon={ClipboardList}
          />
          <Metric
            label="Transactions"
            value={String(overview?.transactions.length ?? 0)}
            icon={BarChart3}
          />
          <Metric
            label="Activity logs"
            value={String(overview?.activityLogs.length ?? 0)}
            icon={FileText}
          />
        </div>
        <section className="mt-8 agri-card overflow-x-auto p-5">
          <h2 className="font-display text-2xl font-bold text-[#264f37]">
            Profiles and account status
          </h2>
          <p className="mt-2 text-sm text-[#6a796e]">
            Role changes remain server-authorized; the current schema exposes
            role IDs and account status but no activity-log table.
          </p>
          <table className="mt-4 w-full min-w-[800px] text-left text-sm">
            <thead className="border-b border-[#e2e9dd] text-xs uppercase tracking-wide text-[#718174]">
              <tr>
                <th className="pb-3">Profile</th>
                <th className="pb-3">Role</th>
                <th className="pb-3">Cooperative</th>
                <th className="pb-3">Status</th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody>
              {overview?.profiles.map(profile => {
                const roleName = profile.roleName ?? "buyer";
                const nextStatus =
                  profile.account_status === "approved"
                    ? "suspended"
                    : "approved";
                return (
                  <tr
                    key={profile.user_id}
                    className="border-b border-[#edf0e9]"
                  >
                    <td className="py-3">
                      <p className="font-bold text-[#315640]">
                        {profile.full_name || profile.email || profile.user_id}
                      </p>
                      <p className="text-xs text-[#718174]">{profile.email}</p>
                    </td>
                    <td className="py-3">{roleName}</td>
                    <td className="py-3">{profile.cooperative_id || "None"}</td>
                    <td className="py-3">
                      <Status value={profile.account_status} />
                    </td>
                    <td className="py-3 text-right">
                      <button
                        className="agri-ghost px-3 py-2 text-xs"
                        onClick={() =>
                          updateProfile.mutate({
                            userId: profile.user_id,
                            roleName: roleName as
                              | "buyer"
                              | "seller"
                              | "coop_officer"
                              | "system_admin",
                            accountStatus: nextStatus,
                            cooperativeId: profile.cooperative_id,
                          })
                        }
                      >
                        {nextStatus === "suspended" ? "Suspend" : "Approve"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!overview?.profiles.length && (
            <Empty
              icon={Users}
              title="No profiles"
              body="No Supabase profiles are currently available."
            />
          )}
        </section>
      </main>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <AuthGate>
      {user?.role === "superadmin" ? (
        <SupabaseAdminDashboard />
      ) : user?.role === "admin" ? (
        <SupabaseOfficerDashboard />
      ) : user?.role === "seller" ? (
        <SupabaseSellerDashboard />
      ) : user?.role === "buyer" ? (
        <BuyerDashboard />
      ) : (
        <Onboarding />
      )}
    </AuthGate>
  );
}
