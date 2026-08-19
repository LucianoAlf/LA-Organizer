'use strict';

// AUDIT-OPTIMISTIC-CONFIRM (12/06) — sanitizador pós-marker unificado.
//
// Problema: o LLM gera a frase de sucesso ("✅ Criado!", "fechei todas as
// pendências") ANTES de saber o resultado real, e o engine appenda o erro/parcial
// depois → contradição intra-mensagem. Esta função roda nos ramos de FALHA/PARCIAL
// (e nos blocks de IntegrityCheck) e rebaixa/remove a frase otimista de acordo com
// o resultado REAL (vindo de okCount/failCount no engine, nunca adivinhado do texto).
//
// outcome:
//   'failed'  — nada persistiu  → remove toda confirmação otimista.
//   'partial' — parte persistiu → rebaixa totalizador absoluto ("todas"→"a maioria")
//               e remove confirmações puras sem quantificador.
//   qualquer outro valor → no-op (defensivo; sucesso real nunca passa por aqui).

// ✅ ☑ ✔ ✓ 🆗 🎉 👍 🙌 — emojis que sinalizam "feito".
// ✓ (U+2713) entrou no audit 16/07: é DIFERENTE de ✔ (U+2714) e a skill de comunicados
// usa justamente ele ("Comunicado despachado. ✓") — sem ele, essa claim não tinha emoji
// nem verbo-no-início, então escapava inteira do gate.
const SUCCESS_EMOJI_RE = /[✅☑✔✓\u{1F197}\u{1F389}\u{1F44D}\u{1F64C}]/u;
const SUCCESS_EMOJI_GLOBAL = /[✅☑✔✓\u{1F197}\u{1F389}\u{1F44D}\u{1F64C}]️?\s?/gu;

