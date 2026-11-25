import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Coins,
  History,
  RefreshCw,
  Trophy,
  Zap,
} from "lucide-react";
import {
  getEnabledAccounts,
  requestWithAccountSession,
} from "../lib/accounts";
import {
  ApiError,
  fetchAccountDashboardModelUsage,
  fetchAccountDashboardStats,
  fetchAccountUsageRecords,
  type DashboardModelUsage,
  type DashboardStats,
} from "../lib/api";
import {
  getAccountModelSnapshot,
  getAccountOfflineModelRanking,
  recordModelUsageError,
  syncAccountModelUsage,
  type ModelTotals,
} from "../lib/model-snapshots";
import {
  aggregateDashboardModelUsage,
  aggregateModelUsage,
  getUsageRangeBounds,
  mergeModelUsageRankings,
  type ModelUsageRankingRow,
  type UsageRange,
} from "../lib/model-usage";
import { getAccountSnapshot, syncAccountStats } from "../lib/usage-snapshots";
import {
  formatClock,
  formatCompactNumber,
  formatCurrency,
  formatDateTime,
  formatPercent,
} from "../lib/format";
import { useI18n } from "../lib/use-i18n";
import type { MessageKey } from "../lib/i18n";

interface AccountIssue {
  id: string;
  name: string;
  message: string;
  savedAt?: string;
}

interface ResetNoticeAccount {
  id: string;
  name: string;
  detectedAt: string;
}

const RESET_NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentReset(value?: string): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= RESET_NOTICE_WINDOW_MS;
}

function emptyTotals(): ModelTotals {
  return { totalTokens: 0, requests: 0, cost: 0 };
}

function SummaryCard({
  icon,
  label,
  value,
  sublabel,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.10] bg-white/[0.06] p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-white/40">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-light tabular-nums text-white/90">
        {value}
      </p>
      {sublabel && <p className="mt-1 text-[11px] text-white/35">{sublabel}</p>}
    </div>
  );
}

