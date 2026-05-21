import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';

const STATUS_VALIDOS = ['ativa', 'estornada', 'todas'] as const;
type StatusFiltro = typeof STATUS_VALIDOS[number];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_vendas');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const unidadeId = req.query.unidade_id as string | undefined;
  if (!unidadeId) return res.status(400).json({ ok: false, error: 'unidade_id obrigatório' });

  // Gerente/farmer só pode ver a própria unidade.
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidadeId)) {
      return res.status(403).json({
        ok: false,
        error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.',
      });
    }
  }

  // dias: default 30, max 90.
  const diasRaw = parseInt((req.query.dias as string | undefined) ?? '30', 10);
  const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(diasRaw, 1), 90) : 30;

  // limit: default 50, max 200.
  const limitRaw = parseInt((req.query.limit as string | undefined) ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const statusRaw = (req.query.status as string | undefined) ?? 'ativa';
  const status: StatusFiltro = STATUS_VALIDOS.includes(statusRaw as StatusFiltro)
    ? (statusRaw as StatusFiltro)
    : 'ativa';

  const professorId = req.query.professor_id as string | undefined;
  const formaPagamento = req.query.forma_pagamento as string | undefined;

  // Cutoff de N dias atrás em ISO.
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  let query = lareport
    .from('loja_vendas')
    .select(`
      id, unidade_id, data_venda, tipo_cliente, aluno_id, colaborador_cliente_id,
      cliente_nome, professor_indicador_id, subtotal, desconto, desconto_tipo,
      total, forma_pagamento, parcelas, observacoes, status,
      estornada_em, estornada_por, motivo_estorno, vendedor_id, created_at,
      loja_venda_itens (
        id, produto_id, variacao_id, quantidade, preco_unitario, desconto,
        desconto_tipo, subtotal, total,
        loja_produtos ( nome, sku )
      ),
      loja_alunos:aluno_id ( nome ),
      loja_colaboradores:colaborador_cliente_id ( nome ),
      loja_professores:professor_indicador_id ( nome )
    `)
    .eq('unidade_id', unidadeId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status !== 'todas') {
    query = query.eq('status', status);
  }
  if (professorId) {
    const pid = parseInt(professorId, 10);
    if (Number.isFinite(pid)) query = query.eq('professor_indicador_id', pid);
  }
  if (formaPagamento) {
    query = query.eq('forma_pagamento', formaPagamento);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
