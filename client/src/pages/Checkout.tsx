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
import { ArrowLeft, Banknote, Copy, Flag, Loader2, QrCode, ShoppingBag, Store, Truck, Upload, ZoomIn } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OptionTileGroup } from "@/components/OptionTileGroup";
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
  const [qrLightboxOpen, setQrLightboxOpen] = useState(false);
  const [qrImgFailed, setQrImgFailed] = useState(false);
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

  const saveQrImage = async () => {
    if (!displayQr?.qrImageUrl) return;
    try {
      const response = await fetch(displayQr.qrImageUrl);
      if (!response.ok) throw new Error("fetch failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const ext = blob.type.includes("png") ? "png" : "jpg";
      anchor.href = url;
      anchor.download = `agricoop-payment-qr-${selectedQrOption?.id ?? "account"}.${ext}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not download the QR image.");
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

  useEffect(() => {
    setQrImgFailed(false);
  }, [displayQr?.qrImageUrl]);

  return (
    <section className="rounded-2xl border border-[#e1e9dd] bg-[#f7faf4] p-4">
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

      <div className="mt-4 grid items-start gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <FulfillmentPicker
            name={`fulfillment-${sellerId}`}
            options={pickerOptions}
            value={choice.fulfillmentMethod}
            onChange={setFulfillmentMethod}
            deliveryBlockedReason={deliveryBlockedReason}
          />
          {cooperativeId !== null && (
            <PickupLocationCard
              cooperativeId={cooperativeId}
              cooperativeName={cooperativeName}
              fulfillmentMethod={choice.fulfillmentMethod}
            />
          )}
        </div>
        <div className="min-w-0">
        <OptionTileGroup
          legend="Payment"
          name={`payment-${sellerId}`}
          value={choice.paymentMethod}
          onChange={value => setPaymentMethod(value as PaymentMethod)}
          options={PAYMENT_METHODS.filter(method => compatibleMethods.includes(method)).map(method => {
            const methodAvailability = paymentMethodAvailability(method, flags, availability);
            return {
              value: method,
              label: checkoutMethodLabel(method),
              sublabel: methodAvailability.reason ?? undefined,
              icon: method === "online" ? <QrCode size={20} /> : <Banknote size={20} />,
              disabled: !methodAvailability.available,
            };
          })}
        />
        {choice.paymentMethod && (
          <p className="mt-2 text-center text-xs leading-5 text-[#4d6854]">{PAYMENT_METHOD_HELPERS[choice.paymentMethod]}</p>
        )}

      {showOnline && (
        <div className="mt-4 rounded-xl border border-[#dfe8db] bg-white p-3 sm:p-4">
          <h4 className="text-center font-bold text-[#315640]">Pay via AgriCoop QR</h4>
          <p className="mt-1 text-center text-xs text-[#66766b]">A cooperative officer verifies the receipt before the seller fulfills the order.</p>
          <p className="mt-1 text-center text-xs font-semibold text-[#4d6854]">
            Fulfillment: {fulfillmentLabel(choice.fulfillmentMethod)} — the seller and officer see this on the order.
          </p>
          {qrOptionsQuery.isLoading || onlineLoading ? (
            <Loader2 className="mt-4 animate-spin text-[#4e8257]" />
          ) : (
            <>
              {!qrOptionsQuery.isLoading && qrOptions.length === 0 && (
                <p className="mt-3 rounded-lg bg-[#fdf3e7] p-3 text-xs font-semibold text-[#8c5a2b]">
                  {cooperativeName ?? "This cooperative"} has not published a QR payment code yet.
                  The AgriCoop platform payment account is shown below — the cooperative will still verify your receipt.
                  You can also choose Cash on Pickup or Cash on Delivery above.
                </p>
              )}
              {(qrOptions.length > 0 || Boolean(displayQr)) && (
                <div className="mt-3 space-y-4">
                  {qrOptions.length > 0 && (
                    <div className="min-w-0">
                      <p className="text-center text-xs font-extrabold uppercase tracking-wide text-[#638947]">Choose a payment QR</p>
                      {qrNotice && <p role="alert" className="mt-2 text-center text-xs font-semibold text-[#8c574c]">{qrNotice}</p>}
                      <div className="mt-2">
                        <OptionTileGroup
                          name={`qr-${sellerId}`}
                          value={selectedQrOption ? String(selectedQrOption.id) : ""}
                          onChange={value => {
                            setQrNotice(null);
                            setReportOpen(false);
                            onChoiceChange({ ...choice, paymentOptionId: Number(value) });
                          }}
                          options={qrOptions.map(option => ({
                            value: String(option.id),
                            label: qrPaymentProviderLabel(option.paymentMethod),
                            icon: <QrProviderMark provider={option.paymentMethod} />,
                          }))}
                        />
                      </div>
                      {!selectedQrOption && (
                        <p className="mt-2 text-center text-xs font-semibold text-[#8c574c]">Select a payment QR code to continue.</p>
                      )}
                      {displayQr && (
                        <div className="mt-3 space-y-1 text-center">
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
                      )}
                      {selectedQrOption && reportSentFor === selectedQrOption.id && !reportOpen && (
                        <p className="mt-3 rounded-lg bg-[#e6f3e5] p-3 text-xs font-semibold text-[#2f5c39]">
                          Thank you. Your report has been sent to the cooperative administrators for review. This QR code is now hidden until it is re-enabled — another available QR code was selected automatically.
                        </p>
                      )}
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
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <button type="button" className="agri-ghost text-sm" onClick={() => setReportOpen(false)}>Cancel</button>
                            <button type="button" className="agri-button text-sm" disabled={reportIssue.isPending} onClick={() => void submitQrReport()}>
                              {reportIssue.isPending ? <Loader2 className="animate-spin" size={14} /> : <Flag size={14} />} Send report
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {displayQr && !(qrOptions.length > 0 && !selectedQrOption) && (
                    <div className="mx-auto w-fit max-w-full rounded-xl border border-[#e2e8de] bg-white p-3 text-center">
                      {displayQr.qrImageUrl && !qrImgFailed ? (
                        <button
                          type="button"
                          onClick={() => setQrLightboxOpen(true)}
                          aria-label={`Enlarge QR code for ${displayQr.label || displayQr.accountName || "online payment"}`}
                          className="mx-auto block w-fit cursor-zoom-in rounded-lg bg-white p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4e8257] focus-visible:ring-offset-2"
                        >
                          <img
                            src={displayQr.qrImageUrl}
                            alt=""
                            className="h-[184px] w-[184px] object-contain sm:h-56 sm:w-56"
                            onError={() => setQrImgFailed(true)}
                          />
                          <span className="mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-[#6d7d70]">
                            <ZoomIn size={12} /> Tap to enlarge
                          </span>
                        </button>
                      ) : displayQr.qrImageUrl ? (
                        <div className="grid h-[200px] w-[200px] place-items-center rounded-lg bg-[#f0f5ed] p-3 text-center text-xs text-[#68796d] sm:h-60 sm:w-60">
                          {displayQr.label || "QR"}
                          <br />
                          QR unavailable
                        </div>
                      ) : (
                        <div className="grid h-[200px] w-[200px] place-items-center rounded-lg bg-[#f0f5ed] text-[#82987a] sm:h-60 sm:w-60">
                          <QrCode />
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                        <span className="font-display text-lg font-bold text-[#1d5639]">{peso(groupTotal)}</span>
                        <button type="button" className="agri-ghost agri-ghost-sm" onClick={() => void copyAmount()}>
                          <Copy size={14} /> Copy amount
                        </button>
                        {selectedQrOption && (
                          <button
                            type="button"
                            className="agri-ghost agri-ghost-sm text-[#a34838]"
                            onClick={() => { setReportOpen(value => !value); setReportSentFor(null); }}
                          >
                            <Flag size={13} className="mr-1 inline" /> QR Code Not Working? Report This QR
                          </button>
                        )}
                      </div>
                    </div>
                  )}
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
        </div>
      </div>
      {displayQr && (
        <Dialog open={qrLightboxOpen} onOpenChange={setQrLightboxOpen}>
          <DialogContent className="w-fit max-w-[calc(100%-2rem)] gap-3 p-4 sm:max-w-[min(90vw,480px)]">
            <DialogHeader className="text-center sm:text-center">
              <DialogTitle className="text-base">
                {displayQr.label || displayQr.accountName || "Payment QR"}
              </DialogTitle>
              <DialogDescription className="text-sm font-bold text-[#1d5639]">
                {peso(groupTotal)}
              </DialogDescription>
            </DialogHeader>
            {displayQr.qrImageUrl && !qrImgFailed ? (
              <img
                src={displayQr.qrImageUrl}
                alt={`Enlarged payment QR for ${displayQr.label || "online payment"}`}
                className="mx-auto max-h-[65vh] max-w-full object-contain [image-rendering:pixelated]"
              />
            ) : (
              <p className="py-10 text-center text-sm text-[#68796d]">
                {displayQr.label || "QR"} — QR unavailable
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" className="agri-ghost text-sm" onClick={() => setQrLightboxOpen(false)}>
                Close
              </button>
              {displayQr.qrImageUrl && !qrImgFailed && (
                <button type="button" className="agri-button text-sm" onClick={() => void saveQrImage()}>
                  Save QR
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

const FULFILLMENT_COPY: Record<FulfillmentMethod, { title: string; body: string }> = {
  pickup: { title: "Pickup", body: "You collect the order yourself." },
  delivery: { title: "Delivery", body: "The order is delivered to your address." },
};

const QR_PROVIDER_MARKS: Record<string, { bg: string; short: string }> = {
  gcash: { bg: "#007dfc", short: "GC" },
  maya: { bg: "#00b14f", short: "M" },
  maribank: { bg: "#0b4f8a", short: "MB" },
  gotyme: { bg: "#6d28d9", short: "GT" },
  other: { bg: "#4b5563", short: "QR" },
};

/** Brand-colored monogram shown on payment-QR provider tiles. */
function QrProviderMark({ provider }: { provider: string }) {
  const mark = QR_PROVIDER_MARKS[provider] ?? QR_PROVIDER_MARKS.other;
  return (
    <span
      className="grid h-9 w-9 place-items-center rounded-lg text-sm font-extrabold text-white"
      style={{ background: mark.bg }}
      aria-hidden
    >
      {mark.short}
    </span>
  );
}

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
    <div className="min-w-0">
      <OptionTileGroup
        legend="Fulfillment"
        name={name}
        value={value}
        onChange={next => onChange(next as FulfillmentMethod)}
        options={options.map(option => {
          const copy = FULFILLMENT_COPY[option];
          const blocked = option === "delivery" && Boolean(deliveryBlockedReason);
          return {
            value: option,
            label: copy.title,
            sublabel: copy.body,
            icon: option === "pickup" ? <Store size={20} /> : <Truck size={20} />,
            disabled: blocked,
          };
        })}
      />
      {deliveryBlockedReason && (
        <p className="mt-2 text-xs leading-5 text-[#8c574c]" role="alert">{deliveryBlockedReason}</p>
      )}
    </div>
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
    <div className="mt-3 rounded-lg border border-[#e2e9dd] bg-white/70 p-3">
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
      <main className={`${shellContainerClass} mx-auto w-full max-w-6xl py-10`}>
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
            {needsDeliveryAddress && (
              <div className="agri-card h-fit p-5 sm:p-6">
                <h3 className="font-display text-lg font-bold text-[#264f37]">Delivery address</h3>
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