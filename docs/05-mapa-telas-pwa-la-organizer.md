# Mapa de Telas do PWA — LA Organizer

**Documento:** 05  
**Versão:** 2.0  
**Data:** 25 de abril de 2026  
**Referência:** Documentos 01 (v2.0), 02 (v2.0), 03 (v2.0), 04 (v2.0)  
**Plataforma:** PWA mobile-first (React/TypeScript)  
**Design:** Dark mode (padrão LA Music) com opção light mode

---

## Estrutura de navegação

### Bottom Navigation (4 tabs fixos)

| Tab | Ícone | Label | Tela principal |
|---|---|---|---|
| 1 | Círculo preenchido | Hoje | Visão do dia atual |
| 2 | Calendário | Semana | Visão semanal |
| 3 | Play/Seta | Projetos | Projetos e roadmap |
| 4 | Menu/Mais | Mais | Checklists, Emusys, configurações, histórico |

### Navegação por role

| Tela | Colaborador | Coordenador | Diretor |
|---|---|---|---|
| Hoje | ✓ | ✓ | ✓ |
| Semana | ✓ | ✓ | ✓ |
| Projetos (meus) | ✓ | ✓ | ✓ |
| Projeto detalhe | ✓ | ✓ | ✓ |
| Checklists operacionais | ✓ | ✓ | ✓ |
| Agenda Emusys | ✓ (professor) | — | — |
| Hábitos pessoais | ✓ | ✓ | ✓ |
| Configurações | ✓ | ✓ | ✓ |
| Histórico | ✓ | ✓ | ✓ |
| Dashboard do time | — | ✓ | ✓ |
| Pessoa detalhe | — | ✓ | ✓ |
| Aderência geral | — | ✓ | ✓ |
| Gestão de checklists | — | ✓ | ✓ |
| Broadcast | — | ✓ | ✓ |
| Dashboard executivo | — | — | ✓ |
| Todos os projetos | — | ✓ | ✓ |

**Total: 16 telas**

---

## Componentes globais

### Header

Presente em todas as telas. Conteúdo varia por tela.

```
┌─────────────────────────────────────────┐
│  Bom dia, Quintela          [Avatar MQ] │
│  Terça, 15 de abril                     │
└─────────────────────────────────────────┘
```

- Nome vem de `collaborators.full_name`
- Avatar: iniciais do nome com cor baseada no role
- Em telas internas: header com botão voltar + título da tela

### Bottom Navigation Bar

```
┌──────────┬──────────┬──────────┬──────────┐
│  ● Hoje  │ 📅 Semana│ ▶ Projetos│ ≡ Mais  │
└──────────┴──────────┴──────────┴──────────┘
```

