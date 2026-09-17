'use strict';
// pix-migracao.js — pauta de migração para o PIX automático. PURO (sem I/O).
const FATIAS = ['autorizacao_pendente', 'pix_avulso', 'cheque', 'boleto', 'dinheiro',
  'cartao_com_falha', 'cartao_avulso', 'sem_historico'];
const ROTULO = {
  autorizacao_pendente: { emoji: '🔵', nome: 'Cadastrados sem cobrança' },
  pix_avulso: { emoji: '🔴', nome: 'Pix avulso' },
  cheque: { emoji: '🟠', nome: 'Cheque' },
  boleto: { emoji: '🟡', nome: 'Boleto' },
  dinheiro: { emoji: '🟡', nome: 'Dinheiro' },
  cartao_com_falha: { emoji: '🟣', nome: 'Cartão falhando' },
  cartao_avulso: { emoji: '🟣', nome: 'Maquininha' },
  sem_historico: { emoji: '⚪', nome: 'Sem histórico' },
};
const LOTE_DIARIO = 10;
const TETO_FILHAS = 15;
const META_YMD = '2026-10-31';

const fatiaDoCliente = (l) => {
  if (l.categoria === 'autorizacao_pendente') return 'autorizacao_pendente';
  return FATIAS.includes(l.fatia) ? l.fatia : 'sem_historico';
};
const ordenarPorPrioridade = (linhas) => [...(linhas || [])].sort((a, b) => {
  const d = FATIAS.indexOf(fatiaDoCliente(a)) - FATIAS.indexOf(fatiaDoCliente(b));
  return d !== 0 ? d : String(a.pagador_nome || '').localeCompare(String(b.pagador_nome || ''), 'pt-BR');
});
const loteDoDia = (linhas, { tamanho = LOTE_DIARIO } = {}) => ordenarPorPrioridade(linhas).slice(0, tamanho);
function contagemPorFatia(linhas) {
  const m = new Map();
  for (const l of linhas || []) { const f = fatiaDoCliente(l); m.set(f, (m.get(f) || 0) + 1); }
  return m;
}
const tituloDaFilha = (l) => `PIX automático — ${l.pagador_nome}${(l.alunos || []).length ? ` (${l.alunos.join(', ')})` : ''}`;

const METAS_BR = META_YMD.slice(8, 10) + '/' + META_YMD.slice(5, 7);
function mensagemDaUnidade({ unidadeNome, linhas, lote, fonteVelha = false }) {
  const cab = `💠 *PIX automático — ${unidadeNome}*`;
  if (fonteVelha) return `${cab}\n_A fonte do LA Report não atualizou hoje — não vou cobrar número que não medi._`;
  const todas = linhas || [];
  const noLote = new Set((lote || []).map((l) => l.pagador_chave));
  const cont = contagemPorFatia(todas);
  const linhasTxt = [`${cab} · faltam ${todas.length} · meta ${METAS_BR}`];
  const resumo = [];
  for (const f of FATIAS) {
    const n = cont.get(f) || 0;
    if (!n) continue;
    const doLote = ordenarPorPrioridade(todas.filter((l) => fatiaDoCliente(l) === f && noLote.has(l.pagador_chave)));
    if (!doLote.length) { resumo.push(`${ROTULO[f].emoji} ${ROTULO[f].nome} (${n})`); continue; }
    const extra = f === 'autorizacao_pendente' ? ' — resolver primeiro' : '';
    linhasTxt.push(`${ROTULO[f].emoji} *${ROTULO[f].nome}* (${n})${extra}\n`
      + doLote.map((l) => `   • ${l.pagador_nome}${(l.alunos || []).length ? ` (${l.alunos.join(', ')})` : ''}`).join('\n'));
  }
  if (resumo.length) linhasTxt.push(resumo.join(' · '));
  return linhasTxt.join('\n');
}

const barra = (pct) => { const c = Math.max(0, Math.min(10, Math.round(Number(pct) / 10))); return '▓'.repeat(c) + '░'.repeat(10 - c); };
function ritmoNecessario({ faltam, hojeYmd, metaYmd = META_YMD }) {
  const dias = Math.ceil((Date.parse(metaYmd + 'T00:00:00-03:00') - Date.parse(hojeYmd + 'T00:00:00-03:00')) / 86400000);
  const semanas = Math.max(0, Math.ceil(dias / 7));
  return { semanas, porSemana: semanas ? Math.ceil(faltam / semanas) : faltam };
}
function relatorioSemanal({ unidades, periodoBr, hojeYmd, alertaRitmo = false }) {
  const us = unidades || [];
  const total = us.reduce((s, u) => s + u.total, 0);
  const migrados = us.reduce((s, u) => s + u.migrados, 0);
  const pend = us.reduce((s, u) => s + (u.pendentesAutorizacao || 0), 0);
  const pct = total ? Math.round((migrados / total) * 100) : 0;
  const faltam = total - migrados;
  const r = ritmoNecessario({ faltam, hojeYmd });
  const linhas = [`💠 *PIX automático — semana de ${periodoBr}*`,
    `Geral  ${barra(pct)}  ${pct}%  (${migrados} de ${total}) · meta ${METAS_BR}`];
  for (const u of us) {
    const p2 = u.total ? Math.round((u.migrados / u.total) * 100) : 0;
    linhas.push(`${u.nome} ${barra(p2)} ${p2}% (${u.migrados}/${u.total}) — ${u.migradosNaSemana} nesta semana`);
  }
  if (pend) linhas.push(`🔵 Cadastrados sem cobrança: ${pend}`);
  linhas.push(`Ritmo: faltam ${r.semanas} semanas e ${faltam} clientes → ${r.porSemana} por semana.`);
  if (alertaRitmo) linhas.push('⚠️ Duas semanas seguidas abaixo do ritmo necessário.');
  return linhas.join('\n');
}

