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
// I2 (revisão final): a RPC do LA Report põe em `autorizacao_pendente` todo cliente com PIX
// automático CADASTRADO que ainda não teve a 1ª cobrança com tarifa — e a 1ª cobrança leva até um
// ciclo (~30 dias). Quem passou de `migrar` pra `autorizacao_pendente` foi cadastrado pela equipe:
// é PROGRESSO. Durante esta carência o cliente sai do lote e da seção 🔵 (fica só contado em ⏳);
// passados 35 dias sem cobrança, volta a ser 🔵 "Cadastrados sem cobrança" normal.
const CARENCIA_PRIMEIRA_COBRANCA_DIAS = 35;
// R1 (re-revisão): a transição também é procurada nos vínculos `migrar` ainda sem transicao_em de
// QUALQUER filha (inclusive a que o atalho já baixou) criados nesta janela.
const JANELA_VINCULO_SEM_TRANSICAO_DIAS = 60;

const fatiaDoCliente = (l) => {
  if (l.categoria === 'autorizacao_pendente') return 'autorizacao_pendente';
  return FATIAS.includes(l.fatia) ? l.fatia : 'sem_historico';
};
// ── BLOQUEIO DO EMUSYS: 2+ MATRÍCULAS (Alf, 19/09) ──────────────────────────────────────────────
// Família OU aluno com 2+ cursos tem faturas separadas, e o Emusys só liga o PIX automático a UMA
// delas — o Alf confirmou e já pediu ao Mateus (Emusys) pra resolver. Medido em 19/09: 82 dos 357
// clientes da pauta (23%) têm 2+ matrículas. Mandar a equipe atrás deles primeiro é gastar o lote
// diário em quem não consegue concluir, e era o que a própria equipe de Campo Grande já evitava.
// Por isso: bloqueado vai pro FIM da fila e leva 🔒. NINGUÉM SOME — continua contado no "faltam",
// continua nas listas, e a mensagem diz quantos são. Só vale pra quem ainda precisa de cadastro
// NOVO (`migrar`): 🔵 já cadastrado e quem já migrou não dependem desta barreira. Dado torto
// (sem `matriculas`, não-lista) nunca bloqueia: na dúvida, cobra.
// Interruptor TOM_PIX_BLOQUEIO_EMUSYS=off desliga tudo (quando o Emusys liberar), sem deploy.
const bloqueioEmusysAtivo = () => String(process.env.TOM_PIX_BLOQUEIO_EMUSYS || '').trim().toLowerCase() !== 'off';
const bloqueadoNoEmusys = (l) => !!l && bloqueioEmusysAtivo() && l.categoria === 'migrar'
  && Array.isArray(l.matriculas) && l.matriculas.length > 1;
