import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const {
    produto_id,
    unidade_id,
    quantidade,
    preco_custo,
    fornecedor,
    nota_fiscal,
    observacao,
  } = req.body || {};

  if (!produto_id) return res.status(400).json({ ok: false, error: 'produto_id obrigatório' });
  if (!unidade_id) return res.status(400).json({ ok: false, error: 'unidade_id obrigatório' });
  if (!quantidade || quantidade <= 0) return res.status(400).json({ ok: false, error: 'quantidade obrigatória e deve ser positiva' });

  // Gerente/farmer só pode dar entrada na própria unidade
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }

  const { data, error } = await lareport.rpc('registrar_entrada_estoque', {
    p_produto_id: produto_id,
    p_unidade_id: unidade_id,
    p_quantidade: quantidade,
    p_preco_custo: preco_custo ?? null,
    p_fornecedor: fornecedor ?? null,
    p_nota_fiscal: nota_fiscal ?? null,
    p_observacao: observacao ?? null,
    p_registrado_por: collab.id,
  });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
