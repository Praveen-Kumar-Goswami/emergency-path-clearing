import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type UserRole = 'citizen' | 'ambulance' | 'dispatcher' | null;

interface AuthContextType {
  session: Session | null;
  userId: string | null;
  role: UserRole;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  signInCitizen: () => Promise<void>;
  signInStaff: (email: string, password: string) => Promise<UserRole>;
  registerStaff: (email: string, password: string, newRole?: 'ambulance') => Promise<UserRole>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  userId: null,
  role: null,
  loading: true,
  error: null,
  clearError: () => {},
  signInCitizen: async () => {},
  signInStaff: async () => null,
  registerStaff: async () => null,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const mapAuthError = (err: any): string => {
  if (!err) return 'An unexpected error occurred';
  const msg = err.message || String(err);
  if (msg.includes('Network request failed') || msg.includes('Failed to fetch')) {
    return 'Network error. Please check your internet connection and Supabase URL.';
  }
  if (msg.includes('Invalid login credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  if (msg.includes('Anonymous sign-ins are disabled')) {
    return 'Anonymous sign-ins are disabled in Supabase Auth settings.';
  }
  if (msg.includes('Email not confirmed')) {
    return 'Email confirmation is pending. Please disable "Confirm email" in Supabase Auth settings.';
  }
  return msg;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const fetchRoleWithRetry = async (uid: string, retries = 4, delayMs = 500): Promise<UserRole> => {
    for (let i = 0; i < retries; i++) {
      const { data, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', uid)
        .maybeSingle();

      if (!profileErr && data?.role) {
        return data.role as UserRole;
      }
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    // Default fallback to citizen if row not created yet
    return 'citizen';
  };

  useEffect(() => {
    let isMounted = true;

    // Restore persisted session on startup
    const initAuth = async () => {
      try {
        const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (initialSession?.user && isMounted) {
          setSession(initialSession);
          const userRole = await fetchRoleWithRetry(initialSession.user.id);
          if (isMounted) setRole(userRole);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(mapAuthError(err));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      if (newSession?.user) {
        const userRole = await fetchRoleWithRetry(newSession.user.id);
        if (isMounted) setRole(userRole);
      } else {
        setRole(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInCitizen = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if active anonymous session already exists
      if (session?.user?.is_anonymous) {
        const userRole = await fetchRoleWithRetry(session.user.id);
        setRole(userRole);
        return;
      }

      const { data, error: anonErr } = await supabase.auth.signInAnonymously();
      if (anonErr) throw anonErr;

      if (data.user) {
        const userRole = await fetchRoleWithRetry(data.user.id);
        setRole(userRole);
      }
    } catch (err: any) {
      const mapped = mapAuthError(err);
      setError(mapped);
      throw new Error(mapped);
    } finally {
      setLoading(false);
    }
  };

  const signInStaff = async (email: string, password: string): Promise<UserRole> => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: staffErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (staffErr) throw staffErr;
      if (!data.user) throw new Error('Sign in succeeded but user was null.');

      const userRole = await fetchRoleWithRetry(data.user.id);
      if (userRole === 'citizen') {
        await supabase.auth.signOut();
        setRole(null);
        setSession(null);
        const roleMsg = 'This account has no ambulance or dispatcher role. Ask an administrator.';
        setError(roleMsg);
        throw new Error(roleMsg);
      }

      setRole(userRole);
      return userRole;
    } catch (err: any) {
      const mapped = mapAuthError(err);
      setError(mapped);
      throw new Error(mapped);
    } finally {
      setLoading(false);
    }
  };

  const registerStaff = async (email: string, password: string, newRole: 'ambulance' = 'ambulance'): Promise<UserRole> => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (signUpErr) throw signUpErr;
      if (!data.user) throw new Error('Registration succeeded but user was null.');

      const { error: profileErr } = await (supabase.from('profiles') as any).upsert({
        id: data.user.id,
        role: newRole,
      });
      if (profileErr) throw profileErr;

      setRole(newRole);
      setSession(data.session);
      return newRole;
    } catch (err: any) {
      const mapped = mapAuthError(err);
      setError(mapped);
      throw new Error(mapped);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      await supabase.auth.signOut();
      setSession(null);
      setRole(null);
      setError(null);
    } catch (err: any) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        userId: session?.user?.id ?? null,
        role,
        loading,
        error,
        clearError,
        signInCitizen,
        signInStaff,
        registerStaff,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
