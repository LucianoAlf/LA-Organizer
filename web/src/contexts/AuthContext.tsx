import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import type { Collaborator, Role } from '../types';

interface AuthContextType {
  session: Session | null;
  collaborator: Collaborator | null;
  role: Role | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [collaborator, setCollaborator] = useState<Collaborator | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: read existing session, subscribe to changes.
  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Resolve collaborator row from session.user.email.
  useEffect(() => {
    let cancelled = false;
    async function resolveCollab() {
      if (!session?.user?.email) {
        setCollaborator(null);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, email, phone, role, function_title, unit, is_active, onboarding_completed')
        .eq('email', session.user.email)
        .eq('is_active', true)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('[Auth] collaborator lookup err:', error.message);
        setCollaborator(null);
      } else {
        setCollaborator((data as Collaborator) ?? null);
      }
      setLoading(false);
    }
    resolveCollab();
    return () => { cancelled = true; };
  }, [session?.user?.email]);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setCollaborator(null);
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        collaborator,
        role: collaborator?.role ?? null,
        loading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}
