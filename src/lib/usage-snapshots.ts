import type { DashboardStats, UsageRecord } from "./api";

/**
 * Local usage history.
 *
 * The relay is treated as an *event source*, never as the source of truth for
 * historical totals: some relays clear or rotate their usage data, and copying
 * those numbers straight into the app made the user's history disappear.
 *
 * On every successful sync the app compares the relay's all-time counters with
 * the last values it saw and adds only the positive difference to `local`,
 * which therefore never decreases:
 *
 *   local.total += max(0, relay.total - lastSeenRelayTotal)
 *
 * When the relay reports a lower total than before (data cleared, database
 * reset, account rotated) the app keeps the local total, re-bases the baseline
 * on the lower number, and records the event in `lastReset` so the UI can say
 * what happened. A brand new account seeds `local` from the relay's all-time
 * totals so history from before the app was installed is still counted.
 *
 * Per-day records (`days`) are merged with a monotonic maximum per field for the
 * same reason: a cleared relay must not erase a day that was already observed.
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

export interface AccountCumulative {
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  todayTokens: number;
  todayRequests: number;
  todayCost: number;
}

/** The last time the relay reported lower all-time totals than before. */
export interface ResetRecord {
  detectedAt: string;
  /** Totals the relay reported before the drop. */
  previousTokens: number;
  previousRequests: number;
  previousCost: number;
  /** Totals the relay reported after the drop. */
  reportedTokens: number;
  reportedRequests: number;
  reportedCost: number;
  /** How many drops have been observed for this account. */
  count: number;
}

export interface AccountUsageSnapshot {
  accountId: string;
  /** ISO timestamp of the last successful sync. */
  lastSyncAt: string;
  /** Last fetch error (relay unreachable / auth failed), when present. */
  lastError?: string;
  /** Local, monotonically increasing all-time totals. The headline numbers. */
  local: AccountCumulative;
  /** Totals the relay reported during the last successful sync. */
  cumulative: AccountCumulative;
  /** True once `local` was seeded from the relay (or an older snapshot). */
  seeded: boolean;
  /** Last time the relay's counters dropped. */
  lastReset?: ResetRecord;
  /** Number of drops observed for this account. */
  resetCount: number;
  /** Per-day usage observed locally, merged with a monotonic maximum. */
  days: Record<string, DailyUsage>;
}

const STORAGE_KEY = "sub2api_usage_snapshots_v3";
/** Snapshots written by earlier versions, migrated on first read. */
const LEGACY_STORAGE_KEYS = [
  "sub2api_usage_snapshots_v2",
  "sub2api_usage_snapshots_v1",
];

const TOKEN_DROP_TOLERANCE = 2;
const COST_DROP_TOLERANCE = 1e-6;
/** Fraction of the previous value that must be lost before it counts as a reset. */
const RELATIVE_DROP_TOLERANCE = 0.005;

function loadAll(): Record<string, AccountUsageSnapshot> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, AccountUsageSnapshot>;
      }
    }
  } catch {
    // Fall through to the legacy lookup.
  }
  const migrated = migrateLegacySnapshots();
  if (Object.keys(migrated).length > 0) {
    persistAll(migrated);
  }
  return migrated;
}

function persistAll(snapshots: Record<string, AccountUsageSnapshot>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // A full or unavailable store must never break a usage sync.
  }
}

/** Import v1/v2 snapshots (server totals were copied verbatim) as local totals. */
function migrateLegacySnapshots(): Record<string, AccountUsageSnapshot> {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const entries = Object.entries(parsed as Record<string, AccountUsageSnapshot>);
      if (entries.length === 0) continue;

      const migrated: Record<string, AccountUsageSnapshot> = {};
      for (const [accountId, snapshot] of entries) {
        if (!snapshot || typeof snapshot !== "object") continue;
        const cumulative = normalizeCumulative(snapshot.cumulative);
        migrated[accountId] = {
          accountId: snapshot.accountId ?? accountId,
          lastSyncAt: snapshot.lastSyncAt ?? new Date().toISOString(),
          lastError: snapshot.lastError,
          local: readNamedCumulative(snapshot.local) ?? cumulative,
          cumulative,
          seeded: true,
          resetCount: typeof snapshot.resetCount === "number" ? snapshot.resetCount : 0,
          days: snapshot.days && typeof snapshot.days === "object" ? snapshot.days : {},
        };
      }
      if (Object.keys(migrated).length > 0) return migrated;
    } catch {
      // Try the next legacy key.
    }
  }
  return {};
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

