import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pin, PinOff, Zap, DollarSign } from "lucide-react";
import TitleBar from "../components/TitleBar";
import { fetchDashboardStats, type DashboardStats } from "../lib/api";

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value: unknown): string {
  const number = toFiniteNumber(value);
  if (number === null) return "---";
  if (number >= 1_000_000) return (number / 1_000_000).toFixed(2) + "M";
  if (number >= 1_000) return (number / 1_000).toFixed(2) + "K";
  return number.toLocaleString();
}

function formatCost(value: unknown): string {
  const number = toFiniteNumber(value);
  return number === null ? "$---" : "$" + number.toFixed(4);
}

export default function FloatingWidget() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(
    () => localStorage.getItem("floating_always_on_top") !== "false"
  );

  useEffect(() => {
    let disposed = false;

    async function loadStats() {
      try {
        const nextStats = await fetchDashboardStats();
        if (!disposed) setStats(nextStats);
      } catch {
        // The main window handles expired sessions; keep the widget stable.
      }
    }

    loadStats();
    const interval = setInterval(loadStats, 60_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  async function toggleAlwaysOnTop() {
    const nextValue = !alwaysOnTop;
    try {
      await getCurrentWindow().setAlwaysOnTop(nextValue);
      setAlwaysOnTop(nextValue);
      localStorage.setItem("floating_always_on_top", String(nextValue));
    } catch {
      // Keep the current state when the native window operation is unavailable.
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/[0.14] bg-[#191735]/95 text-white shadow-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-[#262152] via-[#302b63] to-[#17152f]" />
      <div className="relative z-10">
        <TitleBar />
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-between p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
            Today's snapshot
          </span>
          <button
            type="button"
            aria-label={alwaysOnTop ? "Disable always on top" : "Enable always on top"}
            title={alwaysOnTop ? "Always on top" : "Desktop only"}
            aria-pressed={alwaysOnTop}
            onClick={toggleAlwaysOnTop}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
          >
            {alwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.07] p-3">
            <div className="flex items-center gap-2 text-white/45">
              <DollarSign size={14} />
              <span className="text-[10px] uppercase tracking-wider">Spend</span>
            </div>
            <p className="mt-1 text-lg font-medium tabular-nums text-white/90">
              {stats ? formatCost(stats.today_actual_cost) : "$---"}
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.07] p-3">
            <div className="flex items-center gap-2 text-white/45">
              <Zap size={14} />
              <span className="text-[10px] uppercase tracking-wider">Tokens</span>
            </div>
            <p className="mt-1 text-lg font-medium tabular-nums text-white/90">
              {stats ? formatNumber(stats.today_tokens) : "---"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
