import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import type { Collaborator, Role } from '../types';

interface SendMagicLinkResult {
  ok: boolean;
  email?: string;             // collaborator.email — needed by verifyMagicCode
  masked_phone?: string;
  first_name?: string | null;
  unknown?: boolean;          // server says phone not found / inactive (vague)
  error?: string;
  retry_after_min?: number;
}

interface AuthContextType {
  session: Session | null;
  collaborator: Collaborator | null;
  role: Role | null;
  loading: boolean;
  sendMagicLink: (phone: string) => Promise<SendMagicLinkResult>;
  verifyMagicCode: (email: string, code: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /** Atualiza avatar_url ou full_name do colaborador */
  updateProfile: (fields: { avatar_url?: string; full_name?: string }) => Promise<{ error: Error | null }>;
  /** Força reload do colaborador (após upload de foto etc.) */
  refreshCollaborator: () => Promise<void>;
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
        .select('id, full_name, email, phone, role, function_title, unit, is_active, onboarding_completed, avatar_url, bio, preferred_name, function_role, pedagogical_role')
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

  async function sendMagicLink(phone: string): Promise<SendMagicLinkResult> {
    const cleaned = String(phone || '').replace(/\D/g, '');
    if (!cleaned) return { ok: false, error: 'phone_required' };
    try {
      const { data, error } = await supabase.functions.invoke('send-magic-link', {
        body: { phone: cleaned },
      });
      if (error) {
        // Edge Function returns non-2xx → supabase-js wraps as FunctionsHttpError;
        // try to extract the original payload via the context if available.
        const payload = (error as { context?: Response })?.context;
        if (payload && typeof payload === 'object' && 'json' in payload) {
          try {
            const body = await (payload as Response).json();
            return { ok: false, error: body?.error ?? 'unknown_error', retry_after_min: body?.retry_after_min };
          } catch (_) { /* fall through */ }
        }
        return { ok: false, error: error.message || 'unknown_error' };
      }
      return data as SendMagicLinkResult;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async function verifyMagicCode(email: string, code: string) {
    const token = String(code || '').replace(/\D/g, '').trim();
    if (!email || !token) return { error: new Error('email_and_code_required') };
    // admin.generateLink(type:'magiclink') yields email_otp; verify with type='email'
    // (the OTP-based path; type='magiclink' is for hashed_token from clicked links).
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    return { error: error ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setCollaborator(null);
  }

  async function refreshCollaborator() {
    if (!session?.user?.email) return;
    const { data } = await supabase
      .from('collaborators')
      .select('id, full_name, email, phone, role, function_title, unit, is_active, onboarding_completed, avatar_url, bio, preferred_name, function_role, pedagogical_role')
      .eq('email', session.user.email)
      .eq('is_active', true)
      .maybeSingle();
    if (data) setCollaborator(data as Collaborator);
  }

  async function updateProfile(fields: { avatar_url?: string; full_name?: string }) {
    if (!collaborator?.id) return { error: new Error('no_session') };
    const { error } = await supabase
      .from('collaborators')
      .update(fields)
      .eq('id', collaborator.id);
    if (!error) setCollaborator(prev => prev ? { ...prev, ...fields } : prev);
    return { error: error ?? null };
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        collaborator,
        role: collaborator?.role ?? null,
        loading,
        sendMagicLink,
        verifyMagicCode,
        signIn,
        signOut,
        updateProfile,
        refreshCollaborator,
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