export function emptyCumulative(): AccountCumulative {
  return {
    totalTokens: 0,
    totalRequests: 0,
    totalCost: 0,
    todayTokens: 0,
    todayRequests: 0,
    todayCost: 0,
  };
}

function readNamedCumulative(value: unknown): AccountCumulative | null {
  if (!value || typeof value !== "object") return null;
  return normalizeCumulative(value as Partial<AccountCumulative>);
}

function normalizeCumulative(value: Partial<AccountCumulative> | undefined): AccountCumulative {
  return {
    totalTokens: toFiniteNumber(value?.totalTokens) ?? 0,
    totalRequests: toFiniteNumber(value?.totalRequests) ?? 0,
    totalCost: toFiniteNumber(value?.totalCost) ?? 0,
    todayTokens: toFiniteNumber(value?.todayTokens) ?? 0,
    todayRequests: toFiniteNumber(value?.todayRequests) ?? 0,
    todayCost: toFiniteNumber(value?.todayCost) ?? 0,
  };
}

function toFiniteNumberOrZero(value: unknown): number {
  return toFiniteNumber(value) ?? 0;
}

/** Coerce a possibly corrupt per-day map (old files, hand-edited backups). */
export function normalizeDays(value: unknown): Record<string, DailyUsage> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const days: Record<string, DailyUsage> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const day = raw as Partial<DailyUsage>;
    days[key] = {
      date: typeof day.date === "string" ? day.date : key,
      requests: toFiniteNumberOrZero(day.requests),
      inputTokens: toFiniteNumberOrZero(day.inputTokens),
      outputTokens: toFiniteNumberOrZero(day.outputTokens),
      totalTokens: toFiniteNumberOrZero(day.totalTokens),
      cost: toFiniteNumberOrZero(day.cost),
    };
  }
  return days;
}

function emptySnapshot(accountId: string, syncDate: Date = new Date()): AccountUsageSnapshot {
  return {
    accountId,
    lastSyncAt: syncDate.toISOString(),
    local: emptyCumulative(),
    cumulative: emptyCumulative(),
    seeded: false,
    resetCount: 0,
    days: {},
  };
}

/** True when a drop is large enough to be a real reset instead of noise. */
function isResetDrop(previous: number, current: number, tolerance: number): boolean {
  if (current >= previous) return false;
  const drop = previous - current;
  return drop >= Math.max(tolerance, previous * RELATIVE_DROP_TOLERANCE);
}

export interface SyncResult {
  snapshot: AccountUsageSnapshot;
  /** Usage added to the local totals by this sync. */
  deltaTokens: number;
  deltaRequests: number;
  deltaCost: number;
  /** True when the relay reported lower totals than the previous sync. */
  resetDetected: boolean;
}

/**
 * Fold a relay dashboard reading into the account's local history.
 *
 * `local` only grows: the relay's counters are diffed against the previous
 * reading and the positive part is added, so a relay that clears its data can
 * no longer wipe the user's totals.
 */
