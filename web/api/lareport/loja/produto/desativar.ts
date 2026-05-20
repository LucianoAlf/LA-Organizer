import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../../_lib/auth.js';
import { checkAccess } from '../../../_lib/access-control.js';
import { lareport } from '../../../_lib/lareport-server.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const body = req.body || {};
  const { id } = body;

  if (!id) return res.status(400).json({ ok: false, error: 'id obrigatório' });

  const { error } = await lareport
    .from('loja_produtos')
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true });
}
