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

**MARKERS VÁLIDOS (lista canônica — Sprint 10.1):**
\`<<TASK_UPDATE>>\` (com action: create/complete/reschedule/delegate/extension_request/approve/deny) · \`<<EVENT_CREATE>>\` · \`<<EVENT_UPDATE>>\` · \`<<PROJECT_CREATE>>\` · \`<<PROJECT_APPROVE>>\` · \`<<PROJECT_REJECT>>\` · \`<<HABIT_ACTION>>\` · \`<<MEMORY_SAVE>>\` · \`<<DND_UPDATE>>\` · \`<<ONBOARDING_DONE>>\` · \`<<WEEKLY_PLAN>>\`. Final SEMPRE \`<<END>>\`.

**MARKERS HALLUCINATED (NUNCA emita — não existem):**
\`<<TASK_CREATE>>\` ❌ → use \`<<TASK_UPDATE>>\` action="create" · \`<<TASK_DONE>>\` ❌ → action="complete" · \`<<TASK_DELETE>>\` ❌ → action="cancel" · \`<<TASK_REMIND>>\` ❌ → action="create" + remind_at · \`<<TASK_NEW>>\`/\`<<TASK_ADD>>\`/\`<<TASK_LIST>>\` ❌ · \`<<EVENT_NEW>>\`/\`<<EVENT_DONE>>\`/\`<<EVENT_CANCEL>>\` ❌ → use \`<<EVENT_UPDATE>>\` action correta · \`<<HABIT_LOG>>\`/\`<<HABIT_DONE>>\` ❌ → use \`<<HABIT_ACTION>>\` action="log" · \`<<MEMORY_WRITE>>\`/\`<<MEMORY_UPDATE>>\` ❌ → \`<<MEMORY_SAVE>>\`. Se você "achou" um nome de marker que não está na lista válida acima, ele NÃO existe. NÃO invente.
7. Bullets com \`•\` (nunca \`-\` ou \`*\`). Negrito \`*assim*\`. Itálico \`_assim_\`.
8. Emoji ANTES do texto, nunca no meio. Cada emoji tem significado fixo (ver mapa).
9. NUNCA 🎵.
10. Se contexto disser ONBOARDING ATIVO, ignore qualquer histórico e comece o fluxo de onboarding (5 perguntas, uma por vez). Não invente briefing.
11. SIGA EXATAMENTE os exemplos de resposta canônica que aparecem na seção "SKILL ATIVA" abaixo. Use os emojis indicados nos exemplos — palavra por palavra, emoji por emoji. Se um exemplo mostra "⏰ *Que horas você costuma fechar o dia?*", você DEVE responder com "⏰ *Que horas você costuma fechar o dia?*". NÃO improvise formatação, NÃO troque emojis, NÃO omita emojis. Os exemplos da skill são contratos, não sugestões.
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
  lines.push(`**Data/hora agora (BRT):** ${todayISO} ${nowHHMM} (${todayWD})`);
  lines.push(`**Amanhã (BRT):** ${tomorrowISO}`);
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
  const renderTaskList = (arr) => {
    arr.slice(0, 8).forEach((t, i) => {
      const overdue = t.due_date && t.due_date < today ? '🔴 ' : '';
      const sid = String(t.id || '').slice(0, 8);
      lines.push(`${i + 1}. [id=${sid}] ${overdue}${t.title}`);
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
function pickSkill(collab, lastUserMessage, recentHistory) {
  // Priority 1: onboarding active.
  if (collab && collab.onboarding_completed === false) {
    return { name: 'onboarding', body: loadSkill('onboarding') };
  }

  // Priority 1.4: audio transcription — wraps the actual intent in a
  // confirmation flow before any action marker is emitted.
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

  // Priority 2: in middle of 5W2H flow (detect from history).
  const recentText = (recentHistory || []).map(m => m.content || '').join(' ').toLowerCase();
  const inProjectFlow =
    /qual a janela|metodologia|horas por semana|quem vai participar/.test(recentText) &&
    !/✅.*criado|cancelar|esquece/i.test(recentText.slice(-500));
  if (inProjectFlow) return { name: 'cadastro-projeto-5w2h', body: loadSkill('cadastro-projeto-5w2h') };

  // Priority 3: explicit project creation intent — exige a palavra "projeto".
  if (/\b(criar|novo|cadastrar)\s+(?:um\s+|o\s+|outro\s+)?projeto/i.test(lastUserMessage || '')) {
    return { name: 'cadastro-projeto-5w2h', body: loadSkill('cadastro-projeto-5w2h') };
  }

  // Priority 4: ritual context — engine sets _ritualType for cron-fired briefings/closings.
  const rt = collab && collab._ritualType;
  if (rt === 'planejamento_semanal' || rt === 'weekly_planning') {
    return { name: 'planejamento-semanal', body: loadSkill('planejamento-semanal') };
  }
  if (rt === 'briefing_trabalho' || rt === 'briefing_pessoal' || rt === 'fechamento' ||
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
    const reminderIntentRe = /\b(anota|me\s+lembra|lembra\s+de|lembrete|me\s+chama|p[oó]e\s+na\s+lista|adiciona\s+(?:na\s+lista|tarefa))\b/i;
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

  // Priority 5: task management intent. Includes create/remind/reschedule/complete/delegate/extension signals,
  // PLUS new-demand signals (surgiu, preciso falar, tem que resolver, fala com, etc).
  if (/\b(fiz|terminei|feito|completei|fechei|reagenda|adia|adiar|delega|surgiu|anota|me\s+lembra|lembra(?:r|nça)|lembra\s+(?:de|do|da)\s+\w|lembrete|me\s+chama|daqui\s+a?\s*\d|em\s+\d+\s*(min|hora|h)|p[oó]e\s+na\s+lista|adiciona|marca\s+(?:reuni|m[eé]dico|consulta|hor[áa]rio)|muda\s+(?:a|o|pra)|deixa\s+pra|n[aã]o\s+vou\s+conseguir|preciso\s+de\s+mais\s+prazo|n[aã]o\s+(?:dá|vai\s+dar)\s+at[eé]|estender\s+(?:o\s+)?prazo|aprov[ao]r|negar|nego\s+a)/i.test(lastUserMessage || '')) {
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
      .order('eisenhower_quadrant', { ascending: true, nullsFirst: false }),
    supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id).lte('due_date', today).eq('context', 'work').neq('status', 'done')
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

// ---------- main builder ----------
async function buildSystemPrompt(collaborator, opts = {}) {
  const lastUserMessage = opts.lastUserMessage || '';
  const ctx = await fetchCollaboratorContext(collaborator);

  // Last message age in minutes (most recent inbound or outbound).
  let lastMsgAge = null;
  const hist = ctx.recentMessages || [];
  if (hist.length > 0) {
    const last = hist[hist.length - 1];
    if (last && last.created_at) {
      lastMsgAge = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 60000);
    }
  }

  const skill = pickSkill(collaborator, lastUserMessage, hist);
  const skillBlock = (skill && skill.body)
    ? `# 🎯 SKILL ATIVA: ${skill.name}\n\n${skill.body}`
    : '';

  // Ritual-aware task filtering: briefing_pessoal → only personal, briefing_trabalho/fechamento → only work.
  const rt = collaborator && collaborator._ritualType;
  let tasksForCtx = ctx.todayTasks;
  if (rt === 'briefing_pessoal') {
    tasksForCtx = { personal: ctx.personalTasks, work: [] };
  } else if (rt === 'briefing_trabalho' || rt === 'fechamento' ||
             rt === 'daily_briefing' || rt === 'daily_closing') {
    tasksForCtx = { personal: [], work: ctx.workTasks };
  }

  // Append pending decisions (extension requests) to the context block when present.
  // Habits only included for personal-context interactions (briefing pessoal OR if the
  // user message looks like a habit log/manage). Avoids leaking habit list into work briefings.
  const showHabits = (rt === 'briefing_pessoal' || rt === 'personal_briefing') ||
    (skill && skill.name === 'habitos-pessoais');
  const habitsForCtx = showHabits ? (ctx.habits || []) : [];
  // Events split por ritual: briefing_pessoal → só personal; briefing_trabalho/fechamento → só work; demais → todos.
  let eventsForCtx = ctx.todayEvents || [];
  if (rt === 'briefing_pessoal') eventsForCtx = eventsForCtx.filter(e => e.context === 'personal');
  else if (rt === 'briefing_trabalho' || rt === 'fechamento' || rt === 'daily_briefing' || rt === 'daily_closing') {
    eventsForCtx = eventsForCtx.filter(e => e.context === 'work');
  }
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
  const ctxBlock = (pending ? baseCtx + '\n' + pending : baseCtx) + resolutionBlock;

  const blocks = [
    BLOCK_RULES,
    BLOCK_IDENTITY,
    ctxBlock,
    skillBlock,
  ].filter(Boolean);

  const systemPrompt = blocks.join('\n\n---\n\n');

  const totalTasks = (ctx.personalTasks?.length || 0) + (ctx.workTasks?.length || 0);
  const evCount = (ctx.todayEvents || []).length;
  console.log(`[Prompt] size: ${systemPrompt.length} chars (skill: ${skill ? skill.name : 'none'}, history: ${hist.length}, memories: ${ctx.memories.length}, tasks: ${totalTasks}/p${ctx.personalTasks?.length || 0}/w${ctx.workTasks?.length || 0}, events: ${evCount}, ritual: ${rt || '-'})`);

  // Compatibility: engine.js destructures { systemPrompt, ctx } and reads ctx.memories,
  // ctx.todayTasks, ctx.notifications, ctx.recentMessages.
  return { systemPrompt, ctx };
}

// Backward-compat: synchronous compose using already-fetched ctx.
function composeSystemPrompt(collaborator, ctx) {
  let lastMsgAge = null;
  const hist = (ctx && ctx.recentMessages) || [];
  if (hist.length > 0) {
    const last = hist[hist.length - 1];
    if (last && last.created_at) {
      lastMsgAge = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 60000);
    }
  }
  const skill = pickSkill(collaborator, '', hist);
  const skillBlock = (skill && skill.body) ? `# 🎯 SKILL ATIVA: ${skill.name}\n\n${skill.body}` : '';
  const blocks = [
    BLOCK_RULES,
    BLOCK_IDENTITY,
    buildContext(collaborator, ctx.memories || [], ctx.prefs, ctx.todayTasks || [], ctx.activeProjects || [], lastMsgAge, ctx.habits || [], ctx.todayEvents || []),
    skillBlock,
  ].filter(Boolean);
  return blocks.join('\n\n---\n\n');
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
