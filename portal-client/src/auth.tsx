import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

interface AuthApi {
  loading: boolean;
  isAuthed: boolean;
  accessToken: string | null;
  email: string | null;
  userId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  // Tracks the currently-cached user so we can wipe React Query whenever the
  // signed-in identity changes.
  const cachedUserId = useRef<string | null | undefined>(undefined);

  // Drop ALL cached query data when the user changes (login, logout, or
  // switching accounts). Without this, React Query would serve the previous
  // user's cached orders/inventory/etc. to the next user — a cross-tenant data
  // leak — because the cache survives the auth change and keys aren't per-user.
  function syncCacheForUser(next: Session | null) {
    const nextId = next?.user?.id ?? null;
    if (cachedUserId.current === undefined) {
      // First resolution this page-load — nothing cached yet to clear.
      cachedUserId.current = nextId;
      return;
    }
    if (nextId !== cachedUserId.current) {
      queryClient.clear();
      cachedUserId.current = nextId;
    }
  }

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        syncCacheForUser(data.session);
        setSession(data.session);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      syncCacheForUser(next);
      setSession(next);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      loading,
      isAuthed: Boolean(session?.access_token),
      accessToken: session?.access_token ?? null,
      email: session?.user?.email ?? null,
      userId: session?.user?.id ?? null,
      signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) {
          syncCacheForUser(data.session);
          setSession(data.session);
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
        // Explicit wipe so no stale data lingers between the sign-out and the
        // next sign-in (onAuthStateChange also fires, but this is deterministic).
        queryClient.clear();
        cachedUserId.current = null;
        setSession(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, session],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
