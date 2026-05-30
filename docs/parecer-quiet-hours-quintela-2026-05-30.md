# Parecer: Quintela recebendo cobrança antes das 11h (2026-05-30, sáb)

## Veredito: É BUG. A preferência está certa; o gate de silêncio está cego.

Não é o Quintela "trabalhando mais cedo". A janela de silêncio dele está
corretamente cadastrada — o problema é que **3 jobs de alerta buscam um SELECT
incompleto de `user_preferences`**, então o `isQuietNow` nunca enxerga a janela
horária e libera o envio.

## Evidência (código + dados)

**Preferência do Quintela (`user_preferences`, setada 29/05 16:16):**
- `quiet_start_time(_work/_personal) = 00:00`, `quiet_end_time(...) = 11:00`
- `quiet_days = [0]` (só domingo), `quiet_weekends = false`
- Ou seja: silêncio diário **00:00–11:00**, todo dia. Sábado incluído.

**Mensagem das 08:12 (tela) = `overdue_alert`:**
- `notifications`: "Avaliação de estagiários — Kinho atrasada 1d", `sent_at = 2026-05-30 08:12` (America/Sao_Paulo).
- Template bate com `buildOverdueText(title, 1, false)` → `dispatcher.js:3800`:
  `🔴 *${title}* atrasou 1 dia. Resolve hoje ou reagenda? Me responde aqui — pode ser áudio.`

**A falha — `checkOverdueAlerts` (`dispatcher.js`):**
- Linha **3837** (SELECT): busca só `user_preferences(notify_overdue_alerts, quiet_weekends, quiet_days, quiet_reason)`.
  **NÃO busca** `quiet_start_time*` nem `quiet_end_time*`.
- Linha **3865**: `isQuietNow(collab.user_preferences, nowSaoPaulo())` recebe esse objeto incompleto.
- Em `quiet-hours.js` → `windowFor`: como as colunas de horário não estão no objeto,
  `w.start`/`w.end` caem pra `null`. O check de janela (linha 89: `if (w.start && w.end)`)
  é **pulado inteiro**.
- Sábado: `weekends=false` e `days=[0]` não pegam dow=6 → `isQuietNow` devolve
  `quiet=false` → cobrança liberada às 08:12.

**O gate funciona — está sendo alimentado com dados incompletos.**

## Por que "já resolvemos e continua voltando"

Correções anteriores provavelmente mexeram em `quiet_days`/`quiet_weekends`
(colunas que ESSES SELECTs buscam) — e essas até pegam. Mas a **janela horária
00:00–11:00 nunca foi buscada por esses jobs**, então nunca surtiu efeito. A
preferência foi salva certa toda vez; o job de alerta é que é cego pra ela.

## Escopo: não é só o overdue, nem só o Quintela

SELECTs incompletos (faltam `quiet_start_time*`/`quiet_end_time*`) — mesma classe de bug:
- `dispatcher.js:3837` — `checkOverdueAlerts` (overdue) ← este caso
- `dispatcher.js:3653` — `checkDeadlineAlerts` (deadline)
- `dispatcher.js:4601` — (alerta agregado / overdue)

Qualquer pessoa com **só janela horária** (sem quiet_days/weekends) é cobrada por
esses 3 jobs dentro do horário de silêncio. Os demais jobs ou usam `user_preferences(*)`
(linhas 252, 448) ou já incluem `quiet_start_time, quiet_end_time` (782, 846, 907, 1911) — esses estão OK.

## Recomendação de fix (aguardando teu OK — NÃO mexi ainda)

**Opção A (recomendada): trocar os 3 SELECTs por `user_preferences(*)`.**
São batch jobs sobre ≤200 linhas — custo irrelevante, e elimina de vez a classe
"esqueci uma coluna no SELECT". Consistente com os jobs 252/448 que já fazem assim.

**Opção B (cirúrgica): adicionar as colunas faltantes** (`quiet_start_time, quiet_end_time` +
variantes `_work`/`_personal`) nos 3 SELECTs. Menos invasivo, mas mantém a fragilidade.

**Hardening sugerido (separado):** `windowFor` decide "tem contexto?" via `in prefs`.
Um SELECT parcial **silenciosamente desliga** a janela em vez de falhar. Vale uma
trava defensiva (ex.: logar/avisar quando o objeto não traz as colunas de horário),
pra um próximo SELECT incompleto não reabrir o mesmo buraco sem ninguém ver.

Com TDD: teste que prova `isQuietNow` → `quiet=true` pra Quintela às 08:12 de sábado
quando o job busca as prefs como em produção; depois aplico o fix.
