import * as React from "react";

export function AdminOrderDetailsQueryError({
  orderId,
  message,
  isRetrying,
  onRetry,
}: {
  orderId: number;
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
    <p role="alert">Could not load order #{orderId}: {message}</p>
    <button
      type="button"
      className="mt-2 rounded-lg px-3 py-2 text-xs font-bold underline disabled:opacity-60"
      disabled={isRetrying}
      onClick={onRetry}
    >
      {isRetrying ? "Retrying..." : "Retry"}
    </button>
  </div>;
}
