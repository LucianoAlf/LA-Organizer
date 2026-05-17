import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../../_lib/auth';
import { checkAccess } from '../../../_lib/access-control';
import { lareport } from '../../../_lib/lareport-server';
import { withAudit } from '../../../_lib/audit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const id = parseInt(req.query.id as string, 10);
  const { sala_destino_id, motivo } = req.body || {};
  if (!sala_destino_id) return res.status(400).json({ ok: false, error: 'sala_destino_id obrigatório' });

  const access = checkAccess(collab, 'movimentacoes');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const { data: item } = await lareport.from('inventario').select('unidade_id, sala_id').eq('id', id).maybeSingle();
  if (!item) return res.status(404).json({ ok: false, error: 'item_not_found' });
  const { data: destino } = await lareport.from('salas').select('unidade_id').eq('id', sala_destino_id).maybeSingle();
  if (!destino) return res.status(404).json({ ok: false, error: 'sala_destino_not_found' });

  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(item.unidade_id) || !units.includes(destino.unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }

  const [{ data: mov, error: e1 }, { error: e2 }] = await Promise.all([
    lareport.from('inventario_movimentacoes').insert({
      item_id: id,
      tipo: 'transferencia',
      sala_origem_id: item.sala_id,
      sala_destino_id,
      motivo: withAudit(motivo, collab),
      usuario_id: null,
    }).select().single(),
    lareport.from('inventario').update({ sala_id: sala_destino_id, updated_at: new Date().toISOString() }).eq('id', id),
  ]);
  if (e1) return res.status(500).json({ ok: false, error: e1.message });
  if (e2) return res.status(500).json({ ok: false, error: e2.message });
  return res.status(200).json({ ok: true, data: mov });
}
