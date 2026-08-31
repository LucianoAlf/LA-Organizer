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
// Duas lacunas medidas no corpus real de 25 disparos (31/08):
//   * gatilho: havia "me manda", faltava "manda pra mim" — a mesma oferta com a ordem
//     invertida. Caso 24/08: "Não consigo jogar o arquivo direto no app, mas manda pra
//     mim — eu leio e registro os itens". A resposta INTEIRA, que já era honesta e já
//     começava admitindo o limite, virou só o aviso de erro.
//   * consequente: exigia literalmente "que eu". Em fala natural o "que" cai e o elo é um
//     travessão ou uma vírgula ("manda pra mim — eu registro").
// O aperto que segura o relaxamento continua sendo a PROXIMIDADE: `[^.!?]*` não atravessa
// fim de frase, então "Registrei o pedido. Amanhã eu passo na loja" não vira oferta, e
// "Vou criar a tarefa e qualquer coisa te aviso às 15h" — o contra-exemplo que o comentário
// original já avisava — segue rebaixando, porque ali não há "eu" nenhum depois do gatilho.
const OFERTA_CONDICIONAL_RE =
  /(?:\b(?:se|quando)\s+(?:voc[êe]\s+)?(?:precisar|quiser|surgir|aparecer)\b|\bqualquer\s+coisa\b|(?:[ée]\s+)?\bs[óo]\s+(?:me\s+)?(?:mandar?|chamar?|falar?|avisar?|pedir?)\b|\bme\s+(?:manda|chama|fala|avisa)\b|\b(?:manda|chama|fala|avisa|passa)\s+(?:pra|para)\s+(?:mim|c[áa])\b)[^.!?]*(?:\bque\s+eu\b|[—–-]\s*eu\b|,\s*eu\b)/i;

// ADMISSÃO DE FALHA não é promessa (bug 01/06, revivido em 27/08 — Rafinha). O engine já sabe
// disso: `_replyIsDecline` (engine.js ~13543) zera `replyHasPromise` quando a reply nega o
// verbo. Só que aquele flag governa a MÉTRICA — o strip daqui re-testava a RE crua, não via a
// negação, e apagava a linha do mesmo jeito. Como a admissão costuma ser a ÚNICA linha, o user
// recebia só o disclaimer genérico: troca ESTRITAMENTE PIOR, porque o original já era honesto
// e ainda trazia o detalhe e a re-pergunta ("hoje 18h30, terça e quinta 18h30 — é isso?").
//
// A negação precisa colar no verbo: vale a que está IMEDIATAMENTE antes, sem atravessar
// vírgula/conjunção. Em "não consegui criar o evento, mas já registrei a tarefa" o "registrei"
// NÃO está negado — blindar a linha inteira deixaria passar exatamente a mentira que o guard
// existe pra pegar. Por isso a exceção é por OCORRÊNCIA, não por linha.
//
// São três formas de negar a mesma admissão, e o fix de 31/08 só cobria a primeira:
//   1. capacidade no passado — "não consegui registrar", "não deu pra anotar"
//   2. capacidade no futuro  — "não vou conseguir registrar", "não vou dar conta de anotar"
//   3. o PRÓPRIO verbo       — "não registrei ainda", "não anotei isso"
// A (3) é a mais direta e era a que mais escapava: sem auxiliar nenhum, a negação encosta no
// verbo, e o slice anterior é literalmente "não ". Por isso o branch dela exige o fim de
// string logo após o advérbio — "não consegui criar o evento, mas já registrei" continua
// caindo, porque ali o que encosta em "registrei" é "já", não "não".
const NEGACAO_ANTES_RE =
  /\b(?:n[ãa]o|nunca|nem)\s+(?:(?:vou|vai|vamos|v[ãa]o)\s+)?(?:consigo|consegui|consegue|conseguimos|conseguir|posso|pude|podia|poder|d[áa]|deu|dava|dar\s+conta\s+de|rola|rolou|rolar|tem\s+como|tenho\s+como|tinha\s+como)\s+(?:pra|para|de|que|a)?\s*$|\b(?:n[ãa]o|nunca|nem)\s+$/i;

// Rebaixa promessa comprovadamente vazia: remove a(s) linha(s) de promessa e anexa o aviso
// honesto (lição Ana 30/06: anexar SEM remover = contradição intra-mensagem). Puro; o engine
// só chama quando JÁ PROVOU o vazio (actionable + zero markers + retry não persistiu).
function downgradeEmptyPromise(text) {
  const s = String(text || '');
  const ehPromessa = (t) => {
    if (OFERTA_CONDICIONAL_RE.test(t)) return false;
    const re = new RegExp(REPLY_PROMISE_RE.source, 'gi');
    let m;
    while ((m = re.exec(t)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      if (!NEGACAO_ANTES_RE.test(t.slice(0, m.index))) return true;
    }
    return false;
  };
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
