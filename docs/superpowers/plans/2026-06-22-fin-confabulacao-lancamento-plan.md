# Plano — Camada 2 financeira: lançamento sempre-confirmado e determinístico

> **Para workers:** SUB-SKILL: `superpowers:executing-plans` (inline, tasks acopladas no mesmo `engine.js`). Steps com checkbox.

**Goal:** Todo lançamento financeiro do TOM vira **montagem → "confirma?" → "sim" → execução determinística**. O "sim" não depende do LLM re-emitir marker; a execução chama os handlers atuais (confirmação rica preservada). Camada 1 (`engine.js:11014`) é a rede de segurança.

**Arquitetura:** Interceptar no **dispatch de markers** (`engine.js:~10489`), ANTES de chamar os handlers que inserem. Resolver a fonte de cada item (reusando `resolveSource`/`findCard`); se todos resolverem limpo, montar UMA confirmação, abrir UMA intent `finance_source{form:'launch_confirm'}` com os `{action,params}` pinados, e setar `awaiting_user_confirm`. No "sim", o consumidor `finance_source` (`engine.js:~7805`) chama `handleFinanceAction` por item (handlers INTACTOS) → inserem. **Handlers e executores (`recordCardPurchase`/`writeCashTransaction`/`insertCardPurchase`) não são editados.**

**Stack:** Node CommonJS, `node:test`, Supabase (`pf_transactions`, `pending_intents`), deploy scp+`pm2 restart tom`.

**Escopo / fronteiras (decisões pra Alf revisar):**
- **Sempre-confirmar** vale pros lançamentos com fonte resolvível limpo (1 cartão nomeado; conta resolvida; conta principal como fallback; "dinheiro"). É o caso da Rose (cartão único) e do "gastei 50" (principal). → **montagem + confirma + executa.**
- **Fonte ambígua/múltipla-sem-principal/0-contas:** mantém o fluxo ATUAL (pergunta "qual cartão/conta?" via `finance_source` form list/binary, que JÁ é determinístico e executa na escolha). Esse fluxo também confirma a fonte — só não mostra a montagem completa. *Se o Alf quiser montagem cheia aí também, é fast-follow.*
- **Turno misto** (um item resolve, outro ambíguo): degrada pro comportamento atual do turno inteiro (raro; listas reais são do mesmo cartão). Logado.
- **Fora:** estorno/refund, import de fatura (A0/B), pay_bill, metas — intactos. Voz/tom/confirmações ricas — intactos. Camada 1 — não reconstruir.

---

## Task 0 — Pré-flight (baseline verde)

**Files:** nenhum (verificação).

- [ ] **Passo 1:** Rodar a suíte de finanças + Camada 1 e garantir verde ANTES de mexer.
  Run: `cd /d/la-organizer/_remote && node --test src/finance/*.test.js src/lib/optimistic-confirm*.test.js 2>&1 | tail -20`
  Esperado: tudo PASS (baseline).
- [ ] **Passo 2:** Confirmar Camada 1 na VPS (já feito: `grep -c enforceNoMarkerHonesty` = 2). Anotar `collaborator_id` da Rose = `8bfb18b6-3c2e-4579-b4a9-06409d7e84c4` pro smoke/recuperação.
- [ ] **Passo 3:** `node --check src/engine.js` (sintaxe limpa de partida).

---

## Task 1 — Módulo puro `src/finance/launch-confirm.js` (TDD)

**Files:**
- Create: `src/finance/launch-confirm.js`
- Test: `src/finance/launch-confirm.test.js`

- [ ] **Passo 1 — teste que falha** (`src/finance/launch-confirm.test.js`):

