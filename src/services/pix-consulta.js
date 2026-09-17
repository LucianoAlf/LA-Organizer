'use strict';
// pix-consulta.js — camada PURA (sem I/O) da consulta de lista e de número nos grupos.
//
// O CASO QUE ISTO CORRIGE (Alf, 17/09). Campo Grande pediu no grupo a lista completa do PIX
// avulso. O TOM só conhecia o lote de 10 da mensagem do dia e respondeu "consigo mandar só os que
// estão aparecendo aqui na lista de hoje… pra te mandar mais 20 sem chutar, preciso do card/lista
// completa". Isso trava a equipe: a fonte (get_pix_migracao_v1 / get_situacao_alunos_v1) SEMPRE
// teve tudo — quem não tinha era o prompt. Ordem do dono: o TOM não pode travar informação; se
// perguntarem quantos faltam (PIX, anamnese, contrato) ou a lista inteira, ele responde, detalhado,
// por fatia, SEM CHUTAR.
//
// Este arquivo só decide e formata. Quem lê a fonte é src/services/pix-consulta-fontes.js; quem
// liga no turno do grupo é src/services/group-chat-engine.js.

const { FATIAS, ROTULO } = require('./pix-migracao');

// Teto por mensagem: 45 linhas "• Nome — Alunos" cabem numa mensagem de WhatsApp sem virar
// parede ilegível (a pauta diária já manda ~48 e é o limite do que o time lê de uma vez).
const LIMITE_POR_MENSAGEM = 45;
// Teto de mensagens do mesmo pedido. 8 × 45 = 360 nomes — acima do maior caso medido hoje
// (Campo Grande, 231 a migrar). Acima disso a última mensagem DIZ quantos ficaram de fora em vez
// de o grupo receber uma rajada sem fim.
const TETO_MENSAGENS = 8;

const TEXTO_SEM_UNIDADE = 'Esse grupo não está amarrado a uma unidade, então eu não sei de qual lista você está falando. Me diz a unidade (Recreio, Barra ou Campo Grande) que eu puxo a lista completa na hora.';
const TEXTO_FONTE_FORA = 'A fonte do LA Report não respondeu agora — não vou te mandar número nem nome que eu não medi. Tento de novo já já, é só me chamar.';

function _norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── ASSUNTOS ──────────────────────────────────────────────────────────────────────────────────
// Ordem importa só para leitura; o casamento é acumulativo (ver _alvoDoTexto). `cartao_avulso`
// vem ANTES de `pix_avulso` de propósito: "cartão avulso"/"maquininha" contém "avulso" e sem essa
// precedência a mesma fala casaria as duas fatias.
const ASSUNTOS = [
  ['cartao_avulso', /\bmaquininha\b|\bcartao avulso\b/],
  ['pix_avulso', /\bpix avulso\b|\bavulso\b/],
  ['cartao_com_falha', /\bcartao (com )?falha\b|\bcartao falhando\b|\bfalha no cartao\b|\bcartao recusado\b/],
  ['sem_historico', /\bsem historico\b/],
  ['autorizacao_pendente', /\bcadastrad[oa]s? sem cobranca\b|\bsem cobranca\b|\bautorizacao pendente\b|\baguardando (a )?(1a|primeira) cobranca\b/],
  ['ja_migrou', /\bja migr(ou|aram)\b|\bquem (ja )?migrou\b|\bmigrados\b|\bja estao no automatico\b/],
  ['cheque', /\bcheques?\b/],
  ['boleto', /\bboletos?\b/],
  ['dinheiro', /\bdinheiro\b|\bespecie\b/],
  ['anamnese', /\banamneses?\b/],
  ['contrato', /\bcontratos?\b/],
];
const FAMILIA = { anamnese: 'anamnese', contrato: 'contrato' };
const familiaDoAlvo = (a) => FAMILIA[a] || 'pix';

const RE_PIX = /\bpix\b|\bautomatico\b|\bmigra(r|cao|ram|ndo|m)?\b/;
const RE_TUDO = /\bde tudo\b|\btudo\b/;

