import { useAuth } from "@/_core/hooks/useAuth";
import { WorkspaceHeader } from "@/components/AgriShell";
import { formatDateManila, formatTimeManila } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import {
  BarChart3,
  Download,
  FileText,
  Loader2,
  Package,
  ReceiptText,
} from "lucide-react";
import { buildCsv } from "../../../shared/reportCsv";

const peso = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    cents / 100
  );
function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const url = URL.createObjectURL(
    new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const { user, loading } = useAuth();
  const officer = trpc.supabaseOfficer.overview.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const admin = trpc.supabaseAdmin.overview.useQuery(undefined, {
    enabled: user?.role === "superadmin",
  });
  const isAllowed = user?.role === "admin" || user?.role === "superadmin";
  const dataLoading =
    loading ||
    (user?.role === "admin"
      ? officer.isLoading
      : user?.role === "superadmin"
        ? admin.isLoading
        : false);
  const dataError =
    user?.role === "admin"
      ? officer.error
      : user?.role === "superadmin"
        ? admin.error
        : null;

  if (dataLoading)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f8f5ee]">
        <Loader2 className="animate-spin text-[#4e8257]" />
      </div>
    );
  if (!user || !isAllowed)
    return (
      <>
        <WorkspaceHeader
          title="Marketplace reports"
          description="Export reports for your cooperative."
        />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <div className="agri-card p-8 text-center">
            <h1 className="font-display text-3xl font-bold text-[#254f37]">
              Cooperative officer access required
            </h1>
            <p className="mt-3 text-[#65766b]">
              Only cooperative Officers and SuperAdmins can export reports.
            </p>
          </div>
        </main>
      </>
    );

  const cards: Array<{
    title: string;
    body: string;
    value: string;
    icon: typeof BarChart3;
    export: () => void;
  }> = [];
  if (user.role === "admin" && officer.data) {
    const overview = officer.data;
    const totalSales = overview.transactions.reduce(
      (sum, transaction) => sum + Number(transaction.total_amount),
      0
    );
    cards.push(
      {
        title: "Sales report",
        body: "Transaction totals and F2F payment statuses for your cooperative.",
        icon: BarChart3,
        value: peso(Math.round(totalSales * 100)),
        export: () =>
          downloadCsv("agricoop-sales-report.csv", [
            [
              "Transaction ID",
              "Order ID",
              "Amount (PHP)",
              "Payment status",
              "Date (PH)",
              "Time (PH)",
            ],
            ...overview.transactions.map(transaction => [
              transaction.transaction_id,
              transaction.order_id,
              peso(Math.round(Number(transaction.total_amount) * 100)),
              transaction.payment_status ?? "pending",
              formatDateManila(transaction.paid_at ?? transaction.created_at),
              formatTimeManila(transaction.paid_at ?? transaction.created_at),
            ]),
          ]),
      },
      {
        title: "Inventory report",
        body: "Products and current inventory quantities from the live Supabase tables.",
        icon: Package,
        value: String(overview.products.length),
        export: () =>
          downloadCsv("agricoop-inventory-report.csv", [
            [
              "Product ID",
              "Product",
              "Category",
              "Stock",
              "Unit",
              "Price per unit",
              "Status",
            ],
            ...overview.products.map(product => [
              product.id,
              product.name,
              product.category,
              product.stockQty,
              product.unit,
              peso(product.priceCents),
              product.status,
            ]),
          ]),
      },
      {
        title: "Quotation report",
        body: "Quotation requests handled by the assigned cooperative officer.",
        icon: FileText,
        value: String(overview.quotations.length),
        export: () =>
          downloadCsv("agricoop-quotation-report.csv", [
            [
              "Quotation ID",
              "Product ID",
              "Buyer ID",
              "Quantity",
              "Unit",
              "Proposed price per unit",
              "Status",
              "Date (PH)",
            ],
            ...overview.quotations.map(row => [
              row.quotation.id,
              row.quotation.productId,
              row.quotation.buyerId,
              row.quotation.requestedQty,
              row.unit,
              row.quotation.quotedPriceCents === null
                ? "Pending"
                : peso(row.quotation.quotedPriceCents),
              row.quotation.status ?? "unknown",
              formatDateManila(row.quotation.createdAt),
            ]),
          ]),
      },
      {
        title: "Transaction report",
        body: "Traceable transaction records with the payment status stored by Supabase.",
        icon: ReceiptText,
        value: String(overview.transactions.length),
        export: () =>
          downloadCsv("agricoop-transaction-report.csv", [
            [
              "Transaction ID",
              "Order ID",
              "Amount (PHP)",
              "Payment method",
              "Payment status",
              "Date (PH)",
            ],
            ...overview.transactions.map(transaction => [
              transaction.transaction_id,
              transaction.order_id,
              peso(Math.round(Number(transaction.total_amount) * 100)),
              transaction.payment_method,
              transaction.payment_status ?? "pending",
              formatDateManila(transaction.paid_at ?? transaction.created_at),
            ]),
          ]),
      }
    );
  } else if (user.role === "superadmin" && admin.data) {
    const overview = admin.data;
    const totalSales = overview.transactions.reduce(
      (sum, transaction) => sum + Number(transaction.total_amount),
      0
    );
    cards.push(
      {
        title: "Sales report",
        body: "Platform-wide transaction totals from Supabase.",
        icon: BarChart3,
        value: peso(Math.round(totalSales * 100)),
        export: () =>
          downloadCsv("agricoop-sales-report.csv", [
            [
              "Transaction ID",
              "Order ID",
              "Amount (PHP)",
              "Payment status",
              "Date (PH)",
            ],
            ...overview.transactions.map(transaction => [
              transaction.transaction_id,
              transaction.order_id,
              peso(Math.round(Number(transaction.total_amount) * 100)),
              transaction.payment_status ?? "pending",
              formatDateManila(transaction.paid_at ?? transaction.created_at),
            ]),
          ]),
      },
      {
        title: "Inventory report",
        body: "Platform product records. Inventory is stored in a separate table and is not returned by this administrator summary.",
        icon: Package,
        value: String(overview.products.length),
        export: () =>
          downloadCsv("agricoop-inventory-report.csv", [
            [
              "Product ID",
              "Product",
              "Category",
              "Unit",
              "Price per unit",
              "Status",
            ],
            ...overview.products.map(product => [
              product.product_id,
              product.product_name,
              product.category ?? "General",
              product.unit ?? "unit",
              peso(Math.round(Number(product.price) * 100)),
              product.status ?? "unknown",
            ]),
          ]),
      },
      {
        title: "Quotation report",
        body: "Quotation item details are not included in the current administrator summary because the live schema separates quotation headers and items.",
        icon: FileText,
        value: "0",
        export: () =>
          downloadCsv("agricoop-quotation-report.csv", [
            ["Notice"],
            ["Quotation detail export requires a dedicated read model."],
          ]),
      },
      {
        title: "Transaction report",
        body: "Platform-wide transaction records with order references and F2F status.",
        icon: ReceiptText,
        value: String(overview.transactions.length),
        export: () =>
          downloadCsv("agricoop-transaction-report.csv", [
            [
              "Transaction ID",
              "Order ID",
              "Amount (PHP)",
              "Payment method",
              "Payment status",
              "Date (PH)",
            ],
            ...overview.transactions.map(transaction => [
              transaction.transaction_id,
              transaction.order_id,
              peso(Math.round(Number(transaction.total_amount) * 100)),
              transaction.payment_method,
              transaction.payment_status ?? "pending",
              formatDateManila(transaction.paid_at ?? transaction.created_at),
            ]),
          ]),
      }
    );
  }

  return (
    <>
      <WorkspaceHeader
        title={
          user.role === "superadmin"
            ? "Platform reports"
            : "Cooperative reports"
        }
        description={
          user.role === "superadmin"
            ? "Generate platform-wide marketplace reports."
            : "Generate reports for your assigned cooperative."
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-[#1f4f36] p-7 text-[#fffdf8]">
          <p className="text-xs font-extrabold uppercase tracking-[.13em] text-[#bed99c]">
            {user.role === "superadmin"
              ? "System administrator"
              : "Cooperative Officer"}
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold">
            Operational reports, ready to share.
          </h1>
          <p className="mt-3 max-w-2xl text-[#d7e7d4]">
            Reports are read-only exports of the live Supabase records. AgriCoop
            records face-to-face payment coordination; it does not process
            online payments.
          </p>
        </div>
        {dataError ? (
          <p className="mt-6 rounded-xl bg-[#fff1ec] p-4 text-sm text-[#a34838]">
            {dataError.message}
          </p>
        ) : (
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {cards.map(report => {
              const Icon = report.icon;
              return (
                <article key={report.title} className="agri-card p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#eaf3e5] text-[#4a804c]">
                    <Icon size={21} />
                  </span>
                  <p className="mt-5 text-sm font-bold text-[#66806b]">
                    {report.title}
                  </p>
                  <p className="mt-2 font-display text-3xl font-bold text-[#254f37]">
                    {report.value}
                  </p>
                  <p className="mt-3 min-h-12 text-sm leading-6 text-[#65766b]">
                    {report.body}
                  </p>
                  <button
                    className="agri-button mt-5 text-sm"
                    onClick={report.export}
                  >
                    <Download size={16} /> Download CSV
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
