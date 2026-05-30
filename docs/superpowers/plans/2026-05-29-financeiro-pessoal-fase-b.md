# Finanças Pessoais — Fase B (Rituais + Educação + Selic) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans pra implementar task-a-task. Steps usam checkbox (`- [ ]`).

**Goal:** Rituais automáticos de finanças (mensal, lembrete de contas, relatório), seção financeira no briefing pessoal, skill de educação financeira e simulador de juros com Selic viva do Banco Central.

**Architecture:** Os rituais financeiros que contêm NÚMERO são montados deterministicamente em código (builders puros + queries do `financeiro-service`) e enviados direto via `whatsapp.sendMessage` — NÃO renderizados pelo LLM (lição do Bug 3: LLM não toca em valor financeiro). A educação financeira é uma skill conversacional; o simulador é uma `FINANCE_ACTION` nova (`simulate_interest`) calculada pelo handler com `projection.js` (Fase A) + taxa Selic viva (serviço novo `selic.js`, BCB SGS + cache 24h + fallback).

**Tech Stack:** Node.js CommonJS, Supabase service_role, `fetch` nativo (sem axios), `node:test`, cron externo (crontab chama `node src/rituals/dispatcher.js` a cada 15 min).

---

## Convenções (iguais à Fase A)
- **Sem commit entre tasks** — Stop hook commita `_remote/`. Migrations via MCP (não há migration nesta fase). Deploy do engine via `scp` + `pm2 restart tom`.
- **CommonJS**, client `require('../supabase/client')`.
- **Números financeiros = código, nunca LLM.** Todo valor (saldo, %, contas, projeção) vem de builder/handler determinístico.
- **Quiet hours OBRIGATÓRIO nos 3 rituais.** Finanças é contexto **pessoal** → os 3 (lembrete_conta, financeiro_mensal, relatorio) gateiam em `isQuietNow(cid, now, 'personal')` e, se quiet, fazem `logRitualEvent(..., 'skipped', q.reason, ...)`. NÃO furar o silêncio de quem pediu sossego (não reabrir os vazamentos que o sprint anterior fechou).
- **Spec:** `docs/superpowers/specs/2026-05-29-financeiro-pessoal-design.md` (D1–D7, §6).
- **Fase A já entregou:** `src/finance/{categorize,budget-alert,projection}.js`, `financeiro-service.js`, marker `<<FINANCE_ACTION>>`, skill `financeiro-pessoal.md`. Esta fase REUSA `projection.js` e o `financeiro-service`.

## Padrões verificados (dispatcher.js)
- `RITUAL_BY_DIRECTIVE` (dispatcher.js:42) — map bidirecional `briefing_pessoal↔personal_briefing`.
- `logRitualEvent(collabId, type, status, detail, refDate)` (dispatcher.js:88).
- `timeToSlot(t)` (144) + `currentSlot(now)`; slot de 15 min.
- `fireRitual(collab, ritualType, ymd)` (330) — idempotente via `ritual_logs`, checa DND.
- Molde de ritual mensal (monthly_planning:275, monthly_closing:308): `const time = ...; if (currentSlot(now) !== timeToSlot(time)) continue; if (await alreadySent(c.id, type, ymd)) continue; quiet check; envia + logRitualEvent`.
- `alreadySent(collabId, type, ymd)` — idempotência por dia.
- HTTP: `fetch` nativo (ex. `src/services/audio.js`), com retry/backoff.

## File Structure (Fase B)
**Criar:**
- `src/services/selic.js` — fetch BCB SGS (Selic meta a.a.) + cache 24h + fallback constante.
- `src/services/selic.test.js` — testa cache hit/miss/fallback (com fetch injetado).
- `src/finance/ritual-messages.js` — builders puros das mensagens de ritual (mensal, lembrete, relatório, linha de briefing). Recebem dados já consultados, retornam string.
- `src/finance/ritual-messages.test.js`.
- `skills/educacao-financeira.md` — skill conceitual (molde `skills/pedagogico.md`), sem markers.

