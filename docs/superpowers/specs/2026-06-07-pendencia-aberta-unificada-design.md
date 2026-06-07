# Definição única de "pendência aberta" — unificar planejador semanal × escalação (Achado #79)

**Data:** 2026-06-07 · **Decisão do Alf:** Opção A — pendência = tarefa aberta **+** evento `context='work'` passado sem fechamento; o planejador semanal passa a enxergar esses eventos.

## Problema (achado #79 + #80)
Contradição de estado entre dois geradores:
- **Planejador semanal** (`weekly_planning`, gerado pelo LLM): o contexto (`system.js buildContext`) traz tarefas abertas e eventos **futuros/agenda**, mas **não** eventos work **passados sem fechamento** → o LLM escreveu "📭 Sem pendências abertas — semana limpa".
- **Escalação diária** (`checkOverdueWorkEvents`, dispatcher.js:2017): pega eventos `context='work'`, status≠done/cancelled, `end_at` em [5 dias atrás, ontem] → cobra o dono. Pra ela, evento work passado sem fechamento **é** pendência.
- Caso real: "Reunião com Pedro. Miluli" (só em `events`, não em `tasks`, aberta desde 20/05): planejador disse "semana limpa" 24/05 19:01; escalação cobrou ~13h depois. Sem inbound entre as duas → TOM se contradiz pro usuário (glitch de credibilidade).

## Causa-raiz
**Duplicação de lógica**: cada gerador tem sua própria noção de "pendência". O planejador é cego a eventos work passados; a escalação não. Sem fonte única, divergem.

## Decisão (Opção A)
Definição ÚNICA: **pendência aberta = (tarefa aberta) OU (evento `context='work'` com `end_at` no passado e status ≠ done/cancelled)**. NÃO adiciona cobrança nova — a escalação já cobra esses eventos; o fix só deixa o **resumo do planejador honesto** (deixa de dizer "semana limpa" quando há evento aberto) e cria uma fonte única pra os dois.

Rejeitadas: B (injetar só no planejador → mantém 2 cópias da query = risco de re-divergir, a própria raiz do #79); C (só prompt → sem o dado no contexto o LLM não lista).

## Design
1. **Novo `src/services/open-pendencies.js`** — `getStaleWorkEvents(supabase, collabId, now)`: fonte ÚNICA da query de eventos work passados sem fechamento (mesma janela/filtros da `checkOverdueWorkEvents`: `context='work'`, `status NOT IN (done,cancelled)`, `end_at < ontem 00h BRT` e `>= 5 dias atrás`, escopo do dono via `collaborator_id`). Cliente `supabase` injetado → testável sem DB. Retorna as linhas (id, title, end_at, collaborator_id).
2. **`dispatcher.js` `checkOverdueWorkEvents`** — passa a chamar `getStaleWorkEvents` em vez da query inline. Comportamento idêntico (cooldown `followup_sent_at` e o resto da função permanecem). Pura extração — escalação battle-tested não muda de comportamento.
3. **`system.js`** — o contexto do ritual `weekly_planning` ganha um bloco "⏳ Compromissos passados sem fechamento" listando o retorno de `getStaleWorkEvents` (do próprio colaborador), quando houver. É o dado que faltava pro LLM.
4. **Skill/prompt do planejamento semanal** — regra curta: "compromissos passados sem fechamento contam como pendência; só diga 'semana limpa' se tarefas E eles estiverem zerados."
5. **Teste** — unit do helper (shape/escopo da query, client fake) + smoke; deploy com o rito (node --check, scp md5 VPS==local, restart, ledger).

## Escopo / não-fazer (YAGNI)
- Escopo do planejador = eventos work passados do **próprio** colaborador (dono), espelhando o owner-scope da escalação. Sem expansão pra time nesta fatia.
- NÃO mexer na cadência/cobrança da escalação (só extrair a query).
- NÃO tocar tarefas (já aparecem no planejador). Só adicionar a dimensão de eventos.

## Critério de sucesso
Quando houver evento work passado sem fechamento do colaborador, o planejador semanal **não** diz "semana limpa" — lista o compromisso como pendência. `checkOverdueWorkEvents` e o planejador consomem a MESMA função → não podem mais divergir.

## Sem quebrar o que funciona
A extração é pura (mesma query); D/L/G/finance e o resto da escalação intactos. Mudança no `system.js` é aditiva (novo bloco de contexto só quando há eventos stale).
