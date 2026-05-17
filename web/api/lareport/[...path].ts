// Vercel Serverless Function — proxy autenticado pra TOM internal-api.
//
// Por quê: shared-secret no bundle do PWA é tech debt aceito (tomEngine.ts),
// mas pra LA Report o secret tá no LADO DO LA REPORT (cross-project Supabase).
// Aqui validamos a sessão Supabase do usuário (cookie/JWT do PWA) ANTES
// de injetar o secret server-side e proxiar pro TOM.
//
// Fluxo:
//   1. Browser → /api/lareport/<endpoint> (same-origin, cookie de sessão)
//   2. Esta função extrai o JWT do Authorization header
//   3. Valida via supabase.auth.getUser(token)
//   4. Checa role do collaborator (coord/director/manager)
//   5. Chama TOM_API_BASE + path + x-internal-secret (server-side only)
//   6. Devolve a resposta pro browser
//
// Env vars necessárias no Vercel (SEM prefixo VITE_ — server-side only):
//   TOM_API_BASE          = https://<tunnel>.trycloudflare.com
//   TOM_INTERNAL_SECRET   = <mesmo INTERNAL_API_SECRET do .env do TOM>
//
// Env vars públicas já existentes:
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY (usada aqui também — auth proper user-based)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const ALLOWED_ROLES = new Set(['coordinator', 'director', 'manager']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // 1. Auth — extrai JWT do Authorization header
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, error: 'no_auth' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: 'supabase_env_missing' });
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }

  // 2. Role check — busca o collaborator e confere role
  const { data: collab, error: collabErr } = await supabase
    .from('collaborators')
    .select('id, role')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (collabErr) {
    return res.status(500).json({ ok: false, error: 'collab_lookup_failed', detail: collabErr.message });
  }
  if (!collab || !ALLOWED_ROLES.has(collab.role)) {
    return res.status(403).json({ ok: false, error: 'forbidden_role' });
  }

  // 3. Proxy pro TOM com secret server-side
  const tomBase = process.env.TOM_API_BASE;
  const tomSecret = process.env.TOM_INTERNAL_SECRET;
  if (!tomBase || !tomSecret) {
    return res.status(500).json({ ok: false, error: 'tom_env_missing' });
  }

  // Reconstrói o path: /api/lareport/[unidades|salas|sala/123|loja|alertas] → /internal/lareport/...
  const pathParts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean) as string[];
  const subPath = pathParts.join('/');
  const queryString = Object.entries(req.query)
    .filter(([k]) => k !== 'path')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${tomBase}/internal/lareport/${subPath}${queryString ? `?${queryString}` : ''}`;

  try {
    const tomRes = await fetch(url, {
      method: 'GET',
      headers: { 'x-internal-secret': tomSecret },
    });
    const text = await tomRes.text();
    res.status(tomRes.status);
    res.setHeader('Content-Type', tomRes.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ ok: false, error: 'tom_upstream_failed', detail: msg });
  }
}
