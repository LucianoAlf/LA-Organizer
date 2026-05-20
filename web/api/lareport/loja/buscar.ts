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

  const query = req.query.q as string | undefined;
  const unidadeId = req.query.unidade_id as string | undefined;

  if (!query || query.trim() === '') return res.status(400).json({ ok: false, error: 'query "q" obrigatória' });

  // Gerente/farmer vê só a própria unidade; director/coord pode filtrar ou ver tudo
  const unidadeFiltrada = access.unitFilter
    ? (Array.isArray(access.unitFilter) ? access.unitFilter[0] : access.unitFilter)
    : (unidadeId ?? null);

  const { data, error } = await lareport.rpc('buscar_produto_fuzzy', {
    p_query: query.trim(),
    p_unidade_id: unidadeFiltrada,
  });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
