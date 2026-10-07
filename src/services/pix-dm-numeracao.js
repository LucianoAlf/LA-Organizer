'use strict';
// pix-dm-numeracao.js — onde mora o "número -> cliente" da lista do PIX que o TOM mandou no 1:1
// (pix-dm.js). A pessoa responde "8 já cadastrado" e o 8 tem que virar o cliente CERTO da lista
// que ELA recebeu — não a lista de agora, que pode ter mudado.
//
// CASA: tabela public.pix_dm_numeracao (migrations/20261007_pix_dm_numeracao.sql — autorizada pelo
// dono e aplicada em produção em 07/10): uma linha por lista enviada, `itens` jsonb
// [{ n, chave, nome }]. RLS ligado sem policy: só o service role (o TOM) lê e escreve.
// Até 07/10 a numeração morava provisoriamente em marker_logs (PIX_LISTA_DM); quem chama nunca soube
// onde fica — só usa salvarNumeracao/carregarNumeracao.

const TABELA = 'pix_dm_numeracao';

// itens: [{ n, chave, nome }] -> true | false (nunca lança)
async function salvarNumeracao({ supabase, collaboratorId, itens }) {
  try {
    const { error } = await supabase.from(TABELA).insert({
      collaborator_id: collaboratorId,
      itens: (itens || []).map((i) => ({ n: i.n, chave: i.chave || null, nome: i.nome })),
    });
    if (error) { console.error(`[PixDM] salvar numeração falhou: ${error.message}`); return false; }
    return true;
  } catch (e) {
    console.error(`[PixDM] salvar numeração lançou: ${(e && e.message) || String(e)}`);
    return false;
  }
}

// -> [{ n, chave, nome }] da lista MAIS RECENTE da pessoa desde `desdeIso` (quem chama passa a
// janela de 24h), ou null. LANÇA em erro de leitura (quem chama segue sem adivinhar número).
async function carregarNumeracao({ supabase, collaboratorId, desdeIso }) {
  const { data, error } = await supabase.from(TABELA).select('itens, created_at')
    .eq('collaborator_id', collaboratorId).gte('created_at', desdeIso)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`carregarNumeracao: ${error.message}`);
  if (!data || !Array.isArray(data.itens)) return null;
  return data.itens.map((i) => ({ n: i.n, chave: i.chave || null, nome: i.nome }));
}

module.exports = { TABELA, salvarNumeracao, carregarNumeracao };
