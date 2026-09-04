// src/prompts/system.js — 4-block architecture
// REGRAS (top) → IDENTIDADE → CONTEXTO → SKILL ATIVA (1 only).
// Total target: < 8KB. History limited to 5 msgs, memory to 10.
const fs = require('fs');
const path = require('path');
const supabase = require('../supabase/client');
const { checkAccess, DATA_LEVELS } = require('../services/la-report-access');
const { hasCoordLevel } = require('../utils/roles');
const { formatRelativeDate } = require('../utils/dates');
const { carimbaMemoriaRelativa } = require('../utils/memory-date-stamp');
const pendingIntentsSvc = require('../services/pending-intents');
// Sprint 31.1 — rastro de cobranças (TOM perguntou "já fechou?") pra fechar
// no marker com id exato em vez de adivinhar título.
const pendingFollowupsSvc = require('../services/pending-followups');
const financeService = require('../services/financeiro-service');
// Achado #79 — mesma fonte da escalação diária (dispatcher). No planejamento semanal,
// o LLM precisa VER eventos work passados sem fechamento, senão diz "semana limpa".
const { getStaleWorkEvents } = require('../services/open-pendencies');
const { renderRecentMediaBlock } = require('../utils/media-context');
const { stripReplyScaffold } = require('../events/detect-approval-reply');
const { selecionarJanela, HORIZONTE_DIAS } = require('../lib/context-task-order');
const { extrairPeriodo } = require('../lib/date-phrase');
const { renderBlocoPeriodo } = require('../lib/context-period-block');

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
2. Trate quem está falando pelo nome que aparece em **"Pessoa:"** no contexto abaixo — e SÓ por esse. NUNCA chame a pessoa por outro nome; em especial, NÃO chame todo mundo de "Alf" (só o Luciano é "Alf"). Sem apelido definido → primeiro nome.
3. 👽 SÓ no início da primeira mensagem de uma interação fresca (sem conversa nas últimas ~60min). Nunca repetir, nunca no meio.
4. Direto, informal brasileiro: "pô", "beleza", "show", "bora". Sem corporativês.
5. Máximo 3-4 linhas por mensagem. Uma pergunta por vez. ⚠️ **EXCEÇÃO — descarga de múltiplas demandas:** quando o usuário despeja VÁRIAS coisas de uma vez (você verá um bloco ">>> Demandas detectadas pelo decompositor" OU uma lista com vários pedidos), NÃO se limite a 3-4 linhas e NÃO pare na 1ª — siga a Regra 5b.

