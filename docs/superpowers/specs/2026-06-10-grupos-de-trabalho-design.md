# Spec — Grupos de trabalho: tarefas compartilhadas por grupo

**Data:** 2026-06-10 · **Status:** aprovado em brainstorm (Alf) · **Origem:** pedido da Rose (gerente financeiro, WhatsApp 10/06, repassado pelo Alf). Brainstorm conduzido em sessão dedicada (chip "Brainstorm: tarefas de grupo"); spec entregue pelo Alf nesta sessão.

## Problema

Tasks têm `assigned_to` único. Delegar **transfere** a tarefa: o delegante perde a capacidade de concluir. A Rose quer um pool compartilhado com a Ana Paula (auxiliar do financeiro): as duas veem tudo e **qualquer uma conclui**, sem transferir.

## Decisões do brainstorm (10/06)

1. **Grupo nomeado reutilizável** como entidade (ex.: Financeiro = Rose ★ + Ana), atribuível a qualquer tarefa — não multi-assignee ad-hoc.
2. **Pool de execução:** qualquer membro vê e conclui; a primeira que concluir fecha para todas; `completed_by` registra quem.
3. **Lembretes para todos os membros; escalação (tarefa travada) só para a líder do grupo.**
4. **Self-service:** qualquer líder/gestor (coordenador, gerente, diretor) cria grupos e gerencia membros; diretor vê/edita todos, cada líder os seus.
5. **TOM + app desde o MVP:** "TOM, cria tarefa pro financeiro: …" funciona pelo WhatsApp.
6. **Arquitetura A — grupo como dono da tarefa** (coluna `assigned_group_id`), não N:N nem colaborador virtual.
7. Mockup das 3 telas aprovado no design system (dark, tokens `tom`).

## Visão futura (alinhamento, fora do escopo)

O Alf quer, num pack futuro, **colocar o TOM dentro do grupo de WhatsApp do financeiro**, espelhando este grupo de trabalho. O `work_group` é a âncora desse vínculo (campo futuro tipo `whatsapp_group_chat_id`). Piloto com o Financeiro; depois TOM em outros grupos. **Este MVP não implementa nada disso**, apenas não fecha a porta: grupo é entidade própria, com slug estável.

## Modelo de dados (migration)

```sql
work_groups (
  id uuid PK default gen_random_uuid(),
  name text not null,
  slug text not null unique,        -- ex.: 'financeiro'; âncora estável p/ prompt e futuro vínculo WhatsApp
  leader_id uuid not null references collaborators(id),  -- recebe escalações
  created_by uuid references collaborators(id),
  active boolean not null default true,
  created_at timestamptz default now()
)

work_group_members (
  group_id uuid references work_groups(id) on delete cascade,
  collaborator_id uuid references collaborators(id),
  added_by uuid references collaborators(id),
  created_at timestamptz default now(),
  primary key (group_id, collaborator_id)
)
```

- `tasks.assigned_group_id uuid null references work_groups(id)`.
- `tasks.assigned_to` passa a **nullable** + CHECK exatamente-um-dono: `(assigned_to IS NOT NULL) <> (assigned_group_id IS NOT NULL)`. Linhas existentes todas têm `assigned_to` → CHECK passa sem backfill.
- Líder sempre consta em `work_group_members` (UI garante; trigger de salvaguarda no insert/update de `work_groups`).
- Índices: `tasks(assigned_group_id) where assigned_group_id is not null`; `work_group_members(collaborator_id)`.
- Grupos só para `context='work'` (validação no engine e na UI; CHECK opcional).

## RLS