```js
const test = require('node:test');
const assert = require('node:assert');
const { buildLaunchPreview } = require('./launch-confirm');

const cardItem = (over = {}) => ({ op: 'card_purchase', source: { kind: 'card', id: 'c1', name: 'Latam PASS' },
  txn: { type: 'expense', amount: 62.92, description: 'Cheirin', category: 'alimentacao', installments: 1, date: '2026-06-04', ...over } });

test('preview: 1 item cartão mostra valor, categoria e fonte', () => {
  const out = buildLaunchPreview([cardItem()]);
  assert.match(out, /Cheirin/);
  assert.match(out, /62,92/);
  assert.match(out, /Latam PASS/);
  assert.match(out, /sim/i); // pede confirmação
});

test('preview: parcelado mostra "em 3x"', () => {
  const out = buildLaunchPreview([cardItem({ amount: 350.04, installments: 3, description: 'Sofá' })]);
  assert.match(out, /em 3x/);
});

test('preview: vários itens, fonte única aparece UMA vez', () => {
  const out = buildLaunchPreview([cardItem(), cardItem({ description: 'Polo', amount: 38.98 })]);
  assert.match(out, /Cheirin/); assert.match(out, /Polo/);
  assert.strictEqual((out.match(/Latam PASS/g) || []).length, 1);
});

test('preview: receita usa sinal +', () => {
  const out = buildLaunchPreview([{ op: 'cash', source: { kind: 'account', id: 'a1', name: 'Itaú' },
    txn: { type: 'income', amount: 1000, description: 'Projeto', category: 'salario', installments: 1, date: '2026-06-16' } }]);
  assert.match(out, /\+R\$\s?1\.000,00/);
});

test('preview: lista vazia → null', () => {
  assert.strictEqual(buildLaunchPreview([]), null);
});
```

Run: `node --test src/finance/launch-confirm.test.js` → FAIL (módulo não existe).

- [ ] **Passo 2 — implementação mínima** (`src/finance/launch-confirm.js`):

```js
'use strict';
// Camada 2 (financeiro) do CONFAB-NOMARKER-CHOKEPOINT: a MONTAGEM de confirmação do
// lançamento. PURO. O engine resolve a fonte e passa os itens normalizados; aqui só
// formata o "confirma?". As confirmações de SUCESSO continuam vindo dos handlers (voz rica).

const BRL = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function srcLabel(source) {
  if (!source) return '';
  if (source.kind === 'card') return `💳 ${source.name}`;
  if (source.kind === 'cash') return '💵 Dinheiro';
  return `🏦 ${source.name}`;
}

// items: [{ op, source:{kind,id,name}, txn:{type,amount,description,category,installments,date} }]
function buildLaunchPreview(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const lines = items.map((it) => {
    const t = it.txn || {};
    const parc = t.installments && t.installments >= 2 ? ` em ${t.installments}x` : '';
    const sign = t.type === 'income' ? '+' : '';
    const cat = t.category ? ` · ${t.category}` : '';
    return `• ${t.description || '(sem descrição)'} — ${sign}R$ ${BRL(t.amount)}${parc}${cat}`;
  });
  const sources = [...new Set(items.map((it) => srcLabel(it.source)).filter(Boolean))];
  const onlyIncome = items.every((it) => (it.txn || {}).type === 'income');
  const head = items.length === 1
    ? (onlyIncome ? 'Vou registrar essa entrada:' : 'Vou lançar:')
    : 'Vou lançar:';
  const srcLine = sources.length === 1 ? `\nFonte: *${sources[0]}*` : '';
  return `${head}\n${lines.join('\n')}${srcLine}\n\nConfirma que mando? (responde *sim* ou me corrige)`;
}

module.exports = { buildLaunchPreview };
```

Run: `node --test src/finance/launch-confirm.test.js` → PASS.

---

## Task 2 — Staging helper `stageLaunches` no engine (resolve fonte, NÃO insere)

**Files:** Modify `src/engine.js` — adicionar função-helper perto de `handleFinanceAction` (após `writeCashTransaction`, ~linha 7060, antes do switch). Importar o módulo novo no topo (junto dos outros `require` de finance).

- [ ] **Passo 1:** No topo do engine, garantir `const launchConfirm = require('./finance/launch-confirm');` (junto aos requires de finance). `reconcileInstallments` e `safeCategory` e `financeService` já estão em escopo.

- [ ] **Passo 2:** Adicionar a função (lê live bytes; usa as MESMAS chamadas dos handlers — `findCard`, `resolveSource`, `findPrimaryAccount`, `listCategorySlugs`, `safeCategory`):

