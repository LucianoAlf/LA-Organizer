# Workspace de Grupos de Trabalho — Design

**Data:** 2026-06-10 (noite) · **Aprovado por:** Alf · **Origem:** ideia do Alf vendo a página atual de Grupos ("aqui deveria morar o ambiente de trabalho delas, não só a configuração").

## Problema

A página `Grupos de trabalho` (web/src/screens/gestao/GruposTrabalho.tsx) é só configuração: criar grupo, membros, líder. O pool de tarefas do grupo (entregue 10/06) aparece espalhado nas listas pessoais (Hoje/Semana/Agenda, badge 👥), mas:
- Não existe NENHUM lugar pra ver "como está o Financeiro" (abertas, atrasadas, quem concluiu o quê).
- Não existe edição de tarefa de grupo em lugar nenhum (EditTaskSheet/TaskEditDrawer assumem dono-pessoa).
- O pacote mensal do grupo (grupo-de-subtarefas no pool) não tem casa com progresso.

## Decisões de produto (Alf, 10/06 — via AskUserQuestion + mockups no companion)

1. **Conteúdo = SÓ o pool do grupo.** O workspace é a casa do trabalho DO GRUPO. As tarefas pessoais seguem na Agenda — o badge 👥 da Agenda é ponte, não cópia. Zero duplicação de listas.
2. **Acesso = qualquer MEMBRO do grupo.** Ser membro dá acesso ao workspace dos SEUS grupos (é ambiente de trabalho, não tela de gestão). Administrar (criar grupo, membros, líder, desativar) continua restrito a `can_manage_groups()`.
3. **Permissão de edição = todo membro edita tudo** (criar, editar, prazo, cancelar). É o que a RLS `tasks_group_member_all` já permite. Ações destrutivas pedem confirmação.
4. **Layout = Opção A "Painel do grupo por urgência"**, escolhida entre 3 mockups. **Exigência explícita do Alf: manter a UI fiel ao mockup aprovado** ("essa UI tá muito bonita... tem que manter").

**Mockups canônicos (tokens exatos do DS, light):**
- `docs/superpowers/specs/assets/2026-06-10-workspace-grupos-mockup.html` ← fluxo final aprovado (lista → workspace → sheet de edição, desktop + mobile)
- `docs/superpowers/specs/assets/2026-06-10-workspace-grupos-opcoes.html` (as 3 opções; A escolhida)

## Rotas e navegação

| Rota | Conteúdo |
|---|---|
| `/grupos` | Lista dos grupos visíveis ao usuário (cards com resumo). |
| `/grupos/:groupId` | Workspace do grupo. |
| `/mais/grupos-trabalho` | **Redirect** pra `/grupos` (não quebrar hábito/links). |

- **Sidebar desktop:** item "Grupos de trabalho" SOBE da seção GESTÃO pra **PRINCIPAL** (após Anotações) — agora é ambiente de trabalho de qualquer membro. Ícone Users mantido.
- **Mobile:** Mais → "Grupos de trabalho" aponta pro mesmo destino.
- **Atalho:** quem tem exatamente 1 grupo e NÃO é gestor cai direto no workspace do grupo único (lista pulada).
- **Acesso por conteúdo, não role-gate:** remover `requireRoles` da rota. Membro vê seus grupos; `can_manage_groups` (manager/coordinator/director ou líder em governance_leaders) vê todos; quem não tem grupo nenhum vê empty state ("Você ainda não está em nenhum grupo").

## Página `/grupos` (lista)

Card por grupo (mockup seção 1): nome (card-title), membros com ★ no líder (body-sm muted), progresso do mês ("X de Y no mês" + barra `la-prog`), badges de alerta à direita (🔴 "N atrasadas" danger / 🟠 "1 vence sexta" warning), chevron →. Botão "+ Novo grupo" (primary) só pra `can_manage_groups`. Empty e loading states padrão (EmptyState/LoadingState).

## Workspace `/grupos/:groupId` (mockup seção 2)

**Header:** breadcrumb "‹ Grupos" · `👥 Nome` (screen-title) · linha de membros "★ Rose · Ana · Luciano — qualquer um conclui" (body-sm muted). Ações à direita (desktop): `🗂️ + Pacote mensal` (secondary) · `+ Nova tarefa` (primary) · `⚙` (só líder do grupo ou can_manage_groups). Mobile: ⚙ no header, FAB `+` (abre QuickCreate com grupo pré-selecionado).

**Stats (4 StatCards):** Abertas · Vence em breve (≤7 dias) · Atrasadas · Feitas no mês.

**Seções (cada uma oculta quando vazia):**
1. **🔴 Atrasadas** — surface com border danger/35; linha: checkbox, título, badge "Nd atrasada", "por <criador>", menu ⋮.
2. **⏰ Vence em breve** — due ≤ hoje+7d (e ≥ hoje); badge warning "sexta 12/06".
3. **🗂️ Pacotes do mês** — mães `is_group=true` do pool (ciclo corrente, mesma lógica de `fetchGroupsForDay`/motherActiveCycle): card com nome, chip "mensal" quando recorrente, contador X/Y, barra de progresso, filhas inline (toggle conclui com cascata — reusa `toggleChildWithCascade`), filha concluída mostra "dia N · por <quem>".
4. **📅 Mais pra frente / sem prazo** — avulsas com due > 7d ou sem due (CollapsibleSection fechada por padrão; mesma linha visual das demais).
5. **✅ Feitas recentemente** — últimas 10 do mês corrente, riscadas, opacity .85, badge success "por Ana · hoje 14:02" (completed_by + completed_at relativo: hoje HH:MM / ontem / DD/MM).

