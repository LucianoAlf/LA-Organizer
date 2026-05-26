// src/prompts/system.js — 4-block architecture
// REGRAS (top) → IDENTIDADE → CONTEXTO → SKILL ATIVA (1 only).
// Total target: < 8KB. History limited to 5 msgs, memory to 10.
const fs = require('fs');
const path = require('path');
const supabase = require('../supabase/client');
const { checkAccess, DATA_LEVELS } = require('../services/la-report-access');

const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

// Fase A — Bloco dinâmico de governança de dados injetado no system prompt.
// Lista o que o collaborator atual pode/não pode consultar no LA Report.
function buildAccessBlock(collab) {
  if (!collab) return '';
  const allowed = [];
  const blocked = [];
  for (const dataType of Object.keys(DATA_LEVELS)) {
    const res = checkAccess(collab, dataType);
    const pretty = dataType.replace(/_/g, ' ');
    if (res.allowed) {
      const suffix = res.unitFilter
        ? ` (apenas ${Array.isArray(res.unitFilter) ? res.unitFilter.join(', ') : res.unitFilter})`
        : res.scopeFilter === 'seus_alunos'
        ? ' (apenas seus alunos)'
        : '';
      allowed.push(`- ${pretty}${suffix}`);
    } else {
      blocked.push(`- ${pretty}`);
    }
  }
  return `\n## Regras de acesso ao LA Report para ${collab.full_name}\n\n### ✅ Pode consultar:\n${allowed.join('\n')}\n\n### 🚫 NÃO pode consultar:\n${blocked.join('\n')}\n\n### Comportamento obrigatório:\n1. NUNCA revelar dados da lista bloqueada\n2. Dizer "essa informação é restrita ao seu perfil" se pedirem algo bloqueado\n3. Aplicar filtros de unidade quando indicado\n4. Sugerir "Fala com o Alf ou a coordenação" ao negar\n`;
}

// Caminho do organograma (referência de governança LA Music)
const ORGANOGRAMA_PATH = path.join(__dirname, '..', '..', 'docs', 'organograma-la-music.md');

let _organogramaCache = null;
function loadOrganograma() {
  if (_organogramaCache !== null) return _organogramaCache;
  try {
    _organogramaCache = fs.readFileSync(ORGANOGRAMA_PATH, 'utf8');
  } catch (err) {
    console.warn('[Prompt] organograma load err:', err.message);
    _organogramaCache = '';
  }
  return _organogramaCache;
}

