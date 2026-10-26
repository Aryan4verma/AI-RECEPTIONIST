import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./styles.css";
import Chat from "./pages/customer/Chat";

const Call = lazy(() => import("./pages/customer/Call"));
const AdminLogin = lazy(() => import("./pages/admin/Login"));
const AdminLayout = lazy(() => import("./pages/admin/Layout"));
const Overview = lazy(() => import("./pages/admin/Overview"));
const Customers = lazy(() => import("./pages/admin/Customers"));
const Conversations = lazy(() => import("./pages/admin/Conversations"));
const Appointments = lazy(() => import("./pages/admin/Appointments"));
const BusinessConfig = lazy(() => import("./pages/admin/BusinessConfig"));
const Models = lazy(() => import("./pages/admin/Models"));
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
      <Suspense fallback={<div role="status" className="flex min-h-dvh items-center justify-center bg-canvas text-sm text-ink-3">Opening Cleardesk…</div>}>
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
      </Suspense>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
