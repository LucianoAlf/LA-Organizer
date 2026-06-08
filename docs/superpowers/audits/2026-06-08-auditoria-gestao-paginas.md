# Auditoria funda — páginas do bloco GESTÃO (+ cauda Sistema)

**Data:** 2026-06-08
**Pedido do CEO:** "fizemos só o Dashboard time. Pra cada página dessa: pra que existe, que valor real entrega, tá over-engineered, conflita com outra? Me traz um relatório honesto."
**Método:** 1 agente dedicado por página → código + dado real no banco (SELECTs no Supabase `cesnbnrynvxvgdhfmaua`) + intenção original nos `docs/specs`. Confirmação visual ao vivo no preview (4173) nas 3 páginas mais decisivas.

---

## TL;DR — mapa de veredito

| Página | Rota | Real? | Dado vivo? | Veredito | Esforço |
|---|---|---|---|---|---|
| **Dashboard time** | `/time` | ✅ | ✅ | FEITO (referência) | — |
| **Comunicados** | `/mais/comunicados` | ✅ ponta-a-ponta | ✅ (1 envio, 20/20 jobs, 13 confirm.) | **MANTER + MELHORAR** (a joia) | M |
| **Operações** | `/mais/operacoes` | ✅ | ⚠️ baixo volume (3 ativas / 38 total) | **MELHORAR** (cortar over-eng) | P |
| **Gestão equipe** | `/mais/gestao-equipe` | ✅ CRUD | ✅ (31 colaboradores) | **MANTER** | — |
| **Credenciais** | `/mais/governanca` | ✅ cofre real | ✅ (18 segredos reais) | **MANTER + MELHORAR** (matar rotas mortas) | P |
| **Observabilidade** | `/mais/observabilidade` | ✅ | ❌ (0 aprovações jamais) | **CONSOLIDAR em Comunicados + RENOMEAR** | M |
| **Aderência** | `/mais/aderencia-checklists` | ✅ (melhor gating do app) | ❌ MORTA (templates off desde 29/04) | **DECIDIR: ressuscitar OU matar** | P/P |
| **Agenda LA Music** | `/mais/agenda-escolar` | ✅ | ⚠️ raso (4 eventos) | **MANTER função, MOVER de lugar** | P |
| **Histórico** | `/historico` | ✅ | ✅ (diário aderência 30d) | **MANTER ou CONSOLIDAR na Agenda** | M |

---

## Página por página

### 1. Comunicados — `/mais/comunicados` — **A JOIA (MANTER + MELHORAR · M)**
- **Missão:** broadcast WhatsApp pro time inteiro (ou recortes) com fila/throttle anti-ban + confirmação de leitura. Bate exatamente com a visão do CEO.
- **Envio ponta-a-ponta: SIM, em produção.** `ComunicadoSheet.tsx:356` INSERT em `announcements` → cron `*/5` `dispatcher.js:1572 dispatchAnnouncements` → `whatsapp.sendMessage/sendMedia` (POST real UAZAPI). Prova no banco: 1 comunicado `sent`, 20/20 jobs `sent`, 13 confirmações reais de leitura.
- **Filinha anti-ban: EXISTE e é legítima.** `dispatcher.js:1604-1678`: batch 20/tick, `sleep(3000–6000ms)` com jitter entre cada envio, retry 3×, FIFO. (Comentário "1 msg/min" na L1570 está desatualizado, mas o código real faz 3–6s.)
- **Mock?** Zero. Os "7 sinais" eram a palavra "Todos/todo" em labels (falso-positivo).
- **Lacunas (o que falta pra ficar à altura):**
  1. **Escopo de time** — qualquer coord pode mandar `{all:true}` = empresa toda; não há recorte pro time do próprio líder. Não bate com o multi-tenant do resto da governança.
  2. **Aprovação pulada no PWA** — o workflow `pending_approval` existe no schema e na UI, mas o sheet insere direto como `scheduled` (`ComunicadoSheet.tsx:362`). Comunicado de não-director deveria cair em aprovação.
  3. Corrigir comentário de rate; expor ou remover `confirmation_question`; ETA na UI durante envio.

