# 🧭 PAINEL — Governança da Maria

> **Documento único de controle.** Se você está perdido, leia só as duas primeiras seções.
> Atualizado a cada checkpoint fechado. Última atualização: **09/08/2026 16:10 BRT**.

---

## 1. ONDE ESTAMOS

A missão original é o **Loop de governança da Maria** (Trilha B). Ela está **pausada** porque a
auditoria de acesso que a antecedia encontrou um problema de segurança que precisa fechar antes —
isso virou a **Trilha A**, que é onde estamos hoje.

**Motivo da pausa, em uma frase:** a Fatia 0 do Loop moveria o laudo para dentro do ambiente onde
mora um token que alcança 6 projetos Supabase — migrar sabendo disso seria aumentar a exposição de
propósito.

## 2. PRÓXIMO PASSO

| # | O quê | Quem faz |
|---|---|---|
| **A1** | Ligar **Cloudflare Access** no hostname `agent.maestrosdagestao.com.br` | **ALF** (dashboard) |
| **A3** | Restart único com 3 mudanças — **esperando o sinal do Alf** | Claude, sob autorização |

Nada foi alterado em produção até aqui. Tudo na Trilha A foi leitura.

---

## 3. TRILHA A — Segurança (em andamento)

| ID | Checkpoint | Estado | Quem | Prova de fechamento |
|---|---|---|---|---|
| **A0** | Fechar `toolsAllow` do laudo V1A | ✅ **FECHADO** | Claude | 32 → 3 ferramentas, validado por execução forçada |
| **A1** | Auditoria de acesso e raio de credencial | ✅ **FECHADO** | Claude | Inventário na §6 |
| **A2** | Cloudflare Access no hostname do gateway | 🔴 **ABERTO** | **ALF** | Claude prova de fora: requisição não autenticada para de devolver 200 |
| **A3** | Restart único: `bind`→loopback + rotacionar token do gateway + apagar linhas mortas de PAT | 🔴 **ABERTO** | Claude, **espera sinal** | curl no hostname público volta 200; `check-agentes.py` segue ok; grep prova linhas ausentes |
| **A4** | Revogar os 7 PATs sem consumidor (usando a digital da §7) | 🔴 **ABERTO** — esta semana | **ALF** | Claude re-roda liveness e mostra **401** |
| **A5** | Limpar `bash_history`, sessões e backups com token em claro | ⏸️ depois do A4 | Claude | grep volta vazio. **Exige OK explícito — é apagar dado** |
| **A6** | Rebaixar o Alfredo: usuário próprio, sem sudo, copiando a Maria | ⏸️ plano próprio | Claude | `ps -o user=` mostra não-root |
| **A7** | Contenção por SO na Maria (`maria-ingest`) | ⏸️ pode virar dispensável se B entrar | Claude | agente da Maria não lê o env |

### Detalhe do A3 — as três mudanças do restart

1. `gateway.bind`: `"lan"` → `"loopback"` em `/root/.openclaw/openclaw.json`. O túnel aponta para
   `localhost:18789`, então o Cloudflare continua chegando. **Verificado:** zero conexões
   estabelecidas de fora do loopback (amostra pontual).
2. Rotacionar `gateway.auth.token` — vazou no transcript por bug de redação do Claude.
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
| **B0** | Migrar o laudo do gateway do Alfredo para o da Maria + entrega no WhatsApp dela | ⏸️ **PAUSADA** | B-opçãoB |
| **B1** | 4 tabelas `maria_gov_*` + RPCs + ator técnico + placar | ⏸️ | B0 |
| **B2** | Sonda no webhook + verificador de outra família + gate determinístico + held-out | ⏸️ | B1 |
| **B3** | Loop operacional (só dado/estado) | ⏸️ | B2 |
| **B4** | Suíte + golden-file + fixtures | ⏸️ | B3 |
| **B5** | Escada append-only | ⏸️ | B4 |

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

---

## 6. FATOS PROVADOS (base do plano — não refazer, consultar)

### Credenciais
**15 tokens `sbp_` distintos** na VPS; **8 vivos**, 7 mortos (401). Só **um** tem consumidor em código.

| sha256(12) | projetos | conta | consumidor |
|---|---|---|---|
| `bd00d3…` | 6 | producoes.emla | **SIM** — `superfolha_sql.py` (maria *e* root) + `maria_financeiro_email_ingest.py` |
| `9fce17…` | 7 | la.tecnology.system | nenhum |
| `0a8107…` | 7 | la.tecnology.system | nenhum |
| `6e5b72…` | 7 | la.tecnology.system | nenhum (órfão) |
| `21253b…` | 7 | contatosalf | nenhum (órfão) |
| `1a9e95…` | 2 | **lucianoalf.la — conta pessoal do Alf** | nenhum |
| `3643b6…` | 2 | supa.lamusic | nenhum |
| `d05979…` | 1 | la.music.journey | nenhum |

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

| conta | horário BRT | projetos | era |
|---|---|---|---|
| la.tecnology.system | **15:49:53** | 7 | `LAREPORT_SUPABASE_ACCESS_TOKEN` |
| lucianoalf.la (**pessoal**) | **15:51:08** | 2 | `SUPABASE_LAHQ_ACCESS_TOKEN` |
| la.tecnology.system | **15:52:23** | 7 | `STUDIOMANAGER_SUPABASE_ACCESS_TOKEN` |
| la.music.journey | **15:53:38** | 1 | `SUPABASE_ALFREDO_ACCESS_TOKEN` |
| la.tecnology.system | **15:54:54** | 7 | órfão (só em log) |
| supa.lamusic | **15:56:09** | 2 | estava em `/root/.openclaw/.env` |
| contatosalf | **15:57:24** | 7 | órfão (só em backup) |
| producoes.emla | 15:58:39 | 6 | `FOLHAPAGAMENTO` — **NÃO revogar**, tem consumidor |

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
