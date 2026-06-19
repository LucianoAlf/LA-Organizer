# Paralelismo real do CLI `claude` via HOME isolado por worker + refresh OAuth central

- **Data:** 2026-06-19
- **Autor:** Claude Code (brainstorm com Alf)
- **Status:** Direção e parâmetros **APROVADOS** por Alf (2026-06-19). Aguardando: (1) execução do roteiro de experimentos da Fase 0; (2) validação do procedimento de re-login; (3) revisão desta spec pelo Alf. **Nenhum código entra no fluxo real do WhatsApp até os gates passarem.**
- **Known issue relacionada:** `AI-TIMEOUT-120S-QUEUE-STALL` (tabela `tom_known_issues`, projeto `cesnbnrynvxvgdhfmaua`).

---

## 1. Problema

As chamadas ao CLI `claude` (`src/ai/claude.js`) são **serializadas** por um mutex em memória (`_claudeQueue`). Quando várias pessoas mandam mensagem ao mesmo tempo, a latência **empilha**: a N-ésima mensagem espera N× a latência das anteriores. Foi um dos fatores do "TOM escrevendo a vida toda".

O mutex existe por um motivo real (Sprint 26): dois `claude -p` concorrentes abriam o mesmo `~/.claude.json` e o último a fechar **truncava** o arquivo (virava ~50 bytes), corrompendo a config e deixando o TOM mudo nas mensagens seguintes. Backups corrompidos em `.claude-tom/.claude/backups/.claude.json.backup.*` confirmaram o padrão.

O timeout já caiu de 120s→60s (15/06), o que ameniza o pior caso, mas **não resolve o empilhamento** — a fila continua serial.

**Objetivo:** dar a cada execução concorrente um HOME isolado para que não compartilhem o mesmo `.claude.json`, e então remover a serialização do caminho comum — **sem quebrar a autenticação**.

---

## 2. Achados da investigação (2026-06-19, tudo read-only)

### 2.1. O arquivo que corrompe ≠ o arquivo que autentica

| Arquivo (dentro de `/opt/LA-Organizer/.claude-tom`) | Tamanho | Papel | Reescrito quando? |
|---|---|---|---|
| `.claude.json` | ~29 KB | config/estado: `projects`, caches (`additionalModelCostsCache` etc.), `numStartups`, `oauthAccount` (metadata), `userID` | **A cada execução do CLI** (auto-memory, plugin sync, prefetches) → é o que vira "50 bytes" no race |
| `.claude/.credentials.json` | 471 B | **as credenciais OAuth**: `claudeAiOauth.{accessToken, refreshToken, expiresAt, rateLimitTier, scopes, subscriptionType}` | Só quando o `accessToken` expira e é **refrescado** |

- `subscriptionType: "max"`, scopes OAuth de `claude_code`. **É um login OAuth de assinatura Claude (plano Max) dedicado ao TOM — não é API key nem a conta pessoal do Alf no dia a dia.** Implicação de risco: o pior caso de uma quebra de auth é "TOM mudo até reautenticar", não perda de recurso pessoal do Alf.
- `expiresAt` ≈ hoje + ~3h → o `accessToken` tem validade de **poucas horas** e o CLI **auto-refresca** quando roda perto da expiração, reescrevendo o `.credentials.json`.
- `CLAUDE_CODE_OAUTH_TOKEN` **não** está no `.env` (só um `# ...EXPIRED` comentado). A auth de produção vem **100% do arquivo** `.credentials.json`. O ramo `if (process.env.CLAUDE_CODE_OAUTH_TOKEN)` do `buildEnv()` nunca dispara hoje. Histórico (`docs/provider-fallback.md:103`): já usaram o env-var, ele expirou e deixou o TOM mudo; migraram pro OAuth de arquivo **porque ele auto-refresca**.

### 2.2. Ambiente