- Tab ativo: cor accent (rosa LA Music #E91E63)
- Badge numérico em "Hoje" se tem tarefas atrasadas
- Badge numérico em "Mais" se tem notificação não lida

---

## Tela 1: Hoje

**Rota:** `/hoje`  
**Tab ativo:** Hoje  
**Dados:** daily_plans + daily_plan_items + tasks + emusys_classes (se professor)  
**Quem vê:** Todos

### Layout

```
┌─────────────────────────────────────────┐
│  Header (nome + data + avatar)          │
├─────────────────────────────────────────┤
│                                         │
│  SUAS 3 COISAS DE HOJE                  │
│                                         │
│  [✓] Resolver pai aluno Y      ── 9:15  │
│  [ ] Entrevista professor       ── 14h  │
│  [ ] Revisar material teatro            │
│                                         │
│  ████████░░░░░░░░░░  1 de 3 (33%)       │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  PENDÊNCIAS DE ONTEM            Ver >   │
│                                         │
│  ⚠ Roteiro pilar 1 — reagendado: qui   │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  PROJETOS ATIVOS                        │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ Projeto da Turminha        [azul] │  │
│  │ Próximo: Roteiros — 02/mai       │  │
│  │ █████░░░░░░░░░░░░░░  15%         │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ Teatro 2026             [roxo]    │  │
│  │ Audições sexta 19/abr            │  │
│  └───────────────────────────────────┘  │
│                                         │
├─────────────────────────────────────────┤
│  (SE PROFESSOR)                         │
│  AULAS HOJE (EMUSYS)                    │
│                                         │
│  14h João — Piano      ⚠ Sem presença  │
│  15h Maria — Piano     ✓ OK            │
│  16h Pedro — Teclado   ⚠ Sem conteúdo  │
│                                         │
├─────────────────────────────────────────┤
│  [Bottom Nav]                           │
└─────────────────────────────────────────┘
```

### Interações

| Elemento | Ação |
|---|---|
| Checkbox da tarefa | Toca → marca como concluída → animação de check → atualiza progresso |
| Card de projeto | Toca → navega pra Tela 6 (Projeto detalhe) |
| "Ver" pendências | Expande lista completa de pendências |
| Linha do Emusys | Toca → abre deeplink pro Emusys (se disponível) ou mostra alerta |
| Swipe esquerda na tarefa | Revela opção "Reagendar" |
| Long press na tarefa | Abre menu: Reagendar, Delegar, Pedir prazo, Detalhes |

---

## Tela 2: Semana

**Rota:** `/semana`  
**Tab ativo:** Semana  
**Dados:** weekly_plans + daily_plans + tasks  
**Quem vê:** Todos

### Layout

```
┌─────────────────────────────────────────┐
│  Semana 16 — Abril              [< >]   │
│  14/abr — 18/abr                        │
├─────────────────────────────────────────┤
│                                         │
│  Dom  Seg  TER  Qua  Qui  Sex  Sáb     │
│  13   14   •15  16   17   18   19       │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐           │
│  │ 2  │ │ 3  │ │ 1  │ │ 0  │           │
│  │Feit│ │Hoje│ │Pend│ │Atra│           │
│  └────┘ └────┘ └────┘ └────┘           │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  ENTREGAS DA SEMANA                     │
│                                         │
│  ┌─ ✓ Seg — Contato Renan      [feito]│
│  ├─ ✓ Seg — Ligar Renan áudio  [feito]│
│  ├─ ● Ter — Entrevista prof.    [hoje] │
│  ├─ ○ Qui — Reunião metas time  [pend]│
│  └─ ▫ Sex — Buffer            [buffer]│
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  METAS DA SEMANA (do planejamento)      │
│                                         │
│  1. Terminar roteiros pilar 1           │
│  2. Entrevista professor piano          │
│  3. Reunião metas com time              │
│  4. Resolver pai aluno Y               │
│  5. Audições teatro                     │
│                                         │
│  Taxa de conclusão: 40%                 │
│                                         │
├─────────────────────────────────────────┤
│  [Bottom Nav]                           │
└─────────────────────────────────────────┘
```

### Interações

| Elemento | Ação |
|---|---|
| Setas < > no header | Navega entre semanas |
| Dia na mini-barra | Toca → filtra entregas daquele dia |
| Card de entrega | Toca → abre detalhe da tarefa (modal ou tela) |
| Stat boxes | Toca no número → filtra por status |

---

## Tela 3: Projetos (lista)

**Rota:** `/projetos`  
**Tab ativo:** Projetos  
**Dados:** projects + project_members + project_checkpoints  
**Quem vê:** Todos (filtrado por membership pra colaborador)

### Layout

```
┌─────────────────────────────────────────┐
│  Meus Projetos                    [+ ]  │
│  3 ativos                    [Filtros]  │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ● Projeto da Turminha 2026       │  │
│  │   Vídeo Aulas                    │  │
│  │   Próximo: Roteiros — 02/mai     │  │
│  │   ████░░░░░░░░░░░  15%    [azul] │  │
│  │   Equipe: MQ, JB, Yuri          │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ● LA Educa                       │  │
│  │   Material Didático              │  │
│  │   Próximo: Estrutura — 25/abr    │  │
│  │   ██░░░░░░░░░░░░░░  5%   [verde]│  │
│  │   Equipe: JB, MQ                │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ● Teatro 2026                    │  │
│  │   Evento                         │  │
│  │   Audições: 19/abr               │  │
│  │   ██████████░░░░░  50%    [roxo] │  │
│  │   Equipe: JB                     │  │
│  └───────────────────────────────────┘  │
│                                         │
├─────────────────────────────────────────┤
│  [Bottom Nav]                           │
└─────────────────────────────────────────┘
```

### Interações

| Elemento | Ação |
|---|---|
| Botão [+] | Abre modal/tela de criação de projeto (formulário 5W2H). Só coordenador+ |
| Card de projeto | Toca → navega pra Tela 6 (Projeto detalhe) |
| Filtros | Por status (ativo/concluído/pausado), por categoria |

---

## Tela 4: Projeto detalhe

**Rota:** `/projetos/:id`  
**Dados:** projects + project_checkpoints + tasks (vinculadas) + project_members  
**Quem vê:** Membros do projeto + coordenador+ 

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Projeto da Turminha 2026           │
│  Prazo: 20 de junho — 15% concluído     │
├─────────────────────────────────────────┤
│                                         │
│  [Roadmap]  [Tarefas]  [Equipe]  [Info] │
│                                         │
├── TAB ROADMAP ──────────────────────────┤
│                                         │
│  ████████████████████████░░░░░░  15%    │
│                                         │
│  TIMELINE (Gantt mini horizontal)       │
│                                         │
│  Definição   ████                       │
│  Roteiros       ████                    │
│  Gravação          ████                 │
│  Edição               ████             │
│  Revisão                 ██             │
│  Plataforma                ████         │
│  Teste                        ████      │
│                                         │
│  CHECKPOINTS                            │
│                                         │
│  ✓ Definir programa — 25/abr — Quintela │
│  ● Roteiros — 02/mai — Quintela         │
│  ○ Gravação — 16/mai — Profs + Yuri     │
│  ○ Edição — 23/mai — Yuri              │
│  ○ Revisão — 26/mai — Juliana          │
│  ○ Plataforma — 06/jun — Hugo          │
│  ○ Teste — 20/jun — Todos              │
│                                         │
├── TAB TAREFAS ──────────────────────────┤
│                                         │
│  Filtro: [Todos ▼] [Status ▼]          │
│                                         │
│  🔴 Escrever roteiro pilar 1 — Quintela │
│     Prazo: 28/abr — Em andamento       │
│                                         │
│  ○  Agendar gravação — Juliana          │
│     Prazo: 02/mai — Pendente           │
│                                         │
│  ○  Reservar estúdio — Quintela         │
│     Prazo: 05/mai — Pendente           │
│                                         │
│  [+ Nova tarefa]                        │
│                                         │
├── TAB EQUIPE ───────────────────────────┤
│                                         │
│  [MQ] Marcos Quintela — Owner           │
│       8 tarefas — 3 feitas (37%)        │
│                                         │
│  [JB] Juliana Baltazar — Membro         │
│       4 tarefas — 2 feitas (50%)        │
│                                         │
│  [Yu] Yuri — Membro                     │
│       2 tarefas — 0 feitas (0%)         │
│                                         │
├── TAB INFO ─────────────────────────────┤
│                                         │
│  Nome: Projeto da Turminha 2026         │
│  Por quê: Levar pro CAEM, posicionar... │
│  Onde: Todas as unidades                │
│  Início: 14/abr — Fim: 20/jun          │
│  Como: Gravar aulas, editar, subir...   │
│  Horas/semana: ~10h                     │
│  Categoria: Vídeo Aulas                 │
│  Criado por: Marcos Quintela            │
│                                         │
│  [Editar projeto] (coordenador+)        │
│                                         │
└─────────────────────────────────────────┘
```

### Interações

| Elemento | Ação |
|---|---|
| Tabs | Alterna entre Roadmap, Tarefas, Equipe, Info |
| Checkpoint | Toca → expande com tarefas vinculadas e botão de marcar como feito |
| Tarefa | Toca → abre detalhe/edição. Swipe → reagendar |
| [+ Nova tarefa] | Abre modal de criação vinculada ao projeto |
| Barra do Gantt | Scroll horizontal se necessário |

---

## Tela 5: Mais (menu)

**Rota:** `/mais`  
**Tab ativo:** Mais  
**Quem vê:** Todos (itens variam por role)

### Layout

```
┌─────────────────────────────────────────┐
│  Mais                                   │
├─────────────────────────────────────────┤
│                                         │
│  ☐ Checklists operacionais       [3/4] │
│  🔥 Hábitos pessoais        streak: 12 │
│  📊 Agenda Emusys          (professor)  │
│  📈 Histórico                           │
│  ⚙ Configurações                        │
│                                         │
│  ── GESTÃO (coordenador+) ──────────── │
│                                         │
│  👥 Dashboard do time                   │
│  📋 Aderência geral                    │
│  ☐ Gestão de checklists                │
│  📢 Broadcast                          │
│  📁 Todos os projetos                  │
│                                         │
│  ── DIREÇÃO (diretor) ─────────────── │
│                                         │
│  🏠 Dashboard executivo                 │
│                                         │
├─────────────────────────────────────────┤
│  [Bottom Nav]                           │
└─────────────────────────────────────────┘
```

---

## Tela 6: Checklists operacionais

**Rota:** `/checklists`  
**Dados:** op_checklists + op_checklist_items + op_checklist_completions  
**Quem vê:** Todos (filtrado por function_role)

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Checklists operacionais            │
│  Seus checklists de hoje                │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ▼ Abertura da Escola              │  │
│  │   DIÁRIO — Secretária Manhã       │  │
│  │   HOJE: 6/6 ✓                     │  │
│  │                                   │  │
│  │   [✓] Abrir escola às 6:50       │  │
│  │   [✓] Ligar ar e luzes           │  │
│  │   [✓] Verificar agenda Emusys    │  │
│  │   [✓] Conferir salas             │  │
│  │   [✓] Preparar material          │  │
│  │   [✓] Enviar lembretes           │  │
│  │                                   │  │
│  │   Preenchido por: Lorraine 07:02 │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ▶ Fechamento da Escola            │  │
│  │   DIÁRIO — Secretária Noite       │  │
│  │   HOJE: 0/5 ⏳                    │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ▶ Fiscalização de Salas           │  │
│  │   DIÁRIO — Assistente Pedagógico  │  │
│  │   HOJE: 4/6 ⏳                    │  │
│  └───────────────────────────────────┘  │
│                                         │
├─────────────────────────────────────────┤
│  ADERÊNCIA DO MÊS                      │
│                                         │
│  Abertura da Escola      18/20   [90%]  │
│  Fechamento da Escola    15/20   [75%]  │
│  Fiscalização de Salas   12/20   [60%]  │
│                                         │
└─────────────────────────────────────────┘
```

### Interações

| Elemento | Ação |
|---|---|
| Checklist colapsado | Toca → expande itens |
| Checkbox do item | Toca → marca item, atualiza contagem |
| Campo de observação | Ao marcar item, pode adicionar nota (ex: "ar da sala 3 quebrado") |
| Badge de aderência | Cor por faixa: verde ≥90%, amarelo 70-89%, vermelho <70% |

---

## Tela 7: Agenda Emusys

**Rota:** `/emusys`  
**Dados:** emusys_classes  
**Quem vê:** Professores

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Agenda de aulas                    │
│  Hoje — Terça, 15 de abril              │
├─────────────────────────────────────────┤
│                                         │
│  14:00  João Silva — Piano              │
│         ⚠ Presença pendente             │
│         ⚠ Conteúdo pendente             │
│                                         │
│  15:00  Maria Santos — Piano            │
│         ✓ Presença OK                   │
│         ✓ Conteúdo OK                   │
│                                         │
│  16:00  Pedro Lima — Teclado            │
│         ✓ Presença OK                   │
│         ⚠ Conteúdo pendente             │
│                                         │
│  17:00  Ana Costa — Piano               │
│         ○ Aula não iniciada             │
│                                         │
├─────────────────────────────────────────┤
│  RESUMO DO DIA                          │
│                                         │
│  Aulas: 4 | Presença: 2/3 | Conteúdo: 1/3 │
│                                         │
├─────────────────────────────────────────┤
│  ADERÊNCIA DA SEMANA                    │
│                                         │
│  Presença lançada:    92%   [verde]     │
│  Conteúdo registrado: 78%   [amarelo]   │
│                                         │
└─────────────────────────────────────────┘
```

---

## Tela 8: Hábitos pessoais

**Rota:** `/habitos`  
**Dados:** habits + habit_logs + habit_templates  
**Quem vê:** Todos (apenas dados próprios — 100% privado)

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Meus hábitos                       │
│  3 ativos — melhor streak: 12 dias      │
├─────────────────────────────────────────┤
│                                         │
│  HOJE                                   │
│                                         │
│  💪 Academia          ✓ feito    🔥 12  │
│  📚 Leitura 30 min    ○ pendente 🔥 5   │
│  ✨ Afirmações        ✓ feito    🔥 8   │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  ESTA SEMANA                            │
│                                         │
│  💪 ✓✓✓○○○○  3/5 (seg-sex)             │
│  📚 ✓✓✓✓○○○  4/7 (diário)              │
│  ✨ ✓✓✓✓✓○○  5/7 (diário)              │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  [+ Novo hábito]                        │
│  [Ver templates prontos]                │
│                                         │
└─────────────────────────────────────────┘
```

### Interações

| Elemento | Ação |
|---|---|
| Checkbox do hábito | Toca → marca como feito → incrementa streak → animação de fogo |
| Streak (🔥 número) | Visual motivacional — número de dias consecutivos |
| [+ Novo hábito] | Formulário simples: nome, ícone, cor, frequência, horário de lembrete |
| [Ver templates] | Lista de templates prontos pra ativar com um toque |
| Long press no hábito | Menu: editar, pausar, excluir, ver histórico |

---

## Tela 9: Configurações

**Rota:** `/configuracoes`  
**Dados:** user_preferences + collaborators  
**Quem vê:** Todos

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Configurações                      │
├─────────────────────────────────────────┤
│                                         │
│  RITUAIS                                │
│                                         │
│  Horário briefing pessoal  [07:00 ▼]    │
│  Horário briefing trabalho [08:00 ▼]    │
│  Horário do fechamento     [19:00 ▼]    │
│  Dia do planejamento       [Domingo ▼]  │
│  Horário do planejamento   [19:00 ▼]    │
│  Intensidade da cobrança   [Normal ▼]   │
│                                         │
│  NOTIFICAÇÕES                           │
│                                         │
│  Alertas de prazo          [● ligado]   │
│  Alertas de atraso         [● ligado]   │
│  Resumo do time            [● ligado]   │
│                                         │
│  INTEGRAÇÕES                            │
│                                         │
│  Google Calendar    [Conectar]          │
│  Status: Não conectado                  │
│                                         │
│  PERFIL                                 │
│                                         │
│  Nome: Marcos Quintela                  │
│  Telefone: +55 21 99999-9999            │
│  Função: Coordenador Pedagógico         │
│  Unidade: Todas                         │
│                                         │
└─────────────────────────────────────────┘
```

---

## Tela 9: Histórico

**Rota:** `/historico`  
**Dados:** daily_plans + weekly_plans + ritual_logs  
**Quem vê:** Todos (próprio histórico)

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Histórico                          │
│  [Semana ▼] [Abril 2026 ▼]             │
├─────────────────────────────────────────┤
│                                         │
│  SEMANA 16 (14-18 ABR)          72%     │
│                                         │
│  Seg 14  ████████████░░  3/4    75%     │
│  Ter 15  ██████░░░░░░░░  2/4    50%     │
│  Qua 16  ████████████░░  3/4    75%     │
│  Qui 17  ████████████████ 4/4   100%    │
│  Sex 18  ████████░░░░░░  2/3    66%     │
│                                         │
│  Rituais respondidos: 9/10 (90%)        │
│  Tempo médio de resposta: 12 min        │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  SEMANA 15 (07-11 ABR)          68%     │
│  ...                                    │
│                                         │
└─────────────────────────────────────────┘
```

---

## Tela 10: Dashboard do time

**Rota:** `/time`  
**Dados:** collaborators + daily_plans + tasks + ritual_logs + op_checklist_completions + emusys_classes  
**Quem vê:** Coordenador + Diretor

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Meu time                           │
│  Semana 16 — 8 colaboradores            │
├─────────────────────────────────────────┤
│                                         │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐           │
│  │ 72%│ │  3 │ │  1 │ │ 85%│           │
│  │Conc│ │Atra│ │Inat│ │Ader│           │
│  └────┘ └────┘ └────┘ └────┘           │
│                                         │
│  RANKING DA SEMANA                      │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ [Jo] Joel          92%  ✓✓✓✓✓    │  │
│  │      4/4 hoje — 12/13 semana     │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ [Er] Eric          85%  ✓✓✓✓○    │  │
│  │      2/2 hoje — 6/7 semana       │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ [Jd] Jordão        50%  ✓✓○○○ ⚠  │  │
│  │      1/3 hoje — 4/8 semana       │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ [Ca] Prof. Caio    —    ❌❌❌ ⚠  │  │
│  │      Sem resposta há 2 dias      │  │
│  └───────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

### Interações

| Elemento | Ação |
|---|---|
| Card de pessoa | Toca → navega pra Tela 11 (Pessoa detalhe) |
| Stat boxes | Toca → filtra lista por critério |
| Alerta ⚠ | Toca → opção de enviar cobrança via TOM |

---

## Tela 11: Pessoa detalhe

**Rota:** `/time/:id`  
**Dados:** tudo do colaborador selecionado  
**Quem vê:** Coordenador + Diretor

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Joel — Assistente Pedagógico       │
│  Campo Grande                           │
├─────────────────────────────────────────┤
│                                         │
│  [Tarefas]  [Projetos]  [Rituais]       │
│              [Checklists]  [Emusys]     │
│                                         │
├── TAB TAREFAS ──────────────────────────┤
│                                         │
│  Esta semana: 12/13 (92%)               │
│                                         │
│  ✓ Imprimir partituras                  │
│  ✓ Montar roteiro violino               │
│  ● Fiscalizar salas (hoje)              │
│  ...                                    │
│                                         │
├── TAB RITUAIS ──────────────────────────┤
│                                         │
│  Briefings respondidos: 5/5 (100%)      │
│  Fechamentos respondidos: 4/5 (80%)     │
│  Tempo médio resposta: 8 min            │
│  Planejamento semanal: ✓ Feito          │
│                                         │
├── TAB EMUSYS (se professor) ────────────┤
│                                         │
│  Presença lançada: 95%                  │
│  Conteúdo registrado: 82%               │
│  Aulas sem presença esta semana: 1      │
│                                         │
├── TAB CHECKLISTS ───────────────────────┤
│                                         │
│  Fiscalização de salas: 90%             │
│  Relatório diário: 75%                  │
│                                         │
│  [Enviar cobrança] [Criar tarefa pra]   │
│                                         │
└─────────────────────────────────────────┘
```

---

## Tela 12: Aderência geral

**Rota:** `/aderencia`  
**Dados:** ritual_logs + op_checklist_completions + emusys_classes  
**Quem vê:** Coordenador + Diretor

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Aderência geral                    │
│  [Abril 2026 ▼]                         │
├─────────────────────────────────────────┤
│                                         │
│  RITUAIS                                │
│  Briefings: 85%  Fechamentos: 72%       │
│  Planejamentos: 90%                     │
│                                         │
│  CHECKLISTS OPERACIONAIS                │
│  Abertura escola: 92%                   │
│  Fechamento escola: 78%                 │
│  Fiscalização salas: 65% ⚠             │
│                                         │
│  EMUSYS (professores)                   │
│  Presença: 91%                          │
│  Conteúdo: 74% ⚠                       │
│                                         │
│  POR PESSOA (pior → melhor)             │
│                                         │
│  Prof. Caio      45% ████░░░░░░  🔴     │
│  Jordão          62% ██████░░░░  🟡     │
│  Lorraine        78% ████████░░  🟡     │
│  Quintela        85% ████████░░  🟢     │
│  Joel            95% ██████████  🟢     │
│                                         │
└─────────────────────────────────────────┘
```

---

## Tela 13: Gestão de checklists

**Rota:** `/checklists/gestao`  
**Dados:** op_checklists + op_checklist_items  
**Quem vê:** Coordenador + Diretor

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Gestão de checklists         [+]   │
├─────────────────────────────────────────┤
│                                         │
│  Abertura da Escola                     │
│  Diário — Secretária Manhã — 6 itens    │
│  [Editar] [Desativar]                   │
│                                         │
│  Fechamento da Escola                   │
│  Diário — Secretária Noite — 5 itens    │
│  [Editar] [Desativar]                   │
│                                         │
│  Fiscalização de Salas                  │
│  Diário — Assistente Pedagógico — 6 itens│
│  [Editar] [Desativar]                   │
│                                         │
│  Rotina Semanal Coordenação             │
│  Semanal — Coordenação — 4 itens        │
│  [Editar] [Desativar]                   │
│                                         │
└─────────────────────────────────────────┘
```

### Modal de edição

```
┌─────────────────────────────────────────┐
│  Editar: Abertura da Escola             │
│                                         │
│  Nome: [Abertura da Escola          ]   │
│  Função: [Secretária Manhã ▼]           │
│  Tipo: [Diário ▼]                       │
│  Turno: [Manhã ▼]                       │
│  Unidade: [Todas ▼]                     │
│                                         │
│  ITENS (arrastar pra reordenar)         │
│  ≡ Abrir escola às 6:50           [🗑] │
│  ≡ Ligar ar-condicionado e luzes   [🗑] │
│  ≡ Verificar agenda no Emusys      [🗑] │
│  ≡ Conferir salas e instrumentos   [🗑] │
│  ≡ Preparar material de alunos     [🗑] │
│  ≡ Enviar lembretes de aula        [🗑] │
│                                         │
│  [+ Adicionar item]                     │
│                                         │
│  [Cancelar]              [Salvar]       │
└─────────────────────────────────────────┘
```

---

## Tela 14: Dashboard executivo

**Rota:** `/dashboard`  
**Dados:** todas as tabelas (agregado)  
**Quem vê:** Diretor

### Layout

```
┌─────────────────────────────────────────┐
│  [←] Dashboard executivo                │
│  Abril 2026                             │
├─────────────────────────────────────────┤
│                                         │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐           │
│  │ 72%│ │  5 │ │  2 │ │ 85%│           │
│  │Conc│ │Proj│ │Risk│ │Ader│           │
│  │Geral│ │Ativ│ │    │ │Oper│          │
│  └────┘ └────┘ └────┘ └────┘           │
│                                         │
│  PROJETOS                               │
│                                         │
│  ✅ Teatro 2026 — 50% — no prazo        │
│  ⏳ Proj. Turminha — 15% — no prazo     │
│  ⏳ LA Educa — 5% — atenção             │
│  ⚠ Sem. Baterista — 100% — atrasado    │
│                                         │
│  EQUIPE                                 │
│                                         │
│  Respondendo rituais: 35/40 (87%)       │
│  Emusys em dia: 8/10 profs (80%)        │
│  Checklists em dia: 28/30 (93%)         │
│                                         │
│  QUEM PRECISA DE ATENÇÃO                │
│                                         │
│  ⚠ Prof. Caio — sem resposta 2 dias    │
│  ⚠ Jordão — conclusão 50%             │
│  ⚠ LA Educa — sem tarefas criadas     │
│                                         │
│  EVOLUÇÃO MENSAL                        │
│                                         │
│  [Gráfico de linha: taxa de conclusão   │
│   ao longo das semanas do mês]          │
│                                         │
└─────────────────────────────────────────┘
```

---

## Modais reutilizáveis

### Modal: Criar/Editar tarefa

```
┌─────────────────────────────────────────┐
│  Nova tarefa                            │
│                                         │
│  Título: [                          ]   │
│  Descrição: [                       ]   │
│  Responsável: [Selecionar ▼]            │
│  Prazo: [dd/mm/aaaa]                    │
│  Prioridade: [Média ▼]                  │
│  Categoria: [Operacional ▼]             │
│  Projeto: [Nenhum ▼]                    │
│  Checkpoint: [Nenhum ▼]                 │
│                                         │
│  [Cancelar]              [Criar]        │
└─────────────────────────────────────────┘
```

### Modal: Criar projeto (5W2H)

```
┌─────────────────────────────────────────┐
│  Novo projeto                           │
│                                         │
│  Nome do projeto: [                 ]   │
│  Descrição: [                       ]   │
│  Por que é importante: [            ]   │
│  Onde: [                            ]   │
│  Data início: [dd/mm/aaaa]              │
│  Data fim: [dd/mm/aaaa]                 │
│  Como será feito: [                 ]   │
│  Horas/semana estimadas: [    ]         │
│  Categoria: [Selecionar ▼]              │
│  Cor: [● ● ● ● ● ●]                   │
│  Equipe: [Adicionar membros]            │
│                                         │
│  [Cancelar]              [Criar]        │
└─────────────────────────────────────────┘
```

### Modal: Detalhe da tarefa

```
┌─────────────────────────────────────────┐
│  Entrevista professor piano             │
│  Prazo: 02/mai — Status: Em andamento   │
│                                         │
│  Responsável: Quintela                  │
│  Projeto: Projeto da Turminha           │
│  Checkpoint: Roteiros                   │
│  Prioridade: Alta                       │
│  Criada em: 14/abr por Quintela         │
│                                         │
│  COMENTÁRIOS                            │
│  14/abr — "Candidato indicado pelo      │
│            Renan, agendar pra terça"    │
│  [Adicionar comentário]                 │
│                                         │
│  [Reagendar] [Delegar] [Concluir]       │
└─────────────────────────────────────────┘
```

---

## Fluxo de navegação

```
Bottom Nav
├── Hoje (/hoje)
│   └── Tarefa detalhe (modal)
│   └── Projeto detalhe (/projetos/:id)
│
├── Semana (/semana)
│   └── Tarefa detalhe (modal)
│
├── Projetos (/projetos)
│   └── Projeto detalhe (/projetos/:id)
│       ├── Tab Roadmap
│       ├── Tab Tarefas → Tarefa detalhe (modal)
│       ├── Tab Equipe → Pessoa detalhe (/time/:id)
│       └── Tab Info → Editar projeto (modal)
│   └── Criar projeto (modal)
│
└── Mais (/mais)
    ├── Checklists (/checklists)
    ├── Agenda Emusys (/emusys) — professor
    ├── Histórico (/historico)
    ├── Configurações (/configuracoes)
    ├── Dashboard do time (/time) — coordenador+
    │   └── Pessoa detalhe (/time/:id)
    ├── Aderência geral (/aderencia) — coordenador+
    ├── Gestão de checklists (/checklists/gestao) — coordenador+
    ├── Broadcast (/broadcast) — coordenador+
    ├── Todos os projetos (/projetos/todos) — coordenador+
    └── Dashboard executivo (/dashboard) — diretor
```

---

**Próximo passo:** Documento 06 — PRD completo (consolidação de todos os documentos).
