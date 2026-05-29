# Design — Preferências de Silêncio/Lembretes por Contexto (Pessoal vs Trabalho)

**Data:** 2026-05-29
**Status:** aguardando revisão do usuário
**Escopo:** Fundação (modelo de dados + UI Configurações + dispatcher). A camada conversacional do TOM (perguntar "trabalho ou tudo?") é tratada em outro chat (TOM-Coach / Pilar 2) e apenas **consome** esta fundação.

---

## Problema

O TOM tem 5 mecanismos de silêncio que se sobrepõem sem hierarquia clara, e o silêncio é **global** (cego ao tipo/origem da mensagem). Caso real (Gabi): ela pediu *"me manda lembrete só após 14h"*. O TOM persistiu corretamente como `quiet_start=00:00 / quiet_end=14:00` — **mas global**, silenciando TUDO de manhã, inclusive lembretes que ela QUERIA (ex: academia).

A intenção real dela: *"silêncio das coisas de **LA Music** até eu pegar no trabalho às 14h — minha vida pessoal de manhã continua"*. O sistema não tem como expressar isso.

O produto já começou a dualidade pessoal/trabalho (abas na Agenda, `context` em tasks/events, `briefing_time` vs `personal_briefing_time`) mas **parou no meio**: o silêncio nunca foi separado por contexto.

### Gaps secundários descobertos na auditoria
- **5 vazamentos:** `checkReminders`, `checkTaskCheckins`, `checkHabitReminders`, `dispatchChecklists`, `checkMonthlyPlanning/Closing` disparam **dentro do quiet** (não chamam `isQuietNow`).
- **UI ↔ TOM mismatch:** o TOM consegue setar `quiet_start_time/quiet_end_time`, mas a tela de Configurações **não tem** esse campo nem o lê no `PREF_COLS`. O usuário fica "trancado fora" do que o TOM configurou.

---

## Definição semântica (CRAVADA — não negociável)

`context` é binário e tem significado específico:

> **`work` (Trabalho) = atividades da pessoa DENTRO da LA Music** (organizacional).
> **`personal` (Pessoal) = TUDO que não é LA Music — INCLUSIVE trabalhos/profissão paralela da própria pessoa.**

Exemplos:
| Mensagem | Contexto | Por quê |
|---|---|---|
| "Aula de bateria pra dar amanhã" (Jordan) | `personal` | Trabalho dele, mas não LA Music |
| "Festival de fatias da Lúcia" | `personal` | Empreitada própria, fora da LA Music |
| "Fechar a folha de pagamento da unidade" | `work` | LA Music organizacional |
| "Pagar conta de luz" | `personal` | Vida pessoal |

**Erro a evitar:** ouvir "aula/trabalho/festival/cliente" e jogar tudo pra `work`. A classificação correta em si é responsabilidade do TOM-Coach (outro chat) — esta fundação só **define o termo sem ruído** e o aplica.

Handoff escrito em: `docs/superpowers/handoffs/2026-05-29-semantica-pessoal-trabalho-para-tom-coach.md`

---

## Escopo

**No escopo (Fundação):**
1. Modelo de dados: silêncio + lembretes + toggles de notificação separados por contexto.
2. UI Configurações: abas Pessoal/Trabalho nas seções de silêncio; nova seção "Silêncio diário"; subtítulos cravando a semântica.
3. Dispatcher: cada mensagem proativa carrega `context`; `isQuietNow` recebe `context`; fix dos 5 vazamentos.
4. Migração de dados sem mudar comportamento atual.

**Fora do escopo:**
- Camada conversacional do TOM (perguntar/educar/desambiguar) → TOM-Coach, outro chat.
- Classificação automática de itens em work/personal → idem (TOM-Coach).
- Remoção das colunas antigas `quiet_*` (migração futura).
- Split de voz/intensidade/pausar/max_daily_tasks (são globais por natureza — canal/jeito, não contexto).

---

## Seção 1 — Modelo de dados

Migration adiciona em `user_preferences` (todas nullable; NULL = sem silêncio naquele contexto):

```
quiet_start_time_work        time
quiet_end_time_work          time
quiet_days_work              int[]   default '{}'
quiet_weekends_work          boolean default false

quiet_start_time_personal    time
quiet_end_time_personal      time
quiet_days_personal          int[]   default '{}'
quiet_weekends_personal      boolean default false

notify_deadline_alerts_personal  boolean default true
notify_overdue_alerts_personal   boolean default true
```

- Os `notify_*` atuais (sem sufixo) passam a representar a versão **work**.
- `quiet_reason` continua global (texto livre, não vale a pena duplicar).
- **Globais (sem sufixo):** `do_not_disturb_until`, `do_not_disturb_reason`, `voice_enabled`, `coaching_intensity`, `notify_team_summary`, `max_daily_tasks`, todos os `*_time` de rituais já existentes.
- Colunas antigas `quiet_start_time / quiet_end_time / quiet_days / quiet_weekends`: **deprecadas mas vivas** durante a transição (lidas como fallback até a migração de dados rodar).

