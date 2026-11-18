import * as React from "react";
import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordVisibilityInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordVisibilityInput({ className, ...inputProps }: PasswordVisibilityInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...inputProps}
        type={visible ? "text" : "password"}
        className={`field-control pr-12 ${className ?? ""}`}
      />
      <button
        type="button"
        className="absolute right-0 top-0 grid h-full w-11 place-items-center rounded-r-xl text-[#5d7462] hover:bg-[#edf3e9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3d784f]"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible(value => !value)}
      >
        {visible ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
      </button>
    </div>
  );
}