const MARCA_BLOQUEIO = '🔒';
const LEGENDA_BLOQUEIO = '🔒 = aguardando o Emusys liberar (2+ cursos ou família: ele só liga o PIX automático a uma fatura) — vão pro fim da fila';
const nomeComMarca = (l) => `${l.pagador_nome}${bloqueadoNoEmusys(l) ? ` ${MARCA_BLOQUEIO}` : ''}`;
const ordenarPorPrioridade = (linhas) => [...(linhas || [])].sort((a, b) => {
  const bloq = Number(bloqueadoNoEmusys(a)) - Number(bloqueadoNoEmusys(b)); // livre antes de bloqueado
  if (bloq !== 0) return bloq;
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
// `aguardandoCobranca` (I2): quantos clientes estão na carência da 1ª cobrança. Eles NÃO vêm em
// `linhas` (saem da seção 🔵 e do lote), mas continuam no "faltam" — ainda não migraram de fato —
// e ganham a linha própria "⏳ Aguardando 1ª cobrança (N)" no fim do resumo. 0 (padrão) mantém o
// texto idêntico.
function mensagemDaUnidade({
  unidadeNome, linhas, lote, fonteVelha = false, voltaram = [], aguardandoCobranca = 0,
}) {
  const cab = `💠 *PIX automático — ${unidadeNome}*`;
  if (fonteVelha) return `${cab}\n_A fonte do LA Report não atualizou hoje — não vou cobrar número que não medi._`;
  const todas = linhas || [];
  const aguardando = Math.max(0, Number(aguardandoCobranca) || 0);
  // C1 (revisão final): quem está em `voltaram` é citado UMA vez só — na seção ↩️. Sai do conjunto
  // "listável" das fatias (continua CONTADO no número da fatia, só não repete o nome).
  const chavesVoltaram = new Set((voltaram || []).map((l) => l.pagador_chave));
  const noLote = new Set((lote || []).map((l) => l.pagador_chave).filter((k) => !chavesVoltaram.has(k)));
  const cont = contagemPorFatia(todas);
  const linhasTxt = [`${cab} · faltam ${todas.length + aguardando} · meta ${METAS_BR}`];
  const presos = todas.filter(bloqueadoNoEmusys).length;
  // TAREFA 7 — reconferência de 7 dias: quem a equipe disse ter cadastrado, mas a fonte ainda
  // mostra como `migrar` depois do prazo de graça, ganha uma seção própria logo após o
  // cabeçalho — separada da lista normal pra não se confundir com "gente nova na fila".
  // `voltaram` vazio (padrão) mantém a mensagem IDÊNTICA à de antes desta tarefa.
  if ((voltaram || []).length) {
    linhasTxt.push(`↩️ *Voltaram pra lista* (${voltaram.length}) — disseram que cadastrou, mas o Emusys ainda não mostra:\n`
      + voltaram.map((l) => `   • ${l.pagador_nome}${(l.alunos || []).length ? ` (${l.alunos.join(', ')})` : ''}`).join('\n'));
  }
  const resumo = [];
  for (const f of FATIAS) {
    const n = cont.get(f) || 0;
    if (!n) continue;
    const doLote = ordenarPorPrioridade(todas.filter((l) => fatiaDoCliente(l) === f && noLote.has(l.pagador_chave)));
    if (!doLote.length) { resumo.push(`${ROTULO[f].emoji} ${ROTULO[f].nome} (${n})`); continue; }
    const extra = f === 'autorizacao_pendente' ? ' — resolver primeiro' : '';
    linhasTxt.push(`${ROTULO[f].emoji} *${ROTULO[f].nome}* (${n})${extra}\n`
      + doLote.map((l) => `   • ${nomeComMarca(l)}${(l.alunos || []).length ? ` (${l.alunos.join(', ')})` : ''}`).join('\n'));
  }
  if (resumo.length) linhasTxt.push(resumo.join(' · '));
  if (aguardando) linhasTxt.push(`⏳ Aguardando 1ª cobrança (${aguardando})`);
  if (presos) linhasTxt.push(`🔒 Aguardando o Emusys (${presos}) — 2+ cursos ou família: ele só liga o PIX automático a uma fatura. Vão pro fim da fila.`);
  // M6 (revisão final): no grupo o TOM só lê mensagem em que é marcado — quem vê a lista precisa
  // saber COMO avisar. Só quando a mensagem lista algum nome do lote (sem lote, não há o que avisar).
  const chavesListaveis = new Set(todas.map((l) => l.pagador_chave));
  if ((lote || []).some((l) => chavesListaveis.has(l.pagador_chave))) {
    // 17/09: além de ensinar a AVISAR, o rodapé ensina a PEDIR. Campo Grande pediu a lista
    // completa do PIX avulso e o TOM respondeu que só tinha o lote do dia — a equipe não sabia
    // que bastava pedir, e o TOM não sabia que podia responder (src/services/pix-consulta.js).
    linhasTxt.push('_Cadastrou alguém? Me marca e escreve: cadastrei <nome> no automático. Quer a lista completa? Me marca e peça: lista completa do pix avulso._');
  }
  return linhasTxt.join('\n');
}

const barra = (pct) => { const c = Math.max(0, Math.min(10, Math.round(Number(pct) / 10))); return '▓'.repeat(c) + '░'.repeat(10 - c); };
function ritmoNecessario({ faltam, hojeYmd, metaYmd = META_YMD }) {
  const dias = Math.ceil((Date.parse(metaYmd + 'T00:00:00-03:00') - Date.parse(hojeYmd + 'T00:00:00-03:00')) / 86400000);
  const semanas = Math.max(0, Math.ceil(dias / 7));
  return { semanas, porSemana: semanas ? Math.ceil(faltam / semanas) : faltam };
}
// Ritmo que a EQUIPE controla: o "faltam" sem quem depende do Emusys liberar (bloqueados). É este
// número que o alerta de ritmo e o marcador da semana comparam — um cliente que o Emusys não deixa
// migrar não pode acender "duas semanas abaixo do ritmo" contra quem não tem como fazer nada.
function ritmoDaEquipe({ unidades, hojeYmd }) {
  const us = unidades || [];
  const faltam = us.reduce((s, u) => s + (u.total - u.migrados), 0);
  const presos = us.reduce((s, u) => s + (u.aguardandoEmusys || 0), 0);
  return ritmoNecessario({ faltam: Math.max(0, faltam - presos), hojeYmd });
}
function relatorioSemanal({ unidades, periodoBr, hojeYmd, alertaRitmo = false }) {
  const us = unidades || [];
  const total = us.reduce((s, u) => s + u.total, 0);
  const migrados = us.reduce((s, u) => s + u.migrados, 0);
  const pend = us.reduce((s, u) => s + (u.pendentesAutorizacao || 0), 0);
  const presos = us.reduce((s, u) => s + (u.aguardandoEmusys || 0), 0);
  const pct = total ? Math.round((migrados / total) * 100) : 0;
  const faltam = total - migrados;
  const r = ritmoNecessario({ faltam, hojeYmd });
  const linhas = [`💠 *PIX automático — semana de ${periodoBr}*`,
    `Geral  ${barra(pct)}  ${pct}%  (${migrados} de ${total}) · meta ${METAS_BR}`];
  for (const u of us) {
    const p2 = u.total ? Math.round((u.migrados / u.total) * 100) : 0;
    linhas.push(`${u.nome} ${barra(p2)} ${p2}% (${u.migrados}/${u.total}) — ${u.migradosNaSemana} nesta semana${u.aguardandoEmusys ? ` · ${MARCA_BLOQUEIO} ${u.aguardandoEmusys}` : ''}`);
  }
  if (pend) linhas.push(`🔵 Cadastrados sem cobrança: ${pend}`);
  // 19/09 (Alf): sem esta linha a meta de 31/10 parece atraso do time. Os bloqueados continuam
  // DENTRO de "faltam" e do percentual (a conta não muda) — só ficam nomeados, com o motivo.
  if (presos) linhas.push(`${MARCA_BLOQUEIO} Aguardando o Emusys: ${presos} (2+ cursos ou família — ele só liga o PIX automático a uma fatura)`);
  // M4 (revisão final): meta passou (0 semanas) — "faltam 0 semanas e N clientes → N por semana"
  // não diz nada; o que importa é que a meta venceu e quantos ainda faltam.
  if (r.semanas === 0) linhas.push(`Meta de ${METAS_BR} vencida — faltam ${faltam} clientes.`);
  else {
    linhas.push(`Ritmo: faltam ${r.semanas} semanas e ${faltam} clientes → ${r.porSemana} por semana.`);
    // O que a equipe consegue fazer de fato: sem quem depende do Emusys liberar.
    if (presos) {
      const livres = Math.max(0, faltam - presos);
      linhas.push(`Sem os ${MARCA_BLOQUEIO}: faltam ${livres} clientes → ${ritmoNecessario({ faltam: livres, hojeYmd }).porSemana} por semana.`);
    }
  }
  if (alertaRitmo) linhas.push('⚠️ Duas semanas seguidas abaixo do ritmo necessário.');
  return linhas.join('\n');
}

// ── DATA (YYYY-MM-DD) EM ARITMÉTICA UTC (Tarefa 6) ──────────────────────────────────────────────
// Nunca `new Date(ymd).getDay()` nem hora local: um Date.UTC(y, m-1, d) é sempre meia-noite UTC
// daquele dia civil, e não escorrega pro dia anterior/seguinte por causa do fuso do processo que
// roda o teste ou o dispatcher. Privadas — só servem às funções desta seção.
function _parseYmdUTC(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function _somaDiasYmd(ymd, dias) {
  const dt = new Date(_parseYmdUTC(ymd) + dias * 86400000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── RELATÓRIO SEMANAL — DADOS POR UNIDADE (Tarefa 6 do plano de migração) ───────────────────────
// Lê o retorno CRU da RPC get_pix_migracao_v1 (chamada SEM p_fatia — todas as categorias, não só
// quem falta migrar) e agrega para UMA unidade. `total` conta só as três categorias do progresso
// (migrados + a migrar + autorização pendente) — outra categoria que a fonte um dia devolver fica
// de fora de propósito: este relatório é sobre o progresso da migração, não um censo de toda
// linha que a fonte manda.
function dadosDaUnidadeParaRelatorio(linhas, { nome, hojeYmd }) {
  const desde = _somaDiasYmd(hojeYmd, -7);
  const ate = _somaDiasYmd(hojeYmd, -1);
  let migrados = 0;
  let migradosNaSemana = 0;
  let pendentesAutorizacao = 0;
  let aMigrar = 0;
  let aguardandoEmusys = 0;
  for (const l of linhas || []) {
    if (!l) continue;
    if (l.categoria === 'ja_migrou') {
      migrados += 1;
      if (l.migrou_em && l.migrou_em >= desde && l.migrou_em <= ate) migradosNaSemana += 1;
    } else if (l.categoria === 'autorizacao_pendente') {
      pendentesAutorizacao += 1;
    } else if (l.categoria === 'migrar') {
      aMigrar += 1;
      // Mesma regra da pauta diária (bloqueadoNoEmusys): continua DENTRO do total — só é nomeado.
      if (bloqueadoNoEmusys(l)) aguardandoEmusys += 1;
    }
  }
  return {
    nome, total: migrados + aMigrar + pendentesAutorizacao, migrados, migradosNaSemana, pendentesAutorizacao, aguardandoEmusys,
  };
}

// ── PERÍODO (BR) DA SEMANA ANTERIOR (Tarefa 6) ───────────────────────────────────────────────────
// hoje-7 até hoje-1 — a MESMA janela de dadosDaUnidadeParaRelatorio, só que formatada pro
// cabeçalho do relatório ("semana de 12 a 18/10"). Mesmo mês → só um "/mês" no fim; meses
// diferentes → cada ponta leva o próprio "/mês" (virada de ano também funciona: Date.UTC rola o
// ano sozinho, a formatação só olha mês e dia de cada ponta).
function periodoDaSemanaBr(hojeYmd) {
  const desde = _somaDiasYmd(hojeYmd, -7);
  const ate = _somaDiasYmd(hojeYmd, -1);
  const [, mDesde, dDesde] = desde.split('-');
  const [, mAte, dAte] = ate.split('-');
  return mDesde === mAte ? `${dDesde} a ${dAte}/${mAte}` : `${dDesde}/${mDesde} a ${dAte}/${mAte}`;
}

// ── ALERTA DE RITMO (Tarefa 6) ───────────────────────────────────────────────────────────────────
// Só acende com DUAS semanas seguidas abaixo do ritmo necessário — uma semana fraca sozinha é
// ruído (a fonte atualiza em lote; uma família que atrasa um dia pode zerar uma semana isolada
// sem que o ritmo real tenha mudado). Sem o dado da semana anterior (relatório de estreia, ou
// marcador anterior ilegível) o alerta fica DESLIGADO — nunca acende por falta de histórico.
function precisaAlertaRitmo({
  semanaAtual, ritmoAtual, semanaAnterior, ritmoAnterior,
}) {
  if (semanaAnterior === null || semanaAnterior === undefined
    || ritmoAnterior === null || ritmoAnterior === undefined) {
    return false;
  }
  return semanaAtual < ritmoAtual && semanaAnterior < ritmoAnterior;
}

// ── MOTIVO DO MARCADOR — IDA E VOLTA (Tarefa 6) ──────────────────────────────────────────────────
// O marcador PAUTA_PIX do relatório grava semana+ritmo no PRÓPRIO reason (não há outro lugar pra
// guardar isso entre segundas), e o próximo relatório lê de volta pra saber se a semana ANTERIOR
// ficou abaixo do ritmo. lerSemanaDoMotivo tem que ser o inverso exato de motivoDoRelatorio — sem
// isso o alerta de duas-semanas-seguidas nunca teria uma "semana anterior" pra comparar.
function motivoDoRelatorio({ ymd, migradosNaSemana, porSemana }) {
  return `pix_relatorio:${ymd} semana=${migradosNaSemana} ritmo=${porSemana}`;
}
function lerSemanaDoMotivo(reason) {
  const m = /semana=(-?\d+)\s+ritmo=(-?\d+)/.exec(String(reason || ''));
  return m ? { semana: Number(m[1]), ritmo: Number(m[2]) } : null;
}

// ── QUANDO A PAUTA DO PIX FALA EM CADA UNIDADE (Tarefa 5 do plano de migração) ─────────────────
// Decisão PURA. Recebe os dados JÁ CALCULADOS pelo chamador (`loteUnico`, `horaAbertura`) e nunca
// importa services/anamnese-pauta.js — esse acoplamento é do dispatcher (que já lê os dois
// módulos pra costurar a fala da manhã), não desta função. O corpo NÃO usa `unidadeNome`: ele só
// faz parte da assinatura (o chamador já resolveu o lembrete e a abertura daquela unidade).
// `diaSemana` só é usado pra barrar domingo (e valor que não seja inteiro).
//
// Ordem exata do código:
//   1. `diaSemana` não inteiro, ou domingo (0) -> null. Vem PRIMEIRO e é incondicional: nem um
//      `loteUnico` fixo fura o domingo (a escola não abre nas três unidades nesse dia).
//   2. Tem `loteUnico` (lembrete ÚNICO no dia — Barra, Campo Grande, anamnese-pauta.js
//      LEMBRETE_UNICO_POR_UNIDADE) -> publica NESSE horário, qualquer que seja a abertura (mesmo
//      nula): são unidades que já pediram uma cadência de "uma vez por dia".
//   3. Senão, `horaAbertura` (Recreio) -> publica na abertura, quando a equipe chega.
//   4. Sem `loteUnico` E sem `horaAbertura` -> null (não dá pra inventar quando a equipe chega).
function horaDaPautaPix(unidadeNome, diaSemana, { loteUnico, horaAbertura } = {}) {
  if (!Number.isInteger(diaSemana) || diaSemana === 0) return null;
  return loteUnico || horaAbertura || null;
}

// ── CHAVE DA GUARDA DE DUPLICATA DO DISPATCHER (M1, revisão final) ─────────────────────────────
// O dispatcher bloqueia reenvio procurando, desde o início do dia, mensagem do TOM no grupo cujo
// conteúdo COMEÇA com esta chave (`like('content', chave%)`). A primeira linha crua não serve: ela
// carrega "faltam N", e a mesma pauta com outro número (fonte atualizou entre dois ticks, ou
// retry depois de marcador que falhou) passava pela guarda e saía DE NOVO.
//   mensagem normal     -> prefixo fixo "💠 *PIX automático — <Unidade>* · faltam" (sem o número):
//                          a normal nunca sai duas vezes no dia.
//   aviso de fonte velha -> a primeira linha inteira ("💠 *PIX automático — <Unidade>*"): o aviso
//                          não repete, e a mensagem normal de recuperação (que não começa com
//                          "...*\n_A fonte") ainda sai depois dele.
const SUFIXO_GUARDA_NORMAL = ' · faltam';
function prefixoDaGuardaPix(texto) {
  const primeira = String(texto == null ? '' : texto).split('\n')[0];
  const i = primeira.indexOf(SUFIXO_GUARDA_NORMAL);
  return i === -1 ? primeira : primeira.slice(0, i + SUFIXO_GUARDA_NORMAL.length);
}

// ── O QUE PUBLICAR NO GRUPO, A PARTIR DO RETORNO DO RITUAL (fix round 1 — Critical) ────────────
// `pautaPixDaUnidade` devolve `texto: null` em várias situações bem diferentes:
//   - a RPC do LA Report falhou (`fonteFalhou`) — a ÚNICA que é "a fonte está fora do ar";
//   - não há cliente nenhum a migrar (`semCliente` — sucesso, fila vazia);
//   - o painel de tarefas falhou: ao LER (`containersPix` lançou), ao CRIAR o pacote (`criarPacote`
//     lançou), ao gravar o vínculo das filhas novas (ou vieram filhas a menos), ao desmontar um
//     pacote de hoje incompleto (sem filha ou com filha sem vínculo), ou o lote passou do teto
//     (`TETO_FILHAS`, trava dura). Todas são o nosso lado, não a fonte.
// Lote vazio COM texto (todos na carência da 1ª cobrança ou informados há menos de 7 dias) não
// é falha: chega aqui como texto normal e é publicado.
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
//   texto nulo,    -> falha do painel (leitura, escrita, vínculo, desmontagem ou teto): não publica
//   nenhum dos        nada (não há o que mostrar, e inventar um texto seria mentir) · result
//   anteriores        'fallback' (tenta de novo)
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
  FATIAS, ROTULO, LOTE_DIARIO, TETO_FILHAS, META_YMD, CARENCIA_PRIMEIRA_COBRANCA_DIAS, JANELA_VINCULO_SEM_TRANSICAO_DIAS,
  somaDiasYmd: _somaDiasYmd,
  fatiaDoCliente, ordenarPorPrioridade, loteDoDia, contagemPorFatia, tituloDaFilha,
  bloqueadoNoEmusys, nomeComMarca, MARCA_BLOQUEIO, LEGENDA_BLOQUEIO, ritmoDaEquipe,
  mensagemDaUnidade, barra, ritmoNecessario, relatorioSemanal,
  horaDaPautaPix, decisaoDaPublicacaoPix, prefixoDaGuardaPix,
  dadosDaUnidadeParaRelatorio, periodoDaSemanaBr, precisaAlertaRitmo,
  motivoDoRelatorio, lerSemanaDoMotivo,
};
