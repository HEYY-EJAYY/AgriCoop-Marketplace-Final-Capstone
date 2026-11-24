import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { WorkspaceHeader, shellContainerClass } from "@/components/AgriShell";
import { CooperativeDuplicateNotice } from "@/components/CooperativeDuplicateNotice";
import { CooperativeSelect, emptyCooperativeSelectValue, type CooperativeSelectValue } from "@/components/CooperativeSelect";
import {
  appendNewCooperativeFields,
  confirmNormalizedNameForNewCoop,
  cooperativeConflictFromError,
  type CooperativeConflictUi,
} from "@/lib/cooperativeConflict";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { COOP_ADMIN_APPLICATION_BUCKET, COOP_ADMIN_APPLICATION_CONTENT_TYPES, COOP_ADMIN_APPLICATION_MAX_BYTES, type CoopAdminApplicationContentType } from "@shared/coopAdminApplication";

type LocalImage = {
  file: File;
  previewUrl: string;
  contentType: CoopAdminApplicationContentType;
  isPdf: boolean;
};

const DOCUMENT_ACCEPT = COOP_ADMIN_APPLICATION_CONTENT_TYPES.join(",");
const ID_TYPE_OPTIONS = [
  { value: "national_id", label: "PhilSys / National ID" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "passport", label: "Passport" },
  { value: "postal_id", label: "Postal ID" },
  { value: "umid", label: "UMID" },
  { value: "voters_id", label: "Voter's ID" },
  { value: "other", label: "Other government-issued ID" },
] as const;

async function processDocument(file: File): Promise<LocalImage> {
  if (!COOP_ADMIN_APPLICATION_CONTENT_TYPES.includes(file.type as CoopAdminApplicationContentType)) {
    throw new Error("Use a JPEG, PNG, WebP, or PDF file.");
  }
  if (file.type === "application/pdf") {
    if (file.size > COOP_ADMIN_APPLICATION_MAX_BYTES) {
      throw new Error("Each file must be 5 MB or smaller.");
    }
    return { file, previewUrl: URL.createObjectURL(file), contentType: "application/pdf", isPdf: true };
  }
  const imageType = file.type as "image/jpeg" | "image/png" | "image/webp";
  if (file.size <= COOP_ADMIN_APPLICATION_MAX_BYTES && file.type !== "image/png") {
    return { file, previewUrl: URL.createObjectURL(file), contentType: imageType, isPdf: false };
  }
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Could not compress the image.");
  if (blob.size > COOP_ADMIN_APPLICATION_MAX_BYTES) {
    throw new Error("Each image must be 5 MB or smaller after compression.");
  }
  const next = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  return { file: next, previewUrl: URL.createObjectURL(next), contentType: "image/jpeg", isPdf: false };
}

