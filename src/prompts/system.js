// src/prompts/system.js — 4-block architecture
// REGRAS (top) → IDENTIDADE → CONTEXTO → SKILL ATIVA (1 only).
// Total target: < 8KB. History limited to 5 msgs, memory to 10.
const fs = require('fs');
const path = require('path');
const supabase = require('../supabase/client');

const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

// ---------- BLOCK 1 — REGRAS INVIOLÁVEIS (hardcoded, top of prompt) ----------
const BLOCK_RULES = `# 🚨 REGRAS INVIOLÁVEIS — PRIORIDADE MÁXIMA

1. Você é TOM 👽 — organizador WhatsApp da LA Music.
2. Trate o usuário pelo apelido. Se full_name="Luciano Alf" → "Alf". Sem apelido → primeiro nome.
3. 👽 SÓ no início da primeira mensagem de uma interação fresca (sem conversa nas últimas ~60min). Nunca repetir, nunca no meio.
4. Direto, informal brasileiro: "pô", "beleza", "show", "bora". Sem corporativês.
5. Máximo 3-4 linhas por mensagem. Uma pergunta por vez.
6. ZERO leaks: nada de IDs, UUIDs, markers <<...>> visíveis ao usuário, "5W2H", "Eisenhower", "quadrante", nomes de tabelas, paths de filesystem, "engine", "API", "banco". Você NÃO tem ferramentas neste contexto — NUNCA emita \`<tool_call>\`, \`<tool_use>\`, \`<function_call>\`, \`<tool_name>\`, \`<parameters>\`, ou qualquer marcação de invocação de tool. Sua resposta é APENAS texto natural + markers oficiais documentados.

**MARKERS VÁLIDOS (lista canônica — Sprint 10.1+):**
\`<<TASK_UPDATE>>\` (com action: create/complete/reschedule/delegate/extension_request/approve/deny) · \`<<EVENT_CREATE>>\` · \`<<EVENT_UPDATE>>\` · \`<<PROJECT_CREATE>>\` · \`<<PROJECT_APPROVE>>\` · \`<<PROJECT_REJECT>>\` · \`<<HABIT_ACTION>>\` · \`<<MEMORY_SAVE>>\` · \`<<DND_UPDATE>>\` · \`<<ONBOARDING_DONE>>\` · \`<<WEEKLY_PLAN>>\` · \`<<MONTHLY_PLAN>>\` · \`<<CHECKPOINT_BATCH>>\` (Sprint 11.4) · \`<<CHECKLIST_ACTION>>\` (Sprint 12) · \`<<ANNOUNCEMENT_ACTION>>\` (Sprint 13) · \`<<SCHOOL_EVENT_ACTION>>\` (Sprint 13) · \`<<ANNOUNCEMENT_APPROVAL>>\` (Sprint 13). Final SEMPRE \`<<END>>\`.

**MARKERS HALLUCINATED (NUNCA emita — não existem):**
\`<<TASK_CREATE>>\` ❌ → use \`<<TASK_UPDATE>>\` action="create" · \`<<TASK_DONE>>\` ❌ → action="complete" · \`<<TASK_DELETE>>\` ❌ → action="cancel" · \`<<TASK_REMIND>>\` ❌ → action="create" + remind_at · \`<<TASK_NEW>>\`/\`<<TASK_ADD>>\`/\`<<TASK_LIST>>\` ❌ · \`<<EVENT_NEW>>\`/\`<<EVENT_DONE>>\`/\`<<EVENT_CANCEL>>\` ❌ → use \`<<EVENT_UPDATE>>\` action correta · \`<<HABIT_LOG>>\`/\`<<HABIT_DONE>>\` ❌ → use \`<<HABIT_ACTION>>\` action="log" · \`<<MEMORY_WRITE>>\`/\`<<MEMORY_UPDATE>>\` ❌ → \`<<MEMORY_SAVE>>\`. Se você "achou" um nome de marker que não está na lista válida acima, ele NÃO existe. NÃO invente.
7. Bullets com \`•\` (nunca \`-\` ou \`*\`). Negrito \`*assim*\`. Itálico \`_assim_\`.
8. Emoji ANTES do texto, nunca no meio. Cada emoji tem significado fixo (ver mapa).
9. NUNCA 🎵.
10. Se contexto disser ONBOARDING ATIVO, ignore qualquer histórico e comece o fluxo de onboarding (5 perguntas, uma por vez). Não invente briefing.
11. SIGA EXATAMENTE os exemplos de resposta canônica que aparecem na seção "SKILL ATIVA" abaixo. Use os emojis indicados nos exemplos — palavra por palavra, emoji por emoji. Se um exemplo mostra "⏰ *Que horas você costuma fechar o dia?*", você DEVE responder com "⏰ *Que horas você costuma fechar o dia?*". NÃO improvise formatação, NÃO troque emojis, NÃO omita emojis. Os exemplos da skill são contratos, não sugestões.
12. **Promessa = ação no mesmo turno.** Se você falar "vou salvar", "vou registrar", "vou guardar", "vou criar", "vou reagendar", "vou marcar como feito" — o marker correspondente DEVE aparecer NA MESMA mensagem. Nunca prometa salvar sem persistir. Promessa sem lastro destrói confiança e o estado real do PWA fica desalinhado do que o user acha que existe. Se você não vai persistir agora, NÃO use linguagem de fato consumado: diga "consigo salvar isso depois?" ou "quer que eu registre?".
13. **Autoacusação contida.** Reconhecer erro = "tem razão, foi engano" + correção. NÃO usar repetidamente "vacilo meu", "vou ser sincero contigo", "fui sincero", "não tô conseguindo", "errei feio". Uma vez por incidente é suficiente. Excesso de pedir desculpa transforma o TOM em assistente inseguro — corrige e segue, sem ajoelhar.
14. **Fato operacional vem do banco, não da memória da conversa.** Quando responder consultas de leitura ("como está minha semana?", "o que tenho hoje?", "minhas pendências", "minha agenda", "qual o status do X?"), use APENAS os campos que aparecem no contexto injetado (tasks, eventos, hábitos com seus campos). Se um campo é null/ausente no contexto, renderize como **ausência real** — NUNCA preencha com horários, dias ou detalhes que você "lembra" da conversa anterior. Memória conversacional pode ajudar a entender intenção; nunca pode preencher como fato um campo operacional ausente no banco.
   - Task com due_date mas sem remind_at → "📅 sexta (sem horário definido)", não "sexta às 10h" inventado.
   - Hábito sem reminder_time no contexto → "(sem horário agendado)", não inventar horário do briefing anterior.
   - Evento sem location_text → "(local não definido)", não inferir do contexto.
   - Se o user perguntou sobre algo que NÃO está no contexto injetado, responda "não tenho registro disso" — não invente.
`;

// ---------- BLOCK 2 — IDENTIDADE & EMOJIS (hardcoded, ~1KB) ----------
const BLOCK_IDENTITY = `# 👽 IDENTIDADE

TOM é um ET — homenagem ao ALF dos anos 80. O dono se chama Alf — vocês formam dupla improvável (ET organizador + humano teimoso). Esse é o tom. Sem trocadilho.

## Personalidade
Direto, empático, sem frescura. Cobra com leveza, reconhece antes de cobrar. Adapta intensidade pela preferência da pessoa (light/normal/hard).

## Mapa de emojis (use só com propósito, máx 2-3 por mensagem)

| Emoji | Quando |
|---|---|
| 👽 | Assinatura, primeira msg de interação nova |
| 📋 | Lista de tarefas / título de checklist |
| 🎯 | Prioridade / meta do dia |
| 🔴 | Tarefa atrasada |
| ✅ | Feito / confirmação |
| 👀 | Cobrança leve "fez?" |
| 🧐 | Cobrança direta "tá lá ainda" |
| ⏳ | Tempo acabando |
| 🏃 | Corre que ainda dá |
| 🤩 🥳 | Parabéns / celebração |
| 👻 | Sumiu, "responde aí" |
| 😬 ☠️ | Atraso pesado / crítico |
| 🏆 🔥 | Meta alcançada / mandando bem |
| ☕ | Bom dia (8h+) |
| 😴 | Bom dia (antes 7h) |
| 🏋️ | Academia |
| 💪 | Hábito pessoal |
| 🗓️ | Data |
| ⏰ | Horário |
| 📍 | Local |
| 📚 | Pedagógico |
| 🗂️ | Projeto |
| 🧠 | Memória/registro |
| ⚠️ | Alerta |
| 💰 | Dinheiro |

## Regras de hierarquia
Diretor > Gerente > Coordenador > Líder-de-projeto > Colaborador. Pessoal é privado.
`;

// ---------- skill cache ----------
const _skillCache = {};
function loadSkill(name) {
  if (!name) return null;
  if (_skillCache[name] === undefined) {
    const p = path.join(SKILLS_DIR, name + '.md');
    try {
      _skillCache[name] = fs.readFileSync(p, 'utf-8');
    } catch (e) {
      console.log(`[Prompt] WARN: skill ${name} not found at ${p}`);
      _skillCache[name] = '';
    }
  }
  // Truncate to 8KB if oversize.
  return _skillCache[name].slice(0, 8192);
}

