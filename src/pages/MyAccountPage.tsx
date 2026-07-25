import { useState, useEffect, useCallback } from "react";
import { User, Mail, Hash, Loader2 } from "lucide-react";
import { fetchUserProfile, updateUserProfile, type UserProfile } from "../lib/api";

export default function MyAccountPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUserProfile();
      setProfile(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await updateUserProfile({
        username: profile.username,
        display_name: profile.username,
      });
      setProfile(updated);
      setSuccess("Profile updated successfully.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-light tracking-wide text-white/90">My Account</h1>
        <p className="mt-0.5 text-xs text-white/40">View and manage your account details</p>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}
      {success && <p className="text-xs text-emerald-400/80">{success}</p>}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.06]" />
          ))}
        </div>
      ) : profile ? (
        <div className="rounded-2xl border border-white/[0.10] bg-white/[0.06] p-6 backdrop-blur-xl space-y-5">
          {/* Username */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/45">
              <User size={13} />
              Username
            </label>
            <p className="text-sm text-white/80">{profile.username}</p>
          </div>

          {/* Email */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/45">
              <Mail size={13} />
              Email
            </label>
            <p className="text-sm text-white/80">{profile.email || "Not set"}</p>
          </div>

          {/* Quota/Balance */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/45">
              <Hash size={13} />
              Remaining Quota
            </label>
            <p className="text-lg font-light tracking-tight text-white/90">
              {profile.quota !== undefined ? profile.quota.toFixed(4) : "---"}
            </p>
          </div>

          {/* Status */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/45">
              Status
            </label>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
              profile.status === 1
                ? "bg-emerald-500/15 text-emerald-400/80"
                : "bg-red-500/15 text-red-400/80"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                profile.status === 1 ? "bg-emerald-400" : "bg-red-400"
              }`} />
              {profile.status === 1 ? "Active" : "Inactive"}
            </span>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white/85 transition-all hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              "Refresh Profile"
            )}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-10 text-center">
          <p className="text-sm text-white/50">Unable to load profile.</p>
        </div>
      )}
    </div>
  );
}
