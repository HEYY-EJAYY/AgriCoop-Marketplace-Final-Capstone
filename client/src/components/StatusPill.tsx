import * as React from "react";
import { formatEnumLabel } from "@shared/enumLabels";

export function StatusPill({ value }: { value: string }) {
  return <span className={`status-pill status-${value}`}>{formatEnumLabel(value)}</span>;
}
