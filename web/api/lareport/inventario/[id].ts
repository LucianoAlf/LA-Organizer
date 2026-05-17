import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth';
import { checkAccess } from '../../_lib/access-control';
import { lareport } from '../../_lib/lareport-server';
import { withAudit, stripRestrictedFields } from '../../_lib/audit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['PATCH', 'DELETE'].includes(req.method!)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const id = parseInt(req.query.id as string, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'invalid_id' });

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  if (access.unitFilter) {
    const { data: existing } = await lareport.from('inventario').select('unidade_id').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(existing.unidade_id)) return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
  }

  if (req.method === 'DELETE') {
    const { data, error } = await lareport.from('inventario').update({ status: 'baixa', ativo: false, observacoes: withAudit('Baixa via PWA', collab) }).eq('id', id).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, data });
  }

  const valorAccess = checkAccess(collab, 'valor_patrimonial');
  const { clean, stripped } = stripRestrictedFields(req.body || {}, valorAccess.allowed);
  if (stripped.length > 0) console.warn(`[inventario PATCH ${id}] ${collab.full_name} stripped: ${stripped.join(',')}`);

  const payload = { ...clean };
  if (payload.observacoes !== undefined) payload.observacoes = withAudit(payload.observacoes, collab);

  const { data, error } = await lareport.from('inventario').update(payload).eq('id', id).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
