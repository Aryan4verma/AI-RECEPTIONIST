import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { IconCalendar, IconChat, IconChip, IconExternal, IconMessages, IconSettings, IconUsers } from "../../components/icons";

const NAV = [
  { to: "/admin/overview", label: "Overview", icon: IconChat, desktop: true },
  { to: "/admin/conversations", label: "Conversations", icon: IconMessages, desktop: true },
  { to: "/admin/appointments", label: "Appointments", icon: IconCalendar, desktop: true },
  { to: "/admin/customers", label: "Customers", icon: IconUsers, desktop: true },
  { to: "/admin/config", label: "Business settings", icon: IconSettings, desktop: true },
  { to: "/admin/models", label: "AI models", icon: IconChip, desktop: true },
];

export default function AdminLayout() {
  const { user, signOut } = useAdminAuth();
  const location = useLocation();
  if (location.pathname.startsWith("/admin/login")) return <Outlet />;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {/* Console header */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            <NavLink to="/admin/overview" className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-pine-800 font-display text-lg font-semibold text-[#f4f1e8]">
                C
              </span>
              <span className="leading-tight">
                <span className="block font-display text-[18px] font-semibold tracking-tight text-ink">Cleardesk</span>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">Console</span>
              </span>
            </NavLink>
            <div className="flex items-center gap-3">
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-ink-2 hover:text-pine-700 sm:flex"
                title="Open the customer chat in a new tab"
              >
                Customer chat <IconExternal className="size-3.5" />
              </a>
              <span className="hidden max-w-48 truncate rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11.5px] text-ink-2 md:block" title={user?.email}>
                {user?.email}
              </span>
              <button
                onClick={() => void signOut()}
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-2 hover:text-danger-fg"
              >
                Sign out
              </button>
            </div>
          </div>
          {/* Section nav */}
          <nav aria-label="Console sections" className="-mb-px flex gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
                    isActive ? "border-pine-600 text-pine-700" : "border-transparent text-ink-2 hover:border-line-strong hover:text-ink"
                  }`
                }
              >
                <n.icon className="size-4" />
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <p className="font-display text-sm text-ink">Cleardesk Console</p>
          <a href="/" target="_blank" rel="noreferrer" className="text-xs font-medium text-ink-2 hover:text-pine-700">
            Open customer chat
          </a>
        </div>
      </footer>
    </div>
  );
}
