import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../../_lib/auth.js';
import { checkAccess } from '../../../_lib/access-control.js';
import { lareport } from '../../../_lib/lareport-server.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_vendas');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const body = req.body || {};
  const { reserva_id, motivo } = body;

  if (!reserva_id || !Number.isFinite(Number(reserva_id))) {
    return res.status(400).json({ ok: false, error: 'reserva_id obrigatorio' });
  }
  const reservaId = Number(reserva_id);

  // Busca reserva para validar status e unitFilter.
  const { data: reserva, error: rErr } = await lareport
    .from('loja_reservas')
    .select('id, unidade_id, status')
    .eq('id', reservaId)
    .maybeSingle();
  if (rErr) return res.status(500).json({ ok: false, error: rErr.message });
  if (!reserva) return res.status(400).json({ ok: false, error: 'reserva_inexistente' });

  if (reserva.status !== 'ativa') {
    return res.status(400).json({ ok: false, error: 'reserva_nao_ativa' });
  }

  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(reserva.unidade_id)) {
      return res.status(403).json({
        ok: false,
        error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.',
      });
    }
  }

  const motivoTxt = motivo && typeof motivo === 'string' ? motivo.trim().slice(0, 500) : null;

  const { data, error } = await lareport
    .from('loja_reservas')
    .update({
      status: 'cancelada',
      cancelada_em: new Date().toISOString(),
      motivo_cancelamento: motivoTxt,
    })
    .eq('id', reservaId)
    .eq('status', 'ativa')
    .select('id')
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(400).json({ ok: false, error: 'reserva_nao_ativa' });

  return res.status(200).json({ ok: true, reserva_id: data.id });
}
