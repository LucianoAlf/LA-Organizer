'use strict';

// PROMISE-NOMARKER-DOWNGRADE (audit 01/07, Reunião Time Gestão ×2 — Codex pós-timeout).
//
// Buraco: o guardrail Sprint 28.2 detecta ACTIONABLE_NO_MARKER e tenta o auto-retry, mas
// por design "não toca na reply visual". Quando o retry FALHA/skipa (NO_MARKER — ex.: a
// promessa é de EVENTO/convite, fora do escopo do retry), a promessa vazia segue pro user
// como verdade: "Vou criar na agenda e disparar pros 8 confirmarem presença" — e NADA existe
// no banco. O chokepoint (Camada 1) não pega: o gate dele é verbo de CONCLUSÃO ("criei/✅"),
// não promessa FUTURA ("vou criar"). Irmão de coord-send-honesty (que cobre afirmação de
// ENVIO passado); este cobre PROMESSA sem persistência comprovada.
//
// A REPLY_PROMISE_RE morava inline no engine (Sprint 28.2, com as lições de 01/06 nos
// comentários de lá) — movida pra cá VERBATIM pra ser a fonte única: o mesmo vocabulário
// que dispara o retry decide o strip. O engine importa daqui.
const REPLY_PROMISE_RE = /(?:lembrete|lembro|te\s+(?:aviso|cobro|lembro))\s+(?:hoje\s+|amanh[aã]\s+|j[aá]\s+|de\s+novo\s+|mais\s+tarde\s+)?(?:[aà]s?\s+|nas?\s+)?\d{1,2}\s*[h:]|(?:reagendei|reagendo|reagendado|reagendamento|marquei\s+(?:pra|para)|agendei\s+(?:pra|para)|coloquei\s+(?:pra|para)|movi\s+(?:pra|para))\s+(?:hoje|amanh[aã]|segunda|terça|quarta|quinta|sexta|sábado|domingo|próxima|semana\s+que\s+vem|\d{1,2}\/\d{1,2})|\b(?:registr(?:ar|ei|ando|o)|anot(?:ar|ei|ando|ado)|adicion(?:ar|ei|ando|ado|o)|juntando|criando|criei|vou\s+criar|crio\s+as?|colocando\s+(?:na|no)\s+(?:lista|pacote|fila)|(?:t[oô]|estou)\s+(?:adicionando|registrando|anotando|criando)|adicionando\s+ao\s+pacote)\b/i;

// Sem verbo que casa REPLY_PROMISE_RE nem SEND_CLAIM_RE (não pode ser comido por outra rede).
const PROMISE_NOMARKER_DISCLAIMER =
  '_⚠️ Na real: deu um problema técnico e essa ação NÃO foi executada — nada entrou na agenda e ninguém foi acionado. Me pede de novo que eu faço na hora._';

// Rebaixa promessa comprovadamente vazia: remove a(s) linha(s) de promessa e anexa o aviso
// honesto (lição Ana 30/06: anexar SEM remover = contradição intra-mensagem). Puro; o engine
// só chama quando JÁ PROVOU o vazio (actionable + zero markers + retry não persistiu).
function downgradeEmptyPromise(text) {
  const s = String(text || '');
  if (!REPLY_PROMISE_RE.test(s)) return { reply: s, fired: false };
  const kept = s
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false; // colapsa linhas em branco órfãs (espelha coord-send-honesty)
      return !REPLY_PROMISE_RE.test(line);
    });
  const stripped = kept.join('\n').trim();
  return {
    reply: stripped ? `${stripped}\n\n${PROMISE_NOMARKER_DISCLAIMER}` : PROMISE_NOMARKER_DISCLAIMER,
    fired: true,
  };
}

module.exports = { downgradeEmptyPromise, REPLY_PROMISE_RE, PROMISE_NOMARKER_DISCLAIMER };
