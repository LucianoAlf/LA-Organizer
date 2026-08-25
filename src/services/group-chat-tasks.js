// src/services/group-chat-tasks.js
// Chat de grupo Fase 2 — applier mínimo de tarefas do POOL do grupo.
// NÃO usa o applyTaskActions do WhatsApp (evita lembretes/cascata no zap).
//
// Anti-duplicação (GROUPCHAT-TASK-DUP-WEEKDAY, 12/06): o LLM reemite `create`
// quando a pessoa CORRIGE/acrescenta algo da tarefa recém-criada ("é dia 15 e não
// 16", "coloca pra Anne também"). Sem dedup, cada mensagem virava uma tarefa nova
// quase-idêntica (3x "Anne separar cheque…"). Aqui: antes de inserir, procuramos no
// pool RECENTE do grupo (24h) uma tarefa de título muito parecido (Jaccard de tokens
// normalizados ≥ THRESHOLD) e, se achar, ATUALIZAMOS no lugar (due_date/remind_at)
// em vez de criar outra. Resolve o caso de correção e o de paráfrase do mesmo pedido.

// Filtro de VISIBILIDADE do digest, reusado (fonte única: completer e relatório NÃO podem divergir).
// dropOpenWithDoneTwin esconde ocorrência com gêmea concluída; categorize marca retroativa.
const { dropOpenWithDoneTwin, categorize } = require('./group-report-builder');

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // só dedup contra tarefas recentes (mesma conversa)
const SIM_THRESHOLD = 0.7;                    // Jaccard mínimo p/ considerar "mesma tarefa"
const _STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'para', 'pra', 'pro', 'que', 'esse', 'essa', 'esses', 'essas', 'um', 'uma', 'no', 'na', 'em', 'com', 'ao', 'aos', 'à', 'às', 'the']);

// Conjunto de tokens normalizados (minúsculo, sem acento, sem pontuação, sem stopword).
function _titleTokens(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos (diacríticos combinantes)
      .replace(/[^a-z0-9\s]/g, ' ')                      // pontuação → espaço
      .split(/\s+/)
      .filter((w) => w && !_STOPWORDS.has(w))
  );
}

// Similaridade de Jaccard entre dois conjuntos de tokens (0..1).
function titleSimilarity(a, b) {
  const A = a instanceof Set ? a : _titleTokens(a);
  const B = b instanceof Set ? b : _titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Normaliza título p/ comparação exata tolerante: minúsculo, sem acento, pontuação→espaço, colapsa.
function _normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Resolve tarefas do POOL a partir de uma FRASE que pode ser o LABEL DECORADO do relatório
// ("{Pacote}: {Filha} ({Responsável})") — audit 08/07 GROUPCHAT-COMPLETE-COMPOSITE-LABEL-NOMATCH:
// os handlers casam `.ilike(title)` EXATO; quando a pessoa cola o label, nenhum `title` cru bate
// → not_found (a Rose colou "Depósito de Cheques: Venc 05 (prazo dia 06) (Rose)"; a filha real é
// "Venc 05 (prazo dia 06)"). Aqui: (1) exato normalizado (tolera acento/caixa que o ilike perde);
// se nada, (2) CONTAINMENT — tarefa cujos tokens do título estão TODOS na frase (título ⊆ colado),
// preferindo a MAIS específica (mais tokens = a filha sobre o pacote). Empatadas no top saem por
// due_date asc (o pickInstanceTarget escolhe o ciclo visível mais antigo aberto). Pura; nunca lança.
function matchPoolByPhrase(pool, phrase) {
  const rows = (Array.isArray(pool) ? pool : []).filter((r) => r && r.title);
  const pn = _normTitle(phrase);
  if (!pn) return [];
  const byDue = (a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''));
  const exact = rows.filter((r) => _normTitle(r.title) === pn).sort(byDue);
  if (exact.length) return exact;
  const ptoks = _titleTokens(phrase);
  if (!ptoks.size) return [];
  const scored = [];
  for (const r of rows) {
    const ttoks = _titleTokens(r.title);
    if (!ttoks.size) continue;
    let inter = 0;
    for (const t of ttoks) if (ptoks.has(t)) inter++;
    if (inter === ttoks.size) scored.push({ r, spec: ttoks.size }); // título inteiramente contido na frase
  }
  if (!scored.length) return [];
  const top = Math.max(...scored.map((s) => s.spec));
  return scored.filter((s) => s.spec === top).map((s) => s.r).sort(byDue);
}

