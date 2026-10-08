'use strict';
// pergunta-nao-e-afirmacao.js — a linha que a trava acusou é PERGUNTA ou PROPOSTA, não afirmação. PURO.
//
// OS CASOS (varredura de 27/09, disparos reais da trava de honestidade):
//   Hugo 25/09 14:20   "Salvo como *LA Performance Report* ou como link do *Organizer*?"
//                      -> "salvo" aqui é "eu salvo?" (1ª pessoa, pergunta), não "foi salvo".
//   Quintela 23/09 17:19 "Fechando: *Jornada de Cordas* — qua (30/09) às 13h, presencial, com
//                      Luciano (Alf) e Rodrigo." + "Confirma e aviso os dois?"
//                      -> "Fechando:" é o título de uma PROPOSTA que pede confirmação.
// Nos dois a pessoa recebeu "Na real não consegui registrar" colado numa pergunta — o TOM
// pedindo o ok que a própria regra de confirmar-antes-de-agir manda ele pedir.
//
// O que NÃO muda (caso Bianca 09/08, HABIT-UPDATE-SILENT-LIE): "Entendi: quer tirar o lembrete,
// certo?" + "✅ Lembrete removido" — a pergunta está numa linha e a AFIRMAÇÃO em outra. Aqui só
// é liberada a linha acusada que ELA MESMA termina em "?", ou o cabeçalho "Gerúndio:" de proposta
// numa fala que pede confirmação. Qualquer outra linha acusada mantém a trava valendo.
// Liga na porta `reportedState` de enforceNoMarkerHonesty (optimistic-confirm.js intocado).
const { hasCompletionClaim, hasWeakCompletionClaim } = require('./optimistic-confirm');

// Emoji no prefixo (Bianca 07/10: "📋 Fechando:") — o TOM abre proposta com ícone; sem isto a linha virava afirmação.
const CABECALHO_DE_PROPOSTA_RE = /^[\s*_•\-–—>"'\p{Extended_Pictographic}\uFE0F\u200D]*(?:fechando|registrando|anotando|agendando|marcando|criando|montando|resumindo)\s*:/iu;
const PEDE_CONFIRMACAO_RE = /\b(confirma|confirmo|pode ser|fechado|t[áa] certo|certo|ok|posso|quer que eu|sim ou n[ãa]o)\b[^\n]*\?|\?\s*$/iu;
const TOM_ESCREVEU_RE = /(?<![\p{L}])(?:criei|registrei|anotei|agendei|marquei|salvei|lancei|cadastrei|atualizei|conclu[íi]|finalizei|fechei|dei\s+baixa)(?![\p{L}])/iu;

function _termina_em_pergunta(l) { return /\?\s*[*_~)\]]*\s*$/u.test(l); }

function linhasAcusadasSaoPergunta(reply) {
  const r = String(reply == null ? '' : reply);
  if (!r.trim()) return false;
  if (TOM_ESCREVEU_RE.test(r)) return false; // "✅ Marquei… tá certo?" continua afirmação
  const linhas = r.split('\n');
  const acusadas = linhas.filter((l) => l.trim() && (hasCompletionClaim(l) || hasWeakCompletionClaim(l)));
  if (!acusadas.length) return false;
  const pedeConfirmacao = linhas.some((l) => PEDE_CONFIRMACAO_RE.test(l) && _termina_em_pergunta(l));
  return acusadas.every((l) => _termina_em_pergunta(l) || (pedeConfirmacao && CABECALHO_DE_PROPOSTA_RE.test(l)));
}

module.exports = { linhasAcusadasSaoPergunta };
