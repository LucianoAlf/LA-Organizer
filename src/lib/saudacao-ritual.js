// src/lib/saudacao-ritual.js
// SAUDACAO-NOME-ERRADO (Peterson 29/09 19:04 BRT) — o fechamento do Peterson abriu com
// "Alf, fechamento. 😬". Raiz: a skill rituais-diarios traz TODOS os exemplos de saudação
// com o nome "Alf" ("Alf, fechamento. 😬", "Fechamento do dia, Alf 👽", "Bom dia, Alf"),
// e o nome do destinatário só chegava ao modelo como um dado a mais no contexto. O modelo
// copiou o exemplo literal. `skills/` é veto do dono — o conserto é no ENGINE, em 3 camadas:
//   1. o prompt ganha uma seção que NOMEIA o destinatário e proíbe qualquer outro nome;
//   2. o modelo escreve o marcador {NOME} e é o CÓDIGO que põe o nome (determinístico);
//   3. pós-checagem: saudação endereçada a outra pessoa na 1ª linha é reescrita.
//
// PURO: sem banco, sem LLM. Rodar: node --test src/lib/saudacao-ritual.test.js
'use strict';

// Nome usado nos EXEMPLOS da skill — sempre suspeito numa saudação a outra pessoa, mesmo
// que a lista de colaboradores não carregue (falha de I/O não desliga a guarda).
const NOME_DOS_EXEMPLOS = 'Alf';

const MARCADOR_RE = /\{\{?\s*NOME\s*\}?\}/g;

// Token de nome próprio: começa em maiúscula, >= 3 letras. Corta "[QA]", "da", "de", "01".
const TOKEN_NOME_RE = /^\p{Lu}[\p{L}'-]{2,}$/u;
const NAO_NOME = new Set(['Replay', 'Admin', 'Marketing']);

function tokens(s) {
  return String(s || '').split(/\s+/).map((t) => t.trim()).filter((t) => TOKEN_NOME_RE.test(t) && !NAO_NOME.has(t));
}

// Todos os jeitos de chamar ESTA pessoa (full_name, preferred_name, aliases). O Alf é
// "Luciano Alf"/preferred "Alf" — chamá-lo de Alf é certo, não é nome alheio.
function nomesDoColaborador(c) {
  if (!c) return [];
  const out = new Set([...tokens(c.full_name), ...tokens(c.preferred_name)]);
  for (const a of (Array.isArray(c.aliases) ? c.aliases : [])) for (const t of tokens(a)) out.add(t);
  return [...out];
}

// Nomes de OUTRAS pessoas (qualquer colaborador que não seja o destinatário) + o nome dos
// exemplos da skill. Um token que também é do destinatário (homônimo parcial) nunca entra.
function nomesDeTerceiros(todos, destinatario) {
  const meus = new Set(nomesDoColaborador(destinatario));
  const out = new Set();
  for (const c of (Array.isArray(todos) ? todos : [])) {
    if (!c || (destinatario && c.id === destinatario.id)) continue;
    for (const t of nomesDoColaborador(c)) if (!meus.has(t)) out.add(t);
  }
  if (!meus.has(NOME_DOS_EXEMPLOS)) out.add(NOME_DOS_EXEMPLOS);
  return [...out];
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Vocativo = o nome em posição de CHAMAMENTO: início da linha, depois de vírgula, ou depois
// de uma palavra de saudação; e seguido de pontuação, emoji ou fim de linha. "o Alf pediu"
// (artigo antes, letra depois) não é vocativo — menção a terceiro fica intacta.
const SAUDACAO = "(?:[Bb]om dia|[Bb]oa tarde|[Bb]oa noite|[Ee] a[íi]|[Oo]i|[Oo]l[áa]|[Ee]i|[Ff]ala)";
function vocativoRe(nome) {
  return new RegExp(
    `(^|,\\s*|${SAUDACAO},?\\s+)([*_]?)${escapeRe(nome)}([*_]?)(?=\\s*[,!.?:;…]|\\s+[^\\p{L}\\p{N}\\s]|\\s*$)`,
    'u');
}

function indiceDaAbertura(linhas) {
  const i = linhas.findIndex((l) => l.trim() !== '');
  return i < 0 ? 0 : i;
}

// Quais nomes ALHEIOS aparecem como vocativo na abertura (1ª linha não vazia).
function saudacaoAlheia(texto, { outrosNomes = [], nomesDoDestinatario = [] } = {}) {
  const linhas = String(texto || '').split('\n');
  const abertura = linhas[indiceDaAbertura(linhas)] || '';
  const meus = new Set(nomesDoDestinatario);
  return outrosNomes.filter((n) => !meus.has(n) && vocativoRe(n).test(abertura));
}

// Preenche {NOME} e reescreve saudação endereçada a outra pessoa. Só a ABERTURA é tocada
// (é onde mora a saudação); o corpo pode citar o Alf legitimamente ("tarefa do Alf").
function aplicarNomeDoDestinatario(texto, { nome, outrosNomes = [], nomesDoDestinatario = [] } = {}) {
  const alvo = String(nome || '').trim();
  let out = String(texto || '');
  if (!alvo) return { texto: out, trocas: [] };
  out = out.replace(MARCADOR_RE, alvo);
  const linhas = out.split('\n');
  const i = indiceDaAbertura(linhas);
  const trocas = [];
  for (const n of saudacaoAlheia(out, { outrosNomes, nomesDoDestinatario })) {
    linhas[i] = linhas[i].replace(vocativoRe(n), (_m, pre, a, b) => `${pre}${a}${alvo}${b}`);
    trocas.push({ de: n, para: alvo });
  }
  return { texto: linhas.join('\n'), trocas };
}

function secaoDoDestinatario(nome) {
  return [
    '### 👤 DESTINATÁRIO DESTA MENSAGEM',
    `Esta mensagem vai para *${nome}* — e só para essa pessoa.`,
    `Os exemplos da skill usam "${NOME_DOS_EXEMPLOS}" apenas como nome de EXEMPLO: NUNCA copie esse nome nem chame a pessoa por qualquer outro nome.`,
    'Na saudação, escreva o marcador {NOME} no lugar do nome (ex.: "{NOME}, fechamento. 😬" ou "Fechamento do dia, {NOME} 👽") — o sistema troca pelo nome certo.',
  ].join('\n');
}

module.exports = { aplicarNomeDoDestinatario, saudacaoAlheia, secaoDoDestinatario, nomesDoColaborador,
  nomesDeTerceiros, NOME_DOS_EXEMPLOS };
