import { useCallback, useEffect, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import FloatingWidget from "./pages/FloatingWidget";
import {
  clearStoredTokens,
  fetchUserProfile,
  getStoredAuthToken,
} from "./lib/api";

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

function AuthLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#191735] text-sm text-white/55">
      Checking session...
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() =>
    getStoredAuthToken() ? "checking" : "unauthenticated"
  );

  const validateSession = useCallback(async () => {
    const token = getStoredAuthToken();
    if (!token) {
      setAuthStatus("unauthenticated");
      navigate("/login", { replace: true });
      return;
    }

    setAuthStatus("checking");
    try {
      await fetchUserProfile();
      setAuthStatus("authenticated");
    } catch {
      clearStoredTokens();
      setAuthStatus("unauthenticated");
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    const handleAuthExpired = () => {
      clearStoredTokens();
      setAuthStatus("unauthenticated");
      navigate("/login", { replace: true });
    };
    const handleAuthChanged = () => {
      void validateSession();
    };

    window.addEventListener("auth-expired", handleAuthExpired);
    window.addEventListener("auth-changed", handleAuthChanged);
    void validateSession();

    return () => {
      window.removeEventListener("auth-expired", handleAuthExpired);
      window.removeEventListener("auth-changed", handleAuthChanged);
    };
  }, [navigate, validateSession]);

  if (authStatus === "checking") {
    return <AuthLoading />;
  }

  if (new URLSearchParams(window.location.search).get("window") === "floating") {
    return authStatus === "authenticated" ? <FloatingWidget /> : <LoginPage />;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          authStatus === "authenticated" ? <Navigate to="/" replace /> : <LoginPage />
        }
      />
      <Route
        path="/*"
        element={
          authStatus === "authenticated" ? <Dashboard /> : <Navigate to="/login" replace />
        }
      />
    </Routes>
  );
}

export default App;