// LISTA FORTE — pede NOMES e já diz QUAL lista, mesmo sem citar o assunto ("manda o resto dos
// nomes" é a fala do caso real). Dispensa assunto: cai no padrão `pix`, que é a única lista de
// nomes que o TOM publica no grupo da unidade.
const RE_LISTA_FORTE = /\blista (completa|inteira|toda|cheia)\b|\btod[oa]s os (nomes|clientes)\b|\b(resto|restante)( d[aoe]s?)? ?(nomes?|clientes?|lista)\b|\bmais nomes\b|\boutros nomes\b|\blista de nomes\b/;
// LISTA FRACA — pede nomes, mas só vale com assunto na mesma fala ("manda a lista do pix").
const RE_LISTA_FRACA = /\blista\b|\bnomes?\b|\brelacao\b|\bquem (ainda )?falta\b/;
// "quem falta?" seco é pedido de lista; "quem falta assinar o ponto hoje de manhã?" não é. O que
// separa os dois é o resto da frase — por isso o corte por tamanho, e não uma lista de exceções.
const RE_QUEM_FALTA = /\bquem (ainda )?(falta|esta faltando|nao)\b/;
const TETO_PALAVRAS_QUEM_FALTA = 5;

const RE_NUMEROS = /\bquant[oa]s?\b|\bquanto falta\b|\btotal\b|\bnumeros?\b|\bquantidade\b/;
// Gate barato do turno (não lê a fonte em toda mensagem do grupo): a fala precisa citar um dos
// assuntos OU falar de quantidade/falta.
const RE_GATE_NUMEROS = /\bpix\b|\bautomatico\b|\bmigra(r|cao|ram|ndo|m)?\b|\banamneses?\b|\bcontratos?\b|\bquant[oa]s?\b|\bfalta(m|ndo)?\b/;

function _alvoDoTexto(t) {
  let achados = [];
  for (const [nome, re] of ASSUNTOS) if (re.test(t)) achados.push(nome);
  // "cartão avulso"/"maquininha" também casa /\bavulso\b/ — a fatia mais específica ganha.
  if (achados.includes('cartao_avulso')) achados = achados.filter((a) => a !== 'pix_avulso');
  const familias = new Set(achados.map(familiaDoAlvo));
  if (familias.size > 1) return 'tudo';
  if (RE_TUDO.test(t) && (achados.length || RE_PIX.test(t))) return 'tudo';
  if (achados.length > 1) return 'pix'; // várias fatias na mesma fala -> panorama do PIX
  if (achados.length === 1) return achados[0];
  if (RE_PIX.test(t)) return 'pix';
  return null;
}

// detectarPedido(texto) -> { tipo: 'lista' | 'numeros', alvo } | null
// `lista` ganha de `numeros` quando as duas casam ("me manda a lista e quantos são"): mandar os
// nomes já responde a quantidade, o contrário não.
function detectarPedido(texto) {
  const t = _norm(texto);
  if (!t) return null;
  const alvo = _alvoDoTexto(t);
  const curto = t.split(' ').filter(Boolean).length <= TETO_PALAVRAS_QUEM_FALTA;
  const forte = RE_LISTA_FORTE.test(t) || (RE_QUEM_FALTA.test(t) && curto);
  if (alvo) {
    if (forte || RE_LISTA_FRACA.test(t)) return { tipo: 'lista', alvo };
    if (RE_NUMEROS.test(t)) return { tipo: 'numeros', alvo };
    return null; // citar o assunto sem pedir nada não é pergunta
  }
  if (forte) return { tipo: 'lista', alvo: 'pix' };
  return null;
}

function precisaDeNumeros(texto) {
  const t = _norm(texto);
  return !!t && RE_GATE_NUMEROS.test(t);
}

