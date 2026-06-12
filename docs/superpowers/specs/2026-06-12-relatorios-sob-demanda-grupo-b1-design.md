# Relatórios sob demanda no grupo — B1 (Fundação + on-demand)

**Data:** 2026-06-12
**Status:** Aprovado (aguardando review da spec antes do plano)
**Contexto:** Parte B do roteiro pós-Chat de Grupo. Decomposto em **B1 (fundação + sob demanda)** — esta spec — e **B2 (rituais proativos + config por grupo)** — spec futura, que reaproveita a camada de consulta+render da B1.

## Objetivo

Permitir que um membro peça, no chat do grupo (app ou WhatsApp), um **relatório dos dados do grupo** — "faz um resumo da agenda do mês", "lista as tarefas em aberto", "o que temos pra essa semana" — e o TOM responde com um **card determinístico e completo** (nunca trunca/inventa), montado a partir do banco.

Tudo é **dado de trabalho do grupo** (agenda, tarefas, anotações, checklists). **Nada de financeiro/pessoal** (o módulo `pf_*` é owner-only e fica fora).

## Princípio inegociável: dados exatos, TOM só a moldura

O problema histórico do TOM é **truncar/esquecer itens** em listas que ele mesmo escreve. Aqui a lista é montada 100% por **código (queries)**; o TOM só **interpreta o pedido** (linguagem natural → marker) e escreve uma linha de abertura. O LLM **nunca** escreve a lista.

## Arquitetura

Motor dirigido por **marker**, dentro do pipeline do chat de grupo (Fase 2+):

```
membro pede "resumo da agenda do mês"
  → TOM (group-chat) emite <<GROUP_REPORT>>{"scope":"agenda","window":"mes"}
  → group-chat-engine parseia o marker
  → buildGroupReport(groupId, scope, window)  [queries determinísticas]
  → renderReportHtml → HTML card
  → insere group_chat_messages kind='report', role='tom', channel='app'
  → watcher/bridge-out: card no app + texto formatado no WhatsApp (htmlToWhatsapp já existe)
```

O LLM cuida do **NLU** (entender o pedido, escolher scope+window); o código cuida da **precisão** (lista fiel ao banco). Mesmo padrão dos outros markers do TOM.

## Componentes

### 1. `src/services/group-report-builder.js` (novo)

Núcleo determinístico. Funções:

- **`windowBounds(window, now)`** (pura) → `{ start, end, label }` para `hoje | semana | mes`, em America/Sao_Paulo. Usa os helpers de data locais (`todaySP`/`localYmd` de `utils/date.ts` no front; no backend, equivalente já usado pelos services) — **nunca** `toISOString().slice(0,10)` (bug de UTC após 21h BRT, known issue `LOCALYMD-UTC-SHIFT`). `semana` = segunda a domingo da semana corrente; `mes` = 1º ao último dia do mês corrente.

- **Queries por fonte** (cada uma traz a lista COMPLETA do período, sem `limit` artificial que trunque):
  - `queryAgenda(supabase, groupId, bounds)` → **a "agenda do grupo" = TAREFAS do grupo com `due_date` no período** (decisão de design: `events` não é group-scoped no banco; só `tasks.assigned_group_id` é). Tarefas `assigned_group_id=groupId`, `status != 'done'`, `due_date` entre bounds.start e bounds.end, **ordenadas por `due_date`** (visão cronológica/timeline). Campos: `{ title, due_date, responsável }`. (Difere de `queryTasks`, que lista o pool inteiro por baldes; aqui é a fatia DATADA em ordem de data.)
  - `queryTasks(supabase, groupId, bounds)` → tarefas `assigned_group_id=groupId`, `status != 'done'`, agrupadas em 3 baldes: **com prazo no período**, **vence em breve / esta semana** (due_date entre hoje e +7d), **sem prazo**. Campos: `{ title, due_date, responsável (completed_by/created_by→nome) }`.
  - `queryNotes(supabase, groupId, bounds)` → anotações compartilhadas com o grupo, recentes/no período: `{ title, snippet }`.
  - `queryChecklists(supabase, groupId, bounds)` → checklists operacionais do grupo no período + progresso (X/Y) e, quando houver, subtarefas/itens de checklist das tarefas do grupo.

- **`renderReportHtml({ groupName, scope, windowLabel, sections })`** (pura) → HTML card. Uma `<h3>` com emoji por seção (📅 Agenda, ✅ Tarefas, 📝 Anotações, ☑️ Checklists), `<ul><li>` por item, linha curta. Seção vazia → `<p>(nada no período)</p>`. Hierarquia visual obrigatória (mesma lição de formatação da Fase 4: emoji + quebras, nada de bloco corrido). Só tags básicas (compatível com o sanitizer do app e com o `htmlToWhatsapp` do bridge-out).

