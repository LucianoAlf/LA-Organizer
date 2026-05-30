# Auditoria: paridade chat (PREFS_UPDATE) × PWA (Configurações) — user_preferences

Objetivo: antes de mexer no write-path do chat (item 3), garantir que o TOM ou
**executa com fidelidade ao PWA**, ou **aponta o caminho no PWA** — nunca alucina
nem grava pela metade.

## Contrato dos dois lados

- **Chat** (`engine.js` PREFS_UPDATE): `PREFS_TIME_FIELDS`, `PREFS_INT_FIELDS`,
  `PREFS_BOOL_FIELDS`, `coaching_intensity`, `quiet_days`, `quiet_start_time`,
  `quiet_end_time`, `quiet_reason`. Tudo **GLOBAL** — nenhuma coluna `_work`/`_personal`.
- **PWA** (`web/src/screens/Configuracoes.tsx`): escreve **global + contexto** para
  silêncio, e tem campos que o chat nem conhece.

## Matriz (Grupo = nível de paridade)

### Grupo A — ALINHADO (global, 1 coluna, mesma semântica) → chat executa fiel ✅
| Config (PWA) | Coluna | Chat? |
|---|---|---|
| Briefing pessoal/trabalho/fechamento | `personal_briefing_time`, `briefing_time`, `closing_time` | ✅ |
| Planejamento semanal | `planning_day`, `planning_time` | ✅ |
| Planejamento/fechamento mensal | `monthly_planning_time`, `monthly_closing_time` | ✅ |
| Foco do dia | `max_daily_tasks` | ✅ |
| Intensidade | `coaching_intensity` | ✅ |
| Notificações | `notify_deadline_alerts`, `notify_overdue_alerts`, `notify_team_summary` | ✅ |
| Voz do TOM | `voice_enabled` (tabela collaborators) | ✅ |

→ **Sem mudança.** O chat grava a mesma coluna única; sem dimensão de contexto.

### Grupo B — DIVERGENTE: PWA é context-aware, chat só grava GLOBAL → BUG ❌
| Config (PWA) | Colunas PWA | Chat grava |
|---|---|---|
| Silêncio diário (abas Trabalho/Pessoal) | `quiet_start_time_work/_personal`, `quiet_end_time_work/_personal` (+ global) | só `quiet_start_time/end_time` (global) |
| Dias de silêncio (por contexto) | `quiet_days_work/_personal`, `quiet_weekends_work/_personal` (+ global) | só `quiet_days`, `quiet_weekends` (global) |

→ É o root do caso Jhonatan. Os jobs leem **contexto** (autoritativo); chat escreve
**global** → não surte efeito. O chat **não tem como** saber se o usuário quer
silêncio de Trabalho ou Pessoal (o PWA obriga a escolher a aba).

### Grupo C — SÓ NO PWA, chat não tem campo → risco de alucinação ❌
| Config (PWA) | Coluna | Chat? |
|---|---|---|
| Lembretes de tarefas (Check-in 1..N) | `task_checkin_times` (lista HH:MM) | ❌ inexistente |

→ Se o usuário pedir check-ins por chat, o TOM hoje não tem campo → tende a alucinar
("pronto, configurei") sem gravar nada.

### Grupo D — DIVERGÊNCIA INTENCIONAL (ok)
| Config | Nota |
|---|---|
| Pausar TOM (`do_not_disturb_until`) | Chat usa marker dedicado `<<DND_SET>>` (cap 24h, validado). PWA grava direto. Intencional — chat é mais seguro. Manter. |

## Conclusão

O item 3 não é "espelhar global→contexto" e pronto. São 3 frentes:
1. **Grupo B (silêncio):** tornar o chat context-aware E resolver QUAL contexto
   (perguntar / aplicar nos dois / mandar pro PWA). Manter global em sincronia com
   contexto pra todos os leitores concordarem.
2. **Grupo C (check-ins):** decidir entre dar suporte no chat (novo campo validado)
   ou **apontar pro PWA** ("ajusta em Configurações → Lembretes de tarefas").
3. **Trava anti-alucinação (núcleo do pedido do Alf):** o system prompt do TOM
   (`prompts/system.js`) precisa de um **allowlist explícito** do que é setável por
   chat; para tudo fora da lista → "NÃO diga que fez, mostre o caminho no PWA".
   Hoje o prompt manda setar `quiet_start_time/end_time` global — exatamente o bug.

## Resolvido (save de Configuracoes.tsx)
- **O PWA grava SÓ contexto** (`quiet_*_work`/`quiet_*_personal`). NÃO escreve nem lê
  `quiet_start_time`/`quiet_end_time` global (fora do `PREF_COLS`). → **Global é LEGADO.**
  Fonte de verdade do silêncio = colunas de contexto.
- **Decisão de produto (Alf):** silêncio via chat → TOM **sempre pergunta o contexto**
  (Trabalho/Pessoal/ambos) e grava as colunas de contexto. Check-ins → **apontar pro PWA**.
- **Achado extra (item 4, separado):** jobs de lembrete de evento (`dispatcher.js:782/846/907`)
  leem o global legado → cegos pra quem configura no PWA. Mesmo fix `(*)`/contexto.
- **Achado extra 2:** o PWA tem `notify_deadline_alerts_personal` / `notify_overdue_alerts_personal`
  (toggles de notificação POR CONTEXTO) que o chat também não conhece. Fora do escopo do item 3,
  mas registrado.

## Plano do item 3 (com as decisões)
1. **Prompt `prompts/system.js`** — (a) allowlist explícito do que é setável por chat;
   (b) silêncio: TOM PERGUNTA o contexto antes de emitir o marker, e mapeia pra
   `quiet_*_work`/`_personal`; (c) tudo fora do allowlist (check-ins etc.) → "não diga
   que fez, mostre o caminho no PWA". Corrigir a instrução atual (linha ~95) que manda
   setar global.
2. **`engine.js` PREFS_UPDATE** — aceitar/validar as colunas de contexto:
   `quiet_start_time_work/_personal`, `quiet_end_time_work/_personal`,
   `quiet_days_work/_personal`, `quiet_weekends_work/_personal`.
3. **TDD** — testar o parser de PREFS_UPDATE pros campos novos (válido/ inválido),
   no mesmo padrão dos testes existentes.
