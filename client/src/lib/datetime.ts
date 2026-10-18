export const MANILA_TIME_ZONE = "Asia/Manila";

const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MANILA_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const MANILA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MANILA_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const MANILA_TIME_ONLY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MANILA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function parseDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateManila(value: Date | string | number | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return MANILA_DATE_FORMATTER.format(date);
}

export function formatTimeManila(value: Date | string | number | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return MANILA_TIME_ONLY_FORMATTER.format(date);
}

export function formatDateTimeManila(value: Date | string | number | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return MANILA_DATE_TIME_FORMATTER.format(date);
}

export function formatRelativeTime(value: Date | string | number | null | undefined, now = new Date()): string {
  const date = parseDate(value);
  if (!date) return "—";

  const diffMs = date.getTime() - now.getTime();
  const diffMinutes = diffMs / 60000;
  const absMinutes = Math.abs(diffMinutes);

  if (absMinutes < 1) {
    const diffSeconds = diffMs / 1000;
    return RELATIVE_FORMATTER.format(Math.round(diffSeconds), "second");
  }

  if (Math.abs(diffMinutes) < 60) {
    return RELATIVE_FORMATTER.format(Math.round(diffMinutes), "minute");
  }

  const diffHours = diffMs / 3600000;
  if (Math.abs(diffHours) < 24) {
    return RELATIVE_FORMATTER.format(Math.round(diffHours), "hour");
  }

  const diffDays = diffMs / 86400000;
  return RELATIVE_FORMATTER.format(Math.round(diffDays), "day");
}
