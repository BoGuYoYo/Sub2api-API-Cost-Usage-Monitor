import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import TitleBar from "../components/TitleBar";
import Dashboard from "../pages/Dashboard";
import TotalUsage from "../pages/TotalUsage";

export default function DashboardLayout() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0f0c29] via-[#302b63] to-[#24243e] animate-gradient">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(120,119,198,0.25),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(255,94,247,0.12),transparent_50%)]" />
      </div>

      {/* Title bar */}
      <div className="relative z-30">
        <TitleBar />
      </div>

      {/* Sidebar + Content */}
      <div className="relative z-20 flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/total-usage" element={<TotalUsage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

    </div>
  );
}
