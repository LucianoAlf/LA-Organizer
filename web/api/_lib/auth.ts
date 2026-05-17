import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import type { CollaboratorAuth } from './access-control.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;

// Cliente módulo-level pra validar o token (auth.getUser não exige authenticated).
const sbAdmin = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function requireCollaborator(
  req: VercelRequest,
  res: VercelResponse
): Promise<CollaboratorAuth | null> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ ok: false, error: 'no_auth' });
    return null;
  }

  const { data: ud, error: ue } = await sbAdmin.auth.getUser(token);
  if (ue || !ud.user) {
    res.status(401).json({ ok: false, error: 'invalid_token' });
    return null;
  }
  const email = ud.user.email;
  if (!email) {
    res.status(401).json({ ok: false, error: 'no_email_in_token' });
    return null;
  }

  // RLS de collaborators só permite authenticated. Cria cliente per-request
  // injetando o JWT do usuário pra passar pelas policies.
  const sbAuthed = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: collab, error: ce } = await sbAuthed
    .from('collaborators')
    .select('id, role, unit, full_name, function_role, pedagogical_role, email, is_active')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle();

  if (ce) {
    res.status(500).json({ ok: false, error: 'collab_lookup_failed', detail: ce.message });
    return null;
  }
  if (!collab) {
    res.status(403).json({ ok: false, error: 'no_collaborator', detail: `email=${email}` });
    return null;
  }
  return collab as CollaboratorAuth;
}
