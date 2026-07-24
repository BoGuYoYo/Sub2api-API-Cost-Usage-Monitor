import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, Eye, EyeOff, Loader2 } from "lucide-react";
import { ApiError, login } from "../lib/api";
import TitleBar from "../components/TitleBar";
import SettingsModal from "../components/SettingsModal";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      setError("Please enter username and password");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      window.dispatchEvent(new Event("auth-changed"));
      navigate("/", { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="relative w-full h-full flex flex-col overflow-hidden">
      <div className="relative z-20">
        <TitleBar onSettings={() => setSettingsOpen(true)} solid />
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#211c45_0%,#342b68_52%,#211d42_100%)]" />

        {/* Glassmorphism login card */}
        <div className="relative z-10 w-full max-w-sm mx-4">
          <div className="rounded-2xl border border-[#625b91] bg-[#332d62] p-8 shadow-2xl">
            {/* Logo / Title */}
            <div className="text-center mb-8">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5e568b]">
                <LogIn size={24} className="text-white/80" />
              </div>
              <h1 className="text-2xl font-light text-white tracking-wider">
                API Monitor
              </h1>
              <p className="text-sm text-white/40 mt-1">Sign in to your account</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <input
                  type="text"
                  placeholder="Username or Email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl border border-[#6e6698] bg-[#423b73] px-4 py-2.5 text-sm text-white/90 outline-none transition-all placeholder:text-white/35 focus:border-[#a49acb] focus:bg-[#4b437d]"
                  autoComplete="username"
                />
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[#6e6698] bg-[#423b73] px-4 py-2.5 pr-10 text-sm text-white/90 outline-none transition-all placeholder:text-white/35 focus:border-[#a49acb] focus:bg-[#4b437d]"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 transition-colors hover:text-white/80"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {error && (
                <p className="text-red-400/90 text-xs text-center">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#7b70a6] bg-[#5d5688] py-2.5 text-sm font-medium text-white/95 transition-all duration-300 hover:bg-[#6c6297] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <LogIn size={16} />
                )}
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>
          </div>
        </div>
      </div>
      </div>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
