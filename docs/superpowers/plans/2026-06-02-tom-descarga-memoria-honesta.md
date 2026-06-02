# TOM Descarga — Memória + "Registrei" Honesto — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** Numa descarga de áudio com vários itens e pessoas, o TOM cobre tudo, só diz "registrei" no que persistiu de verdade, e o aviso de duplicata para de engolir a resposta — sem virar um formulário burro.

**Architecture:** Mudanças mínimas no engine (2 bugs reais) + poda/honestidade no system prompt. SEM máquina de estados, SEM nova tabela. Reaproveita decompositor, pending_intents e o confirmar-antes-de-disparar (já no ar).

**Tech Stack:** Node.js (CommonJS) `src/engine.js`, `src/prompts/system.js`. Deploy via SCP + `pm2 restart tom`. Validação: `node --check` + teste e2e controlado (curveball) com leitura do banco via Supabase MCP.

**Spec:** `docs/superpowers/specs/2026-06-02-tom-descarga-memoria-honesta-design.md`

**Escopo desta Fase 1 (lean-lean):** Tasks 1–4 abaixo. A **persistência dedicada da lista (spec §1 — `intake_list`)** fica como **Fase 2 / plano separado**, deferida de propósito (YAGNI): a Regra 5b (MODO LISTA, já no ar) já evita perder itens, e o `pending_intents` já persiste as confirmações. Só fazemos a Fase 2 se, após validar a Fase 1, o "esquecer" ainda aparecer.

---

### Task 1: Engine — dedup NÃO aborta o lote (`applyTaskActions`)

**Files:**
- Modify: `src/engine.js` (função `applyTaskActions`, bloco do soft-dup ~linhas 4001–4005; declaração no topo da função; `return` final)

**Contexto:** `applyTaskActions` processa um array de ações de tarefa num loop. Ao detectar uma tarefa quase-duplicada (soft-dup), hoje ele faz `return` no 1º conflito — **abandonando os itens seguintes do mesmo lote**. O irmão `applyEventActions` já faz o certo: tem `let integrityPayload = null;` no topo (linha ~2146) e retorna no fim (`return { okCount, failCount, integrityPayload };`, linha ~2474). Vamos espelhar esse padrão.

- [ ] **Step 1: Garantir a variável acumuladora no topo de `applyTaskActions`**

Abra `src/engine.js`, ache o início de `async function applyTaskActions(` (perto da linha ~3518). Logo após a declaração de `okCount`/`failCount`, garanta a linha:
```js
  let integrityPayload = null;
```
(Se já existir, não duplique.)

- [ ] **Step 2: Trocar o `return` antecipado por coleta-e-continua**

No bloco do soft-dup de tarefa (perto da linha ~4001), substituir:
```js
        if (_taskIntegrityPayload) {
          // Não insere. Sinaliza para applyTaskActions retornar payload.
          // Usa mecanismo de objeto retornado — ver return abaixo.
          return { okCount, failCount: failCount + 1, integrityPayload: _taskIntegrityPayload };
        }
```
por:
```js
        if (_taskIntegrityPayload) {
          // Sprint 31 — NÃO aborta o lote: guarda o 1º conflito e SEGUE pros
          // outros itens da descarga (antes: o return matava os demais — era o
          // bug "tudo junto perde itens" no caminho do dedup).
          if (!integrityPayload) integrityPayload = _taskIntegrityPayload;
          failCount++;
          continue;
        }
```

- [ ] **Step 3: Garantir que o `return` final de `applyTaskActions` devolve `integrityPayload`**

Localize o `return` no FIM de `applyTaskActions` (após o loop). Garanta que ele inclui `integrityPayload`, ex.:
```js
  return { okCount, failCount, integrityPayload };
```
Se o return final hoje não tem `integrityPayload`, adicione. (Espelha `applyEventActions:~2474`.)

- [ ] **Step 4: Checar sintaxe**

Run: `cd /d/la-organizer/_remote && node --check src/engine.js`
Expected: sem saída (exit 0).

---

### Task 2: Engine — dedup NÃO engole a resposta inteira (preserva o turno)

**Files:**
- Modify: `src/engine.js` (caminho TASK ~linha 7165; caminho EVENT ~linha 7462)

**Contexto:** Quando há um conflito de integridade, o engine faz `reply = _buildIntegrityConfirmText(integrityPayload)` — **sobrescrevendo** todo o texto que o TOM gerou (que numa descarga tem o resumo dos outros itens + as outras perguntas). Resultado: o usuário vê SÓ o "1/2/3" da duplicata. Fix: **anexar** o aviso ao texto do TOM, em vez de substituir.

- [ ] **Step 1: Confirmar a variável que guarda o texto do TOM**

Leia `src/engine.js` linhas ~7150–7170. Identifique a variável que contém o texto que o TOM gerou (provavelmente `reply` já recebeu o `cleanText` antes deste ponto; confirme se é `reply` ou `cleanText`). Use essa variável no passo 2 como `<TEXTO_TOM>`.

