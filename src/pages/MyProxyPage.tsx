import { useState, useEffect, useCallback } from "react";
import { ExternalLink, Loader2, Plus, Server, Trash2 } from "lucide-react";
import {
  ApiError,
  createProxy,
  deleteProxy,
  fetchProxies,
  type ProxyRecord,
} from "../lib/api";

interface ProxyDraft {
  name: string;
  protocol: string;
  host: string;
  port: string;
  raw_url: string;
  username: string;
  password: string;
}

const EMPTY_DRAFT: ProxyDraft = {
  name: "",
  protocol: "http",
  host: "",
  port: "8080",
  raw_url: "",
  username: "",
  password: "",
};

function formatDate(value: string | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatAddress(proxy: ProxyRecord): string {
  if (proxy.raw_url) return proxy.raw_url;
  const protocol = proxy.protocol || "http";
  const host = proxy.host || "Unknown host";
  const port = proxy.port ? `:${proxy.port}` : "";
  const username = proxy.username ? `${proxy.username}:***@` : "";
  return `${protocol}://${username}${host}${port}`;
}

function isActive(proxy: ProxyRecord): boolean {
  return (
    proxy.status === undefined ||
    proxy.status === 1 ||
    proxy.status === "active" ||
    proxy.status === "enabled"
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 404) {
    return "This server does not provide proxy management endpoints.";
  }
  return error instanceof Error ? error.message : fallback;
}

export default function MyProxyPage() {
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<ProxyDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadProxies = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setProxies(await fetchProxies());
    } catch (reason: unknown) {
      setError(getErrorMessage(reason, "Failed to load proxies."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProxies();
  }, [loadProxies]);

  function updateDraft(field: keyof ProxyDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate() {
    if (!draft.name.trim() || (!draft.host.trim() && !draft.raw_url.trim())) {
      setError("Enter a proxy name and either a host or a proxy URL.");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: draft.name.trim(),
        protocol: draft.protocol,
      };
      if (draft.raw_url.trim()) {
        payload.raw_url = draft.raw_url.trim();
      } else {
        payload.host = draft.host.trim();
        payload.port = Number(draft.port) || 8080;
      }
      if (draft.username.trim()) payload.username = draft.username.trim();
      if (draft.password) payload.password = draft.password;

      await createProxy(payload);
      setDraft(EMPTY_DRAFT);
      setCreateOpen(false);
      await loadProxies();
    } catch (reason: unknown) {
      setError(getErrorMessage(reason, "Failed to create proxy."));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(proxy: ProxyRecord) {
    if (!window.confirm(`Delete proxy "${proxy.name || formatAddress(proxy)}"?`)) {
      return;
    }

    try {
      await deleteProxy(proxy.id);
      setProxies((current) => current.filter((item) => item.id !== proxy.id));
    } catch (reason: unknown) {
      setError(getErrorMessage(reason, "Failed to delete proxy."));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-light tracking-wide text-white/90">My Proxy</h1>
          <p className="mt-0.5 text-xs text-white/40">Manage proxy resources for API requests</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/85 transition-all hover:bg-white/15"
        >
          <Plus size={15} />
          New Proxy
        </button>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {createOpen && (
        <div className="space-y-4 rounded-2xl border border-white/[0.10] bg-white/[0.06] p-4 backdrop-blur-xl">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              placeholder="Proxy name"
              autoFocus
              className="rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
            />
            <select
              value={draft.protocol}
              onChange={(event) => updateDraft("protocol", event.target.value)}
              className="rounded-xl border border-white/10 bg-[#252142] px-4 py-2.5 text-sm text-white/90 outline-none focus:border-white/30"
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
            </select>
            <input
              type="text"
              value={draft.host}
              onChange={(event) => updateDraft("host", event.target.value)}
              placeholder="Host"
              className="rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
            />
            <input
              type="number"
              value={draft.port}
              onChange={(event) => updateDraft("port", event.target.value)}
              placeholder="Port"
              min="1"
              max="65535"
              className="rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
            />
            <input
              type="text"
              value={draft.raw_url}
              onChange={(event) => updateDraft("raw_url", event.target.value)}
              placeholder="Full proxy URL (optional)"
              className="sm:col-span-2 rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
            />
            <input
              type="text"
              value={draft.username}
              onChange={(event) => updateDraft("username", event.target.value)}
              placeholder="Username (optional)"
              className="rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
            />
            <input
              type="password"
              value={draft.password}
              onChange={(event) => updateDraft("password", event.target.value)}
              placeholder="Password (optional)"
              className="rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setCreateOpen(false); setDraft(EMPTY_DRAFT); }}
              className="rounded-xl px-3 py-2.5 text-sm text-white/50 hover:text-white/80"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={creating}
              onClick={handleCreate}
              className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white/85 transition-all hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Create Proxy
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          [0, 1, 2].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-2xl bg-white/[0.06]" />
          ))
        ) : proxies.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-10 text-center">
            <Server size={32} className="mx-auto text-white/25" />
            <p className="mt-3 text-sm text-white/50">No proxies yet</p>
            <p className="mt-1 text-xs text-white/30">Create a proxy resource to get started</p>
          </div>
        ) : (
          proxies.map((proxy) => (
            <div
              key={proxy.id}
              className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.06]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/55">
                <ExternalLink size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white/80">{proxy.name || "Unnamed proxy"}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-white/35">{formatAddress(proxy)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] text-white/40">{formatDate(proxy.created_at)}</p>
                <span className={`text-[10px] ${isActive(proxy) ? "text-emerald-400/70" : "text-white/30"}`}>
                  {isActive(proxy) ? "Active" : "Disabled"}
                </span>
              </div>
              <button
                type="button"
                title="Delete proxy"
                onClick={() => handleDelete(proxy)}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-red-400/70"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
