import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, BarChart3, ChevronDown, Clock, DollarSign, History, Monitor, RefreshCw, Zap } from "lucide-react";
import {
  activateAccount,
  getActiveAccount,
  getActiveAccountId,
  loadAccounts,
  requestWithAccountSession,
} from "../lib/accounts";
import {
  fetchAccountDashboardStats,
  fetchAccountRecentUsage,
  type DashboardStats,
  type UsageRecord,
} from "../lib/api";
import {
  getAccountSnapshot,
  getLocalCumulative,
  getServerCumulative,
  recordUsageForAccount,
  syncAccountStats,
  type AccountUsageSnapshot,
} from "../lib/usage-snapshots";
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

interface LocalTotals {
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
}

function readLocalTotals(accountId: string | null): LocalTotals {
  const snapshot: AccountUsageSnapshot | null = accountId
    ? getAccountSnapshot(accountId)
    : null;
  const local = getLocalCumulative(snapshot);
  return {
    totalTokens: local.totalTokens,
    totalRequests: local.totalRequests,
    totalCost: local.totalCost,
  };
}

interface ResetNotice {
  detectedAt: string;
  reportedTokens: number;
}

function readResetNotice(accountId: string | null): ResetNotice | null {
  if (!accountId) return null;
  const snapshot = getAccountSnapshot(accountId);
  const detectedAt = snapshot?.lastReset?.detectedAt;
  if (!detectedAt) return null;
  const time = Date.parse(detectedAt);
  if (Number.isNaN(time) || Date.now() - time > 7 * 24 * 60 * 60 * 1000) return null;
  const server = getServerCumulative(snapshot);
  return { detectedAt, reportedTokens: server.totalTokens };
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


interface AccountSwitcherProps {
  currentName: string;
  accounts: Array<{ id: string; name: string; username: string }>;
  onSwitch: (id: string) => void;
}

function AccountSwitcher({ currentName, accounts, onSwitch }: AccountSwitcherProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch account"
        title="Switch account"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/55 transition-all hover:bg-white/10 hover:text-white/85"
      >
        <span className="max-w-[140px] truncate">{currentName}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#221f45]/95 shadow-2xl backdrop-blur-xl"
        >
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              role="option"
              aria-selected={account.name === currentName}
              onClick={() => {
                setOpen(false);
                onSwitch(account.id);
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white/90"
            >
              <span className="min-w-0 flex-1 truncate">{account.name}</span>
              <span className="shrink-0 text-[10px] text-white/35">{account.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentUsage, setRecentUsage] = useState<UsageRecord[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [widgetError, setWidgetError] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [localTotals, setLocalTotals] = useState<LocalTotals>(() =>
    readLocalTotals(getActiveAccountId())
  );
  const [resetNotice, setResetNotice] = useState<ResetNotice | null>(() =>
    readResetNotice(getActiveAccountId())
  );
  const [activeAccountName, setActiveAccountName] = useState<string>(() => {
    const account = getActiveAccount();
    return account ? account.name : "No account selected";
  });
  const [accountList, setAccountList] = useState(() =>
    loadAccounts().map((account) => ({
      id: account.id,
      name: account.name,
      username: account.username,
    }))
  );
  const [hasAccounts, setHasAccounts] = useState(() => loadAccounts().length > 0);

  const refreshAccounts = useCallback(() => {
    const loaded = loadAccounts();
    setHasAccounts(loaded.length > 0);
    setAccountList(
      loaded.map((account) => ({
        id: account.id,
        name: account.name,
        username: account.username,
      }))
    );
    const active = getActiveAccount();
    setActiveAccountName(active ? active.name : "No account selected");
    setLocalTotals(readLocalTotals(active ? active.id : null));
    setResetNotice(readResetNotice(active ? active.id : null));
  }, []);


  const fetchData = useCallback(async () => {
    const account = getActiveAccount();
    if (!account) return;
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    setRecentLoading(true);

    try {
      // Both requests run through the account's own session, renewing it with
      // the refresh token or the saved password before giving up.
      const [statsResult, recentResult] = await Promise.allSettled([
        requestWithAccountSession(account, (context) =>
          fetchAccountDashboardStats(context)
        ),
        requestWithAccountSession(account, (context) =>
          fetchAccountRecentUsage(formatDate(startDate), formatDate(endDate), context)
        ),
      ]);

      let updated = false;
      if (statsResult.status === "fulfilled") {
        syncAccountStats(account.id, statsResult.value.value);
        setStats(statsResult.value.value);
        setFetchError("");
        updated = true;
      } else {
        setFetchError(
          statsResult.reason instanceof Error
            ? statsResult.reason.message
            : "Unable to load usage from the relay."
        );
      }
      if (recentResult.status === "fulfilled") {
        recordUsageForAccount(account.id, recentResult.value.value);
        setRecentUsage(recentResult.value.value);
        updated = true;
      }
      if (updated) setLastUpdate(new Date());

      setLocalTotals(readLocalTotals(account.id));
      setResetNotice(readResetNotice(account.id));
    } finally {
      setRecentLoading(false);
    }
  }, []);

  const handleSwitchAccount = useCallback(async (id: string) => {
    if (getActiveAccountId() === id) return;
    try {
      await activateAccount(id);
      refreshAccounts();
      setStats(null);
      setRecentUsage(null);
      setLocalTotals(readLocalTotals(id));
      setResetNotice(readResetNotice(id));
      setFetchError("");
      void fetchData();
    } catch {
      // The accounts page reports switch errors; keep Dashboard stable.
    }
  }, [refreshAccounts, fetchData]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    const handleAccountsChanged = () => {
      refreshAccounts();
    };
    window.addEventListener("accounts-changed", handleAccountsChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener("accounts-changed", handleAccountsChanged);
    };
  }, [fetchData, refreshAccounts]);

  // The empty state is rendered after every hook has run, so adding the first
  // account from another page can never change the hook order.
  if (!hasAccounts) {
    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center text-center">
        <Activity size={40} className="text-white/25" />
        <h1 className="mt-4 text-xl font-light tracking-wide text-white/90">Welcome</h1>
        <p className="mt-2 max-w-sm text-sm text-white/50">
          Add a Sub2API relay account to start monitoring token usage.
        </p>
        <button
          type="button"
          onClick={() => navigate("/total-usage")}
          className="mt-6 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white/85 transition-all hover:bg-white/15"
        >
          Go to Total Usage
        </button>
      </div>
    );
  }

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
          <AccountSwitcher
            currentName={activeAccountName}
            accounts={accountList}
            onSwitch={(id) => void handleSwitchAccount(id)}
          />
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
      {fetchError && (
        <p role="alert" className="text-xs text-red-300">{fetchError}</p>
      )}
      {resetNotice && (
        <p role="status" className="text-xs text-amber-300">
          <History size={12} className="mr-1 inline" />
          The relay cleared its usage data on{" "}
          {new Date(resetNotice.detectedAt).toLocaleString(undefined, {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          . Local totals were kept and continue from there.
        </p>
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
          value={
            localTotals.totalTokens > 0
              ? formatNumber(localTotals.totalTokens)
              : stats
                ? formatNumber(stats.total_tokens)
                : "---"
          }
          sublabel={
            localTotals.totalTokens > 0
              ? `Local history · relay reports ${formatNumber(
                  stats ? stats.total_tokens : 0
                )}`
              : undefined
          }
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
