import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';
import { withAudit } from '../../_lib/audit.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const id = parseInt(req.query.id as string, 10);
  const { tipo, descricao, custo, data_manutencao, responsavel, fornecedor_servico, data_proxima_revisao } = req.body || {};
  if (!tipo || !descricao || !data_manutencao) return res.status(400).json({ ok: false, error: 'tipo, descricao e data_manutencao obrigatórios' });

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  if (access.unitFilter) {
    const { data: item } = await lareport.from('inventario').select('unidade_id').eq('id', id).maybeSingle();
    if (!item) return res.status(404).json({ ok: false, error: 'item_not_found' });
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(item.unidade_id)) return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
  }

  const { data, error } = await lareport.from('inventario_manutencoes').insert({
    item_id: id, tipo, descricao,
    custo: custo ?? null,
    data_manutencao,
    responsavel: responsavel ?? null,
    fornecedor_servico: fornecedor_servico ?? null,
    data_proxima_revisao: data_proxima_revisao ?? null,
    observacoes: withAudit(null, collab),
    created_by: null,
  }).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
