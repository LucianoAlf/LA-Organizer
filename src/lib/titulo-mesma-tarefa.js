'use strict';
// titulo-mesma-tarefa.js — "estes dois títulos são a MESMA tarefa?" (TITULO-REESCRITO, 29/09).
//
// Por que existe. Duas checagens decidiam existência/duplicata de tarefa na criação, e as duas
// erravam em direções opostas:
//  - dupguard (detectDuplicateSemanticTask): Jaro-Winkler do título + boost por palavra
//    capitalizada em comum. Prefixo genérico ("Follow up ...") + palavra genérica ("Session")
//    davam 1.00 — 29/09 20:28 (Yuri) "Follow Up Eventos Jordan (Gospel Session e Liverpool Day)"
//    foi barrada como duplicata de "Follow up L.A Session com Jereh (ver se Alves gravou)".
//  - prova de existência da delegação (delegacao-itens-resolve): ilike '%titulo%'. O TOM reescreve
//    o título ao gravar ("ver o vídeo da Vitória" → "Ver o vídeo de registro de visitas (postado
//    pela Vitória no grupo)"), o trecho não aparece contíguo e a tarefa existente vira "nova".
//
// Regra (conservadora, medida no conjunto rotulado titulo-mesma-tarefa.rotulado.js):
//   tokens de CONTEÚDO = palavras normalizadas (sem acento/caixa/pontuação), sem stopword e sem
//   verbo/muleta genérica de tarefa ("ver", "fazer", "falar", "follow up", "pagar"...), plural
//   simples reduzido. MESMA quando TODOS os tokens do título menor estão no maior (contenção 1.0)
//   e o menor tem pelo menos 2 tokens — um nome sozinho ("Norton", "Jereh") não prova nada.
//   Título idêntico depois de normalizar é sempre MESMA.
//   Negação de um lado só ("Lead compareceu" × "Lead não compareceu") = DIFERENTE (replay de grupo).
// Não enxerga sinônimo sem palavra em comum ("folha" × "sistema") — limite declarado no conjunto.
// Puro, sem I/O, nunca lança.

const MIN_TOKENS_CONTEUDO = 2;

// Palavras de função (PT) — não distinguem tarefa nenhuma.
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'no', 'na', 'nos', 'nas', 'em', 'com', 'sem', 'ao', 'aos', 'por', 'pelo', 'pela', 'pelos', 'pelas',
  'para', 'pra', 'pro', 'pras', 'pros', 'que', 'se', 'sobre', 'ate', 'entre', 'ou', 'mas',
  'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'isso', 'isto', 'aquele', 'aquela',
  'meu', 'minha', 'seu', 'sua', 'me', 'te', 'lhe', 'ele', 'ela', 'eles', 'elas', 'voce', 'eu', 'the',
]);

// Verbos/muletas genéricas de tarefa: o TOM troca um pelo outro ao reescrever ("falar com" →
// "conversar com", "fazer follow up" → "Follow up") e eles nunca são o que distingue duas tarefas.
const GENERICAS = new Set([
  'ver', 'assistir', 'fazer', 'falar', 'conversar', 'ligar', 'chamar', 'contatar', 'follow', 'up', 'followup',
  'enviar', 'mandar', 'verificar', 'checar', 'conferir', 'revisar', 'pagar', 'lembrar', 'lembra', 'lembrete',
  'avisar', 'perguntar', 'cobrar', 'resolver', 'tarefa', 'tom',
  'hoje', 'amanha', 'depois', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo',
  'feira', 'hrs', 'hr', 'horas', 'hora', 'min',
]);

