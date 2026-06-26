# Tarefa de grupo/delegada — TOM relay (descrição + autor) + baixa — Design

**Data:** 2026-06-25
**Origem:** demanda Gabi/João/Vitoria (grupo ADM CG). Quick-win do app já entregue (descrição read-only no mobile + auto-grow); esta SPEC cobre o lado TOM (Partes 2-3 do brainstorm).

## Goal

Quando o TOM lembra ou conversa sobre uma tarefa de **grupo (pool)**, ele passa a **descrição** (o que fazer + qual aluno) e **quem criou**; e **dá baixa** quando o executor diz "já fiz". Hoje o membro recebe só o título e o TOM diz "não sei quem criou".

## Diagnóstico (verificado no código — catraca)

**É context-gap, NÃO derrotismo nem RLS.** Os dados existem no banco (descrição + `created_by=Vitoria`), o RLS libera o membro, a baixa tem caminho. O furo é que o **pool do membro não carrega/mostra esses campos no prompt nem no lembrete**:

| Superfície | Onde | Estado hoje |
|---|---|---|
| Prompt — pool do membro (loader) | `system.js:1762` | select sem `description` / `created_by` |
| Prompt — pool do membro (render) | `system.js:545-549` | mostra só `[id] 👥[grupo] título — prazo` |
| Lembrete de grupo (query+texto) | `dispatcher.js:4988` + `:5014` | `⏰ Lembrete: *título* (grupo) — quando` |
| Baixa (concluir pool no 1:1) | `engine.js:4182-4191` | **JÁ funciona** (branch `assigned_group_id` conclui + notifica grupo em 4238) |

> O `↳ descrição` que aparece em `system.js:462` é do `renderTaskList` (tarefas **pessoais/trabalho do próprio**), NÃO do bloco de pool (545). Por isso a descrição não chega pro caso Gabi/João.

## Decisões de produto (Alf, 25/06)

- App mobile = **read-only** (quick-win já no ar).
- TOM = **relay completo + baixa**.
- Checkpoints/subtarefas dentro da tarefa = **fora de escopo**.
- Entrega: quick-win já saiu; esta SPEC é "o resto". Mensagem pra Gabi/João só **no fim**, com OK do Alf.

## Escopo (YAGNI)

Foco no **pool de grupo** (`assigned_group_id`, `assigned_to=null`) — é o caso real. Tarefa delegada 1:1 (`assigned_to=pessoa`) já mostra descrição no `renderTaskList`; só não mostra autor — fica como **bônus pequeno** na mesma fatia se for trivial, senão fora.

## Arquitetura / unidades

### Fatia 1 — Prompt: pool carrega + mostra descrição e autor (`system.js`)
- **Loader** (~1762): adicionar `description, created_by` ao select + join do nome do criador (`creator:collaborators!tasks_created_by_fkey(full_name)` — confirmar nome do FK na implementação).
- **Render** (545-549): por tarefa do pool, além de `título — prazo`:
  - linha `criada por <PrimeiroNome>` quando `created_by` resolvido;
  - linha `↳ <descrição truncada ~240>` quando houver (espelhar exatamente o padrão de 462-465: `replace(/\s+/g,' ')`, corte 240 + `…`).
- **Invariante:** não inflar o contexto — manter `.slice(0, 12)` e a truncagem; `filterVisibleGroupTasks` intacto (não reabrir GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM).

### Fatia 2 — Lembrete de grupo enriquecido (`dispatcher.js` `checkTaskReminders`)
- **Query** (4988): adicionar `description, created_by` ao embed `tasks(...)` + resolver nome do criador (lookup em `collaborators` por `created_by`, reusando o `byId`/uma busca pequena).
- **Texto** (5014): manter a 1ª linha (`⏰ Lembrete: *título* (grupo) — quando`) e ANEXAR:
  - `_Criada por <PrimeiroNome>:_ <descrição curta ~200 + …>` quando houver descrição;
  - sufixo discreto "_abre no app pra ver tudo_" só se truncou.
- **Voz/Comportamento:** o lembrete é mensagem proativa de formato fixo (não a voz conversacional do TOM) e o enriquecimento é exatamente o que o Alf pediu ("o TOM tem que passar quem criou + o que fazer"). Não toca tom/tamanho das respostas de conversa.
- **Consistência (verificar, não assumir):** `remindGroupTasks` (~1054) e o branch de grupo em `checkReminders` (~5125) são outras superfícies de lembrete de grupo. Conferir se disparam pra esse caso; se sim, aplicar o mesmo enriquecimento. Se não dispararem na prática, **logar a decisão de não mexer** (sem cap silencioso).

### Fatia 3 — Baixa do pool no 1:1 (confirmar, não reescrever)
- `engine.js:4182` já conclui tarefa de pool quando o membro manda short-id/"concluí". **Verificação E2E** (banco): membro NÃO-criador conclui uma tarefa de pool via 1:1 → `status=done`, `completed_by` setado, grupo notificado. Sem código novo esperado.
- O prompt (544) já diz "você também pode concluir". Se o E2E mostrar fricção real (TOM não tenta concluir pool ao "já fiz"), avaliar reforço de prompt **mínimo** — só então, e como fatia separada.

### Fatia 4 — Validação integral + registro
- TDD/anti-falso-verde onde houver função pura; smoke determinístico do texto do lembrete (com/sem descrição/criador) e do bloco do prompt.
- `node --check` nos arquivos; deploy (scp engine/system/dispatcher + pm2 restart) com OK do fluxo.
- Registrar KI (`GROUPTASK-TOM-RELAY-NOCTX` ou similar) na `tom_known_issues` (causa = context-gap do pool; fix = enriquecer loader/render/lembrete; baixa já existia).
- **Só depois de tudo verde:** redigir a mensagem pra Gabi/João — e enviar **só com OK explícito do Alf** (mensagem a terceiros).

## Error handling
- Loader do pool já é `try/catch` que não bloqueia (1750/1770) — manter.
- Enriquecimento do lembrete em `try/catch`; criador ausente → omitir "criada por" (nunca quebrar o lembrete).
- Truncagem defensiva (descrição grande não estoura nem o prompt nem o WhatsApp).

## Testing
- **Pure:** `filterVisibleGroupTasks` continua passando (sem regressão de duplicata template/instância).
- **Render do pool:** asserção do builder de linha (se extraível p/ função pura) OU smoke do bloco com uma tarefa de pool com descrição+autor.
- **Lembrete:** smoke determinístico — `textG` com descrição+criador presentes vs ausentes (omite gracioso).
- **Baixa:** E2E no banco (member não-criador conclui pool).
- **Anti-regressão:** contexto não infla (12 itens + truncagem); voz conversacional intocada; quiet-hours do lembrete preservado.

## Riscos / invariantes
- **Voz sagrada:** mudança é DADO no contexto + lembrete (pedido do Alf), não tom/jeito/tamanho das respostas.
- **Não reabrir** GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM (manter `filterVisibleGroupTasks`).
- **Privacidade:** só pool dos grupos em que o remetente é membro (loader já filtra por `myGids`).
- **Coordenação:** edita `src/` (engine/system/dispatcher) → `.deploy-hold` antes; outros chats ativos no `_remote`.
