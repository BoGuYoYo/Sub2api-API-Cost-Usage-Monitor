import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Copy, Check, Key, Loader2 } from "lucide-react";
import { fetchApiKeys, createApiKey, deleteApiKey, type ApiKey } from "../lib/api";

function formatDate(value: string | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApiKeys();
      setKeys(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createApiKey(newName.trim());
      setNewName("");
      setCreateOpen(false);
      await loadKeys();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create key.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete key.");
    }
  }

  async function handleCopy(key: string, id: number) {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for environments without clipboard API
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-light tracking-wide text-white/90">API Keys</h1>
          <p className="mt-0.5 text-xs text-white/40">Manage your API access keys</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/85 transition-all hover:bg-white/15"
        >
          <Plus size={15} />
          New Key
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-300">{error}</p>
      )}

      {createOpen && (
        <div className="rounded-2xl border border-white/[0.10] bg-white/[0.06] p-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter key name..."
              autoFocus
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <button
              type="button"
              disabled={creating || !newName.trim()}
              onClick={handleCreate}
              className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white/85 transition-all hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setCreateOpen(false); setNewName(""); }}
              className="rounded-xl px-3 py-2.5 text-sm text-white/50 hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.06]" />
          ))
        ) : keys.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-10 text-center">
            <Key size={32} className="mx-auto text-white/25" />
            <p className="mt-3 text-sm text-white/50">No API keys yet</p>
            <p className="mt-1 text-xs text-white/30">Create your first key to get started</p>
          </div>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.06]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/55">
                <Key size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white/80">{key.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-white/35">
                  {key.key.substring(0, 20)}...
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] text-white/40">{formatDate(key.created_at)}</p>
                <span className={`text-[10px] ${key.status === 1 ? "text-emerald-400/70" : "text-white/30"}`}>
                  {key.status === 1 ? "Active" : "Disabled"}
                </span>
              </div>
              <button
                type="button"
                title="Copy key"
                onClick={() => handleCopy(key.key, key.id)}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/10 hover:text-white/80"
              >
                {copiedId === key.id ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                type="button"
                title="Delete key"
                onClick={() => handleDelete(key.id)}
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