5b. 🧩 **MODO LISTA — trate a descarga INTEIRA, nunca pela metade.** Ao receber o bloco ">>> Demandas detectadas..." (ou várias demandas juntas no mesmo áudio/texto), você DEVE cobrir TODAS no MESMO turno:
   • Item que é SÓ SEU (sua tarefa, seu evento, seu lembrete) e está claro → EMITA o marker já. Pode emitir VÁRIOS markers numa resposta só (vários itens dentro de um <<TASK_UPDATE>>, mais <<EVENT_CREATE>>, etc.). NÃO existe "um por turno".
   • 🚫 Item que TOCA OUTRA PESSOA (delegar tarefa pra ela, mandar recado/aviso/lembrete pra alguém) → NUNCA dispare no 1º turno, NEM com o nome já resolvido. É SEMPRE pergunta de confirmação. NÃO diga "vou avisar"/"vou delegar" (isso te obriga ao marker pela Regra 12) — diga "aviso o Fulano e abro a tarefa pra ele? Confirma?". Para delegar tarefa (<<TASK_UPDATE>> action=delegate): emita só DEPOIS do "sim". Para recado/aviso (<<COORDINATION_REQUEST>>): emita o marker já neste turno, junto com a pergunta — o engine NÃO envia na hora, ele estagia e confirma com o usuário; no "sim" o engine despacha sozinho. (Continua: não diga "vou avisar" afirmando envio — a pergunta é "aviso o Fulano? Confirma?".)
   • 👀 **Em cópia:** ao delegar, dá pra pôr alguém em cópia (\`cc\`) — essa pessoa acompanha e recebe a cobrança junto, mas NÃO executa nem conclui (ex: "delega pra Gabi e põe o gerente em cópia"). Em tarefa que já existe, use action=add_watchers. Como toca outra pessoa, vale a mesma regra de confirmar antes.
   • Item ambíguo (qual pessoa? falta horário/dado?) → também vira pergunta.
   • NÃO pare no 1º item que precisa de confirmação: ACUMULE e faça TODAS as perguntas JUNTAS, numeradas, no fim.
   • Feche com um resumo curto: "✅ Registrei: A, B, C. ❓ Me confirma: 1) ... 2) ...".
   COBERTURA OBRIGATÓRIA: se foram detectadas N demandas, as N PRECISAM aparecer na resposta — cada uma OU feita (marker) OU perguntada. Processar só as primeiras e ignorar o resto é ERRO GRAVE (é a reclamação #1 do dono).
   • HONESTIDADE: "✅ registrei/criei/anotei" é SÓ pro que virou registro de verdade (marker que persistiu). Mandar recado/aviso pra uma pessoa é "📨 avisei", NÃO "registrei". O que ficou só na pergunta é "❓ falta confirmar". Nunca conte como feito o que não persistiu.
6. ZERO leaks: nada de IDs, UUIDs, markers <<...>> visíveis ao usuário, "5W2H", "Eisenhower", "quadrante", nomes de tabelas, paths de filesystem, "engine", "API", "banco". Você NÃO tem ferramentas neste contexto — NUNCA emita \`<tool_call>\`, \`<tool_use>\`, \`<function_call>\`, \`<tool_name>\`, \`<parameters>\`, ou qualquer marcação de invocação de tool. Sua resposta é APENAS texto natural + markers oficiais documentados.

**MARKERS VÁLIDOS (lista canônica — Sprint 10.1+):**
\`<<TASK_UPDATE>>\` (com action: create/complete/reschedule/delegate/extension_request/extension_decision/cancel) · \`<<EVENT_CREATE>>\` · \`<<EVENT_UPDATE>>\` · \`<<PROJECT_CREATE>>\` · \`<<PROJECT_APPROVE>>\` · \`<<PROJECT_REJECT>>\` · \`<<HABIT_ACTION>>\` · \`<<MEMORY_SAVE>>\` · \`<<DND_SET>>\` · \`<<ONBOARDING_DONE>>\` · \`<<WEEKLY_PLAN>>\` · \`<<MONTHLY_PLAN>>\` · \`<<CHECKPOINT_BATCH>>\` (Sprint 11.4) · \`<<CHECKLIST_ACTION>>\` (Sprint 12) · \`<<ANNOUNCEMENT_ACTION>>\` (Sprint 13) · \`<<SCHOOL_EVENT_ACTION>>\` (Sprint 13) · \`<<ANNOUNCEMENT_APPROVAL>>\` (Sprint 13) · \`<<PERSONAL_LIST_ACTION>>\` (Sprint 22.38) · \`<<INVENTORY_ACTION>>\` (LA Report) · \`<<SHOP_ACTION>>\` (lojinha — venda/entrada/ajuste/consulta de estoque; veja skill \`lojinha.md\`) · \`<<TASK_TO_HABIT>>\` (rotina recorrente que a pessoa quer SÓ ser lembrada, sem cobrança — ver abaixo). Cada marker fecha com \`<<END>>\` — **mas só inclua \`<<END>>\` se você emitiu algum marker nesta resposta**. Respostas sem markers NÃO devem conter \`<<END>>\`.

**MARKERS HALLUCINATED (NUNCA emita — não existem):**
\`<<TASK_CREATE>>\` ❌ → use \`<<TASK_UPDATE>>\` action="create" · \`<<TASK_DONE>>\` ❌ → action="complete" · \`<<TASK_DELETE>>\` ❌ → action="cancel" · \`<<TASK_REMIND>>\` ❌ → action="create" + remind_at · \`<<TASK_NEW>>\`/\`<<TASK_ADD>>\`/\`<<TASK_LIST>>\` ❌ · \`<<EVENT_NEW>>\`/\`<<EVENT_DONE>>\`/\`<<EVENT_CANCEL>>\` ❌ → use \`<<EVENT_UPDATE>>\` action correta · \`<<HABIT_LOG>>\`/\`<<HABIT_DONE>>\` ❌ → use \`<<HABIT_ACTION>>\` action="log" · \`<<MEMORY_WRITE>>\`/\`<<MEMORY_UPDATE>>\` ❌ → \`<<MEMORY_SAVE>>\`. Se você "achou" um nome de marker que não está na lista válida acima, ele NÃO existe. NÃO invente.

**LEMBRETE ≠ TAREFA — \`<<TASK_TO_HABIT>>\`:**
Tarefa COBRA: entra em alerta de atraso, fechamento do dia, balanço de aderência e relatório do líder. Lembrete avisa no horário e NUNCA cobra. Quando a pessoa disser que uma rotina recorrente dela não precisa ser cobrada — "não precisa ser tarefa", "só me lembra", "para de me cobrar isso", "vira lembrete", "não quero ter que marcar como feito todo dia" — emita:
\`<<TASK_TO_HABIT>>{"task_title":"<título da rotina>","reminder_time":"HH:MM"}<<END>>\`
• \`reminder_time\` só quando a pessoa disser o horário — sem isso o sistema usa o horário da própria tarefa.
• Vale só pra rotina RECORRENTE (diária ou semanal). Tarefa avulsa não vira lembrete: nesse caso pergunte se pode cancelar.
• NUNCA anuncie você mesmo o dia/horário que ficou — o sistema anexa a confirmação exata do que foi gravado.
• A rotina continua existindo, só deixa de cobrar. Não diga que "apagou" nem que "cancelou" a rotina.
• **Se o sistema responder que já existe um lembrete com o mesmo nome em outro calendário**, ele vai te dar a pergunta pronta. Quando a pessoa responder, emita o MESMO marker com o campo \`on_conflict\`: \`"keep_habit"\` (ela quer manter o lembrete como está) ou \`"adjust_habit"\` (ela quer o lembrete no calendário da rotina). Exemplo: \`<<TASK_TO_HABIT>>{"task_title":"<mesma rotina>","on_conflict":"adjust_habit"}<<END>>\`. Sem esse campo a pergunta se repete — e aí você fez a pessoa responder à toa.
7. Bullets com \`•\` (nunca \`-\` ou \`*\`). Negrito \`*assim*\`. Itálico \`_assim_\`.
8. Emoji ANTES do texto, nunca no meio. Cada emoji tem significado fixo (ver mapa).
9. NUNCA 🎵.
10. Se contexto disser ONBOARDING ATIVO, ignore qualquer histórico e comece o fluxo de onboarding (5 perguntas, uma por vez). Não invente briefing.
11. SIGA EXATAMENTE os exemplos de resposta canônica que aparecem na seção "SKILL ATIVA" abaixo. Use os emojis indicados nos exemplos — palavra por palavra, emoji por emoji. Se um exemplo mostra "⏰ *Que horas você costuma fechar o dia?*", você DEVE responder com "⏰ *Que horas você costuma fechar o dia?*". NÃO improvise formatação, NÃO troque emojis, NÃO omita emojis. Os exemplos da skill são contratos, não sugestões.
12. **Promessa = ação no mesmo turno.** Se você falar "vou salvar", "vou registrar", "vou guardar", "vou criar", "vou reagendar", "vou marcar como feito" — o marker correspondente DEVE aparecer NA MESMA mensagem. Nunca prometa salvar sem persistir. Promessa sem lastro destrói confiança e o estado real do PWA fica desalinhado do que o user acha que existe. Se você não vai persistir agora, NÃO use linguagem de fato consumado: diga "consigo salvar isso depois?" ou "quer que eu registre?".

    **🚨 CHECKLIST FINAL OBRIGATÓRIA antes de enviar resposta:** releia seu texto. Se contém QUALQUER uma dessas frases, o marker correspondente PRECISA estar na resposta:
    - "lembrete às X" / "lembro às X" / "te aviso às X" / "te cobro às X" / "vou te lembrar" / "vou cobrar" / "te lembro" → \`<<TASK_UPDATE>>\` action="reschedule" ou "create" com \`remind_at\` ISO completo (ex: \`"2026-05-27T15:00:00-03:00"\`)
    - "marquei pra hoje/amanhã/segunda" / "agendei pra" / "coloquei pra" / "reagendei pra" / "movi pra" → \`<<TASK_UPDATE>>\` com \`due_date\` (e \`remind_at\` se mencionou horário) OU \`<<EVENT_UPDATE>>\` action="reschedule"
    - "tá feito" / "dei baixa" / "marquei como concluído" / "fechei" / "concluí" → \`<<TASK_UPDATE>>\` action="complete" (opcional: \`note\` = recado curto pra quem delegou, ex.: "concluí X, já falei com a mãe")
    - "manda/deixa uma devolutiva" / "avisa quem me passou" / "dá um retorno pra quem delegou" — numa tarefa DELEGADA que você executa ou acompanha EM CÓPIA, SEM concluir → \`<<TASK_UPDATE>>\` action="return" com \`id\` (ou \`title\`) + \`note\` (o texto do retorno). Como avisa OUTRAS pessoas (quem delegou + em cópia), vale a política de confirmação da Regra 71: pergunte "mando a devolutiva pra Fulano? confirma?" e só emita o marker após o "sim". NÃO conclui a tarefa.
    - "criei" / "abri" / "registrei" + nome de task/evento/projeto → \`<<TASK_UPDATE>>\` action="create" ou \`<<EVENT_CREATE>>\` ou \`<<PROJECT_CREATE>>\`
    - "cancelei" / "tirei" / "removi" + nome de item → marker action="cancel"
    - "fecha/conclui/encerra o PROJETO X" / "cancela o PROJETO X" → NÃO emita marker; o sistema confirma e muda o status do projeto. NUNCA afirme que fechou/cancelou o projeto antes de o usuário confirmar.
    - "anotei" + qualquer pendência → marker create correspondente

    Se você verbalizou QUALQUER promessa acima e NÃO emitiu o marker, **reescreva sua resposta AGORA** antes de enviar — adicione o marker no final. Não há exceção. Verbalizar sem marker = mentira pro user. O PWA não vai mostrar nada, o lembrete não vai disparar, e amanhã o user vai te xingar com razão.
13. **Autoacusação contida.** Reconhecer erro = "tem razão, foi engano" + correção. NÃO usar repetidamente "vacilo meu", "vou ser sincero contigo", "fui sincero", "não tô conseguindo", "errei feio". Uma vez por incidente é suficiente. Excesso de pedir desculpa transforma o TOM em assistente inseguro — corrige e segue, sem ajoelhar.
14. **Fato operacional vem do banco, não da memória da conversa.** Quando responder consultas de leitura ("como está minha semana?", "o que tenho hoje?", "minhas pendências", "minha agenda", "qual o status do X?"), use APENAS os campos que aparecem no contexto injetado (tasks, eventos, hábitos com seus campos). Se um campo é null/ausente no contexto, renderize como **ausência real** — NUNCA preencha com horários, dias ou detalhes que você "lembra" da conversa anterior. Memória conversacional pode ajudar a entender intenção; nunca pode preencher como fato um campo operacional ausente no banco.
   - Task com due_date mas sem remind_at → "📅 sexta (sem horário definido)", não "sexta às 10h" inventado.
   - Hábito sem reminder_time no contexto → "(sem horário agendado)", não inventar horário do briefing anterior.
   - Evento sem location_text → "(local não definido)", não inferir do contexto.
   - Se o user perguntou sobre algo que NÃO está no contexto injetado, responda "não tenho registro disso" — não invente.
15. **"O que combinamos ontem?" / "o que tá em aberto?" → olhe as tasks, não o histórico da conversa. JAMAIS INVENTE NOMES.** Quando o usuário perguntar sobre pendências, planejamentos, combinados anteriores ou itens em aberto ("me lembra o que ficou pendente", "o que combinamos?", "o que ficou da reunião de ontem?", "o que mais temos em aberto?", "tem algo sem data?"), o histórico de tarefas já está injetado acima em formato estruturado em DUAS seções: "Tarefas pessoais/trabalho hoje" (com prazo nos próximos 7 dias) e "Tarefas pendentes SEM prazo definido". Use APENAS o que está nessas seções + Agenda + Concluído. **NUNCA invente nomes de tarefas que viu em mensagens passadas (conversation_history) como se fossem pendências.** Se uma seção mostra "_nenhuma_", responda literalmente que não há nada cadastrado nessa categoria. Se não houver nenhuma task relevante em NENHUMA seção, diga "não vejo nada cadastrado sobre isso — quer que eu registre agora?". Confabular nome de task (ex: listar "Follow Up Moreira Jr." como aberta quando ela aparece só em msg antiga e não nas seções estruturadas) é falha grave — o engine vai rejeitar o marker com **all_failed** e o usuário fica confuso achando que registrou algo.
16. **NUNCA quebre o personagem falando de mecanismos internos.** Você é assistente operacional, não dev. JAMAIS diga "deixa eu verificar o código", "vou olhar o engine", "vou checar a skill", "vou ver como o sistema trata", "preciso entender como está implementado", "vou analisar o handler", ou qualquer variação que revele que existe código/engine/skill por trás. Quando o usuário pedir ação operacional (cadastrar/atualizar/mover/dar baixa/consultar inventário, criar task, agendar evento, etc), EMITA O MARKER imediatamente com os dados extraídos do pedido. Se o engine rejeitar, ele te avisa — você só responde "não consegui executar, pode reformular?" ou tenta outra variação. NUNCA expõe que está debugando.
17. **Pausa RECORRENTE de DIAS → PREFS_UPDATE POR CONTEXTO, perguntando antes.** Quando o user pedir pra parar de cobrar num padrão recorrente de dias — "não me cobra fim de semana", "não me cobra aos domingos", "só dias úteis", "para de me lembrar nos sábados", "não me incomoda no weekend" — o silêncio é SEPARADO entre **Trabalho** (atividades na LA Music) e **Pessoal** (vida e trabalhos fora da LA Music). Antes de emitir, PERGUNTE: "Isso é pro *Trabalho*, *Pessoal*, ou os dois?" — salvo se o user já deixou claro. Só então emita \`<<PREFS_UPDATE>>\` com as colunas DO CONTEXTO escolhido (Trabalho → sufixo \`_work\`; Pessoal → \`_personal\`; ambos → as duas). Mapeamento: "fim de semana" → \`{"quiet_weekends_work":true}\` (e/ou \`quiet_weekends_personal\`). Dias específicos → \`{"quiet_days_work":[0,6]}\` (0=domingo … 6=sábado). REATIVAR → \`{"quiet_weekends_work":false,"quiet_days_work":[]}\`. Só DEPOIS do marker confirme: "beleza, fim de semana fica silencioso no trabalho." Se prometer sem persistir, o ritual cobra de novo amanhã. (NUNCA grave as colunas globais antigas \`quiet_weekends\`/\`quiet_days\` — são legado; o app lê por contexto.)
17b. **Dia de folga dito DE PASSAGEM também é preferência — ofereça e persista.** Quase nunca a pessoa PEDE silêncio; ela informa o dia enquanto pede outra coisa: *"muda essa tarefa pra segunda pfvr, amanhã é domingo, n trabalho"* (Rose, 01/08) e *"Tom, hoje é domingo, marcar para segunda feira"* (Clayton, 19/07). Nos dois você atendeu o pedido imediato e respondeu certo — "domingo é folga 🙌", "Bom domingo!" — mas não gravou nada, e no domingo seguinte o briefing disparou de novo e virou reclamação. Então: quando alguém mencionar um dia em que não trabalha, **primeiro resolva o que ela pediu** e só depois ofereça, em UMA linha: "quer que eu pare de te acionar aos domingos?". Se confirmar, siga a regra 17 (perguntar contexto, emitir \`<<PREFS_UPDATE>>\` com \`quiet_days_work\`/\`_personal\`). Ofereça no máximo uma vez por conversa e não insista se ela não responder. **Nunca diga que não vai mais incomodar nesse dia sem ter emitido o marker** — sem ele, você vai incomodar.
18. **"Não me chama antes das Xh" → PREFS_UPDATE de horário POR CONTEXTO, perguntando antes (não DND).** Silêncio diário recorrente — "só a partir das 11h", "não me chama antes das 9h", "pode me contatar só depois das 13h" — também é separado entre **Trabalho** e **Pessoal**. PERGUNTE o contexto antes de emitir ("*Trabalho*, *Pessoal*, ou os dois?"), salvo se o user já disse. Emita \`<<PREFS_UPDATE>>\` com as colunas do contexto: Trabalho → \`quiet_start_time_work\`+\`quiet_end_time_work\`; Pessoal → as \`_personal\`; ambos → as duas. Mapeamento: "a partir das Xh" → \`{"quiet_start_time_work":"00:00","quiet_end_time_work":"HH:MM"}\`. "Silêncio de 22h às 8h" → start \`22:00\`, end \`08:00\`. Limpar → ambos \`null\`. **NÃO use \`do_not_disturb_until\`** (DND expira; quiet_hours é permanente). NUNCA grave \`quiet_start_time\`/\`quiet_end_time\` globais — legado.
18b. **Allowlist do que você consegue setar por chat — e o que NÃO.** Você PODE setar por chat: horários de briefing/planejamento/fechamento, foco do dia (máx tarefas/dia), intensidade de cobrança, toggles de notificação (prazo/atraso/resumo), voz, e o silêncio (regras 17–18). **Fora dessa lista — em especial LEMBRETES DE TAREFAS / check-ins (horários tipo 12h, 13h30 que o user quer ser lembrado das tarefas)** — você NÃO consegue configurar por aqui. NÃO diga que fez nem invente confirmação: oriente o caminho no app — "isso você ajusta em *Configurações → Lembretes de tarefas*". Regra de ouro: se não está no allowlist, mostre o caminho no PWA, nunca alucine que configurou.
19. **Marcar/ticar item de LISTA PESSOAL → \`<<PERSONAL_LIST_ACTION>>\` com \`toggle_item\`, NUNCA \`<<CHECKLIST_ACTION>>\`.** Quando o user pedir pra marcar/concluir/ticar/fechar um item que aparece no bloco **LISTAS PESSOAIS** do contexto (cada item vem com \`[item_id=...]\`) — ex: "marca a refeição da manhã", "concluí o almoço", "fecha o item X da minha lista", "marca no meu checklist pessoal" — emita \`<<PERSONAL_LIST_ACTION>>{"action":"toggle_item","item_id":"<uuid completo do item>","is_done":true}<<END>>\`. O \`<<CHECKLIST_ACTION>>\` é EXCLUSIVO de checklist operacional do dia (exige \`completion_id\`) — usá-lo pra lista pessoal é REJEITADO por schema e o item NÃO é marcado. **A palavra "checklist" dita pelo user NÃO muda isso**: lista pessoal sempre usa PERSONAL_LIST_ACTION. Se você só vê o item no contexto mas sem \`[item_id=...]\`, peça pro user confirmar qual lista antes.
20. **NUNCA confirme "marquei/salvei/concluí/agendei/fechei" sem ter emitido o marker correspondente NESTA resposta.** Se você não tem o id necessário, não sabe o formato certo, ou simplesmente não emitiu o marker — NÃO diga que fez. Pergunte ou diga "não consegui, pode reformular?". Responder "✅ Marcado!" quando o marker foi rejeitado ou nem foi emitido faz o user ver que nada mudou no app e perder a confiança no TOM. Confirmar = só depois de emitir o marker de verdade.
21. **Banco é AO VIVO — nunca invente "sincronização".** Tarefas, eventos, projetos e inventário são lidos em tempo real, sem atraso de propagação. NUNCA diga "delay de sincronização", "tá sincronizando", "demora a atualizar" ou "banco do meu lado" pra justificar por que algo aparece atrasado/pendente — é mentira; isso SÓ vale pra FATURA de cartão (Open Finance). Se o usuário afirma algo que o contexto contradiz (ex.: "mudei a data" mas a tarefa segue com o prazo antigo), diga a VERDADE com o dado do contexto ("aqui a tarefa X ainda tá com prazo <data> e em aberto") e ofereça acertar na hora. Nunca aceite a afirmação cegamente nem invente causa técnica. E nunca prometa "não cobro mais" — quem cobra é o ritual automático; ele só para quando a tarefa for reagendada/concluída/cancelada DE VERDADE.
`;

// ---------- BLOCK 2 — IDENTIDADE & EMOJIS (hardcoded, ~1KB) ----------
const BLOCK_IDENTITY = `# 👽 IDENTIDADE

TOM é um ET — homenagem ao ALF dos anos 80 (o criador, Luciano, atende pelo apelido "Alf"). Mas você atende VÁRIOS colaboradores da LA Music: fale SEMPRE com quem está em "Pessoa:" no contexto — nem sempre é o Alf. Tom da relação: dupla improvável (ET organizador + humano teimoso). Sem piadinha.

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

## Você ENXERGA mídia — imagem, foto, print, PDF, vídeo e áudio
Você CONSEGUE ler e analisar qualquer mídia que a pessoa enviar pelo WhatsApp: imagem, foto, print/captura de tela, PDF, vídeo e áudio. O sistema baixa e processa o arquivo automaticamente e o conteúdo já chega pra você como texto (marcado com "[O usuário ACABOU DE ENVIAR ...]").
- Se perguntarem "posso te mandar um PDF/foto/print/arquivo?", responda QUE SIM, pode mandar — você lê e processa (ex.: PDF de fatura → você extrai os lançamentos com valor, data e parcelas).
- NUNCA diga que "não consegue abrir arquivo", que "o WhatsApp não processa arquivo", nem peça print/screenshot de um PDF. É FALSO — você lê PDF direto.
- Só peça pra reenviar se a análise chegar vazia/ilegível (arquivo corrompido ou grande demais).
`;

// ---------- skill cache ----------
const { capSkill } = require('./skill-cap');
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
  // Fatia A — teto generoso (32KB cobre todas as skills atuais) + WARN se cortar
  // de verdade. Antes era slice(0,8192) silencioso, que decapitava 6 skills core.
  return capSkill(_skillCache[name], name);
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
    // AMANHA-POS-MEIA-NOITE (caso Rose 10/06 00:57): na madrugada (00–04h59 BRT),
    // "amanhã" da pessoa = o dia civil EM CURSO (a manhã que vai amanhecer).
    const hourBRT = parseInt(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23',
    }).format(new Date()), 10) % 24;
    targetDay = hourBRT < 5 ? todayISO : tomorrowISO; dayWord = 'amanhã';
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
function buildContext(collab, prefs, tasks, projects, lastMsgAge, habits, events, delegatedTasks, todayChecklists, teamAdherence, personalChecklists, teamTodayChecklists, teamExpectedTemplates, schoolEvents = [], eventTypes = [], doneFutureTasks = [], monthlyCtxBlock = null, orgChart = [], criticalMemories = [], preferenceMemories = [], weeklySummary = null, recentContextMemories = [], openTasksNoDue = [], recentNotes = [], workGroupsCtx = { groups: [], myGroupTasks: [] }, checklistTemplates = []) {
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
  // AMANHA-POS-MEIA-NOITE: na madrugada, "amanhã" falado quase sempre = HOJE civil.
  {
    const _h = parseInt(nowHHMM.slice(0, 2), 10) % 24;
    if (_h < 5) {
      lines.push(`**⚠️ MADRUGADA (${nowHHMM}):** quando a pessoa disser "amanhã" agora, ela quase sempre quer dizer HOJE ${todayISO} (${todayWD} — a manhã que vai amanhecer). Use ${todayISO}, a menos que ela diga data ou dia da semana explícitos.`);
    }
  }

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
  lines.push(`**REGRA DE OURO DAS DATAS:** Todas as tarefas e eventos no contexto abaixo JÁ TÊM o dia-relativo computado entre parênteses: \`(HOJE)\`, \`(amanhã)\`, \`(em Nd)\` ou \`(ATRASADA -Nd)\`. **NUNCA recalcule mentalmente.** Quando for cobrar/lembrar/relatar, use EXATAMENTE o rótulo entre parênteses. Se uma task diz \`28/05 qui (em 2d)\`, você fala "vence em 2 dias, quinta" — não fala "amanhã", não fala "hoje".`);
  lines.push('');

  const roleDisplay = ROLE_LABELS_PT[collab.role] || collab.role || '—';
  lines.push(`**Pessoa:** ${nickname} (${collab.full_name}) — ${roleDisplay}${fn}`);
  // PROJECT-PERM-SKILL-DESYNC (audit 15/06, Rafinha): o engine libera criar projeto/delegar
  // por hasCoordLevel (inclui has_coord_permissions), mas a skill gateava só por Role literal
  // → recusava quem tem permissão concedida. Expõe a permissão real pra os gates das skills.
  if (hasCoordLevel(collab) && collab.role !== 'coordinator' && collab.role !== 'director') {
    lines.push(`**Permissão operacional:** tem nível de COORDENAÇÃO (pode criar projeto, delegar tarefa pra outros, ver relatórios de equipe) — mesmo com o cargo acima. Use isso nos gates de permissão das skills.`);
  }
  lines.push(`⚠️ **Você está falando com ${nickname} agora. Trate SEMPRE esta pessoa por _${nickname}_ — nunca por outro nome.** Só use "Alf" se o nome acima em "Pessoa:" for o próprio Luciano Alf.`);
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

    // MEMORY-RELATIVE-DATE-ORPHAN (08/08): 31 memórias ATIVAS falam em "hoje/ontem/amanhã"
    // ("Yuri planeja enviar vídeos pro Peterson amanhã", registrada em 28/07). Renderizadas
    // sem data, o TOM lê "amanhã" semanas depois e resolve pro amanhã de HOJE — a mesma
    // família do auto-envenenamento que o chat de grupo já trata e o 1:1 não tratava.
    // Carimba só quem depende de quando foi dito (~7%); o resto passa intacto. O `created_at`
    // já vinha no select destes dois blocos e só não estava sendo usado.
    const _mem = (m) => carimbaMemoriaRelativa(m.content, m.created_at);

    if (criticalMemories && criticalMemories.length) {
      lines.push('', '**Crítico:**');
      criticalMemories.forEach(m => lines.push(`• [${m.memory_type}] ${_mem(m)}`));
    }

    if (preferenceMemories && preferenceMemories.length) {
      lines.push('', '**Preferências:**');
      preferenceMemories.forEach(m => lines.push(`• ${_mem(m)}`));
    }

    if (weeklySummary && weeklySummary.summary) {
      const wk = weeklySummary.week_start || '';
      lines.push('', `**Semana passada (a partir de ${wk}):**`, weeklySummary.summary);
    }

    if (recentContextMemories && recentContextMemories.length) {
      // Este é o bloco que MAIS precisa do carimbo: 29 das 31 memórias com termo relativo são
      // importance high/normal e chegam ao prompt só por aqui (busca semântica). O
      // `created_at` passou a vir na RPC match_memories em 08/08 justamente pra isto.
      lines.push('', '**Contexto recente (relevante à mensagem atual):**');
      recentContextMemories.forEach(m => lines.push(`• [${m.memory_type}] ${_mem(m)}`));
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
    // CTX-WINDOW-SORTPOS-BLIND (Rafinha 26/08): o prazo decide quem cabe na janela. Sem isto,
    // sort_position do DnD do PWA jogava tarefa de 31/08 na frente da de amanhã e o TOM dizia
    // "não vejo nada cadastrado" pra quinta com 3 tarefas no banco.
    // CTX-WINDOW-TETO-CEGO (27/08): o teto FIXO de 8 era o resto do mesmo bug — 8 dos 23
    // colaboradores têm mais de 8 abertas (maior fila: 132). Agora atrasadas + 14 dias entram
    // sempre, e o que ficar de fora é DECLARADO (ver aviso abaixo) — o TOM não pode negar
    // existência com base numa lista que ele sabe estar cortada.
    const { mostradas, ocultas } = selecionarJanela(arr, { hoje: today });
    mostradas.forEach((t, i) => {
      const sid = String(t.id || '').slice(0, 8);
      let timeBit = '';
      if (t.remind_at) {
        const remDay = dayFromAny(t.remind_at);
        if (remDay >= today) {
          // Lembrete futuro — usa como referência principal de hora.
          const time = fmtTimeForCtx(t.remind_at);
          const rel = remDay === today ? 'hoje' : remDay === tomorrowOf(today) ? 'amanhã' : remDay;
          timeBit = ` ⏰ ${time} (${rel})`;
        } else if (t.due_date) {
          // Bug 30/05: remind_at no passado (lembrete já disparado, task ainda aberta)
          // → mostra due_date como referência de prazo, não a data do lembrete vencido.
          const rel = t.due_date === today ? 'hoje' : t.due_date === tomorrowOf(today) ? 'amanhã' : t.due_date;
          timeBit = ` 📅 ${rel}`;
        }
      } else if (t.due_date) {
        const rel = t.due_date === today ? 'hoje' : t.due_date === tomorrowOf(today) ? 'amanhã' : t.due_date;
        timeBit = ` 📅 ${rel}`;
      }
      // Bug 30/05 (Kinho): overdue usava remind_at como referência, mas remind_at é
      // o lembrete — não o prazo. Uma task com remind_at ontem e due_date segunda-feira
      // NÃO está atrasada. Somente due_date < hoje define atraso real.
      const overdue = t.due_date && t.due_date < today ? '🔴 ' : '';
      const doneTag = t.status === 'done' ? '✅ ' : '';
      // Task 13 — selos de grupo: mãe recebe prefixo 🗂️ e sufixo (grupo); filha recebe sufixo · 🗂️ grupo
      const groupPrefix = t.is_group ? '🗂️ ' : '';
      const groupSuffix = t.is_group ? ' (grupo)' : (t.parent_task_id ? ' · 🗂️ grupo' : '');
      lines.push(`${i + 1}. [id=${sid}] ${overdue}${doneTag}${groupPrefix}${t.title}${groupSuffix}${timeBit}`);
      // Descrição (quando houver) — uma linha indentada abaixo do título.
      // Mantém lista escaneável mas expõe contexto pro TOM responder perguntas
      // tipo "pra que é essa ligação?" sem precisar abrir o detalhe.
      if (t.description && t.description.trim()) {
        const desc = t.description.trim().replace(/\s+/g, ' ');
        const truncated = desc.length > 240 ? desc.slice(0, 240) + '…' : desc;
        lines.push(`   ↳ ${truncated}`);
      }
      // Checklist (subtarefas) — progresso indentado abaixo da tarefa. Executor vê sem nome.
      const _cb = renderChecklistBlock(t._checklist || []);
      if (_cb) _cb.split('\n').forEach((l) => lines.push(`   ${l}`));
    });
    // O corte tem que ser DITO. Lista cortada em silêncio vira "não tem nada" — foi exatamente
    // isso com o Rafinha em 26/08. Aqui o TOM sabe que é parcial e que precisa perguntar/filtrar.
    if (ocultas > 0) {
      lines.push(`_⚠️ +${ocultas} tarefa(s) desta lista NÃO estão acima (prazo distante ou sem prazo). Lista PARCIAL: nunca responda que "não há nada" ou que algo não existe com base só nela — filtre pela data/assunto que a pessoa pediu antes de negar._`);
    }
  };

  const { renderChecklistBlock } = require('../services/checklist-render');
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

  // Sprint 31.2 — Tarefas pendentes SEM prazo definido.
  // SEMPRE renderiza o bloco (mesmo vazio) com label explícito.
  // Por que sempre: bug observado 28/05/2026 (Yuri). Sem o bloco, quando user
  // perguntava "o que tá em aberto sem data?", o LLM alucinava nomes de
  // conversation_history. Com "_nenhuma_" explícito, TOM responde a verdade.
  lines.push('', `**Tarefas pendentes SEM prazo definido (${(openTasksNoDue || []).length}):**`);
  if (openTasksNoDue && openTasksNoDue.length) {
    openTasksNoDue.slice(0, 20).forEach((t, i) => {
      const sid = String(t.id || '').slice(0, 8);
      const ctx = t.context === 'personal' ? 'pessoal' : t.context === 'work' ? 'trabalho' : t.context;
      const cat = t.category ? ` · ${t.category}` : '';
      lines.push(`${i + 1}. [id=${sid}] ${t.title} (${ctx}${cat})`);
      if (t.description && t.description.trim()) {
        const desc = t.description.trim().replace(/\s+/g, ' ');
        lines.push(`   ↳ ${desc.length > 200 ? desc.slice(0, 200) + '…' : desc}`);
      }
    });
    // Mesmo teto cego do bloco datado: 114 das 132 tarefas do maior acervo são SEM prazo, e o
    // corte em 20 era silencioso. Declara o resto (CTX-WINDOW-TETO-CEGO 27/08).
    const _semPrazoOcultas = Math.max(0, openTasksNoDue.length - 20);
    if (_semPrazoOcultas > 0) {
      lines.push(`_⚠️ +${_semPrazoOcultas} tarefa(s) sem prazo NÃO estão acima. Lista PARCIAL: não negue existência com base só nela._`);
    }
  } else {
    lines.push('_nenhuma_');
  }

  // 📒 Anotações (spec 2026-06-10) — caderninho do usuário (tabela notes). O TOM lê
  // daqui pra responder "me lê a anotação X"; anexa/compartilha via <<NOTE_ACTION>>.
  if (recentNotes && recentNotes.length) {
    lines.push('', `## 📒 Anotações recentes (${recentNotes.length} — app: Mais → Anotações)`);
    recentNotes.forEach((n, i) => {
      const sid = String(n.id || '').slice(0, 8);
      const first = String(n.body || '').split('\n').find((l) => l.trim()) || '';
      const shared = (n.shared_with || []).length ? ` · 👥 ${n.shared_with.length}` : '';
      lines.push(`• [id=${sid}] *${n.title}*${shared} — ${first.slice(0, 80)}`);
      if (i === 0) {
        const bodyCap = String(n.body || '').slice(0, 600);
        lines.push(`  ↳ conteúdo: ${bodyCap}${String(n.body || '').length > 600 ? '…' : ''}`);
      }
    });
    lines.push('_Pra anexar/compartilhar, emita <<NOTE_ACTION>> (skill anotacoes). Pra ler, cite o conteúdo acima — não invente o que não está aqui._');
  }

  // 👥 Grupos de trabalho (spec 2026-06-10) — pool de tarefas por grupo.
  if (workGroupsCtx && workGroupsCtx.groups && workGroupsCtx.groups.length) {
    lines.push('', '## 👥 Grupos de trabalho ativos');
    workGroupsCtx.groups.forEach((g) => {
      const lider = (g.members || []).find((m) => m.collaborator_id === g.leader_id);
      const nomes = (g.members || []).map((m) => (m.full_name || '').split(' ')[0]).filter(Boolean).join(', ');
      lines.push(`• *${g.name}* (líder: ${lider ? lider.full_name.split(' ')[0] : '—'}) — membros: ${nomes || '—'}`);
    });
    lines.push('_Pra criar tarefa DE GRUPO ("cria pro financeiro"): <<TASK>> create com "assigned_group":"<nome do grupo>" (SÓ os listados acima — NUNCA invente grupo; sem to_name junto). Tarefa de grupo: qualquer membro vê e conclui; a primeira pessoa que concluir fecha pra todas._');
    if (workGroupsCtx.myGroupTasks && workGroupsCtx.myGroupTasks.length) {
      const today = todaySaoPaulo();
      lines.push('', '**Tarefas abertas dos SEUS grupos (você também pode concluir):**');
      const { buildGroupPoolLines } = require('../utils/group-task-relay');
      for (const ln of buildGroupPoolLines(workGroupsCtx.myGroupTasks, workGroupsCtx.groups, today, formatRelativeDate, workGroupsCtx.parentTitleById)) {
        lines.push(ln);
      }
    }
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
      // Item 5 (Quintela/Luciano) — convite aguardando resposta: instrui o RSVP explícito.
      const rsvpTag = e._rsvpPending
        ? ` ⏳ *CONVITE AGUARDANDO SUA RESPOSTA* — se a pessoa disser sim/vou/confirmo → \`<<EVENT_UPDATE>>{"action":"rsvp","event_id":"${sid}","status":"confirmed"}<<END>>\`; não/recuso → "declined". NUNCA diga "confirmada" sem emitir esse marker.`
        : e._rsvpConfirmed
        ? ` ✅ *VOCÊ JÁ CONFIRMOU PRESENÇA* — NÃO peça confirmação de novo nem escreva "(confirma presença?)" pra este evento.`
        : e._rsvpTentative
        ? ` 🤔 você marcou "talvez" aqui — só pergunte se já decidiu se a pessoa tocar no assunto.`
        : '';
      // RSVP-OWNER-BLIND: evento que ESTE user criou e tem convidados → contador +
      // quem falta. Responde "falta quem confirmar?" sem inventar e sem dizer "não sei".
      let partTag = '';
      if (e.collaborator_id === collab.id && Array.isArray(e.event_participants) && e.event_participants.length > 0) {
        const tot = e.event_participants.length;
        const conf = e.event_participants.filter(p => p.status === 'confirmed').length;
        const waiting = e.event_participants
          .filter(p => p.status !== 'confirmed' && p.status !== 'declined')
          .map(p => (p.collaborator && p.collaborator.full_name || '').split(' ')[0])
          .filter(Boolean);
        partTag = ` · 👥 ${conf}/${tot} confirmaram${waiting.length ? ` — aguardando: ${waiting.join(', ')}` : ''}`;
      }
      lines.push(`• [id=${sid}] ${datePrefix}${start}–${end} ${mod} ${e.title}${statusTag}${cat}${where}${reminders}${partTag}${rsvpTag}`);
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
      const meta = (h.habit_type === 'quantitative' && Number(h.target_value) > 0)
        ? ` 📊 meta ${h.target_value}${h.unit ? ' ' + h.unit : ''}/dia (quantitativo)`
        : '';
      lines.push(`• [id=${sid}] ${h.icon || '💪'} ${h.name}${streak}${time}${meta}`);
    });
  }

  // Sprint 22.36 Fatia 2 — DELEGADAS (tarefas que ESTE user atribuiu pra outros).
  // Necessário pra TOM responder relatórios tipo "como tá meu dia, com delegadas".
  if (delegatedTasks && delegatedTasks.length) {
    lines.push('', `**Delegadas (${delegatedTasks.length}) — tarefas que você atribuiu pra outros:**`);
    delegatedTasks.slice(0, 15).forEach(t => {
      const assignee = (t.assignee && t.assignee.full_name) ? t.assignee.full_name.split(' ')[0] : '(?)';
      const due = t.due_date ? ` — vence ${formatRelativeDate(t.due_date, today) || t.due_date}` : '';
      const status = t.status ? ` — ${t.status}` : '';
      lines.push(`• ${assignee}: "${t.title}"${due}${status}`);
      // Checklist do executor (subtarefas) — delegador vê o progresso com o nome de quem executa.
      const _cb = renderChecklistBlock(t._checklist || [], { assigneeName: assignee });
      if (_cb) _cb.split('\n').forEach((l) => lines.push(`  ${l}`));
    });
  }

  // Modelos de checklist do time (demanda Jonathan 06/07): quando o usuário pedir
  // "com o checklist/modelo de X" ao criar/delegar tarefa, o TOM emite subtasks:[...]
  // copiando os itens EXATAMENTE (o engine já materializa as filhas no create).
  if (checklistTemplates && checklistTemplates.length) {
    lines.push('', '**Modelos de checklist do time** — se o usuário pedir "com o checklist/modelo de X" ao criar ou delegar tarefa, inclua no marker: subtasks:[...] copiando os itens EXATAMENTE como listados (sem parafrasear, sem omitir, sem acrescentar):');
    checklistTemplates.forEach((t) => {
      const items = Array.isArray(t.items) ? t.items : [];
      lines.push(`• ${t.name}: ${JSON.stringify(items)}`);
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

    // Desambiguação: colaboradores com apelidos alternativos
    const withAliases = orgChart.filter(c => Array.isArray(c.aliases) && c.aliases.length > 0);
    if (withAliases.length > 0) {
      lines.push('', '**Nomes alternativos / desambiguação:**');
      for (const c of withAliases) {
        const firstName = (c.full_name || '').split(' ')[0];
        const aliasStr = c.aliases.slice(0, 4).join(', ');
        const hint = c.function_title ? ` (${c.function_title})` : '';
        lines.push(`• "${firstName}"${hint} → tb. chamada de: ${aliasStr}`);
      }
      lines.push('  ⚠️ "Dai" e "Day" (sem qualificador) são AMBÍGUOS — podem ser qualquer uma das duas. SEMPRE pergunte antes de emitir marker: "Qual Day — a Dai pedagógica ou a Daiana do Recreio?"');
    }

    // Sprint 31 — Pessoas citadas → resolução + delegação com CONFIRMAÇÃO.
    // O Whisper agora transcreve os nomes certos (glossário) e o engine resolve
    // por nome (resolveCollaboratorByName) + action 'delegate'. Aqui fica a regra
    // de COMO agir: oferecer e confirmar antes, nunca sozinho ("Sugerir e confirmar").
    lines.push(
      '',
      '**Pessoas citadas — resolução + delegação:**',
      'Quando o usuário citar alguém do quadro como dono/alvo de uma tarefa, lembrete ou recado (ex.: "orientar o Peterson", "pedir pra Krissya avisar todos"):',
      '• Resolva o nome pelo cadastro acima (nome / apelido / função / unidade). Ambíguo (ex.: Dai) → pergunte qual.',
      '• Delegar/avisar a pessoa exige o "sim": ofereça e confirme — o recado/delegação só é enviado após o "sim" (o engine segura; você nunca envia pra ninguém sozinho). MAS não trave a lista nisso: processe as outras demandas e JUNTE essa confirmação com as demais numa única mensagem (Regra 5b).',
      '• Ao repassar uma fala do usuário pra outra pessoa, cite a fala LITERAL (verbatim), sem parafrasear.',
    );
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
// Roteadores de TÓPICO (banda 4.65/4.7/4.8). Nomeados porque rodam duas vezes: na banda de
// prioridade lendo a FALA REAL, e como último recurso lendo o texto cru — ver pickSkill.
const TOPIC_GERENCIA_RE = /(\brisco\s+de\s+evas|\bevas[ãa]o\b|\bretenç[ãa]o\b|\brecuperaç[ãa]o\s+(?:de\s+)?aluno|\bexperi[êe]ncia\s+da\s+unidade|\bproblema\s+de\s+atendimento|\barticul(?:ar|ação)\s+(?:recepç|secretari|coord)|\bgerente\b|\bger[êe]ncia\b|\bjereh\b|\bclayton\b|\bkrissya\b|\bnegoci(?:ar|ação)\s+(?:permanência|sa[ií]da|condiç)|\bpai\s+(?:insatisfeito|querendo\s+sair|reclamando\s+do\s+atendimento)|\baciona\s+(?:a\s+)?ger[êe]ncia|\brecepç[ãa]o\b|\bsecretari[ao]\b|\bpr[ée][\s-]?atendimento)/i;
const TOPIC_PEDAGOGICO_RE = /(\b(aluno[as]?|professor[a]?(?:es)?|turma[s]?|recital(?:is)?|banda[s]?|coordena[çc][ãa]o\s+pedag|assistent[ea]\s+pedag|mentor[ea]?\s+pedag|kids|school|infantil|musicaliza[çc][ãa]o|aula(?:s)?\s+(?:do|da|de))\b|\b(juliana|quintela|peterson|kinho|renan|matheus\s+felipe|jordan|leo|ramon|dai|rodrigo)\b)/i;
const TOPIC_OPERACOES_RE = /\b(sala\s+\d|ar.condicion|l[âa]mpada|equipamento[s]?|inst[ru]mento[s]?|infra(?:estrutura)?|manuten[çc][ãa]o|reposi[çc][ãa]o|estoque|teclado|amplificador|microfone|cabo[s]?|caixa\s+de\s+som|t[ée]cnico|incidente|baqueta[s]?|palheta[s]?|corda[s]?\s+(?:de|do|para|pra)|tinta|caneta|impressora|computador|wifi|internet)\b/i;

async function pickSkill(collab, lastUserMessage, recentHistory) {
  // SKILL-ROUTER-QUOTE-CONTAMINATION (caso Quintela 12-13/08): num reply-quote o webhook prepende
  // a mensagem CITADA do TOM à fala do usuário. Os roteadores de TÓPICO abaixo (gerencia 4.65 /
  // pedagogico 4.7 / operacoes-tecnicas 4.8) decidem por substantivo de domínio, então o título de
  // tarefa que o próprio TOM citou ("Onboard *professora* nova") sequestrava a rota e a
  // checklist-tarefas (priority 5) nunca carregava. Só ELES leem a fala real: medido em 215
  // reply-quotes de produção, aplicar o strip no pickSkill inteiro mudaria 133 rotas e deixaria 94
  // sem skill nenhuma — pior que a skill errada, porque aí o LLM improvisa o marker.
  const realUserMessage = stripReplyScaffold(String(lastUserMessage || '')).userText || lastUserMessage;

  // Priority 1: onboarding active.
  if (collab && collab.onboarding_completed === false) {
    return { name: 'onboarding', body: loadSkill('onboarding') };
  }

  // Sprint 27 — Educacao financeira (ANTES do financeiro): pergunta conceitual sobre
  // dinheiro/investimento. Escopado a frase de pergunta/conceito, pra nao roubar as
  // acoes (gastei/guardei) do financeiro-pessoal.
  const EDU_FIN_RE = /\b(o\s+que\s+[ée]\s+(?:a\s+)?(?:selic|cdb|tesouro|fgc|caixinha|poupan[çc]a)|como\s+(?:funciona|invisto|come[çc]o\s+a\s+guardar|fa[çc]o\s+pra\s+investir)|me\s+explica\s+(?:juros|selic|investiment)|vale\s+a\s+pena\s+investir|diferen[çc]a\s+entre|tesouro\s+direto|reserva\s+de\s+emerg[êe]ncia|50\/30\/20|juros\s+compost|como\s+investir)\b/i;
  if (EDU_FIN_RE.test(String(lastUserMessage || ''))) {
    return { name: 'educacao-financeira', body: loadSkill('educacao-financeira') };
  }

  // Sprint 27 — Financas pessoais: dinheiro, contas, metas, orcamento, contribuicao.
  // ANTES de recorrencia: frase de dinheiro/meta tem prioridade (ex: "guardei 500 pro carro"
  // e "todo dia 10 pagar aluguel" devem ir pro financeiro, nao virar tarefa recorrente).
  // FINANCE_RE extraído pra ./finance-gate.js (módulo testável — já regrediu 2x).
  const { FINANCE_RE } = require('./finance-gate');
  // Confirmação/correção de um lançamento que o TOM acabou de propor (ex: resumo de
  // comprovante "🧾 ... Grava?"). Nesse turno a resposta é curta ("grava"/"isso"/
  // "não, foi 200") e NÃO casa o FINANCE_RE — sem recarregar a skill, o TOM regredia
  // ("não tenho esse recurso"). Mantém a skill enquanto há proposta de comprovante aberta.
  const recentOutbound = (recentHistory || [])
    .slice(-3)
    .filter((m) => m && m.direction === 'outbound')
    .map((m) => (m.content || '').toLowerCase())
    .join(' ');
  const recentInbound = (recentHistory || [])
    .slice(-3)
    .filter((m) => m && m.direction !== 'outbound')
    .map((m) => (m.content || '').toLowerCase())
    .join(' ');
  // O TOM acabou de fazer uma pergunta de follow-up financeira (resumo "grava?",
  // "quanto foi?", "qual o valor?", pergunta de fonte) e o user responde curto
  // ("100"/"grava"/"no nubank") — esse turno NÃO casa o FINANCE_RE, então sem
  // recarregar a skill o TOM perde o contexto e regride/fabrica. Mantém a skill
  // enquanto há um follow-up financeiro aberto. (Emoji varia 🧾/💰 — não ancorar.)
  const financeFollowupRe = /grava\?|quanto\s+foi|qual\s+(?:foi\s+)?o?\s*valor|de\s+qual\s+conta|saiu\s+de\s+qual|caiu\s+em\s+qual|cart[ãa]o\s+ou\s+conta|em\s+qual\s+(?:dos\s+seus|cart)/i;
  const financeProposalOpen = financeFollowupRe.test(recentOutbound)
    || /comprovante financeiro/i.test(recentInbound);
  const shortReply = String(lastUserMessage || '').trim().length < 40;
  // Listagem de gastos aberta: o TOM prometeu "vou registrando um por um" → mantém a skill
  // em QUALQUER linha com número (ex: "Estacionamento: R$ 90", "Ifood 100"), mesmo sem verbo.
  // Sem isso, a linha-de-valor não casava o FINANCE_RE, a skill caía e o TOM regredia
  // ("não existe marker pra isso") — caso Rafinha 03/06.
  const listingOpen = /vai\s+listando|vou\s+(?:ir\s+)?registrando|listando\s+os\s+gastos|registrando\s+um\s+por\s+um/i.test(recentOutbound);
  const hasNumber = /\d/.test(String(lastUserMessage || ''));
  // RECUSA-FALSA-CAI-COM-SKILL (Rose 16/07): continuação de um fluxo de FATURA/lançamento em lote
  // ("faltam lançar R$ X" no outbound + "lança o que falta" do user) não tem palavra de dinheiro,
  // então a skill de finança caía — e a rede que intercepta a recusa falsa ("não consigo lançar
  // por aqui") cai junto, porque é gateada por skill_active==='financeiro-pessoal'. Mantém finança
  // viva na continuação. Sinal isolado em finance-continuation.js (narrow: exige fatura no outbound).
  const { financeInvoiceContinuation } = require('./finance-continuation');
  const invoiceContinuation = financeInvoiceContinuation({ userText: lastUserMessage, recentOutbound });
  if (FINANCE_RE.test(String(lastUserMessage || '')) || (financeProposalOpen && shortReply) || (listingOpen && hasNumber) || invoiceContinuation) {
    let body = loadSkill('financeiro-pessoal');
    try {
      const [accts, cards] = await Promise.all([
        financeService.listAccounts(collab.id),
        financeService.listCards(collab.id),
      ]);
      const linhas = [
        ...accts.map((a) => `• ${a.name}${a.is_primary ? ' ⭐ (principal)' : ''} (carteira)`),
        ...cards.map((c) => `• ${c.name} (cartão)`),
      ];
      body += `\n\n## Fontes deste usuário (use pra resolver/perguntar a origem — NUNCA cite saldo)\n${linhas.join('\n') || '• (nenhuma cadastrada ainda)'}\n• Dinheiro (carteira)`;
      const _cats = await financeService.listCategorySlugs(collab.id).catch(() => []);
      const _custom = _cats.filter((c) => c.collaborator_id);
      if (_custom.length) {
        body += `\n\n## Categorias personalizadas deste usuário (use quando casar; NUNCA invente/crie categoria)\n`
          + _custom.map((c) => `• ${c.label} (${c.type === 'income' ? 'receita' : 'despesa'}) → slug "${c.slug}"`).join('\n');
      }
    } catch { /* contexto opcional — não bloqueia */ }
    // Blindagem Open Finance: se o usuário tem Pluggy conectado, anexa a skill conta-real
    // (o que vê/não vê, conciliação, vetos anti-alucinação). (Fase D)
    try { if (await financeService.hasPluggyItems(collab.id)) body += `\n\n${loadSkill('conta-real')}`; } catch { /* opcional */ }
    return { name: 'financeiro-pessoal', body };
  }

  // Sprint 30 — Skill lembrete-recorrente: ativa quando user pede pra ser
  // lembrado REPETIDAMENTE de uma rotina (hora em hora / vários horários por
  // dia). Tem prioridade sobre criar-recorrencia pra montar UMA tarefa
  // recorrente com MÚLTIPLOS reminders, nunca N tarefas iguais.
  const HOURLY_REMINDER_RE = /de\s+hora\s+em\s+hora|a\s+cada\s+hora|v[áa]rios\s+lembretes|me\s+(?:lembra|cobra|avisa)\s+.*\b(?:todo\s+dia|de\s+hora\s+em\s+hora|a\s+cada\s+hora|v[áa]rios|das?\s+\d{1,2}\s*h?\s*[àa]s?\s+\d{1,2})|\bdas?\s+\d{1,2}\s*h?\s*[àa]s?\s+\d{1,2}\s*h?\b.*(?:lembr|cobr|avis|hora\s+em\s+hora|a\s+cada)/i;
  // Confirmação de uma proposta de lembrete recorrente que o TOM acabou de fazer
  // (ex: "Vou criar UMA tarefa recorrente ... de hora em hora ... Confirma?"). Nesse
  // turno a resposta é curta ("confirmo"/"sim"/"pode") e NÃO casa o HOURLY_REMINDER_RE
  // — sem recarregar a skill, o TOM regredia e criava UMA tarefa simples (sem
  // recurrence_rule nem reminders). Mesmo padrão do financeProposalOpen acima.
  const recurringReminderProposalOpen = /tarefa\s+recorrente|de\s+hora\s+em\s+hora|\d+\s*avisos?\s*\/?\s*dia|lembrete\s+de\s+hora\s+em\s+hora|recorrente.*lembrete/i.test(recentOutbound);
  if (HOURLY_REMINDER_RE.test(String(lastUserMessage || '')) || (recurringReminderProposalOpen && shortReply)) {
    return { name: 'lembrete-recorrente', body: loadSkill('lembrete-recorrente') };
  }

  // Auditoria 30/06 — Skill fechar-projeto: ativa quando user pede pra fechar/concluir
  // ou cancelar um PROJETO. O engine trata a ação determinística (confirm-first); a skill
  // é a rede anti-confabulação pros casos que caem no LLM (não inventar "fechei o projeto").
  const CLOSE_PROJECT_RE = /\b(fech(?:a|ar|o|ei)|conclu[ií](?:r|do|da|o)?|encerr(?:a|ar)|finaliz(?:a|ar)|cancel(?:a|ar|o))\b[^.?!]*\bprojetos?\b/i;
  if (CLOSE_PROJECT_RE.test(String(lastUserMessage || ''))) {
    return { name: 'fechar-projeto', body: loadSkill('fechar-projeto') };
  }

  // Sprint 29.4 — Skill de recorrência (todos os roles): ativa quando user
  // pede ação que se repete no tempo. Tem prioridade sobre criar-compromisso
  // pra evitar TOM materializar manualmente várias rows.
  const RECURRENCE_RE = /todo\s+(?:dia|m[eê]s|ano|natal)|toda\s+(?:segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado|domingo|semana)|a\s+cada\s+\d+\s+(?:dia|semana|m[eê]s|ano)|(?:[uú]ltim[ao]|primeir[ao]|segund[ao]|terceir[ao]|quart[ao])\s+(?:segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado|domingo|dia\s+do\s+m[eê]s)|dia\s+[uú]til|fim\s+de\s+semana|mensal|semanal|di[áa]rio|anual|quinzenal|trimestral|recorrente|que\s+se\s+repete|repete\s+(?:toda|todo|a\s+cada)|todo\s+dia\s+\d+/i;
  if (RECURRENCE_RE.test(String(lastUserMessage || ''))) {
    return { name: 'criar-recorrencia', body: loadSkill('criar-recorrencia') };
  }

  // Sprint 29.2 — Skill briefing-pre-1on1: ativa quando director pergunta
  // sobre líder específico ou sobre um briefing recebido.
  if (collab && collab.role === 'director') {
    const BRIEFING_RE = /briefing|me\s+explica\s+(?:esse|isso|o)|resumo\s+(?:do|da|de)\s+\w+|por\s+que\s+(?:a|o)\s+\w+\s+t[áa]|o\s+que\s+combinei|combinamos\s+com|pra\s+1\s*:\s*1\s+com|antes\s+da?\s+(?:reuni[ãa]o|1\s*:\s*1)/i;
    if (BRIEFING_RE.test(String(lastUserMessage || ''))) {
      return { name: 'briefing-pre-1on1', body: loadSkill('briefing-pre-1on1') };
    }
  }

  // Sprint 29.3 — Skill scorecard-semanal: ativa pra director OU manager/coord
  // quando pergunta sobre o scorecard (recebido segunda 8h/9h).
  if (collab && (collab.role === 'director' || collab.role === 'manager' || collab.role === 'coordinator' || collab.has_coord_permissions === true)) {
    const SCORECARD_RE = /scorecard|fechamento|closure|minha\s+semana|sua\s+semana|nossa\s+semana|melhor\s+semana|pior\s+(?:semana|bottleneck)|comparativo|comparar.*(?:semana|m[eê]s)|evolu[çc][ãa]o\s+(?:do|da)\s+\w+|delta/i;
    if (SCORECARD_RE.test(String(lastUserMessage || ''))) {
      return { name: 'scorecard-semanal', body: loadSkill('scorecard-semanal') };
    }
  }

  // Sprint 29.1 — Skills de governança: sanitizar/diagnosticar/escalar.
  // Carrega TODAS quando contexto for de governança (director + gatilho específico).
  // Empilhamos as 3 num único body porque pickSkill retorna 1 skill.
  if (collab && collab.role === 'director') {
    const msgLower = String(lastUserMessage || '').toLowerCase();
    const GOV_RE = /governan[çc]a|enrolando|atrasad[ao]|cobra(?:r|nça)?\b|panor[aâ]ma|me\s+d[áa]\s+um\s+resumo|como\s+t[áa]\s+(?:o\s+|meu\s+|a\s+)?(?:time|equipe)|(?:é|s[ãa]o|aí\s+é)\s+teste|tira[r]?\s+da\s+lista|arquiv[ao]r?\s|j[aá]\s+rolou|j[aá]\s+aconteceu|descarta|ignora\s+isso|j[aá]\s+(?:fechou|terminei|conclu[ií])|esquece\s+(?:essa|esse|isso)|(?:isso|essa|esse)\s+[eé]\s+(?:d[ao]|do)\s+\w+|manda\s+pr[oa]\s+\w+\s+cobrar|quem\s+cobra\s+(?:isso|essa|esse)|repassa\s+(?:pra|para)\s+\w+/i;
    if (GOV_RE.test(msgLower)) {
      const parts = [
        loadSkill('governanca-sanitizar'),
        loadSkill('governanca-diagnosticar'),
        loadSkill('governanca-escalar'),
        loadSkill('governanca-redelegacao'),
      ].filter(Boolean);
      if (parts.length > 0) {
        return { name: 'governanca-completa', body: parts.join('\n\n---\n\n') };
      }
    }
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
    // LISTA-TRABALHO-ROUTING-AUDIO (Rafinha 17/08, re-audit 20/08): adição EXPLÍCITA a
    // lista/checklist é alto valor e o tratamento-audio a roubava — o roteador de listas
    // (4.9) nunca era alcançado por áudio, então TODO pedido de lista por voz caía no beco
    // "não consegui registrar". Mesmo precedente do inProjectFlow logo acima: roteia direto
    // pra listas-pessoais (pula o gauntlet de routers entre 1.4 e 4.9). Sinal isolado em
    // lista-add-signal.js, robusto ao prefixo — a MESMA regra que o 4.9 usa (sem divergir).
    const { isExplicitListAdd } = require('./lista-add-signal');
    if (isExplicitListAdd(lastUserMessage)) {
      return { name: 'listas-pessoais', body: loadSkill('listas-pessoais') };
    }
    return { name: 'tratamento-audio', body: loadSkill('tratamento-audio') };
  }

  // Priority 1.5: do_not_disturb intent — preempts everything else.
  // Catches: "agora não", "não me incomoda", "tô em aula/reunião/dirigindo",
  // "me chama em N h/min", "depois", "mais tarde", "pode falar" (clear).
  if (/\b(agora\s+n[aã]o|n[aã]o\s+(?:posso|d[aá])\s+(?:falar|atender)|n[aã]o\s+me\s+(?:incomoda|atrapalha|chama)|t[oô]\s+(?:em\s+)?(?:aula|reuni[aã]o|dirigindo|ocupad[oa]\s+agora|no\s+m[eé]dico)|me\s+(?:chama|lembra|liga)\s+(?:em|daqui)\s+\d+\s*(?:h|horas?|min|minutos?)|(?:s[oó]\s+)?(?:depois|mais\s+tarde)\s*$|pode\s+falar\s+agora|voltei|liberad[oa]\s+agora)/i.test(lastUserMessage || '')) {
    return { name: 'pausa-temporaria', body: loadSkill('pausa-temporaria') };
  }

  // Priority 1.55 — FOLGA-DND-ROUTING (audit 18/08, Dai): folga DECLARADA de HOJE precisa virar
  // DND até o fim do dia, senão os rituais da noite cobram na folga (a infra de silêncio existe,
  // mas nada a aciona). O 1.5 acima só pega pedido explícito de pausa; "tô de folga hoje" é estado,
  // não "me pausa". Aqui roteamos pra `pausa-temporaria` (que ensina o DND-até-EOD), com guards:
  // NÃO em folga FUTURA ("amanhã é folga"), NEGADA ("não tô de folga") nem de TERCEIRO ("folga do X").
  {
    const _fx = String(lastUserMessage || '');
    const _folgaHoje = /\b(?:t[oô]|est(?:ou|ô)|to)\s+(?:de\s+)?folga\b|\bminha\s+folga\b|\bdia\s+de\s+folga\b|\bfolga\s+hoje\b|\bde\s+folga\s+hoje\b|\bhoje\s+(?:é|eh|foi|tô|to|est(?:ou|ô))\s+(?:de\s+|minha\s+)?folga\b/i;
    const _folgaFuturo = /amanh[ãa]|semana\s+que\s+vem|pr[oó]xim[ao]|\b(?:s[aá]bado|domingo|segunda|ter[çc]a|quarta|quinta|sexta)\b/i;
    const _folgaNaoAgora = /\bn[aã]o\s+(?:t[oô]|est(?:ou|ô)|to)\s+(?:de\s+)?folga\b|\bsem\s+folga\b|\bfolga\s+d[eo]\s+[A-ZÀ-Ý]/;
    // "hoje" explícito ancora a folga NO DIA — ignora palavra de futuro solta na mesma frase
    // ("hoje tô de folga, mas amanhã te passo"; "hoje é domingo tô de folga"). Sem "hoje",
    // exige presente 1ª pessoa e nenhuma palavra de futuro (senão é folga futura).
    const _folgaAncoraHoje = /\bhoje\b/i.test(_fx);
    if (_folgaHoje.test(_fx) && !_folgaNaoAgora.test(_fx) && (_folgaAncoraHoje || !_folgaFuturo.test(_fx))) {
      return { name: 'pausa-temporaria', body: loadSkill('pausa-temporaria') };
    }
  }

  // Priority 1.6 — Sprint VoiceToggle: opt-in/opt-out de áudios.
  // Captura "para de mandar áudio", "sem áudio", "desliga voz", "manda áudio
  // de novo", "liga voz", "saudades dos áudios" etc. NÃO captura "tô sem fone"
  // (DND temporário) nem "manda menos áudio" (não tem setting intermediário).
  if (/\b(?:(?:para|chega|sem|desativ|desliga|n[aã]o\s+(?:quero|manda|mande))\s+(?:de\s+(?:mandar|enviar)\s+)?(?:os?\s+)?[aá]udios?|s[oó]\s+texto|prefiro\s+texto|desliga\s+(?:a\s+)?voz|(?:pode\s+)?(?:volta(?:r)?|liga(?:r)?|ativa)\s+(?:a\s+)?(?:voz|com\s+)?(?:os?\s+)?[aá]udios?|saudad(?:es)?\s+(?:da\s+|dos?\s+)?(?:voz|[aá]udios?)|[aá]udio\s+(?:de\s+volta|liberad[oa]|sim)|quero\s+[aá]udio\s+de\s+volta)/i.test(lastUserMessage || '')) {
    return { name: 'preferencias-voz', body: loadSkill('preferencias-voz') };
  }

  // Trigger: skill de anotações (caderninho do usuário, spec 2026-06-10) —
  // "cria uma anotação", "anota aí", "adiciona na anotação", "compartilha a anotação".
  if (/\banota(?:[çc][ãa]o|[çc][õo]es)\b|\banota\s+(?:a[ií]|isso|essa|pra\s+mim)|\bfa(?:z|ça)\s+uma\s+anota|adiciona\s+na\s+anota|compartilha\s+a\s+anota|cria(?:r)?\s+uma\s+anota/i.test(lastUserMessage || '')) {
    return { name: 'anotacoes', body: loadSkill('anotacoes') };
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
  const canManageChecklists = collab && (['director', 'coordinator', 'manager'].includes(collab.role) || hasCoordLevel(collab))
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
  if (hasCoordLevel(collab)) {
    const lm = (lastUserMessage || '').trim();
    // F2 (APROVACAO-SEM-FUNIL): gate alargado — "Aprovado"/"Aprovar"/"rejeitado" não
    // casavam /aprov[oa]$/ (mesma família regex do ALIGN-AMANHA) e a skill nem entrava.
    // O intercept determinístico do engine resolve antes; isto é fallback do LLM.
    if (/^(APROVA|REJEITA)\b/i.test(lm) || /^(aprov|rejeit)\w*\s*$/i.test(lm)) {
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
  if (TOPIC_GERENCIA_RE.test(realUserMessage || '')) {
    return { name: 'gerencia', body: loadSkill('gerencia') };
  }

  // Sprint 19 — Priority 4.7: contexto PEDAGÓGICO (vence checklist-tarefas e operacoes-tecnicas).
  // Gatilhos: aluno/professor/turma/recital/banda/kids/school + nomes da equipe pedagógica.
  // Quando dispara, TOM usa skill pedagogico.md como PRIMARY → emite TASK_UPDATE com department_id pedagogico.
  if (TOPIC_PEDAGOGICO_RE.test(realUserMessage || '')) {
    return { name: 'pedagogico', body: loadSkill('pedagogico') };
  }
  // Sprint 19 — Priority 4.8: contexto OPERAÇÕES TÉCNICAS (infra/equipamento/material).
  // Vence apenas se NÃO for pedagógico. Garante department_id=operacoes-tecnicas no marker.
  if (TOPIC_OPERACOES_RE.test(realUserMessage || '')) {
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
  // listsExplicitRe / listsAddToRe vêm de lista-add-signal.js (fonte única — o bypass de
  // áudio da priority 1.4 usa a MESMA regra; duplicar aqui deixaria as duas divergirem).
  const { LISTS_EXPLICIT_RE: listsExplicitRe, LISTS_ADD_TO_RE: listsAddToRe } = require('./lista-add-signal');
  const listsMarkDoneRe = /\b(?:j[aá]\s+)?(?:comprei|tomei|peguei)\s+(?:o|a|os|as)?\s*\w/i;
  if (
    listsExplicitRe.test(lmLists) ||
    (listsActionRe.test(lmLists) && listsTopicRe.test(lmLists)) ||
    listsAddToRe.test(lmLists) ||
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
  if (hasCoordLevel(collab)
      && /(la\s*educa|estagi[áa]rios?|mentor(?:i?a)?|ancoragem|certificado\s*alfa|trilha)/i.test(lastUserMessage || '')) {
    return { name: 'la-educa', body: loadSkill('la-educa') };
  }

  // Último recurso: os roteadores de tópico lendo o texto CRU (com a citação). Acima eles leem só
  // a fala real, pra não sequestrar a rota de quem só respondeu "feito" a uma cobrança — mas se
  // NADA mais casou, skill errada ainda é melhor que skill nenhuma: sem skill o LLM não tem
  // template de marker e improvisa (28/04, marker em YAML, parser dropou, "Anotado" virou mentira).
  // Sem isto, o strip acima criaria 15 buracos novos nos 215 reply-quotes medidos em produção.
  if (TOPIC_GERENCIA_RE.test(lastUserMessage || '')) {
    return { name: 'gerencia', body: loadSkill('gerencia') };
  }
  if (TOPIC_PEDAGOGICO_RE.test(lastUserMessage || '')) {
    return { name: 'pedagogico', body: loadSkill('pedagogico') };
  }
  if (TOPIC_OPERACOES_RE.test(lastUserMessage || '')) {
    return { name: 'operacoes-tecnicas', body: loadSkill('operacoes-tecnicas') };
  }

  return null;
}

// ---------- DB fetch ----------
async function fetchCollaboratorContext(collaborator) {
  const id = collaborator.id;
  const today = todaySaoPaulo();
  const next7days = (() => { const d = new Date(today + 'T15:00:00.000Z'); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const past7days = (() => { const d = new Date(today + 'T15:00:00.000Z'); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
  // CTX-WINDOW-TETO-CEGO (27/08) — a BUSCA é o gate de verdade do bloco de tarefas: `lte(due_date,
  // next7days)` fazia tarefa do dia 8+ nunca chegar ao renderizador, então nenhuma janela de render
  // podia mostrá-la. Alinha a busca ao MESMO horizonte que o `selecionarJanela` promete — senão a
  // janela mente sobre a cobertura. Medido: +63 linhas na org inteira; o teto por caracteres do
  // render continua sendo o freio do prompt. Só o bloco de tarefas usa isto (eventos e
  // done-futuro seguem em 7 dias de propósito).
  const horizonteTarefas = (() => { const d = new Date(today + 'T15:00:00.000Z'); d.setDate(d.getDate() + HORIZONTE_DIAS); return d.toISOString().slice(0, 10); })();
  const TASK_COLS = 'id, title, description, status, priority, eisenhower_quadrant, due_date, context, remind_at, project_id, projects(name), parent_task_id, is_group, recurrence_rule, recurrence_parent_id';

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
    recentMediaRes,
  ] = await Promise.all([
    supabase.from('collaborator_profiles').select('*').eq('collaborator_id', id).maybeSingle(),
    supabase.from('user_preferences').select('*').eq('collaborator_id', id).maybeSingle(),
    // Sprint 22.29 (Bucket 6) — sort_position primeiro pra TOM respeitar a
    // ordem manual definida pelo user no PWA (DnD na Hoje). Demais orders
    // viram tiebreak pra tasks sem sort_position definido.
    supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id).lte('due_date', horizonteTarefas).eq('context', 'personal')
      .not('status', 'in', '(done,cancelled)')
      .order('sort_position', { ascending: true, nullsFirst: false })
      // Bug 30/05 (Juh/Bianca): remind_at antes de due_date fazia tasks com lembrete
      // futuro ocupar todos os slots do max_daily_tasks, empurrando tasks com
      // due_date=hoje (sem remind_at) para fora do slice. Correto: due_date define
      // urgência real; remind_at é tiebreak dentro do mesmo dia.
      .order('due_date', { ascending: true })
      .order('remind_at', { ascending: true, nullsFirst: false })
      .order('eisenhower_quadrant', { ascending: true, nullsFirst: false }),
    supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id).lte('due_date', horizonteTarefas).eq('context', 'work')
      .not('status', 'in', '(done,cancelled)')
      .order('sort_position', { ascending: true, nullsFirst: false })
      .order('due_date', { ascending: true })
      .order('remind_at', { ascending: true, nullsFirst: false })
      .order('eisenhower_quadrant', { ascending: true, nullsFirst: false }),
    supabase.from('project_members').select('project_id').eq('collaborator_id', id),
    supabase.from('notifications')
      .select('notification_type, title, body, reference_id, reference_type, created_at, status')
      .eq('collaborator_id', id)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: false }).limit(8),
    // Histórico no contexto do LLM. limit(5) era baixo demais → o TOM "esquecia" o que foi
    // combinado >5 msgs atrás em conversas longas (Rose 14/06, lançar fatura). 30 cobre ~15
    // turnos; formatMessages trunca mensagens longas (cards/listas) pra não pesar o custo.
    supabase.from('conversation_history')
      .select('direction, content, created_at')
      .eq('collaborator_id', id)
      .order('created_at', { ascending: false }).limit(30),
    supabase.from('habits')
      .select('id, name, icon, current_streak, frequency, reminder_time, habit_type, target_value, unit')
      .eq('collaborator_id', id).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(20),
    // Compromissos próximos 7 dias em America/Sao_Paulo (-03:00). Inclui scheduled e done.
    // Fix 2026-05-15: inclui também eventos onde o user é PARTICIPANTE (event_participants),
    // não só os owned. Antes, convites de terceiros (ex: Juliana convidando Luciano) sumiam
    // do contexto e TOM se confundia com lembretes/datas.
    (async () => {
      const SELECT_COLS = 'id, collaborator_id, title, start_at, end_at, modality, category, context, location_text, meeting_url, status, event_reminders(remind_at, sent_at)';
      // RSVP-OWNER-BLIND (caso Rose 09/06): o DONO do evento precisa ver quem
      // confirmou/falta — sem isso o TOM dizia "não tenho a lista" com 5/7 no banco.
      // Embed só no caminho owned (FK explícita: a tabela tem 2 FKs pra collaborators).
      const OWN_COLS = SELECT_COLS + ', event_participants(status, collaborator:collaborators!event_participants_collaborator_id_fkey(full_name))';
      const lo = `${today}T00:00:00-03:00`;
      const hi = `${next7days}T23:59:59-03:00`;
      const [own, parts] = await Promise.all([
        supabase.from('events').select(OWN_COLS)
          .eq('collaborator_id', id).gte('start_at', lo).lte('start_at', hi)
          .neq('status', 'cancelled').order('start_at', { ascending: true }).limit(30),
        supabase.from('event_participants')
          .select(`status, responded_at, event:events(${SELECT_COLS})`)
          .eq('collaborator_id', id).neq('status', 'declined'),
      ]);
      const map = new Map();
      for (const e of (own.data || [])) map.set(e.id, e);
      for (const p of (parts.data || [])) {
        const e = p.event;
        if (!e || map.has(e.id)) continue;
        if (e.status === 'cancelled') continue;
        const t = new Date(e.start_at).getTime();
        if (t >= new Date(lo).getTime() && t <= new Date(hi).getTime()) {
          // Item 5 — convite ainda não respondido: flag pra TOM reconhecer "sim/não" como RSVP.
          if (p.status === 'invited' && !p.responded_at) e._rsvpPending = true;
          // EV-LEAK (08/06) — RSVP JÁ respondido precisa aparecer no contexto, senão a IA
          // re-pede "(confirma presença?)" num evento já confirmado e confunde o "sim" do
          // usuário com o convite errado (caso Clayton 08/06: Love Song já confirmado 05/06
          // foi re-perguntado no briefing e roubou o "sim" da Reunião Governança).
          else if (p.status === 'confirmed') e._rsvpConfirmed = true;
          else if (p.status === 'tentative') e._rsvpTentative = true;
          map.set(e.id, e);
        }
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
          .select('id, full_name, unit, role, aliases, preferred_name, manager:collaborators!supervisor_id(id, full_name)')
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
    // MEDIA-IMG-CONTEXT-LOST (Rose 11/06): mídias recentes que o usuário enviou, com a
    // análise persistida (media_extracted_text). Sobrevive à janela de 5 msgs do histórico
    // — repinado no system prompt pra o TOM não dizer "não recebi a imagem" turnos depois.
    supabase.from('conversation_history')
      .select('media_type, media_extracted_text, created_at')
      .eq('collaborator_id', id)
      .eq('direction', 'inbound')
      .not('media_extracted_text', 'is', null)
      .gte('created_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false }).limit(3),
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

  // Task 13 — filtro anti-template: filhas de mães-template (is_group=true + recurrence_rule)
  // não devem aparecer no contexto como tarefas normais (confundem o TOM com datas aleatórias).
  // As queries principais não filtram recurrence_rule, então excluímos em JS pós-fetch.
  let templateGroupIds = new Set();
  try {
    const { data: templateGroups } = await supabase
      .from('tasks')
      .select('id')
      .eq('assigned_to', id)
      .eq('is_group', true)
      .not('recurrence_rule', 'is', null);
    for (const g of (templateGroups || [])) templateGroupIds.add(g.id);
  } catch (_) { /* não-fatal */ }

  // Balde A (audit 19/06): dedup por série — instâncias da mesma recorrência colapsam numa
  // só. Antes, as ~22 cópias materializadas (horizonte 30d) viravam 22 linhas no briefing/
  // fechamento (a mesma tarefa repetida). Dedup ANTES do slice(max_daily) pra não desperdiçar
  // as 3 vagas com duplicatas. Função pura, testada em utils/recurring-dedup.test.js.
  const { dedupRecurringSeries } = require('../utils/recurring-dedup');
  const personalTasks = dedupRecurringSeries((personalRes.data || []).filter(
    (t) => !(t.is_group && t.recurrence_rule != null) && !templateGroupIds.has(t.parent_task_id)
  ));
  const workRaw = dedupRecurringSeries((workRes.data || []).filter(
    (t) => !(t.is_group && t.recurrence_rule != null) && !templateGroupIds.has(t.parent_task_id)
  ));

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
    doneFutureTasks = (doneFuture || []).filter(
      (t) => !templateGroupIds.has(t.parent_task_id) && !(t.is_group && t.recurrence_rule != null)
    );
  } catch (_) { /* não bloqueia se falhar */ }

  // Sprint 31.2 — Tarefas PENDENTES sem prazo definido (due_date IS NULL).
  // Por que existe: bug observado 28/05/2026 (Yuri). Quando user pergunta
  // "o que está em aberto?", a query principal só pega tasks com due_date
  // dentro dos próximos 7 dias. Tasks sem prazo eram invisíveis ao TOM, que
  // alucinava nomes do conversation_history (4 tasks done listadas como abertas).
  // Limite 20 pra cobrir backlog sem inflar prompt.
  let openTasksNoDue = [];
  try {
    const { data: noDue } = await supabase.from('tasks')
      .select(TASK_COLS)
      .eq('assigned_to', id)
      .eq('status', 'pending')
      .is('due_date', null)
      .order('created_at', { ascending: false })
      .limit(20);
    openTasksNoDue = (noDue || []).filter(
      (t) => !templateGroupIds.has(t.parent_task_id) && !(t.is_group && t.recurrence_rule != null)
    );
  } catch (_) { /* não bloqueia se falhar */ }

  // 📒 Anotações recentes (spec 2026-06-10) — limit 5, não bloqueia se falhar.
  let recentNotes = [];
  try {
    recentNotes = await require('../services/notes').listRecentNotes(supabase, id, 5);
  } catch (_) { /* sem anotações no contexto */ }

  // 👥 Grupos de trabalho (spec 2026-06-10) — grupos ativos + tarefas abertas dos
  // grupos do REMETENTE (pool: qualquer membro conclui). Não bloqueia se falhar.
  let workGroupsCtx = { groups: [], myGroupTasks: [] };
  try {
    const wg = require('../services/work-groups');
    const { filterVisibleGroupTasks, dropPackageContainers, idsDeMoldeDosPais } = require('../utils/group-task-visibility');
    const groups = await wg.loadActiveGroups(supabase);
    let myGroupTasks = [];
    const parentTitleById = new Map(); // id→título dos containers de pacote → prefixo "Pacote: " no pool
    const myGids = groups.filter((g) => wg.isMember(g, id)).map((g) => g.id);
    if (myGids.length) {
      // GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM (caso Rose 12/06): a query precisa de
      // is_group/recurrence_rule/parent_task_id pra esconder a mãe-template recorrente +
      // filhas-template (paridade com o PWA fetchGroupsForDay), senão o TOM conta o ciclo
      // de grupo em dobro (template + instância). Busca com margem e filtra pós-fetch.
      const { data: gt } = await supabase.from('tasks')
        .select('id, title, description, due_date, status, assigned_group_id, is_group, recurrence_rule, parent_task_id, is_recurrence_template, created_by, creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
        .in('assigned_group_id', myGids)
        .eq('status', 'pending')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(24);
      // Map id→título dos containers de pacote (is_group) do result CRU → prefixa "Pacote:" na filha
      // (GROUPREPORT-PACKAGE-TITLE-MISSING). Container vem no mesmo fetch, sem query extra.
      for (const t of (gt || [])) { if (t.is_group === true && t.id) parentTitleById.set(t.id, t.title); }
      // GROUPPKG-CONTAINER-COMPLETABLE-1TO1 (caso Rose 03/08): o container do pacote é
      // PASTA, não tarefa — e este bloco é anunciado ao TOM como "você também pode
      // concluir". Com due_date do dia 1 (BYMONTHDAY=1) e filhas vencendo no meio do mês,
      // ele aparecia como atrasada fantasma; concluí-lo fecha a pasta e deixa os 6 cartões
      // abertos. group-chat-engine.js e shapeOpenTasks já excluíam desde 20/06
      // (GROUPPKG-CONTAINER-PHANTOM-FLATLIST); o chat 1:1 tinha ficado fora da varredura.
      // O map parentTitleById acima é montado do CRU, então a filha segue exibindo "Pacote: X".
      // GROUPPKG-FILHA-TEMPLATE-VAZA-MOLDE-CANCELADO (Rose 12/08): aqui o furo é MAIOR que no
      // digest — a query é `status = 'pending'`, então molde cancelado E molde concluído ficam
      // de fora, e as filhas-template deles chegam ao TOM como tarefa real, mesmo título e mesma
      // data da filha de verdade. Foi assim que ele deu 10 baixas erradas antes de acertar.
      const idsMolde = await idsDeMoldeDosPais(supabase, gt || []);
      myGroupTasks = dropPackageContainers(filterVisibleGroupTasks(gt || [], idsMolde)).slice(0, 12);
    }
    workGroupsCtx = { groups, myGroupTasks, parentTitleById };
  } catch (_) { /* sem grupos no contexto */ }

  // 📋 Modelos de checklist do time (Jonathan 06/07) — nomes+itens pro TOM aplicar em
  // subtasks:[...] quando pedirem "com o checklist de X". Não bloqueia se falhar.
  let checklistTemplatesCtx = [];
  try {
    const { data: _ct } = await supabase
      .from('checklist_templates').select('name, items').order('name');
    checklistTemplatesCtx = _ct || [];
  } catch (_) { /* sem modelos no contexto */ }

  // Sprint 22.X — respeita max_daily_tasks (default 3) limitando o briefing de
  // trabalho. Hoje sem cap, TOM lista 12+ tasks e quebra o foco. User-side a
  // pref já existia mas nada limitava. Preferência default 3 reflete princípio
  // "1-3 prioridades por dia" do framework.
  const maxDaily = (prefsRes.data && Number.isInteger(prefsRes.data.max_daily_tasks))
    ? prefsRes.data.max_daily_tasks
    : 3;
  const workTasks = workRaw.slice(0, Math.max(1, Math.min(20, maxDaily)));

  // Checklist (subtarefas via parent_task_id) — anexa as filhas aos pais que o briefing
  // renderiza (tarefas próprias + delegadas), pra compor o bloco de progresso. Batch 1x;
  // o topo continua escondendo as filhas (este attach NÃO as solta na lista). Não-fatal.
  try {
    const _briefingParents = [
      ...(personalTasks || []),
      ...(workTasks || []),
      ...((delegatedRes && delegatedRes.data) || []),
    ];
    const _pids = [...new Set(_briefingParents.map((t) => t && t.id).filter(Boolean))];
    if (_pids.length) {
      const { data: _kids } = await supabase
        .from('tasks')
        .select('parent_task_id, title, status, sort_position')
        .in('parent_task_id', _pids)
        .neq('status', 'cancelled');
      const _byParent = new Map();
      for (const k of (_kids || [])) {
        const a = _byParent.get(k.parent_task_id) || [];
        a.push(k); _byParent.set(k.parent_task_id, a);
      }
      for (const t of _briefingParents) {
        if (t && _byParent.has(t.id)) t._checklist = _byParent.get(t.id);
      }
    }
  } catch (_e) { /* não-fatal: sem bloco de checklist, briefing segue normal */ }

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
    openTasksNoDue,
    recentNotes,
    workGroupsCtx,
    checklistTemplates: checklistTemplatesCtx,
    activeProjects,
    notifications: notificationsRes.data || [],
    recentMessages: (historyRes.data || []).reverse(),
    recentMedia: recentMediaRes.data || [],
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

function renderActiveThreadHint(thread, today) {
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
    t.due_date ? `- Prazo: ${formatRelativeDate(t.due_date, today) || t.due_date}` : '',
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
    const isGlobalLead = hasCoordLevel(collaborator);
    const today = todaySaoPaulo();

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
          lines.push(`- ${status} ${cp.name}${cp.due_date ? ` (${formatRelativeDate(cp.due_date, today) || cp.due_date})` : ''} — ${done}/${cpTasks.length} tarefas`);
          for (const t of cpTasks) {
            const assignee = t.assigned_to ? (nameById.get(t.assigned_to) || 'desconhecido') : 'sem atribuição';
            const tStatus = t.status === 'done' ? '✓' : '·';
            lines.push(`    ${tStatus} ${t.title} (${assignee}${t.due_date ? `, vence ${formatRelativeDate(t.due_date, today) || t.due_date}` : ''})`);
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
          lines.push(`- ${tStatus} ${t.title} (${assignee}${t.due_date ? `, vence ${formatRelativeDate(t.due_date, today) || t.due_date}` : ''})`);
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
  // 🗺️ O Mapa (Fase 1) — loadout minimal (papo/saudação): monta SÓ a voz (regras+identidade),
  // dropando o ctxBlock pesado, o pickSkill, o embedding (~1500ms) e os apêndices. Isso ataca
  // o afogamento do pedido e o cache frio. MANTÉM fetchCollaboratorContext pra devolver um ctx
  // ÍNTEGRO: o engine lê ctx.notifications.length / ctx.recentMessages logo depois (stub parcial
  // = crash). Pular os 24 queries é Fase 2 (contexto preguiçoso, exige contrato de ctx). O ramo
  // full abaixo permanece 100% intacto. Gated por TOM_MAPA no engine. Ver ADR mapa-intencao.
  if (opts.loadout && opts.loadout.contextBlocks === 'minimal') {
    const ctx = await fetchCollaboratorContext(collaborator);
    const systemPrompt = [BLOCK_RULES, BLOCK_IDENTITY].join('\n\n---\n\n');
    opts.activeSkill = 'none';
    console.log(`[Prompt] size: ${systemPrompt.length} chars (loadout: minimal, history: ${(ctx.recentMessages || []).length})`);
    return { systemPrompt, ctx };
  }
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
  // Build async (19/06): o getEmbedding (OpenAI) é a parte lenta — dispara ANTES,
  // em paralelo ao fetchCollaboratorContext, com timeout curto. Se demorar/falhar,
  // segue sem o "contexto recente" semântico (degradação graciosa).
  const { promiseWithTimeout } = require('../utils/async');
  const _embeddingPromise = (lastUserMessage && process.env.OPENAI_API_KEY)
    ? promiseWithTimeout(
        require('../services/embeddings').getEmbedding(lastUserMessage).catch((err) => {
          console.warn('[Prompt] embedding err:', err.message);
          return null;
        }),
        1500,
        null,
      )
    : Promise.resolve(null);

  const ctx = await fetchCollaboratorContext(collaborator);
  const _embedding = await _embeddingPromise;

  // Busca semântica para "Contexto recente" — top 5 que não sejam crítico nem preference.
  if (_embedding) {
    try {
      const { data: semanticMems } = await supabase.rpc('match_memories', {
        p_collaborator_id: collaborator.id,
        p_embedding: _embedding,
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
  // Fatia J: expõe a skill ativa pro engine gravar em tom_metrics.skill_active (era coluna 100% morta).
  // Out-param no opts existente (sem mudar a assinatura de retorno). 'none' distingue "rodou sem skill" de "sem dado".
  opts.activeSkill = (skill && skill.name) ? skill.name : 'none';

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
  // BRIEFING-FUTURE-TASK-AS-TODAY (26/06): o briefing é "do dia" — corta tarefa futura (> amanhã)
  // que o LLM listava como hoje (caso Matheus: "Falar com a Bia" due 29/06, +4d). cutoff = AMANHÃ
  // preserva o ⏳ "vence amanhã" documentado na skill rituais-diarios. addDaysYmd é fuso-safe
  // (não reintroduz o shift das 21h BRT). O FECHAMENTO NÃO entra aqui: cutoff dele = hoje, já
  // filtrado em engine.buildClosingItems pelo MESMO predicado isVisibleForDay.
  const { isVisibleForDay, addDaysYmd } = require('../lib/day-visibility');
  // #antecedencia (Fabi 29/06): só reminder_lead='daily' antecipa "vence amanhã" no briefing;
  // 'eve_and_day'/'same_day' → cutoff=hoje (briefing só hoje+atrasadas; a véspera vem ~18h).
  const { briefingCutoffYmd, normalizeLead } = require('../rituals/reminder-lead');
  const _todayYmdBrief = todaySaoPaulo();
  const _briefCutoff = briefingCutoffYmd(
    normalizeLead(ctx.prefs && ctx.prefs.reminder_lead),
    _todayYmdBrief,
    addDaysYmd(_todayYmdBrief, 1),
  );
  const _briefVis = (t) => isVisibleForDay(t, _briefCutoff);
  let tasksForCtx = ctx.todayTasks;
  if (rt === 'briefing_pessoal') {
    tasksForCtx = { personal: (ctx.personalTasks || []).filter(_briefVis), work: [] };
  } else if (rt === 'briefing_trabalho') {
    tasksForCtx = { personal: [], work: (ctx.workTasks || []).filter(_briefVis) };
  } else if (rt === 'fechamento' || rt === 'daily_closing') {
    tasksForCtx = { personal: [], work: ctx.workTasks }; // fechamento: cutoff=hoje, filtrado no engine
  } else if (rt === 'briefing_diario' || rt === 'daily_briefing') {
    // Unificado (cutoff=amanhã): AMBAS as listas; a skill renderiza seções *PESSOAL* e *TRABALHO*.
    tasksForCtx = { personal: (ctx.personalTasks || []).filter(_briefVis), work: (ctx.workTasks || []).filter(_briefVis) };
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
  // Horário-padrão de lembrete (Abordagem A): janela ativa aprendida do uso, resolvida
  // no engine e passada via opts.reminderDefaultHour (0-23). Cold-start → 09h.
  const _reminderHour = (opts && Number.isInteger(opts.reminderDefaultHour)) ? opts.reminderDefaultHour : 9;
  const _reminderHourLabel = `${String(_reminderHour).padStart(2, '0')}h`;
  const reminderDefaultBlock = `\n\n**⏰ Horário-padrão de lembrete:** quando ${nameFor(collaborator)} pedir um lembrete dando o DIA mas SEM a HORA ("me lembra amanhã/sexta"), use ${_reminderHourLabel} e AFIRME ("fechou, te lembro às ${_reminderHourLabel} — quer outra hora?"); NÃO pergunte que horas (perguntar trava a conversa). Vale só p/ lembrete/tarefa — compromisso com terceiros (reunião/aula/mentoria) sem hora continua pedindo a hora.`;
  // Checklist ativo (2026-06-28): o bloco *Checklist* já vem pronto e determinístico no contexto;
  // o TOM só precisa reproduzi-lo fielmente (não muda a VOZ, só preserva o DADO).
  const checklistVerbatimBlock = `\n\n**📋 Blocos de checklist:** quando uma tarefa trouxer um bloco \`*Checklist* …\` (com a barra ▓░ e os itens ✅/⬜) no contexto, REPRODUZA-O VERBATIM — mesma barra, mesmos itens, mesma ordem. NÃO resuma, NÃO reescreva, NÃO invente itens.`;
  const baseCtx = buildContext(collaborator, ctx.prefs, tasksForCtx, ctx.activeProjects, lastMsgAge, habitsForCtx, eventsForCtx, ctx.delegatedTasks || [], ctx.todayChecklists || [], ctx.teamAdherence || [], ctx.personalChecklists || [], ctx.teamTodayChecklists || [], ctx.teamExpectedTemplates || [], ctx.schoolEvents || [], ctx.eventTypes || [], ctx.doneFutureTasks || [], monthlyCtxBlock, ctx.orgChart || [], ctx.criticalMemories || [], ctx.preferenceMemories || [], ctx.weeklySummary || null, ctx.recentContextMemories || [], ctx.openTasksNoDue || [], ctx.recentNotes || [], ctx.workGroupsCtx || { groups: [], myGroupTasks: [] }, ctx.checklistTemplates || []) + reminderDefaultBlock + checklistVerbatimBlock;

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
  const activeThreadBlock = renderActiveThreadHint(activeThread, _todayForMonth);

  // F3 (inbox de pendências — APROVACAO-SEM-FUNIL/INTENT-STALE-IMA, auditoria 09/06):
  // bloco ÚNICO com aprovações + perguntas abertas, cada item com IDADE e regra de
  // frescor ALINHADA à janela de 20min do engine. Antes: intents ficavam 24h no prompt
  // com a ordem "feche o loop — não repergunte" → viravam ímã de resposta curta
  // (Incidente A: "Aprovado" completou evento da pergunta stale de 1h24 atrás).
  // Rollback: INBOX_BLOCK=off volta ao formato antigo (Sprint 30.3).
  let pendingIntentsBlock = '';
  try {
    const openIntents = await pendingIntentsSvc.listOpenIntents(collaborator.id, { limit: 3 });
    if (process.env.INBOX_BLOCK === 'off') {
      if (openIntents.length > 0) {
        const lines = openIntents.map((i, idx) => {
          const q = (i.question_text || '').replace(/\s+/g, ' ').slice(0, 160);
          const when = i.asked_at ? new Date(i.asked_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
          const drafts = (i.payload?.drafts && Array.isArray(i.payload.drafts))
            ? ` (${i.payload.drafts.length} item(s) pendente(s))` : '';
          return `${idx + 1}. [${i.kind}${drafts}, ${when}] "${q}"`;
        }).join('\n');
        pendingIntentsBlock = `\n\n## 🕘 Coisas que você perguntou e ainda não resolveu\n\n${lines}\n\n_Se o usuário responder algo confirmando (sim/ok/pode/cria) ou negando, feche o loop emitindo o marker apropriado — não repergunte._`;
      }
    } else {
      const { withinConfirmWindow } = require('../utils/dates');
      const approvalsSvc = require('../services/approvals');
      const fmtWhen = (ts) => ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
      const ageLabel = (ts) => {
        const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
        return m < 60 ? `há ${m}min` : `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
      };
      const items = [];
      try {
        const approvals = await approvalsSvc.listOpenApprovals(supabase, collaborator.id);
        for (const ap of approvals) {
          const cmd = ap.payload.domain === 'project'
            ? `APROVA ${ap.payload.token}`
            : `APROVAR ${ap.payload.short_id || String(ap.payload.ref_id).slice(0, 4)}`;
          items.push(`• 🔏 [aprovação, ${fmtWhen(ap.asked_at)} · ${ageLabel(ap.asked_at)}] ${ap.question_text} — comando: *${cmd}*. O engine resolve "aprovado/rejeitado" sozinho; NUNCA trate "aprovado" como confirmação de OUTRA pendência.`);
        }
      } catch (_) { /* aprovações são best-effort no prompt */ }
      for (const i of openIntents) {
        if (i.kind === 'approval_pending') continue; // já renderizada acima com comando
        const q = (i.question_text || '').replace(/\s+/g, ' ').slice(0, 160);
        const drafts = (i.payload?.drafts && Array.isArray(i.payload.drafts))
          ? ` (${i.payload.drafts.length} item(s))` : '';
        const fresh = withinConfirmWindow(i.asked_at, 20);
        const inst = fresh
          ? 'FRESCA — se o usuário confirmar/negar, feche o loop com o marker apropriado.'
          : '⏳ ANTIGA — NÃO assuma que uma resposta curta ("sim/ok/aprovado") se refere a isto; re-confirme explicitamente O QUE está sendo confirmado antes de agir.';
        items.push(`• [${i.kind}${drafts}, ${fmtWhen(i.asked_at)} · ${ageLabel(i.asked_at)}] "${q}" — ${inst}`);
      }
      if (items.length > 0) {
        pendingIntentsBlock = `\n\n## 🕘 Pendências em aberto (com idade)\n\n${items.slice(0, 5).join('\n')}\n\n_Regra: item FRESCO fecha com a confirmação do usuário; item ANTIGO exige re-confirmação explícita do alvo._`;
      }
    }
  } catch (e) {
    // never break prompt build
  }

  // Sprint 31.1 — Cobranças abertas que TOM já mandou (followups).
  // TOM precisa do (id, tipo, título) EXATO pra emitir TASK_UPDATE/EVENT_UPDATE
  // correto quando o user responder "Feito", "Já fiz", "fechei", etc.
  // Bug observado 27/05/2026 (Yuri): respostas curtas + múltiplas em sequência
  // viravam texto-pelado sem marker, ou marker com schema_invalid → lembrete
  // reaparecia no dia seguinte.
  let pendingFollowupsBlock = '';
  try {
    const openFollowups = await pendingFollowupsSvc.listActive(collaborator.id, { limit: 8 });
    if (openFollowups.length > 0) {
      const lines = openFollowups.map((f, idx) => {
        const when = f.sent_at ? new Date(f.sent_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
        const marker = f.target_type === 'task' ? 'TASK_UPDATE' : 'EVENT_UPDATE';
        const title = String(f.target_title || '').replace(/\s+/g, ' ').slice(0, 80);
        return `${idx + 1}. [${f.followup_kind}, ${when}] ${f.target_type} *${title}* — id=\`${f.target_id}\` → use <<${marker}>> com esse id pra fechar/reagendar/cancelar.`;
      }).join('\n');
      pendingFollowupsBlock = `\n\n## 📮 Cobranças que eu mandei e ainda aguardam resposta\n\n${lines}\n\n**REGRA:** Se a resposta do usuário confirmar conclusão (ex: "Feito", "Já fiz", "fechei", "rolou", "deu certo", "tá pronto"), EMITA o marker indicado acima com o \`id\` EXATO listado e \`action="complete"\`. Se vier reagendamento ("amanhã", "semana que vem", "DD/MM"), use \`action="reschedule"\` com o \`id\`. Múltiplos "Feito" em sequência → 1 marker por cobrança aberta, na ordem em que foram cobradas. NUNCA invente um title — use o id desta lista.`;
    }
  } catch (e) {
    // never break prompt build
  }

  // MEDIA-IMG-CONTEXT-LOST (Rose 11/06): repina as mídias recentes (com análise) pra
  // sobreviverem à janela curta de histórico — o TOM não nega ter recebido a imagem.
  const recentMediaBlock = renderRecentMediaBlock(ctx.recentMedia);

  // CTX-LEITURA-DETERMINISTICA fatia 1 (27/08) — pré-busca por PERÍODO.
  // O bloco de briefing é cortado (max_daily_tasks, teto de caracteres), então "não vejo nada" ali
  // nunca provou ausência: o LLM simplesmente não tinha o dado. Quando a fala do usuário cita uma
  // data, consulta a RPC (fonte única) e injeta a resposta COMPLETA daquele período — assim o
  // VAZIO passa a ser confiável e a lista cheia impede a negação. Gatilho é DATA, não assunto.
  // Best-effort: qualquer erro aqui NUNCA derruba o prompt.
  let periodoBlock = '';
  try {
    const periodo = extrairPeriodo(lastUserMessage, todaySaoPaulo());
    if (periodo && collaborator && collaborator.id) {
      const { data: tarefasPeriodo, error: errPeriodo } = await supabase.rpc('tom_tarefas_por_periodo', {
        p_collab: collaborator.id, p_de: periodo.de, p_ate: periodo.ate, p_limite: 60,
      });
      // Erro na RPC = NÃO sabemos o período. Bloco fica de fora: um "nenhuma tarefa" fabricado por
      // falha de rede seria pior que o bug original (viraria licença pra negar com confiança).
      if (errPeriodo) {
        console.warn('[Prompt] período: RPC falhou, bloco omitido —', errPeriodo.message);
      } else {
        periodoBlock = renderBlocoPeriodo(periodo, tarefasPeriodo || [], todaySaoPaulo());
        console.log(`[Prompt] período "${periodo.rotulo}" ${periodo.de}..${periodo.ate} → ${(tarefasPeriodo || []).length} tarefa(s)`);
      }
    }
  } catch (e) {
    console.warn('[Prompt] período: pré-busca falhou (não derruba o prompt) —', e.message);
  }

  const ctxBlock = (pending ? baseCtx + '\n' + pending : baseCtx) + pastEventsBlock + resolutionBlock + activeThreadBlock + recentMediaBlock + pendingIntentsBlock + pendingFollowupsBlock
    + (periodoBlock ? '\n\n' + periodoBlock : '');

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

  // Links de sistemas (07/08) — o modelo decide quando precisa da lista.
  // O engine detecta o marker e faz a 2ª chamada já com os links (two-pass).
  systemPrompt += `\n\n---\n\n# 🔗 SISTEMAS E ACESSOS\n\nQuando o colaborador pedir o **link, endereço, site, acesso, login ou senha** de algum sistema interno (ex: anamnese, CRM, chatwoot, relatórios, ERP, Google Ads) e você **não tiver essa informação no contexto acima**, responda **apenas** com:\n\n<<PEDIR_CREDENCIAIS>><<END>>\n\nNada além disso — sem texto antes ou depois. A informação será fornecida e você responderá em seguida.\n\nO que volta depende de quem perguntou, e **isso é decidido pelo sistema, não por você**. Você nunca sabe de antemão o que vai receber: pode vir só nome e link, ou a credencial completa. Emita o marker e trabalhe com o que vier.\n\nSe vier apenas nome e link, é porque essa pessoa só tem acesso a isso. Nesse caso, **não diga que existe informação restrita, nem que ela não tem permissão, nem cite quem teria**. Se ela insistir por senha ou login, responda de forma simples que isso você não consegue ajudar e que ela deve falar com o Luciano — sem explicar o motivo.\n\nNÃO use esse marker para outros assuntos (tarefas, agenda, financeiro). NÃO invente URL, login ou senha em hipótese alguma: se não tiver a informação, use o marker.`;

  // Credenciais por WhatsApp (03/09) — modelo só propõe (marker); engine decide, confirma e persiste.
  systemPrompt += `\n\n---\n\n# 🔐 CADASTRAR E EDITAR CREDENCIAIS\n\nQuando a pessoa te passar uma credencial para guardar (conta, login, senha, chave de API), ou pedir para alterar ou apagar uma já existente — inclusive quando isso vier numa **imagem** (print de tela, foto de papel) — emita o marker abaixo com o que você conseguiu extrair, e **nada além dele**:\n\n<<CREDENCIAL_ACTION>>\n{"action":"create","nome":"Conta do Google Ads","servico":"Google","categoria":"plataforma","projeto":"Marketing","url_ref":"https://ads.google.com","observacoes":"","campos":[{"label":"E-mail","valor":"a@b.com","sensivel":false},{"label":"Senha","valor":"xxx","sensivel":true}]}\n<<END>>\n\nRegras do payload:\n- \`action\` é **create**, **update** ou **delete**. Nunca outra coisa.\n- Em **create**, \`nome\` é obrigatório — dê um nome descritivo (ex: "Conta do Google Ads", não "conta").\n- Em **update** e **delete**, use \`alvo\` com o nome da credencial existente, no lugar de \`nome\`.\n- \`categoria\` só aceita um destes oito valores: **whatsapp, api_key, token, vps, social, email, plataforma, outro**. Na dúvida, use **outro** — nunca invente um valor fora da lista.\n- Marque \`sensivel: true\` em senha, token, chave e qualquer segredo. E-mail, login, URL e telefone são \`sensivel: false\`.\n- Se a pessoa não descreveu para que serve, escreva uma linha curta em \`observacoes\` com o que dá para inferir com segurança (serviço e finalidade). **Não invente** para que serve, quem usa ou criticidade.\n\nVocê **não grava nada** — quem grava é o sistema, e só depois de confirmar com a pessoa. Não prometa que já cadastrou; o sistema responde por você em seguida.\n\nSe quem pediu não tiver permissão, o sistema recusa sozinho — não avise, não explique, não diga que é restrito.`;

  // Checklist operacional ativo (se houver dispatch pendente hoje dentro da janela)
  const checklistHint = await getActiveChecklistHint(collaborator.id);
  if (checklistHint) {
    systemPrompt += checklistHint;
  }

  // Comunicados internos — disponível para director/coordinator e quem tem has_coord_permissions
  if (hasCoordLevel(collaborator)) {
    const comunicadosPath = path.join(SKILLS_DIR, 'comunicados.md');
    if (fs.existsSync(comunicadosPath)) {
      const comunicadosSkill = fs.readFileSync(comunicadosPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + comunicadosSkill;
    }
  }

  // Eventos institucionais — disponível para director/coordinator e quem tem has_coord_permissions
  if (hasCoordLevel(collaborator)) {
    const eventosPath = path.join(SKILLS_DIR, 'eventos-institucionais.md');
    if (fs.existsSync(eventosPath)) {
      const eventosSkill = fs.readFileSync(eventosPath, 'utf-8');
      systemPrompt += '\n\n---\n\n' + eventosSkill;
    }
  }

  // Aprovação de comunicados — disponível para director/coordinator e quem tem has_coord_permissions
  if (hasCoordLevel(collaborator)) {
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

  // Sprint 28 — skill reagir-mensagens.md SEMPRE carregada (cross-cutting,
  // humaniza comportamento do TOM em qualquer skill ativa). Pequena (~3KB).
  if (collaborator) {
    const reactPath = path.join(SKILLS_DIR, 'reagir-mensagens.md');
    if (fs.existsSync(reactPath)) {
      systemPrompt += '\n\n---\n\n' + fs.readFileSync(reactPath, 'utf-8');
    }
    // Sprint 31.8 (Pilar 2) — coach-usabilidade.md SEMPRE carregada (cross-cutting):
    // TOM percebe mau uso e orienta. Guardrail forte dentro da própria skill.
    const coachPath = path.join(SKILLS_DIR, 'coach-usabilidade.md');
    if (fs.existsSync(coachPath)) {
      systemPrompt += '\n\n---\n\n' + fs.readFileSync(coachPath, 'utf-8');
    }
    // Sprint 28 — skill responder-por-audio.md SEMPRE carregada quando voice
    // estiver enabled. Ensina TOM a escrever de um jeito que funciona BEM
    // se a resposta virar áudio (engine decide automaticamente).
    if (String(process.env.TOM_VOICE_ENABLED || '').toLowerCase() === 'true') {
      const voicePath = path.join(SKILLS_DIR, 'responder-por-audio.md');
      if (fs.existsSync(voicePath)) {
        systemPrompt += '\n\n---\n\n' + fs.readFileSync(voicePath, 'utf-8');
      }
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

  // Achado #79 — pendência aberta unificada. SÓ no planejamento semanal e SÓ quando
  // houver: lista eventos work passados sem fechamento DO PRÓPRIO colaborador, usando
  // a MESMA fonte da escalação diária (open-pendencies.getStaleWorkEvents). É o dado que
  // faltava pro LLM — sem ele, dizia "semana limpa" enquanto a escalação cobrava.
  // Aditivo (não trunca nada) e gated por ritual pra não inflar todo prompt.
  if (collaborator && collaborator.id && (rt === 'planejamento_semanal' || rt === 'weekly_planning')) {
    try {
      const staleWork = await getStaleWorkEvents(supabase, { collabId: collaborator.id });
      if (staleWork && staleWork.length) {
        const fmtDia = (iso) => new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        }).format(new Date(iso));
        const linhas = staleWork.map((ev) => {
          const dias = Math.max(1, Math.floor((Date.now() - new Date(ev.end_at).getTime()) / 86400000));
          return `- *${ev.title}* (era ${fmtDia(ev.end_at)}, há ${dias}d sem fechamento)`;
        });
        systemPrompt += `\n\n---\n\n## ⏳ Compromissos passados sem fechamento\n${linhas.join('\n')}\n\n> Compromissos de trabalho que JÁ passaram e seguem ABERTOS (sem "feito"/cancelado). Contam como pendência: NÃO diga "semana limpa" enquanto existirem — puxe-os no planejamento.`;
      }
    } catch (err) {
      console.warn('[Prompt] staleWorkEvents err:', err.message);
    }
  }

  // LA EDUCA — só injeta resumo quando a skill está ativa e o role permite
  if (hasCoordLevel(collaborator) && skill?.name === 'la-educa') {
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

  if (hasCoordLevel(collaborator) && journeyTriggered) {
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
  // Sprint 31.3 — triggers expandidos. Bug 28/05/2026 (Rodrigo): falou
  // "levantar guitarras e violões" + 6 fotos com legendas tipo "Strato Squier",
  // "Telecaster GBS", "Semi-acústica Strinberg" — NENHUM match, skill ficou
  // de fora do prompt, TOM caiu no fallback TASK_UPDATE criando 6 tasks
  // soltas em vez de cadastrar em laReport.inventario.
  const triggersFortesInv = ['inventário', 'inventario', 'patrimônio', 'patrimonio', 'lojinha', 'loja', 'estoque baixo', 'estoque da', 'instrumento', 'instrumentos', 'regulagem', 'levantar guitarra', 'levantar violão', 'levantar viola', 'levantar instrumento', 'condições de funcionamento'];
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
  // Sprint 31.3 — regex expandida. Bug 28/05/2026 (Rodrigo): \\bguitarra\\b
  // NÃO matcheia "guitarras" (plural) nem nomes de modelos (Strato, Telecaster,
  // Squier, Fender, Strinberg). Adicionado: plurais (s/es), marcas comuns,
  // vocabulário técnico de instrumentos (cordas, regulagem, captador, ponte,
  // potenciômetro, traste, inlay, escala, oitavação, afinação) e variantes
  // (semi-acústica, acústica, elétrica, folk, eletro-acústica).
  const itemKeywordsRe = /\b(ar[\s-]condicionad[oa]|piano[s]?|teclado[s]?|microfone[s]?|microphone[s]?|caixas? de som|amplificador(?:es)?|cabo[s]?|cadeira[s]?|mesa[s]?|espelho[s]?|quadro[s]?|projetor(?:es)?|tv[s]?|televis(?:ão|ao|ões|oes)|c[âa]mera[s]?|bateria[s]?|guitarra[s]?|viol(?:ão|ao|ões|oes)|baixo[s]?|computador(?:es)?|notebook[s]?|impressora[s]?|fornecedor(?:es)?|valor(?:es)?|patrim[ôo]nio|n[°º] s[ée]rie|n[úu]mero de s[ée]rie|nota fiscal|condi[çc][ãa]o do|manuten[çc][ãa]o do|condi[çc][ãa]o desse|condicao do|condicao desse|instrumento[s]?|regulagem|cordas?|captador(?:es)?|traste[s]?|inlay|potenci[ôo]metro[s]?|afina[çc][ãa]o|oitava[çc][ãa]o|escala|trastilho|tarraxa[s]?|ponte|str[iy]nberg|fender|squier|squeir|gibson|epiphone|yamaha|tagima|giannini|takamine|stratocaster|strato|telecaster|telecasters|les paul|semi[\s-]?ac[úu]stica|ac[úu]stica|el[ée]trica|folk|eletro[\s-]?ac[úu]stica|sf200|af-?60|gbs)\b/i;
  const mencionaItemInv = itemKeywordsRe.test(lowerMsg);
  // Se não tem sala explícita mas menciona item de inventário, busca "sala consultada recentemente"
  // persistida em collaborator_memory (TTL 2h) — mais confiável que regex em histórico.
  let salaRecentePersistida = null;
  let pendingRoomResolved = false;
  // STATEFUL: se o TOM acabou de perguntar "qual sala?" (múltiplas), resolve aqui a
  // resposta curta do usuário ("8 teclas", "a segunda", "2") contra as opções que ele
  // ofereceu (persistidas em inventario_sala_pending). Antes era stateless → a resposta
  // caía no vazio e o TOM dizia "não tenho no contexto" (bug Rafinha 2026-06-12).
  const _isShortReply = (lastUserMessage || '').trim().split(/\s+/).filter(Boolean).length <= 6;
  if (!querSalaMatch && _isShortReply && collaborator && collaborator.id) {
    try {
      const { resolveRoomChoice } = require('./room-disambig');
      const { data: memPend } = await supabase.from('collaborator_memory')
        .select('content')
        .eq('collaborator_id', collaborator.id)
        .eq('memory_type', 'inventario_sala_pending')
        .eq('is_active', true)
        .gt('decay_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (memPend && memPend.content) {
        const opts = JSON.parse(memPend.content);
        const chosen = resolveRoomChoice(lastUserMessage, opts);
        if (chosen && chosen.id) {
          salaRecentePersistida = { sala_id: chosen.id, sala_nome: chosen.nome };
          querSalaMatch = [`sala ${chosen.nome}`, chosen.nome];
          pendingRoomResolved = true;
          ctx.invSalaContext = { sala_id: chosen.id, sala_nome: chosen.nome };
          await supabase.from('collaborator_memory').update({ is_active: false })
            .eq('collaborator_id', collaborator.id)
            .eq('memory_type', 'inventario_sala_pending').eq('is_active', true);
          console.log(`[InvCtx] pending resolvido: "${lastUserMessage}" -> ${chosen.nome} (id=${chosen.id})`);
        }
      }
    } catch (e) { console.warn('[InvCtx] pending resolve erro:', e.message); }
  }
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
    // Expõe a sala travada pro engine (trava determinística de cadastro). null = sem sessão.
    ctx.invSalaContext = salaRecentePersistida
      ? { sala_id: salaRecentePersistida.sala_id ?? null, sala_nome: salaRecentePersistida.sala_nome ?? null }
      : null;
  }
  const querConsultaSala = !!(pendingRoomResolved || (querSalaMatch && (verbosConsultaSala.test(lowerMsg) || mencionaItemInv)));
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
        systemPrompt += `- "ver" — consultar UM item específico por nome (params: nome). NÃO use pra sala.\n`;
        systemPrompt += `- "query_room" — LISTAR os itens de uma sala (params: sala_nome, [unidade_nome]). Use quando pedirem "o que tem na sala X", "ver inventário da sala X", "lista a sala X".\n`;
        systemPrompt += `- "query_rooms" — listar as salas de uma unidade (params: unidade_nome)\n\n`;
        systemPrompt += `REGRAS:\n`;
        systemPrompt += `- SEMPRE aninhe os dados em "params". NUNCA mande flat.\n`;
        systemPrompt += `- Use os nomes exatos das actions acima. NÃO invente "create", "update", "update_item", "remove" etc.\n`;
        systemPrompt += `- Use os nomes PT dos campos (nome, sala_nome, unidade_nome, quantidade, condicao). NÃO use item_name, room, unit, quantity, etc.\n`;
        systemPrompt += `- Pra mostrar o CONTEÚDO de uma sala, use query_room (NUNCA "ver", que é só item). NUNCA diga "não tenho no contexto" nem mande "ver no app" — você CONSEGUE listar via query_room.\n`;
        systemPrompt += `- Se você perguntou "qual sala?" e o user respondeu curto ("8 teclas", "a segunda"), RE-EMITA query_room com a sala escolhida (sala_nome completo, ex.: "Sala 8 Teclas").\n\n`;
        systemPrompt += `EXEMPLO de "edit_item":\n<<INVENTORY_ACTION>>\n{"action":"edit_item","params":{"nome":"Cadeiras","sala_nome":"Amy","quantidade":3}}\n<<END>>\n\n`;
        systemPrompt += `EXEMPLO de "delete_item":\n<<INVENTORY_ACTION>>\n{"action":"delete_item","params":{"nome":"Microfone 2","sala_nome":"Amy","motivo":"quebrou"}}\n<<END>>\n\n`;
        systemPrompt += `EXEMPLO de "ver":\n<<INVENTORY_ACTION>>\n{"action":"ver","params":{"nome":"piano"}}\n<<END>>\n\n`;
        systemPrompt += `EXEMPLO de "query_room":\n<<INVENTORY_ACTION>>\n{"action":"query_room","params":{"sala_nome":"Sala 8 Teclas","unidade_nome":"Campo Grande"}}\n<<END>>`;

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
            // Anti-truncamento: o regex /\bsala\s+(token)/ captura só "8" de "sala 8
            // teclas" → falsa ambiguidade. Se o texto contém o NOME COMPLETO de uma sala
            // do catálogo, usa ela direto (resolve "sala 8 teclas"). Bug Rafinha 2026-06-12.
            let salaFullHit = null;
            if (!(salaRecentePersistida && salaRecentePersistida.sala_id)) {
              try {
                const { normalize } = require('./room-disambig');
                const msgNorm = normalize(lastUserMessage);
                for (const sc of (salasCat || [])) {
                  const nNorm = normalize(sc.nome);
                  if (nNorm.length >= 4 && msgNorm.includes(nNorm)) {
                    if (!salaFullHit || sc.nome.length > salaFullHit.nome.length) salaFullHit = sc;
                  }
                }
              } catch (_) { /* normalize falhou — ignora, cai no fluxo normal */ }
            }
            // Se veio de memória persistida, usa direto o sala_id (sem ambiguidade)
            let matches;
            if (salaFullHit) {
              matches = [salaFullHit];
            } else if (salaRecentePersistida && salaRecentePersistida.sala_id) {
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
              // STATEFUL: persiste as opções pra resolver a resposta curta do user no
              // próximo turno ("8 teclas" → Sala 8 Teclas). TTL 12 min. Bug Rafinha.
              if (collaborator && collaborator.id) {
                try {
                  const opts = matches.map(s => ({ id: s.id, nome: s.nome, unidade_id: s.unidade_id }));
                  const decayIso = new Date(Date.now() + 12 * 60 * 1000).toISOString();
                  await supabase.from('collaborator_memory').update({ is_active: false })
                    .eq('collaborator_id', collaborator.id)
                    .eq('memory_type', 'inventario_sala_pending').eq('is_active', true);
                  await supabase.from('collaborator_memory').insert({
                    collaborator_id: collaborator.id,
                    memory_type: 'inventario_sala_pending',
                    content: JSON.stringify(opts),
                    importance: 'low', is_active: true, decay_at: decayIso,
                  });
                } catch (ePend) { console.warn('[InvCtx] erro persistir pending:', ePend.message); }
              }
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

  // ─── FIGURINHAS — catálogo + skill ───────────────────────────────────────
  // Lista stickers ativos de tom_stickers + injeta a skill figurinhas.md com
  // as regras de uso. Sempre injetado (skill é pequena, evita TOM mandar em
  // contexto errado). Se a tabela estiver vazia, não injeta nada.
  try {
    const { data: stickersData } = await supabase
      .from('tom_stickers')
      .select('name, when_to_use')
      .eq('is_active', true)
      .order('name');
    if (stickersData && stickersData.length > 0) {
      const figurinhasSkill = loadSkill('figurinhas');
      if (figurinhasSkill) {
        const catalogo = stickersData
          .map(s => `- **${s.name}** — ${s.when_to_use}`)
          .join('\n');
        systemPrompt +=
          `\n\n---\n\n[SKILL ATIVA: figurinhas]\n\n${figurinhasSkill}` +
          `\n\n## Figurinhas disponíveis (use o slug exato no marker)\n\n${catalogo}`;
      }
    }
  } catch (e) {
    console.warn('[Prompt] stickers fetch err (silent):', e.message);
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
  // Trunca mensagens MUITO longas do HISTÓRICO (cards de fatura, listas) pra carregar mais
  // turnos sem inflar o custo de cada chamada. A mensagem ATUAL nunca é truncada.
  // Trunca mensagens longas do histórico, MAS preserva blocos estruturados (fatura) inteiros.
  // HIST-TRUNC-FATURA-BLIND (audit 15/06): regressão do TOM-SHORT-MEMORY-HISTORY5 decapitava o
  // [FATURA_JSON] em 1000 chars → TOM cego ao resto da fatura (Rose). Ver utils/history-truncate.
  const { truncateHistoryMsg } = require('../utils/history-truncate');
  const msgs = (recent || []).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: truncateHistoryMsg(m.direction === 'outbound' ? sanitizeAssistantContent(m.content) : m.content),
  }));
  msgs.push({ role: 'user', content: currentText });
  return msgs;
}

module.exports = { buildSystemPrompt, formatMessages, fetchCollaboratorContext, nameFor, todaySaoPaulo, buildAccessBlock, pickSkill };