**Modificar:**
- `src/services/financeiro-service.js` — queries pros rituais: `billsDueWithin(collabId, days)`, `monthlyReport(collabId, refMonth)`, `collaboratorsWithActivity()`.
- `src/rituals/dispatcher.js` — 3 rituais novos + builders chamados deterministicamente.
- `src/engine.js` — action `simulate_interest` no `handleFinanceAction` + `FINANCE_ACTIONS`.
- `src/finance/projection.js` — (se preciso) helper `simulate(monthlyOrLump, years, annualRate)` reusando `futureValue`.
- `skills/financeiro-pessoal.md` — documentar a action `simulate_interest`.
- `skills/rituais-diarios.md` — nota de que a seção financeira do briefing é injetada por código.

---

## Task 1: Serviço Selic (BCB SGS + cache + fallback)

**Files:** Create `src/services/selic.js`, `src/services/selic.test.js`

> BCB SGS série 432 = "Meta Selic definida pelo Copom" (% a.a.). Endpoint: `https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json` → `[{ "data":"...", "valor":"10.50" }]`. Cache 24h em memória; fallback constante `10.5`.

- [ ] **Step 1: Teste (cache + fallback) com fetch injetado**

Criar `src/services/selic.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { makeSelicClient } = require('./selic');

test('busca e cacheia (1 fetch para 2 chamadas)', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: true, json: async () => [{ data: '29/05/2026', valor: '10.50' }] }; };
  const selic = makeSelicClient({ fetchImpl: fakeFetch, ttlMs: 60000, now: () => 1000 });
  assert.strictEqual(await selic.getAnnualRate(), 10.5);
  assert.strictEqual(await selic.getAnnualRate(), 10.5);
  assert.strictEqual(calls, 1, 'segunda chamada deve usar cache');
});
test('fallback para constante quando fetch falha e cache vazio', async () => {
  const fakeFetch = async () => { throw new Error('BCB down'); };
  const selic = makeSelicClient({ fetchImpl: fakeFetch, fallbackAnnual: 10.5 });
  assert.strictEqual(await selic.getAnnualRate(), 10.5);
});
test('monthlyRate converte a.a. -> a.m. (taxa equivalente)', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => [{ data: 'x', valor: '12.00' }] });
  const selic = makeSelicClient({ fetchImpl: fakeFetch });
  const m = await selic.getMonthlyRate();
  // (1.12)^(1/12)-1 ≈ 0.00949
  assert.ok(m > 0.0094 && m < 0.0096, `mensal inesperado: ${m}`);
});
```

- [ ] **Step 2: Rodar (falha)** — `node --test src/services/selic.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/services/selic.js`**
```js
// Selic viva do Banco Central (SGS serie 432, % a.a.) + cache + fallback. (spec D4)
const BCB_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json';

// Factory testável: injeta fetch/now pra teste; default usa globais reais.
function makeSelicClient({ fetchImpl = fetch, ttlMs = 86400000, now = () => Date.now(), fallbackAnnual = 10.5 } = {}) {
  const cache = { annual: null, expireAt: 0 };
  async function getAnnualRate() {
    if (cache.annual != null && now() < cache.expireAt) return cache.annual;
    try {
      const resp = await fetchImpl(BCB_URL);
      if (!resp.ok) throw new Error(`BCB HTTP ${resp.status}`);
      const arr = await resp.json();
      const v = Number(String(arr?.[0]?.valor).replace(',', '.'));
      if (!isFinite(v) || v <= 0) throw new Error('valor invalido');
      cache.annual = v; cache.expireAt = now() + ttlMs;
      return v;
    } catch (err) {
      console.error('[Selic]', err.message);
      return cache.annual != null ? cache.annual : fallbackAnnual;
    }
  }
  async function getMonthlyRate() {
    const a = await getAnnualRate();
    return Math.pow(1 + a / 100, 1 / 12) - 1; // taxa mensal equivalente (decimal)
  }
  return { getAnnualRate, getMonthlyRate };
}

const _default = makeSelicClient();
module.exports = { makeSelicClient, getAnnualRate: _default.getAnnualRate, getMonthlyRate: _default.getMonthlyRate };
```

- [ ] **Step 4: Rodar (passa)** — `node --test src/services/selic.test.js` → PASS (3).

---

## Task 2: Action `simulate_interest` (handler determinístico)

**Files:** Modify `src/engine.js`, `skills/financeiro-pessoal.md`; Test reusa `projection.js`.

