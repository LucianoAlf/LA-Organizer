// src/rituals/leader-cards.js
// Fase 7 — CARD POR LÍDER. Substitui os 4 blocos do digest (idade / pessoa+LLM /
// cobrança / staleness), que organizavam as MESMAS tarefas em 4 eixos que não
// conversavam — e por isso liam como ruído. Aqui existe UM eixo: o líder.
//
// PURO e SÍNCRONO: sem banco, sem LLM. O 💡 (diagnostic) é injetado DEPOIS pelo
// dispatcher, que faz o I/O. Rodar: node --test src/rituals/leader-cards.test.js
//
// Hotfix pós-Task 6 (17/07) — buildLeaderCards({ forLeaderId }) monta o card ÚNICO
// do PRÓPRIO líder pro digest dele (dispatcher.js `sendLeaderGovernanceDigest`).
// Sem `forLeaderId`: comportamento de sempre (visão do CEO, N cards por líder-
// principal). Com `forLeaderId`: 1 card, o do destinatário, roteado pela posse
// crua — ver buildSingleLeaderCard.
'use strict';

const { resolveLeadersOf, governanceViewerIdsOf, LEADER_ROLES } = require('../services/leader-routing');

// §5.1 — rótulo do vínculo compartilhado com um co-líder.
const FUNCTION_LABELS = {
  pedagogico: 'pedagógico', farmer: 'farmers', marketing: 'marketing',
  ops_tecnicas: 'ops técnicas', financeiro: 'financeiro', sonoramente: 'Sonoramente', tech: 'tech',
};

// isPlaceholder = sentinela sintética (ex.: SEM_DONO), não pessoa real — o rótulo já É
// o nome inteiro que deve aparecer, cortar no 1º espaço quebraria ("Sem dono" → "Sem").
const firstName = (c) => (c.isPlaceholder ? String(c.full_name || '—') :
  String(c.preferred_name || c.full_name || '').split(' ')[0] || '—');

// Dono não resolvido: assigned_to NULL, ou apontando pra quem saiu (o loader
// `loadCollabsWithEdges` só traz is_active=true — governance-edges.js:13). NÃO pode dar
// `continue`: existem HOJE 11 tarefas de trabalho atrasadas nessa situação, e o dispatcher
// atual as MOSTRA ao CEO (ceoBucket/'__unassigned__'). Sumir aqui seria perda silenciosa
// no relatório de quem manda. Sem unit/group/aresta, resolveLeadersOf cai no CEO →
// primaryOf devolve null → blockFor(null,...) cai no balde `unassigned` ("Direto com
// você") — o MESMO destino de uma tarefa cujo único líder é o CEO.
const SEM_DONO = { id: '__sem_dono__', full_name: 'Sem dono', isPlaceholder: true, is_ceo: false, is_active: true };

// Dias de atraso a partir de YMDs — aritmética em UTC sobre componentes, NUNCA
// new Date(str) local nem toISOString().slice(0,10) (desloca o dia após 21h BRT).
function daysBetweenYmd(todayYmd, dueYmd) {
  const [y1, m1, d1] = String(todayYmd).split('-').map(Number);
  const [y2, m2, d2] = String(dueYmd).split('-').map(Number);
  return Math.max(1, Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000));
}

