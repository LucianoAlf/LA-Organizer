# Auditoria do TOM — Síntese e plano de correção

**Data:** 2026-07-27 · **Autor:** catraca (revisor) · **Para:** Alf
**Contexto:** feature freeze decretado em 27/07. Nada novo — só conserto e refatoração, atacando primeiro o que mais quebra, **uma feature por vez**.
**Como foi feito:** 4 frentes em paralelo — dados de produção (eu) + 3 auditorias de código independentes. Todo achado abaixo tem `arquivo:linha` ou query. **Achados que eu verifiquei pessoalmente estão marcados ✅; o que rebaixei está marcado ❌.**

**Anexos (relatórios completos):** [Parte 1 — dados](2026-07-27-auditoria-tom-parte1-dados.md) · [Fatia A — engine.js](2026-07-27-fatia-A-engine.md) · [Fatia B — skills/soul](2026-07-27-fatia-B-skills-soul.md) · [Fatia C — caminho da mensagem](2026-07-27-fatia-C-caminho-mensagem.md)

---

## 1. Sumário executivo

**O diagnóstico em uma frase:** o TOM não quebra por falta de qualidade nos pedaços — quebra porque **a ação mais usada do sistema não consegue identificar sobre qual tarefa a pessoa está falando**, e porque **o prompt ensina ações que o código não aceita**. Nenhum dos dois se resolve refatorando arquitetura; ambos são cirúrgicos.

**O que está em jogo:** o engajamento **já caiu** — 1.169 mensagens/semana (08/06) → 172 (semana de 20/07); 27 → 18 pessoas ativas; **todos caíram, ninguém subiu** (Rose −49%, Alf −48%, Quintela −52%). Parte pode ser férias escolares de julho; mas quem não tira férias (financeiro, CEO) caiu igual, e a curva desce desde 15/06.

**As 3 causas-raiz, por impacto:**

| # | Causa-raiz | Prova | Custo do fix |
|---|---|---|---|
| **1** | **Identidade de tarefa**: ao achar mais de uma candidata, o TOM **rejeita tudo** em vez de perguntar qual | `engine.js:3852` + **60% das tarefas pendentes têm título duplicado** (337/561) | Baixo |
| **2** | **Prompt ensina o que o código recusa** — ações fantasma na lista que vai em todo turno | `system.js:81` × `engine.js:172-177` ✅ | Muito baixo |
| **3** | **Falha vira silêncio**: envio sem proteção + 51 `catch` vazios | `engine.js:13024` ✅ | Baixo |

---

## 2. O que FUNCIONA (não mexer)

Isto é tão importante quanto a lista de defeitos — é o que **não** deve entrar na refatoração:

- **Financeiro é o mais confiável do sistema**: `FINANCE_ACTION` falha **1,3%** (contra 14,1% das tarefas), apesar de ser a área com mais bugs históricos (57). **Motivo: é o único domínio com executor determinístico** — a confirmação executa de um rascunho guardado em vez de devolver a decisão ao LLM. **Os 57 bugs compraram a arquitetura mais sólida que existe aqui. É o modelo a copiar, não a refazer.**
- **Módulos extraídos são saudáveis**: tudo que saiu do `engine.js` para `services/`/`lib/`/`utils/` ganhou teste — **210 arquivos de teste, ~2.000 casos**. A disciplina de TDD funciona quando o código está fora do monolito.
- **Markers de alto volume sem falha**: `REACT` (107), `TASK_DELEGATED` (48), `WATCHER_ADDED` (18) — 0% de rejeição.
- **A correção histórica das confabulações foi bem propagada**: o auditor de skills procurou instruções que induzem mentira e **não achou nenhuma nova** — 15 skills carregam o aviso explícito "nunca confirme sem marker".
- **Guards de honestidade existem e funcionam** (o de hoje pegou o caso da Rose assim que ampliado).

---

## 3. O que QUEBRA

### 3.1 🔴 Identidade de tarefa — a raiz nº 1

**O que acontece:** você diz *"Tom, conclui o fechamento da escola"*. Existem **30 tarefas pendentes com esse título exato**. O resolver acha 30 candidatas e — em vez de perguntar "qual delas?" — **rejeita tudo em silêncio** (`engine.js:3852-3855`).

