'use strict';
// delegate-question-parse.js — Fatia 5 (confirmação parse-on-open, delegação).
//
// Extrai os itens {task_title, to_name} da pergunta de delegação do TOM. Formatos reais:
//   A) "Delego pra Mayra … — *'título'*. Confirma?"      (destinatário ANTES do título)
//   B) "Delego a tarefa *título* pro Alf …? Confirma?"    (destinatário DEPOIS do título)
//   C) "Confirma pra eu delegar as duas pra Kailane:\n1. Ligar pro lead — prazo hoje\n2. …"
//      (LISTA numerada/marcada, com ou sem negrito — Krissya 29/09, pending_intents 71086cf0 e
//      3a03bfa2; é o jeito natural de pedir várias de uma vez)
// Puro (sem I/O). A prova no banco (nova × existente × ambígua) é o delegacao-itens-resolve.js.
//
// Item = cada linha de lista (título = negrito, ou o texto antes do 1º " — "/" - "/", prazo") e cada
// bloco em *negrito* fora de lista. Destinatário = nome próprio após pra/pro/para, buscado com os
// blocos em negrito REMOVIDOS (pra não casar nome dentro do título, ex.: "para o pai da Amelie"):
// primeiro no resto da própria linha, depois no cabeçalho mais próximo acima, e por fim no texto
// todo (só se houver UM nome). Dois nomes onde se esperava um → não chuta.
// FAIL-CLOSED: qualquer item sem título OU sem destinatário único → null (a pergunta inteira).

// "delegar" entrou em 30/09 (Krissya 29/09): a prosa real é "Confirma pra eu delegar pra X: *…*?",
// e com a âncora só em "delego" o parser não casou NENHUMA pergunta em 30 dias.
const NEG_RE = /\bn[ãa]o\s+deleg(?:o|ar)\b/i;
const ANCHOR_RE = /\bdeleg(?:o|ar)\b/i;
const BOLD_GLOBAL = /\*([^*\n]+)\*/g;
const NOME = "[A-ZÀ-Ú][\\p{L}'-]*(?:\\s+[A-ZÀ-Ú][\\p{L}'-]*)?";
// Sem \b depois de letra acentuada (falha em JS): fronteira à esquerda por lookbehind de letra.
const DEST_GLOBAL_SRC = `(?<![\\p{L}])(?:[Pp]ra|[Pp]ro|[Pp]ara)\\s+(${NOME})`;
// "pra *Kailane*" — nome em negrito é destinatário, não título: desembrulha antes de tudo.
const DEST_EM_NEGRITO = new RegExp(`(?<![\\p{L}])([Pp]ra|[Pp]ro|[Pp]ara)\\s+\\*(${NOME})\\*`, 'gu');
// Linha de lista: "1." "2)" "-" "•" "* " (asterisco + espaço; "*x*" é negrito, não marcador).
// Emoji-número ("1️⃣") NÃO é lista de tarefa: é o menu "Resolvo/Agendo/Delego" do aviso.
const LISTA_RE = /^\s*(?:\d{1,2}[.)]|[-•●▪◦]|\*(?=\s))\s+(.+?)\s*$/u;
const SEP_RE = /\s+[—–]\s+|\s+-\s+|,\s*(?=prazo(?![\p{L}]))|\s*\((?=prazo(?![\p{L}]))/iu;
const AMBIGUO = Symbol('ambiguo');
// Negrito que é PRAZO, não título ("*quarta*", "*30/09*", "*15h*"): não vira item.
const PRAZO_EM_NEGRITO = /^(?:hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(?:[-\s]feira)?(?![\p{L}])|^\d{1,2}\s*(?:[\/h:]|de\s)/iu;

function _stripAspas(s) {
  return String(s).trim().replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim();
}

function _limpaTitulo(s) {
  return _stripAspas(String(s).replace(/[\s.:;,!?]+$/u, '')).replace(/[\s.:;,!?]+$/u, '').trim();
}

function _semNegrito(s) {
  return String(s).replace(BOLD_GLOBAL, ' ');
}

/** Nome único de destinatário no trecho; null se nenhum; AMBIGUO se 2+ distintos. */
function _nomeUnico(trecho) {
  const re = new RegExp(DEST_GLOBAL_SRC, 'gu');
  const nomes = new Set();
  let m;
  while ((m = re.exec(_semNegrito(trecho))) !== null) nomes.add(m[1].trim());
  if (nomes.size === 0) return null;
  if (nomes.size > 1) return AMBIGUO;
  return [...nomes][0];
}

function _negritos(s) {
  const out = [];
  const re = new RegExp(BOLD_GLOBAL.source, 'g');
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

/**
 * @returns {Array<{task_title:string,to_name:string}>|null}
 */
function parseDelegateConfirmItems(reply) {
  if (typeof reply !== 'string' || !reply.trim()) return null;
  if (NEG_RE.test(reply)) return null;
  if (!ANCHOR_RE.test(reply)) return null;

  const texto = reply.replace(DEST_EM_NEGRITO, '$1 $2');
  const linhas = texto.split(/\r?\n/).map((l) => {
    const m = LISTA_RE.exec(l);
    return m ? { lista: true, corpo: m[1], bruto: l } : { lista: false, corpo: l, bruto: l };
  });

  // Fallback global: nome único em TODA a prosa (fora das linhas de lista).
  const prosa = linhas.filter((l) => !l.lista).map((l) => l.corpo).join('\n');
  const nomeGlobal = _nomeUnico(prosa);

  // Cabeçalho mais próximo ACIMA da linha i que cite alguém.
  const nomeDoCabecalho = (i) => {
    for (let k = i - 1; k >= 0; k--) {
      if (linhas[k].lista) continue;
      const n = _nomeUnico(linhas[k].corpo);
      if (n) return n; // nome ou AMBIGUO — o mais próximo decide
    }
    return nomeGlobal;
  };

  // Com lista, os itens SÃO as linhas da lista; negrito solto na prosa (nome, "*Atenção*") não vira
  // tarefa. Sem lista, cada negrito é um item (antes: só o 1º — e só ele tinha prova no banco).
  const temLista = linhas.some((l) => l.lista);
  const itens = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const negr = _negritos(l.corpo);
    let titulos;
    let resto;
    if (l.lista) {
      if (negr.length) {
        titulos = negr;
        resto = _semNegrito(l.corpo);
      } else {
        const partes = l.corpo.split(SEP_RE);
        titulos = [partes[0]];
        resto = partes.slice(1).join(' ');
      }
    } else {
      if (!negr.length || temLista) continue;
      titulos = negr;
      resto = _semNegrito(l.corpo);
    }
    let to = _nomeUnico(resto);
    if (to === AMBIGUO) return null;
    if (!to) to = l.lista ? nomeDoCabecalho(i) : nomeGlobal;
    if (!to || to === AMBIGUO) return null;
    for (const t of titulos) {
      if (PRAZO_EM_NEGRITO.test(String(t).trim())) continue;
      const task_title = _limpaTitulo(t);
      if (!task_title || task_title.length < 3) return null;
      itens.push({ task_title, to_name: to });
    }
  }
  return itens.length ? itens : null;
}

// Compat (vitalidade-parse-on-open e quem já consumia 1 item): o 1º item da pergunta.
function parseDelegateConfirmQuestion(reply) {
  const itens = parseDelegateConfirmItems(reply);
  return itens ? itens[0] : null;
}

module.exports = { parseDelegateConfirmQuestion, parseDelegateConfirmItems };
