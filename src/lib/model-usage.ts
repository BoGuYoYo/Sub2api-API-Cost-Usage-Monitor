import type { DashboardModelUsage, UsageRecord } from "./api";
import { formatDateKey } from "./format";

export type UsageRange = "today" | "7d" | "30d" | "all";

export interface UsageRangeBounds {
  startDate?: string;
  endDate?: string;
}

export interface ModelUsageRankingRow {
  model: string;
  totalTokens: number;
  requests: number;
  cost: number;
  /** Percentage of the combined token total, from 0 to 100. */
  share: number;
  /** True when the source record did not contain a model name. */
  isUnknown?: boolean;
}

export interface ModelRankingCache {
  range: UsageRange;
  accountIds: string[];
  rows: ModelUsageRankingRow[];
  fetchedAt: string;
  truncatedAccounts: string[];
  failedAccounts: Array<{ id: string; name: string; message: string }>;
}

const MODEL_RANKING_CACHE_VERSION = 2;
const MODEL_RANKING_CACHE_KEY = "sub2api_model_ranking_cache_v1";

function modelRankingCacheKey(range: UsageRange, accountIds: string[]): string {
  // The all-time query semantics changed from omitted dates to an explicit
  // full-history interval. Do not briefly show entries cached under the old
  // server-default date window as if they were all-time totals.
  const cacheRange = range === "all" ? "all-v2" : range;
  return `${cacheRange}:${[...accountIds].sort().join(",")}`;
}

export function loadModelRankingCache(
  range: UsageRange,
  accountIds: string[]
): ModelRankingCache | null {
  try {
    const raw = localStorage.getItem(MODEL_RANKING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      entries?: Record<string, ModelRankingCache>;
    };
    if (parsed.version !== MODEL_RANKING_CACHE_VERSION || !parsed.entries) {
      return null;
    }
    const entry = parsed.entries[modelRankingCacheKey(range, accountIds)];
    if (!entry || !Array.isArray(entry.rows) || typeof entry.fetchedAt !== "string") {
      return null;
    }
    return {
      range,
      accountIds: [...accountIds],
      rows: entry.rows,
      fetchedAt: entry.fetchedAt,
      truncatedAccounts: Array.isArray(entry.truncatedAccounts)
        ? entry.truncatedAccounts
        : [],
      failedAccounts: Array.isArray(entry.failedAccounts)
        ? entry.failedAccounts
        : [],
    };
  } catch {
    return null;
  }
}

export function saveModelRankingCache(cache: ModelRankingCache): void {
  try {
    const raw = localStorage.getItem(MODEL_RANKING_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { version?: unknown; entries?: Record<string, ModelRankingCache> }) : null;
    const entries =
      parsed?.version === MODEL_RANKING_CACHE_VERSION && parsed.entries
        ? parsed.entries
        : {};
    entries[modelRankingCacheKey(cache.range, cache.accountIds)] = cache;
    localStorage.setItem(
      MODEL_RANKING_CACHE_KEY,
      JSON.stringify({ version: MODEL_RANKING_CACHE_VERSION, entries })
    );
  } catch {
    // Cache is only an optimization; a full or unavailable store must not break usage.
  }
}

export function getUsageRangeBounds(
  range: UsageRange,
  now: Date = new Date()
): UsageRangeBounds {
  if (range === "all") {
    return {
      startDate: "1970-01-01",
      endDate: formatDateKey(now),
    };
  }

  const end = new Date(now);
  const start = new Date(now);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);

  return {
    startDate: formatDateKey(start),
    endDate: formatDateKey(end),
  };
}

export function toFiniteUsageNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getUsageRecordTokens(record: UsageRecord): number {
  const total = toFiniteUsageNumber(record.total_tokens);
  if (total !== null) return total;
  return (
    (toFiniteUsageNumber(record.input_tokens) ?? 0) +
    (toFiniteUsageNumber(record.output_tokens) ?? 0)
  );
}

export function getUsageRecordCost(record: UsageRecord): number {
  const actual = toFiniteUsageNumber(record.actual_cost);
  if (actual !== null) return actual;
  return toFiniteUsageNumber(record.total_cost) ?? 0;
}

export function getUsageRecordModel(
  record: UsageRecord,
  unknownModel: string
): string {
  const model = typeof record.model === "string" ? record.model.trim() : "";
  return model || unknownModel;
}