// §7.2 — régua de cor. Thresholds IDÊNTICOS aos de hoje (scorecard-builder.js:202-209);
// o que muda é o ESCOPO (líder + time, não `assigned_to = leaderId`) e a FONTE de cada
// termo (§7.1: % é SEMANAL, contagem é AO VIVO). Uma variável por vez.
// PORT espelhado em web/src/lib/scorecard-classify.ts — os dois mudam juntos, mas a
// partir daqui as duas réguas são a MESMA fórmula em RELÓGIOS diferentes: aqui (digest)
// é AO VIVO — overdueLive/stuckLive contam AGORA, closureRate vem do scorecard da SEMANA
// PASSADA, por isso noTasks só pode olhar termos ao vivo (ver comentário dentro da
// função). Lá (dashboard) é SNAPSHOT semanal — os 3 termos de `hasNoTasks`
// (tasks_closed/tasks_overdue/tasks_stuck) vêm da MESMA linha do scorecard, sem mistura
// de relógio nenhuma, então `tasks_closed` dentro do `hasNoTasks` de lá está CERTO como
// está. NÃO "sincronizar" removendo-o de lá só porque ele saiu daqui — são bugs
// diferentes porque as fontes são diferentes, mesmo a régua sendo a mesma.
function classifyCard({ closureRate, overdueLive, stuckLive }) {
  // §7.1 — noTasks é AO VIVO, PONTO. Nada de snapshot aqui.
  // Sem pendência viva não há o que cobrar hoje → 🟢 (vai pro `ritmo`), qualquer que tenha sido
  // a semana passada. O % é contexto DENTRO do card; ele nunca CRIA um card vazio.
  // A versão anterior somava `closedLastWeek === 0` (snapshot) e produzia duas incoerências:
  // rate 0% real + quadro limpo → 🟢 (escondia o 0%); e closed=2/rate=30% + quadro limpo → 🔴
  // com card vazio. Relógios diferentes não se misturam num predicado só.
  const noTasks = overdueLive === 0 && stuckLive === 0;
  // O guard de null é OBRIGATÓRIO, não estilo: `null < 0.60` é `true` em JS (null coage
  // pra 0), então sem ele TODO líder sem nota seria pintado de 🔴 — o bug exatamente
  // oposto ao "100% de zero" que viemos consertar.
  const badPct = closureRate !== null && closureRate < 0.60;
  const midPct = closureRate !== null && closureRate < 0.85;
  if (!noTasks && (badPct || overdueLive >= 3 || stuckLive >= 2)) return '🔴';
  if (!noTasks && (midPct || overdueLive >= 1)) return '🟡';
  return '🟢';
}

// Bloco de UMA pessoa dentro de um card — a chave é sempre o DONO da tarefa/evento
// (isSelf quando o dono é o próprio dono do card). Compartilhado pelos dois modos de
// `buildLeaderCards`: a visão do CEO (N cards, roteados por líder-principal) e o modo
// `forLeaderId` (1 card só, roteado pela posse crua) — dois roteamentos diferentes
// escrevendo no MESMO formato de bloco, pra o resto do pipeline (finishBlock,
// renderLeaderCard) não precisar saber qual dos dois montou o card.
const blank = (person, isSelf) => ({ person: { id: person.id, name: firstName(person) },
  isSelf, novo: [], arrastando: [], events: [], diagnostic: null, count: 0 });

// Ordena os itens de um bloco já fechado. Mesma régua nos dois modos (§7.4/§7.5).
const finishBlock = (b) => {
  b.arrastando.sort((x, y) => y.days - x.days || String(x.id).localeCompare(String(y.id)));
  b.novo.sort((x, y) => String(x.id).localeCompare(String(y.id)));
  return b;
};