> "se eu guardar R$300/mês por 10 anos, quanto tenho?" → o LLM emite `simulate_interest`; o handler calcula com `projection.futureValue` + Selic viva. NÚMERO no código (não LLM).

- [ ] **Step 1: Teste do cálculo (puro, reusa projection)**

Adicionar a `src/finance/projection.test.js`:
```js
test('simulação 300/mês 10 anos a 10,5%/ano > sem juros (36000)', () => {
  const i = Math.pow(1.105, 1/12) - 1;
  const fv = futureValue(300, i, 120);
  assert.ok(fv > 36000, `com juros deveria passar de 36000, veio ${fv}`);
  assert.ok(fv > 60000 && fv < 66000, `esperado ~62k, veio ${fv}`);
});
```
Rodar: `node --test src/finance/projection.test.js` (deve passar — `futureValue` já existe).

- [ ] **Step 2: Adicionar `simulate_interest` em `FINANCE_ACTIONS` e no handler**

Em `src/engine.js`, no array `FINANCE_ACTIONS` adicionar `'simulate_interest'`. No `handleFinanceAction`, novo case (usa `selicService` importado no topo: `const selic = require('./services/selic');`):
```js
    case 'simulate_interest': {
      const monthly = Number(p.monthly || params.monthly || 0);
      const years = Number(params.years || 0);
      if (!monthly || !years) return '❓ Me diz quanto por mês e por quantos anos.';
      const months = Math.round(years * 12);
      const annual = await selic.getAnnualRate();
      const i = Math.pow(1 + annual / 100, 1 / 12) - 1;
      const semJuros = monthly * months;
      const comJuros = Math.round(projection.futureValue(monthly, i, months));
      const ganho = comJuros - semJuros;
      return `🧮 Simulação: R$${monthly}/mês por ${years} ano(s)\n\nSó guardando: R$${semJuros}\nInvestindo a ${annual}%/ano: R$${comJuros}\n\nDiferença: R$${ganho} que o dinheiro trabalhou pra você. Bora? 💪`;
    }
```
> `projection` já está importado na Fase A (`const { ... } = require('./finance/projection')`); adicione `const projection = require('./finance/projection');` OU use os nomes já desestruturados (`futureValue`). Confirme o import existente antes de duplicar.

- [ ] **Step 3: Documentar na skill** — em `skills/financeiro-pessoal.md`, adicionar à lista de ações:
`- \`simulate_interest\` — params: monthly, years (simulação de juros compostos)`.

- [ ] **Step 4: Validar** — `node --check src/engine.js` → exit 0.

---

## Task 3: Skill `educacao-financeira.md`

**Files:** Create `skills/educacao-financeira.md`

> Conceitual, sem markers (molde `skills/pedagogico.md`). EXCEÇÃO: se o user pedir simulação concreta ("se eu guardar X..."), ela orienta a emitir `simulate_interest` (Task 2) — números pelo engine.

- [ ] **Step 1: Escrever a skill** (frontmatter + seções):
  - `## Quando ativar`: Selic, juros compostos, caixinha, poupança vs CDB, reserva de emergência, regra 50/30/20, "como investir", "vale a pena".
  - `## Tom`: nunca condescendente, sem jargão, conecta com a realidade ("você que ganha R$2.800...").
  - `## Tópicos` (tabela do PRD §7.1).
  - `## Selic`: "TOM nunca chuta a Selic — o valor vem do engine/serviço; se precisar citar, peça o número atual".
  - `## Simulador`: "para 'se eu guardar X por Y anos', emita `<<FINANCE_ACTION>>{action:'simulate_interest', params:{monthly, years}}<<END>>` — NÃO calcule você mesmo".
  - `## Regra`: sugiro, nunca mando ("já pensou em..."); sem promessa de rentabilidade.

- [ ] **Step 2: Gatilho no `pickSkill`** (`src/prompts/system.js`): adicionar após o `FINANCE_RE` (ou estender) um `EDU_FIN_RE` pra termos educacionais e carregar `educacao-financeira`:
```js
  const EDU_FIN_RE = /\b(selic|juros\s+compost|tesouro|cdb|poupan[çc]a|reserva\s+de\s+emerg|50\/30\/20|vale\s+a\s+pena\s+investir|como\s+investir|o\s+que\s+[ée]\s+(?:selic|cdb|tesouro))\b/i;
  if (EDU_FIN_RE.test(String(lastUserMessage || ''))) {
    return { name: 'educacao-financeira', body: loadSkill('educacao-financeira') };
  }
```
> Posicionar logo após o bloco FINANCE_RE. `node --check src/prompts/system.js`.

