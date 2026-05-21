import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';

const ERROS_400 = /insuficiente|inexistente|invalida|obrigatorio|ja_estornada|vencida|cancelada/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_vendas');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const body = req.body || {};
  const { venda_id, motivo } = body;

  if (!venda_id || !Number.isFinite(Number(venda_id))) {
    return res.status(400).json({ ok: false, error: 'venda_id obrigatorio' });
  }
  if (!motivo || typeof motivo !== 'string' || motivo.trim().length < 5) {
    return res.status(400).json({ ok: false, error: 'motivo obrigatorio (min 5 chars)' });
  }

  const vendaId = Number(venda_id);

  // Validar unitFilter — busca unidade_id da venda antes de estornar.
  if (access.unitFilter) {
    const { data: venda, error: vErr } = await lareport
      .from('loja_vendas')
      .select('unidade_id, status')
      .eq('id', vendaId)
      .maybeSingle();
    if (vErr) return res.status(500).json({ ok: false, error: vErr.message });
    if (!venda) return res.status(400).json({ ok: false, error: 'venda_inexistente' });

    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(venda.unidade_id)) {
      return res.status(403).json({
        ok: false,
        error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.',
      });
    }
  }

  // SP real: estornar_venda(p_venda_id, p_motivo, p_via_audit) — sem param de
  // responsável. Embeda quem estornou no p_via_audit pra rastreabilidade.
  const viaAudit = `estorno via PWA por ${collab.full_name ?? collab.id}`;
  const { data, error } = await lareport.rpc('estornar_venda', {
    p_venda_id: vendaId,
    p_motivo: motivo.trim(),
    p_via_audit: viaAudit,
  });

  if (error) {
    const status = ERROS_400.test(error.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, data });
}