function buildLeaderCards({ tasks, events, collabs, scorecards, today, forLeaderId }) {
  const list = Array.isArray(collabs) ? collabs : [];
  const byId = new Map(list.map((c) => [c.id, c]));

  // Hotfix pós-Task 6 — o digest do LÍDER (dispatcher.js `sendLeaderGovernanceDigest`)
  // ganhou card próprio: UM card, o do destinatário, com o time dentro. Sem isto o
  // Quintela recebia o card da JULIANA (ela é a líder-principal do Peterson) — líder
  // errado na mensagem dele. Aqui não existe "de quem é o card" (só há um: o do
  // destinatário) — só "de quem é o bloco dentro dele", e isso é posse CRUA (dono da
  // tarefa/evento), não líder-principal resolvido: essa resolução (primaryOf/isLeader,
  // logo abaixo) é exclusiva da visão do CEO, que enxerga N cards e por isso precisa
  // decidir de quem é cada um.
  if (forLeaderId) return buildSingleLeaderCard({ tasks, events, byId, scorecards, today, forLeaderId });

  // Quem é LÍDER = lidera >= 1 pessoa ativa por QUALQUER regra. Mesmo critério do
  // `hasTeam` que o dispatcher já usa (~L.2980) — uma fonte de verdade só.
  const leaderIds = new Set();
  for (const c of list) {
    for (const l of resolveLeadersOf(c, list)) if (l.id !== c.id) leaderIds.add(l.id);
  }
  const isLeader = (id) => leaderIds.has(id) && !(byId.get(id) || {}).is_ceo;

  // Líder principal de uma TAREFA: 1º viewer não-CEO. Delegada (governance_owner_id)
  // curto-circuita pro delegador — quem delegou é quem cobra.
  const primaryOf = (t, owner) => {
    for (const vid of governanceViewerIdsOf(t, owner, list)) {
      const v = byId.get(vid);
      if (v && !v.is_ceo) return v;
    }
    return null;
  };

  const cards = new Map();     // leaderId -> { leader, people: Map }
  const unassigned = new Map();// personId -> block

  const cardFor = (leader) => {
    if (!cards.has(leader.id)) cards.set(leader.id, { leader, people: new Map() });
    return cards.get(leader.id);
  };
  const blockFor = (leader, person, isSelf) => {
    const bucket = leader ? cardFor(leader).people : unassigned;
    if (!bucket.has(person.id)) bucket.set(person.id, blank(person, isSelf));
    return bucket.get(person.id);
  };

  // Todo líder tem card, mesmo sem pendência (a Task 3 decide se ele aparece).
  for (const id of leaderIds) {
    const l = byId.get(id);
    if (l && !l.is_ceo) cardFor(l);
  }

  for (const t of (tasks || [])) {
    const owner = byId.get(t.assigned_to) || SEM_DONO;
    // due_date ausente: o dispatcher SEMPRE filtra `.lt('due_date', today)` antes de montar
    // `tasks`, então isto não acontece hoje na prática — mas `buildLeaderCards` é PURA e
    // pública, e um chamador futuro pode passar uma tarefa sem prazo. Diferente do dono
    // acima, isto NÃO é perda por omissão: sem due_date não existe "dias atrasado" pra
    // calcular (daysBetweenYmd viraria NaN) e o card inteiro é sobre atraso — está fora de
    // escopo, não invisível. Por isso segue sendo filtro explícito, não bug silencioso.
    if (!t.due_date) continue;
    // DEFEITO 3 (dry-run 17/07) — category e coordRequests (o número REAL de cobranças,
    // não um 3-ou-0 derivado do boolean) precisam sobreviver no item: o dispatcher usa os
    // dois pra alimentar o 💡 do analyzePersonBacklog. Jogar fora aqui fazia o diagnóstico
    // dizer "sem categoria" mesmo quando a task TEM categoria (a query sempre teve o campo).
    const coordRequests = t.coordination_request_count || 0;
    const item = { id: t.id, title: String(t.title || ''), days: daysBetweenYmd(today, t.due_date),
      stuck: coordRequests >= 3, category: t.category || null, coordRequests };
    // Posse: dono é líder → card DELE (isSelf). Senão → card do principal. Senão → balde.
    const self = isLeader(owner.id);
    const block = blockFor(self ? owner : primaryOf(t, owner), owner, self);
    (item.days === 1 ? block.novo : block.arrastando).push(item);
    block.count += 1;
  }

  // ⚠️ A tabela `events` usa `collaborator_id` (NÃO `owner_id`) e `start_at` (NÃO `starts_at`).
  // Ver dispatcher.js:2409. Errar o campo faz byId.get() devolver undefined pra TODO evento →
  // `continue` → os compromissos somem calados, com os testes verdes.
  for (const e of (events || [])) {
    // Mesma perda silenciosa do loop de tarefas acima (collaborator_id nulo, ou apontando
    // pra quem saiu) — cai no balde `unassigned`, não pode sumir o compromisso.
    const owner = byId.get(e.collaborator_id) || SEM_DONO;
    const self = isLeader(owner.id);
    const block = blockFor(self ? owner : primaryOf({ assigned_to: e.collaborator_id }, owner), owner, self);
    block.events.push({ id: e.id, title: String(e.title || ''), whenLabel: e.whenLabel || '' });
    block.count += 1;
  }

  const out = [];
  const ritmo = [];
  for (const { leader, people } of cards.values()) {
    const blocks = [...people.values()].map(finishBlock)
      .sort((a, b) => Number(a.isSelf) - Number(b.isSelf)     // self SEMPRE por último
        || b.count - a.count                                   // mais pendências primeiro
        || a.person.name.localeCompare(b.person.name, 'pt-BR')
        || a.person.id.localeCompare(b.person.id));            // tiebreak determinístico
    const own = blocks.filter((b) => b.isSelf).reduce((s, b) => s + b.count, 0);
    const team = blocks.filter((b) => !b.isSelf).reduce((s, b) => s + b.count, 0);

    // §7.1 — o % é SEMANAL (vem do scorecard); a contagem é AO VIVO (dos blocks).
    const sc = (scorecards && scorecards.get(leader.id)) || {};
    const rate = sc.closure_rate;
    const closureRate = (rate === null || rate === undefined) ? null : rate;
    const closurePct = closureRate === null ? null : Math.round(100 * closureRate);
    const stuckLive = blocks.reduce(
      (s, b) => s + b.novo.filter((i) => i.stuck).length + b.arrastando.filter((i) => i.stuck).length, 0);
    // classifyCard recebe o rate BRUTO (§7.2 FIX 2) — closurePct arredondado é só p/ exibição.
    const dot = classifyCard({ closureRate, overdueLive: own + team, stuckLive });

    const card = { leader: { id: leader.id, name: firstName(leader) },
      coLeaders: coLeadersOf(leader, blocks, list, byId),
      dot, closurePct, totals: { all: own + team, team, own }, people: blocks };
    // §7.6 — 🟢 colapsa numa linha; só 🔴/🟡 ganham card.
    if (dot === '🟢') ritmo.push({ id: leader.id, name: firstName(leader) });
    else out.push(card);
  }
  out.sort((a, b) => b.totals.all - a.totals.all
    || a.leader.name.localeCompare(b.leader.name, 'pt-BR')
    || a.leader.id.localeCompare(b.leader.id));               // tiebreak determinístico
  ritmo.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id)); // idem

  // `unassigned` saía na ordem de inserção do Map = ordem do array de entrada = ordem do
  // heap do Postgres (o loader não tem ORDER BY em query nenhuma) — o bloco "Direto com
  // você" reordenava sozinho entre execuções sem nenhum dado ter mudado. Mesma receita das
  // outras ordenações acima: nome (pt-BR) + tiebreak por id.
  const unassignedOut = [...unassigned.values()].map(finishBlock)
    .sort((a, b) => a.person.name.localeCompare(b.person.name, 'pt-BR') || a.person.id.localeCompare(b.person.id));

  return { cards: out, unassigned: unassignedOut, ritmo };
}