// ---------- helpers ----------
// Sprint 10.1 hotfix-2 (Plano C): pré-resolução determinística de datas
// relativas. Engine resolve "amanhã 11h" / "hoje 14h" / "às 8h30 amanhã" no
// momento em que recebe a mensagem do user e injeta o ISO já calculado no
// system prompt. Claude apenas COPIA. Combate history poisoning (TOM repetiu
// "Amanhã (30/04)" antes da âncora estar deployada e isso virou fato pra
// turnos seguintes).
function resolveTemporalRef(userMsg, todayISO, tomorrowISO) {
  if (!userMsg || typeof userMsg !== 'string') return null;
  const lc = userMsg.toLowerCase();
  let targetDay = null;
  let dayWord = null;
  // JS regex \b é ASCII-only; ã/é/etc são tratados como non-word, então
  // \bamanh[ãa]\b NÃO casa "amanhã". Usamos lookarounds explícitos com
  // separadores naturais (início, espaço, pontuação).
  const SEP = '(?:^|[\\s.,!?;:¡¿\\(\\)])';
  const SEP_END = '(?:$|[\\s.,!?;:¡¿\\(\\)])';
  if (new RegExp(SEP + 'amanh(?:ã|a)' + SEP_END, 'i').test(lc)) {
    targetDay = tomorrowISO; dayWord = 'amanhã';
  } else if (new RegExp(SEP + 'hoje' + SEP_END, 'i').test(lc)) {
    targetDay = todayISO; dayWord = 'hoje';
  }
  if (!targetDay) return null;
  // Detecta horário em vários formatos: "11h", "11:30h", "às 11h", "11:30",
  // "às 8h30" (8h30 ↔ 8:30).
  const tm = lc.match(/\b(?:[àa]s\s+)?(\d{1,2})(?::(\d{2})|h(\d{2})|h)\b|\b(\d{1,2})(?::(\d{2}))?\b\s*h(?:oras?)?/);
  let hour = null, minute = null;
  if (tm) {
    const h = parseInt(tm[1] || tm[4] || '', 10);
    const m = parseInt(tm[2] || tm[3] || tm[5] || '0', 10);
    if (Number.isFinite(h) && h >= 0 && h <= 23 && Number.isFinite(m) && m >= 0 && m <= 59) {
      hour = String(h).padStart(2, '0');
      minute = String(m).padStart(2, '0');
    }
  }
  const iso = (hour && minute) ? `${targetDay}T${hour}:${minute}:00-03:00` : null;
  return { dayWord, targetDay, hour, minute, iso };
}

// Sprint 10.1 hotfix-2 (Plano B): sanitização de history para evitar
// poisoning. Remove "(DD/MM)" parentético próximo a palavras temporais nos
// turnos passados do TOM. Mantém a frase legível mas tira a "data canonizada"
// que o modelo achava ser fato. Aplicado só em mensagens outbound (do TOM).
function sanitizeAssistantContent(s) {
  if (typeof s !== 'string') return s;
  return s
    // "amanhã (30/04)" → "amanhã"
    .replace(/\b(amanh[ãa]|hoje|ontem|segunda(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|domingo)\s*\(\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*\)/gi, '$1')
    // Date isolada em parênteses logo após texto temporal-like: "(30/04)"
    .replace(/\(\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*\)/g, '');
}

function todaySaoPaulo() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

function fmtTime(t) {
  if (!t) return '—';
  return String(t).slice(0, 5);
}

function nameFor(collab) {
  if (!collab) return 'amigo';
  // Special case: full_name "Luciano Alf" → "Alf" (until we add a nickname column).
  if (collab.full_name === 'Luciano Alf') return 'Alf';
  return (collab.full_name || '').split(' ')[0] || 'amigo';
}

// ---------- BLOCK 3 — CONTEXTO (dynamic, ~1KB) ----------
function buildContext(collab, memories, prefs, tasks, projects, lastMsgAge, habits, events) {
  const nickname = nameFor(collab);
  const lines = ['# 📌 CONTEXTO DESTA INTERAÇÃO', ''];
  const fn = collab.function_title ? ', ' + collab.function_title : '';

  // Sprint 10.1: âncora temporal explícita. Sem isto Claude calculava
  // "amanhã" errado e gravava remind_at +1 dia adiantado em produção.
  // Sempre America/Sao_Paulo (-03:00) — o engine + UI assumem este TZ.
  const tzFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = tzFmt.formatToParts(new Date());
  const lookup = (k) => (parts.find(p => p.type === k) || {}).value;
  const todayISO = `${lookup('year')}-${lookup('month')}-${lookup('day')}`;
  const nowHHMM = `${lookup('hour')}:${lookup('minute')}`;
  // Calcula amanhã ISO em BRT (sem depender da timezone do servidor).
  const tomorrow = new Date(todayISO + 'T03:00:00.000Z'); // 00h BRT
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);
  const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const todayWD = weekdays[new Date(todayISO + 'T15:00:00.000Z').getUTCDay()];
  const tomorrowWD = weekdays[new Date(tomorrowISO + 'T15:00:00.000Z').getUTCDay()];
  lines.push(`**Data/hora agora (BRT):** ${todayISO} ${nowHHMM} (${todayWD})`);
  lines.push(`**Amanhã (BRT):** ${tomorrowISO} (${tomorrowWD})`);

  // Sprint 17 — âncora semanal explícita (spec §2.6)
  {
    const todayDate = new Date(todayISO + 'T15:00:00.000Z'); // meio-dia BRT
    const todayDOW = todayDate.getUTCDay(); // 0=dom, 1=seg, ..., 6=sáb
    const diffToMonday = (todayDOW === 0 ? -6 : 1 - todayDOW);
    const monday = new Date(todayDate);
    monday.setUTCDate(monday.getUTCDate() + diffToMonday);
    const _fmtDate = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const _weekDays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + i);
      return `${_weekDays[d.getUTCDay()]} ${_fmtDate(d)}`;
    });
    lines.push(`**Esta semana (BRT):** ${weekDates.join(' · ')}`);
  }

  lines.push(`**Timezone para markers:** America/Sao_Paulo. Sempre use ISO -03:00 em remind_at, start_at, end_at, etc. Ex: "amanhã 11h" → "${tomorrowISO}T11:00:00-03:00".`);
  lines.push('');

  lines.push(`**Pessoa:** ${nickname} (${collab.full_name}) — ${collab.role || '—'}${fn}`);
  lines.push(`**Onboarding:** ${collab.onboarding_completed ? 'COMPLETO' : '⚠️ ONBOARDING ATIVO — fluxo de 5 perguntas'}`);

  if (lastMsgAge !== null && lastMsgAge !== undefined) {
    if (lastMsgAge < 60) lines.push(`**Interação:** continuação (última msg há ${lastMsgAge} min — NÃO use 👽)`);
    else lines.push(`**Interação:** NOVA (sem mensagens há ${lastMsgAge}+ min — use 👽 no início)`);
  } else {
    lines.push('**Interação:** PRIMEIRA — use 👽 no início');
  }

  if (prefs) {
    lines.push('', '**Preferências:**');
    lines.push(`• Briefing: ${fmtTime(prefs.briefing_time)} | Fechamento: ${fmtTime(prefs.closing_time)} | Cobrança: ${prefs.coaching_intensity || 'normal'}`);
  }

  if (memories && memories.length) {
    lines.push('', '**Memória (top 10):**');
    memories.slice(0, 10).forEach(m => lines.push(`• [${m.memory_type}] ${m.content}`));
  }

  // Render personal × work separately. Falls back to legacy mixed list if split not provided.
  const today = todaySaoPaulo();
  // Sprint 11 Bloco B.3: TOM precisa VER as tasks com horário pra ordenar a
  // resposta cronologicamente. Antes só via título; agora vê "⏰ 08h30 (amanhã)".
  const fmtTimeForCtx = (iso) => {
    if (!iso) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso));
    const hh = parts.find(p => p.type === 'hour')?.value || '00';
    const mm = parts.find(p => p.type === 'minute')?.value || '00';
    return mm === '00' ? `${parseInt(hh, 10)}h` : `${parseInt(hh, 10)}h${mm}`;
  };
  const dayFromAny = (iso) => {
    if (!iso) return '';
    if (!iso.includes('T')) return iso.slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
  };
  const tomorrowOf = (iso) => {
    const d = new Date(iso + 'T03:00:00.000Z'); d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const renderTaskList = (arr) => {
    arr.slice(0, 8).forEach((t, i) => {
      const sid = String(t.id || '').slice(0, 8);
      let timeBit = '';
      if (t.remind_at) {
        const day = dayFromAny(t.remind_at);
        const time = fmtTimeForCtx(t.remind_at);
        const rel = day === today ? 'hoje' : day === tomorrowOf(today) ? 'amanhã' : day;
        timeBit = ` ⏰ ${time} (${rel})`;
      } else if (t.due_date) {
        const rel = t.due_date === today ? 'hoje' : t.due_date === tomorrowOf(today) ? 'amanhã' : t.due_date;
        timeBit = ` 📅 ${rel}`;
      }
      const overdue = (t.remind_at ? dayFromAny(t.remind_at) : t.due_date) < today ? '🔴 ' : '';
      lines.push(`${i + 1}. [id=${sid}] ${overdue}${t.title}${timeBit}`);
    });
  };

  if (tasks && (tasks.personal || tasks.work)) {
    const personal = tasks.personal || [];
    const work = tasks.work || [];
    lines.push('', `**Tarefas pessoais hoje (${personal.length}):**`);
    if (personal.length) renderTaskList(personal); else lines.push('_nenhuma_');
    lines.push('', `**Tarefas trabalho hoje (${work.length}):**`);
    if (work.length) renderTaskList(work); else lines.push('_nenhuma_');
  } else if (tasks && tasks.length) {
    lines.push('', '**Tarefas hoje:**');
    renderTaskList(tasks);
  }

  // Compromissos hoje (events com horário). Ordenados por start_at.
  // Sprint 10 fix: horário em America/Sao_Paulo (-03:00). DB armazena ISO com
  // timezone (e.g. "2026-04-28 12:00:00+00" = 09:00 BRT). slice(11,16) cru
  // mostrava UTC pro Claude → resposta com horário errado.
  if (events && events.length) {
    lines.push('', `**Compromissos hoje (${events.length}):**`);
    const fmtSP = (iso) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      // Intl com timeZone garante conversão correta independente do TZ do servidor.
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
    };
    events.slice(0, 8).forEach(e => {
      const sid = String(e.id || '').slice(0, 8);
      const start = fmtSP(e.start_at);
      const end = fmtSP(e.end_at);
      const mod = e.modality === 'online' ? '💻' : e.modality === 'hibrido' ? '🔀' : '🏢';
      const cat = e.category ? ` · ${e.category}` : '';
      const where = e.location_text ? ` · ${e.location_text}` : '';
      lines.push(`• [id=${sid}] ${start}–${end} ${mod} ${e.title}${cat}${where}`);
    });
  }

  if (projects && projects.length) {
    lines.push('', '**Projetos ativos:**');
    projects.slice(0, 5).forEach(p => lines.push(`• ${p.name} (${p.progress_percent || 0}%)`));
  }

  if (habits && habits.length) {
    lines.push('', `**Hábitos ativos (${habits.length}):**`);
    habits.slice(0, 10).forEach(h => {
      const sid = String(h.id || '').slice(0, 8);
      const streak = h.current_streak ? ` — streak ${h.current_streak}d` : '';
      const time = h.reminder_time ? ` (${String(h.reminder_time).slice(0,5)})` : '';
      lines.push(`• [id=${sid}] ${h.icon || '💪'} ${h.name}${streak}${time}`);
    });
  }

  return lines.join('\n');
}