// Dado os candidatos casados por título (mãe-instância e/ou molde recorrente),
// retorna a INSTÂNCIA a operar — NUNCA o molde (recurrence_rule != null). Cancelar
// ou concluir o molde mata a série inteira: o materializador (materializeAll) pula
// molde cancelado/concluído, então nunca mais regenera (caso Conciliação de Cartões/
// Rose 17/06). Rotina sempre mira a instância visível; parar a série é ação à parte.
function pickInstanceTarget(rows) {
  // VERDADE ÚNICA (Fatia 2): o blueprint (molde + filhas-template) NUNCA é trabalho vivo.
  // Este é o CHOKEPOINT — todo resolvedor de ação por título (complete via
  // pickVisibleCompletionTarget, cancel, reschedule, _resolveByPhraseFallback,
  // _resolvePackageChildByLabel) funila aqui. Barrar pelo marcador intrínseco fecha as bordas
  // que a heurística de rpid/rule deixava passar (molde cancelado, instância sumida). As queries
  // que alimentam este picker precisam SELECIONAR is_recurrence_template (senão o filtro é no-op).
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.is_recurrence_template !== true);
  const instances = list.filter((r) => r && r.recurrence_rule == null);
  // GROUPREPORT-MOLDE-CICLO-TWIN: num pacote, molde e ciclo são ambos rule=null. O ciclo (ocorrência
  // VISÍVEL) tem recurrence_parent_id preenchido; o molde (blueprint escondido) tem null. Rotina
  // (cancel/complete/reschedule) deve mirar o CICLO — foi o que descasou a Venc 20 da Rose (moveu o
  // molde escondido). Fallback: tarefa simples/one-off (sem ciclo) usa a própria linha.
  const cyclic = instances.filter((r) => r.recurrence_parent_id != null);
  return cyclic[0] || instances[0] || null;
}

// GROUPCHAT-COMPLETE-WRONG-CYCLE-STALE-TWIN (Rose 17/08): o alvo da conclusão tem que ser só o que
// o digest MOSTRA. O completer mirava por título+due_date ASC e pegava a ocorrência mais ANTIGA
// aberta — mas o relatório esconde as com gêmea-concluída (dropOpenWithDoneTwin) e as retroativas.
// Assim o TOM fechou o ciclo velho de 17/07 (que já tinha gêmea done) e a de HOJE seguiu aberta.
// Aqui: mesmo filtro do digest → sobra o pool VISÍVEL; pickInstanceTarget mira o ciclo corrente.
// rows: pool por título (ABERTAS + DONE p/ detectar gêmea), cada linha com created_ymd. Pura.
function pickVisibleCompletionTarget(rows, todayYmd) {
  const visiveis = dropOpenWithDoneTwin(Array.isArray(rows) ? rows : [])
    .filter((t) => t && t.is_group !== true)
    .filter((t) => categorize(t.due_date, todayYmd, t.created_ymd) !== 'retroativa')
    // "feito" conclui o ciclo corrente/atrasado — NUNCA um ciclo recorrente FUTURO (due > hoje):
    // se o corrente já está done, não "conclui" o próximo mês. Avulsa (não-recorrente) futura
    // segue liberada (dá pra concluir cedo). Fecha a mina do caso Rose 17/08 pós-remediação.
    .filter((t) => !(todayYmd && String(t.due_date || '') > todayYmd
      && (t.recurrence_parent_id != null || t.recurrence_rule != null)))
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  return pickInstanceTarget(visiveis);
}

// GROUPCHAT-FALLBACK-VISIBILITY (Rose 25/08) — a trava que faltava em TODO resolvedor de alvo por
// título/frase/label. Só o completer PRIMÁRIO (pickVisibleCompletionTarget) tinha; os DOIS fallbacks
// (frase, label de pacote) E as PRIMÁRIAS de reschedule/cancel chamavam pickInstanceTarget CRU e
// pegavam a ocorrência mais ANTIGA aberta — inclusive um ciclo velho que já tem GÊMEA concluída e que
// o digest ESCONDE (o TOM fechou/remarcou a 25/07 done-twin'd em vez da 25/08 que a Rose fez). Fix de
// RAIZ: um só chokepoint de visibilidade — dropOpenWithDoneTwin (o MESMO do digest) antes do
// pickInstanceTarget. rows precisa vir com DONE incluído (senão não há gêmea a detectar). NÃO aplica
// retroativa/futuro (escopo do digest/complete; aqui só a gêmea era o bug, e adicioná-los esconderia
// alvo legítimo que o resolvedor antigo alcançava — quebrou os testes com fixture retroativo).
function pickVisibleInstance(rows) {
  // NÃO filtra is_group: reschedule/cancel de CONTAINER (pacote) é legítimo (cascateia pras filhas).
  // Barrar container é escopo do COMPLETE — o completer guarda isso à parte (semContainer / o
  // pickVisibleCompletionTarget tem o filtro). Aqui só a gêmea-concluída era o bug.
  const visiveis = dropOpenWithDoneTwin(Array.isArray(rows) ? rows : [])
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  return pickInstanceTarget(visiveis);
}

// Dado candidatos por título, acha o MOLDE da série (recurrence_rule != null). Pura.
// Usado por ENCERRAR SÉRIE (ação deliberada): aí sim a gente quer o molde, não a instância.
function resolveSeriesTemplate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.find((r) => r && r.recurrence_rule != null) || null;
}

// ── Dedup de PACOTE (anti-churn do <<TASK_GROUP>>) ──────────────────────────────
// O LLM reemite `create` quando a pessoa "ajusta" um pacote que já existe ("coloca a
// Anne também", "muda o lembrete"). Sem dedup, cada reemissão criava uma GERAÇÃO inteira
// nova (3x "Conciliação de Cartões" no banco — caso Rose). Estes helpers (puros) deixam o
// engine MERGEAR só os itens novos no pacote visível em vez de duplicar.