- **CLI:** `2.1.143 (Claude Code)`.
- **VPS:** 4 cores, 16 GB RAM, load avg ~0.06, processo `tom` usa ~90 MB. Folga ampla para vários `claude -p` paralelos (o gargalo é espera de rede da API, não CPU local).
- **Fallback Codex** (`src/ai/openai.js`) usa `env: process.env` (HOME real do node, **independente** do `.claude-tom`) → se a auth do Claude cair, o Codex degrada em vez de silenciar.
- **`--bare`** (flag nova) força auth estritamente via `ANTHROPIC_API_KEY`/`apiKeyHelper` e *"OAuth and keychain are never read"* → **inutilizável** para nós (perderíamos o plano Max). Mas confirma o que escreve no `.claude.json` (auto-memory, plugin sync, prefetches) — isolar o HOME mata o race de forma limpa.

### 2.3. Reautenticação (subcomandos confirmados via `--help`)

- `claude auth login --claudeai` → login na assinatura Claude (caso do TOM). Interativo.
- `claude auth status [--json|--text]` → status da auth (read-only). Bom candidato a **canário**.
- `claude auth logout` → logout.
- `claude setup-token` → token de longa duração (foi o caminho que expirou e quebrou antes → **desaconselhado**).
- **Não existe** `claude auth refresh` → não há comando dedicado para refrescar sem inference; o refresh acontece "por carona" numa chamada real.

---

## 3. Objetivo e não-objetivos

**Objetivo:** permitir até **K** execuções `claude -p` simultâneas (cada uma em HOME isolado), eliminando o empilhamento serial, mantendo a auth OAuth Max estável.

**Não-objetivos (nesta entrega):**
- Não reimplementar o fluxo de refresh OAuth (deixamos o CLI fazer).
- Não migrar para `ANTHROPIC_API_KEY`/`setup-token`.
- Não mexer no fluxo real do WhatsApp, em produção, nem reiniciar o PM2 na Fase 0.
- Não forçar rotação real de refresh token com a credencial do TOM.

---

## 4. Decisões aprovadas (Alf, 2026-06-19)

1. **HOME isolado por worker.**
2. **Refresh central no CANON** (um único caminho serializado mantém o `.credentials.json` fresco; os workers só consomem cópia de token válido e não refrescam).
3. **Kill-switch `TOM_CLAUDE_PARALLEL`**, **default OFF** (ausência/0 = comportamento serial idêntico ao de hoje).
4. **K = 2** para começar (configurável por env).
5. **Refresh slack = 30 min** (refrescar o CANON quando faltar <30 min para `expiresAt`).

---

## 5. Arquitetura

### 5.1. Modelo: 1 CANON + pool de workers, refresh "por carona"

```
chat()/chatRaw()
      │
      ▼
getValidToken()  ── lê expiresAt do CANON/.claude/.credentials.json
      │
      ├── token com folga (> slack) ──────────────► leaseWorker() ──► spawn paralelo
      │                                              (semáforo de K slots;
      │                                               sincroniza cópia do
      │                                               .credentials.json no worker;
      │                                               1 spawn por worker por vez)
      │
      └── token perto de expirar (< slack) ───────► canonLock (mutex SÓ p/ isto)
                                                     roda 1 chamada no CANON →
                                                     CLI auto-refresca o token;
                                                     concorrentes aguardam e
                                                     depois caem no pool com token novo
```

- **CANON** = `/opt/LA-Organizer/.claude-tom` (o de hoje). É o **único** lugar que refresca o `.credentials.json`. Serializado por `canonLock` (papel herdado do `_claudeQueue`, mas acionado ~1×/3h, não a cada mensagem).
- **WORKERS** = `/opt/LA-Organizer/.claude-tom-w0 .. .claude-tom-w{K-1}` (persistentes). Cada um tem `.claude.json` próprio (descartável; 1 escritor por vez via lease → sem corrupção) e recebe **cópia** (471 B) do `.credentials.json` fresco do CANON. Rodam com token válido → **não refrescam** → não disparam rotação.
- **Canário de auth:** `claude auth status --json` (HOME do CANON) no boot e antes de ligar a flag.

### 5.2. Componentes no código (`src/ai/claude.js`) — Fase 1, todos atrás da flag OFF