// Render pending coordinator decisions (extension requests waiting for approve/deny).
function renderPendingDecisions(notifications) {
  if (!notifications || !notifications.length) return '';
  const pending = notifications.filter(n =>
    n.notification_type === 'deadline_extension_request' && n.reference_id
  );
  if (!pending.length) return '';
  const lines = ['', '**📥 Pedidos de prazo aguardando sua decisão:**'];
  pending.slice(0, 5).forEach(n => {
    const sid = String(n.reference_id || '').slice(0, 8);
    lines.push(`• [id=${sid}] ${n.title}`);
    if (n.body) lines.push(`  ${n.body.split('\n')[0].slice(0, 200)}`);
  });
  return lines.join('\n');
}

// ---------- BLOCK 4 — SKILL ATIVA (conditional, max 1) ----------
async function pickSkill(collab, lastUserMessage, recentHistory) {
  // Priority 1: onboarding active.
  if (collab && collab.onboarding_completed === false) {
    return { name: 'onboarding', body: loadSkill('onboarding') };
  }

  // Sprint 11.4 hotfix — Mid-flow project detection ANTES de tratamento-audio.
  // Bug observado (29/04 13:30): user mandou áudio durante cadastro de evento Dia
  // das Mães. tratamento-audio sequestrou o turno → cadastro-projeto-5w2h perdeu
  // estado → re-perguntou data já fornecida. Fix: se estamos no meio de um fluxo
  // 5W2H, manter a skill mesmo se input é áudio transcrito.
  // Regex expandido pra cobrir TODAS as perguntas do fluxo, não só as finais.
  const recentText = (recentHistory || []).map(m => m.content || '').join(' ').toLowerCase();
  const inProjectFlow =
    /qual a janela|metodologia|horas por semana|quem vai participar|como vai chamar|por que esse projeto|onde vai acontecer|como vai executar|qual o p[uú]blico|qual a data do (?:workshop|projeto|evento)|que horas come[çc]a|j[aá] tem local|tem local definido|nome (?:do|desse) projeto/.test(recentText) &&
    !/✅.*criado|cancelar|esquece|deixa pra depois/i.test(recentText.slice(-500));
  if (inProjectFlow) {
    return { name: 'cadastro-projeto-5w2h', body: loadSkill('cadastro-projeto-5w2h') };
  }

  // Sprint 11.5b hotfix-2 — Eventos de GRANDE PORTE da LA (workshop, show, recital,
  // captação, festival, dia das mães, formatura, especial X) são PROJETOS, não
  // simples compromissos de calendário. Bug observado (29/04 13:48): user pediu
  // pra criar evento "Especial Dia das Mães com a Turminha LA Music Kids" e TOM
  // tratou como compromisso simples → não perguntou envolvidos/responsáveis/método
  // (que estão na skill cadastro-projeto-5w2h, perguntas 5/6/7).
  //
  // Distinção:
  //   - criar-compromisso: reunião 14h, aula, mentoria, sessão, encontro, consulta
  //                        (datas pontuais, sem time/coordenação)
  //   - cadastro-projeto-5w2h: workshop, show, recital, captação, festival, dia
  //                            das mães, formatura, evento especial, lançamento
  //                            (escopo amplo, envolve múltiplas pessoas, prep)
  const lmFull = (lastUserMessage || '').toLowerCase();
  const largeEventTermRe = /\b(workshop|show|recital|capta[çc][ãa]o|festival|dia\s+das\s+m[aã]es|dia\s+dos\s+pais|formatura|lan[çc]amento|sarau|especial(?:\s+(?:dia|de|do))?|aula\s+aberta|masterclass|apresenta[çc][ãa]o\s+(?:do\s+)?coro|festa\s+(?:de\s+)?fim\s+de\s+ano|temporada)\b/i;
  const inLargeEventFlow =
    /\b(workshop|show|recital|capta[çc][ãa]o|festival|dia\s+das\s+m[aã]es|formatura|sarau|especial)\b/i.test(recentText) &&
    /me\s+fala\s+o\s+nome|qual\s+a\s+data|qual\s+o\s+local|tem\s+alguma\s+descri[çc][ãa]o|quem\s+vai\s+participar|como\s+vai\s+executar/i.test(recentText) &&
    !/✅.*criado|cancelar|esquece/i.test(recentText.slice(-500));
  // Sprint 22.22 — context-aware: detecta se conversa atual eh sobre consulta
  // de projeto existente. Olha a ultima mensagem do TOM tambem (follow-ups).
  const lastBotMsg = (recentHistory || [])
    .slice(-4)
    .filter(m => m && m.direction === 'outbound')
    .map(m => (m.content || '').toLowerCase())
    .join(' ');
  const recentMentionsProjectStatus = /festival|workshop|sarau|recital|projeto.*\b(0%|\d+%)|checkpoint|membros do projeto|owner|coordinator|atribu/i.test(lastBotMsg);

  if (largeEventTermRe.test(lmFull) || inLargeEventFlow) {
    // Antes de assumir cadastro, checar se ja existe projeto com nome similar.
    const m = lmFull.match(largeEventTermRe);
    if (m && m[0] && !/\b(criar|novo|cadastrar|montar|fazer|quero\s+(?:criar|fazer))\b/i.test(lmFull)) {
      try {
        const { data: existing } = await supabase.from('projects')
          .select('id')
          .ilike('name', `%${m[0]}%`)
          .in('status', ['active','planning','pending_approval','paused'])
          .limit(1);
        if (existing && existing.length > 0) {
          return { name: 'consultar-projeto', body: loadSkill('consultar-projeto') };
        }
      } catch { /* fallback pro cadastro abaixo */ }
    }
    return { name: 'cadastro-projeto-5w2h', body: loadSkill('cadastro-projeto-5w2h') };
  }

  // Follow-up: TOM acabou de falar sobre projeto, user respondeu curto
  // ("quero", "sim", "manda", "mostra"). Mantem contexto consultar-projeto.
  if (recentMentionsProjectStatus && lastUserMessage && lastUserMessage.length < 60 &&
      !/\b(criar|novo|cadastrar)\b/i.test(lastUserMessage)) {
    return { name: 'consultar-projeto', body: loadSkill('consultar-projeto') };
  }

  // Priority 1.4: audio transcription — wraps the actual intent in a
  // confirmation flow before any action marker is emitted.
  // ATENÇÃO: vem DEPOIS de inProjectFlow pra não sequestrar turno em mid-flow.
  if (/^\[áudio transcrito\]/i.test(lastUserMessage || '')) {
    return { name: 'tratamento-audio', body: loadSkill('tratamento-audio') };
  }

  // Priority 1.5: do_not_disturb intent — preempts everything else.
  // Catches: "agora não", "não me incomoda", "tô em aula/reunião/dirigindo",
  // "me chama em N h/min", "depois", "mais tarde", "pode falar" (clear).
  if (/\b(agora\s+n[aã]o|n[aã]o\s+(?:posso|d[aá])\s+(?:falar|atender)|n[aã]o\s+me\s+(?:incomoda|atrapalha|chama)|t[oô]\s+(?:em\s+)?(?:aula|reuni[aã]o|dirigindo|ocupad[oa]\s+agora|no\s+m[eé]dico)|me\s+(?:chama|lembra|liga)\s+(?:em|daqui)\s+\d+\s*(?:h|horas?|min|minutos?)|(?:s[oó]\s+)?(?:depois|mais\s+tarde)\s*$|pode\s+falar\s+agora|voltei|liberad[oa]\s+agora)/i.test(lastUserMessage || '')) {
    return { name: 'pausa-temporaria', body: loadSkill('pausa-temporaria') };
  }

  // Priority 1.6 (Sprint 8): aprovação/rejeição de projeto pendente.
  // Trigger forte: APROVA <NOME> ou REJEITA <NOME> motivo (case-insensitive).
  // Trigger fraco: "aprovo"/"rejeito" solto — skill orienta a pedir identificador.
  // Gate por role acontece dentro da skill também (defense in depth).
  if (collab && (collab.role === 'coordinator' || collab.role === 'director')) {
    const lm = (lastUserMessage || '').trim();
    if (/^(APROVA|REJEITA)\b/i.test(lm) || /^(aprov[oa]|rejeit[oa])\s*$/i.test(lm)) {
      return { name: 'aprovar-projeto', body: loadSkill('aprovar-projeto') };
    }
  }

  // Priority 3: explicit project creation intent — exige a palavra "projeto".
  // (Vai antes de consultar-projeto pra "criar projeto novo" nao virar consulta.)
  if (/\b(criar|novo|cadastrar)\s+(?:um\s+|o\s+|outro\s+)?projeto/i.test(lastUserMessage || '')) {
    return { name: 'cadastro-projeto-5w2h', body: loadSkill('cadastro-projeto-5w2h') };
  }

  // Sprint 22.22 — Priority 2.5: consulta de projeto.
  // Filosofia: regex so detecta MENCAO de projeto. NAO tenta classificar intent
  // ("como ta?" / "quem sao?" / "qual o prazo?"). O LLM interpreta com os dados
  // injetados no contexto. Mantem isto largo + simples.
  if (lastUserMessage && /\bprojeto\b|\bfestival\b|\bsemana\s+de\b|\bworkshop\b|\bsarau\b|\brecital\b|\bshow\b|\bcapta[çc][ãa]o\b/i.test(lastUserMessage)) {
    return { name: 'consultar-projeto', body: loadSkill('consultar-projeto') };
  }

  // Priority 4: ritual context — engine sets _ritualType for cron-fired briefings/closings.
  const rt = collab && collab._ritualType;
  if (rt === 'planejamento_semanal' || rt === 'weekly_planning') {
    return { name: 'planejamento-semanal', body: loadSkill('planejamento-semanal') };
  }
  if (rt === 'briefing_trabalho' || rt === 'briefing_pessoal' || rt === 'fechamento' ||
      rt === 'briefing_diario' ||
      rt === 'daily_briefing' || rt === 'daily_closing') {
    return { name: 'rituais-diarios', body: loadSkill('rituais-diarios') };
  }

  // Priority 4.5: manual trigger for weekly planning.
  if (/\b(planej(?:ar|amento)\s+(?:da\s+|a\s+)?semana|planejar\s+a\s+semana|planejamento\s+semanal)\b/i.test(lastUserMessage || '')) {
    return { name: 'planejamento-semanal', body: loadSkill('planejamento-semanal') };
  }
  // Mid-flow detection: TOM asked for goals/distribuição recently.
  const recentTextWp = (recentHistory || []).map(m => m.content || '').join(' ').toLowerCase();
  if (/quais suas 5 entregas|plano da semana|tá bom assim ou quer trocar|hora de planejar a semana/i.test(recentTextWp) &&
      !/✅\s*plano salvo|cancela|deixa pra/i.test(recentTextWp.slice(-500))) {
    return { name: 'planejamento-semanal', body: loadSkill('planejamento-semanal') };
  }

  // Priority 4.7: habits — triggers explícitos + criar/novo + palavra de hábito.
  const HABIT_KW = '(?:academia|exerc[ií]cio|treino|musculação|musculacao|cardio|caminhada|caminhar|leitura|ler|medita[çc][ãa]o|meditar|orar|ora[çc][ãa]o|afirma[çc][õo]es|[áa]gua|conta(?:s\\s+a\\s+pagar)?|vitamin[ao]s?|rem[eé]dios?|instrumento|viol[ãa]o|piano|guitarra|bateria|journaling|di[áa]rio|caminhar\\s+\\d+\\s*min|h[áa]bito)';
  const habitCreateRe = new RegExp('\\b(?:criar|novo|come[çc]ar|quero|comece[ai])\\s+(?:um\\s+|uma\\s+|o\\s+|a\\s+)?' + HABIT_KW + '\\b', 'i');
  if (habitCreateRe.test(lastUserMessage || '') ||
      /\b(que\s+h[áa]bitos|h[áa]bitos\s+posso|listar\s+h[áa]bitos|templates?\s+de\s+h[áa]bito)/i.test(lastUserMessage || '')) {
    return { name: 'habitos-pessoais', body: loadSkill('habitos-pessoais') };
  }
  // Common habit-log triggers — only if briefing_pessoal ritual context OR clear "fiz <hábito>" intent.
  if (/\b(fiz\s+(?:academia|exerc[ií]cio|treino|cardio|musculação|musculacao|caminhada|yoga|aula)|li\s+(?:hoje|antes|os\s+30)|meditei|orei|tomei\s+(?:vitaminas?|rem[eé]dios?|todos?\s+os)|bebi\s+\d|pratiquei\s+(?:violão|violao|piano|guitarra|bateria))/i.test(lastUserMessage || '')) {
    return { name: 'habitos-pessoais', body: loadSkill('habitos-pessoais') };
  }

  // Priority 4.85 (Sprint 7): follow-up de horário.
  // Padrão alvo: TOM acabou de perguntar "que hora" sobre uma pendência sem
  // horário, e o usuário respondeu SOMENTE com hora ("9h", "às 14:30", "14:00").
  // Sem essa regra, pickSkill volta `none` e o Claude improvisa (vide bug
  // capturado em 28/04/2026 — image "9h" → leak de stack).
  // Resolução vai pra criar-compromisso, que tem seção dedicada "Follow-up de
  // horário" instruindo TASK_UPDATE complete + EVENT_CREATE no mesmo turno.
  {
    const lm = (lastUserMessage || '').trim();
    // User digita só hora: "9h", "9:30", "9:30h", "às 9", "às 09:00", "14:00"
    const isolatedTimeRe = /^(?:[àa]s\s+)?\d{1,2}(?::\d{2})?\s*h?(?:oras?)?\.?$/i;
    if (isolatedTimeRe.test(lm)) {
      // Última outbound (TOM) — perguntou hora?
      const recent = (recentHistory || []).filter(m => m.direction === 'outbound');
      const lastBot = recent.length ? String(recent[recent.length - 1].content || '') : '';
      const askedTimeRe = /\b(que\s+horas?|sabe\s+que\s+horas?|qual\s+(?:o\s+)?hor[áa]rio|que\s+hr|qual\s+hr|hor[áa]rio\s+(?:da|do)\s+\w)\b/i;
      if (askedTimeRe.test(lastBot)) {
        return { name: 'criar-compromisso', body: loadSkill('criar-compromisso') };
      }
    }
  }

  // Priority 4.9: compromisso (evento com horário). Cobre create + update.
  // Create: termo de evento + horário, OR range "das X às Y", OR agendar + horário + (termo|modalidade).
  // Update: verbo update (remarca|cancela|fechei) + termo de evento.
  //
  // Sprint 10.1 — guard de reminder intent:
  // Se a mensagem tem "anota|me lembra|lembra de|lembrete|me chama" mesmo
  // mencionando "reunião 9h", o intent real é LEMBRETE (task com remind_at),
  // não criar evento. Ex: "anota: amanhã 9h te lembra de falar pra marcar
  // reunião" — usuário não quer marcar reunião, quer ser lembrado de falar
  // com alguém pra marcar. Cai pra priority 5 (checklist-tarefas).
  {
    const eventTermRe = /\b(reuni[ãa]o|aula|ensaio|mentoria|sess[ãa]o|encontro|grava[çc][ãa]o|masterclass|apresenta[çc][ãa]o|consulta|compromisso)\b/i;
    const hourRe = /\b\d{1,2}(?::\d{2})?\s*h(?:oras?)?\b|\b[àa]s\s+\d{1,2}\b/i;
    const rangeRe = /\bdas?\s+\d{1,2}h?(?::\d{2})?\s+(?:[àa]s|at[eé])\s+\d{1,2}h?(?::\d{2})?\b/i;
    const modalityRe = /\b(online|presencial|h[ií]brido|google\s*meet|zoom|teams|jitsi)\b/i;
    const scheduleVerbRe = /\b(marca|marcar|agend[ao]r?)\b/i;
    // Sprint 10.1 hotfix-3: cobrir conjugações de "lembrar" — "me lembra"
    // (presente), "me lembre" (imperativo educado/subjuntivo), "me lembrar".
    // Regex antiga só pegava "lembra" e perdia "lembre"/"lembrar" → caiu pra
    // skill: none, Claude improvisou marker em YAML, parser rejeitou.
    const reminderIntentRe = /\b(anota|me\s+lembr[aeo]|lembr(?:a|e|ar)\s+(?:de|do|da)|lembrete|me\s+chama|p[oó]e\s+na\s+lista|adiciona\s+(?:na\s+lista|tarefa))\b/i;
    const eventUpdateRe = /\b(remarca|remarcar|reagenda|reagendar|cancel[ao]r?|fechei\s+(?:a\s+|o\s+)?(?:reuni[ãa]o|aula|ensaio|mentoria|sess[ãa]o|grava[çc][ãa]o|masterclass|consulta)|saiu\s+(?:a\s+|o\s+)?(?:reuni[ãa]o|mentoria))\b/i;
    const lm = lastUserMessage || '';
    const hasReminderIntent = reminderIntentRe.test(lm);
    if (!hasReminderIntent && (
        rangeRe.test(lm) ||
        (eventTermRe.test(lm) && hourRe.test(lm)) ||
        (scheduleVerbRe.test(lm) && hourRe.test(lm) && (eventTermRe.test(lm) || modalityRe.test(lm))) ||
        (eventUpdateRe.test(lm) && eventTermRe.test(lm))
       )) {
      return { name: 'criar-compromisso', body: loadSkill('criar-compromisso') };
    }
  }

  // Sprint 20 — Priority 4.65: contexto GERENCIAL EXPLÍCITO (vence pedagogico em 4.7).
  // Gatilhos restritos: nomes dos gerentes + termos gerenciais explícitos (risco evasão,
  // retenção, atendimento, recepção, secretaria, articulação interna).
  // Frases com "aluno"/"responsável" SEM qualificador gerencial caem em pedagogico abaixo.
  if (/(\brisco\s+de\s+evas|\bevas[ãa]o\b|\bretenç[ãa]o\b|\brecuperaç[ãa]o\s+(?:de\s+)?aluno|\bexperi[êe]ncia\s+da\s+unidade|\bproblema\s+de\s+atendimento|\barticul(?:ar|ação)\s+(?:recepç|secretari|coord)|\bgerente\b|\bger[êe]ncia\b|\bjereh\b|\bclayton\b|\bkrissya\b|\bnegoci(?:ar|ação)\s+(?:permanência|sa[ií]da|condiç)|\bpai\s+(?:insatisfeito|querendo\s+sair|reclamando\s+do\s+atendimento)|\baciona\s+(?:a\s+)?ger[êe]ncia|\brecepç[ãa]o\b|\bsecretari[ao]\b|\bpr[ée][\s-]?atendimento)/i.test(lastUserMessage || '')) {
    return { name: 'gerencia', body: loadSkill('gerencia') };
  }

  // Sprint 19 — Priority 4.7: contexto PEDAGÓGICO (vence checklist-tarefas e operacoes-tecnicas).
  // Gatilhos: aluno/professor/turma/recital/banda/kids/school + nomes da equipe pedagógica.
  // Quando dispara, TOM usa skill pedagogico.md como PRIMARY → emite TASK_UPDATE com department_id pedagogico.
  if (/(\b(aluno[as]?|professor[a]?(?:es)?|turma[s]?|recital(?:is)?|banda[s]?|coordena[çc][ãa]o\s+pedag|assistent[ea]\s+pedag|mentor[ea]?\s+pedag|kids|school|infantil|musicaliza[çc][ãa]o|aula(?:s)?\s+(?:do|da|de))\b|\b(juliana|quintela|peterson|kinho|renan|matheus\s+felipe|jordan|leo|ramon|dai|rodrigo)\b)/i.test(lastUserMessage || '')) {
    return { name: 'pedagogico', body: loadSkill('pedagogico') };
  }
  // Sprint 19 — Priority 4.8: contexto OPERAÇÕES TÉCNICAS (infra/equipamento/material).
  // Vence apenas se NÃO for pedagógico. Garante department_id=operacoes-tecnicas no marker.
  if (/\b(sala\s+\d|ar.condicion|l[âa]mpada|equipamento[s]?|inst[ru]mento[s]?|infra(?:estrutura)?|manuten[çc][ãa]o|reposi[çc][ãa]o|estoque|teclado|amplificador|microfone|cabo[s]?|caixa\s+de\s+som|t[ée]cnico|incidente|baqueta[s]?|palheta[s]?|corda[s]?\s+(?:de|do|para|pra)|tinta|caneta|impressora|computador|wifi|internet)\b/i.test(lastUserMessage || '')) {
    return { name: 'operacoes-tecnicas', body: loadSkill('operacoes-tecnicas') };
  }

  // Priority 5: task management intent. Includes create/remind/reschedule/complete/delegate/extension signals,
  // PLUS new-demand signals (surgiu, preciso falar, tem que resolver, fala com, etc).
  if (/\b(fiz|terminei|feito|completei|fechei|reagenda|adia|adiar|delega|surgiu|anota|me\s+lembr[aeo]|lembr(?:a|e|ar|nça)|lembr(?:a|e)\s+(?:de|do|da)\s+\w|lembrete|me\s+chama|daqui\s+a?\s*\d|em\s+\d+\s*(min|hora|h)|p[oó]e\s+na\s+lista|adiciona|marca\s+(?:reuni|m[eé]dico|consulta|hor[áa]rio)|muda\s+(?:a|o|pra)|deixa\s+pra|n[aã]o\s+vou\s+conseguir|preciso\s+de\s+mais\s+prazo|n[aã]o\s+(?:dá|vai\s+dar)\s+at[eé]|estender\s+(?:o\s+)?prazo|aprov[ao]r|negar|nego\s+a)/i.test(lastUserMessage || '')) {
    return { name: 'checklist-tarefas', body: loadSkill('checklist-tarefas') };
  }
  // Priority 5.1: new-demand emergence patterns (must trigger checklist-tarefas, not gestao-memoria).
  // "preciso falar/resolver/ver/ligar/conversar/verificar" — actionable demands.
  // "tem que falar/resolver/ver" — same intent, different phrasing.
  // "fala com X (sobre Y)" — assignment to someone.
  // "apareceu / abriu um caso / tem um caso" — emergent issue.
  if (/\b(preciso\s+(?:falar|resolver|ver|verificar|ligar|conversar|entrar\s+em\s+contato|cobrar|cuidar)|tem\s+que\s+(?:falar|resolver|ver|cuidar)|fala\s+com\s+\w|apareceu\s+(?:uma\s+|um\s+)?(?:demanda|caso|problema|pendência)|abriu\s+um\s+caso|cria(?:r)?\s+(?:uma\s+)?(?:tarefa|task|demanda)\s+(?:pra|para|pro)\s+\w|passa\s+(?:pra|para|pro)\s+\w|abre\s+(?:uma\s+)?(?:tarefa|task)\s+(?:pra|para|pro))/i.test(lastUserMessage || '')) {
    return { name: 'checklist-tarefas', body: loadSkill('checklist-tarefas') };
  }

  // Sprint 11 Bloco A.1 — fallback acionável.
  // Caso real (28/04 22:59): "Amanhã às 10h me lembre de ligar para Ana..."
  // não bateu em nenhum priority anterior. Resultado: skill: none, sem
  // template de marker, Claude improvisou em YAML, parser dropou, "Anotado"
  // virou mentira (DB vazio). Para evitar essa classe de regressão:
  // se a mensagem tem (referência temporal OU verbo de ação clara) JUNTO
  // com um termo de pedido/intenção, defaultamos a checklist-tarefas em vez
  // de none. Conservador: só dispara se MÚLTIPLOS sinais coincidirem,
  // pra não bater em chitchat.
  {
    const lm = (lastUserMessage || '').toLowerCase();
    const hasTimeRef = /\b(amanh[ãa]|hoje|agora|sexta|segunda|terça|quarta|quinta|s[áa]bado|domingo|daqui\s+a|em\s+\d+\s*(?:min|h|hora)|às\s+\d|\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2})\b/i.test(lm);
    const hasIntent = /\b(lembr|anota|agenda|marca|p[oó]e|adiciona|cria|preciso|tenho\s+que|vou\s+ter\s+que|n[aã]o\s+(?:posso|vou)\s+esquecer|sem\s+esquecer)/i.test(lm);
    if (hasTimeRef && hasIntent) {
      return { name: 'checklist-tarefas', body: loadSkill('checklist-tarefas') };
    }
  }

  return null;
}

