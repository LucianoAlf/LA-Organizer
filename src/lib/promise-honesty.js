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
const REPLY_PROMISE_RE = /(?:lembrete|lembro|te\s+(?:aviso|cobro|lembro))\s+(?:hoje\s+|amanh[aã]\s+|j[aá]\s+|de\s+novo\s+|mais\s+tarde\s+)?(?:[aà]s?\s+|nas?\s+)?\d{1,2}\s*[h:]|(?:reagendei|reagendo|reagendado|reagendamento|marquei\s+(?:pra|para)|agendei\s+(?:pra|para)|coloquei\s+(?:pra|para)|movi\s+(?:pra|para))\s+(?:hoje|amanh[aã]|segunda|terça|quarta|quinta|sexta|sábado|domingo|próxima|semana\s+que\s+vem|\d{1,2}\/\d{1,2})|\b(?:registr(?:ar|ei|ando|o)|anot(?:ar|ei|ando|ado)|adicion(?:ar|ei|ando|ado|o)|juntando|criando|criei|vou\s+criar|crio\s+as?|colocando\s+(?:na|no)\s+(?:lista|pacote|fila)|(?:t[oô]|estou)\s+(?:adicionando|registrando|anotando|criando)|adicionando\s+ao\s+pacote)\b|\b(?:vou|irei)\s+parar\s+de\s+(?:te\s+)?cobrar\b|\bparo\s+de\s+(?:te\s+)?cobrar\b/i;

// Sem verbo que casa REPLY_PROMISE_RE nem SEND_CLAIM_RE (não pode ser comido por outra rede).
// NOTA-MENTE-A-CAUSA (Juliana 14/09 19:23): sem marcador tentado, NÃO houve "problema técnico" —
// o TOM simplesmente não fez (às vezes nem tem como fazer). Dizer "deu um problema técnico" é trocar
// uma mentira por outra. O texto técnico só vale quando um marcador foi tentado e rejeitado.
const PROMISE_NOMARKER_DISCLAIMER = '_⚠️ Na real: isso não foi feito — não registrei nada por aqui. Me diz de novo o que você quer que eu faça._';
const PROMISE_FALHOU_DISCLAIMER =  '_⚠️ Na real: deu um problema técnico e essa ação NÃO foi executada — nada entrou na agenda e ninguém foi acionado. Me pede de novo que eu faço na hora._';

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
// OFERTA-E-SO-ME-DIZER (Juliana 14/09): "Quando quiser registrar algum avanço ou prazo, é só me dizer." é
// a pessoa agindo no futuro, não o TOM prometendo agora — mas não tem o "que eu" que o veto abaixo exige,
// e o "registrar" do vocabulário apagava ESSA frase em vez da promessa falsa ao lado dela.
const OFERTA_E_SO_ME_DIZER_RE = /\b(?:se|quando)\s+(?:voc[êe]\s+)?(?:precisar|quiser|surgir|aparecer)\b[^.!?]*[ée]\s+s[óo]\s+(?:me\s+)?(?:dizer|falar|chamar|avisar|mandar|pedir)\b/i;
const OFERTA_CONDICIONAL_RE =  /(?:\b(?:se|quando)\s+(?:voc[êe]\s+)?(?:precisar|quiser|surgir|aparecer)\b|\bqualquer\s+coisa\b|(?:[ée]\s+)?\bs[óo]\s+(?:me\s+)?(?:mandar?|chamar?|falar?|avisar?|pedir?)\b|\bme\s+(?:manda|chama|fala|avisa)\b|\b(?:manda|chama|fala|avisa|passa)\s+(?:pra|para)\s+(?:mim|c[áa])\b)[^.!?]*(?:\bque\s+eu\b|[—–-]\s*eu\b|,\s*eu\b)/i;

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

// LISTAR NAO E PROMETER — LISTAGEM-REBAIXADA-COMO-PROMESSA (medido 09/09/2026).
//
// Quando o TOM APRESENTA o que existe — "Yuri, o que tenho no contexto aqui pra setembro:"
// seguido dos itens, ou "Bora! Aqui o que tá na mesa pra essa semana:" — ele não está
// prometendo nada. Está mostrando. Mas os ITENS carregam o vocabulário da RE: um pendente
// chamado "Perguntar orçamento", outro com "registrar" no título, e a linha do bullet casa
// `REPLY_PROMISE_RE` como se fosse compromisso do turno.
//
// Medido no corpus limpo (32 disparos com o texto original, de 19/08 — antes disso o
// `raw_excerpt` guardava o texto JÁ REBAIXADO e não serve de prova): dos 10 disparos desta
// porta, QUATRO são listagem com bullets e ícone de lista. Dois deles são o caso do Yuri em
// 08/09, que apareceu no relatório de governança da manhã seguinte.
//
// O veto é por LINHA, não pelo texto: a linha do item sai do julgamento e o resto da resposta
// continua sendo avaliado. Assim "Aqui está: • item • item — e vou criar a tarefa" ainda tem
// a promessa da última frase rebaixada, que é o certo. Vetar o texto inteiro por causa de um
// bullet abriria a porta pra mentira embalada em lista.
const LINHA_DE_LISTA_RE = /^\s*(?:[•▪◦‣·]|[-*+]\s|\d+[.)]\s|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*\*)/u;

