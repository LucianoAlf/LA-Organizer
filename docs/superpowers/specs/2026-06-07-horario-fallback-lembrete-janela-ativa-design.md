# Horário-fallback de lembrete por janela ativa — design

**Data:** 2026-06-07 · **Decisão do Alf:** Abordagem A (stat leve no contexto + LLM propõe). Fonte do horário = aprendido do uso. Granularidade = uma janela ativa por pessoa (sem split de categoria).

## Problema
Quando alguém pede um lembrete sem dar a hora ("Tom, me lembra amanhã", "me lembra sexta"), o sistema hoje manda o TOM **perguntar a hora** ou **criar sem prazo** (skill `criar-compromisso.md`, seção "Tarefa SEM data"). Na prática a pessoa não responde a pergunta → a conversa trava e o lembrete nunca nasce. Caso real: Anne fazendo pedido sem horário (07/06).

Ninguém fala "me lembra amanhã **às 14h**" — só "me lembra amanhã". Falta um **horário-padrão (fallback)** pra esses casos.

## Causa-raiz
Não existe horário-padrão de lembrete. O que existe de horário por pessoa (`briefing_time`, `planning_time`, quiet-hours) serve a rituais, não a lembrete avulso. Sem um default, o TOM só tem a opção de perguntar — e perguntar trava.

## Decisão (Abordagem A)
O TOM **afirma** um horário concreto em vez de perguntar ("Fechou, te lembro amanhã às 9h. Quer outra hora?"). O horário vem da **janela ativa** da pessoa, inferida dos horários em que ela realmente fala com o TOM (`conversation_history`, `direction='inbound'`). A inteligência fica no LLM (recebe o horário resolvido no contexto e decide a frase); o engine só calcula o número.

Rejeitadas: B (perfil pré-calculado via cron+coluna → migration+ritual pra um sinal só, defasa entre runs); C (serviço crava a hora sem o LLM → tira a inteligência do TOM, contra o princípio do projeto).

## Modelo de dados existente (não muda)
- **Lembrete = task** com `remind_at` (timestamp) + `due_date` (date-only). O cron `checkReminders` dispara em `remind_at`. O fallback preenche **o horário do `remind_at`** quando há dia mas não hora.
- **Sinal:** tabela `conversation_history` (`collaborator_id`, `direction`, `created_at`). Sem schema novo.

## Design

### 1. `src/services/active-window.js` (novo)
Fonte ÚNICA do horário-padrão. `supabase` injetado (testável sem DB).

- `computeStartHour(hoursBrt)` — **função pura**, sem DB. Recebe array de horas (0–23) das mensagens inbound e devolve `{hour, minute}` do **início típico do dia** = percentil ~20 das horas ativas (não a mediana: "me lembra amanhã" quer o lembrete quando a pessoa começa o dia, não no meio da tarde). Arredonda pra hora cheia. Retorna `null` se a amostra for insuficiente.
- `getActiveWindow(supabase, collabId, now)` — lê inbound dos últimos **30 dias**, converte cada `created_at` pra hora **BRT** (-03:00), aplica `computeStartHour`. Exige mínimo de **15 mensagens em ≥ 5 dias distintos**; abaixo disso → cold-start. Retorna `{hour, minute, confident:boolean, source:'learned'|'cold_start'}`.
- **Cold-start:** sem dado suficiente → **09:00 BRT** (default global).
- **Guardrail quiet-hours:** dispensa clamp ativo. O percentil-20 já cai em horário de vigília (é exatamente quando a pessoa texta). E `checkReminders` (dispatcher.js:4514) já tem gate `isQuietNow` **no disparo**: se o `remind_at` cair em quiet, defere e re-tenta no próximo tick fora da janela. A rede de segurança já existe — não recalcular nada no cálculo.

### 2. Injeção no contexto — `src/prompts/system.js`
O engine chama `getActiveWindow` **uma vez por mensagem** e passa o horário resolvido pro `buildContext`. O `system.js` injeta **uma linha**:

> `Horário-padrão de lembrete pra <nome> quando ele não der a hora: 09h.`

(Sempre um número resolvido — learned ou cold-start. Trabalho trivial pro LLM.)

### 3. Comportamento — skill `skills/criar-compromisso.md`
Regra nova "**lembrete sem hora**":
- Pessoa dá **dia sem hora** ("me lembra amanhã/sexta") → **NÃO pergunta**. Usa o horário-padrão do contexto e **afirma**: *"Fechou, te lembro amanhã às 9h. Quer outra hora?"* Cria task com `remind_at = dia + horário-padrão`.
- Se a pessoa corrigir ("não, às 8h") → o **follow-up de horário que já existe** (seção "Follow-up de horário") reagenda. Sem caminho novo.
- **Escopo (crítico):** vale só pra **lembrete/task** (`remind_at`). **Compromisso com terceiros** (reunião/aula/mentoria/ensaio) sem hora **continua perguntando** — não se chuta 9h numa reunião com outra pessoa. Preserva a lógica atual de eventos.

### 4. Teste
- **Unit puro** de `computeStartHour`: caso Anne-like (ativa de manhã-tarde → ~10-11h), Alf-like (cedo → ~7-8h), poucos-dados → `null`.
- **Smoke** com `conversation_history` fake (cliente injetado): `getActiveWindow` retorna learned com dado suficiente, cold-start (09h) sem dado.
- **Deploy no rito:** `node --check`, `scp` path absoluto com md5 VPS==local, `pm2 restart tom`, verificar online/unstable=0, ledger em `tom_known_issues`.

## Escopo / não-fazer (YAGNI)
- Uma janela por pessoa; **sem** split trabalho×pessoal (decisão do Alf, reconfirmada 2026-06-07 após o caso Gabi). Racional: não dá pra *aprender* duas janelas do histórico (mensagens em `conversation_history` não vêm marcadas trabalho/pessoal); um work-window confiável precisaria de horário de trabalho configurado. A janela única se auto-corrige: quem trabalha à tarde (Gabi 14h+) vê a janela migrar pra ~14h conforme usa o TOM, e o "afirma, quer outra hora?" cobre os primeiros dias. **Gatilho pra reabrir o split:** dado real mostrando lembrete de trabalho caindo de manhã mesmo com histórico acumulado.
- **Sem** tabela/coluna nova; **sem** ritual novo. Cálculo on-the-fly.
- **Sem** clamp de quiet-hours no cálculo — o gate de `checkReminders` no fire-time já cobre.
- Não mexe na lógica de compromisso/evento (só adiciona a regra de lembrete).
- Performance: 1 query agregada indexada por mensagem. Se pesar, memoiza por processo ou evolui pra Abordagem B. Não fazer agora.

## Critério de sucesso
Pessoa pede "me lembra amanhã" sem hora → o TOM **não pergunta**, afirma um horário coerente com a rotina dela (Anne de manhã tarde, Alf cedo), cria o lembrete, e a pessoa só corrige se quiser. Fim do trava-conversa.

## Sem quebrar o que funciona
Tudo aditivo: serviço novo isolado, uma linha de contexto, uma regra de skill. Compromissos/eventos, rituais, quiet-hours, D/L/G e o resto intactos. `getActiveWindow` falhando → cold-start 09h (degrada gracioso, nunca derruba o fluxo).
