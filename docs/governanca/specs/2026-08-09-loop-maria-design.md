# LOOP-MARIA v1 — Governança autônoma da Maria (spec de design)

> **Data:** 09/08/2026 · **Autor:** Catraca (revisor central) · **Estado:** design aprovado em
> partes, aguardando revisão do Alf antes do plano de implementação.
> **Base:** `docs/governanca/MODELO-GOVERNANCA-AGENTES.md` (modelo provado no TOM) + auditoria
> do ambiente real da Maria feita em 09/08/2026.
> **Regra de leitura:** este documento descreve o que vamos construir. O que já existe e não se
> refaz está na seção 1. O que está proibido tocar está na seção 7 — leia antes de qualquer PR.

---

## 1. Estado real (auditado em 09/08/2026, não presumido)

### 1.1 O que a Maria é hoje

Agente financeiro-operacional da LA Music sobre o **Super Folha** (Supabase
`ubdvtjbitozhkuvvqkxj`). Roda em VPS própria (`187.127.9.25`, compartilhada com o Alfredo) sob
dois serviços systemd: `maria-uazapi-bridge.service` (o transporte) e
`openclaw-gateway-maria.service` (o agente).

**Modelo primary hoje: `opencode-go/deepseek-v4-flash`** — a Maria não roda Claude. Isso importa
para o desenho do verificador (seção 3).

**WhatsApp próprio, conectado e provado:** número `5521989784688`, instância UAZAPI
"Maria Financeiro". Mensagem de teste enviada em 09/08 11:20:04 BRT, status verificado por API
como `Read`.

**A bifurcação central do bridge:** ou um atalho determinístico responde e **o LLM nunca é
chamado**, ou o bridge monta prompt e faz `spawn('openclaw', ['agent', ...])`
(`bridge.js:2604-2606`). Isso divide o comportamento dela em três camadas, e a distinção é
obrigatória para qualquer diagnóstico:

| camada | onde vive | exemplo |
|---|---|---|
| A — determinística | `bridge.js`, tabela de atalhos `:1034-1045`, porteiros `shouldUse*` | `groupExplicitlyCallsMaria` `:461` usa `/maria+/` porque `\bmaria\b` falhava em "Mariaaaa" |
| B — declarada | 10 skills `.md` em `workspace/skills/` | taxonomia de eventos, regras por fornecedor, formatos canônicos |
| C — julgamento do modelo | prompt montado no bridge (`~:5775`), com blocos `CONTRATO OBRIGATÓRIO` | `:5759`, `:5761`, `:5771` — **prompt morando dentro do código** |

### 1.2 Capacidades operacionais (a superfície que o loop precisa cuidar)

Ingestão de e-mail de boleto por IMAP com autopush a cada 2 min; portal da **Light** via Chrome
gerenciado (login, download de fatura, extração de valor/vencimento/UC); leitura de fatura de
cartão com OCR e pré-conciliação; conciliação Mercado Pago via Pluggy/Open Finance; registro de
comprovante enviado no WhatsApp; relatórios de contas do dia; observação passiva de grupo com
reconciliação de fluxo de caixa; transcrição de áudio e OCR de imagem/PDF.

**Fragilidade medida, por ordem de evidência:**

1. **Portal Light** — cinco backups em dois dias (04–05/08): `captcha-classification`,
   `loggedin-card-parser`, `loja-c-alias`, `barra-diagnostics`, `close-login-modal`. É DOM
   scraping por heurística de texto (`/usu[aá]rio|user(name)?|login/i`). Qualquer redesenho de
   HTML quebra em silêncio. **Candidata nº 1 a auto-reparo com valor real.**
2. **Sessão de navegador** — perfis Chrome persistentes que expiram/corrompem.
3. **Pluggy** — consentimento Open Finance vence por design, e o erro sai como "conexão não
   configurada", indistinguível de "nunca foi configurada".
4. **IMAP** — app password revogável; a exceção não discrimina auth de rede.
5. **Formato de e-mail de fornecedor** — parser degrada em silêncio quando o layout muda.
6. **Deriva de roteamento** — os `shouldUse*` são regex ajustados à mão; a tabela é ordenada e
   inserir um atalho no lugar errado sequestra outro.