**Concluir** (checkbox em qualquer seção): update com anti-corrida (`.neq('status','done').select()`); 0 rows → toast "✋ já concluída por X" + refetch (espelha o padrão do engine).

**Clicar na tarefa avulsa → GroupTaskSheet.** Clicar no pacote → `TaskGroupSheet` existente (gestão de subtarefas já pronta).

**⚙ Config (popover desktop / sheet mobile):** exatamente o card atual — chips de membros (✕ remove), "+ membro", líder via CustomSelect (director ou líder), "desativar grupo" (bloqueio com tarefas abertas já existe). Reusa as mutations de `useWorkGroups` sem mudança.

## GroupTaskSheet — edição de tarefa do pool (NOVO, mockup seção 3)

AdaptiveSheet. Subtítulo: "👥 <grupo> · criada por <X> · qualquer membro pode editar".
Campos: Título (input canônico) · Descrição (textarea) · Prazo (DateInput) + Hora (TimeInput) · Lembretes (chips preset → task_reminders; rótulo "vão pra TODOS os membros" — fan-out já existe no dispatcher).
Ações: **Cancelar tarefa** (danger outline, ConfirmDialog; status='cancelled' — exclusão é sempre cancelamento reversível) · Fechar · **Salvar** (primary).
Regras: ao mudar due_date, `reminded_at=null` (re-arma o lembrete T-1 do grupo); task_reminders novos inseridos/órfãos não enviados removidos. Se a tarefa está done: mostra "concluída por Y" e oferece "reabrir".
Fora do MVP (decidido): sem "puxar pra mim", sem trocar dono grupo↔pessoa, sem prioridade no sheet.

**Escrita por NÃO-membro:** membro tem RLS ALL garantida. Gestor não-membro (ex.: Alf fora do grupo): verificar na implementação se existe policy de UPDATE que o cubra; se não houver, o sheet abre em **modo leitura** pra não-membro (banner "só membros editam — entra no grupo pela ⚙"). Nunca falhar salvar em silêncio.

## Dados — hook `useGroupWorkspace(groupId)` (novo, zero migration)

- **Q1 avulsas:** `assigned_group_id=eq` · `is_group=false` · `parent_task_id is null` · `status≠cancelled` · `data_classification='real'` · (status≠done de QUALQUER data) ∪ (done com completed_at no mês corrente). Embed `completed_by_collab:collaborators!tasks_completed_by_fkey(full_name)` e `creator:collaborators!tasks_created_by_fkey(full_name)` — **FK explícita obrigatória** (tasks tem várias FKs pra collaborators).
- **Q2 pacotes:** mães `is_group=true` do grupo com `GROUP_SELECT` (filhas embed), filtro de ciclo corrente em JS (mesma regra de fetchGroupsForDay — extrair o filtro pra função pura `isActiveCycle(mother, todayYmd)` em taskGroups.ts e reusar nos 2 lugares).
- **Q3 lista `/grupos`:** `useWorkGroups().list` + 1 query agregada de counts (abertas/atrasadas/feitas-mês por grupo, em JS sobre um select leve).
- queryKeys: `['group-workspace', groupId]`, `['groups-overview']`; invalidar junto com `['tasks']` e `['task-groups']` nas mutations.

## Criação pré-configurada

`QuickCreateSheet` ganha props opcionais `defaultKind?: Kind` e `defaultGroupId?: string`: o reset do open passa a inicializar `kind`, `taskGroupMode=true` e `taskGroupId` quando fornecidos. "+ Nova tarefa" → kind='task' + grupo travado; "🗂️ + Pacote mensal" → kind='group' + grupo. Nenhuma outra mudança no sheet.

## Mobile

Mesma rota/componentes, 1 coluna (mockup mobile): stats compactos, seções empilhadas, FAB. A página atual já é responsiva — o workspace nasce responsivo (sem fork XDesktop/XMobile; não há tela mobile legada a preservar, e o redirect mantém o caminho antigo vivo).

## Fora do MVP (radar)

- Badge 👥 da Agenda clicável → deep-link pro workspace.
- "Puxar pra mim" / claim individual; mover dono grupo↔pessoa.
- Realtime (refetch on focus do react-query basta).
- Relatórios por grupo (buildTeamSummary/leader-briefing — pendência já registrada no plano do MVP de grupos).
- TOM dentro do grupo de WhatsApp (visão de longo prazo; slug é a âncora).

## Validação

- tsc --noEmit + vite build.
- Preview 1366px e 375px: conferência visual CONTRA O MOCKUP (tokens: tom #A3BE50, radius sm10/md16, tipografia da escala, Badge/Button/CustomSelect/DateInput/TimeInput/AdaptiveSheet/StatCard/CollapsibleSection do DS — nenhuma cor/fonte fora da escala).
- E2E real: grupo Financeiro — Rose/Ana veem workspace; concluir com anti-corrida; editar prazo re-arma lembrete; ⚙ restrita; /mais/grupos-trabalho redireciona.
- Mobile 375px intacto nas 38 rotas (guardrail).
