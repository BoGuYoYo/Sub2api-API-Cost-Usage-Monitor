import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
  ShieldCheck,
  DatabaseBackup,
  Upload,
  History,
} from "lucide-react";
import {
  addAccount,
  activateAccount,
  autoReloginAccount,
  deleteAccount,
  enableAutoRelogin,
  getEnabledAccounts,
  hasStoredPassword,
  hasUnreadablePassword,
  loadAccounts,
  reloginAccount,
  requestWithAccountSession,
  setAccountAutoRelogin,
  setAccountEnabled,
  type Account,
  type AccountDraft,
} from "../lib/accounts";
import {
  fetchAccountDashboardStats,
  fetchAccountRecentUsage,
  type DashboardStats,
} from "../lib/api";
import {
  aggregateSnapshots,
  getAccountSnapshot,
  getLocalCumulative,
  getServerCumulative,
  recordUsageError,
  recordUsageForAccount,
  syncAccountStats,
  type AccountUsageSnapshot,
  type DailyUsage,
} from "../lib/usage-snapshots";
import {
  BackupError,
  copyBackupToClipboard,
  downloadBackup,
  importBackup,
} from "../lib/backup";
import { formatClock, formatCompactNumber, formatCurrency, formatDateKey, formatDateTime } from "../lib/format";
import { useI18n } from "../lib/use-i18n";

/** How often the page re-reads every enabled account. */
const SYNC_INTERVAL_MS = 60_000;

function formatNumber(value: number): string {
  return formatCompactNumber(value);
}

function formatCost(value: number): string {
  return formatCurrency(value);
}

function getDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  return { startDate: formatDateKey(startDate), endDate: formatDateKey(endDate) };
}

/** Relay resets older than this are summarised in the repo of history only. */
const RESET_NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentReset(value?: string): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= RESET_NOTICE_WINDOW_MS;
}

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

interface Totals {
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  serverTokens: number;
  serverRequests: number;
  serverCost: number;
}

interface AccountRow {
  account: Account;
  status: "success" | "error" | "offline";
  error?: string;
  /** Local accumulated totals (never decrease). */
  totalTokens: number;
  totalRequests: number;
  totalCost: number;
  /** What the relay reports right now. */
  serverTokens: number;
  serverRequests: number;
  serverCost: number;
  /** When the relay last reported lower totals than before. */
  lastResetAt?: string;
  /** The session was renewed with the saved password during this sync. */
  autoSignedIn?: boolean;
  /** The session was renewed with the refresh token during this sync. */
  refreshed?: boolean;
}

function toSummary(rows: AccountRow[]): Totals {
  const totals: Totals = {
    totalTokens: 0,
    totalRequests: 0,
    totalCost: 0,
    serverTokens: 0,
    serverRequests: 0,
    serverCost: 0,
  };
  for (const row of rows) {
    totals.totalTokens += row.totalTokens;
    totals.totalRequests += row.totalRequests;
    totals.totalCost += row.totalCost;
    totals.serverTokens += row.serverTokens;
    totals.serverRequests += row.serverRequests;
    totals.serverCost += row.serverCost;
  }
  return totals;
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
  const { t } = useI18n();
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
            title={t("usage.chartTooltip", {
              date: day.date,
              value: formatNumber(day.totalTokens),
            })}
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
  return {
    name: "",
    baseUrl: "",
    username: "",
    password: "",
    rememberPassword: true,
    enabled: true,
  };
}