| Função | Responsabilidade |
|---|---|
| `buildEnv(home)` | passa a receber o HOME (hoje fixo); monta env por-worker |
| `ensureWorkerHomes()` | no boot, cria os K HOMEs + 1ª cópia das credenciais (idempotente) |
| `getValidToken()` | lê `expiresAt`; decide pool vs refresh-no-CANON |
| `acquireSlot()` / `releaseSlot()` | semáforo de K (caminho comum, substitui o `_claudeQueue` serial) |
| `syncCredsToWorker(home)` | copia `.credentials.json` do CANON → worker se mudou (compara mtime/`expiresAt`) |
| `canonLock` | mutex reaproveitado só para o refresh no CANON |

`chat()` e `chatRaw()` compartilham a mesma mecânica. **Quando `TOM_CLAUDE_PARALLEL` ≠ 1, o código cai no caminho serial atual (`_claudeQueue`) intacto.**

### 5.3. Parâmetros (env)

| Parâmetro | Valor inicial | Env |
|---|---|---|
| Paralelismo (kill-switch) | **OFF** | `TOM_CLAUDE_PARALLEL` (=1 liga) |
| Tamanho do pool **K** | **2** | `TOM_CLAUDE_POOL_SIZE` |
| Folga de refresh | **30 min** | `TOM_CLAUDE_REFRESH_SLACK_MS` |

### 5.4. Hipóteses a validar nos experimentos (não são fatos ainda)

- **H1:** worker com token em folga **não** refresca (não reescreve o `.credentials.json`). → Exp 2.
- **H2:** worker autentica só com `.credentials.json` (sem precisar do `.claude.json` do CANON); se precisar, copiamos um `.claude.json` mínimo. → Exp 2.
- **H3:** K=2 spawns em HOMEs isolados **não** corrompem nenhum arquivo (nem do worker, nem do CANON). → Exp 3.
- **H4:** há ganho de latência mensurável sob concorrência. → Exp 4.
- **H5:** classificar se o `refreshToken` **rotaciona** no refresh natural. (Design já é robusto a rotação; isto é confirmação.) → Exp 5.
- **H6:** `claude auth status` é read-only (não dispara refresh). → Exp 2 (observação).

---

## 6. Procedimento de reautenticação — **GATE de rollout**

> Sem este procedimento validado, **não há rollout** (exigência do Alf). O TOM autentica 100% via `/opt/LA-Organizer/.claude-tom/.claude/.credentials.json`; se esse arquivo for invalidado, o TOM fica mudo (com Codex de fallback) até reautenticar.

### 6.1. Caminho recomendado — `claude auth login --claudeai`

Na VPS (headless), o fluxo é device-code: o CLI imprime uma URL + código; o Alf abre no navegador, autoriza com a conta Max do TOM, e cola o código de volta. Reescreve o `.credentials.json` no lugar certo.

```bash
# reautenticar a conta do TOM (regrava /opt/LA-Organizer/.claude-tom/.claude/.credentials.json)
ssh tom
HOME=/opt/LA-Organizer/.claude-tom CLAUDE_HOME=/opt/LA-Organizer/.claude-tom/.claude \
  claude auth login --claudeai
# seguir o device-code; ao final, validar:
HOME=/opt/LA-Organizer/.claude-tom claude auth status --json
```

> **A validar na Fase 0/1 (sem quebrar a auth atual):** confirmar com o Alf que ele consegue completar esse device-code (acesso ao navegador com a conta certa). Idealmente ensaiar o login num HOME de teste descartável **antes** de depender dele em prod. O login real no CANON só se/quando a auth quebrar.

### 6.2. Canário (read-only)

```bash
HOME=/opt/LA-Organizer/.claude-tom claude auth status --json
```
Usar no boot do engine e antes de ligar `TOM_CLAUDE_PARALLEL=1`. Se não estiver autenticado → não ligar a flag; alertar.

### 6.3. Alternativa desaconselhada — `setup-token`

`claude setup-token` gera um token de longa duração para `CLAUDE_CODE_OAUTH_TOKEN`. **Foi exatamente o caminho que expirou e deixou o TOM mudo** (`docs/provider-fallback.md:103`). Documentado só como último recurso; não é o caminho-padrão.