const TITULO_EXTRA = {
  pix: 'PIX automático — quem falta migrar',
  tudo: 'PIX automático — quem falta migrar',
  ja_migrou: 'Já migraram',
  anamnese: 'Anamnese pendente',
  contrato: 'Contrato pendente',
};
function tituloDoAlvo(alvo) {
  if (TITULO_EXTRA[alvo]) return TITULO_EXTRA[alvo];
  return (ROTULO[alvo] && ROTULO[alvo].nome) || TITULO_EXTRA.pix;
}

// ── LISTA DE NOMES, QUEBRADA EM MENSAGENS DE WHATSAPP ─────────────────────────────────────────
// Lista vazia NÃO devolve array vazio: um pedido respondido com silêncio é exatamente o que este
// arquivo existe pra acabar. Devolve UMA mensagem dizendo que não há ninguém.
function mensagensDaLista({ unidadeNome, titulo, itens, limitePorMensagem = LIMITE_POR_MENSAGEM }) {
  const lista = itens || [];
  const lim = Math.max(1, Number(limitePorMensagem) || LIMITE_POR_MENSAGEM);
  const n = lista.length;
  const cab = (i, y) => `💠 *${titulo} — ${unidadeNome}* (${n} clientes) — parte ${i}/${y}`;
  if (!n) return [`${cab(1, 1)}\nNinguém nesta lista agora.`];
  const partes = Math.min(TETO_MENSAGENS, Math.ceil(n / lim));
  const mostrados = Math.min(n, partes * lim);
  const fora = n - mostrados;
  const out = [];
  for (let i = 0; i < partes; i++) {
    const fatia = lista.slice(i * lim, Math.min((i + 1) * lim, mostrados));
    const corpo = fatia.map((it) => `• ${it.pagador}${(it.alunos || []).length ? ` — ${it.alunos.join(', ')}` : ''}`).join('\n');
    let txt = `${cab(i + 1, partes)}\n${corpo}`;
    if (i === partes - 1 && fora > 0) {
      txt += `\n_Ficaram ${fora} de fora desta lista — o resto sai pelo painel do LA Report._`;
    }
    out.push(txt);
  }
  return out;
}

// ── BLOCO DE NÚMEROS PRO PROMPT DO LLM ────────────────────────────────────────────────────────
// Vai pro prompt como contexto novo (`numerosContext`), no mesmo estilo de `notesContext`. Não
// intercepta nada: qualquer forma de perguntar quantidade passa a ser respondida com o número
// CERTO, na voz do TOM. Fonte que não respondeu vira uma linha DIZENDO isso — nunca um número.
const NOMES_FORA = [['nao_mexe', 'não mexe'], ['inadimplente', 'inadimplente'], ['nao_pagante', 'não pagante'], ['excecao', 'exceção'], ['outras', 'outras']];

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
  if (anamnese) L.push(`Anamnese: ${anamnese.pendentes} pendentes de ${anamnese.base} alunos`);
  if (contrato) L.push(`Contrato: ${contrato.pendentes} pendentes de ${contrato.base} alunos`);
  if (!anamnese || !contrato) L.push('Anamnese/contrato: NÃO CONSEGUI LER a fonte agora — não afirme número de anamnese nem de contrato nesta resposta.');
  const quando = _dataBr(dadoEm);
  if (quando) L.push(`Dado do LA Report atualizado em ${quando}${dadoDeHoje === false ? ' (NÃO é de hoje — diga isso se for cobrar alguém)' : ''}.`);
  if (motivo) L.push(`(falha de leitura: ${motivo})`);
  L.push('Estes números vêm da fonte agora. Use SOMENTE eles para falar de quantidade; se a pessoa pedir a lista de nomes, diga que é só pedir "lista completa do <assunto>". Nunca estime.');
  return L.join('\n');
}

module.exports = {
  LIMITE_POR_MENSAGEM, TETO_MENSAGENS, TEXTO_SEM_UNIDADE, TEXTO_FONTE_FORA,
  detectarPedido, precisaDeNumeros, tituloDoAlvo, mensagensDaLista, blocoDeNumeros,
};