// forLeaderId — UM card só: o do destinatário. Ele já é o escopo (o chamador filtra
// as tarefas/eventos ANTES de chamar buildLeaderCards — governanceViewerIdsOf pro
// dispatcher de tarefas, scopeIds pro de eventos), então aqui dentro não existe
// "de quem é o card" — existe só "de quem é o bloco dentro dele": a posse crua
// (assigned_to / collaborator_id), sem resolver primário/co-líder (isso é só da
// visão do CEO — ver comentário no chamador). dot/closurePct usam a MESMA régua
// (classifyCard) sobre os totais deste card + o scorecard do PRÓPRIO destinatário.
function buildSingleLeaderCard({ tasks, events, byId, scorecards, today, forLeaderId }) {
  const people = new Map(); // dono (cru) -> block
  const blockFor = (owner) => {
    if (!people.has(owner.id)) people.set(owner.id, blank(owner, owner.id === forLeaderId));
    return people.get(owner.id);
  };

  for (const t of (tasks || [])) {
    // Mesmo guard do modo CEO: sem due_date não há "dias atrasado" pra calcular —
    // fora de escopo, não perda silenciosa (comentário completo lá em cima).
    if (!t.due_date) continue;
    const owner = byId.get(t.assigned_to) || SEM_DONO;
    const block = blockFor(owner);
    // DEFEITO 3 (dry-run 17/07) — category e coordRequests (o número REAL de cobranças,
    // não um 3-ou-0 derivado do boolean) precisam sobreviver no item: o dispatcher usa os
    // dois pra alimentar o 💡 do analyzePersonBacklog. Jogar fora aqui fazia o diagnóstico
    // dizer "sem categoria" mesmo quando a task TEM categoria (a query sempre teve o campo).
    const coordRequests = t.coordination_request_count || 0;
    const item = { id: t.id, title: String(t.title || ''), days: daysBetweenYmd(today, t.due_date),
      stuck: coordRequests >= 3, category: t.category || null, coordRequests };
    (item.days === 1 ? block.novo : block.arrastando).push(item);
    block.count += 1;
  }

  // Mesmo cuidado de campo do modo CEO: `collaborator_id` (não `owner_id`), `start_at`
  // (não `starts_at`) — ver dispatcher.js:2409.
  for (const e of (events || [])) {
    const owner = byId.get(e.collaborator_id) || SEM_DONO;
    const block = blockFor(owner);
    block.events.push({ id: e.id, title: String(e.title || ''), whenLabel: e.whenLabel || '' });
    block.count += 1;
  }

  const blocks = [...people.values()].map(finishBlock)
    .sort((a, b) => Number(a.isSelf) - Number(b.isSelf)     // self SEMPRE por último
      || b.count - a.count                                   // mais pendências primeiro
      || a.person.name.localeCompare(b.person.name, 'pt-BR')
      || a.person.id.localeCompare(b.person.id));            // tiebreak determinístico
  const own = blocks.filter((b) => b.isSelf).reduce((s, b) => s + b.count, 0);
  const team = blocks.filter((b) => !b.isSelf).reduce((s, b) => s + b.count, 0);

  // Nada a mostrar → nenhum card. O chamador (dispatcher) já trata isto como "sem
  // seção" e não envia o digest — mesmo contrato de hoje (returnText: '').
  if (own + team === 0) return { cards: [], unassigned: [], ritmo: [] };

  const leader = byId.get(forLeaderId) || { id: forLeaderId, full_name: String(forLeaderId), isPlaceholder: true };
  const sc = (scorecards && scorecards.get(forLeaderId)) || {};
  const rate = sc.closure_rate;
  const closureRate = (rate === null || rate === undefined) ? null : rate;
  const closurePct = closureRate === null ? null : Math.round(100 * closureRate);
  const stuckLive = blocks.reduce(
    (s, b) => s + b.novo.filter((i) => i.stuck).length + b.arrastando.filter((i) => i.stuck).length, 0);
  const dot = classifyCard({ closureRate, overdueLive: own + team, stuckLive });

  const card = { leader: { id: leader.id, name: firstName(leader) },
    // coLeaders é conceito do CEO ("dividido com o Quintela" pra saber quem MAIS
    // cobrar) — na mensagem do próprio líder não faz sentido dizer isso dele mesmo.
    coLeaders: [], dot, closurePct, totals: { all: own + team, team, own }, people: blocks };

  // ritmo/unassigned são conceitos de "outros líderes" e "ninguém resolve" — nesta
  // visão só existe o destinatário e o time dele, e ele SEMPRE vira card (nunca
  // "some" no ritmo): com pelo menos 1 item, overdueLive>=1 já garante 🔴/🟡 na
  // régua de classifyCard acima, nunca 🟢 — o ramo "vazio" já saiu antes, no `if`.
  return { cards: [card], unassigned: [], ritmo: [] };
}

