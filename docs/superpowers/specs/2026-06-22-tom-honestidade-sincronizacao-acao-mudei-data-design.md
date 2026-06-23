# TOM — Honestidade anti-"sincronização" + ação ao "já mudei a data"

**Data:** 2026-06-22
**Origem:** caso Matheus (investigado nesta sessão)
**Tipo:** Fix de comportamento do TOM (prompt) + rede determinística (engine). Sem migration.

## Goal

Quando o colaborador responde a uma cobrança dizendo que "já mudou a data" (e o banco não reflete), o TOM deve **dizer a verdade e agir** (reagendar) — nunca "ficar quieto" nem inventar "delay de sincronização".

## Contexto e causa raiz (confirmados)

Caso Matheus 22/06 (conversation_history, verbatim):
- Tom: "Finalizar inventário — fez?". Matheus: *"eu ja alterei a data de entrega dele"*. Tom: *"Beleza, se você já ajustou no app, fico quieto"* → **não reagendou** (tarefa segue pending, prazo 15/06, atrasada).
- Depois: Matheus *"mudei a data de validade"*. Tom: *"Entendido, vacilo meu — não cobro mais. Se o banco ainda mostra atrasado aqui do meu lado, é delay de sincronização. Fica tranquilo."* → **confabulou** "delay de sincronização" (mentira; a query é ao vivo) + prometeu "não cobro mais" (que o ritual determinístico quebra no dia seguinte).

Dois defeitos:
1. **Confabulação de causa técnica.** Fonte: `src/finance/pluggy-query-format.js:33` ensina o TOM a dizer "a fatura ainda tá sincronizando com o banco (Open Finance) — cai em 1-3 dias" — **legítimo pra fatura** (Pluggy tem delay real). O TOM **generalizou** pra tarefa (que é ao vivo). Não há regra mandando isso; foi alucinação por transferência de contexto.
2. **Inação.** A skill `checklist-tarefas.md` cobre "muda pra quinta" (reschedule) e "já fiz" (complete), mas **não** cobre "eu **já alterei** a data [no app]" — afirmação de mudança externa. O TOM não confronta com o banco nem reagenda.

## Decisões aprovadas (Alf)

- Abordagem: **prompt + rede determinística** (não só prompt).
- Texto aprovado para o caso: *"Opa — aqui do meu lado a *<tarefa>* ainda tá com prazo <data> e em aberto. Pode ser que você mudou em outro item. Pra quando ficou? Eu acerto aqui agora."*
- Voz/tom/tamanho do TOM **sagrados** — mexer só em honestidade + ação.

## Fix A — Prompt: honestidade anti-"sincronização" (`src/prompts/system.js`)

Adicionar uma regra nas regras globais de honestidade (junto do item 20 "NUNCA confirme sem marker"), texto:

> **Banco é AO VIVO — nunca invente "sincronização".** Tarefas, eventos, projetos e inventário são lidos em tempo real, sem atraso de propagação. NUNCA diga "delay de sincronização", "tá sincronizando", "demora a atualizar" ou "banco do meu lado" pra justificar por que algo aparece atrasado/pendente — é mentira; isso SÓ vale pra FATURA de cartão (Open Finance). Se o usuário afirma algo que o contexto contradiz (ex.: "mudei a data" mas a tarefa segue com o prazo antigo), diga a VERDADE com o dado do contexto ("aqui a tarefa X ainda tá com prazo <data> e em aberto") e ofereça acertar na hora. Nunca aceite a afirmação cegamente nem invente causa técnica. E nunca prometa "não cobro mais" — quem cobra é o ritual automático; ele só para quando a tarefa for reagendada/concluída/cancelada DE VERDADE.

## Fix B — Prompt: ação ao "já mudei a data" (`skills/checklist-tarefas.md`)

Adicionar subfluxo (após o subfluxo "2. Reagendar"):

