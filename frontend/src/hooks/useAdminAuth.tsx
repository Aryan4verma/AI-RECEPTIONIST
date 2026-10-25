import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { adminSignIn, adminSignOut, supabase } from "../lib/admin";

interface AdminUser {
  email: string;
  token: string;
}

interface AdminAuth {
  user: AdminUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AdminAuth | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore a Supabase session if present (refresh persistence).
    supabase?.auth
      .getSession()
      .then(({ data }) => {
        const s = data.session;
        if (s?.user?.email && s.access_token) setUser({ email: s.user.email, token: s.access_token });
      })
      .finally(() => setLoading(false));
    const { data: sub } = supabase?.auth.onAuthStateChange((_evt, session) => {
      if (session?.user?.email && session.access_token) {
        setUser({ email: session.user.email, token: session.access_token });
      } else {
        setUser(null);
      }
    }) ?? { data: { subscription: { unsubscribe: () => undefined } } };
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const token = await adminSignIn(email, password);
    setUser({ email, token });
  }, []);

  const signOut = useCallback(async () => {
    await adminSignOut();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminAuth(): AdminAuth {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminAuth outside provider");
  return v;
}
