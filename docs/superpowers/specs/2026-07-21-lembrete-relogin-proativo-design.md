# Lembrete proativo de re-login do Claude — matar a janela degradada de madrugada

**Data:** 2026-07-21
**Validado com:** Alf (dono) — 2 decisões estruturais fechadas em brainstorm
**Status:** spec → revisão do Alf → plano
**Depende de:** Sentinela reativa (`src/rituals/claude-sentinel.js`, no ar 20/06) — esta feature é a camada *preditiva* (avisar ANTES) sobre a *reativa* (avisar DEPOIS) daquela. Ver memória `reference_tom_cli_auth_relogin`.

---

## 1. O problema

O token OAuth da assinatura Max **dedicada ao TOM** expira a cada ~8h e o CLI auto-refresca sozinho — **enquanto o refresh token vive.** Mas o refresh token morre server-side a cada ~30 dias (rotação/revogação). Quando morre, o próximo expiry do access token não é renovado, o Claude dá `401 Re-authenticate`, e o TOM cai no Codex (degradado). **Só re-login manual resolve** (nenhum refresh sob demanda salva).

Dois incidentes idênticos: **20/06 → 21/07 = ~31 dias** de intervalo, batendo com refresh de vida ~30d.

A Sentinela reativa (20/06) avisa o dono ~5min após a queda — mas o **estrago é a janela degradada de madrugada**: o token morre no boundary de expiry (~8h em 8h); se cai de madrugada, o TOM roda no Codex até alguém acordar e re-logar (21/07 foram ~6h45; 20/06 foram ~13h).

**Por que não dá pra medir "dias desde o re-login" pelo arquivo:** o `mtime` do `.credentials.json` é **poluído pelo auto-refresh** (reescrito a cada ~8h). No incidente 21/07 o arquivo estava "fresco" de 19:50 e mesmo assim o token morreu às 03:50. `mtime` = último *refresh*, não último *re-login*.

## 2. A ideia

Re-logar **proativamente a cada ~25 dias, em horário comercial.** Cada re-login mint um refresh token novo com ~30d de vida → se você renova aos 25d, ele nunca chega a morrer, e nunca de madrugada. Não previne a causa server-side; **desarma a janela noturna** movendo o re-login pra um horário controlado.

## 3. Decisões do Alf (fechadas em brainstorm 21/07)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Como medir "dias desde o re-login" | **Carimbo no re-login via wrapper.** Um script `tom-relogin.sh` faz login + backup + verifica canário + grava timestamp num marker. Determinístico, imune ao refresh. O alerta passa a ensinar esse comando. |
| 2 | Cadência do lembrete | **Nag diário em horário comercial.** A partir de ~25d, 1 lembrete/dia (9–18h BRT) até re-logar. Auto-encerra quando o carimbo renova. Baixo ruído (1×/dia, poucos dias/mês). |

## 4. O que JÁ existe (investigado no código — a spec não inventa API)

- **`src/rituals/claude-sentinel.js`** — Sentinela REATIVA. Roda a cada tick do dispatcher (~5min). Estado em `tom_provider_incidents` (o dispatcher é cron efêmero). Funções puras `decideSentinel` / `buildSentinelMessage` testadas isoladas. `_cfg(env)` lê knobs; `DEFAULTS.reloginCmd = 'ssh -t tom "HOME=/opt/LA-Organizer/.claude-tom claude auth login --claudeai"'`. O branch `pageType==='auth'` de `buildSentinelMessage` imprime esse comando cru.
- **Credenciais** em `/opt/LA-Organizer/.claude-tom/.claude/.credentials.json` — **fora do repo** (dir runtime do engine). Sobrevive ao `git reset --hard` do auto-deploy.
- **O dispatcher roda NO box** (VPS) → pode ler/escrever arquivos locais em `/opt/LA-Organizer/.claude-tom/`. Marker file persiste entre ticks tão bem quanto o banco (satisfaz "cron sem memória").
- **Gotchas do re-login manual (21/07):** (a) `ssh -t tom "..."` NÃO resolve de dentro do box (`Could not resolve hostname tom` — `tom` é alias local); (b) `pkill -f "auth login"` por SSH se suicida (o `-f` casa a própria linha remota); (c) o CLI 2.1.143 usa fluxo **paste-back** (imprime URL → autoriza no browser → cola o código de volta no MESMO processo; PKCE não deixa colar por fora).

## 5. Arquitetura — 3 peças, todas aditivas, sem migration

