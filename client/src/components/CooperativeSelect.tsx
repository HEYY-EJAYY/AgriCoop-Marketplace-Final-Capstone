import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

export type CooperativeSelectValue = {
  cooperativeId: number | null;
  newCooperativeName: string;
  newCooperativeLocation: string;
  addNew: boolean;
};

type CooperativeSelectProps = {
  value: CooperativeSelectValue;
  onChange: (next: CooperativeSelectValue) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
};

/**
 * Searchable active-cooperative picker with optional "add it" inline fields.
 * Used by public registration and Admin Add account.
 */
export function CooperativeSelect({
  value,
  onChange,
  required = false,
  disabled = false,
  id = "cooperative-select",
  label = "Cooperative",
}: CooperativeSelectProps) {
  const { data: cooperatives = [], isLoading } = trpc.cooperatives.listActive.useQuery();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cooperatives;
    return cooperatives.filter(row =>
      row.name.toLowerCase().includes(q)
      || row.normalizedName.toLowerCase().includes(q)
      || row.location.toLowerCase().includes(q),
    );
  }, [cooperatives, query]);

  const selected = cooperatives.find(row => row.id === value.cooperativeId) ?? null;

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="field-label mb-0">{label}{required ? " *" : " (optional)"}</legend>
      {!value.addNew && (
        <>
          <label className="field-label" htmlFor={`${id}-search`}>
            Search
            <input
              id={`${id}-search`}
              className="field-control"
              type="search"
              placeholder={isLoading ? "Loading cooperatives…" : "Type to filter…"}
              value={query}
              onChange={event => setQuery(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field-label" htmlFor={id}>
            Select cooperative
            <select
              id={id}
              className="field-control"
              required={required && !value.addNew}
              value={value.cooperativeId ?? ""}
              onChange={event => {
                const nextId = event.target.value ? Number(event.target.value) : null;
                onChange({
                  ...value,
                  cooperativeId: Number.isFinite(nextId) ? nextId : null,
                  addNew: false,
                });
              }}
            >
              <option value="">Choose a cooperative…</option>
              {filtered.map(row => (
                <option key={row.id} value={row.id}>
                  {row.name} — {row.location}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <p className="text-xs text-[#617467]">Selected: {selected.name}</p>
          )}
        </>
      )}

      <label className="flex min-h-11 items-start gap-2 text-sm font-semibold text-[#315640]">
        <input
          type="checkbox"
          className="mt-1"
          checked={value.addNew}
          onChange={event => onChange({
            cooperativeId: event.target.checked ? null : value.cooperativeId,
            newCooperativeName: value.newCooperativeName,
            newCooperativeLocation: value.newCooperativeLocation || "Philippines",
            addNew: event.target.checked,
          })}
        />
        <span>My cooperative isn&apos;t listed: add it</span>
      </label>

      {value.addNew && (
        <div className="space-y-3 rounded-xl border border-[#d6e5cb] bg-[#f7faf5] p-3">
          <label className="field-label" htmlFor={`${id}-new-name`}>
            New cooperative name
            <input
              id={`${id}-new-name`}
              className="field-control"
              required={required}
              minLength={3}
              maxLength={180}
              value={value.newCooperativeName}
              onChange={event => onChange({ ...value, newCooperativeName: event.target.value })}
            />
          </label>
          <label className="field-label" htmlFor={`${id}-new-location`}>
            Location
            <input
              id={`${id}-new-location`}
              className="field-control"
              required={required}
              minLength={3}
              maxLength={180}
              value={value.newCooperativeLocation}
              onChange={event => onChange({ ...value, newCooperativeLocation: event.target.value })}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}