export function syncAccountStats(
  accountId: string,
  stats: DashboardStats,
  syncDate: Date = new Date()
): SyncResult {
  const snapshots = loadAll();
  const existing = snapshots[accountId];
  const base = existing ?? emptySnapshot(accountId, syncDate);

  const server: AccountCumulative = {
    totalTokens: toFiniteNumber(stats.total_tokens) ?? 0,
    totalRequests: toFiniteNumber(stats.total_requests) ?? 0,
    totalCost: toFiniteNumber(stats.total_actual_cost) ?? 0,
    todayTokens: toFiniteNumber(stats.today_tokens) ?? 0,
    todayRequests: toFiniteNumber(stats.today_requests) ?? 0,
    todayCost: toFiniteNumber(stats.today_actual_cost) ?? 0,
  };

  const previous = normalizeCumulative(base.cumulative);
  const previousLocal = normalizeCumulative(base.local);

  let local: AccountCumulative;
  let deltaTokens = 0;
  let deltaRequests = 0;
  let deltaCost = 0;

  if (!base.seeded) {
    // First reading for this account: adopt the relay's all-time totals so
    // usage that predates the app still counts. Today's counters stay with the
    // server view in `cumulative`.
    local = { ...server, todayTokens: 0, todayRequests: 0, todayCost: 0 };
  } else {
    deltaTokens = Math.max(0, server.totalTokens - previous.totalTokens);
    deltaRequests = Math.max(0, server.totalRequests - previous.totalRequests);
    deltaCost = Math.max(0, server.totalCost - previous.totalCost);
    local = {
      ...previousLocal,
      totalTokens: previousLocal.totalTokens + deltaTokens,
      totalRequests: previousLocal.totalRequests + deltaRequests,
      totalCost: previousLocal.totalCost + deltaCost,
    };
  }

  // A local total always covers at least what the relay currently reports.
  local.totalTokens = Math.max(local.totalTokens, server.totalTokens);
  local.totalRequests = Math.max(local.totalRequests, server.totalRequests);
  local.totalCost = Math.max(local.totalCost, server.totalCost);

  const resetDetected =
    base.seeded &&
    (isResetDrop(previous.totalTokens, server.totalTokens, TOKEN_DROP_TOLERANCE) ||
      isResetDrop(previous.totalRequests, server.totalRequests, TOKEN_DROP_TOLERANCE) ||
      isResetDrop(previous.totalCost, server.totalCost, COST_DROP_TOLERANCE));

  const resetCount = (base.resetCount ?? 0) + (resetDetected ? 1 : 0);
  const next: AccountUsageSnapshot = {
    ...base,
    accountId,
    lastSyncAt: syncDate.toISOString(),
    lastError: undefined,
    local,
    cumulative: server,
    seeded: true,
    resetCount,
    lastReset: resetDetected
      ? {
          detectedAt: syncDate.toISOString(),
          previousTokens: previous.totalTokens,
          previousRequests: previous.totalRequests,
          previousCost: previous.totalCost,
          reportedTokens: server.totalTokens,
          reportedRequests: server.totalRequests,
          reportedCost: server.totalCost,
          count: resetCount,
        }
      : base.lastReset,
    days: base.days ?? {},
  };

  snapshots[accountId] = next;
  persistAll(snapshots);
  return { snapshot: next, deltaTokens, deltaRequests, deltaCost, resetDetected };
}

/** Keep the largest value seen for each field so cleared records cannot win. */
function mergeDailyUsage(
  previous: DailyUsage | undefined,
  incoming: DailyUsage
): DailyUsage {
  if (!previous) return incoming;
  return {
    date: incoming.date,
    requests: Math.max(previous.requests, incoming.requests),
    inputTokens: Math.max(previous.inputTokens, incoming.inputTokens),
    outputTokens: Math.max(previous.outputTokens, incoming.outputTokens),
    totalTokens: Math.max(previous.totalTokens, incoming.totalTokens),
    cost: Math.max(previous.cost, incoming.cost),
  };
}

