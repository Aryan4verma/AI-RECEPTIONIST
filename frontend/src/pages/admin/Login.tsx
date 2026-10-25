import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, ErrorNote, Field, Input } from "../../components/ui";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { supabaseConfigured } from "../../lib/admin";

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
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-pine-600 font-display text-lg font-semibold text-white" aria-hidden="true">
            C
          </div>
          <h1 className="font-display text-2xl text-ink">Cleardesk Console</h1>
          <p className="mt-1 text-sm text-ink-2">Sign in to manage your receptionist.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-card border border-line bg-raised p-6 shadow-slip">
          {!supabaseConfigured() && (
            <ErrorNote>
              Supabase isn't configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in{" "}
              <code>frontend/.env</code>.
            </ErrorNote>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
            Sign in
          </Button>
          <p className="text-center text-xs text-ink-3">
            Administrator accounts are provisioned by the business owner. Access requires membership in the admin list.
          </p>
        </form>
      </div>
    </div>
  );
}
