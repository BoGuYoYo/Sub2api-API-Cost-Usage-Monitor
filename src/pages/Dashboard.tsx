import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Activity, BarChart3, Clock, DollarSign, Monitor, RefreshCw, Zap } from "lucide-react";
import { fetchDashboardStats, fetchRecentUsage, type DashboardStats, type UsageRecord } from "../lib/api";
import { openFloatingWidget } from "../lib/windows";

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value: unknown): string {
  const number = toFiniteNumber(value);
  if (number === null) return "---";
  if (number >= 1_000_000) return (number / 1_000_000).toFixed(2) + "M";
  if (number >= 1_000) return (number / 1_000).toFixed(2) + "K";
  return number.toLocaleString();
}

function formatCost(value: unknown): string {
  const number = toFiniteNumber(value);
  return number === null ? "$---" : "$" + number.toFixed(4);
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: unknown): string {
  if (!value) return "Unknown time";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getModelName(record: UsageRecord): string {
  return typeof record.model === "string" && record.model.trim()
    ? record.model
    : "Unknown model";
}

function getRecordTokens(record: UsageRecord): number {
  const total = toFiniteNumber(record.total_tokens);
  if (total !== null) return total;
  return (
    (toFiniteNumber(record.input_tokens) ?? 0) +
    (toFiniteNumber(record.output_tokens) ?? 0)
  );
}

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  sublabel?: string;
}

function StatCard({ icon, label, value, sublabel }: StatCardProps) {
  return (
    <div className="group rounded-2xl border border-white/[0.10] bg-white/[0.06] p-5 backdrop-blur-xl transition-all duration-300 hover:scale-[1.02] hover:bg-white/[0.10]">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/60 transition-all group-hover:bg-white/15 group-hover:text-white/80">
          {icon}
        </div>
        <span className="text-xs font-medium uppercase tracking-wider text-white/40">
          {label}
        </span>
      </div>
      <p className="text-2xl font-light tracking-tight text-white/90">
        {value}
      </p>
      {sublabel && <p className="mt-1 text-xs text-white/30">{sublabel}</p>}
    </div>
  );
}

interface RecentUsageProps {
  records: UsageRecord[] | null;
  loading: boolean;
}

function RecentUsage({ records, loading }: RecentUsageProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.06] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/60">
            <Activity size={16} />
          </div>
          <h2 className="text-sm font-medium tracking-wide text-white/80">
            Recent Model Usage
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-white/35">
          Last 7 days
        </span>
      </div>

      {loading ? (
        <div className="space-y-2 p-3" aria-label="Loading recent model usage">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-14 animate-pulse rounded-xl bg-white/[0.06]" />
          ))}
        </div>
      ) : records && records.length > 0 ? (
        <div className="divide-y divide-white/[0.08]">
          {records.slice(0, 8).map((record, index) => {
            const model = getModelName(record);
            const actualCost = record.actual_cost ?? record.total_cost;
            return (
              <div
                key={`${record.id}-${index}`}
                className="flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/55">
                  <Zap size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white/80" title={model}>
                    {model}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/35">
                    <Clock size={11} />
                    {formatDateTime(record.created_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium tabular-nums text-white/75">
                    {formatCost(actualCost)}
                  </p>
                  <p className="text-[11px] tabular-nums text-white/35">
                    {formatNumber(getRecordTokens(record))} tokens
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-white/50">No model usage in the last 7 days.</p>
          <p className="mt-1 text-xs text-white/30">Records will appear after your next API request.</p>
        </div>
      )}
    </section>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentUsage, setRecentUsage] = useState<UsageRecord[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [widgetError, setWidgetError] = useState("");

  const fetchData = useCallback(async () => {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    setRecentLoading(true);

    try {
      const [statsResult, recentResult] = await Promise.allSettled([
        fetchDashboardStats(),
        fetchRecentUsage(formatDate(startDate), formatDate(endDate)),
      ]);

      let updated = false;
      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
        updated = true;
      }
      if (recentResult.status === "fulfilled") {
        setRecentUsage(recentResult.value);
        updated = true;
      }
      if (updated) setLastUpdate(new Date());
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function handleOpenWidget() {
    setWidgetError("");
    try {
      await openFloatingWidget();
    } catch (error: unknown) {
      setWidgetError(
        error instanceof Error ? error.message : "Unable to open the desktop widget."
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-light tracking-wide text-white/90">Dashboard</h1>
          {lastUpdate && (
            <p className="mt-0.5 text-[10px] text-white/30">
              Updated {lastUpdate.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Open desktop widget"
            title="Desktop widget"
            onClick={handleOpenWidget}
            className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/55 transition-all hover:bg-white/10 hover:text-white/85"
          >
            <Monitor size={14} />
            <span>Desktop Widget</span>
          </button>
          <button
            type="button"
            aria-label="Refresh dashboard"
            title="Refresh dashboard"
            onClick={fetchData}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-white/40 transition-all hover:bg-white/10 hover:text-white/70"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {widgetError && (
        <p role="alert" className="text-xs text-red-300">{widgetError}</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          icon={<DollarSign size={18} />}
          label="Today's Spend"
          value={stats ? formatCost(stats.today_actual_cost) : "$---"}
        />
        <StatCard
          icon={<Zap size={18} />}
          label="Today's Tokens"
          value={stats ? formatNumber(stats.today_tokens) : "---"}
        />
        <StatCard
          icon={<BarChart3 size={18} />}
          label="Total Tokens"
          value={stats ? formatNumber(stats.total_tokens) : "---"}
        />
        <StatCard
          icon={<Activity size={18} />}
          label="Today's Requests"
          value={stats ? formatNumber(stats.today_requests) : "---"}
        />
      </div>

      <RecentUsage records={recentUsage} loading={recentLoading} />
    </div>
  );
}