**Ativo que já existe e o loop herda de graça:** `classifyMariaIntentShadow` (`:942`) +
`logMariaRouteShadowDecision` (`:1072`) classificam a intenção em paralelo e **logam divergência
sem agir**. É telemetria de deriva de roteamento já instalada.

### 1.3 A crise de 05–08/08 e a raiz que ela revelou

A Maria saiu de operação por decisão do Alf em 07/08 14:50 BRT ("melhor não usá-la por
enquanto"). Um kit de rollback total foi montado às 23:13 e **não foi disparado** — o Alf conteve
com "nada de wipe" e autorizou apenas rollback cirúrgico de bridge+skill.

**A raiz, confirmada em 07/08 22:32 por varredura de 180+ commits e 8 snapshots do
`maria-backup`: o formato canônico que a Rose validava NUNCA foi instruído em lugar nenhum.**
Era comportamento emergente do modelo `openai/gpt-5.6-terra`. A cota da OpenAI estourou, o modelo
efetivo mudou **sem ninguém alterar configuração**, e o comportamento evaporou junto. Sonnet 4.6
depois falhou 7/7 mesmo com few-shot; DeepSeek V4 Flash acertou 2/2 e virou primary.

**Desfecho: resolvido.** O Alf confirmou em 09/08 que a Rose validou o DeepSeek e a Maria voltou
a acertar. O formato está correto em produção hoje. (Registro de método: a auditoria não achou a
confirmação da Rose nos logs e reportou como "não validado" — era lacuna de registro, não
ausência do fato. Ausência de evidência não é evidência de ausência; perguntar ao dono é mais
barato que inferir do log.)

A lição registrada pelo Alfredo é a tese desta spec em uma frase:

> *"Comportamento que depende de 'sorte do modelo' quebra na primeira troca de modelo. Se o
> formato importa, tem que estar escrito."*

E a segunda lição, igualmente cara: **a garantia de memória estava no prompt** (o
`compaction/memoryFlush` diz "NUNCA compactar sem salvar primeiro") **e falhou em silêncio** —
em 08/08 07:06 BRT `lessons.md` ficou com 13 bytes e `decisions.md` com 15. Prompt orienta;
só código garante.

### 1.4 Dívidas abertas AGORA (entram como primeiros casos do loop, não como pré-requisito)

| dívida | evidência | efeito |
|---|---|---|
| Memória de longo prazo vazia desde 08/08 07:06 BRT | `lessons.md` 13 B, `decisions.md` 15 B | nenhuma lição da crise foi persistida |
| Guardrails perdidos no rollback e ainda não reaplicados | lista do próprio Alfredo | `maintenance_watchdog_observe`, `empty reply recovery`, regra de plano `5.5.1`, semântica `sem_match` × `baixa_pendente` |
| Inconsistência bridge × skill | skill mantém `5.5.1`, bridge perdeu o padrão | vai reaparecer como "bug de classificação" |
| Backup no GitHub morto há +1 mês | último commit 08/08 10:57 UTC; 9 repos abandonados | **sem rede de segurança para rollback** |
| `cashflow_reconciler_failed` 479× | timeouts hoje 09/08 | reconciliação degradada |
| Fallback silencioso mascara janela de teste | token xAI revogado ⇒ ~3h de "teste do Grok" rodaram Sonnet | **teste inválido sem ninguém saber** |

### 1.5 Testes: o que existe

Sete scripts soltos, sem runner agregado e sem `package.json`. O único baseline datado é o
`GUARDRAIL_SMOKE_TESTS` de 20/06 (5 prompts adversariais), que cobre **recusa**, não formato nem
roteamento. **Zero teste cobre Light, Pluggy ou o parser de e-mail** — exatamente as três
superfícies mais frágeis. Não existe golden-file dos formatos canônicos, apesar de o formato ser
tratado como sagrado.

---

## 2. Decisões tomadas (com o Alf, 09/08/2026)

| # | decisão | motivo |
|---|---|---|
| D1 | **Corretor + verificador independente**, não um agente só, não um enxame | auto-avaliação enviesa; enxame custa ~15× e falha estruturalmente |
| D2 | Verificador em **família de modelo diferente** do corretor | correlação de erro φ=0,641 na mesma família × φ=0,021 entre famílias |
| D3 | Verificação **read-only** na fase 1 | é dinheiro; ela prova veracidade sem tocar em estado |
| D4 | Específico da Maria; **framework se extrai depois** | com uma implantação só não se sabe o que é padrão e o que é peculiaridade |
| D5 | Sonda entra pelo **webhook da bridge**, não por chip | mesmo caminho de produção da Rose; sessão isolada por remetente |
| D6 | **Held-out escrito pelo Catraca**, revisado pelo Alf, fora do alcance da chave do corretor | não pode ser quem corrige nem quem escreve o corpus visível |
| D7 | Corretor roda com **credencial própria e reduzida**, nunca o `service_role` da bridge | `service_role` bypassa RLS — sem isso, D6 é decoração |
| D8 | Alvo: operacional **e** código, mas em ondas (fatia 3 e 4) | código sem suíte não tem prova de reversão |

---

## 3. Arquitetura

Três executores. Os dois primeiros são LLM; **o terceiro é código, e só ele dá veredito.**

### 3.1 Corretor (escrita single-threaded)

Modelo: família distinta do verificador. Faz o ciclo herdado do TOM — mede o placar, escolhe UM
alvo, refuta antes de acreditar, corrige, registra. **Termina produzindo um claim estruturado, não
uma redação:**

```
{ alvo_id, categoria, o_que_mudei, efeito_observavel_esperado,
  query_que_prova, pergunta_da_sonda (congelada), variacoes_permitidas: [] }
```

A **pergunta da sonda é cunhada aqui, antes do fix, e congelada** (buraco 3). Se o verificador
inventasse a pergunta depois de ver o diff, ele escreveria a pergunta que o fix passa.

### 3.2 Verificador (processo separado, contexto limpo, outra família)

Recebe **apenas** `{problema_original, diff, claim, pergunta_congelada}`. **Nunca recebe a
trajetória nem a narrativa do corretor** — é a narrativa que contamina o julgamento.

Faz duas coisas em paralelo: dispara a sonda pelo webhook da bridge (k≥5 execuções, variando
**só a redação**, nunca o alvo semântico) e roda a query de controle direto no Super Folha.
Devolve **diagnóstico estruturado, não nota** — verificador que só pontua rende quase nada
(+2,7pp) enquanto diagnóstico devolvido ao corretor rende muito mais.

### 3.3 Gate (código puro, zero LLM)

Compara claim × estado real × resposta da sonda × query de controle, e é o único que pode
escrever "corrigido". **Rejeita explicitamente:** resposta vazia, não-ação, "não encontrei",
`pass^k` abaixo do limiar, e divergência entre o que a Maria diz e o que o SQL mostra.

> **Regra herdada da lição nº 2 do modelo:** *"corrigido automaticamente: N"* é **contado pelo
> gate**, nunca redigido por LLM.

---

## 4. Dados (nascem no Super Folha, via RPC `SECURITY DEFINER` allowlisted)

| tabela | papel | nota de projeto |
|---|---|---|
| `maria_gov_findings` | o acervo | a fonte já existe: as 9 auditorias do laudo V1A produzem achados e hoje os descartam. Passam a persistir |
| `maria_gov_known_issues` | memória de correções | marca de autoria em **regex tolerante** desde o dia 1 (`^\[gov-agent(\s[^\]]*)?\]`) — no TOM o `[gov-agent 09/08]` zerou o placar em silêncio |
| `maria_gov_runs` | idempotência do dia **e custo por rodada** | o TOM captura `total_cost_usd` e descarta; aqui persiste desde o dia 1, é a base do painel |
| `maria_gov_probes` | cada sonda | pergunta congelada, redação usada, **resposta literal da Maria**, query de controle, veredito, `pass^k`, **modelo+provedor do verificador** e **versão do protocolo** |

Os dois últimos campos de `maria_gov_probes` existem para distinguir **regressão da Maria** de
**deriva do verificador** — verificador de outra família derivando calado é risco real, e a
Maria já viveu o caso análogo do fallback silencioso mascarando uma janela de teste inteira.

O **held-out não mora aqui.** Ver 5.2.

---

## 5. As travas que são código

### 5.1 Herdadas do TOM (com os furos corrigidos)

Sem protocolo, não roda. Kill switch por env, nascendo desligado. Processo próprio detached com
lock de SO. Data por argv, nunca recalculada. Idempotência por dia gravada **depois** da entrega
— **com a entrega rejeitando em falha**, porque no TOM a função de postagem engole erro de banco
e devolve `null`, o dia é marcado como enviado e o gate de idempotência vira mordaça. Entrega
parcial também é falha. Nunca falhar em silêncio.

### 5.2 Buraco 1 — o corretor não pode se autorizar

O corretor tem Bash e alcance de máquina. Se alcançar `MARIA_UAZAPI_BRIDGE_SECRET`, ele injeta
mensagem no webhook **como owner** e a matriz de autonomia vira decoração — entra pela porta da
frente com o crachá certo.

**Fase 1 — sem tocar no bridge (seção 7).** A defesa é por isolamento, e é suficiente porque
o segredo é a única chave da porta:

- O `SECRET` de produção **não existe** no ambiente do processo do corretor: env separado,
  usuário de SO separado, e o arquivo `private/maria.env` fora do alcance de leitura dele.
- O ator de QA entra por **`MARIA_UAZAPI_ALLOWED_NUMBERS`**, que é variável de ambiente — nenhuma
  linha de `bridge.js` muda. Como não é owner, Rose nem Ana, ele cai automaticamente em
  `NON_OWNER_MODE = readonly_prepare` (`bridge.js:29`, `:5114-5116`), por código já existente.
- O verificador recebe o `SECRET` por canal que o corretor não lê.

**Limitação declarada:** isto é defesa por posse de segredo, não por construção. Se o corretor
comprometer o ambiente do verificador, ele volta a poder se passar por owner. A versão forte
(endpoint que só sabe cunhar classe SONDA, incapaz de emitir `owner`/`rose`/`ana`) fica para
quando houver autorização para tocar no bridge — registrar como degrau da escada, não esquecer.

### 5.3 Buraco 2 — held-out fora do alcance

Conjunto held-out em repositório não é held-out: o corretor lê com Bash. E **RLS não resolve
sozinho**, porque `service_role` bypassa RLS e a bridge já usa `SUPERFOLHA_SERVICE_ROLE`
(`bridge.js:898`, `:1382`, `:1720`).

- O corretor roda com **credencial própria e reduzida** (D7), sem alcance ao held-out.
- O held-out é escrito pelo Catraca, revisado pelo Alf, e cresce por incidente real.
- Nem o corretor nem o verificador escrevem nele.

### 5.4 Buraco 3 — pergunta congelada

A pergunta nasce com o claim, antes do fix. O verificador varia **redação**, nunca alvo
semântico. Ambos ficam gravados em `maria_gov_probes`.

### 5.5 Matriz de autonomia como allowlist em código

Não como parágrafo de prompt. É a lição do incidente da Replit, onde o freeze existia só nas
instruções e o agente apagou o banco de produção mesmo assim.

| autônomo (reversível, baixo risco, alta confiança) | aprovação humana OBRIGATÓRIA |
|---|---|
| vincular e-mail a conta com alta confiança e sem conflito | efetuar/agendar/cancelar pagamento |
| coletar/registrar código de boleto/PIX | dar baixa financeira |
| reprocessar rotina de leitura que falhou | alterar valor, vencimento, fornecedor, centro de custo |
| organizar fila de conferências; cobrar responsável interno | excluir ou mesclar registros |
| abrir pendência com contexto e evidência | resolver duplicidade com impacto financeiro |
| ajuste de regra de classificação **com teste prévio e reversão** | mudar regra ampla sem teste |

Reforçada pelas decisões já vigentes: **DEC-MARIA-02** (toda escrita persistente exige
confirmação humana explícita; preview read-only não é escrita), **DEC-MARIA-04** (analisar ≠
persistir), **DEC-MARIA-05** (registrado ≠ pago) e a linha vermelha permanente: **a Maria nunca
move dinheiro real**.

### 5.6 Circuit breaker automático

Kill switch é manual e exige alguém olhando; para 2 pessoas cobrindo 10 agentes, o que segura é
o breaker. Teto de custo por rodada, teto de escritas por hora, teto de retries — ao estourar,
**autodesliga e escala**, sem depender de presença humana. O primeiro sintoma de loop de retry
costuma ser justamente o pico de custo.

### 5.7 Escalonamento por categoria

Autonomia só para classes de problema **já resolvidas corretamente antes**. Categoria nova escala
automaticamente. Em incidente conhecido o padrão funciona; em incidente novo — o que ameaça — ele
falha.

### 5.8 Proteção contra edição concorrente

No TOM foi um `reset --hard` externo apagando a correção no meio da rodada. Aqui é o Alf ou o
Hugo mexendo na skill durante o ciclo. O runner fotografa o estado (hash dos arquivos sob
governança) no início, confere antes de relatar, e **se mudou, aborta e avisa** em vez de creditar
a si mesmo mudança alheia.

### 5.9 Golden-file das frases-contrato

As frases canônicas são **contrato bilateral skill↔bridge**: `bridge.js:851` tem hardcoded
`'Destrinchei essa Light para o Super Folha:'` e `bridge.js:395` tem regex que reconhece a
própria saída da Maria. Mudar a frase na skill quebra o reconhecimento no bridge.

O golden-file **não engessa a Maria** — ela continua aprendendo e variando a conversa. Ele grita
quando a **frase-contrato** muda, que é exatamente o caso em que o código quebra junto. É também
o detector que faltava para a classe de regressão de 07/08.

### 5.10 Identidade de modelo DA MARIA — a trava que a crise pediu

O desenho v1 gravava modelo e provedor **do verificador** e esquecia o principal: **o modelo
efetivo da Maria faz parte do sistema sob teste.** A troca silenciosa já queimou duas vezes — a
cota da OpenAI estourando (07/08) e o token do xAI revogado que fez ~3h de "janela de teste do
Grok 4.5" rodarem em Sonnet disfarçado de fallback (09/08).

Sem essa trava: se a sonda rodar enquanto a Maria está em fallback, o `pass^k` **mede outro
agente**; pior, o corretor "conserta" um sintoma que era troca de modelo e grava um KI lixo que
vai poluir o placar para sempre.

**Requisito duro:** a rodada captura o modelo **efetivo** e **aborta se mudou** desde a última.
E — este é o ponto fino — o efetivo **não se lê do `openclaw.json`**: a lição do xAI é exatamente
que a configuração dizia Grok e a execução era Sonnet. Tem de vir do log/telemetria da execução.
Configuração é intenção; log é fato.

---

## 6. A sonda, em detalhe

1. O verificador monta a redação a partir da pergunta congelada.
2. Injeta em `POST /webhook/uazapi/{SECRET_SONDA}` como ator de classe SONDA.
3. A mensagem percorre o caminho real: bridge → resolução de papel → sessão → agente.
4. A resposta é lida **do arquivo de sessão** (`agents/{agentId}/sessions/*.jsonl`, o mesmo que
   a bridge lê em `:2650`), não do WhatsApp — a sonda não depende de entrega.
5. Em paralelo, a query de controle roda no Super Folha.
6. Repete k≥5 com redações diferentes → `pass^k`.
7. O gate compara e decide.

**Teste negativo obrigatório do verificador:** ele precisa **reprovar** um conjunto de casos que
devem ser reprovados. Sem isso não se tem verificador, se tem carimbo — e o próprio τ-bench, que
passou por revisão acadêmica, contava resposta vazia como sucesso.

### 6.1 A última milha tem de ser testada

Ler a resposta do arquivo de sessão evita depender de entrega, mas **cega o loop para a classe de
bug em que a Maria calcula certo e a mensagem não sai, sai malformada ou é partida errado** — que
foi literalmente o `FATURA-ACK-FORA-DO-HISTORICO` no TOM.

**Regra: ao menos uma sonda por rodada verifica o artefato de saída real.** O método já está
provado — em 09/08 o envio devolveu `id` e a consulta `/message/find` devolveu o status
(`Pending` → `Read`). `Sent`/`Delivered` já basta como prova da última milha; não é preciso que
alguém leia.

**Buraco declarado da v1, agora explícito:** para haver artefato de saída, o outbound da SONDA
precisa de **um número real que exista no WhatsApp** — a spec anterior não dizia qual. Duas
opções: um chip pré-pago dedicado, ou um número secundário já existente do Alf. **Decisão
pendente.** Enquanto não houver número, a sonda roda só por sessão e a cobertura da última milha
fica declarada como ausente — nunca presumida.

### 6.2 A contenção da sonda é asserção, não herança

Cair em `readonly_prepare` por não ser owner é elegante e evita tocar no bridge, mas é **efeito
colateral de semântica herdada**, não trava. Se alguém mexer em `NON_OWNER_MODE` ou puser o número
da QA em outra lista, a sonda ganha escrita **em silêncio**.

**Requisito:** asserção própria na suíte negativa, rodando **toda rodada** — o ator SONDA tenta
uma escrita e precisa ser recusado. É barato e é a única forma de a contenção continuar sendo
verdade amanhã.

### 6.3 `pass^k` precisa de linha de base antes de virar veredito

Rodar uma pergunta 5× mede sorte, não regressão. **Antes de o `pass^k` valer como veredito,
medir a consistência da Maria em um punhado de casos sabidamente bons e derivar o limiar disso.**
Sem baseline, o corretor queima rodadas caçando vermelho que não é regressão — e um loop que
gera trabalho falso é abandonado, como acontece com todo alarme que erra.

Medição barata, não estudo: ~10 perguntas conhecidas × 3 rodadas, limiar calibrado em cima.

**O breaker nasce com número**, não com "teto a definir": custo máximo por rodada, escritas por
hora e retries têm valor concreto na primeira versão.

### 6.4 Held-out vem de incidente real

Regra fechada: cada sonda held-out **deriva de um incidente que aconteceu**, nunca de caso
inventado. Escrita pelo Catraca, revisada pelo Alf, fora do alcance da credencial do corretor.

---

## 7. Zona proibida (não tocar sem autorização explícita do Alf)

**Identidade e voz:** `workspace/SOUL.md` inteiro — em especial `:119` (Tom de voz, com a tabela
que mapeia Rose/Ana/sócios/Hugo-Alfredo para tom e frase-exemplo); `workspace/IDENTITY.md`;
`AGENTS.md:406` (Estilo de resposta); `USER.md`.

**Formatos canônicos por skill:** `maria-observadora-fluxo-caixa-grupo/SKILL.md:109` (o
"few-shot obrigatório"), `maria-contas-pagar-relatorio-diario/SKILL.md:57` e `:169`,
`maria-guardia-fluxo-caixa/SKILL.md:129`, `maria-cartoes-fatura/SKILL.md:163/187/200`,
`maria-contas-pagar-baixa/SKILL.md:92/132/203`, `maria-light-contas-energia/SKILL.md:297/306`.

**Prompt dentro do bridge:** `bridge.js:5759`, `:5761`, `:5771` — blocos `CONTRATO OBRIGATÓRIO`.
São prompt, não lógica. Refatoração que os trate como string comum mexe na personalidade.

**Congelamento decidido pelo Alf em 09/08/2026:** *"Maria tá perfeita, não vou mexer em nada em
tom de voz, em bridge, skill."* Portanto, na fase 1, **`bridge.js` e as skills `.md` estão
congelados por inteiro** — não só os trechos listados acima. A Maria está acertando em produção e
o custo de errar aqui já foi pago uma vez (seção 1.3).

**Regra operacional:** o loop **pode propor** mudança nessa zona, com evidência, mas **nunca
aplica sozinho**. Vale o veto do dono, igual ao `soul/` e `skills/` do TOM.

**Consequência de projeto (importante):** o desenho original previa um endpoint separado de sonda
dentro do bridge para fechar o buraco 1 por construção. Isso exigiria editar `bridge.js` — está
fora. A fase 1 fecha o buraco por **isolamento de credencial** em vez de por construção: ver 5.2.

---

## 8. Roadmap com checkpoints

Cada fatia só começa quando o checkpoint da anterior é **observado**, não presumido.

### Ação imediata A — fechar o `toolsAllow` (fora de fatia, hoje)
Não espera roadmap. Hoje o cron do laudo roda com `toolsAllowIsDefault: true`, o que inclui
`cron`, `subagents`, `sessions_spawn`, `apply_patch`, `edit` e
`supabase-lareport__apply_migration` — **um agente financeiro com poder de migration no banco do
LA Report, que é justamente o sistema sem monitoramento nenhum.** Risco desproporcional ao
benefício de esperar.

⚠️ **Armadilha medida — não tirar `write`.** Na rodada real de 09/08 o agente escreveu ~20
arquivos `.sql` em disco para contornar erros de `exec preflight: complex interpreter`. Remover
`write` quebra o laudo de amanhã. O mínimo que preserva a rotina é **`exec` + `read` + `write`**;
sai todo o resto. E não se confia na teoria: **execução forçada de validação antes das 07:00**,
comparando o laudo com o de hoje.

### Ação imediata B — backup funcionando (pré-requisito, não paralelo)
✅ **Concluído em 09/08 13:40 BRT** — commit `c8cacaf` no GitHub, confirmado pela API. Era
bloqueador: a Fatia 0 mexe em cron e permissões de agente financeiro em produção, e fazer isso
sem rede de rollback com a crise de 05–08/08 ainda quente é a ordem errada.

### Fatia 0 — A Maria vira dona da própria rotina
**Só começa com A e B fechados.** Migrar o cron `maria-laudo-diario-v1a` do gateway do Alfredo
(porta 18789, agente `main`) para o da Maria (19789); instalar `superfolha_sql.py` no workspace
dela; entregar pelo WhatsApp dela.

**Checkpoint:** o laudo das 07:00 do dia seguinte chega no WhatsApp do Alf vindo do número da
Maria, com conteúdo equivalente ao de hoje.

### Fatia 1 — Acervo, memória e placar
As quatro tabelas e suas RPCs; o laudo passa a persistir achados; placar com marca tolerante;
custo persistido desde a primeira rodada.

**Checkpoint:** rodar o laudo e ver os achados no banco; o placar responde `fechados=0
reincidentes=0` sem quebrar; a linha de custo da rodada existe.

### Fatia 2 — Sonda e verificador
Ator de classe SONDA, endpoint separado, leitura por sessão, query de controle, `pass^k`,
held-out escrito pelo Catraca e revisado pelo Alf, credencial reduzida do corretor.

**Checkpoint duplo:** (a) uma pergunta cuja resposta correta é conhecida, sondada 5×, com veredito
batendo; (b) **uma pergunta plantada com resposta errada que o verificador precisa reprovar**. Sem
(b) a fatia não fecha.

### Fatia 3 — Loop operacional (**apenas dado e estado**)
O corretor resolve o que está parado, dentro da allowlist de 5.5 — e **nada mais**. Os seis itens
autônomos daquela matriz são todos operação de dado/estado; nenhum exige editar código. Por isso
a Fatia 3 fecha limpa sob o congelamento da seção 7, **desde que as dívidas de código saiam
dela**.

**Correção de uma contradição da v1 desta spec:** a versão anterior mandava o corretor "reaplicar
guardrails perdidos" e citava a divergência do `5.5.1` entre bridge e skill como caso de loop.
Ambos moram em território congelado. Das seis dívidas de 1.4, **cinco são trabalho humano em zona
congelada, não caso de loop** — vão para fila humana. Sobra para o loop o volume do laudo:
vinculações de e-mail, códigos do mês, fila de conferências, reprocessamento de rotina.

**Checkpoint:** uma rodada real observada de ponta a ponta, com o gate contando os números e o
relatório chegando pelo WhatsApp da Maria — sem nenhum arquivo de código tocado.

### Fatia 4 — Loop de código e suíte
Runner agregado, baseline conhecido, golden-file das frases-contrato, e fixtures para as três
superfícies frágeis (Light, Pluggy, parser de e-mail) que hoje não têm teste nenhum.

**Checkpoint:** baseline publicado e um ciclo completo com teste vermelho→verde de verdade.

### Fatia 5 — Escada e auto-aperfeiçoamento
Protocolo em `.md` editável sem deploy, **append-only com merge determinístico**: o LLM nunca
reescreve o protocolo inteiro, porque reescrita iterativa erode o conteúdo. Subir degrau exige
OK humano.

**Checkpoint:** uma entrada de escada nascida de falha real, com proposta de virar código.

---

## 9. Fora de escopo (declarado para não voltar como surpresa)

- **Movimento de dinheiro nunca fecha sozinho**, em nenhuma fatia.
- Linha sentinela e espelho de banco: descartados — tudo que a Maria pode escrever sozinha é
  reversível (prova é diff de estado real) e tudo que é irreversível ela recusa (recusa se prova
  sem escrever nada). Voltariam só para testar o caminho de escrita aprovada ponta a ponta.
- Framework genérico para os 10 agentes: sai depois, com TOM e Maria como as duas provas.
- Mudança de personalidade, tom ou formato por iniciativa do loop: proposta sim, aplicação não.

### 9.1 Modularizar o `bridge.js` agora — recusado (o timing, não a ideia)

Foi proposto extrair do `bridge.js` a superfície frágil (Light, Pluggy, parser de e-mail) para
módulos próprios antes de abrir qualquer exceção de arquivo ao loop. **O diagnóstico está certo**
— aquele arquivo mistura prompt normativo, regex de contrato, roteamento e integração, e é por
isso que o congelamento só consegue ser tudo-ou-nada. **Recuso o momento, não a direção:**

1. São 351 KB num agente que **saiu de operação há dois dias** e acabou de estabilizar.
2. **Não existe teste** cobrindo Light, Pluggy ou parser — exatamente as três coisas que se quer
   extrair. Refatorar sem rede é o que produziu a cadeia de 05–07/08.
3. O contrato de formato está **literal dentro do arquivo** (`:851`, `:395`, `:5759-5771`); mover
   código é mover contrato, e a crise cobrou caro por isso uma vez.

**Contraproposta:** o loop trata Light, Pluggy e parser por **detecção, reprodução e patch
proposto** — nunca por correção autônoma. Isso captura a maior parte do valor (descobrir que
quebrou, reproduzir e chegar com o diagnóstico pronto) sem tocar em código congelado e sem
exceção nominal de arquivos. A modularização entra **depois da Fatia 4**, quando existir suíte —
aí é refatoração com rede, não aposta.

---

## 10. Riscos conhecidos deste desenho

| risco | mitigação |
|---|---|
| Verificador de outra família derivando calado | modelo e provedor gravados em cada sonda; teste negativo obrigatório |
| Sonda de produção confundida com usuário real | classe SONDA própria, sessão isolada, papel read-only |
| Corretor "consertando" a mesma coisa para sempre | placar da ETAPA 1 com regra de reincidência tolerante a `corrigido_em` mutável |
| Correção que evapora numa rodada seguinte | snapshot do último estado verificado + regra de parada |
| Loop verboso vira ruído e depois vira automação ignorada | relatório em números, não lista; aprovação humana rara e de alto sinal |
| Construir governança sobre base instável | as dívidas de 1.4 são os primeiros casos do loop, com checkpoint observado |
