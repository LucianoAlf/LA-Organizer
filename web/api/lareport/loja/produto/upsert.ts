import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../../_lib/auth.js';
import { checkAccess } from '../../../_lib/access-control.js';
import { lareport } from '../../../_lib/lareport-server.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'loja_produtos');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const body = req.body || {};

  const {
    id,
    nome,
    categoria_id,
    sku: skuRaw,
    preco,
    custo,
    estoque_minimo,
    comissao_especial,
    foto_url,
    descricao,
    disponivel_whatsapp,
    ativo,
  } = body;

  // Validação campos obrigatórios
  if (!nome) return res.status(400).json({ ok: false, error: 'nome obrigatório' });
  if (!categoria_id) return res.status(400).json({ ok: false, error: 'categoria_id obrigatório' });
  if (preco == null) return res.status(400).json({ ok: false, error: 'preco obrigatório' });

  const isInsert = !id;

  // Auto-gerar SKU se INSERT e sku não fornecido
  const sku = skuRaw || (isInsert ? `PROD-${Date.now()}` : undefined);

  const payload: Record<string, unknown> = {
    nome,
    categoria_id,
    preco,
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
    // INSERT
    const { data, error } = await lareport
      .from('loja_produtos')
      .insert(payload)
      .select('id')
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, produto_id: (data as { id: number }).id });
  } else {
    // UPDATE
    const { error } = await lareport
      .from('loja_produtos')
      .update(payload)
      .eq('id', id);

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, produto_id: id });
  }
}