```js
// Camada 2 (sempre-confirmar): resolve a fonte de CADA lançamento e devolve itens p/ montagem
// + os {action,params} PINADOS (fonte fixada por nome exato) p/ execução determinística no "sim".
// NÃO insere nada. allClean=false → o turno cai no fluxo atual (pergunta de fonte / insert direto).
async function stageLaunches(cid, actions, userText) {
  const items = []; const pinned = []; let ok = true;
  const catsFor = async () => {
    const _cats = await financeService.listCategorySlugs(cid).catch(() => []);
    return new Set(_cats.filter((r) => r.collaborator_id).map((r) => r.slug));
  };
  for (const a of actions) {
    const p = { ...(a.params || {}) };
    if (a.action === 'card_purchase') {
      const rec = reconcileInstallments(p.installments, userText);
      if (rec.corrected) p.installments = rec.installments;
      const amount = Number(p.amount);
      if (!amount || amount <= 0) { ok = false; break; }
      const cards = await financeService.findCard(cid, p.card || '');
      if (cards.length !== 1) { ok = false; break; }            // ambíguo/não-achou → fluxo atual
      const card = cards[0];
      const category = safeCategory(p.category, p.description, 'expense', await catsFor());
      pinned.push({ action: 'card_purchase', params: { ...p, card: card.name, category } });
      items.push({ op: 'card_purchase', source: { kind: 'card', id: card.id, name: card.name },
        txn: { type: 'expense', amount, description: p.description, category, installments: parseInt(p.installments || 1, 10), date: p.date } });
    } else { // register_transaction
      const type = p.type || 'expense';
      const amount = Number(p.amount);
      if (!amount || amount <= 0) { ok = false; break; }
      const category = safeCategory(p.category, p.description, type, await catsFor());
      const srcName = p.account_name || p.account || p.carteira || p.conta || p.card;
      const srcMethod = p.method || p.metodo || p.via || '';
      const src = srcName ? await financeService.resolveSource(cid, srcName, { type, method: srcMethod }) : { kind: 'none' };
      let source = null; const pin = { ...p, category };
      if (src.kind === 'ambiguous') { ok = false; break; }       // cartão×conta → fluxo atual (binary)
      else if (src.kind === 'card' && type === 'expense') { source = { kind: 'card', id: src.card.id, name: src.card.name }; pin.account_name = src.card.name; }
      else if (src.kind === 'account') { source = { kind: 'account', id: src.account.id, name: src.account.name }; pin.account_name = src.account.name; }
      else {
        const primary = await financeService.findPrimaryAccount(cid);
        if (!primary) { ok = false; break; }                     // 0/multi-sem-principal → fluxo atual
        source = { kind: 'account', id: primary.id, name: primary.name }; pin.account_name = primary.name;
      }
      pinned.push({ action: 'register_transaction', params: pin });
      items.push({ op: source.kind === 'card' ? 'card_purchase' : 'cash', source,
        txn: { type, amount, description: p.description, category, installments: parseInt(p.installments || 1, 10), date: p.date } });
    }
  }
  return { items, actions: pinned, allClean: ok && items.length === actions.length };
}
```

- [ ] **Passo 3:** `node --check src/engine.js` → limpo.

---

## Task 3 — Interceptar o dispatch: montagem + abre intent (sem inserir)

**Files:** Modify `src/engine.js` no bloco de FINANCE_ACTION (`~10489–10536`).

- [ ] **Passo 1:** Substituir o corpo do `if (finParsed.actions.length > 0) { ... }` (loop atual) pela versão que tenta estagiar os lançamentos e, no sucesso, monta UMA confirmação; senão **mantém o loop atual idêntico**:

