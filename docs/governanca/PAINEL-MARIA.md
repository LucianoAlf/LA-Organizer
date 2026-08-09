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
| — | **Conferir amanhã 07:00** se o laudo chegou sozinho (primeira rodada automática) | ALF + Claude |
| **B1** | Fundações: 4 tabelas `maria_gov_*` + RPCs + ator técnico + placar | Claude |
| — | Colar o **token novo do gateway** na UI (arquivo já entregue) | **ALF** |

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
| **B0** | Migrar o laudo para a Maria + entrega no WhatsApp dela | ✅ **FECHADO 09/08 17:33** | — |
| **B1** | 4 tabelas `maria_gov_*` + RPCs + ator técnico + placar | ⏸️ | B0 |
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

1. **Ligar o Cloudflare Access** (A2) — passos na §9.
2. **Dar o sinal do restart** (A3) — derruba o Alfredo por segundos.
3. **Revogar os 7** usando a digital da §7 (A4) — esta semana.
4. **OK explícito** para apagar arquivo, quando chegar o A5.

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
