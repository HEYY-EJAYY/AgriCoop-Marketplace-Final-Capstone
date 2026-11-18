export type CooperativeDuplicateMatch = {
  id: number;
  name: string;
  normalizedName: string;
  address: string;
  location: string;
};

type ExactProps = {
  mode: "exact";
  match: CooperativeDuplicateMatch;
  onUse: (match: CooperativeDuplicateMatch) => void;
};

type SimilarProps = {
  mode: "similar";
  matches: CooperativeDuplicateMatch[];
  onUse: (match: CooperativeDuplicateMatch) => void;
  onAddMine: () => void;
};

type CooperativeDuplicateNoticeProps = ExactProps | SimilarProps;

export function CooperativeDuplicateNotice(props: CooperativeDuplicateNoticeProps) {
  if (props.mode === "exact") {
    const { match, onUse } = props;
    return (
      <div
        className="rounded-2xl border border-[#e9dba9] bg-[#fff8e2] p-4 text-sm text-[#76551b]"
        role="alert"
        aria-live="polite"
      >
        <p className="font-bold">This cooperative already exists.</p>
        <p className="mt-2">
          <strong>{match.name}</strong>
          {match.address ? <> · {match.address}</> : null}
          {match.location ? <> · {match.location}</> : null}
        </p>
        <p className="mt-2">Is this your cooperative?</p>
        <button type="button" className="agri-button mt-3 text-sm" onClick={() => onUse(match)}>
          Yes, use this one
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-[#d6e5cb] bg-[#f7faf5] p-4 text-sm text-[#315640]"
      role="status"
      aria-live="polite"
    >
      <p className="font-bold">A similar cooperative already exists. Is this the coop?</p>
      <ul className="mt-3 space-y-3">
        {props.matches.map(match => (
          <li key={match.id} className="rounded-xl border border-[#d6e5cb] bg-white p-3">
            <p className="font-semibold">{match.name}</p>
            <p className="text-xs text-[#6a796e]">
              {[match.address, match.location].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="agri-button text-sm" onClick={() => props.onUse(match)}>
                Yes, use this one
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="agri-ghost mt-3 text-sm" onClick={props.onAddMine}>
        No, add mine
      </button>
    </div>
  );
}