```js
    if (finParsed.actions.length > 0) {
      _finActionRan = true;
      const LAUNCH = new Set(['register_transaction', 'card_purchase']);
      const launchActions = finParsed.actions.filter((a) => LAUNCH.has(a.action));
      let staged = null;
      if (launchActions.length) {
        try { staged = await stageLaunches(collab.id, launchActions, text); }
        catch (e) { console.warn('[LaunchStage] err:', e.message); staged = null; }
      }

      if (staged && staged.allClean && staged.items.length) {
        // SEMPRE-CONFIRMAR: monta UMA confirmação pro lote; não insere nada agora.
        const otherActions = finParsed.actions.filter((a) => !LAUNCH.has(a.action));
        const otherReplies = [];
        for (const a of otherActions) {
          try {
            const _o = { persisted: false };
            const r = await handleFinanceAction(collab, a.action, a.params, _o);
            const _res = (FIN_WRITE.has(a.action) && !_o.persisted) ? 'skipped' : 'executed';
            await logMarker(collab.id, 'FINANCE_ACTION', _res, a.action, null);
            if (r && r.trim()) otherReplies.push(r.trim());
          } catch (err) {
            await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', `error:${err.message}`, null);
            otherReplies.push('Deu ruim num item — tenta de novo?');
          }
        }
        const preview = launchConfirm.buildLaunchPreview(staged.items);
        const intentId = await pendingIntents.openIntent(collab.id, 'finance_source',
          { form: 'launch_confirm', actions: staged.actions }, preview);
        if (!intentId) {
          // openIntent falhou (ex.: drift de CHECK) → honesto, NUNCA finge que estagiou.
          await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', 'launch_confirm_intent_null', null);
          reply = 'Opa, não consegui preparar a confirmação aqui — me manda de novo, por favor 🙏';
        } else {
          _metrics.awaiting_user_confirm = true; // Camada 1 não rebaixa o preview (é pergunta)
          await logMarker(collab.id, 'FINANCE_ACTION', 'skipped', `staged_launch:${staged.items.length}`, null);
          reply = [...otherReplies, preview].filter(Boolean).join('\n\n');
        }
      } else {
        // FLUXO ATUAL (inalterado): despacha cada marker (insere/pergunta como hoje).
        const finReplies = [];
        for (const a of finParsed.actions) {
          try {
            if (a.action === 'card_purchase') {
              const _rec = reconcileInstallments(a.params && a.params.installments, text);
              if (_rec.corrected) { a.params = { ...(a.params || {}), installments: _rec.installments }; }
            }
            const _outcome = { persisted: false };
            const finReply = await handleFinanceAction(collab, a.action, a.params, _outcome);
            const _result = (FIN_WRITE.has(a.action) && !_outcome.persisted) ? 'skipped' : 'executed';
            const _reason = (_result === 'skipped') ? `no_persist:${a.action}` : a.action;
            await logMarker(collab.id, 'FINANCE_ACTION', _result, _reason, null);
            if (finReply && finReply.trim()) finReplies.push(finReply.trim());
          } catch (err) {
            console.error('[Finance] erro:', err.message);
            await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', `error:${err.message}`, null);
            finReplies.push('Deu ruim ao registrar um dos itens — tenta de novo?');
          }
        }
        if (finParsed.malformed > 0) {
          console.warn(`[Finance] WARN: ${finParsed.malformed} malformed marker(s) junto de ${finParsed.actions.length} válido(s)`);
          await logMarker(collab.id, 'FINANCE_ACTION', 'rejected', `schema_invalid_partial:${finParsed.malformed}`, reply);
          finReplies.push(finParsed.malformed === 1
            ? '⚠️ Registrei o que deu, mas um item veio embolado e não entrou. Me manda de novo só esse?'
            : `⚠️ Registrei o que deu, mas ${finParsed.malformed} itens vieram embolados e não entraram. Me manda de novo só esses?`);
        }
        reply = finReplies.length ? finReplies.join('\n\n') : (finParsed.cleanText || reply);
      }
    } else if (finParsed.malformed > 0) {
```

(o `else if (finParsed.malformed > 0)` e o resto do bloco seguem inalterados.)

- [ ] **Passo 2:** `node --check src/engine.js` → limpo.

---

## Task 4 — Consumidor do "sim": executa os handlers atuais (determinístico)

**Files:** Modify `src/engine.js` no consumidor `finance_source` (`~7805`), ANTES do ramo `txn_pick`/`matchSourceReply`.

- [ ] **Passo 1:** Logo após `if (finOpen) {`, inserir o ramo `launch_confirm`:

