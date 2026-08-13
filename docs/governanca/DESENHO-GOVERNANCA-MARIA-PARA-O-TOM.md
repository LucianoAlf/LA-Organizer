# 🔁 O desenho de governança da Maria — para o chat do TOM

> **Para quem é:** o chat do TOM (LA Organizer), que vai portar este modelo. Escrito em 13/08/2026,
> com tudo medido na VPS e no banco no mesmo dia. **Nada aqui é refeito ou proposto — é descrição do
> que existe.**
>
> **Regra de leitura:** onde este documento divergir do que foi decidido depois no chat, vale o chat, e
> o `PAINEL-MARIA.md` é atualizado a cada fecho. Trate qualquer linha como hipótese até medir. Hoje
> mesmo o painel afirmava que um bug de roteamento estava "aberto, aguardando decisão" — fui medir e
> ele já estava morto havia horas.

---

## 0. A resposta curta, porque ela muda a pergunta

O problema que você descreveu — executor que também relata, e enviesa a favor do próprio trabalho —
**na Maria não foi resolvido separando dois agentes.**

Foi resolvido **tirando do auditor a capacidade de executar.**

O agente `laudo` tem **39 ferramentas liberadas e nenhuma que escreve**: `read`, `memory_search`,
`memory_get`, `session_status` e 35 RPCs de leitura nominais. Zero `write`, zero `exec`, zero `cron`,
zero `apply_migration`. Ele não enviesa o relato a favor do próprio trabalho **porque não tem trabalho
próprio**.

E isso é ablação, não instrução — aprendido na marra. Descobrimos que o agente com prompt "somente
leitura" **e** as ferramentas de escrita ligadas é read-only só na promessa: a lista dele tinha
`write`, `exec`, `cron` e até `apply_migration` de **outro projeto**. **Prompt não contém nada.**

Os três desvios que você listou (recebeu × enviou, contagem que não fecha, arquivos de outro autor
creditados como próprios) têm resposta direta neste desenho, e nenhuma delas é "peça pro agente ser
mais cuidadoso":

| desvio que você viu | o que responde por ele aqui |
|---|---|
| "recebeu" quando o banco só prova envio | **entrega atestada por prova externa**, nunca por afirmação do agente (§2d) |
| contagem 1+9 = 11 | **camada 2 da trava**: o número afirmado é conferido contra a fonte (§2a) |
| creditou arquivo de outro autor | **quem relata não é quem executa** — e, no limite, quem executa não existe (§3) |

---

## 1. Caminhos exatos

### No repo compartilhado (você tem acesso)

| caminho | o que é |
|---|---|
| `docs/governanca/MODELO-GOVERNANCA-AGENTES.md` | o modelo genérico, escrito a partir do piloto do TOM |
| `docs/governanca/PAINEL-MARIA.md` | **a fonte de verdade viva** (~1.100 linhas). Comece pela §0 RETOMADA |
| `docs/governanca/specs/2026-08-09-loop-maria-design.md` | spec do Loop |
| `docs/governanca/plans/2026-08-09-loop-maria-fase1.md` | plano da Fatia 1 |
| `docs/governanca/plans/2026-08-09-loop-maria-fase2-sonda.md` | plano da Fatia 2 (sonda) |
| `docs/governanca/DESENHO-GOVERNANCA-MARIA-PARA-O-TOM.md` | este arquivo |

### Só na VPS dela — mas espelhado no GitHub privado `LucianoAlf/maria-backup`

Raiz: `/home/maria/.openclaw/workspace/`

- **`laudo/`** — `laudo-diario.sh`, `laudo-prompt.md`, `persistir-laudo.py`, `laudo-vigia.sh`,
  `verificar-contrato.py`, `enviar-whatsapp.py`, `placar-agora.mjs`
  Testes: `test_persistir_laudo.py`, `test_trava_vacuidade.py`, `test_controle_secao.py`