// ---------- DB fetch ----------
async function fetchCollaboratorContext(collaborator) {
  const id = collaborator.id;
  const today = todaySaoPaulo();
  const TASK_COLS = 'id, title, status, priority, eisenhower_quadrant, due_date, context, remind_at, project_id, projects(name)';

  const [
    profileRes,
    memoriesRes,
    prefsRes,
    personalRes,
    workRes,
    projectsRes,
    notificationsRes,
    historyRes,
    habitsRes,
    eventsRes,
  ] = await Promise.all([
    supabase.from('collaborator_profiles').select('*').eq('collaborator_id', id).maybeSingle(),
    supabase.from('collaborator_memory')
      .select('memory_type, content, importance, created_at')
      .eq('collaborator_id', id).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('user_preferences').select('*').eq('collaborator_id', id).maybeSingle(),
    supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id).lte('due_date', today).eq('context', 'personal').neq('status', 'done')
      .order('remind_at', { ascending: true, nullsFirst: false })
      .order('due_date', { ascending: true })
      .order('eisenhower_quadrant', { ascending: true, nullsFirst: false }),
    supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id).lte('due_date', today).eq('context', 'work').neq('status', 'done')
      .order('remind_at', { ascending: true, nullsFirst: false })
      .order('due_date', { ascending: true })
      .order('eisenhower_quadrant', { ascending: true, nullsFirst: false }),
    supabase.from('project_members').select('project_id').eq('collaborator_id', id),
    supabase.from('notifications')
      .select('notification_type, title, body, reference_id, reference_type, created_at, status')
      .eq('collaborator_id', id)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: false }).limit(8),
    supabase.from('conversation_history')
      .select('direction, content, created_at')
      .eq('collaborator_id', id)
      .order('created_at', { ascending: false }).limit(5),
    supabase.from('habits')
      .select('id, name, icon, current_streak, frequency, reminder_time')
      .eq('collaborator_id', id).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(20),
    // Compromissos de HOJE em America/Sao_Paulo (-03:00). Inclui scheduled e done.
    supabase.from('events')
      .select('id, title, start_at, end_at, modality, category, context, location_text, meeting_url, status')
      .eq('collaborator_id', id)
      .gte('start_at', `${today}T00:00:00-03:00`)
      .lte('start_at', `${today}T23:59:59-03:00`)
      .neq('status', 'cancelled')
      .order('start_at', { ascending: true }).limit(20),
  ]);

  let activeProjects = [];
  const memberRows = projectsRes.data || [];
  if (memberRows.length) {
    const ids = memberRows.map(m => m.project_id);
    const { data } = await supabase.from('projects')
      .select('name, status, progress_percent, end_date')
      .in('id', ids).in('status', ['planning', 'active']);
    activeProjects = data || [];
  }

  const personalTasks = personalRes.data || [];
  const workTasks = workRes.data || [];

  return {
    profile: profileRes.data || null,
    memories: memoriesRes.data || [],
    prefs: prefsRes.data || null,
    todayTasks: { personal: personalTasks, work: workTasks },
    personalTasks,
    workTasks,
    activeProjects,
    notifications: notificationsRes.data || [],
    recentMessages: (historyRes.data || []).reverse(),
    habits: habitsRes.data || [],
    todayEvents: eventsRes.data || [],
    todayDate: today,
  };
}

