import { useEffect, useId, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export type CooperativeSelectValue = {
  cooperativeId: number | null;
  newCooperativeName: string;
  newCooperativeLocation: string;
  newCooperativeAddress: string;
  addNew: boolean;
};

export type CooperativeSelectProps = {
  value: CooperativeSelectValue;
  onChange: (next: CooperativeSelectValue) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
  /** When false, hide add-new (association / staff assign). Default true. */
  allowAddNew?: boolean;
};

export function emptyCooperativeSelectValue(): CooperativeSelectValue {
  return {
    cooperativeId: null,
    newCooperativeName: "",
    newCooperativeLocation: "",
    newCooperativeAddress: "",
    addNew: false,
  };
}

/**
 * One accessible Cooperative combobox: search inside the list, empty state,
 * and "Can't find it? Add my cooperative" (optional).
 */
export function CooperativeSelect({
  value,
  onChange,
  required = false,
  disabled = false,
  id,
  label = "Cooperative",
  allowAddNew = true,
}: CooperativeSelectProps) {
  const reactId = useId();
  const baseId = id ?? `cooperative-${reactId}`;
  const listboxId = `${baseId}-listbox`;
  const { data: cooperatives = [], isLoading } = trpc.cooperatives.listActive.useQuery();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cooperatives;
    return cooperatives.filter(row =>
      row.name.toLowerCase().includes(q)
      || row.normalizedName.toLowerCase().includes(q)
      || row.location.toLowerCase().includes(q)
      || (row.address ?? "").toLowerCase().includes(q),
    );
  }, [cooperatives, query]);

  const selected = cooperatives.find(row => row.id === value.cooperativeId) ?? null;
  const addNewOptionIndex = allowAddNew ? filtered.length : -1;
  const optionCount = filtered.length + (allowAddNew ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const pickExisting = (coopId: number) => {
    onChange({
      ...value,
      cooperativeId: coopId,
      addNew: false,
      newCooperativeName: "",
      newCooperativeLocation: "",
      newCooperativeAddress: "",
    });
    setQuery("");
    setOpen(false);
  };

  const startAddNew = () => {
    onChange({
      ...value,
      cooperativeId: null,
      addNew: true,
      newCooperativeName: query.trim() || value.newCooperativeName,
    });
    setOpen(false);
  };

  const onComboboxKeyDown = (event: React.KeyboardEvent) => {
    if (disabled || value.addNew) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex(i => Math.min(i + 1, Math.max(optionCount - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex(i => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (allowAddNew && activeIndex === addNewOptionIndex) startAddNew();
      else if (filtered[activeIndex]) pickExisting(filtered[activeIndex]!.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(Math.max(optionCount - 1, 0));
    }
  };

  if (value.addNew && allowAddNew) {
    return (
      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="field-label mb-0">{label}{required ? " *" : ""}</legend>
        <div className="space-y-3 rounded-xl border border-[#d6e5cb] bg-[#f7faf5] p-3">
          <p className="text-sm font-semibold text-[#315640]">Add my cooperative</p>
          <label className="field-label" htmlFor={`${baseId}-new-name`}>
            Cooperative name
            <input
              id={`${baseId}-new-name`}
              className="field-control"
              required={required}
              minLength={3}
              maxLength={180}
              value={value.newCooperativeName}
              onChange={event => onChange({ ...value, newCooperativeName: event.target.value })}
            />
          </label>
          <label className="field-label" htmlFor={`${baseId}-new-address`}>
            Address
            <input
              id={`${baseId}-new-address`}
              className="field-control"
              required={required}
              minLength={3}
              maxLength={255}
              placeholder="Street or barangay detail"
              value={value.newCooperativeAddress}
              onChange={event => onChange({ ...value, newCooperativeAddress: event.target.value })}
            />
          </label>
          <label className="field-label" htmlFor={`${baseId}-new-location`}>
            Location
            <input
              id={`${baseId}-new-location`}
              className="field-control"
              required={required}
              minLength={3}
              maxLength={180}
              placeholder="Municipality/city and province"
              value={value.newCooperativeLocation}
              onChange={event => onChange({ ...value, newCooperativeLocation: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="agri-ghost text-sm"
            onClick={() => onChange({
              ...emptyCooperativeSelectValue(),
              cooperativeId: value.cooperativeId,
            })}
          >
            Back to cooperative list
          </button>
        </div>
      </fieldset>
    );
  }

  const displayValue = selected
    ? `${selected.name} — ${selected.location}`
    : "";

  return (
    <div className="space-y-2" ref={rootRef}>
      <label className="field-label" id={`${baseId}-label`} htmlFor={baseId}>
        {label}{required ? " *" : ""}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={baseId}
          type="text"
          role="combobox"
          className="field-control"
          disabled={disabled}
          required={required && !value.addNew}
          placeholder="Choose a cooperative"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={`${baseId}-label`}
          aria-activedescendant={open ? `${baseId}-opt-${activeIndex}` : undefined}
          value={open ? query : displayValue}
          onChange={event => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
            if (value.cooperativeId != null) {
              onChange({ ...value, cooperativeId: null });
            }
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onComboboxKeyDown}
        />
        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={`${baseId}-label`}
            className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-[#d6e5cb] bg-white shadow-lg"
          >
            <div className="sticky top-0 border-b border-[#edf0e9] bg-[#f7faf5] p-2">
              <input
                className="field-control"
                type="search"
                placeholder={isLoading ? "Loading cooperatives…" : "Search cooperatives…"}
                value={query}
                onChange={event => setQuery(event.target.value)}
                aria-label="Search cooperatives"
                autoFocus
              />
            </div>
            {filtered.length === 0 ? (
              <div className="space-y-2 p-3 text-sm text-[#5f7164]">
                <p>No cooperatives match that search.</p>
                {allowAddNew && (
                  <button
                    type="button"
                    id={`${baseId}-opt-0`}
                    role="option"
                    aria-selected={activeIndex === 0}
                    className={`block w-full rounded-lg px-3 py-2 text-left font-semibold text-[#2f5a3d] ${activeIndex === 0 ? "bg-[#e8f3e0]" : "hover:bg-[#f3f8ef]"}`}
                    onMouseEnter={() => setActiveIndex(0)}
                    onClick={startAddNew}
                  >
                    Can&apos;t find it? Add my cooperative
                  </button>
                )}
              </div>
            ) : (
              <ul className="py-1">
                {filtered.map((row, index) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      id={`${baseId}-opt-${index}`}
                      role="option"
                      aria-selected={activeIndex === index}
                      className={`block w-full px-3 py-2 text-left text-sm ${activeIndex === index ? "bg-[#e8f3e0]" : "hover:bg-[#f3f8ef]"}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => pickExisting(row.id)}
                    >
                      <span className="font-semibold text-[#315640]">{row.name}</span>
                      <span className="mt-0.5 block text-xs text-[#6a796e]">
                        {[row.address, row.location].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
                {allowAddNew && (
                  <li className="border-t border-[#edf0e9]">
                    <button
                      type="button"
                      id={`${baseId}-opt-${addNewOptionIndex}`}
                      role="option"
                      aria-selected={activeIndex === addNewOptionIndex}
                      className={`block w-full px-3 py-2.5 text-left text-sm font-semibold text-[#2f5a3d] ${activeIndex === addNewOptionIndex ? "bg-[#e8f3e0]" : "hover:bg-[#f3f8ef]"}`}
                      onMouseEnter={() => setActiveIndex(addNewOptionIndex)}
                      onClick={startAddNew}
                    >
                      Can&apos;t find it? Add my cooperative
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
      {selected && !open && (
        <p className="text-xs text-[#617467]">
          Selected: {selected.name}
          {selected.address ? ` · ${selected.address}` : ""}
          {selected.location ? ` · ${selected.location}` : ""}
        </p>
      )}
    </div>
  );
}
