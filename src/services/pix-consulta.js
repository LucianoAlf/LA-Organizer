'use strict';
// pix-consulta.js — camada PURA (sem I/O) da consulta de lista e de número nos grupos.
//
// O CASO QUE ISTO CORRIGE (Alf, 17/09). Campo Grande pediu no grupo a lista completa do PIX
// avulso. O TOM só conhecia o lote de 10 da mensagem do dia e respondeu "consigo mandar só os que
// estão aparecendo aqui na lista de hoje… pra te mandar mais 20 sem chutar, preciso do card/lista
// completa". Isso trava a equipe: a fonte (get_pix_migracao_v1 / get_situacao_alunos_v1) SEMPRE
// teve tudo — quem não tinha era o prompt. Ordem do dono: o TOM não pode travar informação.
//
// Este arquivo só decide e formata. Quem lê a fonte é src/services/pix-consulta-fontes.js; quem
// liga no turno do grupo é src/services/group-chat-engine.js.
//
// C4 (17/09): o grupo "PIX AUTOMÁTICO L.A." não tem unidade amarrada (`la_report_unidade_id`
// nulo) e respondia sempre "me diz a unidade" — travando informação de novo, agora por falta de
// unidade em vez de falta de lote. `detectarUnidade` acha uma unidade CITADA dentro da fala
// (Campo Grande/CG, Recreio, Barra); sem citação, o orquestrador (pix-consulta-fontes.js) manda
// as três. `blocoDeNumerosTodasUnidades` formata o bloco de números das três juntas + TOTAL.

const { FATIAS, ROTULO, META_YMD } = require('./pix-migracao');
const { pareceFalaDeCadastro } = require('../lib/pix-cadastro-informado');
const situ = require('./situacao-aluno');

// Teto por mensagem: 45 linhas "• Nome — Alunos" cabem numa mensagem de WhatsApp sem virar
// parede ilegível (a pauta diária já manda ~48 e é o limite do que o time lê de uma vez).
const LIMITE_POR_MENSAGEM = 45;
// Teto de mensagens do MESMO PEDIDO — vale para o pedido inteiro, não por família: um "manda tudo"
// não pode virar rajada de 20 mensagens no grupo.
const TETO_MENSAGENS = 8;

const TEXTO_SEM_UNIDADE = 'Esse grupo não está amarrado a uma unidade, então eu não sei de qual lista você está falando. Me diz a unidade (Recreio, Barra ou Campo Grande) que eu puxo a lista completa na hora.';
const TEXTO_FONTE_FORA = 'A fonte do LA Report não respondeu agora — não vou te mandar número nem nome que eu não medi. Tento de novo já já, é só me chamar.';

function _norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── C1 (fix round 1): TOKEN DE ASSUNTO OBRIGATÓRIO ────────────────────────────────────────────
// A revisão mediu três sequestros REAIS do interceptador, todos por palavra genérica:
//   "quem falta pagar o boleto da excursão…"            (marcador de lista + palavra de fatia)
//   "me passa os nomes de quem falta pagar o cheque…"   (idem)
//   "cadastrei o fulano no automático mas não achei o nome dele"  (aviso de cadastro, não pedido)
// Regra nova: só interceptamos (e só lemos a fonte) quando a fala traz um TOKEN DE ASSUNTO
// explícito. Palavra de FATIA sozinha — cheque, boleto, dinheiro, maquininha, cartão — nunca
// basta: ela só ESCOLHE a fatia quando o assunto já está na fala. Sem assunto, quem responde é o
// LLM, que tem a mensagem da pauta no histórico.
// (Os tokens são testados sobre o texto JÁ NORMALIZADO — "píx"→"pix", "automático"→"automatico",
// "migração"→"migracao" —, por isso não há problema de `\b` colado em vogal acentuada.)
// FOLLOW-UP DO C1 (decisao do dono): o VERBO migrar tambem e assunto — "quantos faltam pra
// migrar?" e "lista de quem falta migrar" sao as falas naturais do time. Mas o verbo sozinho e
// ambiguo fora do PIX ("vou migrar o cadastro do aluno pro app"), entao ele entra como assunto
// FRACO: vale pra escolher o alvo, e so abre a leitura da fonte quando a fala TAMBEM pede lista
// ou quantidade (ver precisaDeNumeros). O substantivo "migracao" segue FORTE — quem diz "como ta
// a migracao?" esta falando desta migracao e de mais nada.
const TOKEN_PIX_FORTE = /\b(pix|automatico|migracao)\b/;
const TOKEN_PIX_VERBO = /\b(migrar|migra|migrado|migrados)\b/;
const TOKEN_ANAMNESE = /\banamneses?\b/;
const TOKEN_CONTRATO = /\bcontratos?\b/;
const TOKEN_PIX = { test: (t) => TOKEN_PIX_FORTE.test(t) || TOKEN_PIX_VERBO.test(t) };
const temAssuntoForte = (t) => TOKEN_PIX_FORTE.test(t) || TOKEN_ANAMNESE.test(t) || TOKEN_CONTRATO.test(t);