- **tasks** (read/update/complete): ramo adicional `assigned_group_id IN (SELECT group_id FROM work_group_members WHERE collaborator_id = current_collab_id())`. Sempre `current_collab_id()`, nunca `auth.uid()` (17/24 colaboradores non-coinciding); testar com usuário non-coinciding.
- **work_groups / members:** SELECT para qualquer colaborador autenticado; INSERT para quem pode criar grupos — definição exata: `role IN ('manager','coordinator','director')` OU consta em `governance_leaders`; UPDATE/DELETE para `leader_id = current_collab_id()` ou diretor.
- Caminho do engine é `service_role` (ignora RLS) → validações equivalentes no código do engine; identidade do remetente nunca vem do marker.

## Engine TOM

- **Marker `<<TASK>>` create:** novo campo `assigned_group` (nome/slug). Resolução **server-side** contra `work_groups` ativos (case/acento-insensível); não encontrado ou ambíguo → TOM pergunta em vez de chutar. **ID nunca vem do LLM.**
- **Prompt (`system.js`):** bloco "GRUPOS DE TRABALHO" com grupos ativos (nome, líder, membros), para o TOM resolver "pro financeiro". Sem nomes hardcoded.
- **`resolveTaskByShortId`:** passa a incluir tarefas com `assigned_group_id` nos grupos do remetente (concluir/editar via WhatsApp).
- **Conclusão:** membro do grupo pode concluir; UPDATE condicionado a `status != 'done'` (corrida Rose×Ana → segunda recebe "já concluída por X"); grava `completed_by`; notifica `created_by` e demais membros.
- **Lembretes/cobranças:** iteram todos os membros. Escalação (`coordination_request_count` alto) → só `leader_id`.
- **Relatórios (`buildTeamSummary`, `buildLeaderBriefing`):** tarefa de grupo aparece como linha do grupo ("Financeiro — Rose+Ana"), sem duplicar por pessoa.
- Antes de codar: consultar `tom_known_issues` (protocolo de bugs/regressões).

## UI (PWA)

- **Gestão equipe › "Grupos de trabalho":** lista + criar/editar (nome, líder com nota "recebe as escalações", membros em chips DS com ✕ e "+ adicionar"). Visível para líderes/gestores; diretor vê todos.
- **Nova tarefa / edição:** seletor de responsável com abas **Pessoa | Grupo**; card do grupo selecionado mostra membros e a regra do pool.
- **Minhas tarefas:** inclui tarefas dos meus grupos com badge 👥 verde (`tom`) ao lado das pessoais.
- Regras obrigatórias: componentes DS (`CustomSelect`, `Button`, tokens `tom`/`bg-*`/`fg-*`), guardrail mobile (dispatcher `XMobile`/`XDesktop`, testar 375px e 1440px), mockup aprovado como referência visual.

## Edge cases

- **Sai do grupo →** perde acesso às tarefas abertas do grupo (modelo dinâmico, decidido). Concluídas ficam no histórico (`completed_by` é pessoa, não grupo).
- **Desativar grupo com tarefas abertas →** bloquear até reatribuir ou concluir.
- **Recorrência:** instâncias herdam `assigned_group_id` do template.
- **Grupos de tarefas (mãe/filhas, `parent_task_id`):** mãe e filhas compartilham o mesmo dono-grupo; cascata `maybeCompleteParentGroup` inalterada.
- **`governance_owner_id`/trigger de posse:** continua funcionando por `created_by`; não depende de `assigned_to`.

## Testes

- Unit: resolução de grupo por nome (acentos, ambiguidade); conclusão concorrente (claim idempotente).
- RLS: usuário non-coinciding vê/conclui tarefa do grupo; não-membro não vê.
- E2E real na VPS (`node --env-file=.env`), fluxo: Rose cria pro grupo → Ana vê → Ana conclui → Rose notificada.

## Fora de escopo (fase 2+)

- Criar/editar grupos via WhatsApp; multi-assignee ad-hoc (N:N); checklists operacionais por grupo; TOM dentro do grupo de WhatsApp (pack futuro); reatribuição em massa ao desativar grupo.

## Rollout

Migration → engine → UI → piloto com o Financeiro (Rose + Ana) → demais grupos conforme demanda.
