import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ChartPie,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  UserRound,
  Zap,
  DollarSign,
  CircleAlert,
  ArrowLeftRight,
  KeyRound,
} from "lucide-react";
import {
  addAccount,
  activateAccount,
  deleteAccount,
  getAccountRequestContext,
  getEnabledAccounts,
  loadAccounts,
  refreshAccountToken,
  reloginAccount,
  setAccountEnabled,
  type Account,
  type AccountDraft,
} from "../lib/accounts";
import {
  ApiError,
  fetchAccountDashboardStats,
  fetchAccountRecentUsage,
  type DashboardStats,
} from "../lib/api";
import {
  aggregateSnapshots,
  getAccountSnapshot,
  recordDashboardStats,
  recordUsageError,
  recordUsageForAccount,
  type AccountUsageSnapshot,
  type DailyUsage,
} from "../lib/usage-snapshots";

function formatNumber(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(2) + "K";
  return value.toLocaleString();
}

function formatCost(value: number): string {
  return "$" + value.toFixed(4);
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  return { startDate: formatDate(startDate), endDate: formatDate(endDate) };
}

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function snapshotCumulative(snapshot: AccountUsageSnapshot | null): {
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  todayTokens: number;
} {
  const cumulative = snapshot?.cumulative;
  return {
    totalTokens: toFiniteNumber(cumulative?.totalTokens) ?? 0,
    totalRequests: toFiniteNumber(cumulative?.totalRequests) ?? 0,
    totalCost: toFiniteNumber(cumulative?.totalCost) ?? 0,
    todayTokens: toFiniteNumber(cumulative?.todayTokens) ?? 0,
  };
}

interface AccountRow {
  account: Account;
  status: "success" | "error" | "offline";
  error?: string;
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  todayTokens: number;
}

interface Totals {
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  todayTokens: number;
}

function toSummary(rows: AccountRow[]): Totals {
  return {
    totalTokens: rows.reduce((total, item) => total + item.totalTokens, 0),
    totalRequests: rows.reduce((total, item) => total + item.totalRequests, 0),
    totalCost: rows.reduce((total, item) => total + item.totalCost, 0),
    todayTokens: rows.reduce((total, item) => total + item.todayTokens, 0),
  };
}

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}

