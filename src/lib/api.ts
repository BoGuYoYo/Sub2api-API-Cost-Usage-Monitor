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
}

export function isTokenExpired(token: string): boolean {
  const payload = token.split(".")[1];
  if (!payload) return false;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const parsed = JSON.parse(decoded) as { exp?: unknown };
    return typeof parsed.exp === "number" && parsed.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export function getStoredAuthToken(): string | null {
  const token =
    localStorage.getItem("auth_token") ||
    localStorage.getItem("access_token");
  if (token && isTokenExpired(token)) {
    clearStoredTokens();
    return null;
  }
  return token;
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token =
    localStorage.getItem("auth_token") ||
    localStorage.getItem("access_token");
  const route = path.split("?", 1)[0];
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

  let response: Response;
  try {
    response = await tauriFetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
      connectTimeout: 15000,
    });
  } catch {
    throw new ApiError("Unable to connect to the server. Check your network or API URL.");
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
    if (response.status === 401 && !path.startsWith("/auth/login")) {
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

interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function login(email: string, password: string) {
  const data = await request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!data.access_token) {
    throw new ApiError("Login response did not include access_token.", 200);
  }

  localStorage.setItem("auth_token", data.access_token);
  localStorage.setItem("access_token", data.access_token);
  if (data.refresh_token) {
    localStorage.setItem("refresh_token", data.refresh_token);
  }
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
