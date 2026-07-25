import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Users, Loader2 } from "lucide-react";
import { fetchGroups, createGroup, deleteGroup, type Group } from "../lib/api";

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

export default function MyGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGroups();
      setGroups(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createGroup(newName.trim(), newDesc.trim() || undefined);
      setNewName("");
      setNewDesc("");
      setCreateOpen(false);
      await loadGroups();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create group.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteGroup(id);
      setGroups((prev) => prev.filter((g) => g.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete group.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-light tracking-wide text-white/90">My Groups</h1>
          <p className="mt-0.5 text-xs text-white/40">Organize API keys into groups</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/85 transition-all hover:bg-white/15"
        >
          <Plus size={15} />
          New Group
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-300">{error}</p>
      )}

      {createOpen && (
        <div className="rounded-2xl border border-white/[0.10] bg-white/[0.06] p-4 backdrop-blur-xl space-y-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Group name..."
            autoFocus
            className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)..."
            className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-white/30"
          />
          <div className="flex items-center gap-2">
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
              onClick={() => { setCreateOpen(false); setNewName(""); setNewDesc(""); }}
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
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-10 text-center">
            <Users size={32} className="mx-auto text-white/25" />
            <p className="mt-3 text-sm text-white/50">No groups yet</p>
            <p className="mt-1 text-xs text-white/30">Create a group to organize your API keys</p>
          </div>
        ) : (
          groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.06]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/55">
                <Users size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white/80">{group.name}</p>
                {group.description && (
                  <p className="mt-0.5 text-xs text-white/40">{group.description}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                {group.key_count !== undefined && (
                  <p className="text-[11px] text-white/40">{group.key_count} keys</p>
                )}
                <p className="text-[11px] text-white/30">{formatDate(group.created_at)}</p>
              </div>
              <button
                type="button"
                title="Delete group"
                onClick={() => handleDelete(group.id)}
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
