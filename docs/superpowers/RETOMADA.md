# RETOMADA — leia isto primeiro

Ponto único de retomada do chat Revisor/Catraca. Atualizado em **08/08/2026, 22h**.

Se você acabou de perder contexto (compactação ou sessão nova): **leia este arquivo inteiro
antes de qualquer coisa.** Ele é curto de propósito. Os detalhes estão nos dois documentos
irmãos, e só valem quando você precisar deles:

- `CHECKPOINT-2026-08-08-refatoracao-tom.md` — a refatoração (Fatia A, deploy, incidentes)
- `GOVERNANCA-TOM-metodologia.md` — o ciclo de governança e as 4 passadas de triagem

---

## PRÓXIMO PASSO (é só isto)

**A raiz do `schema_invalid`** — KI `MARKER-SCHEMA-DRIFT-SKILL-AUSENTE`. É a **maior causa de
pedido perdido em silêncio** que existe hoje: 242 casos históricos em 16 tipos de marker,
**24 nos últimos 30 dias** — mais que qualquer família de finding.

Não é JSON quebrado. O LLM emite JSON bem formado com **campo/valor fora da whitelist**,
porque o marker sai num turno em que a skill que define o schema **não está carregada**.
Provado no caso Quintela 03/08 cruzando `marker_logs` com o log do prompt: skill certa às
19:24:29, `criar-recorrencia` às 19:25:03, marker inventado às 19:25:21. E `schema_invalid`
**não tem retry** — o auto-retry (`engine.js` ~13000) só cobre "verbalizou promessa e não
emitiu marker".

**MEÇA ANTES DE ESCOLHER O CAMINHO:** quebrar os 24 casos de 30 dias por
`(marker_type, campo que faltou)` usando `marker_logs.raw_excerpt`. Se a maioria for
skill-ausente em fluxo multi-turno, o caminho (b) resolve mais; se for vocabulário divergente
espalhado, o (a) resolve mais.

- **(a) retry para `schema_invalid`**, espelhando o auto-retry que já existe, reemitindo com
  a skill DONA do marker carregada. Precisa de um mapa marker→skill, que hoje não existe.
- **(b) segurar a skill** durante fluxo multi-turno — mexe no seletor de loadout, território
  do Mapa (`TOM_MAPA`), risco maior.

O `WEEKLY_PLAN` já foi tratado como sintoma em 08/08 (normalizador tolerante, mesmo remédio
do `MEMORY_SAVE` em 05/08). Os outros 15 tipos seguem descobertos.

⚠️ Quatro vezes em 08/08 a raiz registrada não era a raiz real. Trate raiz escrita como
hipótese, sempre — e cruze `marker_logs` com o log do prompt antes de culpar o LLM.

### Mapa das famílias (varredura de 08/08, os 38 findings dos últimos 14 dias)

| família | casos | estado |
|---|---|---|
| Confirmação não executa / repete pergunta | 7 | ✅ fechada 08/08 |
| Afirma e desmente na mesma mensagem | 3 | ✅ fechada 08/08 |
| Data errada no reagendamento | 5 | ⚠️ 2 fechados (weekday-offby), 3 vivos — "amanhã" resolvido errado |
| Pedido ignorado no meio de outro | 6 | ⚠️ não é família — ao abrir, 2 eram `schema_invalid` e 2 o guard A2 |
| Cobrança indevida | 8 | ⚠️ ver abaixo |
| Financeiro / extrato incompleto | 3 | ❌ não tocada |

"Cobrança indevida" se desfez ao ser aberta, e vale registrar por quê: 2 casos eram tarefa
recorrente que devia ser hábito (**a ponte `<<TASK_TO_HABIT>>` entrou em 02/08 e os
incidentes são de 01/08** — já mortos); 1 era o cancelamento de série (KI
`EVENT-CANCEL-SERIE-SO-INSTANCIA`, dado da Ana Paula corrigido à mão, código não vale sob
freeze: 1 série no banco inteiro, 3 pedidos em 60 dias); sobram 3 de **proativo em dia de
descanso/férias** (Rose, Ana Paula, Gabi) — e a Ana Paula literalmente **pergunta como
configurar**, então checar se o DND por dia da semana já existe antes de tratar como falta
(família `project_tom_nega_capacidade`).

Os 171 findings com mais de 14 dias não foram varridos — a maioria deve estar morta por fix
posterior. Vale cruzar por `incident_at` antes de olhar um por um.

Os 14 findings das famílias fechadas hoje ganharam `promoted_code`, mas **seguem `novo` de
propósito**: fix no ar não é prova viva. Fecham na medição de 15/08.

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
| Varredura dos `medio`/`baixo` por família + 14 findings amarrados | 08/08 19:30 UTC |
| **`WEEKLY_PLAN` rejeitado por schema** (sintoma; raiz virou KI) | 08/08 19:43 UTC |

Governança: auditoria auditada, migration de reverificação aplicada, fila `alto` triada
(21 → 13 fechados, 4 vivos, 4 aguardando), 3 famílias viraram KI rastreável.

**O número que orienta tudo:** findings caem **71% por semana** desde 07/06 (86 → 25).
Confabulação **−85%**. `dropped_request` caiu só 56% e virou a categoria **dominante**.

---

## FILA (em ordem)

1. **Raiz do `schema_invalid`** (acima). 24 casos em 30 dias, 16 tipos de marker.
2. **Família "pedido ignorado no meio de outro"** — 6 casos. ATENÇÃO: ao abrir os 6, pelo
   menos 2 eram `schema_invalid` (Quintela) e 2 eram o guard A2 (`all_failed`, Arthur/Rose).
   Reagrupar antes de tratar como família própria.
3. **Medir a F3 + o sanitizador** por volta de 15/08 — ver acima.
4. **Medir a Fatia A** (fecha a Task 7) — ligada em 08/08 15:25 UTC. Olhar
   `[TaskTarget] serie` nos logs e `TASK_TARGET_AMBIGUOUS` em `marker_logs`.
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
