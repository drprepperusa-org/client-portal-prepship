import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

interface AuthApi {
  loading: boolean;
  isAuthed: boolean;
  passwordRecovery: boolean;
  accessToken: string | null;
  email: string | null;
  userId: string | null;
  activationPending: boolean;
  lastSignInAt: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signOutAllDevices: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  finishPasswordRecovery: (newPassword: string) => Promise<void>;
}

const AuthCtx = createContext<AuthApi | null>(null);
const RECOVERY_MARKER = 'prepship.passwordRecovery';

function recoveryRedirect(): string {
  return `${window.location.origin}/reset-password`;
}

function setRecoveryMarker(active: boolean): void {
  if (active) window.sessionStorage.setItem(RECOVERY_MARKER, '1');
  else window.sessionStorage.removeItem(RECOVERY_MARKER);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => window.sessionStorage.getItem(RECOVERY_MARKER) === '1',
  );
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

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMarker(true);
        setPasswordRecovery(true);
      } else if (event === 'SIGNED_OUT') {
        setRecoveryMarker(false);
        setPasswordRecovery(false);
      }
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
      passwordRecovery,
      accessToken: session?.access_token ?? null,
      email: session?.user?.email ?? null,
      userId: session?.user?.id ?? null,
      activationPending: session?.user?.app_metadata?.portalInvitePending === true,
      lastSignInAt: session?.user?.last_sign_in_at ?? null,
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
      signOutAllDevices: async () => {
        // scope: 'global' revokes every refresh token for this user, ending
        // sessions on all other browsers/devices too (this one included). Mirror
        // signOut's deterministic cache wipe.
        await supabase.auth.signOut({ scope: 'global' });
        queryClient.clear();
        cachedUserId.current = null;
        setSession(null);
      },
      changePassword: async (currentPassword, newPassword) => {
        const currentEmail = session?.user?.email;
        if (!currentEmail) throw new Error('You are not signed in.');
        // Re-authenticate with the current password first: updateUser alone
        // trusts the existing session, which would let anyone at an unlocked
        // screen reset the password. This proves the person knows the old one.
        const { error: reauthError } = await supabase.auth.signInWithPassword({
          email: currentEmail,
          password: currentPassword,
        });
        if (reauthError) throw new Error('Your current password is incorrect.');
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw new Error(error.message);
      },
      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: recoveryRedirect(),
        });
        if (error) throw new Error(error.message);
      },
      finishPasswordRecovery: async (newPassword) => {
        if (!session?.access_token || !passwordRecovery) {
          throw new Error('Open the latest password recovery email to continue.');
        }
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw new Error(error.message);
        setRecoveryMarker(false);
        setPasswordRecovery(false);
        await supabase.auth.signOut();
        queryClient.clear();
        cachedUserId.current = null;
        setSession(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, passwordRecovery, session],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