---

## Seção 2 — Dispatcher: classificação de contexto

**Regra única:** toda mensagem proativa carrega um `context` ('work'|'personal'), e o silêncio é checado contra a janela daquele contexto.

Assinatura: `isQuietNow(prefs, now)` → `isQuietNow(prefs, now, context)`.
- Internamente seleciona `quiet_*_${context}` (com fallback pras colunas antigas globais se as novas forem NULL).
- Lógica de range (normal vs cruza-meia-noite) permanece idêntica à atual.

Classificação por path:
| Path | Contexto |
|---|---|
| Briefing pessoal / trabalho | já separados (mantém) |
| remind/check Task/Event/Reminders, Task/EventCheckins, deadline/overdue | herda `task.context` / `event.context` |
| remindOperationalTasks, adherence, planning/closing, dispatchChecklists | **work** (operacional) |
| checkHabitReminders | herda `context` do hábito (ver nota abaixo); default **personal** |
| Relatórios coord/CEO/team, coordination timeouts | **work** (org-level; não sujeito a quiet pessoal) |

**Nota de implementação:** verificar se a tabela `habits` tem coluna `context`. Se não tiver, tratar todos como `personal` no v1 (a maioria — academia, água, leitura — é pessoal) e registrar como melhoria futura.

**Fix dos 5 vazamentos:** `checkReminders`, `checkTaskCheckins`, `checkHabitReminders`, `dispatchChecklists`, `checkMonthlyPlanning/Closing` passam a chamar `isQuietNow(prefs, now, context)`.

**Resultado caso Gabi:** quiet **trabalho** 00:00→14:00. De manhã: academia (personal) **passa** ✅; cobrança de tarefa de trabalho **espera até 14h** ✅.

---

## Seção 3 — UI Configurações (abas Pessoal/Trabalho)

`web/src/screens/Configuracoes.tsx`:
- **Toggle Pessoal / Trabalho** no topo das seções de silêncio (mesmo padrão visual das abas da Agenda). A aba ativa define se os controles editam `_work` ou `_personal`.
- **Nova seção "🔕 Silêncio diário":** 2 `TimeInput` (início/fim), por contexto. Reusa o componente `TimeInput` existente.
- "Dias de silêncio" passa a operar na coluna do contexto da aba ativa.
- "Notificações" (prazo/atraso) ganham versão por contexto; "Resumo do time" continua global (liderança).
- `PREF_COLS` + objeto de save atualizados pras novas colunas.
- **Subtítulo cravando semântica:** *"Trabalho = suas atividades na LA Music. Pessoal = sua vida e trabalhos seus fora da LA Music."*
- Guardrail Desktop: testar em 375px e 1440px (a tela tem versão única; confirmar que segue responsiva).

---

## Seção 4 — Migração de dados + Testes

**Migração (segura, preserva comportamento):**
- Quem já tem `quiet_*` global preenchido → **copia o valor pra AMBOS** `_work` e `_personal`. Comportamento idêntico ao de hoje; ninguém é surpreendido. A diferenciação vira opção dali pra frente.
- Gabi cai com 00:00–14:00 nos dois contextos; refina pra só-trabalho depois (via UI ou TOM-Coach).

**Testes:**
- `isQuietNow(prefs, now, context)` — checagens determinísticas: quiet work ativo + personal livre (e vice-versa); range normal e cruza-meia-noite; fallback pras colunas antigas quando novas são NULL.
- Cada um dos 5 paths corrigidos chamando com o contexto certo (smoke no dispatcher com `--force` / fixtures).
- UI: `npx tsc --noEmit` + `npx vite build`; preview 4173 — alternar abas, salvar, reload, conferir persistência das colunas novas.
- Cenário Gabi ponta-a-ponta: setar quiet trabalho 00:00–14:00; simular lembrete personal de manhã (passa) e cobrança work de manhã (espera).

---

## Riscos / mitigações

- **Quebrar silêncio de quem já configurou:** mitigado pela migração que copia global → ambos (zero mudança de comportamento).
- **Path sem contexto claro (ex: hábito sem coluna context):** default explícito (`personal` pra hábito, `work` pra operacional) documentado na Seção 2.
- **Colunas antigas vs novas divergirem:** `isQuietNow` lê novas com fallback pras antigas; remoção das antigas só em migração futura, depois de confirmar que toda escrita migrou.
- **Inconsistência de label com a Agenda:** mantido "Trabalho/Pessoal" (não renomear) — consistência preservada.

---

## Dependência com o TOM-Coach (outro chat)

- **Esta fundação** entrega o modelo de dados + UI + dispatcher context-aware. NÃO muda a conversa do TOM.
- **TOM-Coach** (outro chat) classifica itens em work/personal seguindo a definição semântica cravada acima. Se classificar errado, o item cai na janela de silêncio errada.
- Alinhamento via o handoff em `docs/superpowers/handoffs/2026-05-29-semantica-pessoal-trabalho-para-tom-coach.md`.
