import { formatDateKey } from "./format";
import {
  normalizeModelName,
  type ModelUsageRankingRow,
  type UsageRange,
  getUsageRangeBounds,
} from "./model-usage";

/**
 * Local per-account model usage history.
 *
 * Mirrors `usage-snapshots.ts` so Model Usage Ranking stays accurate when:
 *   1. One or more accounts are offline / have expired sessions — their last
 *      saved model rankings remain included rather than disappearing.
 *   2. A relay clears or rotates its usage data — `"all"` accumulates
 *      monotonically (`local += max(0, server - prevServer)`), `"today"`
 *      accumulates monotonically within the same calendar day, and `"7d"` /
 *      `"30d"` preserve pre-reset usage as a carry-over until the sliding
 *      window ages past the reset date.
 *   3. A backup is exported/imported — `mergeModelSnapshotMaps` merges
 *      snapshots without shrinking local history.
 */

export interface ModelTotals {
  totalTokens: number;
  requests: number;
  cost: number;
}

export interface StoredModelEntry {
  /** Normalized display name, or empty string when `isUnknown` is true. */
  model: string;
  isUnknown?: boolean;
  /** Locally preserved/accumulated totals shown in the ranking. */
  local: ModelTotals;
  /** Totals last reported by the relay (baseline for future diffs). */
  server: ModelTotals;
}

export interface ModelResetRecord {
  detectedAt: string;
  previousTokens: number;
  previousRequests: number;
  previousCost: number;
  reportedTokens: number;
  reportedRequests: number;
  reportedCost: number;
  count: number;
}

export interface WindowCarryOver {
  /** Local ISO date (YYYY-MM-DD) of the reset. */
  resetDate: string;
  /** ISO timestamp of the reset that produced this carry-over. */
  resetAt: string;
  models: Record<
    string,
    {
      model: string;
      isUnknown?: boolean;
      totals: ModelTotals;
    }
  >;
}

export interface RangeModelSnapshot {
  range: UsageRange;
  windowStartDate: string;
  windowEndDate: string;
  lastSyncAt: string;
  seeded: boolean;
  truncated?: boolean;
  models: Record<string, StoredModelEntry>;
  carryOver?: WindowCarryOver;
  lastAppliedResetAt?: string;
}

export interface AccountModelSnapshot {
  accountId: string;
  lastSyncAt: string;
  lastError?: string;
  resetCount: number;
  lastReset?: ModelResetRecord;
  ranges: Partial<Record<UsageRange, RangeModelSnapshot>>;
}

const STORAGE_KEY = "sub2api_model_snapshots_v1";
const UNKNOWN_MODEL_KEY = "__unknown_model__";

const TOKEN_DROP_TOLERANCE = 2;
const COST_DROP_TOLERANCE = 1e-6;
/** Same reset threshold used by `usage-snapshots.ts`. */
const RELATIVE_DROP_TOLERANCE = 0.005;

