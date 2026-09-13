import { LayoutDashboard, ChartPie } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";


const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/total-usage", label: "Total Usage", icon: ChartPie },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

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


    </nav>
  );
}
