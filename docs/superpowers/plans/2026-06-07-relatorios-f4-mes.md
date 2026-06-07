# Relatórios — Fatia 4: Análise do mês (TOM) — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Testes puros = `scripts/smoke-*.js` (node assert). Sem commit entre tasks; deploy scp+pm2 na task final. ABSOLUTE paths. Sonnet/Opus.

**Goal:** "📊 Análise do mês" no padrão-ouro: comparativo (despesas vs mês anterior), top gastos (% + nº), por tipo (essencial×estilo), projeção (saldo→a pagar→projetado), metas, **Dica do TOM** contextual, ações. Ação TOM `query_month_analysis`.

**Architecture:** `report-analysis.js` (classifyExpenseType, calcVariation, buildTomTip, buildQuickActions) + `reports/month.js` (buildMonthAnalysis, puro) → `wa-format` (rankingTopN/comparison/goalsBlock/analysisProjection/analysisByType + renderMonthAnalysis) ← engine `query_month_analysis`. Service: `monthCategoryBreakdown(cid, ref)`. Reusa `tomTip` (F2), `listAccounts/listActiveBills/listGoals`, `buildBillsToPay` (F1), `CAT_META`, `mesDaComp`.

**Escopo:** TOM. Despesas vêm de `pf_transactions` (consistente com querySummary/monthlyReport existentes). PWA: dashboard já tem charts/orçamento; comparativo+projeção no app = follow-up.

---

## Task 1: `report-analysis.js` — helpers puros
**Files:** Create `src/finance/report-analysis.js`; Create `scripts/smoke-report-analysis.js`.

- [ ] **Step 1:** `scripts/smoke-report-analysis.js`:
```js
const assert = require('assert');
const { classifyExpenseType, calcVariation, buildTomTip, buildQuickActions } = require('../src/finance/report-analysis');

assert.strictEqual(classifyExpenseType('moradia'), 'essential');
assert.strictEqual(classifyExpenseType('alimentacao'), 'essential');
assert.strictEqual(classifyExpenseType('lazer'), 'lifestyle');
assert.strictEqual(classifyExpenseType('viagens'), 'lifestyle');
assert.strictEqual(classifyExpenseType('outros'), 'other');

assert.deepStrictEqual(calcVariation(120, 100), { delta:20, pct:20, label:'⬆️ +20%' });
assert.deepStrictEqual(calcVariation(80, 100), { delta:-20, pct:-20, label:'⬇️ -20%' });
assert.deepStrictEqual(calcVariation(100, 100), { delta:0, pct:0, label:'➡️ 0%' });
assert.strictEqual(calcVariation(50, 0).pct, 100);   // sem base anterior
assert.strictEqual(calcVariation(0, 0).pct, 0);

assert.ok(/vermelho/.test(buildTomTip({ saldoProjetado:-100 })));
assert.ok(/vencida/.test(buildTomTip({ saldoProjetado:500, overdueCount:2 })));
assert.ok(/Alimentação/.test(buildTomTip({ saldoProjetado:500, overdueCount:0, topCategoria:'Alimentação', topPct:60 })));
assert.ok(/sa[úu]vel|meta|reserva/i.test(buildTomTip({ saldoProjetado:500, overdueCount:0 })));
assert.ok(Array.isArray(buildQuickActions()) && buildQuickActions().length >= 2);
console.log('PASS — report-analysis OK.');
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** `src/finance/report-analysis.js`:
```js
'use strict';
// Taxonomia essencial × estilo de vida (calibrável — decisão de negócio).
const ESSENTIAL = new Set([
  'moradia','contas_consumo','mercado','saude','transporte','educacao','farmacia',
  'alimentacao','combustivel','seguros','impostos','emprestimo','financiamento',
  'filhos','reparos_manutencoes',
]);
function classifyExpenseType(slug) {
  if (slug === 'outros' || slug === 'transferencia_contas') return 'other';
  return ESSENTIAL.has(slug) ? 'essential' : 'lifestyle';
}

// Variação percentual entre dois períodos. prev=0 → 100% (se houver atual) ou 0%.
function calcVariation(current, previous) {
  const cur = Number(current) || 0, prev = Number(previous) || 0;
  const delta = cur - prev;
  let pct;
  if (prev === 0) pct = cur === 0 ? 0 : 100;
  else pct = Math.round((delta / prev) * 100);
  const arrow = delta > 0 ? '⬆️' : (delta < 0 ? '⬇️' : '➡️');
  const sign = pct > 0 ? '+' : '';
  return { delta, pct, label: `${arrow} ${sign}${pct}%` };
}

