// Handlers consolidados /loja/* (raiz) — invocados pelo router loja/[action].ts.
// Sprint 23.8 consolidação Vercel Hobby (12 functions limit).
// Comportamento idêntico aos arquivos originais entrada/ajuste/estorno/venda/
// transferencia/historico-vendas/buscar/buscar-cliente/buscar-professor.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from './auth.js';
import { checkAccess } from './access-control.js';
import { lareport } from './lareport-server.js';

const FORMAS_PAGAMENTO = ['pix', 'dinheiro', 'debito', 'credito', 'folha', 'saldo'] as const;
type FormaPagamento = typeof FORMAS_PAGAMENTO[number];
const TIPOS_CLIENTE = ['aluno', 'avulso', 'colaborador'] as const;
type TipoCliente = typeof TIPOS_CLIENTE[number];

interface EntradaItem {
  produto_id: number; variacao_id?: number | null;
  quantidade: number; preco_custo?: number | null;
}
interface VendaItem {
  produto_id: number; variacao_id?: number | null;
  quantidade: number; preco_unitario: number;
  desconto?: number; desconto_tipo?: 'valor' | 'percentual';
}
interface TransferenciaResult { saldo_origem: number; saldo_destino: number; }
const STATUS_VALIDOS = ['ativa', 'estornada', 'todas'] as const;
type StatusFiltro = typeof STATUS_VALIDOS[number];
const ERROS_400_ESTORNO = /insuficiente|inexistente|invalida|obrigatorio|ja_estornada|vencida|cancelada/i;
const ERROS_400_TRANSF = /insuficiente|inexistente|igual|invalida|obrigatorio/i;

// ============================= ENTRADA =============================
export async function entrada(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const body = req.body || {};
  const {
    unidade_id, fornecedor, nota_fiscal, nf, observacao, observacoes,
    itens: itensRaw, produto_id, variacao_id, quantidade, preco_custo,
  } = body;
  if (!unidade_id) return res.status(400).json({ ok: false, error: 'unidade_id obrigatório' });
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }
  let itens: EntradaItem[];
  if (Array.isArray(itensRaw) && itensRaw.length > 0) {
    itens = itensRaw;
  } else if (produto_id != null) {
    if (!quantidade || quantidade <= 0) return res.status(400).json({ ok: false, error: 'quantidade obrigatória e deve ser positiva' });
    itens = [{ produto_id, variacao_id: variacao_id ?? null, quantidade, preco_custo: preco_custo ?? null }];
  } else {
    return res.status(400).json({ ok: false, error: 'Forneça "itens" (array) ou "produto_id"' });
  }
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (!item.produto_id) return res.status(400).json({ ok: false, error: `itens[${i}].produto_id obrigatório` });
    if (!item.quantidade || item.quantidade <= 0) return res.status(400).json({ ok: false, error: `itens[${i}].quantidade deve ser positivo` });
  }
  const { data, error } = await lareport.rpc('registrar_entrada_estoque_v2', {
    p_unidade_id: unidade_id, p_itens: itens,
    p_fornecedor: fornecedor ?? null, p_nota_fiscal: nota_fiscal ?? nf ?? null,
    p_observacao: observacao ?? observacoes ?? null, p_registrado_por: collab.id,
  });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}

// ============================= AJUSTE =============================
export async function ajuste(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const { produto_id, unidade_id, delta, motivo } = req.body || {};
  if (!produto_id) return res.status(400).json({ ok: false, error: 'produto_id obrigatório' });
  if (!unidade_id) return res.status(400).json({ ok: false, error: 'unidade_id obrigatório' });
  if (delta == null || delta === 0) return res.status(400).json({ ok: false, error: 'delta obrigatório e deve ser diferente de zero' });
  if (!motivo || String(motivo).trim() === '') return res.status(400).json({ ok: false, error: 'motivo obrigatório' });
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }
  const { data, error } = await lareport.rpc('ajustar_estoque_manual', {
    p_produto_id: produto_id, p_unidade_id: unidade_id,
    p_delta: delta, p_motivo: String(motivo).trim(), p_ajustado_por: collab.id,
  });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}

