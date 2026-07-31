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
  const list = Array.isArray(rows) ? rows : [];
  const instances = list.filter((r) => r && r.recurrence_rule == null);
  // GROUPREPORT-MOLDE-CICLO-TWIN: num pacote, molde e ciclo são ambos rule=null. O ciclo (ocorrência
  // VISÍVEL) tem recurrence_parent_id preenchido; o molde (blueprint escondido) tem null. Rotina
  // (cancel/complete/reschedule) deve mirar o CICLO — foi o que descasou a Venc 20 da Rose (moveu o
  // molde escondido). Fallback: tarefa simples/one-off (sem ciclo) usa a própria linha.
  const cyclic = instances.filter((r) => r.recurrence_parent_id != null);
  return cyclic[0] || instances[0] || null;
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
async function _resolveByPhraseFallback({ supabase, groupId, phrase, excludeCancelled = false }) {
  try {
    let q = supabase.from('tasks')
      .select('id, title, recurrence_rule, recurrence_parent_id, due_date, is_group')
      .eq('assigned_group_id', groupId).neq('status', 'done');
    if (excludeCancelled) q = q.neq('status', 'cancelled');
    const { data: pool } = await q.limit(200);
    return pickInstanceTarget(matchPoolByPhrase(pool, phrase));
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
      .select('id, title, due_date, parent_task_id, is_group, recurrence_rule, recurrence_parent_id')
      .eq('assigned_group_id', groupId).neq('status', 'done').neq('status', 'cancelled').limit(300);
    const rows = data || [];
    const containers = new Set(rows.filter((r) => r.is_group === true && _normTitle(r.title) === pkg).map((r) => r.id));
    if (!containers.size) return null;
    const filhas = rows.filter((r) => r.parent_task_id && containers.has(r.parent_task_id)
      && _normTitle(r.title) === child && r.recurrence_rule == null);
    return pickInstanceTarget(filhas);
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
          .select('id, title, recurrence_rule')
          .eq('assigned_group_id', groupId)
          .neq('status', 'done')
          .ilike('title', title)
          .order('due_date', { ascending: true })
          .limit(5);
        let target = pickInstanceTarget(found);
        // Fallback (GROUPCHAT-COMPLETE-COMPOSITE-LABEL-NOMATCH): a pessoa colou o label do
        // relatório ("{Pacote}: {Filha} ({Resp})") → o ilike exato não bate no title cru.
        if (!target) target = await _resolveByPhraseFallback({ supabase, groupId, phrase: title });
        if (!target) { failed.push({ action: a, why: 'not_found_in_pool' }); continue; }
        // Anti-corrida: só marca se ainda não estava done.
        const patch = { status: 'done', completed_at: new Date().toISOString(), completed_by: senderCollabId };
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
          .select('id, title, is_group, recurrence_rule')
          .eq('assigned_group_id', groupId)
          .neq('status', 'done')
          .neq('status', 'cancelled')
          .ilike('title', title)
          .order('created_at', { ascending: false })
          .limit(5);
        // Protege a série recorrente: cancela a INSTÂNCIA visível, NUNCA o molde.
        // Cancelar o template mata a série inteira — materializeAll pula molde
        // cancelado, então nunca mais regenera (caso Conciliação de Cartões/Rose 17/06).
        let target = pickInstanceTarget(hit);
        if (!target) target = await _resolveByPhraseFallback({ supabase, groupId, phrase: title, excludeCancelled: true });
        if (!target) { failed.push({ action: a, why: 'not_found_in_group' }); continue; }
        await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', target.id);
        if (target.is_group) {
          await supabase.from('tasks').update({ status: 'cancelled' }).eq('parent_task_id', target.id).neq('status', 'done');
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
        const { data: found } = await supabase.from('tasks')
          .select('id, title, recurrence_rule').eq('assigned_group_id', groupId)
          .neq('status', 'done').neq('status', 'cancelled').ilike('title', title)
          .order('due_date', { ascending: true }).limit(5);
        let target = pickInstanceTarget(found);
        if (!target) target = await _resolveByPhraseFallback({ supabase, groupId, phrase: title, excludeCancelled: true });
        if (!target) { failed.push({ action: a, why: 'not_found_in_pool' }); continue; }
        const patch = {}; if (nd) patch.due_date = nd; if (nr) patch.remind_at = nr;
        const { data: upd } = await supabase.from('tasks').update(patch).eq('id', target.id).select('id, title').maybeSingle();
        if (upd) updated.push({ ...upd, changed: patch });
        else failed.push({ action: a, why: 'race_lost' });
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
// Molde cancelado → materializeAll (Balde A) já pula molde cancelado, então PARA de gerar.
async function endSeries({ supabase, templateId }) {
  // FATIA 2: series_ended_at é o que de fato PARA a série pós-flip (o guard novo ignora status).
  await supabase.from('tasks').update({ status: 'cancelled', series_ended_at: new Date().toISOString() }).eq('id', templateId);
  await supabase.from('tasks').update({ status: 'cancelled' }).eq('recurrence_parent_id', templateId).neq('status', 'done');
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

module.exports = {
  applyGroupChatTaskActions, titleSimilarity, pickInstanceTarget,
  findDuplicatePackage, resolveVisibleInstance, filterNewSubtasks, matchPoolByPhrase,
  resolveSeriesTemplate, endSeries, reviveSeries, _resolvePackageChildByLabel,
};