// PERGUNTA-NAO-MANDA-REPETIR (Rafinha 01/10 16:25 UTC e 02/10 19:21 UTC — a 3ª porta da oferta
// condicional). Duas notas a mais, para quando o rebaixamento acontece numa fala que AINDA PERGUNTA
// algo: "Me diz de novo o que você quer que eu faça" logo abaixo de uma pergunta do TOM manda a
// pessoa se repetir em vez de responder. A afirmação falsa sai do mesmo jeito; a nota só não pede
// pra repetir — pede a resposta, que é o que destrava a escrita. Sem particípio e sem verbo de
// conclusão afirmado: a porta de baixo roda DEPOIS sobre este texto e não pode acusar a própria nota.
// "…que eu sigo", não "…que eu registro": a pergunta que sobra nem sempre é de registro (Clayton 25/09:
// "Mando pro Luciano? *Sim* ou *não*") — a nota não pode prometer a ação errada.
const PROMISE_PERGUNTA_DISCLAIMER = '_⚠️ Na real: ainda não registrei nada por aqui — me responde aí em cima que eu sigo._';
const PROMISE_PERGUNTA_FALHOU_DISCLAIMER = '_⚠️ Na real: deu um problema técnico e ainda não registrei nada — me responde aí em cima que eu tento de novo._';

const { vetoDePergunta, fraseEhPedidoDeConfirmacao, textoTemPergunta } = require('./veto-pergunta');