// ---------- BLOCK 1 — REGRAS INVIOLÁVEIS (hardcoded, top of prompt) ----------
const BLOCK_RULES = `# 🚨 REGRAS INVIOLÁVEIS — PRIORIDADE MÁXIMA

1. Você é TOM 👽 — organizador WhatsApp da LA Music.
2. Trate o usuário pelo apelido. Se full_name="Luciano Alf" → "Alf". Sem apelido → primeiro nome.
3. 👽 SÓ no início da primeira mensagem de uma interação fresca (sem conversa nas últimas ~60min). Nunca repetir, nunca no meio.
4. Direto, informal brasileiro: "pô", "beleza", "show", "bora". Sem corporativês.
5. Máximo 3-4 linhas por mensagem. Uma pergunta por vez.
6. ZERO leaks: nada de IDs, UUIDs, markers <<...>> visíveis ao usuário, "5W2H", "Eisenhower", "quadrante", nomes de tabelas, paths de filesystem, "engine", "API", "banco". Você NÃO tem ferramentas neste contexto — NUNCA emita \`<tool_call>\`, \`<tool_use>\`, \`<function_call>\`, \`<tool_name>\`, \`<parameters>\`, ou qualquer marcação de invocação de tool. Sua resposta é APENAS texto natural + markers oficiais documentados.

**MARKERS VÁLIDOS (lista canônica — Sprint 10.1+):**
\`<<TASK_UPDATE>>\` (com action: create/complete/reschedule/delegate/extension_request/approve/deny) · \`<<EVENT_CREATE>>\` · \`<<EVENT_UPDATE>>\` · \`<<PROJECT_CREATE>>\` · \`<<PROJECT_APPROVE>>\` · \`<<PROJECT_REJECT>>\` · \`<<HABIT_ACTION>>\` · \`<<MEMORY_SAVE>>\` · \`<<DND_UPDATE>>\` · \`<<ONBOARDING_DONE>>\` · \`<<WEEKLY_PLAN>>\` · \`<<MONTHLY_PLAN>>\` · \`<<CHECKPOINT_BATCH>>\` (Sprint 11.4) · \`<<CHECKLIST_ACTION>>\` (Sprint 12) · \`<<ANNOUNCEMENT_ACTION>>\` (Sprint 13) · \`<<SCHOOL_EVENT_ACTION>>\` (Sprint 13) · \`<<ANNOUNCEMENT_APPROVAL>>\` (Sprint 13) · \`<<PERSONAL_LIST_ACTION>>\` (Sprint 22.38) · \`<<INVENTORY_ACTION>>\` (LA Report) · \`<<SHOP_ACTION>>\` (lojinha — venda/entrada/ajuste/consulta de estoque; veja skill \`lojinha.md\`). Cada marker fecha com \`<<END>>\` — **mas só inclua \`<<END>>\` se você emitiu algum marker nesta resposta**. Respostas sem markers NÃO devem conter \`<<END>>\`.

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
15. **"O que combinamos ontem?" → olhe as tasks, não o histórico da conversa.** Quando o usuário perguntar sobre pendências, planejamentos ou combinados anteriores ("me lembra o que ficou pendente", "o que combinamos?", "o que ficou da reunião de ontem?"), NUNCA diga "não tenho histórico da conversa de ontem". O histórico de tarefas já está injetado acima em formato estruturado. Responda referenciando as tasks pendentes do contexto. Se não houver nenhuma task relevante, diga "não vejo nada cadastrado sobre isso — quer que eu registre agora?".
16. **NUNCA quebre o personagem falando de mecanismos internos.** Você é assistente operacional, não dev. JAMAIS diga "deixa eu verificar o código", "vou olhar o engine", "vou checar a skill", "vou ver como o sistema trata", "preciso entender como está implementado", "vou analisar o handler", ou qualquer variação que revele que existe código/engine/skill por trás. Quando o usuário pedir ação operacional (cadastrar/atualizar/mover/dar baixa/consultar inventário, criar task, agendar evento, etc), EMITA O MARKER imediatamente com os dados extraídos do pedido. Se o engine rejeitar, ele te avisa — você só responde "não consegui executar, pode reformular?" ou tenta outra variação. NUNCA expõe que está debugando.
17. **Pedidos de pausa RECORRENTE viram PREFS_UPDATE, não desculpa social.** Quando o user pedir pra parar de cobrar em padrão recorrente — "não me cobra fim de semana", "não me cobra aos domingos", "só me cobra em dias úteis", "para de me lembrar nos sábados", "não me incomoda no weekend", etc — você DEVE emitir o marker \`<<PREFS_UPDATE>>\` ANTES de confirmar. Mapeamento: "fim de semana" / "weekend" / "sábado e domingo" → \`{"quiet_weekends":true,"quiet_reason":"<motivo se disse>"}\`. Dias específicos → \`{"quiet_days":[0,6]}\` (0=domingo … 6=sábado). Pra REATIVAR ("volta a me cobrar"): \`{"quiet_weekends":false,"quiet_days":[]}\`. Apenas DEPOIS de emitir o marker você confirma: "beleza, fim de semana fica silencioso. Volto na segunda." Se prometer sem persistir, o ritual vai cobrar de novo amanhã e o user vai te xingar com razão.
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
  // preferred_name set by user in MeuPerfil takes top priority.
  if (collab.preferred_name) return collab.preferred_name.trim().split(/\s+/)[0];
  // Special case: full_name "Luciano Alf" → "Alf".
  if (collab.full_name === 'Luciano Alf') return 'Alf';
  return (collab.full_name || '').split(' ')[0] || 'amigo';
}

// ---------- BLOCK 3 — CONTEXTO (dynamic, ~1KB) ----------
// Sprint 22.36 Fatia 2 — Adicionado: delegatedTasks (tarefas que ESTE user atribuiu
// pra outros), todayChecklists (checklists operacionais de hoje com %).
// Antes ficavam fora do contexto e TOM dizia "não tenho esse dato" no relatório.
function buildContext(collab, prefs, tasks, projects, lastMsgAge, habits, events, delegatedTasks, todayChecklists, teamAdherence, personalChecklists, teamTodayChecklists, teamExpectedTemplates, schoolEvents = [], eventTypes = [], doneFutureTasks = [], monthlyCtxBlock = null, orgChart = [], criticalMemories = [], preferenceMemories = [], weeklySummary = null, recentContextMemories = []) {
  const nickname = nameFor(collab);
  const lines = ['# 📌 CONTEXTO DESTA INTERAÇÃO', ''];
  const { ROLE_LABELS: ROLE_LABELS_PT } = require('../lib/roles');
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
    // Sprint 23.5 — calendário com nomes completos para evitar erro de dia ("quinta" ≠ "qui")
    const _fullDays = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
    const fullWeek = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + i);
      return `${_fullDays[d.getUTCDay()]} ${_fmtDate(d)}`;
    });
    lines.push(`**Dias desta semana (para markers):** ${fullWeek.join(' · ')}`);
  }

  // Calendário de lookup — evita que TOM calcule dia-da-semana e erre.
  // Formato compacto 1 linha, 16 dias. Root cause: LLM date arithmetic falha.
  {
    const _abbrDays = ['dom','seg','ter','qua','qui','sex','sáb'];
    const todayAnchor = new Date(todayISO + 'T15:00:00.000Z');
    const calParts = [];
    for (let i = 0; i <= 15; i++) {
      const d = new Date(todayAnchor);
      d.setUTCDate(d.getUTCDate() + i);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const abbr = _abbrDays[d.getUTCDay()];
      const tag = i === 0 ? '(HOJE)' : i === 1 ? '(amanhã)' : '';
      calParts.push(tag ? `${abbr} ${dd}/${mm}${tag}` : `${abbr} ${dd}/${mm}`);
    }
    lines.push(`**TABELA DE DATAS — Use SEMPRE esta tabela para converter dia-da-semana em data. NUNCA calcule datas mentalmente. Se o usuário pedir data além do último dia desta tabela, pergunte: "Qual a data exata?"**\n${calParts.join(' | ')}`);
  }

  lines.push(`**Timezone para markers:** America/Sao_Paulo. Sempre use ISO -03:00 em remind_at, start_at, end_at, etc. Ex: "amanhã 11h" → "${tomorrowISO}T11:00:00-03:00".`);
  lines.push('');

  const roleDisplay = ROLE_LABELS_PT[collab.role] || collab.role || '—';
  lines.push(`**Pessoa:** ${nickname} (${collab.full_name}) — ${roleDisplay}${fn}`);
  if (collab.bio) {
    lines.push(`**Bio (${nickname} escreveu sobre si mesmo — leia com atenção):** ${collab.bio}`);
  }
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

  // Memória estratificada — crítico + preferences + semana + contexto semântico.
  const hasAnyMemory = (criticalMemories && criticalMemories.length) ||
                       (preferenceMemories && preferenceMemories.length) ||
                       weeklySummary ||
                       (recentContextMemories && recentContextMemories.length);

  if (hasAnyMemory) {
    const nick = nameFor(collab);
    lines.push('', `## O que sei sobre ${nick}`);

    if (criticalMemories && criticalMemories.length) {
      lines.push('', '**Crítico:**');
      criticalMemories.forEach(m => lines.push(`• [${m.memory_type}] ${m.content}`));
    }

    if (preferenceMemories && preferenceMemories.length) {
      lines.push('', '**Preferências:**');
      preferenceMemories.forEach(m => lines.push(`• ${m.content}`));
    }

    if (weeklySummary && weeklySummary.summary) {
      const wk = weeklySummary.week_start || '';
      lines.push('', `**Semana passada (a partir de ${wk}):**`, weeklySummary.summary);
    }

    if (recentContextMemories && recentContextMemories.length) {
      lines.push('', '**Contexto recente (relevante à mensagem atual):**');
      recentContextMemories.forEach(m => lines.push(`• [${m.memory_type}] ${m.content}`));
    }
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
      const doneTag = t.status === 'done' ? '✅ ' : '';
      lines.push(`${i + 1}. [id=${sid}] ${overdue}${doneTag}${t.title}${timeBit}`);
      // Descrição (quando houver) — uma linha indentada abaixo do título.
      // Mantém lista escaneável mas expõe contexto pro TOM responder perguntas
      // tipo "pra que é essa ligação?" sem precisar abrir o detalhe.
      if (t.description && t.description.trim()) {
        const desc = t.description.trim().replace(/\s+/g, ' ');
        const truncated = desc.length > 240 ? desc.slice(0, 240) + '…' : desc;
        lines.push(`   ↳ ${truncated}`);
      }
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

  // Tarefas concluídas com prazo hoje ou futuro (done-futuro).
  // Bloco separado para não ser cortado pelo slice(0,8) das tasks abertas.
  // Garante que TOM responda "o que eu tinha pra amanhã?" mesmo após marcar como feito.
  if (doneFutureTasks && doneFutureTasks.length) {
    lines.push('', `**Concluído (prazo amanhã ou futuro, ${doneFutureTasks.length}):**`);
    doneFutureTasks.forEach(t => {
      const sid = String(t.id || '').slice(0, 8);
      const rel = t.due_date === today ? 'hoje' : t.due_date;
      const ctx = t.context === 'personal' ? 'pessoal' : t.context === 'work' ? 'trabalho' : t.context;
      lines.push(`• ✅ [id=${sid}] "${t.title}" — vencia ${rel} (${ctx})`);
    });
  }

  // Bloco mensal (injetado quando keyword mensal detectada ou últimos 7 dias do mês).
  if (monthlyCtxBlock) {
    lines.push('', monthlyCtxBlock);
  }

  // Agenda próximos 7 dias (events com horário). Ordenados por start_at.
  // Sprint 10 fix: horário em America/Sao_Paulo (-03:00). DB armazena ISO com
  // timezone (e.g. "2026-04-28 12:00:00+00" = 09:00 BRT). slice(11,16) cru
  // mostrava UTC pro Claude → resposta com horário errado.
  // Fix (2026-05-15): expandido de hoje-só para próximos 7 dias, para TOM
  // responder "o que tenho amanhã?" e ver eventos marcados como feito.
  if (events && events.length) {
    lines.push('', `**Agenda — próximos 7 dias (${events.length}):**`);
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
    const fmtDateSP = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      // Retorna YYYY-MM-DD em BRT para comparar com today
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    };
    events.slice(0, 15).forEach(e => {
      const sid = String(e.id || '').slice(0, 8);
      const start = fmtSP(e.start_at);
      const end = fmtSP(e.end_at);
      const mod = e.modality === 'online' ? '💻' : e.modality === 'hibrido' ? '🔀' : '🏢';
      const cat = e.category ? ` · ${e.category}` : '';
      const where = e.location_text ? ` · ${e.location_text}` : '';
      // Prefix de data: só mostra quando não é hoje
      const evDate = fmtDateSP(e.start_at);
      const datePrefix = evDate && evDate !== today ? `[${evDate}] ` : '';
      // Status: done aparece como ✅ para TOM saber que já foi concluído
      const statusTag = e.status === 'done' ? ' ✅' : '';
      // Sprint 22.50b — lembretes pendentes (sent_at IS NULL) listados depois.
      const pendingReminders = (e.event_reminders || [])
        .filter(r => !r.sent_at)
        .map(r => fmtSP(r.remind_at))
        .filter(Boolean)
        .sort();
      const reminders = pendingReminders.length
        ? ` · ⏰ lembretes: ${pendingReminders.join(', ')}`
        : '';
      lines.push(`• [id=${sid}] ${datePrefix}${start}–${end} ${mod} ${e.title}${statusTag}${cat}${where}${reminders}`);
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

  // Sprint 22.36 Fatia 2 — DELEGADAS (tarefas que ESTE user atribuiu pra outros).
  // Necessário pra TOM responder relatórios tipo "como tá meu dia, com delegadas".
  if (delegatedTasks && delegatedTasks.length) {
    lines.push('', `**Delegadas (${delegatedTasks.length}) — tarefas que você atribuiu pra outros:**`);
    delegatedTasks.slice(0, 15).forEach(t => {
      const assignee = (t.assignee && t.assignee.full_name) ? t.assignee.full_name.split(' ')[0] : '(?)';
      const due = t.due_date ? ` — vence ${t.due_date}` : '';
      const status = t.status ? ` — ${t.status}` : '';
      lines.push(`• ${assignee}: "${t.title}"${due}${status}`);
    });
  }

  // Sprint 22.36 Fatia 2 — CHECKLISTS DE HOJE.
  if (todayChecklists && todayChecklists.length) {
    lines.push('', `**Checklists de hoje:**`);
    todayChecklists.forEach(c => {
      const tplName = (c.op_checklists && c.op_checklists.name) || '(sem nome)';
      const items = c.op_checklist_item_completions || [];
      const extras = c.op_checklist_completion_extra_items || [];
      const all = [...items, ...extras];
      const done = all.filter(i => i.is_checked).length;
      const total = all.length || 1;
      const pct = Math.round((done / total) * 100);
      const tag = c.completed_at ? '✅' : (pct >= 70 ? '🟡' : '🔴');
      lines.push(`• ${tag} ${tplName}: ${done}/${total} (${pct}%)${c.completed_at ? ' — concluído' : ''}`);
      // Mostra observações capturadas (TOM pode usar pra contextualizar)
      const noted = all.filter(i => i.notes && String(i.notes).trim());
      noted.slice(0, 3).forEach(i => {
        lines.push(`   ↳ obs: ${String(i.notes).slice(0, 80)}`);
      });
    });
  }

  // Hierarquia explícita — só renderiza quando há colaboradores com manager_id configurado.
  if (orgChart && orgChart.length) {
    const withManager = orgChart.filter(c => c.manager);
    if (withManager.length > 0) {
      lines.push('', '**Hierarquia da equipe:**');
      for (const c of withManager) {
        const firstName = (c.full_name || '').split(' ')[0];
        const managerFirst = (c.manager?.full_name || '—').split(' ')[0];
        const unit = c.unit || '—';
        lines.push(`• ${firstName} (${unit}) → ${managerFirst}`);
      }
    }
  }

  // Sprint 22.37 — ADERÊNCIA DA EQUIPE (semana atual) pra liderança operacional.
  // Skill subfluxo 7 (checklists-operacionais) usa esses dados pra responder
  // perguntas tipo "como tá a aderência da equipe?" sem inventar.
  if (teamAdherence && teamAdherence.length) {
    lines.push('', `**Aderência da equipe (esta semana):**`);
    teamAdherence.slice(0, 25).forEach(t => {
      const emoji = t.pct >= 90 ? '🟢' : t.pct >= 70 ? '🟡' : '🔴';
      const first = (t.full_name || '').split(' ')[0];
      const annotations = [];
      if (t.late_items > 0) annotations.push(`${t.late_items} c/atraso`);
      if (t.escalated_count > 0) annotations.push(`${t.escalated_count} escaladas`);
      const tail = annotations.length ? ` — ${annotations.join(', ')}` : '';
      lines.push(`• ${emoji} ${first}: ${t.pct}% (${t.completed}/${t.dispatched})${tail}`);
    });
  }

  // Sprint 22.47/48 — Checklists da equipe HOJE (só liderança).
  // Mostra:
  //  (a) status real (completions ja existentes — dispatcher rodou)
  //  (b) templates ESPERADOS hoje (independente de dispatch) — assim TOM sempre
  //      sabe responder "quem tem checklist pendente hoje?" mesmo quando o
  //      dispatcher nao rodou ou esta com problema.
  const hasTeamData = (teamTodayChecklists && teamTodayChecklists.length) ||
                      (teamExpectedTemplates && teamExpectedTemplates.length);
  if (hasTeamData) {
    lines.push('', '**Checklists da equipe hoje:**');

    // (a) Status real
  if (teamTodayChecklists && teamTodayChecklists.length) {
    // Per-unit drilldown: agrupa por unidade → colaborador.
    // Se só uma unidade (manager), renderiza flat (sem header de unidade).
    const byUnit = new Map();
    for (const c of teamTodayChecklists) {
      const tplObj = Array.isArray(c.op_checklists) ? c.op_checklists[0] : c.op_checklists;
      const unit = tplObj?.unit || 'sem unidade';
      const name = (Array.isArray(c.collaborators) ? c.collaborators[0] : c.collaborators)?.full_name || c.collaborator_id;
      const first = name.split(' ')[0];
      const items = c.op_checklist_item_completions || [];
      const done = items.filter(i => i.is_checked).length;
      const total = items.length || 1;
      const pct = Math.round((done / total) * 100);
      const tplName = tplObj?.name || '?';
      const tag = c.completed_at ? '✅' : (pct >= 70 ? '🟡' : '🔴');
      if (!byUnit.has(unit)) byUnit.set(unit, new Map());
      const byCollab = byUnit.get(unit);
      if (!byCollab.has(first)) byCollab.set(first, []);
      byCollab.get(first).push(`${tag} ${tplName} (${done}/${total})`);
    }
    lines.push('Status real (já dispatched):');
    if (byUnit.size === 1) {
      // Manager com uma unidade: renderização flat (sem header).
      const [[, byCollab]] = byUnit;
      for (const [name, entries] of byCollab) {
        lines.push(`• ${name}: ${entries.join(' · ')}`);
      }
    } else {
      // Diretor com múltiplas unidades: agrupa com header de unidade.
      for (const [unit, byCollab] of byUnit) {
        lines.push(`📍 ${unit}:`);
        for (const [name, entries] of byCollab) {
          lines.push(`  • ${name}: ${entries.join(' · ')}`);
        }
      }
    }
  } else {
    lines.push('Status real: 0 dispatched, 0 completed.');
  }

    // (b) Templates esperados hoje (independente de dispatch ja ter rodado)
    if (teamExpectedTemplates && teamExpectedTemplates.length) {
      lines.push('Templates esperados hoje (por dia da semana):');
      for (const t of teamExpectedTemplates) {
        const hh = (t.dispatch_time || '').slice(0, 5);
        // marca se ja existe completion pra esse template hoje
        const dispatched = (teamTodayChecklists || []).some(c => {
          const tpl = Array.isArray(c.op_checklists) ? c.op_checklists[0] : c.op_checklists;
          return tpl && tpl.name === t.name;
        });
        const tag = dispatched ? '✅ dispatched' : '⏳ ainda não dispatched';
        lines.push(`• ${t.name} (${hh}, ${t.shift}, ${t.unit}) — ${tag}`);
      }
      const noneDispatched = !(teamTodayChecklists && teamTodayChecklists.length);
      if (noneDispatched) {
        lines.push('⚠️ Nenhum template foi dispatched hoje. Pode ser cedo (dispatcher roda no horário do template), ou o cron pode estar com problema.');
      }
    }
  }

  // Sprint 22.38 — LISTAS PESSOAIS do user (mercado/viagem/remédios/geral).
  // Gated: só injeta listas com pelo menos 1 item pendente, pra evitar ruído.
  // Skill `listas-pessoais.md` usa pra responder/atualizar via TOM.
  if (personalChecklists && personalChecklists.length) {
    const ICON = { shopping: '🛒', travel: '✈️', meds: '💊', general: '📋' };
    const withPending = personalChecklists.filter(l =>
      (l.personal_checklist_items || []).some(it => !it.is_done)
    );
    if (withPending.length) {
      lines.push('', `**Listas pessoais (${withPending.length} ativas com pendências):**`);
      withPending.slice(0, 8).forEach(l => {
        const items = (l.personal_checklist_items || [])
          .filter(it => !it.is_done)
          .sort((a, b) => a.sort_order - b.sort_order);
        const icon = ICON[l.list_type] || '📋';
        // list_id completo (UUID) pra marker add_item funcionar.
        // Todos os itens expostos pra TOM poder listar sem truncar.
        lines.push(`• [list_id=${l.id}] ${icon} ${l.name}: ${items.length} pendentes`);
        items.forEach((it, i) => lines.push(`  ${i + 1}. [item_id=${it.id}] ${it.description}`));
      });
    }
  }

  // Sprint Agenda v2 — eventos institucionais dos próximos 30 dias (toda equipe).
  // Skill `agenda-escolar.md` usa pra responder "o que vai acontecer esse mês?",
  // "tem evento essa semana?", "qual a agenda da Barra?" etc.
  if (schoolEvents && schoolEvents.length) {
    const typeMap = new Map((eventTypes || []).map(t => [t.id, t]));
    const fmtBR = (ymd) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}`; };
    const unitsLabel = (units, unit) => {
      const list = (units && units.length > 0) ? units : (unit ? [unit] : []);
      if (list.length === 0) return 'escola toda';
      if (list.length === 3) return 'todas';
      const map = { barra: 'Barra', recreio: 'Recreio', campo_grande: 'Campo Grande' };
      return list.map(u => map[u] || u).join('+');
    };
    lines.push('', `**📅 Agenda — próximos 30 dias (${schoolEvents.length} eventos):**`);
    schoolEvents.slice(0, 25).forEach(ev => {
      const t = typeMap.get(ev.event_type);
      const emoji = (t && t.emoji) || '📅';
      const range = ev.end_date && ev.end_date !== ev.event_date
        ? `${fmtBR(ev.event_date)}→${fmtBR(ev.end_date)}`
        : fmtBR(ev.event_date);
      const time = (!ev.is_all_day && ev.start_time) ? ` ${ev.start_time.slice(0, 5)}` : '';
      const where = unitsLabel(ev.units, ev.unit);
      const loc = ev.location ? ` · ${ev.location}` : '';
      lines.push(`• ${emoji} [event_id=${ev.id}] *${ev.title}* — ${range}${time} · ${where}${loc}`);
      if (ev.description) lines.push(`  ↳ ${ev.description.slice(0, 140)}`);
    });
  }

  return lines.join('\n');
}

// Render pending coordinator decisions (extension requests waiting for approve/deny).
function renderPendingDecisions(notifications) {
  if (!notifications || !notifications.length) return '';
  const out = [];

  // Pedidos de extensão de prazo (deadline_extension_request)
  const ext = notifications.filter(n =>
    n.notification_type === 'deadline_extension_request' && n.reference_id
  );
  if (ext.length) {
    out.push('', '**📥 Pedidos de prazo aguardando sua decisão:**');
    ext.slice(0, 5).forEach(n => {
      const sid = String(n.reference_id || '').slice(0, 8);
      out.push(`• [id=${sid}] ${n.title}`);
      if (n.body) out.push(`  ${n.body.split('\n')[0].slice(0, 200)}`);
    });
  }

  // Sprint 22.56 — Tasks recém-atribuídas a este user (aguardando resposta 1/2/3/4)
  // Pega notifications dos últimos 2 dias. TOM precisa saber explicitamente qual
  // task_id usar quando o user responde "1", "2", "3", "4" ou pede reschedule/concluir.
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const assigned = notifications.filter(n =>
    n.notification_type === 'task_assigned_by_other'
    && n.reference_id
    && n.created_at && new Date(n.created_at).getTime() >= cutoff
  );
  if (assigned.length) {
    out.push('', '**🔥 Tarefas recém-atribuídas a você (aguardam decisão 1/2/3/4):**');
    assigned.slice(0, 5).forEach(n => {
      const sid = String(n.reference_id || '').slice(0, 8);
      out.push(`• [id=${sid}] ${n.title}`);
    });
    out.push('_Quando o user responder 1/2/3/4 ou pedir reschedule/concluir/delegar referente a uma dessas, **USE EXATAMENTE o [id=...]** acima — não confunda com tarefas mais antigas da lista de hoje._');
  }

  return out.join('\n');
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

  // Trigger: skill de ajuda — usuário pergunta como o sistema funciona
  const lmLower = (lastUserMessage || '').toLowerCase().trim();
  const AJUDA_TRIGGERS = [
    'como você funciona', 'o que você pode fazer', 'o que você faz',
    'comandos', 'funcionalidades', 'o que tem aqui', 'como te uso',
    'como usar você', 'me explica', 'menu',
  ];
  const isHelpAlone = /^(me ajuda|ajuda)[?!.]*$/.test(lmLower);
  // lmLower.length < 80: evita ativar em "me ajuda a criar tarefa de marketing para..."
  if ((AJUDA_TRIGGERS.some(t => lmLower.includes(t)) || isHelpAlone) && lmLower.length < 80) {
    return { name: 'ajuda', body: loadSkill('ajuda') };
  }

  // ── CHECKLISTS-ADMIN skill ───────────────────────────────────────────────
  const CHECKLIST_ADMIN_TRIGGERS = [
    'lista checklists', 'quais checklists', 'mostra os checklists',
    'desliga checklist', 'pausa checklist', 'ativa checklist', 'liga checklist',
    'troca responsável', 'muda responsável',
    'quem é responsável pelo checklist', 'quem faz o checklist',
  ]
  const canManageChecklists = collab && ['director', 'coordinator', 'manager'].includes(collab.role)
  if (
    canManageChecklists &&
    CHECKLIST_ADMIN_TRIGGERS.some(t => lmLower.includes(t))
  ) {
    return { name: 'checklists-admin', body: loadSkill('checklists-admin') }
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

  // Sprint 23 — Follow-up de microconfirmação pós-duplicata.
  // Padrão: engine detectou dup_event, perguntou "1/2/3", user respondeu só "2".
  // Sem essa regra, pickSkill volta `none` e TOM não emite bypass_integrity:true,
  // gerando loop infinito de microconfirmação (vide bug 11/05/2026).
  {
    const lm = (lastUserMessage || '').trim();
    const isolatedChoiceRe = /^[123]\.?$/;
    if (isolatedChoiceRe.test(lm)) {
      const recent = (recentHistory || []).filter(m => m.direction === 'outbound');
      const lastBot = recent.length ? String(recent[recent.length - 1].content || '') : '';
      const dupMicroconfirmRe = /(Achei um compromisso parecido|mesmo compromisso.*atualizo|outro compromisso.*crio novo|Cancela,?\s+vou reformular)/i;
      if (dupMicroconfirmRe.test(lastBot)) {
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

  // Sprint Agenda v2 — Priority 4.85: AGENDA ESCOLAR (eventos institucionais).
  // Captura ANTES de listas-pessoais e checklist-tarefas pra "agenda do mês",
  // "tem evento essa semana?", "quando é o show?", "tem recesso?" virarem
  // consulta na agenda institucional, não criação de task ou lista pessoal.
  const lmAgenda = (lastUserMessage || '').toLowerCase();
  const agendaTopicRe = /\b(agenda|calend[áa]rio|evento(?:s)?|show|workshop|oficina(?:s)?|recesso|f[eé]rias|matr[íi]cula|avalia[çc][ãa]o|reuni[ãa]o\s+(?:de\s+)?pais|festa\s+(?:de\s+)?pais|aula\s+inaugural|apresenta[çc][ãa]o)\b/i;
  const agendaQuestionRe = /\b(o\s+que\s+(?:vai|tem)|quando\s+(?:é|ser[áa])|tem\s+(?:algum)?|quais?\s+(?:s[ãa]o|os)|qual\s+(?:é|a)|m[eê]s\s+que\s+vem|essa\s+semana|esse\s+m[eê]s|trimestre|semestre|este\s+ano|do\s+ano)\b/i;
  const agendaDispatchRe = /\b(manda|dispara|comunica|envia)\s+(?:a\s+|o\s+)?(?:resumo\s+(?:da\s+)?)?(?:agenda|calend[áa]rio)\s+(?:do\s+m[eê]s|do\s+trimestre|do\s+semestre|do\s+ano|pra\s+(?:o\s+)?(?:time|equipe|grupo))/i;
  if (
    agendaDispatchRe.test(lmAgenda) ||
    (agendaTopicRe.test(lmAgenda) && agendaQuestionRe.test(lmAgenda)) ||
    /\bagenda\s+(?:do|da)\s+(?:m[eê]s|trimestre|semestre|ano|barra|recreio|campo\s+grande)\b/i.test(lmAgenda)
  ) {
    return { name: 'agenda-escolar', body: loadSkill('agenda-escolar') };
  }

  // Sprint 22.46 — Priority 4.9: listas pessoais (mercado, viagem, remedios, geral).
  // Captura ANTES de checklist-tarefas pra "adiciona X na lista de mercado" virar
  // PERSONAL_LIST_ACTION, nao TASK_CREATE. Triggers no skill listas-pessoais.md.
  const lmLists = (lastUserMessage || '').toLowerCase();
  const listsTopicRe = /\b(mercado|supermercado|farm[aá]cia|rem[eé]dios?|viagem|compras?(?:\s+do\s+m[eê]s)?|presentes?|sup(?:er)?(?:mercado)?)\b/i;
  const listsActionRe = /\b(adicion[ao]|p[oó]e|coloca|inclui|tira|remove|riscar?|marca|cria(?:r)?\s+(?:uma\s+)?lista|lista\s+(?:de|do|da|pra))\b/i;
  const listsExplicitRe = /\b(?:minha\s+)?lista\s+(?:de|do|da|pra)\s+(?:mercado|supermercado|farm[aá]cia|rem[eé]dios?|viagem|compras?|presentes?)/i;
  const listsMarkDoneRe = /\b(?:j[aá]\s+)?(?:comprei|tomei|peguei)\s+(?:o|a|os|as)?\s*\w/i;
  if (
    listsExplicitRe.test(lmLists) ||
    (listsActionRe.test(lmLists) && listsTopicRe.test(lmLists)) ||
    (listsMarkDoneRe.test(lmLists) && (recentText.includes('mercado') || recentText.includes('viagem') || recentText.includes('rem[eé]di')))
  ) {
    return { name: 'listas-pessoais', body: loadSkill('listas-pessoais') };
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

  // LA EDUCA — só pra coord/director
  if ((collab?.role === 'coordinator' || collab?.role === 'director')
      && /(la\s*educa|estagi[áa]rios?|mentor(?:i?a)?|ancoragem|certificado\s*alfa|trilha)/i.test(lastUserMessage || '')) {
    return { name: 'la-educa', body: loadSkill('la-educa') };
  }

  return null;
}

// ---------- DB fetch ----------
async function fetchCollaboratorContext(collaborator) {
  const id = collaborator.id;
  const today = todaySaoPaulo();
  const next7days = (() => { const d = new Date(today + 'T15:00:00.000Z'); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const past7days = (() => { const d = new Date(today + 'T15:00:00.000Z'); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
  const TASK_COLS = 'id, title, description, status, priority, eisenhower_quadrant, due_date, context, remind_at, project_id, projects(name)';

  const isLeadership = collaborator.role === 'director' || collaborator.role === 'coordinator' ||
    collaborator.role === 'manager' || collaborator.role === 'leader';

  const [
    profileRes,
    prefsRes,
    personalRes,
    workRes,
    projectsRes,
    notificationsRes,
    historyRes,
    habitsRes,
    eventsRes,
    delegatedRes,
    todayChecklistsRes,
    teamAdherenceRes,
    personalChecklistsRes,
    teamTodayChecklistsRes,
    teamExpectedTemplatesRes,
    schoolEventsRes,
    eventTypesRes,
    pastEventsRes,
    pastTasksRes,
    pastHabitLogsRes,
    pastDelegatedRes,
    orgChartRes,
    critRes,
    prefRes,
    weeklyRes,
  ] = await Promise.all([
    supabase.from('collaborator_profiles').select('*').eq('collaborator_id', id).maybeSingle(),
    supabase.from('user_preferences').select('*').eq('collaborator_id', id).maybeSingle(),
    // Sprint 22.29 (Bucket 6) — sort_position primeiro pra TOM respeitar a
    // ordem manual definida pelo user no PWA (DnD na Hoje). Demais orders
    // viram tiebreak pra tasks sem sort_position definido.
    supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id).lte('due_date', next7days).eq('context', 'personal')
      .not('status', 'in', '(done,cancelled)')
      .order('sort_position', { ascending: true, nullsFirst: false })
      .order('remind_at', { ascending: true, nullsFirst: false })
      .order('due_date', { ascending: true })
      .order('eisenhower_quadrant', { ascending: true, nullsFirst: false }),
    supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id).lte('due_date', next7days).eq('context', 'work')
      .not('status', 'in', '(done,cancelled)')
      .order('sort_position', { ascending: true, nullsFirst: false })
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
    // Compromissos próximos 7 dias em America/Sao_Paulo (-03:00). Inclui scheduled e done.
    // Fix 2026-05-15: inclui também eventos onde o user é PARTICIPANTE (event_participants),
    // não só os owned. Antes, convites de terceiros (ex: Juliana convidando Luciano) sumiam
    // do contexto e TOM se confundia com lembretes/datas.
    (async () => {
      const SELECT_COLS = 'id, collaborator_id, title, start_at, end_at, modality, category, context, location_text, meeting_url, status, event_reminders(remind_at, sent_at)';
      const lo = `${today}T00:00:00-03:00`;
      const hi = `${next7days}T23:59:59-03:00`;
      const [own, parts] = await Promise.all([
        supabase.from('events').select(SELECT_COLS)
          .eq('collaborator_id', id).gte('start_at', lo).lte('start_at', hi)
          .neq('status', 'cancelled').order('start_at', { ascending: true }).limit(30),
        supabase.from('event_participants')
          .select(`event:events(${SELECT_COLS})`)
          .eq('collaborator_id', id).neq('status', 'declined'),
      ]);
      const map = new Map();
      for (const e of (own.data || [])) map.set(e.id, e);
      for (const p of (parts.data || [])) {
        const e = p.event;
        if (!e || map.has(e.id)) continue;
        if (e.status === 'cancelled') continue;
        const t = new Date(e.start_at).getTime();
        if (t >= new Date(lo).getTime() && t <= new Date(hi).getTime()) map.set(e.id, e);
      }
      const merged = [...map.values()].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at))).slice(0, 30);
      return { data: merged, error: own.error || parts.error };
    })(),
    // Sprint 22.36 Fatia 2 — DELEGADAS: tarefas que ESTE user atribuiu pra outros.
    // Antes ficavam fora do contexto. Bug do relatório do dia onde TOM dizia
    // "não tenho esse dato no contexto atual" pra delegadas.
    supabase.from('tasks')
      .select('id, title, status, due_date, assigned_to, assignee:collaborators!tasks_assigned_to_fkey(full_name)')
      .eq('created_by', id).neq('assigned_to', id)
      .not('status', 'in', '(done,cancelled)')
      .order('due_date', { ascending: true, nullsFirst: false }).limit(20),
    // Sprint 22.36 Fatia 2 — CHECKLISTS DE HOJE deste user.
    supabase.from('op_checklist_completions')
      .select('id, completed_at, dispatched_at, op_checklists(name, unit), op_checklist_item_completions(is_checked, notes), op_checklist_completion_extra_items(is_checked, notes)')
      .eq('collaborator_id', id)
      .eq('reference_date', today),
    // Sprint 22.37 — Aderência da equipe (semana atual) pra liderança operacional.
    // Director (qualquer unidade) e manager unit-específica recebem o bloco.
    // Coordinator pedagogical (Quintela/Juliana) e manager unit='all' (Yuri) → [].
    (collaborator.role === 'director' || (collaborator.role === 'manager' && collaborator.unit !== 'all'))
      ? supabase.rpc('get_adherence_by_collab', {
          p_start_date: (() => {
            const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
            const todayStr = tzFmt.format(new Date());
            const d = new Date(todayStr + 'T15:00:00.000Z');
            const dow = d.getUTCDay();
            const diffToMonday = dow === 0 ? -6 : 1 - dow;
            d.setUTCDate(d.getUTCDate() + diffToMonday);
            return d.toISOString().slice(0, 10);
          })(),
          p_end_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
          p_unit_filter: collaborator.role === 'manager' ? collaborator.unit : null,
        })
      : Promise.resolve({ data: [], error: null }),
    // Sprint 22.38 — Listas pessoais ativas do user (mercado/viagem/remédios/geral).
    // Bloco gated em buildContext: só renderiza listas com pendentes.
    supabase.from('personal_checklists')
      .select('id, name, list_type, personal_checklist_items(id, description, is_done, sort_order)')
      .eq('owner_collab_id', id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20),
    // Sprint 22.47 — checklists da equipe hoje (só liderança). Mostra quem tem
    // pendente pra TOM responder "quem tem checklist pendente hoje?".
    isLeadership
      ? supabase.from('op_checklist_completions')
          .select('id, completed_at, collaborator_id, collaborators(full_name), op_checklists(name, unit), op_checklist_item_completions(is_checked)')
          .eq('reference_date', today)
          .order('collaborator_id')
          .limit(80)
      : Promise.resolve({ data: [], error: null }),
    // Sprint 22.48 — templates ATIVOS (independente de completions). Permite
    // TOM responder "quem tem checklist pendente hoje?" mesmo quando o
    // dispatcher não rodou (ou está quebrado). Filtragem por days_of_week
    // contendo o dow atual acontece em buildContext.
    isLeadership
      ? supabase.from('op_checklists')
          .select('id, name, function_role, shift, unit, days_of_week, dispatch_time')
          .eq('is_active', true)
      : Promise.resolve({ data: [], error: null }),
    // Sprint Agenda v2 — eventos institucionais dos próximos 30 dias.
    // Visível pra TODOS os colaboradores (resolve dor da Barra). Skill `agenda-escolar.md`
    // usa pra responder "o que vai acontecer esse mês?", "tem evento na semana?", etc.
    (() => {
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 30);
      const horizonYmd = horizon.toISOString().slice(0, 10);
      return supabase.from('school_events')
        .select('id, title, event_type, event_date, end_date, start_time, is_all_day, units, unit, location, description, status')
        .eq('status', 'active')
        .gte('event_date', today)
        .lte('event_date', horizonYmd)
        .order('event_date', { ascending: true })
        .limit(40);
    })(),
    // Tipos com emoji/cor pra renderização do bloco.
    supabase.from('event_types').select('id, label, emoji').order('sort_order'),
    // Histórico: eventos dos últimos 7 dias (exceto hoje) para TOM responder sobre o passado.
    // Inclui owned + invited (mesma lógica do bloco de próximos eventos).
    (async () => {
      const COLS = 'id, title, start_at, end_at, modality, context, location_text, status';
      const lo = `${past7days}T00:00:00-03:00`;
      const hi = `${today}T00:00:00-03:00`;
      const [own, parts] = await Promise.all([
        supabase.from('events').select(COLS)
          .eq('collaborator_id', id).gte('start_at', lo).lt('start_at', hi)
          .neq('status', 'cancelled').order('start_at', { ascending: false }).limit(15),
        supabase.from('event_participants')
          .select(`event:events(${COLS})`)
          .eq('collaborator_id', id).neq('status', 'declined'),
      ]);
      const map = new Map();
      for (const e of (own.data || [])) map.set(e.id, e);
      for (const p of (parts.data || [])) {
        const e = p.event;
        if (!e || map.has(e.id)) continue;
        if (e.status === 'cancelled') continue;
        const t = new Date(e.start_at).getTime();
        if (t >= new Date(lo).getTime() && t < new Date(hi).getTime()) map.set(e.id, e);
      }
      const merged = [...map.values()].sort((a, b) => String(b.start_at).localeCompare(String(a.start_at))).slice(0, 15);
      return { data: merged, error: own.error || parts.error };
    })(),
    // Tarefas concluídas nos últimos 7 dias.
    supabase.from('tasks')
      .select('id, title, context, completed_at, due_date')
      .eq('assigned_to', id)
      .eq('status', 'done')
      .gte('completed_at', `${past7days}T00:00:00-03:00`)
      .order('completed_at', { ascending: false }).limit(20),
    // Hábitos dos últimos 7 dias.
    supabase.from('habit_logs')
      .select('log_date, is_completed, habits(name, icon)')
      .eq('collaborator_id', id)
      .gte('log_date', past7days)
      .order('log_date', { ascending: false }).limit(30),
    // Tarefas delegadas concluídas nos últimos 7 dias (criadas por este user pra outros).
    supabase.from('tasks')
      .select('id, title, context, completed_at, assignee:collaborators!tasks_assigned_to_fkey(full_name)')
      .eq('created_by', id).neq('assigned_to', id)
      .eq('status', 'done')
      .gte('completed_at', `${past7days}T00:00:00-03:00`)
      .order('completed_at', { ascending: false }).limit(15),
    // Hierarquia explícita — org chart para liderança responder "quem responde pra quem?".
    isLeadership
      ? supabase.from('collaborators')
          .select('id, full_name, unit, role, manager:collaborators!supervisor_id(id, full_name)')
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [], error: null }),
    // Memórias críticas (todas, sem limite — são raras)
    supabase.from('collaborator_memory')
      .select('id, memory_type, content, importance, created_at')
      .eq('collaborator_id', id).eq('is_active', true)
      .eq('importance', 'critical')
      .order('created_at', { ascending: false }),
    // Preferences (top 5 mais recentes)
    supabase.from('collaborator_memory')
      .select('id, memory_type, content, importance, created_at')
      .eq('collaborator_id', id).eq('is_active', true)
      .eq('memory_type', 'preference')
      .order('created_at', { ascending: false }).limit(5),
    // Weekly summary (último, se existir)
    supabase.from('collaborator_weekly_summaries')
      .select('summary, week_start')
      .eq('collaborator_id', id)
      .order('week_start', { ascending: false }).limit(1).maybeSingle(),
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
  const workRaw = workRes.data || [];

  // Fix (2026-05-15): tasks done com due_date >= hoje — permite TOM responder
  // "o que eu tinha pra amanhã?" mesmo após marcar como feito.
  // Guardado em campo separado para não ser cortado pelo slice(0,8) do renderTaskList.
  let doneFutureTasks = [];
  try {
    const { data: doneFuture } = await supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id)
      .eq('status', 'done')
      .gte('due_date', today)
      .lte('due_date', next7days)
      .order('due_date', { ascending: true })
      .limit(15);
    doneFutureTasks = doneFuture || [];
  } catch (_) { /* não bloqueia se falhar */ }

  // Sprint 22.X — respeita max_daily_tasks (default 3) limitando o briefing de
  // trabalho. Hoje sem cap, TOM lista 12+ tasks e quebra o foco. User-side a
  // pref já existia mas nada limitava. Preferência default 3 reflete princípio
  // "1-3 prioridades por dia" do framework.
  const maxDaily = (prefsRes.data && Number.isInteger(prefsRes.data.max_daily_tasks))
    ? prefsRes.data.max_daily_tasks
    : 3;
  const workTasks = workRaw.slice(0, Math.max(1, Math.min(20, maxDaily)));

  const ctx = {
    profile: profileRes.data || null,
    criticalMemories: critRes.data || [],
    preferenceMemories: prefRes.data || [],
    weeklySummary: weeklyRes.data || null,
    recentContextMemories: [], // populado depois pelo semantic search
    prefs: prefsRes.data || null,
    todayTasks: { personal: personalTasks, work: workTasks },
    personalTasks,
    workTasks,
    doneFutureTasks,
    activeProjects,
    notifications: notificationsRes.data || [],
    recentMessages: (historyRes.data || []).reverse(),
    habits: habitsRes.data || [],
    todayEvents: eventsRes.data || [],
    pastEvents: pastEventsRes.data || [],
    pastTasks: pastTasksRes.data || [],
    pastHabitLogs: pastHabitLogsRes.data || [],
    pastDelegated: pastDelegatedRes.data || [],
    orgChart: orgChartRes.data || [],
    delegatedTasks: delegatedRes.data || [],
    todayChecklists: todayChecklistsRes.data || [],
    teamAdherence: teamAdherenceRes.data || [],
    personalChecklists: personalChecklistsRes.data || [],
    teamTodayChecklists: teamTodayChecklistsRes.data || [],
    teamExpectedTemplates: (() => {
      const all = teamExpectedTemplatesRes.data || [];
      // dow: 1=Mon … 6=Sat, 7=Sun (consistente com dispatcher.js)
      const jsDow = new Date(today + 'T15:00:00.000Z').getUTCDay();
      const dow = jsDow === 0 ? 7 : jsDow;
      return all.filter(t => Array.isArray(t.days_of_week) && t.days_of_week.includes(dow));
    })(),
    schoolEvents: schoolEventsRes.data || [],
    eventTypes: eventTypesRes.data || [],
    todayDate: today,
  };
  // Sprint 23.5+ — médio prazo: resumo da semana passada (fail-silent)
  try {
    const { data: weeklySummary } = await supabase
      .from('collaborator_weekly_summaries')
      .select('summary, week_start')
      .eq('collaborator_id', id)
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (weeklySummary?.summary) ctx.weeklySummary = weeklySummary;
  } catch (_) {}
  return ctx;
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

      // Sprint 22.22r-s — Runbook T-minus (so pra projetos category=event)
      if (p.category === 'event') {
        const { data: pTimes } = await supabase
          .from('projects')
          .select('event_date, event_start_time')
          .eq('id', p.id)
          .single();
        const { data: runbookBlocks } = await supabase
          .from('event_runbook_blocks')
          .select('id, label, offset_minutes, position')
          .eq('project_id', p.id)
          .order('position', { ascending: true })
          .order('offset_minutes', { ascending: true });
        if (runbookBlocks && runbookBlocks.length > 0) {
          const blockIds = runbookBlocks.map(b => b.id);
          const { data: runbookItems } = await supabase
            .from('event_runbook_items')
            .select('block_id, text, done')
            .in('block_id', blockIds);
          const itemsByBlock = new Map();
          for (const it of runbookItems || []) {
            if (!itemsByBlock.has(it.block_id)) itemsByBlock.set(it.block_id, []);
            itemsByBlock.get(it.block_id).push(it);
          }
          // Helper pra computar hora esperada
          function expectedTime(offsetMin) {
            if (!pTimes?.event_date || !pTimes?.event_start_time) return null;
            const [y, m, d] = pTimes.event_date.split('-').map(Number);
            const [hh, mm] = pTimes.event_start_time.split(':').map(Number);
            const base = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
            base.setMinutes(base.getMinutes() + offsetMin);
            const h = String(base.getHours()).padStart(2, '0');
            const mi = String(base.getMinutes()).padStart(2, '0');
            return `${h}:${mi}`;
          }
          lines.push(`\n**Runbook do Dia (${runbookBlocks.length} blocos):**`);
          if (pTimes?.event_start_time) {
            lines.push(`Abertura: ${pTimes.event_start_time.slice(0, 5)}${pTimes.event_date ? ` em ${pTimes.event_date}` : ''}`);
          }
          for (const b of runbookBlocks) {
            const its = itemsByBlock.get(b.id) || [];
            const doneCount = its.filter(i => i.done).length;
            const offsetLabel = b.offset_minutes === 0
              ? 'ABERTURA'
              : b.offset_minutes < 0
                ? `${Math.abs(b.offset_minutes)}min antes`
                : `${b.offset_minutes}min depois`;
            const expected = expectedTime(b.offset_minutes);
            const timeBit = expected ? ` · ${expected}` : '';
            lines.push(`- [${offsetLabel}${timeBit}] ${b.label} — ${doneCount}/${its.length} itens`);
            for (const it of its) {
              lines.push(`    ${it.done ? '✓' : '☐'} ${it.text}`);
            }
          }
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

// Extrai Y/M/D em BRT via Intl.DateTimeFormat.formatToParts. Não dá pra
// re-parsear toLocaleString: Node 20 + ICU 78 retorna "YYYY-MM-DD, h:mm:ss p.m.",
// formato não-parseável por new Date() → RangeError "Invalid time value".
function _brtParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return {
    y: parts.find(p => p.type === 'year').value,
    m: parts.find(p => p.type === 'month').value,
    d: parts.find(p => p.type === 'day').value,
  };
}

// Retorna YMD (YYYY-MM-DD) de hoje em BRT.
function brtYmd(offsetDays = 0) {
  const { y, m, d: dd } = _brtParts();
  if (offsetDays === 0) return `${y}-${m}-${dd}`;
  const d = new Date(`${y}-${m}-${dd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Retorna o primeiro e último dia do mês BRT relativo ao offset de meses.
function brtMonthRange(monthOffset = 0) {
  const { y, m } = _brtParts();
  const year = parseInt(y, 10);
  const monthIdx = parseInt(m, 10) - 1 + monthOffset;
  const from = new Date(Date.UTC(year, monthIdx, 1, 12));
  const to = new Date(Date.UTC(year, monthIdx + 1, 0, 12));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    label: from.toLocaleString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }),
  };
}