// ============================= ESTORNO =============================
export async function estorno(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_vendas');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const { venda_id, motivo } = req.body || {};
  if (!venda_id || !Number.isFinite(Number(venda_id))) return res.status(400).json({ ok: false, error: 'venda_id obrigatorio' });
  if (!motivo || typeof motivo !== 'string' || motivo.trim().length < 5) {
    return res.status(400).json({ ok: false, error: 'motivo obrigatorio (min 5 chars)' });
  }
  const vendaId = Number(venda_id);
  if (access.unitFilter) {
    const { data: venda, error: vErr } = await lareport
      .from('loja_vendas').select('unidade_id, status').eq('id', vendaId).maybeSingle();
    if (vErr) return res.status(500).json({ ok: false, error: vErr.message });
    if (!venda) return res.status(400).json({ ok: false, error: 'venda_inexistente' });
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(venda.unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }
  const viaAudit = `estorno via PWA por ${collab.full_name ?? collab.id}`;
  const { data, error } = await lareport.rpc('estornar_venda', {
    p_venda_id: vendaId, p_motivo: motivo.trim(), p_via_audit: viaAudit,
  });
  if (error) {
    const status = ERROS_400_ESTORNO.test(error.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: error.message });
  }
  return res.status(200).json({ ok: true, data });
}

// ============================= VENDA =============================
export async function venda(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const body = req.body || {};
  const {
    unidade_id, forma_pagamento, tipo_cliente, aluno_id, colaborador_id,
    professor_indicador_id, observacoes, via_audit, parcelas,
    itens: itensRaw, produto_id, variacao_id, quantidade, preco_unitario,
    desconto, desconto_tipo,
  } = body;
  if (!unidade_id) return res.status(400).json({ ok: false, error: 'unidade_id obrigatório' });
  if (!forma_pagamento) return res.status(400).json({ ok: false, error: 'forma_pagamento obrigatória' });
  if (!FORMAS_PAGAMENTO.includes(forma_pagamento as FormaPagamento)) {
    return res.status(400).json({ ok: false, error: `forma_pagamento inválida. Use: ${FORMAS_PAGAMENTO.join(', ')}` });
  }
  const tipo_cliente_final: TipoCliente = TIPOS_CLIENTE.includes(tipo_cliente) ? tipo_cliente : 'avulso';
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }
  let itens: VendaItem[];
  if (Array.isArray(itensRaw) && itensRaw.length > 0) {
    itens = itensRaw;
  } else if (produto_id != null && preco_unitario != null) {
    itens = [{
      produto_id, variacao_id: variacao_id ?? null, quantidade: quantidade ?? 1,
      preco_unitario, desconto: desconto ?? 0, desconto_tipo: desconto_tipo ?? 'valor',
    }];
  } else {
    return res.status(400).json({ ok: false, error: 'Forneça "itens" (array) ou "produto_id" + "preco_unitario"' });
  }
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (!item.produto_id) return res.status(400).json({ ok: false, error: `itens[${i}].produto_id obrigatório` });
    if (item.preco_unitario == null) return res.status(400).json({ ok: false, error: `itens[${i}].preco_unitario obrigatório` });
    if (!item.quantidade || item.quantidade <= 0) return res.status(400).json({ ok: false, error: `itens[${i}].quantidade deve ser positivo` });
  }
  const { data, error } = await lareport.rpc('registrar_venda_v2', {
    p_unidade_id: unidade_id, p_itens: itens,
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

// ============================= TRANSFERENCIA =============================
export async function transferencia(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const { produto_id, unidade_origem, unidade_destino, quantidade, motivo, via_audit, variacao_id } = req.body || {};
  if (!produto_id) return res.status(400).json({ ok: false, error: 'produto_id obrigatório' });
  if (!unidade_origem) return res.status(400).json({ ok: false, error: 'unidade_origem obrigatório' });
  if (!unidade_destino) return res.status(400).json({ ok: false, error: 'unidade_destino obrigatório' });
  if (!quantidade || quantidade <= 0) return res.status(400).json({ ok: false, error: 'quantidade deve ser positivo' });
  if (!motivo) return res.status(400).json({ ok: false, error: 'motivo obrigatório' });
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_origem)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }
  const { data, error } = await lareport.rpc('transferir_estoque', {
    p_produto_id: produto_id, p_unidade_origem: unidade_origem,
    p_unidade_destino: unidade_destino, p_quantidade: quantidade,
    p_motivo: motivo, p_via_audit: via_audit ?? null,
    p_variacao_id: variacao_id ?? null,
  });
  if (error) {
    const status = ERROS_400_TRANSF.test(error.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: error.message });
  }
  const result = data as TransferenciaResult;
  return res.status(200).json({ ok: true, saldo_origem: result?.saldo_origem, saldo_destino: result?.saldo_destino });
}

