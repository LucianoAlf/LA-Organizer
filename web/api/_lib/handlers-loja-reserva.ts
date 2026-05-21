// Handlers consolidados de /loja/reserva/* (cancelar, finalizar) —
// invocados pelo router loja/reserva/[action].ts. Sprint 23.8.
// Comportamento idêntico aos originais cancelar.ts / finalizar.ts.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from './auth.js';
import { checkAccess } from './access-control.js';
import { lareport } from './lareport-server.js';

const FORMAS_PAGAMENTO = ['pix', 'dinheiro', 'debito', 'credito', 'folha', 'saldo'] as const;
type FormaPagamento = typeof FORMAS_PAGAMENTO[number];

const TIPOS_CLIENTE = ['aluno', 'avulso', 'colaborador'] as const;
type TipoCliente = typeof TIPOS_CLIENTE[number];

interface ReservaRow {
  id: number;
  status: string;
  unidade_id: string;
  produto_id: number;
  variacao_id: number | null;
  quantidade: number;
  aluno_id: number | null;
  cliente_nome: string | null;
}

export async function reservaCancelar(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_vendas');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const { reserva_id, motivo } = req.body || {};
  if (!reserva_id || !Number.isFinite(Number(reserva_id))) {
    return res.status(400).json({ ok: false, error: 'reserva_id obrigatorio' });
  }
  const reservaId = Number(reserva_id);

  const { data: reserva, error: rErr } = await lareport
    .from('loja_reservas')
    .select('id, unidade_id, status')
    .eq('id', reservaId)
    .maybeSingle();
  if (rErr) return res.status(500).json({ ok: false, error: rErr.message });
  if (!reserva) return res.status(400).json({ ok: false, error: 'reserva_inexistente' });
  if (reserva.status !== 'ativa') return res.status(400).json({ ok: false, error: 'reserva_nao_ativa' });

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

export async function reservaFinalizar(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_vendas');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const body = req.body || {};
  const {
    reserva_id, forma_pagamento, tipo_cliente, preco_unitario,
    desconto, desconto_tipo, professor_indicador_id, colaborador_id,
    observacoes, parcelas, via_audit,
  } = body;

  if (!reserva_id || !Number.isFinite(Number(reserva_id))) {
    return res.status(400).json({ ok: false, error: 'reserva_id obrigatorio' });
  }
  if (!forma_pagamento) return res.status(400).json({ ok: false, error: 'forma_pagamento obrigatoria' });
  if (!FORMAS_PAGAMENTO.includes(forma_pagamento as FormaPagamento)) {
    return res.status(400).json({ ok: false, error: `forma_pagamento invalida. Use: ${FORMAS_PAGAMENTO.join(', ')}` });
  }
  if (preco_unitario == null || !Number.isFinite(Number(preco_unitario))) {
    return res.status(400).json({ ok: false, error: 'preco_unitario obrigatorio' });
  }

  const reservaId = Number(reserva_id);

  const { data: reservaRaw, error: rErr } = await lareport
    .from('loja_reservas')
    .select('id, status, unidade_id, produto_id, variacao_id, quantidade, aluno_id, cliente_nome')
    .eq('id', reservaId)
    .maybeSingle();
  if (rErr) return res.status(500).json({ ok: false, error: rErr.message });
  if (!reservaRaw) return res.status(400).json({ ok: false, error: 'reserva_inexistente' });

  const reserva = reservaRaw as ReservaRow;
  if (reserva.status !== 'ativa') return res.status(400).json({ ok: false, error: 'reserva_nao_ativa' });

  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(reserva.unidade_id)) {
      return res.status(403).json({
        ok: false,
        error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.',
      });
    }
  }

  const tipoClienteFinal: TipoCliente = TIPOS_CLIENTE.includes(tipo_cliente)
    ? tipo_cliente
    : (reserva.aluno_id ? 'aluno' : 'avulso');

  const itens = [{
    produto_id: reserva.produto_id,
    variacao_id: reserva.variacao_id,
    quantidade: reserva.quantidade,
    preco_unitario: Number(preco_unitario),
    desconto: desconto != null ? Number(desconto) : 0,
    desconto_tipo: desconto_tipo === 'percentual' ? 'percentual' : 'valor',
  }];

  const { data: vendaData, error: vErr } = await lareport.rpc('registrar_venda_v2', {
    p_unidade_id: reserva.unidade_id,
    p_itens: itens,
    p_forma_pagamento: forma_pagamento as FormaPagamento,
    p_via_audit: via_audit ?? `reserva:${reservaId}`,
    p_tipo_cliente: tipoClienteFinal,
    p_cliente_nome: reserva.cliente_nome ?? null,
    p_aluno_id: reserva.aluno_id ?? null,
    p_colaborador_cliente_id: colaborador_id ?? null,
    p_professor_indicador_id: professor_indicador_id ?? null,
    p_desconto: 0,
    p_desconto_tipo: 'valor',
    p_parcelas: parcelas ?? 1,
    p_observacoes: observacoes ?? null,
  });

  if (vErr) {
    const status = /insuficiente|inexistente|invalida|obrigatorio/i.test(vErr.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: vErr.message });
  }

  let vendaId: number | null = null;
  if (vendaData && typeof vendaData === 'object') {
    const d = vendaData as Record<string, unknown>;
    const candidate = d.venda_id ?? d.id ?? (Array.isArray(vendaData) ? (vendaData[0] as Record<string, unknown>)?.venda_id : null);
    if (candidate != null && Number.isFinite(Number(candidate))) vendaId = Number(candidate);
  }
  if (typeof vendaData === 'number') vendaId = vendaData;

  const { error: updErr } = await lareport
    .from('loja_reservas')
    .update({
      status: 'finalizada',
      finalizada_em: new Date().toISOString(),
      finalizada_venda_id: vendaId,
    })
    .eq('id', reservaId)
    .eq('status', 'ativa');

  if (updErr) {
    console.error('[reserva/finalizar] venda registrada mas update da reserva falhou:', updErr.message);
  }

  return res.status(200).json({ ok: true, venda_id: vendaId, venda_data: vendaData });
}
