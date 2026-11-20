import { shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { getAccountAccessRestriction } from "../../../shared/accountAccess";
import { buildCsv } from "../../../shared/reportCsv";
import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { formatDateManila } from "@/lib/datetime";
import { logAuthDiagnostic } from "@/lib/authSession";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import AdminRefundManagement from "@/components/AdminRefundManagement";
import { AdminOrderDetailsQueryError } from "@/components/AdminOrderDetailsQueryError";
import { StatusPill } from "@/components/StatusPill";
import AdminShell from "@/components/AdminShell";
import { adminNavForRole, adminSectionFromSearch } from "@/navigation/adminNav";
import { OfficerApplicationsPanel } from "@/components/OfficerApplicationsPanel";
import { AddAccountDialog } from "@/components/AddAccountDialog";
import { CooperativeDuplicateNotice } from "@/components/CooperativeDuplicateNotice";
import { CooperativeSelect, emptyCooperativeSelectValue, type CooperativeSelectValue } from "@/components/CooperativeSelect";
import {
  confirmNormalizedNameForNewCoop,
  cooperativeConflictFromError,
  type CooperativeConflictUi,
} from "@/lib/cooperativeConflict";
import { getProductImageUrl } from "@/lib/productImages";
import { formatCombinedEnumLabels, formatEnumLabel } from "@shared/enumLabels";
import { paymentMethodLabel } from "@shared/paymentMethods";
import {
  toUserFacingErrorMessage,
  USER_FACING_DELETE_COOPERATIVE_ERROR,
  USER_FACING_DELETE_USER_ERROR,
  USER_FACING_LOAD_ERROR,
  USER_FACING_SAVE_ERROR,
} from "@shared/userFacingErrors";
import { getProductVarieties, MAX_PRODUCT_IMAGE_SIZE_BYTES, MAX_PRODUCT_IMAGES, moveProductImage, PRODUCT_UNITS } from "../../../shared/productOptions";
import { PAYMENT_PROOF_BUCKET, PAYMENT_PROOF_CONTENT_TYPES, PAYMENT_PROOF_MAX_BYTES } from "../../../shared/paymentProofs";
import { PROFILE_VERIFICATION_BUCKET, PROFILE_VERIFICATION_CONTENT_TYPES, PROFILE_VERIFICATION_MAX_BYTES } from "../../../shared/profileVerification";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AlertCircle, BarChart3, Check, ClipboardList, Download, FileText, Leaf, Loader2, LucideIcon, MessageCircle, Package, Plus, Store, Users, QrCode } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useSearch } from "wouter";

const peso = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
const when = (value: Date | string | null) => formatDateManila(value);
const Status = StatusPill;

function ListingPaymentFlagFields({
  allowsPickup,
  allowsDelivery,
  onChange,
}: {
  allowsPickup: boolean;
  allowsDelivery: boolean;
  onChange: (patch: Partial<{ allowsPickup: boolean; allowsDelivery: boolean }>) => void;
}) {
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-white p-3 md:col-span-2">
      <p className="text-xs font-extrabold uppercase tracking-wide text-[#638947]">Buyer options</p>
      <label className="flex items-center gap-2 text-sm text-[#45614e]">
        <input type="checkbox" checked={allowsPickup} onChange={e => onChange({ allowsPickup: e.target.checked })} />
        Pickup
      </label>
      <label className="flex items-center gap-2 text-sm text-[#45614e]">
        <input type="checkbox" checked={allowsDelivery} onChange={e => onChange({ allowsDelivery: e.target.checked })} />
        Delivery
      </label>
      <p className="text-xs text-[#66766b]">Online payment is set by cooperative officers for the whole marketplace.</p>
      {allowsPickup === false && allowsDelivery === false && (
        <p role="alert" className="text-xs text-[#a34838]">Choose at least Pickup or Delivery.</p>
      )}
    </div>
  );
}

function readImageAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

function ProductImagePicker({ imageUrls, files, onImageUrlsChange, onFilesChange, error, onError, disabled = false }: {
  imageUrls: string[];
  files: File[];
  onImageUrlsChange: (urls: string[]) => void;
  onFilesChange: (files: File[]) => void;
  error: string;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const filePreviews = useMemo(
    () => files.map(file => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );
  useEffect(() => () => filePreviews.forEach(preview => URL.revokeObjectURL(preview.url)), [filePreviews]);

  const chooseFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selected.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_PRODUCT_IMAGE_SIZE_BYTES)) {
      onError("Choose JPEG, PNG, or WebP images that are 3 MB or less each.");
      return;
    }
    if (imageUrls.length + files.length + selected.length > MAX_PRODUCT_IMAGES) {
      onError(`A product can have up to ${MAX_PRODUCT_IMAGES} images.`);
      return;
    }
    onError("");
    onFilesChange([...files, ...selected]);
  };

  return <div className="field-label mt-3">
    Product image gallery ({imageUrls.length + files.length}/{MAX_PRODUCT_IMAGES})
    <input className="field-control" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || imageUrls.length + files.length >= MAX_PRODUCT_IMAGES} onChange={chooseFiles}/>
    {error && <span role="alert" className="mt-1 block text-xs text-[#a34838]">{error}</span>}
    {(imageUrls.length > 0 || files.length > 0) && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {imageUrls.map((url, index) => <div key={`${url}-${index}`} className="relative overflow-hidden rounded-lg border border-[#dce4d6]">
        <img src={url} alt={`Product image ${index + 1}`} className="h-28 w-full object-cover"/>
        <div className="absolute right-1 top-1 flex gap-1">
          <button type="button" className="rounded bg-white/90 px-2 py-1 text-xs font-bold" aria-label={`Move product image ${index + 1} earlier`} disabled={disabled || index === 0} onClick={() => onImageUrlsChange(moveProductImage(imageUrls, index, -1))}>Up</button>
          <button type="button" className="rounded bg-white/90 px-2 py-1 text-xs font-bold" aria-label={`Move product image ${index + 1} later`} disabled={disabled || index === imageUrls.length - 1} onClick={() => onImageUrlsChange(moveProductImage(imageUrls, index, 1))}>Down</button>
          <button type="button" className="rounded bg-white/90 px-2 py-1 text-xs font-bold text-[#8c4135]" aria-label={`Remove product image ${index + 1}`} disabled={disabled} onClick={() => onImageUrlsChange(imageUrls.filter((_, imageIndex) => imageIndex !== index))}>Remove</button>
        </div>
      </div>)}
      {filePreviews.map(({ file, url }, index) => <div key={`${file.name}-${index}`} className="relative overflow-hidden rounded-lg border border-[#dce4d6]">
        <img src={url} alt={`New product image ${index + imageUrls.length + 1}`} className="h-28 w-full object-cover"/>
        <div className="absolute right-1 top-1 flex gap-1">
          <button type="button" className="rounded bg-white/90 px-2 py-1 text-xs font-bold" aria-label={`Move selected product image ${index + 1} earlier`} disabled={disabled || index === 0} onClick={() => onFilesChange(moveProductImage(files, index, -1))}>Up</button>
          <button type="button" className="rounded bg-white/90 px-2 py-1 text-xs font-bold" aria-label={`Move selected product image ${index + 1} later`} disabled={disabled || index === files.length - 1} onClick={() => onFilesChange(moveProductImage(files, index, 1))}>Down</button>
          <button type="button" className="rounded bg-white/90 px-2 py-1 text-xs font-bold text-[#8c4135]" aria-label={`Remove selected image ${index + 1}`} disabled={disabled} onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))}>Remove</button>
        </div>
      </div>)}
    </div>}
  </div>;
}

async function uploadProductImageFiles(
  files: File[],
  upload: (input: { fileName: string; contentType: "image/jpeg" | "image/png" | "image/webp"; base64: string }) => Promise<{ url: string }>,
) {
  const uploadedUrls: string[] = [];
  for (const file of files) {
    const uploaded = await upload({
      fileName: file.name,
      contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
      base64: await readImageAsBase64(file),
    });
    uploadedUrls.push(uploaded.url);
  }
  return uploadedUrls;
}

function Empty({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return <div className="py-9 text-center"><Icon className="mx-auto text-[#a0b796]" size={29}/><h3 className="mt-3 font-bold text-[#3d5e49]">{title}</h3><p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-[#6d7d70]">{body}</p></div>;
}

function QueryErrorState({ message, onRetry, isFetching }: { message: string; onRetry: () => void; isFetching: boolean }) {
  return <div className="agri-card p-6 text-center">
    <p role="alert" className="text-sm text-[#a34838]">{toUserFacingErrorMessage(message, USER_FACING_LOAD_ERROR)}</p>
    <button type="button" className="agri-ghost mt-3 text-sm" disabled={isFetching} onClick={onRetry}>
      {isFetching && <Loader2 className="animate-spin" size={15}/>} Retry
    </button>
  </div>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return <div className="agri-card p-5"><div className="flex items-start justify-between"><p className="text-sm font-bold text-[#66806b]">{label}</p><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf4e9] text-[#4c834d]"><Icon size={18}/></span></div><p className="mt-4 font-display text-3xl font-bold text-[#254f37]">{value}</p></div>;
}

function LoadingWorkspace() { return <div className="grid min-h-[40vh] place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]"/></div>; }

function getAuthGateCopy(resolution: string | undefined) {
  switch (resolution) {
    case "email_not_verified":
      return {
        title: "Verify your email",
        message: "This Supabase identity has not confirmed its email address. Operational access is blocked until you verify it. Open the verification message or request a new link from the sign-in page.",
      };
    case "application_user_missing":
      return {
        title: "AgriCoop account link required",
        message: "Supabase sign-in is valid, but no matching application account was found for this Auth identity. Ask an administrator to verify the openId mapping. Sign-in does not create or assign a profile or role.",
      };
    case "application_user_mapping_unavailable":
      return {
        title: "AgriCoop identity mapping unavailable",
        message: "A canonical Supabase profile exists, but AgriCoop could not find its exact application account mapping. Ask an administrator to verify the openId link and database policies.",
      };
    case "application_profile_missing":
      return {
        title: "AgriCoop role profile missing",
        message: "An application account exists, but its canonical public role profile is missing or not visible. An administrator must review the profile link and database policies.",
      };
    case "application_role_mapping_unavailable":
      return {
        title: "AgriCoop role mapping unavailable",
        message: "The canonical role record is missing or not visible. An administrator must review the role mapping; AgriCoop will not infer a role from Auth metadata.",
      };
    case "application_role_mapping_conflict":
      return {
        title: "AgriCoop role conflict",
        message: "Your application role and canonical profile role disagree. AgriCoop attempts an automatic sync on sign-in. If you still see this screen, ask a SuperAdmin to use Role reconciliation in System administration.",
      };
    case "application_identity_conflict":
      return {
        title: "Duplicate AgriCoop identity",
        message: "More than one application or canonical role record matches this Auth identity. Sign-in is blocked until an administrator resolves the duplicate records.",
      };
    case "application_database_access_denied":
      return {
        title: "AgriCoop database access denied",
        message: "Database grants or row-level security policies denied the application lookup. An administrator must review access; AgriCoop will not bypass those policies.",
      };
    case "application_database_schema_unavailable":
      return {
        title: "AgriCoop database schema unavailable",
        message: "A required application schema object is missing or incompatible. An administrator must review the PostgreSQL schema before sign-in can continue.",
      };
    case "application_database_unavailable":
      return {
        title: "AgriCoop profile service unavailable",
        message: "Supabase sign-in may be valid, but AgriCoop could not reach its application database. Try again later.",
      };
    default:
      return {
        title: "Your AgriCoop workspace",
        message: "Sign in to access the tools assigned to your marketplace role.",
      };
  }
}

function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, sessionLoading, accessTokenPresent, logout } = useAuth();
  const { data: authResolution } = trpc.auth.status.useQuery(undefined, { enabled: !loading && !user });
  useEffect(() => {
    logAuthDiagnostic("protected_route_auth_state", {
      component: "Dashboard.AuthGate",
      sessionInitializationPending: sessionLoading,
      authLoading: loading,
      accessTokenPresent,
      applicationUserPresent: Boolean(user),
    });
  }, [sessionLoading, loading, accessTokenPresent, user]);
  if (loading) return <LoadingWorkspace/>;
  if (!user) {
    const copy = getAuthGateCopy(authResolution);
    return <div className="grid min-h-screen place-items-center bg-[#f8f5ee] opacity-100 p-4">
      <div className="agri-card max-w-md p-8 text-center">
        <Leaf className="mx-auto text-[#68924d]"/>
        <h1 className="mt-4 font-display text-3xl font-bold text-[#244e36]">{copy.title}</h1>
        <p className="mt-3 leading-7 text-[#647568]">{copy.message}</p>
        <button className="agri-button mt-6" onClick={() => goToAuth("Dashboard.AuthGate")}>
          {authResolution === "email_not_verified" ? "Open verification" : "Sign in to AgriCoop"}
        </button>
      </div>
    </div>;
  }
  const accessRestriction = getAccountAccessRestriction(user);
  if (accessRestriction) {
    const copy = {
      pending: {
        title: "Account pending approval",
        message: "Your AgriCoop account is not approved for operational access yet. Sellers also need an authorized cooperative assignment. No role or cooperative assignment was created during sign-in.",
      },
      suspended: {
        title: "Account access suspended",
        message: "Your AgriCoop account is suspended. Contact an authorized administrator to review your account status.",
      },
      cooperative_assignment_required: {
        title: "Cooperative assignment required",
        message: "This Admin account has no cooperative assignment. Contact a SuperAdmin before using cooperative operations.",
      },
    }[accessRestriction];
    return <main className="grid min-h-screen place-items-center bg-[#f8f5ee] opacity-100 p-4"><div className="agri-card w-full max-w-xl p-8 text-center"><Leaf className="mx-auto text-[#68924d]"/><h1 className="mt-4 font-display text-3xl font-bold text-[#244e36]">{copy.title}</h1><p className="mt-3 leading-7 text-[#647568]">{copy.message}</p>{user.role === "seller" && user.cooperativeId === null && <SellerAssociationRequestPanel/>}<button className="agri-button mt-6" onClick={() => void logout().catch(() => toast.error("Could not complete sign out. Please try again."))}>Sign out</button></div></main>;
  }
  return <>{children}</>;
}

