# 🧭 PAINEL — Governança da Maria

> **Documento único de controle.** Se você está perdido, leia só as duas primeiras seções.
> Atualizado a cada checkpoint fechado. Última atualização: **09/08/2026 17:40 BRT**.

---

## 1. ONDE ESTAMOS

A missão original é o **Loop de governança da Maria** (Trilha B). Ela está **pausada** porque a
auditoria de acesso que a antecedia encontrou um problema de segurança que precisa fechar antes —
isso virou a **Trilha A**, que é onde estamos hoje.

**Motivo da pausa, em uma frase:** a Fatia 0 do Loop moveria o laudo para dentro do ambiente onde
mora um token que alcança 6 projetos Supabase — migrar sabendo disso seria aumentar a exposição de
propósito.

## 2. PRÓXIMO PASSO

**A trilha de segurança fez o que tinha que fazer.** Proposta: voltar para a **Trilha B** —
e a decisão D-03 merece ser reaberta, porque o inventário mudou a premissa dela (ver D-09 na §5).

**O B0 foi entregue em 09/08.** O laudo agora sai pelo WhatsApp da Maria às 07:00 BRT, com vigia às
07:40. A primeira prova em produção é a rodada automática de **10/08 às 07:00**.

| # | O quê | Quem faz |
|---|---|---|
| **A0-bis** | **Devolver o corte de ferramentas do laudo** — agente `laudo` dedicado. O B0 desfez o A0 sem eu perceber | Claude |
| **B1-resto** | RPCs + laudo persistir achados + custo por rodada. **O B2 depende disto** | Claude |
| — | **Conferir amanhã 07:00** se o laudo chegou sozinho (primeira rodada automática) | ALF + Claude |
| **B2** | Sonda no webhook + verificador de outra família + gate determinístico + held-out | Claude, **depois do B1-resto** |
| — | **Decidir onde o `gov/` e o `laudo/` ficam guardados** — hoje existem só na VPS (§8) | **ALF** |
| — | Colar o **token novo do gateway** na UI (arquivo já entregue) | **ALF** |
| **A8** | Rotacionar a `service_role` do TOM — **adiado pelo Alf em 09/08**, chave segue viva | ALF decide quando |

Na VPS, nada foi alterado até aqui: tudo na Trilha A foi leitura. A única mudança em produção foi
o Access, feita pelo Alf no dashboard da Cloudflare.

---

## 3. TRILHA A — Segurança (em andamento)

