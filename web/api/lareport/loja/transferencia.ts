import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';

const ERROS_400 = /insuficiente|inexistente|igual|invalida|obrigatorio/i;

interface TransferenciaResult {
  saldo_origem: number;
  saldo_destino: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const body = req.body || {};

  const {
    produto_id,
    unidade_origem,
    unidade_destino,
    quantidade,
    motivo,
    via_audit,
    variacao_id,
  } = body;

  // Validação básica
  if (!produto_id) return res.status(400).json({ ok: false, error: 'produto_id obrigatório' });
  if (!unidade_origem) return res.status(400).json({ ok: false, error: 'unidade_origem obrigatório' });
  if (!unidade_destino) return res.status(400).json({ ok: false, error: 'unidade_destino obrigatório' });
  if (!quantidade || quantidade <= 0) return res.status(400).json({ ok: false, error: 'quantidade deve ser positivo' });
  if (!motivo) return res.status(400).json({ ok: false, error: 'motivo obrigatório' });

  // Gerente/farmer só pode transferir DA própria unidade
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_origem)) {
      return res.status(403).json({
        ok: false,
        error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.',
      });
    }
  }

  const { data, error } = await lareport.rpc('transferir_estoque', {
    p_produto_id: produto_id,
    p_unidade_origem: unidade_origem,
    p_unidade_destino: unidade_destino,
    p_quantidade: quantidade,
    p_motivo: motivo,
    p_via_audit: via_audit ?? null,
    p_variacao_id: variacao_id ?? null,
  });

  if (error) {
    const status = ERROS_400.test(error.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: error.message });
  }

  const result = data as TransferenciaResult;
  return res.status(200).json({
    ok: true,
    saldo_origem: result?.saldo_origem,
    saldo_destino: result?.saldo_destino,
  });
}
