# Confirmação seca → tarefa recém-lembrada (Fatia 1 do "não consegui registrar")

**Data:** 2026-08-16
**Autor:** Catraca (revisor central) + Alf (decisor)
**Status:** desenho aprovado, aguardando revisão da spec

## Problema (medido, não inferido)

A auditoria acumulou **21 achados** com o literal "não consegui registrar" — patamar que não cai há 6 semanas. Medição no banco mostrou que **não é um bug: é uma string de sintoma sobre ~4 raízes distintas**:

- **1a — confirmação não resolve o alvo** (~14): o usuário confirma conclusão sem dizer QUAL tarefa ("Feito", "Pode fechar", "Isso foi feito", "Bombinha ok", "Pode marcar como feito") → `TASK_UPDATE` volta `all_failed` → aviso honesto dispara.
- 1b — claim sem marker (`CHOKEPOINT redirected confab:unknown`): o LLM afirma conclusão sem emitir ação.
- 2 — falso-fire do guard em turno sem nada a registrar ("Beleza", "Sem problemas").
- 3 — furo de forma (a afirmação sobrevive acima do aviso).

**Esta spec ataca só a 1a.** As outras vêm depois, uma por vez (decisão do Alf).

### Raiz da 1a (confirmada no código)

O lembrete que o TOM manda **vem do disparo** (`dispatcher`), não do LLM. Ele **já é gravado** em `conversation_history` com a referência exata da tarefa via `proactive-link.sendAndLink` (`ref_type='task'`, `ref_id=task.id`, + `whatsapp_message_id`) — feito no Lote D (REPLY-QUOTE-PROATIVO).

**O buraco:** esse vínculo só é consumido quando a pessoa **responde-citando** (reply-quote) o lembrete no WhatsApp (engine ~9800, filtra `ref_id not null`). Uma confirmação **seca** ("Feito", sem citar) ignora o vínculo, cai na resolução por título:

1. O LLM emite `TASK_UPDATE` com um `title` (chute, porque o prompt em `system.js:120` o **proíbe** de confiar no `conversation_history` pra nome de tarefa — anti-confabulação).
2. `engine.js:4472` faz `title → candidatos` por `ilike` e `resolveTaskTarget` (`src/lib/task-target.js`) desempata.
3. Título indireto ("Isso", "Ele") ou paráfrase → `candidatos` vazio → `title-lookup failed` → `all_failed` → `NO_MARKER_HONEST_NOTE`.

`resolveTaskTarget` só desempata entre candidatos **já casados por título** — nunca vê contexto de conversa. A resposta certa **não pode vir do LLM** (o prompt o proíbe): tem que ser **determinística**, usando o vínculo que o outro motor já gravou.

## Objetivo

Quando o usuário confirma conclusão logo após o TOM ter lembrado de uma tarefa, **completar a tarefa recém-lembrada de forma determinística** — pelo `ref_id` exato, sem passar pelo chute de título do LLM. Fecha o "não consegui registrar" da 1a na raiz, no espírito do executor determinístico do financeiro (o módulo mais confiável, 1,3% de falha).

## Decisões do Alf (travadas)

- **Janela:** 24h. Confirmação até 24h após o lembrete amarra automaticamente; depois disso, fluxo atual.
- **Voz:** o engine resolve/executa o ALVO determinístico, mas a **fala final passa pelo LLM** (voz do TOM é sagrada). Sem template robótico.

## Arquitetura

Padrão da casa: **resolvedor PURO** (igual `task-target.js`) + engine busca os candidatos e injeta o resultado. Interceptor **antes do LLM** (família das `pending-intents`), porque assim funciona mesmo quando o LLM nem emitiria marker (o caso `confab:unknown`), não só quando erra o título.

### Fluxo

```
lembrete (dispatcher, sendAndLink) → conversation_history {outbound, ref_type:'task', ref_id, created_at}
                                                    │
usuário: "Feito"  ──► interceptor pré-LLM ──► busca refs de tarefa das últimas 24h (outbound, ref_type='task')
                                                    │
                                    resolvedor PURO: (reply é conclusão?) × (quantas tarefas lembradas?)
                                        ├─ 1 tarefa  → executa a conclusão determinística (id exato)
                                        │              + injeta contexto "você concluiu *X*" → LLM confirma na voz
                                        ├─ >1 tarefas → LLM pergunta "qual? 1) X 2) Y" (nunca chuta)
                                        └─ 0 / não-conclusão → segue o fluxo atual (nada muda)
```

### Componentes

**1. `src/lib/completion-from-reminder.js` (NOVO, puro, TDD)**

