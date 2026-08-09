# RETOMADA — leia isto primeiro

Ponto único de retomada do chat Revisor/Catraca. Atualizado em **08/08/2026, 22h**.

Se você acabou de perder contexto (compactação ou sessão nova): **leia este arquivo inteiro
antes de qualquer coisa.** Ele é curto de propósito. Os detalhes estão nos dois documentos
irmãos, e só valem quando você precisar deles:

- `CHECKPOINT-2026-08-08-refatoracao-tom.md` — a refatoração (Fatia A, deploy, incidentes)
- `GOVERNANCA-TOM-metodologia.md` — o ciclo de governança e as 4 passadas de triagem

---

## ✅ FAMÍLIA C — SILÊNCIO (09/08): duas raízes distintas, as duas corrigidas

**Pedido do Alf:** *"a pessoa fala 'Tom, hoje é feriado, não me manda mensagem' — acabou, tem
que cortar na hora"*, e *"normalmente a pessoa esquece de ligar"* a preferência recorrente.

### Raiz 1 — o chokepoint de silêncio esquecia o DND (pontual)

O TOM **já gravava** `do_not_disturb_until` certo (`applyDnd`, cap 24h) — provado com o caso do
Matheus (30/06 14:08 → 01/07 08:00: **zero proativo na janela**). O problema era quem LÊ.

`isQuietNow` é o gate compartilhado — **66 pontos** o consultam — e não lia o campo. Dos 8
arquivos que gateiam por ele, **7 nunca checavam DND**; só o dispatcher checava, à mão, em 14
pontos. O pior: `send-proativo.js`, documentado como *"o silêncio fica embutido aqui — é
impossível esquecer o gate"*, com trava de deploy própria. **O chokepoint que existe pra
ninguém esquecer o silêncio esquecia o DND.**

Fix num lugar só: `isQuietNow` checa `do_not_disturb_until` antes de tudo; os 66 herdam.
Colunas entraram no `QUIET_PREF_COLUMNS` (sem isso o caminho por UUID buscaria prefs sem o
campo — o footgun do SELECT parcial do caso Quintela). DND é **global** (não é por contexto) e
vence até `defaultNightGate:false`, senão o feriado continua chegando pelo lembrete que a
própria pessoa agendou. Provado na VPS: `dnd:feriado` → `quiet:true`; vencido → passa.

### Raiz 2 — reclamação não vira preferência (recorrente)

O padrão, medido: **pedido explícito funciona; menção incidental evapora.**

| pessoa | o que fez | `quiet_days_work` |
|---|---|---|
| Arthur (07/06) | pediu "não me manda no domingo" | `[0]` ✓ |
| Ana Paula (26/07) | perguntou como faz | `[0]` ✓ |
| **Rose (01/08)** | *"muda pra segunda pfvr, amanhã é domingo, n trabalho"* | **`[]`** ✗ |
| **Clayton (19/07)** | *"Tom, hoje é domingo, marcar para segunda feira"* | **`[]`** ✗ |