---

## Task 4: Queries de ritual no `financeiro-service.js`

**Files:** Modify `src/services/financeiro-service.js` (+ testes puros onde aplicável)

- [ ] **Step 1: Adicionar funções** (todas filtram por `collaborator_id`):
```js
// Contas a vencer nos proximos `days` dias (status derivado de last_paid_at, D6).
async function billsDueWithin(collaboratorId, days = 5) {
  const today = new Date();
  const dom = today.getUTCDate();
  const { data, error } = await supabase.from('pf_bills')
    .select('name, amount, due_day, type, last_paid_at, category')
    .eq('collaborator_id', collaboratorId).eq('is_active', true);
  if (error) throw error;
  const { start } = monthBounds();
  return (data || []).filter((b) => {
    const pagoEsteMes = b.last_paid_at && b.last_paid_at >= start;
    if (pagoEsteMes) return false;
    const aVencer  = b.due_day >= dom && b.due_day <= dom + days; // proximos `days` dias
    const atrasada = b.due_day < dom;                             // venceu este mes e nao foi paga (PRD §6.2) -> da vida ao mode 'atrasada'
    return aVencer || atrasada;
  });
  // EDGE (minor, virada de mes): conta com due_day no comeco do mes seguinte
  // (ex: dom=30, due_day=2) nao entra como "a vencer" deste ciclo. Aceitavel pro v1 — anotado.
}
// Relatorio do mes de referencia (default mes corrente).
async function monthlyReport(collaboratorId, ref = new Date()) {
  const { start, end } = monthBounds(ref);
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', start).lt('transaction_date', end);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter(r => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter(r => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCat = {};
  for (const r of rows) if (r.type === 'expense') porCat[r.category] = (porCat[r.category]||0)+Number(r.amount);
  const top = Object.entries(porCat).sort((a,b)=>b[1]-a[1]).slice(0,3);
  return { receitas, despesas, saldo: receitas - despesas, top, temAtividade: rows.length > 0 };
}
// Colaboradores com >=1 transacao (alvo dos rituais financeiros).
async function collaboratorsWithActivity() {
  const { data, error } = await supabase.from('pf_transactions').select('collaborator_id');
  if (error) throw error;
  return [...new Set((data || []).map(r => r.collaborator_id))];
}
```
Adicionar ao `module.exports`. `node --check src/services/financeiro-service.js`.

---

## Task 5: Builders puros das mensagens de ritual

**Files:** Create `src/finance/ritual-messages.js`, `src/finance/ritual-messages.test.js`

> Recebem dados JÁ consultados (objetos), retornam string. Puros → testáveis. Garantem que o NÚMERO é do código.

- [ ] **Step 1: Teste**
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildMonthlyFinance, buildBillReminder, buildMonthlyReport, buildBriefingFinanceLine } = require('./ritual-messages');

