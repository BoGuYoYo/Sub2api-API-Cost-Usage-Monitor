import { LayoutDashboard, Key, Users, User, Shield, Settings, LogOut } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearStoredTokens } from "../lib/api";

interface SidebarProps {
  onSettings?: () => void;
}

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/api-keys", label: "API Keys", icon: Key },
  { path: "/groups", label: "My Groups", icon: Users },
  { path: "/account", label: "My Account", icon: User },
  { path: "/proxy", label: "My Proxy", icon: Shield },
];

export default function Sidebar({ onSettings }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  function handleLogout() {
    clearStoredTokens();
    navigate("/login", { replace: true });
  }

  return (
    <nav className="flex h-full w-56 flex-col border-r border-white/[0.08] bg-white/[0.03] backdrop-blur-xl">
      {/* App branding */}
      <div className="flex h-9 shrink-0 items-center px-4 border-b border-white/[0.06]">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/40">
          Menu
        </span>
      </div>

      {/* Navigation items */}
      <div className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                isActive
                  ? "bg-white/10 text-white/90"
                  : "text-white/45 hover:bg-white/[0.06] hover:text-white/70"
              }`}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-white/[0.06] p-3 space-y-1">
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/45 transition-all hover:bg-white/[0.06] hover:text-white/70"
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/45 transition-all hover:bg-white/[0.06] hover:text-red-400/70"
        >
          <LogOut size={16} />
          <span>Log Out</span>
        </button>
      </div>
    </nav>
  );
}