// Dica do TOM contextual. Prioridade: projeção negativa > conta vencida > categoria dominante > saúde.
function buildTomTip(ctx = {}) {
  if (ctx.saldoProjetado != null && ctx.saldoProjetado < 0)
    return 'Atenção: pelo previsto, o mês fecha no vermelho. Vale segurar gastos não-essenciais ou antecipar uma entrada.';
  if (ctx.overdueCount > 0)
    return `Você tem ${ctx.overdueCount} conta(s) vencida(s). Quitar primeiro evita juros — depois a gente organiza o resto.`;
  if (ctx.topCategoria && ctx.topPct >= 40)
    return `${ctx.topCategoria} puxou ${ctx.topPct}% dos gastos. Se foi pontual, tranquilo; se repete, vale um teto: "define orçamento de ${String(ctx.topCategoria).toLowerCase()} 500".`;
  return 'Saldo saudável! Que tal separar um pouco do excedente pra uma meta ou reserva?';
}

function buildQuickActions() {
  return ['quanto gastei esse mês', 'minhas contas a pagar', 'extrato'];
}

module.exports = { classifyExpenseType, calcVariation, buildTomTip, buildQuickActions, ESSENTIAL };
```
- [ ] **Step 4:** run → PASS; `node --check`.

---

## Task 2: Service — `monthCategoryBreakdown`
**Files:** Modify `src/services/financeiro-service.js`.

- [ ] **Step 1:** adicionar após `querySummary` (ou perto de `monthlyReport`):
```js
// Quebra do mês: receitas, despesas e por categoria (total + contagem). Base pf_transactions
// (mesma fonte de querySummary/monthlyReport). ref = qualquer Date dentro do mês desejado.
async function monthCategoryBreakdown(collaboratorId, ref = new Date()) {
  const { start, end } = monthBounds(ref);
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', start).lt('transaction_date', end)
    .neq('is_adjustment', true);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const by = {};
  for (const r of rows) if (r.type === 'expense') {
    by[r.category] = by[r.category] || { total: 0, count: 0 };
    by[r.category].total += Number(r.amount); by[r.category].count += 1;
  }
  const byCategory = Object.entries(by).map(([slug, v]) => ({ slug, total: v.total, count: v.count }));
  return { receitas, despesas, byCategory };
}
```
- [ ] **Step 2:** export: adicionar `monthCategoryBreakdown` ao `module.exports` (perto de `monthlyReport`).
- [ ] **Step 3:** `node --check /d/la-organizer/_remote/src/services/financeiro-service.js`.

---

## Task 3: `reports/month.js` — buildMonthAnalysis (builder puro)
**Files:** Create `src/finance/reports/month.js`; Create `scripts/smoke-reports-month.js`.

- [ ] **Step 1:** `scripts/smoke-reports-month.js`:
```js
const assert = require('assert');
const { buildMonthAnalysis } = require('../src/finance/reports/month');
const data = {
  monthLabel:'abril', despesas:2759, receitas:8000, despesasPrev:2000,
  byCategory:[{slug:'alimentacao',total:2239,count:8},{slug:'transporte',total:320,count:4},{slug:'lazer',total:200,count:1}],
  saldoAtual:10161, aPagar:4329, overdueCount:0, goals:[{name:'Europa',pct:3,current:500,target:15000}],
};
const m = buildMonthAnalysis(data);
assert.strictEqual(m.comparativo.variation.label, '⬆️ +38%');         // (2759-2000)/2000≈38%
assert.strictEqual(m.ranking[0].label, 'Alimentação');                 // CAT_META label
assert.strictEqual(m.ranking[0].pct, Math.round(2239/2759*100));       // 81
assert.strictEqual(m.ranking.length, 3);
assert.ok(m.porTipo.essenciais === 2239 + 320);                        // aliment+transporte
assert.ok(m.porTipo.estilo === 200);                                   // lazer
assert.strictEqual(m.projecao.saldoProjetado, 10161 - 4329);           // 5832
assert.strictEqual(m.metas[0].name, 'Europa');
assert.ok(typeof m.tip === 'string' && m.tip.length > 0);
console.log('PASS — buildMonthAnalysis OK.');
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** `src/finance/reports/month.js`:
```js
'use strict';
const { classifyExpenseType, calcVariation, buildTomTip, buildQuickActions } = require('../report-analysis');
const { CAT_META } = require('../../services/finance-format'); // slug → {emoji,label}

// data: { monthLabel, despesas, receitas, despesasPrev, byCategory:[{slug,total,count}],
//         saldoAtual, aPagar, overdueCount, goals:[{name,pct,current,target}] }
function buildMonthAnalysis(data) {
  const desp = Number(data.despesas) || 0;
  const comparativo = {
    atual: desp, anterior: Number(data.despesasPrev) || 0,
    variation: calcVariation(desp, data.despesasPrev),
  };
  const ranking = (data.byCategory || []).slice()
    .sort((a, b) => b.total - a.total).slice(0, 5)
    .map((c) => ({
      slug: c.slug, label: (CAT_META[c.slug] || {}).label || c.slug,
      total: c.total, count: c.count, pct: desp > 0 ? Math.round((c.total / desp) * 100) : 0,
    }));
  let ess = 0, life = 0;
  for (const c of (data.byCategory || [])) {
    const t = classifyExpenseType(c.slug);
    if (t === 'essential') ess += c.total; else if (t === 'lifestyle') life += c.total;
  }
  const tot = ess + life;
  const porTipo = {
    essenciais: ess, estilo: life,
    essPct: tot > 0 ? Math.round((ess / tot) * 100) : 0,
    estiloPct: tot > 0 ? Math.round((life / tot) * 100) : 0,
  };
  const saldoProjetado = (Number(data.saldoAtual) || 0) - (Number(data.aPagar) || 0);
  const projecao = { saldoAtual: Number(data.saldoAtual) || 0, aPagar: Number(data.aPagar) || 0, saldoProjetado };
  const tip = buildTomTip({
    saldoProjetado, overdueCount: data.overdueCount || 0,
    topCategoria: ranking[0] && ranking[0].label, topPct: ranking[0] && ranking[0].pct,
  });
  return {
    monthLabel: data.monthLabel, receitas: Number(data.receitas) || 0,
    comparativo, ranking, porTipo, projecao, metas: data.goals || [], tip, acoes: buildQuickActions(),
  };
}

module.exports = { buildMonthAnalysis };
```
- [ ] **Step 4:** run → PASS; `node --check`.

