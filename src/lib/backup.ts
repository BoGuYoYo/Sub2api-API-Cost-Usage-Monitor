/**
 * Local data backup and restore.
 *
 * Everything the app knows lives in this machine's WebView storage: the account
 * list (with saved sessions and obfuscated passwords) and the locally
 * accumulated usage history. Exporting a JSON copy means the history survives
 * even a cleared app data directory, a reinstall, or a move to another machine.
 * Restoring never shrinks local history: totals are merged with a per-field
 * maximum.
 */
import {
  loadAccounts,
  saveAccounts,
  type Account,
} from "./accounts";
import { t } from "./i18n";
import {
  getDeviceKey,
  hasDeviceKey,
  hasRecoverableSecret,
  setDeviceKey,
} from "./secret-store";
import {
  loadAllSnapshots,
  mergeSnapshotMaps,
  saveAllSnapshots,
  type AccountUsageSnapshot,
} from "./usage-snapshots";

export const BACKUP_APP_ID = "sub2api-api-cost-usage-monitor";
export const BACKUP_FORMAT_VERSION = 2;

export interface LocalBackup {
  app: string;
  version: number;
  exportedAt: string;
  /** Device key so saved passwords stay usable after a restore. */
  deviceKey?: string;
  activeAccountId?: string | null;
  accounts: Account[];
  snapshots: Record<string, AccountUsageSnapshot>;
}

export interface ImportSummary {
  accountsAdded: number;
  accountsUpdated: number;
  snapshotsMerged: number;
  /** Accounts with a saved password that is readable after the import. */
  passwordsRestored: number;
  /** Accounts whose saved password cannot be read on this installation. */
  passwordsUnavailable: number;
}

export function createBackup(): LocalBackup {
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    deviceKey: getDeviceKey(),
    activeAccountId: localStorage.getItem("sub2api_active_account_id"),
    accounts: loadAccounts(),
    snapshots: loadAllSnapshots(),
  };
}

export function backupToJson(backup: LocalBackup = createBackup()): string {
  return JSON.stringify(backup, null, 2);
}

export function backupFileName(backup: LocalBackup = createBackup()): string {
  const stamp = backup.exportedAt.replace(/[:.]/g, "-");
  return `sub2api-monitor-backup-${stamp}.json`;
}

/** Download the backup as a JSON file next to the user's other downloads. */
export function downloadBackup(): void {
  const backup = createBackup();
  const blob = new Blob([backupToJson(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = backupFileName(backup);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Copy the backup JSON to the clipboard (small data sets, mouse-free path). */
export async function copyBackupToClipboard(): Promise<void> {
  await navigator.clipboard.writeText(backupToJson());
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

function parseBackup(json: string): LocalBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BackupError(t("backup.invalidJson"));
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BackupError(t("backup.notABackup"));
  }
  const candidate = parsed as Partial<LocalBackup>;
  const accounts = Array.isArray(candidate.accounts) ? candidate.accounts : [];
  const snapshots =
    candidate.snapshots &&
    typeof candidate.snapshots === "object" &&
    !Array.isArray(candidate.snapshots)
      ? (candidate.snapshots as Record<string, AccountUsageSnapshot>)
      : {};
  if (accounts.length === 0 && Object.keys(snapshots).length === 0) {
    throw new BackupError(t("backup.empty"));
  }
  return {
    app: typeof candidate.app === "string" ? candidate.app : BACKUP_APP_ID,
    version:
      typeof candidate.version === "number"
        ? candidate.version
        : BACKUP_FORMAT_VERSION,
    exportedAt:
      typeof candidate.exportedAt === "string"
        ? candidate.exportedAt
        : new Date().toISOString(),
    deviceKey:
      typeof candidate.deviceKey === "string" ? candidate.deviceKey : undefined,
    activeAccountId: candidate.activeAccountId ?? null,
    accounts,
    snapshots,
  };
}

function isAccount(value: unknown): value is Account {
  const account = value as Account | null;
  return (
    !!account &&
    typeof account === "object" &&
    typeof account.id === "string" &&
    typeof account.baseUrl === "string" &&
    typeof account.username === "string"
  );
}

/**
 * Merge an account from a backup with the local record: the newer record wins,
 * but a saved password is never dropped when only one side has one.
 */
function mergeAccount(current: Account | undefined, incoming: Account): Account {
  const normalized: Account = {
    ...incoming,
    accessToken: typeof incoming.accessToken === "string" ? incoming.accessToken : "",
    refreshToken: typeof incoming.refreshToken === "string" ? incoming.refreshToken : "",
    expiresAt: typeof incoming.expiresAt === "number" ? incoming.expiresAt : null,
    enabled: incoming.enabled !== false,
    createdAt: incoming.createdAt ?? new Date().toISOString(),
    updatedAt: incoming.updatedAt ?? new Date().toISOString(),
  };
  if (!current) return normalized;

  const currentIsNewer = (current.updatedAt ?? "") > (normalized.updatedAt ?? "");
  const preferred = currentIsNewer ? { ...normalized, ...current } : normalized;
  const currentHasPassword = hasRecoverableSecret(current.password);
  const incomingHasPassword = hasRecoverableSecret(normalized.password);

  if (!hasRecoverableSecret(preferred.password)) {
    if (currentHasPassword) {
      preferred.password = current.password;
      preferred.autoRelogin = current.autoRelogin;
    } else if (incomingHasPassword) {
      preferred.password = normalized.password;
      preferred.autoRelogin = normalized.autoRelogin;
    }
  }
  // Never activate automatic sign-in without a readable password.
  if (!hasRecoverableSecret(preferred.password)) {
    preferred.password = undefined;
    preferred.autoRelogin = false;
  }
  return preferred;
}

/**
 * Restore a backup. Local totals are merged (never reduced) and accounts are
 * combined by id. Returns a summary so the UI can report what happened.
 */
export function importBackup(json: string): ImportSummary {
  const backup = parseBackup(json);

  const incomingAccounts = backup.accounts.filter(isAccount);
  const currentAccounts = loadAccounts();

  // Adopt the backup's device key only on a fresh installation; otherwise the
  // existing key must stay or every locally saved password would break.
  if (backup.deviceKey && !hasDeviceKey() && currentAccounts.length === 0) {
    setDeviceKey(backup.deviceKey);
  }

  let accountsAdded = 0;
  let accountsUpdated = 0;
  let passwordsRestored = 0;
  let passwordsUnavailable = 0;

  const byId = new Map(currentAccounts.map((account) => [account.id, account]));
  for (const incoming of incomingAccounts) {
    const current = byId.get(incoming.id);
    const merged = mergeAccount(current, incoming);
    if (current) {
      accountsUpdated += 1;
    } else {
      accountsAdded += 1;
    }
    passwordsRestored += hasRecoverableSecret(merged.password) ? 1 : 0;
    passwordsUnavailable +=
      !!merged.password && !hasRecoverableSecret(merged.password) ? 1 : 0;
    byId.set(incoming.id, merged);
  }

  if (incomingAccounts.length > 0) {
    saveAccounts([...byId.values()]);
  }

  const mergedSnapshots = mergeSnapshotMaps(loadAllSnapshots(), backup.snapshots);
  saveAllSnapshots(mergedSnapshots);

  return {
    accountsAdded,
    accountsUpdated,
    snapshotsMerged: Object.keys(backup.snapshots).length,
    passwordsRestored,
    passwordsUnavailable,
  };
}
