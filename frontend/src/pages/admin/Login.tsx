import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, ErrorNote, Field, Input } from "../../components/ui";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { supabaseConfigured } from "../../lib/admin";
import { IconShield } from "../../components/icons";
import { Photo } from "../../components/Photo";
import { Link } from "react-router-dom";

export default function AdminLogin() {
  const { signIn } = useAdminAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      nav("/admin/overview", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden min-h-dvh flex-col justify-between overflow-hidden bg-pine-900 p-12 text-white lg:flex">
        <p className="relative z-10 text-sm font-semibold tracking-wide">Cleardesk <span className="ml-2 font-normal text-white/60">/ Business console</span></p>
        <div className="relative z-10 max-w-md pb-16"><p className="mb-5 text-xs uppercase tracking-[.2em] text-brass-300">A little more presence</p><h2 className="font-display text-5xl leading-[1.08] tracking-tight">A thoughtful front desk.<br /><em className="font-normal text-brass-300">A calmer working day.</em></h2><p className="mt-6 max-w-sm text-sm leading-relaxed text-white/75">The conversations, people and appointments that keep your business moving.</p></div>
        <Photo src="/images/hero-reception.jpg" className="!absolute inset-0 opacity-20" />
        <p className="relative z-10 text-xs text-white/60">Your business, thoughtfully connected.</p>
      </aside>
      <main className="flex min-w-0 flex-col px-5 py-7 sm:px-12 lg:px-16">
        <Link to="/" className="flex w-fit items-center gap-3 text-sm font-semibold"><span className="flex size-9 items-center justify-center rounded-xl bg-pine-800 font-display text-lg text-white">C</span> Cleardesk</Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <div className="mb-8">
          <p className="section-kicker mb-4">For your team</p>
          <h1 className="type-h1 text-ink">Welcome back.</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-3">Sign in to your business console.</p>
        </div>
        <form onSubmit={submit} className="space-y-5">
          {!supabaseConfigured() && (
            <ErrorNote>
              Staff sign-in is not configured on this deployment. Contact the business owner.
            </ErrorNote>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" placeholder="you@business.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" loading={busy} disabled={!supabaseConfigured()} className="w-full">
            {busy ? "Signing in…" : "Sign in to console"}
          </Button>
          <p className="flex items-start gap-2 border-t border-line pt-5 text-xs leading-relaxed text-ink-3">
            <IconShield className="mt-px size-3.5 shrink-0" />
            Administrator accounts are provisioned by the business owner. Access requires membership in the admin list.
          </p>
        </form></div>
        <Link to="/" className="text-xs font-medium text-ink-3 hover:text-pine-700">← Back to the customer view</Link>
      </main>
      </div>
  );
}
