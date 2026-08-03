# Spec — Router v1/v2 e ledger de propriedade (fatia 1)

**Data:** 03/08/2026 · **De:** Claude · **Para:** Alfredo (auditoria) e Alf
**Origem:** auditoria de viabilidade Hermes+UAZAPI · **Estado:** implementado e testado, **nada aplicado em produção**

---

## 1. O que está entregue nesta fatia

| Artefato | Estado |
|---|---|
| `src/router/route-decision.js` + testes | Implementado, 16/16. **Não importado por nada** — inerte em produção |
| `migrations/2026-08-03-tom-router-ownership.sql` | Escrita. **NÃO aplicada** — aguarda auditoria |
| RPCs de ownership (4) | Dentro da migration, idem |
| RPCs de ação de negócio | **Deliberadamente fora.** Ver Contraponto 2 |
| Mudança no engine v1 | **Nenhuma.** Ver Contraponto 3 |

Nenhuma mudança de comportamento foi para produção. O que precisa da sua auditoria antes de existir é a **aplicação** da migration e a **ligação** do router ao ingress — nada disso foi feito.

---

## 2. Números reconferidos

Verifiquei os fatos do seu relatório contra o banco antes de projetar em cima deles.

| Fato | Seu relatório | Agora | Leitura |
|---|---|---|---|
| Vínculos proativos (`whatsapp_message_id` + `ref_id`) | 1.108 | **1.119** | Confere; cresceu porque o sistema está vivo |
| `task_reminders` não enviados | 689 | **705** | Confere, mesma razão |
| `task_reminders` vencidos e não enviados | 10 | **1** | O dispatcher drenou. **A conclusão não muda:** nada de segundo dispatcher sobre eles |
| `outbound_queue` | vazia | 12, todas `sent` | Drenada; segue sem owner de runtime |

**Número novo que quantifica o seu P0:** nos últimos 30 dias há **4.288 outbounds sem `whatsapp_message_id`**, contra 1.119 com ID em toda a história — e todos os que têm ID vêm do caminho proativo. Ou seja: **~79% do que o TOM fala hoje não pode ser citado e roteado de volta.** O P0 não é uma lacuna de borda; é a maioria do tráfego.

**Descoberta que barateia a correção:** `extractSentMessageId()` já existe (`src/services/sent-message-id.js`) e `whatsapp.sendMessage()` **já retorna** `response.data`. O caminho proativo usa isso via `sendAndLink`. A resposta normal (`engine.js:13103`) simplesmente descarta. Não falta infraestrutura — falta usar a que existe.

---

## 3. Router — contrato

Função **pura**, sem I/O, relógio ou aleatório. O adapter lê o ledger e entrega os fatos; a decisão é testável exaustivamente. Isso importa porque um erro aqui não degrada uma resposta: **duplica uma execução**.

```
decideRoute({ quotedOwner, flowOwner, flowPhase, canaryOpen }) → { owner, reason, conflict? }
```

**Ordem (a sua, mantida):**

1. citação pertence ao v1 → **v1**
2. citação pertence ao v2 → **v2**
3. fluxo aberto (`canary` ou `draining`) → **dono do fluxo**
4. resto → **v1**

**Sobre o conflito quote × fluxo — cheguei à sua ordem por um caminho diferente e ela se sustenta.** Cogitei dar precedência ao fluxo aberto (operação em andamento parece mais forte que citação antiga). Está errado: a citação identifica a **entidade**, e quem pode mutar uma entidade é o dono dela. Roteando pelo fluxo, o v2 receberia uma citação de entidade v1 que ele não pode tocar — e responderia "não consigo", que é pior que o v1 simplesmente resolver. Mantida a sua ordem. O conflito é **registrado** (`route_conflict`), porque discordância entre dois sinais de propriedade não pode ficar invisível.

**Fase e rollback:** fechar o canário impede **abrir** fluxo novo no v2; nunca sequestra fluxo em andamento. `draining` continua roteando para o v2 — rollback que rouba a conversa no meio faz a resposta cair num runtime que não sabe da operação, exatamente o estado que o router existe para evitar. `retired` solta.