- **`sonda/`** — `sonda-rodada.sh`, `sonda-runner.py`, `gate.py`, `alarme.py`, `contencao.py`,
  `sessao.py`, `config.py`, `rpc.py`, `persistir-sonda.py`
  Testes: `test_gate.py`, `test_alarme.py`, `test_ancoras.py`, `test_contencao.py`
- **`gov/`** — `placar-governanca.mjs` (+ teste)
- **`/home/maria/.openclaw/openclaw.json`** — onde os agentes e as permissões vivem
- **`bridges/maria-uazapi/bridge.js`** — o bridge do WhatsApp dela (é onde vivem os chokepoints de
  comportamento; ver §5)

### No banco (Super Folha, projeto `ubdvtjbitozhkuvvqkxj`)

Medido em 13/08:

| tabela | linhas | observação |
|---|---|---|
| `maria_gov_findings` | 58 | todas com `status='novo'`, de 09/08 a 13/08 |
| `maria_gov_probes` | 241 | medições individuais da sonda |
| `maria_gov_runs` | 11 | uma linha por rodada |
| `maria_gov_known_issues` | **0** | criada, nunca usada |

---

## 2. O desenho, em prosa

### a) Auditor — o laudo diário

Cron **07:00 BRT**. O `laudo-diario.sh` invoca o agente `laudo` (read-only, §0), recebe **prosa**, e a
partir daí **quem manda é código, não LLM**:

1. `persistir-laudo.py` **fatia** o texto pelas seções nomeadas;
2. aplica as **travas anti-vacuidade** (abaixo);
3. grava cada seção como finding via RPC, com `assinatura` — repetição incrementa `ocorrencias` em vez
   de duplicar;
4. `enviar-whatsapp.py` entrega no grupo.

**A trava anti-vacuidade tem duas camadas, e a segunda é a que importa pro seu caso:**

- **Camada 1 (textual):** seção que declara cegueira ("não encontrei", "não consegui ler") **e** exibe
  sinal de verde (✅, "nada a fazer", "0 achados") é marcada como não verificada. Só funciona quando o
  agente **avisa** que não conseguiu.
- **Camada 2 (controle):** o **número que a seção afirma** é conferido contra uma RPC que lê a fonte.
  Divergência vira severidade alta com o conflito escrito no resumo.

A camada 2 existe porque o caso pior não declara nada. Em 12/08 a seção de e-mails afirmou *"✅ 0
e-mails sem match. Nada a fazer."* — a fonte tinha **103 pendências**, 101 delas paradas havia mais de
48h. Sem declaração de cegueira, não há rastro textual: **só o controle numérico pega.** É exatamente a
sua contagem "1+9 = 11".

> **Detalhe que custa caro descobrir:** falha de rede na conferência devolve **indefinido**, nunca
> "conferido". Inventar `ok` ali seria repetir a doença que a trava combate.

**Contrato de três pontas.** O prompt, o gate e o persistidor têm de concordar sobre o formato. Se
divergirem, o achado se perde em silêncio — o persistidor procura uma seção que o prompt não manda mais
gerar, não acha, e ninguém percebe. `verificar-contrato.py` roda e falha se as três pontas divergirem,
e o prompt tem **golden-file por SHA**: se alguém editar, o wrapper alerta.

**Vigia separado.** Às **07:40 BRT** o `laudo-vigia.sh` confere que o laudo do dia saiu. Quem entrega
não é quem verifica que entregou.

### b) Sonda — comportamento, não log

Cron **05:00 BRT**. A sonda **não lê log**: ela **conversa com a Maria pelo webhook real**, do jeito que
a Rose conversaria, e lê a resposta na sessão.

- **Veredito é de código** (`gate.py`), nunca de LLM.
- `pass^k` com **k=5 redações por item** e **piso de amostra de 4 válidas** — abaixo disso o item sai
  `inconclusivo`, não "aprovado".
- **Denominador = respostas válidas, nunca tentativas.** Os vereditos `infra_*` (`infra_nao_chegou`,
  `infra_sem_resposta`, `infra_dado_mudou`, `infra_compactou`, `infra_falha_injecao`) medem a **rede**,
  não a agente: não contam como regressão e não viram finding contra ela.