> ### 2b. User AFIRMA que já mudou a data (mas o banco pode não refletir)
> Quando o user responde a uma cobrança/atrasada com "**eu já alterei/mudei a data**" (de entrega/validade/no app) — ele está **afirmando que mudou por fora**, NÃO pedindo pra você reagendar. Olhe o prazo da tarefa no contexto:
> - **Tarefa AINDA atrasada / prazo antigo no contexto** → o banco não reflete; provável que ele mexeu em outro item. NÃO "fique quieto" nem invente "sincronização". Diga a verdade e ofereça acertar: *"Opa — aqui do meu lado a *<tarefa>* ainda tá com prazo <data> e em aberto. Pode ser que você mudou em outro item. Pra quando ficou? Eu acerto aqui agora."* Quando ele responder a data → `reschedule`. Se ele disser que na verdade concluiu → `complete`.
> - **Tarefa JÁ com a data nova / fora de atraso** → confirme e siga.
> NUNCA prometa "não cobro mais": a cobrança é automática e só para com `reschedule`/`complete`/`cancel` real no banco.

## Fix C — Rede determinística (`src/lib/sync-excuse-guard.js` + wiring no engine)

Helper puro novo (TDD), no estilo do `optimistic-confirm.js`:

```js
// Detecta desculpa de "sincronização" usada pra justificar prazo/atrasada.
function hasSyncExcuse(text): boolean
// Contexto legítimo (fatura/Open Finance) — não mexer.
function isInvoiceContext(text): boolean   // /fatura|cart[ãa]o|open\s*finance|pluggy/i
// Remove a(s) sentença(s) que contêm a desculpa (split por . ! ? \n).
function stripSyncExcuse(text): string
// Pipeline: se !invoice && hasSyncExcuse → remove a sentença.
function enforceNoSyncExcuse(reply): string
```

Padrões de detecção (`hasSyncExcuse`): `/\b(delay|atraso)\b[^.!?\n]{0,20}sincroniz/i`, `/sincroniz\w*[^.!?\n]{0,30}(banco|sistema|app|atualiz|meu lado|cai em|dias)/i`, `/demora\w*[^.!?\n]{0,12}atualiz/i`, `/banco[^.!?\n]{0,25}(meu lado|do meu lado)/i`.

**Wiring:** no mesmo chokepoint da Camada 1 anti-confab (engine ~11013, depois do bloco pending-intents, antes do bloco de voz) — `reply = enforceNoSyncExcuse(reply)`. Cobre voz + texto. Telemetria: logar `SYNC_EXCUSE_STRIPPED` quando remover (pra medir reincidência). É 2ª camada — o prompt (A/B) é a 1ª; a rede só mata a mentira se o prompt falhar.

## O que NÃO muda

- Voz/tom/tamanho das respostas do TOM.
- A mensagem legítima de **fatura** (`pluggy-query-format.js:33`) — protegida pelo `isInvoiceContext`.
- A capacidade de reschedule/complete (já funciona).

## Testes

- **TDD `sync-excuse-guard.test.js`:**
  - A frase exata do Matheus ("...é delay de sincronização...") → `hasSyncExcuse=true`, `stripSyncExcuse` remove a sentença e mantém o resto.
  - "a fatura ainda tá sincronizando com o banco (Open Finance)" → `isInvoiceContext=true` → `enforceNoSyncExcuse` NÃO mexe.
  - texto comum sem desculpa → inalterado.
  - "sincronização" em contexto neutro (ex.: "sincronizei com o Quintela") NÃO deve disparar falso-positivo (calibrar regex: exige termo banco/sistema/atualizar/delay perto).
- **Smoke VPS:** `enforceNoSyncExcuse` sobre a fala real do Matheus (rebaixa) + sobre a msg de fatura (preserva). `node --check` nos arquivos tocados.
- Prompt (A/B): validar via dry/replay manual (sem teste unitário de prompt).

## Fora de escopo (YAGNI)

- Detectar/consolidar duplicatas de tarefa (é o reparo de dados do Matheus — Frente B separada, aguardando confirmação dele).
- Gate determinístico pra forçar reschedule (o prompt B cuida; rede só anti-mentira).