/**
 * Vendor prefixes that should be folded into the plain model name in the
 * ranking view. Some relays expose the same underlying model under a
 * vendor-prefixed alias (e.g. `cn:deepseek-v4.1-flash` next to
 * `deepseek-v4.1-flash`); leaving them apart splits one model into two rows
 * and makes the ranking and its token share meaningless.
 */
export const MERGED_MODEL_PREFIXES = ["cn:"];

/** Strip a known vendor prefix so aliases collapse into one ranking row. */
export function normalizeModelName(raw: string): string {
  let name = raw.trim();
  for (const prefix of MERGED_MODEL_PREFIXES) {
    if (name.length > prefix.length && name.toLowerCase().startsWith(prefix)) {
      name = name.slice(prefix.length).trim();
      break;
    }
  }
  return name;
}

export function aggregateModelUsage(
  records: UsageRecord[],
  unknownModel: string
): ModelUsageRankingRow[] {
  const byModel = new Map<
    string,
    Omit<ModelUsageRankingRow, "share">
  >();

  for (const record of records) {
    const rawModel = typeof record.model === "string" ? record.model.trim() : "";
    const isUnknown = !rawModel;
    const model = isUnknown ? unknownModel : normalizeModelName(rawModel);
    const key = isUnknown ? "__unknown_model__" : model;
    const row = byModel.get(key) ?? {
      model,
      totalTokens: 0,
      requests: 0,
      cost: 0,
      isUnknown,
    };
    row.totalTokens += getUsageRecordTokens(record);
    row.requests += 1;
    row.cost += getUsageRecordCost(record);
    byModel.set(key, row);
  }

  const totalTokens = [...byModel.values()].reduce(
    (sum, row) => sum + row.totalTokens,
    0
  );

  return [...byModel.values()]
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

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const number = toFiniteUsageNumber(value);
    if (number !== null) return number;
  }
  return null;
}

/** Normalize the relay's per-model dashboard totals across API versions. */
export function aggregateDashboardModelUsage(
  models: DashboardModelUsage[],
  unknownModel: string
): ModelUsageRankingRow[] {
  const byModel = new Map<string, Omit<ModelUsageRankingRow, "share">>();

  for (const item of models) {
    const rawModel =
      (typeof item.model === "string" && item.model.trim()) ||
      (typeof item.model_name === "string" && item.model_name.trim()) ||
      "";
    const isUnknown = !rawModel;
    const displayName = isUnknown ? unknownModel : normalizeModelName(rawModel);
    const key = isUnknown ? "__unknown_model__" : displayName;
    const row = byModel.get(key) ?? {
      model: displayName,
      totalTokens: 0,
      requests: 0,
      cost: 0,
      isUnknown,
    };

    const tokens =
      firstFinite(item.total_tokens, item.tokens) ??
      (firstFinite(item.input_tokens) ?? 0) +
        (firstFinite(item.output_tokens) ?? 0);
    const requests =
      firstFinite(item.requests, item.request_count, item.total_requests) ?? 0;
    const cost =
      firstFinite(
        item.actual_cost,
        item.total_actual_cost,
        item.total_cost,
        item.cost
      ) ?? 0;

    row.totalTokens += tokens;
    row.requests += requests;
    row.cost += cost;
    byModel.set(key, row);
  }

  const totalTokens = [...byModel.values()].reduce(
    (sum, row) => sum + row.totalTokens,
    0
  );

  return [...byModel.values()]
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

export function mergeModelUsageRankings(
  groups: ModelUsageRankingRow[][]
): ModelUsageRankingRow[] {
  const merged = new Map<string, Omit<ModelUsageRankingRow, "share">>();
  for (const rows of groups) {
    for (const row of rows) {
      // Re-normalize here as well: per-account rows may still carry a vendor
      // prefix (or come from a stale cache written before merging existed).
      const displayName = row.isUnknown ? row.model : normalizeModelName(row.model);
      const key = row.isUnknown ? "__unknown_model__" : displayName;
      const current = merged.get(key) ?? {
        model: displayName,
        totalTokens: 0,
        requests: 0,
        cost: 0,
        isUnknown: row.isUnknown,
      };
      current.totalTokens += row.totalTokens;
      current.requests += row.requests;
      current.cost += row.cost;
      merged.set(key, current);
    }
  }

  const totalTokens = [...merged.values()].reduce(
    (sum, row) => sum + row.totalTokens,
    0
  );
  return [...merged.values()]
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
