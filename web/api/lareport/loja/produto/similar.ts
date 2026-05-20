import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../../_lib/auth.js';
import { checkAccess } from '../../../_lib/access-control.js';
import { lareport } from '../../../_lib/lareport-server.js';

interface ProdutoFuzzy {
  id: number;
  nome: string;
  sku: string | null;
  preco: number;
  estoque: number;
  score: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const nome = req.query.nome as string | undefined;
  const limitRaw = req.query.limit as string | undefined;
  const limit = Math.min(parseInt(limitRaw || '5', 10) || 5, 20);

  if (!nome) return res.status(400).json({ ok: false, error: 'query param "nome" obrigatório' });

  const { data, error } = await lareport.rpc('buscar_produto_fuzzy', {
    p_termo: nome,
    p_unidade_id: null,
  });

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const results = ((data as ProdutoFuzzy[]) || [])
    .filter((p) => p.score > 0.7)
    .slice(0, limit)
    .map(({ id, nome: n, sku, preco, score }) => ({ id, nome: n, sku, preco, score }));

  return res.status(200).json({ ok: true, results });
}