// Pacote-mãe ativo mais parecido (>= threshold) com o título novo, ou null.
function findDuplicatePackage(mothers, newTitle, threshold = SIM_THRESHOLD) {
  const tok = _titleTokens(newTitle);
  if (!tok.size) return null;
  let best = null, bestSim = 0;
  for (const m of mothers || []) {
    const sim = titleSimilarity(tok, _titleTokens(m && m.title));
    if (sim > bestSim) { bestSim = sim; best = m; }
  }
  return bestSim >= threshold ? best : null;
}

// Resolve a INSTÂNCIA visível onde mergear: match já-instância → ela mesma; molde
// recorrente → instância ativa do ciclo corrente (menor due_date); pacote simples → ele.
function resolveVisibleInstance(mothers, dup) {
  if (!dup) return null;
  // template da série: o próprio (se for molde) ou o pai (se for instância).
  const tplId = dup.recurrence_rule ? dup.id : dup.recurrence_parent_id;
  if (!tplId) return dup; // pacote simples (não-recorrente)
  // SEMPRE o ciclo corrente (menor due_date) — determinístico, não depende de qual
  // mãe o findDuplicatePackage casou (template ou instância de qualquer mês).
  const insts = (mothers || []).filter((m) => m && m.recurrence_parent_id === tplId);
  insts.sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  return insts[0] || dup; // edge: molde sem instância materializada
}

// Subtarefas do create que NÃO existem como filha (por título parecido) — evita
// re-adicionar cartões que já estão no pacote.
function filterNewSubtasks(existingChildTitles, subtasks, threshold = SIM_THRESHOLD) {
  const existing = (existingChildTitles || []).map((t) => _titleTokens(t));
  return (subtasks || []).filter((s) => {
    const tok = _titleTokens(s && s.title);
    if (!tok.size) return false;
    return !existing.some((et) => titleSimilarity(tok, et) >= threshold);
  });
}

// Fallback IO do resolvedor: busca o pool ABERTO do grupo e casa por FRASE (matchPoolByPhrase),
// mirando o ciclo visível (pickInstanceTarget). Só roda quando o `.ilike` EXATO não achou — em
// geral porque a pessoa colou o label decorado do relatório. Degrada pra null; nunca lança.
async function _resolveByPhraseFallback({ supabase, groupId, phrase }) {
  try {
    // Inclui DONE (só exclui cancelled): o pickVisibleInstance precisa da gêmea-concluída pra
    // esconder o ciclo velho e mirar o corrente — MESMA verdade do digest (GROUPCHAT-FALLBACK-VISIBILITY).
    const { data: pool } = await supabase.from('tasks')
      .select('id, title, recurrence_rule, recurrence_parent_id, due_date, is_group, is_recurrence_template, status')
      .eq('assigned_group_id', groupId).neq('status', 'cancelled').limit(200);
    return pickVisibleInstance(matchPoolByPhrase(pool || [], phrase));
  } catch (_) { return null; }
}

// GROUPCHAT-CREATE-COMPOSITE-LABEL-DUP (31/07, caso Rose) — resolve o LABEL COMPOSTO
// "Pacote: Filha" na FILHA real do pacote. O relatório do grupo renderiza a filha com o
// prefixo do pacote ("Repasses de Cartões - Maquininha: CG"), mas no banco ela se chama só
// "CG" — então o LLM age pelo label que leu e o dedup do create não reconhece. Somado à
// janela de 24h do dedup (a filha nasceu no dia 1º, materializada pela recorrência), pedir
// "remaneja" acabava CRIANDO duplicata em vez de editar.
// PRECISÃO DE PROPÓSITO (não usa o containment genérico do matchPoolByPhrase): exige que o
// prefixo seja um CONTAINER is_group existente E o sufixo seja FILHA dele. Sem isso, criar
// "Comprar cadeiras CG" casaria com a tarefa "CG" e viraria update — falso-positivo pior
// que o bug. Nunca mira molde (pickInstanceTarget + recurrence_rule == null).
async function _resolvePackageChildByLabel({ supabase, groupId, label }) {
  try {
    const i = String(label || '').indexOf(':');
    if (i < 1) return null;
    const pkg = _normTitle(label.slice(0, i));
    const child = _normTitle(label.slice(i + 1));
    if (!pkg || !child) return null;
    const { data } = await supabase.from('tasks')
      .select('id, title, due_date, parent_task_id, is_group, recurrence_rule, recurrence_parent_id, is_recurrence_template, status')
      .eq('assigned_group_id', groupId).neq('status', 'cancelled').limit(300);
    const rows = data || [];
    const containers = new Set(rows.filter((r) => r.is_group === true && _normTitle(r.title) === pkg).map((r) => r.id));
    if (!containers.size) return null;
    // Inclui DONE no filtro pra o pickVisibleInstance detectar gêmea e mirar o ciclo corrente
    // (mesma verdade do digest — GROUPCHAT-FALLBACK-VISIBILITY).
    const filhas = rows.filter((r) => r.parent_task_id && containers.has(r.parent_task_id)
      && _normTitle(r.title) === child && r.recurrence_rule == null);
    return pickVisibleInstance(filhas);
  } catch (_) { return null; }
}