export default function CoopAdminApplication() {
  const { user, loading } = useAuth();
  const utils = trpc.useUtils();
  const mine = trpc.officerApplications.mine.useQuery(undefined, {
    enabled: !!user && user.role === "buyer" && user.requestedRole === "admin",
  });
  const createIntent = trpc.officerApplications.createUploadIntent.useMutation();
  const submit = trpc.officerApplications.submit.useMutation({
    onSuccess: () => {
      toast.success("Application submitted for review.");
      void utils.officerApplications.mine.invalidate();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });

  const [fullName, setFullName] = useState(user?.name ?? "");
  const [positionTitle, setPositionTitle] = useState("");
  const [contactNumber, setContactNumber] = useState(user?.contactNumber ?? "");
  const [idType, setIdType] = useState<(typeof ID_TYPE_OPTIONS)[number]["value"]>("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [consent, setConsent] = useState(false);
  const [coop, setCoop] = useState<CooperativeSelectValue>(emptyCooperativeSelectValue);
  const [idImage, setIdImage] = useState<LocalImage | null>(null);
  const [proofImage, setProofImage] = useState<LocalImage | null>(null);
  const [coopConflict, setCoopConflict] = useState<CooperativeConflictUi | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!coop.addNew || coop.newCooperativeName.trim().length < 3) return undefined;
    if (!coop.newCooperativeLocation.trim() || coop.newCooperativeAddress.trim().length < 3) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void utils.cooperatives.previewCreate
        .fetch({
          newCooperativeName: coop.newCooperativeName.trim(),
          newCooperativeLocation: coop.newCooperativeLocation.trim(),
          newCooperativeAddress: coop.newCooperativeAddress.trim(),
        })
        .then(() => {
          if (!cancelled) setCoopConflict(null);
        })
        .catch(error => {
          const conflict = cooperativeConflictFromError(error);
          if (!cancelled && conflict) setCoopConflict(conflict);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [coop.addNew, coop.newCooperativeName, coop.newCooperativeLocation, coop.newCooperativeAddress, utils.cooperatives.previewCreate]);

  const pending = mine.data?.application.status === "pending";
  const awaiting = !mine.data || mine.data.application.status === "awaiting_documents" || mine.data.application.status === "rejected";

  const canSubmit = useMemo(() => (
    fullName.trim().length >= 2
    && positionTitle.trim().length >= 2
    && contactNumber.trim().length >= 7
    && idNumber.trim().length >= 3
    && consent
    && (coop.cooperativeId || (coop.addNew && coop.newCooperativeName.trim().length >= 3))
    && idImage
  ), [fullName, positionTitle, contactNumber, idNumber, consent, coop, idImage]);

  const onPick = async (kind: "id" | "proof", file: File | null) => {
    if (!file) return;
    try {
      const processed = await processDocument(file);
      if (kind === "id") {
        if (idImage) URL.revokeObjectURL(idImage.previewUrl);
        setIdImage(processed);
      } else {
        if (proofImage) URL.revokeObjectURL(proofImage.previewUrl);
        setProofImage(processed);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that image.");
    }
  };

  const uploadOne = async (kind: "id" | "proof", image: LocalImage) => {
    const intent = await createIntent.mutateAsync({
      kind,
      contentType: image.contentType,
      fileSizeBytes: image.file.size,
    });
    const { error } = await supabase.storage
      .from(COOP_ADMIN_APPLICATION_BUCKET)
      .uploadToSignedUrl(intent.storagePath, intent.uploadToken, image.file, {
        contentType: image.contentType,
        upsert: true,
      });
    if (error) throw error;
    return intent;
  };

  const buildSubmitPayload = (
    idIntent: { storagePath: string; uploadIntent: string },
    proofIntent: { storagePath: string; uploadIntent: string } | null,
    confirmSimilarNormalizedName?: string,
  ) => {
    const payload: Parameters<typeof submit.mutateAsync>[0] = {
      fullName: fullName.trim(),
      positionTitle: positionTitle.trim(),
      contactNumber: contactNumber.trim(),
      idType,
      idNumber: idNumber.trim(),
      consentAccepted: true,
      idDocumentPath: idIntent.storagePath,
      idUploadIntent: idIntent.uploadIntent,
    };
    if (proofIntent) {
      payload.proofDocumentPath = proofIntent.storagePath;
      payload.proofUploadIntent = proofIntent.uploadIntent;
    }
    appendNewCooperativeFields(payload, coop);
    if (confirmSimilarNormalizedName) {
      payload.confirmSimilarNormalizedName = confirmSimilarNormalizedName;
    }
    return payload;
  };

  const runSubmit = async (
    idIntent: { storagePath: string; uploadIntent: string },
    proofIntent: { storagePath: string; uploadIntent: string } | null,
    confirmSimilarNormalizedName?: string,
  ) => {
    try {
      await submit.mutateAsync(buildSubmitPayload(idIntent, proofIntent, confirmSimilarNormalizedName));
      setCoopConflict(null);
    } catch (error) {
      const conflict = cooperativeConflictFromError(error);
      if (conflict) {
        setCoopConflict(conflict);
        return;
      }
      throw error;
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!idImage || !canSubmit) return;
    setBusy(true);
    try {
      const idIntent = await uploadOne("id", idImage);
      const proofIntent = proofImage ? await uploadOne("proof", proofImage) : null;
      await runSubmit(idIntent, proofIntent);
    } catch (error) {
      if (cooperativeConflictFromError(error)) return;
      toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Submit failed."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="animate-spin text-[#4e8257]" /></div>;
  }
  if (!user || user.role !== "buyer" || user.requestedRole !== "admin") {
    return (
      <>
        <WorkspaceHeader title="OfficerAdmin application" description="Applicant access only." />
        <main className={`${shellContainerClass} py-10`}>
          <div className="agri-card p-5 sm:p-6 text-center">
            <h1 className="font-display text-3xl font-bold text-[#254f37]">Applicant access required</h1>
            <p className="mt-3 text-[#65766b]">Register as OfficerAdmin, verify your email, then return here.</p>
            <Link href="/dashboard" className="agri-button mt-6 inline-flex min-h-11 no-underline">Back to dashboard</Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader
        title="Complete your OfficerAdmin application"
        description="Upload your ID and proof of position. OfficerAdmin access is granted only after SuperAdmin approval."
      />
      <main className={`${shellContainerClass} py-8`}>
        {pending ? (
          <div className="agri-card p-6" role="status">
            <h1 className="font-display text-2xl font-bold text-[#254f37]">Application pending</h1>
            <p className="mt-3 text-sm text-[#5f7164]">
              Your application is waiting for approval. We will contact you once it is reviewed.
            </p>
          </div>
        ) : (
          <form className="agri-card space-y-5 p-6" onSubmit={onSubmit}>
            {mine.data?.application.status === "rejected" && (
              <p className="rounded-xl bg-[#fff1ec] p-3 text-sm text-[#a34838]" role="alert">
                Previous application rejected{mine.data.application.rejectionReason ? `: ${mine.data.application.rejectionReason}` : "."} Update your documents and resubmit.
              </p>
            )}
            <label className="field-label">Full name
              <input className="field-control" required value={fullName} onChange={e => setFullName(e.target.value)} />
            </label>
            <CooperativeSelect
              value={coop}
              onChange={next => {
                setCoop(next);
                setCoopConflict(null);
              }}
              required
            />
            {coopConflict && (
              <CooperativeDuplicateNotice
                {...(coopConflict.mode === "exact"
                  ? {
                      mode: "exact" as const,
                      match: coopConflict.match,
                      onUse: match => {
                        if (!idImage) return;
                        setBusy(true);
                        void (async () => {
                          try {
                            const idIntent = await uploadOne("id", idImage);
                            const proofIntent = proofImage ? await uploadOne("proof", proofImage) : null;
                            await runSubmit(idIntent, proofIntent, match.normalizedName);
                          } catch (error) {
                            if (!cooperativeConflictFromError(error)) {
                              toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Submit failed."));
                            }
                          } finally {
                            setBusy(false);
                          }
                        })();
                      },
                    }
                  : {
                      mode: "similar" as const,
                      matches: coopConflict.matches,
                      onUse: match => {
                        if (!idImage) return;
                        setBusy(true);
                        void (async () => {
                          try {
                            const idIntent = await uploadOne("id", idImage);
                            const proofIntent = proofImage ? await uploadOne("proof", proofImage) : null;
                            await runSubmit(idIntent, proofIntent, match.normalizedName);
                          } catch (error) {
                            if (!cooperativeConflictFromError(error)) {
                              toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Submit failed."));
                            }
                          } finally {
                            setBusy(false);
                          }
                        })();
                      },
                      onAddMine: () => {
                        if (!idImage) return;
                        setBusy(true);
                        void (async () => {
                          try {
                            const idIntent = await uploadOne("id", idImage);
                            const proofIntent = proofImage ? await uploadOne("proof", proofImage) : null;
                            await runSubmit(idIntent, proofIntent, confirmNormalizedNameForNewCoop(coop));
                          } catch (error) {
                            if (!cooperativeConflictFromError(error)) {
                              toast.error(toUserFacingErrorMessage(error instanceof Error ? error.message : "Submit failed."));
                            }
                          } finally {
                            setBusy(false);
                          }
                        })();
                      },
                    })}
              />
            )}
            <label className="field-label">Position or title
              <input className="field-control" required value={positionTitle} onChange={e => setPositionTitle(e.target.value)} placeholder="e.g. Board Secretary" />
            </label>
            <label className="field-label">Contact number
              <input className="field-control" required inputMode="tel" maxLength={40} value={contactNumber} onChange={e => setContactNumber(e.target.value)} placeholder="e.g. 0917 123 4567" />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="field-label">Government ID type
                <select className="field-control" value={idType} onChange={e => setIdType(e.target.value as typeof idType)}>
                  {ID_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="field-label">Government ID number
                <input className="field-control" required minLength={3} maxLength={60} value={idNumber} onChange={e => setIdNumber(e.target.value)} placeholder="As shown on your ID" />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {(["id", "proof"] as const).map(kind => {
                const doc = kind === "id" ? idImage : proofImage;
                return (
                  <label key={kind} className="field-label">
                    {kind === "id" ? "Front of government ID (required)" : "Back of ID or supporting document (optional)"}
                    <input
                      className="field-control"
                      type="file"
                      accept={DOCUMENT_ACCEPT}
                      onChange={e => void onPick(kind, e.target.files?.[0] ?? null)}
                    />
                    <span className="mt-1 block text-xs font-normal text-[#6d7d70]">JPEG, PNG, WebP, or PDF · max 5 MB</span>
                    {doc && (
                      doc.isPdf ? (
                        <p className="mt-3 rounded-xl bg-[#f2f6ef] px-3 py-2 text-sm text-[#315640]">{doc.file.name}</p>
                      ) : (
                        <img src={doc.previewUrl} alt="" className="mt-3 max-h-48 w-full rounded-xl object-cover" />
                      )
                    )}
                  </label>
                );
              })}
            </div>
            <label className="flex items-start gap-3 text-sm text-[#45614e]">
              <input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} />
              <span>I agree to the identity verification and privacy terms. My documents are stored privately and reviewed only by authorized SuperAdmins.</span>
            </label>
            <button type="submit" className="agri-button min-h-11" disabled={!canSubmit || busy || !awaiting}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : null}
              Submit application
            </button>
          </form>
        )}
      </main>
    </>
  );
}
