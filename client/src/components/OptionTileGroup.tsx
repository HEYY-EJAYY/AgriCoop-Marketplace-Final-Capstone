import { Check } from "lucide-react";
import type { ReactNode } from "react";

export type OptionTileOption = {
  value: string;
  label: string;
  sublabel?: string;
  /** Logo, monogram, or icon shown above the label. */
  icon?: ReactNode;
  disabled?: boolean;
};

/**
 * Compact selectable tile group. Renders real radio inputs (sr-only) inside
 * labels so keyboard arrow-key navigation and form semantics are preserved.
 * Tiles size to a shared min width and wrap — they never stretch full-row.
 * Negative/positive ordering does not apply here; this is a single-choice
 * selector, not an action group.
 */
export function OptionTileGroup({
  legend,
  legendClassName,
  name,
  options,
  value,
  onChange,
  className,
}: {
  legend?: string;
  legendClassName?: string;
  name: string;
  options: OptionTileOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <fieldset className={className ?? "min-w-0"}>
      {legend && (
        <legend className={`text-xs font-extrabold uppercase tracking-wide text-[#638947] ${legendClassName ?? ""}`}>{legend}</legend>
      )}
      <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2.5">
        {options.map(option => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`relative flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center transition-colors ${
                option.disabled
                  ? "cursor-not-allowed border-[#e3e9de] bg-[#f4f4f1] opacity-70"
                  : selected
                    ? "border-[#5d8a5e] bg-[#edf4e9] text-[#315640]"
                    : "border-[#e3e9de] bg-white text-[#66766b] hover:border-[#b9cbb2]"
              } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#4e8257] has-[:focus-visible]:ring-offset-1`}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={selected}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
              />
              {option.icon}
              <span className="text-sm font-bold leading-5">{option.label}</span>
              {option.sublabel && (
                <span className="text-xs font-normal leading-4 text-[#6d7d70]">{option.sublabel}</span>
              )}
              {selected && (
                <span
                  className="absolute bottom-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#4e8257] text-white"
                  aria-hidden
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