- [ ] **Step 2: TASK path — anexar em vez de sobrescrever (~linha 7165)**

Substituir:
```js
        reply = _buildIntegrityConfirmText(integrityPayload);
```
por:
```js
        {
          // Sprint 31 — NÃO engole a resposta: preserva o que o TOM resolveu/
          // perguntou nos OUTROS itens da descarga e ANEXA o aviso de duplicata.
          const _dupQ = _buildIntegrityConfirmText(integrityPayload);
          const _prev = (<TEXTO_TOM> || '').trim();
          reply = _prev ? `${_prev}\n\n${_dupQ}` : _dupQ;
        }
```
(Troque `<TEXTO_TOM>` pela variável confirmada no Step 1.)

- [ ] **Step 3: EVENT path — mesma mudança (~linha 7462)**

Repetir o padrão do Step 2 no bloco EVENT (~linha 7462), usando a mesma variável de texto do TOM daquele escopo.

- [ ] **Step 4: Checar sintaxe**

Run: `cd /d/la-organizer/_remote && node --check src/engine.js`
Expected: sem saída (exit 0).

---

### Task 3: Prompt — "registrei" honesto + poda da regra que trava

**Files:**
- Modify: `src/prompts/system.js` (BLOCK_RULES ~linhas 57–100; Regra 5/5b já editadas hoje)

**Contexto:** O TOM diz "Registrei: …" para coisas que só foram mensagens enviadas (recado pra pessoa), não registros. E o prompt acumulou regras (5/5b) que precisam ficar coerentes e enxutas. Objetivo: **menos texto**, mais claro.

- [ ] **Step 1: Honestidade do "registrei" — adicionar 1 frase curta na Regra 5b**

Em `system.js`, no fim do bloco da Regra 5b (após a linha "COBERTURA OBRIGATÓRIA…"), acrescente UMA linha à lista `lines`/template:
```
   • HONESTIDADE: "✅ registrei/criei/anotei" é SÓ pro que virou registro de verdade (marker que persistiu). Mandar recado/aviso pra alguém é "📨 avisei", NÃO "registrei". Pergunta pendente é "❓ falta confirmar". Nunca conte como feito o que não persistiu.
```

- [ ] **Step 2: Poda — revisar Regra 5 pra não conflitar**

Reler a Regra 5 (linha ~63) e a 5b. Garantir que a EXCEÇÃO da Regra 5 ("descarga → não se limite a 3-4 linhas / não pare na 1ª") está clara e que NÃO há instrução remanescente dizendo "uma pergunta por vez" sem a ressalva da descarga. Se houver redundância entre 5 e 5b, fundir numa redação mais curta. **Resultado esperado: o bloco fica igual ou MENOR, nunca maior.**

- [ ] **Step 3: Checar sintaxe**

Run: `cd /d/la-organizer/_remote && node --check src/prompts/system.js`
Expected: `SYNTAX OK` (ou sem erro).

---

### Task 4: Deploy + validação curveball (teste controlado)

**Files:** nenhum (deploy + teste e2e).

- [ ] **Step 1: Deploy**

Run:
```bash
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp /d/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
ssh tom "pm2 restart tom"
```
Expected: TOM "pronto. Aguardando mensagens…".

- [ ] **Step 2: Curveball de propósito (checkpoint com o Alf)**

Pedir ao Alf pra mandar UM áudio bagunçado de propósito, ex.:
> "Tom, cria pra mim revisar o contrato amanhã; ah, e me lembra de pagar o IPVA semana que vem; o terceiro deixa quieto, esquece; e fala pro Jereh… não, deixa, esse eu falo depois."

Esperado (inteligência, não robô): cria os 2 reais, **ignora** o "deixa quieto", e NÃO dispara pro Jereh (o Alf desistiu). Resposta soa humana.

- [ ] **Step 3: Auditar no banco (Supabase MCP)**

Conferir: tasks criadas batem com o que o TOM disse "registrei"; **nenhuma** mensagem saiu pro Jereh; nada inventado. Pontuar item a item e reportar ao Alf.

- [ ] **Step 4: Regressão — mensagem simples**

Garantir que uma mensagem de 1 demanda só ("cria tarefa X amanhã") continua curta e direta (a poda não pode deixar o TOM prolixo).

---

## Self-review
- **Spec coverage:** §2 (registrei honesto) → Task 3. §3 (poda) → Task 3. §"bugs relacionados (dedup engole/aborta)" → Tasks 1–2. §"valida esperto" → Task 4. §1 (persistência) → **deferida (Fase 2)**, documentado no header. Homônimo Dai/Daiana → fora desta fase (mitigado pelo confirmar-antes).
- **Placeholders:** `<TEXTO_TOM>` é um marcador deliberado resolvido no Task 2 Step 1 (leitura do código) — instrução explícita, não placeholder vago.
- **Consistência:** `integrityPayload` (Task 1) é o mesmo nome usado por `applyEventActions`; `_buildIntegrityConfirmText` e `reply` conforme o engine atual.