// Retorna stats de tasks e eventos para um período YMD.
async function fetchPeriodStats(collabId, fromYmd, toYmd) {
  const [tasksRes, eventsRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, status')
      .eq('assigned_to', collabId)
      .eq('context', 'work')
      .gte('due_date', fromYmd)
      .lte('due_date', toYmd),
    supabase
      .from('events')
      .select('id, status')
      .eq('collaborator_id', collabId)
      .eq('context', 'work')
      .gte('start_at', `${fromYmd}T00:00:00-03:00`)
      .lte('start_at', `${toYmd}T23:59:59-03:00`),
  ]);
  const tasks = tasksRes.data || [];
  const events = eventsRes.data || [];
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const pending = tasks.filter(t => !['done', 'cancelled'].includes(t.status)).length;
  const cancelled = tasks.filter(t => t.status === 'cancelled').length;
  const pct = total ? Math.round((done / total) * 100) : null;
  return { total, done, pending, cancelled, pct, events: events.length };
}

// Busca stats completos (todas contexts) para bloco de contexto mensal.
// Diferença de fetchPeriodStats: sem filtro context='work', inclui habit_logs e op_checklist_completions.
async function fetchMonthlyStats(collabId, from, to) {
  const [tasksRes, eventsRes, habitsRes, checklistsRes] = await Promise.all([
    supabase.from('tasks')
      .select('id, status')
      .eq('assigned_to', collabId)
      .gte('due_date', from)
      .lte('due_date', to),
    supabase.from('events')
      .select('id')
      .eq('collaborator_id', collabId)
      .gte('start_at', `${from}T00:00:00-03:00`)
      .lte('start_at', `${to}T23:59:59-03:00`)
      .neq('status', 'cancelled'),
    supabase.from('habit_logs')
      .select('id, is_completed')
      .eq('collaborator_id', collabId)
      .gte('log_date', from)
      .lte('log_date', to),
    supabase.from('op_checklist_completions')
      .select('id, completed_at')
      .eq('collaborator_id', collabId)
      .gte('reference_date', from)
      .lte('reference_date', to),
  ]);
  const tasks = tasksRes.data || [];
  const events = eventsRes.data || [];
  const habits = habitsRes.data || [];
  const checklists = checklistsRes.data || [];
  return {
    tasks: {
      total: tasks.length,
      done: tasks.filter(t => t.status === 'done').length,
      pending: tasks.filter(t => !['done', 'cancelled'].includes(t.status)).length,
      cancelled: tasks.filter(t => t.status === 'cancelled').length,
    },
    events: events.length,
    habits: {
      total: habits.length,
      done: habits.filter(h => h.is_completed).length,
    },
    checklists: {
      total: checklists.length,
      done: checklists.filter(c => c.completed_at !== null).length,
    },
  };
}