// Sprint 11.3 hotfix — Active Thread Binding (anti context-bleed).
// Bug observado: TOM confundiu task do Moreira (criada há 1min) com task do Renan
// (criada há 30min) quando user disse "me lembra por favor". TOM puxou pelo
// horário/saliência em vez do assunto corrente. Fix: injetar HINT explícito de
// qual task é o "objeto ativo" da conversa, derivado de:
//   1. Última task criada/atualizada pelo TOM nas últimas N msgs (mais forte)
//   2. Nomes próprios no histórico recente que casem com title de task
// O LLM passa a ter âncora textual pra resolver pronomes ("a ligação", "ele",
// "me lembra") sem chutar.
async function inferActiveThread(recentMessages, allTasks, collaboratorId) {
  if (!Array.isArray(recentMessages) || !recentMessages.length) return null;

  // Sprint 11.3 hotfix-2 — Pool expandido. allTasks vem do contexto de hoje, mas
  // o "assunto corrente" pode ser uma task criada AGORA com due_date amanhã (caso
  // real Moreira: user pediu "me lembra" sobre task de amanhã, hint não disparou).
  // Solução: union de allTasks + tasks criadas/atualizadas nas últimas 24h, mesmo
  // se due_date futuro. 1 query extra por turno — custo aceitável pra resolver bug.
  let pool = Array.isArray(allTasks) ? [...allTasks] : [];
  if (collaboratorId) {
    try {
      const cutoff24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('tasks')
        .select('id, title, status, due_date, remind_at, context, created_at, updated_at')
        .eq('assigned_to', collaboratorId)
        .or(`created_at.gte.${cutoff24h},updated_at.gte.${cutoff24h}`)
        .not('status', 'in', '(done,cancelled)')
        .order('created_at', { ascending: false })
        .limit(20);
      // Dedupe por id
      const seen = new Set(pool.map(t => t.id));
      for (const t of (recent || [])) {
        if (!seen.has(t.id)) { pool.push(t); seen.add(t.id); }
      }
    } catch (err) {
      console.warn('[ActiveThread] recent tasks query err (non-fatal):', err.message);
    }
  }
  if (!pool.length) return null;

  // Janela curta: últimas 6 mensagens (3 turnos user/assistant).
  const recent = recentMessages.slice(-6);
  const recentText = recent.map(m => String(m.content || '')).join(' ').toLowerCase();
  const recentInbound = recent
    .filter(m => m.direction === 'inbound')
    .map(m => String(m.content || ''));

  // Heurística 1: nomes próprios mencionados no histórico (palavras CapitalizadasNoMeio).
  // Pega palavras com letra maiúscula (PT-BR aceita Á-Ú e ã/ç). Filtra stop-words.
  const STOP = new Set(['Alf','Tom','Vou','Ola','Show','Beleza','Bora','Sim','Não','Quero','Manda']);
  const names = new Set();
  for (const text of recent.map(m => String(m.content || ''))) {
    const matches = text.match(/\b([A-ZÁ-Ú][a-zá-úãõç]{2,})(?:\s+([A-ZÁ-Ú][a-zá-úãõç]{2,}))?/g) || [];
    for (const m of matches) {
      const trimmed = m.trim();
      if (trimmed.length >= 3 && !STOP.has(trimmed)) names.add(trimmed);
    }
  }

  // Score cada task: nome próprio match (peso 3) + recência da criação (peso 2).
  const now = Date.now();
  const scored = pool.map(t => {
    let score = 0;
    const titleLower = String(t.title || '').toLowerCase();
    // 1. Nome próprio match
    for (const n of names) {
      if (titleLower.includes(n.toLowerCase())) {
        score += 3;
        break;
      }
    }
    // 2. Título mencionado em substring no histórico
    const titleWords = titleLower.split(/[\s—\-,()]+/).filter(w => w.length >= 4);
    let wordHits = 0;
    for (const w of titleWords) if (recentText.includes(w)) wordHits++;
    if (wordHits >= 2) score += 2;
    else if (wordHits === 1) score += 1;
    // 3. Bonus se task foi mencionada em mensagem inbound recente (mais forte)
    for (const text of recentInbound) {
      const tLower = text.toLowerCase();
      for (const n of names) {
        if (tLower.includes(n.toLowerCase()) && titleLower.includes(n.toLowerCase())) {
          score += 2; break;
        }
      }
    }
    // 4. Recência: tasks criadas há < 5min ganham boost
    const createdMs = t.created_at ? new Date(t.created_at).getTime() : 0;
    const ageMin = createdMs ? Math.floor((now - createdMs) / 60000) : Infinity;
    if (ageMin <= 5) score += 2;
    else if (ageMin <= 30) score += 1;
    return { task: t, score, ageMin };
  }).filter(x => x.score >= 2);

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  // Sprint 11.4 hotfix — threshold mais alto. Bug observado: TOM cruzou "Workshop
  // de Improvisação" (existente) com "Dia das Mães" (novo) só porque palavra
  // "workshop" aparecia em alguma mensagem anterior. Score < 4 = match fraco
  // (não dispara hint). Só >= 4 = sinal forte. Reduz falso-positivo de cross-bleed.
  if (top.score < 4) return null;
  // Empate alto entre 2+ tasks → ambíguo; melhor não dar hint do que dar errado.
  if (scored.length >= 2 && scored[1].score === top.score) {
    return { ambiguous: true, candidates: scored.slice(0, 3).map(s => s.task) };
  }
  return { ambiguous: false, task: top.task, score: top.score, ageMin: top.ageMin };
}

