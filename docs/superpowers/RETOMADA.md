# RETOMADA — leia isto primeiro

Ponto único de retomada do chat Revisor/Catraca. Atualizado em **08/08/2026, 22h**.

Se você acabou de perder contexto (compactação ou sessão nova): **leia este arquivo inteiro
antes de qualquer coisa.** Ele é curto de propósito. Os detalhes estão nos dois documentos
irmãos, e só valem quando você precisar deles:

- `CHECKPOINT-2026-08-08-refatoracao-tom.md` — a refatoração (Fatia A, deploy, incidentes)
- `GOVERNANCA-TOM-metodologia.md` — o ciclo de governança e as 4 passadas de triagem

---

## PRÓXIMO PASSO (é só isto)

**Auditar o Dreams (03h)** — única área grande que nunca foi olhada, e o Alf sinalizou que
tem bastante coisa lá. Depois dele vem o **🤖 agente de governança** (seção própria abaixo,
pedido explícito para não esquecer).

Fora esses dois, a fila não tem nada grande e comprovado: sobraram 3 findings de data errada
no reagendamento, 3 de proativo em dia de descanso (**checar antes se o DND por dia da semana
já existe** — a Ana Paula pergunta como configurar, assinatura de
`project_tom_nega_capacidade`) e as medições de 15/08.

### O que a varredura do `schema_invalid` ensinou (08/08)

Achei 242 casos e escrevi num KI que era "a maior causa de pedido perdido". **Estava errado,
e o erro era meu, de uma hora antes.** Datando o `tom-error.log` por mês: maio 63, junho 59,
julho 23, agosto 8 — e dos 8 de agosto, 4 já estavam mortos. **O vivo era 4.** Somei
histórico sem datar, que é exatamente o que a regra do `incident_at` manda não fazer.

O mecanismo é real e vale guardar: o LLM emite JSON **bem formado** com campo/valor fora da
whitelist — `to_name` vs `recipient_name`, `message` vs `message_body`, `items`/`days` vs
`goals`+`distribution`, `body` vs `content`, `mode:"direct"`. E `schema_invalid` **não tem
retry** (o auto-retry só cobre "verbalizou promessa e não emitiu marker").

**O padrão que resolve:** toda vez que alguém aceita o sinônimo, aquele tipo some da lista.
`to_name` (14/07) zerou `recipient_name:missing` — o último caso é do próprio dia. `body`
(05/08) zerou o `MEMORY_SAVE`. Hoje, `WEEKLY_PLAN` e `mode`. **Aceitar o sinônimo, não
construir maquinário.** Os dois caminhos grandes que cheguei a propor (retry com skill dona;
segurar skill no fluxo multi-turno) não se justificam em 4 casos/mês — reavaliar se subir.

⚠️ **Cinco vezes em 08/08 a raiz registrada não sobreviveu ao dado.** Trate raiz escrita como
hipótese, inclusive a que você acabou de escrever. E **date antes de somar**.

---

## 🤖 AGENTE DE GOVERNANÇA — NÃO ESQUECER (pedido explícito do Alf, 08/08)

**Vem logo depois do Dreams.** O Alf pediu para isto ficar registrado de forma que não se
perca: *"a gente não pode esquecer disso jamais"*.

**O que é:** um agente que roda sobre a auditoria (a das 07h e a do Dream das 03h), consulta
`tom_audit_findings` e `tom_known_issues`, olha o histórico — o que já foi corrigido, o que é
regressão, o que está se repetindo — e **já gera o ajuste**, com autonomia, exceto quando a
decisão for de negócio.

**Decidido pelo Alf:** autonomia para corrigir sozinho; parar só em decisão de negócio; "o
grande lance é não ficar parando". Modelo: o mais capaz disponível (ele falou em Opus; hoje o
topo é **Opus 5** — vale confirmar na hora de montar). O TOM roda em Sonnet e continua assim.

**DECIDIDO PELO ALF EM 08/08 — é mais que relatório, é canal de comando, e vive num GRUPO.**
Não é só o agente *avisando*: o Alf e o Hugo vão **pedir correção e pedir auditoria pelo
WhatsApp**, com tudo liberado, em vez de abrir o Claude.

**Grupo: `LA ORGANIZER - TOM`** (Alf + Hugo + TOM). O Alf descartou o 1:1 e a razão é boa: ele
usa o TOM 1:1 no dia a dia (reunião, financeiro) e misturar embola dois papéis — além de
espalhar poder de engenharia no canal pessoal dele. No grupo o poder fica num lugar só e
auditável. O relatório das 07h passa a ir pra lá, e o 1:1 dele volta a ser só assistente.
O Alf fica no grupo (não dá pra deixar só com o Hugo: o ponto de parada do agente é
"decisão de negócio", e quem decide é ele).

**MODELO-JANELA: MANTER como está** — eu sugeri abrir exceção pro grupo de governança e o Alf
recusou, com razão melhor que a minha: se o TOM responde sempre, ele atropela os dois quando
estiverem decidindo entre si. Chama por vocativo, ele entra; despedida ou 8 min de silêncio,
ele sai. **Já funciona hoje, sem código:** `detectDisengageTrigger` fecha a janela quando a
mensagem tem "tom" + termo de despedida. A frase que o Alf quer usar —
*"valeu, Tom, dá uma segurada aí"* — **já fecha** (testado). `valeu`/`obrigado`/`tchau`/
`até`/`fechou` funcionam; só "Tom, para" ou "Tom sai" NÃO fecham (sem termo de despedida).
Se incomodar, é uma linha no `FAREWELL_RE` — não fazer sem necessidade.