### 5.1 Wrapper `scripts/tom-relogin.sh` (novo)
Re-login turnkey e auto-verificável, roda no box:
```bash
#!/usr/bin/env bash
set -euo pipefail
export HOME=/opt/LA-Organizer/.claude-tom
CRED="$HOME/.claude/.credentials.json"
STAMP="$HOME/.last-relogin"

[ -f "$CRED" ] && cp -a "$CRED" "$CRED.bak.$(date +%s)"   # 1. backup
claude auth login --claudeai                              # 2. login (paste-back, TTY)
if timeout 60 claude -p ok >/dev/null 2>&1; then          # 3. canário REAL
  date -Iseconds > "$STAMP"
  echo "✅ Re-login verificado (canário ok). Lembrete zerado: $(cat "$STAMP")"
else
  echo "❌ Canário falhou após o login — NÃO carimbei. Rode 'HOME=$HOME claude -p ok' e veja o erro." >&2
  exit 1
fi
```
Mata 2 gotchas (backup manual + confiar no "Login successful" da tela). Do laptop: `ssh -t tom "/opt/LA-Organizer/scripts/tom-relogin.sh"`; de dentro do box: só o path.

### 5.2 Módulo `src/rituals/claude-relogin-reminder.js` (novo)
Irmão da Sentinela, MESMO padrão (puro + I/O fino). Não incha a Sentinela (concern distinto: preditivo vs reativo).
- `decideReloginReminder({ lastReloginMs, lastReminderMs, nowMs, thresholdDays, startHour, endHour, tz })` → `{ remind, daysSince, reason }` (§6).
- `buildReminderMessage({ daysSince, cmd })` → string PT-BR (§7).
- `runReloginReminder({ sendMessage, readStamps, writeReminderStamp, now, env })` → orquestrador: lê markers, decide, se `remind` manda no WhatsApp do dono e carimba `.last-relogin-reminder`. **NUNCA propaga erro** (o tick não pode quebrar por causa dele) — igual à Sentinela.
- Reusa `ownerPhone` (env `TOM_OWNER_ALERT_PHONE`, default Alf) e o `sendMessage` do dispatcher.
- Ligado no dispatcher ao lado de `runClaudeSentinel`.

### 5.3 Estado — 2 marker files em `/opt/LA-Organizer/.claude-tom/`
- `.last-relogin` — o **wrapper** escreve (`date -Iseconds`) no login verificado.
- `.last-relogin-reminder` — o **orquestrador** escreve quando manda um nag (dedup 1×/dia).

Ambos fora do repo → sobrevivem ao deploy. Sem tabela, sem migration. Conteúdo = string ISO; o **orquestrador** faz `Date.parse(conteúdo) → ms` antes de passar pra `decide` (que é pura e só lida com ms). Marker ausente → passa `null`.

### 5.4 Fix de brinde na Sentinela reativa
`DEFAULTS.reloginCmd` → `'ssh -t tom "/opt/LA-Organizer/scripts/tom-relogin.sh"'`. O branch `auth` de `buildSentinelMessage` ganha uma linha extra mostrando a forma de-dentro-do-box (`(se já estiver no box: /opt/LA-Organizer/scripts/tom-relogin.sh)`). Fix de TEXTO — `decideSentinel` e o estado ficam intactos.

## 6. `decideReloginReminder` — semântica exata (pura, TDD)

```
Defaults: thresholdDays=25, startHour=9, endHour=18, tz='America/Sao_Paulo'
brtHour(ms) = Number(Intl HH 24h em tz)      brtDate(ms) = 'YYYY-MM-DD' em tz  (determinístico dado ms)

1. lastReloginMs null      → { remind:false, daysSince:null, reason:'no-stamp' }   (fail-safe; orquestrador loga)
2. ageDays = (nowMs - lastReloginMs) / 86400000;  daysSince = floor(ageDays)
3. ageDays < thresholdDays → { remind:false, daysSince, reason:'fresh' }
4. brtHour(nowMs) < startHour || >= endHour → { remind:false, daysSince, reason:'off-hours' }
5. lastReminderMs != null && brtDate(lastReminderMs) === brtDate(nowMs) → { remind:false, daysSince, reason:'already-today' }
6. senão → { remind:true, daysSince, reason:'due' }
```
Fuso via `Intl.DateTimeFormat` (mesmo helper `_hhmm` da Sentinela). `endHour` exclusivo (18h já é fora). Dias **corridos** (a vida do token é calendário, não dias úteis).