### 2. Observabilidade — `/mais/observabilidade` — **CONSOLIDAR + RENOMEAR (M)**
- **O que é (confirmado ao vivo):** subtítulo literal *"Aprovações pendentes · fila ao vivo · histórico de envios"*. **É o backstage do Comunicados** — director aprova/rejeita o que a coordenação escreveu e vê entrega. O nome "Observabilidade" é mentira: não consome `health-check`/`ritual_logs`/`marker_logs`.
- **Dado:** tudo real, mas **o fluxo de aprovação nunca foi exercido 1× em produção** (`pending_approval=0`, `ever_reviewed=0`). `refetchInterval:15s` sobre 1 linha = polling de vaidade.
- **Veredito:** mover os 3 blocos pra dentro de **Comunicados** como aba "Aprovações & Envios" (um recurso, uma porta). Se mantida separada, no mínimo **renomear** — foi o nome que fez o próprio CEO perguntar "o que é essa porra?". Reservar a palavra "Observabilidade" pra uma futura tela real de saúde do TOM (que hoje não existe na UI).

### 3. Aderência — `/mais/aderencia-checklists` — **DECISÃO DE PRODUTO (P)**
- **Missão:** visão de cumprimento de checklists operacionais (abertura/fechamento/limpeza/fiscalização) por colaborador, com drilldown. Gating multi-tenant é **o melhor do app** (RLS por unidade, director vê tudo, manager só a dele).
- **Confirmado ao vivo:** renderiza "Sem checklists despachados". **Clinicamente morta:** `op_checklists` = 4 templates, **todos `is_active=false` desde 29/04**; `op_checklist_completions` = **0 linhas**. Nunca teve 1 dado real. Engenharia sólida sobre o nada.
- **Duplicação:** existe **2×** — a rota `/mais/aderencia-checklists` (Sprint 22.37, com RPCs+RLS) **e** uma aba "Aderência" dentro de `/checklists` desktop (Sprint 23, hook diferente, regra de 6h hardcoded triplicada). Medem a mesma coisa.
- **Sobreposição com Dashboard time:** complementar, NÃO redundante (Dashboard mede tarefas `context='work'`; Aderência mede rituais operacionais físicos). Público só cruza em `director`.
- **Veredito (decisão sua):**
  - Se a LA Music **ainda faz** checklists operacionais via TOM → **ressuscitar** (P: reativar os 4 templates + confirmar cron). A tela funciona "de graça".
  - Se o processo foi **abandonado** → **matar** (P: remover rota 22.37 + aba Sprint 23 + hooks + RPCs).
  - Em qualquer caso: **consolidar as 2 superfícies** numa só (M).

### 4. Operações — `/mais/operacoes` — **MELHORAR (P)**
- **Missão:** fila operacional por departamento — captura demandas via TOM/WhatsApp e exibe como fila triável. Reusa `tasks` (não cria entidade nova). Spec Sprint 15.
- **Real (confirmado ao vivo):** tabs por depto com badge, card vivo "Confirmar cronograma — Sala 5 CG · Jereh · Origem: Rafinha via relay". Captura via TOM acontece, em **baixo volume** (3 tasks ativas, 38 total, 0 marketing).
- **Over-engineering (SIM, pontual):**
  1. **Drag-and-drop** (`@dnd-kit` + localStorage, ~60 linhas) reordena o que já está ordenado por prioridade+prazo, persiste só no device, some ao trocar de aparelho. Com 3 tasks ativas, nunca teve razão. → **cortar**.
  2. `deptAssignees` hardcoda slug `pedagogico`/`gerencia` (`:186-212`) — a spec prometia não hardcodar.
  3. Escopo `manager` vê empresa toda (sem recorte por unidade).
- **Veredito:** NÃO matar (backend wired, captura real). Cortar drag-drop, tab Marketing vazia, generalizar assignees, revisar escopo manager.

### 5. Credenciais — `/mais/governanca` (`GovernancaPage`) — **MANTER + MELHORAR (P)**
- **O que é:** cofre de senhas/segredos CRUD sobre `governance_credentials`. "Governança" no nome do arquivo é enganoso — não trata de hierarquia. É o que o menu diz: credenciais e acessos.
- **Os "19 mocks" = 100% falso-positivo** (são `placeholder=` HTML + textos "Ex:" + hex de cor). SELECT: **18 credenciais reais**, status 11 ok/7 atenção. ⚠️ Contém **segredos vivos em plaintext** (chave OpenAI, Gemini, senha Google).
- **Código morto:** `GovernancaNovo.tsx` + `GovernancaDetalhe.tsx` (rotas `/novo` e `/:id`) — substituídas pelo drawer interno e esquecidas. ~590 linhas acessíveis só por URL direta. → **deletar**.
- **Veredito:** manter; deletar rotas mortas; renomear arquivo `Governanca`→`Credenciais` (mata ambiguidade com o spec de governança do Dashboard). Segurança plaintext = achado #33 da auditoria, pré-produção (fora deste escopo).

