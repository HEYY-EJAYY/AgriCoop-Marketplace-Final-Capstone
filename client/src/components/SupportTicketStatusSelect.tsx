import * as React from "react";
import {
  getSupportTicketStatusOptions,
  isSupportTicketStatus,
  type SupportTicketStatus,
} from "../../../shared/supportTicketStatus";
import { formatEnumLabel } from "@shared/enumLabels";

export function SupportTicketStatusSelect({
  status,
  disabled,
  onChange,
}: {
  status: string;
  disabled: boolean;
  onChange: (status: SupportTicketStatus) => void;
}) {
  if (!isSupportTicketStatus(status)) {
    return <span role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
      Unsupported ticket status: {status}
    </span>;
  }

  if (status === "closed") {
    return <span className="rounded-xl bg-[#f2f6ef] px-3 py-2 text-sm font-bold text-[#315640]">
      Closed
    </span>;
  }

  return <select
    className="field-control"
    value={status}
    disabled={disabled}
    onChange={event => {
      if (isSupportTicketStatus(event.currentTarget.value)) onChange(event.currentTarget.value);
    }}
  >
    {getSupportTicketStatusOptions(status).map(option => (
      <option key={option} value={option}>{formatEnumLabel(option)}</option>
    ))}
  </select>;
}
