import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth';
import { checkAccess } from '../../_lib/access-control';
import { lareport } from '../../_lib/lareport-server';
import { withAudit, stripRestrictedFields } from '../../_lib/audit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const valorAccess = checkAccess(collab, 'valor_patrimonial');
  const { clean, stripped } = stripRestrictedFields(req.body || {}, valorAccess.allowed);
  if (stripped.length > 0) console.warn(`[inventario POST] ${collab.full_name} (${collab.role}/${collab.function_role}) tentou enviar campos restritos: ${stripped.join(',')}`);

  if (access.unitFilter && clean.unidade_id) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(clean.unidade_id)) return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
  }

  const payload = { ...clean, observacoes: withAudit(clean.observacoes, collab), created_by: null };

  const { data, error } = await lareport.from('inventario').insert(payload).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
