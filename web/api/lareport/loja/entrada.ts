import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';

interface EntradaItem {
  produto_id: number;
  variacao_id?: number | null;
  quantidade: number;
  preco_custo?: number | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const body = req.body || {};

  const {
    unidade_id,
    fornecedor,
    nota_fiscal,
    nf,
    observacao,
    observacoes,
    // multi-item
    itens: itensRaw,
    // legacy single-item (compat)
    produto_id,
    variacao_id,
    quantidade,
    preco_custo,
  } = body;

  if (!unidade_id) return res.status(400).json({ ok: false, error: 'unidade_id obrigatório' });

  // Gerente/farmer só pode dar entrada na própria unidade
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }

  // Normaliza para array de itens (compat com body single-item legado)
  let itens: EntradaItem[];
  if (Array.isArray(itensRaw) && itensRaw.length > 0) {
    itens = itensRaw;
  } else if (produto_id != null) {
    // Legacy single-item: converte para array de 1
    if (!quantidade || quantidade <= 0) {
      return res.status(400).json({ ok: false, error: 'quantidade obrigatória e deve ser positiva' });
    }
    itens = [{
      produto_id,
      variacao_id: variacao_id ?? null,
      quantidade,
      preco_custo: preco_custo ?? null,
    }];
  } else {
    return res.status(400).json({ ok: false, error: 'Forneça "itens" (array) ou "produto_id"' });
  }

  // Valida cada item
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (!item.produto_id) return res.status(400).json({ ok: false, error: `itens[${i}].produto_id obrigatório` });
    if (!item.quantidade || item.quantidade <= 0) return res.status(400).json({ ok: false, error: `itens[${i}].quantidade deve ser positivo` });
  }

  const { data, error } = await lareport.rpc('registrar_entrada_estoque_v2', {
    p_unidade_id: unidade_id,
    p_itens: itens,
    p_fornecedor: fornecedor ?? null,
    p_nota_fiscal: nota_fiscal ?? nf ?? null,
    p_observacao: observacao ?? observacoes ?? null,
    p_registrado_por: collab.id,
  });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
