/**
 * Multi-account session layer.
 *
 * An "account" is a Sub2API relay URL plus username/password credential set.
 * Each account signs in against its own relay URL and keeps its own tokens.
 * Switching accounts swaps the global session (token + base URL) used by the
 * Dashboard. Total Usage aggregates usage across all enabled accounts and
 * keeps an offline snapshot of every account's usage so history survives
 * outages.
 *
 * Sessions are renewed automatically, in this order:
 *   1. the stored refresh token,
 *   2. the stored password (`autoRelogin`, opt-out per account) when the
 *      refresh token is gone or rejected — this is what signs an account back
 *      in after the relay expires its session.
 */
import {
  ApiError,
  clearStoredTokens,
  loginWithBaseUrl,
  normalizeApiBaseUrl,
  refreshAccountSession,
} from "./api";
import {
  hasRecoverableSecret,
  isObfuscatedSecret,
  obfuscateSecret,
  revealSecret,
} from "./secret-store";

export interface Account {
  /** Stable local id (not the server username). */
  id: string;
  /** Display name chosen by the user. */
  name: string;
  /** Relay base URL the account signs into (normalized, e.g. https://host/api/v1). */
  baseUrl: string;
  /** Sub2API username or email used to sign in. */
  username: string;
  /** Access token captured at login (kept per account). */
  accessToken: string;
  /** Refresh token captured at login (kept per account). */
  refreshToken: string;
  /** Token expiry in epoch ms (when known). */
  expiresAt: number | null;
  /**
   * Obfuscated password kept locally so the account can sign itself back in.
   * Only present when the user opted in with "remember password".
   */
  password?: string;
  /** Allow automatic re-login with the stored password. */
  autoRelogin: boolean;
  /** When the account last signed itself back in. */
  lastAutoLoginAt?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountDraft {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  /** Keep the password locally so the account can sign in again by itself. */
  rememberPassword: boolean;
  enabled: boolean;
}

interface LoginResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

const STORAGE_KEY = "sub2api_accounts_v3";
const ACTIVE_ACCOUNT_KEY = "sub2api_active_account_id";

/** Renew a session this long before the access token actually expires. */
const SESSION_SKEW_MS = 120_000;

export function notifyAccountsChanged(): void {
  window.dispatchEvent(new Event("accounts-changed"));
}

export function generateAccountId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getJwtExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(
      normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    );
    const parsed = JSON.parse(decoded) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function getActiveAccountId(): string | null {
  return localStorage.getItem(ACTIVE_ACCOUNT_KEY);
}

export function getActiveAccount(): Account | null {
  const id = getActiveAccountId();
  if (!id) return null;
  return loadAccounts().find((account) => account.id === id) ?? null;
}

export function setActiveAccountId(id: string): void {
  localStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
}

/** Normalize a stored record, filling in fields added by newer versions. */
function normalizeAccount(item: Account): Account {
  const password = typeof item.password === "string" ? item.password : undefined;
  const storedPassword = isObfuscatedSecret(password) ? password : undefined;
  return {
    ...item,
    password: storedPassword,
    // Accounts saved before automatic re-login existed keep it off until the
    // user stores a password for them.
    autoRelogin: item.autoRelogin === true && !!storedPassword,
  };
}

export function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Account =>
          !!item &&
          typeof item === "object" &&
          typeof (item as Account).id === "string" &&
          typeof (item as Account).baseUrl === "string" &&
          typeof (item as Account).username === "string" &&
          typeof (item as Account).accessToken === "string"
      )
      .map(normalizeAccount);
  } catch {
    return [];
  }
}

