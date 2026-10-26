import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { Photo } from "../../components/Photo";
import {
  IconCalendar,
  IconChat,
  IconChip,
  IconExternal,
  IconMessages,
  IconSettings,
  IconUsers,
} from "../../components/icons";

/* Grouped nav — sections mirror how the owner thinks about the front desk. */
const NAV_GROUPS: { title: string; items: { to: string; label: string; icon: typeof IconChat }[] }[] = [
  {
    title: "Front desk",
    items: [
      { to: "/admin/overview", label: "Overview", icon: IconChat },
      { to: "/admin/conversations", label: "Conversations", icon: IconMessages },
      { to: "/admin/appointments", label: "Appointments", icon: IconCalendar },
    ],
  },
  {
    title: "Directory",
    items: [{ to: "/admin/customers", label: "Customers", icon: IconUsers }],
  },
  {
    title: "Configuration",
    items: [
      { to: "/admin/config", label: "Business settings", icon: IconSettings },
      { to: "/admin/models", label: "AI models", icon: IconChip },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((g) => g.items);

export default function AdminLayout() {
  const { user, signOut } = useAdminAuth();
  const location = useLocation();
  if (location.pathname.startsWith("/admin/login")) return <Outlet />;

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Sidebar — cream, active item is a raised white pill */}
      <aside className="pane-scroll sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-line bg-canvas-deep/60 lg:flex">
        <div className="flex shrink-0 items-center gap-3 px-5 pb-6 pt-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-pine-800 font-display text-lg font-semibold text-[#f4f1e8]">
            C
          </span>
            <span className="leading-tight">
              <span className="block font-display text-[18px] font-semibold tracking-tight text-ink">Cleardesk</span>
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-3">Console</span>
            </span>
        </div>

        <nav aria-label="Console sections" className="flex-1 space-y-5 px-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="micro px-3 pb-1.5">{group.title}</p>
              <div className="space-y-0.5">
                {group.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors ${
                        isActive
                          ? "bg-raised text-pine-700 shadow-card"
                          : "text-ink-2 hover:bg-raised/70 hover:text-ink"
                      }`
                    }
                  >
                    <n.icon className="size-4.5" />
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Promo card — real product surface, links to the customer chat */}
        <div className="shrink-0 p-3">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="group block overflow-hidden rounded-card border border-line shadow-card transition-shadow hover:shadow-slip"
            title="See what your customers see"
          >
            <Photo src="/images/promo-cafe.jpg" className="h-24">
              <div className="absolute inset-0 bg-gradient-to-t from-pine-950/60 to-transparent" />
              <p className="absolute bottom-2 left-3 text-[11px] font-semibold text-[#f4f1e8]">
                Your front desk, live
              </p>
            </Photo>
            <div className="flex items-center justify-between bg-surface px-3.5 py-2.5">
              <p className="text-[12px] font-medium text-ink-2">See the customer view</p>
              <IconExternal className="size-3.5 text-ink-3 transition-colors group-hover:text-pine-700" />
            </div>
          </a>
        </div>

        <div className="shrink-0 border-t border-line px-5 py-4">
          <p className="truncate text-[12px] font-medium text-ink-2" title={user?.email}>
            {user?.email}
          </p>
          <button
            onClick={() => void signOut()}
            className="mt-1 text-[12.5px] font-semibold text-ink-3 transition-colors hover:text-danger-fg"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header + section pills */}
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <NavLink to="/admin/overview" className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-pine-800 font-display text-base font-semibold text-[#f4f1e8]">
                C
              </span>
              <span className="font-display text-[16px] font-semibold tracking-tight text-ink">Cleardesk Console</span>
            </NavLink>
            <div className="flex items-center gap-2">
              <a href="/" target="_blank" rel="noreferrer" className="rounded-full px-2.5 py-1.5 text-[12px] font-medium text-ink-2">
                Chat ↗
              </a>
              <button onClick={() => void signOut()} className="rounded-full px-2.5 py-1.5 text-[12px] font-semibold text-ink-3">
                Sign out
              </button>
            </div>
          </div>
          <nav aria-label="Console sections" className="nav-scroll overflow-x-auto px-3 pb-2">
            <div className="flex gap-1.5">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                      isActive ? "bg-pine-700 text-[#f4f1e8] shadow-card" : "border border-line bg-raised text-ink-2"
                    }`
                  }
                >
                  <n.icon className="size-3.5" />
                  {n.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </header>

        {/* Utility bar (desktop) */}
        <div className="hidden items-center justify-between border-b border-line bg-surface px-8 py-3 lg:flex">
          <p className="text-[12px] text-ink-3">Everything here is live from your receptionist service.</p>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-pine-400 hover:text-pine-700"
            title="Open the customer chat in a new tab"
          >
            Customer chat <IconExternal className="size-3.5" />
          </a>
        </div>

        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 xl:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
