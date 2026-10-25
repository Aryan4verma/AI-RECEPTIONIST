import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./styles.css";
import Chat from "./pages/customer/Chat";

const Call = lazy(() => import("./pages/customer/Call"));
import AdminLogin from "./pages/admin/Login";
import AdminLayout from "./pages/admin/Layout";
import Overview from "./pages/admin/Overview";
import Customers from "./pages/admin/Customers";
import Conversations from "./pages/admin/Conversations";
import Appointments from "./pages/admin/Appointments";
import BusinessConfig from "./pages/admin/BusinessConfig";
import Models from "./pages/admin/Models";
import { AdminAuthProvider, useAdminAuth } from "./hooks/useAdminAuth";

function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAdminAuth();
  const location = useLocation();
  if (location.pathname.startsWith("/admin/login")) return <>{children}</>;
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-3">
        <svg className="size-6 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  if (!user) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Chat />} />
        <Route
          path="/call"
          element={
            <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-3">Opening the call screen…</div>}>
              <Call />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminAuthProvider>
              <AdminGate>
                <AdminLayout />
              </AdminGate>
            </AdminAuthProvider>
          }
        >
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="login" element={<AdminLogin />} />
          <Route path="overview" element={<Overview />} />
          <Route path="customers" element={<Customers />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="config" element={<BusinessConfig />} />
          <Route path="models" element={<Models />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
