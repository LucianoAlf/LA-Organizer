import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth.js';
import { checkAccess } from '../../_lib/access-control.js';
import { lareport } from '../../_lib/lareport-server.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
  if (!q || q.trim() === '') {
    return res.status(400).json({ ok: false, error: 'query "q" obrigatória' });
  }

  if (tipo === 'aluno') {
    // Gerente/farmer: força filtro de unidade própria
    const unidadeFiltrada = access.unitFilter
      ? (Array.isArray(access.unitFilter) ? access.unitFilter[0] : access.unitFilter)
      : (unidadeId ?? null);

    let query = lareport
      .from('alunos')
      .select('id, nome, telefone, status, unidade_id')
      .eq('ativo', true)
      .ilike('nome', `%${q.trim()}%`)
      .order('nome')
      .limit(limit);

    if (unidadeFiltrada) {
      query = query.eq('unidade_id', unidadeFiltrada);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, results: data });
  }

  // tipo === 'colaborador': sem filtro de unidade
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