function AddAccountModal({ open, onClose, onAdded, onError }: AddAccountModalProps) {
  const { t } = useI18n();
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
        err instanceof Error ? err.message : t("usage.addFailed");
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
              {t("add.title")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-white/45">
              {t("add.description")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("usage.closeAddDialog")}
            title={t("usage.closeDialog")}
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
              {t("add.displayName")}
            </label>
            <input
              id="account-name"
              type="text"
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              placeholder={t("add.displayNamePlaceholder")}
              autoFocus
              className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/90 outline-none transition-all placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.10]"
            />
          </div>

          <div>
            <label
              htmlFor="account-base-url"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55"
            >
              {t("add.relayUrl")}
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
              {t("add.relayUrlHint")}
            </p>
          </div>

          <div>
            <label
              htmlFor="account-username"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55"
            >
              {t("add.username")}
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
              {t("add.password")}
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
              {t("add.passwordHint")}
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
            <input
              type="checkbox"
              checked={draft.rememberPassword}
              onChange={(event) => updateDraft("rememberPassword", event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-white"
            />
            <span className="text-sm text-white/75">
              {t("add.rememberPassword")}
            </span>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => updateDraft("enabled", event.target.checked)}
              className="h-4 w-4 accent-white"
            />
            <span className="text-sm text-white/75">
              {t("add.includeInTotals")}
            </span>
          </label>

          {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            >
              {t("usage.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {saving ? t("usage.signingIn") : t("add.submit")}
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
  /** "relogin" refreshes a session; "enable-auto" stores the password too. */
  mode: "relogin" | "enable-auto";
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

function ReLoginModal({
  open,
  account,
  mode,
  onClose,
  onDone,
  onError,
}: ReLoginModalProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (open) {
      setPassword("");
      setRemember(true);
      setFormError("");
    }
  }, [open, account?.id]);

  if (!open || !account) return null;

  const enableAuto = mode === "enable-auto";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    if (!password) {
      setFormError(t("relogin.emptyPassword"));
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (enableAuto) {
        await enableAutoRelogin(account.id, password);
      } else {
        await reloginAccount(account.id, password, remember);
      }
      onDone();
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : t("usage.reloginFailed");
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
              {enableAuto ? t("relogin.titleEnable") : t("relogin.titleSignIn")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-white/45">
              {enableAuto
                ? t("relogin.enableDescription", {
                    name: account.name,
                    username: account.username,
                  })
                : t("relogin.signInDescription", {
                    name: account.name,
                    username: account.username,
                  })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("usage.closeReloginDialog")}
            title={t("usage.closeDialog")}
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
              {t("add.password")}
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
          </div>

          {!enableAuto && (
            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-white"
              />
              <span className="text-sm text-white/75">
                {t("relogin.remember")}
              </span>
            </label>
          )}

          {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            >
              {t("usage.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
              {saving
                ? t("usage.signingIn")
                : enableAuto
                  ? t("relogin.submitEnable")
                  : t("relogin.submitSignIn")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Fetch an account's relay dashboard stats and recent usage.
 *
 * The session is renewed automatically (refresh token, then the stored
 * password) before a request and retried once after a 401, so an account with a
 * saved password signs itself back in without the user noticing.
 */
async function fetchAccountData(account: Account): Promise<{
  stats: DashboardStats;
  account: Account;
  renewed: boolean;
  autoSignedIn: boolean;
}> {
  const { startDate, endDate } = getDateRange();

  const stats = await requestWithAccountSession(account, (context) =>
    fetchAccountDashboardStats(context)
  );
  syncAccountStats(account.id, stats.value);

  // Recent usage feeds the 7-day chart only; a failure here must not hide
  // the cumulative totals, so it is best-effort.
  try {
    const records = await requestWithAccountSession(stats.account, (context) =>
      fetchAccountRecentUsage(startDate, endDate, context)
    );
    recordUsageForAccount(account.id, records.value);
  } catch {
    // The local totals are already saved; keep chart data as-is.
  }

  const previousAutoLogin = account.lastAutoLoginAt ?? "";
  const autoSignedIn =
    !!stats.account.lastAutoLoginAt && stats.account.lastAutoLoginAt !== previousAutoLogin;

  return {
    stats: stats.value,
    account: stats.account,
    renewed: stats.renewed,
    autoSignedIn,
  };
}

export default function TotalUsage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts());
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pageError, setPageError] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [reloginAccount, setReloginAccount] = useState<Account | null>(null);
  const [reloginMode, setReloginMode] = useState<"relogin" | "enable-auto">("relogin");
  const [reloginOpen, setReloginOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const syncingRef = useRef(false);

  const refreshAccounts = useCallback(() => {
    setAccounts(loadAccounts());
  }, []);

  const loadUsage = useCallback(async (options: { background?: boolean } = {}) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const enabled = getEnabledAccounts();
      if (!options.background) {
        setLoading(true);
      }
      setPageError("");

      if (enabled.length === 0) {
        setRows([]);
        setLastUpdate(new Date());
        return;
      }

      const results = await Promise.allSettled(
        enabled.map((account) => fetchAccountData(account))
      );

      const nextRows = results.map((result, index) => {
        const account = enabled[index];
        const snapshot = getAccountSnapshot(account.id);
        const local = getLocalCumulative(snapshot);
        const server = getServerCumulative(snapshot);

        if (result.status === "fulfilled") {
          const { stats, account: syncedAccount, autoSignedIn, renewed } = result.value;
          const latest = getAccountSnapshot(account.id);
          const latestLocal = getLocalCumulative(latest);
          const latestServer = getServerCumulative(latest);
          return {
            account: syncedAccount,
            status: "success" as const,
            totalTokens: latestLocal.totalTokens,
            totalRequests: latestLocal.totalRequests,
            totalCost: latestLocal.totalCost,
            serverTokens: toFiniteNumber(stats.total_tokens) ?? latestServer.totalTokens,
            serverRequests:
              toFiniteNumber(stats.total_requests) ?? latestServer.totalRequests,
            serverCost:
              toFiniteNumber(stats.total_actual_cost) ?? latestServer.totalCost,
            lastResetAt: latest?.lastReset?.detectedAt,
            autoSignedIn,
            refreshed: renewed && !autoSignedIn,
          };
        }

        const error =
          result.reason instanceof Error
            ? result.reason.message
            : t("dashboard.loadFailed");
        recordUsageError(account.id, error);

        const hasData =
          snapshot !== null &&
          (local.totalTokens > 0 || Object.keys(snapshot.days).length > 0);
        return {
          account,
          status: (hasData ? "offline" : "error") as "offline" | "error",
          error,
          totalTokens: local.totalTokens,
          totalRequests: local.totalRequests,
          totalCost: local.totalCost,
          serverTokens: server.totalTokens,
          serverRequests: server.totalRequests,
          serverCost: server.totalCost,
          lastResetAt: snapshot?.lastReset?.detectedAt,
        };
      });

      setRows(nextRows);
      refreshAccounts();
      setLastUpdate(new Date());
    } finally {
      setLoading(false);
      syncingRef.current = false;
    }
  }, [refreshAccounts, t]);

  useEffect(() => {
    void loadUsage();
    const interval = window.setInterval(() => {
      void loadUsage({ background: true });
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadUsage]);

  const totals = useMemo(() => toSummary(rows), [rows]);
  const snapshotDays = useMemo(
    () =>
      aggregateSnapshots(
        rows
          .map((row) => getAccountSnapshot(row.account.id))
          .filter((snap): snap is AccountUsageSnapshot => snap !== null)
      ),
    [rows]
  );
  const enabledCount = accounts.filter((account) => account.enabled).length;
  const failedCount = rows.filter((row) => row.status === "error").length;
  const offlineCount = rows.filter((row) => row.status === "offline").length;
  const resetRows = rows.filter((row) => isRecentReset(row.lastResetAt));
  const autoSignedInRows = rows.filter((row) => row.autoSignedIn);
  const refreshedRows = rows.filter((row) => row.refreshed);
  const storedPasswordCount = accounts.filter((account) => hasStoredPassword(account)).length;

  async function handleSwitch(account: Account) {
    try {
      await activateAccount(account.id);
      refreshAccounts();
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : t("usage.switchFailed"));
    }
  }

  function handleToggleEnabled(account: Account) {
    setAccountEnabled(account.id, !account.enabled);
    refreshAccounts();
    void loadUsage({ background: true });
  }

  function handleDelete(account: Account) {
    if (!window.confirm(t("usage.deleteConfirm", { name: account.name }))) {
      return;
    }
    deleteAccount(account.id);
    refreshAccounts();
    void loadUsage({ background: true });
  }

  async function handleKey(account: Account) {
    setPageError("");
    setStatusNote("");
    // A stored password means the account can sign itself back in right away.
    if (account.autoRelogin && hasStoredPassword(account)) {
      try {
        await autoReloginAccount(account.id);
        setStatusNote(t("usage.autoSignedInOne", { name: account.name }));
        refreshAccounts();
        void loadUsage({ background: true });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : t("usage.reloginFailed");
        setPageError(message);
        setReloginAccount(account);
        setReloginMode("relogin");
        setReloginOpen(true);
      }
      return;
    }
    setReloginAccount(account);
    setReloginMode("relogin");
    setReloginOpen(true);
  }

  async function handleToggleAutoRelogin(account: Account) {
    setPageError("");
    setStatusNote("");
    if (!account.autoRelogin || !hasStoredPassword(account)) {
      setReloginAccount(account);
      setReloginMode("enable-auto");
      setReloginOpen(true);
      return;
    }
    if (!window.confirm(t("usage.forgetConfirm", { name: account.name }))) {
      return;
    }
    try {
      setAccountAutoRelogin(account.id, false);
      setStatusNote(t("usage.autoSignInDisabled", { name: account.name }));
      refreshAccounts();
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : t("usage.settingFailed"));
    }
  }

  function handleBackup() {
    setPageError("");
    try {
      downloadBackup();
      void copyBackupToClipboard()
        .then(() => {
          setStatusNote(t("usage.backupDone"));
        })
        .catch(() => {
          setStatusNote(t("usage.backupDoneNoClipboard"));
        });
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : t("usage.backupFailed"));
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPageError("");
    setStatusNote("");
    try {
      const text = await file.text();
      const summary = importBackup(text);
      refreshAccounts();
      void loadUsage({ background: true });
      const parts = [
        t("usage.restoreSummary", {
          added: summary.accountsAdded,
          updated: summary.accountsUpdated,
          snapshots: summary.snapshotsMerged,
        }),
      ];
      if (summary.passwordsRestored > 0) {
        parts.push(t("usage.restorePasswords", { count: summary.passwordsRestored }));
      }
      if (summary.passwordsUnavailable > 0) {
        parts.push(
          t("usage.restorePasswordsUnavailable", {
            count: summary.passwordsUnavailable,
          })
        );
      }
      setStatusNote(parts.join(" · ") + ".");
    } catch (err: unknown) {
      setPageError(
        err instanceof BackupError || err instanceof Error
          ? err.message
          : t("usage.restoreFailed")
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-light tracking-wide text-white/90">{t("usage.title")}</h1>
          {lastUpdate && (
            <p className="mt-0.5 text-[10px] text-white/30">
              {t("usage.summary", {
                time: formatClock(lastUpdate),
                accounts: accounts.length,
                enabled: enabledCount,
                passwords: storedPasswordCount,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleBackup}
            title={t("usage.backupTitle")}
            className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/55 transition-all hover:bg-white/10 hover:text-white/85"
          >
            <DatabaseBackup size={14} />
            <span>{t("usage.backup")}</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title={t("usage.restoreTitle")}
            className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/55 transition-all hover:bg-white/10 hover:text-white/85"
          >
            <Upload size={14} />
            <span>{t("usage.restore")}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImportFile(event)}
          />
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/85 transition-all hover:bg-white/15"
          >
            <Plus size={15} />
            {t("usage.addAccount")}
          </button>
          <button
            type="button"
            aria-label={t("usage.refresh")}
            title={t("usage.refresh")}
            onClick={() => void loadUsage()}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-white/40 transition-all hover:bg-white/10 hover:text-white/70"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {pageError && <p role="alert" className="text-xs text-red-300">{pageError}</p>}
      {statusNote && (
        <p role="status" className="text-xs text-emerald-300/90">
          {statusNote}
        </p>
      )}
      {failedCount > 0 && (
        <p role="status" className="text-xs text-amber-300">
          {t("usage.noDataYet", { count: failedCount })}
        </p>
      )}
      {offlineCount > 0 && (
        <p role="status" className="text-xs text-sky-300">
          {t("usage.offlineCount", { count: offlineCount })}
        </p>
      )}
      {autoSignedInRows.length > 0 && (
        <p role="status" className="text-xs text-emerald-300/90">
          {t("usage.autoSignedIn", {
            names: autoSignedInRows.map((row) => row.account.name).join(", "),
          })}
        </p>
      )}
      {refreshedRows.length > 0 && (
        <p role="status" className="text-[11px] text-white/35">
          {t("usage.sessionRefreshed", {
            names: refreshedRows.map((row) => row.account.name).join(", "),
          })}
        </p>
      )}
      {resetRows.length > 0 && (
        <p role="status" className="text-xs text-amber-300">
          <History size={12} className="mr-1 inline" />
          {t("usage.resetNotice", {
            list: resetRows
              .map(
                (row) =>
                  `${row.account.name} (${formatDateTime(row.lastResetAt)})`
              )
              .join(", "),
          })}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          icon={<Zap size={20} />}
          label={t("usage.accountsTotalTokens")}
          value={loading ? "---" : formatNumber(totals.totalTokens)}
          sublabel={t("usage.accountsTotalTokensHint", {
            value: formatNumber(totals.serverTokens),
          })}
          highlight
        />
        <StatCard
          icon={<Activity size={18} />}
          label={t("usage.totalRequests")}
          value={loading ? "---" : formatNumber(totals.totalRequests)}
          sublabel={t("usage.totalRequestsHint", {
            value: formatNumber(totals.serverRequests),
          })}
        />
        <StatCard
          icon={<DollarSign size={18} />}
          label={t("usage.totalCost")}
          value={loading ? "$---" : formatCost(totals.totalCost)}
          sublabel={t("usage.totalCostHint", {
            value: formatCost(totals.serverCost),
          })}
        />
        <StatCard
          icon={<ChartPie size={18} />}
          label={t("usage.activeAccounts")}
          value={String(enabledCount)}
          sublabel={t("usage.activeAccountsHint", {
            accounts: accounts.length,
            offline: offlineCount,
          })}
        />
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 backdrop-blur-xl">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-white/55">
          {t("usage.chartTitle")}
        </h2>
        <DailyBar days={snapshotDays} />
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 backdrop-blur-xl">
        <h2 className="text-sm font-medium uppercase tracking-wider text-white/55">
          {t("usage.accountsTitle")}
        </h2>

        {accounts.length === 0 ? (
          <div className="py-10 text-center">
            <UserRound size={32} className="mx-auto text-white/25" />
            <p className="mt-3 text-sm text-white/50">{t("usage.noAccounts")}</p>
            <p className="mt-1 text-xs text-white/30">{t("usage.noAccountsHint")}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {accounts.map((account) => {
              const row = rows.find((item) => item.account.id === account.id);
              const isEnabled = account.enabled;
              const savedPassword = hasStoredPassword(account);
              const unreadablePassword = hasUnreadablePassword(account);
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
                    <div className="flex flex-wrap items-center gap-2">
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
                          ? t("usage.statusOffline")
                          : row?.status === "error"
                            ? t("usage.statusError")
                            : isEnabled
                              ? t("usage.statusEnabled")
                              : t("usage.statusDisabled")}
                      </span>
                      {savedPassword && (
                        <span
                          title={
                            account.autoRelogin
                              ? t("usage.autoSignInOnTitle", {
                                  lastUsed: account.lastAutoLoginAt
                                    ? t("usage.autoSignInLastUsed", {
                                        time: formatDateTime(account.lastAutoLoginAt),
                                      })
                                    : "",
                                })
                              : t("usage.passwordSavedTitle")
                          }
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                            account.autoRelogin
                              ? "bg-emerald-500/10 text-emerald-300/80"
                              : "bg-white/10 text-white/40"
                          }`}
                        >
                          <ShieldCheck size={10} />
                          {account.autoRelogin
                            ? t("usage.badgeAutoSignIn")
                            : t("usage.badgePasswordSaved")}
                        </span>
                      )}
                      {unreadablePassword && (
                        <span
                          title={t("usage.passwordUnavailableTitle")}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300/90"
                        >
                          <CircleAlert size={10} />
                          {t("usage.badgePasswordUnavailable")}
                        </span>
                      )}
                      {row?.autoSignedIn && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                          <KeyRound size={10} />
                          {t("usage.badgeSignedInAutomatically")}
                        </span>
                      )}
                      {isRecentReset(row?.lastResetAt) && (
                        <span
                          title={t("usage.resetChipTitle", {
                            time: formatDateTime(row?.lastResetAt),
                          })}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"
                        >
                          <History size={10} />
                          {t("usage.badgeRelayCleared")}
                        </span>
                      )}
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
                          {t("usage.noSavedData")}
                        </p>
                        <p className="mt-0.5 max-w-[220px] truncate text-[10px] text-white/30">
                          {row.error}
                        </p>
                      </div>
                    ) : (
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium tabular-nums text-white/75">
                          {t("usage.tokensValue", { value: formatNumber(row.totalTokens) })}
                        </p>
                        <p className="text-[11px] tabular-nums text-white/35">
                          {t("usage.requestsAndCost", {
                            requests: formatNumber(row.totalRequests),
                            cost: formatCost(row.totalCost),
                          })}
                        </p>
                        <p className="text-[10px] tabular-nums text-white/25">
                          {t("usage.relayReports", {
                            tokens: formatNumber(row.serverTokens),
                            requests: formatNumber(row.serverRequests),
                            cost: formatCost(row.serverCost),
                          })}
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] text-white/30">{t("usage.notIncluded")}</p>
                    </div>
                  )}

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title={t("usage.switchTo")}
                      onClick={() => void handleSwitch(account)}
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-sky-300"
                    >
                      <ArrowLeftRight size={14} />
                    </button>
                    <button
                      type="button"
                      title={
                        savedPassword
                          ? t("usage.keyWithPassword")
                          : t("usage.keyWithoutPassword")
                      }
                      onClick={() => void handleKey(account)}
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-emerald-300"
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      type="button"
                      title={
                        account.autoRelogin
                          ? t("usage.autoSignInOnClick")
                          : t("usage.rememberPasswordTitle")
                      }
                      onClick={() => void handleToggleAutoRelogin(account)}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl transition-all hover:bg-white/10 ${
                        account.autoRelogin ? "text-emerald-300/80" : "text-white/40"
                      }`}
                    >
                      <ShieldCheck size={14} />
                    </button>
                    <button
                      type="button"
                      title={isEnabled ? t("usage.disableAccount") : t("usage.enableAccount")}
                      onClick={() => handleToggleEnabled(account)}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 ${
                        isEnabled ? "hover:text-amber-300" : "hover:text-emerald-300"
                      }`}
                    >
                      <Power size={14} />
                    </button>
                    <button
                      type="button"
                      title={t("usage.deleteAccount")}
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

      <p className="text-[11px] leading-5 text-white/30">
        {t("usage.localHistoryNote")}
      </p>

      <AddAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={() => {
          refreshAccounts();
          void loadUsage({ background: true });
        }}
        onError={setPageError}
      />
      <ReLoginModal
        open={reloginOpen}
        account={reloginAccount}
        mode={reloginMode}
        onClose={() => setReloginOpen(false)}
        onDone={() => {
          refreshAccounts();
          void loadUsage({ background: true });
        }}
        onError={setPageError}
      />
    </div>
  );
}