- **`buildGroupReport({ supabase, groupId, scope, window })`** → orquestra: resolve bounds, roda as queries das seções pedidas (`scope='tudo'` = todas; senão só a do scope), chama render, retorna `{ html }`. Degrada gracioso: uma query falha → aquela seção vira "(não consegui carregar)"; o resto renderiza.

### 2. `src/services/group-chat-prompt.js` (modificar)

Documentar o marker no prompt do chat de grupo:

```
### Relatório do grupo (sob demanda)
Quando pedirem um resumo/relatório/listagem do que o grupo tem (agenda, tarefas,
anotações, checklists) — num período (hoje/semana/mês) — emita SÓ o marker:
<<GROUP_REPORT>>{"scope":"agenda|tarefas|anotacoes|checklists|tudo","window":"hoje|semana|mes"}<<END>>
- scope: escolha pelo pedido (agenda→agenda; "tudo/o que temos"→tudo). window: hoje/semana/mes (padrão: mes; tarefas sem janela→tudo em aberto).
- NUNCA escreva a lista você mesmo — o sistema monta com dados EXATOS do banco.
  Você só dá uma linha de abertura ("Aqui o resumo da agenda de junho 👇") + o marker.
```

### 3. `src/services/group-chat-engine.js` (modificar)

No parser de markers do chat de grupo, adicionar o caso `<<GROUP_REPORT>>`:
- valida o JSON (scope ∈ enum, window ∈ enum; default `tudo`/`mes` se inválido).
- chama `buildGroupReport`.
- insere `group_chat_messages` `{ group_id, sender_id:null, role:'tom', kind:'report', content:html, channel:'app' }` — o mesmo formato do card de fechamento, então o app renderiza e o bridge-out espelha sem mudança.

## Renderização & entrega

- **App:** `MessageBubble` já renderiza `kind='report'` como card HTML.
- **WhatsApp:** `bridge-out.buildWhatsappText` já converte `report` via `htmlToWhatsapp` (negrito/bullets/quebras). Sem mudança.
- A linha de abertura do TOM (prosa) é uma mensagem normal separada; o card é a `kind='report'`.

## Tratamento de erro

- Query de uma fonte falha → seção "(não consegui carregar)", resto renderiza (try/catch por seção).
- Tudo vazio → card amigável "Nada agendado/pendente no período. 🎉".
- Marker malformado (scope/window inválido) → default (`tudo`/`mes`), nunca quebra.
- `buildGroupReport` nunca lança pro engine (degrada gracioso).

## Validação

- **Testes puros (`node:test`):** `windowBounds` (limites de hoje/semana/mês no fuso SP, incl. caso após 21h BRT); `renderReportHtml` (seções→HTML, seção vazia, hierarquia com emoji); agregação de `queryTasks` em 3 baldes com fixtures (com prazo/vence em breve/sem prazo).
- **E2E na VPS (grupo Financeiro):** "faz um resumo da agenda do mês" → card com os eventos reais do grupo; "lista as tarefas em aberto" → todas as tarefas (conferir que NENHUMA falta vs banco); espelho no WhatsApp limpo (negrito/bullets). Confirmar que o TOM NÃO escreveu a lista na prosa (só o marker).
- Registrar `tom_known_issues` ao fechar (`GROUPCHAT-B1-RELATORIOS-ONDEMAND`).

## Fora do escopo (YAGNI)

- **Rituais proativos / cron** (bom dia, semanal, mensal) e **config por grupo** (o quê/quando) → **B2** (próxima spec; reaproveita `buildGroupReport`).
- Financeiro/pessoal (`pf_*`), relatório no 1:1, export PDF (o card já tem "Baixar HTML").
- Filtros avançados (por pessoa, por categoria) → depois.

## Riscos conhecidos

1. **Agenda = tarefas datadas (resolvido):** `events` não é group-scoped no banco, então a agenda do grupo é definida como as tarefas do grupo com `due_date` no período. Eventos de calendário pessoais ficam fora (revisitar em projeto futuro se criarmos eventos de grupo).
2. **Fonte de "anotações do grupo" e "checklists do grupo":** confirmar na implementação as tabelas/colunas exatas (notas compartilhadas com grupo; checklists operacionais por grupo) — o builder degrada gracioso se uma fonte não existir/retornar vazio, então não bloqueia o v1 (agenda+tarefas já entregam o valor central).
3. **Janela "semana":** segunda–domingo (padrão BR); testar a virada de semana.
