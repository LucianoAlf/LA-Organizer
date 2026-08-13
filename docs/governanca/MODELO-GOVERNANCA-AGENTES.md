# MODELO DE GOVERNANÇA AUTÔNOMA DE AGENTES

> **O que é isto:** a referência técnica completa do ciclo de governança/auto-reparo construído
> e provado no TOM (07–09/08/2026) — arquitetura, banco, protocolo, travas de código, rodadas
> reais e as lições que custaram caro. **É um documento vivo:** cada implantação nova (Maria,
> LA Report, os demais) alimenta as seções 8 e 9 com evidências e regressões. Futuramente migra
> para o segundo cérebro (LAHQ), onde os próprios agentes registram seus aprendizados.
>
> **Para quem:** quem for implantar este modelo num agente novo. Não começa do zero — começa daqui.
>
> **Estado:** v1, 09/08/2026 · Piloto no TOM **em produção** (3 rodadas reais, 2 correções de
> código entregues, 47 achados antigos varridos) · Próximo alvo: **Maria** (financeiro).

---

## 1. O problema

A LA Music opera **9 agentes** com **2 pessoas** (Alf + Hugo) para manter tudo. Sem governança:

- Bug só aparece quando produção reclama ("mudou o número", "KPI errado", "aluno duplicado").
- Auditoria que só **alerta** vira lista de tarefas para humano — no TOM, 209 achados ficaram
  meses sem ninguém olhar; na Maria, o laudo V1A já nasce pedindo trabalho manual.
- Cada correção manual exige reconstruir contexto do zero: qual era a fala real? já foi
  corrigido? é regressão?

**A tese do modelo:** cada sistema tem seu próprio agente de governança que roda diariamente e
fecha o ciclo sozinho — **detecta → refuta → corrige → prova → registra → relata** — parando
apenas em decisão de negócio. O humano sai do caminho crítico da manutenção e vira revisor.

**Prova de que funciona (TOM, 48h de operação):**

| rodada | resultado |
|---|---|
| 08/08 22:17 (forçada) | Refutou um falso-positivo com varredura de 467 mensagens. **Não mexeu em código — desfecho certo.** |
| 09/08 08:21 (1ª autônoma, via cron) | Achou raiz real (`CONFAB-GERUNDIO-CHOKEPOINT`), teste vermelho→verde, falso-fire medido em 1000 respostas reais (0,80%), commit em produção. |
| 09/08 10:14 (forçada, teto novo) | 2ª correção de raiz (`FATURA-ACK-FORA-DO-HISTORICO`, 12 pontos de saída), varredura **206→159 achados** (47 fechados com prova, 0 de severidade alta tocados), achou 1 bug no próprio placar, sobreviveu a um `reset --hard` externo no meio da rodada e **me corrigiu** numa nota errada de ambiente. |

---

## 2. O modelo numa página

```
                         ┌────────────────────────────────────────────┐
                         │  AUDITORIA (produz o ACERVO)               │
                         │  LLM auditor lê as conversas/operações do  │
                         │  dia e grava achados tipados no banco      │
                         └───────────────────┬────────────────────────┘
                                             ▼
   ┌──────────────┐      ┌────────────────────────────────────────────┐
   │ TRIAGEM      │      │  ACERVO (tom_audit_findings)               │
   │ automática   │─────▶│  category · severity · literal · status ·  │
   │ (regressão?) │      │  auto_triage · verified_*                  │
   └──────────────┘      └───────────────────┬────────────────────────┘
                                             ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  DIGEST diário (determinístico, SQL+template, SEM LLM)          │
   │  → mostra os achados ao humano ANTES do agente agir             │
   └───────────────────┬─────────────────────────────────────────────┘
                       ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  CICLO DE GOVERNANÇA (diário, processo próprio, LLM com tools)  │
   │  ETAPA 1  Placar: dos KIs que EU fechei, quantos voltaram?      │
   │  ETAPA 2  1 CORREÇÃO por rodada; refutação SEM teto             │
   │  ETAPA 2.5 Bug ou pedido de feature? (feature → fila, não faz)  │
   │  ETAPA 3  REFUTAR antes de acreditar (grep, literal, datar)     │
   │  ETAPA 4  Prova de reversão (teste VERMELHO com a entrada real) │
   │  ETAPA 5  Menor fix; suíte inteira no baseline                  │
   │  ETAPA 6  Registrar KI com marca de autoria                     │
   │  ETAPA 7  Relatar no canal; A ENTREGA (restart) é do CÓDIGO     │
   │  ETAPA 8  Atualizar a escada (auto-aperfeiçoamento)             │
   └───────────────────┬─────────────────────────────────────────────┘
                       ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  ENTREGA: canal do PRÓPRIO agente (WhatsApp), formatada,        │
   │  idempotente, nunca em silêncio. Restart/deploy: determinístico │
   └─────────────────────────────────────────────────────────────────┘
```

**Princípios que não se negociam** (cada um tem cicatriz na seção 9):

1. **Só corrige o que reproduzir** — teste vermelho antes, verde depois. Refutar é entrega.
2. **A entrega nunca fica com o LLM** — "reiniciei", "corrigi", "enviei" são afirmações que o
   CÓDIGO verifica e relata; o LLM confabula entrega.
3. **Autonomia com raio definido em código** — diretórios permitidos, ações proibidas,
   kill switch por env, tudo fora do prompt.