/**
 * Monta bloco compacto de stats do mês atual + comparativo com mês anterior.
 * Ativado por keyword ou nos últimos 7 dias do mês.
 * Retorna string formatada ou null em caso de erro.
 */
async function buildMonthlyContextBlock(collabId) {
  try {
    const cur  = brtMonthRange(0);
    const prev = brtMonthRange(-1);
    const today = brtYmd();
    // Se ainda estamos dentro do mês, vai só até hoje; se mês virou, vai ao fim.
    const toDate = today <= cur.to ? today : cur.to;

    const [curStats, prevStats] = await Promise.all([
      fetchMonthlyStats(collabId, cur.from, toDate),
      fetchMonthlyStats(collabId, prev.from, prev.to),
    ]);

    const dayNow    = parseInt(toDate.slice(8), 10);
    const totalDays = parseInt(cur.to.slice(8), 10);
    const dayLabel  = today < cur.to ? `1–${dayNow} de ${totalDays}` : `1–${totalDays}`;

    const lines = [`📅 *${cur.label} (${dayLabel}):*`];

    if (curStats.tasks.total > 0) {
      const pct = Math.round((curStats.tasks.done / curStats.tasks.total) * 100);
      lines.push(
        `• Tarefas: ${curStats.tasks.done} ✅ | ${curStats.tasks.pending} ⏳` +
        (curStats.tasks.cancelled ? ` | ${curStats.tasks.cancelled} canceladas` : '') +
        ` (${pct}% concluído)`
      );
    }

    if (curStats.events > 0) {
      lines.push(`• Compromissos: ${curStats.events} no mês`);
    }

    if (curStats.habits.total > 0) {
      const pct = Math.round((curStats.habits.done / curStats.habits.total) * 100);
      lines.push(`• Hábitos: ${curStats.habits.done}/${curStats.habits.total} registros (${pct}%)`);
    }

    if (curStats.checklists.total > 0) {
      const pct = Math.round((curStats.checklists.done / curStats.checklists.total) * 100);
      lines.push(`• Checklists: ${curStats.checklists.done}/${curStats.checklists.total} cumpridos (${pct}%)`);
    }

    // Comparativos: só se mês anterior tem dados mínimos (≥ 3 itens por categoria).
    const comparatives = [];
    if (prevStats.tasks.total >= 3) {
      const diff = curStats.tasks.done - prevStats.tasks.done;
      comparatives.push(`tarefas ${diff >= 0 ? '+' : ''}${diff}`);
    }
    if (prevStats.habits.total >= 3) {
      const diff = curStats.habits.done - prevStats.habits.done;
      comparatives.push(`hábitos ${diff >= 0 ? '+' : ''}${diff} registros`);
    }
    if (prevStats.checklists.total >= 3 && curStats.checklists.total > 0) {
      const curPct  = Math.round((curStats.checklists.done  / curStats.checklists.total)  * 100);
      const prevPct = Math.round((prevStats.checklists.done / prevStats.checklists.total) * 100);
      const diff = curPct - prevPct;
      comparatives.push(`checklists ${diff >= 0 ? '+' : ''}${diff}%`);
    }

    if (comparatives.length > 0) {
      lines.push(`📊 vs ${prev.label}: ${comparatives.join(' | ')}`);
    }

    // Bloco semanal: semana atual (últimos 7 dias) vs semana anterior (8-14d atrás)
    const weekFrom   = brtYmd(-6);  // hoje incluso = 7 dias
    const weekTo     = brtYmd(0);
    const prevWkFrom = brtYmd(-13);
    const prevWkTo   = brtYmd(-7);

    let curWk, prevWk;
    try {
      [curWk, prevWk] = await Promise.all([
        fetchMonthlyStats(collabId, weekFrom, weekTo),
        fetchMonthlyStats(collabId, prevWkFrom, prevWkTo),
      ]);
    } catch (_) { curWk = prevWk = null; }

    if (curWk) {
      lines.push('', `📅 *Esta semana (${weekFrom.slice(8)}/${weekFrom.slice(5,7)}–${weekTo.slice(8)}/${weekTo.slice(5,7)}):*`);
      const wkPct = curWk.tasks.total > 0 ? Math.round((curWk.tasks.done / curWk.tasks.total) * 100) : null;
      if (curWk.tasks.total > 0) {
        lines.push(`• Tarefas: ${curWk.tasks.done} ✅ | ${curWk.tasks.pending} ⏳` +
          (wkPct !== null ? ` (${wkPct}%)` : ''));
      }
      if (curWk.habits.total > 0) {
        lines.push(`• Hábitos: ${curWk.habits.done}/${curWk.habits.total} registros`);
      }
      if (curWk.checklists.total > 0) {
        lines.push(`• Checklists: ${curWk.checklists.done}/${curWk.checklists.total} cumpridos`);
      }
      if (curWk.events > 0) {
        lines.push(`• Compromissos: ${curWk.events}`);
      }

      // Comparativo semana atual vs semana anterior, com alerta automático
      if (prevWk && (prevWk.tasks.total >= 3 || prevWk.habits.total >= 3 || prevWk.checklists.total >= 3)) {
        const wkComps = [];

        // Helper de alerta (>=20% diferença)
        const flag = (cur, prev) => {
          if (prev === 0) return '';
          const delta = ((cur - prev) / prev) * 100;
          if (delta <= -20) return ' 📉 atenção';
          if (delta >= 20)  return ' 🚀';
          return '';
        };

        if (prevWk.tasks.total >= 3) {
          const diff = curWk.tasks.done - prevWk.tasks.done;
          const sign = diff >= 0 ? '+' : '';
          wkComps.push(`tarefas ${sign}${diff}${flag(curWk.tasks.done, prevWk.tasks.done)}`);
        }
        if (prevWk.habits.total >= 3) {
          const diff = curWk.habits.done - prevWk.habits.done;
          const sign = diff >= 0 ? '+' : '';
          wkComps.push(`hábitos ${sign}${diff} registros${flag(curWk.habits.done, prevWk.habits.done)}`);
        }
        if (prevWk.checklists.total >= 3 && curWk.checklists.total > 0) {
          const curPct  = Math.round((curWk.checklists.done  / curWk.checklists.total)  * 100);
          const prevPct = Math.round((prevWk.checklists.done / prevWk.checklists.total) * 100);
          const diff = curPct - prevPct;
          const sign = diff >= 0 ? '+' : '';
          wkComps.push(`checklists ${sign}${diff}%${flag(curWk.checklists.done, prevWk.checklists.done)}`);
        }

        if (wkComps.length > 0) {
          lines.push(`📊 vs semana passada: ${wkComps.join(' | ')}`);
        }
      }
    }

    return lines.join('\n');
  } catch (err) {
    console.warn('[Prompt] buildMonthlyContextBlock err:', err.message);
    return null;
  }
}

