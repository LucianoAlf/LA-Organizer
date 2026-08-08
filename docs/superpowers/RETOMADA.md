# RETOMADA — leia isto primeiro

Ponto único de retomada do chat Revisor/Catraca. Atualizado em **08/08/2026, 22h**.

Se você acabou de perder contexto (compactação ou sessão nova): **leia este arquivo inteiro
antes de qualquer coisa.** Ele é curto de propósito. Os detalhes estão nos dois documentos
irmãos, e só valem quando você precisar deles:

- `CHECKPOINT-2026-08-08-refatoracao-tom.md` — a refatoração (Fatia A, deploy, incidentes)
- `GOVERNANCA-TOM-metodologia.md` — o ciclo de governança e as 4 passadas de triagem

---

## PRÓXIMO PASSO (é só isto)

**Implementar o `complete_confirm`** — KI `TASK-CONFIRM-DONE-NOOP`, 8 ocorrências em 10 dias,
a dor de maior volume hoje.

**Raiz já confirmada:** não existe intent de confirmação de CONCLUSÃO. `VALID_KINDS` em
`src/services/pending-intents.js:25` tem `task_creation`, `event_creation`,
`reschedule_confirm`, `event_create_confirm`… e nenhum para concluir. Quando o TOM pergunta
"posso dar baixa?" e a pessoa diz "Sim rolou", a execução depende do **LLM re-emitir o marker**
— e ele não re-emite. Por isso ele repete a pergunta e a tarefa segue cobrando.

**Caminho (espelhar o `reschedule_confirm`, que já resolveu isso no reagendamento):**
1. Detector que abre o intent quando o TOM pergunta se pode concluir.
2. `openIntent(collab.id, 'complete_confirm', { actions })` com as tarefas **já resolvidas** —
   molde em `engine.js` ~10837.
3. Resolução determinística no início do `processMessage`, junto do bloco de
   `reschedule_confirm` em `engine.js` ~8713 (janela `withinConfirmWindow` de 15 min;
   "sim" aplica, "não" resolve como `denied`).

⚠️ **DUAS PORTAS:** kind novo entra em `VALID_KINDS` **e** no CHECK da tabela no banco. Só no
banco → `openIntent` **lança**, cai no catch do ramo e o apply é pulado **em silêncio**. Já
aconteceu com o próprio `reschedule_confirm` (comentário em `pending-intents.js:21`).

Verificar também se `TASK-RESCHEDULE-CONFIRM-NOOP` (aberto) não é a mesma raiz.

---

## ONDE ESTAMOS

**Produção saudável e sincronizada.** VPS `0` commits atrás, deploy automático voltou a
funcionar, flag `TOM_TASK_TARGET_SERIES=1` ligada.

Fechado em 08/08:

| o quê | commit |
|---|---|
| Auto-envenenamento de data no grupo | `31f4d72f` |
| Fatia A — alvo por ciclo corrente (3 handlers) | `10277e17` `b30801c1` |
| Prova determinística do executor (6/6) | `a3eaf172` |
| Auto-deploy morto há 5 dias | `860295aa` |
| Cascata de pacote no reschedule (caso Rose) | `9c4a4694` |
| "terça que vem" caindo na abstenção | `00ff628a` |

Governança: auditoria auditada, migration de reverificação aplicada, fila `alto` triada
(21 → 13 fechados, 4 vivos, 4 aguardando), 3 famílias viraram KI rastreável.

**O número que orienta tudo:** findings caem **71% por semana** desde 07/06 (86 → 25).
Confabulação **−85%**. `dropped_request` caiu só 56% e virou a categoria **dominante**.

---

## FILA (em ordem)

1. **`TASK-CONFIRM-DONE-NOOP`** — implementar (acima). 8 casos.
2. **`TOM-AFIRMA-DEPOIS-DESMENTE`** — 5 casos. O chokepoint de honestidade dispara DEPOIS da
   afirmação; as duas frases convivem e a pessoa não sabe em qual acreditar. Provável caminho:
   sanitizar a afirmação ANTES do envio quando o marker não foi aplicado.
3. **Medir a Fatia A** (fecha a Task 7) — ligada em 08/08 15:25 UTC. Olhar
   `[TaskTarget] serie` nos logs e `TASK_TARGET_AMBIGUOUS` em `marker_logs`.
4. **209 findings `medio`/`baixo`** nunca olhados — encolhem muito com o cruzamento automático.
5. **Auditar o Dreams** (03h) — o Alf sinalizou que tem bastante coisa lá. Nunca olhado.
6. **Crons de governança** — paridade git↔produção; `[GroupChat][DATE-CLAIM]` > 0; molde
   recorrente virando `cancelled`.
7. **Segunda seção no relatório das 07h**: "o que foi feito e o que reincidiu".
8. Menores: `CONFAB-WRITE-DATE-NO-RELLABEL` (data no 1:1, não tocado); rotacionar token da
   Hostinger; confirmação ao cancelar tarefa recorrente (é UI, esbarra no freeze).

---

## COMO TRABALHAR AQUI (o que já custou caro aprender)

- **Prova de reversão sempre.** Rodar o teste contra o código ANTES do fix: se não reproduzir o
  bug, o teste não mede nada. Foi assim que o cenário B passou verde sem tocar na linha que
  dizia testar.
- **`incident_at`, nunca `created_at`**, ao comparar finding com data de fix.
- **Agrupar por família antes de priorizar por severidade.** Severidade mede o caso, não a
  frequência da causa — as 3 famílias eram todas `medio` e por isso invisíveis.
- **Reincidência por categoria+pessoa é só primeiro filtro.** Não fecha nem mantém aberto
  sozinho: inflou os vivos e me fez apontar uma frente já morta.
- **O dublê dos testes ignora a lista de colunas do `select`** — coluna faltando passa VERDE na
  suíte e só quebra em produção. Conferir à mão.
- Baseline da suíte: `node --test "src/**/*.test.js"` → **`fail 3`** (env ausente, não é
  regressão). `node --test src/` é falso-vermelho.
- **Autonomia:** reversível e provável → faço e conto depois. Irreversível, voz do TOM, ou
  decisão de negócio → pergunto. Deletar dado de produção → sempre pergunto.

---

## PROTOCOLO DE CHECKPOINT

Quando o contexto ficar pesado: **atualizo este arquivo → o Alf roda `/compact` → eu leio este
arquivo e sigo.** O `/compact` é comando dele (eu não consigo disparar).

Ao atualizar, manter as quatro respostas: **de onde viemos · onde estamos · pra onde vamos ·
o que está pendente.** E o PRÓXIMO PASSO no topo, executável sem precisar de mais nada.