function toFiniteOrZero(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function emptyTotals(): ModelTotals {
  return { totalTokens: 0, requests: 0, cost: 0 };
}

function normalizeTotals(value: Partial<ModelTotals> | undefined): ModelTotals {
  return {
    totalTokens: toFiniteOrZero(value?.totalTokens),
    requests: toFiniteOrZero(value?.requests),
    cost: toFiniteOrZero(value?.cost),
  };
}

function addTotals(a: ModelTotals, b: ModelTotals): ModelTotals {
  return {
    totalTokens: a.totalTokens + b.totalTokens,
    requests: a.requests + b.requests,
    cost: a.cost + b.cost,
  };
}

function maxTotals(a: ModelTotals, b: ModelTotals): ModelTotals {
  return {
    totalTokens: Math.max(a.totalTokens, b.totalTokens),
    requests: Math.max(a.requests, b.requests),
    cost: Math.max(a.cost, b.cost),
  };
}

function hasAnyUsage(totals: ModelTotals): boolean {
  return totals.totalTokens > 0 || totals.requests > 0 || totals.cost > 0;
}

function modelKeyAndName(
  rawModel: string,
  isUnknown?: boolean
): { key: string; model: string; isUnknown: boolean } {
  if (isUnknown) {
    return { key: UNKNOWN_MODEL_KEY, model: "", isUnknown: true };
  }
  const normalized = normalizeModelName(rawModel);
  if (!normalized) {
    return { key: UNKNOWN_MODEL_KEY, model: "", isUnknown: true };
  }
  return { key: normalized, model: normalized, isUnknown: false };
}

function normalizeModelMap(
  raw: unknown
): Record<string, StoredModelEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, StoredModelEntry> = {};

  for (const [entryKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Partial<StoredModelEntry>;
    const inferredUnknown =
      Boolean(item.isUnknown) || entryKey === UNKNOWN_MODEL_KEY;
    const { key, model, isUnknown } = modelKeyAndName(
      typeof item.model === "string" ? item.model : entryKey,
      inferredUnknown
    );
    const local = normalizeTotals(item.local);
    const server = normalizeTotals(item.server);
    const existing = result[key];
    if (existing) {
      existing.local = addTotals(existing.local, local);
      existing.server = addTotals(existing.server, server);
    } else {
      result[key] = { model, isUnknown, local, server };
    }
  }
  return result;
}

function normalizeCarryOver(raw: unknown): WindowCarryOver | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidate = raw as Partial<WindowCarryOver>;
  if (typeof candidate.resetDate !== "string" || !candidate.resetDate) {
    return undefined;
  }
  const models: WindowCarryOver["models"] = {};
  if (candidate.models && typeof candidate.models === "object") {
    for (const [entryKey, value] of Object.entries(candidate.models)) {
      if (!value || typeof value !== "object") continue;
      const item = value as {
        model?: unknown;
        isUnknown?: unknown;
        totals?: Partial<ModelTotals>;
      };
      const inferredUnknown =
        Boolean(item.isUnknown) || entryKey === UNKNOWN_MODEL_KEY;
      const { key, model, isUnknown } = modelKeyAndName(
        typeof item.model === "string" ? item.model : entryKey,
        inferredUnknown
      );
      const totals = normalizeTotals(item.totals);
      if (!hasAnyUsage(totals)) continue;
      const existing = models[key];
      if (existing) {
        existing.totals = addTotals(existing.totals, totals);
      } else {
        models[key] = { model, isUnknown, totals };
      }
    }
  }
  if (Object.keys(models).length === 0) return undefined;
  return {
    resetDate: candidate.resetDate,
    resetAt: typeof candidate.resetAt === "string" ? candidate.resetAt : "",
    models,
  };
}

function normalizeRangeSnapshot(
  range: UsageRange,
  raw: unknown
): RangeModelSnapshot | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidate = raw as Partial<RangeModelSnapshot>;
  return {
    range,
    windowStartDate:
      typeof candidate.windowStartDate === "string" ? candidate.windowStartDate : "",
    windowEndDate:
      typeof candidate.windowEndDate === "string" ? candidate.windowEndDate : "",
    lastSyncAt:
      typeof candidate.lastSyncAt === "string" ? candidate.lastSyncAt : "",
    seeded: Boolean(candidate.seeded),
    truncated: Boolean(candidate.truncated) || undefined,
    models: normalizeModelMap(candidate.models),
    carryOver: normalizeCarryOver(candidate.carryOver),
    lastAppliedResetAt:
      typeof candidate.lastAppliedResetAt === "string"
        ? candidate.lastAppliedResetAt
        : undefined,
  };
}

function normalizeAccountModelSnapshot(
  accountId: string,
  raw: unknown
): AccountModelSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Partial<AccountModelSnapshot>;
  const ranges: Partial<Record<UsageRange, RangeModelSnapshot>> = {};
  if (candidate.ranges && typeof candidate.ranges === "object") {
    for (const range of ["today", "7d", "30d", "all"] as const) {
      const normalized = normalizeRangeSnapshot(range, candidate.ranges[range]);
      if (normalized) ranges[range] = normalized;
    }
  }
  return {
    accountId:
      typeof candidate.accountId === "string" && candidate.accountId
        ? candidate.accountId
        : accountId,
    lastSyncAt:
      typeof candidate.lastSyncAt === "string" ? candidate.lastSyncAt : "",
    lastError:
      typeof candidate.lastError === "string" ? candidate.lastError : undefined,
    resetCount:
      typeof candidate.resetCount === "number" && Number.isFinite(candidate.resetCount)
        ? candidate.resetCount
        : 0,
    lastReset: candidate.lastReset,
    ranges,
  };
}