function SellerAssociationRequestPanel() {
  const utils = trpc.useUtils();
  const [coop, setCoop] = useState<CooperativeSelectValue>(emptyCooperativeSelectValue);
  const [message, setMessage] = useState("");
  const { data: cooperatives = [], isLoading: cooperativesLoading, error: cooperativesError } = trpc.cooperativeAssociations.activeCooperatives.useQuery();
  const { data: requests = [], isLoading: requestsLoading, error: requestsError } = trpc.cooperativeAssociations.mine.useQuery();
  const request = trpc.cooperativeAssociations.request.useMutation({
    onSuccess: async () => {
      toast.success("Cooperative association request submitted.");
      setMessage("");
      await utils.cooperativeAssociations.mine.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const pendingRequest = requests.find(row => row.request.status === "pending");

  return <section className="mt-6 rounded-xl border border-[#dce4d6] bg-[#f5f8f2] p-4 text-left">
    <h2 className="font-display text-xl font-bold text-[#264f37]">Request cooperative association</h2>
    <p className="mt-1 text-sm leading-6 text-[#65766b]">An authorized cooperative Admin must review your request. Include a reason; approval changes your cooperative assignment, while account approval remains a separate step.</p>
    {(cooperativesError || requestsError) && <p role="alert" className="mt-3 text-sm text-[#a34838]">{cooperativesError?.message || requestsError?.message}</p>}
    {(cooperativesLoading || requestsLoading) && <p className="mt-3 text-sm text-[#65766b]">Loading cooperative options…</p>}
    {requests.map(({ request: row, cooperativeName }) => <div key={row.id} className="mt-3 rounded-lg bg-white p-3 text-sm">
      <p className="font-bold text-[#315640]">{cooperativeName} · {formatEnumLabel(row.status)}</p>
      {row.message && <p className="mt-1 text-[#65766b]">{row.message}</p>}
      {row.reviewNote && <p className="mt-1 text-[#65766b]">Admin note: {row.reviewNote}</p>}
    </div>)}
    {!pendingRequest && !cooperativesLoading && !cooperativesError && <form className="mt-4 space-y-3" onSubmit={event => {
      event.preventDefault();
      if (coop.cooperativeId) request.mutate({ cooperativeId: coop.cooperativeId, message: message.trim() });
    }}>
      <CooperativeSelect value={coop} onChange={setCoop} allowAddNew={false} required label="Choose a cooperative" />
      <label className="field-label">Reason for this cooperative request<textarea required maxLength={600} className="field-control min-h-20" value={message} onChange={event => setMessage(event.target.value)}/></label>
      <button className="agri-button text-sm" disabled={request.isPending || !coop.cooperativeId || !cooperatives.length || !message.trim()}>Submit association request</button>
    </form>}
    {!cooperativesLoading && !cooperativesError && !cooperatives.length && <p className="mt-3 text-sm text-[#65766b]">No active cooperatives are currently accepting requests.</p>}
  </section>;
}

function AssociationRequestsManager() {
  const utils = trpc.useUtils();
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [moveListings, setMoveListings] = useState<Record<number, boolean>>({});
  const { data: requests = [], isLoading, error } = trpc.cooperativeAdmin.associationRequests.useQuery();
  const review = trpc.cooperativeAdmin.reviewAssociationRequest.useMutation({
    onSuccess: async () => {
      toast.success("Association request reviewed.");
      await Promise.all([
        utils.cooperativeAdmin.associationRequests.invalidate(),
        utils.admin.overview.invalidate(),
      ]);
    },
    onError: problem => toast.error(problem.message),
  });

  return <section className="mt-8 agri-card p-5 sm:p-6">
    <h2 className="font-display text-2xl font-bold text-[#264f37]">Seller cooperative requests</h2>
    <p className="mt-1 text-sm text-[#6a796e]">Add a review note for every decision. On approval, choose whether to also move the Seller's existing listings; account approval remains separate.</p>
    {isLoading && <p className="mt-4 text-sm text-[#65766b]">Loading requests…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-[#a34838]">{error.message}</p>}
    {!isLoading && !error && !requests.length && <p className="mt-4 text-sm text-[#65766b]">No pending association requests.</p>}
    <div className="mt-4 space-y-3">{requests.map(({ request: row, sellerName, sellerEmail, cooperativeName }) => <article key={row.id} className="rounded-xl border border-[#e2e9dd] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-bold text-[#315640]">{sellerName || "Seller"} · {cooperativeName}</p><p className="text-xs text-[#718074]">{sellerEmail || "No email"} · Request #{row.id}</p></div>
        <div className="flex gap-2">
          <button
            className="agri-button px-3 py-2 text-xs"
            disabled={review.isPending || !reviewNotes[row.id]?.trim()}
            onClick={() => review.mutate({
              requestId: row.id,
              decision: "approved",
              reviewNote: reviewNotes[row.id]?.trim() ?? "",
              moveExistingListings: moveListings[row.id] ?? false,
            })}
          >
            Approve association
          </button>
          <button
            className="agri-ghost px-3 py-2 text-xs text-[#a34838]"
            disabled={review.isPending || !reviewNotes[row.id]?.trim()}
            onClick={() => review.mutate({
              requestId: row.id,
              decision: "rejected",
              reviewNote: reviewNotes[row.id]?.trim() ?? "",
            })}
          >
            Reject
          </button>
        </div>
      </div>
      {row.message && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#65766b]">{row.message}</p>}
      <label className="field-label mt-3">Review note (required)<textarea required maxLength={600} className="field-control min-h-16" value={reviewNotes[row.id] ?? ""} onChange={event => setReviewNotes(current => ({ ...current, [row.id]: event.target.value }))}/></label>
      <label className="mt-3 flex items-center gap-2 text-sm text-[#315640]">
        <input type="checkbox" checked={moveListings[row.id] ?? false} onChange={event => setMoveListings(current => ({ ...current, [row.id]: event.target.checked }))}/>
        Also move this Seller's existing listings to {cooperativeName}
      </label>
    </article>)}</div>
  </section>;
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
  const resetFields = () => {
    setName(user?.name || "");
    setContactNumber(user?.contactNumber || "");
    setAddress(user?.address || "");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ name, contactNumber: contactNumber || undefined, address: address || undefined });
  };
  return <>
    <WorkspaceHeader title="Complete your profile" description="Keep your contact details current for cooperative marketplace activity."/>
    <main className={`${shellContainerClass} pt-10 pb-8`}>
      <form id="onboarding-form" onSubmit={submit} className="agri-card p-6 sm:p-8">
        <h1 className="font-display text-3xl font-bold text-[#244e36]">Your profile</h1>
        <p className="mt-3 leading-7 text-[#647568]">Your role, approval status, and cooperative assignment are managed by AgriCoop and your cooperative officer.</p>
        <label className="field-label mt-6">Display name<input value={name} onChange={e => setName(e.target.value)} className="field-control" required maxLength={120}/></label>
        <label className="field-label mt-5">Contact number <span className="normal-case tracking-normal text-[#6e7d73]">(optional)</span><input value={contactNumber} onChange={e => setContactNumber(e.target.value)} className="field-control" placeholder="e.g., 09XX XXX XXXX" maxLength={40}/></label>
        <label className="field-label mt-5">Address <span className="normal-case tracking-normal text-[#6e7d73]">(optional)</span><textarea value={address} onChange={e => setAddress(e.target.value)} className="field-control" maxLength={500}/></label>
        <div className="sticky bottom-0 z-20 -mx-6 mt-8 flex justify-end gap-2 border-t border-[#dce4d6] bg-[#fffdf8] p-3 sm:-mx-8">
          <button type="button" className="agri-ghost min-h-11" onClick={resetFields} disabled={update.isPending}>Cancel</button>
          <button type="submit" disabled={update.isPending} className="agri-button min-h-11">{update.isPending && <Loader2 className="animate-spin" size={17}/>} Save</button>
        </div>
      </form>
    </main>
  </>;
}

function ProfileVerificationPanel() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const verificationQuery = trpc.account.verificationMine.useQuery();
  const requestUpload = trpc.account.requestVerificationUpload.useMutation();
  const submitVerification = trpc.account.submitVerification.useMutation();
  const [birthdate, setBirthdate] = useState(user?.birthdate ? new Date(user.birthdate).toISOString().slice(0, 10) : "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [address, setAddress] = useState(user?.address ?? "");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [stage, setStage] = useState<"idle" | "authorizing" | "uploading" | "saving">("idle");
  const status = verificationQuery.data?.status ?? user?.verificationStatus ?? "unverified";
  const canSubmit = status === "unverified" || status === "rejected";
  const isPending = stage !== "idle" || requestUpload.isPending || submitVerification.isPending;
  const stageLabel = stage === "authorizing" ? "Preparing secure upload…"
    : stage === "uploading" ? "Uploading privately…"
      : stage === "saving" ? "Validating and submitting…"
        : "Submit for review";
  const refresh = async () => {
    await Promise.all([utils.account.verificationMine.invalidate(), utils.auth.me.invalidate()]);
  };
  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (selected && (!PROFILE_VERIFICATION_CONTENT_TYPES.includes(selected.type as typeof PROFILE_VERIFICATION_CONTENT_TYPES[number])
      || selected.size < 1
      || selected.size > PROFILE_VERIFICATION_MAX_BYTES)) {
      setFileError("Choose a JPEG, PNG, or WebP image up to 5 MiB.");
      setFile(null);
      return;
    }
    setFileError("");
    setFile(selected);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !birthdate || !phone.trim()) return;
    try {
      setStage("authorizing");
      const authorization = await requestUpload.mutateAsync({
        contentType: file.type as typeof PROFILE_VERIFICATION_CONTENT_TYPES[number],
        fileSizeBytes: file.size,
      });
      setStage("uploading");
      const { error } = await supabase.storage
        .from(PROFILE_VERIFICATION_BUCKET)
        .uploadToSignedUrl(authorization.storagePath, authorization.uploadToken, file, { contentType: file.type });
      if (error) throw new Error(error.message);
      setStage("saving");
      await submitVerification.mutateAsync({
        uploadIntent: authorization.uploadIntent,
        birthdate,
        phone,
        address: address || undefined,
        note: note || undefined,
      });
      toast.success("Profile verification submitted for review.");
      setFile(null);
      setNote("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit profile verification.");
    } finally {
      setStage("idle");
    }
  };

  return <section className="mt-8 agri-card p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-display text-2xl font-bold text-[#264f37]">Profile verification</h2><p className="mt-1 text-sm text-[#6a796e]">Submit a private image of your verification document. Only authorized cooperative administrators can review it.</p></div>
      <Status value={status}/>
    </div>
    {verificationQuery.error ? <div className="mt-4"><p role="alert" className="text-sm text-[#a34838]">{verificationQuery.error.message}</p><button type="button" className="agri-ghost mt-2 text-xs" disabled={verificationQuery.isFetching} onClick={() => void verificationQuery.refetch()}>Retry</button></div>
      : verificationQuery.isLoading ? <Loader2 className="mx-auto my-5 animate-spin text-[#5d8a5e]"/>
        : <div className="mt-4 space-y-4">
          {status === "pending" && <p role="status" className="rounded-lg bg-[#f7f5ef] p-3 text-sm text-[#66766b]">Your application is awaiting review. You cannot submit another application while one is pending.</p>}
          {status === "approved" && <p role="status" className="rounded-lg bg-[#edf6eb] p-3 text-sm text-[#315640]">Your profile verification is approved.</p>}
          {verificationQuery.data?.submissions.length ? <div className="rounded-xl border border-[#e2e9dd] p-4">
            <h3 className="font-bold text-[#315640]">Submission history</h3>
            <ol className="mt-3 space-y-3">{verificationQuery.data.submissions.map(submission => <li key={submission.id} className="rounded-lg bg-[#f5f7f3] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Submitted {when(submission.submittedAt)}</span><Status value={submission.status}/></div>
              {submission.reviewedAt && <p className="mt-1 text-xs text-[#718074]">Reviewed {when(submission.reviewedAt)}</p>}
              {submission.reviewNote && <p className="mt-2 whitespace-pre-wrap text-sm text-[#65766b]">Review note: {submission.reviewNote}</p>}
            </li>)}</ol>
          </div> : <div className="rounded-xl border border-[#e2e9dd] p-4"><h3 className="font-bold text-[#315640]">Submission history</h3><p className="mt-2 text-sm text-[#6d7d70]">No verification submissions yet.</p></div>}
          {canSubmit && <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <label className="field-label">Birthdate<input required type="date" className="field-control" value={birthdate} onChange={event => setBirthdate(event.target.value)} disabled={isPending}/></label>
            <label className="field-label">Contact number<input required type="tel" minLength={7} maxLength={40} className="field-control" value={phone} onChange={event => setPhone(event.target.value)} disabled={isPending}/></label>
            <label className="field-label md:col-span-2">Address (optional)<textarea maxLength={500} className="field-control min-h-20" value={address} onChange={event => setAddress(event.target.value)} disabled={isPending}/></label>
            <label className="field-label md:col-span-2">Verification document image (JPEG, PNG, or WebP; up to 5 MiB)
              <input required type="file" accept="image/jpeg,image/png,image/webp" className="field-control" onChange={chooseFile} disabled={isPending}/>
              {file && <span className="mt-1 block text-xs text-[#66766b]">Selected: {file.name}</span>}
              {fileError && <span role="alert" className="mt-1 block text-xs text-[#a34838]">{fileError}</span>}
            </label>
            <label className="field-label md:col-span-2">Note for the reviewer (optional)<textarea maxLength={600} className="field-control min-h-20" value={note} onChange={event => setNote(event.target.value)} disabled={isPending}/></label>
            <label className="flex items-start gap-2 text-xs leading-5 text-[#65766b] md:col-span-2"><input required type="checkbox" className="mt-1" disabled={isPending}/>I consent to sharing this document and profile details with authorized AgriCoop reviewers for verification. The file is stored privately and is not published.</label>
            <button type="submit" className="agri-button justify-self-start text-sm" disabled={!file || !birthdate || !phone.trim() || Boolean(fileError) || isPending}>
              {isPending && <Loader2 className="animate-spin" size={16}/>} {stageLabel}
            </button>
            {isPending && <p role="status" className="self-center text-xs text-[#66766b]">{stageLabel} Keep this page open until the upload is complete.</p>}
          </form>}
        </div>}
  </section>;
}

function BuyerPaymentProof({ payment, onSubmitted }: { payment: any; onSubmitted: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [uploadStage, setUploadStage] = useState<"idle" | "authorizing" | "uploading" | "saving">("idle");
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const upload = trpc.payments.uploadProof.useMutation();
  const finalizeUpload = trpc.payments.finalizeProofUpload.useMutation();
  const canSubmitProof = (payment.status === "pending" || payment.status === "failed")
    && payment.proofStatus !== "pending"
    && payment.proofStatus !== "verified"
    && payment.orderStatus !== "cancelled"
    && payment.orderStatus !== "completed";
  const submitProof = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    try {
      setUploadStage("authorizing");
      const authorization = await upload.mutateAsync({
        orderId: payment.orderId,
        fileName: file.name,
        contentType: file.type as typeof PAYMENT_PROOF_CONTENT_TYPES[number],
        fileSizeBytes: file.size,
      });
      setUploadStage("uploading");
      const { error } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .uploadToSignedUrl(authorization.storagePath, authorization.uploadToken, file, { contentType: file.type });
      if (error) throw new Error(error.message);
      setUploadStage("saving");
      await finalizeUpload.mutateAsync({ orderId: payment.orderId, uploadIntent: authorization.uploadIntent });
      toast.success("Payment proof submitted for verification.");
      setFile(null);
      onSubmitted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit payment proof.");
    } finally {
      setUploadStage("idle");
    }
  };
  const isUploading = uploadStage !== "idle" || upload.isPending || finalizeUpload.isPending;
  const uploadStageLabel = uploadStage === "authorizing" ? "Preparing secure upload…"
    : uploadStage === "uploading" ? "Uploading privately…"
      : uploadStage === "saving" ? "Verifying and saving…"
        : "Submit proof";
  return <article className="rounded-xl border border-[#e3e9de] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="font-bold text-[#315640]">Order #{payment.orderId} · {peso(payment.amountCents)}</p><p className="mt-1 text-xs text-[#6d7d70]">GCash payment · Transaction #{payment.id}</p></div>
      <Status value={payment.status}/>
    </div>
    {payment.reviewNote && <p className="mt-3 rounded-lg bg-[#f7f5ef] p-3 text-sm text-[#66766b]">Admin review note: {payment.reviewNote}</p>}
    {canSubmitProof ? <form onSubmit={submitProof} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
      <label className="field-label">Payment receipt image (JPEG, PNG, or WebP; up to 5 MiB)<input required className="field-control" type="file" accept="image/jpeg,image/png,image/webp" disabled={isUploading} onChange={event => {
        const selected = event.currentTarget.files?.[0] ?? null;
        event.currentTarget.value = "";
        if (selected && (!PAYMENT_PROOF_CONTENT_TYPES.includes(selected.type as typeof PAYMENT_PROOF_CONTENT_TYPES[number]) || selected.size > PAYMENT_PROOF_MAX_BYTES)) {
          setFileError("Choose a JPEG, PNG, or WebP receipt image that is 5 MiB or less.");
          setFile(null);
          return;
        }
        setFileError("");
        setFile(selected);
      }}/></label>
      <button className="agri-button" disabled={!file || isUploading}>{isUploading ? <Loader2 className="animate-spin" size={16}/> : null} {uploadStageLabel}</button>
      {isUploading && <p role="status" className="text-xs text-[#66766b] md:col-span-2">{uploadStageLabel} Keep this page open until the upload is complete.</p>}
      {fileError && <p role="alert" className="text-xs text-[#a34838] md:col-span-2">{fileError}</p>}
      {previewUrl && <img src={previewUrl} alt="Selected payment receipt preview" className="max-h-56 rounded-lg border border-[#e3e9de] object-contain md:col-span-2"/>}
    </form> : <p className="mt-3 text-sm text-[#66766b]">{payment.status === "awaiting_verification" ? "Your receipt is awaiting Admin review." : "This payment is no longer accepting proof submissions."}</p>}
  </article>;
}

function BuyerDashboard() {
  const { user: buyerUser } = useAuth();
  const [, setLocation] = useLocation();
  const openOrderChat = trpc.conversations.openForOrder.useMutation({
    onSuccess: data => setLocation(`/messages?id=${data.conversationId}`),
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const utils = trpc.useUtils();
  const [quotedPaymentMethod, setQuotedPaymentMethod] = useState<"cash_pickup" | "cash_delivery">("cash_pickup");
  const officerApplication = trpc.officerApplications.mine.useQuery(undefined, {
    enabled: !!buyerUser && buyerUser.role === "buyer" && buyerUser.requestedRole === "admin",
  });
  const ordersQuery = trpc.orders.buyerMine.useQuery();
  const { data: orders = [], isLoading } = ordersQuery;
  const quotationsQuery = trpc.quotations.buyerMine.useQuery();
  const { data: quotations = [] } = quotationsQuery;
  const paymentsQuery = trpc.payments.mine.useQuery();
  const { data: payments = [], isLoading: paymentsLoading } = paymentsQuery;
  const refreshBuyerData = () => {
    utils.quotations.buyerMine.invalidate();
    utils.orders.buyerMine.invalidate();
  };
  const decideQuotation = trpc.quotations.decide.useMutation({
    onSuccess: () => { toast.success("Quotation decision saved."); refreshBuyerData(); },
    onError: error => toast.error(error.message),
  });
  const placeQuotedOrder = trpc.orders.create.useMutation({
    onSuccess: () => { toast.success("Order placed at the quoted unit price."); refreshBuyerData(); },
    onError: error => toast.error(error.message),
  });
  const queryError = ordersQuery.error ?? quotationsQuery.error ?? paymentsQuery.error;
  const isFetching = ordersQuery.isFetching || quotationsQuery.isFetching || paymentsQuery.isFetching;
  if (queryError) {
    return <>
      <WorkspaceHeader title="Buyer workspace" description="Your marketplace data could not be loaded."/>
      <main className={`${shellContainerClass} py-8`}>
        <QueryErrorState
          message={queryError.message}
          isFetching={isFetching}
          onRetry={() => void Promise.all([ordersQuery.refetch(), quotationsQuery.refetch(), paymentsQuery.refetch()])}
        />
      </main>
    </>;
  }
  if (ordersQuery.isLoading || quotationsQuery.isLoading || paymentsQuery.isLoading) return <LoadingWorkspace/>;
  return <>
    <WorkspaceHeader title="Buyer workspace" description="Track direct orders, quotation requests, and face-to-face coordination."/>
    <main className={`${shellContainerClass} py-8`}>
      {buyerUser?.requestedRole === "admin" && officerApplication.data?.application.status !== "approved" && (
        <div className="mb-6 rounded-2xl border border-[#d7e4cf] bg-[#f3f8ef] p-4" role="status">
          {officerApplication.data?.application.status === "pending" ? (
            <>
              <p className="font-bold text-[#2f5a3d]">Application waiting for approval</p>
              <p className="mt-1 text-sm text-[#5f7164]">Your Cooperative Admin documents are under review. We will contact you once they are reviewed.</p>
            </>
          ) : (
            <>
              <p className="font-bold text-[#2f5a3d]">Complete your Cooperative Admin application</p>
              <p className="mt-1 text-sm text-[#5f7164]">Upload your ID and proof of position so a SuperAdmin can review Officer Admin access.</p>
              <Link href="/applications/cooperative-admin" className="agri-button mt-3 inline-flex min-h-11 text-sm no-underline">Open application</Link>
            </>
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Orders placed" value={String(orders.length)} icon={ClipboardList}/>
        <Metric label="Open quotations" value={String(quotations.filter(row => row.quotation.status === "requested").length)} icon={FileText}/>
        <Metric label="Completed orders" value={String(orders.filter(row => row.order.status === "completed").length)} icon={Check}/>
      </div>
      <ProfileVerificationPanel/>
      <section className="mt-8 grid gap-8 xl:grid-cols-[1.25fr_.75fr]">
        <div className="agri-card p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><h2 className="font-display text-2xl font-bold text-[#264f37]">Your orders</h2><p className="mt-1 text-sm text-[#6a796e]">Seller confirmations and fulfillment updates appear here.</p></div><Link href="/marketplace" className="agri-ghost text-sm no-underline">Browse listings</Link></div>
          <div className="mt-5 space-y-3">
            {isLoading ? <Loader2 className="mx-auto my-10 animate-spin text-[#5d8a5e]"/> : orders.length ? orders.map(row => <div className="rounded-2xl border border-[#e3e9de] p-4" key={row.order.id}>
              <div className="flex flex-wrap items-start justify-between gap-2"><div><Link href={`/orders/${row.order.id}`} className="font-bold text-[#30573e] no-underline hover:text-[#1f5a3c]">Order #{row.order.id} · {row.sellerName || "Farm seller"}</Link><p className="mt-1 text-xs text-[#6d7d70]">{formatEnumLabel(row.order.orderType)} Order · {when(row.order.createdAt)}</p></div><Status value={row.order.status}/></div>
              <div className="mt-3 flex flex-wrap gap-2">{row.items.map(item => <span key={item.item.id} className="rounded-lg bg-[#f0f5ed] px-2.5 py-1.5 text-xs text-[#45614e]">{item.productName} × {item.item.quantity} {item.unit}</span>)}</div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0e9] pt-3"><p className="font-display font-bold text-[#27573a]">{peso(row.order.totalCents)}</p><button type="button" className="agri-ghost min-h-11 px-3 text-xs" disabled={openOrderChat.isPending} onClick={() => openOrderChat.mutate({ orderId: row.order.id })}>{openOrderChat.isPending ? <Loader2 className="animate-spin" size={14}/> : <MessageCircle size={14}/>} Message</button></div>
            </div>) : <Empty icon={ClipboardList} title="No orders yet" body="Explore local cooperative listings and submit your first order when ready."/>}
          </div>
        </div>
        <div className="agri-card p-5 sm:p-6">
          <h2 className="font-display text-2xl font-bold text-[#264f37]">Quotation requests</h2><p className="mt-1 text-sm text-[#6a796e]">A transparent first step before an order.</p>
          <div className="mt-5 space-y-3">{quotations.length ? quotations.map(row => <div key={row.quotation.id} className="rounded-xl bg-[#f2f6ef] p-4">
            <div className="flex justify-between gap-2"><p className="font-bold text-[#315640]">{row.productName}</p><Status value={row.quotation.status}/></div>
            <p className="mt-1 text-xs text-[#728076]">{row.quotation.requestedQty} {row.unit} from {row.sellerName || "farm seller"}</p>
            {row.quotation.quotedPriceCents !== null && <p className="mt-3 font-display text-lg font-bold text-[#2c603f]">{peso(row.quotation.quotedPriceCents)} per {row.unit}</p>}
            {row.quotation.sellerNote && <p className="mt-2 text-xs leading-5 text-[#637568]">“{row.quotation.sellerNote}”</p>}
            {row.quotation.status === "responded" && <div className="mt-3 flex gap-2"><button className="agri-button px-3 py-2 text-xs" disabled={decideQuotation.isPending} onClick={() => decideQuotation.mutate({ quotationId: row.quotation.id, status: "accepted" })}>Accept quote</button><button className="agri-ghost px-3 py-2 text-xs" disabled={decideQuotation.isPending} onClick={() => decideQuotation.mutate({ quotationId: row.quotation.id, status: "declined" })}>Decline quote</button></div>}
            {row.quotation.status === "accepted" && <div className="mt-3 space-y-2"><label className="field-label">Payment method<select className="field-control" value={quotedPaymentMethod} onChange={event => setQuotedPaymentMethod(event.target.value as typeof quotedPaymentMethod)}><option value="cash_pickup">Cash on pickup</option><option value="cash_delivery">Cash on delivery</option></select></label><button className="agri-button px-3 py-2 text-xs" disabled={placeQuotedOrder.isPending} onClick={() => placeQuotedOrder.mutate({ items: [{ productId: row.quotation.productId, quantity: row.quotation.requestedQty }], quotationId: row.quotation.id, paymentMethod: quotedPaymentMethod })}>Place order at quoted price</button></div>}
          </div>) : <Empty icon={FileText} title="No quotations yet" body="Request a quotation from any available product in the marketplace."/>}</div>
        </div>
      </section>
      <section className="mt-8 agri-card p-5 sm:p-6">
        <h2 className="font-display text-2xl font-bold text-[#264f37]">GCash payments</h2>
        <p className="mt-1 text-sm text-[#6a796e]">Submit a receipt for review after paying with the seller’s configured GCash option.</p>
        <div className="mt-5 space-y-4">
          {paymentsLoading ? <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]"/> : payments.filter(payment => payment.paymentMethod === "gcash").map(payment => <BuyerPaymentProof key={payment.id} payment={payment} onSubmitted={() => { void utils.payments.mine.invalidate(); void utils.orders.buyerMine.invalidate(); }}/>)}
          {!paymentsLoading && !payments.some(payment => payment.paymentMethod === "gcash") && <Empty icon={ClipboardList} title="No GCash payments" body="GCash payment records will appear here after placing a GCash order."/>}
        </div>
      </section>
    </main>
  </>;
}

function SellerProductCard({ product, listingTab }: { product: any; listingTab: "active" | "archived" }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>(product.imageUrls?.length ? product.imageUrls : product.primaryImageUrl ? [product.primaryImageUrl] : []);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageError, setImageError] = useState("");
  const [values, setValues] = useState({ name: product.name, category: product.category, variety: product.variety, description: product.description || "", unit: product.unit, price: String(product.priceCents / 100), stock: String(product.stockQty), minOrderQty: String(product.minOrderQty), qualityGrade: product.qualityGrade, status: product.status, allowsPickup: product.allowsPickup ?? true, allowsDelivery: product.allowsDelivery ?? true });
  const update = trpc.products.update.useMutation({ onSuccess: result => { toast.success(result.reviewRequired ? "Listing changes submitted for review and hidden until approval." : "Listing and inventory updated."); setEditing(false); setImageFiles([]); utils.products.mine.invalidate(); utils.marketplace.list.invalidate(); }, onError: error => toast.error(toUserFacingErrorMessage(error.message, USER_FACING_SAVE_ERROR)) });
  const uploadImage = trpc.products.uploadImage.useMutation();
  const invalidateListings = () => { utils.products.mine.invalidate(); utils.marketplace.list.invalidate(); };
  const archive = trpc.products.archive.useMutation({ onSuccess: () => { toast.success("Listing archived."); invalidateListings(); }, onError: error => toast.error(toUserFacingErrorMessage(error.message)) });
  const unarchive = trpc.products.unarchive.useMutation({ onSuccess: () => { toast.success("Listing restored to Active."); invalidateListings(); }, onError: error => toast.error(toUserFacingErrorMessage(error.message)) });
  const softDelete = trpc.products.softDelete.useMutation({ onSuccess: () => { toast.success("Listing deleted."); invalidateListings(); }, onError: error => toast.error(toUserFacingErrorMessage(error.message)) });
  const submitProduct = trpc.products.submit.useMutation({ onSuccess: () => { toast.success("Product submitted for verification."); utils.products.mine.invalidate(); }, onError: error => toast.error(toUserFacingErrorMessage(error.message)) });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (Number(values.stock) > 0 && Number(values.minOrderQty) > Number(values.stock)) {
      toast.error("Minimum order cannot exceed available stock.");
      return;
    }
    if (imageError) {
      toast.error(imageError);
      return;
    }
    if (!values.allowsPickup && !values.allowsDelivery) {
      toast.error("Choose at least Pickup or Delivery.");
      return;
    }
    try {
      const uploadedUrls = await uploadProductImageFiles(imageFiles, uploadImage.mutateAsync);
      const nextImageUrls = [...imageUrls, ...uploadedUrls];
      update.mutate(
        { id: product.id, name: values.name, category: values.category, variety: values.variety, description: values.description, unit: values.unit as typeof PRODUCT_UNITS[number], priceCents: Math.round(Number(values.price) * 100), stockQty: Number(values.stock), minOrderQty: Number(values.minOrderQty), qualityGrade: values.qualityGrade, status: values.status, allowsPickup: values.allowsPickup, allowsDelivery: values.allowsDelivery, imageUrls: nextImageUrls },
        { onSuccess: () => setImageUrls(nextImageUrls) },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed.");
    }
  };
  if (editing) return <form onSubmit={save} className="rounded-2xl border-2 border-[#abd19e] bg-[#f2f8ef] p-4"><label className="field-label">Product name<input required className="field-control" value={values.name} onChange={e => setValues({ ...values, name: e.target.value })}/></label><label className="field-label mt-3">Classification<input required className="field-control" value={values.category} onChange={e => setValues({ ...values, category: e.target.value })}/></label><label className="field-label mt-3">Variety<input required list={`product-varieties-${product.id}`} className="field-control" value={values.variety} onChange={e => setValues({ ...values, variety: e.target.value })}/><datalist id={`product-varieties-${product.id}`}>{getProductVarieties(values.name).map(variety => <option value={variety} key={variety}/>)}</datalist></label><label className="field-label mt-3">Description<textarea required className="field-control min-h-24" value={values.description} onChange={e => setValues({ ...values, description: e.target.value })}/></label><div className="mt-3 grid grid-cols-2 gap-2"><label className="field-label">Price per unit (PHP)<input required className="field-control" type="number" min="0.01" step="0.01" value={values.price} onChange={e => setValues({ ...values, price: e.target.value })}/></label><label className="field-label">Unit<select required className="field-control" value={values.unit} onChange={e => setValues({ ...values, unit: e.target.value })}>{PRODUCT_UNITS.map(unit => <option value={unit} key={unit}>{unit === "kg" ? "kilogram (kg)" : unit}</option>)}</select></label><label className="field-label">Available stock ({values.unit})<input required className="field-control" type="number" min="0" step="1" value={values.stock} onChange={e => setValues({ ...values, stock: e.target.value })}/></label><label className="field-label">Minimum order ({values.unit})<input required className="field-control" type="number" min="1" step="1" max={Number(values.stock) > 0 ? values.stock : undefined} value={values.minOrderQty} onChange={e => setValues({ ...values, minOrderQty: e.target.value })}/>{Number(values.stock) > 0 && Number(values.minOrderQty) > Number(values.stock) && <span role="alert" className="mt-1 block text-xs text-[#a34838]">Minimum order cannot exceed available stock.</span>}</label></div><ListingPaymentFlagFields allowsPickup={values.allowsPickup} allowsDelivery={values.allowsDelivery} onChange={patch => setValues({ ...values, ...patch })}/><ProductImagePicker imageUrls={imageUrls} files={imageFiles} onImageUrlsChange={setImageUrls} onFilesChange={setImageFiles} error={imageError} onError={setImageError} disabled={update.isPending || uploadImage.isPending}/><label className="field-label mt-3">Quality grade<select className="field-control" value={values.qualityGrade} onChange={e => setValues({ ...values, qualityGrade: e.target.value as typeof values.qualityGrade })}><option value="premium">Premium</option><option value="standard">Standard</option><option value="imperfect">Imperfect / value-grade</option></select></label><label className="field-label mt-3">Status<select className="field-control" value={values.status} onChange={e => setValues({ ...values, status: e.target.value as "published" | "archived" })}><option value="published">Published</option><option value="archived">Archived</option></select></label><div className="mt-4 flex gap-2"><button className="agri-button min-h-11 px-3 py-2 text-xs" disabled={update.isPending || uploadImage.isPending}>Save changes</button><button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => setEditing(false)}>Cancel</button></div></form>;
  return <div className="rounded-2xl border border-[#e2e9dd] p-4"><div className="flex justify-between gap-3"><span className="rounded-full bg-[#eef5ea] px-2 py-1 text-xs font-bold text-[#4d784c]">{product.category}</span><Status value={product.verificationStatus || product.status}/></div>{product.cooperativeName && <p className="mt-2 text-xs font-bold text-[#5f7a5f]">{product.cooperativeName}</p>}<h3 className="mt-4 font-display text-xl font-bold text-[#28523a]">{product.name}</h3><p className="mt-1 text-sm text-[#647468]">{product.variety} · {peso(product.priceCents)} per {product.unit}</p><div className="mt-4 flex items-center justify-between border-t border-[#edf0e9] pt-3"><span className="text-xs font-bold text-[#607363]">Stock: {product.stockQty} {product.unit} · Minimum: {product.minOrderQty} {product.unit}</span><span className="text-xs text-[#688068]">{product.qualityGrade}</span></div><div className="mt-4 flex flex-wrap gap-3"><button onClick={() => setEditing(true)} className="agri-ghost px-3 py-2 text-xs">Edit listing</button>{product.verificationStatus !== "pending" && product.verificationStatus !== "approved" && <button onClick={() => submitProduct.mutate({ id: product.id })} className="agri-button px-3 py-2 text-xs">Submit for verification</button>}{listingTab === "active" && <button type="button" onClick={() => archive.mutate({ id: product.id })} disabled={archive.isPending} className="text-xs font-bold text-[#a34838]">Archive</button>}{listingTab === "archived" && <button type="button" onClick={() => unarchive.mutate({ id: product.id })} disabled={unarchive.isPending} className="agri-ghost px-3 py-2 text-xs">Unarchive</button>}<button type="button" onClick={() => { if (window.confirm(`Delete “${product.name}”? It will leave Active and Archived.`)) softDelete.mutate({ id: product.id }); }} disabled={softDelete.isPending} className="text-xs font-bold text-[#a34838]">Delete</button></div></div>;
}
function QuotationResponse({ row, onRespond }: { row: any; onRespond: (price: number, note: string | undefined, status: "responded" | "declined") => void }) {
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const submitResponse = (event: FormEvent) => {
    event.preventDefault();
    const quotedPriceCents = Math.round(Number(price) * 100);
    if (!Number.isSafeInteger(quotedPriceCents) || quotedPriceCents <= 0) return;
    onRespond(quotedPriceCents, note.trim() || undefined, "responded");
  };

  return <div className="rounded-xl bg-[#f2f6ef] p-4">
    <div className="flex justify-between gap-2">
      <div>
        <p className="font-bold text-[#315640]">{row.productName}</p>
        <p className="mt-1 text-xs text-[#6d7d70]">{row.buyerName || "Buyer"} requests {row.quotation.requestedQty} {row.unit}</p>
      </div>
      <Status value={row.quotation.status}/>
    </div>
    {row.quotation.buyerNote && <p className="mt-2 text-xs italic leading-5 text-[#647568]">“{row.quotation.buyerNote}”</p>}
    {row.quotation.status === "requested" && <form onSubmit={submitResponse} className="mt-3 space-y-3">
      <label className="field-label">Price per unit (PHP)
        <input required type="number" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)} className="field-control"/>
      </label>
      <label className="field-label">Note for the buyer (optional)
        <textarea maxLength={600} value={note} onChange={event => setNote(event.target.value)} className="field-control min-h-20"/>
      </label>
      <div className="flex gap-2">
        <button type="submit" className="agri-button shrink-0 px-3 py-2 text-xs">Reply</button>
        <button type="button" onClick={() => onRespond(1, note.trim() || undefined, "declined")} className="text-xs font-bold text-[#a34838]">Decline</button>
      </div>
    </form>}
  </div>;
}

function SellerDashboard({ onExitSellerMode }: { onExitSellerMode?: () => void } = {}) {
  const [, setLocation] = useLocation();
  const openOrderChat = trpc.conversations.openForOrder.useMutation({
    onSuccess: data => setLocation(`/messages?id=${data.conversationId}`),
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const utils = trpc.useUtils(); const { user } = useAuth(); const productsQuery = trpc.products.mine.useQuery(); const { data: products = [], isLoading } = productsQuery;
  const [queueTab, setQueueTab] = useState<"active" | "archived">("active");
  const sellerEnabled = user?.role === "seller" || !!onExitSellerMode;
  const ordersQuery = trpc.orders.sellerMine.useQuery({ archived: queueTab === "archived" }, { enabled: sellerEnabled }); const { data: orders = [] } = ordersQuery;
  const sellerOrderCounts = trpc.orders.sellerMineCounts.useQuery(undefined, { enabled: sellerEnabled });
  const quotationsQuery = trpc.quotations.sellerMine.useQuery({ archived: queueTab === "archived" }, { enabled: sellerEnabled }); const { data: quotations = [] } = quotationsQuery;
  const quotationCounts = trpc.quotations.counts.useQuery({ side: "seller" }, { enabled: sellerEnabled });
  const sellerArchive = trpc.orders.sellerUpdateArchive.useMutation({ onSuccess: () => { toast.success("Fulfillment queue updated."); void utils.orders.sellerMine.invalidate(); void utils.orders.sellerMineCounts.invalidate(); }, onError: error => toast.error(toUserFacingErrorMessage(error.message)) });
  const quotationArchive = trpc.quotations.updateState.useMutation({ onSuccess: () => { toast.success("Quotation view updated."); void utils.quotations.sellerMine.invalidate(); void utils.quotations.counts.invalidate(); }, onError: error => toast.error(toUserFacingErrorMessage(error.message)) });
  const { data: cooperatives = [] } = trpc.cooperatives.list.useQuery();
  const assignedCooperative = user?.cooperativeId
    ? cooperatives.find(cooperative => cooperative.id === user.cooperativeId)
    : undefined;
  const cooperativeRemoved = user?.cooperativeId != null && !assignedCooperative;
  const needsCooperative = user?.cooperativeId == null || cooperativeRemoved;
  const sellerCooperativeName = assignedCooperative?.name
    ?? (cooperativeRemoved ? "Your cooperative was removed. Choose another before publishing new listings." : "Not assigned — request a cooperative before publishing");
  const emptyForm = () => ({ name: "", category: "Crop Production", variety: "", description: "", unit: "kg", price: "", stock: "", minOrderQty: "1", qualityGrade: "standard" as "premium" | "standard" | "imperfect", allowsPickup: true, allowsDelivery: true });
  const [openForm, setOpenForm] = useState(false); const [form, setForm] = useState(emptyForm); const [imageFiles, setImageFiles] = useState<File[]>([]); const [imageError, setImageError] = useState("");
  const [listingTab, setListingTab] = useState<"active" | "archived">("active");
  const activeListings = products.filter(product => product.status === "published" && !product.deletedAt);
  const archivedListings = products.filter(product => product.status === "archived" && !product.deletedAt);
  const visibleListings = listingTab === "active" ? activeListings : archivedListings;
  const uploadImage = trpc.products.uploadImage.useMutation();
  const create = trpc.products.create.useMutation({ onSuccess: () => { toast.success("Product listing submitted for verification."); setOpenForm(false); setForm(emptyForm()); setImageFiles([]); setImageError(""); utils.products.mine.invalidate(); utils.marketplace.list.invalidate(); }, onError: error => toast.error(toUserFacingErrorMessage(error.message, USER_FACING_SAVE_ERROR)) });
  const updateStatus = trpc.orders.updateStatus.useMutation({ onSuccess: () => { toast.success("Order status updated."); utils.orders.sellerMine.invalidate(); utils.products.mine.invalidate(); }, onError: error => toast.error(error.message) });
  const respond = trpc.quotations.respond.useMutation({ onSuccess: () => { toast.success("Quotation response sent."); utils.quotations.sellerMine.invalidate(); }, onError: error => toast.error(error.message) });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (Number(form.minOrderQty) > Number(form.stock) || imageError) return;
    if (!form.allowsPickup && !form.allowsDelivery) {
      toast.error("Choose at least Pickup or Delivery.");
      return;
    }
    try {
      const imageUrls = await uploadProductImageFiles(imageFiles, uploadImage.mutateAsync);
      create.mutate({ name: form.name, category: form.category, variety: form.variety, description: form.description, unit: form.unit as typeof PRODUCT_UNITS[number], priceCents: Math.round(Number(form.price) * 100), stockQty: Number(form.stock), minOrderQty: Number(form.minOrderQty), qualityGrade: form.qualityGrade, allowsPickup: form.allowsPickup, allowsDelivery: form.allowsDelivery, imageUrls });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed.");
    }
  };
  const queryError = productsQuery.error
    ?? (user?.role === "seller" ? ordersQuery.error ?? quotationsQuery.error : undefined);
  const queryFetching = productsQuery.isFetching || ordersQuery.isFetching || quotationsQuery.isFetching;
  if (queryError) {
    return <>
      <WorkspaceHeader title="Seller workspace" description="Marketplace data could not be loaded."/>
      <main className={`${shellContainerClass} py-8`}>
        <QueryErrorState
          message={queryError.message}
          isFetching={queryFetching}
          onRetry={() => void Promise.all([
            productsQuery.refetch(),
            ...(user?.role === "seller" ? [ordersQuery.refetch(), quotationsQuery.refetch()] : []),
          ])}
        />
      </main>
    </>;
  }
  if (productsQuery.isLoading || (user?.role === "seller" && (ordersQuery.isLoading || quotationsQuery.isLoading))) {
    return <LoadingWorkspace/>;
  }
  return <><WorkspaceHeader title={onExitSellerMode ? "Seller workspace (acting as seller)" : "Farmer workspace"} description="Manage harvest listings, quotations, inventory, and fulfillment."/>{onExitSellerMode && <div className={`${shellContainerClass} pt-5`}><button className="agri-ghost text-sm" onClick={onExitSellerMode}>Return to Admin workspace</button></div>}<main className={`${shellContainerClass} py-8`}><div className="grid gap-4 md:grid-cols-3"><Metric label="Active listings" value={String(activeListings.length)} icon={Package}/><Metric label="Incoming orders" value={String(orders.filter(row => row.order.status === "submitted").length)} icon={ClipboardList}/><Metric label="Waiting quotations" value={String(quotations.filter(row => row.quotation.status === "requested").length)} icon={FileText}/></div><section className="mt-8 agri-card p-5 sm:p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="font-display text-2xl font-bold text-[#264f37]">Your produce listings</h2><p className="mt-1 text-sm text-[#6a796e]">Edit product details, manually update stock, or archive unavailable listings.</p>{needsCooperative && <p className="mt-2 text-sm font-semibold text-[#a34838]" role="alert">Your cooperative was removed or is not assigned. Choose another before publishing new listings.</p>}</div><button className="agri-button text-sm" disabled={needsCooperative} onClick={() => setOpenForm(!openForm)}><Plus size={17}/>{openForm ? "Close form" : "Add harvest"}</button></div>{needsCooperative && <div className="mt-4"><SellerAssociationRequestPanel/></div>}{openForm && !needsCooperative && <form onSubmit={submit} className="mt-6 grid gap-4 rounded-2xl bg-[#f1f6ee] p-5 md:grid-cols-2"><label className="field-label">Product name<input required className="field-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label className="field-label">Classification<input required className="field-control" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}/></label><label className="field-label">Cooperative<input readOnly className="field-control bg-white/70" value={sellerCooperativeName} aria-label="Listing cooperative"/></label><label className="field-label">Variety<input required list="new-product-varieties" className="field-control" value={form.variety} onChange={e => setForm({ ...form, variety: e.target.value })}/><datalist id="new-product-varieties">{getProductVarieties(form.name).map(variety => <option value={variety} key={variety}/>)}</datalist></label><label className="field-label">Price per chosen unit (PHP)<input required min="0.01" step="0.01" type="number" className="field-control" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}/></label><label className="field-label">Unit of measurement<select required className="field-control" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>{PRODUCT_UNITS.map(unit => <option value={unit} key={unit}>{unit === "kg" ? "kilogram (kg)" : unit}</option>)}</select></label><label className="field-label">Available stock ({form.unit})<input required min="1" step="1" type="number" className="field-control" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })}/></label><label className="field-label">Minimum order quantity ({form.unit})<input required min="1" max={form.stock} step="1" type="number" className="field-control" value={form.minOrderQty} onChange={e => setForm({ ...form, minOrderQty: e.target.value })}/>{Number(form.minOrderQty) > Number(form.stock) && <span role="alert" className="mt-1 block text-xs text-[#a34838]">Minimum order cannot exceed available stock.</span>}</label><ListingPaymentFlagFields allowsPickup={form.allowsPickup} allowsDelivery={form.allowsDelivery} onChange={patch => setForm({ ...form, ...patch })}/><ProductImagePicker imageUrls={[]} files={imageFiles} onImageUrlsChange={() => undefined} onFilesChange={setImageFiles} error={imageError} onError={setImageError} disabled={create.isPending || uploadImage.isPending}/><label className="field-label">Quality grade<select className="field-control" value={form.qualityGrade} onChange={e => setForm({ ...form, qualityGrade: e.target.value as typeof form.qualityGrade })}><option value="premium">Premium</option><option value="standard">Standard</option><option value="imperfect">Imperfect / value-grade</option></select></label><label className="field-label md:col-span-2">Description<textarea required className="field-control min-h-29" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label><div className="md:col-span-2 flex justify-center pt-1"><button disabled={create.isPending || uploadImage.isPending || Boolean(imageError)} className="agri-button text-sm">{create.isPending || uploadImage.isPending ? <Loader2 className="animate-spin" size={15}/> : null} Submit listing</button></div></form>}<div className="mt-6 flex gap-2" role="tablist" aria-label="Listing status"><button type="button" role="tab" aria-selected={listingTab === "active"} className={`min-h-11 rounded-xl px-3 text-sm font-bold ${listingTab === "active" ? "bg-[#1f4f36] text-white" : "bg-[#edf3e9] text-[#315640]"}`} onClick={() => setListingTab("active")}>Active ({activeListings.length})</button><button type="button" role="tab" aria-selected={listingTab === "archived"} className={`min-h-11 rounded-xl px-3 text-sm font-bold ${listingTab === "archived" ? "bg-[#1f4f36] text-white" : "bg-[#edf3e9] text-[#315640]"}`} onClick={() => setListingTab("archived")}>Archived ({archivedListings.length})</button></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{isLoading ? <Loader2 className="m-8 animate-spin text-[#5d8a5e]"/> : visibleListings.length ? visibleListings.map(product => <SellerProductCard key={product.id} product={product} listingTab={listingTab}/>) : <Empty icon={Package} title={listingTab === "archived" ? "No archived listings" : "No products published"} body={listingTab === "archived" ? "Archived harvests appear here until you unarchive or delete them." : "Add your first harvest to begin reaching buyers."}/>}</div></section><section className="mt-8 grid gap-8 xl:grid-cols-2"><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Fulfillment queue</h2><div className="mt-3 flex gap-2" role="tablist" aria-label="Queue filter"><button type="button" role="tab" aria-selected={queueTab==="active"} className={`agri-ghost px-3 py-1.5 text-xs ${queueTab==="active"?"bg-[#edf3e9]":""}`} onClick={()=>setQueueTab("active")}>Active ({sellerOrderCounts.data?.active ?? 0})</button><button type="button" role="tab" aria-selected={queueTab==="archived"} className={`agri-ghost px-3 py-1.5 text-xs ${queueTab==="archived"?"bg-[#edf3e9]":""}`} onClick={()=>setQueueTab("archived")}>Archived ({sellerOrderCounts.data?.archived ?? 0})</button></div><div className="mt-5 space-y-3">{orders.length ? orders.map(row => <div key={`${row.order.id}-${row.item.id}`} className="rounded-xl bg-[#f2f6ef] p-4"><div className="flex flex-wrap justify-between gap-2"><div><Link href={`/orders/${row.order.id}`} className="font-bold text-[#315640] no-underline hover:text-[#1f5a3c]">Order #{row.order.id} · {row.buyerName || "Buyer"}</Link><p className="mt-1 text-xs text-[#6f7d72]">{row.productName} × {row.item.quantity} {row.unit} · {peso(row.item.unitPriceCents * row.item.quantity)}</p></div><Status value={row.order.status}/></div><div className="mt-3"><button type="button" className="agri-ghost min-h-11 px-3 py-2 text-xs" disabled={openOrderChat.isPending} onClick={() => openOrderChat.mutate({ orderId: row.order.id })}><MessageCircle size={14}/> Message</button></div>{row.order.status !== "completed" && row.order.status !== "cancelled" && <div className="mt-4 flex flex-wrap gap-2">{row.order.status === "submitted" && <button onClick={() => updateStatus.mutate({ orderId: row.order.id, status: "confirmed" })} className="agri-ghost px-3 py-2 text-xs">Confirm</button>}{row.order.status === "confirmed" && <button onClick={() => updateStatus.mutate({ orderId: row.order.id, status: "ready" })} className="agri-ghost px-3 py-2 text-xs">Mark ready</button>}{row.order.status === "ready" && <p className="self-center text-xs text-[#617467]">Ready for the cooperative officer to complete after fulfillment and payment.</p>}<button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => sellerArchive.mutate({ orderIds: [row.order.id], action: queueTab === "active" ? "archive" : "unarchive" })}>{queueTab === "active" ? "Archive" : "Unarchive"}</button><button type="button" className="text-xs font-bold text-[#a34838]" onClick={() => sellerArchive.mutate({ orderIds: [row.order.id], action: "delete" })}>Delete</button><button onClick={() => updateStatus.mutate({ orderId: row.order.id, status: "cancelled" })} className="text-xs font-bold text-[#a34838]">Cancel</button></div>}</div>) : <Empty icon={ClipboardList} title="No incoming orders" body="New buyer orders will appear here."/>}</div></div><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Quotation requests</h2><div className="mt-2 text-sm text-[#6a796e]">{queueTab === "archived" ? "Archived" : "Active"} · {quotationCounts.data?.active ?? 0} active / {quotationCounts.data?.archived ?? 0} archived</div><div className="mt-2 flex gap-2" role="tablist" aria-label="Quotation queue filter"><button type="button" role="tab" className="agri-ghost px-3 py-1.5 text-xs" onClick={() => setQueueTab("active")}>Active</button><button type="button" role="tab" className="agri-ghost px-3 py-1.5 text-xs" onClick={() => setQueueTab("archived")}>Archived</button></div><div className="mt-5 space-y-3">{quotations.length ? quotations.map(row => <QuotationResponse key={row.quotation.id} row={row} onRespond={(quotedPriceCents, sellerNote, status) => respond.mutate({ quotationId: row.quotation.id, quotedPriceCents, sellerNote, status })}/>) : <Empty icon={FileText} title="No quotation requests" body="Buyer quotation requests will be shown here."/>}</div></div></section></main></>;
}

function SellerVerificationWorkspace() {
  const { user } = useAuth();
  const { data: cooperatives = [] } = trpc.cooperatives.list.useQuery();
  const cooperativeRemoved = user?.cooperativeId != null && !cooperatives.some(c => c.id === user.cooperativeId);
  return <>
    {(user?.cooperativeId === null || cooperativeRemoved) && <div className={`${shellContainerClass} pt-5`}><SellerAssociationRequestPanel/></div>}
    <SellerDashboard/>
    <main className={`${shellContainerClass} pb-8`}><ProfileVerificationPanel/></main>
  </>;
}

function OfficerDashboard() {
  const utils = trpc.useUtils(); const { data: overview, isLoading, error } = trpc.cooperativeAdmin.overview.useQuery();
  const updateMember = trpc.cooperativeAdmin.updateMemberStatus.useMutation({ onSuccess: () => { toast.success("Member status updated."); utils.cooperativeAdmin.overview.invalidate(); }, onError: problem => toast.error(problem.message) });
  if (isLoading) return <LoadingWorkspace/>;
  if (error) return <><WorkspaceHeader title="Cooperative officer workspace" description="Monitor members and marketplace coordination for your assigned cooperative."/><main className={`${shellContainerClass} py-8`}><div className="flex gap-3 rounded-2xl border border-[#e9dba9] bg-[#fff8e2] p-4 text-sm leading-6 text-[#76551b]"><AlertCircle className="mt-0.5 shrink-0" size={18}/><div><strong>Officer setup required</strong><p>{error.message}</p></div></div></main></>;
  const totalSales = overview?.transactions.reduce((sum, row) => sum + row.transactions.amountCents, 0) || 0;
  const downloadReport = () => { const rows = [["Report type", "Name / ID", "Detail", "Value (PHP)"], ...(overview?.products || []).map(product => ["Inventory", product.name, `${product.category} · ${product.variety} · ${product.stockQty} ${product.unit} available · minimum ${product.minOrderQty} ${product.unit}`, `${peso(product.priceCents)} per ${product.unit}`]), ...(overview?.quotations || []).map(row => ["Quotation", row.productName, `${row.buyerName || "Buyer"} · ${row.quotation.requestedQty} ${row.unit} requested · ${formatEnumLabel(row.quotation.status)}`, row.quotation.quotedPriceCents ? `${peso(row.quotation.quotedPriceCents)} per ${row.unit}` : "Pending"]), ...(overview?.transactions || []).map(row => ["Transaction", `Order #${row.transactions.orderId}`, row.transactions.paymentReferenceNote || "F2F coordination noted", peso(row.transactions.amountCents)])]; const url = URL.createObjectURL(new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "agricoop-cooperative-report.csv"; link.click(); URL.revokeObjectURL(url); };
  return <><WorkspaceHeader title="Cooperative officer workspace" description="Validate members, oversee listings and transactions, and keep cooperative trade accountable."/><main className={`${shellContainerClass} py-8`}><div className="grid gap-4 md:grid-cols-5"><Metric label="Cooperative members" value={String(overview?.members.length || 0)} icon={Users}/><Metric label="Listings monitored" value={String(overview?.products.length || 0)} icon={Package}/><Metric label="Quotations monitored" value={String(overview?.quotations.length || 0)} icon={FileText}/><Metric label="Orders recorded" value={String(overview?.orders.length || 0)} icon={ClipboardList}/><Metric label="Recorded sales" value={peso(totalSales)} icon={BarChart3}/></div><section className="mt-8 grid gap-8 xl:grid-cols-[1.15fr_.85fr]"><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Member validation</h2><p className="mt-1 text-sm text-[#6a796e]">Approve or suspend cooperative member roles within your assigned organization.</p><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="border-b border-[#e2e9dd] text-xs uppercase tracking-wide text-[#718174]"><tr><th className="pb-3">Member</th><th className="pb-3">Role</th><th className="pb-3">Status</th><th className="pb-3"></th></tr></thead><tbody>{overview?.members.map(member => <tr key={member.id} className="border-b border-[#edf0e9]"><td className="py-3 font-bold text-[#315640]">{member.name || "Unnamed member"}</td><td className="py-3 capitalize text-[#647568]">{member.role}</td><td className="py-3"><Status value={member.approvalStatus}/></td><td className="py-3 text-right">{member.role !== "admin" && member.role !== "superadmin" && (member.approvalStatus !== "approved" ? <button className="agri-ghost px-2.5 py-1.5 text-xs" onClick={() => updateMember.mutate({ userId: member.id, approvalStatus: "approved" })}>Approve</button> : <button className="text-xs font-bold text-[#a34838]" onClick={() => updateMember.mutate({ userId: member.id, approvalStatus: "suspended" })}>Suspend</button>)}</td></tr>)}</tbody></table>{!overview?.members.length && <p className="py-8 text-center text-sm text-[#6d7d70]">No members are associated with this cooperative yet.</p>}</div></div><div className="space-y-8"><div className="agri-card p-5 sm:p-6"><h2 className="font-display text-2xl font-bold text-[#264f37]">Inventory pulse</h2><div className="mt-4 space-y-3">{overview?.products.length ? overview.products.map(product => <div key={product.id} className="flex items-center justify-between rounded-xl bg-[#f2f6ef] p-3"><div><p className="font-bold text-[#315640]">{product.name}</p><p className="text-xs text-[#6c7c70]">{product.category} · {product.unit}</p></div><span className={`text-sm font-bold ${product.stockQty < 10 ? "text-[#a35538]" : "text-[#2c6b43]"}`}>{product.stockQty} left</span></div>) : <p className="text-sm text-[#6d7d70]">No cooperative listings to monitor yet.</p>}</div></div><div className="agri-card p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-2xl font-bold text-[#264f37]">Report snapshot</h2><p className="mt-2 text-sm leading-6 text-[#65766b]">Live sales, inventory, quotation, and completed-transaction reporting for your cooperative.</p></div><button onClick={downloadReport} className="agri-ghost shrink-0 px-3 py-2 text-xs"><Download size={15}/> Export CSV</button></div><div className="mt-4 rounded-xl bg-[#edf3e9] p-4"><p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#638947]">Payment coordination / status</p><p className="mt-1 text-sm text-[#41634c]">{overview?.transactions.length || 0} completed transactions documented with payment reference notes where provided.</p></div></div></div></section></main></>;
}

function AdminUserRow({
  user,
  cooperativeName,
  cooperatives,
  canAssignSuperAdmin,
  currentUserId,
  currentUserRole,
  onSave,
  onRequestDelete,
  onRestore,
}: {
  user: any;
  cooperativeName: string | null;
  cooperatives: any[];
  canAssignSuperAdmin: boolean;
  currentUserId?: number;
  currentUserRole?: string;
  onSave: (values: any) => void;
  onRequestDelete: (user: any) => void;
  onRestore: (userId: number) => void;
}) {
  const [role, setRole] = useState(user.role === "user" ? "buyer" : user.role);
  const [approvalStatus, setApprovalStatus] = useState(user.approvalStatus);
  const [cooperativeId, setCooperativeId] = useState(user.cooperativeId?.toString() || "");
  const isSelf = currentUserId === user.id;
  const isDeleted = Boolean(user.deletedAt);
  const canDelete = !isSelf
    && user.role !== "superadmin"
    && (currentUserRole === "superadmin"
      ? user.role === "buyer" || user.role === "seller" || user.role === "admin"
      : user.role === "buyer" || user.role === "seller");

  return (
    <tr className={`border-t border-[#edf0e9] ${isDeleted ? "opacity-70" : ""}`}>
      <td className="p-3">
        <p className="font-bold text-[#315640]">{user.name || "Unnamed user"}{isDeleted ? " (deleted)" : ""}</p>
        <p className="text-xs text-[#718074]">{user.email || "No email"}</p>
      </td>
      <td className="p-3">
        <select className="rounded border border-[#d5e0d1] bg-white p-1.5" value={role} disabled={isDeleted} onChange={e => setRole(e.target.value)}>
          <option value="buyer">Buyer</option>
          <option value="seller">Seller</option>
          <option value="admin" disabled={currentUserRole !== "superadmin" && user.role !== "admin"}>Officer</option>
          {canAssignSuperAdmin && <option value="superadmin">SuperAdmin</option>}
        </select>
      </td>
      <td className="p-3">
        <select className="max-w-40 rounded border border-[#d5e0d1] bg-white p-1.5" value={cooperativeId} disabled={isDeleted} onChange={e => setCooperativeId(e.target.value)}>
          <option value="">None</option>
          {cooperatives.map(cooperative => <option key={cooperative.id} value={cooperative.id}>{cooperative.name}</option>)}
        </select>
        {cooperativeName && <p className="mt-1 text-xs text-[#718074]">Current: {cooperativeName}</p>}
      </td>
      <td className="p-3">
        <select className="rounded border border-[#d5e0d1] bg-white p-1.5" value={approvalStatus} disabled={isDeleted} onChange={e => setApprovalStatus(e.target.value)}>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
        </select>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-2 whitespace-nowrap">
          {!isDeleted && (
            <button type="button" onClick={() => onSave({ role, approvalStatus, cooperativeId: cooperativeId ? Number(cooperativeId) : null })} className="agri-ghost shrink-0 px-3 py-2 text-xs">Save</button>
          )}
          {isDeleted ? (
            <button type="button" className="agri-ghost shrink-0 px-3 py-2 text-xs" onClick={() => onRestore(user.id)}>Restore</button>
          ) : canDelete ? (
            <button type="button" className="agri-ghost shrink-0 px-3 py-2 text-xs text-[#a34838]" onClick={() => onRequestDelete(user)}>Delete</button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function AdminOrderCard({ orderId }: { orderId: number }) {
  const utils = trpc.useUtils();
  const [completionOpen, setCompletionOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [finalQuantities, setFinalQuantities] = useState<Record<number, string>>({});
  const [completionError, setCompletionError] = useState("");
  const { data, isLoading, isFetching, error, refetch } = trpc.cooperativeAdmin.orderDetails.useQuery({ orderId });
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
  const recordCashReceipt = trpc.payments.recordCashReceipt.useMutation({
    onSuccess: async () => {
      toast.success("Cash receipt recorded.");
      await Promise.all([
        utils.cooperativeAdmin.orderDetails.invalidate({ orderId }),
        utils.admin.overview.invalidate(),
        utils.payments.mine.invalidate(),
      ]);
    },
    onError: problem => toast.error(problem.message),
  });
  const [removeOpen, setRemoveOpen] = useState(false);
  const statesQuery = trpc.cooperativeAdmin.orderThreadStates.useQuery();
  const thread = (statesQuery.data ?? []).find(row => row.orderId === orderId);
  const requestAvailability = trpc.orders.requestSellerAvailability.useMutation({
    onSuccess: async () => {
      toast.success("Seller availability request sent.");
      await Promise.all([
        utils.orders.sellerMine.invalidate(),
        utils.cooperativeAdmin.orderDetails.invalidate({ orderId }),
        utils.cooperativeAdmin.orderThreadStates.invalidate(),
      ]);
    },
    onError: problem => toast.error(problem.message),
  });
  const updateOrderState = trpc.cooperativeAdmin.updateOrderState.useMutation({
    onSuccess: async () => {
      toast.success("Order removed from the list.");
      setRemoveOpen(false);
      await Promise.all([
        utils.cooperativeAdmin.orderThreadStates.invalidate(),
        utils.admin.overview.invalidate(),
        utils.cooperativeAdmin.overview.invalidate(),
      ]);
    },
    onError: problem => toast.error(toUserFacingErrorMessage(problem.message)),
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
  const cancelOrder = () => setCancelOpen(true);
  const isRemoved = Boolean(thread?.deletedAt || thread?.archivedAt);

  if (isLoading) return <div className="rounded-xl bg-[#f2f6ef] p-4 text-sm text-[#6c7c70]">Loading order #{orderId}…</div>;
  if (error || !data) return <AdminOrderDetailsQueryError
    orderId={orderId}
    message={error?.message ?? "Order details are unavailable."}
    isRetrying={isFetching}
    onRetry={() => { void refetch(); }}
  />;

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
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {data.payment && (
        <span className="rounded-full bg-[#e8f1e4] px-2.5 py-1 text-xs font-semibold text-[#315640]">
          Payment: {data.order.paymentStatus === "paid" ? "Paid" : data.order.paymentStatus === "awaiting_verification" ? "Awaiting verification" : "Unpaid"} · {String(data.order.paymentMethod ?? "").replaceAll("_", " ")}
        </span>
      )}
      {data.order.status === "ready" && data.payment && data.order.paymentStatus !== "paid" && (data.order.paymentMethod === "cash_pickup" || data.order.paymentMethod === "cash_delivery") && <div><p className="mb-1 text-xs text-[#6c7c70]">Record only after the full cash amount is received.</p><button type="button" className="agri-ghost px-3 py-2 text-xs" disabled={recordCashReceipt.isPending} onClick={() => recordCashReceipt.mutate({ orderId: data.order.id })}>Record cash received</button></div>}
      {data.order.status === "submitted" && <button type="button" className="agri-button px-3 py-2 text-xs" disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({ orderId: data.order.id, status: "confirmed" })}>Approve order</button>}
      {data.order.status === "confirmed" && <button type="button" className="agri-button px-3 py-2 text-xs" disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({ orderId: data.order.id, status: "ready" })}>Mark ready</button>}
      {data.order.status === "ready" && <button type="button" className="agri-button px-3 py-2 text-xs" onClick={startCompletion}>Complete</button>}
      {(data.order.status === "submitted" || data.order.status === "confirmed") && (
        <button type="button" className="agri-ghost px-3 py-2 text-xs" disabled={requestAvailability.isPending} onClick={() => requestAvailability.mutate({ orderId: data.order.id })}>Request seller confirmation</button>
      )}
      {data.order.status !== "completed" && data.order.status !== "cancelled" && <button type="button" className="px-3 py-2 text-xs font-bold text-[#a34838]" onClick={cancelOrder}>Cancel</button>}
      {(data.order.status === "completed" || data.order.status === "cancelled") && !isRemoved && (
        <button type="button" className="agri-ghost px-3 py-2 text-xs text-[#a34838]" onClick={() => setRemoveOpen(true)}>Remove from list</button>
      )}
    </div>
    {isRemoved && <p className="mt-3 text-xs text-[#6c7c70]">This order was removed from the operational list. Its records remain preserved for accountability.</p>}
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
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel order #{orderId}?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone. No stock will be deducted.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={updateStatus.isPending}>Keep order</AlertDialogCancel>
          <AlertDialogAction
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate({ orderId, status: "cancelled" })}
          >
            Cancel order
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove order #{orderId} from the list?</AlertDialogTitle>
          <AlertDialogDescription>
            This hides the order from operational lists. The order, payment, and audit records stay preserved for accountability. This cannot be undone from this screen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={updateOrderState.isPending}>Keep order</AlertDialogCancel>
          <AlertDialogAction
            disabled={updateOrderState.isPending}
            onClick={() => updateOrderState.mutate({ orderIds: [orderId], action: "archive" })}
          >
            Remove from list
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </article>;
}

const ORDER_TAB_DEFS = [
  { id: "pending", label: "Pending" },
  { id: "complete", label: "Complete" },
  { id: "cancelled", label: "Cancelled" },
] as const;
type OrderTabId = (typeof ORDER_TAB_DEFS)[number]["id"];

function orderTabForStatus(status: string): OrderTabId {
  if (status === "completed") return "complete";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

function AdminOrdersPanel() {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.admin.overview.useQuery();
  const statesQuery = trpc.cooperativeAdmin.orderThreadStates.useQuery();
  const [tab, setTab] = useState<OrderTabId>("pending");
  const [search, setSearch] = useState("");
  const updateOrderState = trpc.cooperativeAdmin.updateOrderState.useMutation({
    onSuccess: () => {
      toast.success("Order list updated.");
      void utils.cooperativeAdmin.orderThreadStates.invalidate();
      void utils.admin.overview.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const orders = overviewQuery.data?.orders ?? [];
  const hiddenIds = new Set(
    (statesQuery.data ?? [])
      .filter(row => row.deletedAt || row.archivedAt)
      .map(row => row.orderId),
  );
  const visible = orders.filter(order => !hiddenIds.has(order.id));
  const counts: Record<OrderTabId, number> = { pending: 0, complete: 0, cancelled: 0 };
  for (const order of visible) counts[orderTabForStatus(order.status)] += 1;
  const term = search.trim().toLowerCase();
  const filtered = visible.filter(order => {
    if (orderTabForStatus(order.status) !== tab) return false;
    if (!term) return true;
    return String(order.id).includes(term)
      || (order.totalCents !== undefined && peso(order.totalCents).toLowerCase().includes(term))
      || (order.status ?? "").toLowerCase().includes(term);
  });
  const pendingOrders = filtered.filter(order => order.status !== "completed" && order.status !== "cancelled");
  const closedOrders = filtered.filter(order => order.status === "completed" || order.status === "cancelled");
  return (
    <section className="agri-card p-5 sm:p-6" data-testid="admin-orders-content">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#264f37]">Order management</h2>
          <p className="mt-1 text-sm text-[#6a796e]">Review orders, coordinate fulfillment, and verify payments for your cooperative.</p>
        </div>
        <input
          className="field-control w-full sm:w-64"
          placeholder="Search orders…"
          value={search}
          onChange={event => setSearch(event.target.value)}
          aria-label="Search orders"
        />
      </div>
      <div className="mt-4 flex gap-2" role="tablist" aria-label="Order category">
        {ORDER_TAB_DEFS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`agri-ghost px-3 py-1.5 text-xs ${tab === item.id ? "bg-[#edf3e9]" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label} ({counts[item.id]})
          </button>
        ))}
      </div>
      <div className="mt-5 space-y-3">
        {(tab === "pending" ? pendingOrders : closedOrders).map(order => (
          <AdminOrderCard key={order.id} orderId={order.id} />
        ))}
        {!(tab === "pending" ? pendingOrders : closedOrders).length && (
          <p className="py-5 text-center text-sm text-[#6d7d70]">
            {tab === "pending" ? "No orders are waiting for fulfillment." : tab === "complete" ? "No completed orders yet." : "No cancelled orders."}
          </p>
        )}
      </div>
    </section>
  );
}

function AdminPaymentReviewQueue() {
  const utils = trpc.useUtils();
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const { data, isLoading, isFetching, error, refetch } = trpc.payments.reviewQueue.useQuery();
  const proofs = data?.proofs ?? [];
  const cashAwaitingReceived = data?.cashAwaitingReceived ?? [];
  const review = trpc.payments.reviewProof.useMutation({
    onSuccess: () => {
      toast.success("Payment review saved.");
      void utils.payments.reviewQueue.invalidate();
      void utils.payments.mine.invalidate();
      void utils.admin.overview.invalidate();
    },
    onError: mutationError => toast.error(mutationError.message),
  });
  const recordCash = trpc.payments.recordCashReceipt.useMutation({
    onSuccess: () => {
      toast.success("Cash receipt recorded.");
      void utils.payments.reviewQueue.invalidate();
      void utils.payments.mine.invalidate();
      void utils.admin.overview.invalidate();
    },
    onError: mutationError => toast.error(mutationError.message),
  });
  return <div className="space-y-8">
    <section className="agri-card p-5 sm:p-6">
      <h2 className="font-display text-2xl font-bold text-[#264f37]">Online receipt verification</h2>
      <p className="mt-1 text-sm text-[#6a796e]">Review private receipt images before marking a payment verified or rejected.</p>
      {error ? <div className="mt-4 text-sm text-[#a34838]"><p role="alert">{error.message}</p><button type="button" className="agri-ghost mt-2 text-xs" disabled={isFetching} onClick={() => void refetch()}>Retry</button></div> : isLoading ? <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]"/> : proofs.length ? <div className="mt-5 space-y-4">{proofs.map(row => <article key={row.proof.id} className="rounded-xl border border-[#e3e9de] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-[#315640]">Order #{row.order.id} · {peso(Number(row.order.totalCents))}</p><p className="mt-1 text-xs text-[#6d7d70]">Proof #{row.proof.id} · {row.proof.originalFileName ?? "Receipt image"}</p></div><Status value={row.proof.verificationStatus}/></div>
        {row.evidenceUrl ? <a href={row.evidenceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-bold text-[#397549] underline">Open private receipt image</a> : <p className="mt-3 text-sm text-[#a34838]">{row.evidenceUnavailable ? "The private receipt is unavailable. Check Storage configuration; reject this attempt with a reason so the buyer can resubmit." : "No valid private receipt is available for this payment."}</p>}
        {row.proof.verificationStatus === "pending" && <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="field-label min-w-56 flex-1">Review note (required when rejecting)<textarea maxLength={600} className="field-control min-h-16" value={reasons[row.proof.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [row.proof.id]: event.target.value }))}/></label>
          <button className="agri-button" disabled={review.isPending || !row.evidenceUrl} onClick={() => review.mutate({ proofId: row.proof.id, decision: "verified", reviewNote: reasons[row.proof.id]?.trim() || undefined })}>Verify payment</button>
          <button className="agri-ghost text-[#a34838]" disabled={review.isPending || !reasons[row.proof.id]?.trim()} onClick={() => review.mutate({ proofId: row.proof.id, decision: "rejected", reviewNote: reasons[row.proof.id]?.trim() })}>Reject proof</button>
        </div>}
      </article>)}</div> : <p className="py-6 text-center text-sm text-[#6d7d70]">No online payments are waiting for review.</p>}
    </section>
    <section className="agri-card p-5 sm:p-6">
      <h2 className="font-display text-2xl font-bold text-[#264f37]">Cash awaiting confirmation</h2>
      <p className="mt-1 text-sm text-[#6a796e]">Mark cash received only after the full amount is in hand for a ready order.</p>
      {isLoading ? <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]"/> : cashAwaitingReceived.length ? <div className="mt-5 space-y-3">{cashAwaitingReceived.map(order => <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e3e9de] p-4">
        <div>
          <p className="font-bold text-[#315640]">Order #{order.id} · {peso(Number(order.totalCents))}</p>
          <p className="mt-1 text-xs text-[#6d7d70]">{paymentMethodLabel(order.paymentMethod)} · {formatEnumLabel(order.status)}</p>
        </div>
        <button type="button" className="agri-button text-sm" disabled={recordCash.isPending} onClick={() => recordCash.mutate({ orderId: order.id })}>Record cash received</button>
      </article>)}</div> : <p className="py-6 text-center text-sm text-[#6d7d70]">No cash orders are waiting to be marked received.</p>}
    </section>
  </div>;
}

function AdminSystemPaymentsPanel() {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.systemPayment.getSettings.useQuery();
  const accountsQuery = trpc.systemPayment.listAccounts.useQuery();
  const [draft, setDraft] = useState({ cashPickupEnabled: true, cashDeliveryEnabled: true, onlineEnabled: false });
  const [accountForm, setAccountForm] = useState({ label: "", accountName: "", accountNumber: "", instructions: "" });
  const updateSettings = trpc.systemPayment.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Payment settings saved.");
      void utils.systemPayment.getSettings.invalidate();
      void utils.systemPayment.getAvailability.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const createAccount = trpc.systemPayment.createAccount.useMutation({
    onSuccess: () => {
      toast.success("Online account added.");
      setAccountForm({ label: "", accountName: "", accountNumber: "", instructions: "" });
      void utils.systemPayment.listAccounts.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const activateAccount = trpc.systemPayment.activateAccount.useMutation({
    onSuccess: () => {
      toast.success("Online account activated.");
      void utils.systemPayment.listAccounts.invalidate();
      void utils.systemPayment.getAvailability.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const archiveAccount = trpc.systemPayment.archiveAccount.useMutation({
    onSuccess: () => {
      toast.success("Online account archived.");
      void utils.systemPayment.listAccounts.invalidate();
      void utils.systemPayment.getAvailability.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const uploadQr = trpc.systemPayment.uploadQr.useMutation({
    onSuccess: () => {
      toast.success("QR image saved.");
      void utils.systemPayment.listAccounts.invalidate();
      void utils.systemPayment.getAvailability.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  useEffect(() => {
    if (!settingsQuery.data) return;
    setDraft({
      cashPickupEnabled: settingsQuery.data.cashPickupEnabled,
      cashDeliveryEnabled: settingsQuery.data.cashDeliveryEnabled,
      onlineEnabled: settingsQuery.data.onlineEnabled,
    });
  }, [settingsQuery.data]);

  const onUploadQr = async (accountId: number, file: File | null) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > PAYMENT_PROOF_MAX_BYTES) {
      toast.error("Choose a JPEG, PNG, or WebP QR image that is 5 MB or less.");
      return;
    }
    try {
      const base64 = await readImageAsBase64(file);
      uploadQr.mutate({
        accountId,
        fileName: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read the QR image.");
    }
  };

  const accounts = accountsQuery.data ?? [];
  return (
    <div className="space-y-8" data-testid="admin-payments-content">
      <section className="agri-card p-5 sm:p-6">
        <h2 className="font-display text-2xl font-bold text-[#264f37]">Payment settings</h2>
        <p className="mt-1 text-sm text-[#6a796e]">These toggles apply to every listing. Online checkout also needs one active account with a QR.</p>
        {settingsQuery.error ? <p role="alert" className="mt-4 text-sm text-[#a34838]">{settingsQuery.error.message}</p>
          : settingsQuery.isLoading ? <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]"/>
            : <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); updateSettings.mutate(draft); }}>
              <label className="flex items-center gap-2 text-sm text-[#45614e]"><input type="checkbox" checked={draft.cashPickupEnabled} onChange={event => setDraft({ ...draft, cashPickupEnabled: event.target.checked })} /> Cash on pickup</label>
              <label className="flex items-center gap-2 text-sm text-[#45614e]"><input type="checkbox" checked={draft.cashDeliveryEnabled} onChange={event => setDraft({ ...draft, cashDeliveryEnabled: event.target.checked })} /> Cash on delivery</label>
              <label className="flex items-center gap-2 text-sm text-[#45614e]"><input type="checkbox" checked={draft.onlineEnabled} onChange={event => setDraft({ ...draft, onlineEnabled: event.target.checked })} /> Online payment</label>
              <button className="agri-button text-sm" disabled={updateSettings.isPending}>Save settings</button>
            </form>}
      </section>
      <section className="agri-card p-5 sm:p-6">
        <h2 className="font-display text-2xl font-bold text-[#264f37]">Online account and QR</h2>
        <p className="mt-1 text-sm text-[#6a796e]">Buyers see only the active account. Archive replaces an account without deleting its history.</p>
        <form className="mt-5 grid gap-3 md:grid-cols-2" onSubmit={event => {
          event.preventDefault();
          createAccount.mutate({
            label: accountForm.label.trim(),
            accountName: accountForm.accountName.trim(),
            accountNumber: accountForm.accountNumber.trim(),
            instructions: accountForm.instructions.trim() || undefined,
          });
        }}>
          <label className="field-label">Label<input required maxLength={150} className="field-control" value={accountForm.label} onChange={event => setAccountForm({ ...accountForm, label: event.target.value })} /></label>
          <label className="field-label">Account name<input required maxLength={150} className="field-control" value={accountForm.accountName} onChange={event => setAccountForm({ ...accountForm, accountName: event.target.value })} /></label>
          <label className="field-label">Account number<input required maxLength={100} className="field-control" value={accountForm.accountNumber} onChange={event => setAccountForm({ ...accountForm, accountNumber: event.target.value })} /></label>
          <label className="field-label md:col-span-2">Instructions<textarea maxLength={2000} className="field-control min-h-20" value={accountForm.instructions} onChange={event => setAccountForm({ ...accountForm, instructions: event.target.value })} /></label>
          <div className="md:col-span-2"><button className="agri-button text-sm" disabled={createAccount.isPending}>Add account</button></div>
        </form>
        <div className="mt-6 space-y-3">
          {accountsQuery.isLoading ? <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]"/> : accounts.filter(account => !account.archivedAt).map(account => (
            <article key={account.id} className="rounded-xl border border-[#e3e9de] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-[#315640]">{account.label}{account.isActive ? " · Active" : ""}</p>
                  <p className="mt-1 text-sm text-[#5f7264]">{account.accountName} · {account.accountNumber}</p>
                  {account.instructions && <p className="mt-2 text-xs text-[#6d7d70]">{account.instructions}</p>}
                </div>
                {account.qrImageUrl ? <img src={account.qrImageUrl} alt="" className="h-20 w-20 rounded-lg border border-[#e2e9dd] object-contain" /> : <div className="grid h-20 w-20 place-items-center rounded-lg bg-[#edf3e9] text-[#82987a]"><QrCode /></div>}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!account.isActive && <button type="button" className="agri-button px-3 py-2 text-xs" disabled={activateAccount.isPending} onClick={() => activateAccount.mutate({ id: account.id })}>Set active</button>}
                <button type="button" className="agri-ghost px-3 py-2 text-xs text-[#a34838]" disabled={archiveAccount.isPending} onClick={() => archiveAccount.mutate({ id: account.id })}>Archive</button>
                <label className="agri-ghost cursor-pointer px-3 py-2 text-xs">
                  Upload QR
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploadQr.isPending} onChange={event => { void onUploadQr(account.id, event.target.files?.[0] ?? null); event.target.value = ""; }} />
                </label>
              </div>
            </article>
          ))}
          {!accountsQuery.isLoading && !accounts.some(account => !account.archivedAt) && <p className="py-4 text-center text-sm text-[#6d7d70]">No online account yet.</p>}
        </div>
      </section>
      <AdminPaymentReviewQueue />
    </div>
  );
}

function AdminProfileVerificationQueue() {
  const utils = trpc.useUtils();
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const { data: queue = [], isLoading, isFetching, error, refetch } = trpc.account.verificationQueue.useQuery();
  const review = trpc.account.reviewVerification.useMutation({
    onSuccess: async () => {
      toast.success("Profile verification decision saved.");
      setReasons({});
      await Promise.all([
        utils.account.verificationQueue.invalidate(),
        utils.admin.overview.invalidate(),
      ]);
    },
    onError: mutationError => toast.error(mutationError.message),
  });
  return <section className="mt-8 agri-card p-5 sm:p-6">
    <h2 className="font-display text-2xl font-bold text-[#264f37]">Profile verification queue</h2>
    <p className="mt-1 text-sm text-[#6a796e]">Review private applicant documents. Admins see only their cooperative; SuperAdmins see platform-wide submissions.</p>
    {error ? <div className="mt-4 text-sm text-[#a34838]"><p role="alert">{error.message}</p><button type="button" className="agri-ghost mt-2 text-xs" disabled={isFetching} onClick={() => void refetch()}>Retry</button></div>
      : isLoading ? <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]"/>
        : queue.length ? <div className="mt-5 space-y-4">{queue.map(row => <article key={row.submissionId} className="rounded-xl border border-[#e3e9de] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-bold text-[#315640]">{row.name || "Unnamed applicant"} · User #{row.userId}</p><p className="mt-1 text-xs capitalize text-[#6d7d70]">{row.role} · Cooperative {row.cooperativeId ?? "unassigned"} · Submitted {when(row.submittedAt)}</p></div>
            <Status value="pending"/>
          </div>
          <dl className="mt-3 grid gap-2 rounded-lg bg-[#f5f7f3] p-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-[#718074]">Birthdate</dt><dd>{when(row.birthdate)}</dd></div>
            <div><dt className="text-xs text-[#718074]">Contact number</dt><dd>{row.phone || "Not provided"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-[#718074]">Address</dt><dd>{row.address || "Not provided"}</dd></div>
            {row.submissionNote && <div className="sm:col-span-2"><dt className="text-xs text-[#718074]">Applicant note</dt><dd className="whitespace-pre-wrap">{row.submissionNote}</dd></div>}
          </dl>
          {row.evidenceUrl ? <a href={row.evidenceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-bold text-[#397549] underline">Open private verification image</a>
            : <p role="alert" className="mt-3 text-sm text-[#a34838]">The private evidence is unavailable. Check the bucket setup; approval is disabled until evidence is accessible.</p>}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="field-label min-w-56 flex-1">Review note (required when rejecting)<textarea maxLength={600} className="field-control min-h-16" value={reasons[row.submissionId] ?? ""} onChange={event => setReasons(current => ({ ...current, [row.submissionId]: event.target.value }))}/></label>
            <button type="button" className="agri-button" disabled={review.isPending || !row.evidenceUrl} onClick={() => review.mutate({ submissionId: row.submissionId, decision: "approved" })}>Approve</button>
            <button type="button" className="agri-ghost text-[#a34838]" disabled={review.isPending || !reasons[row.submissionId]?.trim()} onClick={() => review.mutate({ submissionId: row.submissionId, decision: "rejected", note: reasons[row.submissionId]?.trim() })}>Reject</button>
          </div>
        </article>)}</div>
          : <p className="py-6 text-center text-sm text-[#6d7d70]">No profiles are waiting for review.</p>}
  </section>;
}

function RoleConflictsPanel() {
  const utils = trpc.useUtils();
  const conflicts = trpc.admin.listRoleConflicts.useQuery();
  const reconcile = trpc.admin.reconcileRole.useMutation({
    onSuccess: () => {
      toast.success("Role records reconciled to the application account role.");
      void utils.admin.listRoleConflicts.invalidate();
      void utils.admin.overview.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  return <section className="mt-8 agri-card p-5 sm:p-6">
    <h2 className="font-display text-2xl font-bold text-[#264f37]">Role reconciliation</h2>
    <p className="mt-1 text-sm text-[#6a796e]">Application <code className="text-xs">users.role</code> is the operational source of truth. Canonical <code className="text-xs">profiles.role_id</code> must match. Conflicts block sign-in until healed.</p>
    {conflicts.error ? <QueryErrorState message={conflicts.error.message} isFetching={conflicts.isFetching} onRetry={() => void conflicts.refetch()}/>
      : conflicts.isLoading ? <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]"/>
      : conflicts.data?.length ? <div className="mt-4 space-y-3">{conflicts.data.map(row => <div key={row.userId} className="flex flex-col gap-3 rounded-xl border border-[#e9dba9] bg-[#fff8e2] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-bold text-[#76551b]">{row.email || `User #${row.userId}`}</p><p className="mt-1 text-xs text-[#76551b]">App role: {row.applicationRole} · Profile role: {row.profileRole}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="agri-button px-3 py-2 text-xs" disabled={reconcile.isPending} onClick={() => reconcile.mutate({ userId: row.userId, prefer: "application" })}>Align profile to app role</button>
          <button type="button" className="agri-ghost px-3 py-2 text-xs" disabled={reconcile.isPending} onClick={() => reconcile.mutate({ userId: row.userId, prefer: "profile" })}>Override app with profile role</button>
        </div>
      </div>)}</div>
      : <p className="mt-4 text-sm text-[#6d7d70]">No role conflicts detected.</p>}
  </section>;
}

function CooperativesAdminPanel({ canCreateCooperative }: { canCreateCooperative: boolean }) {
  const utils = trpc.useUtils();
  const manageQuery = trpc.cooperatives.manageList.useQuery();
  const [name, setName] = useState("");
  const [coopLocation, setCoopLocation] = useState("");
  const [coopAddress, setCoopAddress] = useState("");
  const [coopConflict, setCoopConflict] = useState<CooperativeConflictUi | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
    sellerCount: number;
    listingCount: number;
  } | null>(null);

  const createCooperative = trpc.cooperatives.create.useMutation({
    onSuccess: () => {
      toast.success("Cooperative added.");
      setName("");
      setCoopLocation("");
      setCoopAddress("");
      setCoopConflict(null);
      void utils.cooperatives.manageList.invalidate();
      void utils.admin.overview.invalidate();
      void utils.cooperatives.list.invalidate();
    },
    onError: error => {
      const conflict = cooperativeConflictFromError(error);
      if (conflict) {
        setCoopConflict(conflict);
        return;
      }
      toast.error(error.message);
    },
  });
  const softDelete = trpc.cooperatives.softDelete.useMutation({
    onSuccess: () => {
      toast.success("Cooperative deleted.");
      setDeleteTarget(null);
      void manageQuery.refetch();
      void utils.cooperatives.list.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message, USER_FACING_DELETE_COOPERATIVE_ERROR)),
  });
  const restore = trpc.cooperatives.restore.useMutation({
    onSuccess: () => {
      toast.success("Cooperative restored.");
      void manageQuery.refetch();
      void utils.cooperatives.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const runCreate = (confirmSimilarNormalizedName?: string) => {
    createCooperative.mutate({
      name: name.trim(),
      location: coopLocation.trim(),
      address: coopAddress.trim(),
      confirmSimilarNormalizedName,
    });
  };
  const deletedCount = manageQuery.data?.filter(row => Boolean(row.deletedAt)).length ?? 0;
  const visibleCooperatives = manageQuery.data?.filter(row => showDeleted || !row.deletedAt) ?? [];

  return (
  <div className="space-y-8">
    {canCreateCooperative && <form
      className="agri-card p-5 sm:p-6"
      onSubmit={event => {
        event.preventDefault();
        runCreate();
      }}
    >
      <h2 className="font-display text-2xl font-bold text-[#264f37]">Add a cooperative</h2>
      <label className="field-label mt-4">Cooperative name<input required minLength={3} className="field-control" value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="field-label mt-4">Street / barangay address<input required minLength={3} className="field-control" value={coopAddress} onChange={e => setCoopAddress(e.target.value)} /></label>
      <label className="field-label mt-4">Location<input required minLength={3} className="field-control" value={coopLocation} onChange={e => setCoopLocation(e.target.value)} placeholder="City, Province" /></label>
      {coopConflict && (
        <CooperativeDuplicateNotice
          {...(coopConflict.mode === "exact"
            ? {
                mode: "exact" as const,
                match: coopConflict.match,
                onUse: match => runCreate(match.normalizedName),
              }
            : {
                mode: "similar" as const,
                matches: coopConflict.matches,
                onUse: match => runCreate(match.normalizedName),
                onAddMine: () => runCreate(confirmNormalizedNameForNewCoop({
                  cooperativeId: null,
                  newCooperativeName: name,
                  newCooperativeLocation: coopLocation,
                  newCooperativeAddress: coopAddress,
                  addNew: true,
                })),
              })}
        />
      )}
      <button type="submit" className="agri-button mt-5 text-sm" disabled={createCooperative.isPending}><Plus size={16} /> Create cooperative</button>
    </form>}

    <section className="agri-card overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-[#264f37]">Cooperatives</h2>
        <button
          type="button"
          className="agri-ghost min-h-11 px-3 py-2 text-sm"
          aria-pressed={showDeleted}
          onClick={() => setShowDeleted(value => !value)}
        >
          {showDeleted ? "Hide deleted" : `Show deleted (${deletedCount})`}
        </button>
      </div>
      {manageQuery.isLoading && <Loader2 className="mx-auto my-6 animate-spin text-[#5d8a5e]" />}
      {manageQuery.error && <p role="alert" className="mt-3 text-sm text-[#a34838]">{manageQuery.error.message}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-[#e2e9dd] text-xs uppercase text-[#718174]">
            <tr>
              <th className="pb-2">Name</th>
              <th className="pb-2">Location</th>
              <th scope="col" className="min-w-[120px] px-4 pb-2 text-center">Sellers</th>
              <th scope="col" className="min-w-[120px] px-4 pb-2 text-center">Listings</th>
              <th className="pb-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleCooperatives.map(row => (
              <tr key={row.id} className={`border-t border-[#edf0e9] ${row.deletedAt ? "opacity-70" : ""}`}>
                <td className="py-2 font-semibold text-[#315640]">{row.name}{row.deletedAt ? " (deleted)" : ""}</td>
                <td className="py-2 text-[#65766b]">{[row.address, row.location].filter(Boolean).join(" · ")}</td>
                <td className="px-4 py-2 text-center">{row.sellerCount}</td>
                <td className="px-4 py-2 text-center">{row.listingCount}</td>
                <td className="py-2 text-right">
                  {row.deletedAt ? (
                    <button type="button" className="agri-ghost px-2 py-1 text-xs" disabled={restore.isPending} onClick={() => restore.mutate({ id: row.id })}>Restore</button>
                  ) : (
                    <button
                      type="button"
                      className="agri-ghost px-2 py-1 text-xs text-[#a34838]"
                      onClick={() => setDeleteTarget({
                        id: row.id,
                        name: row.name,
                        sellerCount: row.sellerCount,
                        listingCount: row.listingCount,
                      })}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!manageQuery.isLoading && !visibleCooperatives.length && (
          <p className="py-4 text-sm text-[#6d7d70]">{showDeleted ? "No cooperatives to show." : "No active cooperatives yet."}</p>
        )}
      </div>
    </section>

    <AlertDialog open={deleteTarget != null} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This soft-deletes the cooperative. It currently has {deleteTarget?.sellerCount ?? 0} seller(s) and {deleteTarget?.listingCount ?? 0} listing(s).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-[#a34838]"
            disabled={softDelete.isPending}
            onClick={() => {
              if (deleteTarget) softDelete.mutate({ id: deleteTarget.id });
            }}
          >
            Delete cooperative
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
  );
}

function MemberManagementPanel({ scope }: { scope: "buyer" | "seller" }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const overviewQuery = trpc.admin.overview.useQuery();
  const overview = overviewQuery.data;
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [usersFilter, setUsersFilter] = useState<"active" | "deleted">("active");
  const [deleteUserTarget, setDeleteUserTarget] = useState<{
    id: number;
    name: string | null;
    email: string | null;
    role: string;
    listingCount: number;
    openOrderCount: number;
  } | null>(null);
  const updateUser = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      toast.success("User settings saved.");
      utils.admin.overview.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const softDeleteUser = trpc.admin.softDeleteUser.useMutation({
    onSuccess: () => {
      toast.success("User deleted.");
      setDeleteUserTarget(null);
      void utils.admin.overview.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message, USER_FACING_DELETE_USER_ERROR)),
  });
  const restoreUser = trpc.admin.restoreUser.useMutation({
    onSuccess: () => {
      toast.success("User restored.");
      void utils.admin.overview.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const userDeletePreview = trpc.admin.userDeletePreview.useQuery(
    { userId: deleteUserTarget?.id ?? 0 },
    { enabled: Boolean(deleteUserTarget?.id) },
  );
  const isBuyer = scope === "buyer";
  const title = isBuyer ? "Buyer management" : "Seller management";
  const description = isBuyer
    ? "Review and manage buyer accounts within your cooperative."
    : "Review and manage seller accounts within your cooperative.";
  const scopedUsers = (overview?.users ?? []).filter(row => row.user.role === scope);
  const visibleUsers = scopedUsers.filter(row =>
    usersFilter === "deleted" ? Boolean(row.user.deletedAt) : !row.user.deletedAt,
  );
  if (overviewQuery.isLoading) return <LoadingWorkspace />;
  if (overviewQuery.error) {
    return (
      <QueryErrorState
        message={overviewQuery.error.message}
        isFetching={overviewQuery.isFetching}
        onRetry={() => void overviewQuery.refetch()}
      />
    );
  }
  return (
    <section className="agri-card overflow-hidden" data-testid={`member-management-${scope}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#264f37]">{title}</h2>
          <p className="mt-1 text-sm text-[#6a796e]">{description} Scope: My cooperative.</p>
          <div className="mt-3 flex gap-2" role="tablist" aria-label="User list filter">
            <button type="button" role="tab" aria-selected={usersFilter === "active"} className={`agri-ghost px-3 py-1.5 text-xs ${usersFilter === "active" ? "bg-[#edf3e9]" : ""}`} onClick={() => setUsersFilter("active")}>Active</button>
            <button type="button" role="tab" aria-selected={usersFilter === "deleted"} className={`agri-ghost px-3 py-1.5 text-xs ${usersFilter === "deleted" ? "bg-[#edf3e9]" : ""}`} onClick={() => setUsersFilter("deleted")}>Deleted</button>
          </div>
        </div>
        <button type="button" className="agri-button min-h-11 text-sm" onClick={() => setAddAccountOpen(true)}>
          Add account
        </button>
      </div>
      <div className="overflow-x-auto border-t border-[#e3e9de]">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-[#f1f6ee] text-xs uppercase tracking-wide text-[#718174]">
            <tr>
              <th className="p-3">User</th>
              <th className="p-3">Role</th>
              <th className="p-3">Cooperative</th>
              <th className="p-3">Approval</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map(row => (
              <AdminUserRow
                key={row.user.id}
                user={row.user}
                cooperativeName={row.cooperativeName}
                cooperatives={overview?.cooperatives ?? []}
                canAssignSuperAdmin={false}
                currentUserId={user?.id}
                currentUserRole={user?.role}
                onSave={values => updateUser.mutate({ userId: row.user.id, ...values })}
                onRequestDelete={target => setDeleteUserTarget({
                  id: target.id,
                  name: target.name,
                  email: target.email,
                  role: target.role,
                  listingCount: 0,
                  openOrderCount: 0,
                })}
                onRestore={userId => restoreUser.mutate({ userId })}
              />
            ))}
          </tbody>
        </table>
        {!visibleUsers.length && (
          <p className="p-8 text-center text-sm text-[#6d7d70]">
            {usersFilter === "deleted" ? "No deleted users." : `No ${scope} accounts are available yet.`}
          </p>
        )}
      </div>
      <AddAccountDialog open={addAccountOpen} onClose={() => setAddAccountOpen(false)} />
      <AlertDialog open={deleteUserTarget != null} onOpenChange={open => { if (!open) setDeleteUserTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteUserTarget?.name || deleteUserTarget?.email || "user"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Role: {deleteUserTarget?.role}. Listings: {userDeletePreview.data?.listingCount ?? "…"}. Open orders: {userDeletePreview.data?.openOrderCount ?? "…"}.
              This soft-deletes the account, bans sign-in, hides their listings, and clears their cart. Orders stay intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#a34838]"
              disabled={softDeleteUser.isPending || !deleteUserTarget}
              onClick={() => {
                if (deleteUserTarget) softDeleteUser.mutate({ userId: deleteUserTarget.id, confirm: true });
              }}
            >
              Confirm delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SystemHealthPanel() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [info, setInfo] = useState<{ status?: string; database?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then(response => response.json())
      .then(data => {
        if (cancelled) return;
        setInfo(data);
        setState("ok");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section className="agri-card p-5 sm:p-6" data-testid="system-health-content">
      <h2 className="font-display text-2xl font-bold text-[#264f37]">System health</h2>
      <p className="mt-1 text-sm text-[#6a796e]">Live status of the application API and database connection.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[#f2f6ef] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">API</p>
          <p className={`mt-1 font-display text-xl font-bold ${state === "error" ? "text-[#a34838]" : "text-[#315640]"}`}>
            {state === "loading" ? "Checking…" : state === "error" ? "Unreachable" : "Operational"}
          </p>
        </div>
        <div className="rounded-xl bg-[#f2f6ef] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Database</p>
          <p className={`mt-1 font-display text-xl font-bold ${state === "error" || info?.database !== "available" ? "text-[#a34838]" : "text-[#315640]"}`}>
            {state === "loading" ? "Checking…" : state === "error" ? "Unknown" : info?.database === "available" ? "Available" : "Degraded"}
          </p>
        </div>
      </div>
      {state === "error" && (
        <p className="mt-4 text-sm text-[#a34838]" role="alert">
          The health endpoint could not be reached. Check the deployment and runtime logs.
        </p>
      )}
    </section>
  );
}

function AdminDashboard() {
  const [sellerMode, setSellerMode] = useState(false);
  const [rejectingProductId, setRejectingProductId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const overviewQuery = trpc.admin.overview.useQuery();
  const { data: overview, isLoading } = overviewQuery;
  const updateUser = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      toast.success("User settings saved.");
      utils.admin.overview.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const reviewProduct = trpc.admin.reviewProduct.useMutation({
    onSuccess: () => {
      toast.success("Product review saved.");
      setRejectingProductId(null);
      setRejectionReason("");
      utils.admin.overview.invalidate();
      utils.marketplace.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const deleteListing = trpc.admin.deleteListing.useMutation({
    onSuccess: () => {
      toast.success("Listing deleted.");
      utils.admin.overview.invalidate();
      utils.marketplace.list.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const hideListing = trpc.admin.hideListing.useMutation({
    onSuccess: () => {
      toast.success("Listing hidden from the marketplace.");
      void utils.admin.overview.invalidate();
      void utils.marketplace.list.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });

  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [usersFilter, setUsersFilter] = useState<"active" | "deleted">("active");
  const [deleteUserTarget, setDeleteUserTarget] = useState<{
    id: number;
    name: string | null;
    email: string | null;
    role: string;
    listingCount: number;
    openOrderCount: number;
  } | null>(null);
  const softDeleteUser = trpc.admin.softDeleteUser.useMutation({
    onSuccess: () => {
      toast.success("User deleted.");
      setDeleteUserTarget(null);
      void utils.admin.overview.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message, USER_FACING_DELETE_USER_ERROR)),
  });
  const restoreUser = trpc.admin.restoreUser.useMutation({
    onSuccess: () => {
      toast.success("User restored.");
      void utils.admin.overview.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });
  const userDeletePreview = trpc.admin.userDeletePreview.useQuery(
    { userId: deleteUserTarget?.id ?? 0 },
    { enabled: Boolean(deleteUserTarget?.id) },
  );
  const search = useSearch();
  const allowedSections = useMemo(
    () => new Set(adminNavForRole(user?.role).map(item => item.section).filter(Boolean) as string[]),
    [user?.role],
  );
  const requestedSection = adminSectionFromSearch(search, user?.role);
  const activeSection = allowedSections.has(requestedSection) ? requestedSection : "overview";
  const [visitedSections, setVisitedSections] = useState<Set<string>>(() => new Set([activeSection]));
  useEffect(() => {
    setVisitedSections(prev => (prev.has(activeSection) ? prev : new Set(prev).add(activeSection)));
  }, [activeSection]);
  if (sellerMode) return <SellerDashboard onExitSellerMode={() => setSellerMode(false)} />;
  if (isLoading) return <LoadingWorkspace />;
  if (overviewQuery.error) {
    return (
      <AdminShell>
        <QueryErrorState
          message={overviewQuery.error.message}
          isFetching={overviewQuery.isFetching}
          onRetry={() => void overviewQuery.refetch()}
        />
      </AdminShell>
    );
  }

  const pendingProducts = overview?.products.filter(product => product.verificationStatus === "pending" && !product.deletedAt) ?? [];
  const managedListings = overview?.products ?? [];
  const openOrders = overview?.orders.filter(order => order.status !== "completed" && order.status !== "cancelled") ?? [];

  const overviewSection = (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button className="agri-ghost text-sm" onClick={() => setSellerMode(true)}>Act as seller</button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label={user?.role === "superadmin" ? "Platform users" : "Cooperative users"} value={String(overview?.users.length || 0)} icon={Users} />
        <Metric label={user?.role === "superadmin" ? "Cooperatives" : "Your cooperative"} value={String(overview?.cooperatives.length || 0)} icon={Store} />
        <Metric label="Product listings" value={String(overview?.products.length || 0)} icon={Package} />
        <Metric label="Transaction records" value={String(overview?.transactions.length || 0)} icon={ClipboardList} />
      </div>
      <section className="flex flex-wrap items-center justify-between gap-4 agri-card p-5 sm:p-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#264f37]">Payments</h2>
          <p className="mt-1 text-sm text-[#6a796e]">Enable methods, manage the AgriCoop QR, and verify receipts in Payment Verification.</p>
        </div>
        <Link href="/dashboard?section=payments" className="agri-button text-sm no-underline">Open Payment Verification</Link>
      </section>
      <AdminProfileVerificationQueue />
      <AdminRefundManagement />
      <AssociationRequestsManager />
      {user?.role === "admin" && <CooperativesAdminPanel canCreateCooperative={false} />}
      {user?.role === "superadmin" && <RoleConflictsPanel />}
    </div>
  );

  const quotationsPanel = (
    <section className="agri-card p-5 sm:p-6" data-testid="admin-quotations-content">
      <h2 className="font-display text-2xl font-bold text-[#264f37]">Quotation requests</h2>
      <p className="mt-1 text-sm text-[#6a796e]">Scope: {user?.role === "admin" ? "My cooperative" : "All cooperatives"}.</p>
      <div className="mt-5 space-y-3">
        {overview?.quotations.map(row => (
          <article key={row.quotation.id} className="rounded-xl bg-[#f2f6ef] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold text-[#315640]">{row.productName}</p>
                <p className="mt-1 text-xs text-[#6d7d70]">
                  {row.quotation.requestedQty} {row.unit} · {row.buyerName || "Buyer"} · Request #{row.quotation.id}
                </p>
              </div>
              <Status value={row.quotation.status}/>
            </div>
            {row.quotation.quotedPriceCents != null && (
              <p className="mt-2 text-sm font-bold text-[#315640]">{peso(row.quotation.quotedPriceCents)} per {row.unit}</p>
            )}
          </article>
        ))}
        {!overview?.quotations.length && <p className="py-5 text-center text-sm text-[#6d7d70]">No quotation requests are recorded for this scope.</p>}
      </div>
    </section>
  );
  const panels: Record<string, ReactNode> = {
            applications: user?.role === "superadmin" ? <OfficerApplicationsPanel /> : null,
            products: (
              <section className="agri-card overflow-hidden" data-testid="admin-moderation-content">
                <div className="p-5 sm:p-6">
                  <h2 className="font-display text-2xl font-bold text-[#264f37]">Product verification queue</h2>
                  <p className="mt-1 text-sm text-[#6a796e]">Scope: {user?.role === "admin" ? "My cooperative" : "All cooperatives"}. Approve Seller submissions before buyer visibility is enabled.</p>
                </div>
                <div className="grid gap-3 border-t border-[#e3e9de] p-5 sm:grid-cols-2 lg:grid-cols-3">
                  {pendingProducts.map(product => (
                    <div key={product.id} className="rounded-2xl border border-[#e2e9dd] p-4">
                      <p className="font-display text-xl font-bold text-[#28523a]">{product.name}</p>
                      <p className="mt-1 text-xs text-[#6d7d70]">{product.category} · {peso(product.priceCents)} / {product.unit}</p>
                      <div className="mt-4 flex gap-2">
                        <button className="agri-button px-3 py-2 text-xs" onClick={() => reviewProduct.mutate({ productId: product.id, decision: "approved" })}>Approve</button>
                        <button className="agri-ghost px-3 py-2 text-xs text-[#a34838]" onClick={() => { setRejectingProductId(product.id); setRejectionReason(""); }}>Reject</button>
                      </div>
                      {rejectingProductId === product.id && (
                        <form
                          onSubmit={event => {
                            event.preventDefault();
                            const reason = rejectionReason.trim();
                            if (reason) reviewProduct.mutate({ productId: product.id, decision: "rejected", rejectionReason: reason });
                          }}
                          className="mt-4 space-y-3"
                        >
                          <label className="field-label">Rejection reason<textarea required maxLength={600} className="field-control min-h-20" value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} /></label>
                          <div className="flex gap-2">
                            <button className="agri-button px-3 py-2 text-xs" disabled={reviewProduct.isPending || !rejectionReason.trim()}>Submit rejection</button>
                            <button type="button" className="agri-ghost px-3 py-2 text-xs" onClick={() => setRejectingProductId(null)}>Keep in queue</button>
                          </div>
                        </form>
                      )}
                    </div>
                  ))}
                  {!pendingProducts.length && <p className="col-span-full py-6 text-center text-sm text-[#6d7d70]">No products are waiting for review.</p>}
                </div>
                <div className="border-t border-[#e3e9de] p-5 sm:p-6">
                  <h3 className="font-display text-xl font-bold text-[#264f37]">All listings</h3>
                  <p className="mt-1 text-sm text-[#6a796e]">All listing statuses in {user?.role === "admin" ? "My cooperative" : "the platform"} are shown here. Listings can be hidden from buyers or soft-deleted.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {managedListings.map(product => (
                      <div key={`manage-${product.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-[#e2e9dd] p-4">
                        <div>
                          <p className="font-bold text-[#315640]">{product.name}</p>
                          <p className="text-xs text-[#6d7d70]">{formatCombinedEnumLabels(product.status, product.verificationStatus)} · {product.deletedAt ? "Deleted" : formatEnumLabel(product.visibility)}</p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          {!product.deletedAt && product.visibility !== "hidden" && (
                            <button
                              type="button"
                              className="agri-ghost px-2 py-1 text-xs"
                              disabled={hideListing.isPending}
                              onClick={() => hideListing.mutate({ productId: product.id })}
                            >
                              Hide
                            </button>
                          )}
                          {product.deletedAt ? (
                            <span className="text-xs font-bold text-[#6d7d70]">Deleted</span>
                          ) : (
                            <button
                              type="button"
                              className="text-xs font-bold text-[#a34838]"
                              disabled={deleteListing.isPending}
                              onClick={() => {
                                if (window.confirm(`Delete “${product.name}”?`)) deleteListing.mutate({ productId: product.id });
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!managedListings.length && <p className="col-span-full py-4 text-center text-sm text-[#6d7d70]">No listings to manage.</p>}
                  </div>
                </div>
              </section>
            ),
            payments: <AdminSystemPaymentsPanel />,
            orders: (
              <div className="space-y-6">
                <AdminOrdersPanel />
                {quotationsPanel}
              </div>
            ),
            quotations: quotationsPanel,
            users: (
              <section className="grid gap-8" data-testid="admin-users-content">
                <div className="agri-card overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
                    <div>
                      <h2 className="font-display text-2xl font-bold text-[#264f37]">Users and roles</h2>
                      <p className="mt-1 text-sm text-[#6a796e]">Apply role, approval, and cooperative assignment controls across the platform.</p>
                      <div className="mt-3 flex gap-2" role="tablist" aria-label="User list filter">
                        <button type="button" role="tab" aria-selected={usersFilter === "active"} className={`agri-ghost px-3 py-1.5 text-xs ${usersFilter === "active" ? "bg-[#edf3e9]" : ""}`} onClick={() => setUsersFilter("active")}>Active</button>
                        <button type="button" role="tab" aria-selected={usersFilter === "deleted"} className={`agri-ghost px-3 py-1.5 text-xs ${usersFilter === "deleted" ? "bg-[#edf3e9]" : ""}`} onClick={() => setUsersFilter("deleted")}>Deleted</button>
                      </div>
                    </div>
                    {(user?.role === "admin" || user?.role === "superadmin") && (
                      <button type="button" className="agri-button min-h-11 text-sm" onClick={() => setAddAccountOpen(true)}>
                        Add account
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto border-t border-[#e3e9de]">
                    <table className="w-full min-w-[860px] text-left text-sm">
                      <thead className="bg-[#f1f6ee] text-xs uppercase tracking-wide text-[#718174]">
                        <tr>
                          <th className="p-3">User</th>
                          <th className="p-3">Role</th>
                          <th className="p-3">Cooperative</th>
                          <th className="p-3">Approval</th>
                          <th className="p-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {overview?.users
                          .filter(row => usersFilter === "deleted" ? Boolean(row.user.deletedAt) : !row.user.deletedAt)
                          .map(row => (
                          <AdminUserRow
                            key={row.user.id}
                            user={row.user}
                            cooperativeName={row.cooperativeName}
                            cooperatives={overview.cooperatives}
                            canAssignSuperAdmin={user?.role === "superadmin"}
                            currentUserId={user?.id}
                            currentUserRole={user?.role}
                            onSave={values => updateUser.mutate({ userId: row.user.id, ...values })}
                            onRequestDelete={target => setDeleteUserTarget({
                              id: target.id,
                              name: target.name,
                              email: target.email,
                              role: target.role,
                              listingCount: 0,
                              openOrderCount: 0,
                            })}
                            onRestore={userId => restoreUser.mutate({ userId })}
                          />
                        ))}
                      </tbody>
                    </table>
                    {!overview?.users.filter(row => usersFilter === "deleted" ? Boolean(row.user.deletedAt) : !row.user.deletedAt).length && (
                      <p className="p-8 text-center text-sm text-[#6d7d70]">
                        {usersFilter === "deleted" ? "No deleted users." : "No user accounts are available yet."}
                      </p>
                    )}
                  </div>
                </div>
                {(user?.role === "admin" || user?.role === "superadmin") && (
                  <CooperativesAdminPanel canCreateCooperative={user.role === "superadmin"} />
                )}
                <AlertDialog open={deleteUserTarget != null} onOpenChange={open => { if (!open) setDeleteUserTarget(null); }}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {deleteUserTarget?.name || deleteUserTarget?.email || "user"}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Role: {deleteUserTarget?.role}. Listings: {userDeletePreview.data?.listingCount ?? "…"}. Open orders: {userDeletePreview.data?.openOrderCount ?? "…"}.
                        This soft-deletes the account, bans sign-in, hides their listings, and clears their cart. Orders stay intact.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-[#a34838]"
                        disabled={softDeleteUser.isPending || !deleteUserTarget}
                        onClick={() => {
                          if (deleteUserTarget) softDeleteUser.mutate({ userId: deleteUserTarget.id, confirm: true });
                        }}
                      >
                        Confirm delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </section>
            ),
          };

  const sectionViews: Record<string, ReactNode> = {
    overview: overviewSection,
    buyers: <MemberManagementPanel scope="buyer" />,
    sellers: <MemberManagementPanel scope="seller" />,
    users: panels.users,
    orders: <div className="space-y-6">{panels.orders}{panels.quotations}</div>,
    payments: user?.role === "superadmin" ? panels.payments : <AdminPaymentReviewQueue />,
    products: panels.products,
    applications: panels.applications,
    cooperatives: <CooperativesAdminPanel canCreateCooperative={user?.role === "superadmin"} />,
    settings: <AdminSystemPaymentsPanel />,
    health: <SystemHealthPanel />,
  };

  return (
    <AdminShell>
      <div className="space-y-6">
        {Array.from(visitedSections).map(sectionKey => {
          const view = sectionViews[sectionKey];
          if (view == null) return null;
          return (
            <div key={sectionKey} hidden={sectionKey !== activeSection} data-section={sectionKey}>
              {view}
            </div>
          );
        })}
        <AddAccountDialog open={addAccountOpen} onClose={() => setAddAccountOpen(false)} />
      </div>
    </AdminShell>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  // AdminDashboard is coop-scoped for officers via admin.overview; SuperAdmin sees platform-wide queues.
  // OfficerDashboard remains available as a lighter member-focused view if we split routes later.
  return <AuthGate>{user?.role === "admin" || user?.role === "superadmin" ? <AdminDashboard/> : user?.role === "seller" ? <SellerVerificationWorkspace/> : user?.role === "buyer" ? <BuyerDashboard/> : <Onboarding/>}</AuthGate>;
}