async function applyGroupChatTaskActions({ supabase, groupId, senderCollabId, actions }) {
  const created = [];
  const updated = [];
  const completed = [];
  const cancelled = [];
  const failed = [];

  // Candidatas a dedup: pool recente (24h) não-concluído do grupo. Falha → sem dedup
  // (degrada pra inserir; nunca lança). Inclui as criadas DENTRO deste mesmo batch.
  let candidates = [];
  try {
    const sinceISO = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const { data } = await supabase
      .from('tasks')
      .select('id, title, due_date')
      .eq('assigned_group_id', groupId)
      .neq('status', 'done')
      // CANCELADA não é candidata a dedup (31/07): o pool só excluía 'done', então uma tarefa
      // cancelada recente casava e recebia o patch — o TOM dizia "ajustei" e o usuário não via
      // NADA (cancelada não aparece em lugar nenhum) = NOOP silencioso. Achado ao testar o fix
      // do label composto contra o banco real: ele resolveu na duplicata cancelada minutos antes.
      .neq('status', 'cancelled')
      .gte('created_at', sinceISO);
    candidates = (data || []).map((t) => ({ id: t.id, title: t.title, due_date: t.due_date, tokens: _titleTokens(t.title) }));
  } catch (_) { candidates = []; }

  function findDuplicate(title) {
    const tok = _titleTokens(title);
    let best = null, bestSim = 0;
    for (const c of candidates) {
      const sim = titleSimilarity(tok, c.tokens);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    return bestSim >= SIM_THRESHOLD ? best : null;
  }

  for (const a of actions || []) {
    try {
      if (a.action === 'create') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }

        const wantsDue = typeof a.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date) ? a.due_date : null;
        let remindISO = null;
        if (typeof a.remind_at === 'string' && a.remind_at.trim()) {
          const d = new Date(a.remind_at.trim());
          if (!Number.isNaN(d.getTime())) remindISO = d.toISOString();
        }
        const recur = (typeof a.recurrence_rule === 'string' && a.recurrence_rule.trim())
          ? a.recurrence_rule.trim().replace(/^RRULE:/i, '') : null;

        // ── Dedup: já existe tarefa quase-igual recente? Atualiza no lugar. ──
        let dup = findDuplicate(title);
        // O dedup acima só enxerga o pool de 24h e compara por tokens — não reconhece a
        // filha de pacote pelo LABEL COMPOSTO que o relatório exibe. Ver
        // _resolvePackageChildByLabel (GROUPCHAT-CREATE-COMPOSITE-LABEL-DUP).
        let _dupIsPackageChild = false;
        if (!dup) {
          const _child = await _resolvePackageChildByLabel({ supabase, groupId, label: title });
          if (_child) { dup = { id: _child.id, title: _child.title, due_date: _child.due_date }; _dupIsPackageChild = true; }
        }
        // Filha de pacote NÃO pode receber recurrence_rule: quem manda na cadência do pacote é
        // o molde-mãe (container template). Gravar a regra na filha a transforma em MOLDE e ela
        // SOME do relatório do grupo (o builder filtra recurrence_rule != null) — que é
        // exatamente o sintoma que a Rose viu em 31/07. Remaneja a data (isso funciona) e
        // devolve o aviso honesto de que a cadência do pacote não se ajusta por aqui.
        if (dup && _dupIsPackageChild && recur) {
          const patch = {};
          if (wantsDue && wantsDue !== dup.due_date) patch.due_date = wantsDue;
          if (remindISO) patch.remind_at = remindISO;
          if (Object.keys(patch).length) {
            const { data: upd } = await supabase.from('tasks').update(patch).eq('id', dup.id).select('id, title').maybeSingle();
            if (upd) updated.push({ ...upd, changed: patch });
          }
          failed.push({ action: a, why: 'package_recurrence_unsupported' });
          continue;
        }
        // (A) Recorrente: correção do mesmo assunto recente ("ajusta o lembrete dos Depósitos")
        // ATUALIZA a RRULE/due/remind da série existente e re-materializa, em vez de criar
        // outra série quase-idêntica (caso Rose 12/06). Caso GROUPCHAT-TASK-DUP-WEEKDAY estendido.
        if (dup && recur) {
          const patch = { recurrence_rule: recur };
          if (wantsDue) patch.due_date = wantsDue;
          if (remindISO) patch.remind_at = remindISO;
          const { data: upd } = await supabase.from('tasks').update(patch).eq('id', dup.id).select('id, title').maybeSingle();
          if (upd) {
            try {
              // limpa instâncias futuras não-concluídas e re-materializa com a regra nova.
              const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
              await supabase.from('tasks').update({ status: 'cancelled' })
                .eq('recurrence_parent_id', dup.id).neq('status', 'done').gte('due_date', todayYmd);
              const { materializeSeries } = require('./recurrence-engine');
              const { data: full } = await supabase.from('tasks').select('*').eq('id', dup.id).maybeSingle();
              if (full && full.recurrence_rule) await materializeSeries('tasks', full);
            } catch (e) { console.warn('[GroupChat] re-materialize:', e.message); }
            updated.push({ ...upd, changed: patch });
            continue;
          }
        }
        if (dup && !recur) {
          const patch = {};
          if (wantsDue && wantsDue !== dup.due_date) patch.due_date = wantsDue;
          if (remindISO) patch.remind_at = remindISO;
          if (Object.keys(patch).length) {
            const { data: upd } = await supabase.from('tasks').update(patch).eq('id', dup.id).select('id, title').maybeSingle();
            if (upd) { dup.due_date = wantsDue || dup.due_date; updated.push({ ...upd, changed: patch }); continue; }
          }
          // Nada novo a mudar (mesmo assunto, sem campo diferente) → trata como já-feito, sem dup.
          updated.push({ id: dup.id, title: dup.title, changed: {} });
          continue;
        }

        const row = { title, assigned_group_id: groupId, created_by: senderCollabId, status: 'pending' };
        if (wantsDue) row.due_date = wantsDue;
        // Lembrete agendado ("me lembra segunda…"): grava remind_at (o cron de deadlines
        // dispara o aviso quando remind_at <= now e ainda não foi enviado).
        if (remindISO) row.remind_at = remindISO;
        // Recorrência (Sprint 4): armazena a RRULE e materializa as instâncias logo após.
        if (recur) row.recurrence_rule = recur;

        const { data, error } = await supabase.from('tasks').insert(row).select('id, title').single();
        if (error) { failed.push({ action: a, why: error.message }); continue; }
        if (recur && data?.id) {
          try {
            const { materializeSeries } = require('./recurrence-engine');
            const { data: fullTpl } = await supabase.from('tasks').select('*').eq('id', data.id).maybeSingle();
            if (fullTpl) await materializeSeries('tasks', fullTpl);
          } catch (e) { console.warn('[GroupChat] materialize recorrência falhou:', e.message); }
        }
        created.push(data);
        // Entra como candidata pra dedup das próximas ações deste mesmo batch.
        if (data?.id) candidates.push({ id: data.id, title, due_date: wantsDue, tokens: _titleTokens(title) });
      } else if (a.action === 'complete') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        // Resolve por título dentro do pool do grupo, ainda não concluída.
        // Protege a série: conclui a INSTÂNCIA visível, NUNCA o molde recorrente
        // (concluir o molde mata a série — materializeAll não regenera molde done).
        const { data: found } = await supabase
          .from('tasks')
          // `recurrence_parent_id` separa a filha-INSTÂNCIA (tem) da filha-TEMPLATE (não tem).
          // Inclui DONE (pra detectar a GÊMEA concluída — dropOpenWithDoneTwin) e created_at (pra
          // retroativa): o alvo tem que ser só o que o digest MOSTRA. Sem isso o completer pegava a
          // ocorrência mais antiga aberta e fechava o ciclo velho (fechou 4 existindo 2, Rose 12/08;
          // fechou 17/07 com gêmea done deixando a de HOJE aberta, Rose 17/08). Cancelada fora.
          .select('id, title, recurrence_rule, recurrence_parent_id, is_group, status, due_date, created_at, is_recurrence_template')
          .eq('assigned_group_id', groupId)
          .neq('status', 'cancelled')
          .ilike('title', title)
          .order('due_date', { ascending: false })
          .limit(30);
        // GROUPPKG-CONTAINER-COMPLETABLE-GROUP (05/08): container de pacote é PASTA, não
        // tarefa. Concluí-lo fecha a pasta e deixa as filhas abertas por dentro — o mesmo
        // dano do caso Rose (03/08) por outra porta. Aquela veio pelo chat 1:1, onde o
        // container era listado no prompt; esta resolve por título DIRETO na tabela, então
        // o filtro do pool não protege. Filtro em JS (e não .neq no builder) porque `neq`
        // sobre booleano descartaria linha com is_group NULL junto — e é o mesmo formato
        // usado em group-chat-engine.js e group-report-builder.js.
        //
        // Vale só para o COMPLETE. O reschedule logo abaixo continua alcançando container
        // de propósito: mover o prazo do pacote é operação legítima (é o que o PWA faz).
        const semContainer = (t) => !!t && t.is_group !== true;
        const _spYmd = (ts) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts)); } catch (_) { return null; } };
        const _todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const _rows = (found || []).map((t) => ({ ...t, created_ymd: _spYmd(t.created_at) }));
        const _open = _rows.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
        // Mira só o pool VISÍVEL (espelha o digest): esconde gêmea-concluída e retroativa.
        let target = pickVisibleCompletionTarget(_rows, _todayYmd);
        // Fallback (GROUPCHAT-COMPLETE-COMPOSITE-LABEL-NOMATCH): a pessoa colou o label do
        // relatório ("{Pacote}: {Filha} ({Resp})") → o ilike exato não bate no title cru.
        // O fallback é compartilhado com o reschedule, então o guard fica aqui, no ramo.
        if (!target) {
          const viaFrase = await _resolveByPhraseFallback({ supabase, groupId, phrase: title });
          target = semContainer(viaFrase) ? viaFrase : null;
        }
        // GROUPCHAT-COMPLETE-TEMPLATE-ONLY-CYCLE (Rose 06/08): mensal que ainda não gerou
        // instância. O ciclo corrente É O PRÓPRIO MOLDE — o materializeSeries semeia a data do
        // molde como já existente, de propósito, pra não duplicar. E pickInstanceTarget descarta
        // molde, também de propósito, porque concluir molde MATA a série (materializeAll não
        // regenera molde done). Entre as duas regras corretas, ninguém conclui o ciclo corrente:
        // a Rose ouviu "não achei essa tarefa no grupo" sobre trabalho que estava na tela dela.
        //
        // Saída: materializa a ocorrência como instância JÁ CONCLUÍDA. O molde não é tocado —
        // é ele que gera os meses seguintes. A instância done na mesma data também faz o molde
        // sumir do pool sozinho, via dropOpenWithDoneTwin (casa por título|due_date).
        if (!target) {
          let _tpl = resolveSeriesTemplate(_open.filter(semContainer));
          // O `ilike` exato acima só acha quando o LLM emite o título inteiro. A pessoa fala
          // apelido ("relatório"), e o matchPoolByPhrase também não salva: ele exige o título
          // CONTIDO na frase, que é a direção oposta da que se fala. Aqui a busca é PARCIAL e
          // restrita a MOLDE — e só resolve se houver exatamente UM. Dois ou mais: falha
          // honesta, sem escolher no chute.
          if (!_tpl) {
            const { data: _tpls } = await supabase.from('tasks')
              .select('id, title, due_date, recurrence_rule, recurrence_parent_id, is_group, remind_at, description, assigned_group_id, created_by, data_classification, context, priority')
              .eq('assigned_group_id', groupId)
              .not('status', 'in', '("done","cancelled")')
              .not('recurrence_rule', 'is', null)
              .is('recurrence_parent_id', null)
              .ilike('title', `%${String(title).slice(0, 60)}%`)
              .limit(5);
            const _cands = (_tpls || []).filter(semContainer);
            if (_cands.length === 1) _tpl = _cands[0];
            else if (_cands.length > 1) {
              console.warn(`[GroupChat] apelido "${String(title).slice(0, 40)}" casou com ${_cands.length} moldes — falha honesta em vez de chute`);
            }
          }
          // O _tpl do caminho primário vem de `_open` (colunas PARCIAIS — sem assigned_group_id/
          // created_by), então clonar dele geraria ocorrência órfã (fora do grupo) ou insert que
          // falha. Re-busca a linha COMPLETA antes de materializar (o caminho por apelido já traz
          // mais colunas, mas uniformizar aqui fecha o buraco pros dois).
          if (_tpl && _tpl.id) {
            const { data: _full } = await supabase.from('tasks').select('*').eq('id', _tpl.id).maybeSingle();
            if (_full) _tpl = _full;
          }
          if (_tpl && _tpl.due_date) {
            try {
              const { _cloneTemplate } = require('./recurrence-engine');
              const linha = _cloneTemplate('tasks', _tpl, new Date(`${_tpl.due_date}T12:00:00Z`));
              linha.status = 'done';
              linha.completed_at = new Date().toISOString();
              linha.completed_by = senderCollabId;
              const { data: nova, error: eIns } = await supabase.from('tasks').insert(linha).select('id, title').maybeSingle();
              if (eIns) throw new Error(eIns.message);
              if (nova) {
                completed.push(nova);
                console.log(`[GroupChat] ciclo corrente do molde ${String(_tpl.id).slice(0, 8)} materializado JÁ concluído (${_tpl.due_date}) — molde intacto`);
                continue;
              }
            } catch (eMat) {
              console.error('[GroupChat] falha ao materializar ciclo corrente:', eMat.message);
            }
          }
        }
        if (!target) { failed.push({ action: a, why: 'not_found_in_pool' }); continue; }
        // Anti-corrida: só marca se ainda não estava done.
        const patch = { status: 'done', completed_at: new Date().toISOString(), completed_by: senderCollabId, updated_by: senderCollabId };
        const { data: upd } = await supabase
          .from('tasks')
          .update(patch)
          .eq('id', target.id)
          .neq('status', 'done')
          .select('id, title');
        if (!upd || !upd.length) { failed.push({ action: a, why: 'race_lost' }); continue; }
        completed.push(target);
      } else if (a.action === 'cancel') {
        // TOM cancela tarefa do grupo a pedido. Alf LIBEROU (15/06) remover tarefa ANTIGA também
        // (antes só <24h). Escopo de segurança que PERMANECE: só tarefa do GRUPO (NUNCA pessoal) e
        // ainda aberta. Mãe de grupo → cancela as filhas. Cancel é soft (status=cancelled, reversível).
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        const { data: hit } = await supabase
          .from('tasks')
          // recurrence_parent_id obrigatório — ver a nota no ramo `complete`. Cancelar a
          // filha-template no lugar da real é pior que concluir: some trabalho da frente
          // de todo mundo e o molde fica marcado.
          .select('id, title, due_date, status, is_group, recurrence_rule, recurrence_parent_id, is_recurrence_template')
          .eq('assigned_group_id', groupId)
          // Inclui DONE (só exclui cancelled) pro pickVisibleInstance esconder a gêmea-concluída e
          // mirar o ciclo corrente — MESMA verdade do digest (GROUPCHAT-FALLBACK-VISIBILITY, Rose 25/08).
          .neq('status', 'cancelled')
          .ilike('title', title)
          .order('due_date', { ascending: true })
          .limit(30);
        // Protege a série recorrente: cancela a INSTÂNCIA visível, NUNCA o molde.
        // Cancelar o template mata a série inteira — materializeAll pula molde
        // cancelado, então nunca mais regenera (caso Conciliação de Cartões/Rose 17/06).
        let target = pickVisibleInstance(hit || []);
        if (!target) target = await _resolveByPhraseFallback({ supabase, groupId, phrase: title, excludeCancelled: true });
        if (!target) { failed.push({ action: a, why: 'not_found_in_group' }); continue; }
        // updated_by (13/08): quem pediu o cancelamento fica registrado — inclusive na
        // cascata pras filhas, que é onde some mais trabalho de uma vez só.
        const _porQuem = { updated_by: senderCollabId || null };
        await supabase.from('tasks').update({ status: 'cancelled', ..._porQuem }).eq('id', target.id);
        if (target.is_group) {
          await supabase.from('tasks').update({ status: 'cancelled', ..._porQuem }).eq('parent_task_id', target.id).neq('status', 'done');
        }
        cancelled.push({ id: target.id, title: target.title });
      } else if (a.action === 'reschedule') {
        // Editar PRAZO/lembrete de tarefa do grupo. Mira a INSTÂNCIA visível (nunca o molde).
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        const nd = typeof a.new_due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.new_due_date) ? a.new_due_date : null;
        let nr = null;
        if (typeof a.new_remind_at === 'string' && a.new_remind_at.trim()) {
          const d = new Date(a.new_remind_at.trim()); if (!Number.isNaN(d.getTime())) nr = d.toISOString();
        }
        if (!nd && !nr) { failed.push({ action: a, why: 'reschedule_no_date' }); continue; }
        // `is_group` é obrigatório aqui: sem ele não há como saber que o alvo é um CONTAINER
        // e a cascata abaixo nunca dispararia. (O dublê dos testes ignora a lista de colunas,
        // então essa falta passaria verde na suíte e só apareceria em produção.)
        const { data: found } = await supabase.from('tasks')
          // recurrence_parent_id obrigatório — ver a nota no ramo `complete`. Remarcar a
          // filha-template move o molde e descasa a série: foi o que fez o TOM "criar 3
          // duplicadas" ao remanejar os Repasses da Rose em 31/07.
          .select('id, title, due_date, status, recurrence_rule, recurrence_parent_id, is_group, is_recurrence_template').eq('assigned_group_id', groupId)
          // Inclui DONE (só exclui cancelled): pickVisibleInstance esconde a gêmea-concluída e mira o
          // ciclo corrente — antes remarcava a data do ciclo VELHO (GROUPCHAT-FALLBACK-VISIBILITY).
          .neq('status', 'cancelled').ilike('title', title)
          .order('due_date', { ascending: true }).limit(30);
        let target = pickVisibleInstance(found || []);
        if (!target) target = await _resolveByPhraseFallback({ supabase, groupId, phrase: title, excludeCancelled: true });
        if (!target) { failed.push({ action: a, why: 'not_found_in_pool' }); continue; }
        // updated_by (13/08): remarcar move trabalho de dia sem deixar rastro de quem moveu —
        // e desce em cascata pras filhas logo abaixo, então some prazo de várias de uma vez.
        const patch = { updated_by: senderCollabId }; if (nd) patch.due_date = nd; if (nr) patch.remind_at = nr;
        const { data: upd } = await supabase.from('tasks').update(patch).eq('id', target.id).select('id, title').maybeSingle();
        if (upd) {
          // PACOTE É UMA UNIDADE (incidente Rose, 08/08 11:15). O `cancel` acima já descia
          // para as filhas; aqui a mesma regra faltava. O TOM movia só o container e dizia
          // "passei as três subtarefas" — elas ficavam no dia velho. Ela repetiu "ainda tá
          // 30" três vezes e ele repetiu que tinha feito.
          // `done` fica de fora (histórico não se remarca), igual ao cancel.
          if (target.is_group) {
            await supabase.from('tasks').update(patch).eq('parent_task_id', target.id).neq('status', 'done');
          }
          updated.push({ ...upd, changed: patch });
        } else failed.push({ action: a, why: 'race_lost' });
      } else {
        failed.push({ action: a, why: 'unsupported_action' });
      }
    } catch (err) {
      failed.push({ action: a, why: err.message });
    }
  }

  return { created, updated, completed, cancelled, failed };
}