```js
      if (finOpen.payload && finOpen.payload.form === 'launch_confirm') {
        const conf = pendingIntents.detectUserConfirmation(String(text || ''));
        if (conf === 'yes') {
          const acts = Array.isArray(finOpen.payload.actions) ? finOpen.payload.actions : [];
          const replies = [];
          for (const a of acts) {
            try {
              const _o = { persisted: false };
              const r = await handleFinanceAction(collab, a.action, a.params, _o); // handler ATUAL insere
              if (r && r.trim()) replies.push(r.trim());
            } catch (e) {
              console.error('[LaunchConfirm] exec err:', e.message);
              replies.push('⚠️ Um item não entrou — me manda de novo só ele?');
            }
          }
          await pendingIntents.resolveIntent(finOpen.id, 'confirmed', `launch_confirm:${acts.length}`);
          const out = replies.length ? replies.join('\n\n') : '✅ Lançado!';
          try {
            await whatsapp.sendMessage(phone, out);
            await logConversation(collab.id, 'outbound', out);
            await logMarker(collab.id, 'FINANCE_ACTION', 'executed', `launch_confirm:${acts.length}`, null);
          } catch (e) { console.warn('[LaunchConfirm] post err:', e.message); }
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (launch_confirm_resolved)`);
          return;
        }
        if (conf === 'no') {
          await pendingIntents.resolveIntent(finOpen.id, 'denied', 'launch_confirm denied');
          const out = 'Beleza, não lancei nada. Quando quiser é só mandar de novo 👍';
          try { await whatsapp.sendMessage(phone, out); await logConversation(collab.id, 'outbound', out); } catch (e) { console.warn('[LaunchConfirm] deny post err:', e.message); }
          console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (launch_confirm_denied)`);
          return;
        }
        // conf === null → resposta não é sim/não claro (correção/conteúdo) → cai no LLM (re-propõe).
      }
```

- [ ] **Passo 2:** `node --check src/engine.js` → limpo. Confirmar que `handleFinanceAction` está em escopo neste ponto (já é chamado em 10508/10558; é função do módulo → OK).

---

## Task 5 — Skill `skills/financeiro-pessoal.md`: LLM PROPÕE, não declara feito

**Files:** Modify `skills/financeiro-pessoal.md`.

- [ ] **Passo 1:** Na seção do `<<FINANCE_ACTION>>` (após a linha ~26 que já diz "o ENGINE gera a mensagem de confirmação oficial"), acrescentar regra (cirúrgica, sem mexer no resto):

```markdown
- **Lançamento (despesa/receita/cartão) é SEMPRE confirmado pelo engine antes de gravar.** Você só emite o(s) `<<FINANCE_ACTION>>` com os dados; o engine monta a confirmação ("Confirma que mando?") e só grava no "sim" do usuário. Portanto, ao registrar gasto/recebimento/compra: **NUNCA diga que já lançou/registrou/encaminhou** ("lancei", "registrado", "✅ feito"). Apenas emita o marker — o engine fala por você. Dizer "feito" antes da confirmação é mentira e quebra a confiança.
```

- [ ] **Passo 2:** Conferir que a linha 173 (anti-derrotismo "NUNCA diga que não existe marker") segue intacta — as duas regras coexistem (emita o marker; só não declare concluído).

---

## Task 6 — Smoke E2E na VPS (repro Rose + regressão)

**Files:** script efêmero `/tmp/smoke-launch.js` na VPS (não commitar).

- [ ] **Passo 1:** Suíte local: `cd /d/la-organizer/_remote && node --test src/finance/launch-confirm.test.js src/finance/*.test.js src/lib/optimistic-confirm*.test.js 2>&1 | tail -15` → verde.
- [ ] **Passo 2:** scp engine + módulo + skill p/ VPS (Task 7 faz o deploy; aqui o smoke roda lendo o engine já atualizado). Casos (colaborador de teste, NÃO a Rose real):
  1. **Lista mesma fatura (cartão único):** 3 itens "Latam PASS" → 1 montagem listando os 3 + "Fonte: Latam PASS" → "sim" → 3 rows em `pf_transactions` com competência da fatura. **"não"** noutro teste → 0 rows.
  2. **Parcelado:** "R$350,04 3x Latam PASS" → montagem "em 3x" → "sim" → 3 rows (jul/ago/set, `purchase_group`).
  3. **Avulso carteira:** "gastei 50 no almoço" (conta principal) → montagem "Fonte: 🏦 [principal]" → "sim" → 1 row.
  4. **Receita:** "recebi 1000 projeto no Itaú" → montagem "+R$ 1.000,00" → "sim" → 1 row income.
  5. **Regressão fonte ambígua:** nome que casa cartão+conta → cai no fluxo atual (pergunta "cartão ou conta?") e executa na escolha (inalterado).
  6. **Regressão Camada 1:** simular reply "✅ Lançado" com `nothingPersisted` → continua rebaixando (não regrediu).
- [ ] **Passo 3:** Engine boota limpo (`pm2 logs tom --lines 30 --nostream` sem crash) e canário `claude -p` não aplica (é zap) — usar 1 msg real de teste do próprio Alf opcionalmente.

---

## Task 7 — Deploy + recuperar Rose + known issue + memória

**Files:** scp dos 3 arquivos; SQL na VPS/Supabase.

- [ ] **Passo 1 — deploy:**
  `scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js`
  `scp D:/la-organizer/_remote/src/finance/launch-confirm.js tom:/opt/LA-Organizer/src/finance/launch-confirm.js`
  `scp D:/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md`
  `ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && pm2 restart tom && pm2 logs tom --lines 20 --nostream"`
- [ ] **Passo 2 — recuperar os 5 lançamentos perdidos da Rose** (lista 2: Cheirin 62,92/04-06 alimentação; deboraduquedecaxias 129/07-06 compras; ifd polo 38,98/07-06 alimentação · lista 3: Mp\*rvosasco 350,04 3x/06-06 reparos; Amazon Compras Arthur 54,24 2x/20-06 compras). **CHECAR DUPLICATA PRIMEIRO** (ela pode ter lançado na mão):
  `SELECT description, amount, transaction_date, installments_total FROM pf_transactions WHERE collaborator_id='8bfb18b6-3c2e-4579-b4a9-06409d7e84c4' AND created_at > '2026-06-21' ORDER BY created_at;`
  Se NÃO existirem → **confirmar com o Alf** e inserir via o caminho real (montar a msg e mandar pelo TOM em homologação, OU INSERT direto com competência por vencimento). Se já existirem → não duplicar.
- [ ] **Passo 3 — known issue:**
  ```sql
  INSERT INTO tom_known_issues (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao, colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
  VALUES ('FIN-CONFIRM-CONFAB-NOOP','Confirmação de lançamento financeiro não executava (LLM re-emitia o marker)','marker','alto','corrigido',
   'Camada 2 da família CONFAB: o "sim" de um lançamento dependia do LLM re-emitir <<FINANCE_ACTION>>; sem executor determinístico (só anchor/batch_complete existiam). Listas 2/3 da Rose 21/06 confirmadas e não gravadas.',
   'Staging no dispatch: resolve fonte, monta UMA confirmação, abre intent finance_source{form:launch_confirm}; no "sim" o consumidor chama os handlers atuais (determinístico, sem LLM). Sempre-confirmar. Camada 1 (chokepoint) é a rede. Handlers/executores intactos.',
   'manual','"sim" a um lançamento financeiro → "✅ lançado" mas pf_transactions vazio; marker_logs launch_confirm', ARRAY['Rose'], '2026-06-21', '2026-06-21', 2, now());
  ```
- [ ] **Passo 4 — memória:** atualizar `project_tom_estorno_cartao`/criar nota curta sobre a Camada 2 financeira + corrigir a memória do audit (a "vazio" era impreciso: lista 1 entrou; o bug era o caminho de confirmação). Atualizar `MEMORY.md`.

---

## Self-review
- **Cobertura da spec:** sempre-confirmar ✅ (Task 3) · executor determinístico ✅ (Task 4, via handlers) · sem migração ✅ (reusa `finance_source`) · Camada 1 não reconstruída ✅ · idempotência ✅ (`resolveIntent`; intent resolvida não reaparece) · voz/confirmações ricas intactas ✅ (handlers no "sim").
- **Sem placeholder:** módulo e blocos de engine com código real; handlers/executores não editados.
- **Não-regressão:** fluxo atual preservado no `else`; fonte ambígua e Camada 1 com testes de regressão (Task 6.5/6.6). Handlers intactos = superfície mínima.
- **Risco residual:** turno misto (raro) degrada pro atual — logado, aceitável.
