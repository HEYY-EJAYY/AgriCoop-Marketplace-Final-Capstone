import { PageFrame, shellContainerClass } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import {
  groupCartItemsBySeller,
  type CheckoutCartItem,
} from "../../../shared/checkoutCart";
import { getAccountAccessRestriction } from "../../../shared/accountAccess";
import { useBuyerCart } from "@/hooks/useBuyerCart";
import {
  fulfillmentLabel,
  fulfillmentOptionsForListings,
  methodsForListings,
  paymentMethodsForFulfillment,
  paymentMethodAvailability,
  PAYMENT_METHODS,
  PAYMENT_METHOD_HELPERS,
  paymentMethodLabel,
  QR_ISSUE_REASONS,
  qrIssueReasonLabel,
  qrPaymentProviderLabel,
  type FulfillmentMethod,
  type PaymentMethod,
  type QrIssueReason,
  type SystemPaymentAvailability,
} from "../../../shared/paymentMethods";
import {
  PAYMENT_PROOF_BUCKET,
  PAYMENT_PROOF_CONTENT_TYPES,
  PAYMENT_PROOF_MAX_BYTES,
} from "../../../shared/paymentProofs";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { cooperativePickupAddressLine, hasStructuredPickupAddress, isPickupAddressComplete } from "@shared/pickupAddress";
import {
  DELIVERY_MIN_WEIGHT_GRAMS,
  formatWeightKg,
  orderWeightGrams,
} from "../../../shared/orderWeight";
import { ArrowLeft, Copy, Flag, Loader2, QrCode, ShoppingBag, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

type SellerGroupChoice = {
  paymentMethod: PaymentMethod;
  fulfillmentMethod: FulfillmentMethod;
  receiptUploadIntent?: string;
  paymentOptionId?: number;
};

type CheckoutOnlineDetails = {
  qrImageUrl: string;
  accountName: string;
  accountNumber: string;
  label: string;
  instructions?: string | null;
};

const checkoutAvailabilityFallback: SystemPaymentAvailability = {
  cashPickupEnabled: true,
  cashDeliveryEnabled: true,
  onlineEnabled: false,
  onlineAccountReady: false,
};

const peso = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

function checkoutMethodLabel(method: PaymentMethod) {
  return paymentMethodLabel(method);
}

function listingFlags(items: CheckoutCartItem[]) {
  return items.map(item => ({
    allowsPickup: item.allowsPickup ?? true,
    allowsDelivery: item.allowsDelivery ?? true,
    acceptsOnlinePayment: item.acceptsOnlinePayment ?? false,
    onlinePaymentEnabled: item.onlinePaymentEnabled !== false,
  }));
}

/**
 * Reason Delivery is unavailable for this seller group despite the listings
 * supporting it — null when weight rules allow delivery (or delivery isn't
 * offered at all). Mirrors the server-side check in orders.create.
 */
function deliveryWeightBlockReason(items: CheckoutCartItem[]): string | null {
  const base = fulfillmentOptionsForListings(listingFlags(items));
  if (!base.includes("delivery")) return null;
  const weight = orderWeightGrams(items);
  if (weight.unknownUnits.length > 0) {
    return `Delivery is unavailable because the weight of items sold by ${weight.unknownUnits.join(", ")} cannot be determined.`;
  }
  if (weight.totalGrams < DELIVERY_MIN_WEIGHT_GRAMS) {
    const remainingGrams = DELIVERY_MIN_WEIGHT_GRAMS - weight.totalGrams;
    return `Minimum order weight for Delivery is 20 kg. Your current order weighs ${formatWeightKg(weight.totalGrams)}. Add ${formatWeightKg(remainingGrams)} more to qualify for Delivery, or choose Pickup.`;
  }
  return null;
}

function fulfillmentOptionsForCart(items: CheckoutCartItem[]): FulfillmentMethod[] {
  const base = fulfillmentOptionsForListings(listingFlags(items));
  if (deliveryWeightBlockReason(items)) return base.filter(option => option !== "delivery");
  return base;
}

function SellerCheckoutGroup({
  sellerId,
  sellerName,
  items,
  choice,
  onChoiceChange,
  availability,
  onlineDetails,
  onlineLoading,
}: {
  sellerId: number;
  sellerName: string;
  items: CheckoutCartItem[];
  choice: SellerGroupChoice;
  onChoiceChange: (next: SellerGroupChoice) => void;
  availability: SystemPaymentAvailability;
  onlineDetails?: CheckoutOnlineDetails | null;
  onlineLoading: boolean;
}) {
  const flags = useMemo(() => listingFlags(items), [items]);
  const methods = useMemo(() => methodsForListings(flags, availability), [flags, availability]);
  const deliveryBlockedReason = useMemo(() => deliveryWeightBlockReason(items), [items]);
  const fulfillmentOptions = useMemo(() => fulfillmentOptionsForCart(items), [items]);
  const pickerOptions = useMemo(() => fulfillmentOptionsForListings(flags), [flags]);
  const groupTotal = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  const cooperativeId = items[0]?.cooperativeId ?? null;
  const cooperativeName = items[0]?.cooperativeName ?? null;
  const productIds = useMemo(() => items.map(item => item.productId), [items]);
  const qrOptionsQuery = trpc.adminPayment.checkoutOptions.useQuery(
    { cooperativeId, productIds },
    { enabled: choice.paymentMethod === "online" },
  );
  const qrOptions = qrOptionsQuery.data ?? [];
  const selectedQrOption = qrOptions.find(option => option.id === choice.paymentOptionId) ?? null;
  const utils = trpc.useUtils();
  const [qrNotice, setQrNotice] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<QrIssueReason>("cannot_scan");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSentFor, setReportSentFor] = useState<number | null>(null);
  const reportIssue = trpc.adminPayment.reportIssue.useMutation();

  useEffect(() => {
    if (choice.paymentMethod !== "online" || qrOptionsQuery.isLoading || qrOptionsQuery.isError) return;
    if (!qrOptions.length) return;
    if (choice.paymentOptionId !== undefined && qrOptions.some(option => option.id === choice.paymentOptionId)) return;
    if (choice.paymentOptionId !== undefined) {
      setQrNotice("The QR code you selected is no longer available, so another available QR code was selected instead.");
      onChoiceChange({ ...choice, paymentOptionId: undefined });
      return;
    }
    onChoiceChange({ ...choice, paymentOptionId: qrOptions[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice.paymentMethod, choice.paymentOptionId, qrOptions, qrOptionsQuery.isLoading, qrOptionsQuery.isError, onChoiceChange]);

  const submitQrReport = async () => {
    if (!selectedQrOption || reportIssue.isPending) return;
    try {
      await reportIssue.mutateAsync({
        paymentOptionId: selectedQrOption.id,
        reason: reportReason,
        details: reportDetails.trim() || undefined,
      });
      setReportOpen(false);
      setReportDetails("");
      setReportSentFor(selectedQrOption.id);
      // The reported QR is deactivated server-side; refresh so it disappears
      // from this and every other buyer's checkout for the cooperative.
      void utils.adminPayment.checkoutOptions.invalidate();
      toast.success("Your QR report was sent to the cooperative administrators. This QR is now hidden until it is reviewed.");
    } catch (problem) {
      toast.error(toUserFacingErrorMessage(problem instanceof Error ? problem.message : "Could not send the report."));
    }
  };

  const canUploadReceipt = true;
  const uploadReceipt = trpc.payments.uploadCheckoutReceipt.useMutation();
  const finalizeReceipt = trpc.payments.finalizeCheckoutReceipt.useMutation();

  useEffect(() => {
    if (!receiptFile) {
      setReceiptPreview(null);
      return;
    }
    const url = URL.createObjectURL(receiptFile);
    setReceiptPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [receiptFile]);

  const compatibleMethods = useMemo(
    () => paymentMethodsForFulfillment(methods, choice.fulfillmentMethod),
    [methods, choice.fulfillmentMethod],
  );

  useEffect(() => {
    const fulfillmentMethod = fulfillmentOptions.includes(choice.fulfillmentMethod)
      ? choice.fulfillmentMethod
      : fulfillmentOptions[0] ?? "pickup";
    const options = paymentMethodsForFulfillment(methods, fulfillmentMethod);
    const paymentMethod = options.includes(choice.paymentMethod)
      ? choice.paymentMethod
      : options[0] ?? methods[0] ?? "cash_pickup";
    if (fulfillmentMethod !== choice.fulfillmentMethod || paymentMethod !== choice.paymentMethod) {
      onChoiceChange({
        paymentMethod,
        fulfillmentMethod,
        receiptUploadIntent: paymentMethod === "online" ? choice.receiptUploadIntent : undefined,
      });
    }
  }, [methods, choice.paymentMethod, choice.fulfillmentMethod, choice.receiptUploadIntent, fulfillmentOptions, onChoiceChange]);

  const setFulfillmentMethod = (fulfillmentMethod: FulfillmentMethod) => {
    const options = paymentMethodsForFulfillment(methods, fulfillmentMethod);
    const paymentMethod = options.includes(choice.paymentMethod)
      ? choice.paymentMethod
      : options[0] ?? choice.paymentMethod;
    onChoiceChange({
      paymentMethod,
      fulfillmentMethod,
      receiptUploadIntent: paymentMethod === "online" ? choice.receiptUploadIntent : undefined,
    });
    if (paymentMethod !== "online") {
      setReceiptFile(null);
      setReceiptError("");
    }
  };

  const setPaymentMethod = (paymentMethod: PaymentMethod) => {
    const fulfillmentMethod =
      paymentMethod === "cash_pickup"
        ? "pickup"
        : paymentMethod === "cash_delivery"
          ? "delivery"
          : choice.fulfillmentMethod;
    onChoiceChange({
      paymentMethod,
      fulfillmentMethod,
      receiptUploadIntent: paymentMethod === "online" ? choice.receiptUploadIntent : undefined,
    });
    if (paymentMethod !== "online") {
      setReceiptFile(null);
      setReceiptError("");
    }
  };

  const uploadReceiptFile = async (file: File) => {
    if (!canUploadReceipt || !uploadReceipt || !finalizeReceipt) {
      toast.error("Checkout receipt upload is not available yet. Try again after the app is updated.");
      return;
    }
  setReceiptBusy(true);
    setReceiptError("");
    try {
      const authorization = await uploadReceipt.mutateAsync({
        sellerId,
        fileName: file.name,
        contentType: file.type as (typeof PAYMENT_PROOF_CONTENT_TYPES)[number],
        fileSizeBytes: file.size,
      });
      const { error } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .uploadToSignedUrl(authorization.storagePath, authorization.uploadToken, file, { contentType: file.type });
      if (error) throw new Error(error.message);
      const finalized = await finalizeReceipt.mutateAsync({
        sellerId,
        uploadIntent: authorization.uploadIntent,
      });
      onChoiceChange({ ...choice, receiptUploadIntent: finalized.receiptUploadIntent });
      toast.success("Receipt uploaded for this seller group.");
    } catch (problem) {
      const message = toUserFacingErrorMessage(problem instanceof Error ? problem.message : "Upload failed.");
      setReceiptError(message);
      toast.error(message);
      onChoiceChange({ ...choice, receiptUploadIntent: undefined });
    } finally {
      setReceiptBusy(false);
    }
  };

  const onPickReceipt = (file: File | null) => {
    if (!file) return;
    if (
      !PAYMENT_PROOF_CONTENT_TYPES.includes(file.type as (typeof PAYMENT_PROOF_CONTENT_TYPES)[number])
      || file.size > PAYMENT_PROOF_MAX_BYTES
    ) {
      setReceiptError("Choose a JPEG, PNG, or WebP receipt up to 5 MiB.");
      setReceiptFile(null);
      onChoiceChange({ ...choice, receiptUploadIntent: undefined });
      return;
    }
    setReceiptError("");
    setReceiptFile(file);
    void uploadReceiptFile(file);
  };

  const copyAmount = async () => {
    try {
      await navigator.clipboard.writeText((groupTotal / 100).toFixed(2));
      toast.success("Amount copied.");
    } catch {
      toast.error("Could not copy amount.");
    }
  };

  const showOnline = choice.paymentMethod === "online";
  const displayQr = selectedQrOption
    ? {
        qrImageUrl: selectedQrOption.qrImageUrl,
        label: `${qrPaymentProviderLabel(selectedQrOption.paymentMethod)} — ${selectedQrOption.methodName}`,
        accountName: selectedQrOption.accountName ?? "",
        accountNumber: selectedQrOption.accountNumber ?? "",
        instructions: selectedQrOption.instructions,
      }
    : onlineDetails
      ? { ...onlineDetails, label: `AgriCoop platform payment account — ${onlineDetails.accountName || onlineDetails.label || "online payment"}` }
      : null;

  return (
    <section className="rounded-2xl border border-[#e1e9dd] bg-[#f7faf4] p-4 sm:p-5">
      <h3 className="font-display text-xl font-bold text-[#264f37]">{sellerName}</h3>
      {cooperativeName && (
        <p className="mt-0.5 text-xs font-bold text-[#5f7a5f]">Sold by {cooperativeName}</p>
      )}
      <p className="mt-1 text-xs text-[#6d7d70]">
        {items.length} listing{items.length === 1 ? "" : "s"} · {peso(groupTotal)}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-[#526858]">
        {items.map(item => (
          <li key={item.productId} className="flex justify-between gap-2 border-b border-[#edf0e9] pb-2">
            <span>
              {item.name} × {item.quantity} {item.unit}
            </span>
            <span className="font-bold text-[#315640]">{peso(item.priceCents * item.quantity)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5">
        <FulfillmentPicker
          name={`fulfillment-${sellerId}`}
          options={pickerOptions}
          value={choice.fulfillmentMethod}
          onChange={setFulfillmentMethod}
          deliveryBlockedReason={deliveryBlockedReason}
        />
      </div>

      {cooperativeId !== null && (
        <PickupLocationCard
          cooperativeId={cooperativeId}
          cooperativeName={cooperativeName}
          fulfillmentMethod={choice.fulfillmentMethod}
        />
      )}

      <div className="mt-5">
        <fieldset className="min-w-0">
          <legend className="text-xs font-extrabold uppercase tracking-wide text-[#638947]">Payment</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {PAYMENT_METHODS.filter(method => compatibleMethods.includes(method)).map(method => {
            const methodAvailability = paymentMethodAvailability(method, flags, availability);
            const reasonId = `payment-${sellerId}-${method}-reason`;
            return (
              <label
                key={method}
                className={`rounded-xl border p-3 text-sm font-bold ${
                  methodAvailability.available ? "cursor-pointer" : "cursor-not-allowed opacity-70"
                } ${
                  choice.paymentMethod === method
                    ? "border-[#5d8a5e] bg-[#edf4e9] text-[#315640]"
                    : "border-[#e3e9de] bg-white text-[#66766b]"
                }`}
              >
                <input
                  type="radio"
                  name={`payment-${sellerId}`}
                  className="mr-2 accent-[#4e8257]"
                  checked={choice.paymentMethod === method}
                  disabled={!methodAvailability.available}
                  aria-describedby={methodAvailability.reason ? reasonId : undefined}
                  onChange={() => setPaymentMethod(method)}
                />
                {checkoutMethodLabel(method)}
                {methodAvailability.reason && (
                  <span id={reasonId} className="mt-1 block text-xs font-normal leading-5">
                    {methodAvailability.reason}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {choice.paymentMethod && (
          <p className="mt-2 text-xs leading-5 text-[#4d6854]">{PAYMENT_METHOD_HELPERS[choice.paymentMethod]}</p>
        )}
        </fieldset>
      </div>

      {showOnline && (
        <div className="mt-5 rounded-2xl border border-[#dfe8db] bg-white p-4">
          <h4 className="font-bold text-[#315640]">Pay via AgriCoop QR</h4>
          <p className="mt-1 text-xs text-[#66766b]">A cooperative officer verifies the receipt before the seller fulfills the order.</p>
          <p className="mt-1 text-xs font-semibold text-[#4d6854]">
            Fulfillment: {fulfillmentLabel(choice.fulfillmentMethod)} — the seller and officer see this on the order.
          </p>
          {qrOptionsQuery.isLoading || onlineLoading ? (
            <Loader2 className="mt-4 animate-spin text-[#4e8257]" />
          ) : (
            <>
              {qrOptions.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-[#638947]">Choose a payment QR</p>
                  {qrNotice && <p role="alert" className="mt-2 text-xs font-semibold text-[#8c574c]">{qrNotice}</p>}
                  <div className="mt-2 grid gap-2">
                    {qrOptions.map(option => {
                      const selected = selectedQrOption?.id === option.id;
                      return (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${
                            selected ? "border-[#5d8a5e] bg-[#edf4e9] text-[#315640]" : "border-[#e3e9de] bg-white text-[#66766b]"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`qr-${sellerId}`}
                            className="mt-1 accent-[#4e8257]"
                            checked={selected}
                            onChange={() => {
                              setQrNotice(null);
                              setReportOpen(false);
                              onChoiceChange({ ...choice, paymentOptionId: option.id });
                            }}
                          />
                          <span className="min-w-0">
                            <span className="block font-bold">
                              {qrPaymentProviderLabel(option.paymentMethod)} — {option.methodName}
                            </span>
                            {(option.accountName || option.accountNumber) && (
                              <span className="mt-0.5 block text-xs font-normal text-[#6d7d70]">
                                {[option.accountName, option.accountNumber].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {!qrOptionsQuery.isLoading && qrOptions.length === 0 && (
                <p className="mt-3 rounded-lg bg-[#fdf3e7] p-3 text-xs font-semibold text-[#8c5a2b]">
                  {cooperativeName ?? "This cooperative"} has not published a QR payment code yet.
                  The AgriCoop platform payment account is shown below — the cooperative will still verify your receipt.
                  You can also choose Cash on Pickup or Cash on Delivery above.
                </p>
              )}
              {qrOptions.length > 0 && !selectedQrOption ? (
                <p className="mt-3 text-xs font-semibold text-[#8c574c]">Select a payment QR code above to continue.</p>
              ) : displayQr ? (
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
                  {displayQr.qrImageUrl ? (
                    <img
                      src={displayQr.qrImageUrl}
                      alt="AgriCoop payment QR"
                      className="h-32 w-32 shrink-0 rounded-lg border border-[#e2e8de] bg-white object-contain"
                    />
                  ) : (
                    <div className="grid h-32 w-32 shrink-0 place-items-center rounded-lg bg-[#f0f5ed] text-[#82987a]">
                      <QrCode />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    {displayQr.instructions && (
                      <p className="text-xs leading-5 text-[#4d6854]">{displayQr.instructions}</p>
                    )}
                    <p className="text-sm font-bold text-[#315640]">
                      {displayQr.label || displayQr.accountName || "Online payment"}
                    </p>
                    {displayQr.accountNumber && (
                      <p className="text-xs text-[#68796d]">
                        {displayQr.accountName ? `${displayQr.accountName} · ` : ""}
                        {displayQr.accountNumber}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
              {selectedQrOption && reportSentFor === selectedQrOption.id && !reportOpen && (
                <p className="mt-3 rounded-lg bg-[#e6f3e5] p-3 text-xs font-semibold text-[#2f5c39]">
                  Thank you. Your report has been sent to the cooperative administrators for review. This QR code is now hidden until it is re-enabled — another available QR code was selected automatically.
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold text-[#1d5639]">{peso(groupTotal)}</span>
                <button type="button" className="agri-ghost px-2 py-1 text-xs" onClick={() => void copyAmount()}>
                  <Copy size={14} /> Copy amount
                </button>
                {selectedQrOption && (
                  <button
                    type="button"
                    className="agri-ghost px-2 py-1 text-xs text-[#a34838]"
                    onClick={() => { setReportOpen(value => !value); setReportSentFor(null); }}
                  >
                    <Flag size={13} className="mr-1 inline" /> QR Code Not Working? Report This QR
                  </button>
                )}
              </div>
              {selectedQrOption && reportOpen && (
                <div className="mt-3 rounded-xl border border-[#eadfd2] bg-[#fdf8f2] p-3">
                  <label className="field-label text-xs">What is wrong with this QR code?
                    <select className="field-control" value={reportReason} onChange={event => setReportReason(event.target.value as QrIssueReason)}>
                      {QR_ISSUE_REASONS.map(reason => <option key={reason} value={reason}>{qrIssueReasonLabel(reason)}</option>)}
                    </select>
                  </label>
                  <label className="field-label mt-3 text-xs">Additional details (optional)
                    <textarea maxLength={1000} className="field-control" value={reportDetails} onChange={event => setReportDetails(event.target.value)} />
                  </label>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <button type="button" className="agri-ghost text-sm" onClick={() => setReportOpen(false)}>Cancel</button>
                    <button type="button" className="agri-button text-sm" disabled={reportIssue.isPending} onClick={() => void submitQrReport()}>
                      {reportIssue.isPending ? <Loader2 className="animate-spin" size={14} /> : <Flag size={14} />} Send report
                    </button>
                  </div>
                </div>
              )}
              <label className="field-label mt-4">
                Payment receipt (required)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="field-control"
                  disabled={receiptBusy || !canUploadReceipt}
                  onChange={e => onPickReceipt(e.target.files?.[0] ?? null)}
                />
              </label>
              {!canUploadReceipt && (
                <p role="alert" className="mt-2 text-xs text-[#a34838]">
                  Receipt upload will be available once checkout payment procedures are deployed.
                </p>
              )}
              {receiptError && (
                <p role="alert" className="mt-2 text-xs text-[#a34838]">
                  {receiptError}
                </p>
              )}
              {choice.receiptUploadIntent && (
                <p className="mt-2 text-xs font-bold text-[#387047]">Receipt ready for order placement.</p>
              )}
              {receiptPreview && (
                <img
                  src={receiptPreview}
                  alt="Receipt preview"
                  className="mt-3 max-h-48 rounded-lg border border-[#e3e9de] object-contain"
                />
              )}
              {(receiptBusy || uploadReceipt?.isPending || finalizeReceipt?.isPending) && (
                <p className="mt-2 text-xs text-[#66766b]">
                  <Loader2 className="mr-1 inline animate-spin" size={14} />
                  Uploading receipt…
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

const FULFILLMENT_COPY: Record<FulfillmentMethod, { title: string; body: string }> = {
  pickup: { title: "Pickup", body: "You collect the order yourself." },
  delivery: { title: "Delivery", body: "The order is delivered to your address." },
};

function FulfillmentPicker({
  name,
  options,
  value,
  onChange,
  deliveryBlockedReason,
}: {
  name: string;
  options: FulfillmentMethod[];
  value: FulfillmentMethod;
  onChange: (value: FulfillmentMethod) => void;
  deliveryBlockedReason?: string | null;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-extrabold uppercase tracking-wide text-[#638947]">Fulfillment</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map(option => {
          const copy = FULFILLMENT_COPY[option];
          const selected = value === option;
          const blocked = option === "delivery" && Boolean(deliveryBlockedReason);
          return (
            <label
              key={option}
              className={`flex min-h-11 items-start gap-3 rounded-xl border p-3 text-sm font-bold ${
                blocked
                  ? "cursor-not-allowed border-[#e3e9de] bg-[#f4f4f1] text-[#9aa49b]"
                  : selected
                    ? "cursor-pointer border-[#5d8a5e] bg-[#edf4e9] text-[#315640]"
                    : "cursor-pointer border-[#e3e9de] bg-white text-[#66766b]"
              }`}
            >
              <input
                type="radio"
                name={name}
                className="mt-1 accent-[#4e8257]"
                checked={selected}
                disabled={blocked}
                onChange={() => onChange(option)}
              />
              <span>
                {copy.title}
                <span className="mt-0.5 block text-xs font-normal leading-5 text-[#6d7d70]">{copy.body}</span>
              </span>
            </label>
          );
        })}
      </div>
      {deliveryBlockedReason && (
        <p className="mt-2 text-xs leading-5 text-[#8c574c]" role="alert">{deliveryBlockedReason}</p>
      )}
    </fieldset>
  );
}

function PickupLocationCard({
  cooperativeId,
  cooperativeName,
  fulfillmentMethod,
}: {
  cooperativeId: number;
  cooperativeName: string | null;
  fulfillmentMethod: FulfillmentMethod;
}) {
  const query = trpc.cooperatives.pickupInfo.useQuery(
    { cooperativeId },
    { enabled: fulfillmentMethod === "pickup" },
  );
  if (fulfillmentMethod !== "pickup") return null;
  const info = query.data ?? null;
  const pickupAddressLine = info ? cooperativePickupAddressLine(info) : "";
  const pickupAddressComplete = info ? isPickupAddressComplete(info) : false;
  return (
    <div className="mt-4 rounded-xl border border-[#e2e9dd] bg-white p-4">
      <h4 className="text-xs font-extrabold uppercase tracking-wide text-[#638947]">Pickup location</h4>
      {query.isLoading ? (
        <Loader2 className="mt-3 animate-spin text-[#4e8257]" size={18} />
      ) : !info ? (
        <p className="mt-2 text-sm text-[#8c574c]">
          Pickup information is unavailable for this cooperative right now. Please contact the cooperative through AgriCoop Messages before choosing pickup.
        </p>
      ) : (
        <div className="mt-2 space-y-1 text-sm text-[#45614e]">
          <p className="font-bold text-[#315640]">Pickup from {info.name}</p>
          <p>{pickupAddressLine || "The cooperative has not added a pickup address yet."}</p>
          {pickupAddressComplete ? null : (
            <p className="text-xs font-semibold text-[#8c574c]">
              {info.address || hasStructuredPickupAddress(info)
                ? "This cooperative's pickup address is incomplete. Confirm the exact pickup point with " + info.name + " before pickup."
                : "This cooperative has not configured a detailed pickup address. Confirm the exact pickup point with " + info.name + " before pickup."}
            </p>
          )}
          {info.pickupContactNumber && <p>Contact: {info.pickupContactNumber}</p>}
          {info.pickupInstructions && <p>Pickup instructions: {info.pickupInstructions}</p>}
          {info.operatingHours && <p>Hours: {info.operatingHours}</p>}
          {!info.address && !info.pickupContactNumber && (
            <p className="text-xs text-[#6d7d70]">
              You can also reach the cooperative through AgriCoop Messages.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Checkout() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const { items: cartItems, isCartLoading, remove: removeCartItem } = useBuyerCart();
  const cart = useMemo(
    () => (cartItems.length ? { items: cartItems as CheckoutCartItem[] } : null),
    [cartItems],
  );
  const sellerMap = useMemo(() => (cart ? groupCartItemsBySeller(cart.items) : new Map()), [cart]);

  const availabilityQuery = trpc.systemPayment.getAvailability.useQuery(undefined, {
    enabled: Boolean(user && (user.role === "buyer" || user.role === "seller")),
  });
  const availability = availabilityQuery.data ?? checkoutAvailabilityFallback;
  const onlineDetailsQuery = trpc.systemPayment.getCheckoutOnlineDetails.useQuery(undefined, {
    enabled: Boolean(user?.role === "buyer" && availability.onlineEnabled && availability.onlineAccountReady),
    retry: false,
  });

  const initialChoices = useMemo(() => {
    const map = new Map<number, SellerGroupChoice>();
    Array.from(sellerMap.entries()).forEach(([sellerId, items]) => {
      const flags = listingFlags(items);
      const fulfillmentOptions = fulfillmentOptionsForCart(items);
      const fulfillmentMethod = fulfillmentOptions[0] ?? "pickup";
      const methods = paymentMethodsForFulfillment(methodsForListings(flags, availability), fulfillmentMethod);
      const paymentMethod = methods[0] ?? "cash_pickup";
      map.set(sellerId, { paymentMethod, fulfillmentMethod });
    });
    return map;
  }, [sellerMap, availability]);

  const [choices, setChoices] = useState<Map<number, SellerGroupChoice>>(initialChoices);
  const [delivery, setDelivery] = useState({
    recipientName: "",
    contactNumber: "",
    province: "",
    city: "",
    barangay: "",
    streetAddress: "",
    instructions: "",
  });

  useEffect(() => {
    setChoices(initialChoices);
  }, [initialChoices]);

  const utils = trpc.useUtils();
  const createOrder = trpc.orders.create.useMutation();
  const [submitting, setSubmitting] = useState(false);

  const totalCents = cart?.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0) ?? 0;
  const accessRestriction = user ? getAccountAccessRestriction(user) : null;
  const roleCanOrder = Boolean(user && (user.role === "buyer" || user.role === "seller") && !accessRestriction);

  const allOnlineHaveReceipt = useMemo(() => {
    return Array.from(choices.values()).every(
      choice => choice.paymentMethod !== "online" || Boolean(choice.receiptUploadIntent),
    );
  }, [choices]);

  const allChoicesAvailable = Array.from(sellerMap.entries()).every(([sellerId, items]) => {
    const choice = choices.get(sellerId);
    return Boolean(choice && methodsForListings(listingFlags(items), availability).includes(choice.paymentMethod));
  });
  const needsDeliveryAddress = Array.from(choices.values()).some(choice => choice.fulfillmentMethod === "delivery");
  const deliveryAddressComplete = Boolean(
    delivery.recipientName.trim().length >= 2
    && delivery.contactNumber.trim().length >= 7
    && delivery.province.trim().length >= 2
    && delivery.city.trim().length >= 2
    && delivery.barangay.trim().length >= 2
    && delivery.streetAddress.trim().length >= 5,
  );
  const deliveryPayload = {
    recipientName: delivery.recipientName.trim(),
    contactNumber: delivery.contactNumber.trim(),
    province: delivery.province.trim(),
    city: delivery.city.trim(),
    barangay: delivery.barangay.trim(),
    streetAddress: delivery.streetAddress.trim(),
    instructions: delivery.instructions.trim() || undefined,
  };
  const belowMinimumCount = cart?.items.filter(item => item.quantity < item.minOrderQty).length ?? 0;
  const canSubmit = Boolean(
    cart
    && belowMinimumCount === 0
    && choices.size === sellerMap.size
    && allChoicesAvailable
    && allOnlineHaveReceipt
    && (!needsDeliveryAddress || deliveryAddressComplete)
    && !submitting
    && !isCartLoading,
  );

  const updateChoice = useCallback((sellerId: number, next: SellerGroupChoice) => {
    setChoices(current => {
      const copy = new Map(current);
      copy.set(sellerId, next);
      return copy;
    });
  }, []);

  const submitOrder = async () => {
    if (!user) return goToAuth("Checkout.submitOrder");
    if (!roleCanOrder || !cart || !canSubmit) return;

    setSubmitting(true);
    const createdIds: number[] = [];
    try {
      for (const [sellerId, items] of Array.from(sellerMap.entries())) {
        const choice = choices.get(sellerId);
        if (!choice) throw new Error("Choose payment for every seller group.");
        if (choice.paymentMethod === "online" && !choice.receiptUploadIntent) {
          throw new Error("Upload a payment receipt for each online payment group.");
        }
        const result = await createOrder.mutateAsync({
          items: items.map((item: CheckoutCartItem) => ({ productId: item.productId, quantity: item.quantity })),
          paymentMethod: choice.paymentMethod,
          fulfillmentMethod: choice.fulfillmentMethod,
          receiptUploadIntent: choice.receiptUploadIntent,
          paymentOptionId: choice.paymentMethod === "online" ? choice.paymentOptionId : undefined,
          deliveryDetails: choice.fulfillmentMethod === "delivery" ? deliveryPayload : undefined,
          buyerNote:
            choice.paymentMethod === "online"
              ? "Buyer paid via the AgriCoop QR; receipt attached at checkout."
              : "Please confirm availability and arrange the selected cash handover.",
        });
        createdIds.push(result.orderId);
      }
      await Promise.all(cart.items.map(item => removeCartItem(item.productId).catch(() => undefined)));
      void utils.cart.mine.invalidate();
      void utils.cart.count.invalidate();
      toast.success(
        createdIds.length === 1
          ? "Order submitted. The seller will confirm availability."
          : `${createdIds.length} orders submitted—one per seller.`,
      );
      void utils.orders.buyerMine.invalidate();
      setLocation(createdIds.length === 1 ? `/orders/${createdIds[0]}` : "/activity");
    } catch (problem) {
      if (createdIds.length) {
        toast.error(
          `${createdIds.length} order(s) were placed before an error occurred. Review Activity before retrying.`,
        );
        void utils.orders.buyerMine.invalidate();
      } else {
        toast.error(toUserFacingErrorMessage(problem instanceof Error ? problem.message : "Could not place order."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageFrame>
        <div className="grid min-h-80 place-items-center">
          <Loader2 className="animate-spin text-[#4e8257]" />
        </div>
      </PageFrame>
    );
  }
  if (!user) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Sign in to continue checkout</h1>
          <p className="mt-3 text-[#5c6c60]">Your saved order stays on your account after you sign in.</p>
          <button className="agri-button mt-6" type="button" onClick={() => goToAuth("Checkout")}>
            Sign in
          </button>
        </main>
      </PageFrame>
    );
  }
  if (!roleCanOrder) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Marketplace checkout unavailable</h1>
          <p className="mt-3 text-[#5c6c60]">
            {accessRestriction === "pending"
              ? "Your account is pending cooperative approval before you can place orders."
              : accessRestriction === "suspended"
                ? "This account is suspended. Contact cooperative support for help."
                : "Only approved Buyer and Seller accounts can place marketplace orders."}
          </p>
          <Link href="/dashboard" className="agri-button mt-6 inline-flex no-underline">
            Return to workspace
          </Link>
        </main>
      </PageFrame>
    );
  }
  if (isCartLoading) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-16 text-center`} role="status">
          <Loader2 className="mx-auto animate-spin text-[#4e8257]" size={28} aria-hidden />
          <h1 className="mt-4 font-display text-3xl font-bold text-[#244e36]">Loading your order…</h1>
        </main>
      </PageFrame>
    );
  }
  if (!cart) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Your checkout basket is empty</h1>
          <p className="mt-3 text-[#5c6c60]">Return to the marketplace and add items to your order.</p>
          <Link href="/marketplace" className="agri-button mt-6 inline-flex no-underline">
            Browse marketplace
          </Link>
        </main>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <main className={`${shellContainerClass} py-10`}>
        <Link href="/marketplace" className="agri-ghost text-sm no-underline">
          <ArrowLeft size={16} /> Return to marketplace
        </Link>
        <h1 className="mt-5 font-display text-4xl font-bold text-[#244e36]">Review your order</h1>
        <p className="mt-2 text-sm text-[#5c6c60]">
          {sellerMap.size > 1
            ? "Each farmer is checked out separately with its own payment choice."
            : "Order totals and item availability are verified again by the server before submission."}
        </p>
        <div className="mt-7 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          <div className="space-y-4">
            {Array.from(sellerMap.entries()).map(([sellerId, items]) => {
              const choice = choices.get(sellerId) ?? initialChoices.get(sellerId)!;
              return (
                <SellerCheckoutGroup
                  key={sellerId}
                  sellerId={sellerId}
                  sellerName={items[0]?.sellerName || "Farm seller"}
                  items={items}
                  choice={choice}
                  onChoiceChange={next => updateChoice(sellerId, next)}
                  availability={availability}
                  onlineDetails={onlineDetailsQuery.data}
                  onlineLoading={onlineDetailsQuery.isLoading}
                />
              );
            })}
          </div>
          <aside className="agri-card h-fit p-5 sm:p-6">
            <h2 className="font-display text-2xl font-bold text-[#264f37]">Order summary</h2>
            <div className="mt-4 space-y-3">
              {cart.items.map(item => (
                <div key={item.productId} className="flex justify-between gap-3 border-b border-[#edf0e9] pb-3 text-sm">
                  <span className="text-[#526858]">
                    {item.name} × {item.quantity} {item.unit}
                  </span>
                  <span className="font-bold text-[#315640]">{peso(item.priceCents * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-between font-bold text-[#315640]">
              <span>Estimated total</span>
              <span>{peso(totalCents)}</span>
            </div>
            {sellerMap.size > 1 && (
              <p className="mt-3 text-xs leading-5 text-[#4d6854]">
                You will place {sellerMap.size} separate orders—one per seller.
              </p>
            )}
            {needsDeliveryAddress && (
              <div className="mt-5 rounded-xl border border-[#e2e9dd] bg-[#f7faf5] p-4">
                <h3 className="text-sm font-bold text-[#315640]">Delivery address</h3>
                <p className="mt-1 text-xs text-[#6c7c70]">Required before you can submit. This address is saved with the order.</p>
                <div className="mt-3 grid gap-3">
                  <label className="field-label text-xs">Recipient name
                    <input className="field-control" value={delivery.recipientName} onChange={event => setDelivery({ ...delivery, recipientName: event.target.value })} />
                  </label>
                  <label className="field-label text-xs">Contact number
                    <input className="field-control" inputMode="tel" value={delivery.contactNumber} onChange={event => setDelivery({ ...delivery, contactNumber: event.target.value })} />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="field-label text-xs">Province / region
                      <input className="field-control" value={delivery.province} onChange={event => setDelivery({ ...delivery, province: event.target.value })} />
                    </label>
                    <label className="field-label text-xs">City / municipality
                      <input className="field-control" value={delivery.city} onChange={event => setDelivery({ ...delivery, city: event.target.value })} />
                    </label>
                  </div>
                  <label className="field-label text-xs">Barangay
                    <input className="field-control" value={delivery.barangay} onChange={event => setDelivery({ ...delivery, barangay: event.target.value })} />
                  </label>
                  <label className="field-label text-xs">Street, house no., subdivision
                    <input className="field-control" value={delivery.streetAddress} onChange={event => setDelivery({ ...delivery, streetAddress: event.target.value })} />
                  </label>
                  <label className="field-label text-xs">Delivery instructions (optional)
                    <input className="field-control" value={delivery.instructions} onChange={event => setDelivery({ ...delivery, instructions: event.target.value })} />
                  </label>
                </div>
                {!deliveryAddressComplete && <p className="mt-2 text-xs text-[#8c574c]">Complete all required address fields to place a delivery order.</p>}
              </div>
            )}
            <button
              type="button"
              className="agri-button mt-5 w-full"
              disabled={!canSubmit || createOrder.isPending}
              onClick={() => void submitOrder()}
            >
              {submitting || createOrder.isPending ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <ShoppingBag size={16} />
              )}{" "}
              Place {sellerMap.size > 1 ? `${sellerMap.size} orders` : "order"}
            </button>
            {belowMinimumCount > 0 && (
              <p className="mt-3 text-xs text-[#8c574c]" role="alert">
                Some quantities are below the product minimum order. Increase them in your order to continue.
              </p>
            )}
            {!allOnlineHaveReceipt && (
              <p className="mt-3 text-xs text-[#8c574c]">
                <Upload className="mr-1 inline" size={12} />
                Upload a receipt for each seller group using online payment.
              </p>
            )}
          </aside>
        </div>
      </main>
    </PageFrame>
  );
}