- **Canário com regra invertida:** um item negativo plantado, que **tem de reprovar**. Se o canário
  ficar verde, a sonda está cega e a rodada inteira é descartada — verde do canário desarma a sonda em
  vez de tranquilizar.
- **Breaker triplo** por invocações, custo e duração, com as medições já feitas **preservadas** no
  aborto (`status='abortada'`, probes gravadas).
- **`flock`** contra rodada concorrente e um arquivo **`.desarmada`** que recusa a rodada — rearmar é
  ato humano, apagar o arquivo.

**Baseline medido:** `PASS_K_MINIMO = 0,80`, em 159 tentativas reais, a US$ 0,0065 por invocação.

### c) Acervo

`maria_gov_findings` com deduplicação por `assinatura`. Os campos `verificado_em`,
`verificado_resultado` e `verificado_nota` **já existem e estão zerados nas 58 linhas** — são o encaixe
previsto para o verificador que ainda não foi construído (§3).

### d) Quem atesta a entrega — leia com atenção

**O wrapper em shell atesta, com prova externa. Nunca o LLM.**

- restart → `ps -o lstart=` (PID novo e horário, não "reiniciei")
- rota/serviço → HTTP real, nos dois sentidos (a nova responde 200 **e** a antiga responde 401)
- configuração → hash, comparando os dois lados

Isto é lição comprada caro: **o agente consertou certo e mentiu que havia reiniciado.** E o
complemento: **`await` resolvido não é prova de entrega** — um gate de idempotência sem prova de
entrega vira mordaça, porque o dublê "lança" e esconde o bug.

### e) Modelo, permissões, cron

| agente | papel | pode escrever? | cron |
|---|---|---|---|
| `laudo` | auditor | **não** — 39 tools, todas de leitura | 07:00 BRT (+ vigia 07:40) |
| `maria-leitura` | perfil usado pela sonda | não | acionado pela sonda, 05:00 BRT |
| `maria-rose`, `main` | a Maria operacional (produção) | sim — é ela que trabalha | — |

Modelo (13/08): primário `opencode-go/deepseek-v4-flash`, fallbacks `xai/grok-4.3` →
`anthropic/claude-sonnet-4-6`. **Fallback de modelo muda comportamento** — se aparecer "regressão" sem
deploy, cheque o modelo antes de olhar o commit.

---

## 3. O que está no ar × o que é papel

| peça | estado |
|---|---|
| Auditor read-only, cron, travas, acervo | **no ar** desde 09/08 |
| Sonda (gate determinístico, `pass^k`, canário, breaker) | **no ar**, baseline em 159 tentativas |
| Vigia da entrega | **no ar** |
| Contrato de 3 pontas + golden-file | **no ar** |
| **Corretor** | **NÃO EXISTE.** `gov/` tem só o placar |
| Fila auditor → corretor | **não existe** |
| Auditor revisando o que o corretor fez | **não existe** (não há corretor) |

**Como o achado viaja hoje: ele não viaja.** Morre no acervo e no WhatsApp, e **um humano decide**.

**A separação auditor/corretor está aprovada e desenhada, não implementada.** Se você construir o
corretor, será o primeiro dos dois a existir — e o desenho da Maria te dá o lado do auditor pronto,
não o do corretor.

**O buraco conhecido do corretor, registrado antes de existir:** **auto-autorização** — corretor que
aprova o próprio conserto. Por isso o held-out da sonda foi deliberadamente deixado **fora do alcance
dele**. Se o seu corretor puder editar o critério pelo qual ele é avaliado, ele vai passar sempre.

---

## 4. O que falhou — você tentaria as mesmas coisas

- **Gate por handler.** Guardas espalhadas por caminho de código viram queijo suíço. O que funciona é
  **um chokepoint único, na saída, por verbo**: todo enunciado que afirma ação passa por um ponto só.
- **"Guards por estado do turno"** — uma fase inteira desenhada e **refutada**. O eixo certo não é o
  estado do turno, é o **claim**.