// FATIAS E CATEGORIAS — só refinam o alvo DENTRO da família PIX. `cartao_avulso` vem antes de
// `pix_avulso` de propósito: "cartão avulso"/"maquininha" contém "avulso", e sem a precedência a
// mesma fala casaria as duas fatias e o alvo desandava pra 'pix' (lista errada no grupo).
// 💳 (Recreio 06/10): "cartão cadastrado" = cartão RECORRENTE cadastrado no Emusys, mas a última
// mensalidade foi por PIX — a seção 💳 da lista. NÃO é a maquininha (cartão passado no balcão).
const RECORTES_PIX = [
  ['cartao_cadastrado', /\bcartao (recorrente |de credito )?cadastrados?\b|\bcartoes (recorrentes )?cadastrados\b|\bcadastrad[oa]s? no cartao\b/],
  ['cartao_avulso', /\bmaquininha\b|\bcartao avulso\b/],
  ['pix_avulso', /\bpix avulso\b|\bavulso\b/],
  ['cartao_com_falha', /\bcartao (com )?falha\b|\bcartao falhando\b|\bfalha no cartao\b|\bcartao recusado\b/],
  ['sem_historico', /\bsem historico\b/],
  ['autorizacao_pendente', /\bcadastrad[oa]s? sem cobranca\b|\bsem cobranca\b|\bautorizacao pendente\b|\baguardando (a )?(1a|primeira) cobranca\b/],
  ['ja_migrou', /\bja migr(ou|aram)\b|\bquem (ja )?migrou\b|\bmigrados\b|\bja estao no automatico\b/],
  ['cheque', /\bcheques?\b/],
  ['boleto', /\bboletos?\b/],
  ['dinheiro', /\bdinheiro\b|\bespecie\b/],
];
const RE_TUDO = /\bde tudo\b|\btudo\b/;

// Marcadores de pedido de NOMES. Com o token de assunto já obrigatório, não é mais preciso
// separar marcador "forte" de "fraco": qualquer um deles, junto do assunto, é pedido de lista.
const RE_LISTA = /\blista\b|\bnomes?\b|\brelacao\b|\bquem (ainda )?(falta|esta faltando)\b|\b(resto|restante)\b|\btod[oa]s os (clientes|alunos)\b/;
const RE_NUMEROS = /\bquant[oa]s?\b|\bquanto falta\b|\btotal\b|\bnumeros?\b|\bquantidade\b/;

function _alvoDoTexto(t, bruto = '') {
  const pix = TOKEN_PIX.test(t);
  const ana = TOKEN_ANAMNESE.test(t);
  const con = TOKEN_CONTRATO.test(t);
  if (!pix && !ana && !con) return null;
  if ([pix, ana, con].filter(Boolean).length > 1) return 'tudo';
  if (ana) return 'anamnese';
  if (con) return 'contrato';
  // família PIX: a fatia/categoria citada refina o alvo; "tudo" pede o panorama inteiro.
  let achados = [];
  for (const [nome, re] of RECORTES_PIX) if (re.test(t)) achados.push(nome);
  // O 💳 some no _norm (emoji não é letra): procurado na fala crua.
  if (String(bruto).includes('💳') && !achados.includes('cartao_cadastrado')) achados.push('cartao_cadastrado');
  if (achados.includes('cartao_avulso')) achados = achados.filter((a) => a !== 'pix_avulso');
  // "cartão cadastrado e paga pix avulso" é a pergunta do 💳 (a forma é sempre Pix avulso/outra
  // não-cartão) — o Pix avulso ali descreve o 💳, não pede a fatia inteira.
  if (achados.includes('cartao_cadastrado')) achados = achados.filter((a) => a !== 'pix_avulso');
  if (RE_TUDO.test(t)) return 'tudo';
  return achados.length === 1 ? achados[0] : 'pix';
}

// detectarPedido(texto) -> { tipo: 'lista' | 'numeros', alvo } | null
// `lista` ganha de `numeros` quando as duas casam ("me manda a lista e quantos são"): mandar os
// nomes já responde a quantidade, o contrário não.
function detectarPedido(texto) {
  // C1: fala com FORMA de aviso de cadastro é assunto do atalho determinístico
  // (src/services/pix-cadastro-grupo.js), não pedido de lista — inclusive quando negação ou
  // dúvida refutam o reconhecimento ("cadastrei o fulano no automático mas não achei o nome
  // dele"). Sem esta trava, um aviso da equipe virava lista inteira do PIX no grupo.
  if (pareceFalaDeCadastro(texto)) return null;
  const t = _norm(texto);
  if (!t) return null;
  const alvo = _alvoDoTexto(t, texto);
  if (!alvo) return null;
  if (RE_LISTA.test(t)) return { tipo: 'lista', alvo };
  if (RE_NUMEROS.test(t)) return { tipo: 'numeros', alvo };
  return null; // citar o assunto sem pedir nada não é pergunta
}