4. **Comportamento em `.md` editável sem deploy** — o protocolo é dado, não código.
5. **Nunca falhar em silêncio** — toda saída (sucesso, refutação, timeout, crash) vira mensagem.
6. **Idempotente por dia** — cron bate a cada 5 min numa janela; roda uma vez.

---

## 3. Arquitetura de referência (implantação no TOM)

### 3.1 Linha do tempo diária

| hora (BRT) | o quê | componente |
|---|---|---|
| 03:00 | Auditoria de conversa (LLM lê o dia, grava achados) | `src/services/conversation-audit.js`, acoplada ao Dream |
| 05:00 | Health-check + triagem automática (`auto_triage`: regressão × novo × suprimido) | `src/rituals/health-check.js` |
| 07:00 | Relatório de saúde aos diretores | dispatcher |
| 07:30 | **Digest de achados no grupo de ops** — determinístico, sem LLM | `src/services/ops-digest.js` |
| 08:00 | **Ciclo de governança** (janela de retry até 12h) | `src/rituals/gov-runner.js` → `src/services/governance-agent.js` |

Racional da ordem: o humano vê o digest **antes** de o agente agir; a triagem das 05h garante
que o ciclo das 08h já sabe o que é regressão.

### 3.2 Componentes de código (arquivo → responsabilidade)

| arquivo | responsabilidade |
|---|---|
| `src/services/conversation-audit.js` | Auditor LLM. Categorias tipadas (`confabulation`, `dropped_request`, `frustration`, `wrong_refusal`, `media_fail`, `proactive_overreach`). Grava em `tom_audit_findings`. |
| `src/prompts/conversation-audit-prompt.js` | Prompt do auditor — inclusive a regra "emita `proactive_overreach` MESMO que o TOM peça desculpa depois" (o envio indevido já ocorreu). |
| `src/services/ops-digest.js` | Digest 07:30. SQL + template, **sem LLM** — alarme diário que erra contagem uma vez deixa de ser lido. Idempotente via `ritual_logs`. |
| `src/services/ops-agent.js` | Spawn do CLI `claude` com ferramentas (Bash/Read/Write/Edit/Grep/Glob), cwd no repositório em produção, HOME isolado com OAuth próprio. Gate de acesso por **duas condições no código** (grupo E allowlist de remetente). `briefing`/`timeoutMs` injetáveis. Rastreio de pedidos em andamento + drain hook (avisa o grupo se um restart matar um pedido no meio). |
| `src/services/governance-agent.js` | O ciclo: idempotência do dia, placar (ETAPA 1), acervo, montagem do pedido, "sem protocolo → NÃO roda". |
| `src/rituals/gov-runner.js` | Processo PRÓPRIO (detached do dispatcher), lock `flock -n`, ymd por argv, log em `logs/gov-agent.log`, e o **restart determinístico** (seção 5.4). |
| `src/rituals/dispatcher.js` (gancho) | Só DISPARA o runner e volta — nunca espera (seção 5.3). |
| `src/lib/placar-governanca.js` | Função pura da ETAPA 1: dos KIs com marca `[gov-agent]`, quantos voltaram; famílias com 2 reincidências entram em PARADA. |
| `src/utils/wa-format.js` | Sanitizador markdown→WhatsApp + split de mensagens longas (limite ~1200 chars, nunca trunca). |
| `docs/ops/PROTOCOLO-GOVERNANCA.md` | **O comportamento do agente.** Lido a cada rodada; editar muda o agente na hora, sem deploy. |
| `docs/ops/ESCADA-GOVERNANCA.md` | Auto-aperfeiçoamento: o agente lê no início e ESCREVE no fim quando uma etapa falha. Subir de degrau exige OK humano. |
| `docs/ops/PEDIDOS-DE-PRODUTO.md` | Fila do que é FEATURE, não bug (ETAPA 2.5) — visibiliza demanda que morria dentro dos achados. |
| `docs/ops/FORMATO-GRUPO.md` | Regras de entrega no WhatsApp (estrutura, emoji por gravidade, teto de linhas). |

**Por que os `.md` ficam FORA de `skills/`:** `skills/` alimenta o prompt do agente-fim (o TOM
que fala com o time). Instrução de engenharia não pode vazar para lá. Verificado: o loader
carrega skill por **nome explícito** (não varre diretório), então nada em `docs/` é carregável
por acidente.

### 3.3 Envs (kill switches e tuning)

```
TOM_GOV_AGENT=1          # kill switch do ciclo (0 desliga no próximo tick, sem restart)
TOM_GOV_TIMEOUT_MS=1800000   # teto do ciclo (30 min — refutar+reproduzir+corrigir+suíte)
TOM_GOV_JANELA_DIAS=2    # janela de "sinal fresco" preferido para a correção
TOM_OPS_ENABLED=1        # kill switch do canal de ops sob demanda
TOM_OPS_GROUP_ID=...     # grupo de entrega (o canal de engenharia)
TOM_OPS_ALLOWLIST=...    # quem pode COMANDAR o agente (ids, não telefone)
TOM_OPS_MODEL=claude-opus-5  # governança usa o modelo mais capaz; o agente-fim continua no dele
```

---

## 4. Banco de dados (schemas reais)

### 4.1 `tom_audit_findings` — o ACERVO