### 6.4. Backup / restore das credenciais

```bash
# backup (antes de qualquer experimento)
ssh tom 'cp -a /opt/LA-Organizer/.claude-tom/.claude/.credentials.json \
  /opt/LA-Organizer/.claude-tom/.claude/.credentials.json.bak.$(date +%s)'
# restore (se algo invalidar o CANON)
ssh tom 'cp -a <backup> /opt/LA-Organizer/.claude-tom/.claude/.credentials.json'
```

---

## 7. Roteiro de experimentos — **Fase 0** (aprovado; só `/tmp` + cópia das credenciais do CANON)

> **Risco honesto:** estes experimentos **não tocam o fluxo real do WhatsApp**, mas **não são "zero risco"** — copiar o `.credentials.json` para um HOME de teste carrega o **`refreshToken` real**; se o CLI de teste decidir refrescar, pode disparar rotação e afetar a auth real no servidor. Risco **baixo**, não nulo. (Sem efeito na auth de fato, porque não rodam o CLI: Exp 1, que só faz `cp` de backup, e Exp 5, que só lê + hasheia.)

**Gate de `expiresAt` (obrigatório antes de Exp 2/3/4):** ler o `expiresAt` do CANON e **só rodar se houver > 2 h de folga**. Se faltar menos, **aguardar o CANON refrescar naturalmente** e só então testar. Com > 2 h de folga o CLI de teste não refresca → qualquer mudança no `refreshToken` do CANON denuncia que um worker disparou rotação.

**Protocolo por rodada (Exp 2/3/4):** registrar `sha256(refreshToken do CANON)` **antes e depois** de cada rodada. Igual = CANON intacto, nenhum worker rotacionou. Diferente (com folga > 2 h) = **alerta**, parar tudo.

**Proibições nesta fase:** nenhum deploy, nenhum `scp` pro fluxo real, nenhum `pm2 restart`, nenhum código novo no engine, nenhuma rotação forçada com a credencial real.

### Exp 1 — Backup do CANON (só `cp` local; não roda o CLI, sem efeito na auth)
Copiar `.credentials.json` (e `.claude.json`) para `.bak.<ts>` na VPS (ver §6.4). Rede de segurança.

### Exp 2 — HOME de teste: auth fora do `.claude-tom` (baixo risco — carrega o refreshToken real)
```bash
ssh tom '
TS=$(date +%s); D=/tmp/tomtest-w0
mkdir -p $D/.claude
cp -a /opt/LA-Organizer/.claude-tom/.claude/.credentials.json $D/.claude/
md5sum $D/.claude/.credentials.json            # ANTES
printf "responda apenas: OK" > /tmp/sp-$TS.txt
HOME=$D CLAUDE_HOME=$D/.claude claude -p "ping" --model sonnet --output-format json \
  --strict-mcp-config --mcp-config "{\"mcpServers\":{}}" --tools "" \
  --append-system-prompt-file /tmp/sp-$TS.txt | head -c 400
echo; md5sum $D/.claude/.credentials.json      # DEPOIS (mudou = refrescou)
ls -la $D $D/.claude
'
```
**Observar:** autenticou? (`is_error`/`result`). O md5 da credencial **do worker** mudou? (H1) O CLI exigiu `.claude.json`? (H2 — o teste já roda **sem** copiar nada além do credentials). `auth status` num HOME de teste muda a credencial? (H6). **Prova do CANON:** `sha256(refreshToken do CANON)` antes e depois — deve ficar **igual** (CANON intocado).

### Exp 3 — K=2 spawns paralelos em HOMEs de teste (baixo risco)
Criar `/tmp/tomtest-w0..w1` com cópia das credenciais; disparar **K=2** `claude -p` simultâneos; repetir **≥20 rodadas**. Após cada rodada: (a) validar que **todo** `.claude.json`/`.credentials.json` dos workers continua JSON válido e com tamanho coerente (não "50 bytes") e que todas as respostas vieram; (b) registrar `sha256(refreshToken do CANON)` **antes/depois** (deve ficar igual). → prova de H3 / requisito #2. **K=3/4 fica como experimento posterior, fora do Gate A** (o rollout inicial é K=2).

