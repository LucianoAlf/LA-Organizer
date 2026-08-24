'use strict';
// Caminho 2 / Fatia 0 — detector PROVISÓRIO de recusa falsa (derrotismo).
// Impreciso DE PROPÓSITO: aqui é só sinal de WATCH p/ o velocímetro (linha de métrica
// SEPARADA do confab). Na Fatia 1 o `resolve()` torna isso PRECISO (decide se a recusa
// é mentira de fato). PURO, sem I/O.
//
// Casos-alvo (frases reais): Matheus 24/06 "não existe o comando pra isso aqui",
// "vai direto no app", "faz mais de 2 dias", "não tenho como editar pelo chat".

const RE_DEFEAT = /\bn[ãa]o tenho como\b|\bn[ãa]o existe (o )?comando\b|\bn[ãa]o consigo\b|\bn[ãa]o d[áa] pra (fazer|mexer|editar|alterar|apagar|excluir)\b[^.?!]*\bchat\b|\bvai (direto )?(l[áa] )?no app\b|\bmais de \d+ dias?\b/i;

// FINGUARD-DEFEATISM-CROSSDOMAIN-HIJACK (Ana 27/06): "não consigo encaminhar a imagem em si" é
// limitação HONESTA de repassar mídia (TOM não reenvia o binário, mas passa os dados extraídos) —
// NÃO derrotismo. Só o ramo genérico `\bnão consigo\b` casa isso; os outros (não existe comando /
// não tenho como / vai no app / mais de N dias) são recusa-mentira real e ficam intactos. Por isso
// a exclusão é cirúrgica: vale SÓ quando o match é exatamente "não consigo" E a cláusula é
// encaminhar/enviar + objeto-de-mídia. Coexistência: se há OUTRO derrotismo real no texto, ele
// prevalece (a iteração global pega o próximo match não-excluído).
const RE_NAO_CONSIGO = /^n[ãa]o consigo$/i;
const RE_MEDIA_VERB = /^n[ãa]o consigo\s+(?:encaminhar|enviar|mandar|repassar|compartilhar|reenviar)\b/i;
// boundary Unicode-aware: \b é ASCII em JS e falha antes de "áudio"/"vídeo"/"mídia" (inicial
// acentuada); \p{L}\p{N} com flag u resolve e ainda evita substring ("foto" em "fotografia").
const RE_MEDIA_OBJ = /(?<![\p{L}\p{N}])(?:imagem|foto|[áa]udio|print|arquivo|v[íi]deo|m[íi]dia|documento|pdf|anexo)(?![\p{L}\p{N}])/iu;

function isMediaForwardLimitation(text, idx) {
  // cláusula a partir do "não consigo" até o próximo terminador de frase
  const clause = String(text).slice(idx).split(/[.?!\n]/)[0];
  return RE_MEDIA_VERB.test(clause) && RE_MEDIA_OBJ.test(clause);
}

/**
 * @param {string} reply  resposta gerada (texto do LLM)
 * @param {{actionableIntent?:boolean, markerEmitted?:boolean}} ctx
 * @returns {{suspect:boolean, phrase:string|null}}
 */
function detectDefeatism(reply, { actionableIntent = false, markerEmitted = false } = {}) {
  const t = String(reply || '');
  const re = new RegExp(RE_DEFEAT.source, 'gi');
  let phrase = null;
  let m;
  while ((m = re.exec(t)) !== null) {
    // pula a limitação honesta de mídia; segue procurando derrotismo real depois dela
    if (RE_NAO_CONSIGO.test(m[0]) && isMediaForwardLimitation(t, m.index)) continue;
    phrase = m[0];
    break;
  }
  return { suspect: !!phrase && actionableIntent && !markerEmitted, phrase };
}

// RECUSA-FALSA-CAI-COM-SKILL (raiz — Rose 16/07, Matheus 20/08, Juliana 13/07, 9a0a173a): o
// interceptor de derrotismo do engine é gated em skill_active==='financeiro-pessoal'. No turno de
// follow-up/esclarecimento a skill cai (pickSkill decide por palavra de dinheiro no turno) e a
// recusa falsa passa. Cada gatilho estreito de pickSkill patcheava UM fluxo (whack-a-mole, 3
// incidentes). Este predicado escopa a rede por DOMÍNIO, não por skill: True quando a fala é uma
// recusa/redirect de CAPACIDADE FINANCEIRA (lançar/registrar/salvar transação/gasto/estorno) na
// MESMA cláusula — a capacidade EXISTE (register_transaction em FINANCE_ACTIONS), então é sempre
// mentira. FAIL-CLOSED: exclui limitação de CONSULTA (achar/ver/buscar — honesta) e exige objeto
// financeiro (não sequestra recusa não-financeira nem a limitação de mídia do detectDefeatism).
const _DENY_RE = /\bn[ãa]o consigo\b|\bn[ãa]o tenho como\b|\bn[ãa]o d[áa] pra\b|\bn[ãa]o rola\b|(?:direto\s+)?\bno app\b|m[óo]dulo de finan[çc]|gerencia no app|precisa ser[^.?!]{0,30}\bno app\b/i;
const _FIN_OBJ_RE = /lan[çc]a(?:r|mento|ndo|mentos)?\b|transa[çc][ãa]o|transa[çc][õo]es|financeir[oa]s?\b|\bestorno\b|\bgasto\b|\bdespesa\b|\breceita\b/i;
const _FIND_RE = /\b(?:achar|encontrar|localizar|ver|visualizar|mostrar|puxar|buscar|acessar|consultar|listar)\b/i;

function isFinanceCapabilityDenial(reply) {
  const t = String(reply || '');
  if (!t.trim()) return false;
  for (const clause of t.split(/[.?!\n;]+/)) {
    if (_DENY_RE.test(clause) && _FIN_OBJ_RE.test(clause) && !_FIND_RE.test(clause)) return true;
  }
  return false;
}

module.exports = { detectDefeatism, isFinanceCapabilityDenial, RE_DEFEAT };