// Rebaixa promessa comprovadamente vazia: remove a(s) linha(s) de promessa e anexa o aviso
// honesto (lição Ana 30/06: anexar SEM remover = contradição intra-mensagem). Puro; o engine
// só chama quando JÁ PROVOU o vazio (actionable + zero markers + retry não persistiu).
// PROMISE-NOMARKER-CEGO-PRA-ESCRITA-RECENTE (Rafinha 08/09 11:11 BRT): esta porta roda ANTES
// do enforceNoMarkerHonesty (engine ~14884) e reescreve o `reply`, então a porta de baixo nunca
// vê o original — e nenhum dos vetos DELA vale aqui. Reafirmar uma escrita que ACABOU de
// acontecer ("no áudio anterior eu registrei X, era isso mesmo?") casa a REPLY_PROMISE_RE e
// virava "essa ação NÃO foi executada", com as 3 tarefas já no banco havia 4 minutos.
// O mecanismo que separa reafirmação de promessa já existe desde 19/08 (restatesRecentWrite,
// optimistic-confirm.js) — o que faltava era estar ligado nesta porta. Opt AUSENTE ⇒ inerte.
//
// DECISAO-UNICA-DO-VETO-DE-PERGUNTA (03/10): o veto de pergunta/awaitingConfirm que a porta de
// baixo tinha e esta não tinha agora vem de UM lugar só (veto-pergunta.js), usado pelas duas.
// Três saídas, e só elas:
//   intocado  — nada acusado, ou TODA frase acusada é pedido de confirmação ("Confirma esse que
//               eu registro…", Rafinha 02/10), ou o turno está em awaitingConfirm;
//   neutraliza — afirmação/promessa falsa + pergunta de verdade sobrando: sai a frase falsa, ficam
//               as perguntas, e a nota NÃO manda repetir (Rafinha 01/10);
//   rebaixa   — afirmação/promessa falsa sem pergunta: exatamente o comportamento de antes.
// Opts ausentes ⇒ mesmo comportamento de antes em tudo que não é pergunta.
function decidirPromessaSemMarcador(text, opts = {}) {
  const s = String(text || '');
  const o = opts || {};
  if (o.restatesRecentWrite) return { reply: s, fired: false, modo: 'intocado', veto: 'reafirma_escrita' };
  const ehPromessaFrase = (f) => {
    if (OFERTA_CONDICIONAL_RE.test(f) || OFERTA_E_SO_ME_DIZER_RE.test(f)) return false;
    const re = new RegExp(REPLY_PROMISE_RE.source, 'gi');
    let m;
    while ((m = re.exec(f)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      if (!NEGACAO_ANTES_RE.test(f.slice(0, m.index))) return true;
    }
    return false;
  };
  // Item de lista: o TOM está mostrando o que existe, não prometendo agir.
  const ehAcusada = (frase, linha) => !LINHA_DE_LISTA_RE.test(linha) && ehPromessaFrase(frase);
  const vp = vetoDePergunta(s, { awaitingConfirm: !!o.awaitingConfirm, ehAcusada });
  if (vp.veto) return { reply: s, fired: false, modo: 'intocado', veto: vp.motivo };
  // Frase acusada que é pedido de confirmação fica (veto por FRASE, como a oferta condicional):
  // só a afirmação/promessa de verdade sai.
  const fraseCai = (frase, linha) => ehAcusada(frase, linha) && !fraseEhPedidoDeConfirmacao(frase);
  const SPLIT_FRASE = /(?<=[.!?…])\s+/;
  // VETO POR FRASE (Juliana 14/09): a oferta vetava a LINHA inteira — uma promessa falsa na mesma
  // linha ("Vou parar de cobrar. Quando quiser…, é só me dizer.") passava protegida por ela.
  const linhaCai = (linha) => String(linha).split(SPLIT_FRASE).some((f) => fraseCai(f, linha));
  const linhas = s.split('\n');
  if (!linhas.some(linhaCai)) return { reply: s, fired: false, modo: 'intocado', veto: null };
  // Dropar TODA linha em branco (como era) colapsa também o separador entre duas linhas
  // MANTIDAS. O reply segue daqui para o chokepoint (engine ~13946), que remove a claim junto
  // com o parágrafo dela — sem o separador, o bloco de conteúdo vira parte da claim e some.
  // Caso Dudu 27/08 18:51: o pedido dos cabos voltou como duas notas de erro e nada mais.
  // STRIP POR FRASE (Ana 04/09 19:46, finding bb3cbd5d): o veto já raciocina em frase
  // (`OFERTA_CONDICIONAL_RE` usa `[^.!?]*` de propósito) e o strip apagava por LINHA. Quando a
  // promessa divide a linha com conteúdo verdadeiro, o verdadeiro morre junto — "Beleza,
  // anotado! A Mayra segue com isso pra amanhã." chegou como só o disclaimer. Linha sem fim de
  // frase e linha de frase única com promessa seguem caindo inteiras: nenhum caso que o guard
  // já pegava escapa.
  const kept = [];
  for (const line of linhas) {
    if (!linhaCai(line)) { kept.push(line); continue; }
    const resto = line.split(SPLIT_FRASE).filter((frase) => !fraseCai(frase, frase)).join(' ').trim();
    if (resto) kept.push(resto);
  }
  const stripped = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // A pergunta que sobra é medida no texto JÁ limpo: "Registrei tudo, certo?" some inteira e não
  // deixa pergunta nenhuma — ali a nota é a de sempre.
  const neutraliza = !!stripped && textoTemPergunta(stripped);
  // NOTA-MENTE-A-CAUSA (Juliana 14/09): "deu problema técnico" só quando um marcador foi tentado.
  const nota = neutraliza
    ? (o.markerAttempted ? PROMISE_PERGUNTA_FALHOU_DISCLAIMER : PROMISE_PERGUNTA_DISCLAIMER)
    : (o.markerAttempted ? PROMISE_FALHOU_DISCLAIMER : PROMISE_NOMARKER_DISCLAIMER);
  return {
    reply: stripped ? `${stripped}\n\n${nota}` : nota,
    fired: true,
    modo: neutraliza ? 'neutraliza' : 'rebaixa',
    veto: null,
  };
}

// Nome antigo, mesmo contrato ({ reply, fired }) — testes e chamadores antigos seguem valendo.
function downgradeEmptyPromise(text, opts = {}) {
  return decidirPromessaSemMarcador(text, opts);
}

module.exports = { downgradeEmptyPromise, decidirPromessaSemMarcador, REPLY_PROMISE_RE, PROMISE_NOMARKER_DISCLAIMER, PROMISE_FALHOU_DISCLAIMER, PROMISE_PERGUNTA_DISCLAIMER, PROMISE_PERGUNTA_FALHOU_DISCLAIMER, OFERTA_E_SO_ME_DIZER_RE, OFERTA_CONDICIONAL_RE, LINHA_DE_LISTA_RE };