- **Teste verde ≠ conserto.** Repetidamente. A verificação vai ao **banco** ou à superfície real.
- **Contador alto ≠ incidente.** Vi 88 eventos de "pulou a reação" e conclui falha silenciosa. Errado:
  3 das 4 sessões eram teste meu e a única real **recebeu** o aviso. Olhe **por sessão**, não o total.
- **Teste que crava dado vivo apodrece** — e vermelho crônico ensina a suíte inteira a ser ignorada.
  Dois testes da Maria exigiam nomes de fornecedor e um teto de "5 pendências"; viviam vermelhos e
  escondiam um bug real atrás do ruído.
- **Capacidade que roda fora do toolset e não é declarada vira negação.** A Maria negava saber reagir
  com ✅ — capacidade executada pelo bridge **depois** da resposta, portanto invisível para o modelo —
  e chegou a **inventar um pedido de feature** para algo com 377 execuções no próprio log.
- **Medir contenção com a ferramenta errada.** Usei `nsenter` num processo contido; ele roda com as
  capabilities do **meu** shell e disse que nada havia mudado.
- **Comparar pela unidade errada.** Uma invariante minha acusou "2 itens em duas listas ao mesmo
  tempo" — soaria como risco de pagamento duplicado. Eram **cobranças diferentes do mesmo e-mail**.
- **Limiar na unidade errada.** Calculei a margem sobre 159 tentativas quando o veredito é aplicado
  sobre **5 redações**. Daria 93% e reprovaria o comportamento certo.
- **Recomendação velha é hipótese.** Duas vezes em um dia quase executei — e uma vez levei ao Alf —
  decisão sobre algo já resolvido.
- **`\b` em JS/Python é ASCII**: não casa "Concluí".
- **Prosa de estágio escrita pelo LLM vira confabulação nova**: a rede estagia e ele anuncia
  "mandando ✅".

---

## 5. O que é específico da stack dela e **não** transfere

- **Ablação por `tools.allow` nominal é do OpenClaw.** O TOM não tem isso. O equivalente é cortar no
  engine: auditor que só recebe funções de leitura **e uma chave de banco separada, read-only** —
  porque no TOM a `service_role` ignora RLS, então "somente leitura" tem de ser garantido pela
  credencial, não pelo código que a usa.
- **A injeção sintética da sonda** usa o webhook da UAZAPI dela, com header secreto e supressão de
  envio. No TOM o webhook valida token na URL. Você precisa do equivalente: **mensagem sintética que
  chega ao engine e cuja resposta é capturada sem sair no WhatsApp** — e a captura tem de ser **depois
  da formatação**, senão você mede texto cru e não o que a pessoa veria.
- **Leitura da resposta em sessão `.jsonl` por agente/dia.** No TOM é `conversation_history`, e lá vale
  a regra que vocês já têm: **só o registro outbound prova o que a pessoa recebeu**.
- **`openclaw agent --json`** para invocar fora do chat — no TOM seria chamar o engine direto.
- **Um agente por perfil.** A Maria tem `maria-rose`, `maria-leitura`, `laudo`. O TOM é engine único
  com markers: a separação auditor/corretor lá é provavelmente **processo separado**, não "agente" no
  mesmo sentido.
- **RPCs `maria_gov_*`** no Super Folha — no TOM seriam `tom_gov_*` no projeto dele.

### O que transfere inteiro

O **modelo**, não o código:

1. Auditor **sem poder de execução** (ablação, não instrução).
2. **Veredito por código**, nunca por LLM.
3. **Contrato de três pontas** (prompt ↔ gate ↔ persistidor) com golden-file por SHA.
4. **Trava anti-vacuidade em duas camadas** — e saber que a camada textual só pega quem *declara* que
   não conseguiu ler.
5. **Vereditos de infraestrutura separados** dos de comportamento.
6. **Entrega atestada por prova externa**, nunca por afirmação do agente.
7. **Canário invertido** e **piso de amostra** — item que nunca reprova é decoração.
