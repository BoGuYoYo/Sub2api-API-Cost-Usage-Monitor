import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export const DEFAULT_API_URL = "";
const API_URL_STORAGE_KEY = "api_base_url";

export function normalizeApiBaseUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter a Sub2API website URL.");

  const withProtocol = /^https?:\/\//i.test(input)
    ? input
    : `https://${input}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api/v1")) {
    return `${url.origin}${pathname}`;
  }
  if (pathname.endsWith("/api")) {
    pathname += "/v1";
  } else {
    pathname += "/api/v1";
  }
  return `${url.origin}${pathname}`;
}

export function getConfiguredApiUrl(): string {
  return localStorage.getItem(API_URL_STORAGE_KEY) || DEFAULT_API_URL;
}

export function getApiBaseUrl(): string {
  return normalizeApiBaseUrl(getConfiguredApiUrl());
}

export function saveApiBaseUrl(value: string): string {
  const normalized = normalizeApiBaseUrl(value);
  localStorage.setItem(API_URL_STORAGE_KEY, normalized);
  return normalized;
}

export interface ConnectionCheck {
  reachable: boolean;
  status?: number;
  detail: string;
}

export async function checkApiConnection(value: string): Promise<ConnectionCheck> {
  let baseUrl: string;
  try {
    baseUrl = normalizeApiBaseUrl(value);
  } catch (reason: unknown) {
    return {
      reachable: false,
      detail: reason instanceof Error ? reason.message : "Invalid URL.",
    };
  }

  try {
    const response = await tauriFetch(`${baseUrl}/auth/me`, {
      method: "GET",
      headers: {
        "Accept-Language": "zh-CN",
      },
      connectTimeout: 15000,
    });
    return {
      reachable: true,
      status: response.status,
      detail: `${baseUrl} responded with HTTP ${response.status}.`,
    };
  } catch (error: unknown) {
    return {
      reachable: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

interface ApiEnvelope<T> {
  code?: number;
  data?: T;
  message?: string;
  detail?: string;
}

export class ApiError extends Error {
  status?: number;
  code?: number;

  constructor(message: string, status?: number, code?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function clearStoredTokens() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("token_expires_at");
  cancelTokenAutoRefresh();
}

const TOKEN_EXPIRY_STORAGE_KEY = "token_expires_at";
const REFRESH_AHEAD_MS = 120_000;
const REFRESH_LOCK_KEY = "sub2api-auth-token-refresh";

let refreshInFlight: Promise<string | null> | null = null;
let autoRefreshTimer: number | null = null;

interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem("refresh_token");
}

function getStoredTokenExpiry(): number | null {
  const raw = localStorage.getItem(TOKEN_EXPIRY_STORAGE_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
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

export function isTokenExpired(token: string): boolean {
  const expiry = getJwtExpiryMs(token);
  return expiry !== null && expiry <= Date.now();
}

function shouldRefreshToken(token: string): boolean {
  const expiry = getStoredTokenExpiry() ?? getJwtExpiryMs(token);
  return expiry !== null && expiry <= Date.now() + REFRESH_AHEAD_MS;
}

function persistAuthTokens(data: LoginResponse): void {
  localStorage.setItem("auth_token", data.access_token);
  localStorage.setItem("access_token", data.access_token);
  if (data.refresh_token) {
    localStorage.setItem("refresh_token", data.refresh_token);
  }
  if (typeof data.expires_in === "number") {
    localStorage.setItem(
      TOKEN_EXPIRY_STORAGE_KEY,
      String(Date.now() + data.expires_in * 1000)
    );
  } else {
    const jwtExpiry = getJwtExpiryMs(data.access_token);
    if (jwtExpiry !== null) {
      localStorage.setItem(TOKEN_EXPIRY_STORAGE_KEY, String(jwtExpiry));
    } else {
      localStorage.removeItem(TOKEN_EXPIRY_STORAGE_KEY);
    }
  }
  scheduleTokenAutoRefresh();
}

export function cancelTokenAutoRefresh(): void {
  if (autoRefreshTimer !== null) {
    window.clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

export function scheduleTokenAutoRefresh(): void {
  cancelTokenAutoRefresh();

  const token = getStoredAuthToken();
  if (!token || !getStoredRefreshToken()) return;

  const expiry = getStoredTokenExpiry() ?? getJwtExpiryMs(token);
  if (expiry === null) return;

  const delay = Math.max(0, expiry - Date.now() - REFRESH_AHEAD_MS);
  autoRefreshTimer = window.setTimeout(() => {
    autoRefreshTimer = null;
    void refreshStoredAccessToken().catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredTokens();
        window.dispatchEvent(new Event("auth-expired"));
      }
    });
  }, delay);
}

export async function refreshStoredAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;
  if (refreshInFlight) return refreshInFlight;

  const pending = (async () => {
    const accessTokenBeforeLock = getStoredAuthToken();
    const run = async () => {
      const currentRefreshToken = getStoredRefreshToken();
      const currentAccessToken = getStoredAuthToken();

      if (currentRefreshToken !== refreshToken) {
        if (currentAccessToken && currentAccessToken !== accessTokenBeforeLock) {
          return currentAccessToken;
        }
        throw new ApiError("Session changed while refreshing.", 401);
      }

      if (
        currentAccessToken &&
        currentAccessToken !== accessTokenBeforeLock
      ) {
        return currentAccessToken;
      }
      if (currentAccessToken && currentAccessToken === accessTokenBeforeLock) {
        const currentExpiry = getStoredTokenExpiry();
        if (
          currentExpiry !== null &&
          currentExpiry > Date.now() + REFRESH_AHEAD_MS
        ) {
          return currentAccessToken;
        }
      }

      const data = await request<LoginResponse>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!data.access_token) {
        throw new ApiError("Refresh response did not include access_token.", 200);
      }
      if (getStoredRefreshToken() !== refreshToken) {
        throw new ApiError("Session changed while refreshing.", 401);
      }

      persistAuthTokens(data);
      return data.access_token;
    };

    let freshAccessToken: string;
    if (typeof navigator !== "undefined" && navigator.locks) {
      freshAccessToken = await navigator.locks.request(REFRESH_LOCK_KEY, run);
    } else {
      freshAccessToken = await run();
    }
    scheduleTokenAutoRefresh();
    return freshAccessToken;
  })();

  refreshInFlight = pending;
  try {
    return await pending;
  } finally {
    if (refreshInFlight === pending) {
      refreshInFlight = null;
    }
  }
}

export function getStoredAuthToken(): string | null {
  return (
    localStorage.getItem("auth_token") ||
    localStorage.getItem("access_token")
  );
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const route = path.split("?", 1)[0];
  const skipRefresh =
    route === "/auth/login" ||
    route === "/auth/refresh" ||
    route.startsWith("/auth/register");

  let token = getStoredAuthToken();
  if (
    !skipRefresh &&
    token &&
    getStoredRefreshToken() &&
    shouldRefreshToken(token)
  ) {
    try {
      const freshToken = await refreshStoredAccessToken();
      if (freshToken) token = freshToken;
    } catch {
      // Keep the existing token so the authenticated call can surface a 401.
    }
  }

  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Accept-Language", "zh-CN");
  if (
    route === "/auth/me" ||
    route === "/user" ||
    route.startsWith("/user/") ||
    route === "/keys" ||
    route.startsWith("/keys/") ||
    route === "/usage" ||
    route.startsWith("/usage/")
  ) {
    headers.set("X-User-UI-Request", "1");
  }
  if (
    route === "/groups" ||
    route.startsWith("/groups/") ||
    route === "/proxies" ||
    route.startsWith("/proxies/")
  ) {
    headers.set("X-Admin-UI-Request", "1");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const doFetch = async (): Promise<Response> => {
    try {
      return await tauriFetch(`${getApiBaseUrl()}${path}`, {
        ...init,
        headers,
        connectTimeout: 15000,
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("[api] request failed:", reason);
      throw new ApiError(
        `Unable to connect to the server (${reason})`
      );
    }
  };

  let response: Response;
  try {
    response = await doFetch();
  } catch (error: unknown) {
    throw error;
  }

  if (response.status === 401 && !skipRefresh && getStoredRefreshToken()) {
    try {
      const freshToken = await refreshStoredAccessToken();
      if (freshToken) {
        headers.set("Authorization", `Bearer ${freshToken}`);
        response = await doFetch();
      }
    } catch {
      clearStoredTokens();
      window.dispatchEvent(new Event("auth-expired"));
      throw new ApiError("Session expired. Please log in again.", 401);
    }
  }

  let payload: ApiEnvelope<T> | T | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T> | T;
  } catch {
    payload = null;
  }

  const envelope =
    payload && typeof payload === "object"
      ? (payload as ApiEnvelope<T>)
      : undefined;

  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith("/auth/login") &&
      route !== "/auth/refresh"
    ) {
      clearStoredTokens();
      window.dispatchEvent(new Event("auth-expired"));
    }

    throw new ApiError(
      envelope?.message ||
        envelope?.detail ||
        `Server request failed (HTTP ${response.status})`,
      response.status,
      envelope?.code
    );
  }

  if (envelope && typeof envelope.code === "number" && envelope.code !== 0) {
    throw new ApiError(
      envelope.message || envelope.detail || "The server returned an error.",
      response.status,
      envelope.code
    );
  }

  if (
    envelope &&
    envelope.code === 0 &&
    Object.prototype.hasOwnProperty.call(envelope, "data")
  ) {
    return envelope.data as T;
  }

  return payload as T;
}

async function requestWithFallback<T>(
  paths: readonly string[],
  init: RequestInit = {}
): Promise<T> {
  for (let index = 0; index < paths.length; index += 1) {
    try {
      return await request<T>(paths[index], init);
    } catch (error: unknown) {
      const isLastPath = index === paths.length - 1;
      if (!(error instanceof ApiError) || error.status !== 404 || isLastPath) {
        throw error;
      }
    }
  }

  throw new ApiError("No compatible server endpoint was found.", 404);
}

export async function login(email: string, password: string) {
  const data = await request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!data.access_token) {
    throw new ApiError("Login response did not include access_token.", 200);
  }

  persistAuthTokens(data);
  return data;
}

export interface DashboardStats {
  total_requests: number;
  total_tokens: number;
  total_actual_cost: number;
  today_requests: number;
  today_tokens: number;
  today_actual_cost: number;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  return request<DashboardStats>("/usage/dashboard/stats");
}

export interface UserProfile {
  username: string;
  quota: number;
  status: number;
  email?: string;
}

export async function fetchUserProfile(): Promise<UserProfile> {
  return requestWithFallback<UserProfile>(["/user/profile", "/user/self"]);
}

export interface UsageRecord {
  id: string | number;
  model?: string;
  created_at?: string;
  actual_cost?: number | string | null;
  total_cost?: number | string | null;
  total_tokens?: number | string | null;
  input_tokens?: number | string | null;
  output_tokens?: number | string | null;
}

interface UsageResponse {
  items?: UsageRecord[];
}

export async function fetchRecentUsage(
  startDate: string,
  endDate: string
): Promise<UsageRecord[]> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    page: "1",
    page_size: "100",
  });
  const data = await request<UsageResponse | UsageRecord[]>(
    `/usage?${params.toString()}`
  );

  if (Array.isArray(data)) return data;
  return Array.isArray(data.items) ? data.items : [];
}

// ============================================================
// API Key Management
// ============================================================

export interface ApiKey {
  id: number;
  key: string;
  name: string;
  group_id?: number;
  created_at: string;
  status: number | string;
  quota?: number;
  used_quota?: number;
  unlimited?: boolean;
}

interface ApiKeyListResponse {
  items?: ApiKey[];
  data?: ApiKey[];
}

export async function fetchApiKeys(): Promise<ApiKey[]> {
  const data = await requestWithFallback<ApiKeyListResponse | ApiKey[]>([
    "/keys",
    "/key",
  ]);
  if (Array.isArray(data)) return data;
  if (data.items) return data.items;
  if (data.data) return data.data;
  return [];
}

export async function createApiKey(name: string, groupId?: number): Promise<ApiKey> {
  return requestWithFallback<ApiKey>(["/keys", "/key"], {
    method: "POST",
    body: JSON.stringify({ name, group_id: groupId }),
  });
}

export async function deleteApiKey(id: number): Promise<void> {
  await requestWithFallback<unknown>([`/keys/${id}`, `/key/${id}`], {
    method: "DELETE",
  });
}

export async function updateApiKey(id: number, data: Partial<{ name: string; status: number; group_id: number }>): Promise<ApiKey> {
  return requestWithFallback<ApiKey>([`/keys/${id}`, `/key/${id}`], {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ============================================================
// Group Management
// ============================================================

export interface Group {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  status: number | string;
  key_count?: number;
}

interface GroupListResponse {
  items?: Group[];
  data?: Group[];
}

export async function fetchGroups(): Promise<Group[]> {
  const data = await requestWithFallback<GroupListResponse | Group[]>([
    "/groups",
    "/group",
  ]);
  if (Array.isArray(data)) return data;
  if (data.items) return data.items;
  if (data.data) return data.data;
  return [];
}

export async function createGroup(name: string, description?: string): Promise<Group> {
  return requestWithFallback<Group>(["/groups", "/group"], {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteGroup(id: number): Promise<void> {
  await requestWithFallback<unknown>([`/groups/${id}`, `/group/${id}`], {
    method: "DELETE",
  });
}

export async function updateGroup(id: number, data: Partial<{ name: string; description: string; status: number }>): Promise<Group> {
  return requestWithFallback<Group>([`/groups/${id}`, `/group/${id}`], {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ============================================================
// Proxy Management
// ============================================================

export interface ProxyRecord {
  id: number | string;
  name?: string;
  protocol?: string;
  host?: string;
  port?: number | string;
  raw_url?: string;
  username?: string;
  password?: string;
  status?: number | string;
  is_public?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

interface ProxyListResponse {
  items?: ProxyRecord[];
  data?: ProxyRecord[];
}

export async function fetchProxies(): Promise<ProxyRecord[]> {
  const data = await requestWithFallback<ProxyListResponse | ProxyRecord[]>([
    "/proxies",
    "/proxies/all",
    "/user/proxy",
  ]);
  if (Array.isArray(data)) return data;
  if (data.items) return data.items;
  if (data.data) return data.data;
  return [];
}

export async function createProxy(data: Partial<ProxyRecord>): Promise<ProxyRecord> {
  return requestWithFallback<ProxyRecord>(["/proxies", "/user/proxy"], {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProxy(
  id: number | string,
  data: Partial<ProxyRecord>
): Promise<ProxyRecord> {
  return requestWithFallback<ProxyRecord>(
    [`/proxies/${id}`, `/user/proxy/${id}`],
    {
      method: "PUT",
      body: JSON.stringify(data),
    }
  );
}

export async function deleteProxy(id: number | string): Promise<void> {
  await requestWithFallback<unknown>([`/proxies/${id}`, `/user/proxy/${id}`], {
    method: "DELETE",
  });
}

// ============================================================
// User Profile Update
// ============================================================

export async function updateUserProfile(data: Partial<{ username: string; email: string; display_name: string }>): Promise<UserProfile> {
  return requestWithFallback<UserProfile>(["/user", "/user/profile"], {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
