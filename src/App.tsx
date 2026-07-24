import { useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import FloatingWidget from "./pages/FloatingWidget";

function App() {
  useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthExpired = () => {
      navigate("/login", { replace: true });
    };

    window.addEventListener("auth-expired", handleAuthExpired);
    return () => window.removeEventListener("auth-expired", handleAuthExpired);
  }, [navigate]);

  if (new URLSearchParams(window.location.search).get("window") === "floating") {
    return <FloatingWidget />;
  }

  const token =
    localStorage.getItem("auth_token") || localStorage.getItem("access_token");

  return (
    <Routes>
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/*"
        element={token ? <Dashboard /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}

export default App;
