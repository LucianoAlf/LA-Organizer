import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';

// Spec original mencionava "expira_em" (timestamptz). O schema real usa "prazo" (DATE).
// Aceitamos ambos no body (expira_em é tratado como hint de data) e gravamos em "prazo".
// Default: hoje + 7 dias.
function defaultPrazoIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function normalizePrazo(input: unknown): string | null {
  if (!input || typeof input !== 'string') return null;
  // Aceita ISO completo ou apenas YYYY-MM-DD.
  const m = input.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_vendas');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const body = req.body || {};
  const {
    produto_id,
    variacao_id,
    unidade_id,
    quantidade,
    cliente_nome,
    aluno_id,
    observacoes,
    expira_em,
    prazo: prazoBody,
  } = body;

  if (!produto_id || !Number.isFinite(Number(produto_id))) {
    return res.status(400).json({ ok: false, error: 'produto_id obrigatorio' });
  }
  if (!unidade_id || typeof unidade_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'unidade_id obrigatorio' });
  }
  if (!quantidade || !Number.isFinite(Number(quantidade)) || Number(quantidade) <= 0) {
    return res.status(400).json({ ok: false, error: 'quantidade invalida (deve ser > 0)' });
  }
  if (!cliente_nome || typeof cliente_nome !== 'string' || !cliente_nome.trim()) {
    return res.status(400).json({ ok: false, error: 'cliente_nome obrigatorio' });
  }

  // Gerente/farmer só pode reservar na própria unidade.
  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(unidade_id)) {
      return res.status(403).json({
        ok: false,
        error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.',
      });
    }
  }

  const prazo = normalizePrazo(prazoBody) ?? normalizePrazo(expira_em) ?? defaultPrazoIso();
  const qtd = Number(quantidade);
  const prodId = Number(produto_id);
  const varId = variacao_id != null && Number.isFinite(Number(variacao_id)) ? Number(variacao_id) : null;

  // Valida estoque disponível (estoque - reservas ativas).
  const { data: disponivel, error: dispErr } = await lareport.rpc('estoque_disponivel', {
    p_produto_id: prodId,
    p_unidade_id: unidade_id,
    p_variacao_id: varId,
  });
  if (dispErr) return res.status(500).json({ ok: false, error: dispErr.message });

  const disponivelNum = Number(disponivel);
  if (!Number.isFinite(disponivelNum) || disponivelNum < qtd) {
    return res.status(400).json({
      ok: false,
      error: `estoque insuficiente — disponivel=${disponivelNum}, pedido=${qtd}`,
    });
  }

  const { data, error } = await lareport
    .from('loja_reservas')
    .insert({
      produto_id: prodId,
      variacao_id: varId,
      unidade_id,
      aluno_id: aluno_id != null && Number.isFinite(Number(aluno_id)) ? Number(aluno_id) : null,
      cliente_nome: cliente_nome.trim().slice(0, 200),
      quantidade: qtd,
      prazo,
      status: 'ativa',
      observacoes: observacoes ? String(observacoes) : null,
      created_via: 'pwa',
    })
    .select('id, prazo')
    .single();

  if (error) {
    const status = /insuficiente|inexistente|invalida|obrigatorio/i.test(error.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, reserva_id: data.id, prazo: data.prazo });
}