/** Merge the fetched usage records into the per-day chart data. */
export function recordUsageForAccount(
  accountId: string,
  records: UsageRecord[],
  syncDate: Date = new Date()
): AccountUsageSnapshot {
  const snapshots = loadAll();
  const existing = snapshots[accountId];
  const base = existing ?? emptySnapshot(accountId, syncDate);
  const dateKey = toDateKey(syncDate);

  const observed: DailyUsage = {
    date: dateKey,
    requests: records.length,
    inputTokens: sumFinite(records.map((record) => record.input_tokens)),
    outputTokens: sumFinite(records.map((record) => record.output_tokens)),
    totalTokens: sumFinite(records.map((record) => getRecordTokens(record))),
    cost: sumFinite(records.map((record) => getRecordCost(record))),
  };

  const days = { ...normalizeDays(base.days) };
  days[dateKey] = mergeDailyUsage(days[dateKey], observed);

  const next: AccountUsageSnapshot = {
    ...base,
    accountId,
    lastSyncAt: syncDate.toISOString(),
    lastError: undefined,
    local: normalizeCumulative(base.local),
    cumulative: normalizeCumulative(base.cumulative),
    seeded: base.seeded ?? false,
    resetCount: base.resetCount ?? 0,
    days,
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
    ...(existing ?? emptySnapshot(accountId)),
    lastError: error,
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
    const dayMap = normalizeDays(snapshot?.days);
    for (const key of keys) {
      const day = dayMap[key];
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
  const snapshot = loadAll()[accountId];
  if (!snapshot) return null;
  return {
    ...snapshot,
    local: normalizeCumulative(snapshot.local),
    cumulative: normalizeCumulative(snapshot.cumulative),
    seeded: snapshot.seeded ?? false,
    resetCount: snapshot.resetCount ?? 0,
    days: normalizeDays(snapshot.days),
  };
}

/** Local, accumulated totals (the headline numbers, never decrease). */
export function getLocalCumulative(
  snapshot: AccountUsageSnapshot | null | undefined
): AccountCumulative {
  return normalizeCumulative(snapshot?.local);
}

/** What the relay currently reports (used as the secondary display). */
export function getServerCumulative(
  snapshot: AccountUsageSnapshot | null | undefined
): AccountCumulative {
  return normalizeCumulative(snapshot?.cumulative);
}

/** Sum of the local accumulated totals across accounts. */
export function sumLocalCumulative(snapshots: AccountUsageSnapshot[]): AccountCumulative {
  const total = emptyCumulative();
  for (const snapshot of snapshots) {
    const local = getLocalCumulative(snapshot);
    total.totalTokens += local.totalTokens;
    total.totalRequests += local.totalRequests;
    total.totalCost += local.totalCost;
    total.todayTokens += local.todayTokens;
    total.todayRequests += local.todayRequests;
    total.todayCost += local.todayCost;
  }
  return total;
}

/** Every stored snapshot, keyed by account id (used by backup/restore). */
export function loadAllSnapshots(): Record<string, AccountUsageSnapshot> {
  return loadAll();
}

/** Persist a full snapshot map (used by backup/restore). */
export function saveAllSnapshots(
  snapshots: Record<string, AccountUsageSnapshot>
): void {
  persistAll(snapshots);
}

/**
 * Combine two snapshots of the same account without losing data.
 *
 * Totals keep the larger value per field, and the relay baseline does too: a
 * higher baseline means those deltas were already counted locally, so the next
 * sync only adds genuinely new usage.
 */
export function mergeAccountSnapshot(
  current: AccountUsageSnapshot | undefined,
  incoming: AccountUsageSnapshot | undefined
): AccountUsageSnapshot | null {
  if (!current) return incoming ?? null;
  if (!incoming) return current;

  const pickHigher = (a: number, b: number) => Math.max(a, b);
  const currentLocal = normalizeCumulative(current.local);
  const incomingLocal = normalizeCumulative(incoming.local);
  const currentServer = normalizeCumulative(current.cumulative);
  const incomingServer = normalizeCumulative(incoming.cumulative);

  const days: Record<string, DailyUsage> = { ...normalizeDays(current.days) };
  for (const [key, day] of Object.entries(normalizeDays(incoming.days))) {
    days[key] = mergeDailyUsage(days[key], day);
  }

  const currentReset = current.lastReset;
  const incomingReset = incoming.lastReset;
  const lastReset =
    (incomingReset?.detectedAt ?? "") > (currentReset?.detectedAt ?? "")
      ? incomingReset
      : currentReset;

  const newerLastSync =
    (incoming.lastSyncAt ?? "") > (current.lastSyncAt ?? "")
      ? incoming.lastSyncAt
      : current.lastSyncAt;

  return {
    accountId: current.accountId || incoming.accountId,
    lastSyncAt: newerLastSync,
    lastError: current.lastError ?? incoming.lastError,
    local: {
      totalTokens: pickHigher(currentLocal.totalTokens, incomingLocal.totalTokens),
      totalRequests: pickHigher(currentLocal.totalRequests, incomingLocal.totalRequests),
      totalCost: pickHigher(currentLocal.totalCost, incomingLocal.totalCost),
      todayTokens: pickHigher(currentLocal.todayTokens, incomingLocal.todayTokens),
      todayRequests: pickHigher(currentLocal.todayRequests, incomingLocal.todayRequests),
      todayCost: pickHigher(currentLocal.todayCost, incomingLocal.todayCost),
    },
    cumulative: {
      totalTokens: pickHigher(currentServer.totalTokens, incomingServer.totalTokens),
      totalRequests: pickHigher(currentServer.totalRequests, incomingServer.totalRequests),
      totalCost: pickHigher(currentServer.totalCost, incomingServer.totalCost),
      todayTokens: pickHigher(currentServer.todayTokens, incomingServer.todayTokens),
      todayRequests: pickHigher(currentServer.todayRequests, incomingServer.todayRequests),
      todayCost: pickHigher(currentServer.todayCost, incomingServer.todayCost),
    },
    seeded: Boolean(current.seeded || incoming.seeded),
    lastReset,
    resetCount: Math.max(current.resetCount ?? 0, incoming.resetCount ?? 0),
    days,
  };
}

/** Merge a full snapshot map, keeping the larger totals for every account. */
export function mergeSnapshotMaps(
  existing: Record<string, AccountUsageSnapshot>,
  incoming: Record<string, AccountUsageSnapshot>
): Record<string, AccountUsageSnapshot> {
  const merged: Record<string, AccountUsageSnapshot> = { ...existing };
  for (const [accountId, snapshot] of Object.entries(incoming)) {
    const combined = mergeAccountSnapshot(merged[accountId], snapshot);
    if (combined) merged[accountId] = combined;
  }
  return merged;
}
