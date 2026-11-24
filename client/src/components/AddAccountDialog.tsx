import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CooperativeDuplicateNotice } from "@/components/CooperativeDuplicateNotice";
import { CooperativeSelect, emptyCooperativeSelectValue, type CooperativeSelectValue } from "@/components/CooperativeSelect";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  appendNewCooperativeFields,
  confirmNormalizedNameForNewCoop,
  cooperativeConflictFromError,
  type CooperativeConflictUi,
} from "@/lib/cooperativeConflict";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";

type AddAccountDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function AddAccountDialog({ open, onClose }: AddAccountDialogProps) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"buyer" | "seller" | "admin">("buyer");
  const [coop, setCoop] = useState<CooperativeSelectValue>(emptyCooperativeSelectValue);
  const [coopConflict, setCoopConflict] = useState<CooperativeConflictUi | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !coop.addNew || coop.newCooperativeName.trim().length < 3) return undefined;
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
  }, [open, coop.addNew, coop.newCooperativeName, coop.newCooperativeLocation, coop.newCooperativeAddress, utils.cooperatives.previewCreate]);

  const createAccount = trpc.admin.createAccount.useMutation({
    onSuccess: data => {
      toast.success("Account created.");
      void utils.admin.overview.invalidate();
      if (data.inviteLink) setInviteLink(data.inviteLink);
      else onClose();
    },
    onError: error => {
      const conflict = cooperativeConflictFromError(error);
      if (conflict) {
        setCoopConflict(conflict);
        return;
      }
      toast.error(toUserFacingErrorMessage(error.message));
    },
  });

  const buildPayload = (confirmSimilarNormalizedName?: string) => {
    const payload: Parameters<typeof createAccount.mutateAsync>[0] = {
      name: name.trim(),
      email: email.trim(),
      role,
    };
    appendNewCooperativeFields(payload, coop);
    if (confirmSimilarNormalizedName) {
      payload.confirmSimilarNormalizedName = confirmSimilarNormalizedName;
    }
    return payload;
  };

  const runCreate = async (confirmSimilarNormalizedName?: string) => {
    await createAccount.mutateAsync(buildPayload(confirmSimilarNormalizedName));
    setCoopConflict(null);
  };

  if (!open) return null;
  const needsCoop = role === "seller" || role === "admin";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1c2b2080] p-4" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <form
        className="agri-card w-full max-w-lg space-y-4 p-6"
        onSubmit={event => {
          event.preventDefault();
          void runCreate().catch(() => undefined);
        }}
      >
        <h2 id="add-account-title" className="font-display text-2xl font-bold text-[#264f37]">Add account</h2>
        <p className="text-sm text-[#6a796e]">Creates a confirmed Auth user and emails a set-password link. No password is shown here.</p>
        {inviteLink && (
          <div className="rounded-xl bg-[#fff8e8] p-3 text-sm text-[#7a5a18]" role="status">
            <p>Email delivery may have failed. Copy this one-time set-password link now (it is not stored):</p>
            <textarea className="field-control mt-2 min-h-24 text-xs" readOnly value={inviteLink} />
            <button
              type="button"
              className="agri-button mt-2 min-h-11 text-sm"
              onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => toast.success("Link copied."))}
            >
              Copy link
            </button>
          </div>
        )}
        <label className="field-label">Full name
          <input className="field-control" required value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="field-label">Email
          <input className="field-control" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="field-label">Role
          <select className="field-control" value={role} onChange={e => setRole(e.target.value as typeof role)}>
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
            {user?.role === "superadmin" && <option value="admin">OfficerAdmin</option>}
          </select>
        </label>
        {needsCoop && (
          <CooperativeSelect
            value={coop}
            onChange={next => {
              setCoop(next);
              setCoopConflict(null);
            }}
            required
          />
        )}
        {coopConflict && (
          <CooperativeDuplicateNotice
            {...(coopConflict.mode === "exact"
              ? {
                  mode: "exact" as const,
                  match: coopConflict.match,
                  onUse: match => void runCreate(match.normalizedName),
                }
              : {
                  mode: "similar" as const,
                  matches: coopConflict.matches,
                  onUse: match => void runCreate(match.normalizedName),
                  onAddMine: () => void runCreate(confirmNormalizedNameForNewCoop(coop)),
                })}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="agri-ghost min-h-11" onClick={onClose}>Close</button>
          {!inviteLink && (
            <button className="agri-button min-h-11" disabled={createAccount.isPending}>Create account</button>
          )}
        </div>
      </form>
    </div>
  );
}