```
resolverConclusaoDeLembrete({ reply, refsRecentes, agoraMs }) →
  { modo: 'exato',  taskId, title, motivo }        // 1 tarefa lembrada + reply é conclusão inequívoca
  { modo: 'ambiguo', candidatos: [{taskId,title}], motivo }  // >1 tarefa lembrada
  { modo: 'nenhum', motivo }                        // 0 refs, fora da janela, negação, pergunta, ou não é conclusão
```

- `refsRecentes`: `[{ task_id, title, reminded_at }]` — o engine passa as linhas de `conversation_history` outbound com `ref_type='task'` dos últimos 24h (dedup por `task_id`, a mais recente vence).
- **Detecção de conclusão:** reutiliza o detector de confirmação existente onde possível (`pending-intents.detectUserConfirmation` / `WEAK_COMPLETION_RE` de `optimistic-confirm.js`), com **veto de negação** ("não fiz", "ainda não") e **veto de pergunta** (termina em "?"). Whitelist conservadora: "feito", "pronto", "concluí", "ok"/"okay", "isso", "pode marcar/fechar", "<coisa> ok". Na dúvida → `nenhum` (deixa o fluxo atual seguir; não inventa conclusão).
- **Ambiguidade real:** se as refs recentes são de tarefas distintas → `ambiguo` (pergunta). Se são a mesma série (via `serieDe` de `task-target.js`) → resolve a ocorrência corrente com `resolveTaskTarget` e vira `exato`.
- Puro: sem banco, sem LLM, sem relógio interno (`agoraMs` injetado). Prova por mutação.

**2. Engine — interceptor pré-LLM (`src/engine.js`, família das pending-intents)**

- Busca `refsRecentes` (uma query nova, escopada: `conversation_history` do colaborador, `direction='outbound'`, `ref_type='task'`, `created_at > now()-24h`, ordem desc).
- Chama `resolverConclusaoDeLembrete`.
  - `exato` → executa a conclusão pelo caminho determinístico já existente (o mesmo handler `complete` por **id exato**, que não passa por título → não dá `all_failed`), com idempotência (se já concluída, no-op gracioso). Injeta no contexto do LLM: "O usuário confirmou a conclusão de *<title>* (que você lembrou) — já registrei; confirme na sua voz." **Suprime a Camada-1 (`enforceNoMarkerHonesty`) neste turno** (a ação FOI executada; o guard não pode desmentir — senão vira o confab-inverso de novo).
  - `ambiguo` → injeta os candidatos e instrui o LLM a **perguntar qual** (não completa nada).
  - `nenhum` → não faz nada; segue o pipeline atual intacto.

### Fronteiras / o que NÃO entra (YAGNI)

- **Só resposta a LEMBRETE** (o sinal mais forte e de maior volume). "Tarefa listada na última fala do TOM" (ex.: "Ficam abertas: A, B, C" → "A foi feita") é **Fatia 2**, depois.
- Não toca nas raízes 1b, 2, 3 (fatias seguintes).
- Não afrouxa o match de título (o "fuzzy" foi descartado no brainstorm — risco de completar a tarefa errada em silêncio).
- Não muda o reply-quote (já funciona).

## Tratamento de erro

- Query de `refsRecentes` falha → `refsRecentes=[]` → `nenhum` → fluxo atual (degrada seguro, nunca quebra o turno).
- Conclusão já aplicada (idempotência) → no-op + confirma mesmo assim ("já estava fechada").
- Negação/pergunta → `nenhum` (jamais completa contra "não fiz").
- 0 refs → `nenhum`.

## Testes

- **`completion-from-reminder.test.js`** (puro): 1 ref + "feito" → exato; >1 ref → ambiguo; negação "não fiz" → nenhum; pergunta → nenhum; fora da janela → nenhum; mesma série (2 instâncias) → exato via `resolveTaskTarget`; reply não-conclusão ("valeu") → nenhum; 0 refs → nenhum.
- **Engine (integração leve):** interceptor executa conclusão por id exato (não gera `all_failed`); guard Camada-1 suprimido no turno resolvido; `ambiguo` não completa nada.
- **Zero-regressão:** suíte inteira no baseline. Grep dos leitores de `conversation_history` e do caminho `complete` antes de mexer (contrato do `ref_id`).

## Métrica de sucesso

Reprodução no Replay Lab: perfil com um lembrete de tarefa emitido (`sendAndLink`), responder "Feito" solto → a tarefa correta fica `done`, **sem** "não consegui registrar", e a confirmação sai na voz do TOM. Acompanhar a queda do patamar da 1a nas auditorias das semanas seguintes (medir, não presumir).
