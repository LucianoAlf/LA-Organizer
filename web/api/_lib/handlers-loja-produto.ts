// Handlers consolidados de /loja/produto/* — invocados pelo router
// loja/produto/[action].ts. Sprint 23.8: consolidacão pra caber no
// limite Vercel Hobby (12 functions). Comportamento idêntico aos
// arquivos originais desativar.ts / similar.ts / upsert.ts.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from './auth.js';
import { checkAccess } from './access-control.js';
import { lareport } from './lareport-server.js';

interface ProdutoFuzzy {
  id: number;
  nome: string;
  sku: string | null;
  preco: number;
  estoque: number;
  score: number;
}

export async function produtoDesativar(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id obrigatório' });
  const { error } = await lareport
    .from('loja_produtos')
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true });
}

export async function produtoSimilar(req: VercelRequest, res: VercelResponse) {
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

export async function produtoUpsert(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });
  const body = req.body || {};
  const {
    id, nome, categoria_id, sku: skuRaw, preco, custo, estoque_minimo,
    comissao_especial, foto_url, descricao, disponivel_whatsapp, ativo,
  } = body;
  if (!nome) return res.status(400).json({ ok: false, error: 'nome obrigatório' });
  if (!categoria_id) return res.status(400).json({ ok: false, error: 'categoria_id obrigatório' });
  if (preco == null) return res.status(400).json({ ok: false, error: 'preco obrigatório' });
  const isInsert = !id;
  const sku = skuRaw || (isInsert ? `PROD-${Date.now()}` : undefined);
  const payload: Record<string, unknown> = {
    nome, categoria_id, preco,
    custo: custo ?? null,
    estoque_minimo: estoque_minimo ?? 5,
    comissao_especial: comissao_especial ?? null,
    foto_url: foto_url ?? null,
    descricao: descricao ?? null,
    disponivel_whatsapp: disponivel_whatsapp ?? false,
    ativo: ativo ?? true,
    updated_at: new Date().toISOString(),
  };
  if (sku !== undefined) payload.sku = sku;
  if (isInsert) {
    const { data, error } = await lareport
      .from('loja_produtos')
      .insert(payload)
      .select('id')
      .single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, produto_id: (data as { id: number }).id });
  } else {
    const { error } = await lareport
      .from('loja_produtos')
      .update(payload)
      .eq('id', id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, produto_id: id });
  }
}
