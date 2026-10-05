import { LayoutDashboard, ChartPie, Languages } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { LOCALES } from "../lib/i18n";
import { useI18n } from "../lib/use-i18n";

const NAV_ITEMS = [
  { path: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { path: "/total-usage", labelKey: "nav.totalUsage", icon: ChartPie },
] as const;

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, locale, setLocale } = useI18n();

  return (
    <nav className="flex h-full w-56 flex-col border-r border-white/[0.08] bg-white/[0.03] backdrop-blur-xl">
      {/* App branding */}
      <div className="flex h-9 shrink-0 items-center px-4 border-b border-white/[0.06]">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/40">
          {t("nav.menu")}
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
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {/* Language switch */}
      <div className="shrink-0 border-t border-white/[0.06] p-3">
        <div className="mb-2 flex items-center gap-2 px-1 text-[10px] font-medium uppercase tracking-[0.2em] text-white/35">
          <Languages size={13} />
          <span>{t("nav.language")}</span>
        </div>
        <div
          role="group"
          aria-label={t("nav.languageHint")}
          className="flex gap-1 rounded-xl bg-white/[0.05] p-1"
        >
          {LOCALES.map((option) => {
            const isActive = option.id === locale;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isActive}
                title={t("nav.languageHint")}
                onClick={() => setLocale(option.id)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs transition-all ${
                  isActive
                    ? "bg-white/15 text-white/90"
                    : "text-white/45 hover:bg-white/[0.07] hover:text-white/75"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