### 6. Gestão equipe — `/mais/gestao-equipe` — **MANTER**
- CRUD real de colaboradores (list/create via edge `admin-create-collaborator`/update/deactivate) sobre `collaborators`. SELECT: 31 linhas, dado de produção, último cadastro 06/06.
- `GestaoEquipe` (pessoas) ≠ `ConfigurarEquipe` (mapa setor→responsável em `event_team_map`) — distintos, sem redundância. Sem sobreposição com Credenciais.
- **3 melhorias pequenas:** trocar `confirm()` nativo por BottomSheet/DS (`GestaoEquipeDetalhe.tsx:149`, viola o CLAUDE.md); validar WhatsApp/e-mail no cliente; token de cor no status (`:127`).

### 7. Agenda LA Music — `/mais/agenda-escolar` — **MANTER função, MOVER de lugar (P)**
- **Real:** o calendário é a casca; o motor é gerar até 3 comunicados (`announcements`) por `school_event`. Dado raso (4 eventos, último 10/05). Tabela/propósito DIFERENTE da Agenda principal (`events`+`tasks` pessoais).
- **Veredito:** mal-classificada em "SISTEMA" sendo ferramenta de coordenação/director-only. Mover pro bloco Coordenação ou virar aba dentro de **Comunicados** (é o gatilho dos announcements). Mover = baixo; reparent = médio.

### 8. Histórico — `/historico` — **MANTER ou CONSOLIDAR (M)**
- **Real, vivo:** diário de aderência pessoal 30d do próprio usuário (tasks/events `context='work'` + flag briefing). Lê 749 tasks work, 77 events, 1649 ritual_logs.
- **Veredito:** candidato a virar view "passado/aderência 30d" dentro da Agenda principal (mesma fonte, a Agenda já tem navegação month/week). Não matar (é o único retrovisor self-service). Se não refatorar agora, manter — só está sub-promovido.

---

## Temas transversais (o que a auditoria revelou de padrão)

- **A) Escopo por líder inconsistente.** O multi-tenant que viramos no Dashboard time NÃO chegou em Comunicados (qualquer coord → empresa toda), Operações (manager → empresa toda) nem na aba antiga de Aderência. Esse é o through-line da governança.
- **B) Features mortas por falta de PROCESSO, não de código.** Aderência (templates desativados) e Observabilidade (0 aprovações). A decisão é de produto/operação, não de engenharia. Honestidade: construímos infra cara que nunca rodou com dado real.
- **C) Comunicados é o cluster de maior valor** — e Observabilidade + Agenda LA Music **orbitam ele**. Consolidar os três num só lugar ("Comunicados" com abas) é a maior simplificação possível do menu.
- **D) Código morto a varrer:** `GovernancaNovo/Detalhe` (~590 linhas), drag-drop de Operações (~60 + 1 dep), aba duplicada de Aderência.

---

## Fatiamento proposto (impacto × baixo risco)

### Fatia 1 — "Menu honesto + faxina" (P · risco baixo)
Mexe só em nomes, classificação e código morto. Zero risco de quebrar dado.
- Renomear/consolidar **Observabilidade** → "Aprovações & Envios" (dentro de Comunicados).
- Renomear `Governanca`→`Credenciais` + **deletar** `GovernancaNovo/Detalhe`.
- Cortar **drag-drop** de Operações + tab Marketing vazia.
- **(precisa de 1 decisão sua)** Aderência: reativar templates OU matar a feature.
> Resultado: o menu para de mentir, ~650+ linhas mortas somem, e o CEO para de perguntar "o que é essa porra".

### Fatia 2 — "Comunicados de verdade, multi-tenant" (M · valor alto)
O cluster que o CEO mais valoriza.
- **Escopo de time** (líder alcança só o time dele).
- **Aprovação no caminho PWA** (não-director → `pending_approval`).
- Absorver **Observabilidade** como aba "Aprovações & Envios".
- Aproximar **Agenda LA Music** de Comunicados (é o gatilho dos announcements).

### Fatia 3 — "Polimento" (P/M · depois)
- **Histórico** → aba "aderência 30d" na Agenda principal.
- **Operações:** escopo manager + generalizar `deptAssignees`.
- **Gestão equipe:** 3 melhorias cosméticas.
- **Aderência:** se ressuscitada, consolidar as 2 superfícies.

---

## Decisões que só o CEO responde
1. **Aderência:** a LA Music ainda faz checklists operacionais (abertura/fechamento/limpeza) via TOM? → ressuscitar vs matar.
2. **Comunicados:** líder deve alcançar só o time dele, ou broadcast pra empresa toda é OK (e nesse caso, director-only)?
3. **Ordem:** começar pela Fatia 1 (faxina rápida) ou já pela Fatia 2 (Comunicados, o valor real)?