// I4 (fix round 1): o gate dos números exige o MESMO token de assunto. Antes bastava "quantos" ou
// "falta" — palavras de conversa de trabalho —, e cada uma custava duas RPCs ao LA Report.
// CONTEXTO RECENTE (bateria em sombra, 28/09): no grupo "PIX AUTOMÁTICO L.A", logo depois do
// relatório de segunda, "Tom, quantas faltam?" e "essas informações aqui estão certas?" não traziam
// "pix" na fala — o gate fechava e o TOM respondia sem os números. Quando a conversa RECENTE do
// grupo é sobre PIX automático, pergunta de QUANTIDADE ou de CONFERÊNCIA abre a leitura. Só isso:
// conversa comum continua sem custar leitura, e sem esse contexto o gate é o mesmo de antes.
const RE_CONFERENCIA = /\b(esta|estao|ta|tao|sao|e|isso|isto) (tudo |mesmo )?cert[oa]s?\b|\bconfere\b|\bbate(m)?\b/;
const JANELA_ASSUNTO = 8;
function assuntoPixRecente(history) {
  const ult = Array.isArray(history) ? history.slice(-JANELA_ASSUNTO) : [];
  return ult.some((m) => m && TOKEN_PIX_FORTE.test(_norm(m.content)));
}

function precisaDeNumeros(texto, { assuntoPixRecente: recente = false } = {}) {
  // C1: a mesma trava do interceptador vale aqui — fala com forma de aviso de cadastro é assunto
  // do atalho determinístico e NÃO custa leitura de fonte nenhuma (a revisão exigiu "no source
  // read" para "cadastrei o fulano no automático mas não achei o nome dele").
  if (pareceFalaDeCadastro(texto)) return false;
  const t = _norm(texto);
  if (!t) return false;
  if (temAssuntoForte(t)) return true;
  // So o verbo "migrar": ambiguo por si ("vou migrar o cadastro do aluno pro app"). Abre a
  // leitura apenas quando a fala pede lista ou quantidade — os portoes do C1 seguem de pe.
  if (TOKEN_PIX_VERBO.test(t) && (RE_LISTA.test(t) || RE_NUMEROS.test(t))) return true;
  return !!recente && (RE_NUMEROS.test(t) || RE_CONFERENCIA.test(t));
}