function _base(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // acento fora; "ª" vira "a"
    .toLowerCase()
    .replace(/(\p{L})\.(?=\p{L})/gu, '$1')              // "L.A" → "la", "gov.br" → "govbr"
    .replace(/(\d)(\p{L})/gu, '$1 $2')                   // "20A" → "20 a", "18h" → "18 h"
    .replace(/(\p{L})(\d)/gu, '$1 $2')                   // "R$500" → "r 500"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Radical leve (sem dicionário): plural, desinência verbal/particípio e vogal final. O TOM troca
// a forma da palavra ao reescrever ("que a Vitória postou" → "postado pela Vitória"; "registrar"
// × "registro"). Só corta se sobrarem ≥ 4 letras.
const _SUFIXOS = ['ando', 'endo', 'indo', 'aram', 'eram', 'iram', 'ado', 'ada', 'ido', 'ida', 'ou', 'ar', 'er', 'ir'];
// Polaridade: "não/nunca/nem" some junto com as stopwords, mas inverte a tarefa.
const _NEGACAO = /(^| )(nao|nunca|nem)( |$)/;
function _negado(base) { return _NEGACAO.test(base); }

function _radical(w) {
  if (/\d/.test(w) || w.length <= 4) return w;
  let r = w;
  if (r.endsWith('oes') || r.endsWith('aes')) r = r.slice(0, -3) + 'ao'; // violões → violao
  else if (r.endsWith('s')) r = r.slice(0, -1);                         // visitas → visita
  for (const suf of _SUFIXOS) {
    if (r.endsWith(suf) && r.length - suf.length >= 4) { r = r.slice(0, -suf.length); break; }
  }
  if (/[aeo]$/.test(r) && r.length - 1 >= 4) r = r.slice(0, -1);
  return r;
}

/** Conjunto de tokens de conteúdo do título (ordem de aparição). */
function tokensDoTitulo(titulo) {
  const out = new Set();
  const b = _base(titulo);
  if (!b) return out;
  for (const w of b.split(' ')) {
    if (!w) continue;
    if (w.length === 1 && !/\d/.test(w)) continue; // letra solta ("a" do "20A", "h" do "18h")
    if (STOPWORDS.has(w) || GENERICAS.has(w)) continue;
    const r = _radical(w);
    if (GENERICAS.has(r)) continue;
    out.add(r);
  }
  return out;
}

/**
 * @returns {{mesma:boolean, contencao:number, jaccard:number, comuns:number, menor:number}}
 *   contencao = fração dos tokens do título MENOR presentes no maior (0..1).
 */
function mesmaTarefa(a, b) {
  const na = _base(a);
  const nb = _base(b);
  if (!na || !nb) return { mesma: false, contencao: 0, jaccard: 0, comuns: 0, menor: 0 };
  const A = tokensDoTitulo(a);
  const B = tokensDoTitulo(b);
  const [menor, maior] = A.size <= B.size ? [A, B] : [B, A];
  let comuns = 0;
  for (const t of menor) if (maior.has(t)) comuns++;
  const contencao = menor.size ? comuns / menor.size : 0;
  const uniao = A.size + B.size - comuns;
  const jaccard = uniao ? comuns / uniao : 0;
  const identico = na === nb;
  const mesmaPolaridade = _negado(na) === _negado(nb);
  const mesma = identico || (mesmaPolaridade && menor.size >= MIN_TOKENS_CONTEUDO && contencao === 1);
  return { mesma, contencao: identico ? 1 : contencao, jaccard: identico ? 1 : jaccard, comuns, menor: menor.size };
}

/**
 * Filtra as linhas cujo título é "a mesma tarefa" que `titulo` — OU contém o trecho (o que o
 * ilike '%titulo%' já achava; nada que era achado deixa de ser).
 */
function tarefasParecidas(rows, titulo) {
  const lista = Array.isArray(rows) ? rows : [];
  const trecho = _base(String(titulo == null ? '' : titulo).slice(0, 60));
  if (!trecho) return [];
  return lista.filter((r) => {
    if (!r || !r.title) return false;
    if (_base(r.title).includes(trecho)) return true;
    return mesmaTarefa(titulo, r.title).mesma;
  });
}

module.exports = { mesmaTarefa, tokensDoTitulo, tarefasParecidas, MIN_TOKENS_CONTEUDO };