function persistAccounts(accounts: Account[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

/**
 * Replace the stored account list (used by backup restore) and re-apply the
 * global session so the active account keeps working.
 */
export function saveAccounts(accounts: Account[]): void {
  persistAccounts(accounts);
  const activeId = getActiveAccountId();
  const active = activeId ? accounts.find((item) => item.id === activeId) : null;
  if (active) {
    applyGlobalSession(active);
    setActiveAccountId(active.id);
    window.dispatchEvent(new Event("auth-changed"));
  } else {
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    ensureActiveAccount();
  }
  notifyAccountsChanged();
}

function toAccount(input: AccountDraft, data: LoginResult, id?: string): Account {
  const now = new Date().toISOString();
  const expiresAt =
    typeof data.expires_in === "number"
      ? Date.now() + data.expires_in * 1000
      : getJwtExpiryMs(data.access_token);
  const storedPassword = input.rememberPassword
    ? obfuscateSecret(input.password)
    : "";
  return {
    id: id ?? generateAccountId(),
    name: input.name.trim(),
    baseUrl: normalizeApiBaseUrl(input.baseUrl),
    username: input.username.trim(),
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt,
    password: storedPassword || undefined,
    autoRelogin: storedPassword.length > 0,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  };
}

/** Swap the global session keys to the given account's tokens + base URL. */
function applyGlobalSession(account: Account): void {
  localStorage.setItem("auth_token", account.accessToken);
  localStorage.setItem("access_token", account.accessToken);
  localStorage.setItem("api_base_url", account.baseUrl);
  if (account.refreshToken) {
    localStorage.setItem("refresh_token", account.refreshToken);
  } else {
    localStorage.removeItem("refresh_token");
  }
  if (account.expiresAt !== null) {
    localStorage.setItem("token_expires_at", String(account.expiresAt));
  } else {
    localStorage.removeItem("token_expires_at");
  }
}

/**
 * Make sure an account is active. If no account is active but accounts exist,
 * activate the first enabled account (or the first account) synchronously.
 */
export function ensureActiveAccount(): Account | null {
  const currentId = getActiveAccountId();
  if (currentId) {
    const existing = loadAccounts().find((account) => account.id === currentId);
    if (existing) return existing;
  }
  const accounts = loadAccounts();
  if (accounts.length === 0) return null;
  const target = accounts.find((account) => account.enabled) ?? accounts[0];
  applyGlobalSession(target);
  setActiveAccountId(target.id);
  return target;
}

/** Sign in a new account against its relay URL and make it the active account. */
export async function addAccount(input: AccountDraft): Promise<Account> {
  const name = input.name.trim();
  const username = input.username.trim();
  const password = input.password;
  if (!name) throw new Error("Enter an account name.");
  if (!username) throw new Error("Enter the Sub2API username or email.");
  if (!password) throw new Error("Enter the account password.");

  const baseUrl = normalizeApiBaseUrl(input.baseUrl);
  const data = await loginWithBaseUrl(baseUrl, username, password);
  if (!data.access_token) {
    throw new ApiError("Login response did not include access_token.", 200);
  }

  const account = toAccount({ ...input, baseUrl }, data);
  const accounts = loadAccounts().filter((item) => item.id !== account.id);
  persistAccounts([...accounts, account]);
  applyGlobalSession(account);
  setActiveAccountId(account.id);
  window.dispatchEvent(new Event("auth-changed"));
  notifyAccountsChanged();
  return account;
}

/** Activate an existing account: swap the global session to its tokens + URL. */
export async function activateAccount(id: string): Promise<Account> {
  const account = loadAccounts().find((item) => item.id === id);
  if (!account) throw new Error("Account no longer exists.");
  if (!account.accessToken) throw new Error("This account has no saved session.");
  applyGlobalSession(account);
  setActiveAccountId(account.id);
  window.dispatchEvent(new Event("auth-changed"));
  notifyAccountsChanged();
  return account;
}

export function hasStoredPassword(account: Account): boolean {
  return hasRecoverableSecret(account.password);
}

/**
 * Check a password against the relay, then keep it locally so the account can
 * sign itself back in later. The active account is not switched.
 */
export async function enableAutoRelogin(
  id: string,
  password: string
): Promise<Account> {
  const existing = loadAccounts().find((account) => account.id === id);
  if (!existing) throw new Error("Account no longer exists.");
  if (!password) throw new Error("Enter the account password.");

  const data = await loginWithBaseUrl(existing.baseUrl, existing.username, password);
  if (!data.access_token) {
    throw new ApiError("Login response did not include access_token.", 200);
  }

  const stored = obfuscateSecret(password);
  if (!stored) throw new Error("Unable to store the password on this device.");

  const updated = updateAccountSession(id, data, {
    password: stored,
    autoRelogin: true,
    lastAutoLoginAt: new Date().toISOString(),
  });
  if (!updated) throw new Error("Unable to update the account session.");
  notifyAccountsChanged();
  return updated;
}

/**
 * Re-sign-in an existing account after its token expired. The stored session
 * is replaced with a fresh one from the relay. With `rememberPassword` the new
 * password is kept locally so the account can renew itself next time.
 */
export async function reloginAccount(
  id: string,
  password: string,
  rememberPassword = true
): Promise<Account> {
  const existing = loadAccounts().find((account) => account.id === id);
  if (!existing) throw new Error("Account no longer exists.");
  if (!password && !hasStoredPassword(existing)) {
    throw new Error("Enter the account password.");
  }

  const secret = password || revealSecret(existing.password);
  const data = await loginWithBaseUrl(existing.baseUrl, existing.username, secret);
  if (!data.access_token) {
    throw new ApiError("Login response did not include access_token.", 200);
  }

  const updated = updateAccountSession(id, data, {
    password: rememberPassword ? obfuscateSecret(secret) : undefined,
    autoRelogin: rememberPassword && !!obfuscateSecret(secret),
  });
  if (!updated) throw new Error("Unable to update the account session.");
  setActiveAccountId(id);
  applyGlobalSession(updated);
  window.dispatchEvent(new Event("auth-changed"));
  notifyAccountsChanged();
  return updated;
}

/** Remove an account. If it was the active one, activate another account. */
export function deleteAccount(id: string): void {
  const accounts = loadAccounts().filter((account) => account.id !== id);
  persistAccounts(accounts);
  if (getActiveAccountId() === id) {
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    const next = accounts.find((account) => account.enabled) ?? accounts[0] ?? null;
    if (next) {
      applyGlobalSession(next);
      setActiveAccountId(next.id);
      window.dispatchEvent(new Event("auth-changed"));
    } else {
      clearStoredTokens();
    }
  }
  notifyAccountsChanged();
}

export function setAccountEnabled(id: string, enabled: boolean): void {
  const accounts = loadAccounts().map((account) =>
    account.id === id
      ? { ...account, enabled, updatedAt: new Date().toISOString() }
      : account
  );
  persistAccounts(accounts);
  notifyAccountsChanged();
}

/**
 * Turn automatic re-login on or off for an account. Enabling it requires a
 * password, which is stored obfuscated on this machine. Disabling it erases the
 * stored password.
 */
export function setAccountAutoRelogin(
  id: string,
  enabled: boolean,
  password = ""
): Account {
  const accounts = loadAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index < 0) throw new Error("Account no longer exists.");

  const current = accounts[index];
  if (!enabled) {
    const cleared: Account = {
      ...current,
      password: undefined,
      autoRelogin: false,
      updatedAt: new Date().toISOString(),
    };
    accounts[index] = cleared;
    persistAccounts(accounts);
    notifyAccountsChanged();
    return cleared;
  }

  const stored = password ? obfuscateSecret(password) : current.password ?? "";
  if (!hasRecoverableSecret(stored)) {
    throw new Error(
      password
        ? "Unable to store the password on this device."
        : "Enter the account password to enable automatic sign-in."
    );
  }
  const updated: Account = {
    ...current,
    password: stored,
    autoRelogin: true,
    updatedAt: new Date().toISOString(),
  };
  accounts[index] = updated;
  persistAccounts(accounts);
  notifyAccountsChanged();
  return updated;
}

export function getEnabledAccounts(): Account[] {
  return loadAccounts().filter((account) => account.enabled);
}

export interface SessionUpdate {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Persist a refreshed session onto an account record. */
export function updateAccountSession(
  id: string,
  data: SessionUpdate,
  extra: Partial<Account> = {}
): Account | null {
  const accounts = loadAccounts();
  const index = accounts.findIndex((account) => account.id === id);
  if (index < 0) return null;
  const current = accounts[index];
  const expiresAt =
    typeof data.expires_in === "number"
      ? Date.now() + data.expires_in * 1000
      : getJwtExpiryMs(data.access_token);
  const next: Account = {
    ...current,
    ...extra,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt,
    updatedAt: new Date().toISOString(),
  };
  accounts[index] = next;
  persistAccounts(accounts);
  if (getActiveAccountId() === id) {
    applyGlobalSession(next);
  }
  return next;
}

/** Request context for an account (relay URL + account token). */
export function getAccountRequestContext(account: Account): {
  baseUrl: string;
  apiKey: string;
} {
  return { baseUrl: account.baseUrl, apiKey: account.accessToken };
}

/** Try to refresh an account token; returns the updated account or null. */
export async function refreshAccountToken(
  account: Account
): Promise<Account | null> {
  if (!account.refreshToken) return null;
  try {
    const data = await refreshAccountSession(
      account.refreshToken,
      account.accessToken,
      account.baseUrl
    );
    if (!data.access_token) return null;
    return updateAccountSession(account.id, data);
  } catch {
    return null;
  }
}

/**
 * True when the stored session can still be used without contacting the relay.
 * Tokens without a readable expiry (opaque tokens) are trusted until a request
 * comes back with 401.
 */
export function isSessionUsable(
  account: Account,
  skewMs: number = SESSION_SKEW_MS
): boolean {
  if (!account.accessToken) return false;
  const expiry = account.expiresAt ?? getJwtExpiryMs(account.accessToken);
  if (expiry === null) return true;
  return expiry > Date.now() + skewMs;
}

export interface SessionRenewalOptions {
  /** Renew even when the stored session still looks valid (used after a 401). */
  force?: boolean;
  /** Do not fall back to the stored password. */
  allowPassword?: boolean;
  /** Headroom before expiry that still counts as "needs renewal". */
  skewMs?: number;
  /** Sign in with the saved password even inside its throttle window. */
  ignoreCooldown?: boolean;
}

/** Reason an account could not renew itself. */
export function sessionRenewalHelp(account: Account): string {
  if (hasStoredPassword(account) && account.autoRelogin) {
    return `Automatic sign-in failed for ${account.name}. Check the relay URL, the username/password, or sign in again manually.`;
  }
  return `Session expired for ${account.name}. Open the key icon on its row and sign in again, or turn on "Remember password" to let it sign in automatically next time.`;
}

/**
 * Automatic sign-ins are throttled so several polling views (dashboard, widget,
 * Total Usage) cannot hammer the relay's login endpoint, and so a wrong password
 * fails fast instead of risking an account lockout.
 */
const AUTO_LOGIN_SUCCESS_COOLDOWN_MS = 30_000;
const AUTO_LOGIN_FAILURE_COOLDOWN_MS = 300_000;

const autoLoginCooldownUntil = new Map<string, number>();
const autoLoginInFlight = new Map<string, Promise<Account>>();

/**
 * Sign in with the password kept on this machine. Returns null when there is no
 * saved password or the account is inside its cooldown window.
 */
async function autoLoginWithPassword(
  account: Account,
  ignoreCooldown = false
): Promise<Account | null> {
  if (!account.autoRelogin) return null;
  const secret = revealSecret(account.password);
  if (!secret) return null;

  const cooldownUntil = autoLoginCooldownUntil.get(account.id) ?? 0;
  if (!ignoreCooldown && Date.now() < cooldownUntil) return null;

  // Share one attempt between concurrent callers.
  const inFlight = autoLoginInFlight.get(account.id);
  if (inFlight) {
    return inFlight.catch(() => null);
  }

  const attempt = (async () => {
    const data = await loginWithBaseUrl(account.baseUrl, account.username, secret);
    if (!data.access_token) {
      throw new ApiError("Login response did not include access_token.", 200);
    }
    const updated = updateAccountSession(account.id, data, {
      lastAutoLoginAt: new Date().toISOString(),
    });
    if (!updated) throw new Error("Unable to update the account session.");
    notifyAccountsChanged();
    return updated;
  })();

  autoLoginInFlight.set(account.id, attempt);
  try {
    const updated = await attempt;
    autoLoginCooldownUntil.set(
      account.id,
      Date.now() + AUTO_LOGIN_SUCCESS_COOLDOWN_MS
    );
    return updated;
  } catch (error: unknown) {
    autoLoginCooldownUntil.set(
      account.id,
      Date.now() + AUTO_LOGIN_FAILURE_COOLDOWN_MS
    );
    throw error;
  } finally {
    if (autoLoginInFlight.get(account.id) === attempt) {
      autoLoginInFlight.delete(account.id);
    }
  }
}

/**
 * Make sure an account has a usable session, renewing it when needed:
 * refresh token first, then the stored password. Throws an ApiError (401) when
 * the account cannot renew itself, so callers can prompt for a password.
 */
export async function ensureAccountSession(
  account: Account,
  options: SessionRenewalOptions = {}
): Promise<Account> {
  const {
    force = false,
    allowPassword = true,
    skewMs = SESSION_SKEW_MS,
    ignoreCooldown = false,
  } = options;
  const current = loadAccounts().find((item) => item.id === account.id) ?? account;

  if (!force && isSessionUsable(current, skewMs)) {
    return current;
  }

  const refreshed = await refreshAccountToken(current);
  if (refreshed?.accessToken) {
    notifyAccountsChanged();
    return refreshed;
  }

  if (allowPassword) {
    try {
      const signedIn = await autoLoginWithPassword(current, ignoreCooldown);
      if (signedIn) return signedIn;
    } catch (error: unknown) {
      if (
        !(error instanceof ApiError) ||
        (error.status !== 401 && error.status !== 400 && error.status !== undefined)
      ) {
        // Connection problems and relay errors surface as-is.
        throw error;
      }
      throw new ApiError(
        `${sessionRenewalHelp(current)} (${error.message})`,
        401
      );
    }
  }

  throw new ApiError(sessionRenewalHelp(current), 401);
}

/**
 * Sign an account back in with its stored password, without switching the
 * active account. Used by the background usage sync and the key button.
 */
export async function autoReloginAccount(id: string): Promise<Account> {
  const account = loadAccounts().find((item) => item.id === id);
  if (!account) throw new Error("Account no longer exists.");
  if (!account.autoRelogin || !hasStoredPassword(account)) {
    throw new ApiError(
      `No saved password for ${account.name}; sign in again manually.`,
      401
    );
  }
  return ensureAccountSession(account, { force: true, ignoreCooldown: true });
}

export interface AccountRequestResult<T> {
  value: T;
  /** The account record, updated when the session was renewed. */
  account: Account;
  /** True when the request needed a fresh session before it succeeded. */
  renewed: boolean;
}

/**
 * Run an authenticated request for an account, renewing the session (refresh
 * token, then stored password) and retrying once when the relay answers 401.
 */
export async function requestWithAccountSession<T>(
  account: Account,
  run: (context: ReturnType<typeof getAccountRequestContext>) => Promise<T>
): Promise<AccountRequestResult<T>> {
  let current = await ensureAccountSession(account);
  try {
    return {
      value: await run(getAccountRequestContext(current)),
      account: current,
      renewed: current.accessToken !== account.accessToken,
    };
  } catch (error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    current = await ensureAccountSession(account, { force: true });
    return {
      value: await run(getAccountRequestContext(current)),
      account: current,
      renewed: true,
    };
  }
}

/** Accounts whose password is stored but could not be read (device key lost). */
export function hasUnreadablePassword(account: Account): boolean {
  return isObfuscatedSecret(account.password) && !hasRecoverableSecret(account.password);
}