// ── C4: detectarUnidade — acha uma unidade CITADA dentro de uma fala qualquer ──────────────────
// Diferente de situacao-aluno.resolverUnidade (que espera a fala INTEIRA ser só o nome/apelido,
// como vem do marker do LLM): aqui a unidade é UMA PALAVRA dentro de uma frase livre do grupo.
// Mesmos ids/apelidos de situacao-aluno.js — fonte única, nenhum UUID duplicado aqui. `\b` nos
// dois lados garante que "barra" só casa como PALAVRA (não em "barragem"/"embarra") e que "cg"
// só casa sozinho (não dentro de "cgestao" ou qualquer coisa colada).
function detectarUnidade(texto) {
  const t = _norm(texto);
  if (!t) return null;
  for (const apelido of Object.keys(situ.UNIDADES)) {
    const re = new RegExp(`\\b${apelido.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(t)) return situ.UNIDADES[apelido];
  }
  return null;
}

const TITULO_EXTRA = {
  pix: 'PIX automático — quem falta migrar',
  tudo: 'PIX automático — quem falta migrar',
  ja_migrou: 'Já migraram',
  cartao_cadastrado: 'Cartão cadastrado, pagando PIX',
  anamnese: 'Anamnese — quem falta preencher',
  contrato: 'Contrato — quem falta assinar',
};
function tituloDoAlvo(alvo) {
  if (TITULO_EXTRA[alvo]) return TITULO_EXTRA[alvo];
  return (ROTULO[alvo] && ROTULO[alvo].nome) || TITULO_EXTRA.pix;
}
// I5: no PIX quem aparece é o CLIENTE (pagador); na anamnese e no contrato é o ALUNO.
function substantivoDoAlvo(alvo) {
  return (alvo === 'anamnese' || alvo === 'contrato') ? 'alunos' : 'clientes';
}

// ── LISTA DE NOMES, QUEBRADA EM MENSAGENS DE WHATSAPP ─────────────────────────────────────────
// C2: um pedido pode ter mais de uma família (alvo 'tudo' = PIX, anamnese, contrato). Cada
// família tem TÍTULO e NUMERAÇÃO DE PARTES próprios; o teto de mensagens é do PEDIDO INTEIRO.
// REPARTIÇÃO: uma mensagem reservada por família antes de qualquer distribuição — uma família
// que sai MUDA é exatamente a doença que esta feature existe pra curar. O que sobra do teto vai
// pras famílias na ordem em que foram pedidas. O que não coube é DITO na última mensagem.
// C4: `unidadeNome` pode vir null/vazio quando quem chama já montou o TÍTULO INTEIRO por bloco
// (caso das três unidades juntas — cada bloco já traz "… — Campo Grande" etc. no próprio título,
// e colar outra unidade em cima duplicaria/erraria o rótulo).
function mensagensDeVariasListas({
  unidadeNome, blocos, avisos = [], limitePorMensagem = LIMITE_POR_MENSAGEM, tetoMensagens = TETO_MENSAGENS,
}) {
  const lista = (blocos || []).filter(Boolean);
  const lim = Math.max(1, Number(limitePorMensagem) || LIMITE_POR_MENSAGEM);
  const teto = Math.max(1, Number(tetoMensagens) || TETO_MENSAGENS);
  const rotulo = unidadeNome ? (titulo) => `${titulo} — ${unidadeNome}` : (titulo) => titulo;
  const querem = lista.map((b) => Math.max(1, Math.ceil(((b.itens || []).length) / lim)));
  const dadas = lista.map(() => 0);
  let restante = teto;
  for (let i = 0; i < lista.length && restante > 0; i++) { dadas[i] = 1; restante -= 1; }
  for (let i = 0; i < lista.length && restante > 0; i++) {
    const d = Math.min(Math.max(0, querem[i] - dadas[i]), restante);
    dadas[i] += d;
    restante -= d;
  }

  const out = [];
  let fora = 0;
  for (let i = 0; i < lista.length; i++) {
    const b = lista[i];
    const itens = b.itens || [];
    const subst = b.substantivo || 'clientes';
    const partes = dadas[i];
    // O DENOMINADOR e de quantas partes a lista PRECISA, nao de quantas couberam: uma familia
    // cortada anunciando "parte 1/1" leria como lista completa — o mesmo "parece inteiro e nao
    // e" que esta feature veio curar. Com 318 alunos e uma parte concedida, o cabecalho diz
    // "parte 1/8" e o rodape diz quantos ficaram de fora.
    const precisa = querem[i];
    const mostrados = Math.min(itens.length, partes * lim);
    fora += itens.length - mostrados;
    if (!partes) continue;
    // Lista vazia também leva o resumo: é nele que mora o "a conferência de hoje não rodou" do
    // contrato — sem ele, vazio por FALHA sairia idêntico a vazio por SAÚDE.
    if (!itens.length) { out.push(`💠 *${rotulo(b.titulo)}* (0 ${subst}) — parte 1/1${b.resumo ? `\n${b.resumo}` : ''}\nNinguém nesta lista agora.`); continue; }
    for (let k = 0; k < partes; k++) {
      const fatia = itens.slice(k * lim, Math.min((k + 1) * lim, mostrados));
      const corpo = _corpoDaParte(fatia, k > 0 ? itens[k * lim - 1] : null);
      const topo = k === 0 && b.resumo ? `\n${b.resumo}${corpo.secionado ? '\n' : ''}` : '';
      out.push(`💠 *${rotulo(b.titulo)}* (${itens.length} ${subst}) — parte ${k + 1}/${precisa}${topo}\n${corpo.texto}`);
    }
  }
  const rodape = [];
  if (fora > 0) rodape.push(`_Ficaram ${fora} de fora desta lista — o resto sai pelo painel do LA Report._`);
  for (const a of avisos || []) if (a) rodape.push(`_${a}_`);
  if (rodape.length && out.length) out[out.length - 1] += `\n${rodape.join('\n')}`;
  return out;
}

// ── LISTA ORGANIZADA (Alf, 28/09) ─────────────────────────────────────────────────────────────
// "Sempre que o TOM responder, tem que vir organizado, hierárquico, como mensagem de WhatsApp." A
// lista de quem falta migrar saía como 43 linhas corridas (Barra, pedido do Arthur). Item com
// `secao` ganha cabeçalho da seção (a mesma forma de pagamento da pauta das 9h), linha em branco
// entre seções e nome recuado — igual à pauta. Parte que começa no meio de uma seção repete o
// cabeçalho com "(continuação)". Item SEM `secao` sai plano, como antes (desde 30/09 anamnese e
// contrato também têm seção — ver listaDeAlunosOrganizada, logo abaixo).
function _linhaPlana(it) {
  return `• ${it.pagador}${(it.alunos || []).length ? ` — ${it.alunos.join(', ')}` : ''}`;
}
function _corpoDaParte(fatia, anterior) {
  if (!fatia.some((it) => it && it.secao)) return { texto: fatia.map(_linhaPlana).join('\n'), secionado: false };
  const linhas = [];
  let atual;
  fatia.forEach((it, i) => {
    if (i === 0 || it.secao !== atual) {
      if (linhas.length) linhas.push('');
      const cont = i === 0 && anterior && anterior.secao === it.secao ? ' _(continuação)_' : '';
      if (it.secao) linhas.push(`${it.secao}${cont}`);
      atual = it.secao;
    }
    // `detalhe` (anamnese/contrato: "responsável: X") vence a lista de alunos — no aluno, o nome
    // já é a linha; repetir o próprio nome entre parênteses é o "Nome — Nome" de 30/09.
    const extra = it.detalhe || ((it.alunos || []).length ? it.alunos.join(', ') : '');
    linhas.push(`   • ${it.pagador}${extra ? ` (${extra})` : ''}`);
  });
  return { texto: linhas.join('\n'), secionado: true };
}

// ── ANAMNESE E CONTRATO ORGANIZADOS (Arthur, Barra, 30/09 16:23) ──────────────────────────────
// A lista de contrato chegou como 56 linhas "• Nome — Nome": o item levava o responsável na frente
// e o aluno ao lado, e na Barra 55 de 56 têm `responsavel_nome` = o próprio aluno (a RPC cai pro
// nome da pessoa quando não há responsável). Agora cada aluno é UMA linha com o nome dele, e
// "(responsável: X)" só aparece quando X é outra pessoa (situacao-aluno.responsavelDistinto).
// SEÇÕES: 🧒 Crianças (LAMK, ≤11 anos — a mesma regra dos cards de situacao-aluno.js, onde quem
// resolve é o responsável) e 🎓 Adultos. No contrato, quando a fonte separa "não assinado" de "sem
// contrato no Emusys", a seção separa também — são conversas diferentes com a família.
// `nao_verificado` NUNCA vira cobrança (ver COMO O CONTRATO E MEDIDO em situacao-aluno.js), mas
// também não some: vira linha do resumo, com a quantidade.
// -> { itens: [{ pagador, alunos: [], detalhe?, secao }], resumo }
const ROTULO_STATUS_CONTRATO = { nao_assinado: 'não assinado', sem_contrato: 'sem contrato no Emusys' };
const ORDEM_STATUS_CONTRATO = ['nao_assinado', 'sem_contrato'];
const _ehCrianca = (p) => String(p && p.classificacao).toUpperCase() === 'LAMK';
function listaDeAlunosOrganizada({ recorte, pessoas }) {
  const todas = pessoas || [];
  const pend = situ.filtrarPorRecorte(todas, recorte);
  const ehContrato = recorte === 'contrato';
  const status = (p) => (ORDEM_STATUS_CONTRATO.includes(p.contrato_assinatura_status) ? p.contrato_assinatura_status : 'nao_assinado');
  const porStatus = ehContrato && new Set(pend.map(status)).size > 1;
  const chave = (p) => `${_ehCrianca(p) ? 0 : 1}|${porStatus ? ORDEM_STATUS_CONTRATO.indexOf(status(p)) : 0}`;
  const ordenadas = [...pend].sort((a, b) => {
    const d = chave(a).localeCompare(chave(b));
    return d || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  });
  const conta = new Map();
  for (const p of ordenadas) conta.set(chave(p), (conta.get(chave(p)) || 0) + 1);
  const rotuloSecao = (p) => {
    const faixa = _ehCrianca(p) ? '🧒 *Crianças' : '🎓 *Adultos';
    const st = porStatus ? ` · ${ROTULO_STATUS_CONTRATO[status(p)]}` : '';
    return `${faixa}${st}* (${conta.get(chave(p))})${_ehCrianca(p) ? ' — quem resolve é o responsável' : ''}`;
  };
  const itens = ordenadas.map((p) => {
    const resp = situ.responsavelDistinto(p);
    const it = { pagador: p.nome, alunos: [], secao: rotuloSecao(p) };
    if (resp) it.detalhe = `responsável: ${resp}`;
    return it;
  });

  const oQue = ehContrato ? 'sem contrato assinado' : 'sem anamnese';
  const resumo = [`📋 *${pend.length} de ${todas.length} alunos ativos ${oQue}*`];
  if (ehContrato) {
    if (situ.contratoConferidoHoje(todas) === false) {
      resumo.push('⚠️ *A conferência de contrato de hoje não rodou* — não dá pra dizer quem falta assinar agora');
    } else {
      const nv = situ.naoVerificadosDeContrato(todas).length;
      if (nv) resumo.push(`❔ ${nv} não deu pra conferir hoje — fica${nv > 1 ? 'm' : ''} fora da lista (conferir no Emusys antes de cobrar)`);
    }
  }
  return { itens, resumo: resumo.join('\n') };
}

// Topo da lista do PIX: onde a unidade está e quanto tempo falta. Mesma conta do relatório de
// segunda (total = migrados + a migrar + cadastrados sem cobrança) — o grupo nunca vê dois números.
function _diasAte(hojeYmd, metaYmd) {
  const a = Date.parse(`${hojeYmd}T00:00:00Z`);
  const b = Date.parse(`${metaYmd}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86400000);
}
function resumoDaMigracao({ migrados, total, hojeYmd, metaYmd = META_YMD }) {
  const m = Math.max(0, Number(migrados) || 0);
  const tot = Math.max(m, Number(total) || 0);
  const linhas = [`✅ *${m} de ${tot} já migraram* · faltam ${tot - m}`];
  const metaBr = `${metaYmd.slice(8, 10)}/${metaYmd.slice(5, 7)}`;
  const dias = hojeYmd ? _diasAte(hojeYmd, metaYmd) : null;
  if (dias != null) {
    if (dias > 1) linhas.push(`⏰ Faltam ${dias} dias pra meta de ${metaBr}`);
    else if (dias === 1) linhas.push(`⏰ Falta 1 dia pra meta de ${metaBr}`);
    else if (dias === 0) linhas.push(`⏰ A meta é hoje (${metaBr})`);
    else linhas.push(`⏰ Meta de ${metaBr} vencida`);
  }
  return linhas.join('\n');
}

// Atalho de UMA família só (o caso comum). Lista vazia NÃO devolve array vazio: um pedido
// respondido com silêncio é exatamente o que este arquivo existe pra acabar.
function mensagensDaLista({ unidadeNome, titulo, itens, substantivo = 'clientes', limitePorMensagem = LIMITE_POR_MENSAGEM }) {
  return mensagensDeVariasListas({
    unidadeNome, blocos: [{ titulo, substantivo, itens }], limitePorMensagem,
  });
}

// ── BLOCO DE NÚMEROS PRO PROMPT DO LLM ────────────────────────────────────────────────────────
// Vai pro prompt como contexto novo (`numerosContext`), no mesmo estilo de `notesContext`. Não
// intercepta nada: qualquer forma de perguntar quantidade passa a ser respondida com o número
// CERTO, na voz do TOM. Fonte que não respondeu vira uma linha DIZENDO isso — nunca um número.
const NOMES_FORA = [['nao_mexe', 'não mexe'], ['inadimplente', 'inadimplente'], ['nao_pagante', 'não pagante'], ['excecao', 'exceção'], ['outras', 'outras']];
// C3 (fix round 1): a pauta diária de anamnese/contrato conta só quem tem AULA HOJE (~25 em Campo
// Grande); estes números são de TODOS os alunos ativos da unidade (318). Sem o recorte escrito no
// próprio número, o TOM afirmaria 318 como se fosse a pauta do dia. O rótulo é literal.
const RECORTE_ALUNOS = '(TODOS os alunos ativos da unidade, NÃO é a pauta de hoje)';

function _dataBr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (x) => String(x).padStart(2, '0');
  // Horário de Brasília — o time lê a hora do relógio dele, não UTC.
  const b = new Date(d.getTime() - 3 * 3600000);
  return `${p(b.getUTCDate())}/${p(b.getUTCMonth() + 1)} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}

function blocoDeNumeros({ unidadeNome, pix, anamnese, contrato, dadoEm, dadoDeHoje, motivo }) {
  const L = [`## NÚMEROS DA FONTE AGORA — ${unidadeNome} (leia ANTES de falar qualquer quantidade)`];
  if (pix) {
    // 28/09: "213 clientes na fonte" (Barra) virava fala do TOM, e o relatório diz 53 — o resto nem
    // entra na migração. A base aqui é a MESMA do relatório de segunda: já migraram + faltam.
    L.push(`PIX automático: ${pix.ja_migrou + pix.faltam} clientes na migração (a mesma base do relatório de segunda) · já migraram ${pix.ja_migrou} · faltam migrar ${pix.faltam} (${pix.migrar} a migrar + ${pix.autorizacao_pendente} cadastrados sem cobrança)`);
    if (pix.bloqueado_emusys) L.push(`  dos que faltam, ${pix.bloqueado_emusys} estão aguardando o Emusys (2+ matrículas: ele só liga o PIX automático a uma fatura) — continuam contados, vão pro fim da fila`);
    if (pix.cartao_cadastrado) L.push(`  dos que faltam, ${pix.cartao_cadastrado} têm cartão recorrente cadastrado mas pagaram por PIX (💳) — conferir no Emusys: se já estão no cartão, saem da lista quando a cobrança passar; vão pro fim da fila. Se pedirem os NOMES deles: <<LISTA_PIX>> com alvo "cartao_cadastrado" (nunca "cartao_avulso", que é a maquininha)`);
    const fat = FATIAS.map((f) => [ROTULO[f], (pix.fatias || {})[f] || 0])
      .filter(([, n]) => n > 0).map(([r, n]) => `${r.emoji} ${r.nome} ${n}`);
    L.push(`Fatias de quem falta: ${fat.length ? fat.join(' · ') : 'nenhuma'}`);
    if (pix.aguardando_cobranca) L.push(`Aguardando a 1ª cobrança: ${pix.aguardando_cobranca}`);
    L.push(`Fora da migração (NÃO entram em nenhuma conta): ${NOMES_FORA.map(([k, r]) => `${r} ${pix[k] || 0}`).join(' · ')}`);
  } else {
    L.push('PIX automático: NÃO CONSEGUI LER a fonte agora — não afirme nenhum número de PIX nesta resposta.');
  }
  if (anamnese) L.push(`Anamnese ${RECORTE_ALUNOS}: ${anamnese.pendentes} pendentes de ${anamnese.base}`);
  if (contrato) L.push(`Contrato ${RECORTE_ALUNOS}: ${contrato.pendentes} pendentes de ${contrato.base}`);
  if (!anamnese || !contrato) L.push('Anamnese/contrato: NÃO CONSEGUI LER a fonte agora — não afirme número de anamnese nem de contrato nesta resposta.');
  const quando = _dataBr(dadoEm);
  if (quando) L.push(`Dado do LA Report atualizado em ${quando}${dadoDeHoje === false ? ' (NÃO é de hoje — diga isso se for cobrar alguém)' : ''}.`);
  if (motivo) L.push(`(falha de leitura: ${motivo})`);
  L.push('Estes números vêm da fonte agora. Use SOMENTE eles para falar de quantidade; se a pessoa pedir os NOMES, emita o marker <<LISTA_PIX>> (PIX) ou <<SITUACAO_ALUNO>> (anamnese/contrato) — o sistema posta a lista inteira; nunca peça planilha. Nunca estime.');
  L.push('Ao dar número de anamnese ou contrato, diga sempre que é o total da unidade e não a pauta de hoje.');
  return L.join('\n');
}

