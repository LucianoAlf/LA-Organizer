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

// OFERTA CONDICIONAL (Ana Paula, 15/08 22:01) — o verbo de promessa é o CONSEQUENTE de um
// pedido futuro do usuário ("qualquer coisa, só manda que eu registro"). Não é compromisso
// deste turno: não há ação pendente, logo não há vazio a rebaixar. Exige o gatilho E o "que
// eu" na MESMA frase — sem isso, "vou criar a tarefa e qualquer coisa te aviso às 15h" (uma
// promessa de verdade) escaparia pelo "qualquer coisa".
const OFERTA_CONDICIONAL_RE =
  /(?:\b(?:se|quando)\s+(?:voc[êe]\s+)?(?:precisar|quiser|surgir|aparecer)\b|\bqualquer\s+coisa\b|(?:[ée]\s+)?\bs[óo]\s+(?:me\s+)?(?:mandar?|chamar?|falar?|avisar?|pedir?)\b|\bme\s+(?:manda|chama|fala|avisa)\b)[^.!?]*\bque\s+eu\b/i;

// Rebaixa promessa comprovadamente vazia: remove a(s) linha(s) de promessa e anexa o aviso
// honesto (lição Ana 30/06: anexar SEM remover = contradição intra-mensagem). Puro; o engine
// só chama quando JÁ PROVOU o vazio (actionable + zero markers + retry não persistiu).
function downgradeEmptyPromise(text) {
  const s = String(text || '');
  const ehPromessa = (t) => REPLY_PROMISE_RE.test(t) && !OFERTA_CONDICIONAL_RE.test(t);
  const linhas = s.split('\n');
  if (!linhas.some(ehPromessa)) return { reply: s, fired: false };
  // Dropar TODA linha em branco (como era) colapsa também o separador entre duas linhas
  // MANTIDAS. O reply segue daqui para o chokepoint (engine ~13946), que remove a claim junto
  // com o parágrafo dela — sem o separador, o bloco de conteúdo vira parte da claim e some.
  // Caso Dudu 27/08 18:51: o pedido dos cabos voltou como duas notas de erro e nada mais.
  const kept = linhas.filter((line) => !ehPromessa(line));
  const stripped = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    reply: stripped ? `${stripped}\n\n${PROMISE_NOMARKER_DISCLAIMER}` : PROMISE_NOMARKER_DISCLAIMER,
    fired: true,
  };
}

module.exports = { downgradeEmptyPromise, REPLY_PROMISE_RE, PROMISE_NOMARKER_DISCLAIMER, OFERTA_CONDICIONAL_RE };