/**
 * Retorna hint de checklist operacional ativo para injetar no system prompt.
 * Apenas se houver op_checklist_completions pendente hoje dentro da janela de 6h.
 */
async function getActiveChecklistHint(collaboratorId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('op_checklist_completions')
    .select(`
      id, dispatched_at,
      op_checklists (
        name, completion_threshold,
        op_checklist_items ( id, description, sort_order, is_active )
      )
    `)
    .eq('collaborator_id', collaboratorId)
    .eq('reference_date', today)
    .is('completed_at', null)
    .order('dispatched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return '';

  const template = data.op_checklists;
  if (!template) return '';

  // Verifica janela de 6h
  const now = new Date();
  const dispatchedAt = data.dispatched_at ? new Date(data.dispatched_at) : null;
  if (dispatchedAt) {
    const windowEnd = new Date(dispatchedAt.getTime() + 6 * 60 * 60 * 1000);
    if (now > windowEnd) return ''; // janela encerrada
  }

  const items = (template.op_checklist_items || [])
    .filter(i => i.is_active !== false)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item, i) => `${i + 1}. [item_id:${item.id}] ${item.description}`)
    .join('\n');

  return (
    `\n\n---\n` +
    `🗒️ **CHECKLIST OPERACIONAL ATIVO**\n` +
    `Template: ${template.name} (threshold: ${template.completion_threshold}%)\n` +
    `completion_id: ${data.id}\n` +
    `Itens:\n${items}\n\n` +
    `Se o colaborador está respondendo a este checklist, emita:\n` +
    `<<CHECKLIST_ACTION>>\n{"completion_id":"${data.id}","items":[{"item_id":"<uuid>","done":true}],"channel":"whatsapp"}\n<<END>>`
  );
}

function renderActiveThreadHint(thread) {
  if (!thread) return '';
  if (thread.ambiguous) {
    const list = thread.candidates.map(t => `  - "${String(t.title).slice(0, 70)}"`).join('\n');
    return [
      '',
      '**🧵 ASSUNTO CORRENTE — AMBÍGUO**',
      'Há 2+ tasks parecidas no contexto recente. Se o user usar pronome ("a ligação", "ele", "isso", "me lembra"), NÃO chute — PERGUNTE qual:',
      list,
      'Pergunta sugerida: "Você diz a do {nome1} ou a do {nome2}?"',
    ].join('\n');
  }
  const t = thread.task;
  const ageLabel = thread.ageMin <= 1 ? 'agora há pouco'
    : thread.ageMin <= 5 ? `${thread.ageMin}min atrás`
    : thread.ageMin <= 30 ? 'recente'
    : 'no histórico';
  return [
    '',
    '**🧵 ASSUNTO CORRENTE da conversa (Active Thread):**',
    `- Task ativa: "${String(t.title).slice(0, 90)}" (${ageLabel})`,
    t.remind_at ? `- Lembrete: ${t.remind_at}` : '',
    t.due_date ? `- Prazo: ${t.due_date}` : '',
    '',
    '**REGRA**: Se o user usar pronome ou referência genérica ("a ligação", "ele", "isso", "me lembra", "agenda"), ASSOCIE essa intenção à task ativa acima — NÃO ao mais saliente do contexto geral. Se houver dúvida real, PERGUNTE qual task antes de agir. NUNCA puxe outra task só porque tem horário próximo ou aparece em destaque.',
  ].filter(Boolean).join('\n');
}

// ---------- main builder ----------
// Sprint 22.22 — Carrega contexto detalhado dos projetos relevantes pra
// pergunta. TOM nao tem SQL tool, entao injetamos dados crus no system prompt.
// Filtra por permissao manualmente (RLS so vale com JWT, aqui usamos service_role).
async function buildProjectStatusContext(collaborator, lastUserMessage) {
  try {
    const collabId = collaborator.id;
    const isGlobalLead = collaborator.role === 'coordinator' || collaborator.role === 'director';

    // 1. Pega projetos relevantes: por nome (ILIKE) + projetos onde o collab eh membro.
    const term = (lastUserMessage || '').slice(0, 200);
    const significantWords = (term.match(/[a-zA-ZáéíóúãõâêîôûçÁÉÍÓÚÃÕÂÊÎÔÛÇ]{4,}/g) || [])
      .map(w => w.toLowerCase())
      .filter(w => !['como','esta','está','tava','status','minha','parte','sobre','nosso','quais','envolvido','envolvida','projeto','projetos','tarefa','tarefas','agora'].includes(w))
      .slice(0, 4);

    // Busca por nome se tiver palavras significativas
    let nameMatched = [];
    if (significantWords.length > 0) {
      const orFilter = significantWords.map(w => `name.ilike.%${w}%`).join(',');
      const { data } = await supabase.from('projects')
        .select('id, name, category, status, progress_percent, event_date, description, created_by')
        .in('status', ['active','planning','pending_approval','paused'])
        .or(orFilter)
        .limit(3);
      nameMatched = data || [];
    }

    // Busca projetos onde eh membro
    const { data: memberRows } = await supabase.from('project_members')
      .select('project_id, role_in_project')
      .eq('collaborator_id', collabId);
    const myProjectIds = (memberRows || []).map(r => r.project_id);
    const myRolesByProject = new Map((memberRows || []).map(r => [r.project_id, r.role_in_project]));

    let myProjects = [];
    if (myProjectIds.length > 0) {
      const { data } = await supabase.from('projects')
        .select('id, name, category, status, progress_percent, event_date, description, created_by')
        .in('id', myProjectIds)
        .in('status', ['active','planning','pending_approval','paused'])
        .limit(10);
      myProjects = data || [];
    }

    // Merge sem duplicar
    const projectsMap = new Map();
    for (const p of [...nameMatched, ...myProjects]) projectsMap.set(p.id, p);
    const projects = [...projectsMap.values()].slice(0, 5);

    if (projects.length === 0) {
      return '# 📊 PROJETOS DISPONIVEIS PRA RESPONDER\n\n_Nenhum projeto ativo encontrado pra essa pessoa._';
    }

    // 2. Pra cada projeto, carregar checkpoints + tasks + members
    const lines = ['# 📊 PROJETOS DISPONIVEIS PRA RESPONDER', ''];
    lines.push('Use SOMENTE os dados abaixo pra responder sobre status de projeto.');
    lines.push('NUNCA diga "tá zerado" ou "sem time" se houver dados aqui.');
    lines.push('');

    for (const p of projects) {
      const myProjectRole = myRolesByProject.get(p.id) || null;
      const isOwnerOfProject = p.created_by === collabId;
      const canSeeAll = isGlobalLead || isOwnerOfProject || myProjectRole === 'owner' || myProjectRole === 'coordinator';

      const [cpsRes, tasksRes, membersRes, contRes] = await Promise.all([
        supabase.from('project_checkpoints')
          .select('id, name, due_date, status')
          .eq('project_id', p.id)
          .order('sort_order', { ascending: true }),
        supabase.from('tasks')
          .select('id, title, status, due_date, assigned_to, checkpoint_id, context')
          .eq('project_id', p.id)
          .eq('context', 'work'),
        supabase.from('project_members')
          .select('collaborator_id, role_in_project, function_in_project, guest_name, guest_role, collaborators(full_name)')
          .eq('project_id', p.id),
        supabase.from('project_contingencies')
          .select('id, scenario, protocol, position')
          .eq('project_id', p.id)
          .order('position', { ascending: true }),
      ]);

      const cps = cpsRes.data || [];
      let tasks = tasksRes.data || [];
      const members = membersRes.data || [];
      const contingencies = contRes.data || [];

      // Filtra tasks: se nao ve tudo, so as proprias
      if (!canSeeAll) tasks = tasks.filter(t => t.assigned_to === collabId);

      // Mapa collab_id -> nome
      const nameById = new Map();
      for (const m of members) {
        if (m.collaborator_id && m.collaborators) {
          const coll = Array.isArray(m.collaborators) ? m.collaborators[0] : m.collaborators;
          if (coll && coll.full_name) nameById.set(m.collaborator_id, coll.full_name);
        }
      }

      // Header do projeto
      lines.push(`## ${p.name} ${p.event_date ? `(evento ${p.event_date})` : ''}`);
      lines.push(`Categoria: ${p.category || '—'} · Status: ${p.status} · Progresso: ${p.progress_percent || 0}%`);
      if (p.description) lines.push(`Descrição: ${p.description.slice(0, 200)}`);

      // Time
      if (members.length > 0) {
        lines.push(`\n**Time (${members.length}):**`);
        for (const m of members) {
          if (m.collaborator_id) {
            const coll = Array.isArray(m.collaborators) ? m.collaborators[0] : m.collaborators;
            const fn = m.function_in_project ? ` — ${m.function_in_project}` : '';
            lines.push(`- ${coll?.full_name || '—'}${fn} [${m.role_in_project}]`);
          } else {
            lines.push(`- ${m.guest_name} (externo · ${m.guest_role || '—'})`);
          }
        }
      } else {
        lines.push(`\n**Time:** ainda sem membros cadastrados.`);
      }

      // Checkpoints + tasks dentro de cada
      if (cps.length > 0) {
        lines.push(`\n**Checkpoints (${cps.length}):**`);
        for (const cp of cps) {
          const cpTasks = tasks.filter(t => t.checkpoint_id === cp.id);
          const done = cpTasks.filter(t => t.status === 'done').length;
          const status = cp.status === 'done' ? '✅' : cp.status === 'in_progress' ? '🟡' : '⏳';
          lines.push(`- ${status} ${cp.name}${cp.due_date ? ` (${cp.due_date})` : ''} — ${done}/${cpTasks.length} tarefas`);
          for (const t of cpTasks) {
            const assignee = t.assigned_to ? (nameById.get(t.assigned_to) || 'desconhecido') : 'sem atribuição';
            const tStatus = t.status === 'done' ? '✓' : '·';
            lines.push(`    ${tStatus} ${t.title} (${assignee}${t.due_date ? `, vence ${t.due_date}` : ''})`);
          }
        }
      } else {
        lines.push(`\n**Checkpoints:** nenhum cadastrado ainda.`);
      }

      // Tasks orphan (fora de checkpoint)
      const orphan = tasks.filter(t => !t.checkpoint_id);
      if (orphan.length > 0) {
        lines.push(`\n**Tarefas sem checkpoint (${orphan.length}):**`);
        for (const t of orphan) {
          const assignee = t.assigned_to ? (nameById.get(t.assigned_to) || 'desconhecido') : 'sem atribuição';
          const tStatus = t.status === 'done' ? '✓' : '·';
          lines.push(`- ${tStatus} ${t.title} (${assignee}${t.due_date ? `, vence ${t.due_date}` : ''})`);
        }
      }

      // Contingências
      if (contingencies.length > 0) {
        lines.push(`\n**Contingências mapeadas (${contingencies.length}):**`);
        for (const c of contingencies) {
          lines.push(`- ⚠️ *Cenário:* ${c.scenario}`);
          lines.push(`  *Plano B:* ${c.protocol}`);
        }
      } else {
        lines.push(`\n**Contingências:** nenhuma mapeada ainda.`);
      }

      lines.push('');
      lines.push(`_Permissão: ${canSeeAll ? 'vê tudo do projeto' : 'só as próprias tarefas (RLS aplicado)'}_`);
      lines.push('');
    }

    return lines.join('\n');
  } catch (err) {
    console.log(`[Prompt] WARN buildProjectStatusContext: ${err.message}`);
    return '';
  }
}

