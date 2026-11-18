import { useState } from "react";
import { toast } from "sonner";
import { CooperativeSelect, type CooperativeSelectValue } from "@/components/CooperativeSelect";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";

type AddAccountDialogProps = {
  open: boolean;
  onClose: () => void;
};

type CoopSuggestion = {
  id: number;
  name: string;
  normalizedName: string;
  location: string;
};

export function AddAccountDialog({ open, onClose }: AddAccountDialogProps) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"buyer" | "seller" | "admin">("buyer");
  const [coop, setCoop] = useState<CooperativeSelectValue>({
    cooperativeId: null,
    newCooperativeName: "",
    newCooperativeLocation: "Philippines",
    addNew: false,
  });
  const [coopSuggestion, setCoopSuggestion] = useState<CoopSuggestion | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const createAccount = trpc.admin.createAccount.useMutation({
    onSuccess: data => {
      toast.success("Account created.");
      void utils.admin.overview.invalidate();
      if (data.inviteLink) setInviteLink(data.inviteLink);
      else onClose();
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });

  const buildPayload = (confirmSimilarNormalizedName?: string) => {
    const payload: {
      name: string;
      email: string;
      role: typeof role;
      cooperativeId?: number;
      newCooperativeName?: string;
      newCooperativeLocation?: string;
      confirmSimilarNormalizedName?: string;
    } = {
      name: name.trim(),
      email: email.trim(),
      role,
      cooperativeId: !coop.addNew ? coop.cooperativeId ?? undefined : undefined,
      newCooperativeName: coop.addNew ? coop.newCooperativeName.trim() : undefined,
      newCooperativeLocation: coop.addNew ? (coop.newCooperativeLocation.trim() || "Philippines") : undefined,
    };
    if (confirmSimilarNormalizedName) {
      payload.confirmSimilarNormalizedName = confirmSimilarNormalizedName;
    }
    return payload;
  };

  const runCreate = async (confirmSimilarNormalizedName?: string) => {
    try {
      await createAccount.mutateAsync(buildPayload(confirmSimilarNormalizedName));
      setCoopSuggestion(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Account creation failed.";
      const suggestionMatch = /Did you mean "([^"]+)"/i.exec(message);
      if (suggestionMatch && coop.addNew) {
        const list = await utils.cooperatives.listActive.fetch();
        const found = list.find(row => row.name === suggestionMatch[1]);
        if (found) {
          setCoopSuggestion({
            id: found.id,
            name: found.name,
            normalizedName: found.normalizedName,
            location: found.location,
          });
          return;
        }
      }
      throw error;
    }
  };

  if (!open) return null;
  const needsCoop = role === "seller" || role === "admin";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1c2b2080] p-4" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <form
        className="agri-card w-full max-w-lg space-y-4 p-6"
        onSubmit={event => {
          event.preventDefault();
          void runCreate().catch(error => {
            if (!(error instanceof Error)) return;
            // mutateAsync errors after coop suggestion are already handled; avoid duplicate toasts.
            if (/Did you mean "/i.test(error.message) && coop.addNew) return;
            toast.error(toUserFacingErrorMessage(error.message));
          });
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
            {user?.role === "superadmin" && <option value="admin">Officer Admin</option>}
          </select>
        </label>
        {needsCoop && (
          <CooperativeSelect
            value={coop}
            onChange={next => {
              setCoop(next);
              setCoopSuggestion(null);
            }}
            required
          />
        )}
        {coopSuggestion && (
          <section role="alertdialog" aria-labelledby="add-account-coop-did-you-mean-title" className="rounded-xl border border-[#e2c48a] bg-[#fff8ea] p-4">
            <h2 id="add-account-coop-did-you-mean-title" className="font-bold text-[#6a4e16]">Did you mean…?</h2>
            <p className="mt-2 text-sm text-[#6a4e16]">
              A similar cooperative already exists: <strong>{coopSuggestion.name}</strong> ({coopSuggestion.location}).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="agri-button text-sm"
                disabled={createAccount.isPending}
                onClick={() => {
                  void runCreate(coopSuggestion.normalizedName).catch(error =>
                    toast.error(error instanceof Error ? error.message : "Account creation failed."),
                  );
                }}
              >
                Use {coopSuggestion.name}
              </button>
              <button
                type="button"
                className="agri-ghost text-sm"
                disabled={createAccount.isPending}
                onClick={() => {
                  const normalized = coop.newCooperativeName.trim().toLowerCase().replace(/[^a-z0-9]+/gi, "");
                  void runCreate(normalized || coopSuggestion.normalizedName).catch(error =>
                    toast.error(error instanceof Error ? error.message : "Account creation failed."),
                  );
                }}
              >
                Create mine anyway
              </button>
            </div>
          </section>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="agri-ghost min-h-11" onClick={onClose}>Close</button>
          {!inviteLink && (
            <button className="agri-button min-h-11" disabled={createAccount.isPending}>Create account</button>
          )}
        </div>
      </form>
    </div>
  );
}