// ── C4: números das TRÊS unidades juntas (grupo sem unidade e SEM unidade citada na fala) ──────
// `unidades`: [{ unidadeNome, pix, anamnese, contrato, motivo }, ...] já na ORDEM de exibição
// (decidida por quem orquestra — pix-consulta-fontes.js — não aqui). Cada unidade fala por si
// (mesmos rótulos honestos de blocoDeNumeros) e o TOTAL só soma o que TODAS as unidades
// conseguiram ler — uma unidade fora não pode virar zero silencioso dentro da soma (mesmo motivo
// de numerosDaUnidade nunca inventar zero por falha: "zero por falha sai idêntico a zero por
// saúde, e é assim que um laudo vira mentira").
function blocoDeNumerosTodasUnidades({ unidades }) {
  const L = ['## NÚMEROS DA FONTE AGORA — as três unidades (leia ANTES de falar qualquer quantidade)'];
  let pixOk = true; let totalBase = 0; let totalJa = 0; let totalFaltam = 0; let totalPresos = 0;
  let anaOk = true; let totalAnaPend = 0; let totalAnaBase = 0;
  let conOk = true; let totalConPend = 0; let totalConBase = 0;

  for (const u of (unidades || [])) {
    if (u.pix) {
      L.push(`${u.unidadeNome} — PIX automático: ${u.pix.ja_migrou + u.pix.faltam} na migração · já migraram ${u.pix.ja_migrou} · faltam migrar ${u.pix.faltam}${u.pix.bloqueado_emusys ? ` (${u.pix.bloqueado_emusys} aguardando o Emusys)` : ''}${u.pix.cartao_cadastrado ? ` (${u.pix.cartao_cadastrado} 💳 conferir no Emusys)` : ''}`);
      totalBase += u.pix.ja_migrou + u.pix.faltam;
      totalJa += u.pix.ja_migrou;
      totalFaltam += u.pix.faltam;
      totalPresos += u.pix.bloqueado_emusys || 0;
    } else {
      L.push(`${u.unidadeNome} — PIX automático: NÃO CONSEGUI LER a fonte agora.`);
      pixOk = false;
    }
    if (u.anamnese) {
      L.push(`${u.unidadeNome} — Anamnese ${RECORTE_ALUNOS}: ${u.anamnese.pendentes} pendentes de ${u.anamnese.base}`);
      totalAnaPend += u.anamnese.pendentes;
      totalAnaBase += u.anamnese.base;
    } else {
      L.push(`${u.unidadeNome} — Anamnese: NÃO CONSEGUI LER a fonte agora.`);
      anaOk = false;
    }
    if (u.contrato) {
      L.push(`${u.unidadeNome} — Contrato ${RECORTE_ALUNOS}: ${u.contrato.pendentes} pendentes de ${u.contrato.base}`);
      totalConPend += u.contrato.pendentes;
      totalConBase += u.contrato.base;
    } else {
      L.push(`${u.unidadeNome} — Contrato: NÃO CONSEGUI LER a fonte agora.`);
      conOk = false;
    }
    if (u.motivo) L.push(`(${u.unidadeNome} — falha de leitura: ${u.motivo})`);
  }

  L.push(pixOk
    ? `TOTAL — PIX automático: ${totalBase} na migração · já migraram ${totalJa} · faltam migrar ${totalFaltam}${totalPresos ? ` (${totalPresos} aguardando o Emusys: 2+ matrículas, ele só liga o PIX automático a uma fatura)` : ''}`
    : 'TOTAL — PIX automático: não dá pra somar agora — pelo menos uma unidade não respondeu.');
  L.push(anaOk
    ? `TOTAL — Anamnese ${RECORTE_ALUNOS}: ${totalAnaPend} pendentes de ${totalAnaBase}`
    : 'TOTAL — Anamnese: não dá pra somar agora — pelo menos uma unidade não respondeu.');
  L.push(conOk
    ? `TOTAL — Contrato ${RECORTE_ALUNOS}: ${totalConPend} pendentes de ${totalConBase}`
    : 'TOTAL — Contrato: não dá pra somar agora — pelo menos uma unidade não respondeu.');
  L.push('Perguntaram quantas faltam sem dizer a unidade? Responda ORGANIZADO: uma linha por unidade (Campo Grande, Recreio, Barra) com já migraram e faltam, e a linha do total no fim.');
  L.push('Estes números vêm da fonte agora. Use SOMENTE eles para falar de quantidade; se a pessoa pedir os NOMES, emita o marker <<LISTA_PIX>> (PIX) ou <<SITUACAO_ALUNO>> (anamnese/contrato), com a unidade se ela disser — o sistema posta a lista inteira; nunca peça planilha. Nunca estime.');
  L.push('Ao dar número de anamnese ou contrato, diga sempre que é o total da unidade e não a pauta de hoje.');
  return L.join('\n');
}

