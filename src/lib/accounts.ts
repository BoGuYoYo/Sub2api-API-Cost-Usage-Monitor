/**
 * Multi-account session layer.
 *
 * An "account" is a Sub2API relay URL plus username/password credential set.
 * Each account signs in against its own relay URL and keeps its own tokens.
 * Switching accounts swaps the global session (token + base URL) used by the
 * Dashboard. Total Usage aggregates usage across all enabled accounts and
 * keeps an offline snapshot of every account's usage so history survives
 * outages.
 */
import {
  ApiError,
  clearStoredTokens,
  loginWithBaseUrl,
  normalizeApiBaseUrl,
  refreshAccountSession,
} from "./api";

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
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountDraft {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  enabled: boolean;
}

interface LoginResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

const STORAGE_KEY = "sub2api_accounts_v3";
const ACTIVE_ACCOUNT_KEY = "sub2api_active_account_id";

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

export function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Account =>
        !!item &&
        typeof item === "object" &&
        typeof (item as Account).id === "string" &&
        typeof (item as Account).baseUrl === "string" &&
        typeof (item as Account).username === "string" &&
        typeof (item as Account).accessToken === "string"
    );
  } catch {
    return [];
  }
}

function persistAccounts(accounts: Account[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

function toAccount(input: AccountDraft, data: LoginResult, id?: string): Account {
  const now = new Date().toISOString();
  const expiresAt =
    typeof data.expires_in === "number"
      ? Date.now() + data.expires_in * 1000
      : getJwtExpiryMs(data.access_token);
  return {
    id: id ?? generateAccountId(),
    name: input.name.trim(),
    baseUrl: normalizeApiBaseUrl(input.baseUrl),
    username: input.username.trim(),
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt,
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

/**
 * Re-sign-in an existing account after its token expired. The stored
 * session is replaced with a fresh one from the relay.
 */
export async function reloginAccount(
  id: string,
  password: string
): Promise<Account> {
  const existing = loadAccounts().find((account) => account.id === id);
  if (!existing) throw new Error("Account no longer exists.");
  if (!password) throw new Error("Enter the account password.");

  const data = await loginWithBaseUrl(
    existing.baseUrl,
    existing.username,
    password
  );
  if (!data.access_token) {
    throw new ApiError("Login response did not include access_token.", 200);
  }

  const updated = updateAccountSession(id, data);
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

export function getEnabledAccounts(): Account[] {
  return loadAccounts().filter((account) => account.enabled);
}

export interface SessionUpdate {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Persist a refreshed session onto an account record. */
export function updateAccountSession(id: string, data: SessionUpdate): Account | null {
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
