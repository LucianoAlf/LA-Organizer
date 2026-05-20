import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';

const FORMAS_PAGAMENTO = ['pix', 'dinheiro', 'debito', 'credito', 'folha', 'saldo'] as const;
type FormaPagamento = typeof FORMAS_PAGAMENTO[number];

const TIPOS_CLIENTE = ['aluno', 'avulso', 'colaborador'] as const;
type TipoCliente = typeof TIPOS_CLIENTE[number];

interface VendaItem {
  produto_id: number;
  variacao_id?: number | null;
  quantidade: number;
  preco_unitario: number;
  desconto?: number;
  desconto_tipo?: 'valor' | 'percentual';
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
    forma_pagamento,
    tipo_cliente,
    aluno_id,
    colaborador_id,
    professor_indicador_id,
    observacoes,
    via_audit,
    parcelas,
    // multi-item
    itens: itensRaw,
    // legacy single-item (compat)
    produto_id,
    variacao_id,
    quantidade,
    preco_unitario,
    desconto,
    desconto_tipo,
  } = body;

  if (!unidade_id) return res.status(400).json({ ok: false, error: 'unidade_id obrigatório' });
  if (!forma_pagamento) return res.status(400).json({ ok: false, error: 'forma_pagamento obrigatória' });
  if (!FORMAS_PAGAMENTO.includes(forma_pagamento as FormaPagamento)) {
    return res.status(400).json({ ok: false, error: `forma_pagamento inválida. Use: ${FORMAS_PAGAMENTO.join(', ')}` });
  }

  const tipo_cliente_final: TipoCliente = TIPOS_CLIENTE.includes(tipo_cliente)
    ? tipo_cliente
    : 'avulso';

  // Gerente/farmer só pode vender na própria unidade
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }

  // Normaliza para array de itens (compat com body single-item legado)
  let itens: VendaItem[];
  if (Array.isArray(itensRaw) && itensRaw.length > 0) {
    itens = itensRaw;
  } else if (produto_id != null && preco_unitario != null) {
    // Legacy single-item: converte para array de 1
    itens = [{
      produto_id,
      variacao_id: variacao_id ?? null,
      quantidade: quantidade ?? 1,
      preco_unitario,
      desconto: desconto ?? 0,
      desconto_tipo: desconto_tipo ?? 'valor',
    }];
  } else {
    return res.status(400).json({ ok: false, error: 'Forneça "itens" (array) ou "produto_id" + "preco_unitario"' });
  }

  // Valida cada item
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (!item.produto_id) return res.status(400).json({ ok: false, error: `itens[${i}].produto_id obrigatório` });
    if (item.preco_unitario == null) return res.status(400).json({ ok: false, error: `itens[${i}].preco_unitario obrigatório` });
    if (!item.quantidade || item.quantidade <= 0) return res.status(400).json({ ok: false, error: `itens[${i}].quantidade deve ser positivo` });
  }

  const { data, error } = await lareport.rpc('registrar_venda_v2', {
    p_unidade_id: unidade_id,
    p_itens: itens,
    p_forma_pagamento: forma_pagamento as FormaPagamento,
    p_tipo_cliente: tipo_cliente_final,
    p_aluno_id: aluno_id ?? null,
    p_colaborador_id: colaborador_id ?? null,
    p_professor_indicador_id: professor_indicador_id ?? null,
    p_desconto_tipo: 'valor',
    p_observacoes: observacoes ?? null,
    p_via_audit: via_audit ?? null,
    p_parcelas: parcelas ?? null,
    p_registrado_por: collab.id,
  });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