## 7. Mensagens (puras, PT-BR)

**Nag (`buildReminderMessage`):**
```
🔑 *TOM — renova o login do Claude (2 min)*
Faz {daysSince} dias do último re-login. O token da Max vive ~30 dias e, se passar, morre de madrugada e o TOM cai no Codex (degradado) até alguém re-logar.

Renova agora — do teu terminal:
ssh -t tom "/opt/LA-Organizer/scripts/tom-relogin.sh"
(se já estiver dentro do box: /opt/LA-Organizer/scripts/tom-relogin.sh)
```
É alerta de **dono/infra**, não voz-de-colaborador → [[feedback_tom_comportamento_sagrado]] não se aplica (aquilo protege a voz do TOM PARA a equipe).

**Sentinela auth (ajuste):** mesma estrutura de hoje, só o comando vira o wrapper + a linha "de dentro do box".

## 8. Seed no deploy
Alf re-logou 21/07 ~07:35 BRT. No deploy, gravo `.last-relogin` = `date -Iseconds` (o re-login foi horas atrás; tolerante ao limiar de 25d). Baseline correto → 1º disparo ~15/08. Sem seed, `decide` retorna `no-remind` (fail-safe) e nunca cutucaria.

## 9. Zero-regressão

| Risco | Mitigação |
|---|---|
| Mexer na Sentinela reativa quebra a detecção | Só muda TEXTO (`reloginCmd` default + 1 linha na msg). `decideSentinel` e `tom_provider_incidents` intactos. Teste: `buildSentinelMessage({pageType:'auth'})` ainda contém o comando. |
| Novo módulo quebra o tick do dispatcher | Orquestrador engole erro e retorna (igual Sentinela). Se `require`/lógica falhar, loga e segue. |
| Markers somem (reset do box) | `decide` com `lastReloginMs=null` → `no-remind` (fail-safe, sem spam). Logado. |
| Nag vira spam | Dedup mesmo-dia-BRT (§6.5) + janela 9–18h. Máx 1/dia. Auto-para quando o carimbo renova. |
| Deploy reverte produção | `.deploy-hold` na raiz durante o WIP; deploy cirúrgico; SCP dos arquivos novos + seed do marker + restart; sem tocar em nada existente além do texto da Sentinela. |
| Wrapper afeta o engine em runtime | Não: é script manual, não é `require`d pelo engine. |

**Migration:** nenhuma. **Flag:** `TOM_RELOGIN_REMINDER_ENABLED` (default on) desliga o nag. **Knob:** `TOM_RELOGIN_REMIND_DAYS` (25).

## 10. Testes (TDD)

`src/rituals/claude-relogin-reminder.test.js` (`node --test`), funções puras:
1. Sem carimbo (`lastReloginMs=null`) → `remind:false, reason:'no-stamp'`.
2. Fresco (age 10d) → `remind:false, reason:'fresh', daysSince:10`.
3. Devido, 9h BRT, sem nag hoje → `remind:true, reason:'due'`.
4. Devido mas 08h BRT → `off-hours`. Devido mas 18h BRT → `off-hours` (limite exclusivo).
5. Devido mas já cutucou hoje (mesma data BRT) → `already-today`.
6. Devido, último nag foi ONTEM → `remind:true`.
7. Fronteira: exatamente 25.0d, 10h BRT, sem nag → `remind:true` (`>=`).
8. Determinismo de fuso: `nowMs` às 23h UTC (=20h BRT) → `off-hours`; às 12h UTC (=09h BRT) → dentro.
9. `buildReminderMessage`: `daysSince` renderiza; o comando do wrapper aparece.
10. Sentinela intacta: `buildSentinelMessage({pageType:'auth', reloginCmd})` contém o comando (regressão do fix de texto).

Orquestrador + wrapper + fiação no dispatcher: `node --check` + **dry-run na VPS** (forçar `nowMs`/marker antigo e ver o nag sair 1×; segundo tick no mesmo dia → silêncio).

## 11. Fora de escopo (YAGNI)
- Feriados / weekday-only (o nag diário já cobre folga; próximo dia pega).
- Tabela no banco pro estado (markers bastam).
- Re-login automático (impossível — precisa do browser/paste do Alf).
- Detectar a rotação do refresh token server-side (causa fora do nosso controle).
- Segundo `.env` knob pra janela de horas (hardcode 9–18 com constantes nomeadas; vira knob só se pedir).
