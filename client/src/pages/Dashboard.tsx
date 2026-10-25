import { WorkspaceHeader } from "@/components/AgriShell";
import { buildCsv } from "../../../shared/reportCsv";
import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { formatDateManila } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";
import { getProductImageUrl } from "@/lib/productImages";
import { getProductVarieties, isProductImageSizeAllowed, PRODUCT_UNITS } from "../../../shared/productOptions";
import { AlertCircle, BarChart3, Check, ClipboardList, Download, FileText, Leaf, Loader2, LucideIcon, Package, Plus, Store, Users } from "lucide-react";
import { FormEvent, ReactNode, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";

const peso = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
const when = (value: Date | string | null) => formatDateManila(value);
const Status = ({ value }: { value: string }) => <span className={`status-pill status-${value}`}>{value.replaceAll("_", " ")}</span>;

const PRODUCT_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ProductImageContentType = (typeof PRODUCT_IMAGE_CONTENT_TYPES)[number];
type ProductImageUploadInput = { fileName: string; contentType: ProductImageContentType; size: number };
type ProductImageUploadTicket = { bucket: string; key: string; token: string; url: string };

async function uploadProductImage(
  file: File,
  createTicket: (input: ProductImageUploadInput) => Promise<ProductImageUploadTicket>,
) {
  const contentType = PRODUCT_IMAGE_CONTENT_TYPES.find(type => type === file.type);
  if (!contentType || !isProductImageSizeAllowed(file.size)) {
    throw new Error("Choose a JPEG, PNG, or WebP image that is 5 MB or less.");
  }

  const ticket = await createTicket({ fileName: file.name, contentType, size: file.size });
  const { error } = await supabase.storage
    .from(ticket.bucket)
    .uploadToSignedUrl(ticket.key, ticket.token, file, { contentType });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  return ticket.url;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return <div className="agri-card p-5"><div className="flex items-start justify-between"><p className="text-sm font-bold text-[#66806b]">{label}</p><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf4e9] text-[#4c834d]"><Icon size={18}/></span></div><p className="mt-4 font-display text-3xl font-bold text-[#254f37]">{value}</p></div>;
}

function Empty({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return <div className="py-9 text-center"><Icon className="mx-auto text-[#a0b796]" size={29}/><h3 className="mt-3 font-bold text-[#3d5e49]">{title}</h3><p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-[#6d7d70]">{body}</p></div>;
}

function LoadingWorkspace() { return <div className="grid min-h-screen place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]"/></div>; }

function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingWorkspace/>;
  if (!user) return <div className="grid min-h-screen place-items-center bg-[#f8f5ee] p-4"><div className="agri-card max-w-md p-8 text-center"><Leaf className="mx-auto text-[#68924d]"/><h1 className="mt-4 font-display text-3xl font-bold text-[#244e36]">Your AgriCoop workspace</h1><p className="mt-3 leading-7 text-[#647568]">Sign in to access the tools assigned to your marketplace role.</p><button className="agri-button mt-6" onClick={goToAuth}>Sign in to AgriCoop</button></div></div>;
  return <>{children}</>;
}

function Onboarding() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [name, setName] = useState(user?.name || "");
  const [contactNumber, setContactNumber] = useState(user?.contactNumber || "");
  const [address, setAddress] = useState(user?.address || "");
  const update = trpc.account.updateProfile.useMutation({
    onSuccess: () => { toast.success("Your profile has been saved."); utils.auth.me.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ name, contactNumber: contactNumber || undefined, address: address || undefined });
  };
  return <><WorkspaceHeader title="Complete your profile" description="Keep your contact details current for cooperative marketplace activity."/><main className="mx-auto max-w-3xl px-4 py-10 sm:px-6"><form onSubmit={submit} className="agri-card p-6 sm:p-8"><h1 className="font-display text-3xl font-bold text-[#244e36]">Your profile</h1><p className="mt-3 leading-7 text-[#647568]">Your role, approval status, and cooperative assignment are managed by AgriCoop and your cooperative officer.</p><label className="field-label mt-6">Display name<input value={name} onChange={e => setName(e.target.value)} className="field-control" required maxLength={120}/></label><label className="field-label mt-5">Contact number <span className="normal-case tracking-normal text-[#6e7d73]">(optional)</span><input value={contactNumber} onChange={e => setContactNumber(e.target.value)} className="field-control" placeholder="e.g., 09XX XXX XXXX" maxLength={40}/></label><label className="field-label mt-5">Address <span className="normal-case tracking-normal text-[#6e7d73]">(optional)</span><textarea value={address} onChange={e => setAddress(e.target.value)} className="field-control" maxLength={500}/></label><button disabled={update.isPending} className="agri-button mt-7">{update.isPending && <Loader2 className="animate-spin" size={17}/>} Save profile</button></form></main></>;
}

function BuyerDashboard() {
  const utils = trpc.useUtils();
  const { data: orders = [], isLoading } = trpc.supabaseOrders.buyerMine.useQuery();
  const { data: quotations = [] } = trpc.supabaseQuotations.buyerMine.useQuery();
  const refreshBuyerData = () => {
    utils.supabaseQuotations.buyerMine.invalidate();
    utils.supabaseOrders.buyerMine.invalidate();
  };
  const decideQuotation = trpc.supabaseQuotations.decide.useMutation({
    onSuccess: () => { toast.success("Quotation decision saved."); refreshBuyerData(); },
    onError: error => toast.error(error.message),
  });
  const placeQuotedOrder = trpc.supabaseOrders.create.useMutation({
    onSuccess: () => { toast.success("Order placed at the quoted unit price."); refreshBuyerData(); },
    onError: error => toast.error(error.message),
  });
  return <><WorkspaceHeader title="Buyer workspace" description="Track direct orders, quotation requests, and face-to-face coordination."/><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="grid gap-4 md:grid-cols-3"><Metric label="Orders placed" value={String(orders.length)} icon={ClipboardList}/><Metric label="Open quotations" value={String(quotations.filter(row => row.quotation.status === "requested").length)} icon={FileText}/><Metric label="Completed orders" value={String(orders.filter(row => row.order.status === "completed").length)} icon={Check}/></div><section className="mt-8 grid gap-8 xl:grid-cols-[1.25fr_.75fr]"><div className="agri-card p-5 sm:p-6"><div className="flex items-center justify-between"><div><h2 className="font-display text-2xl font-bold text-[#264f37]">Your orders</h2><p className="mt-1 text-sm text-[#6a796e]">Seller confirmations and fulfillment updates appear here.</p></div><Link href="/marketplace" className="agri-ghost text-sm no-underline">Browse listings</Link></div><div className="mt-5 space-y-3">{isLoading ? <Loader2 className="mx-auto my-10 animate-spin text-[#5d8a5e]"/> : orders.length ? orders.map(row => <div className="rounded-2xl border border-[#e3e9de] p-4" key={row.order.id}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-[#30573e]">Order #{row.order.id} · {row.sellerName || "Farm seller"}</p><p className="mt-1 text-xs text-[#6d7d70]">{row.order.orderType} order · {when(row.order.createdAt)}</p></div><Status value={row.order.status}/></div><div className="mt-3 flex flex-wrap gap-2">{row.items.map(item => <span key={item.item.id} className="rounded-lg bg-[#f0f5ed] px-2.5 py-1.5 text-xs text-[#45614e]">{item.productName} × {item.item.quantity} {item.unit}</span>)}</div><div className="mt-3 flex items-center justify-between border-t border-[#edf0e9] pt-3"><p className="font-display font-bold text-[#27573a]">{peso(row.order.totalCents)}</p><p className="text-xs text-[#6c7a70]">Payment coordination / status</p></div></div>) : <Empty icon={ClipboardList} title="No orders yet" body="Explore local cooperative listings and submit your first order when ready."/>}</div></div><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Quotation requests</h2><p className="mt-1 text-sm text-[#6a796e]">A transparent first step before an order.</p><div className="mt-5 space-y-3">{quotations.length ? quotations.map(row => <div key={row.quotation.id} className="rounded-xl bg-[#f2f6ef] p-4"><div className="flex justify-between gap-2"><p className="font-bold text-[#315640]">{row.productName}</p><Status value={row.quotation.status}/></div><p className="mt-1 text-xs text-[#728076]">{row.quotation.requestedQty} {row.unit} from {row.sellerName || "farm seller"}</p>{row.quotation.quotedPriceCents !== null && <p className="mt-3 font-display text-lg font-bold text-[#2c603f]">{peso(row.quotation.quotedPriceCents)} per {row.unit}</p>}{row.quotation.sellerNote && <p className="mt-2 text-xs leading-5 text-[#637568]">“{row.quotation.sellerNote}”</p>}{row.quotation.status === "responded" && <div className="mt-3 flex gap-2"><button className="agri-button px-3 py-2 text-xs" disabled={decideQuotation.isPending} onClick={() => decideQuotation.mutate({ quotationId: row.quotation.id, status: "accepted" })}>Accept quote</button><button className="agri-ghost px-3 py-2 text-xs" disabled={decideQuotation.isPending} onClick={() => decideQuotation.mutate({ quotationId: row.quotation.id, status: "declined" })}>Decline quote</button></div>}{row.quotation.status === "accepted" && <button className="agri-button mt-3 px-3 py-2 text-xs" disabled={placeQuotedOrder.isPending} onClick={() => placeQuotedOrder.mutate({ items: [{ productId: row.quotation.productId, quantity: row.quotation.requestedQty }], quotationId: row.quotation.id })}>Place order at quoted price</button>}</div>) : <Empty icon={FileText} title="No quotations yet" body="Request a quotation from any available product in the marketplace."/>}</div></div></section></main></>;
}

function SellerProductCard({ product }: { product: any }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState("");
  const [values, setValues] = useState({ name: product.name, category: product.category, variety: product.variety, description: product.description || "", unit: product.unit, price: String(product.priceCents / 100), stock: String(product.stockQty), minOrderQty: String(product.minOrderQty), imageUrl: product.primaryImageUrl || "", qualityGrade: product.qualityGrade, status: product.status });
  const update = trpc.products.update.useMutation({ onSuccess: () => { toast.success("Listing and inventory updated."); setEditing(false); setImageFile(null); utils.products.mine.invalidate(); utils.marketplace.list.invalidate(); }, onError: error => toast.error(error.message) });
  const uploadImage = trpc.products.uploadImage.useMutation();
  const archive = trpc.products.archive.useMutation({ onSuccess: () => { toast.success("Listing archived."); utils.products.mine.invalidate(); utils.marketplace.list.invalidate(); }, onError: error => toast.error(error.message) });
  const submitProduct = trpc.products.submit.useMutation({ onSuccess: () => { toast.success("Product submitted for verification."); utils.products.mine.invalidate(); }, onError: error => toast.error(error.message) });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (Number(values.minOrderQty) > Number(values.stock)) return;
    let primaryImageUrl = values.imageUrl || null;
    if (imageFile) {
      try {
        primaryImageUrl = await uploadProductImage(imageFile, input => uploadImage.mutateAsync(input));
      } catch (error) {
        setImageError(error instanceof Error ? error.message : "Image upload failed.");
        toast.error(error instanceof Error ? error.message : "Image upload failed.");
        return;
      }
    }
    update.mutate({ id: product.id, name: values.name, category: values.category, variety: values.variety, description: values.description, unit: values.unit as typeof PRODUCT_UNITS[number], priceCents: Math.round(Number(values.price) * 100), stockQty: Number(values.stock), minOrderQty: Number(values.minOrderQty), qualityGrade: values.qualityGrade, status: values.status, primaryImageUrl });
  };
  if (editing) return <form onSubmit={save} className="rounded-2xl border-2 border-[#abd19e] bg-[#f2f8ef] p-4"><label className="field-label">Product name<input required className="field-control" value={values.name} onChange={e => setValues({ ...values, name: e.target.value })}/></label><label className="field-label mt-3">Classification<input required className="field-control" value={values.category} onChange={e => setValues({ ...values, category: e.target.value })}/></label><label className="field-label mt-3">Variety<input required list={`product-varieties-${product.id}`} className="field-control" value={values.variety} onChange={e => setValues({ ...values, variety: e.target.value })}/><datalist id={`product-varieties-${product.id}`}>{getProductVarieties(values.name).map(variety => <option value={variety} key={variety}/>)}</datalist></label><label className="field-label mt-3">Description<textarea required className="field-control min-h-24" value={values.description} onChange={e => setValues({ ...values, description: e.target.value })}/></label><div className="mt-3 grid grid-cols-2 gap-2"><label className="field-label">Price per unit (PHP)<input required className="field-control" type="number" min="0.01" step="0.01" value={values.price} onChange={e => setValues({ ...values, price: e.target.value })}/></label><label className="field-label">Unit<select required className="field-control" value={values.unit} onChange={e => setValues({ ...values, unit: e.target.value })}>{PRODUCT_UNITS.map(unit => <option value={unit} key={unit}>{unit === "kg" ? "kilogram (kg)" : unit}</option>)}</select></label><label className="field-label">Available stock ({values.unit})<input required className="field-control" type="number" min="1" step="1" value={values.stock} onChange={e => setValues({ ...values, stock: e.target.value })}/></label><label className="field-label">Minimum order ({values.unit})<input required className="field-control" type="number" min="1" step="1" max={values.stock} value={values.minOrderQty} onChange={e => setValues({ ...values, minOrderQty: e.target.value })}/>{Number(values.minOrderQty) > Number(values.stock) && <span role="alert" className="mt-1 block text-xs text-[#a34838]">Minimum order cannot exceed available stock.</span>}</label></div><label className="field-label mt-3">Product image upload<input className="field-control" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { setImageFile(e.target.files?.[0] ?? null); setImageError(""); }}/></label>{imageError && <p role="alert" className="text-xs text-[#a34838]">{imageError}</p>}<label className="field-label mt-3">Quality grade<select className="field-control" value={values.qualityGrade} onChange={e => setValues({ ...values, qualityGrade: e.target.value as typeof values.qualityGrade })}><option value="premium">Premium</option><option value="standard">Standard</option><option value="imperfect">Imperfect / value-grade</option></select></label><label className="field-label mt-3">Status<select className="field-control" value={values.status} onChange={e => setValues({ ...values, status: e.target.value as "published" | "archived" })}><option value="published">Published</option><option value="archived">Archived</option></select></label><div className="mt-4 flex gap-2"><button className="agri-button px-3 py-2 text-xs" disabled={update.isPending || uploadImage.isPending}>Save changes</button><button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => setEditing(false)}>Cancel</button></div></form>;
  return <div className="rounded-2xl border border-[#e2e9dd] p-4"><div className="flex justify-between gap-3"><span className="rounded-full bg-[#eef5ea] px-2 py-1 text-xs font-bold text-[#4d784c]">{product.category}</span><Status value={product.verificationStatus || product.status}/></div><h3 className="mt-4 font-display text-xl font-bold text-[#28523a]">{product.name}</h3><p className="mt-1 text-sm text-[#647468]">{product.variety} · {peso(product.priceCents)} per {product.unit}</p><div className="mt-4 flex items-center justify-between border-t border-[#edf0e9] pt-3"><span className="text-xs font-bold text-[#607363]">Stock: {product.stockQty} {product.unit} · Minimum: {product.minOrderQty} {product.unit}</span><span className="text-xs text-[#688068]">{product.qualityGrade}</span></div><div className="mt-4 flex gap-3"><button onClick={() => setEditing(true)} className="agri-ghost px-3 py-2 text-xs">Edit listing</button>{product.verificationStatus !== "pending" && product.verificationStatus !== "approved" && <button onClick={() => submitProduct.mutate({ id: product.id })} className="agri-button px-3 py-2 text-xs">Submit for verification</button>}{product.status === "published" && <button onClick={() => archive.mutate({ id: product.id })} className="text-xs font-bold text-[#a34838]">Archive</button>}</div></div>;
}
function QuotationResponse({ row, onRespond }: { row: any; onRespond: (price: number, note: string | undefined, status: "responded" | "declined") => void }) {
  const [price, setPrice] = useState(""); const [note, setNote] = useState("");
  return <div className="rounded-xl bg-[#f2f6ef] p-4"><div className="flex justify-between gap-2"><div><p className="font-bold text-[#315640]">{row.productName}</p><p className="mt-1 text-xs text-[#6d7d70]">{row.buyerName || "Buyer"} requests {row.quotation.requestedQty} {row.unit}</p></div><Status value={row.quotation.status}/></div>{row.quotation.buyerNote && <p className="mt-2 text-xs italic leading-5 text-[#647568]">“{row.quotation.buyerNote}”</p>}{row.quotation.status === "requested" && <div className="mt-3 flex gap-2"><label className="sr-only" htmlFor={`quotation-price-${row.quotation.id}`}>Price per unit (PHP)</label><input id={`quotation-price-${row.quotation.id}`} type="number" min="0.01" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="Price per unit (PHP)" className="field-control mt-0 text-sm"/><button disabled={!price} onClick={() => onRespond(Math.round(Number(price) * 100), note || undefined, "responded")} className="agri-button shrink-0 px-3 py-2 text-xs">Reply</button><button onClick={() => onRespond(1, note || undefined, "declined")} className="text-xs font-bold text-[#a34838]">Decline</button></div>}</div>;
}

function SellerDashboard({ onExitSellerMode }: { onExitSellerMode?: () => void } = {}) {
  const utils = trpc.useUtils(); const { user } = useAuth(); const { data: products = [], isLoading } = trpc.products.mine.useQuery(); const { data: orders = [] } = trpc.orders.sellerMine.useQuery(undefined, { enabled: user?.role === "seller" }); const { data: quotations = [] } = trpc.quotations.sellerMine.useQuery(undefined, { enabled: user?.role === "seller" });
  const emptyForm = () => ({ name: "", category: "Crop Production", variety: "", description: "", unit: "kg", price: "", stock: "", minOrderQty: "1", qualityGrade: "standard" as "premium" | "standard" | "imperfect" });
  const [openForm, setOpenForm] = useState(false); const [form, setForm] = useState(emptyForm); const [imageFile, setImageFile] = useState<File | null>(null); const [imageError, setImageError] = useState("");
  const uploadImage = trpc.products.uploadImage.useMutation();
  const create = trpc.products.create.useMutation({ onSuccess: () => { toast.success("Product listing submitted for verification."); setOpenForm(false); setForm(emptyForm()); setImageFile(null); setImageError(""); utils.products.mine.invalidate(); utils.marketplace.list.invalidate(); }, onError: error => toast.error(error.message) });
  const updateStatus = trpc.orders.updateStatus.useMutation({ onSuccess: () => { toast.success("Order status updated."); utils.orders.sellerMine.invalidate(); utils.products.mine.invalidate(); }, onError: error => toast.error(error.message) });
  const respond = trpc.quotations.respond.useMutation({ onSuccess: () => { toast.success("Quotation response sent."); utils.quotations.sellerMine.invalidate(); }, onError: error => toast.error(error.message) });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (Number(form.minOrderQty) > Number(form.stock)) return;
    let imageUrl: string | undefined;
    if (imageFile) {
      try {
        imageUrl = await uploadProductImage(imageFile, input => uploadImage.mutateAsync(input));
      } catch (error) {
        setImageError(error instanceof Error ? error.message : "Image upload failed.");
        toast.error(error instanceof Error ? error.message : "Image upload failed.");
        return;
      }
    }
    create.mutate({ name: form.name, category: form.category, variety: form.variety, description: form.description, unit: form.unit as typeof PRODUCT_UNITS[number], priceCents: Math.round(Number(form.price) * 100), stockQty: Number(form.stock), minOrderQty: Number(form.minOrderQty), qualityGrade: form.qualityGrade, imageUrls: imageUrl ? [imageUrl] : [] });
  };
  return <><WorkspaceHeader title={onExitSellerMode ? "Seller workspace (acting as seller)" : "Farmer workspace"} description="Manage harvest listings, quotations, inventory, and fulfillment."/>{onExitSellerMode && <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8"><button className="agri-ghost text-sm" onClick={onExitSellerMode}>Return to Admin workspace</button></div>}<main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="grid gap-4 md:grid-cols-3"><Metric label="Active listings" value={String(products.filter(product => product.status === "published").length)} icon={Package}/><Metric label="Incoming orders" value={String(orders.filter(row => row.order.status === "submitted").length)} icon={ClipboardList}/><Metric label="Waiting quotations" value={String(quotations.filter(row => row.quotation.status === "requested").length)} icon={FileText}/></div><section className="mt-8 agri-card p-5 sm:p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="font-display text-2xl font-bold text-[#264f37]">Your produce listings</h2><p className="mt-1 text-sm text-[#6a796e]">Edit product details, manually update stock, or archive unavailable listings.</p></div><button className="agri-button text-sm" onClick={() => setOpenForm(!openForm)}><Plus size={17}/>{openForm ? "Close form" : "Add harvest"}</button></div>{openForm && <form onSubmit={submit} className="mt-6 grid gap-4 rounded-2xl bg-[#f1f6ee] p-5 md:grid-cols-2"><label className="field-label">Product name<input required className="field-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label className="field-label">Classification<input required className="field-control" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}/></label><label className="field-label">Variety<input required list="new-product-varieties" className="field-control" value={form.variety} onChange={e => setForm({ ...form, variety: e.target.value })}/><datalist id="new-product-varieties">{getProductVarieties(form.name).map(variety => <option value={variety} key={variety}/>)}</datalist></label><label className="field-label">Price per chosen unit (PHP)<input required min="0.01" step="0.01" type="number" className="field-control" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}/></label><label className="field-label">Unit of measurement<select required className="field-control" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>{PRODUCT_UNITS.map(unit => <option value={unit} key={unit}>{unit === "kg" ? "kilogram (kg)" : unit}</option>)}</select></label><label className="field-label">Available stock ({form.unit})<input required min="1" step="1" type="number" className="field-control" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })}/></label><label className="field-label">Minimum order quantity ({form.unit})<input required min="1" max={form.stock} step="1" type="number" className="field-control" value={form.minOrderQty} onChange={e => setForm({ ...form, minOrderQty: e.target.value })}/>{Number(form.minOrderQty) > Number(form.stock) && <span role="alert" className="mt-1 block text-xs text-[#a34838]">Minimum order cannot exceed available stock.</span>}</label><label className="field-label">Product image upload<input className="field-control" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { setImageFile(e.target.files?.[0] ?? null); setImageError(""); }}/>{imageError && <span role="alert" className="mt-1 block text-xs text-[#a34838]">{imageError}</span>}</label><label className="field-label">Quality grade<select className="field-control" value={form.qualityGrade} onChange={e => setForm({ ...form, qualityGrade: e.target.value as typeof form.qualityGrade })}><option value="premium">Premium</option><option value="standard">Standard</option><option value="imperfect">Imperfect / value-grade</option></select></label><label className="field-label md:row-span-2">Description<textarea required className="field-control min-h-29" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label><div><button disabled={create.isPending || uploadImage.isPending} className="agri-button text-sm">{create.isPending || uploadImage.isPending ? <Loader2 className="animate-spin" size={15}/> : null} Submit listing</button></div></form>}<div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{isLoading ? <Loader2 className="m-8 animate-spin text-[#5d8a5e]"/> : products.length ? products.map(product => <SellerProductCard key={product.id} product={product}/>) : <Empty icon={Package} title="No products published" body="Add your first harvest to begin reaching buyers."/>}</div></section><section className="mt-8 grid gap-8 xl:grid-cols-2"><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Fulfillment queue</h2><div className="mt-5 space-y-3">{orders.length ? orders.map(row => <div key={`${row.order.id}-${row.item.id}`} className="rounded-xl bg-[#f2f6ef] p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-bold text-[#315640]">Order #{row.order.id} · {row.buyerName || "Buyer"}</p><p className="mt-1 text-xs text-[#6f7d72]">{row.productName} × {row.item.quantity} {row.unit} · {peso(row.item.unitPriceCents * row.item.quantity)}</p></div><Status value={row.order.status}/></div>{row.order.status !== "completed" && row.order.status !== "cancelled" && <div className="mt-4 flex flex-wrap gap-2">{row.order.status === "submitted" && <button onClick={() => updateStatus.mutate({ orderId: row.order.id, status: "confirmed" })} className="agri-ghost px-3 py-2 text-xs">Confirm</button>}{row.order.status === "confirmed" && <button onClick={() => updateStatus.mutate({ orderId: row.order.id, status: "ready" })} className="agri-ghost px-3 py-2 text-xs">Mark ready</button>}{row.order.status === "ready" && <button onClick={() => { const note = window.prompt("Optional F2F payment reference note:") || undefined; updateStatus.mutate({ orderId: row.order.id, status: "completed", paymentReferenceNote: note }); }} className="agri-button px-3 py-2 text-xs">Complete & record</button>}<button onClick={() => updateStatus.mutate({ orderId: row.order.id, status: "cancelled" })} className="text-xs font-bold text-[#a34838]">Cancel</button></div>}</div>) : <Empty icon={ClipboardList} title="No incoming orders" body="New buyer orders will appear here."/>}</div></div><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Quotation requests</h2><div className="mt-5 space-y-3">{quotations.length ? quotations.map(row => <QuotationResponse key={row.quotation.id} row={row} onRespond={(quotedPriceCents, sellerNote, status) => respond.mutate({ quotationId: row.quotation.id, quotedPriceCents, sellerNote, status })}/>) : <Empty icon={FileText} title="No quotation requests" body="Buyer quotation requests will be shown here."/>}</div></div></section></main></>;
}
function SupabaseSellerDashboard() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { data: products = [], isLoading, error } = trpc.supabaseProducts.mine.useQuery(undefined, { enabled: user?.role === "seller" });
  const [form, setForm] = useState({ name: "", category: "", description: "", unit: "kg", price: "", stock: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const create = trpc.supabaseProducts.create.useMutation({ onSuccess: () => { toast.success("Product saved to Supabase."); setForm({ name: "", category: "", description: "", unit: "kg", price: "", stock: "" }); utils.supabaseProducts.mine.invalidate(); utils.marketplace.list.invalidate(); }, onError: problem => toast.error(problem.message) });
  const update = trpc.supabaseProducts.update.useMutation({ onSuccess: () => { toast.success("Product and inventory updated."); setEditingId(null); utils.supabaseProducts.mine.invalidate(); utils.marketplace.list.invalidate(); }, onError: problem => toast.error(problem.message) });
  const archive = trpc.supabaseProducts.archive.useMutation({ onSuccess: () => { toast.success("Product archived."); utils.supabaseProducts.mine.invalidate(); utils.marketplace.list.invalidate(); }, onError: problem => toast.error(problem.message) });
  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate({ name: form.name, category: form.category, description: form.description, unit: form.unit, priceCents: Math.round(Number(form.price) * 100), stockQty: Number(form.stock), status: "available" }); };
  return <><WorkspaceHeader title="Farmer workspace" description="Manage products and inventory stored in the Supabase marketplace tables."/><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="mb-6 rounded-2xl border border-[#dce8d5] bg-[#f1f6ee] p-4 text-sm leading-6 text-[#4a6651]">This workspace uses the verified Supabase fields: product name, category, description, unit, price, status, and inventory quantity. Variety, product images, quality grades, and minimum-order fields are not present in the existing database schema and are not submitted.</div>{error && <div className="mb-6 rounded-xl bg-[#fff1ec] p-4 text-sm text-[#a34838]">{error.message}</div>}<section className="grid gap-7 lg:grid-cols-[360px_1fr]"><form onSubmit={submit} className="agri-card h-fit p-5"><h2 className="font-display text-2xl font-bold text-[#264f37]">Add product</h2><label className="field-label mt-4">Product name<input required className="field-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label className="field-label mt-4">Category<input required className="field-control" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}/></label><label className="field-label mt-4">Description<textarea required className="field-control min-h-28" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label><label className="field-label mt-4">Unit<select className="field-control" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>{PRODUCT_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label><label className="field-label mt-4">Price (PHP)<input required min="0.01" step="0.01" type="number" className="field-control" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}/></label><label className="field-label mt-4">Stock quantity<input required min="0" step="1" type="number" className="field-control" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })}/></label><button className="agri-button mt-5 w-full" disabled={create.isPending}>{create.isPending ? <Loader2 className="animate-spin" size={16}/> : <Plus size={16}/>} Save product</button></form><div className="agri-card p-5"><div className="flex items-center justify-between"><div><h2 className="font-display text-2xl font-bold text-[#264f37]">Your Supabase products</h2><p className="mt-1 text-sm text-[#6a796e]">Inventory quantity is stored separately in the inventory table.</p></div><span className="rounded-full bg-[#edf3e9] px-3 py-1 text-xs font-bold text-[#487249]">{products.length} records</span></div><div className="mt-5 space-y-3">{isLoading ? <Loader2 className="mx-auto my-10 animate-spin text-[#5d8a5e]"/> : products.length ? products.map(product => editingId === product.id ? <form key={product.id} onSubmit={event => { event.preventDefault(); update.mutate({ productId: product.id, name: form.name, category: form.category, description: form.description, unit: form.unit, priceCents: Math.round(Number(form.price) * 100), stockQty: Number(form.stock), status: product.status === "archived" ? "archived" : "available" }); }} className="rounded-xl border-2 border-[#abd19e] bg-[#f2f8ef] p-4"><p className="font-bold text-[#315640]">Editing {product.name}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><input required className="field-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/><input required className="field-control" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}/><textarea required className="field-control sm:col-span-2" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/><input required min="0.01" step="0.01" type="number" className="field-control" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}/><input required min="0" step="1" type="number" className="field-control" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })}/></div><div className="mt-3 flex gap-2"><button className="agri-button px-3 py-2 text-xs" disabled={update.isPending}>Save</button><button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => setEditingId(null)}>Cancel</button></div></form> : <div key={product.id} className="rounded-xl border border-[#e2e9dd] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-[#315640]">{product.name}</p><p className="mt-1 text-xs text-[#6d7d70]">{product.category} · {product.unit} · {peso(product.priceCents)}</p></div><Status value={product.status}/></div><p className="mt-3 text-sm text-[#65766b]">{product.description}</p><p className="mt-3 text-xs font-bold text-[#45614e]">Stock: {product.stockQty} {product.unit}</p><div className="mt-4 flex gap-2"><button className="agri-ghost px-3 py-2 text-xs" onClick={() => { setEditingId(product.id); setForm({ name: product.name, category: product.category, description: product.description, unit: product.unit, price: String(product.priceCents / 100), stock: String(product.stockQty) }); }}>Edit</button>{product.status !== "archived" && <button className="text-xs font-bold text-[#a34838]" onClick={() => archive.mutate({ productId: product.id })}>Archive</button>}</div></div>) : <Empty icon={Package} title="No Supabase products" body="Create a product using the fields supported by the existing database schema."/>}</div></div></section></main></>;
}

function SupabaseOfficerDashboard() {
  const utils = trpc.useUtils();
  const { data: overview, isLoading, error } = trpc.supabaseOfficer.overview.useQuery();
  const refresh = () => utils.supabaseOfficer.overview.invalidate();
  const memberStatus = trpc.supabaseOfficer.updateMemberStatus.useMutation({ onSuccess: () => { toast.success("Member status updated."); refresh(); }, onError: problem => toast.error(problem.message) });
  const productReview = trpc.supabaseOfficer.reviewProduct.useMutation({ onSuccess: () => { toast.success("Product status updated."); refresh(); utils.marketplace.list.invalidate(); }, onError: problem => toast.error(problem.message) });
  const quotationReview = trpc.supabaseOfficer.reviewQuotation.useMutation({ onSuccess: () => { toast.success("Quotation response saved."); refresh(); }, onError: problem => toast.error(problem.message) });
  const orderStatus = trpc.supabaseOfficer.updateOrderStatus.useMutation({ onSuccess: () => { toast.success("Order status updated."); refresh(); }, onError: problem => toast.error(problem.message) });
  if (isLoading) return <LoadingWorkspace/>;
  if (error) return <><WorkspaceHeader title="Cooperative officer workspace" description="Manage records within your assigned cooperative."/><main className="mx-auto max-w-3xl px-4 py-8"><div className="rounded-2xl bg-[#fff1ec] p-5 text-sm text-[#a34838]">{error.message}</div></main></>;
  return <><WorkspaceHeader title="Cooperative officer workspace" description="Review cooperative members, product availability, quotations, and order fulfillment from Supabase records."/><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="grid gap-4 md:grid-cols-5"><Metric label="Members" value={String(overview?.members.length ?? 0)} icon={Users}/><Metric label="Products" value={String(overview?.products.length ?? 0)} icon={Package}/><Metric label="Quotations" value={String(overview?.quotations.length ?? 0)} icon={FileText}/><Metric label="Orders" value={String(overview?.orders.length ?? 0)} icon={ClipboardList}/><Metric label="Transactions" value={String(overview?.transactions.length ?? 0)} icon={BarChart3}/></div><section className="mt-8 grid gap-8 xl:grid-cols-2"><div className="agri-card p-5"><h2 className="font-display text-2xl font-bold text-[#264f37]">Members</h2><div className="mt-4 space-y-2">{overview?.members.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f2f6ef] p-3"><div><p className="font-bold text-[#315640]">{member.name || member.email || member.id}</p><p className="text-xs text-[#718174]">{member.role} · {member.approvalStatus}</p></div>{member.role !== "admin" && member.role !== "superadmin" && <button className="agri-ghost px-3 py-2 text-xs" onClick={() => memberStatus.mutate({ userId: member.id, accountStatus: member.approvalStatus === "approved" ? "suspended" : "approved" })}>{member.approvalStatus === "approved" ? "Suspend" : "Approve"}</button>}</div>)}{!overview?.members.length && <Empty icon={Users} title="No cooperative members" body="No profiles are currently assigned to this cooperative."/>}</div></div><div className="agri-card p-5"><h2 className="font-display text-2xl font-bold text-[#264f37]">Products and inventory</h2><div className="mt-4 space-y-2">{overview?.products.map(product => <div key={product.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f2f6ef] p-3"><div><p className="font-bold text-[#315640]">{product.name}</p><p className="text-xs text-[#718174]">{product.stockQty} {product.unit} · {product.status}</p></div><button className="agri-ghost px-3 py-2 text-xs" onClick={() => productReview.mutate({ productId: product.id, decision: product.status === "archived" ? "available" : "archived" })}>{product.status === "archived" ? "Activate" : "Archive"}</button></div>)}{!overview?.products.length && <Empty icon={Package} title="No cooperative products" body="No seller products are currently assigned to this cooperative."/>}</div></div><div className="agri-card p-5"><h2 className="font-display text-2xl font-bold text-[#264f37]">Quotation queue</h2><div className="mt-4 space-y-3">{overview?.quotations.map(row => <div key={row.quotation.id} className="rounded-xl border border-[#e2e9dd] p-4"><div className="flex justify-between gap-2"><div><p className="font-bold text-[#315640]">{row.productName}</p><p className="text-xs text-[#718174]">{row.buyerName || "Buyer"} · {row.quotation.requestedQty} {row.unit}</p></div><Status value={row.quotation.status}/></div>{row.quotation.status === "requested" && <div className="mt-3 flex gap-2"><button className="agri-button px-3 py-2 text-xs" onClick={() => { const value = window.prompt("Proposed price per unit (PHP):"); const price = value ? Math.round(Number(value) * 100) : 0; if (price > 0) quotationReview.mutate({ quotationId: row.quotation.id, decision: "responded", proposedPriceCents: price }); }}>Respond</button><button className="text-xs font-bold text-[#a34838]" onClick={() => quotationReview.mutate({ quotationId: row.quotation.id, decision: "declined" })}>Decline</button></div>}</div>)}{!overview?.quotations.length && <Empty icon={FileText} title="No quotation requests" body="Quotation records will appear here when buyers submit requests."/>}</div></div><div className="agri-card p-5"><h2 className="font-display text-2xl font-bold text-[#264f37]">Order fulfillment</h2><div className="mt-4 space-y-3">{overview?.orders.map(order => <div key={order.order_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f2f6ef] p-3"><div><p className="font-bold text-[#315640]">Order {order.order_id}</p><p className="text-xs text-[#718174]">{order.order_type} · PHP {Number(order.total_amount).toFixed(2)}</p></div><div className="flex items-center gap-2"><Status value={order.status}/>{order.status !== "completed" && order.status !== "cancelled" && <button className="agri-ghost px-3 py-2 text-xs" onClick={() => { const next = order.status === "submitted" ? "confirmed" : order.status === "confirmed" ? "ready" : "completed"; orderStatus.mutate({ orderId: order.order_id, status: next }); }}>Advance</button>}</div></div>)}{!overview?.orders.length && <Empty icon={ClipboardList} title="No orders" body="Orders associated with this cooperative will appear here."/>}</div></div></section></main></>;
}

function SupabaseAdminDashboard() {
  const utils = trpc.useUtils();
  const { data: overview, isLoading, error } = trpc.supabaseAdmin.overview.useQuery();
  const updateProfile = trpc.supabaseAdmin.updateProfile.useMutation({ onSuccess: () => { toast.success("Profile updated."); utils.supabaseAdmin.overview.invalidate(); }, onError: problem => toast.error(problem.message) });
  if (isLoading) return <LoadingWorkspace/>;
  if (error) return <><WorkspaceHeader title="System administration" description="Manage verified Supabase profiles and records."/><main className="mx-auto max-w-3xl px-4 py-8"><div className="rounded-2xl bg-[#fff1ec] p-5 text-sm text-[#a34838]">{error.message}</div></main></>;
  return <><WorkspaceHeader title="System administration" description="Cross-cooperative oversight backed by Supabase PostgreSQL records."/><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="grid gap-4 md:grid-cols-5"><Metric label="Profiles" value={String(overview?.profiles.length ?? 0)} icon={Users}/><Metric label="Products" value={String(overview?.products.length ?? 0)} icon={Package}/><Metric label="Orders" value={String(overview?.orders.length ?? 0)} icon={ClipboardList}/><Metric label="Transactions" value={String(overview?.transactions.length ?? 0)} icon={BarChart3}/><Metric label="Activity logs" value={String(overview?.activityLogs.length ?? 0)} icon={FileText}/></div><section className="mt-8 agri-card overflow-x-auto p-5"><h2 className="font-display text-2xl font-bold text-[#264f37]">Profiles and account status</h2><table className="mt-4 w-full min-w-[800px] text-left text-sm"><thead className="border-b border-[#e2e9dd] text-xs uppercase tracking-wide text-[#718174]"><tr><th className="pb-3">Profile</th><th className="pb-3">Role ID</th><th className="pb-3">Cooperative</th><th className="pb-3">Status</th><th className="pb-3"/></tr></thead><tbody>{overview?.profiles.map(profile => <tr key={profile.user_id} className="border-b border-[#edf0e9]"><td className="py-3"><p className="font-bold text-[#315640]">{profile.full_name || profile.email || profile.user_id}</p><p className="text-xs text-[#718174]">{profile.email}</p></td><td className="py-3">{profile.role_id}</td><td className="py-3">{profile.cooperative_id || "None"}</td><td className="py-3">{profile.account_status}</td><td className="py-3 text-right"><button className="agri-ghost px-3 py-2 text-xs" onClick={() => updateProfile.mutate({ userId: profile.user_id, roleName: profile.role_id === 4 ? "system_admin" : profile.role_id === 3 ? "coop_officer" : profile.role_id === 2 ? "seller" : "buyer", accountStatus: profile.account_status === "approved" ? "suspended" : "approved", cooperativeId: profile.cooperative_id })}>{profile.account_status === "approved" ? "Suspend" : "Approve"}</button></td></tr>)}</tbody></table>{!overview?.profiles.length && <Empty icon={Users} title="No profiles" body="No Supabase profiles are currently available."/>}</section></main></>;
}

function OfficerDashboard() {
  const utils = trpc.useUtils(); const { data: overview, isLoading, error } = trpc.cooperativeAdmin.overview.useQuery();
  const updateMember = trpc.cooperativeAdmin.updateMemberStatus.useMutation({ onSuccess: () => { toast.success("Member status updated."); utils.cooperativeAdmin.overview.invalidate(); }, onError: problem => toast.error(problem.message) });
  if (isLoading) return <LoadingWorkspace/>;
  if (error) return <><WorkspaceHeader title="Cooperative officer workspace" description="Monitor members and marketplace coordination for your assigned cooperative."/><main className="mx-auto max-w-3xl px-4 py-8"><div className="flex gap-3 rounded-2xl border border-[#e9dba9] bg-[#fff8e2] p-4 text-sm leading-6 text-[#76551b]"><AlertCircle className="mt-0.5 shrink-0" size={18}/><div><strong>Officer setup required</strong><p>{error.message}</p></div></div></main></>;
  const totalSales = overview?.transactions.reduce((sum, row) => sum + row.transactions.amountCents, 0) || 0;
  const downloadReport = () => { const rows = [["Report type", "Name / ID", "Detail", "Value (PHP)"], ...(overview?.products || []).map(product => ["Inventory", product.name, `${product.category} · ${product.variety} · ${product.stockQty} ${product.unit} available · minimum ${product.minOrderQty} ${product.unit}`, `${peso(product.priceCents)} per ${product.unit}`]), ...(overview?.quotations || []).map(row => ["Quotation", row.productName, `${row.buyerName || "Buyer"} · ${row.quotation.requestedQty} ${row.unit} requested · ${row.quotation.status}`, row.quotation.quotedPriceCents ? `${peso(row.quotation.quotedPriceCents)} per ${row.unit}` : "Pending"]), ...(overview?.transactions || []).map(row => ["Transaction", `Order #${row.transactions.orderId}`, row.transactions.paymentReferenceNote || "F2F coordination noted", peso(row.transactions.amountCents)])]; const url = URL.createObjectURL(new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "agricoop-cooperative-report.csv"; link.click(); URL.revokeObjectURL(url); };
  return <><WorkspaceHeader title="Cooperative officer workspace" description="Validate members, oversee listings and transactions, and keep cooperative trade accountable."/><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="grid gap-4 md:grid-cols-5"><Metric label="Cooperative members" value={String(overview?.members.length || 0)} icon={Users}/><Metric label="Listings monitored" value={String(overview?.products.length || 0)} icon={Package}/><Metric label="Quotations monitored" value={String(overview?.quotations.length || 0)} icon={FileText}/><Metric label="Orders recorded" value={String(overview?.orders.length || 0)} icon={ClipboardList}/><Metric label="Recorded sales" value={peso(totalSales)} icon={BarChart3}/></div><section className="mt-8 grid gap-8 xl:grid-cols-[1.15fr_.85fr]"><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Member validation</h2><p className="mt-1 text-sm text-[#6a796e]">Approve or suspend cooperative member roles within your assigned organization.</p><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="border-b border-[#e2e9dd] text-xs uppercase tracking-wide text-[#718174]"><tr><th className="pb-3">Member</th><th className="pb-3">Role</th><th className="pb-3">Status</th><th className="pb-3"></th></tr></thead><tbody>{overview?.members.map(member => <tr key={member.id} className="border-b border-[#edf0e9]"><td className="py-3 font-bold text-[#315640]">{member.name || "Unnamed member"}</td><td className="py-3 capitalize text-[#647568]">{member.role}</td><td className="py-3"><Status value={member.approvalStatus}/></td><td className="py-3 text-right">{member.role !== "admin" && member.role !== "superadmin" && (member.approvalStatus !== "approved" ? <button className="agri-ghost px-2.5 py-1.5 text-xs" onClick={() => updateMember.mutate({ userId: member.id, approvalStatus: "approved" })}>Approve</button> : <button className="text-xs font-bold text-[#a34838]" onClick={() => updateMember.mutate({ userId: member.id, approvalStatus: "suspended" })}>Suspend</button>)}</td></tr>)}</tbody></table>{!overview?.members.length && <p className="py-8 text-center text-sm text-[#6d7d70]">No members are associated with this cooperative yet.</p>}</div></div><div className="space-y-8"><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Inventory pulse</h2><div className="mt-4 space-y-3">{overview?.products.length ? overview.products.map(product => <div key={product.id} className="flex items-center justify-between rounded-xl bg-[#f2f6ef] p-3"><div><p className="font-bold text-[#315640]">{product.name}</p><p className="text-xs text-[#6c7c70]">{product.category} · {product.unit}</p></div><span className={`text-sm font-bold ${product.stockQty < 10 ? "text-[#a35538]" : "text-[#2c6b43]"}`}>{product.stockQty} left</span></div>) : <p className="text-sm text-[#6d7d70]">No cooperative listings to monitor yet.</p>}</div></div><div className="agri-card p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-2xl font-bold text-[#264f37]">Report snapshot</h2><p className="mt-2 text-sm leading-6 text-[#65766b]">Live sales, inventory, quotation, and completed-transaction reporting for your cooperative.</p></div><button onClick={downloadReport} className="agri-ghost shrink-0 px-3 py-2 text-xs"><Download size={15}/> Export CSV</button></div><div className="mt-4 rounded-xl bg-[#edf3e9] p-4"><p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#638947]">Payment coordination / status</p><p className="mt-1 text-sm text-[#41634c]">{overview?.transactions.length || 0} completed transactions documented with payment reference notes where provided.</p></div></div></div></section></main></>;
}

function AdminUserRow({ user, cooperativeName, cooperatives, canAssignSuperAdmin, onSave }: { user: any; cooperativeName: string | null; cooperatives: any[]; canAssignSuperAdmin: boolean; onSave: (values: any) => void }) {
  const [role, setRole] = useState(user.role === "user" ? "buyer" : user.role); const [approvalStatus, setApprovalStatus] = useState(user.approvalStatus); const [cooperativeId, setCooperativeId] = useState(user.cooperativeId?.toString() || "");
  return <tr className="border-t border-[#edf0e9]"><td className="p-3"><p className="font-bold text-[#315640]">{user.name || "Unnamed user"}</p><p className="text-xs text-[#718074]">{user.email || "No email"}</p></td><td className="p-3"><select className="rounded border border-[#d5e0d1] bg-white p-1.5" value={role} onChange={e => setRole(e.target.value)}><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="admin">Officer</option>{canAssignSuperAdmin && <option value="superadmin">SuperAdmin</option>}</select></td><td className="p-3"><select className="max-w-40 rounded border border-[#d5e0d1] bg-white p-1.5" value={cooperativeId} onChange={e => setCooperativeId(e.target.value)}><option value="">None</option>{cooperatives.map(cooperative => <option key={cooperative.id} value={cooperative.id}>{cooperative.name}</option>)}</select>{cooperativeName && <p className="mt-1 text-xs text-[#718074]">Current: {cooperativeName}</p>}</td><td className="p-3"><select className="rounded border border-[#d5e0d1] bg-white p-1.5" value={approvalStatus} onChange={e => setApprovalStatus(e.target.value)}><option value="approved">Approved</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select></td><td className="p-3"><button onClick={() => onSave({ role, approvalStatus, cooperativeId: cooperativeId ? Number(cooperativeId) : null })} className="agri-ghost px-3 py-2 text-xs">Save</button></td></tr>;
}

function AdminOrderCard({ orderId }: { orderId: number }) {
  const utils = trpc.useUtils();
  const [completionOpen, setCompletionOpen] = useState(false);
  const [finalQuantities, setFinalQuantities] = useState<Record<number, string>>({});
  const [completionError, setCompletionError] = useState("");
  const { data, isLoading, error } = trpc.cooperativeAdmin.orderDetails.useQuery({ orderId });
  const updateStatus = trpc.orders.updateStatus.useMutation({
    onSuccess: async () => {
      toast.success("Order updated.");
      setCompletionOpen(false);
      setCompletionError("");
      await Promise.all([
        utils.admin.overview.invalidate(),
        utils.cooperativeAdmin.orderDetails.invalidate({ orderId }),
        utils.cooperativeAdmin.overview.invalidate(),
      ]);
    },
    onError: problem => {
      setCompletionError(problem.message);
      toast.error(problem.message);
    },
  });
  const items = data?.items ?? [];
  const quantityError = (value: string, stockQty: number) => {
    if (!/^\d+$/.test(value)) return "Enter a whole number of zero or more.";
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity)) return "Enter a valid whole number.";
    if (quantity > stockQty) return `Only ${stockQty} units are currently in stock.`;
    return "";
  };
  const validQuantities = items.map(({ item, stockQty }) => ({
    item,
    value: finalQuantities[item.id] ?? String(item.quantity),
    error: quantityError(finalQuantities[item.id] ?? String(item.quantity), stockQty),
  }));
  const allQuantitiesValid = validQuantities.every(item => !item.error);
  const hasDeliveredQuantity = validQuantities.some(item => Number(item.value) > 0);
  const finalTotalCents = allQuantitiesValid
    ? items.reduce((total, { item }) => total + Number(finalQuantities[item.id] ?? item.quantity) * item.unitPriceCents, 0)
    : null;
  const startCompletion = () => {
    setFinalQuantities(Object.fromEntries(items.map(({ item }) => [item.id, String(item.quantity)])));
    setCompletionError("");
    setCompletionOpen(true);
  };
  const confirmCompletion = (event: FormEvent) => {
    event.preventDefault();
    const invalid = validQuantities.find(item => item.error);
    if (invalid) {
      setCompletionError(invalid.error);
      return;
    }
    if (!hasDeliveredQuantity) {
      setCompletionError("At least one final delivered quantity must be greater than zero.");
      return;
    }
    updateStatus.mutate({
      orderId,
      status: "completed",
      finalItems: validQuantities.map(({ item, value }) => ({ orderItemId: item.id, quantity: Number(value) })),
    });
  };
  const cancelOrder = () => {
    if (window.confirm("Cancel this order? No stock will be deducted.")) {
      updateStatus.mutate({ orderId, status: "cancelled" });
    }
  };

  if (isLoading) return <div className="rounded-xl bg-[#f2f6ef] p-4 text-sm text-[#6c7c70]">Loading order #{orderId}…</div>;
  if (error || !data) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load order #{orderId}: {error?.message ?? "Order details are unavailable."}</div>;

  return <article className="rounded-xl border border-[#e2e9dd] bg-[#f8faf6] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-bold text-[#315640]">Order #{orderId} · {data.buyer?.name || "Buyer"}</p>
        <p className="mt-1 text-sm text-[#6c7c70]">{peso(data.order.totalCents)} · {when(data.order.createdAt)}</p>
      </div>
      <Status value={data.order.status}/>
    </div>
    <div className="mt-3 space-y-1 text-sm text-[#586d5d]">
      {items.map(({ item, productName, unit }) => <p key={item.id}>{productName} × {item.quantity} {unit} · {peso(item.unitPriceCents * item.quantity)}</p>)}
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      {data.order.status === "ready" && <button type="button" className="agri-button px-3 py-2 text-xs" onClick={startCompletion}>Complete</button>}
      {data.order.status !== "completed" && data.order.status !== "cancelled" && <button type="button" className="px-3 py-2 text-xs font-bold text-[#a34838]" onClick={cancelOrder}>Cancel</button>}
    </div>
    {completionOpen && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setCompletionOpen(false); }}>
      <form role="dialog" aria-modal="true" aria-labelledby={`complete-order-title-${orderId}`} onSubmit={confirmCompletion} className="my-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
        <h3 id={`complete-order-title-${orderId}`} className="font-display text-2xl font-bold text-[#264f37]">Complete order #{orderId}</h3>
        <p className="mt-1 text-sm text-[#6c7c70]">Enter the final delivered quantity for each item. Values cannot exceed current stock.</p>
        <div className="mt-5 space-y-4">
          {validQuantities.map(({ item, value, error: itemError }) => {
            const productItem = items.find(row => row.item.id === item.id)!;
            return <div key={item.id} className="rounded-xl border border-[#e2e9dd] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-[#315640]">{productItem.productName}</p>
                  <p className="mt-1 text-xs text-[#6c7c70]">Ordered: {item.quantity} {productItem.unit} · Price: {peso(item.unitPriceCents)} per {productItem.unit}</p>
                </div>
                <p className="text-xs text-[#6c7c70]">Stock: {productItem.stockQty} {productItem.unit}</p>
              </div>
              <label className="field-label mt-3">Final delivered quantity
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Final delivered quantity for ${productItem.productName}`}
                    aria-invalid={Boolean(itemError)}
                    className="field-control"
                    type="number"
                    min="0"
                    max={productItem.stockQty}
                    step="1"
                    inputMode="numeric"
                    value={value}
                    onChange={event => {
                      setFinalQuantities(current => ({ ...current, [item.id]: event.target.value }));
                      setCompletionError("");
                    }}
                  />
                  <span className="shrink-0 text-sm font-semibold text-[#586d5d]">{productItem.unit}</span>
                </div>
                {itemError && <span role="alert" className="mt-1 block text-xs text-[#a34838]">{itemError}</span>}
              </label>
            </div>;
          })}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-[#e2e9dd] pt-4">
          <span className="font-bold text-[#315640]">Final order total</span>
          <span aria-live="polite" className="font-display text-xl font-bold text-[#1d5639]">{finalTotalCents === null ? "Enter valid quantities" : peso(finalTotalCents)}</span>
        </div>
        {completionError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{completionError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="agri-ghost text-sm" disabled={updateStatus.isPending} onClick={() => setCompletionOpen(false)}>Back</button>
          <button type="submit" className="agri-button text-sm" disabled={updateStatus.isPending || !allQuantitiesValid}>Confirm completion</button>
        </div>
      </form>
    </div>}
  </article>;
}

function AdminDashboard() {
  const [sellerMode, setSellerMode] = useState(false);
  const { user } = useAuth();
  const utils = trpc.useUtils(); const { data: overview, isLoading } = trpc.admin.overview.useQuery(); const [name, setName] = useState(""); const [location, setLocation] = useState("");
  const createCooperative = trpc.cooperatives.create.useMutation({ onSuccess: () => { toast.success("Cooperative added."); setName(""); setLocation(""); utils.admin.overview.invalidate(); utils.cooperatives.list.invalidate(); }, onError: error => toast.error(error.message) });
  const updateUser = trpc.admin.updateUser.useMutation({ onSuccess: () => { toast.success("User settings saved."); utils.admin.overview.invalidate(); }, onError: error => toast.error(error.message) }); const reviewProduct = trpc.admin.reviewProduct.useMutation({ onSuccess: () => { toast.success("Product review saved."); utils.admin.overview.invalidate(); utils.marketplace.list.invalidate(); }, onError: error => toast.error(error.message) });
  if (sellerMode) return <SellerDashboard onExitSellerMode={() => setSellerMode(false)}/>; if (isLoading) return <LoadingWorkspace/>;
  return <><WorkspaceHeader title={user?.role === "superadmin" ? "System administration" : "Cooperative administration"} description={user?.role === "superadmin" ? "Coordinate roles, cooperative assignments, and platform-wide marketplace oversight." : "Manage listings and accounts within your assigned cooperative."}/><div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8"><button className="agri-ghost text-sm" onClick={() => setSellerMode(true)}>Act as seller</button></div><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><div className="grid gap-4 md:grid-cols-4"><Metric label={user?.role === "superadmin" ? "Platform users" : "Cooperative users"} value={String(overview?.users.length || 0)} icon={Users}/><Metric label={user?.role === "superadmin" ? "Cooperatives" : "Your cooperative"} value={String(overview?.cooperatives.length || 0)} icon={Store}/><Metric label="Product listings" value={String(overview?.products.length || 0)} icon={Package}/><Metric label="Transaction records" value={String(overview?.transactions.length || 0)} icon={ClipboardList}/></div><section className="mt-8 agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Order fulfillment</h2><p className="mt-1 text-sm text-[#6a796e]">Complete ready orders with actual delivered quantities, or cancel without deducting stock.</p><div className="mt-5 space-y-3">{overview?.orders.filter(order => order.status !== "completed" && order.status !== "cancelled").map(order => <AdminOrderCard key={order.id} orderId={order.id}/>)}{!overview?.orders.some(order => order.status !== "completed" && order.status !== "cancelled") && <p className="py-5 text-center text-sm text-[#6d7d70]">No orders are waiting for fulfillment.</p>}</div></section><section className="mt-8 agri-card overflow-hidden"><div className="p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Product verification queue</h2><p className="mt-1 text-sm text-[#6a796e]">Approve Seller submissions before buyer visibility is enabled.</p></div><div className="grid gap-3 border-t border-[#e3e9de] p-5 sm:grid-cols-2 lg:grid-cols-3">{overview?.products.filter(product => product.verificationStatus === "pending").map(product => <div key={product.id} className="rounded-2xl border border-[#e2e9dd] p-4"><p className="font-display text-xl font-bold text-[#28523a]">{product.name}</p><p className="mt-1 text-xs text-[#6d7d70]">{product.category} · {peso(product.priceCents)} / {product.unit}</p><div className="mt-4 flex gap-2"><button className="agri-button px-3 py-2 text-xs" onClick={() => reviewProduct.mutate({ productId: product.id, decision: "approved" })}>Approve</button><button className="agri-ghost px-3 py-2 text-xs text-[#a34838]" onClick={() => { const reason = window.prompt("Rejection reason:"); if (reason?.trim()) reviewProduct.mutate({ productId: product.id, decision: "rejected", rejectionReason: reason.trim() }); }}>Reject</button></div></div>)}{!overview?.products.some(product => product.verificationStatus === "pending") && <p className="col-span-full py-6 text-center text-sm text-[#6d7d70]">No products are waiting for review.</p>}</div></section><section className="mt-8 grid gap-8 xl:grid-cols-[1.3fr_.7fr]"><div className="agri-card overflow-hidden"><div className="p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Users and roles</h2><p className="mt-1 text-sm text-[#6a796e]">Apply role, approval, and cooperative assignment controls across the platform.</p></div><div className="overflow-x-auto border-t border-[#e3e9de]"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-[#f1f6ee] text-xs uppercase tracking-wide text-[#718174]"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Cooperative</th><th className="p-3">Approval</th><th className="p-3"></th></tr></thead><tbody>{overview?.users.map(row => <AdminUserRow key={row.user.id} user={row.user} cooperativeName={row.cooperativeName} cooperatives={overview.cooperatives} canAssignSuperAdmin={user?.role === "superadmin"} onSave={values => updateUser.mutate({ userId: row.user.id, ...values })}/>)}</tbody></table>{!overview?.users.length && <p className="p-8 text-center text-sm text-[#6d7d70]">No user accounts are available yet.</p>}</div></div><div className="space-y-8"><form onSubmit={event => { event.preventDefault(); createCooperative.mutate({ name, location }); }} className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Add a cooperative</h2><label className="field-label mt-4">Cooperative name<input required className="field-control" value={name} onChange={e => setName(e.target.value)}/></label><label className="field-label mt-4">Location<input required className="field-control" value={location} onChange={e => setLocation(e.target.value)} placeholder="City, Province"/></label><button className="agri-button mt-5 text-sm" disabled={createCooperative.isPending}><Plus size={16}/> Create cooperative</button></form><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Platform activity</h2><div className="mt-4 space-y-3">{overview?.orders.slice(0, 5).map(order => <div className="flex items-center justify-between rounded-xl bg-[#f2f6ef] p-3" key={order.id}><div><p className="font-bold text-[#315640]">Order #{order.id}</p><p className="text-xs text-[#6c7c70]">{peso(order.totalCents)} · {when(order.createdAt)}</p></div><Status value={order.status}/></div>)}{!overview?.orders.length && <p className="text-sm text-[#6d7d70]">Orders will appear as marketplace activity begins.</p>}</div></div></div></section></main></>;
}

export default function Dashboard() {
  const { user } = useAuth();
  return <AuthGate>{user?.role === "superadmin" ? <SupabaseAdminDashboard/> : user?.role === "admin" ? <SupabaseOfficerDashboard/> : user?.role === "seller" ? <SupabaseSellerDashboard/> : user?.role === "buyer" ? <BuyerDashboard/> : <Onboarding/>}</AuthGate>;
}
