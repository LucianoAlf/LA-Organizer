'use strict';
// eco-relato-usuario.js — a pessoa RELATOU o que ELA fez, e o TOM só repetiu. PURO.
//
// O CASO (achado a0a688e2, Dudu, 16/09 21:39). Áudio: "hoje eu já fiz a ronda, tá tudo certo,
// cabo, caixa de som, amplificador, tudo ok". O modelo respondeu certo — repetiu o relato e pediu
// confirmação: "Entendi, Dudu: • ✅ Ronda de hoje feita • ✅ Cabo, caixa de som e amplificador
// funcionando • ✅ Tudo certo — Certo?". Não havia nada pra gravar (nenhuma tarefa de ronda). A
// trava de honestidade (lib/optimistic-confirm.js) leu "✅ … feita" como o TOM afirmando escrita
// própria, apagou as linhas e mandou "Na real não consegui registrar isso agora — me manda de
// novo". A pessoa fez a parte dela e levou bronca da máquina.
//
// A RAIZ, medida pelo próprio TOM em 20/09 sobre os 39 disparos: 23% são ECO do relato da pessoa
// (a trava come verdade), 46% são afirmação de escrita própria (a trava ACERTA). O que separa as
// duas metades não está no texto do TOM — está em QUEM fez a ação, e isso mora na fala da pessoa
// no mesmo turno, que a trava nunca via. O veto que existia pra essa classe (isReportedStateClaim)
// exige agente terceiro nomeado ("pela Krissya") e desarma com qualquer ✅: alcançava 0 de 39.
//
// Este detector lê a fala da PESSOA e só libera quando TODAS valem:
//   1. ela RELATA ação própria no passado ("já fiz", "conferi", "paguei") E não pede nada ao TOM;
//   2. a resposta NÃO tem o TOM em 1ª pessoa de escrita ("criei", "registrei", "marquei");
//   3. toda linha acusada pela trava retoma alguma palavra do relato dela;
//   4. nenhuma linha acusada usa particípio de ESCRITA NO SISTEMA ("marcado", "registrado",
//      "concluído", "criado") — "✅ Boleto marcado como pago" continua sendo pego.
// Liga na porta `reportedState` que enforceNoMarkerHonesty já tinha: optimistic-confirm.js (em
// parada por 23 commits em 60 dias) não é tocado.
const { hasCompletionClaim, hasWeakCompletionClaim } = require('./optimistic-confirm');

const RELATO_PROPRIO_RE = /(?<![\p{L}])(?:fiz|fizemos|terminei|terminamos|acabei|finalizei|entreguei|mandei|enviei|paguei|pagamos|liguei|resolvi|resolvemos|verifiquei|conferi|chequei|olhei|arrumei|troquei|montei|limpei|testei|levei|busquei|comprei|falei|avisei|passei|recebi|devolvi|consertei)(?![\p{L}])|(?<![\p{L}])j[áa]\s+(?:foi|t[áa]|est[áa])\s+(?:feit|pag|entregu|resolvid|conferid|verificad|arrumad|consertad)/iu;
const PEDIDO_RE = /(?<![\p{L}])(?:marca|marque|marcar|anota|anote|anotar|registra|registre|registrar|cria|crie|criar|lan[çc]a|lance|lan[çc]ar|agenda|agende|agendar|coloca|coloque|colocar|bota|botar|p[õo]e|d[áa]\s+baixa|dar\s+baixa|me\s+lembr[ae]|lembra\s+(?:de|que)|conclui|finaliza|cancela|apaga|exclui)(?![\p{L}])/iu;
const TOM_ESCREVEU_RE = /(?<![\p{L}])(?:criei|registrei|anotei|agendei|marquei|salvei|lancei|cadastrei|atualizei|conclu[íi]|finalizei|fechei|coloquei|botei|dei\s+baixa)(?![\p{L}])/iu;
const PARTICIPIO_ESCRITA_RE = /(?<![\p{L}])(?:marcad|registrad|anotad|salv|gravad|lan[çc]ad|criad|agendad|cadastrad|baixad|atualizad|conclu[íi]d|finalizad|encerrad|fechad|confirmad)[oa]s?(?![\p{L}])/iu;

const _PARADAS = new Set(['hoje', 'ontem', 'amanha', 'tudo', 'certo', 'para', 'pelo', 'pela', 'esse', 'essa', 'isso', 'este', 'esta', 'como', 'sobre', 'mais', 'muito', 'ainda', 'aqui', 'agora', 'entendi', 'beleza', 'feito', 'feita']);
function _norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function _palavras(s) { return new Set((_norm(s).match(/[a-z]{4,}/g) || []).filter((w) => !_PARADAS.has(w))); }

function ecoDoRelatoDoUsuario(userText, reply) {
  const u = String(userText == null ? '' : userText);
  const r = String(reply == null ? '' : reply);
  if (!u.trim() || !r.trim()) return false;
  if (!RELATO_PROPRIO_RE.test(u) || PEDIDO_RE.test(u)) return false; // (1)
  if (TOM_ESCREVEU_RE.test(r)) return false;                        // (2)
  const acusadas = r.split('\n').filter((l) => l.trim() && (hasCompletionClaim(l) || hasWeakCompletionClaim(l)));
  if (!acusadas.length) return false;
  const doRelato = _palavras(u);
  return acusadas.every((l) => !PARTICIPIO_ESCRITA_RE.test(l)       // (4)
    && [..._palavras(l)].some((w) => doRelato.has(w)));             // (3)
}

module.exports = { ecoDoRelatoDoUsuario };