// Encerra a SÉRIE (ação deliberada, à parte da rotina): cancela o molde + as instâncias
// não-done (corrente + futuras). Reversível (soft) via reviveSeries. Done preservado (histórico).
//
// ⚠️ CORREÇÃO DE COMENTÁRIO (09/08): aqui dizia "molde cancelado → materializeAll já pula molde
// cancelado, então PARA de gerar". Isso era verdade até o flip da FATIA 2 (24/06) e ficou FALSO
// depois: `materializeAll` filtra `.is('series_ended_at', null)` e NÃO olha status
// (recurrence-engine.js:384), e `shouldMaterializeTemplate` idem. Quem para a série é o
// `series_ended_at` que esta função seta na MESMA escrita do cancelamento — não o status.
// O comentário velho é o que fez o buraco passar despercebido: cancelar o molde por outra
// porta (sem `scope:'series'`) deixa a série viva aos olhos do cron.
async function endSeries({ supabase, templateId }) {
  // FATIA 2: series_ended_at é o que de fato PARA a série pós-flip (o guard novo ignora status).
  await supabase.from('tasks').update({ status: 'cancelled', series_ended_at: new Date().toISOString() }).eq('id', templateId);
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('recurrence_parent_id', templateId).neq('status', 'done');
  // FATIA 4: as filhas-BLUEPRINT (parent_task_id=molde, recurrence_parent_id null) não têm lineage de
  // instância, então a linha acima não as pega — ficavam pending órfãs (invisíveis só por sorte do
  // filtro do relatório; com o flag, invisíveis, mas ainda pending no banco). Cancela por higiene.
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('parent_task_id', templateId).neq('status', 'done');
  return { ended: true, id: templateId };
}

