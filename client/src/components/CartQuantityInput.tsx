import { useEffect, useRef, useState } from "react";

type CartQuantityInputProps = {
  productName: string;
  quantity: number;
  min: number;
  max: number;
  unit: string;
  disabled?: boolean;
  onCommit: (next: number) => void;
};

/**
 * Typed quantity with +/- steppers. Allows empty text while typing; commits on blur/Enter.
 */
export function CartQuantityInput({
  productName,
  quantity,
  min,
  max,
  unit,
  disabled,
  onCommit,
}: CartQuantityInputProps) {
  const [text, setText] = useState(String(quantity));
  const debounceRef = useRef<number | null>(null);
  const lastCommitted = useRef(quantity);

  useEffect(() => {
    setText(String(quantity));
    lastCommitted.current = quantity;
  }, [quantity]);

  useEffect(() => () => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
  }, []);

  const clampAndCommit = (raw: string) => {
    if (raw.trim() === "") {
      setText(String(lastCommitted.current));
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setText(String(lastCommitted.current));
      return;
    }
    const clamped = Math.min(Math.max(parsed, min), max);
    if (clamped !== parsed) {
      // Friendly stock message is raised by the caller when clamped to max.
    }
    setText(String(clamped));
    if (clamped !== lastCommitted.current) {
      lastCommitted.current = clamped;
      onCommit(clamped);
    }
  };

  const scheduleCommit = (raw: string) => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => clampAndCommit(raw), 350);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="grid h-6 w-6 place-items-center rounded bg-white font-bold"
        disabled={disabled || quantity <= min}
        aria-label={`Decrease quantity of ${productName}`}
        onClick={() => {
          const next = Math.max(min, quantity - min);
          setText(String(next));
          lastCommitted.current = next;
          onCommit(next);
        }}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        min={min}
        max={max}
        disabled={disabled}
        className="h-7 w-14 rounded border border-[#d5e0d2] bg-white px-1 text-center text-sm font-bold text-[#315640]"
        value={text}
        aria-label={`Quantity of ${productName} in ${unit}`}
        onChange={event => {
          const next = event.target.value.replace(/[^\d]/g, "");
          setText(next);
          if (next !== "") scheduleCommit(next);
        }}
        onBlur={() => clampAndCommit(text)}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            clampAndCommit(text);
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="text-xs font-bold text-[#66806b]">{unit}</span>
      <button
        type="button"
        className="grid h-6 w-6 place-items-center rounded bg-white font-bold"
        disabled={disabled || quantity >= max}
        aria-label={`Increase quantity of ${productName}`}
        onClick={() => {
          const next = Math.min(max, quantity + min);
          setText(String(next));
          lastCommitted.current = next;
          onCommit(next);
        }}
      >
        +
      </button>
    </div>
  );
}