export default function ModelRanking() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [range, setRange] = useState<UsageRange>("30d");
  const [rankingRows, setRankingRows] = useState<ModelUsageRankingRow[]>([]);
  const [liveServerTotals, setLiveServerTotals] = useState<ModelTotals>(emptyTotals);
  const [liveCount, setLiveCount] = useState(0);
  const [offlineAccounts, setOfflineAccounts] = useState<AccountIssue[]>([]);
  const [failures, setFailures] = useState<AccountIssue[]>([]);
  const [resetAccounts, setResetAccounts] = useState<ResetNoticeAccount[]>([]);
  const [truncatedAccounts, setTruncatedAccounts] = useState<string[]>([]);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [pageError, setPageError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const generation = useRef(0);

  const loadUsage = useCallback(async () => {
    const requestGeneration = ++generation.current;
    const now = new Date();
    const accounts = getEnabledAccounts();
    const bounds = getUsageRangeBounds(range, now);
    const allBounds = getUsageRangeBounds("all", now);
    const unknownLabel = t("ranking.unknownModel");

    // Hydrate immediately from per-account offline snapshots so the screen
    // never flashes empty while live relays are being queried.
    const initialGroups: ModelUsageRankingRow[][] = [];
    let latestOfflineSync = "";
    for (const account of accounts) {
      const offline = getAccountOfflineModelRanking(
        account.id,
        range,
        unknownLabel,
        now
      );
      if (offline) {
        initialGroups.push(offline.rows);
        if (offline.lastSyncAt > latestOfflineSync) {
          latestOfflineSync = offline.lastSyncAt;
        }
      }
    }
    const hasInitialOffline = initialGroups.length > 0;

    setTotalAccounts(accounts.length);
    setLoading(!hasInitialOffline);
    setRefreshing(true);
    setPageError("");
    setFailures([]);
    setOfflineAccounts([]);
    setResetAccounts([]);
    setStale(false);

    if (hasInitialOffline) {
      setRankingRows(mergeModelUsageRankings(initialGroups));
      setTruncatedAccounts([]);
      setLiveCount(0);
      setLiveServerTotals(emptyTotals());
      setLastUpdate(latestOfflineSync ? new Date(latestOfflineSync) : null);
    } else {
      setRankingRows([]);
      setTruncatedAccounts([]);
      setLiveCount(0);
      setLiveServerTotals(emptyTotals());
      setLastUpdate(null);
    }

    if (accounts.length === 0) {
      setRankingRows([]);
      setFailures([]);
      setOfflineAccounts([]);
      setResetAccounts([]);
      setTruncatedAccounts([]);
      setLastUpdate(new Date());
      setLoading(false);
      setRefreshing(false);
      setStale(false);
      return;
    }

    try {
      const results = await Promise.allSettled(
        accounts.map(async (account) => {
          const result = await requestWithAccountSession(account, async (context) => {
            try {
              const models = await fetchAccountDashboardModelUsage(
                bounds.startDate,
                bounds.endDate,
                context
              );
              if (models) {
                let allModels: DashboardModelUsage[] | null = null;
                if (range !== "all") {
                  try {
                    allModels = await fetchAccountDashboardModelUsage(
                      allBounds.startDate,
                      allBounds.endDate,
                      context
                    );
                  } catch {
                    // Best-effort all-time sync for reset detection & offline history.
                  }
                }
                return {
                  kind: "models" as const,
                  models,
                  allModels,
                  truncated: false,
                };
              }

              const usage = await fetchAccountUsageRecords(
                bounds.startDate,
                bounds.endDate,
                context
              );
              let stats: DashboardStats | null = null;
              if (range !== "all") {
                try {
                  stats = await fetchAccountDashboardStats(context);
                } catch {
                  // Best-effort stats sync for reset detection.
                }
              }
              return {
                kind: "records" as const,
                records: usage.records,
                stats,
                truncated: usage.truncated,
              };
            } catch (error: unknown) {
              if (!(error instanceof ApiError) || error.status !== 404) throw error;
              const usage = await fetchAccountUsageRecords(
                bounds.startDate,
                bounds.endDate,
                context
              );
              let stats: DashboardStats | null = null;
              if (range !== "all") {
                try {
                  stats = await fetchAccountDashboardStats(context);
                } catch {
                  // Best-effort stats sync for reset detection.
                }
              }
              return {
                kind: "records" as const,
                records: usage.records,
                stats,
                truncated: usage.truncated,
              };
            }
          });
          return {
            account,
            ...result.value,
          };
        })
      );

      if (requestGeneration !== generation.current) return;

      const syncDate = new Date();
      const rowGroups: ModelUsageRankingRow[][] = [];
      const nextFailures: AccountIssue[] = [];
      const nextOffline: AccountIssue[] = [];
      const nextResets: ResetNoticeAccount[] = [];
      const nextTruncated: string[] = [];
      const nextServerTotals = emptyTotals();
      let nextLiveCount = 0;

      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const account = accounts[index];

        if (result.status === "fulfilled") {
          nextLiveCount += 1;
          const payload = result.value;

          let externalResetAt =
            getAccountSnapshot(account.id)?.lastReset?.detectedAt;

          if (payload.kind === "models" && payload.allModels) {
            const allRows = aggregateDashboardModelUsage(
              payload.allModels,
              unknownLabel
            );
            const allSync = syncAccountModelUsage(
              account.id,
              "all",
              allRows,
              unknownLabel,
              { syncDate, externalResetAt }
            );
            const allResetAt = allSync.snapshot.lastReset?.detectedAt;
            if (allResetAt && (!externalResetAt || allResetAt > externalResetAt)) {
              externalResetAt = allResetAt;
            }
          } else if (payload.kind === "records" && payload.stats) {
            const statsSync = syncAccountStats(account.id, payload.stats, syncDate);
            const statsResetAt = statsSync.snapshot.lastReset?.detectedAt;
            if (
              statsResetAt &&
              (!externalResetAt || statsResetAt > externalResetAt)
            ) {
              externalResetAt = statsResetAt;
            }
          }

          const fetchedRows =
            payload.kind === "models"
              ? aggregateDashboardModelUsage(payload.models, unknownLabel)
              : aggregateModelUsage(payload.records, unknownLabel);

          const synced = syncAccountModelUsage(
            account.id,
            range,
            fetchedRows,
            unknownLabel,
            {
              syncDate,
              truncated: payload.truncated,
              externalResetAt,
            }
          );

          rowGroups.push(synced.rows);
          nextServerTotals.totalTokens += synced.serverTotals.totalTokens;
          nextServerTotals.requests += synced.serverTotals.requests;
          nextServerTotals.cost += synced.serverTotals.cost;
          if (payload.truncated) {
            nextTruncated.push(account.name);
          }

          const rangeResetAt =
            range === "7d" || range === "30d"
              ? synced.rangeSnapshot.carryOver?.resetAt
              : synced.snapshot.lastReset?.detectedAt;
          if (isRecentReset(rangeResetAt) && rangeResetAt) {
            nextResets.push({
              id: account.id,
              name: account.name,
              detectedAt: rangeResetAt,
            });
          }
          continue;
        }

        const errorMessage =
          result.reason instanceof Error
            ? result.reason.message
            : t("ranking.loadFailed");
        recordModelUsageError(account.id, errorMessage);

        const offline = getAccountOfflineModelRanking(
          account.id,
          range,
          unknownLabel,
          syncDate
        );
        if (offline) {
          rowGroups.push(offline.rows);
          nextOffline.push({
            id: account.id,
            name: account.name,
            message: errorMessage,
            savedAt: offline.lastSyncAt,
          });
          if (offline.truncated) {
            nextTruncated.push(account.name);
          }
          const modelSnap = getAccountModelSnapshot(account.id);
          const rangeSnap = modelSnap?.ranges[range];
          const rangeResetAt =
            range === "7d" || range === "30d"
              ? rangeSnap?.carryOver?.resetAt
              : modelSnap?.lastReset?.detectedAt;
          if (isRecentReset(rangeResetAt) && rangeResetAt) {
            nextResets.push({
              id: account.id,
              name: account.name,
              detectedAt: rangeResetAt,
            });
          }
        } else {
          nextFailures.push({
            id: account.id,
            name: account.name,
            message: errorMessage,
          });
        }
      }

      const nextRows = mergeModelUsageRankings(rowGroups);
      setRankingRows(nextRows);
      setLiveServerTotals(nextServerTotals);
      setLiveCount(nextLiveCount);
      setOfflineAccounts(nextOffline);
      setFailures(nextFailures);
      setResetAccounts(nextResets);
      setTruncatedAccounts(nextTruncated);
      setLastUpdate(syncDate);
      setStale(false);
    } catch (error: unknown) {
      if (requestGeneration !== generation.current) return;
      if (!hasInitialOffline) {
        setRankingRows([]);
        setFailures([]);
        setOfflineAccounts([]);
        setResetAccounts([]);
        setTruncatedAccounts([]);
      }
      setStale(hasInitialOffline);
      setPageError(
        error instanceof Error ? error.message : t("ranking.loadFailed")
      );
    } finally {
      if (requestGeneration === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [range, t]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const rows = useMemo(
    () =>
      rankingRows.map((row) =>
        row.isUnknown ? { ...row, model: t("ranking.unknownModel") } : row
      ),
    [locale, rankingRows, t]
  );

  const summary = useMemo(
    () =>
      rows.reduce(
        (total, row) => ({
          tokens: total.tokens + row.totalTokens,
          requests: total.requests + row.requests,
          cost: total.cost + row.cost,
        }),
        { tokens: 0, requests: 0, cost: 0 }
      ),
    [rows]
  );

  const allAccountsFailed =
    totalAccounts > 0 &&
    failures.length === totalAccounts &&
    offlineAccounts.length === 0;
  const offlineCount = offlineAccounts.length;
  const hasLocalDivergence =
    !loading &&
    (offlineCount > 0 ||
      resetAccounts.length > 0 ||
      summary.tokens > liveServerTotals.totalTokens + 2 ||
      summary.requests > liveServerTotals.requests + 2 ||
      summary.cost > liveServerTotals.cost + 1e-6);

  const rangeOptions: ReadonlyArray<{ id: UsageRange; labelKey: MessageKey }> = [
    { id: "today", labelKey: "ranking.range.today" },
    { id: "7d", labelKey: "ranking.range.7d" },
    { id: "30d", labelKey: "ranking.range.30d" },
    { id: "all", labelKey: "ranking.range.all" },
  ];

  function displayValue(value: number): string {
    return loading ? "---" : formatCompactNumber(value);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-light tracking-wide text-white/90">
            {t("ranking.title")}
          </h1>
          <p className="mt-1 max-w-xl text-xs text-white/40">
            {t("ranking.subtitle")}
          </p>
          {lastUpdate && (
            <p className="mt-1 text-[10px] text-white/30">
              {t("dashboard.updatedAt", { time: formatClock(lastUpdate) })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="model-ranking-range">
            {t("ranking.range")}
          </label>
          <select
            id="model-ranking-range"
            value={range}
            onChange={(event) => setRange(event.target.value as UsageRange)}
            className="h-9 rounded-xl border border-white/[0.10] bg-[#272447] px-3 text-xs text-white/80 outline-none transition-colors hover:bg-[#302b57] focus:border-white/25"
          >
            {rangeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={t("ranking.refresh")}
            title={t("ranking.refresh")}
            disabled={refreshing}
            onClick={() => void loadUsage()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white/45 transition-colors hover:bg-white/10 hover:text-white/80 disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {totalAccounts === 0 && !loading ? (
        <section className="rounded-2xl border border-white/[0.10] bg-white/[0.06] px-6 py-12 text-center backdrop-blur-xl">
          <Trophy size={28} className="mx-auto text-white/25" />
          <h2 className="mt-3 text-sm font-medium text-white/70">
            {t("ranking.noAccounts")}
          </h2>
          <p className="mt-1 text-xs text-white/35">
            {t("ranking.noAccountsHint")}
          </p>
          <button
            type="button"
            onClick={() => navigate("/total-usage")}
            className="mt-5 rounded-xl bg-white/10 px-4 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/15"
          >
            {t("ranking.goToAccounts")}
          </button>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <SummaryCard
              icon={<Zap size={14} />}
              label={t("ranking.totalTokens")}
              value={displayValue(summary.tokens)}
              sublabel={
                hasLocalDivergence
                  ? t("ranking.localHistoryTokensHint", {
                      value: formatCompactNumber(liveServerTotals.totalTokens),
                    })
                  : undefined
              }
            />
            <SummaryCard
              icon={<BarChart3 size={14} />}
              label={t("ranking.totalRequests")}
              value={displayValue(summary.requests)}
              sublabel={
                hasLocalDivergence
                  ? t("ranking.localHistoryHint", {
                      value: formatCompactNumber(liveServerTotals.requests),
                    })
                  : undefined
              }
            />
            <SummaryCard
              icon={<Coins size={14} />}
              label={t("ranking.totalCost")}
              value={loading ? "$---" : formatCurrency(summary.cost)}
              sublabel={
                hasLocalDivergence
                  ? t("ranking.localHistoryHint", {
                      value: formatCurrency(liveServerTotals.cost),
                    })
                  : undefined
              }
            />
            <SummaryCard
              icon={<Trophy size={14} />}
              label={t("ranking.modelCount")}
              value={loading ? "---" : String(rows.length)}
              sublabel={
                offlineCount > 0
                  ? t("usage.activeAccountsHint", {
                      accounts: totalAccounts,
                      offline: offlineCount,
                    })
                  : undefined
              }
            />
          </div>

          {pageError && (
            <div role="alert" className="rounded-xl border border-red-300/20 bg-red-300/[0.07] px-4 py-3 text-xs text-red-200">
              {pageError}
            </div>
          )}

          {stale && (
            <div
              role="status"
              className="rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-xs text-amber-100/75"
            >
              {t("ranking.stale")}
            </div>
          )}

          {offlineAccounts.length > 0 && (
            <div
              role="status"
              className="rounded-xl border border-sky-300/20 bg-sky-300/[0.07] px-4 py-3 text-xs text-sky-200/90"
            >
              <p className="font-medium">
                {t("ranking.offlineCount", { count: offlineAccounts.length })}
              </p>
              <ul className="mt-2 space-y-1 pl-5 text-[11px] text-sky-100/65">
                {offlineAccounts.map((account) => (
                  <li key={account.id} className="list-disc break-words">
                    {t("ranking.offlineAccountDetail", {
                      name: account.name,
                      time: formatDateTime(account.savedAt),
                      error: account.message,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resetAccounts.length > 0 && (
            <div
              role="status"
              className="rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-xs text-amber-200/90"
            >
              <History size={12} className="mr-1.5 inline" />
              {t("ranking.resetNotice", {
                list: resetAccounts
                  .map(
                    (account) =>
                      `${account.name} (${formatDateTime(account.detectedAt)})`
                  )
                  .join(", "),
              })}
            </div>
          )}

          {failures.length > 0 && (
            <div
              role="status"
              className="rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-xs text-amber-100/80"
            >
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle size={14} />
                {allAccountsFailed
                  ? t("ranking.allFailed")
                  : t("ranking.partialFailure", { count: failures.length })}
              </p>
              <ul className="mt-2 space-y-1 pl-5 text-[11px] text-amber-100/60">
                {failures.map((failure) => (
                  <li key={failure.id} className="list-disc break-words">
                    {t("ranking.accountError", {
                      name: failure.name,
                      error: failure.message,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {truncatedAccounts.length > 0 && (
            <div
              role="status"
              className="rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-xs text-amber-100/75"
            >
              {t("ranking.truncated", {
                names: truncatedAccounts.join(", "),
              })}
            </div>
          )}

          <section className="overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.06] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/60">
                  <Trophy size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-medium tracking-wide text-white/80">
                    {t("ranking.tableTitle")}
                  </h2>
                  <p className="mt-0.5 text-[10px] text-white/30">
                    {offlineCount > 0
                      ? t("ranking.loadedWithOffline", {
                          live: liveCount,
                          offline: offlineCount,
                          total: totalAccounts,
                        })
                      : t("ranking.loadedAccounts", {
                          loaded: liveCount,
                          total: totalAccounts,
                        })}
                  </p>
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-white/30">
                {t("ranking.sortedByTokens")}
              </span>
            </div>

            {loading ? (
              <div className="space-y-2 p-4" aria-label={t("ranking.loading")}>
                {[0, 1, 2, 3, 4].map((item) => (
                  <div
                    key={item}
                    className="h-12 animate-pulse rounded-xl bg-white/[0.06]"
                  />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm text-white/55">{t("ranking.empty")}</p>
                <p className="mt-1 text-xs text-white/30">
                  {t("ranking.emptyHint")}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[500px] w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-[10px] uppercase tracking-wider text-white/30">
                      <th className="w-10 px-3 py-3 font-medium">
                        {t("ranking.rank")}
                      </th>
                      <th className="min-w-[150px] px-2 py-3 font-medium">
                        {t("ranking.model")}
                      </th>
                      <th className="w-[4.5rem] px-2 py-3 text-right font-medium">
                        {t("ranking.tokens")}
                      </th>
                      <th className="w-14 px-2 py-3 text-right font-medium">
                        {t("ranking.requests")}
                      </th>
                      <th className="w-[4.75rem] px-2 py-3 text-right font-medium">
                        {t("ranking.cost")}
                      </th>
                      <th className="w-16 px-3 py-3 text-right font-medium">
                        {t("ranking.share")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {rows.map((row, index) => (
                      <tr
                        key={row.model}
                        className="group transition-colors hover:bg-white/[0.04]"
                      >
                        <td className="px-3 py-3">
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-medium ${
                              index === 0
                                ? "bg-amber-300/15 text-amber-200"
                                : index === 1
                                  ? "bg-slate-200/10 text-slate-200/75"
                                  : index === 2
                                    ? "bg-orange-300/10 text-orange-200/70"
                                    : "bg-white/[0.05] text-white/35"
                            }`}
                          >
                            {index + 1}
                          </span>
                        </td>
                        <td className="px-2 py-3">
                          <p
                            className="truncate text-xs font-medium text-white/80"
                            title={row.model}
                          >
                            {row.model}
                          </p>
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-400/70 to-fuchsia-300/60"
                              style={{ width: `${Math.min(100, row.share)}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-3 text-right text-xs font-medium tabular-nums text-white/75">
                          {formatCompactNumber(row.totalTokens)}
                        </td>
                        <td className="px-2 py-3 text-right text-xs tabular-nums text-white/50">
                          {formatCompactNumber(row.requests)}
                        </td>
                        <td className="px-2 py-3 text-right text-xs tabular-nums text-white/50">
                          {formatCurrency(row.cost)}
                        </td>
                        <td className="px-3 py-3 text-right text-xs tabular-nums text-white/45">
                          {formatPercent(row.share)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-[11px] leading-5 text-white/30">
            {t("ranking.localHistoryNote")}
          </p>
        </>
      )}
    </div>
  );
}