// Religa a série: reativa o molde CANCELADO (por título) + re-materializa (materializeSeries,
// NÃO materializeAll — mesmo helper do dedup-recur). Inverso do endSeries. Direto (constructivo).
async function reviveSeries({ supabase, groupId, title }) {
  // Só o MOLDE (recurrence_rule != null). Sem este filtro, séries densas (N instâncias
  // canceladas com o MESMO título após o clone) enchiam o limit(5) de instâncias e o molde
  // ficava fora do top-5 por created_at → reviveSeries falhava com not_found (achado E2E Fatia 2).
  const { data: hit } = await supabase.from('tasks')
    .select('id, title, recurrence_rule, status').eq('assigned_group_id', groupId)
    .eq('status', 'cancelled').not('recurrence_rule', 'is', null).ilike('title', String(title || '').trim())
    .order('created_at', { ascending: false }).limit(5);
  const tpl = (hit || []).find((r) => r && r.recurrence_rule != null);
  if (!tpl) return { revived: false, reason: 'not_found' };
  // FATIA 2: limpar series_ended_at é o que RELIGA a série pós-flip (status=pending sozinho
  // não basta — o guard novo keia series_ended_at). Inverso do endSeries.
  await supabase.from('tasks').update({ status: 'pending', series_ended_at: null }).eq('id', tpl.id);
  // Reativa as instâncias FUTURAS que o endSeries cancelou. Crítico: materializeSeries deduplica
  // por due_date INCLUINDO canceladas → sem este un-cancel, religar não traz as ocorrências de volta.
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  await supabase.from('tasks').update({ status: 'pending' })
    .eq('recurrence_parent_id', tpl.id).eq('status', 'cancelled').gte('due_date', todayYmd);
  try {
    const { materializeSeries } = require('./recurrence-engine');
    const { data: full } = await supabase.from('tasks').select('*').eq('id', tpl.id).maybeSingle();
    if (full && full.recurrence_rule) await materializeSeries('tasks', full);
  } catch (e) { console.warn('[GroupChat] revive re-materialize:', e.message); }
  return { revived: true, id: tpl.id, title: tpl.title };
}