**Prova cruzada (código + banco):**
- `TASK_UPDATE` = ação mais usada do sistema: **411 usos/30d, 14,1% rejeitada**
- O motivo campeão é **`all_failed`** (36 casos) — não é formato de JSON, é *não achou o alvo*
- **337 de 561 tarefas pendentes (60%) têm título duplicado.** Campeãs: "marcar endócrino" (40 cópias), "presença emusys" (34), "renovação" (33), "fechamento da escola" (30)
- O mesmo defeito aparece como `integrity_dup_task` (~8 casos)

**Agravantes no resolver** (`engine.js:3816-3857`): só busca tarefas dos **últimos 60 dias** e só as **atribuídas à própria pessoa**.

**Correção recomendada (cirúrgica, 2 partes):**
1. **Desambiguar em vez de desistir**: quando houver N candidatas, o TOM **pergunta** ("achei 3 'fechamento da escola': 25/07, 26/07, 27/07 — qual?"). É a diferença entre um TOM que trava e um que resolve.
2. **Limpar as duplicatas** (337) e **atacar a fonte**: são sobras de recorrência. Sem isso, a desambiguação vira pergunta com 40 opções.

### 3.2 🔴 O prompt ensina ações que o código recusa ✅

A lista de markers válidos em `src/prompts/system.js:81` vai para o LLM **em todo turno** e contém ações **inexistentes**:

| O prompt ensina | O código tem | Resultado |
|---|---|---|
| `<<DND_UPDATE>>` | só `<<DND_SET>>` (`engine.js:3579`) | rejeição garantida |
| `TASK_UPDATE action: approve` | não está em `VALID_TASK_ACTIONS` (`engine.js:172-177`) | `unknown_action` |
| `TASK_UPDATE action: deny` | idem | `unknown_action` |
| `extension_decision` com campo `decision` (`skills/checklist-tarefas.md:547`) | o código exige `approved` (boolean) + `new_due_date` (`engine.js:3676`) | rejeitado **sempre que a skill é seguida à risca** |

**Isso explica os 21 `schema_invalid`** medidos em produção. **Correção: alinhar a lista ao código.** É a correção de melhor custo-benefício de toda a auditoria — texto, sem risco.

### 3.3 🟠 Preferência que o usuário pede e não tem efeito

`skills/configurar-preferencias.md` é carregada **em todo turno** e ensina a gravar `quiet_start_time`/`quiet_end_time` — colunas que a própria regra 18 do prompt chama de **legado**. O engine **aceita e grava sem erro**, mas `services/quiet-hours.js:75-94` **ignora** essas colunas quando existem as por contexto. Resultado: a pessoa pede silêncio, o TOM confirma honestamente, **e nada muda**. Não aparece como falha em lugar nenhum.

### 3.4 🟠 Falha vira silêncio ✅

- **Envio final sem proteção** (`engine.js:13024`): se o envio ao WhatsApp falhar, o erro sobe e **a pessoa simplesmente não recebe nada** — sem retry, sem aviso.
- **51 blocos `catch` vazios** no `engine.js`; **10 `.catch(() => {})`** no `webhook.js` (fallbacks de mídia/PDF).
- **Regra de reagendamento duplicada** (`engine.js:3644` e `4772`) com **dois validadores de data diferentes** — existe combinação em que a data **não é aplicada e ninguém é avisado**.

### 3.5 🟠 "Confirmei e não aconteceu"

**30 casos em 30 dias** de `ACTIONABLE_NO_MARKER` — o TOM deveria agir e não emitiu ação nenhuma. Os textos são literalmente respostas curtas de confirmação (`"Isso"`). Dois known-issues (`TASK-RESCHEDULE-CONFIRM-NOOP`, `EVENT-CREATE-CONFIRM-NOOP`) estavam abertos **esperando prova viva — a prova apareceu**.

### 3.6 🟡 Peso morto e monolito

- **18 dos 64 arquivos de skill (~25% das linhas) nunca são carregados** em nenhum prompt.
- **`skills/inventario.md` (174 linhas) nunca é carregada** — o prompt só injeta uma frase mandando "use a skill inventario.md", que o LLM nunca recebeu (`system.js:3613`) ✅. O smoke test passa verde porque só confere se a **substring** "inventario.md" está no prompt.
- **`engine.js` = 14.671 linhas**; `processMessage` sozinha = **4.587 linhas** (31% do arquivo); **zero testes** para o que vive dentro dele (contra 210 arquivos de teste no resto do repo).