// ── MARCADOR <<LISTA_PIX>> (Barra, 17/09 15:40) ────────────────────────────────────────────
// Arthur perguntou "tom quais são os alunos pix que ainda não está no pix automático?" e o TOM
// pediu planilha. O detector por palavra acima só conhece "lista", "nomes", "quem falta" — e
// NÃO deve crescer pra cobrir toda forma de perguntar (decisão do Alf 02/09: "eu fujo de regex").
// Quem entende a pergunta é o LLM: ele emite <<LISTA_PIX>>{"alvo": ...} e o CÓDIGO escreve os
// nomes (pix-consulta-fontes.atenderMarkersListaPix), igual ao <<SITUACAO_ALUNO>>.
// `alvosDoMarker` normaliza o que o LLM mandou: alvo fora da lista vira 'pix' (todo mundo que
// falta migrar — responder a mais é melhor que calar), no máximo 3 formas por pedido (o teto de
// mensagens é do pedido inteiro) e 'tudo' engole o resto.
// 06/10 (Recreio): "cartao_cadastrado" = só a seção 💳 da lista (ver pix-consulta-fontes._lerPix);
// "cartao_pix" é o apelido que o modelo tende a escrever.
const ALVOS_DO_MARKER = new Set([...FATIAS, 'pix', 'ja_migrou', 'cartao_cadastrado', 'anamnese', 'contrato', 'tudo']);
const APELIDOS_DO_MARKER = { cartao_pix: 'cartao_cadastrado' };
const TETO_ALVOS_DO_MARKER = 3;
function alvosDoMarker(alvo) {
  const brutos = Array.isArray(alvo) ? alvo : [alvo];
  const vistos = [];
  for (const a of brutos) {
    const cru = String(a == null ? '' : a).trim().toLowerCase();
    const n = APELIDOS_DO_MARKER[cru] || cru;
    if (ALVOS_DO_MARKER.has(n) && !vistos.includes(n)) vistos.push(n);
  }
  if (vistos.includes('tudo')) return ['tudo'];
  return vistos.length ? vistos.slice(0, TETO_ALVOS_DO_MARKER) : ['pix'];
}

module.exports = {
  LIMITE_POR_MENSAGEM, TETO_MENSAGENS, TEXTO_SEM_UNIDADE, TEXTO_FONTE_FORA, RECORTE_ALUNOS,
  detectarPedido, precisaDeNumeros, detectarUnidade, tituloDoAlvo, substantivoDoAlvo,
  mensagensDaLista, mensagensDeVariasListas, blocoDeNumeros, blocoDeNumerosTodasUnidades,
  alvosDoMarker, resumoDaMigracao, assuntoPixRecente, listaDeAlunosOrganizada,
};
