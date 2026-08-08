# RETOMADA — leia isto primeiro

Ponto único de retomada do chat Revisor/Catraca. Atualizado em **08/08/2026, 22h**.

Se você acabou de perder contexto (compactação ou sessão nova): **leia este arquivo inteiro
antes de qualquer coisa.** Ele é curto de propósito. Os detalhes estão nos dois documentos
irmãos, e só valem quando você precisar deles:

- `CHECKPOINT-2026-08-08-refatoracao-tom.md` — a refatoração (Fatia A, deploy, incidentes)
- `GOVERNANCA-TOM-metodologia.md` — o ciclo de governança e as 4 passadas de triagem

---

## PRÓXIMO PASSO (é só isto)

**Varrer os 209 findings `medio`/`baixo`** que nunca foram olhados — agrupando por FAMÍLIA,
não por severidade.

É o filão comprovado: os 4 KIs fechados em 08/08 estavam **todos** em findings `medio`, e
ficaram meses invisíveis porque a fila era triada por severidade. Severidade mede o caso, a
família mede a causa. Método que funcionou hoje: agrupar por sintoma → puxar o **literal** de
`conversation_history` → rodar o caso contra o código real → só então decidir a raiz.

⚠️ Três vezes seguidas em 08/08 a raiz registrada não era a raiz real. Trate raiz escrita
como hipótese.

**No radar, com data (não bloqueia):** medir a F3 por volta de **15/08** — `CONFIRM_NOEXEC`
deve cair e `CONFIRM_CREATE_ALLOWED` aparecer; cruzar com `tasks` criadas logo após o marker
pra confirmar que nada duplicou. Rollback é `TOM_CONFIRM_CREATE_GATE=0`. Junto, checar se
voltou alguma outbound com verbo de conclusão + "não consegui registrar" (seria forma nova
escapando do sanitizador).

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
| **"Siim" e "Todas feitas" não confirmavam** (2 KIs) | 08/08 18:17 UTC |
| **F3: criação liberada sem payload executável** (`TASK-CONFIRM-DONE-NOOP` fechado) | 08/08 18:57 UTC |
| **Afirmação + desmentido na mesma msg** (`TOM-AFIRMA-DEPOIS-DESMENTE` fechado) | 08/08 19:09 UTC |

Governança: auditoria auditada, migration de reverificação aplicada, fila `alto` triada
(21 → 13 fechados, 4 vivos, 4 aguardando), 3 famílias viraram KI rastreável.

**O número que orienta tudo:** findings caem **71% por semana** desde 07/06 (86 → 25).
Confabulação **−85%**. `dropped_request` caiu só 56% e virou a categoria **dominante**.

---

## FILA (em ordem)

1. **209 findings `medio`/`baixo`** por família (acima).
2. **Medir a F3 + o sanitizador** por volta de 15/08 — ver acima.
3. **Medir a Fatia A** (fecha a Task 7) — ligada em 08/08 15:25 UTC. Olhar
   `[TaskTarget] serie` nos logs e `TASK_TARGET_AMBIGUOUS` em `marker_logs`.
4. **Auditar o Dreams** (03h) — o Alf sinalizou que tem bastante coisa lá. Nunca olhado.
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
- **O resumo do finding NÃO é a fala da pessoa.** O finding da Vitoria dizia `USUÁRIO:
  "Confirmado"` — ela escreveu **"Siim"**. Um dá `yes` no detector, o outro dava `null`, e a
  diferença era o bug inteiro. Puxar sempre o literal de `conversation_history` antes de
  concluir qualquer coisa sobre o que o usuário disse.
- **Raiz escrita num KI é hipótese até alguém ir ao banco.** A raiz que eu havia registrado
  em `TASK-CONFIRM-DONE-NOOP` ("falta um `complete_confirm`") estava errada — a intent e o
  executor já existiam. Rodar o caso contra o código real custa minutos e evita construir
  a coisa errada.
- **`console.warn`/`error` vão pro `tom-error.log`, não pro `tom-out.log`.** Contei os 5 ramos
  de falha do `complete` no out.log e deu **zero em todos** — falso-zero. No error.log eram
  158 (76 do guard de data futura, 55 do A2). Contar falha sempre nos DOIS arquivos.
- **Exceção aberta num caso costuma valer para a família toda.** O gerúndio foi liberado no
  `MOVE_CLAIM` em 27/07 com a razão certa ("este gate só roda quando já sabemos que nada
  persistiu") e ninguém generalizou — dois meses depois o mesmo buraco reapareceu em
  "Fechando a tarefa dela". Ao abrir exceção, perguntar de quantos casos ela vale.
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