### 3.7 ❌ Rebaixado (não é problema)

- **"Fila do Claude serializa todo mundo"**: `TOM_CLAUDE_PARALLEL=1` **está ligado** em produção ✅ — o auditor não tinha acesso ao `.env` e sinalizou a incerteza corretamente.

### 3.8 ⚠️ Achado lateral que precisa de decisão sua

**`TOM_MAPA=0`** — a montagem de prompt por intenção (a virada de 01/07) está **desligada** em produção. Ou seja, o TOM carrega contexto cego em toda mensagem: mais lento, mais caro, mais confuso. Foi rollback deliberado ou ficou esquecido?

---

## 4. Plano de correção — uma feature por vez

Ordenado por **uso × falha × risco**, do mais barato/mais eficaz para o mais caro. Cada item é independente e testável.

| Ordem | Correção | Por quê agora | Risco |
|---|---|---|---|
| **1** | **Alinhar prompt ↔ código** (§3.2): tirar `DND_UPDATE`, `approve`, `deny` da lista; corrigir `extension_decision` na skill | mata os 21 `schema_invalid`; é só texto | mínimo |
| **2** | **Desambiguação de tarefa** (§3.1a): perguntar "qual delas?" em vez de rejeitar | maior `uso × falha` do sistema (411 usos, 36 all_failed) | baixo — comportamento novo só no caminho que hoje **já falha** |
| **3** | **Limpeza das 337 duplicatas + fonte** (§3.1b) | sem isso o item 2 vira pergunta com 40 opções | médio (mexe em dado — faço com backup e reversível) |
| **4** | **Envio protegido + varredura dos `catch` vazios** (§3.4) | falha silenciosa é o que corrói confiança | baixo |
| **5** | **Preferência de silêncio sem efeito** (§3.3) | usuário pede e nada acontece | baixo |
| **6** | **Confirmação que não executa** (§3.5) | copiar o **executor determinístico do financeiro** — o padrão que já provou funcionar | médio |
| **7** | **Podar peso morto** (§3.6): 18 skills órfãs + carregar de verdade a `inventario.md` | reduz contexto/custo em todo turno | baixo |
| **8** | **Extrair do `engine.js` por feature** — na ordem: `EVENT_CREATE` → chokepoint de honestidade → `TASK_UPDATE` → coordenação → intercepts | só depois que o resto estabilizar; é a obra pesada | alto (fazer por último, com testes antes) |

**Fora da fila de propósito:** o financeiro. Tem a menor taxa de falha (1,3%) e é o modelo arquitetural. Mexer nele agora é risco sem dor que justifique.

**Nota de método (importante):** refatorar por "quem teve mais bugs no histórico" levaria ao financeiro — o alvo errado. A régua correta é **falha viva × uso**.

---

## 5. Sobre a possível migração (Hermes)

Se a migração andar, este documento serve como **mapa de superfície**: as ações reais em uso (§1), quais funcionam bem (§2) e quais são peso morto (§3.6). Migrar as 18 skills órfãs ou as ações fantasma seria migrar defeito. **Recomendação: qualquer migração começa pelas ações de maior uso comprovado** — `TASK_UPDATE`, `COORDINATION_REQUEST`, `FINANCE_ACTION`, `EVENT_*` — e ignora o resto até prova de uso.

---

## 6. Limites honestos desta auditoria

- Não foi feita comparação campo-a-campo de **todos** os markers (faltaram HABIT_ACTION, MEMORY_SAVE, PROJECT_*, PERSONAL_LIST_ACTION, SCHOOL_EVENT_ACTION, WEEKLY/MONTHLY_PLAN, SHOP_ACTION, FINANCE_ACTION, COORDINATION_*) — provável que existam mais ações fantasma como as de §3.2.
- As faixas 13.068–14.671 do `engine.js` (rituais/relatórios) não foram lidas linha a linha.
- A causa do eco de 26/07 (mensagem do TOM voltando como do usuário) **não foi confirmada**: há dois mecanismos plausíveis no código, nenhum provado contra o payload real.
- O `web/` (PWA) ficou fora do escopo.
- A divisão entre atrito e sazonalidade na queda de engajamento **não é determinável pelo dado** — depende do calendário do negócio.
