import { Routes, Route } from "react-router-dom";
import DashboardLayout from "./pages/DashboardLayout";
import FloatingWidget from "./pages/FloatingWidget";
import { ensureActiveAccount } from "./lib/accounts";

/**
 * The app no longer has a login gate. On startup any stored account is
 * activated automatically (swapping the global session). If no accounts exist
 * yet, the Dashboard shows an empty state pointing to the Total Usage page.
 */
export default function App() {
  ensureActiveAccount();

  if (new URLSearchParams(window.location.search).get("window") === "floating") {
    return <FloatingWidget />;
  }

  return (
    <Routes>
      <Route path="/*" element={<DashboardLayout />} />
    </Routes>
  );
}