Base prática já verificada: o **Hugo já é `director` ativo com WhatsApp** (final 1223) — não
precisa cadastrar ninguém. Mas o relatório das 07h hoje é **hardcoded só pro Luciano**, e
existem 4 `director` (Admin, Anne Susan, Hugo, Luciano): tem que ser **lista explícita**,
senão a Anne Susan passa a receber relatório técnico.

**PENDENTE DO ALF:** criar o grupo no WhatsApp com os dois + o TOM (o app espelha via
`group-chat-bridge`; o número do TOM precisa estar no grupo do WhatsApp). Feito isso: apontar
o relatório das 07h pra lá, montar o gate/allowlist, e **conferir `work_group_members` dos
dois** — `sender_id` NULL deixa o TOM mudo para aquele membro específico, sem erro nenhum
(`project_groupchat_sender_id_null_silent`).

⚠️ **O que muda no desenho por causa do "tudo liberado"** (levantado em 08/08; o Alf decidiu
seguir, e a mitigação é de desenho, não de custo): hoje o TOM identifica pessoa por
`collaborators.phone` — isso é **identificação, não autenticação**. Com poder de rodar
correção e deploy, quem tiver o WhatsApp tem o servidor e o banco. O canal privilegiado
precisa nascer com:
- **gate de DUAS condições, no engine e nunca no prompt** (prompt não é controle de acesso):
  `group_id` é o de governança **E** `sender_id` está na allowlist. Só "é membro do grupo"
  não basta — quem for adicionado um dia herdaria o servidor;
- **nunca acionável por conteúdo repassado**: mensagem citada, encaminhada ou de terceiro não
  vira comando (o TOM lê ~30 pessoas; sem isso, qualquer uma escreve comando por tabela);
- **deletar dado de produção segue exigindo OK explícito** — já é a regra da casa;
- **trilha de auditoria**: quem pediu, o que rodou, resultado;
- **kill switch por env var**, no padrão das outras flags.

**Ainda em aberto:**
1. **O que ele faz sozinho vs o que propõe.** Sugestão: corrige e deploya o que for
   reversível e provado (fix + teste de reversão verde); **propõe** o que mexe em voz do TOM,
   dado de produção de terceiro, ou capacidade nova.
2. **Frequência e gatilho:** depois do audit das 07h? Ou contínuo?
3. **Onde ele registra:** KI em `tom_known_issues` é o caminho natural — já é o formato.

**GUARDRAILS — e estes não são teóricos, são as lições que custaram caro HOJE:**
- **Date antes de somar.** Total histórico não é problema vivo (242 `schema_invalid` → 4).
- **O resumo do finding não é a fala da pessoa.** Puxar o literal de `conversation_history`.
- **Raiz escrita é hipótese** — inclusive a que ele mesmo acabou de escrever. Em 08/08 a raiz
  registrada caiu **cinco vezes**.
- **Prova de reversão obrigatória:** rodar o cenário contra o código ANTES do fix; se não
  reproduzir, não mede nada.
- **Checar a data do fix antes de tratar finding como vivo** — duas famílias inteiras de hoje
  já estavam mortas por fixes de um dia antes do incidente.
- **Contar falha no `tom-error.log`**, não no `tom-out.log`.
- **Nunca fechar KI por teste verde** — só com prova viva em produção.

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
| **`WEEKLY_PLAN` rejeitado por schema** | 08/08 19:43 UTC |
| **Recado morto por `mode` inválido/ausente** (coordenação) | 08/08 19:57 UTC |

Governança: auditoria auditada, migration de reverificação aplicada, fila `alto` triada
(21 → 13 fechados, 4 vivos, 4 aguardando), 3 famílias viraram KI rastreável.

**O número que orienta tudo:** findings caem **71% por semana** desde 07/06 (86 → 25).
Confabulação **−85%**. `dropped_request` caiu só 56% e virou a categoria **dominante**.

---

## FILA (em ordem)

1. **Auditar o Dreams** (03h) — única área grande nunca olhada; o Alf sinalizou.
2. **🤖 AGENTE DE GOVERNANÇA** — seção própria acima. Pedido explícito do Alf: não esquecer.
3. **Medir a F3 + o sanitizador** por volta de 15/08 — ver acima.
4. **3 findings de data errada no reagendamento** ainda vivos ("amanhã" resolvido errado).
5. **3 de proativo em dia de descanso** — checar se o DND por dia já existe ANTES de codar.
6. **Medir a Fatia A** (fecha a Task 7) — ligada em 08/08 15:25 UTC. Olhar
   `[TaskTarget] serie` nos logs e `TASK_TARGET_AMBIGUOUS` em `marker_logs`.
7. **Crons de governança** — paridade git↔produção; `[GroupChat][DATE-CLAIM]` > 0; molde
   recorrente virando `cancelled`.
8. **Segunda seção no relatório das 07h**: "o que foi feito e o que reincidiu".
9. Menores: `CONFAB-WRITE-DATE-NO-RELLABEL` (data no 1:1, não tocado); rotacionar token da
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
- **DATE ANTES DE SOMAR.** Achei 242 `schema_invalid` e escrevi que era "a maior causa de
  pedido perdido". Datado por mês: maio 63 → agosto 8, e metade dos de agosto já morta. O
  vivo era **4**. Um total histórico sem recorte de data mede o passado, não o problema.
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