/**
 * Constrói bloco de contexto histórico para TOM consumir em rituais de fechamento/planejamento.
 * Só é chamado quando ritual_type indica que o histórico é relevante — não em toda mensagem.
 */
async function buildHistoricalContext(collabId, ritualType) {
  try {
    const today = brtYmd();
    const lines = ['', '---', '', '## 📊 Desempenho histórico (contexto para este ritual)'];

    // Dia: fechamento diário e fechamento mensal
    const needsDay = ['fechamento', 'daily_closing', 'fechamento_mensal'].includes(ritualType);
    // Semana: fechamento + planejamento semanal
    const needsWeek = ['fechamento', 'daily_closing', 'planejamento_semanal', 'weekly_planning'].includes(ritualType);
    // Mês atual: planejamento semanal + fechamento/planejamento mensal
    const needsMonth = ['planejamento_semanal', 'weekly_planning', 'fechamento_mensal', 'planejamento_mensal'].includes(ritualType);
    // Mês anterior: planejamento mensal + fechamento mensal
    const needsPrevMonth = ['fechamento_mensal', 'planejamento_mensal'].includes(ritualType);

    if (needsDay) {
      const s = await fetchPeriodStats(collabId, today, today);
      lines.push('', `**Hoje (${today.slice(8, 10)}/${today.slice(5, 7)}):**`);
      if (s.total === 0 && s.events === 0) {
        lines.push('  Sem tarefas ou compromissos registrados no dia.');
      } else {
        if (s.total > 0) lines.push(`  Tarefas: ${s.done}/${s.total} concluídas${s.pct !== null ? ` (${s.pct}%)` : ''} · ${s.pending} pendentes${s.cancelled ? ` · ${s.cancelled} canceladas` : ''}`);
        if (s.events > 0) lines.push(`  Compromissos: ${s.events}`);
      }
    }

    if (needsWeek) {
      // Semana = últimos 7 dias incluindo hoje
      const weekFrom = brtYmd(-6);
      const s = await fetchPeriodStats(collabId, weekFrom, today);
      const weekLabel = `${weekFrom.slice(8, 10)}/${weekFrom.slice(5, 7)} – ${today.slice(8, 10)}/${today.slice(5, 7)}`;
      lines.push('', `**Semana (${weekLabel}):**`);
      if (s.total === 0 && s.events === 0) {
        lines.push('  Sem tarefas ou compromissos na semana.');
      } else {
        if (s.total > 0) lines.push(`  Tarefas: ${s.done}/${s.total} concluídas${s.pct !== null ? ` (${s.pct}%)` : ''} · ${s.pending} pendentes`);
        if (s.events > 0) lines.push(`  Compromissos: ${s.events}`);
      }
    }

    if (needsMonth) {
      const cur = brtMonthRange(0);
      const s = await fetchPeriodStats(collabId, cur.from, today); // até hoje (mês em curso)
      lines.push('', `**Mês atual (${cur.label}, até hoje):**`);
      if (s.total === 0 && s.events === 0) {
        lines.push('  Sem registros no mês até agora.');
      } else {
        if (s.total > 0) lines.push(`  Tarefas: ${s.done}/${s.total} concluídas${s.pct !== null ? ` (${s.pct}%)` : ''} · ${s.pending} pendentes${s.cancelled ? ` · ${s.cancelled} canceladas` : ''}`);
        if (s.events > 0) lines.push(`  Compromissos: ${s.events}`);
      }
    }

    if (needsPrevMonth) {
      const prev = brtMonthRange(-1);
      const s = await fetchPeriodStats(collabId, prev.from, prev.to);
      lines.push('', `**Mês anterior (${prev.label}):**`);
      if (s.total === 0 && s.events === 0) {
        lines.push('  Sem registros no mês anterior.');
      } else {
        if (s.total > 0) lines.push(`  Tarefas: ${s.done}/${s.total} concluídas${s.pct !== null ? ` (${s.pct}%)` : ''} · ${s.pending} pendentes${s.cancelled ? ` · ${s.cancelled} canceladas` : ''}`);
        if (s.events > 0) lines.push(`  Compromissos: ${s.events}`);
      }
    }

    lines.push('', '> Use esses dados ao fechar o dia/semana/mês ou ao planejar o próximo período. Cite os números, reconheça conquistas e aponte onde melhorar.', '');
    return lines.join('\n');
  } catch (err) {
    console.warn('[Prompt] buildHistoricalContext err:', err.message);
    return '';
  }
}