```
id uuid · collaborator_id uuid · category text · severity text ('alto'|'medio'|'baixo')
summary text            -- resumo do auditor. NUNCA é a fala literal (ver lição 9.6)
evidence text           -- trecho com timestamps
occurred_at / incident_at timestamptz  -- usar incident_at (quando o problema ACONTECEU)
signature text · occurrences int · first_seen / last_seen timestamptz
status text             -- 'novo'|'confirmado'|... fechados: 'resolvido','falso_positivo','wontfix','corrigido','descartado'
promoted_code text      -- elo com tom_known_issues.codigo quando promovido a KI
auto_triage jsonb       -- {decision:'regression'|'keep'|'suppress', decided_at, matched_code, match_confidence}
verified_at timestamptz · verified_result text · verified_note text  -- veredito do agente, com método
```

### 4.2 `tom_known_issues` — os KIs (memória de correções)

```
id uuid · codigo text (ex.: FATURA-ACK-FORA-DO-HISTORICO) · titulo · area · severidade · status
causa_raiz text · fix_resumo text   -- ⚠️ fix_resumo COMEÇA com a marca de autoria do agente
sinal_tipo text ('marker_log'|'manual' — CHECK constraint!) · sinal_padrao text
colaboradores_afetados uuid[] · primeira_vez/ultima_vez timestamptz · ocorrencias int
corrigido_em timestamptz            -- ⚠️ MUTÁVEL: reconserto sobrescreve (ver lição 9.3)
```

### 4.3 `ritual_logs` — idempotência de tudo que é diário

```
collaborator_id uuid · ritual_type text ('gov_agent'|'ops_digest'|...) · reference_date date
status text · sent_at timestamptz · detail text   -- ex.: "fechados=0 reincidentes=0 parada=0 acervo=206 custo=0.8123"
```

Regra: **grava só com a entrega CONFIRMADA** — quem posta devolve comprovante
(`src/lib/entrega.js`); resposta falsy ou exceção conta como não entregue, e o próximo tick da
janela retenta. Não basta o `await` ter resolvido: era exatamente assim que o dia fechava sem o
relatório ter chegado a ninguém (lição 9.15).

Exceção deliberada: "protocolo ausente" grava mesmo sem o ciclo ter rodado, senão o grupo leva
~48 avisos iguais de um problema que não se resolve sozinho. Mas a exceção é sobre o ciclo, não
sobre a entrega: o **aviso** ainda precisa ter chegado, senão ninguém fica sabendo que o agente
está parado.

### 4.4 Fontes de verdade que o agente consulta

- `conversation_history` — a fala LITERAL das pessoas (resumo de achado ≠ fala).
- `marker_logs` — o que o agente-fim tentou executar e com que resultado
  (`marker_type, result, reason, raw_excerpt`). **O estado final esconde a falha; quem conta a
  verdade é o marker DO TURNO.**
- `group_chat_messages` — o canal de entrega (e a prova de que a mensagem saiu).

---

## 5. As travas que são CÓDIGO (não prompt)

Esta seção é o coração do modelo. Prompt orienta; **trava garante**.

### 5.1 Gate de acesso (quem comanda o agente)

Duas condições no código, nunca no prompt: mensagem veio do **grupo de ops** E o remetente
resolvido está na **allowlist**. Só "é membro do grupo" não basta (quem for adicionado herdaria
a VPS); só "está na lista" não basta (daria poder de engenharia no 1:1). Fail-closed em tudo.

### 5.2 Sem protocolo → NÃO roda

Se o `.md` do protocolo não for encontrado, o ciclo **aborta e avisa** ("é problema de deploy").
Sem isso, o briefing cairia no genérico e um agente com Bash em produção rodaria **sem nenhuma
etapa** — respondendo normalmente, falha invisível.

### 5.3 Processo próprio (a armadilha do dispatcher)

O cron roda o dispatcher sob `flock -n` a cada 5 min e o processo termina em `process.exit(0)`.
Consequência dupla: com `await`, um ciclo de 30 min prende o lock e **pula ~6 ticks de tudo**
(lembretes, rituais); sem `await`, o `exit(0)` mata o `.then()` que postaria o resultado —
silêncio. Solução: o tick só **dispara** `gov-runner.js` detached (lock próprio `flock -n
/tmp/la-gov.lock`, env herdado, `--ymd` por argv para não haver segundo cálculo de data) e sai.

### 5.4 Restart determinístico (a entrega não é do LLM)

`decidirRestart()` no runner: compara o que mudou desde o início da rodada, conta **só `.js`
sob `src/`** (doc/teste não mudam o que roda; `skills/`/`soul/` é violação, não deploy),
desconta a **sujeira pré-existente** do `git status` (a VPS tinha órfãos untracked que fariam
restart diário à toa), roda `node --check` antes (sintaxe quebrada + restart = crash-loop, o
único desfecho pior que o fix não subir) e então chama `pm2 restart` — **depois** do relatório
postado — e posta o que de fato aconteceu. O protocolo **proíbe** o agente de reiniciar e de
escrever que reiniciou.

### 5.5 Placar como função pura + marca de autoria

`fix_resumo LIKE '[gov-agent]%'` filtra o que É do agente — sem a marca ele mede o trabalho
dos humanos como se fosse dele. Duas sutilezas que já quebraram (lições 9.3 e 9.4):
`corrigido_em` é mutável (reconserto apaga a reincidência que o motivou — a regra compara
também `auto_triage.decided_at` vs `corrigido_em`); e a marca precisa ser **regex tolerante**
(`^\[gov-agent(\s[^\]]*)?\]`) porque o LLM escreve `[gov-agent 09/08]`.

### 5.6 Teto separado: 1 correção / refutação sem limite

