import type { UsageRecord } from "./api";

/**
 * Offline usage snapshots.
 *
 * Every successful usage fetch for an enabled account is merged into a
 * persistent per-day snapshot under `sub2api_usage_snapshots_v1`. The Total
 * Usage page reads from these snapshots first, so history survives relay
 * outages: when a relay is unreachable, the last known numbers for that day
 * are still shown instead of zeroes.
 */

export interface DailyUsage {
  /** ISO date key, e.g. 2026-09-12. */
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

export interface AccountUsageSnapshot {
  accountId: string;
  /** ISO timestamp of the last successful sync. */
  lastSyncAt: string;
  /** Last fetch error (relay unreachable / auth failed), when present. */
  lastError?: string;
  days: Record<string, DailyUsage>;
}

const STORAGE_KEY = "sub2api_usage_snapshots_v1";

function loadAll(): Record<string, AccountUsageSnapshot> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, AccountUsageSnapshot>;
  } catch {
    return {};
  }
}

function persistAll(snapshots: Record<string, AccountUsageSnapshot>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
}

function toDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function getRecordTokens(record: UsageRecord): number {
  const total = toFiniteNumber(record.total_tokens);
  if (total !== null) return total;
  return (
    (toFiniteNumber(record.input_tokens) ?? 0) +
    (toFiniteNumber(record.output_tokens) ?? 0)
  );
}

function getRecordCost(record: UsageRecord): number {
  const actual = toFiniteNumber(record.actual_cost);
  if (actual !== null) return actual;
  return toFiniteNumber(record.total_cost) ?? 0;
}

function sumFinite(values: unknown[]): number {
  let total = 0;
  for (const value of values) {
    const number = toFiniteNumber(value);
    total += number === null ? 0 : number;
  }
  return total;
}

/** Merge today's fetched usage records into the account snapshot. */
export function recordUsageForAccount(
  accountId: string,
  records: UsageRecord[],
  syncDate: Date = new Date()
): AccountUsageSnapshot {
  const snapshots = loadAll();
  const existing = snapshots[accountId];
  const dateKey = toDateKey(syncDate);

  const today: DailyUsage = {
    date: dateKey,
    requests: records.length,
    inputTokens: sumFinite(records.map((record) => record.input_tokens)),
    outputTokens: sumFinite(records.map((record) => record.output_tokens)),
    totalTokens: sumFinite(records.map((record) => getRecordTokens(record))),
    cost: sumFinite(records.map((record) => getRecordCost(record))),
  };

  const next: AccountUsageSnapshot = {
    accountId,
    lastSyncAt: syncDate.toISOString(),
    days: {
      ...(existing?.days ?? {}),
      [dateKey]: today,
    },
  };

  snapshots[accountId] = next;
  persistAll(snapshots);
  return next;
}

/** Mark a failed sync for an account (keeps existing data intact). */
export function recordUsageError(accountId: string, error: string): void {
  const snapshots = loadAll();
  const existing = snapshots[accountId];
  snapshots[accountId] = {
    accountId,
    lastSyncAt: existing?.lastSyncAt ?? new Date().toISOString(),
    lastError: error,
    days: existing?.days ?? {},
  };
  persistAll(snapshots);
}

/** Number of days the Total Usage page should include in its range. */
export function getSnapshotRangeDays(): number {
  return 7;
}

/**
 * Compute per-day totals for the last N days across the given snapshots.
 * Missing days are filled with zero so charts stay stable.
 */
export function aggregateSnapshots(
  snapshots: AccountUsageSnapshot[],
  days: number = getSnapshotRangeDays()
): DailyUsage[] {
  const today = new Date();
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    keys.push(toDateKey(date));
  }

  const byKey: Record<string, DailyUsage> = {};
  for (const key of keys) {
    byKey[key] = {
      date: key,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
    };
  }

  for (const snapshot of snapshots) {
    for (const key of keys) {
      const day = snapshot.days[key];
      if (!day) continue;
      const target = byKey[key];
      target.requests += day.requests;
      target.inputTokens += day.inputTokens;
      target.outputTokens += day.outputTokens;
      target.totalTokens += day.totalTokens;
      target.cost += day.cost;
    }
  }

  return keys.map((key) => byKey[key]);
}

/** Direct lookup of the stored snapshot for a single account. */
export function getAccountSnapshot(accountId: string): AccountUsageSnapshot | null {
  return loadAll()[accountId] ?? null;
}