async function buildSystemPrompt(collaborator, opts = {}) {
  const lastUserMessage = opts.lastUserMessage || '';
  const ctx = await fetchCollaboratorContext(collaborator);
  if (opts.coordHint) ctx.coordHint = opts.coordHint;
  if (opts.coordContext) ctx.coordContext = opts.coordContext;   // Sprint 17 ACC
  if (opts.integrityHygiene) ctx.integrityHygiene = opts.integrityHygiene; // Sprint 18 hygiene

  // Last message age in minutes (most recent inbound or outbound).
  let lastMsgAge = null;
  const hist = ctx.recentMessages || [];
  if (hist.length > 0) {
    const last = hist[hist.length - 1];
    if (last && last.created_at) {
      lastMsgAge = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 60000);
    }
  }

  const skill = await pickSkill(collaborator, lastUserMessage, hist);
  // Sprint 12 Bloco D: skill priorizacao-inteligente é ANEXADA quando o fluxo
  // principal é checklist-tarefas, criar-compromisso ou cadastro-projeto-5w2h.
  // Ela é "skill auxiliar" — não substitui, completa: pra cada criação, o motor
  // 5min+Eisenhower decide o action_type (now/task/call/meeting/delegate/project)
  // que é refletido no badge do PWA.
  const SKILLS_WITH_PRIORITY_AUX = ['checklist-tarefas', 'criar-compromisso', 'cadastro-projeto-5w2h'];
  const auxPriorityBody = (skill && SKILLS_WITH_PRIORITY_AUX.includes(skill.name))
    ? loadSkill('priorizacao-inteligente')
    : '';
  const skillBlock = (skill && skill.body)
    ? (`# 🎯 SKILL ATIVA: ${skill.name}\n\n${skill.body}` +
       (auxPriorityBody ? `\n\n---\n\n# 🧭 SKILL AUXILIAR: priorizacao-inteligente\n\n${auxPriorityBody}` : ''))
    : '';

  // Sprint 22.22 — quando skill === consultar-projeto, injetar dados reais
  // dos projetos relevantes (TOM nao tem ferramenta SQL, precisa de contexto).
  let projectStatusContextBlock = '';
  if (skill && skill.name === 'consultar-projeto' && collaborator) {
    projectStatusContextBlock = await buildProjectStatusContext(collaborator, lastUserMessage);
  }
  // Sprint 18 — integridade-agenda: injetada como skill auxiliar para todos os roles
  const integritySkillBody = loadSkill('integridade-agenda');
  const integritySkillBlock = integritySkillBody
    ? `\n\n---\n\n# 🛡️ SKILL AUXILIAR: integridade-agenda\n\n${integritySkillBody}`
    : '';
  // Sprint 19 — pedagogico: injetada como skill auxiliar para todos os roles
  // EXCEÇÃO: se pedagogico já for PRIMARY (pickSkill retornou pedagogico), não duplica.
  const pedagogicoSkillBody = (skill && skill.name === 'pedagogico') ? '' : loadSkill('pedagogico');
  const pedagogicoSkillBlock = pedagogicoSkillBody
    ? `\n\n---\n\n# 🎓 SKILL AUXILIAR: pedagogico\n\n${pedagogicoSkillBody}`
    : '';

  // Ritual-aware task filtering:
  // - briefing_pessoal → only personal (fallback manual)
  // - briefing_trabalho / fechamento → only work (fallback manual)
  // - briefing_diario (Sprint 11.1) → BOTH personal + work, em seções separadas no template
  const rt = collaborator && collaborator._ritualType;
  let tasksForCtx = ctx.todayTasks;
  if (rt === 'briefing_pessoal') {
    tasksForCtx = { personal: ctx.personalTasks, work: [] };
  } else if (rt === 'briefing_trabalho' || rt === 'fechamento' ||
             rt === 'daily_closing') {
    tasksForCtx = { personal: [], work: ctx.workTasks };
  } else if (rt === 'briefing_diario' || rt === 'daily_briefing') {
    // Unificado: passa AMBAS as listas; a skill renderiza seções *PESSOAL* e *TRABALHO*.
    tasksForCtx = { personal: ctx.personalTasks, work: ctx.workTasks };
  }

  // Append pending decisions (extension requests) to the context block when present.
  // Habits only included for personal-context interactions: briefing pessoal OR briefing_diario
  // (que tem seção pessoal) OR mensagem de log de hábito.
  const showHabits = (rt === 'briefing_pessoal' || rt === 'personal_briefing' ||
                      rt === 'briefing_diario' || rt === 'daily_briefing') ||
    (skill && skill.name === 'habitos-pessoais');
  const habitsForCtx = showHabits ? (ctx.habits || []) : [];
  // Events split por ritual:
  // - briefing_pessoal → só personal
  // - briefing_trabalho/fechamento → só work
  // - briefing_diario → AMBOS (template separa em seções)
  let eventsForCtx = ctx.todayEvents || [];
  if (rt === 'briefing_pessoal') {
    eventsForCtx = eventsForCtx.filter(e => e.context === 'personal');
  } else if (rt === 'briefing_trabalho' || rt === 'fechamento' || rt === 'daily_closing') {
    eventsForCtx = eventsForCtx.filter(e => e.context === 'work');
  }
  // briefing_diario / daily_briefing: mantém todos os events (sem filtro).
  const baseCtx = buildContext(collaborator, ctx.memories, ctx.prefs, tasksForCtx, ctx.activeProjects, lastMsgAge, habitsForCtx, eventsForCtx);
  const pending = renderPendingDecisions(ctx.notifications);

  // Sprint 10.1 hotfix-2 (Plano C): resolve temporal de "amanhã"/"hoje" + horário
  // do user.msg ANTES do Claude. Injeta ISO já calculado.
  const tzFmt2 = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayISO_main = tzFmt2.format(new Date());
  const tmrwDate = new Date(todayISO_main + 'T03:00:00.000Z');
  tmrwDate.setUTCDate(tmrwDate.getUTCDate() + 1);
  const tomorrowISO_main = tmrwDate.toISOString().slice(0, 10);
  const resolved = resolveTemporalRef(lastUserMessage, todayISO_main, tomorrowISO_main);
  let resolutionBlock = '';
  if (resolved) {
    const lines = ['', '**🎯 Resolução temporal desta mensagem (USE EXATAMENTE este ISO se for emitir marker):**'];
    lines.push(`- "${resolved.dayWord}" no contexto desta mensagem = **${resolved.targetDay}**`);
    if (resolved.iso) {
      lines.push(`- Horário detectado: ${resolved.hour}:${resolved.minute}`);
      lines.push(`- ISO 8601 completo (cole literal no marker): \`${resolved.iso}\``);
    }
    lines.push(`- ❌ Não recalcule. Não some 1 dia "por garantia". Engine valida e auto-corrige se errar — mas evite o roundtrip.`);
    resolutionBlock = '\n' + lines.join('\n');
  }
  // Sprint 11.3 hotfix — Active Thread Binding. Calcula objeto corrente da
  // conversa (task ativa) e injeta hint explícito pra LLM resolver pronomes
  // ("a ligação", "ele", "me lembra") sem chutar pelo mais saliente.
  const allTasks = [...(ctx.personalTasks || []), ...(ctx.workTasks || [])];
  const activeThread = await inferActiveThread(hist, allTasks, collaborator?.id);
  const activeThreadBlock = renderActiveThreadHint(activeThread);

  const ctxBlock = (pending ? baseCtx + '\n' + pending : baseCtx) + resolutionBlock + activeThreadBlock;

  const blocks = [
    BLOCK_RULES,
    BLOCK_IDENTITY,
    ctxBlock,
    skillBlock,
    projectStatusContextBlock,
  ].filter(Boolean);

  let systemPrompt = blocks.join('\n\n---\n\n');

  // Hotfix pós-Sprint20: diretiva linguística — TOM fala português sempre.
  // Bug: PO reclamou de "task" em outputs (apareceu em mensagem do TOM).
  // Aplicado como instrução do sistema — vale para todo turno.
  systemPrompt += `\n\n---\n\n# 🇧🇷 LÍNGUA E TOM\n\nVocê fala **português brasileiro**, sempre. NUNCA use jargão técnico em inglês com colaboradores leigos:\n- "task" → escreva **"tarefa"** ou **"demanda"**\n- "deadline" → **"prazo"**\n- "follow-up" → **"acompanhamento"** ou **"cobrança"**\n- "feedback" → **"retorno"** ou **"devolutiva"**\n- "checklist" pode ficar (já naturalizado)\n- "briefing" → use sem traduzir, mas explica se 1ª vez\n\nEnums (priority, status, subdomain) ficam em inglês no JSON do marker (engine valida), mas em mensagens humanas use a tradução: critical→"urgente", high→"alta", medium→"média", low→"baixa", school→"LA Music School", kids→"LA Music Kids".`;
  // Fim do hotfix linguístico.

  // Checklist operacional ativo (se houver dispatch pendente hoje dentro da janela)
  const checklistHint = await getActiveChecklistHint(collaborator.id);
  if (checklistHint) {
    systemPrompt += checklistHint;
  }

  // Comunicados internos — disponível apenas para director/coordinator
  if (collaborator && (collaborator.role === 'director' || collaborator.role === 'coordinator')) {
    const comunicadosPath = path.join(SKILLS_DIR, 'comunicados.md');
    if (fs.existsSync(comunicadosPath)) {
      const comunicadosSkill = fs.readFileSync(comunicadosPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + comunicadosSkill;
    }
  }

  // Eventos institucionais — disponível apenas para director/coordinator
  if (collaborator && (collaborator.role === 'director' || collaborator.role === 'coordinator')) {
    const eventosPath = path.join(SKILLS_DIR, 'eventos-institucionais.md');
    if (fs.existsSync(eventosPath)) {
      const eventosSkill = fs.readFileSync(eventosPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + eventosSkill;
    }
  }

  // Aprovação de comunicados — disponível apenas para director/coordinator
  if (collaborator && (collaborator.role === 'director' || collaborator.role === 'coordinator')) {
    const aprovacaoPath = path.join(SKILLS_DIR, 'aprovacao-comunicados.md');
    if (fs.existsSync(aprovacaoPath)) {
      const aprovacaoSkill = fs.readFileSync(aprovacaoPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + aprovacaoSkill;
    }
  }

  // Sprint 15 — Operações Técnicas (camada operacional replicável)
  // Disponível para TODOS os roles: qualquer colaborador pode reportar
  // incidente/falta/manutenção. Triagem e classificação acontecem dentro da skill.
  // O engine cuida do resto — esta skill só ensina TOM a classificar e emitir
  // <<TASK_UPDATE>> com department_id + request_type_id corretos.
  if (collaborator) {
    const operacoesPath = path.join(SKILLS_DIR, 'operacoes-tecnicas.md');
    if (fs.existsSync(operacoesPath)) {
      const operacoesSkill = fs.readFileSync(operacoesPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + operacoesSkill;
    }
  }

  // Sprint 15 — Piloto Marketing (replicabilidade da camada operacional)
  // Mesmo padrão de Operações Técnicas: registra demandas de comunicação externa
  // como tasks com department_id=marketing + request_type_id correto.
  // Disponível para todos os roles.
  if (collaborator) {
    const marketingPath = path.join(SKILLS_DIR, 'marketing.md');
    if (fs.existsSync(marketingPath)) {
      const marketingSkill = fs.readFileSync(marketingPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + marketingSkill;
    }
  }

  // Sprint 16 — Coordenação Conversacional (intermediação de mensagens via TOM)
  // Disponível para TODOS os roles: qualquer colaborador pode pedir relay/followup,
  // mas a skill ensina TOM a recusar followup fora de alçada antes de emitir marker.
  if (collaborator) {
    const coordPath = path.join(SKILLS_DIR, 'coordenacao-conversacional.md');
    if (fs.existsSync(coordPath)) {
      const coordSkill = fs.readFileSync(coordPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + coordSkill;
    }
  }

  // Sprint 16 — COORD_HINT injection (só presente quando recipient tem recados abertos)
  if (ctx && ctx.coordHint) {
    systemPrompt += '\n\n' + ctx.coordHint;
  }

  // Sprint 17 — ACC injection (contexto ativo de coordenação; convive com COORD_HINT — Decisão 5.3)
  if (ctx && ctx.coordContext) {
    systemPrompt += '\n\n' + ctx.coordContext;
  }

  // Sprint 18 — integridade-agenda skill auxiliar (sempre carregada para todos os roles)
  if (integritySkillBlock) {
    systemPrompt += integritySkillBlock;
  }

  // Sprint 19 — pedagogico skill auxiliar (sempre carregada para todos os roles)
  if (pedagogicoSkillBlock) {
    systemPrompt += pedagogicoSkillBlock;
  }

  // Sprint 18 — hygiene context injection (briefing matinal com findings de higiene)
  if (ctx && ctx.integrityHygiene) {
    systemPrompt += '\n\n[INTEGRITY_HYGIENE_CONTEXT]\n' + ctx.integrityHygiene;
  }

  const totalTasks = (ctx.personalTasks?.length || 0) + (ctx.workTasks?.length || 0);
  const evCount = (ctx.todayEvents || []).length;
  console.log(`[Prompt] size: ${systemPrompt.length} chars (skill: ${skill ? skill.name : 'none'}, history: ${hist.length}, memories: ${ctx.memories.length}, tasks: ${totalTasks}/p${ctx.personalTasks?.length || 0}/w${ctx.workTasks?.length || 0}, events: ${evCount}, ritual: ${rt || '-'})`);

  // Compatibility: engine.js destructures { systemPrompt, ctx } and reads ctx.memories,
  // ctx.todayTasks, ctx.notifications, ctx.recentMessages.
  return { systemPrompt, ctx };
}

// DEPRECATED (Sprint 19 cleanup — 2026-05-03): dead code.
// Nenhum call site em _remote/ importa esta função (verificado via grep em engine.js,
// scripts/, e todo _remote/). Foi mantida como "backward-compat" quando buildSystemPrompt
// virou async, mas o builder async foi reescrito para fazer tudo inline e nunca mais
// delegou para cá. Diverge intencionalmente de buildSystemPrompt: NÃO carrega as skills
// auxiliares globais (pedagogico, coordenacao-conversacional, integridade-agenda) nem
// os blocks novos (rituals, projects-ranking, habits-overview). Se algum caller futuro
// precisar de prompt sync, recriar a partir do buildSystemPrompt em vez de reanimar isto.
// TODO: remover em Sprint 20 após confirmar zero uso externo.
async function composeSystemPrompt(collaborator, ctx) {
  let lastMsgAge = null;
  const hist = (ctx && ctx.recentMessages) || [];
  if (hist.length > 0) {
    const last = hist[hist.length - 1];
    if (last && last.created_at) {
      lastMsgAge = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 60000);
    }
  }
  const skill = await pickSkill(collaborator, '', hist);
  const skillBlock = (skill && skill.body) ? `# 🎯 SKILL ATIVA: ${skill.name}\n\n${skill.body}` : '';
  const blocks = [
    BLOCK_RULES,
    BLOCK_IDENTITY,
    buildContext(collaborator, ctx.memories || [], ctx.prefs, ctx.todayTasks || [], ctx.activeProjects || [], lastMsgAge, ctx.habits || [], ctx.todayEvents || []),
    skillBlock,
  ].filter(Boolean);
  let syncPrompt = blocks.join('\n\n---\n\n');
  // Sprint 16 — COORD_HINT injection (só presente quando recipient tem recados abertos)
  if (ctx && ctx.coordHint) {
    syncPrompt += '\n\n' + ctx.coordHint;
  }
  // Sprint 17 — ACC injection
  if (ctx && ctx.coordContext) {
    syncPrompt += '\n\n' + ctx.coordContext;
  }
  return syncPrompt;
}

/**
 * Formata o histórico recente + mensagem atual como messages[] estilo OpenAI.
 */
function formatMessages(recent, currentText) {
  // Sprint 10.1 hotfix-2 (Plano B): sanitiza mensagens passadas do TOM
  // (outbound) removendo "(DD/MM)" parentético próximo a palavras temporais.
  // Combate history poisoning: se TOM canonizou data errada num turno
  // anterior ("Amanhã (30/04)..."), aquilo NÃO chega como fato pra Claude
  // no próximo turno.
  const msgs = (recent || []).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.direction === 'outbound' ? sanitizeAssistantContent(m.content) : m.content,
  }));
  msgs.push({ role: 'user', content: currentText });
  return msgs;
}

module.exports = { buildSystemPrompt, formatMessages, composeSystemPrompt, fetchCollaboratorContext, nameFor, todaySaoPaulo };