function emptyAccountSnapshot(
  accountId: string,
  syncDate: Date = new Date()
): AccountModelSnapshot {
  return {
    accountId,
    lastSyncAt: syncDate.toISOString(),
    resetCount: 0,
    ranges: {},
  };
}

function loadAll(): Record<string, AccountModelSnapshot> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, AccountModelSnapshot> = {};
    for (const [accountId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const normalized = normalizeAccountModelSnapshot(accountId, value);
      if (normalized) result[accountId] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

function persistAll(snapshots: Record<string, AccountModelSnapshot>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // A full or unavailable store must never break model ranking.
  }
}

function rowsToServerMap(
  rows: ModelUsageRankingRow[]
): Record<string, { model: string; isUnknown: boolean; totals: ModelTotals }> {
  const map: Record<string, { model: string; isUnknown: boolean; totals: ModelTotals }> = {};
  for (const row of rows) {
    const { key, model, isUnknown } = modelKeyAndName(row.model, row.isUnknown);
    const totals: ModelTotals = {
      totalTokens: toFiniteOrZero(row.totalTokens),
      requests: toFiniteOrZero(row.requests),
      cost: toFiniteOrZero(row.cost),
    };
    const existing = map[key];
    if (existing) {
      existing.totals = addTotals(existing.totals, totals);
    } else {
      map[key] = { model, isUnknown, totals };
    }
  }
  return map;
}

function sumModelMap(
  models: Record<string, StoredModelEntry> | undefined,
  field: "local" | "server"
): ModelTotals {
  const total = emptyTotals();
  if (!models) return total;
  for (const entry of Object.values(models)) {
    const value = entry[field];
    total.totalTokens += value.totalTokens;
    total.requests += value.requests;
    total.cost += value.cost;
  }
  return total;
}

function sumServerInput(
  map: Record<string, { model: string; isUnknown: boolean; totals: ModelTotals }>
): ModelTotals {
  const total = emptyTotals();
  for (const item of Object.values(map)) {
    total.totalTokens += item.totals.totalTokens;
    total.requests += item.totals.requests;
    total.cost += item.totals.cost;
  }
  return total;
}

function isResetDrop(previous: number, current: number, tolerance: number): boolean {
  if (current >= previous) return false;
  const drop = previous - current;
  return drop >= Math.max(tolerance, previous * RELATIVE_DROP_TOLERANCE);
}

function entriesToRows(
  models: Record<string, StoredModelEntry>,
  unknownModelLabel: string,
  overrideCarry?: WindowCarryOver,
  useServerOnly: boolean = false
): ModelUsageRankingRow[] {
  const rawRows: Array<Omit<ModelUsageRankingRow, "share">> = [];

  for (const [key, entry] of Object.entries(models)) {
    const totals = useServerOnly
      ? entry.server
      : overrideCarry
        ? addTotals(overrideCarry.models[key]?.totals ?? emptyTotals(), entry.server)
        : entry.local;
    if (!hasAnyUsage(totals)) continue;
    rawRows.push({
      model: entry.isUnknown ? unknownModelLabel : entry.model,
      totalTokens: totals.totalTokens,
      requests: totals.requests,
      cost: totals.cost,
      isUnknown: entry.isUnknown || undefined,
    });
  }

  if (overrideCarry) {
    for (const [key, carry] of Object.entries(overrideCarry.models)) {
      if (models[key]) continue;
      if (!hasAnyUsage(carry.totals)) continue;
      rawRows.push({
        model: carry.isUnknown ? unknownModelLabel : carry.model,
        totalTokens: carry.totals.totalTokens,
        requests: carry.totals.requests,
        cost: carry.totals.cost,
        isUnknown: carry.isUnknown || undefined,
      });
    }
  }

  const totalTokens = rawRows.reduce((sum, row) => sum + row.totalTokens, 0);
  return rawRows
    .map((row) => ({
      ...row,
      share: totalTokens > 0 ? (row.totalTokens / totalTokens) * 100 : 0,
    }))
    .sort(
      (a, b) =>
        b.totalTokens - a.totalTokens ||
        b.cost - a.cost ||
        b.requests - a.requests ||
        a.model.localeCompare(b.model)
    );
}

export interface ModelSyncOptions {
  syncDate?: Date;
  truncated?: boolean;
  /** Reset timestamp detected externally (e.g. from `usage-snapshots`). */
  externalResetAt?: string;
}

export interface ModelSyncResult {
  snapshot: AccountModelSnapshot;
  rangeSnapshot: RangeModelSnapshot;
  rows: ModelUsageRankingRow[];
  serverTotals: ModelTotals;
  localTotals: ModelTotals;
  resetDetected: boolean;
}

/**
 * Fold a relay model ranking response for one account and range into local
 * offline history.
 */
export function syncAccountModelUsage(
  accountId: string,
  range: UsageRange,
  rows: ModelUsageRankingRow[],
  unknownModelLabel: string,
  options: ModelSyncOptions = {}
): ModelSyncResult {
  const syncDate = options.syncDate ?? new Date();
  const syncTimestamp = syncDate.toISOString();
  const bounds = getUsageRangeBounds(range, syncDate);
  const windowStart = bounds.startDate ?? "1970-01-01";
  const windowEnd = bounds.endDate ?? formatDateKey(syncDate);

  const allSnapshots = loadAll();
  const base = allSnapshots[accountId] ?? emptyAccountSnapshot(accountId, syncDate);
  const prevRange = base.ranges[range];

  // Stale response guard: do not let a slower, older response move the relay
  // baseline backwards.
  if (prevRange?.lastSyncAt && prevRange.lastSyncAt > syncTimestamp) {
    const resolvedRows = entriesToRows(prevRange.models, unknownModelLabel);
    return {
      snapshot: base,
      rangeSnapshot: prevRange,
      rows: resolvedRows,
      serverTotals: sumModelMap(prevRange.models, "server"),
      localTotals: sumModelMap(prevRange.models, "local"),
      resetDetected: false,
    };
  }

  const incomingMap = rowsToServerMap(rows);
  const incomingSum = sumServerInput(incomingMap);
  const truncated = Boolean(options.truncated);

  let nextRange: RangeModelSnapshot;
  let resetDetected = false;
  let prevSum = emptyTotals();

  if (range === "all" || range === "today") {
    const sameSeries =
      Boolean(prevRange?.seeded) &&
      (range === "all" || prevRange?.windowEndDate === windowEnd);
    const prevModels = sameSeries ? (prevRange?.models ?? {}) : {};
    prevSum = sumModelMap(prevModels, "server");

    const nextModels: Record<string, StoredModelEntry> = {};
    const allKeys = new Set([
      ...Object.keys(prevModels),
      ...Object.keys(incomingMap),
    ]);

    for (const key of allKeys) {
      const prevEntry = prevModels[key];
      const inc = incomingMap[key];
      const incomingServer = inc?.totals ?? emptyTotals();
      const model = inc?.model ?? prevEntry?.model ?? "";
      const isUnknown = inc?.isUnknown ?? prevEntry?.isUnknown ?? false;

      let local: ModelTotals;
      let server: ModelTotals;

      if (!sameSeries) {
        local = incomingServer;
        server = incomingServer;
      } else {
        const prevServer = prevEntry?.server ?? emptyTotals();
        const prevLocal = prevEntry?.local ?? emptyTotals();
        const deltaTokens = Math.max(0, incomingServer.totalTokens - prevServer.totalTokens);
        const deltaRequests = Math.max(0, incomingServer.requests - prevServer.requests);
        const deltaCost = Math.max(0, incomingServer.cost - prevServer.cost);
        local = maxTotals(
          {
            totalTokens: prevLocal.totalTokens + deltaTokens,
            requests: prevLocal.requests + deltaRequests,
            cost: prevLocal.cost + deltaCost,
          },
          incomingServer
        );
        // When paginated fallback hit the page cap, avoid shrinking the server
        // baseline to an incomplete slice.
        server = truncated ? maxTotals(prevServer, incomingServer) : incomingServer;
      }

      if (hasAnyUsage(local) || hasAnyUsage(server)) {
        nextModels[key] = { model, isUnknown, local, server };
      }
    }

    resetDetected =
      sameSeries &&
      !truncated &&
      (isResetDrop(prevSum.totalTokens, incomingSum.totalTokens, TOKEN_DROP_TOLERANCE) ||
        isResetDrop(prevSum.requests, incomingSum.requests, TOKEN_DROP_TOLERANCE) ||
        isResetDrop(prevSum.cost, incomingSum.cost, COST_DROP_TOLERANCE));

    nextRange = {
      range,
      windowStartDate: windowStart,
      windowEndDate: windowEnd,
      lastSyncAt: syncTimestamp,
      seeded: true,
      truncated: truncated || undefined,
      models: nextModels,
    };
  } else {
    // Sliding windows ("7d" and "30d"): update directly from relay unless a
    // relay reset occurred since the last sync of this window, in which case
    // preserve pre-reset usage as a carry-over until the window ages past it.
    let carryOver =
      prevRange?.carryOver && windowStart <= prevRange.carryOver.resetDate
        ? prevRange.carryOver
        : undefined;
    let lastAppliedResetAt = prevRange?.lastAppliedResetAt;

    const candidateResetAt = [
      options.externalResetAt,
      base.lastReset?.detectedAt,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort()
      .pop();

    prevSum = sumModelMap(prevRange?.models, "server");
    const serverDropped =
      incomingSum.totalTokens < prevSum.totalTokens ||
      incomingSum.requests < prevSum.requests ||
      incomingSum.cost < prevSum.cost;

    if (
      prevRange?.seeded &&
      !truncated &&
      candidateResetAt &&
      candidateResetAt > prevRange.lastSyncAt &&
      candidateResetAt > (lastAppliedResetAt ?? "") &&
      serverDropped
    ) {
      const preserved: WindowCarryOver["models"] = {};
      for (const [key, entry] of Object.entries(prevRange.models)) {
        if (!hasAnyUsage(entry.local)) continue;
        preserved[key] = {
          model: entry.model,
          isUnknown: entry.isUnknown,
          totals: entry.local,
        };
      }
      if (Object.keys(preserved).length > 0) {
        const parsedReset = new Date(candidateResetAt);
        const resetDate = Number.isNaN(parsedReset.getTime())
          ? windowEnd
          : formatDateKey(parsedReset);
        if (windowStart <= resetDate) {
          carryOver = {
            resetDate,
            resetAt: candidateResetAt,
            models: preserved,
          };
          lastAppliedResetAt = candidateResetAt;
        }
      }
    }

    const nextModels: Record<string, StoredModelEntry> = {};
    const allKeys = new Set([
      ...Object.keys(carryOver?.models ?? {}),
      ...Object.keys(incomingMap),
    ]);

    for (const key of allKeys) {
      const carry = carryOver?.models[key];
      const inc = incomingMap[key];
      const incomingServer = inc?.totals ?? emptyTotals();
      const carryTotals = carry?.totals ?? emptyTotals();
      const model = inc?.model ?? carry?.model ?? "";
      const isUnknown = inc?.isUnknown ?? carry?.isUnknown ?? false;
      const local = addTotals(carryTotals, incomingServer);

      if (hasAnyUsage(local) || hasAnyUsage(incomingServer)) {
        nextModels[key] = { model, isUnknown, local, server: incomingServer };
      }
    }

    nextRange = {
      range,
      windowStartDate: windowStart,
      windowEndDate: windowEnd,
      lastSyncAt: syncTimestamp,
      seeded: true,
      truncated: truncated || undefined,
      models: nextModels,
      carryOver,
      lastAppliedResetAt,
    };
  }

  const nextResetCount = base.resetCount + (resetDetected ? 1 : 0);
  const nextSnapshot: AccountModelSnapshot = {
    ...base,
    accountId,
    lastSyncAt:
      base.lastSyncAt && base.lastSyncAt > syncTimestamp
        ? base.lastSyncAt
        : syncTimestamp,
    lastError: undefined,
    resetCount: nextResetCount,
    lastReset: resetDetected
      ? {
          detectedAt: syncTimestamp,
          previousTokens: prevSum.totalTokens,
          previousRequests: prevSum.requests,
          previousCost: prevSum.cost,
          reportedTokens: incomingSum.totalTokens,
          reportedRequests: incomingSum.requests,
          reportedCost: incomingSum.cost,
          count: nextResetCount,
        }
      : base.lastReset,
    ranges: {
      ...base.ranges,
      [range]: nextRange,
    },
  };

  allSnapshots[accountId] = nextSnapshot;
  persistAll(allSnapshots);

  return {
    snapshot: nextSnapshot,
    rangeSnapshot: nextRange,
    rows: entriesToRows(nextRange.models, unknownModelLabel),
    serverTotals: sumModelMap(nextRange.models, "server"),
    localTotals: sumModelMap(nextRange.models, "local"),
    resetDetected,
  };
}

/** Mark a failed sync for an account without erasing its saved model history. */
export function recordModelUsageError(accountId: string, error: string): void {
  const snapshots = loadAll();
  const existing = snapshots[accountId] ?? emptyAccountSnapshot(accountId);
  snapshots[accountId] = {
    ...existing,
    lastError: error,
  };
  persistAll(snapshots);
}

export interface OfflineModelRanking {
  rows: ModelUsageRankingRow[];
  lastSyncAt: string;
  truncated: boolean;
  localTotals: ModelTotals;
  serverTotals: ModelTotals;
  lastResetAt?: string;
}

/**
 * Read the locally stored ranking for one account and range when offline.
 *
 * Returns `null` if no usable saved data exists for the requested time window
 * (for example, `"today"` saved on a previous calendar day, or `"7d"`/`"30d"`
 * whose saved window no longer overlaps today's window).
 */
export function getAccountOfflineModelRanking(
  accountId: string,
  range: UsageRange,
  unknownModelLabel: string,
  now: Date = new Date()
): OfflineModelRanking | null {
  const snapshot = loadAll()[accountId];
  if (!snapshot) return null;

  const rangeSnap = snapshot.ranges[range];
  if (!rangeSnap || !rangeSnap.seeded) return null;

  const bounds = getUsageRangeBounds(range, now);
  const currentStart = bounds.startDate ?? "1970-01-01";
  const currentEnd = bounds.endDate ?? formatDateKey(now);

  if (range === "today" && rangeSnap.windowEndDate !== currentEnd) {
    return null;
  }
  if (
    (range === "7d" || range === "30d") &&
    rangeSnap.windowEndDate &&
    rangeSnap.windowEndDate < currentStart
  ) {
    return null;
  }

  const carryExpired =
    Boolean(rangeSnap.carryOver) &&
    currentStart > (rangeSnap.carryOver?.resetDate ?? "");

  const rows = entriesToRows(
    rangeSnap.models,
    unknownModelLabel,
    undefined,
    carryExpired
  );
  const localTotals = carryExpired
    ? sumModelMap(rangeSnap.models, "server")
    : sumModelMap(rangeSnap.models, "local");
  const serverTotals = sumModelMap(rangeSnap.models, "server");

  return {
    rows,
    lastSyncAt: rangeSnap.lastSyncAt || snapshot.lastSyncAt,
    truncated: Boolean(rangeSnap.truncated),
    localTotals,
    serverTotals,
    lastResetAt: snapshot.lastReset?.detectedAt,
  };
}

export function getAccountModelSnapshot(
  accountId: string
): AccountModelSnapshot | null {
  return loadAll()[accountId] ?? null;
}

export function loadAllModelSnapshots(): Record<string, AccountModelSnapshot> {
  return loadAll();
}

export function saveAllModelSnapshots(
  snapshots: Record<string, AccountModelSnapshot>
): void {
  persistAll(snapshots);
}

function mergeRangeSnapshots(
  range: UsageRange,
  current: RangeModelSnapshot | undefined,
  incoming: RangeModelSnapshot | undefined
): RangeModelSnapshot | undefined {
  if (!current) return incoming;
  if (!incoming) return current;

  const curSync = current.lastSyncAt ?? "";
  const incSync = incoming.lastSyncAt ?? "";
  const sameMoment = curSync === incSync;
  const incomingIsNewer = incSync > curSync;

  if (range === "today") {
    if (incoming.windowEndDate !== current.windowEndDate) {
      return incoming.windowEndDate > current.windowEndDate ? incoming : current;
    }
  }

  if (range === "7d" || range === "30d") {
    const preferred = incomingIsNewer ? incoming : current;
    const older = incomingIsNewer ? current : incoming;

    // Pick the newer carryOver if still valid for the preferred window.
    const candidates = [preferred.carryOver, older.carryOver].filter(
      (c): c is WindowCarryOver =>
        Boolean(c && preferred.windowStartDate <= c.resetDate)
    );
    candidates.sort((a, b) => (b.resetAt > a.resetAt ? 1 : b.resetAt < a.resetAt ? -1 : 0));
    const carryOver = candidates[0];

    const models: Record<string, StoredModelEntry> = {};
    const allKeys = new Set([
      ...Object.keys(preferred.models),
      ...Object.keys(carryOver?.models ?? {}),
    ]);
    for (const key of allKeys) {
      const prefEntry = preferred.models[key];
      const carryEntry = carryOver?.models[key];
      const server = prefEntry?.server ?? emptyTotals();
      const local = carryEntry
        ? addTotals(carryEntry.totals, server)
        : (prefEntry?.local ?? server);
      const model = prefEntry?.model ?? carryEntry?.model ?? "";
      const isUnknown = prefEntry?.isUnknown ?? carryEntry?.isUnknown ?? false;
      if (hasAnyUsage(local) || hasAnyUsage(server)) {
        models[key] = { model, isUnknown, local, server };
      }
    }

    return {
      ...preferred,
      seeded: Boolean(current.seeded || incoming.seeded),
      carryOver,
      lastAppliedResetAt:
        (incoming.lastAppliedResetAt ?? "") > (current.lastAppliedResetAt ?? "")
          ? incoming.lastAppliedResetAt
          : current.lastAppliedResetAt,
      models,
    };
  }

  // "all" (and same-day "today"): monotonic local max + newest server baseline.
  const models: Record<string, StoredModelEntry> = {};
  const allKeys = new Set([
    ...Object.keys(current.models),
    ...Object.keys(incoming.models),
  ]);

  for (const key of allKeys) {
    const curEntry = current.models[key];
    const incEntry = incoming.models[key];
    const curLocal = curEntry?.local ?? emptyTotals();
    const incLocal = incEntry?.local ?? emptyTotals();
    const curServer = curEntry?.server ?? emptyTotals();
    const incServer = incEntry?.server ?? emptyTotals();

    const local = maxTotals(curLocal, incLocal);
    const server = sameMoment
      ? maxTotals(curServer, incServer)
      : incomingIsNewer
        ? incServer
        : curServer;

    if (hasAnyUsage(local) || hasAnyUsage(server)) {
      models[key] = {
        model: incEntry?.model ?? curEntry?.model ?? "",
        isUnknown: incEntry?.isUnknown ?? curEntry?.isUnknown ?? false,
        local,
        server,
      };
    }
  }

  const newer = incomingIsNewer ? incoming : current;
  return {
    range,
    windowStartDate: newer.windowStartDate,
    windowEndDate: newer.windowEndDate,
    lastSyncAt: newer.lastSyncAt,
    seeded: Boolean(current.seeded || incoming.seeded),
    truncated: sameMoment
      ? Boolean(current.truncated && incoming.truncated)
      : Boolean(newer.truncated),
    models,
  };
}

/** Combine two model snapshots for the same account without shrinking local history. */
export function mergeAccountModelSnapshot(
  current: AccountModelSnapshot | undefined,
  incoming: AccountModelSnapshot | undefined
): AccountModelSnapshot | null {
  if (!current) return incoming ?? null;
  if (!incoming) return current;

  const incomingIsNewer = (incoming.lastSyncAt ?? "") > (current.lastSyncAt ?? "");
  const lastReset =
    (incoming.lastReset?.detectedAt ?? "") > (current.lastReset?.detectedAt ?? "")
      ? incoming.lastReset
      : current.lastReset;

  const ranges: Partial<Record<UsageRange, RangeModelSnapshot>> = {};
  for (const range of ["today", "7d", "30d", "all"] as const) {
    const merged = mergeRangeSnapshots(
      range,
      current.ranges[range],
      incoming.ranges[range]
    );
    if (merged) ranges[range] = merged;
  }

  return {
    accountId: current.accountId || incoming.accountId,
    lastSyncAt: incomingIsNewer ? incoming.lastSyncAt : current.lastSyncAt,
    lastError: current.lastError ?? incoming.lastError,
    resetCount: Math.max(current.resetCount ?? 0, incoming.resetCount ?? 0),
    lastReset,
    ranges,
  };
}

/** Merge a full model snapshot map, keeping the larger local totals for every account. */
export function mergeModelSnapshotMaps(
  existing: Record<string, AccountModelSnapshot>,
  incoming: Record<string, AccountModelSnapshot>
): Record<string, AccountModelSnapshot> {
  const merged: Record<string, AccountModelSnapshot> = { ...existing };
  for (const [accountId, snapshot] of Object.entries(incoming)) {
    const normalized = normalizeAccountModelSnapshot(accountId, snapshot);
    if (!normalized) continue;
    const combined = mergeAccountModelSnapshot(merged[accountId], normalized);
    if (combined) merged[accountId] = combined;
  }
  return merged;
}
