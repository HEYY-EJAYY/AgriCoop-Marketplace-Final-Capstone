import * as React from "react";

export function NotificationQueryError({
  message,
  isRetrying,
  onRetry,
}: {
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return <div className="p-4 text-sm text-[#8e3f32]">
    <p role="alert">{message}</p>
    <button type="button" disabled={isRetrying} onClick={onRetry} className="mt-2 font-bold underline disabled:opacity-60">
      {isRetrying ? "Retrying..." : "Retry"}
    </button>
  </div>;
}
