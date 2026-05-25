import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { DEMO_TOKEN } from './demo-data';
import { supabase } from './supabase';

type SignUpResult = {
  needsEmailConfirmation: boolean;
};

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  accessToken: string | null;
  isDemo: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

function buildRedirect(path: string): string {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

function isDevDemoEnabled() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  if (import.meta.env.VITE_ENABLE_DEMO !== 'true') {
    window.localStorage.removeItem('clientPortal.demo');
    return false;
  }
  return window.localStorage.getItem('clientPortal.demo') === 'true';
}

function demoUser(): User {
  return {
    id: 'demo-client-user',
    app_metadata: { role: 'client_user', clientIds: [7], storeIds: [12001] },
    user_metadata: { name: 'DrPrepperUSA Client' },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    email: 'client@drprepperusa.org',
  } as User;
}

function removeSupabaseSessionKeys(storage: Storage) {
  const keysToRemove: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (key === 'supabase.auth.token' || key === 'sb-auth-token' || key.startsWith('sb-')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => storage.removeItem(key));
}

function clearLocalSession() {
  if (typeof window === 'undefined') return;
  removeSupabaseSessionKeys(window.localStorage);
  removeSupabaseSessionKeys(window.sessionStorage);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(isDevDemoEnabled);

  useEffect(() => {
    if (demo) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadInitialSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) {
          clearLocalSession();
          setSession(null);
        } else {
          setSession(data.session);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' && !nextSession) clearLocalSession();
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [demo]);

  const value = useMemo<AuthState>(
    () => ({
      session: demo ? ({} as Session) : session,
      user: demo ? demoUser() : (session?.user ?? null),
      loading,
      accessToken: demo ? DEMO_TOKEN : (session?.access_token ?? null),
      isDemo: demo,
      signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) setSession(data.session);
      },
      signUp: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: buildRedirect('/login') },
        });
        if (error) throw error;
        return { needsEmailConfirmation: !data.session };
      },
      signOut: async () => {
        setSession(null);
        setLoading(false);
        if (demo) {
          window.localStorage.removeItem('clientPortal.demo');
          setDemo(false);
        }
        clearLocalSession();
      },
      resetPasswordForEmail: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: buildRedirect('/reset-password'),
        });
        if (error) throw error;
      },
      updatePassword: async (newPassword) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
      },
    }),
    [demo, loading, session],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