// Markup de início de linha (negrito/itálico/bullet/citação) a ignorar.
const LEADING_MARKUP = /^[\s*_~>•\-–—"']+/;

// Verbos de CONCLUSÃO (particípio ou 1ª pessoa do passado) + estados "pronto/feito".
// Inclui o prefixo opcional "tá/está". NÃO inclui presente/futuro/gerúndio
// ("crio", "vou criar", "criando") — isso é intenção, não conclusão.
const COMPLETION_CORE =
  '(?:t[aá]|est[aá]\\s+)?' +
  '(?:criad[oa]s?|criei|registrad[oa]s?|registrei|anotad[oa]s?|anotei|' +
  'agendad[oa]s?|agendei|marcad[oa]s?|marquei|salvad[oa]s?|salv[oa]s?|salvei|' +
  'guardad[oa]s?|guardei|reagendad[oa]s?|reagendei|atualizad[oa]s?|atualizei|' +
  'conclu[ií]d[oa]s?|conclu[ií]|fechad[oa]s?|fechei|resolvid[oa]s?|resolvi|' +
  'finalizad[oa]s?|finalizei|encerrad[oa]s?|encerrei|movid[oa]s?|movi|' +
  'cancelad[oa]s?|cancelei|confirmad[oa]s?|confirmei|lan[çc]ad[oa]s?|lancei|' +
  'adicionad[oa]s?|adicionei|inserid[oa]s?|' +
  // AUDIT 16/07 (confab-noop sweep): verbos das frases CANÔNICAS das skills que
  // escapavam do gate — delegate/cancel de tarefa ("Delegado pro X"), HABIT delete
  // ("Excluí o *Ler*"), ANNOUNCEMENT ("Comunicado despachado ✓"), coordenação
  // ("Avisei o Rafinha"). Particípio/1ª pessoa apenas: futuro/subjuntivo ("vou delegar",
  // "exclua?") NÃO casa, e forma longa vem antes da curta pro \b não quebrar.
  // DELIBERADAMENTE FORA: "enviad*" — ambíguo demais em PT ("boleto foi enviado pelo
  // banco") e já causou falso-fire em contexto financeiro (SENDHONESTY-FALSEFIRE-FINANCE,
  // Rose 14/07). A claim "Comunicado enviado pra aprovação" fica descoberta de propósito;
  // o fix dela é o staging determinístico, não afrouxar este gate.
  'despachad[oa]s?|despachei|exclu[ií]d[oa]s?|exclu[ií]|apagad[oa]s?|apaguei|' +
  'delegad[oa]s?|deleguei|avisad[oa]s?|avisei|' +
  // HABIT-UPDATE-SILENT-LIE (Bianca 09/08): a família de REMOÇÃO faltava inteira. O
  // vocabulário nasceu em torno de CRIAR coisas — "excluí"/"apaguei" entraram pelo delete de
  // hábito, mas o TOM fala "removido"/"tirei" quando a pessoa pede pra TIRAR alguma coisa, e
  // nada disso casava: "✅ Lembrete das 6h removido" com o marker rejeitado passou limpo.
  // Diferente do "enviad*" que ficou de fora acima, aqui não há ambiguidade — nos 90 dias
  // anteriores as 9 falas do TOM com esses verbos eram TODAS claim de ação própria.
  // "desligad*" fica FORA de propósito: descreve estado de coisa no mundo ("o ar tá desligado").
  'removid[oa]s?|removi|tirad[oa]s?|tirei|desativad[oa]s?|desativei|' +
  'pront[oa]|prontinh[oa]|feit[oa])';

// Fronteira FINAL ASCII-safe. Antes era `\b`, que em JS é ASCII: verbo terminado em vogal
// ACENTUADA não fazia boundary contra espaço/pontuação → "Concluí a tarefa." (a claim mais
// óbvia que existe) NUNCA disparou o chokepoint, nem "Excluí o *Ler*.". Bug PRÉ-EXISTENTE
// achado no audit 16/07; mesma classe do CONFIRM-SHORTYES-TA-ACCENT-BOUNDARY (28/06).
// `(?![\p{L}])` + flag `u` = "não seguido de letra" (unicode-aware), preservando o veto a
// casar no meio de palavra ("Recriado" não vira claim).
const COMPLETION_END = '(?![\\p{L}])';
// FORMA-CONECTIVO (29/07, caso Valcílio — regressão pega pela auditoria das 7h): o verbo
// ESTAVA no vocabulário ("criei"), mas a linha começa com conectivo — "E criei a visita do
// Valcílio também:" — e o ANCHORED só tolerava markup/emoji antes do verbo. **Uma conjunção
// derrubava o gate inteiro**, e a afirmação sobreviveu ACIMA do "_não consegui registrar_".
// É o buraco de FORMA nº1 (ver project_confab_chokepoint): ampliar vocabulário não resolve
// forma. Tolera até 2 conectivos curtos; NÃO afrouxa o resto (COMPLETION_CORE segue só
// particípio/1ª pessoa passado, e COMPLETION_END segue barrando meio-de-palavra).
const LEAD_CONNECTIVE = '(?:(?:e|mas|j[áa]|tamb[ée]m|a[íi]|ent[ãa]o|pronto|prontinho|beleza|blz|ok|show|opa)[\\s,]+){0,2}';
const COMPLETION_ANCHORED = new RegExp('^[\\s*_~>•\\-–—"\']*' + LEAD_CONNECTIVE + COMPLETION_CORE + COMPLETION_END, 'iu');
const COMPLETION_ANYWHERE = new RegExp('\\b' + COMPLETION_CORE + COMPLETION_END, 'iu');

// Totalizador absoluto.
const TOTALIZER_RE = /\b(todas|todos|tudo)\b/i;

// Confirmações de recorrência ("você recebe o lembrete", "todo dia 5").
const RECUR_RE = /(voc[êe]\s+recebe\s+o\s+lembrete|^todo\s+dia\s+\d+)/i;

// PLANNING-CONFIRM-NO-CREATE (22/06) — claim de PLANEJAMENTO/organização que implica
// persistência mas escapa do COMPLETION_CORE: "semana/agenda organizada", "organizei",
// "te cobro/lembro/aviso conforme/quando/nos dias". Caso Dai 21/06. Dispara em qualquer
// posição da linha (o fraseado vem no meio: "Semana do canto organizada então:").
const PLANNING_CLAIM_RE = /\borganiz(?:ei|ad[oa]s?)\b|\bte\s+(?:cobro|lembro|aviso)\s+(?:conforme|quando|à\s+medida|nos?\s+dias?|cada)\b|\bvou\s+(?:te\s+)?(?:cobrando|lembrando|acompanhando)\b/i;

// MOVE-CLAIM (27/07, caso Rose GROUPTASK-MOVE-TO-GROUP-CONFAB) — claim de MOVIMENTAÇÃO
// entre listas ("movendo as 3 pro grupo") e o ESTADO RESULTANTE ("agora estão no
// *Financeiro*"). Escapava por DOIS buracos somados: (a) o COMPLETION_CORE tem "movi/
// movido" mas o COMPLETION_ANCHORED exige o verbo NO INÍCIO da linha, e a frase real veio
// com ele no meio e em GERÚNDIO ("Beleza, movendo as 3..."); (b) o estado resultante não
// tem verbo de conclusão nenhum. Dispara em qualquer posição (igual PLANNING_CLAIM_RE).
// Gerúndio entra AQUI (contra o princípio geral "gerúndio = intenção") porque este gate só
// roda quando o engine JÁ SABE que nada persistiu (outcome failed/partial) — ali "estou
// movendo" é tão falso quanto "movi". NÃO casa subjuntivo/infinitivo ("mova", "mover"):
// a PERGUNTA "quer que eu mova?" é legítima e precisa sobreviver.
const MOVE_CLAIM_RE = /\bmov(?:endo|i|id[oa]s?|o)(?![\p{L}])|\btransfer(?:indo|i|id[oa]s?|o)(?![\p{L}])|\bagora\s+(?:est[áaã]o?|s[ãa]o|ficou|ficaram)\s+(?:n[oa]s?|em|d[oa]s?)(?![\p{L}])/iu;

// TOM-AFIRMA-DEPOIS-DESMENTE (Rose 06/08, Krissya 05/08) — dois buracos de FORMA que
// sobraram depois do fix do Valcílio. Nos dois casos a afirmação ficou EM CIMA e o
// "_não consegui registrar_" EMBAIXO, no mesmo texto, e a pessoa não sabe em qual acreditar.
//
// (a) GERÚNDIO. "Fechando a tarefa dela." O princípio geral do módulo é que gerúndio é
//     INTENÇÃO, não conclusão — mas esse princípio não vale aqui, e o MOVE_CLAIM_RE já
//     tinha aberto a exceção com a justificativa certa: este gate só roda quando o engine
//     JÁ SABE que nada persistiu, e nesse ponto "estou fechando" é tão falso quanto
//     "fechei". O que valia pra mover vale pra todos os verbos.
//
// (b) 1ª PESSOA NO MEIO DA LINHA. "Fechou, reagendei pra amanhã." O verbo está no
//     vocabulário, mas o ANCHORED exige início e "Fechou," não é conectivo; sem emoji e
//     sem totalizador, nada pegava. Restringir a 1ª PESSOA é o que torna isso seguro: o
//     particípio pode descrever estado alheio ("Comprar enfeite já tava marcado" — e esse
//     precisa sobreviver), mas "reagendei" é sempre o TOM dizendo que ele fez.
const COMPLETION_GERUND_RE = new RegExp('\\b(?:criando|registrando|anotando|agendando|marcando|salvando|'
  + 'guardando|reagendando|atualizando|concluindo|fechando|resolvendo|finalizando|encerrando|'
  + 'cancelando|confirmando|lan[çc]ando|adicionando|despachando|excluindo|apagando|delegando|avisando)'
  + '(?![\\p{L}])', 'iu');
const FIRST_PERSON_DONE_RE = new RegExp('\\b(?:criei|registrei|anotei|agendei|marquei|salvei|guardei|'
  + 'reagendei|atualizei|conclu[ií]|fechei|resolvi|finalizei|encerrei|movi|cancelei|confirmei|lancei|'
  + 'adicionei|despachei|exclu[ií]|apaguei|deleguei|avisei|organizei)(?![\\p{L}])', 'iu');

// A negação inverte o sentido: "Não reagendei nada ainda" é honesto e PRECISA sobreviver —
// removê-lo deixaria o TOM mudo (foi o que houve no caso Alf 01/08, quando o guard comeu a
// resposta inteira). Olha só a vizinhança imediata ANTES do verbo, não a linha toda, senão
// "Fechei, mas não avisei" perderia a parte que é mentira.
const _NEG_ANTES_RE = /\b(?:n[ãa]o|nem)\s+(?:[\p{L}]+\s+)?$/iu;
function _claimSemNegacao(texto, re) {
  const m = re.exec(texto);
  if (!m) return false;
  return !_NEG_ANTES_RE.test(texto.slice(Math.max(0, m.index - 18), m.index));
}

// REDE 1 (audit 15/07, caso Matheus RESCHEDULE-CONFIRM-NOOP) — afirmações FRACAS de
// conclusão: "Fechou" (3ª pessoa, fora do COMPLETION_CORE), "Combinado", "Beleza", "Show".
// São ubíquas em banter, então SÓ contam como claim quando o ENGINE sinaliza
// pendingActionRecent (a última virada do TOM foi pergunta-de-confirmação de ação). O eixo é
// de ESTADO (nothingPersisted + recência), NUNCA actionable_intent — este é falso justamente
// no turno-alvo ("Isso"→"Fechou": inputActionable=false E replyHasPromise=false, engine.js:12294)
// e é circular (depende do mesmo detector que a Rede 1 estende).
const WEAK_COMPLETION_RE = /\b(fechou|combinad[oa]s?|beleza|show)\b/i;

function _stripLeadingEmoji(line) {
  return String(line).replace(SUCCESS_EMOJI_GLOBAL, '').replace(LEADING_MARKUP, '').trimStart();
}

// Uma linha é "otimista" quando afirma que a ação foi concluída.
// includeWeak: também trata afirmações FRACAS ("Fechou/Combinado/Beleza/Show") como otimistas
// — só ligado pelo enforceNoMarkerHonesty quando o eixo de estado já autorizou (Rede 1).
function _isOptimisticLine(line, includeWeak) {
  const t = String(line).trim();
  if (!t) return false;
  if (SUCCESS_EMOJI_RE.test(t)) return true;
  if (RECUR_RE.test(t)) return true;
  const noEmoji = _stripLeadingEmoji(t);
  if (COMPLETION_ANCHORED.test(noEmoji)) return true;
  // "Todos os itens registrados" — totalizador + verbo de conclusão em qualquer
  // posição. Sem o totalizador NÃO casa (evita stripar menção a estado alheio,
  // ex.: "Comprar enfeite já tava marcado").
  if (TOTALIZER_RE.test(t) && COMPLETION_ANYWHERE.test(t)) return true;
  // PLANNING-CONFIRM-NO-CREATE: claim de planejamento ("semana organizada", "te cobro conforme").
  if (PLANNING_CLAIM_RE.test(t)) return true;
  // MOVE-CLAIM: "movendo as 3 pro grupo" / "agora estão no *Financeiro*" (caso Rose 26/07).
  if (MOVE_CLAIM_RE.test(t)) return true;
  // TOM-AFIRMA-DEPOIS-DESMENTE (b): 1ª pessoa em QUALQUER posição — "Fechou, reagendei pra
  // amanhã" (Krissya 05/08). Só 1ª pessoa: particípio em qualquer posição comeria menção a
  // estado alheio ("Comprar enfeite já tava marcado").
  if (_claimSemNegacao(t, FIRST_PERSON_DONE_RE)) return true;
  // TOM-AFIRMA-DEPOIS-DESMENTE (a): gerúndio de conclusão — "Fechando a tarefa dela"
  // (Rose 06/08). Pergunta fica de fora: "Quer que eu vá fechando as pendências?" é
  // legítima e some se o gate pegar (mesmo cuidado que o MOVE_CLAIM tem com "mova/mover").
  if (!t.endsWith('?') && _claimSemNegacao(t, COMPLETION_GERUND_RE)) return true;
  if (includeWeak && WEAK_COMPLETION_RE.test(noEmoji)) return true;
  return false;
}

function _downgradeTotalizers(line) {
  const cap = (m, repl) => (m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase())
    ? repl.charAt(0).toUpperCase() + repl.slice(1)
    : repl;
  return String(line)
    .replace(/\btodas as\b/gi, (m) => cap(m, 'a maioria das'))
    .replace(/\btodos os\b/gi, (m) => cap(m, 'a maioria dos'))
    .replace(/\btodas\b/gi, (m) => cap(m, 'a maioria'))
    .replace(/\btodos\b/gi, (m) => cap(m, 'a maioria'))
    .replace(/\btudo\b/gi, (m) => cap(m, 'a maior parte'));
}

function hasOptimisticConfirm(text) {
  if (!text) return false;
  return String(text).split('\n').some(_isOptimisticLine);
}

function sanitizeOptimisticConfirm(text, outcome, opts) {
  if (!text) return '';
  if (outcome !== 'failed' && outcome !== 'partial') return String(text);
  const includeWeak = !!(opts && opts.includeWeak);

  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) { out.push(line); continue; }
    if (!_isOptimisticLine(line, includeWeak)) { out.push(line); continue; }

    if (outcome === 'failed') {
      // Nada persistiu → a confirmação é falsa: remove a linha inteira.
      continue;
    }

    // outcome === 'partial': remove o emoji de sucesso e rebaixa o totalizador.
    const noEmoji = line.replace(SUCCESS_EMOJI_GLOBAL, '').replace(/^\s+/, '');
    if (TOTALIZER_RE.test(noEmoji)) {
      out.push(_downgradeTotalizers(noEmoji).replace(/\s+$/, ''));
    } else if (COMPLETION_ANCHORED.test(_stripLeadingEmoji(noEmoji))) {
      // Confirmação pura ("✅ Criado!") sem quantificador → o rodapé do engine
      // ("Registrei N de M") carrega a verdade; remove a linha.
      continue;
    } else {
      // Emoji era decoração de uma frase neutra → mantém só o texto.
      out.push(noEmoji.replace(/\s+$/, ''));
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// hasCompletionClaim — gate do chokepoint Camada 1 (CONFAB-NOMARKER-CHOKEPOINT).
// Por linha: verbo de conclusão NO INÍCIO, OU ✅ na linha JUNTO com verbo em qualquer
// posição, OU totalizador + verbo. NÃO dispara no ✅ decorativo sozinho (protege a voz).
function _isCompletionClaimLine(line) {
  const t = String(line).trim();
  if (!t) return false;
  const noEmoji = _stripLeadingEmoji(t);
  if (COMPLETION_ANCHORED.test(noEmoji)) return true;
  if (SUCCESS_EMOJI_RE.test(t) && COMPLETION_ANYWHERE.test(t)) return true;
  if (TOTALIZER_RE.test(t) && COMPLETION_ANYWHERE.test(t)) return true;
  if (PLANNING_CLAIM_RE.test(t)) return true;   // PLANNING-CONFIRM-NO-CREATE (caso Dai)
  // CONFAB-GERUNDIO-CHOKEPOINT (Rose 09/08): o gerúndio entrou no _isOptimisticLine em 08/08
  // mas ficou de fora daqui de propósito ("risco de falso-fire maior, sem evidência pedindo").
  // A evidência apareceu: "lançando todas as 14 parcelas!" sem marker NENHUM — sem marker o
  // sanitizador nem roda, então este gate era o único no caminho. Mesmos dois guards de lá
  // (pergunta e negação), que é o que separa a promessa falsa da fala legítima.
  if (!t.endsWith('?') && _claimSemNegacao(t, COMPLETION_GERUND_RE)) return true;
  return false;
}
function hasCompletionClaim(text) {
  if (!text) return false;
  return String(text).split('\n').some(_isCompletionClaimLine);
}

// hasWeakCompletionClaim — camada FRACA da Rede 1: "Fechou/Combinado/Beleza/Show" em
// qualquer linha. Sozinha NÃO basta pra rebaixar — o enforceNoMarkerHonesty só a usa sob
// pendingActionRecent (eixo de estado). Ver WEAK_COMPLETION_RE.
function _isWeakCompletionClaimLine(line) {
  const t = String(line).trim();
  if (!t) return false;
  return WEAK_COMPLETION_RE.test(_stripLeadingEmoji(t));
}
function hasWeakCompletionClaim(text) {
  if (!text) return false;
  return String(text).split('\n').some(_isWeakCompletionClaimLine);
}

// enforceNoMarkerHonesty — Camada 1: se a fala afirma conclusão mas NADA persistiu no
// turno, rebaixa pra honesta. PURO. Sinais vêm do engine (nunca adivinhados do texto).
// Caminho 2 / Fatia 0 — modo VELOCÍMETRO: com opts2.meta===true retorna {reply, fired, sense}
// pra o engine medir os disparos (curva da doença). SEM meta → retorna string (retrocompat).
// CHOKEPOINT-PROGRESS-FALSEFIRE (01/08, caso Alf) — o usuário respondeu à cobrança com um
// STATUS DE PROGRESSO ("To fazendo, Tom"). Isso NÃO pede ação nenhuma: não havia o que
// persistir, então `nothingPersisted` é o estado CORRETO, não um sintoma. Como a cobrança
// ("Resolve hoje ou reagenda?") ligou o pendingActionRecent, a camada FRACA leu a cordialidade
// do TOM ("Beleza, fico no aguardo") como confirmação-sem-ação e SUBSTITUIU a resposta inteira
// pela nota de erro — o que chegou no WhatsApp foi só o "⚠️ não consegui registrar".
// Gate só da camada FRACA: claim FORTE ("Concluí!") segue disparando, progresso ou não.
// VETO: se a fala também PEDE ação ("tô fazendo, marca como concluída"), não vale como
// progresso puro — aí o guard tem que continuar valendo.
const PROGRESS_STATUS_RE = /\b(?:t[oôõ]|estou)\s+(?:fazendo|vendo|resolvendo|terminando|acabando|trabalhando|nisso|nessa)\b|\bvou\s+(?:fazer|ver|resolver|terminar)\b|\bfazendo\s+(?:agora|isso)\b|\bem\s+andamento\b/iu;
const ACTION_REQUEST_RE = /\b(?:marca|marque|conclui|conclua|finaliza|encerra|cancela|reagenda|remarca|adia|cria|criar|apaga|exclui|deleta|muda|troca)\w*\b/iu;
function isProgressStatusReply(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (ACTION_REQUEST_RE.test(t)) return false;
  return PROGRESS_STATUS_RE.test(t);
}

// CHOKEPOINT-NEGA-ESCRITA-RECENTE (Dudu 18/08 21:07 BRT) — o guard só enxerga a janela do
// turno, então nega afirmação VERDADEIRA sobre o que o próprio TOM persistiu segundos antes.
// Caso: tarefa criada 21:06:57 (TASK_UPDATE executed); às 21:06:59 o Dudu reforça o mesmo
// pedido ("Me lembra só amanhã"), nada novo há pra persistir, e o "✅ Tá registrado" — que era
// verdade — virou "não consegui registrar". Irmão do TASK-HONESTY-NEGA-BAIXA-FEITA (Kailane
// 12/08, task-done-recente.js), na superfície de saída em vez do prompt.
// PURA: recebe os títulos já lidos do banco. Casa só quando a fala REAFIRMA aquele item —
// overlap de tokens fortes —, nunca por "houve escrita recente" (isso liberaria confab sobre
// outro item no mesmo turno).
const _RESTATE_STOPWORDS = new Set(['para', 'pelo', 'pela', 'esse', 'essa', 'isso', 'este', 'esta', 'como', 'sobre', 'ontem', 'hoje', 'amanha', 'tarefa', 'lembrete']);
function _restateTokens(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !_RESTATE_STOPWORDS.has(t));
}
function restatesRecentWrite(reply, titulos) {
  const lista = Array.isArray(titulos) ? titulos : [];
  if (!reply || !lista.length) return false;
  const hay = new Set(_restateTokens(reply));
  if (!hay.size) return false;
  return lista.some((t) => {
    const toks = _restateTokens(t);
    if (toks.length < 2) return false;
    const hits = toks.filter((tk) => hay.has(tk)).length;
    return hits >= 2 && hits / toks.length >= 0.6;
  });
}

const NO_MARKER_HONEST_NOTE = '_⚠️ Na real não consegui registrar isso agora — me manda de novo, por favor._';
function enforceNoMarkerHonesty(reply, opts, opts2) {
  const o = opts || {};
  const meta = !!(opts2 && opts2.meta);
  const wrap = (r, fired) => (meta ? { reply: r, fired, sense: 'confab' } : r);
  if (!reply || !o.nothingPersisted || o.awaitingConfirm) return wrap(reply, false);
  // Forte (particípio/1ª pessoa) dispara sempre — tuning de meses, não mexo. Fraca ("Fechou")
  // só sob pendingActionRecent (eixo de ESTADO): fecha o NOOP do Matheus sem falso-fire de banter.
  //
  // HABIT-UPDATE-SILENT-LIE (Bianca 09/08): `infoGathering` vetava aqui em cima, ANTES de olhar
  // o claim — então "dispara sempre" era falso na prática. Uma mensagem que pergunta e afirma no
  // mesmo sopro ("Entendi: quer tirar o lembrete, certo?" + "✅ Lembrete removido") era lida como
  // coleta de informação e desarmava o chokepoint inteiro. O TOM foi ENSINADO a confirmar antes
  // de agir, então perguntar-e-afirmar é padrão dele, não exceção: a porta ficava aberta no
  // caminho mais comum. Uma pergunta ao lado não torna a afirmação verdadeira, e `nothingPersisted`
  // já é o gate duro. O veto continua valendo para a camada FRACA, que é onde mora o falso-fire
  // de banter ("Beleza! Quer que eu veja mais alguma coisa?") — ali a pergunta É o sinal.
  let strong = hasCompletionClaim(reply);
  // FALSEFIRE-COMPOSICAO (Rose ADM 14/08): quando o TOM PEDE conteúdo/insumo (content-solicitation:
  // "Anotado! Pode mandar o próximo") e NENHUM marker foi tentado no turno, ele não afirmou ação de
  // domínio — é rascunho de mensagem, e `nothingPersisted` é o estado CORRETO, não sintoma. Veta só
  // a camada FORTE. O que NÃO desarma: confirm-seeking (Bianca 09/08 "quer tirar o lembrete, certo?"
  // ✅ removido → contentSolicitation=false) e marker tentado-e-rejeitado (markerAttempted=true).
  // Opt ausente ⇒ veto inerte ⇒ zero-regressão para chamadores antigos. Ver reply-classify.js
  // (isContentSolicitationReply) e project_naoregistrei_balde_sintoma_fatias (Fatia 2).
  if (strong && o.contentSolicitation && !o.markerAttempted) strong = false;
  // Reafirmar o que o próprio TOM acabou de gravar não é confab (Dudu 18/08). markerAttempted
  // mantém o freio: marker tentado-e-rejeitado neste turno é ação na mesa que FALHOU.
  if (strong && o.restatesRecentWrite && !o.markerAttempted) strong = false;
  const weak = !strong && !o.infoGathering && !!o.pendingActionRecent
    && !o.userProgressStatus && !o.restatesRecentWrite && hasWeakCompletionClaim(reply);
  if (!strong && !weak) return wrap(reply, false);
  const cleaned = sanitizeOptimisticConfirm(reply, 'failed', { includeWeak: weak });
  const out = cleaned ? cleaned + '\n\n' + NO_MARKER_HONEST_NOTE : NO_MARKER_HONEST_NOTE;
  return wrap(out, true);
}

module.exports = { sanitizeOptimisticConfirm, hasOptimisticConfirm, hasCompletionClaim, hasWeakCompletionClaim, enforceNoMarkerHonesty, isProgressStatusReply, restatesRecentWrite };
