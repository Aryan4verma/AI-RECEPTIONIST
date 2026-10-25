import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../../hooks/useAdminAuth";

const NAV = [
  { to: "overview", label: "Overview" },
  { to: "conversations", label: "Conversations" },
  { to: "appointments", label: "Appointments" },
  { to: "customers", label: "Customers" },
  { to: "config", label: "Business settings" },
  { to: "models", label: "AI models" },
];

export default function AdminLayout() {
  const { user, signOut } = useAdminAuth();
  const nav = useNavigate();
  const location = useLocation();
  if (location.pathname.startsWith("/admin/login")) return <Outlet />; // bare sign-in

  async function handleSignOut() {
    await signOut();
    nav("/admin/login", { replace: true });
  }

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col bg-pine-900 text-pine-100 md:flex">
        <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
          <div className="flex size-8 items-center justify-center rounded-lg bg-white/10 font-display text-base font-semibold text-white" aria-hidden="true">
            C
          </div>
          <div className="leading-tight">
            <p className="font-display text-[15px] text-white">Cleardesk</p>
            <p className="text-[11px] text-pine-200/80">Console</p>
          </div>
        </div>
        <nav aria-label="Admin sections" className="flex-1 space-y-0.5 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
                  isActive ? "bg-white/12 text-white" : "text-pine-100/75 hover:bg-white/6 hover:text-white"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-medium text-pine-100/80 hover:text-white"
            title="Open the customer chat in a new tab"
          >
            Customer chat ↗
          </a>
          <p className="mt-3 truncate text-xs text-pine-200/70" title={user?.email}>
            {user?.email}
          </p>
          <button onClick={handleSignOut} className="mt-1.5 text-[13px] font-medium text-pine-100/80 hover:text-white">
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line bg-pine-900 px-4 py-2.5 md:hidden">
          <span className="font-display text-[15px] text-white">Cleardesk Console</span>
          <button onClick={handleSignOut} className="text-xs font-medium text-pine-100/80">
            Sign out
          </button>
        </div>
        <div className="pane-scroll overflow-x-auto border-b border-line bg-surface px-2 md:hidden">
          <div className="flex gap-1 py-1.5">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium ${isActive ? "bg-pine-50 text-pine-700" : "text-ink-2 hover:bg-canvas"}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </div>
        </div>
        <main className="pane-scroll flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