// §5.1 — união dos líderes NÃO-principais das pessoas do card, menos o CEO e menos o
// dono do card. `label` = function_role compartilhado, se for o mesmo pra todos; senão 'time'.
function coLeadersOf(leader, blocks, list, byId) {
  const acc = new Map();  // coLeaderId -> Set(function_role das pessoas compartilhadas)
  for (const b of blocks) {
    if (b.isSelf) continue;
    const person = byId.get(b.person.id);
    if (!person) continue;
    // SEM .slice(1): sob delegação (governance_owner_id) o card pode pertencer ao
    // delegador, não ao 1º líder natural de `person` — slice(1) descartava esse líder
    // natural sem motivo nesse cenário. O filtro `l.id === leader.id` abaixo já cobre os
    // dois casos sozinho: caminho natural (card = 1º líder) ele mesmo bate e é pulado;
    // caminho delegado (card = delegador) o líder natural não bate e por isso é mantido
    // como co-líder legítimo.
    for (const l of resolveLeadersOf(person, list)) {
      if (l.is_ceo || l.id === leader.id) continue;
      if (!acc.has(l.id)) acc.set(l.id, new Set());
      acc.get(l.id).add(person.function_role || null);
    }
  }
  return [...acc.entries()]
    .map(([id, roles]) => {
      const only = roles.size === 1 ? [...roles][0] : null;
      return { id, name: firstName(byId.get(id) || {}), label: (only && FUNCTION_LABELS[only]) || 'time' };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}

const MAX_POR_FAIXA = 3;
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

// §7.5 — 3 itens por faixa, mas stuck e 30d+ FURAM a fila: são o motivo da cor,
// esconder eles seria repetir o defeito do `stuck` invisível que viemos matar.
function pickItems(items) {
  const fura = items.filter((i) => i.stuck || i.days >= 30);
  const resto = items.filter((i) => !(i.stuck || i.days >= 30));
  const mostra = [...fura, ...resto].slice(0, MAX_POR_FAIXA);
  const ordem = new Map(items.map((i, ix) => [i.id, ix]));   // devolve à ordem original
  return { mostra: mostra.sort((a, b) => ordem.get(a.id) - ordem.get(b.id)),
    resto: Math.max(0, items.length - mostra.length) };
}

const fmtItem = (i) => `    • ${i.title.slice(0, 55)} — ${i.days}d${i.stuck ? ' ⚠️ cobrada 3x' : ''}`;

function fmtFaixa(rotulo, items, comRotulo) {
  if (!items.length) return [];
  const { mostra, resto } = pickItems(items);
  const linhas = comRotulo ? [`   ${rotulo}`] : [];
  linhas.push(...mostra.map(fmtItem));
  if (resto > 0) linhas.push(`    _+${resto}_`);
  return linhas;
}

// DEFEITO 1 (dry-run 17/07) — analyzePersonBacklog (governance-analyzer.js) devolve
// uma SEÇÃO SOLTA, desenhada pra fechar a mensagem inteira: "🔍 *Nome:* {diag}\n\n💡
// *Recomendação:* {ação}". Encaixado cru dentro do bloco da pessoa (`💡 _${b.diagnostic}_`),
// o \n\n embutido furava a indentação do card (a linha da Recomendação nascia na coluna
// zero, quebrando o print) e o nome duplicava ("💡 _🔍 *Nome:* ...", emoji dentro de
// emoji — o bloco já diz de quem é, o prefixo é redundante aqui dentro).
//
// fmtDiagnostic conserta só o ENCAIXE — as PALAVRAS são do analyzer, sagradas, não se
// toca. ROBUSTA: o LLM pode fugir do formato pedido (o analyzer já tem fallback
// determinístico, mas nem o LLM nem um fallback futuro são garantia) — nesse caso NUNCA
// perde a frase, só a formatação bonita (feio > perdido).
function fmtDiagnostic(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  // tira "🔍 *Nome:* " do começo, se existir — redundante dentro do bloco da pessoa.
  const semPrefixo = text.replace(/^🔍\s*\*[^*]*\*\s*/, '').trim();
  if (!semPrefixo) return [];

  // separa a Recomendação: o prompt do analyzer sempre a bota em linha própria (linha
  // em branco antes), mas tolera variação de espaço/quebra — o que não pode variar é
  // perder texto.
  const m = semPrefixo.match(/^([\s\S]*?)\n+\s*💡\s*\*Recomenda[cç][aã]o:?\*\s*([\s\S]*)$/i);
  const oneLine = (s) => s.trim().replace(/\s*\n+\s*/g, ' ');

  if (m) {
    const diagLine = oneLine(m[1]);
    const recLine = oneLine(m[2]);
    const linhas = [];
    if (diagLine) linhas.push(`   💡 _${diagLine}_`);
    if (recLine) linhas.push(`      _Recomendação: ${recLine}_`);
    if (linhas.length) return linhas;
  }

  // Fallback: formato inesperado (sem "💡 *Recomendação:*", sem "🔍 *Nome:*", ou
  // qualquer coisa que o LLM tenha inventado). Indenta linha a linha, colapsando linhas
  // em branco — mas preserva TODO o texto que veio. Nunca devolve vazio havendo texto.
  const linhasCru = semPrefixo.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!linhasCru.length) return [`   💡 _${semPrefixo}_`];
  return [`   💡 _${linhasCru[0]}_`, ...linhasCru.slice(1).map((l) => `      _${l}_`)];
}

function fmtBlock(b) {
  const titulo = b.isSelf ? `*Próprias* · ${b.count}` : `  *${b.person.name}* · ${b.count}`;
  // §7.4 — com as DUAS faixas, cada uma leva rótulo. Com uma só, o rótulo não vale 2 linhas.
  const duas = b.novo.length > 0 && b.arrastando.length > 0;
  return ['', `  ${titulo.trim()}`,
    ...fmtFaixa('🆕 *Caiu hoje*', b.novo, duas),
    ...fmtFaixa('⏳ *Arrastando*', b.arrastando, duas),
    ...b.events.flatMap((e) => [`   📅 ${e.title.slice(0, 45)} (${e.whenLabel})`, '      _sem devolutiva_']),
    ...(b.diagnostic ? fmtDiagnostic(b.diagnostic) : []),
  ];
}

// Sem gênero: o card é printado e encaminhado PRA PESSOA, e não existe campo de gênero em
// `collaborators`. "Dele" fixo erraria com Juliana/Krissya/Rose/Anne/Bianca; heurística por
// nome erraria com gente real. "próprias" (tarefas próprias) é natural e correto pra todos.
// Se algum dia existir campo de gênero, é aqui que ele entra.
//
// DEFEITO 2 (dry-run 17/07) — mesmo caso pra nota de co-líder ("dividido com o/a {nome}"):
// o artigo fixo "o" acerta o Quintela por ACASO (ele é homem), não por sorte que se deva
// manter — o MESMO código erra "com o Rose" (ela é mulher). E quando 2 co-líderes
// DIFERENTES dividem o MESMO rótulo (caso real: Krissya via "farmers" com Fabi E com
// Rose em 2 linhas), a nota duplicava em vez de colapsar — o rótulo é o MESMO vínculo.
function joinNames(names) {
  if (names.length <= 2) return names.join(' e ');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function fmtCoLeaderLines(coLeaders) {
  const byLabel = new Map(); // label -> [nomes...] na ordem de chegada (coLeaders já vem ordenado por nome)
  for (const co of (coLeaders || [])) {
    if (!byLabel.has(co.label)) byLabel.set(co.label, []);
    byLabel.get(co.label).push(co.name);
  }
  return [...byLabel.entries()].map(([label, names]) => `_${label} dividido com ${joinNames(names)}_`);
}

function renderLeaderCard(card) {
  const pct = card.closurePct === null ? '' : `${card.closurePct}% · `;
  const linhas = [`${card.dot} *${card.leader.name}* — ${pct}${plural(card.totals.all, 'pendência', 'pendências')}`];
  // Hoje um card com totals.all===0 nunca chega aqui (§7.6 manda pra `ritmo` antes) —
  // o guard fica como defesa, não como caminho exercitado pelos testes atuais.
  if (card.totals.all > 0) linhas.push(`_${card.totals.team} do time · ${plural(card.totals.own, 'própria', 'próprias')}_`);
  for (const line of fmtCoLeaderLines(card.coLeaders)) linhas.push(line);
  for (const b of card.people) linhas.push(...fmtBlock(b));
  return linhas.join('\n');
}

function renderUnassigned(blocks) {
  if (!blocks.length) return '';
  const total = blocks.reduce((s, b) => s + b.count, 0);
  return [`❓ *Direto com você* — ${plural(total, 'pendência', 'pendências')}`,
    ...blocks.flatMap((b) => fmtBlock(b))].join('\n');
}

module.exports = { buildLeaderCards, classifyCard, renderLeaderCard, renderUnassigned,
  daysBetweenYmd, FUNCTION_LABELS, LEADER_ROLES, fmtDiagnostic, fmtCoLeaderLines };
