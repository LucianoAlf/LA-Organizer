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

const { FATIAS, ROTULO } = require('./pix-migracao');
const { pareceFalaDeCadastro } = require('../lib/pix-cadastro-informado');

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
const RECORTES_PIX = [
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

function _alvoDoTexto(t) {
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
  if (achados.includes('cartao_avulso')) achados = achados.filter((a) => a !== 'pix_avulso');
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
  const alvo = _alvoDoTexto(t);
  if (!alvo) return null;
  if (RE_LISTA.test(t)) return { tipo: 'lista', alvo };
  if (RE_NUMEROS.test(t)) return { tipo: 'numeros', alvo };
  return null; // citar o assunto sem pedir nada não é pergunta
}

// I4 (fix round 1): o gate dos números exige o MESMO token de assunto. Antes bastava "quantos" ou
// "falta" — palavras de conversa de trabalho —, e cada uma custava duas RPCs ao LA Report.
function precisaDeNumeros(texto) {
  // C1: a mesma trava do interceptador vale aqui — fala com forma de aviso de cadastro é assunto
  // do atalho determinístico e NÃO custa leitura de fonte nenhuma (a revisão exigiu "no source
  // read" para "cadastrei o fulano no automático mas não achei o nome dele").
  if (pareceFalaDeCadastro(texto)) return false;
  const t = _norm(texto);
  if (!t) return false;
  if (temAssuntoForte(t)) return true;
  // So o verbo "migrar": ambiguo por si ("vou migrar o cadastro do aluno pro app"). Abre a
  // leitura apenas quando a fala pede lista ou quantidade — os portoes do C1 seguem de pe.
  return TOKEN_PIX_VERBO.test(t) && (RE_LISTA.test(t) || RE_NUMEROS.test(t));
}

const TITULO_EXTRA = {
  pix: 'PIX automático — quem falta migrar',
  tudo: 'PIX automático — quem falta migrar',
  ja_migrou: 'Já migraram',
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
function mensagensDeVariasListas({
  unidadeNome, blocos, avisos = [], limitePorMensagem = LIMITE_POR_MENSAGEM, tetoMensagens = TETO_MENSAGENS,
}) {
  const lista = (blocos || []).filter(Boolean);
  const lim = Math.max(1, Number(limitePorMensagem) || LIMITE_POR_MENSAGEM);
  const teto = Math.max(1, Number(tetoMensagens) || TETO_MENSAGENS);
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
    if (!itens.length) { out.push(`💠 *${b.titulo} — ${unidadeNome}* (0 ${subst}) — parte 1/1\nNinguém nesta lista agora.`); continue; }
    for (let k = 0; k < partes; k++) {
      const fatia = itens.slice(k * lim, Math.min((k + 1) * lim, mostrados));
      const corpo = fatia.map((it) => `• ${it.pagador}${(it.alunos || []).length ? ` — ${it.alunos.join(', ')}` : ''}`).join('\n');
      out.push(`💠 *${b.titulo} — ${unidadeNome}* (${itens.length} ${subst}) — parte ${k + 1}/${precisa}\n${corpo}`);
    }
  }
  const rodape = [];
  if (fora > 0) rodape.push(`_Ficaram ${fora} de fora desta lista — o resto sai pelo painel do LA Report._`);
  for (const a of avisos || []) if (a) rodape.push(`_${a}_`);
  if (rodape.length && out.length) out[out.length - 1] += `\n${rodape.join('\n')}`;
  return out;
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
    L.push(`PIX automático: ${pix.total} clientes na fonte · já migraram ${pix.ja_migrou} · faltam migrar ${pix.faltam} (${pix.migrar} a migrar + ${pix.autorizacao_pendente} cadastrados sem cobrança)`);
    const fat = FATIAS.map((f) => [ROTULO[f], (pix.fatias || {})[f] || 0])
      .filter(([, n]) => n > 0).map(([r, n]) => `${r.emoji} ${r.nome} ${n}`);
    L.push(`Fatias de quem falta: ${fat.length ? fat.join(' · ') : 'nenhuma'}`);
    if (pix.aguardando_cobranca) L.push(`Aguardando a 1ª cobrança: ${pix.aguardando_cobranca}`);
    L.push(`Fora da migração: ${NOMES_FORA.map(([k, r]) => `${r} ${pix[k] || 0}`).join(' · ')}`);
  } else {
    L.push('PIX automático: NÃO CONSEGUI LER a fonte agora — não afirme nenhum número de PIX nesta resposta.');
  }
  if (anamnese) L.push(`Anamnese ${RECORTE_ALUNOS}: ${anamnese.pendentes} pendentes de ${anamnese.base}`);
  if (contrato) L.push(`Contrato ${RECORTE_ALUNOS}: ${contrato.pendentes} pendentes de ${contrato.base}`);
  if (!anamnese || !contrato) L.push('Anamnese/contrato: NÃO CONSEGUI LER a fonte agora — não afirme número de anamnese nem de contrato nesta resposta.');
  const quando = _dataBr(dadoEm);
  if (quando) L.push(`Dado do LA Report atualizado em ${quando}${dadoDeHoje === false ? ' (NÃO é de hoje — diga isso se for cobrar alguém)' : ''}.`);
  if (motivo) L.push(`(falha de leitura: ${motivo})`);
  L.push('Estes números vêm da fonte agora. Use SOMENTE eles para falar de quantidade; se a pessoa pedir a lista de nomes, diga que é só pedir "lista completa do <assunto>". Nunca estime.');
  L.push('Ao dar número de anamnese ou contrato, diga sempre que é o total da unidade e não a pauta de hoje.');
  return L.join('\n');
}

module.exports = {
  LIMITE_POR_MENSAGEM, TETO_MENSAGENS, TEXTO_SEM_UNIDADE, TEXTO_FONTE_FORA, RECORTE_ALUNOS,
  detectarPedido, precisaDeNumeros, tituloDoAlvo, substantivoDoAlvo,
  mensagensDaLista, mensagensDeVariasListas, blocoDeNumeros,
};
