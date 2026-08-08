# RETOMADA — leia isto primeiro

Ponto único de retomada do chat Revisor/Catraca. Atualizado em **08/08/2026, 22h**.

Se você acabou de perder contexto (compactação ou sessão nova): **leia este arquivo inteiro
antes de qualquer coisa.** Ele é curto de propósito. Os detalhes estão nos dois documentos
irmãos, e só valem quando você precisar deles:

- `CHECKPOINT-2026-08-08-refatoracao-tom.md` — a refatoração (Fatia A, deploy, incidentes)
- `GOVERNANCA-TOM-metodologia.md` — o ciclo de governança e as 4 passadas de triagem

---

## PRÓXIMO PASSO (é só isto)

**Investigar a F3 do `TASK-CONFIRM-DONE-NOOP`** — o que sobrou dele depois de 08/08.

São os casos em que o TOM diz **"não consegui dar baixa agora"** ou **"tive um problema
técnico"** (Rafinha 17/07 e 23/07, Peterson 22/07). Ali o marker FOI emitido e o **apply
falhou** — é outra coisa, e a raiz nunca foi investigada.

**Caminho:** achar o ramo que emite essas duas frases literais e **contar os motivos de
falha, todos** (lição do audit 25/06: contar TODOS os ramos de falha, não parar no primeiro).

⚠️ **NÃO comece por `complete_confirm`/`reschedule_confirm` — não é a raiz.** A entrada
anterior deste arquivo mandava implementar um `complete_confirm` e estava **errada**: a intent
já existe (`kind confirmation` + `payload.batch_complete`) e o executor determinístico também
(`executeBatchComplete`, `engine.js` ~10060) — ele já rodou com sucesso 22 vezes. O que
faltava era **reconhecer a resposta**, e isso foi corrigido em 08/08.

Se um dia precisar mesmo de um kind novo: ⚠️ **DUAS PORTAS** — entra em `VALID_KINDS`
(`pending-intents.js:25`) **e** no CHECK da tabela. Só no banco → `openIntent` **lança**, cai
no catch do ramo e o apply é pulado **em silêncio**.

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

Governança: auditoria auditada, migration de reverificação aplicada, fila `alto` triada
(21 → 13 fechados, 4 vivos, 4 aguardando), 3 famílias viraram KI rastreável.

**O número que orienta tudo:** findings caem **71% por semana** desde 07/06 (86 → 25).
Confabulação **−85%**. `dropped_request` caiu só 56% e virou a categoria **dominante**.

---

## FILA (em ordem)

1. **`TASK-CONFIRM-DONE-NOOP` — só a F3** (acima). 3 casos; F1 e F2 fechadas em 08/08.
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
- **O resumo do finding NÃO é a fala da pessoa.** O finding da Vitoria dizia `USUÁRIO:
  "Confirmado"` — ela escreveu **"Siim"**. Um dá `yes` no detector, o outro dava `null`, e a
  diferença era o bug inteiro. Puxar sempre o literal de `conversation_history` antes de
  concluir qualquer coisa sobre o que o usuário disse.
- **Raiz escrita num KI é hipótese até alguém ir ao banco.** A raiz que eu havia registrado
  em `TASK-CONFIRM-DONE-NOOP` ("falta um `complete_confirm`") estava errada — a intent e o
  executor já existiam. Rodar o caso contra o código real custa minutos e evita construir
  a coisa errada.
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