### Exp 4 — Latência: pool vs serial (baixo risco)
Cronometrar o wall-clock de K mensagens simultâneas (a) pela fila serial (baseline, 1 HOME) e (b) pelo pool (K HOMEs). Reportar p50/p95 e o fator de melhora. Baseline conhecido: floor do CLI ~2.4s, prod 8–12s. → requisito #3.

### Exp 5 — Rotação do refresh token, **passiva** (só leitura + hash; não roda o CLI)
```bash
# snapshot do HASH (nunca o valor cru) do refreshToken do CANON, antes e depois de ~3h
ssh tom 'jq -r ".claudeAiOauth.refreshToken" \
  /opt/LA-Organizer/.claude-tom/.claude/.credentials.json | sha256sum'
```
Comparar o hash antes/depois de um ciclo natural de refresh do CANON. Hash mudou → **rotaciona**; igual → **estável**. Não força refresh, não copia o refreshToken para lugar nenhum. → H5.

> Rotação **forçada** com a credencial real do TOM foi descartada por decisão do Alf — só a observação passiva acima.

---

## 8. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Um worker refresca e a rotação invalida o `refreshToken` do CANON | Baixa (design impede worker de refrescar) | Alto (TOM mudo até re-login) | Refresh central; workers só com token em folga; Exp 2 mede H1; Exp 5 classifica rotação; backup (Exp 1) |
| R2 | CLI refresca proativamente mesmo com folga (janela interna desconhecida) | Média | Alto | Exp 2 mede; se ocorrer → aumentar slack, ou `chmod 444` na credencial do worker, ou tornar o worker read-only do credentials |
| R3 | Corrupção do `.claude.json` por 2 spawns no MESMO worker | Baixa | Médio | Semáforo garante 1 spawn por worker por vez (lease estrito) |
| R4 | Esgotar CPU/RAM com K spawns | Baixa (4core/16GB, K=2) | Médio | K=2 conservador e configurável; medir no Exp 3 |
| R5 | Rate limit da conta Max sob paralelismo | Média | Médio | observar 429; Codex fallback; K baixo; `rateLimitTier` presente |
| R6 | Flag ligada por engano num deploy | Baixa | Alto | `default OFF` explícito; só liga manual, com Alf |
| R7 | Codex fallback cair junto com o Claude | Baixa | Alto (mudo total) | Codex usa env/HOME próprio, independente do `.claude-tom` |
| R8 | `auth login` device-code intransponível (sem acesso ao navegador certo) | Baixa | Alto (não recupera) | validar §6.1 com Alf **antes** do rollout; manter backup do credentials |

---

## 9. Rollback (por fase)

- **Fase 0 (experimentos):** não altera o fluxo real. Reverter = `rm -rf /tmp/tomtest-*` + apagar os `.bak`. Se (improvável) um worker rotacionou o token (hash do refreshToken do CANON mudou), restaurar `.credentials.json` do backup (Exp 1) ou re-logar (§6.1).
- **Fase 1 (código atrás da flag OFF):** comportamento idêntico ao de hoje (flag OFF). Reverter código = re-`scp` da versão anterior de `claude.js` (guardar cópia antes de editar).
- **Fase 2 (flag ON):** reverter = `TOM_CLAUDE_PARALLEL=0` no `.env` + `pm2 restart tom` (segundos, **sem deploy de código**). Se a auth quebrou: `claude auth login --claudeai` no CANON (§6.1) + restart.

---

## 10. Critérios de aprovação (gates)

- **Gate A — experimentos → código:** Exp 2 autentica fora do `.claude-tom`, worker não refresca com folga (H1 ok) **e** `sha256(refreshToken do CANON)` inalterado; Exp 3 com **zero** corrupção em ≥20 rodadas **com K=2** (suficiente — o rollout inicial é K=2; **K=3/4 não é gate**) **e** refreshToken do CANON inalterado em todas as rodadas; Exp 4 mostra ganho de latência mensurável sob concorrência; Exp 5 classifica a rotação (sim/não).
- **Gate B — código atrás da flag OFF:** Gate A ok **+** esta spec revisada pelo Alf **+** procedimento de re-login (§6) validado (Alf confirma que consegue completar o `auth login`).
- **Gate C — ligar a flag em produção:** Gate B ok **+** Alf presente **+** backup do CANON feito **+** canário `auth status --json` verde **+** plano de reversão (§9) à mão. Registrar resultado em `tom_known_issues` (`AI-TIMEOUT-120S-QUEUE-STALL`).