function StatCard({ icon, label, value, sublabel, highlight = false }: StatCardProps) {
  return (
    <div
      className={`rounded-2xl border p-5 backdrop-blur-xl ${
        highlight
          ? "border-white/[0.20] bg-white/[0.12]"
          : "border-white/[0.10] bg-white/[0.06]"
      }`}
    >
      <div className="mb-3 flex items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${
            highlight ? "bg-white/20 text-white/90" : "bg-white/10 text-white/60"
          }`}
        >
          {icon}
        </div>
        <span className="text-xs font-medium uppercase tracking-wider text-white/40">
          {label}
        </span>
      </div>
      <p
        className={`text-3xl font-light tabular-nums ${
          highlight ? "text-white" : "text-white/90"
        }`}
      >
        {value}
      </p>
      {sublabel && <p className="mt-1 text-[11px] text-white/35">{sublabel}</p>}
    </div>
  );
}

interface DailyBarProps {
  days: DailyUsage[];
}

function DailyBar({ days }: DailyBarProps) {
  if (days.length === 0) return null;
  const max = Math.max(...days.map((day) => day.totalTokens), 1);
  return (
    <div className="flex items-end gap-2">
      {days.map((day) => (
        <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[9px] tabular-nums text-white/40">
            {formatNumber(day.totalTokens)}
          </span>
          <div
            className="w-full rounded-t-md bg-white/15 transition-all hover:bg-white/25"
            style={{ height: `${Math.max(4, (day.totalTokens / max) * 64)}px` }}
            title={`${day.date}: ${formatNumber(day.totalTokens)} tokens`}
          />
          <span className="text-[9px] text-white/30">{day.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  onError: (message: string) => void;
}

function emptyDraft(): AccountDraft {
  return { name: "", baseUrl: "", username: "", password: "", enabled: true };
}

function AddAccountModal({ open, onClose, onAdded, onError }: AddAccountModalProps) {
  const [draft, setDraft] = useState<AccountDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(emptyDraft());
      setFormError("");
    }
  }, [open]);

  if (!open) return null;

  function updateDraft(field: keyof AccountDraft, value: string | boolean) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      await addAccount(draft);
      onAdded();
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unable to add this account.";
      setFormError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-account-title"
        className="w-full max-w-md rounded-2xl border border-white/[0.14] bg-[#242143]/95 p-6 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="add-account-title" className="text-lg font-medium text-white/90">
              Add Sub2API Account
            </h2>
            <p className="mt-1 text-xs leading-5 text-white/45">
              Enter the relay URL and the account credentials to track its token usage.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close add account dialog"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white/45 transition-colors hover:bg-white/10 hover:text-white/85"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="account-name"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55"
            >
              Display Name
            </label>
            <input
              id="account-name"
              type="text"
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              placeholder="My primary relay"
              autoFocus
              className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/90 outline-none transition-all placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.10]"
            />
          </div>

          <div>
            <label
              htmlFor="account-base-url"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55"
            >
              Sub2API Relay URL
            </label>
            <input
              id="account-base-url"
              type="text"
              value={draft.baseUrl}
              onChange={(event) => updateDraft("baseUrl", event.target.value)}
              placeholder="https://your-relay.example.com"
              className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/90 outline-none transition-all placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.10]"
            />
            <p className="mt-2 text-[11px] leading-4 text-white/35">
              The site URL or its /api/v1 endpoint. Each account can use a different relay.
            </p>
          </div>

          <div>
            <label
              htmlFor="account-username"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55"
            >
              Sub2API Username / Email
            </label>
            <input
              id="account-username"
              type="text"
              value={draft.username}
              onChange={(event) => updateDraft("username", event.target.value)}
              placeholder="user@example.com"
              autoComplete="username"
              className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/90 outline-none transition-all placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.10]"
            />
          </div>

          <div>
            <label
              htmlFor="account-password"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55"
            >
              Password
            </label>
            <input
              id="account-password"
              type="password"
              value={draft.password}
              onChange={(event) => updateDraft("password", event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/90 outline-none transition-all placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.10]"
            />
            <p className="mt-2 text-[11px] leading-4 text-white/35">
              Your password is only used once to sign in and is never stored.
            </p>
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => updateDraft("enabled", event.target.checked)}
              className="h-4 w-4 accent-white"
            />
            <span className="text-sm text-white/75">
              Include this account in total usage
            </span>
          </label>

          {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {saving ? "Signing in..." : "Sign In & Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ReLoginModalProps {
  open: boolean;
  account: Account | null;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

function ReLoginModal({ open, account, onClose, onDone, onError }: ReLoginModalProps) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (open) {
      setPassword("");
      setFormError("");
    }
  }, [open]);

  if (!open || !account) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    if (!password) {
      setFormError("Enter the account password.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await reloginAccount(account.id, password);
      onDone();
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unable to sign in again.";
      setFormError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="relogin-title"
        className="w-full max-w-md rounded-2xl border border-white/[0.14] bg-[#242143]/95 p-6 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="relogin-title" className="text-lg font-medium text-white/90">
              Sign in again
            </h2>
            <p className="mt-1 text-xs leading-5 text-white/45">
              Token expired for <span className="text-white/70">{account.name}</span> ({account.username}).
              Re-enter the password to refresh the session.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close re-login dialog"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white/45 transition-colors hover:bg-white/10 hover:text-white/85"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="relogin-password"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55"
            >
              Password
            </label>
            <input
              id="relogin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus
              className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/90 outline-none transition-all placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.10]"
            />
            <p className="mt-2 text-[11px] leading-4 text-white/35">
              Your password is only used once to sign in and is never stored.
            </p>
          </div>

          {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
              {saving ? "Signing in..." : "Sign In"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Fetch an account's server-side dashboard stats (cumulative totals) plus its
 * recent usage (for the 7-day chart). Successful stats are recorded into the
 * offline snapshot; a 401 triggers a token refresh with one retry.
 */
async function fetchAccountData(
  account: Account
): Promise<{ stats: DashboardStats }> {
  const { startDate, endDate } = getDateRange();
  let context = getAccountRequestContext(account);

  let stats: DashboardStats;
  try {
    stats = await fetchAccountDashboardStats(context);
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      const refreshed = await refreshAccountToken(account);
      if (refreshed) {
        context = getAccountRequestContext(refreshed);
        stats = await fetchAccountDashboardStats(context);
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  recordDashboardStats(account.id, stats);

  // Recent usage feeds the 7-day chart only; a failure here must not hide
  // the cumulative totals, so it is best-effort.
  try {
    const records = await fetchAccountRecentUsage(startDate, endDate, context);
    recordUsageForAccount(account.id, records);
  } catch {
    // The cumulative snapshot is already saved; keep chart data as-is.
  }

  return { stats };
}

export default function TotalUsage() {
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts());
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pageError, setPageError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [reloginAccount, setReloginAccount] = useState<Account | null>(null);
  const [reloginOpen, setReloginOpen] = useState(false);

  const refreshAccounts = useCallback(() => {
    setAccounts(loadAccounts());
  }, []);

  const loadUsage = useCallback(async () => {
    const enabled = getEnabledAccounts();
    setLoading(true);
    setPageError("");

    if (enabled.length === 0) {
      setRows([]);
      setLoading(false);
      setLastUpdate(new Date());
      return;
    }

    const results = await Promise.allSettled(
      enabled.map((account) => fetchAccountData(account))
    );

    const nextRows = results.map((result, index) => {
      const account = enabled[index];
      const snapshot = getAccountSnapshot(account.id);
      const fallback = snapshotCumulative(snapshot);

      if (result.status === "fulfilled") {
        const stats = result.value.stats;
        return {
          account,
          status: "success" as const,
          totalTokens: toFiniteNumber(stats.total_tokens) ?? fallback.totalTokens,
          totalRequests: toFiniteNumber(stats.total_requests) ?? fallback.totalRequests,
          totalCost: toFiniteNumber(stats.total_actual_cost) ?? fallback.totalCost,
          todayTokens: toFiniteNumber(stats.today_tokens) ?? fallback.todayTokens,
        };
      }

      const error =
        result.reason instanceof Error
          ? result.reason.message
          : "Failed to load usage for this account.";
      recordUsageError(account.id, error);

      const hasSnapshot =
        snapshot !== null &&
        (Object.keys(snapshot.days).length > 0 ||
          (toFiniteNumber(snapshot.cumulative?.totalTokens) ?? 0) > 0);
      return {
        account,
        status: (hasSnapshot ? "offline" : "error") as "offline" | "error",
        error,
        totalTokens: fallback.totalTokens,
        totalRequests: fallback.totalRequests,
        totalCost: fallback.totalCost,
        todayTokens: fallback.todayTokens,
      };
    });

    setRows(nextRows);
    setLoading(false);
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const totals = useMemo(() => toSummary(rows), [rows]);
  const snapshotDays = useMemo(
    () =>
      aggregateSnapshots(
        rows
          .map((row) => getAccountSnapshot(row.account.id))
          .filter((snap): snap is AccountUsageSnapshot => snap !== null)
      ),
    [rows, lastUpdate]
  );
  const enabledCount = accounts.filter((account) => account.enabled).length;
  const failedCount = rows.filter((row) => row.status === "error").length;
  const offlineCount = rows.filter((row) => row.status === "offline").length;

  async function handleSwitch(account: Account) {
    try {
      await activateAccount(account.id);
      refreshAccounts();
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Unable to switch account.");
    }
  }

  function handleToggleEnabled(account: Account) {
    setAccountEnabled(account.id, !account.enabled);
    refreshAccounts();
    void loadUsage();
  }

  function handleDelete(account: Account) {
    if (
      !window.confirm(
        `Delete account "${account.name}"?\nThe remote Sub2API account is not affected.`
      )
    ) {
      return;
    }
    deleteAccount(account.id);
    refreshAccounts();
    void loadUsage();
  }

  function handleReLogin(account: Account) {
    setReloginAccount(account);
    setReloginOpen(true);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-light tracking-wide text-white/90">Total Usage</h1>
          {lastUpdate && (
            <p className="mt-0.5 text-[10px] text-white/30">
              Updated {lastUpdate.toLocaleTimeString()} · {accounts.length} account
              {accounts.length === 1 ? "" : "s"} · {enabledCount} enabled
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/85 transition-all hover:bg-white/15"
          >
            <Plus size={15} />
            Add Account
          </button>
          <button
            type="button"
            aria-label="Refresh total usage"
            title="Refresh total usage"
            onClick={() => void loadUsage()}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-white/40 transition-all hover:bg-white/10 hover:text-white/70"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {pageError && <p role="alert" className="text-xs text-red-300">{pageError}</p>}
      {failedCount > 0 && (
        <p role="status" className="text-xs text-amber-300">
          {failedCount} enabled account(s) have no saved data yet.
        </p>
      )}
      {offlineCount > 0 && (
        <p role="status" className="text-xs text-sky-300">
          {offlineCount} account(s) are offline — showing last saved usage.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          icon={<Zap size={20} />}
          label="ACCOUNTS TOTAL TOKENS"
          value={loading ? "---" : formatNumber(totals.totalTokens)}
          sublabel="Sum of each account's total tokens (all-time)"
          highlight
        />
        <StatCard
          icon={<Activity size={18} />}
          label="Total Requests"
          value={loading ? "---" : formatNumber(totals.totalRequests)}
          sublabel="All enabled accounts · all-time"
        />
        <StatCard
          icon={<DollarSign size={18} />}
          label="Total Cost"
          value={loading ? "$---" : formatCost(totals.totalCost)}
          sublabel="All enabled accounts · all-time"
        />
        <StatCard
          icon={<ChartPie size={18} />}
          label="Active Accounts"
          value={String(enabledCount)}
          sublabel={`${accounts.length} configured · ${offlineCount} offline`}
        />
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 backdrop-blur-xl">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-white/55">
          Token usage · last 7 days
        </h2>
        <DailyBar days={snapshotDays} />
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 backdrop-blur-xl">
        <h2 className="text-sm font-medium uppercase tracking-wider text-white/55">
          Accounts
        </h2>

        {accounts.length === 0 ? (
          <div className="py-10 text-center">
            <UserRound size={32} className="mx-auto text-white/25" />
            <p className="mt-3 text-sm text-white/50">No accounts configured</p>
            <p className="mt-1 text-xs text-white/30">
              Add a Sub2API relay account to start tracking its token usage
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {accounts.map((account) => {
              const row = rows.find((item) => item.account.id === account.id);
              const isEnabled = account.enabled;
              return (
                <div
                  key={account.id}
                  className={`flex flex-wrap items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.06] ${
                    isEnabled ? "" : "opacity-60"
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/55">
                    <UserRound size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-white/80">
                        {account.name}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                          row?.status === "offline"
                            ? "bg-sky-500/15 text-sky-300"
                            : row?.status === "error"
                              ? "bg-red-500/15 text-red-300"
                              : isEnabled
                                ? "bg-emerald-500/15 text-emerald-400/80"
                                : "bg-white/10 text-white/40"
                        }`}
                      >
                        <span
                          className={`h-1 w-1 rounded-full ${
                            row?.status === "offline"
                              ? "bg-sky-300"
                              : row?.status === "error"
                                ? "bg-red-300"
                                : isEnabled
                                  ? "bg-emerald-400"
                                  : "bg-white/30"
                          }`}
                        />
                        {row?.status === "offline"
                          ? "Offline (saved)"
                          : row?.status === "error"
                            ? "Error"
                            : isEnabled
                              ? "Enabled"
                              : "Disabled"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-white/35">
                      {account.username} · {account.baseUrl}
                    </p>
                  </div>

                  {isEnabled && row ? (
                    row.status === "error" ? (
                      <div className="shrink-0 text-right">
                        <p className="flex items-center justify-end gap-1 text-[11px] text-red-300">
                          <CircleAlert size={12} />
                          No saved data
                        </p>
                        <p className="mt-0.5 max-w-[200px] truncate text-[10px] text-white/30">
                          {row.error}
                        </p>
                      </div>
                    ) : (
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium tabular-nums text-white/75">
                          {formatNumber(row.totalTokens)} tokens
                        </p>
                        <p className="text-[11px] tabular-nums text-white/35">
                          {formatNumber(row.totalRequests)} requests · {formatCost(row.totalCost)}
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] text-white/30">Not included</p>
                    </div>
                  )}

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Switch to this account"
                      onClick={() => void handleSwitch(account)}
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-sky-300"
                    >
                      <ArrowLeftRight size={14} />
                    </button>
                    <button
                      type="button"
                      title="Sign in again (refresh expired token)"
                      onClick={() => handleReLogin(account)}
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-emerald-300"
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      type="button"
                      title={isEnabled ? "Disable account" : "Enable account"}
                      onClick={() => handleToggleEnabled(account)}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 ${
                        isEnabled ? "hover:text-amber-300" : "hover:text-emerald-300"
                      }`}
                    >
                      <Power size={14} />
                    </button>
                    <button
                      type="button"
                      title="Delete account"
                      onClick={() => handleDelete(account)}
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-red-400/70"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AddAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={() => {
          refreshAccounts();
          void loadUsage();
        }}
        onError={setPageError}
      />
      <ReLoginModal
        open={reloginOpen}
        account={reloginAccount}
        onClose={() => setReloginOpen(false)}
        onDone={() => {
          refreshAccounts();
          void loadUsage();
        }}
        onError={setPageError}
      />
    </div>
  );
}