// DERECUR ("só o primeiro mês" — refat verdade-única, Fatia 3): para de REPETIR mas MANTÉM o
// ciclo corrente. Difere do endSeries (que cancela TUDO, inclusive o corrente): aqui só o
// PRÓXIMO ciclo em diante cai. Mesmo par molde do endSeries (status cancelled + series_ended_at)
// pra continuar religável pelo reviveSeries ("volta a recorrência"). O flag is_recurrence_template
// já esconde o molde/blueprint; series_ended_at para o cron; a filha-blueprint órfã é tratada na
// Fatia 4 (endSeries) — aqui ela nasce invisível pelo flag.
async function derecurSeries({ supabase, templateId }) {
  const nowIso = new Date().toISOString();
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [y, m] = todayYmd.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m é 1-based → dia 0 do mês seguinte
  const fimMes = `${todayYmd.slice(0, 8)}${String(ultimoDia).padStart(2, '0')}`;
  // Molde: para o cron (series_ended_at) e fica localizável pra religar (status cancelled).
  await supabase.from('tasks').update({ status: 'cancelled', series_ended_at: nowIso }).eq('id', templateId);
  // Só o PRÓXIMO ciclo em diante (due > fim do mês corrente); o corrente + filhas ficam intactos.
  const { data: futuras } = await supabase.from('tasks')
    .select('id').eq('recurrence_parent_id', templateId).neq('status', 'done').gt('due_date', fimMes);
  const futIds = (futuras || []).map((r) => r.id);
  if (futIds.length) {
    await supabase.from('tasks').update({ status: 'cancelled' }).in('id', futIds);
    await supabase.from('tasks').update({ status: 'cancelled' }).in('parent_task_id', futIds).neq('status', 'done');
  }
  return { derecurred: true, id: templateId, futurasCanceladas: futIds.length };
}

module.exports = {
  applyGroupChatTaskActions, titleSimilarity, pickInstanceTarget, pickVisibleCompletionTarget, pickVisibleInstance,
  findDuplicatePackage, resolveVisibleInstance, filterNewSubtasks, matchPoolByPhrase,
  resolveSeriesTemplate, endSeries, reviveSeries, derecurSeries, _resolvePackageChildByLabel,
};