| ID | Checkpoint | Estado | Quem | Prova de fechamento |
|---|---|---|---|---|
| **A0** | Fechar `toolsAllow` do laudo V1A | ✅ **FECHADO** | Claude | 32 → 3 ferramentas. Rodada forçada de 09/08 14:43 saiu com as **9 seções inteiras** e números reais — confirmado visualmente pelo Alf no Telegram do Alfredo. Cortar as ferramentas **não** degradou o laudo |
| **A1** | Auditoria de acesso e raio de credencial | ✅ **FECHADO** | Claude | Inventário na §6 |
| **A2** | Cloudflare Access no hostname do gateway | ✅ **FECHADO 09/08 16:34** | ALF | **(a)** Medido de fora: `/` e `/health` passaram de **200** para **302 → old-mountain-a6b3.cloudflareaccess.com/cdn-cgi/access/login/**. **(b)** Controle negativo: `maria-whatsapp…` inalterado. **(c)** Alf autenticou e chegou na UI do gateway — a chave dele funciona |
| **A3** | Restart único: `bind`→loopback + rotacionar token do gateway + apagar linhas mortas de PAT | ✅ **FECHADO 09/08 16:49** | Claude | escuta agora só `127.0.0.1:18789` + `[::1]:18789` (era `0.0.0.0`); `/health` local **200**; os 3 agentes visíveis pro monitor; hostname público segue **302 → Access**; `workspace/.env` só com FOLHAPAGAMENTO; token rotacionado — **provado pelo log**: navegador com o token velho recebeu `reason=token_mismatch` |
| **A5** | Censurar `bash_history`, sessões, backups e `shell_snapshots` | ✅ **FECHADO 09/08 17:04** | Claude | **168 arquivos, 641 ocorrências** substituídas por `<REDACTED:sha256-…>`. Token sobrou **só nos 4 configs vivos**. Zero erro nos gateways; `.jsonl` com **0 linhas quebradas**; MCP com valor intacto. Backup: `/root/redact-backup-20260809T170445.tar.gz` (600) |
| **A4** | Revogar os 5 PATs sem consumidor | ⏸️ **ESTACIONADO** — manutenção, sem urgência | ALF, quando quiser | Motivo do estacionamento: **medido que nenhum token vivo escapou da VPS.** Dos 3 repos com remote no GitHub, o único token commitado (`ad5703…`) já estava **morto (401)**. Com o A5 feito, os tokens saíram do alcance de qualquer agente. Revogar virou higiene, não contenção |
| **A6** | Rebaixar o Alfredo: usuário próprio, sem sudo, copiando a Maria | 🔶 **ABERTO — MAIOR ITEM QUE SOBROU** | Claude, precisa de plano próprio | `ps -o user=` mostra não-root |
| **A7** | Contenção por SO na Maria (`maria-ingest`) | 🔶 **ABERTO** (risco menor: `maria` não tem sudo) | Claude | agente da Maria não lê o env |
| **A8** | **`service_role` do TOM vazada em repo PÚBLICO** | 🔶 **ABERTO — sangramento estancado, chave ainda viva** | ALF decidiu adiar a rotação em 09/08 | chave vazada devolvendo **401** |

### A8 — o achado de 09/08 (detalhe, porque é o item mais grave em aberto)

Descoberto por acidente: o Alf perguntou "isso está subindo pro git?". Estava — e o repositório
`LucianoAlf/LA-Organizer` era **público**.

| medida | resultado |
|---|---|
| entrou no repo | commit `3ad52f54`, **26/04/2026 11:17** — exposta por **105 dias** |
| projeto | `cesnbnrynvxvgdhfmaua` (TOM) · papel `service_role` · expira **2036** |
| a chave respondia? | **HTTP 200**, e leu dado real: **39 colaboradores**, **3.040 tarefas** — `service_role` ignora RLS |
| download anônimo | **HTTP 200** em `raw.githubusercontent.com/.../3ad52f54/.env` |
| **estancado em 09/08** | Alf tornou o repo **privado**. Anônimo agora leva **404**; push do hook segue funcionando |
| **ainda em aberto** | a chave **continua viva (200)**. Privar não desfaz: quem clonou, tem |

O commit `f1c6b28e` se chama `fix(security): remove .env.save from tree`. Tiraram do tree — mas em
git remover não apaga, e o commit anterior seguia servindo o arquivo a qualquer um, sem login.

**Inventário de consumidores (feito antes de qualquer rotação — regra do Alf):**

| onde | o quê |
|---|---|
| `/opt/LA-Organizer/.env` | **1 único consumidor vivo** — o engine do TOM |
| 4 Edge Functions | leem `SUPABASE_SERVICE_ROLE_KEY` da env do Supabase |
| dentro do banco | **zero** — sem `pg_cron`, sem `pg_net`, sem webhook, sem trigger |
| PWA | **zero** — usa a `anon`, não a `service_role` |
| working tree local | **zero** — a chave só vive no histórico do git |

Rastro morto a limpar depois: 8 backups diários, 14 `.env.bak*`, `.bash_history` do root, 1 `.jsonl`.

**Caminho sem downtime, quando o Alf quiser executar** (confirmado na doc do Supabase, não é chute):
o projeto TOM **já tem o sistema novo de chaves ligado**, com `sb_publishable_` ativa. Então:
criar `sb_secret_` → trocar no `.env` do engine → migrar as 4 Edge Functions
(`SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEYS['default']`, `verify_jwt=false`) →
**desativar só a `service_role` legacy**, e a chave vazada morre. O PWA nem sente, porque usa a
`anon`. Cada passo é reversível — dá pra reativar a legacy se algo quebrar.

**A lição:** passei a tarde do 09/08 censurando 641 ocorrências de token **dentro da VPS** enquanto
o mapa da infra subia pro GitHub público a cada 20 minutos pelo hook. Blindei o lado que eu estava
olhando. O buraco mora no lado sem irmão — sempre perguntar "e o outro lado?".

**Legenda dos estados** — ⏸️ *ESTACIONADO* é escolha deliberada de adiar algo opcional.
🔶 *ABERTO* é trabalho real que ainda falta. **Não confundir os dois.**

**O que o A6 ainda deixa exposto:** o gateway do Alfredo roda como **root**. Se aquele agente for
induzido a agir errado — por uma mensagem, uma página que leia, um documento — ele age como root,
com acesso a tudo na máquina, inclusive os arquivos da Maria. Não é hipótese: em 09/08 o agente do
laudo foi **sozinho** atrás do arquivo de credenciais, sem instrução para isso.

### Detalhe do A3 — as três mudanças do restart

1. `gateway.bind`: `"lan"` → `"loopback"` em `/root/.openclaw/openclaw.json`. O túnel aponta para
   `localhost:18789`, então o Cloudflare continua chegando. **Verificado:** zero conexões
   estabelecidas de fora do loopback (amostra pontual).
2. Rotacionar `gateway.auth.token` — vazou no transcript por bug de redação do Claude.
   **Urgência caiu com o A2 fechado:** o token deixou de ser a única coisa entre a internet e o
   gateway root. Virou item de conveniência do restart, não emergência.
   **Verificado:** aparece em 58 arquivos, todos log/backup; nenhuma config viva de cliente na
   máquina. Custo: Alf redigita o token no celular uma vez.
3. Apagar de `/root/.openclaw/workspace/.env` e `/root/.openclaw/.env` as linhas de PAT **sem
   consumidor**: `SUPABASE_ALFREDO`, `SUPABASE_LAHQ`, `LAREPORT`, `STUDIOMANAGER` e o `3643b6…`.

---

## 4. TRILHA B — Loop da Maria (missão original, PAUSADA)

Spec: [`specs/2026-08-09-loop-maria-design.md`](specs/2026-08-09-loop-maria-design.md)
Plano da Fase 1: [`plans/2026-08-09-loop-maria-fase1.md`](plans/2026-08-09-loop-maria-fase1.md)

| ID | Fatia | Estado | Bloqueado por |
|---|---|---|---|
| **B-opçãoB** | Trocar o PAT por credencial de escopo estreito em `superfolha_sql.py` **e** no ingestor de e-mail | 🔴 próximo da Trilha B | — |
| **B0** | Migrar o laudo para a Maria + entrega no WhatsApp dela | ⚠️ **FUNCIONA, mas alargou o `toolsAllow`** — ver A0-bis | — |
| **A0-bis** | **Devolver o corte de ferramentas que o B0 desfez** | 🔴 **ABERTO — o laudo automático de amanhã 07:00 roda alargado** | — |
| **B1** | 4 tabelas `maria_gov_*` + ator técnico + placar | 🟡 **PARCIAL** — fechou o *plano* (Tasks 6–7), não a *Fatia 1* da spec | — |
| **B1-resto** | RPCs + o laudo persistir achados + custo por rodada | 🔴 **ABERTO — o B2 depende disto** | — |
| **B2** | Sonda no webhook + verificador de outra família + gate determinístico + held-out | ⏸️ | B1 |
| **B3** | Loop operacional (só dado/estado) | ⏸️ | B2 |
| **B4** | Suíte + golden-file + fixtures | ⏸️ | B3 |
| **B5** | Escada append-only | ⏸️ | B4 |

### B0 — como ficou (09/08/2026)
Tudo em `/home/maria/.openclaw/workspace/laudo/`, rodando como usuário `maria`:

| peça | papel |
|---|---|
| `laudo-prompt.md` | prompt congelado, extraído **verbatim** do cron antigo. Golden-file `sha256:80a8cdc9fbecccb6` — o wrapper avisa se mudar |
| `laudo-diario.sh` | chama `openclaw agent --json` (que **não entrega nada**), extrai `result.meta.finalAssistantVisibleText`, aplica o gate, e só então manda |
| `enviar-whatsapp.py` | `POST /send/text` na UAZAPI. **Quem envia é código, nunca o LLM.** Sai 0 só se todas as partes forem confirmadas |
| `laudo-vigia.sh` | dead-man's switch às 07:40 BRT: se não houver entrega do dia, avisa |
| crontab do `maria` | `0 10 * * *` UTC = 07:00 BRT (sistema em UTC); vigia `40 10 * * *` |

**Cron antigo:** `a47a1c2b…` no gateway do Alfredo → `enabled: false`, `nextRunAtMs: null`. Desligado,
não apagado — dá para reverter.

**PROVA da entrega:** run de 17:30 BRT saiu `ENTREGUE chars=3905 secoes=9`, 2 partes, ambas HTTP 200.

**Duas armadilhas pegas antes de causar dano:**
1. O extrator inicial não achava o campo certo e caía num fallback "maior string do JSON" — que é o
   **system prompt**. Teria mandado o prompt interno da Maria para o WhatsApp do dono.
2. O gate contava linhas `^N.`; o modelo da Maria escreve `**1. Título**`, então a linha começa com
   `*`. Falso positivo por formatação. **Gate agora é semântico** — procura os nomes das 9 seções
   exigidas pelo prompt, o que independe do modelo.

**Requisitos travados para o B-opçãoB** (ditados pelo Alf, não negociar sem ele):
- A ferramenta nova é **drop-in**: mesmas flags, mesma saída (`STATUS 201` + JSON). O payload do laudo
  é conteúdo congelado — mudar a invocação obrigaria a editar o que o congelamento protege.
- **O ingestor é a metade difícil.** Ele escreve; papel read-only não serve. Precisa de credencial
  própria com grant estreito em tabelas específicas. Não deixar a estimativa esconder isso.

### B1 — como ficou (09/08/2026)

Banco: Super Folha (`ubdvtjbitozhkuvvqkxj`). Código: `/home/maria/.openclaw/workspace/gov/`.

| peça | estado |
|---|---|
| `maria_gov_findings` (16 col.), `maria_gov_known_issues` (12), `maria_gov_probes` (16), `maria_gov_runs` (10) | criadas |
| ator técnico `gov_agent_tecnico` em `maria_whatsapp_atores` | criado (gate 1 da V1B) |
| `placar-governanca.mjs` + `.test.mjs` | **pass 8, fail 0** |
| baseline da suíte | `backups/loop-maria-fase1/baseline-suite.txt` |

**Idempotência (gate 2 da V1B) — provada nos DOIS sentidos, não só no caso fácil:**

| cenário | esperado | medido |
|---|---|---|
| mesma assinatura, mesmo dia BRT | colide | ✅ `duplicate key` |
| 20h e 22h BRT do dia 09 (**dias UTC diferentes**) | colide | ✅ colidiu — o índice é BRT de verdade |
| 09/08 22h e 10/08 00h30 BRT (**mesmo dia UTC**) | passam os dois | ✅ passaram — não agrupa demais |

O primeiro teste sozinho (18h BRT) não provaria nada: naquele horário o dia UTC e o dia BRT
coincidem. A prova está nas bordas.

**Três desvios do plano, todos verificados contra o banco/máquina real:**

1. **`gov_agent_tecnico` foi recusado por um CHECK** em `maria_whatsapp_atores` que só aceitava 4
   papéis. O plano assumiu que entraria. Antes de ampliar o CHECK, varri quem **lê** a tabela:
   **nenhum código lê** — a bridge viva deriva papel por **número, hardcoded**; as únicas
   ocorrências do nome da tabela na VPS estão em `.md` de spec. Só então ampliei.
2. **`maria_gov_findings` tem 16 colunas, o plano dizia esperar 14.** Contei o DDL: são 16. O
   número escrito no plano é que estava errado; o DDL aplicado é o do plano, sem desvio.
3. **`node --test <caminho>` no Node 24 trata o caminho como ARQUIVO.** Passar o diretório dá
   `MODULE_NOT_FOUND` e imprime `fail 1`. Isso quase virou um **baseline vermelho gravado em
   disco** — a partir dele, "a suíte está no baseline" passaria a significar "está quebrada".
   Forma correta: `cd <dir> && node --test` **sem argumento**. Some-se a isso que
   `sudo -u maria node --test` de outro cwd dá `EACCES` no spawn: a `maria` não lê o cwd herdado.

### ⚠️ A0-bis — o B0 desfez o A0 (achado de 09/08 21:45, erro meu)

O **A0** cortou o `toolsAllow` do laudo de 32 para 3. Mas esse corte vivia no **cron do gateway do
Alfredo** — e o **B0 desligou aquele cron** e passou a chamar `openclaw agent --agent main` por
cron do SO. Resultado: o corte foi junto.

| | ferramentas do laudo |
|---|---|
| depois do A0 | `["exec","read","write"]` — lido de `cron_jobs.payload_tools_allow_json`, job `a47a1c2b…` |
| hoje | **todas** — a config da Maria não tem `toolsAllow` em lugar nenhum; `tools.exec.security = "full"`, `tools.exec.ask = "off"` |

`openclaw agent --help` **não tem flag de restrição de ferramentas** — só vem da config. A única
trava que continua de pé é `tools.fs.workspaceOnly = true`.

**Minha primeira proposta — agente dedicado `agents.laudo` com `toolsAllow` — NÃO EXISTE.**
Consultado `openclaw config schema`: `toolsAllow` só aparece em `channels.clickclack` e num plugin.
`agents` aceita apenas `defaults` e `list`, e nenhuma chave de ferramenta. Registrado aqui para
ninguém tentar de novo.

**O que o schema realmente oferece:**

| caminho | alcance |
|---|---|
| `tools.allow` / `tools.deny` | **global** — atinge a Maria inteira, não só o laudo |
| `tools.toolsBySender` | por remetente — o laudo não tem remetente, é cron |
| `cron_jobs.payload_tools_allow_json` | **por job** — é onde o A0 morava, e **funciona** |

**Caminho mais provável (a decidir, não decidido):** recriar o cron do laudo **no gateway da
Maria (19789)** com `toolsAllow`, em vez do cron do SO. Mantém o B0 no que importa — a rotina é da
Maria, não do Alfredo — e recupera o A0. **O custo a resolver:** o wrapper `laudo-diario.sh` é
quem faz o gate semântico e o envio por código; um `agentTurn` de cron não passa por ele. Encaixar
os dois é decisão de design, não ajuste — merece ser pensada, não improvisada.

**Lição:** ao migrar uma rotina de lugar, a trava que morava no lugar antigo não vai junto. Perguntar
sempre "o que estava protegendo isso lá, e quem protege aqui?".

### ⚠️ B1 fechou o plano, não a Fatia 1

A Fatia 1 da spec pede **quatro** coisas: as tabelas **e suas RPCs**; **o laudo passa a persistir
achados**; placar com marca tolerante; **custo persistido desde a primeira rodada**. O plano da
Fase 1 (Tasks 6–7) cobria só a primeira e a terceira.

Medido em 09/08 21:40: `findings=0, runs=0, known_issues=0, probes=0, RPCs=0`. O checkpoint da
Fatia 1 — *"rodar o laudo e ver os achados no banco; a linha de custo da rodada existe"* — **não é
atingível hoje**, porque nada popula as tabelas.

**Isso bloqueia o B2:** a sonda verifica achados, e não há achados.

**Onde esse código mora — e não mora:** o script `backup-to-github-safe.sh` tem allowlist
(`docs-inbox-applied docs scripts bridges skills tools`). **Nem `gov/` nem `laudo/` estão nela.**
O B0 e o B1 existem hoje **só na VPS, em um lugar**. Ver §8.

---

## 5. DECISÕES TOMADAS (não re-litigar)

| # | Data | Decisão | Motivo |
|---|---|---|---|
| D-01 | 09/08 | Não rotacionar `MARIA_LAREPORT_RPC_DATABASE_URL` | Exposição isolada, sem consumidor. **Superada pela D-05** — foi tomada sobre mapa incompleto do Claude |
| D-02 | 09/08 | **Guard A (SQL só `select`) — PULADO** | O B joga fora esse trabalho; e o caminho principal é `exec` chamando a API direto, que o guard não toca |
| D-03 | 09/08 | **Opção B antes da Fatia 0** | A Fatia 0 move o laudo para dentro do env onde o PAT mora |
| D-04 | 09/08 | **Root entra no escopo agora** | 4 processos rodavam como root; o gateway hospeda agentes com `exec` |
| D-05 | 09/08 | **Rotação: sim, mas depois do inventário** | Rotacionar às cegas falha em silêncio — consumidor desconhecido quebra dias depois |
| D-06 | 09/08 | **Access primeiro, sem esperar restart.** Hostname fica público, mas atrás do Access | Sem downtime; tirar o ingress custaria o acesso pelo celular, que é uso real |
| D-07 | 09/08 | **Cloudflare NÃO vai para o Alfredo** | Não existe credencial Cloudflare na máquina nem MCP; e ele é o objeto da mudança. Delegar execução **e** verificação ao mesmo agente é o modo de falha conhecido |
| D-08 | 09/08 | **Comportamento e tom da Maria: zona congelada** | Veto do Alf. `bridge.js` e `skills/*.md` não se tocam |

### D-09 — PROPOSTA ABERTA: reabrir a D-03
A D-03 ("opção B antes da Fatia 0") partiu de que migrar o laudo o colocaria dentro do env onde o PAT
mora. **O inventário desmentiu a premissa:** o `FOLHAPAGAMENTO` está nos **dois** envs, e hoje o laudo
roda no gateway do Alfredo, que é **root** e tem 3 PATs vivos ao alcance. Migrar para o gateway da
Maria o move para um processo **sem sudo, com 1 PAT só** — e a Maria já tem um consumidor desse mesmo
token (`maria_financeiro_email_ingest.py`), então não cria classe nova de exposição.

**Recomendação: o B0 pode sair antes da opção B.** Migrar reduz o raio em vez de aumentar. A opção B
continua valendo, mas como melhoria, não como pré-requisito. Decisão do Alf.

### Aprendizado do A2 (registrado para não repetir)
Ao ver a UI falhar com *"Não foi possível conectar"*, o Claude atribuiu à camada Cloudflare. **O "Erro
bruto" refutou:** `unauthorized: gateway token missing` — mensagem do **OpenClaw**, não do Cloudflare.
A conexão atravessou Access e túnel e chegou no gateway; quem recusou foi o gateway. Antes de culpar
a camada que acabou de mudar, **abrir o erro bruto**. E o teste que isolou a camada foi o handshake
WebSocket direto no `localhost:18789` (devolveu `101` + `connect.challenge`), provando que o servidor
estava intacto.

---

## 6. FATOS PROVADOS (base do plano — não refazer, consultar)

### Credenciais
**15 tokens `sbp_` distintos** na VPS; **8 vivos**, 7 mortos (401). Só **um** tem consumidor em código.

| sha256(12) | projetos | conta | consumidor |
|---|---|---|---|
| `bd00d3…` | 6 | producoes.emla | **SIM** — `superfolha_sql.py` (maria *e* root) + `maria_financeiro_email_ingest.py` |
| `9fce17…` | 7 | la.tecnology.system | **SIM** — MCP `supabase-lareport` em `openclaw.json:399` (`Bearer ${SUPABASE_LAREPORT_MCP_TOKEN}`) |
| `3643b6…` | 2 | supa.lamusic | **SIM** — var `SUPABASE_ACCESS_TOKEN`, usada por scripts `.mjs`/`.ps1` do repo LAperformanceReport |
| `0a8107…` | 7 | la.tecnology.system | nenhum |
| `6e5b72…` | 7 | la.tecnology.system | nenhum (órfão) |
| `21253b…` | 7 | contatosalf | nenhum (órfão) |
| `1a9e95…` | 2 | **lucianoalf.la — conta pessoal do Alf** | nenhum |
| `d05979…` | 1 | la.music.journey | nenhum |

⚠️ **Só 5 dos 8 são revogáveis.** `bd00d3`, `9fce17` e `3643b6` têm consumidor vivo — revogar quebra.

**Armadilha achada no A3:** a varredura de consumidores original buscou só os nomes de variável que
apareciam em `workspace/.env`. O `/root/.openclaw/.env` usava **outros nomes** para os mesmos tokens
— `SUPABASE_ACCESS_TOKEN` (nome convencional, lido por padrão pelo CLI e pelo MCP do Supabase) e
`SUPABASE_LAREPORT_MCP_TOKEN`. O dry-run pegou antes de apagar. **Lição: varrer por VALOR do token,
não por nome de variável** — o mesmo segredo vive sob nomes diferentes em arquivos diferentes.

**PAT autentica como usuário, não como projeto** → rotacionar **não reduz o raio**, só invalida o
vazado. `GET /v1/projects/{ref}/api-keys` devolve 200 em qualquer projeto alcançado.

### Topologia da VPS `srv1549273` (187.127.9.25)
- **`maria` NÃO tem sudo.** Gateway e bridge dela: `User=maria`, bind **loopback**, túnel só no webhook.
  **É o agente mais bem contido da máquina.**
- **Rodam como root:** gateway 18789 (agentes `main`=Alfredo e `mike`), `sol-openclaw-report-bridge.cjs`,
  `fabio-notification-worker`. Os dois primeiros são `systemd --user` do uid 0 (`Linger=yes`), units em
  `/root/.config/systemd/user/`.
- **Nenhum precisa de root:** portas >1024, sem capabilities, sem escrita fora do próprio tree.
- **`fabio` NÃO é agente:** 264 linhas Python, zero `subprocess`/`eval`, unit já endurecida. Prioridade baixa.
- **UFW ativo** (só 22/80/443), **mas o túnel Cloudflare atravessa**:
  `agent.maestrosdagestao.com.br` → `http://localhost:18789`.
- **O gateway não está aberto:** `auth.mode: "token"` (48 chars), rate limit 10/60s, lockout 300s,
  `allowInsecureAuth: false`, `allowedOrigins` restrito. Público são a casca da UI e `/health`.

### Achados laterais (fora de escopo, registrados)
- `check-agentes.py` (cron a cada 15min) vigia o **Mike** na porta **19789** com a unit
  `openclaw-mike.service`, **que não existe** — mike mora na 18789. Vigia provavelmente cego.
- 22 arquivos `codex-home/shell_snapshots/*.sh` (17 do `main`, 5 do `mike`) despejam ambiente com token.
- O MCP Supabase do Claude usa um **9º** PAT (`b70898…`), não vazado na VPS, alcance dos mesmos 6 projetos.

---

## 7. IMPRESSÃO DIGITAL DOS PATs (para o A4)

Cada token foi tocado uma vez em `GET /v1/profile`, espaçado 75s. **Horários BRT** — se o painel
mostrar UTC, somar 3h. Em `Account > Access Tokens`, a entrada cujo *last used* bate com o horário
**é** aquele token.

| conta | horário BRT | projetos | revogar? |
|---|---|---|---|
| lucianoalf.la (**pessoal**) | **15:51:08** | 2 | ✅ **SIM** (era `SUPABASE_LAHQ`) |
| la.tecnology.system | **15:52:23** | 7 | ✅ **SIM** (era `STUDIOMANAGER`) |
| la.music.journey | **15:53:38** | 1 | ✅ **SIM** (era `SUPABASE_ALFREDO`) |
| la.tecnology.system | **15:54:54** | 7 | ✅ **SIM** (órfão, só em log) |
| contatosalf | **15:57:24** | 7 | ✅ **SIM** (órfão, só em backup) |
| la.tecnology.system | 15:49:53 | 7 | ❌ **NÃO** — MCP `supabase-lareport` usa |
| supa.lamusic | 15:56:09 | 2 | ❌ **NÃO** — scripts do LAperformanceReport usam |
| producoes.emla | 15:58:39 | 6 | ❌ **NÃO** — `FOLHAPAGAMENTO`, tem consumidor |

**Diagnóstico de brinde:** se alguma entrada mostrar *last used* **mais recente** que o horário acima,
outra coisa está usando aquele token (outro servidor, um Action, um MCP). Evidência em vez de memória.

---

## 8. ESPERANDO O ALF

*(itens 1–4 desta lista — Access, restart, revogação, OK do A5 — foram todos resolvidos em 09/08;
o que sobrou está abaixo.)*

1. **Colar o token novo do gateway** na UI do OpenClaw. O arquivo já foi entregue.

2. **A8 — rotacionar a `service_role` do TOM.** Adiado por decisão do Alf em 09/08. O sangramento
   foi estancado (repo privado), mas **a chave continua viva**. Plano pronto na §3.

### RESOLVIDO 09/08 21:30 — onde o `gov/` e o `laudo/` ficam guardados

Estavam **em um lugar só, a VPS**: a allowlist do `backup-to-github-safe.sh`
(`docs-inbox-applied docs scripts bridges skills tools`) não incluía nenhum dos dois.

Alf fechou o `LucianoAlf/maria-backup` (agora **privado**) e eu adicionei um bloco próprio para
`gov` e `laudo` — separado do loop existente, para não mudar o que já era copiado.

**Por que bloco próprio:** o rsync original exclui `.env*`, `*.key`, `*.pem`, `*.token` — mas
**não exclui `.log` nem `.txt`**. Incluir `laudo/` no loop comum versionaria o `ultima-saida.txt`,
que é **o laudo financeiro real da empresa**. O bloco novo exclui estado e saída explicitamente.

Provado no push `c8cacaf..e2d3e78`: subiram os 6 arquivos de código
(`gov/placar-governanca{,.test}.mjs`, `laudo/{laudo-diario.sh,laudo-vigia.sh,enviar-whatsapp.py,laudo-prompt.md}`)
e o controle negativo passou — `ultima-saida.txt`, `ultima-entrega.json` e `laudo.log` ficaram de fora.

## 9. Passos do Cloudflare Access (A2)

`one.dash.cloudflare.com` → **Access** → **Applications** → **Add an application** → **Self-hosted**.

| Campo | Valor |
|---|---|
| Application name | `OpenClaw Gateway (Alfredo)` |
| Session Duration | **1 mês** (senão o celular pede login toda hora) |
| Subdomain | `agent` |
| Domain | `maestrosdagestao.com.br` |
| Path | vazio (protege tudo, inclusive `/health`) |

**Add policy:** nome `Alf`, Action **Allow**, Include → **Emails** → e-mail do Alf. Salvar.

- Não precisa configurar SSO: o **One-time PIN** por e-mail já vem por padrão.
- Se a conta nunca usou Zero Trust, há um onboarding único (nome de time). Gratuito até 50 usuários.
- Precisando de acesso programático depois, **não desligar o Access** — adicionar policy de
  **Service Auth** com service token.
- Nada nesta VPS chama o hostname (só `.md` e backups), então o Access não quebra nada aqui.
  Se houver automação **fora** da VPS batendo nele, quebra.

---

## 10. REGRA DE ATUALIZAÇÃO DESTE PAINEL

A cada checkpoint fechado, **antes de começar o próximo**:
1. Mudar o estado na tabela da trilha e escrever a **prova** — nunca "feito", sempre o que foi medido.
2. Atualizar a §2 (PRÓXIMO PASSO) com a ação seguinte e quem faz.
3. Registrar decisão nova na §5, com o motivo.
4. Fato novo e durável vai para a §6.

**A entrega nunca fica com o LLM:** todo checkpoint fecha com medição, não com afirmação.