O limite real é **banda de revisão de código humano** ("ninguém revisa cinco mudanças de
engine por dia"). Refutar não muda código → sem teto, dos mais ANTIGOS pros novos, cada um com
a ETAPA 3 completa. **Severidade `alto` fica FORA da varredura em massa** — se um alto merece
fechar, vira a correção da rodada, com relatório próprio. O pedido do ciclo carrega o tamanho
do acervo (`carregarAcervo()`: total/altos/2d/+30d) — sem o número na frente, o agente não
sabe que o acervo existe.

### 5.7 Entrega formatada e nunca silenciosa

Sanitizador markdown→WhatsApp (só existem `*negrito*`, `_itálico_`, `~riscado~`, `` ` ``;
markdown chega literal), split por parágrafo (~1200 chars), typing sustentado durante trabalho
longo (o `composing` do WhatsApp expira em ~25s), drain hook que avisa o grupo se um restart
matar um pedido no meio, e relatório de varredura em **números**, não lista.

O drain hook só serve no processo que **instala handler de sinal e configura o canal**. O
runner do ciclo é processo próprio: sem as duas pontas ligadas, o hook nasce órfão e um
`pm2 restart` no meio de 30 min de trabalho morre calado (`instalarAvisoDeInterrupcao`).

### 5.8 Entrega confirmada é catraca do log de idempotência

O gate que impede mensagem duplicada é o mesmo que impede o retry. Se ele fechar o dia sem a
mensagem ter saído, deixa de proteger e passa a **silenciar** — falha fechada, invisível,
exatamente onde o modelo inteiro depende de alguém ser avisado.

A trava: o envio devolve comprovante e o log só grava com ele na mão (`entregar()` em
`src/lib/entrega.js`). Vale para o ciclo (08:00) e para o digest (07:30), que tinham o mesmo
defeito. Entrega em partes conta como falha **parcial**: perder a parte 2 de 4 e seguir
postando 3 e 4 deixa no grupo um relatório furado que ninguém detecta lendo, então o envio para
no primeiro erro e diz quantas partes chegaram.

**Regra para replicar:** todo par "faz o trabalho → marca como feito" precisa que o passo do
meio devolva prova. `await` que resolveu não é prova.

---

## 6. O protocolo (as etapas e o porquê de cada uma)

O texto integral vive em `docs/ops/PROTOCOLO-GOVERNANCA.md` (editável sem deploy). Resumo com
a justificativa de origem:

| etapa | regra | por quê (caso real) |
|---|---|---|
| 1 | **Placar primeiro**: dos KIs que EU fechei, quantos voltaram? 2 reincidências = família em PARADA, leva raiz ao grupo | 391 KIs corrigidos e o sistema seguia instável (27/07). Sem medir a si mesmo, o agente conserta a mesma coisa pra sempre |
| 2 | 1 correção; refutação sem teto; alto fora da massa | seção 5.6 |
| 2.5 | **Bug ou pedido de feature?** Critério verificável: existe handler/marker para essa capacidade? Não existe → NÃO implementa, registra em PEDIDOS-DE-PRODUTO e avisa | Feature freeze. Os achados misturam 3 naturezas (casos Rose: "não consigo executar" = bug; "organiza melhor pf" = feature; "injeção não persiste" = limitação que SOA como bug). Na dúvida → feature e pergunta |
| 3 | **Refutar antes de acreditar**: grep o caso no src/ → puxar o LITERAL → datar o fix vs o incidente → rodar contra o código atual | Em 08/08, 4 alvos seguidos JÁ tinham conserto — em 3, o comentário citava o caso pelo nome |
| 4 | **Prova de reversão** com a ENTRADA REAL DO TURNO (não o pedido original da conversa). Sem teste vermelho → não corrige | 8 tentativas em branco alimentando o áudio completo; a entrada real era só "O q?" |
| 5 | Menor fix; suíte inteira no baseline (`node --test src/` → `fail 3`); **commitar ANTES da varredura**; re-rodar a suíte antes de relatar | Deploy externo rodou `reset --hard` no meio da rodada e apagou a correção do disco (09/08) — só o teste untracked denunciou |
| 6 | KI com causa-raiz, números antes/depois e marca `[gov-agent ...]` no início do `fix_resumo` | Sem a marca, a ETAPA 1 não existe |
| 7 | Relatar; **não reiniciar nem dizer que reiniciou** (o runner faz e relata) | O restart fantasma (lição 9.2) |
| 8 | Etapa falhou repetido? Registrar na ESCADA com caso e proposta de virar código | Fechou o loop: as 2 primeiras entradas da escada viraram regra de protocolo em <24h |

**Limites (para e escala):** decisão de negócio · fora de `src/` (PWA, migration, infra) ·
apagar dado de produção (SEMPRE OK explícito) · `soul/`/`skills/` (voz do agente-fim, veto do
dono) · suíte fora do baseline · família em parada · não reproduziu.

**A escada:** degrau 1 = LLM executa tudo guiado pelo protocolo (atual) → degrau 2 = etapas
que erram ≥3× no mesmo padrão viram código → degrau 3 = pipeline determinístico, LLM só onde
exige julgamento. Subida é aprovada por humano — é mudança no próprio agente.

---

## 7. Custo e modelo

- Ciclo diário: 1 spawn de **Opus 5** com teto de 30 min (`--output-format json` devolve
  `total_cost_usd` por rodada — base do futuro painel de custos).
- **Onde esse número fica** (09/08): `ritual_logs.detail`, sufixo ` custo=<usd>`. Não virou
  coluna (a tabela é de idempotência: nasceria NULL em todo o resto) nem tabela própria
  (`agent_run_costs` é o alvo quando o painel existir de fato — até lá seria feature sob o
  freeze). O histórico é backfillável a partir da string:
  `substring(detail from 'custo=([0-9.]+)')::numeric`.
  O canal de ops **interativo** não tem linha em `ritual_logs` (pedido sob demanda não tem
  `reference_date`), então o custo dele fica no log com o mesmo dialeto: `grep 'custo=' nos
  logs + a coluna cobrem os dois. Ausência do campo ≠ rodada de graça: sem número o sufixo
  não entra, e zero é gravado como `custo=0`.
- Digest 07:30: **zero LLM** (SQL + template).
- Auditoria 03h: já existia (acoplada ao Dream).
- O agente-fim (TOM) continua no modelo dele (Sonnet); governança não muda isso.

---

## 8. Evidência de produção (histórico das rodadas)

> **Como alimentar:** cada rodada relevante de QUALQUER implantação entra aqui com data,
> sistema, o que fez e o que ensinou. É o material que daqui a meses vira o playbook do LAHQ.

### 08/08 22:17 — TOM, rodada forçada (validação)
Refutou `frustration` do Quintela como falso-positivo varrendo os 467 inbounds dele; escalou ao
grupo a única parte que era julgamento ("TOM aceitou culpa que o histórico não sustenta — é
voz/prompt, fora da minha alçada"). Zero código mudado. `git status` limpo verificado.

### 09/08 08:21 — TOM, 1ª rodada 100% autônoma (cron)
`CONFAB-GERUNDIO-CHOKEPOINT` (Rose): "lançando todas as 14 parcelas!" sem marker. Raiz fina: o
fix do dia anterior pôs o gerúndio no sanitizador mas não no chokepoint, e **sem marker nenhum
o sanitizador nem roda** — o único gate do caminho estava aberto. Teste 2/2 vermelho→verde,
falso-fire medido em **1000 respostas reais** (0,80%), suíte no baseline, KI registrado, commit
`f368e3b`. **Falha da rodada:** relatou "restart disparado desacoplado" — e o processo tinha
12h de uptime. Conserto excelente, entrega confabulada → virou a trava 5.4 no mesmo dia.

### 09/08 10:14 — TOM, rodada com o teto novo (observada)
- **Correção:** `FATURA-ACK-FORA-DO-HISTORICO` — interceptors de fatura enviavam via
  `sendMessage` e nunca gravavam em `conversation_history`; o TOM "esquecia" que lançou (a
  Rose cobrava) e a auditoria abria pedido-ignorado fantasma do mesmo buraco. 12 pontos de
  saída pareados, 3/3 vermelho→verde, commit `9a4dffd`.
- **Varredura:** 206→159 abertos. 47 fechados (46 "já corrigido", 1 falso-positivo), 10 deles
  **provados por execução** da fala real contra o código de hoje. **0 de severidade alta
  tocados** (trava segurou). Deixou 8 abertos de propósito, nomeando o pior caso não coberto.
- **Auto-diagnóstico:** achou o bug da marca do placar (zerado com 2 consertos no banco) e
  reportou; sobreviveu a um `reset --hard` externo que apagou sua correção no meio da rodada
  (o teste untracked denunciou ao re-rodar a suíte); registrou as duas falhas na ESCADA com
  proposta — ambas viraram protocolo/código em seguida.
- **Verificação independente (Catraca):** conversa real da Fabi (20/06) puxada, literais
  rodados na função citada: `"sim"→yes`, `"essas ok, pode dar concluido"→yes`, controles
  negativos → `null`. Suíte na VPS: 2487 testes, `fail 3` (baseline). Restart determinístico
  disparou e relatou sozinho.

---

## 9. As lições (cicatrizes — cada uma custou horas ou um incidente)

1. **Refutar antes de acreditar.** 4 alvos seguidos já tinham conserto no código; um agente sem
   essa trava teria feito 4 mudanças inúteis no engine em produção.
2. **A entrega NUNCA fica com o LLM.** Ele consertou de verdade e escreveu "restart disparado"
   com o processo em 12h de uptime. "Corrigido/reiniciado/enviado" é o código quem afirma,
   depois de verificar. (Para financeiro: "corrigido automaticamente: 14 e-mails" tem que ser
   CONTADO por código, nunca redigido pelo LLM.)
3. **Campo de data mutável apaga história.** `corrigido_em` é sobrescrito no reconserto — a
   reincidência que motivou o reconserto some e a trava de parada morre calada. Comparar também
   contra a data da TRIAGEM.
4. **Marca de autoria é contrato com o lado frágil no LLM.** Ele escreveu `[gov-agent 09/08]`
   e o filtro exigia `[gov-agent]` colado → placar zerado em silêncio. Regex tolerante.
5. **Chokepoint só cobre o que ele checa.** O gate compartilhado de silêncio (66 call sites,
   "impossível esquecer o gate") não lia o DND — 7 de 8 arquivos nunca checavam. Ponto único
   sem a fonte certa é lacuna invisível.
6. **Resumo de achado ≠ fala literal.** O resumo dizia "TOM disse que lançou e não lançou"; o
   literal mostrou que a fatura FOI lançada — o defeito era outro (histórico). Sempre puxar
   `conversation_history`.
7. **Reproduzir com a entrada real do turno.** 8 tentativas em branco com o pedido original; a
   entrada do turno era "O q?".
8. **O estado final esconde a falha.** Dado existir no banco não prova que o caminho funcionou —
   o marker DO TURNO conta a verdade (`rejected` nas 2 primeiras tentativas, executado na 3ª).
9. **Contagem é hipótese até abrir o literal.** 242→4, 18→5, 6→1 no mesmo dia.
10. **Trabalho longo × deploy concorrente: commitar ANTES.** `reset --hard` externo apagou a
    correção testada no meio da varredura; só o teste untracked sobreviveu e denunciou.
    Corolário: re-rodar a suíte imediatamente antes de relatar.
11. **Timestamps em dois fusos, duas vezes.** Data do sistema em UTC virou `[gov-agent 09/08]`
    às 22h de 08/08; `timestamptz` lido cru virou "16h00" para um turno de 13:00 BRT. Regra:
    `TZ=America/Sao_Paulo date +%F` para "hoje" e `at time zone 'America/Sao_Paulo'` ao citar
    hora do banco.
12. **Ambiente engana até quem construiu.** Flags via `--env-file` não aparecem em
    `/proc/<pid>/environ` nem no `pm2 jlist` (2 falso-negativos); `pm2 uptime` arredonda —
    prova de restart é `ps -o lstart=`; glob `src/**` no `--test` não roda em Node 20.
13. **Processo filho morre com o pai, e o `.then()` junto.** Pedido do Alf sumiu em silêncio
    num `pm2 restart`. Daí: drain hook que avisa, e trabalho longo em processo detached.
14. **O agente pode estar certo e o revisor errado.** Ele registrou que `node --test src/`
    funciona; minha nota dizia falso-vermelho; medi lado a lado — idênticos. Corrigi a MINHA
    nota. Verificação independente vale nos dois sentidos.
15. **Gate de idempotência sem prova de entrega vira mordaça.** O invariante "posta primeiro,
    grava o log depois" estava no código, no doc e no teste — e era falso em produção: o
    `postar` real devolvia `null` em falha de insert em vez de lançar, o `await` resolvia, o dia
    fechava `sent` e o retry ficava bloqueado. Relatório nenhum, aviso nenhum, log nenhum. O
    teste passava porque injetava um `postar` que **lança** — validava um contrato que a
    implementação real não cumpria. Regras: **o dublê tem que falhar do jeito que a produção
    falha**, e "não sei se entregou" conta como não entregou (custo de errar pra um lado: uma
    mensagem repetida; pro outro: o dia inteiro em silêncio).
16. **Doc de incidente envelhece como instrução.** O registro da falha do glob no `--test`
    continuou dizendo "o protocolo manda `src/**/*.test.js`" depois de o protocolo já ter sido
    corrigido — e os dois arquivos vão no MESMO system prompt todo dia. Registro histórico ao
    lado de instrução viva precisa dizer, no próprio texto, que é histórico.

---

## 10. Checklist de replicação (implantar num sistema novo)

Pré-requisitos no sistema-alvo — **sem eles o modelo não fecha**:

- [ ] **Acervo**: tabela de achados de auditoria (equivalente de `tom_audit_findings`), com
      categoria, severidade, literal/evidência, `incident_at`, status e campo de veredito.
- [ ] **KIs**: tabela de correções conhecidas (equivalente de `tom_known_issues`) com `codigo`,
      `corrigido_em` e `fix_resumo` (onde vive a marca de autoria).
- [ ] **Fonte de verdade**: onde está a fala/operação LITERAL para refutar (conversas, logs de
      transação, audit_log).
- [ ] **Suíte de testes** com baseline conhecido. Sem suíte não há prova de reversão — o ciclo
      para na ETAPA 4 e o agente vira só refutador (ainda útil, mas não é auto-reparo).
- [ ] **Canal próprio de entrega** conectado e provado (mensagem de teste real).
- [ ] **Runner**: cron → processo detached com lock, idempotência por dia, log próprio,
      kill switch por env, "nunca falhar em silêncio".
- [ ] **Protocolo `.md`** fora do caminho do prompt do agente-fim, com raio de ação, proibições
      absolutas e a matriz de autonomia DO DOMÍNIO.
- [ ] **Entrega determinística**: o equivalente do "restart" local (deploy, reload, reprocesso)
      decidido e executado por código, com verificação.
- [ ] **Placar** adaptado (marca de autoria + regra de reincidência tolerante a campo mutável).

Sequência de implantação (a mesma que funcionou no TOM):
**brainstorm → spec → plano → tasks com TDD → validação em produção observada → cron.**
No TOM, mesmo com spec e plano, **3 defeitos só apareceram executando** (placar morto contra
dados reais, `await` no tick, protocolo ausente rodando sem travas) — a validação observada
não é opcional.

---

## 11. Primeiro alvo: MARIA (financeiro)

### O que já se sabe (não verificado por mim — confirmar no ambiente real)

- **Stack diferente do TOM**: OpenClaw Gateway (cron `maria-laudo-diario-v1a`, id
  `a47a1c2b-51f9-4097-a85a-f8db87087809`, `0 7 * * *` America/Sao_Paulo, `sessionTarget:
  isolated`), runtime Hermes, banco **Super Folha**, entrega hoje via **Telegram privado do
  Alfredo** (errado por decisão do Alf — Alfredo é amigo pessoal, não mensageiro).
- **V1A no ar** (desde 09/08): laudo diário read-only com 9 auditorias, proibições absolutas
  explícitas, "nunca falhar em silêncio", regra editorial total vs. limiar 48h. **Isso é bom e
  não se refaz.**
- **V1B (escrita) BLOQUEADA** atrás de 4 gates: identidade técnica para `maria_audit_log`,
  idempotência por tipo de ocorrência, registro de normalização sem UPDATE não autorizado,
  idempotência do alerta.
- Escrita dela é via **RPCs `SECURITY DEFINER` allowlisted** (`maria_agent_memory_registrar`,
  `maria_audit_insert`, ...) — nunca INSERT direto. Bom padrão, manter.
- Tabelas conhecidas: `maria_audit_log`, `maria_agent_memory_events`,
  `maria_conferencias_lancamento`, `contas_pagar`/`vw_maria_contas_pagar`,
  `contas_pagar_codigo_mes`, `maria_email_*`, `maria_fluxo_caixa_eventos`,
  `maria_eclassificacao_regras`.
- Laudo real de 09/08: 353 contas pendentes, 11 vencidas (7 >48h), 93 e-mails sem match
  (81 >48h), 5 conferências paradas, autopush sem rodar há ~39h.

### As 5 checagens ANTES de propor qualquer coisa (ETAPA 3 aplicada ao projeto)

1. Ler o que já existe: `memory/projects/maria-financeiro.md`, `memory/agents/inventory.md`
   (AGT-MARIA), `MARIA-GOVERNANCIA-ATIVA-DIARIA-2026-08-08.md`.
2. **WhatsApp da Maria conectado e provado?** (número, sessão, mensagem de teste real). Sem
   isso, "entrega no WhatsApp dela" é hipótese.
3. **Os 4 gates da V1B seguem abertos?** Governança ativa É escrita — sem destravar, auto-reparo
   é promessa.
4. **Existe equivalente de acervo + KIs no Super Folha**, ou precisa nascer? Sem os dois não há
   placar nem varredura.
5. **Ela tem suíte de testes?** Sem suíte, prova de reversão não existe (ciclo para na ETAPA 4).

### Matriz de autonomia (MAIS conservadora que a do TOM — é dinheiro)

| autônomo (reversível, baixo risco, alta confiança) | aprovação humana OBRIGATÓRIA |
|---|---|
| vincular e-mail a conta com alta confiança e sem conflito | efetuar/agendar/cancelar pagamento |
| coletar/registrar código de boleto/PIX | dar baixa financeira |
| reprocessar rotina de leitura que falhou | alterar valor, vencimento, fornecedor, centro de custo |
| organizar fila de conferências; cobrar responsável interno | excluir ou mesclar registros |
| abrir pendência com contexto e evidência | resolver duplicidade com impacto financeiro |
| ajuste de regra de classificação **com teste prévio + reversão** | mudar regra ampla sem teste |

Regra de relato (herdada da lição 9.2): **"corrigido automaticamente: N" é contado por código,
nunca redigido pelo LLM.** Relatório separado em: corrigido automaticamente · aguardando
aprovação · bloqueado por risco · causa raiz em investigação · prevenção aplicada.

### Sequência sugerida

1. **Entrega primeiro** (valor imediato, risco zero): laudo V1A sai do Telegram do Alfredo →
   WhatsApp da própria Maria, direto ao Alf. Nada mais muda.
2. Fundações: acervo + KIs no Super Folha; provar os 4 gates da V1B (read-only vira escrita
   auditada); suíte mínima.
3. Ciclo de governança dela (protocolo próprio, placar, teto separado, matriz acima).
4. Validação observada em produção (como foi no TOM) → cron.

---

## 12. Visão (não construído — registrar para não perder)

- **Painel de controle central** (ideia Alf+Hugo): tokens gastos por agente/rodada
  (`total_cost_usd` já vem no JSON do CLI), desempenho por modelo, comparativos, taxa de
  reincidência por sistema. Candidato natural a viver no LAHQ.
- **LAHQ como segundo cérebro**: este documento migra pra lá; os agentes passam a alimentar
  evidências/regressões/aprendizados sozinhos (a ESCADA de cada um é o embrião disso).
- **Roadmap de replicação** (ordem por dor): Maria (financeiro) → LA Report (sync
  Emusys/MusicScore — hoje ninguém monitora; produção descobre) → demais agentes.

---

## 13. Como alimentar este documento

- Rodada com lição nova → entra na seção 8 (evidência) e, se for padrão, vira item na seção 9.
- Implantação nova → ganha subseção própria na 11 (estado, checagens, matriz, decisões).
- Regra que virou código → atualizar a seção 5 e apontar o commit.
- **Não** duplicar o que vive nos `.md` de runtime (protocolo/escada) — aqui é o modelo e a
  história; lá é o comportamento vivo.

---

## 14. SEPARAÇÃO AUDITOR ↔ CORRETOR (desenho, 13/08/2026)

Pedido do Alf: *"se o mesmo agente que faz auditoria conserta, ele acaba sendo tendencioso"*.
Está certo — e a evidência mais forte não veio do agente, veio de **mim** neste dia, atuando
como auditor e corretor do caso Rose:

| # | O que eu afirmei como auditor | O que me derrubou |
|---|---|---|
| 1 | "A raiz é dedupe sem `UNIQUE (recurrence_parent_id, due_date)`" | O banco: filha-template tem esse campo **nulo** |
| 2 | "Consertei a lista, 21/21 verde, fechado" | A simulação: **1/3 antes e 1/3 depois** — agulha parada |
| 3 | "Reparei os dados" | A conferência: eu tinha **duplicado 4 cartões** |

Três erros, três mecanismos diferentes de correção. **Nenhum deles foi eu revendo meu próprio
raciocínio** — foram medições externas ao raciocínio que produziu a conclusão.

### A lição que muda o desenho

Separar os papéis é necessário mas **não é suficiente**. O que quebrou o viés nos 3 casos foi
a **prova de reversão obrigatória**: medir o mesmo cenário ANTES e DEPOIS. Um corretor
separado, sem essa exigência, produz exatamente o meu erro nº2 — conserta algo real, verde
em tudo, e a agulha não anda.

### Desenho

```
AUDITOR (lê, nunca escreve código)
  produz: achado + PROVA (literal exato, id no banco, query que reproduz)
  produz: CRITÉRIO DE ACEITE — "isto passa a valer quando X for medido"
  NÃO propõe fix. Propor fix é começar a defender uma hipótese.
        │
        ▼
CORRETOR (escreve código, não julga se o achado é válido)
  1. REPRODUZ com o critério do auditor  → se não reproduz, DEVOLVE (não é fix, é refutação)
  2. mede o baseline (vermelho)          → registra o número
  3. corrige
  4. mede de novo com o MESMO critério   → verde, e o número tem que ter MUDADO
  5. se o número não mudou: o fix está errado, ainda que os testes passem  ← erro nº2
        │
        ▼
CÓDIGO (não-LLM) faz a entrega e relata: restart provado por `ps -o lstart=`,
suíte no baseline, e o antes/depois da medição no relatório.
```

**Regras que fazem o desenho valer** (sem elas viram dois agentes concordando):

1. **O auditor não vê o código do fix.** Se vir, passa a avaliar a solução em vez do sintoma.
2. **O critério de aceite nasce ANTES do fix**, escrito por quem não vai corrigir. Critério
   escrito depois é escrito para passar.
3. **Refutação é entrega de valor.** O corretor devolver "não reproduz" tem que valer tanto
   quanto corrigir — senão ele inventa reprodução. (4 de 5 "regressões" de 09-15/07 eram
   falsas; ver seção 8.)
4. **Nenhum fix fecha sem antes/depois medido.** É a trava contra o erro nº2, o mais caro
   porque parece sucesso.
5. **A simulação conversacional é o instrumento**, não a suíte. A suíte roda sem LLM; o que
   quebra no TOM é escolha dentro de um turno de conversa. Ver `scripts/replay-lab-*`.

### Estado

**Não implementado.** Hoje é um agente só, com as etapas 3 (refutar) e 4 (prova de reversão)
dentro do próprio ciclo — que é a versão "um agente disciplinado" disto. A separação real
espera decisão do Alf sobre custo (dobra as chamadas de LLM por rodada).

### Decisão do Alf (13/08): FAZER — custo aprovado

Dobrar as chamadas de LLM por rodada **não é impedimento**. A implantação usa a arquitetura
**já testada e validada na Maria** — o Alf traz o desenho de lá na hora de executar. Não
inventar um desenho paralelo aqui: dois modelos diferentes para o mesmo problema viram duas
dívidas, e o daqui não tem rodagem em produção.

O §14 acima é o que eu derivei sozinho a partir dos erros do caso Rose. Serve como **lista de
conferência** contra o desenho da Maria — o que bater, confirma; o que divergir, o da Maria
ganha (tem evidência de produção), e a divergência vira lição a registrar aqui.

#### O que preciso saber do desenho da Maria (perguntas específicas)

Genérico ("me manda a arquitetura") volta incompleto. Isto é o que muda a implantação:

1. **Transporte do achado** — o auditor entrega ao corretor por tabela, arquivo ou fila?
   Se o TOM já tem `tom_audit_findings`, o corretor lê de lá ou de um artefato próprio?
2. **Critério de aceite** — quem escreve, em que formato, e é obrigatório? (No meu desenho é
   o auditor quem escreve, ANTES do fix. Se lá for diferente, quero saber por quê.)
3. **Devolução** — o corretor pode responder "não reproduz"? Onde isso fica registrado e
   conta como entrega? (4 de 5 "regressões" de 09-15/07 aqui eram falsas — sem devolver com
   status, o corretor inventa reprodução.)
4. **Medição antes/depois** — quem mede, código ou LLM? É trava dura (não fecha sem) ou
   recomendação? **Esta é a pergunta mais importante**: foi a ausência disso que deixou meu
   fix passar com a agulha parada em 1/3.
5. **O auditor vê o fix?** Se vê, passa a avaliar a solução em vez do sintoma.
6. **Anticonluio** — o que impede os dois de concordarem? Modelos diferentes, prompts
   adversariais, terceiro juiz?
7. **Modelo por papel** e o que acontece quando a cota do primário estoura (aqui o fallback
   é GPT-5.6 Sol High; ver `src/services/ops-fallback.js`).
8. **Raio em código** de cada papel: o auditor tem write? O corretor tem deploy? Kill switch?

**Diferença de terreno que já sei que existe:** aqui o instrumento de medição é a **simulação
conversacional** (`scripts/replay-lab-*`), porque o que quebra no TOM é escolha dentro de um
turno de conversa — a suíte roda sem LLM e não pega. Se a Maria mede de outro jeito, esse é
o ponto que NÃO se copia direto.