Nos dois casos abertos o TOM **respondeu certo e disse de volta** que era folga ("domingo é
folga 🙌", "Bom domingo!") — e não gravou. No domingo seguinte o briefing disparou e virou
finding. A regra 17 só dispara em pedido explícito de silêncio; informação dada de passagem
não aciona nada. Fix: **regra 17b** — resolve o pedido imediato, depois oferece em uma linha
("quer que eu pare de te acionar aos domingos?") e persiste via regra 17. Máximo uma oferta por
conversa; proibido prometer sem o marker. Guardada por `regras-silencio.test.js` (texto), senão
uma refatoração apaga a regra e nada quebra.

### O 3º pedido já estava pronto

*"Se a pessoa falar 'já tá ligado e você continua mandando', ele tem que relatar pro agente de
governança"* — **já funciona**: o auditor tem a categoria `proactive_overreach` com esses
literais ("não me manda agora", "hoje é meu descanso", "dia de folga/domingo") e manda emitir
**mesmo se o TOM se desculpar depois**. Vira finding → digest 07:30 → agente 08:00.

⚠️ **Contraponto ao "TOM manda a pessoa ir no app":** ele **já configura sozinho** (Arthur e Ana
Paula provam). Mandar ir em *Mais* seria rebaixar o que já funciona. Não implementei — se você
quiser mesmo assim, é uma linha na 17b.

## PRÓXIMO PASSO (é só isto)

**Escolher o próximo da FILA.** Os dois itens que estavam na frente saíram: o agente de
governança está ✅ no ar (08/08 22:17) e a **Fatia 3 do router já estava completa** — ver
abaixo. Recomendação: família C (tarefa que vence em dia não-útil, item 1 da fila).

Não há bug aberto com sinal vivo no momento — os quatro alvos que persegui em 08/08 já tinham
conserto no código.

### ✅ FATIA 3 DO ROUTER — JÁ ESTAVA COMPLETA (medido em 09/08)

Fui executar e **não havia o que fazer**: os 4 itens da régua estão no código e provados em
produção. O que me mandou pra lá foi uma nota minha de 03/08 16:27 dizendo que faltava o 4º
item (amarrar o outbound ao claim vencedor) — o commit que o fechou é `d8ddfb1b`, de **03/08
16:41**. A nota estava certa quando escrita e envelheceu 14 minutos depois.

**Cadeia verificada no código:** `webhook.js:245` claim → `:264` `enterTurn` → `:548`
`runInTurn` (a fila não herda o contexto, então reentra) → `whatsapp.js:296` `beforeSend`
gateia → `:307` `afterSend` grava. Flag `TOM_ROUTER_CLAIM=1` ligada na VPS.

**Medição (ledger `tom_message_ownership`), turnos REAIS depois de 03/08 16:41:**

| | |
|---|---|
| turnos concluídos | 214 |
| com a saída amarrada à operação | **208** |
| silenciosos (nenhum outbound) | 6 |
| **vazamento (saiu fora do dono)** | **0** |

⚠️ **Duas leituras que quase viraram bug falso:**
1. `lease_token` é **0 em 1165 outbounds** — parece furo e não é. `tom_record_outbound` usa
   `p_lease_token` como **guarda de posse** e deliberadamente não grava a coluna no insert: a
   lease pertence à operação de entrada, não ao registro de saída.
2. A cobertura de `operation_id` cai pra 9–26% em 05–07/08. É o **Replay Lab**: 26/55/19 turnos
   QA nesses dias, e em replay o outbound é suprimido por projeto. Fora do replay, fecha.

**7 inbounds presos em `claimed`:** 5 tiveram resposta (o claim só não recebeu o `finish` — é o
early-return de mídia já documentado no `webhook.js:265`), 1 é QA e 1 é fixture
(`wa_message_id=QA-AUTH-0001`, telefone `5599999999999`, sem colaborador). **Zero usuário real
sem resposta.**

### ✅ `MEMORY_SAVE schema_invalid` — JÁ ESTAVA CORRIGIDO (08/08)

Peguei os payloads REAIS recusados em `marker_logs` (Matheus `type/title/body` 04/08;
Quintela `type/name/description/body` 04/07) e rodei contra o parser ATUAL: **os 3 passam.**
O sinônimo `body` entrou em `memory-fields.js` em 05/08 — um dia depois do incidente.

📉 **A família inteira zerou:** `schema_invalid` teve **24 ocorrências em 30 dias** (8 tipos
de marker) e **0 desde 05/08**, última em 04/08 14:22. Os fixes de normalização da semana
(`memory-fields` body, `weekly-plan-normalize`, `coord-alias`) resolveram junto.

**KI `MARKER-SCHEMA-DRIFT-SKILL-AUSENTE` NÃO foi fechado** — anotei a medição nele e deixei
aberto. 4 dias de zero não é prova: com base de ~0,8/dia, zero em 4 dias tem ~4% de chance de
ser acaso. Sugestivo, não conclusivo. **Confirmar em 15/08 antes de marcar corrigido.**

⚠️⚠️ **A LIÇÃO DO DIA — QUATRO VEZES seguidas o conserto já existia no código:**
1. reschedule não movia `remind_at` → existia desde 30/05
2. o piso do lembrete vencido → `4dd0e206`, 05/08, **citando o caso pelo nome no comentário**
3. DND por dia da semana → `quiet_days` existe, `isQuietNow` gateia ~60 pontos
4. `MEMORY_SAVE schema_invalid` → sinônimo `body`, 05/08

Em três dos quatro, o comentário no código **já nomeava o caso que eu estava investigando**.
**Antes de escrever qualquer fix aqui: `grep` o nome da pessoa, a data do incidente e o
marker no `src/`.** O custo de não fazer isso hoje foi horas de investigação; o de fazer é
uma chamada de grep.

### ✅ `ACTIONABLE_NO_MARKER`: ruído cortado em 69%, e o alerta agora diz a CAUSA (08/08)

**Correção de uma análise minha, registrada aqui de propósito.** Eu tinha escrito neste
arquivo que os 18 alertas eram "ZERO reais". **Errado — são ~4-5 reais**, e o erro foi de
método: olhei se o dado existia no banco no FIM. Existia. Mas o `MEMORY_SAVE` do Matheus só
entrou na **terceira** tentativa; as duas primeiras foram `rejected(schema_invalid)`, com
`CHOKEPOINT confab:promise_nomarker` disparando junto.

🔑 **O estado final esconde a falha. Quem conta a verdade é o marker DO TURNO.** Ver o dado lá
não prova que o caminho funcionou — prova que alguma tentativa funcionou, e o usuário sentiu
as que não.

**Composição real dos 18 (14 dias):**

| classe | qtd |
|---|---|
| REAL — tentou e o marker foi **recusado** (`schema_invalid`, marker inexistente) | 4 |
| recuperado pelo auto-retry no mesmo turno | 3 |
| marker executado no turno | 1 |
| conversa, listagem, pergunta ("A frota chegou, Alf! 🛸") | ~10 |

**O detector estava funcionando** — apontou `MEMORY_SAVE schema_invalid` e um
`<<FINANCE_ENTRY>>` que o TOM inventou e o parser removeu (Rose 25/07). O problema era a
proporção: 16 dos 18 chegavam ao relatório das 07h, todo dia, no WhatsApp do Alf e do Hugo.

**Fix:** `src/lib/actionable-triage.js` (puro, 7 testes, fixture = os 18 casos REAIS do
banco). Classifica pelo que aconteceu no turno: recusa de marker vem primeiro (é o mais
grave e o único que já traz a causa), depois persistência, depois pergunta/listagem/conversa.
Medido em produção sobre 14 dias: **16 → 5 reportados, 69% de ruído a menos**, e o que sobra
sai com `MEMORY_SAVE (schema_invalid)` no título em vez de "o TOM prometeu e não fez".

⚠️ **Recusa tem prioridade sobre sucesso no mesmo turno** — no caso Matheus 10:01 houve um
`executed` E um `rejected`. Se o sucesso mascarasse a recusa, a falha que a pessoa sentiu
sumiria do relatório.

**O que os 5 reais apontam** (próximo alvo natural): 3 são `MEMORY_SAVE schema_invalid` —
família do KI aberto `MARKER-SCHEMA-DRIFT-SKILL-AUSENTE`; 1 é o TOM emitindo um marker que
não existe (`FINANCE_ENTRY`).

### ✅ PROATIVO EM DIA DE DESCANSO — NADA A CODAR (08/08)

Eram "3 findings"; abertos, eram **14**. Investiguei os 14 e **nenhum precisa de código**.
Checar antes de codar valeu o dia inteiro aqui.

**Família A — "não me mande no domingo" (3): já existe e já funciona.**
`user_preferences` tem `quiet_days`, `quiet_days_work/personal`, `quiet_weekends` e janelas
`quiet_start/end_time`; `isQuietNow` gateia **~60 pontos** de envio, e há um
`quiet-gate-guard.test.js` que **bloqueia o deploy** de envio proativo sem gate.
Melhor: **o TOM configura sozinho.** A Ana perguntou "como faço pra você não me mandar
mensagem domingo?" às 19:02 de 26/07 — e há dois `PREFS_UPDATE` *executed* em `marker_logs`
às **19:03 e 19:04**. Prefs hoje: `quiet_days_work=[0]`. Idem Gabi (27/07) e Matheus (14/07).

**Família B — "não me cobre antes do vencimento" (6, o Matheus reclamou 4×): já corrigido.**
A raiz não era `reminder_lead` nem antecedência — era o **`remind_at` congelado sobrevivendo
ao reschedule**. Provado no banco: "Finalizar inventário de musicalização" com
`due_date=06/08` e `remind_at=20/06` (45 dias no passado), `reminded_at=04/08 09:35` — o cron
cobrou **2 minutos** depois de o TOM reagendar pra quinta. Corrigido em **05/08**
(`4dd0e206`, piso no `shiftTaskRemindAt`, com teste), um dia depois do incidente. Hoje:
**0 tarefas** em estado de disparo indevido.

⚠️ **Duas vezes hoje eu "achei o bug" e o código já tinha o conserto** — o shift de
`remind_at` no reschedule (30/05) e depois o piso (05/08). Nos dois casos o comentário no
código já citava o caso pelo nome. **Antes de escrever o fix, grepe o caso no código: aqui a
chance de já existir é alta.**

**Família C — RECLASSIFICADA, segue aberta (3):** Rose 01/08, Clayton 19/07, Kailane 21/06.
O resumo dizia "proatividade em dia de descanso", mas o literal é outra coisa: *"muda essa
tarefa pra segunda pfvr, amanhã é domingo, n trabalho"*, *"hoje é domingo, marcar para
segunda feira"*. **Não é sobre receber mensagem — é sobre a tarefa VENCER em dia não-útil**,
e `quiet_days` não cobre isso. Antes de codar: checar se o agendamento já sabe pular dia
não-útil, e se `quiet_days` pode ser lido como calendário de trabalho.

### ✅ DATA ERRADA NO REAGENDAMENTO — FECHADO (08/08 22:30 UTC)

Eram 3 findings. **2 refutados no literal, 1 real** — e a raiz não era nenhuma das suspeitas
óbvias (nem fuso, nem o fluxo principal).

- **Rafinha 01/08 — REFUTADO.** O literal diz "Reagendado pra amanhã! Igreja Bangu —
  **domingo 02/08**". Sábado + 1 = domingo 02/08: o TOM acertou. Errado estava o *resumo* do
  auditor. (De novo: `project_finding_resumo_nao_e_literal`.)
- **Anne Susan 05/08 — REFUTADO como data.** Ela pediu "me lembra no dia 7", ele entendeu
  "amanhã" — compreensão de áudio, não aritmética; na correção acertou "dia 7 (sexta)".
- **Alf 05/08 — REAL.** Virou `AUTO-RETRY-DATE-POISON-FROM-REPLY`, corrigido.

**A raiz:** o TOM narrou "reagendei pra amanhã (sex 07/08)" numa quarta; o
`ACTIONABLE_NO_MARKER` viu texto acionável sem marker e disparou o `TASK_UPDATE_AUTO_RETRY`,
que **gravou 07/08 na tarefa**. O mini-prompt do retry é um conversor texto→marker: a fala do
TOM é a fonte de verdade dele, e a data explícita no texto ganhou da âncora — que estava
certa ali dentro.

⚠️ **A LIÇÃO QUE CUSTOU 8 TENTATIVAS EM BRANCO: reproduza com a ENTRADA REAL DO TURNO, não
com o pedido original da conversa.** Eu alimentava o áudio completo ("...colocar pra
amanhã...") e o modelo acertava 4/4 — parecia que o bug não existia. No turno do retry o
texto do usuário era só **"O q?"** (está no `reason` do `marker_logs`). Sem termo temporal no
pedido, o modelo copia a data do reply: **2 erros em 4**. Depois do fix, 0/4.

🔑 **O achado de maior alcance foi de graça, no meio do caminho:** `detectaDataAfirmadaErrada`
(`utils/date-claim`, no ar desde 06/08) era **cego** ao formato `amanhã (sex 07/08)` — só
pegava `(07/08)`. E o dia-da-semana no parêntese é o formato que o TOM **mais** produz,
porque é o da TABELA DE DATAS do prompt. *O formato mais provável era o único cego.* Isso
valia também pro **chat de grupo**, que já usava o detector e onde a taxa medida é 42%.

📏 **Medição do 1:1 (45 dias):** "amanhã (DD/MM)" em 37 falas, **1 errada de verdade**. Meu
primeiro número foi 6 — os outros 5 caíram ao abrir o literal (o regex casava `07/20` dentro
de "Fechar folha 07/**2026**", e "Semana (**25/07**–31/07)" depois de "hoje"). **Grep de data
com janela de N caracteres infla; datar e abrir o literal desinfla.**

### ✅ DIGEST PROATIVO — NO AR (08/08 22:05 UTC)

O TOM leva os achados ao grupo **sem ninguém pedir**, todo dia às **07:30 BRT** (depois da
triagem das 5h, então `auto_triage` já separa regressão de achado novo). Janela de retry até
11h; idempotência em `ritual_logs` (`ritual_type='ops_digest'`, âncora = primeiro da
allowlist). Kill switch: `TOM_OPS_DIGEST=0` desliga só o automático e mantém o sob demanda.

**É determinístico — SQL + template, sem LLM.** Um alarme diário que erra a contagem uma vez
deixa de ser lido, e aí se perde o canal inteiro. Para aprofundar existe o agente Opus 5 no
mesmo grupo, sob demanda.

- `src/services/ops-digest.js` + 31 testes. Regressão vai pro topo e **nunca** é cortada pelo
  teto de 5 itens; o que sobra é anunciado ("+6 não listados"), nunca truncado calado.
- Provado ponta a ponta: mensagem no grupo + `ritual_logs`, e 2ª rodada devolveu
  `já entregue hoje` sem duplicar.

⚠️ **O que medir em ~15/08:** se o digest disser "nada novo" muitos dias seguidos, **não
assuma que é dia limpo** — confira `[ConvAudit]` em `logs/rituals.log` entre duas marcas de
`[Dream] concluído`. Em 08/08 o dia era limpo de verdade (0 achados, 0 falhas), mas essa é
exatamente a forma que um falso-verde tomaria.

### ✅ FORMATO DE ENTREGA NO GRUPO (08/08)

O Alf reclamou de "maçaroca de texto" antes de existir maçaroca — e estava certo pelo motivo
errado do meu lado. **Minha hipótese (markdown) estava errada:** rodei o agente na VPS com um
pedido real e a saída não tinha `##`, `**` nem tabela. Tinha **2165 caracteres de parágrafo
corrido, sem hierarquia e sem um emoji**. O problema é densidade, não sintaxe.

- **`docs/ops/FORMATO-GRUPO.md`** — as regras de entrega (estrutura, emoji, teto de linhas,
  exemplo bom e exemplo ruim). Lido a cada pedido e colado no briefing: **editar o arquivo
  muda a resposta na hora, sem deploy**. Dá pra pedir a mudança ao próprio TOM no grupo.
  Fica fora de `skills/` de propósito — o loader varre aquele diretório e isso não pode
  vazar pro TOM que fala com o time.
- **`src/utils/wa-format.js`** + 18 testes — rede determinística: converte markdown pro que o
  WhatsApp entende e divide em mensagens de ~1200 chars. **Divide em vez de truncar**: num
  relatório de auditoria a conclusão fica no fim. Bloco ``` é preservado byte a byte, senão
  corromperia a evidência que o agente está mostrando.

### Auditoria do Dreams (08/08) — o ritual está saudável; o que ele PRODUZ tinha um furo

**Execução: impecável.** 37/37 colaboradores por dia, zero erro em 21 dias
(`ritual_logs` + `[Dream] concluído: 37/37`). Não precisa de nada.

⚠️ **Terceiro arquivo de log:** o dispatcher roda por crontab e escreve em
**`logs/rituals.log`** — não no `tom-out.log` nem no `tom-error.log`. Grepar `[Dream]` nos
outros dois dá zero e parece que o ritual não roda.

**O furo estava no produto, não no processo** — e só apareceu porque olhei o que o Dream
*grava*, não se ele *rodou*: 31 memórias ativas falam em "hoje/ontem/amanhã" e o prompt do
1:1 renderizava **sem data nenhuma**. Corrigido (`MEMORY-RELATIVE-DATE-ORPHAN`, KI próprio).
Vale a lição: **o auto-envenenamento de data foi corrigido no grupo em 08/08 e ninguém
verificou o 1:1** — mesma família, canal maior, ficou de fora. Ao fechar um caso, perguntar
onde mais aquilo vive.

**Dois achados menores, medidos e NÃO tratados (de propósito):**
- **Maturidade não evolui:** 29 `beginner`, 8 `developing`, **zero** `proficient` ou
  `advanced` — a escala tem 4 níveis e usa 2. Os 8 `developing` são de fato os usuários mais
  pesados, então o sinal não é aleatório; mas ninguém nunca subiu. Ou o critério do LLM é
  conservador demais, ou os dois níveis de cima são inalcançáveis. Baixo impacto (o campo
  quase não é usado), custo de investigar > ganho hoje.
- **Os 4 perfis `[QA] Replay` entram no Dream** (37 = 33 pessoas + 4 QA) e consomem LLM. Não
  geram lixo (0 memórias, 0 findings), então é só desperdício pequeno — filtrar por
  `full_name ilike '[QA]%'` resolveria em uma linha, mas não vale mexer no dispatcher por isso
  agora.

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

## 🤖 AGENTE DE GOVERNANÇA — ✅ NO AR (08/08 22:17 BRT)

**Roda todo dia às 08:00 BRT**, depois do digest das 07:30. Janela de retry até 12h.
Kill switch: `TOM_GOV_AGENT=0` no `.env` da VPS (vale no próximo tick, não precisa restart —
o dispatcher é processo de cron e relê o `.env` a cada rodada). Backup: `.env.bak-gov-*`.

**Arquivos:** `src/services/governance-agent.js` (ciclo) · `src/rituals/gov-runner.js`
(processo próprio) · `src/lib/placar-governanca.js` (ETAPA 1) · `docs/ops/PROTOCOLO-GOVERNANCA.md`
+ `ESCADA-GOVERNANCA.md` + `PEDIDOS-DE-PRODUTO.md` (**editáveis sem deploy** — mudam o
comportamento na hora). Log: `logs/gov-agent.log`. Lock: `/tmp/la-gov.lock`.

### Primeira rodada real — 08/08 22:17, VERIFICADA NO BANCO

Refutou um achado e **não mexeu em uma linha de código** — que é o desfecho certo, não uma
falha. Fechou `frustration` do Quintela (06/08) como `falso_positivo` depois de puxar o literal
e varrer os 467 inbounds dele. Escalou ao grupo a única parte que era julgamento ("o TOM aceitou
culpa que o histórico não sustenta — é voz/prompt, fora da minha alçada"). `ritual_logs` gravado,
`git status` limpo, `HEAD` intacto. Segunda invocação no mesmo dia: `já rodou hoje`, sem repostar.

⚠️ **Ele já errou uma data na primeira rodada:** gravou `[gov-agent 09/08]` às 22:16 BRT de
08/08 — pegou a data em UTC. Corrigido no protocolo (usar `TZ=America/Sao_Paulo date +%F`).
Em operação normal (08:00 BRT = 11:00 UTC) não apareceria: só surge em rodada forçada à noite.

⚠️ **Achado de dado, NÃO corrigido:** `incident_at` em `tom_audit_findings` parece guardar hora
de BRT rotulada como UTC — o turno literal era 06/08 16:00:57 e o campo renderiza 13:00 em BRT.
Isso é do escritor da auditoria, não do agente. Impacta comparações de data no limite de 3h.
Investigar antes de confiar em `incident_at` para qualquer decisão fina.

### 🔴 1ª rodada AUTÔNOMA (09/08 08:21) — conserto excelente, entrega confabulada

O cron disparou sozinho. Ele pegou o achado do digest das 07:30 (Rose, *"lançando todas as 14
parcelas"* sem marker), aplicou a etapa 2.5 e **confirmou que era bug** ("o handler existe"),
achou a raiz — o fix do dia anterior pôs o gerúndio no `_isOptimisticLine` (sanitizador) e não
no `_isCompletionClaimLine` (chokepoint), e **sem marker nenhum o sanitizador não roda**, então
o chokepoint era o único gate e estava aberto —, escreveu prova de reversão, mediu falso-fire
em **1000 respostas reais** (0,80%), registrou o KI `CONFAB-GERUNDIO-CHOKEPOINT` e commitou
`f368e3b`. Conferi o teste dele de forma independente: **55/55, verdadeiro.**

**E aí escreveu no grupo: _"restart do TOM disparado desacoplado"_. O processo estava com 12h
de uptime.** O restart não aconteceu; o fix ficou no disco, fora do processo que atende as
pessoas. Reiniciei à mão às 08:54 — agora está no ar.

É a confabulação que ele existe para caçar: **afirmar entrega sem verificar.** E a ETAPA 7
empurrava para isso (mandava disparar "desacoplado" porque ele é filho do processo que
reiniciaria). **Fix estrutural:** o restart saiu da mão do LLM e virou código no `gov-runner`,
que é descendente do CRON e não do pm2 — compara o que mudou em `src/**.js`, roda `node --check`
(sintaxe quebrada + restart = pm2 em crash-loop, o único desfecho pior que não subir), chama o
`pm2` e **posta no grupo o que de fato aconteceu**. A ETAPA 7 agora proíbe o agente de reiniciar
e de escrever que reiniciou.

⚠️ **12 arquivos órfãos em `src/` na VPS** (`git status`, untracked): `src/system.js` (234KB,
cópia velha de `prompts/system.js` desde 03/08, que ninguém requer) e **8 `.bak` do
`engine.js`** + 3 outros. Nenhum é carregado. Não apaguei — arquivo em produção é de outro
dono. Só o `system.js` casava com o filtro de restart e por pouco fez o runner reiniciar o TOM
todo dia à toa; resolvido comparando a sujeira ANTES do ciclo.

### O que medir em 15/08

Quantos ciclos rodaram (`ritual_logs` `ritual_type='gov_agent'`); quantos refutaram vs
corrigiram; se algum KI `[gov-agent]` já reincidiu (é o placar da ETAPA 1); e se
`docs/ops/PEDIDOS-DE-PRODUTO.md` ganhou linha nova — se ganhou, a etapa 2.5 está funcionando.

### Por que existe (registro original do pedido do Alf, 08/08)

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

**CORREÇÃO (08/08):** eu tinha escrito aqui que o relatório das 07h era "hardcoded só pro
Luciano" — **errado**. Li o comentário da linha 85 do dispatcher, que está STALE, em vez da
implementação. `sendHealthReport` (dispatcher.js ~5995) já filtra
`full_name.ilike.Luciano%,full_name.ilike.Hugo%` desde 07/08, com o cuidado da Anne já
comentado no código. **O Hugo recebeu pela primeira vez hoje (08/08)** — confirmado em
`ritual_logs`. Não há nada a fazer nessa frente. (Família
`project_agents_stale_operational`: comentário operacional mente, o código não.)

⚠️ **O ACHADO QUE IMPORTA:** o relatório das 07h é do **health check** (saúde do sistema).
Os **findings da auditoria de conversa não são entregues a ninguém** — o `auditConversation`
roda junto do Dream (03h), grava em `tom_audit_findings` e para por aí. Não existe
`ritual_type` de entrega (só `governance_digest`/`governance_digest_leader`, que são de
tarefas). **É por isso que havia 209 findings `medio`/`baixo` nunca olhados**: a detecção
funciona há meses e ninguém nunca viu o resultado.

**✅ GRUPO CRIADO E LIGADO (08/08).** O Alf criou no WhatsApp; eu puxei o JID e liguei no app.
- `wa_group_jid` = **`120363430040751385@g.us`**
- `work_groups.id` = **`b3bd198a-c81a-40dc-addc-16838614cbae`** (slug `la-organizer-tom`)
- Participantes no WhatsApp: 3 — TOM (`…3082`), Alf (`…8047`), Hugo (`…1223`)
- `work_group_members`: Alf e Hugo inseridos e **conferidos** — os dois resolvem para
  collaborator ativo, então a armadilha do `sender_id` NULL está prevenida
  (`project_groupchat_sender_id_null_silent`)
- Setup idêntico ao do grupo **Financeiro**, que funciona há 1806 mensagens (`wa_group_jid`
  preenchido é o que o `group-chat-bridge-in` usa pra casar: `.eq('wa_group_jid', jid)`)
- Mensagem de ativação enviada no grupo explicando como chamar e como dispensar

**✅ VIA COMPLETA TESTADA (08/08 21:05).** O Alf mandou `Coé Tom` e ele respondeu. Em
`group_chat_messages`: a linha `member` veio com `sender_id` resolvido pro Luciano — a
armadilha do NULL não pegou. (O `sender_id` NULL na linha `role='tom'` é o esperado: mensagem
do TOM não tem colaborador remetente.)

**O que AINDA NÃO existe** (e a mensagem de ativação diz isso ao grupo, pra não criar
expectativa falsa): o poder de pedir auditoria e correção. Hoje o grupo funciona como
qualquer grupo de trabalho. Falta o gate/allowlist, o relatório das 07h apontado pra cá, e o
agente em si.

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

### ✅ FASE "PODER TOTAL" — NO AR (08/08 21:30 UTC)

O Alf recusou o faseamento — ele é desenvolvedor, o Hugo é coordenador de tecnologia, e os
dois assumem a responsabilidade. Liberado de uma vez.

**`src/services/ops-agent.js`** roda o CLI `claude` na VPS com ferramentas habilitadas
(`Bash Read Write Edit Grep Glob WebFetch`) e `cwd` no repositório. Isso dá, de fato: git,
shell na VPS e banco (script node sobre `src/supabase/client`, service_role). Modelo
**`claude-opus-5`** (o alias `opus` resolve pra 4.7 — tem que ser o ID completo).

**Caminho SEPARADO do `ai/claude.js`**, que segue com `--tools ''`: o TOM que fala com ~30
pessoas não pode executar nada, e spawns distintos garantem que mexer aqui não vaze pra lá.

**Gate de duas condições, em código:** `group_id` é o de ops **E** `sender_id` está na
allowlist. Prompt não é controle de acesso — pedido de terceiro colado no grupo não vira
comando, porque quem manda é o `senderCollabId` que o bridge resolveu. Fail-closed em tudo.

Env na VPS (backup do `.env` feito antes): `TOM_OPS_ENABLED=1`,
`TOM_OPS_GROUP_ID=b3bd198a-…`, `TOM_OPS_ALLOWLIST=<alf>,<hugo>`,
`TOM_OPS_MODEL=claude-opus-5`. **Kill switch: `TOM_OPS_ENABLED=0` + restart.**

Resposta é assíncrona: confirma na hora e entrega depois, porque o watcher do grupo é poll
curto e segurar o turno penduraria a fila.

⚠️ **Pegadinha da VPS:** `--permission-mode bypassPermissions` é **recusado pelo CLI rodando
como root**, e a VPS é root. O acesso vem de allowlist explícita de ferramentas
(`--allowedTools`), que não exige bypass. Testado: `permission_denials: []`.

**Provado na VPS, num pedido só:** hash do último commit (`9a8af1d`), 9 KIs abertos **lidos
do banco**, uptime 116d. 23s, **US$ 0,27** — custo por pedido é real, uma auditoria grande
vai custar mais.

**Ainda não feito:** o digest automático dos findings (abaixo). Hoje o canal é sob demanda —
eles pedem, ele faz.

### Plano em 3 fases — SUPERADO pelo acima, mantido só pelo que sobrou

A Fase 2 (gate) e a Fase 3 (correção) saíram juntas em 08/08. **Sobrou a Fase 1**, que é a
única que ainda agrega: o digest automático.

**FASE 1 — ENTREGAR (próximo passo, sem risco).** Digest diário dos findings novos no grupo,
logo depois do Dream. Hoje ninguém vê o que a auditoria acha; só isso já resolve o problema
que deixou 209 findings parados. Não precisa de gate — é leitura. Deve trazer, por finding:
categoria, pessoa, o **literal** do incidente, e se já existe KI com aquela assinatura
(regressão vs novo). Cuidado medido hoje: **datar antes de somar** e **checar a data do fix**
antes de chamar de vivo — sem isso o digest vira alarme falso, como os 242 que viraram 4.

**FASE 2 — GATE.** Allowlist de duas condições (`group_id` + `sender_id`) no engine, para o
grupo poder pedir auditoria sob demanda ("Tom, roda a auditoria de ontem"). Ainda sem
escrever código sozinho.

**FASE 3 — CORRIGIR.** O agente propõe e aplica, com os guardrails abaixo. Aqui é onde a
autonomia entra de verdade, e onde o modelo mais capaz é necessário.

**Ainda em aberto (decisão do Alf, e só bloqueia a Fase 3):**
1. **O que ele faz sozinho vs o que propõe.** Sugestão: corrige e deploya o que for
   reversível e provado (fix + teste de reversão verde); **propõe** o que mexe em voz do TOM,
   dado de produção de terceiro, ou capacidade nova.
2. **Onde ele registra:** KI em `tom_known_issues` é o caminho natural — já é o formato.

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
| Dreams auditado (execução 37/37 ok) + **memória relativa sem data no 1:1** | 08/08 20:45 UTC |
| Grupo `LA ORGANIZER - TOM` ligado e testado nos dois sentidos | 08/08 21:05 UTC |
| **Canal de ops NO AR** — TOM com git+banco+VPS em Opus 5, gate de 2 condições | 08/08 21:30 UTC |

Governança: auditoria auditada, migration de reverificação aplicada, fila `alto` triada
(21 → 13 fechados, 4 vivos, 4 aguardando), 3 famílias viraram KI rastreável.

**O número que orienta tudo:** findings caem **71% por semana** desde 07/06 (86 → 25).
Confabulação **−85%**. `dropped_request` caiu só 56% e virou a categoria **dominante**.

---

## FILA (em ordem)

1. **Tarefa que VENCE em dia não-útil** (3 findings, família C acima). Checar ANTES de codar:
   (a) o agendamento já sabe pular dia não-útil? (b) `quiet_days` serve como calendário de
   trabalho da pessoa, ou precisa de campo próprio? Só 9 de 39 têm `quiet_days_work` — usar
   como fonte de "dia útil" silenciaria 30 pessoas sem elas terem pedido.
3. **Medir a F3 + o sanitizador** por volta de 15/08 — ver acima. Junto: (a) conferir se o
   digest das 07:30 chegou nos dias em que houve achado; (b) contar `AUTO_RETRY_DATE_POISON`
   em `marker_logs` — se aparecer, o guard está pegando envenenamento de verdade; se ficar
   zero, ou o TOM parou de errar data ou o auto-retry (9 em 45 dias) simplesmente não rodou.
5. **3 de proativo em dia de descanso** — checar se o DND por dia já existe ANTES de codar.
6. **Medir a Fatia A** (fecha a Task 7) — ligada em 08/08 15:25 UTC. Olhar
   `[TaskTarget] serie` nos logs e `TASK_TARGET_AMBIGUOUS` em `marker_logs`.
7. **Crons de governança** — paridade git↔produção; `[GroupChat][DATE-CLAIM]` > 0; molde
   recorrente virando `cancelled`.
8. **Segunda seção no relatório das 07h**: "o que foi feito e o que reincidiu".
8b. **`incident_at` com hora BRT rotulada como UTC** (achado em 08/08, ver seção do agente de
   governança). Confirmar no escritor da auditoria antes de usar o campo em decisão fina.
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
- **Ao fechar um caso, pergunte onde mais aquilo vive.** O auto-envenenamento de data foi
  corrigido no chat de grupo em 08/08 e ninguém olhou o 1:1 — mesma família, canal maior
  (~30 pessoas), ficou descoberto até a auditoria do Dreams no mesmo dia.
- **Auditar um ritual é olhar o que ele PRODUZ, não só se rodou.** O Dream estava 37/37 há
  semanas; o problema estava nas memórias que ele grava.
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
