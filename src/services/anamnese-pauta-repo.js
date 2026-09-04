'use strict';
// Acesso à tabela anamnese_pauta. Fino de propósito: quem decide é o módulo puro; aqui só
// entra e sai do banco. TODA chamada checa `error` — consulta com coluna errada devolve
// { data:null, error } e viraria "zero linhas" em silêncio (custou dois diagnósticos errados
// em 03/09).

async function registrarAparicoes(sb, { unidadeId, dia, pessoas } = {}) {
  const lista = [...new Set((pessoas || []).filter(Boolean))];
  if (!lista.length) return { gravadas: 0, erro: null };
  const linhas = lista.map((pessoa_chave) => ({ unidade_id: unidadeId, pessoa_chave, dia }));
  // upsert: o cron bate o mesmo slot mais de uma vez; sem isto a 2ª passada estoura o UNIQUE.
  const { error } = await sb.from('anamnese_pauta')
    .upsert(linhas, { onConflict: 'unidade_id,pessoa_chave,dia', ignoreDuplicates: true });
  if (error) {
    console.error(`[Pauta] registrarAparicoes falhou unidade=${unidadeId} dia=${dia}: ${error.message}`);
    return { gravadas: 0, erro: error.message };
  }
  return { gravadas: linhas.length, erro: null };
}

async function gravarResultado(sb, { unidadeId, dia, pessoaChave, resultado } = {}) {
  const { error } = await sb.from('anamnese_pauta')
    .update({ resultado, updated_at: new Date().toISOString() })
    .eq('unidade_id', unidadeId).eq('pessoa_chave', pessoaChave).eq('dia', dia);
  if (error) {
    console.error(`[Pauta] gravarResultado falhou ${pessoaChave} ${dia}: ${error.message}`);
    return false;
  }
  return true;
}

// Devolve null (NÃO Map vazio) quando a leitura falha: Map vazio significa "ninguém falhou",
// e o chamador tomaria decisão de escada em cima de uma mentira.
async function contarFalhas(sb, { unidadeId, pessoas } = {}) {
  const lista = [...new Set((pessoas || []).filter(Boolean))];
  if (!lista.length) return new Map();
  const { data, error } = await sb.from('anamnese_pauta')
    .select('pessoa_chave, resultado')
    .eq('unidade_id', unidadeId).eq('resultado', 'nao_preencheu')
    .in('pessoa_chave', lista);
  if (error) {
    console.error(`[Pauta] contarFalhas falhou unidade=${unidadeId}: ${error.message}`);
    return null;
  }
  const m = new Map();
  (data || []).forEach((r) => m.set(r.pessoa_chave, (m.get(r.pessoa_chave) || 0) + 1));
  return m;
}

module.exports = { registrarAparicoes, gravarResultado, contarFalhas };