---

## Task 4: `wa-format` — blocos + renderMonthAnalysis
**Files:** Modify `src/finance/wa-format/index.js`; Modify `scripts/smoke-wa-format.js`.

- [ ] **Step 1:** append asserts antes do `console.log` final de `scripts/smoke-wa-format.js`:
```js
const { renderMonthAnalysis } = require('../src/finance/wa-format');
const mm = {
  monthLabel:'abril', receitas:8000,
  comparativo:{ atual:2759, anterior:2000, variation:{ delta:759, pct:38, label:'⬆️ +38%' } },
  ranking:[{label:'Alimentação',total:2239,count:8,pct:81},{label:'Transporte',total:320,count:4,pct:12}],
  porTipo:{ essenciais:2559, estilo:200, essPct:93, estiloPct:7 },
  projecao:{ saldoAtual:10161, aPagar:4329, saldoProjetado:5832 },
  metas:[{name:'Europa',pct:3,current:500,target:15000}],
  tip:'Saldo saudável!', acoes:['quanto gastei esse mês','extrato'],
};
const rm = renderMonthAnalysis(mm);
assert.ok(rm.startsWith('📊 *Análise de abril*'));
assert.ok(rm.includes('⬆️ +38%'));
assert.ok(rm.includes('🥇 Alimentação: R$ 2.239,00 (81%)'));
assert.ok(rm.includes('🏠 Essenciais: 93%'));
assert.ok(rm.includes('Projetado: R$ 5.832,00 ✅'));
assert.ok(rm.includes('🎯 *Metas*'));
assert.ok(rm.includes('💡 *Dica do TOM*'));
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** add to `src/finance/wa-format/index.js` before `module.exports` (+ export `rankingTopN, comparison, goalsBlock, analysisProjection, analysisByType, renderMonthAnalysis`):
```js
const _MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
function rankingTopN(items) {
  return (items || []).map((it, i) => `${_MEDALS[i] || '•'} ${it.label}: ${money(it.total)} (${it.pct}%)`).join('\n');
}
function comparison(c) {
  return `📈 *Comparativo*\n• Este mês: ${money(c.atual)}\n• Mês anterior: ${money(c.anterior)}\n• Variação: ${c.variation.label}`;
}
function goalsBlock(goals) {
  if (!goals || !goals.length) return '';
  const lines = goals.slice(0, 3).map((g) => `• ${g.name}: ${g.pct}%\n  ${money(g.current)} / ${money(g.target)}`).join('\n');
  return `🎯 *Metas*\n${lines}`;
}
function analysisProjection(p) {
  const ok = p.saldoProjetado >= 0 ? '✅' : '🔴';
  return `💰 *Projeção do mês*\n• Saldo atual: ${money(p.saldoAtual)}\n• A pagar: ${money(p.aPagar)}\n• Projetado: ${money(p.saldoProjetado)} ${ok}`;
}
function analysisByType(t) {
  return `🏷️ *Por tipo*\n🏠 Essenciais: ${t.essPct}% (${money(t.essenciais)})\n🎯 Estilo de vida: ${t.estiloPct}% (${money(t.estilo)})`;
}
function renderMonthAnalysis(m) {
  return assemble([
    header('📊', `Análise de ${m.monthLabel}`),
    comparison(m.comparativo),
    (m.ranking && m.ranking.length) ? `🏆 *Top gastos*\n${rankingTopN(m.ranking)}` : '',
    (m.porTipo && (m.porTipo.essenciais || m.porTipo.estilo)) ? analysisByType(m.porTipo) : '',
    analysisProjection(m.projecao),
    goalsBlock(m.metas),
    tomTip(m.tip),
    quickActions(m.acoes),
  ]);
}
```
- [ ] **Step 4:** run → PASS; `node --check`.

---

## Task 5: Engine `query_month_analysis` + skill
**Files:** Modify `src/engine.js`; Modify `skills/financeiro-pessoal.md`.

- [ ] **Step 1 (engine):** adicionar `'query_month_analysis'` a `FINANCE_ACTIONS` (após `'query_checkup'`). Adicionar o case (perto dos query_*):
```js
    case 'query_month_analysis': {
      const { buildMonthAnalysis } = require('./finance/reports/month');
      const { buildBillsToPay } = require('./finance/reports/bills');
      const wa = require('./finance/wa-format');
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const cur = await financeService.monthCategoryBreakdown(cid, now);
      const prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prev = await financeService.monthCategoryBreakdown(cid, prevRef);
      const accounts = await financeService.listAccounts(cid);
      const saldoAtual = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
      const bills = await financeService.listActiveBills(cid);
      const toPay = buildBillsToPay(bills, [], today);
      const goalsRaw = await financeService.listGoals(cid);
      const goals = goalsRaw.map((g) => ({
        name: g.name, current: Number(g.current_amount) || 0, target: Number(g.target_amount) || 0,
        pct: Number(g.target_amount) > 0 ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100) : 0,
      }));
      const model = buildMonthAnalysis({
        monthLabel: financeFmt.mesDaComp(today.slice(0, 7) + '-01'),
        despesas: cur.despesas, receitas: cur.receitas, despesasPrev: prev.despesas,
        byCategory: cur.byCategory, saldoAtual, aPagar: toPay.totalPendente,
        overdueCount: toPay.vencidas.length, goals,
      });
      return wa.renderMonthAnalysis(model);
    }