**Robustez:** só `'v1'`/`'v2'` exatos roteiam; qualquer outro valor é ruído e cai no v1. Testei as **128 combinações** possíveis de entrada: todas devolvem exatamente um dono válido e um motivo do enum.

---

## 4. Contrapontos ao desenho

### Contraponto 1 — a regra "entidade v2 → v2" não é decidível pelo router

Sua ordem tem, no item 4, "entidade criada no canário e marcada v2 → v2". **Isso não é decidível antes do LLM no caso geral.** "Conclui a tarefa X" em texto livre exige interpretar qual é X — e interpretar dentro do router inverteria o desenho (o router existe para decidir *antes* de qualquer LLM).

A regra só é decidível quando há **quote** ou **fluxo aberto** — que já são os itens 1–3. Por isso, na fatia 1, **texto livre vai sempre para o v1**, e o v2 só recebe o que é inequivocamente dele. Isso coincide com a sua "primeira fatia: resposta a lembrete 1:1 criado no v2", então não muda o plano — muda o que se pode prometer do router.

Quando o canário crescer, a extensão natural é **cohort por colaborador**, não por entidade adivinhada em texto. Isso precisa de decisão explícita e não está aqui.

### Contraponto 2 — as RPCs de ação não devem nascer agora

Entreguei as 4 RPCs de **ownership** (`tom_route_claim_inbound`, `tom_record_outbound`, `tom_flow_open`, `tom_flow_set_phase`). São infraestrutura de roteamento: simples, verificáveis e independentes de regra de negócio.

**Não escrevi `tom_v2_apply_reminder_action` nem `tom_v2_verify_operation`**, e a razão é a sua própria: uma RPC de ação escrita hoje herdaria o contrato de ciclo de vida que ainda está quebrado. `endSeries1on1` devolve `{ended:true}` sem checar erro; `engine.js:4685` confia nisso. Escrever a RPC do v2 antes do **E2.0** seria replicar a mentira em Postgres, onde ela fica mais difícil de auditar. Elas vêm depois do contrato tipado, não antes.

### Contraponto 3 — o canário não pode começar antes do P0

Com 79% dos outbounds sem ID, o roteamento por quote cobre uma fração pequena do tráfego real. Se o canário abrir assim, a maior parte dos replies cai no default (v1) — inclusive replies a mensagens do **v2** — e o v2 parece quebrado por um motivo que não é dele.

**Pré-requisito para a fatia 3 (canário):** o v1 passar a gravar o ID de saída da resposta normal. É pequeno (`extractSentMessageId` já existe), mas mexe no engine em produção — por isso não fiz nesta entrega, para não misturar com código inerte. Proponho como fatia própria, com seu diff auditado antes do deploy.

---

## 5. Ordem das fatias

| # | Fatia | Toca produção? |
|---|---|---|
| 1 | **Router puro + schema + RPCs de ownership** ← esta entrega | Não (inerte / não aplicada) |
| 2 | Captura do ID de saída no v1 (P0) + gravação no ledger | Sim, engine v1 |
| 3 | Router transparente: tudo segue ao v1, só grava rota. Prova de não-regressão | Sim, ingress |
| 4 | Shadow v2 read-only | Não escreve, não responde |
| 5 | Canário real: 1 lembrete novo, dono v2 | Sim, escopo mínimo |

O ledger precisa estar **cheio e correto** (fatias 2–3) antes de qualquer coisa responder. Rotear com ledger vazio é decidir no escuro.

---

## 6. Fora de escopo, registrado

- **WhatsApp nativo do Hermes:** concordo em manter UAZAPI como ingress/egress único nesta fase. Trocar runtime e transporte juntos destrói a capacidade de diagnosticar.
- **Endurecer o ingress** (HMAC/segredo próprio, fila persistente, healthcheck): etapa explícita da fatia 3, não ajuste escondido.
- **Lembretes v1 em voo (705):** continuam exclusivamente no v1. O v2 nasce dono apenas do que criar.
- **`soul/` e `skills/`:** intocados.

---

**Arquivos:** `src/router/route-decision.js` · `src/router/route-decision.test.js` · `migrations/2026-08-03-tom-router-ownership.sql`