async function buildSystemPrompt(collaborator, opts = {}) {
  const lastUserMessage = opts.lastUserMessage || '';
  // Janela Temporal Mensal: ativa por keyword ou nos últimos 7 dias do mês.
  const _monthlyKeywordRe = /\b(esse\s+m[eê]s|este\s+m[eê]s|no\s+m[eê]s|do\s+m[eê]s|m[eê]s\s+atual|m[eê]s\s+passado|ao\s+longo\s+do\s+m[eê]s|mensal|balan[çc]o|resumo\s+do\s+m[eê]s|como\s+(?:foi|est[áa]|fui|estou)\s+(?:esse|este|o)\s+m[eê]s|o\s+que\s+fiz\s+esse\s+m[eê]s|produtividade|meta\s+do\s+m[eê]s)\b/i;
  const _todayForMonth = brtYmd();
  const _dayOfMonth = parseInt(_todayForMonth.slice(8), 10);
  const _daysInMonth = new Date(parseInt(_todayForMonth.slice(0, 4)), parseInt(_todayForMonth.slice(5, 7)), 0).getDate();
  const _isEndOfMonth = _dayOfMonth >= (_daysInMonth - 6);
  const _includeMonthly = _monthlyKeywordRe.test(lastUserMessage) || _isEndOfMonth;
  let monthlyCtxBlock = null;
  if (_includeMonthly && collaborator) {
    monthlyCtxBlock = await buildMonthlyContextBlock(collaborator.id);
  }
  const ctx = await fetchCollaboratorContext(collaborator);

  // Busca semântica para "Contexto recente" — top 5 que não sejam crítico nem preference.
  if (lastUserMessage && process.env.OPENAI_API_KEY) {
    try {
      const { getEmbedding } = require('../services/embeddings');
      const embedding = await getEmbedding(lastUserMessage);
      const { data: semanticMems } = await supabase.rpc('match_memories', {
        p_collaborator_id: collaborator.id,
        p_embedding: embedding,
        p_match_count: 15,
        p_threshold: 0.6,
      });
      const usedIds = new Set([
        ...(ctx.criticalMemories || []).map(m => m.id),
        ...(ctx.preferenceMemories || []).map(m => m.id),
      ]);
      ctx.recentContextMemories = (semanticMems || [])
        .filter(m => !usedIds.has(m.id) && m.importance !== 'critical' && m.memory_type !== 'preference')
        .slice(0, 5);
    } catch (err) {
      console.warn('[Prompt] semantic search err:', err.message);
    }
  }

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

  // Organograma — injetado quando skill de governança ativa OU keyword de hierarquia.
  const _orgChartKeywordRe = /\b(organograma|quem\s+(?:é|cuida|coordena|reporta|escala|delega)|quem\s+(?:é\s+)?o?\s*(?:respons[áa]vel|gerente|coordenador|l[íi]der|supervisor)|reporta\s+pra\s+quem|escalar?\s+(?:pra|para)\s+quem|delegar?\s+(?:pra|para)\s+quem|hierarquia)\b/i;
  const _governanceSkills = ['gerencia', 'pedagogico', 'coordenacao-conversacional'];
  const _injectOrganograma =
    (skill && _governanceSkills.includes(skill.name)) ||
    _orgChartKeywordRe.test(lastUserMessage);

  let organogramaBlock = '';
  if (_injectOrganograma) {
    const organograma = loadOrganograma();
    if (organograma) {
      organogramaBlock = `\n\n---\n\n# 🗺️ ORGANOGRAMA LA MUSIC (referência de governança)\n\n${organograma}\n\n---\n`;
    }
  }

  // Health check — injetado quando director pergunta sobre saúde do sistema.
  // Skill `auditoria-sistema` consome o bloco [HEALTH_CHECK_LAST_RUN].
  let healthCheckBlock = '';
  const _healthKeywordRe = /\b(sa[úu]de\s+do\s+sistema|auditoria|status\s+do\s+sistema|status\s+do\s+tom|health\s*check|algum\s+(?:problema|erro)|erros?\s+recorrentes?|como\s+t[áa]\s+o\s+tom)\b/i;
  if (collaborator && collaborator.role === 'director' && _healthKeywordRe.test(lastUserMessage)) {
    try {
      const supabaseClient = require('../supabase/client');
      const { data: runs } = await supabaseClient
        .from('health_check_runs')
        .select('ran_at, summary, checks, auto_fixes_applied')
        .order('ran_at', { ascending: false })
        .limit(1);
      if (runs && runs[0]) {
        const r = runs[0];
        healthCheckBlock = `\n\n---\n\n[HEALTH_CHECK_LAST_RUN]\nran_at: ${r.ran_at}\nsummary: ${JSON.stringify(r.summary)}\nchecks: ${JSON.stringify(r.checks)}\nauto_fixes_applied: ${JSON.stringify(r.auto_fixes_applied || [])}\n[/HEALTH_CHECK_LAST_RUN]\n`;
      }
    } catch (err) {
      console.warn('[Prompt] healthcheck inject err:', err.message);
    }
  }

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
  // Sprint 23.5 — criar-compromisso: sempre carregada para todos os roles.
  // Multi-turno crítico: respostas "1/2/3" após dup microconfirm precisam da skill no contexto.
  // Não duplica se já for PRIMARY.
  const criarCompromissoSkillBody = (skill && skill.name === 'criar-compromisso') ? '' : loadSkill('criar-compromisso');
  const criarCompromissoSkillBlock = criarCompromissoSkillBody
    ? `\n\n---\n\n# 📅 SKILL AUXILIAR: criar-compromisso\n\n${criarCompromissoSkillBody}`
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
  const baseCtx = buildContext(collaborator, ctx.prefs, tasksForCtx, ctx.activeProjects, lastMsgAge, habitsForCtx, eventsForCtx, ctx.delegatedTasks || [], ctx.todayChecklists || [], ctx.teamAdherence || [], ctx.personalChecklists || [], ctx.teamTodayChecklists || [], ctx.teamExpectedTemplates || [], ctx.schoolEvents || [], ctx.eventTypes || [], ctx.doneFutureTasks || [], monthlyCtxBlock, ctx.orgChart || [], ctx.criticalMemories || [], ctx.preferenceMemories || [], ctx.weeklySummary || null, ctx.recentContextMemories || []);

  // Histórico completo dos últimos 7 dias — agrupado por dia
  let pastEventsBlock = '';
  {
    const pastEvts      = ctx.pastEvents    || [];
    const pastTasks     = ctx.pastTasks     || [];
    const pastHabits    = ctx.pastHabitLogs || [];
    const pastDeleg     = ctx.pastDelegated || [];
    const brDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
    const fmtLabel = (ymd) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(ymd + 'T15:00:00Z'));
    const fmtHr  = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
    // Coleta todos os itens com chave de data
    const byDay = {}; // { 'YYYY-MM-DD': string[] }
    const push = (ymd, line) => { if (!byDay[ymd]) byDay[ymd] = []; byDay[ymd].push(line); };
    pastEvts.forEach(e => {
      const mod = e.modality === 'online' ? '💻' : '🏢';
      push(brDate(e.start_at), `  ${mod} ${fmtHr(e.start_at)} ${e.title}`);
    });
    pastTasks.forEach(t => {
      const ymd = t.completed_at ? brDate(t.completed_at) : (t.due_date || '');
      if (ymd) push(ymd, `  ✅ ${t.title}`);
    });
    pastDeleg.forEach(t => {
      const ymd = t.completed_at ? brDate(t.completed_at) : '';
      const who = t.assignee?.full_name ? ` → ${t.assignee.full_name}` : '';
      if (ymd) push(ymd, `  👥 ${t.title}${who} (delegada)`);
    });
    pastHabits.forEach(h => {
      const icon = h.habits?.icon || '🔁';
      const name = h.habits?.name || '';
      const done = h.is_completed ? '✓' : '✗';
      push(h.log_date, `  ${icon} ${name} ${done}`);
    });
    const days = Object.keys(byDay).sort().reverse();
    if (days.length > 0) {
      const lines = ['\n\n**📅 Histórico — últimos 7 dias:**'];
      days.forEach(ymd => {
        lines.push(`\n*${fmtLabel(ymd)}*`);
        byDay[ymd].forEach(l => lines.push(l));
      });
      pastEventsBlock = lines.join('\n');
    }
  }

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

  const ctxBlock = (pending ? baseCtx + '\n' + pending : baseCtx) + pastEventsBlock + resolutionBlock + activeThreadBlock;

  const blocks = [
    BLOCK_RULES,
    BLOCK_IDENTITY,
    ctxBlock,
    organogramaBlock,
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

  // Sprint 22.X — Configurar Preferências (todos os roles).
  // Skill ensina TOM a emitir <<PREFS_UPDATE>> quando user pede mudança em
  // briefing time, intensidade, notificações, DND, etc.
  if (collaborator) {
    const prefsPath = path.join(SKILLS_DIR, 'configurar-preferencias.md');
    if (fs.existsSync(prefsPath)) {
      const prefsSkill = fs.readFileSync(prefsPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + prefsSkill;
    }
  }

  // Sprint 15 → 23.13 — Operações Técnicas: liderança OU quem tem function_role='ops_tecnicas'
  // (ex: Rafinha — é literalmente o cara das ops técnicas, precisa da skill completa).
  const isOpsRole = collaborator && (
    ['manager', 'coordinator', 'director'].includes(collaborator.role) ||
    collaborator.function_role === 'ops_tecnicas'
  );
  if (isOpsRole) {
    const operacoesPath = path.join(SKILLS_DIR, 'operacoes-tecnicas.md');
    if (fs.existsSync(operacoesPath)) {
      systemPrompt += '\n\n---\n\n' + fs.readFileSync(operacoesPath, 'utf-8');
    }
  }

  // Sprint 15 → 23.13 — Marketing: Yuri (manager+unit=all) OU qualquer function_role='marketing'
  // (ex: John — collaborator de marketing, precisa da skill mesmo sem ser gerente).
  const isMarketingRole = collaborator && (
    (collaborator.role === 'manager' && collaborator.unit === 'all') ||
    collaborator.function_role === 'marketing'
  );
  if (isMarketingRole) {
    const marketingPath = path.join(SKILLS_DIR, 'marketing.md');
    if (fs.existsSync(marketingPath)) {
      systemPrompt += '\n\n---\n\n' + fs.readFileSync(marketingPath, 'utf-8');
    }
  }

  // Sprint 16 → 23.13 → 23.15 — Coordenação Conversacional:
  // Carrega sob 2 condições:
  //   (a) COORD_HINT ativo → recipient tem recados pendentes, precisa da skill
  //       pra emitir COORDINATION_RESPONSE corretamente
  //   (b) lastUserMessage casa com keywords de relay/followup → user tá pedindo
  // Sem essas condições, NÃO carrega (economiza ~10KB de prompt, reduz latência).
  // Resultado: mensagens triviais ficam ágeis; relay continua disponível quando
  // o user pede explicitamente. RLS no banco já protege INSERT.
  const COORD_KEYWORDS_RE = /\b(manda|mande|mandar|envia|envie|enviar|avisa|avise|avisar|fala\s+com|falar\s+com|fale\s+com|cobra|cobre|cobrar|cobrança|cobrar?\s+(?:o|a|os|as)|pergunta\s+(?:pro|pra|para|ao|à)|perguntar?\s+(?:pro|pra|para|ao|à)|passa\s+pro|passar?\s+pro|transmite|transmita|transmitir|encaminha|encaminhe|encaminhar|comunica|comunique|comunicar|recado|repassa|repasse|repassar|relay)\b/i;
  const hasCoordHint = !!(ctx && ctx.coordHint);
  const hasCoordIntent = lastUserMessage && COORD_KEYWORDS_RE.test(lastUserMessage);
  if (collaborator && (hasCoordHint || hasCoordIntent)) {
    const coordPath = path.join(SKILLS_DIR, 'coordenacao-conversacional.md');
    if (fs.existsSync(coordPath)) {
      systemPrompt += '\n\n---\n\n' + fs.readFileSync(coordPath, 'utf-8');
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

  // Sprint 23.5 — criar-compromisso sempre carregada (multi-turno crítico, não condicional)
  if (criarCompromissoSkillBlock) {
    systemPrompt += criarCompromissoSkillBlock;
  }

  // Sprint 19 → 23.13 — pedagogico: liderança OU quem tem function_role='pedagogico'
  // (mentores/assistentes que dão aula — Peterson, Jordan, Kinho, Dai, Renan, Leo,
  // Ramon, Rodrigo, Matheus Felipe). Sem isso TOM improvisa em conversas sobre alunos.
  const isPedagogicoRole = collaborator && (
    ['coordinator', 'director'].includes(collaborator.role) ||
    collaborator.function_role === 'pedagogico'
  );
  if (pedagogicoSkillBlock && isPedagogicoRole) {
    systemPrompt += pedagogicoSkillBlock;
  }

  // Sprint 18 — hygiene context injection (briefing matinal com findings de higiene)
  if (ctx && ctx.integrityHygiene) {
    systemPrompt += '\n\n[INTEGRITY_HYGIENE_CONTEXT]\n' + ctx.integrityHygiene;
  }

  // Sprint 23.5+ — perfil comportamental do colaborador (quando preenchido)
  if (ctx.profile) {
    const p = ctx.profile;
    const profileLines = [];

    // Helper: strengths/growth_areas podem vir como string OU array
    const formatArrayOrString = (v) => Array.isArray(v) ? v.join(', ') : String(v);

    // === Profile expandido — todos os 11 campos comportamentais ===
    if (p.maturity_level && p.maturity_level !== 'beginner') {
      profileLines.push(`- Maturidade: ${p.maturity_level}`);
    }
    if (p.communication_style)    profileLines.push(`- Comunicação: ${p.communication_style}`);
    if (p.response_pattern)       profileLines.push(`- Padrão de resposta: ${p.response_pattern}`);
    if (p.vocabulary_notes)       profileLines.push(`- Vocabulário: ${p.vocabulary_notes}`);
    if (p.best_coaching_approach) profileLines.push(`- Como coaching: ${p.best_coaching_approach}`);
    if (p.strengths)              profileLines.push(`- Pontos fortes: ${formatArrayOrString(p.strengths)}`);
    if (p.growth_areas)           profileLines.push(`- A desenvolver: ${formatArrayOrString(p.growth_areas)}`);
    if (p.personal_context)       profileLines.push(`- Contexto pessoal: ${p.personal_context}`);
    if (p.profile_notes)          profileLines.push(`- Observações: ${p.profile_notes}`);

    // Métricas — úteis pro TOM calibrar tom de cobrança
    const metrics = [];
    if (p.total_interactions != null && p.total_interactions > 0) {
      metrics.push(`${p.total_interactions} interações totais`);
    }
    if (p.completion_rate_30d != null) {
      metrics.push(`${Number(p.completion_rate_30d).toFixed(0)}% conclusão (30d)`);
    }
    if (metrics.length > 0) {
      profileLines.push(`- Engajamento: ${metrics.join(' · ')}`);
    }

    if (profileLines.length > 0) {
      systemPrompt += `\n\n---\n\n## Como ${collaborator.full_name.split(' ')[0]} funciona\n${profileLines.join('\n')}`;
    }
  }

  // Sprint 23.5+ — médio prazo: resumo da semana passada (quando disponível)
  if (ctx.weeklySummary) {
    const ws = ctx.weeklySummary;
    systemPrompt += `\n\n---\n\n📋 **Semana passada (${ws.week_start}):**\n${ws.summary}`;
  }

  // Histórico de desempenho — injetado apenas nos rituais que precisam de contexto histórico.
  // Fechamento (dia+semana), planejamento semanal (semana+mês), fechamento/planejamento mensal (mês+mês anterior).
  const HISTORICAL_RITUALS = ['fechamento', 'daily_closing', 'planejamento_semanal', 'weekly_planning', 'fechamento_mensal', 'planejamento_mensal'];
  if (collaborator && collaborator.id && rt && HISTORICAL_RITUALS.includes(rt)) {
    const historicalBlock = await buildHistoricalContext(collaborator.id, rt);
    if (historicalBlock) {
      systemPrompt += historicalBlock;
    }
  }

  // LA EDUCA — só injeta resumo quando a skill está ativa e o role permite
  if ((collaborator?.role === 'coordinator' || collaborator?.role === 'director') && skill?.name === 'la-educa') {
    try {
      const supabaseClient = require('../supabase/client');

      // 1. Dados gerais (view la_educa_progresso)
      const { data: rows } = await supabaseClient
        .from('la_educa_progresso')
        .select('*')
        .order('unidade');
      const lista = rows || [];

      // G5 — detectar se user mencionou nome de estagiário
      const lowerMsg = (lastUserMessage || '').toLowerCase();
      const estagMencionado = lista.find(e => {
        if (!e.nome) return false;
        const partes = e.nome.toLowerCase().split(/\s+/);
        return partes.some(p => p.length >= 4 && lowerMsg.includes(p));
      });

      let blocoTexto = '';

      if (estagMencionado) {
        // ── Detalhe POR ESTAGIÁRIO mencionado (G5) ──
        const e = estagMencionado;

        // Buscar responsáveis por pilar deste estagiário
        const { data: resp } = await supabaseClient
          .from('la_educa_responsaveis_pilar')
          .select(`pilar_id, instrutor_id,
                   instrutor:collaborators!instrutor_id(full_name),
                   pilar:la_educa_pilares!pilar_id(codigo, nome)`)
          .eq('estagiario_id', e.id);

        // Breakdown por pilar via avaliações
        const { data: avals } = await supabaseClient
          .from('la_educa_avaliacoes')
          .select('pilar, ancorado')
          .eq('estagiario_id', e.id);

        const grouped = {};
        for (const a of (avals || [])) {
          const cod = a.pilar || '?';
          if (!grouped[cod]) grouped[cod] = { codigo: cod, total: 0, ancorados: 0 };
          grouped[cod].total += 1;
          if (a.ancorado) grouped[cod].ancorados += 1;
        }

        // Enriquecer com nome do pilar via responsáveis
        for (const r of (resp || [])) {
          const cod = r.pilar?.codigo;
          if (cod && grouped[cod]) {
            grouped[cod].nome = r.pilar?.nome || cod;
          }
        }

        const pilaresLinhas = Object.values(grouped)
          .sort((a, b) => a.codigo.localeCompare(b.codigo))
          .map(p => {
            const r = (resp || []).find(x => x.pilar?.codigo === p.codigo);
            const respNome = r ? (r.instrutor?.full_name || 'mentor') : 'mentor';
            return `${p.codigo.toUpperCase()} ${p.nome || p.codigo}: ${p.ancorados}/${p.total} (resp: ${respNome})`;
          }).join(' | ');

        const dias = e.ultima_atualizacao
          ? Math.floor((Date.now() - new Date(e.ultima_atualizacao).getTime()) / 86400000)
          : null;

        blocoTexto =
          `[LA_EDUCA_ESTAGIARIO]\n` +
          `Nome: ${e.nome}\n` +
          `Trilha: ${e.trilha_icone || ''} ${e.trilha_nome || '—'}\n` +
          `Unidade: ${e.unidade || '—'}\n` +
          `Mentor: ${e.mentor_nome || '—'}\n` +
          `Progresso: ${e.checkpoints_ancorados}/${e.checkpoints_total} (${Math.round(e.percentual || 0)}%)\n` +
          `Última atualização: ${dias !== null ? dias + 'd atrás' : 'nunca'}\n` +
          `Pilares: ${pilaresLinhas || '(sem avaliações)'}` +
          (e.certificado_emitido ? `\n🏆 Certificado Alfa emitido em ${(e.certificado_emitido_em || '').slice(0, 10)}` : '');

      } else {
        // ── Visão geral — sem cap de 3 (G10) ──
        const porUnidade = lista.reduce((acc, e) => {
          const u = e.unidade || '—';
          acc[u] = acc[u] || { count: 0, somaPct: 0 };
          acc[u].count += 1;
          acc[u].somaPct += Number(e.percentual || 0);
          return acc;
        }, {});
        const resumoUnidades = Object.entries(porUnidade)
          .map(([u, v]) => `${u}: ${v.count} ativos, ${Math.round(v.somaPct / v.count)}% médio`)
          .join(' | ');

        // Atrasados — lista COMPLETA, sem .slice(0, 3)
        const atrasados = lista
          .filter(e => {
            if (!e.ultima_atualizacao) return false;
            const d = Math.floor((Date.now() - new Date(e.ultima_atualizacao).getTime()) / 86400000);
            return d > 14 && Number(e.percentual) < 100;
          })
          .map(e => {
            const d = Math.floor((Date.now() - new Date(e.ultima_atualizacao).getTime()) / 86400000);
            return `${e.nome} (mentor: ${e.mentor_nome || '—'}, ${d}d)`;
          });

        const prontos = lista
          .filter(e => Number(e.percentual) === 100 && !e.certificado_emitido)
          .map(e => `${e.nome} (${e.unidade})`);

        // Certificados emitidos últimos 30 dias
        const limite30 = new Date(Date.now() - 30 * 86400 * 1000);
        const certRecentes = lista
          .filter(e => e.certificado_emitido && e.certificado_emitido_em && new Date(e.certificado_emitido_em) > limite30)
          .map(e => `${e.nome} (${e.unidade}, ${(e.certificado_emitido_em || '').slice(0, 10)})`);

        // Total de checkpoints personalizados (sem checkpoint_id vinculado)
        const { count: customCount } = await supabaseClient
          .from('la_educa_avaliacoes')
          .select('id', { count: 'exact', head: true })
          .is('checkpoint_id', null);

        blocoTexto =
          `[LA_EDUCA_RESUMO]\n` +
          `Por unidade: ${resumoUnidades || '(sem estagiários)'}\n` +
          `Atrasados (>14d): ${atrasados.length > 0 ? atrasados.join('; ') : 'nenhum'}\n` +
          `Prontos pra Certificado Alfa: ${prontos.length > 0 ? prontos.join('; ') : 'nenhum'}\n` +
          `Certificados emitidos (últimos 30d): ${certRecentes.length > 0 ? certRecentes.join('; ') : 'nenhum'}\n` +
          `Checkpoints personalizados no total: ${customCount || 0}`;
      }

      systemPrompt += '\n\n---\n\n' + blocoTexto;

    } catch (err) {
      console.error('[system.js] LA_EDUCA_RESUMO erro:', err.message);
    }
  }

  // LA JOURNEY — injeta resumo quando a skill está ativa ou a mensagem menciona journey/cursos
  const lowerMsgJourney = (lastUserMessage || '').toLowerCase();

  const hasJourneyKeyword = ['la journey', 'la-journey', 'lajourney', 'journey', 'jornada', 'jornada pedagógica',
    'atrasados journey', 'pendências journey', 'pendencias journey', 'publicado journey'].some(t => lowerMsgJourney.includes(t));

  const cursoNames = ['bateria', 'canto', 'cordas', 'teclas', 'musicalização', 'musicalizacao'];
  const pedagogicalContext = ['journey', 'jornada', 'checkpoint', 'foundation', 'grow', 'advance', 'master', 'iniciação', 'iniciacao', 'marco', 'mentor', 'pedagógic', 'pedagogic'];
  const hasCursoWithContext = cursoNames.some(c =>
    lowerMsgJourney.includes(c) && pedagogicalContext.some(k => lowerMsgJourney.includes(k))
  );

  const isJourneyCommand = /^\s*\/journey\b/.test(lastUserMessage || '');
  const journeyTriggered =
    skill?.name === 'la-journey' ||
    hasJourneyKeyword ||
    hasCursoWithContext ||
    isJourneyCommand;

  if ((collaborator?.role === 'coordinator' || collaborator?.role === 'director') && journeyTriggered) {
    try {
      const supabaseClient = require('../supabase/client');

      // Detecta curso mencionado (se houver) para injeção filtrada
      const cursoMencionado = cursoNames.find(c => lowerMsgJourney.includes(c));
      const filtraCurso = cursoMencionado ? cursoMencionado.replace('ção', 'cao') : null;

      const [{ data: schoolRows }, { data: kidsRows }] = await Promise.all([
        supabaseClient.rpc('la_journey_lista_progresso', { p_programa_id: 'school' }),
        supabaseClient.rpc('la_journey_lista_progresso', { p_programa_id: 'kids' }),
      ]);

      let all = [...(schoolRows || []), ...(kidsRows || [])];
      if (filtraCurso) {
        all = all.filter(r =>
          r.curso_id === filtraCurso || (r.curso_nome || '').toLowerCase().includes(filtraCurso)
        );
      }

      const { data: pendRaw } = await supabaseClient
        .from('la_journey_conteudo_checkpoint')
        .select('id, programa_id, curso_id, checkpoint_id, updated_at, la_journey_cursos(nome), la_journey_checkpoints(nome)')
        .eq('status', 'em_revisao');

      function emojiStatus(status, pct) {
        if (status === 'publicado') return '✅';
        if (status === 'em_revisao') return '🟡';
        if (pct > 0) return '⚪';
        return '⬜';
      }

      function formatRows(rows, label) {
        if (!rows || rows.length === 0) return `${label}: sem dados`;
        const total = rows.length;
        const publicados = rows.filter(r => r.status === 'publicado').length;
        const pctGeral = Math.round((publicados / total) * 100);
        const cursos = rows.map(r => {
          const emoji = emojiStatus(r.status, r.pct_publicado || 0);
          return `  - ${emoji} ${r.curso_nome || r.curso_id}: ${Math.round(r.pct_publicado || 0)}%`;
        }).join('\n');
        return `${label}: ${pctGeral}% preenchido\n${cursos}`;
      }

      let blocoJourney;
      if (filtraCurso) {
        // Injeção filtrada: só o curso mencionado
        const cursosStr = all.map(r => {
          const emoji = emojiStatus(r.status, r.pct_publicado || 0);
          return `  - ${emoji} ${r.curso_nome || r.curso_id} (${r.programa_id}): ${Math.round(r.pct_publicado || 0)}%`;
        }).join('\n');
        blocoJourney = `[LA_JOURNEY_STATUS — filtrado: ${cursoMencionado}]\n${cursosStr || '  (sem dados)'}`;
      } else {
        const pendencias = (pendRaw || []).map(p => {
          const cursoNome = p.la_journey_cursos?.nome || p.curso_id;
          const checkNome = p.la_journey_checkpoints?.nome || p.checkpoint_id;
          return `  - ${cursoNome}: ${checkNome}`;
        });
        blocoJourney =
          `[LA_JOURNEY_STATUS]\n` +
          formatRows(schoolRows, 'School') + '\n\n' +
          formatRows(kidsRows, 'Kids') + '\n\n' +
          `Pendências de revisão (${pendencias.length}):\n` +
          (pendencias.length > 0 ? pendencias.join('\n') : '  (nenhuma)');
      }

      systemPrompt += '\n\n---\n\n' + blocoJourney;
    } catch (err) {
      console.error('[system.js] LA_JOURNEY_STATUS erro:', err.message);
    }
  }

  // ─── INVENTÁRIO — detecção contextual (R2) ──────────────────────────────────
  const lowerMsg = (lastUserMessage || '').toLowerCase();
  const triggersFortesInv = ['inventário', 'inventario', 'patrimônio', 'patrimonio', 'lojinha', 'loja', 'estoque baixo', 'estoque da'];
  const cmdsInv = /^\s*\/(inv|loja)\b/.test(lastUserMessage || '');
  const unidadesNomes = ['barra', 'recreio', 'campo grande', ' cg '];
  const verbosOperacionais = ['comprei', 'recebi', 'peguei', 'levei', 'chiando', 'quebrado', 'quebrou', 'falta', 'acabou'];
  const matchUnidadeInv = unidadesNomes.some(u => (' ' + lowerMsg + ' ').includes(u));
  const matchVerboInv = verbosOperacionais.some(v => lowerMsg.includes(v));
  const matchInvForte = triggersFortesInv.some(t => lowerMsg.includes(t));
  // Consulta de sala específica: "o que tem na sala X", "ver sala X", "mostra a sala X", "sala X" com verbo de consulta
  let querSalaMatch = /\bsala\s+([a-zA-ZáàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ0-9]+)/i.exec(lastUserMessage || '');
  const verbosConsultaSala = /\b(o que tem|o que h[áa]|que tem|tem o que|ver|mostra|mostrar|mostre|lista|listar|conte[uú]do|inventário|inventario|quais|qual[s]?|equipamento[s]?|item|itens)\b/i;
  // Palavras de item de inventário — se o user fala disso sem mencionar sala, herdar sala da conversa recente
  const itemKeywordsRe = /\b(ar[\s-]condicionad[oa]|piano|teclado|microfone|microphone|caixa de som|amplificador|cabo|cadeira|mesa|espelho|quadro|projetor|tv|televisão|televisao|c[âa]mera|bateria|guitarra|violão|violao|baixo|computador|notebook|impressora|fornecedor|valor|patrim[ôo]nio|n[°º] s[ée]rie|n[úu]mero de s[ée]rie|nota fiscal|condi[çc][ãa]o do|manuten[çc][ãa]o do|condi[çc][ãa]o desse|condicao do|condicao desse)\b/i;
  const mencionaItemInv = itemKeywordsRe.test(lowerMsg);
  // Se não tem sala explícita mas menciona item de inventário, busca "sala consultada recentemente"
  // persistida em collaborator_memory (TTL 2h) — mais confiável que regex em histórico.
  let salaRecentePersistida = null;
  if (!querSalaMatch && mencionaItemInv && collaborator) {
    try {
      const { data: memRec } = await supabase
        .from('collaborator_memory')
        .select('content, decay_at')
        .eq('collaborator_id', collaborator.id)
        .eq('memory_type', 'inventario_sala_recente')
        .eq('is_active', true)
        .gt('decay_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (memRec && memRec.content) {
        try {
          const parsed = JSON.parse(memRec.content);
          if (parsed.sala_id) {
            salaRecentePersistida = parsed;
            querSalaMatch = [`sala ${parsed.sala_nome}`, parsed.sala_nome];
          }
        } catch (_) { /* ignora json inválido */ }
      }
    } catch (e) {
      console.warn('[InvCtx] erro lookup sala recente:', e.message);
    }
    console.log(`[InvCtx] item=${mencionaItemInv} hist=${hist.length} salaRecentePersistida=${salaRecentePersistida ? salaRecentePersistida.sala_nome : 'NENHUMA'}`);
  }
  const querConsultaSala = !!(querSalaMatch && (verbosConsultaSala.test(lowerMsg) || mencionaItemInv));
  const matchInv = cmdsInv || matchInvForte || (matchUnidadeInv && matchVerboInv) || querConsultaSala || mencionaItemInv;

  if (matchInv) {
    try {
      const { laReportClient, isLaReportConfigured } = require('../services/la-report-client');
      if (isLaReportConfigured()) {
        const { data: unidadesCat } = await laReportClient.from('unidades').select('id, nome');
        const { data: salasCat } = await laReportClient.from('salas').select('id, nome, tipo_sala, unidade_id').eq('ativo', true);
        const { data: produtosCat } = await laReportClient.from('loja_produtos').select('id, nome, sku').eq('ativo', true);
        systemPrompt += `\n\n[INVENTARIO_CATALOGO]\n`;
        systemPrompt += `Unidades: ${(unidadesCat || []).map(u => `${u.nome}(${u.id})`).join(', ')}\n`;
        systemPrompt += `Salas: ${(salasCat || []).map(s => `${s.nome}/${s.tipo_sala || '?'}/uid=${s.unidade_id}`).join(' | ')}\n`;
        systemPrompt += `Produtos lojinha: ${(produtosCat || []).map(p => `${p.nome}${p.sku ? '(' + p.sku + ')' : ''}`).join(', ')}\n\n`;
        systemPrompt += `Quando o usuário descrever uma ação operacional, use a skill inventario.md e emita <<INVENTORY_ACTION>>...<<END>> com JSON estruturado. Sempre confirmar antes de gravar.\n\n`;
        systemPrompt += `ACTIONS PERMITIDAS (use exatamente esses nomes):\n`;
        systemPrompt += `- "add_item" — cadastrar novo item (params: nome, sala_nome, [unidade_nome], [categoria], [marca], [quantidade], etc)\n`;
        systemPrompt += `- "edit_item" — atualizar item existente (params: nome, sala_nome, + os campos a mudar: quantidade, condicao, status, marca, modelo, valor_compra, fornecedor, etc)\n`;
        systemPrompt += `- "delete_item" — dar baixa em item (params: nome, sala_nome, [motivo])\n`;
        systemPrompt += `- "move_item" — registrar movimentação entre salas (params: item_nome, tipo, sala_destino_nome, [motivo])\n`;
        systemPrompt += `- "maintenance" — registrar manutenção (params: item_nome, tipo, descricao, [custo], [fornecedor_servico])\n`;
        systemPrompt += `- "shop_movement" — movimentação de estoque da lojinha (params: produto_nome, unidade_nome, tipo, quantidade)\n`;
        systemPrompt += `- "ver" — consultar item por nome (params: nome)\n\n`;
        systemPrompt += `REGRAS:\n`;
        systemPrompt += `- SEMPRE aninhe os dados em "params". NUNCA mande flat.\n`;
        systemPrompt += `- Use os nomes exatos das actions acima. NÃO invente "create", "update", "update_item", "remove" etc.\n`;
        systemPrompt += `- Use os nomes PT dos campos (nome, sala_nome, unidade_nome, quantidade, condicao). NÃO use item_name, room, unit, quantity, etc.\n\n`;
        systemPrompt += `EXEMPLO de "edit_item":\n<<INVENTORY_ACTION>>\n{"action":"edit_item","params":{"nome":"Cadeiras","sala_nome":"Amy","quantidade":3}}\n<<END>>\n\n`;
        systemPrompt += `EXEMPLO de "delete_item":\n<<INVENTORY_ACTION>>\n{"action":"delete_item","params":{"nome":"Microfone 2","sala_nome":"Amy","motivo":"quebrou"}}\n<<END>>\n\n`;
        systemPrompt += `EXEMPLO de "ver":\n<<INVENTORY_ACTION>>\n{"action":"ver","params":{"nome":"piano"}}\n<<END>>`;

        // Se usuário perguntou sobre uma sala específica, busca e injeta o detalhe
        if (querConsultaSala && querSalaMatch) {
          try {
            const inventarioService = require('../services/inventario-service');
            const nomeBuscado = querSalaMatch[1];
            // Detecta unidade na mensagem
            const unidadeMencionada = unidadesNomes.find(u => (' ' + lowerMsg + ' ').includes(u))?.trim();
            let unidadeId = null;
            if (unidadeMencionada) {
              const u = (unidadesCat || []).find(x => x.nome.toLowerCase().includes(unidadeMencionada.toLowerCase()));
              if (u) unidadeId = u.id;
            }
            // Se veio de memória persistida, usa direto o sala_id (sem ambiguidade)
            let matches;
            if (salaRecentePersistida && salaRecentePersistida.sala_id) {
              const { data: salaDireta } = await laReportClient
                .from('salas').select('id, nome, tipo_sala, unidade_id, ativo')
                .eq('id', salaRecentePersistida.sala_id).maybeSingle();
              matches = salaDireta ? [salaDireta] : [];
            } else {
              matches = await inventarioService.buscarSalaPorNome(nomeBuscado, unidadeId);
            }
            if (matches.length === 0) {
              systemPrompt += `\n\n[SALA_CONSULTADA: "${nomeBuscado}" — nenhuma sala encontrada${unidadeMencionada ? ` na unidade ${unidadeMencionada}` : ''}]\n`;
            } else if (matches.length > 1) {
              systemPrompt += `\n\n[SALA_CONSULTADA: múltiplas salas "${nomeBuscado}" → ${matches.map(s => `${s.nome} (uid=${s.unidade_id}, id=${s.id})`).join(', ')}]\nPergunta ao usuário qual.\n`;
            } else {
              const detalhe = await inventarioService.detalheSala(matches[0].id, collaborator);
              const sala = detalhe.sala;
              const itens = detalhe.itens || [];
              const movs = detalhe.movimentacoes || [];
              const manuts = detalhe.manutencoes || [];
              const verValor = checkAccess(collaborator, 'valor_patrimonial').allowed;
              systemPrompt += `\n\n[SALA_DETALHE: ${sala.nome} — ${sala.unidades?.nome || ''} (id=${sala.id}${sala.tipo_sala ? ', ' + sala.tipo_sala : ''}${sala.capacidade_maxima ? ', cap ' + sala.capacidade_maxima : ''})]\n`;
              systemPrompt += `Total itens: ${itens.length}\n\n`;
              if (itens.length > 0) {
                systemPrompt += `ITENS COMPLETOS (use TUDO pra responder, não invente que não tem):\n`;
                systemPrompt += itens.map(i => {
                  const partes = [`id=${i.id}`, `nome="${i.nome}"`];
                  if (i.categoria) partes.push(`cat=${i.categoria}`);
                  if (i.marca) partes.push(`marca=${i.marca}`);
                  if (i.modelo) partes.push(`modelo=${i.modelo}`);
                  if (i.numero_serie) partes.push(`nº_série=${i.numero_serie}`);
                  if (i.codigo_patrimonio) partes.push(`cód_patrim=${i.codigo_patrimonio}`);
                  partes.push(`qtd=${i.quantidade ?? 1}`);
                  partes.push(`condição=${i.condicao || '?'}`);
                  partes.push(`status=${i.status || '?'}`);
                  if (verValor && i.valor_compra != null) partes.push(`valor_compra=R$${i.valor_compra}`);
                  if (verValor && i.data_compra) partes.push(`data_compra=${i.data_compra}`);
                  if (verValor && i.nota_fiscal) partes.push(`nf=${i.nota_fiscal}`);
                  if (verValor && i.fornecedor) partes.push(`fornecedor=${i.fornecedor}`);
                  if (i.vida_util_meses) partes.push(`vida_útil=${i.vida_util_meses}m`);
                  if (i.proxima_revisao) partes.push(`próx_revisão=${i.proxima_revisao}`);
                  if (i.alertar_dias_antes != null) partes.push(`alerta=${i.alertar_dias_antes}d`);
                  if (i.foto_url) partes.push(`foto=sim`);
                  if (i.observacoes) partes.push(`obs="${String(i.observacoes).slice(0, 200)}"`);
                  return `- ${partes.join(' · ')}`;
                }).join('\n') + '\n';
              }
              if (movs.length > 0) {
                systemPrompt += `\nMOVIMENTAÇÕES recentes (últimas ${movs.length}):\n`;
                systemPrompt += movs.slice(0, 10).map(m => `- ${m.data_movimentacao?.slice(0, 10) || '?'} · ${m.tipo} · item="${m.inventario?.nome || m.item_id}" · ${m.motivo || ''}`).join('\n') + '\n';
              }
              if (manuts.length > 0) {
                systemPrompt += `\nMANUTENÇÕES recentes (últimas ${manuts.length}):\n`;
                systemPrompt += manuts.slice(0, 10).map(m => `- ${m.data_manutencao || '?'} · ${m.tipo} · item="${m.inventario?.nome || m.item_id}" · ${m.descricao || ''}${verValor && m.custo != null ? ' · R$' + m.custo : ''}${m.responsavel ? ' · resp=' + m.responsavel : ''}`).join('\n') + '\n';
              }
              if (!verValor) {
                systemPrompt += `\n[GOVERNANÇA] Este colaborador NÃO tem acesso a valor patrimonial (valor_compra, data_compra, nota_fiscal, fornecedor, custos de manutenção). Se ele perguntar, responde: "Essa info é restrita ao seu perfil. Fala com o Alf ou a coordenação."\n`;
              }
              systemPrompt += `\nUse esses dados pra responder DIRETAMENTE. NÃO peça pra consultar — você JÁ tem TUDO acima. Se perguntarem por algo específico (valor, série, manutenção, etc.), olha a lista e responde.\n`;

              systemPrompt += `\n[FORMATO_RESPOSTA_SALA — use SEMPRE este template quando listar itens de uma sala no WhatsApp]\n`;
              systemPrompt += `📋 *Sala <Nome>* — <Unidade> · <tipo_sala> · Cap. <N> alunos\n\n`;
              systemPrompt += `Pra CADA item, escolha o emoji pela categoria/nome:\n`;
              systemPrompt += `  ❄️ climatização (ar condicionado, ventilador) · 🎹 teclas (piano, teclado, sintetizador) · 🎸 cordas (violão, guitarra, baixo, ukulele)\n`;
              systemPrompt += `  🥁 percussão (bateria, pandeiro, tambor) · 🎤 voz/microfone · 🔊 som/caixa/amplificador · 🎚️ mesa de som\n`;
              systemPrompt += `  🪑 mobília (cadeira, banco, sofá) · 🪞 espelho · ⬜ quadro/lousa · 📺 tv/projetor · 💡 iluminação · 💻 computador/notebook\n`;
              systemPrompt += `  📷 câmera · 🎬 vídeo · 🔧 ferramenta · 📦 outros\n\n`;
              systemPrompt += `Itens COM dados financeiros (valor/NF/fornecedor) ou técnicos (série/cód) → BLOCO completo:\n`;
              systemPrompt += `*<emoji> <Nome>*\n  › Marca: X · Modelo: Y\n  › Nº Série: Z · Cód: W\n  › Condição: bom · Status: ativo\n  › Valor: R$ 2.000 · NF: 12345\n  › Fornecedor: Frio Peças\n  › Compra: 01/04/2026\n  › Próx revisão: 15/08/2026\n\n`;
              systemPrompt += `Itens SIMPLES (só nome+condição, sem dados extras) → linha única em grupos de 2-3:\n`;
              systemPrompt += `*🎤 Microfone 1* · *🎤 Microfone 2* · *🪞 Espelho*\n\n`;
              systemPrompt += `REGRAS:\n`;
              systemPrompt += `- Negrito do WhatsApp com *asteriscos* (NÃO use markdown **)\n`;
              systemPrompt += `- Campos vazios/null: OMITIR a linha inteira (não escrever "Modelo: —")\n`;
              systemPrompt += `- Datas em DD/MM/AAAA (não AAAA-MM-DD)\n`;
              systemPrompt += `- Valor formatado: R$ 2.000 (não 2000)\n`;
              systemPrompt += `- Fechar com totalizador: "Total: N itens ativos · M em manutenção"\n`;
              systemPrompt += `- Se governança restringiu valor_patrimonial, NÃO mostrar Valor/NF/Fornecedor/Compra\n`;

              // Persiste sala consultada em collaborator_memory (TTL 2h) — pra próxima msg achar mesmo sem "sala X"
              if (collaborator && collaborator.id) {
                try {
                  const decayIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
                  const memContent = JSON.stringify({
                    sala_id: sala.id, sala_nome: sala.nome,
                    unidade_id: sala.unidade_id, unidade_nome: sala.unidades?.nome || null,
                  });
                  // Desativa anteriores e insere a nova como ativa
                  await supabase.from('collaborator_memory')
                    .update({ is_active: false })
                    .eq('collaborator_id', collaborator.id)
                    .eq('memory_type', 'inventario_sala_recente')
                    .eq('is_active', true);
                  await supabase.from('collaborator_memory').insert({
                    collaborator_id: collaborator.id,
                    memory_type: 'inventario_sala_recente',
                    content: memContent,
                    importance: 'medium',
                    is_active: true,
                    decay_at: decayIso,
                  });
                  console.log(`[InvCtx] sala persistida: ${sala.nome} (id=${sala.id}) decay=${decayIso}`);
                } catch (eMem) {
                  console.warn('[InvCtx] erro persistir sala recente:', eMem.message);
                }
              }
            }
          } catch (eDet) {
            if (eDet.code === 'ACCESS_DENIED') {
              systemPrompt += `\n\n[SALA_CONSULTADA: acesso negado — ${eDet.message}]\n`;
            } else {
              systemPrompt += `\n\n[SALA_CONSULTADA: erro ${eDet.message}]\n`;
            }
          }
        }
      }
    } catch (e) {
      systemPrompt += `\n[INVENTARIO_CATALOGO]\nErro ao carregar catálogo: ${e.message}`;
    }
  }

  // ─── LOJINHA — detecção contextual ────────────────────────────────────────
  // Sprint lojinha-bidirecional — gatilho para skill lojinha.md (SHOP_ACTION).
  // Separado do bloco inventario pra evitar falso-positivo: lojinha é estoque
  // de produtos de varejo (baqueta, palheta, camiseta), não patrimônio de sala.
  const _lojinhaKeywordRe = /\b(vendi|vendeu|vender|venda|chegou|chegaram|comprou|lojinha|tá\s+acabando|ta\s+acabando|zerou|paleta|palheta(?:\s+(?:de|do|para|pra))?|baqueta(?:\s+(?:de|do|para|pra))?|caderno|camiseta|estoque\s+da\s+loja)\b/i;
  if (_lojinhaKeywordRe.test(lastUserMessage || '')) {
    const lojinhaSkillBody = loadSkill('lojinha');
    if (lojinhaSkillBody) {
      systemPrompt += `\n\n---\n\n[SKILL ATIVA: lojinha]\n\n${lojinhaSkillBody}`;
    }
  }

  // Fase A — bloco dinâmico de governança de dados (sempre injetado quando há collaborator).
  if (collaborator) {
    systemPrompt += '\n\n' + buildAccessBlock(collaborator);
  }

  const totalTasks = (ctx.personalTasks?.length || 0) + (ctx.workTasks?.length || 0);
  const evCount = (ctx.todayEvents || []).length;
  const memCount = (ctx.criticalMemories?.length || 0) + (ctx.preferenceMemories?.length || 0) + (ctx.recentContextMemories?.length || 0);
  console.log(`[Prompt] size: ${systemPrompt.length} chars (skill: ${skill ? skill.name : 'none'}, history: ${hist.length}, memories: ${memCount}, tasks: ${totalTasks}/p${ctx.personalTasks?.length || 0}/w${ctx.workTasks?.length || 0}, events: ${evCount}, ritual: ${rt || '-'})`);

  // Compatibility: engine.js destructures { systemPrompt, ctx } and reads ctx.memories,
  // ctx.todayTasks, ctx.notifications, ctx.recentMessages.
  return { systemPrompt, ctx };
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

module.exports = { buildSystemPrompt, formatMessages, fetchCollaboratorContext, nameFor, todaySaoPaulo, buildAccessBlock };
