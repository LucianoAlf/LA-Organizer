'use strict';
// pix-dm-numeracao.js — onde mora o "número -> cliente" da lista do PIX que o TOM mandou no 1:1
// (pix-dm.js). A pessoa responde "8 já cadastrado" e o 8 tem que virar o cliente CERTO da lista
// que ELA recebeu — não a lista de agora, que pode ter mudado.
//
// CASA PROVISÓRIA (07/10): enquanto o dono não decide a casa definitiva, a numeração vai numa linha
// de `marker_logs` (marker_type PIX_LISTA_DM, result 'skipped', JSON em raw_excerpt) — sem
// migration. É tipo META: está em _NON_DOMAIN_MARKERS do engine, não conta como ação de domínio.
// Quando houver coluna própria (ex.: na linha outbound de conversation_history), troca-se SÓ este
// arquivo: quem chama usa salvarNumeracao/carregarNumeracao e não sabe onde fica.

const MARCADOR_LISTA = 'PIX_LISTA_DM';

// itens: [{ n, chave, nome }] -> true | false (nunca lança)
async function salvarNumeracao({ supabase, collaboratorId, itens }) {
  try {
    const { error } = await supabase.from('marker_logs').insert({
      collaborator_id: collaboratorId, marker_type: MARCADOR_LISTA, result: 'skipped',
      reason: `lista:${(itens || []).length}`,
      raw_excerpt: JSON.stringify({ v: 1, itens: (itens || []).map((i) => [i.n, i.chave || null, i.nome]) }),
    });
    if (error) { console.error(`[PixDM] salvar numeração falhou: ${error.message}`); return false; }
    return true;
  } catch (e) {
    console.error(`[PixDM] salvar numeração lançou: ${(e && e.message) || String(e)}`);
    return false;
  }
}

// -> [{ n, chave, nome }] da lista mais recente desde `desdeIso`, ou null. LANÇA em erro de leitura.
async function carregarNumeracao({ supabase, collaboratorId, desdeIso }) {
  const { data, error } = await supabase.from('marker_logs').select('raw_excerpt, created_at')
    .eq('collaborator_id', collaboratorId).eq('marker_type', MARCADOR_LISTA)
    .gte('created_at', desdeIso).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`carregarNumeracao: ${error.message}`);
  if (!data) return null;
  const j = JSON.parse(data.raw_excerpt || '{}');
  return (j.itens || []).map(([n, chave, nome]) => ({ n, chave, nome }));
}

module.exports = { MARCADOR_LISTA, salvarNumeracao, carregarNumeracao };