test('buildMonthlyFinance inclui saldo com sinal', () => {
  const m = buildMonthlyFinance({ nome: 'Alf', receitas: 3200, despesas: 2100, goals: [] });
  assert.match(m, /\+R\$1100/);
  assert.match(m, /Alf/);
});
test('buildBillReminder previo', () => {
  const m = buildBillReminder({ nome: 'Alf', bill: { name: 'Aluguel', amount: 1200, due_day: 10 }, mode: 'previo', dias: 2 });
  assert.match(m, /Aluguel/); assert.match(m, /1200/); assert.match(m, /2 dias/);
});
test('buildMonthlyReport gastou mais que ganhou', () => {
  const m = buildMonthlyReport({ nome: 'Alf', mes: 'abril', receitas: 1000, despesas: 1500, top: [['lazer',800]], goals: [] });
  assert.match(m, /Gastou mais/i);
});
test('buildBriefingFinanceLine vazio quando sem contas', () => {
  assert.strictEqual(buildBriefingFinanceLine([]), '');
});
```

- [ ] **Step 2: Rodar (falha).**

- [ ] **Step 3: Implementar `src/finance/ritual-messages.js`** (templates do PRD §6.1/§6.2/§6.4/§6.5; voz do SOUL; barra de progresso simples). [conteúdo completo: 4 funções `buildMonthlyFinance`, `buildBillReminder` (modes previo/dia/atrasada), `buildMonthlyReport`, `buildBriefingFinanceLine`, retornando strings com os valores recebidos — sem recalcular nada além de formatação.]

- [ ] **Step 4: Rodar (passa).**

---

## Task 6: Ritual `lembrete_conta` (diário, 8h)

**Files:** Modify `src/rituals/dispatcher.js`

> Determinístico: consulta `billsDueWithin`, monta com `buildBillReminder`, envia direto via `whatsapp.sendMessage` (NÃO via LLM), loga em `ritual_logs`.

- [ ] **Step 1:** Registrar `lembrete_conta` no map e adicionar bloco no `run()` (molde monthly, mas diário 8h):
```js
// Lembrete de contas — diario 8h BRT
if (currentSlot(now) === timeToSlot('08:00')) {
  for (const cid of await financeService.collaboratorsWithActivity()) {
    if (await alreadySent(cid, 'lembrete_conta', now.ymd)) continue;
    const bills = await financeService.billsDueWithin(cid, 2);
    if (!bills.length) continue;
    const q = await isQuietNow(cid, now, 'personal'); // pessoal: respeita sossego
    if (q.quiet) { await logRitualEvent(cid, 'lembrete_conta', 'skipped', q.reason, now.ymd); continue; }
    const collab = await getCollab(cid); // helper existente p/ phone+nome
    for (const b of bills) {
      const dias = b.due_day - now.dom;
      const mode = dias > 0 ? 'previo' : (dias === 0 ? 'dia' : 'atrasada');
      await whatsapp.sendMessage(collab.phone, buildBillReminder({ nome: collab.first_name, bill: b, mode, dias }));
    }
    await logRitualEvent(cid, 'lembrete_conta', 'sent', `${bills.length} conta(s)`, now.ymd);
  }
}
```
> ⚠️ Confirmar nomes exatos no `run()`: como obter `collab` (phone/nome), o objeto `now` (`.ymd`, `.dom`), e `alreadySent`. Ajustar aos helpers reais (ver monthly_planning:275).

- [ ] **Step 2:** `node --check src/rituals/dispatcher.js`.

---

## Task 7: Ritual `financeiro_mensal` (dia 10, 18h)

**Files:** Modify `src/rituals/dispatcher.js`

- [ ] **Step 1:** Bloco no `run()` (gate dia 10 + 18h), determinístico:
```js
if (now.dom === 10 && currentSlot(now) === timeToSlot('18:00')) {
  for (const cid of await financeService.collaboratorsWithActivity()) {
    if (await alreadySent(cid, 'financeiro_mensal', now.ymd)) continue;
    const rep = await financeService.monthlyReport(cid);
    if (!rep.temAtividade) continue;
    const goals = await financeService.listGoals(cid);
    const bills = await financeService.billsDueWithin(cid, 5);
    const collab = await getCollab(cid);
    const q = await isQuietNow(cid, now, 'personal');
    if (q.quiet) { await logRitualEvent(cid, 'financeiro_mensal', 'skipped', q.reason, now.ymd); continue; }
    await whatsapp.sendMessage(collab.phone, buildMonthlyFinance({ nome: collab.first_name, ...rep, goals, bills }));
    await logRitualEvent(cid, 'financeiro_mensal', 'sent', null, now.ymd);
  }
}
```

- [ ] **Step 2:** `node --check`.

---

## Task 8: Ritual `relatorio_financeiro_mensal` (dia 1, 18h, mês anterior)

**Files:** Modify `src/rituals/dispatcher.js`

- [ ] **Step 1:** Bloco no `run()` (gate dia 1 + 18h), `monthlyReport` do MÊS ANTERIOR:
```js
if (now.dom === 1 && currentSlot(now) === timeToSlot('18:00')) {
  const prevRef = new Date(Date.UTC(now.year, now.monthIndex - 1, 15)); // meio do mes anterior
  for (const cid of await financeService.collaboratorsWithActivity()) {
    if (await alreadySent(cid, 'relatorio_financeiro_mensal', now.ymd)) continue;
    const rep = await financeService.monthlyReport(cid, prevRef);
    if (!rep.temAtividade) continue;
    const q = await isQuietNow(cid, now, 'personal');
    if (q.quiet) { await logRitualEvent(cid, 'relatorio_financeiro_mensal', 'skipped', q.reason, now.ymd); continue; }
    const goals = await financeService.listGoals(cid);
    const collab = await getCollab(cid);
    await whatsapp.sendMessage(collab.phone, buildMonthlyReport({ nome: collab.first_name, mes: mesNome(prevRef), ...rep, goals }));
    await logRitualEvent(cid, 'relatorio_financeiro_mensal', 'sent', null, now.ymd);
  }
}
```
> Confirmar como o `now` expõe ano/mês (campos reais) e criar `mesNome()` (helper local PT-BR).

- [ ] **Step 2:** `node --check`.

---

## Task 9: Seção financeira no briefing pessoal

**Files:** Modify `src/rituals/dispatcher.js` (ou onde o briefing_pessoal é montado) + `skills/rituais-diarios.md`

> O briefing pessoal é LLM-renderizado. Pra não deixar o LLM inventar número, injetar a linha PRONTA (de `buildBriefingFinanceLine`) no contexto, com instrução "use exatamente esta linha".

- [ ] **Step 1:** No fluxo do `personal_briefing`/`briefing_pessoal`, antes de chamar o LLM, montar `const finLine = buildBriefingFinanceLine(await financeService.billsDueWithin(cid, 0));` (contas vencendo HOJE) e injetar no prompt/contexto do ritual como bloco pronto.
- [ ] **Step 2:** Em `skills/rituais-diarios.md`, documentar: "A linha de '💰 Vence hoje' é fornecida pronta pelo sistema — reproduza-a, não recalcule."
- [ ] **Step 3:** `node --check`.

---

## Task 10: Deploy + smoke

- [ ] **Step 1:** Rodar TODOS os testes: `node --test src/finance/*.test.js src/services/selic.test.js src/utils/dates.test.js` → tudo PASS.
- [ ] **Step 2:** `scp` dos arquivos novos/alterados (`selic.js`, `ritual-messages.js`, `financeiro-service.js`, `engine.js`, `dispatcher.js`, `system.js`, skills) + `pm2 restart tom`; conferir boot limpo.
- [ ] **Step 3 (smoke determinístico de ritual):** invocar o ritual sem esperar o cron — `ssh tom "cd /opt/LA-Organizer && node -e \"require('./src/services/financeiro-service').monthlyReport('<COLLAB_A>').then(r=>console.log(require('./src/finance/ritual-messages').buildMonthlyFinance({nome:'Alf',...r,goals:[]})))\""` → confere a mensagem montada (com dados de teste recriados, se necessário).
- [ ] **Step 4 (smoke via WhatsApp, manual — Alf):** "o que é Selic?" (skill educação + número vivo), "se eu guardar 300 por mês por 10 anos?" (`simulate_interest`, números do engine), e cadastrar uma conta com vencimento próximo pra disparar o lembrete no próximo ciclo de 8h (ou forçar `due_day` = hoje e rodar o dispatcher manualmente).
- [ ] **Step 5:** Verificar `ritual_logs` (`ritual_type` em `lembrete_conta`/`financeiro_mensal`/`relatorio_financeiro_mensal`, status `sent`).

---

## Pontos a confirmar na execução (não bloqueiam)
- Âncoras exatas no `run()` do `dispatcher.js`: helper de obter colaborador (phone/primeiro nome), campos de `now` (`ymd`, `dom`, ano/mês), `alreadySent`, e onde o loop de colaboradores vive (monthly_planning:275 é o molde).
- Import de `selic` e `projection` no `engine.js` (não duplicar desestruturação da Fase A).
- BCB SGS série: 432 (meta % a.a.). Confirmar shape do JSON no 1º fetch real.
- Crontab do VPS já chama `dispatcher.js` a cada 15 min — os blocos novos entram nesse mesmo `run()`, sem mudar o crontab. Confirmar.

## Out of scope (Fase C)
Todo o PWA (recharts, telas, componentes, hook/service, navegação, simulador visual, gestão de carteiras).
