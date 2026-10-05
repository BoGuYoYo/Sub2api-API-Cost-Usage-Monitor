/**
 * Locale-aware display helpers, shared by every page so the same number is
 * formatted the same way everywhere.
 */
import { getLocale } from "./i18n";

function localeTag(): string {
  return getLocale() === "zh" ? "zh-CN" : "en-US";
}

/** Compact counts used for tokens and requests: 1.23M / 1.23K / 1,234. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "---";
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(2) + "K";
  return value.toLocaleString(localeTag());
}

/** Costs are always shown in USD with four decimals. */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "$---";
  return "$" + value.toFixed(4);
}

/** ISO date key (YYYY-MM-DD) for API range parameters and per-day keys. */
export function formatDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Short localized date + time, or an empty string when there is no value. */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "";
  }
  return date.toLocaleString(localeTag(), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Wall-clock time for "updated at" lines. */
export function formatClock(value: Date): string {
  return value.toLocaleTimeString(localeTag());
}