// ============================= HISTORICO VENDAS =============================
export async function historicoVendas(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_vendas');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const unidadeId = req.query.unidade_id as string | undefined;
  if (!unidadeId) return res.status(400).json({ ok: false, error: 'unidade_id obrigatório' });
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidadeId)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }
  const diasRaw = parseInt((req.query.dias as string | undefined) ?? '30', 10);
  const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(diasRaw, 1), 90) : 30;
  const limitRaw = parseInt((req.query.limit as string | undefined) ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const statusRaw = (req.query.status as string | undefined) ?? 'ativa';
  const status: StatusFiltro = STATUS_VALIDOS.includes(statusRaw as StatusFiltro) ? (statusRaw as StatusFiltro) : 'ativa';
  const professorId = req.query.professor_id as string | undefined;
  const formaPagamento = req.query.forma_pagamento as string | undefined;
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  let query = lareport
    .from('loja_vendas')
    .select(`
      id, unidade_id, data_venda, tipo_cliente, aluno_id, colaborador_cliente_id,
      cliente_nome, professor_indicador_id, subtotal, desconto, desconto_tipo,
      total, forma_pagamento, parcelas, observacoes, status,
      estornada_em, estornada_por, motivo_estorno, vendedor_id, created_at,
      loja_venda_itens:loja_vendas_itens (
        id, produto_id, variacao_id, produto_nome, variacao_nome,
        quantidade, preco_unitario, subtotal
      ),
      loja_alunos:alunos!aluno_id ( nome ),
      loja_colaboradores:colaboradores!colaborador_cliente_id ( nome ),
      loja_professores:professores!professor_indicador_id ( nome )
    `)
    .eq('unidade_id', unidadeId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status !== 'todas') query = query.eq('status', status);
  if (professorId) {
    const pid = parseInt(professorId, 10);
    if (Number.isFinite(pid)) query = query.eq('professor_indicador_id', pid);
  }
  if (formaPagamento) query = query.eq('forma_pagamento', formaPagamento);
  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}

// ============================= BUSCAR PRODUTO =============================
export async function buscar(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const query = req.query.q as string | undefined;
  const unidadeId = req.query.unidade_id as string | undefined;
  if (!query || query.trim() === '') return res.status(400).json({ ok: false, error: 'query "q" obrigatória' });
  const unidadeFiltrada = access.unitFilter
    ? (Array.isArray(access.unitFilter) ? access.unitFilter[0] : access.unitFilter)
    : (unidadeId ?? null);
  const { data, error } = await lareport.rpc('buscar_produto_fuzzy', {
    p_query: query.trim(), p_unidade_id: unidadeFiltrada,
  });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}

// ============================= BUSCAR CLIENTE =============================
export async function buscarCliente(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const tipo = req.query.tipo as string | undefined;
  const q = req.query.q as string | undefined;
  const unidadeId = req.query.unidade_id as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  if (!tipo || !['aluno', 'colaborador'].includes(tipo)) {
    return res.status(400).json({ ok: false, error: 'tipo deve ser "aluno" ou "colaborador"' });
  }
  if (!q || q.trim() === '') return res.status(400).json({ ok: false, error: 'query "q" obrigatória' });
  if (tipo === 'aluno') {
    const unidadeFiltrada = access.unitFilter
      ? (Array.isArray(access.unitFilter) ? access.unitFilter[0] : access.unitFilter)
      : (unidadeId ?? null);
    let q2 = lareport
      .from('alunos')
      .select('id, nome, telefone, status, unidade_id')
      .eq('ativo', true)
      .ilike('nome', `%${q.trim()}%`)
      .order('nome')
      .limit(limit);
    if (unidadeFiltrada) q2 = q2.eq('unidade_id', unidadeFiltrada);
    const { data, error } = await q2;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, results: data });
  }
  const { data, error } = await lareport
    .from('colaboradores')
    .select('id, nome, telefone, cargo, unidade_id')
    .eq('ativo', true)
    .ilike('nome', `%${q.trim()}%`)
    .order('nome')
    .limit(limit);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, results: data });
}

// ============================= BUSCAR PROFESSOR =============================
export async function buscarProfessor(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const q = req.query.q as string | undefined;
  const unidadeId = req.query.unidade_id as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  if (!q || q.trim() === '') return res.status(400).json({ ok: false, error: 'query "q" obrigatória' });
  const unidadeFiltrada = access.unitFilter
    ? (Array.isArray(access.unitFilter) ? access.unitFilter[0] : access.unitFilter)
    : (unidadeId ?? null);
  let query = lareport
    .from('professores')
    .select('id, nome, telefone, unidade_id')
    .eq('ativo', true)
    .ilike('nome', `%${q.trim()}%`)
    .order('nome')
    .limit(limit);
  if (unidadeFiltrada) query = query.eq('unidade_id', unidadeFiltrada);
  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, results: data });
}
