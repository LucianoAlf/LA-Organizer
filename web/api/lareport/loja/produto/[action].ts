// Router catch-all /loja/produto/* — Sprint 23.8 consolidação Vercel Hobby.
// URLs preservadas: /loja/produto/desativar, /similar, /upsert.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  produtoDesativar,
  produtoSimilar,
  produtoUpsert,
} from '../../../_lib/handlers-loja-produto.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string | undefined;
  switch (action) {
    case 'desativar': return produtoDesativar(req, res);
    case 'similar':   return produtoSimilar(req, res);
    case 'upsert':    return produtoUpsert(req, res);
    default:
      return res.status(404).json({ ok: false, error: 'action_not_found', action });
  }
}