// ── QUANDO A PAUTA DO PIX FALA EM CADA UNIDADE (Tarefa 5 do plano de migração) ─────────────────
// Decisão PURA. Recebe os dados JÁ CALCULADOS pelo chamador (`loteUnico`, `horaAbertura`) e nunca
// importa services/anamnese-pauta.js — esse acoplamento é do dispatcher (que já lê os dois
// módulos pra costurar a fala da manhã), não desta função. `unidadeNome` e `diaSemana` chegam
// pela mesma razão que em horaDeAberturaDaUnidade: são o contexto da decisão, ainda que o corpo
// de hoje só precise do segundo pra barrar domingo — deixa a assinatura pronta pro dia em que a
// regra precisar olhar o nome (ex.: uma quarta unidade com cadência própria) sem quebrar quem já
// chama esta função.
//
// Unidade com lembrete ÚNICO no dia (Barra, Campo Grande — anamnese-pauta.js,
// LEMBRETE_UNICO_POR_UNIDADE) publica NESSE horário, sempre — nunca no de abertura dela: são
// unidades que já pediram uma cadência de "uma vez por dia", e a pauta do PIX segue a mesma.
// Unidade sem lembrete único (Recreio) publica no horário de abertura, que é quando a equipe
// chega e pode agir na lista.
//
// Domingo (`diaSemana === 0`) nunca publica, mesmo pra quem tem `loteUnico` fixo — a escola não
// abre nas três unidades nesse dia (mesma fonte conferida em anamnese-pauta.js). É por isso que a
// checagem de domingo vem PRIMEIRO e é incondicional: um `loteUnico` não pode furar essa regra.
// Unidade sem horário de abertura conhecido (`horaAbertura` nulo) também não publica — não dá pra
// inventar quando a equipe chega.
function horaDaPautaPix(unidadeNome, diaSemana, { loteUnico, horaAbertura } = {}) {
  if (!Number.isInteger(diaSemana) || diaSemana === 0) return null;
  return loteUnico || horaAbertura || null;
}

// ── O QUE PUBLICAR NO GRUPO, A PARTIR DO RETORNO DO RITUAL (fix round 1 — Critical) ────────────
// `pautaPixDaUnidade` devolve `texto: null` em QUATRO situações bem diferentes: a RPC do LA
// Report falhou (`fonteFalhou`), não há cliente a migrar hoje (`semCliente` — sucesso, fila
// vazia), o painel de tarefas falhou ao CRIAR o pacote (`criarPacote` lançou), ou falhou ao LER o
// painel (`containersPix` lançou, catch externo do ritual). Só a PRIMEIRA é "a fonte está fora do
// ar" — as outras três são o painel (nosso lado), não a fonte.
//
// O DEFEITO QUE ISTO CORRIGE: antes desta função, o dispatcher tratava QUALQUER `texto === null`
// como "fonte fora do ar" e publicava "a fonte não atualizou hoje" no grupo REAL. Isso é uma
// afirmação FALSA toda vez que a fila de uma unidade esvazia (destino do plano, não raro — vai
// acontecer todo dia que a unidade zerar a migração) ou que o painel tem um bug de escrita/
// leitura — e nos dois casos o aviso errado ESCONDE o problema real (fila vazia vira "a fonte não
// respondeu"; um bug de escrita no painel também vira "a fonte não respondeu").
//
// Decisão PURA, testável sem tocar o ritual nem o dispatcher: dado o retorno de
// `pautaPixDaUnidade` — LENDO SÓ OS FLAGS ESTRUTURADOS (`fonteFalhou`, `fonteVelha`,
// `semCliente`), nunca inspecionando o texto de `motivo` — decide O QUE publicar (ou nada) e QUAL
// resultado gravar no marcador de idempotência.
//   fonteFalhou    -> publica o aviso de fonte velha (mesma regra: não cobrar número que não foi
//                      medido) · result 'fallback' (tenta de novo no próximo tick)
//   fonteVelha     -> publica o texto que o ritual já preparou (mesmo aviso, já pronto em r.texto)
//                      · result 'fallback'
//   semCliente     -> não publica nada — fila vazia é notícia boa, não aviso · result 'skipped'
//   texto nulo,    -> falha de leitura/escrita do painel: não publica nada (não há o que mostrar,
//   nenhum dos        e inventar um texto seria mentir) · result 'fallback' (tenta de novo)
//   anteriores
//   caso contrário -> publica r.texto tal como veio · result 'executed'
function decisaoDaPublicacaoPix(r, { unidadeNome }) {
  if (r.fonteFalhou) {
    return { texto: mensagemDaUnidade({ unidadeNome, linhas: [], lote: [], fonteVelha: true }), result: 'fallback' };
  }
  if (r.fonteVelha) {
    return { texto: r.texto, result: 'fallback' };
  }
  if (r.semCliente) {
    return { texto: null, result: 'skipped' };
  }
  if (r.texto === null) {
    return { texto: null, result: 'fallback' };
  }
  return { texto: r.texto, result: 'executed' };
}

module.exports = {
  FATIAS, ROTULO, LOTE_DIARIO, TETO_FILHAS, META_YMD,
  fatiaDoCliente, ordenarPorPrioridade, loteDoDia, contagemPorFatia, tituloDaFilha,
  mensagemDaUnidade, barra, ritmoNecessario, relatorioSemanal,
  horaDaPautaPix, decisaoDaPublicacaoPix,
};