---

## 11. Plano de rollout faseado

| Fase | O que | Toca produção? |
|---|---|---|
| **0** | Experimentos (§7) em `/tmp` + cópia das credenciais | Não toca o fluxo real; carrega refreshToken real (baixo risco) |
| **1** | Implementar §5.2 atrás da flag (default OFF) + testes unitários; deploy com flag OFF (comportamento idêntico) | Deploy do código, mas comportamento inalterado |
| **2** | Ligar `TOM_CLAUDE_PARALLEL=1` com Alf presente; observar `pm2 logs` por ≥1 ciclo de refresh (~3h) | Sim (reversível por flag) |
| **3** | Subir K se estável; registrar em `tom_known_issues` | Sim |

---

## 12. Resultados da Fase 0 — executada em 2026-06-19 (Alf presente)

Ambiente: VPS, CLI 2.1.143, token com folga 5,2h→4,7h durante os testes. CANON conferido por hash **antes/depois de cada experimento** — inalterado em 100% das medições (`refreshToken` jq-r=`2326376d…`, jq-j=`86c9ad81…`; `.claude.json` 29.245 B válido; `expiresAt` `1781906408875` constante). Salvaguarda extra adotada na execução: cred copiada pros workers em **`chmod 444`** (impede fisicamente o worker de refrescar/rotacionar).

| Exp | O que | Resultado bruto | Hipótese |
|---|---|---|---|
| 1 | Backup do CANON | `.bak.1781887636` (471 B + 29.245 B) | — |
| 2 | Auth em HOME isolado (cred 444) | `is_error:false`, `result:"OK"`, 1,77 s; worker criou `.claude.json` próprio (25,8 KB) | **H1 ✅** (não refresca c/ folga) · **H2 ✅** (basta `.credentials.json`) |
| 3 | K=2 paralelo, 20 rodadas (40 spawns) | 20/20 OK, zero corrupção, CANON intacto por rodada | **H3 ✅** |
| 4 | Latência serial vs pool K=2, N=20 | serial p50 **5557 ms** / pool p50 **2809 ms** → **1,98× no p50** (p95 7911→3946; max 8913→4494) | **H4 ✅** |
| 5 | Rotação passiva | baseline gravado; aguardando refresh natural (~`expiresAt`, 21h30) | pendente |

**Nota — backups internos de 50 B nos workers** (`/tmp/tomtest-w*/.claude/backups/.claude.json.backup.*`): cada worker teve **exatamente 1**, com conteúdo `{"firstStartTime":"…"}`. É o `.claude.json` **recém-criado** (só o 1º campo), salvo pelo mecanismo backup-antes-de-escrever do CLI **antes** de popular o arquivo (que chega a 26 KB, 15 chaves, válido). **Não é corrupção:** o arquivo cresce 50 B→26 KB e nunca regride; é o **oposto** do bug Sprint 26 (lá um `.claude.json` de 29 KB *regredia* pra ~50 B por escrita concorrente no HOME compartilhado, perdendo dados reais). Os backups do CANON seguem todos ~29 KB. Único por worker, não recorrente, não intercalado com tamanhos grandes.

**Gate A:** H1–H4 satisfeitas com **K=2**; falta só a classificação do Exp 5 (confirmatória, não bloqueante — o design já é robusto a rotação). **A implementação (Fase 1) aguarda nova aprovação do Alf.**

## 13. Fora de escopo / decisões adiadas

- Paralelismo dentro do próprio refresh (manter serial — é raro).
- Migração para `ANTHROPIC_API_KEY`/Bedrock/Vertex.
- Pool dinâmico/auto-scaling de K (começamos fixo).
- `--bare` (incompatível com OAuth).