```
- [ ] **Step 2 (skill):** adicionar após `query_checkup`:
```markdown
- `query_month_analysis` — sem params. "📊 Análise do mês": comparativo de gastos vs mês anterior, top gastos (% e nº), essencial×estilo de vida, projeção (saldo→a pagar→projetado), metas e uma dica. Use em "resumo do mês", "análise do mês", "como foi o mês", "análise financeira".
```
- [ ] **Step 3:** `node --check /d/la-organizer/_remote/src/engine.js`; `grep -n "query_month_analysis" src/engine.js skills/financeiro-pessoal.md`.

---

## Task 6: Deploy + smoke real
- [ ] **Step 1:** rodar `node scripts/smoke-report-analysis.js && node scripts/smoke-reports-month.js && node scripts/smoke-wa-format.js` + `node --check` em report-analysis, reports/month, wa-format, financeiro-service, engine.
- [ ] **Step 2:** scp (report-analysis.js, reports/month.js, wa-format/index.js, financeiro-service.js, engine.js, financeiro-pessoal.md, 3 smokes) + md5 (month, wa-format, engine) + smoke VPS + `pm2 restart tom`.
- [ ] **Step 3:** smoke real: "resumo do mês" do Matheus — confere despesas do mês, comparativo, projeção (saldoAtual − aPagar) batendo com o banco.

## Self-review
- Cobertura: classifyExpenseType/calcVariation/buildTomTip/buildQuickActions (T1), monthCategoryBreakdown (T2), buildMonthAnalysis (T3), render+blocos (T4), engine+skill (T5). ✓
- Tipos: model `{monthLabel, comparativo:{atual,anterior,variation:{label}}, ranking:[{label,total,pct}], porTipo:{essenciais,estilo,essPct,estiloPct}, projecao:{saldoAtual,aPagar,saldoProjetado}, metas:[{name,pct,current,target}], tip, acoes}` — render lê exatamente. ✓
- Despesas de pf_transactions (consistente com querySummary). Inclusão de compras de cartão na despesa do mês = mesmo comportamento dos relatórios existentes (fora de escopo desta fatia).
