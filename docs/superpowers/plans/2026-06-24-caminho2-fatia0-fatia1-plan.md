# Caminho 2 — Fatia 0 + Fatia 1 — Plano de implementação (v2, pós-review)

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`. Passos com checkbox (`- [ ]`).

**Goal:** Tornar a honestidade do TOM ESTRUTURAL (Modelo α: engine escreve a linha do fato; LLM só põe carinho em volta) — instrumentando o velocímetro (Fatia 0) e FECHANDO a fatia que mais morde, finança/derrotismo (Fatia 1), de forma **independente do marker do LLM**.

**Architecture:** O resolvedor determinístico (`resolve()`) decide capacidade/alcance. Ele é alcançado por caminhos **marker-independentes** (não só pelo handler cooperativo): a correção pré-LLM (`detectCorrection`, 8285) e a guarda pós-LLM (anti-fabricação, 10775) — ambas estendidas pra (a) rotear por `resolve()`, (b) escrever a linha honesta (α) quando fora de alcance, e (c) **disparar também na RECUSA** do LLM. O chokepoint vira velocímetro (mede confab e derrotismo, linhas separadas; curva caindo = prova).

**Tech Stack:** Node CommonJS, testes `node:test`, Supabase service_role, métrica via `marker_logs` (`logMarker`), deploy `scp`+`pm2` (`tom`). Spec: `docs/superpowers/specs/2026-06-24-caminho2-honestidade-estrutural-design.md`.

**Âncoras reais confirmadas no código (24/06):**
- `detectCorrection` pré-LLM: `engine.js:8285-8326` (desiste pro LLM em `!recent.length`, 8322).
- Anti-fabricação create: `engine.js:10775-10806` (só dispara em `looksLikeFinanceConfirmation`, NÃO em recusa).
- Handlers `edit_transaction`/`delete_transaction`: `engine.js:7285`/`7265` (query `listRecentTransactions(cid,{hours:2,limit:10})`).
- Chokepoint: `engine.js:11251`. `_metrics` (sem campo `domain`): `marker_emitted`, `actionable_intent`, `awaiting_user_confirm`, `auto_retry_succeeded` (7860+).
- `detectRegisterIntent` é CONSERVADOR: bail em multi-valor (`amounts.length!==1`) → não cria lista multi-item (escopo, ver §YAGNI).

---

## FATIA 0 — Velocímetro + liveness + inventário de portas

### Task F0.1: Inventário das portas reais (VPS) — investigação
**Files:** Modify `…/specs/2026-06-24-caminho2-honestidade-estrutural-design.md` (§6).
- [ ] **Step 1:** `ssh tom "cd /opt/LA-Organizer && grep -rno 'whatsapp.sendMessage\|sendAndLink\|processMessage(' src/ | grep -v test"`
- [ ] **Step 2:** `ssh tom "cd /opt/LA-Organizer && grep -rno 'enforceNoMarkerHonesty' src/"` — cruzar: quais envios passam pelo chokepoint.
- [ ] **Step 3:** Escrever no §6 a tabela porta→passa-pelo-velocímetro? (sim/não). Sem código.

### Task F0.2: `enforceNoMarkerHonesty` retorna se disparou (refactor mínimo)
**Files:** Modify `src/lib/optimistic-confirm.js`; Test `src/lib/optimistic-confirm.camada1.test.js`.
- [ ] **Step 1: Teste falhando**
```js
test('enforceNoMarkerHonesty sinaliza fired+sense quando rebaixa confab', () => {
  const out = enforceNoMarkerHonesty('✅ Tarefa criada!', { nothingPersisted: true }, { meta: true });
  assert.equal(out.fired, true); assert.equal(out.sense, 'confab'); assert.ok(typeof out.reply === 'string');
});
test('não dispara quando algo persistiu', () => {
  assert.equal(enforceNoMarkerHonesty('✅ feito', { nothingPersisted: false }, { meta: true }).fired, false);
});
```
- [ ] **Step 2:** `cd /d/la-organizer/_remote && node --test src/lib/optimistic-confirm.camada1.test.js` → FAIL.
- [ ] **Step 3: Impl — modo dual retrocompat:** 3º arg `opts={}`. Se `opts.meta===true` → retorna `{reply,fired,sense}`; senão retorna `reply` (string), como hoje. `sense='confab'`. Não mudar a lógica de rebaixamento.
- [ ] **Step 4:** Rodar → PASS (testes antigos seguem verdes).

### Task F0.3: Velocímetro liga no call-site + `_domainOf` REAL + mata o silent-catch
**Files:** Modify `src/engine.js` (~11251 e o try/catch em volta); novo helper `_domainOf`.

> ⚠️ Correção do review: `_domainOf(_metrics) || 'unknown'` daria **ReferenceError** (a função não existe — mesma classe do `CONFAB-CHOKEPOINT-SCOPE`/11252). `||` protege retorno falsy, não função inexistente. Definir helper REAL.

- [ ] **Step 1: Definir `_domainOf` real** (perto dos outros helpers de engine):
```js
// Domínio coarse do turno p/ a métrica do velocímetro. Deriva do que o turno emitiu.
// Sem campo _metrics.domain no engine — NÃO referenciar função/var inexistente (anti-11252).
function _domainOf(m) {
  const em = String((m && m.marker_emitted) || '');
  if (/FINANCE/i.test(em)) return 'finance';
  if (/TASK|CHECKLIST/i.test(em)) return 'task';
  if (/EVENT/i.test(em)) return 'event';
  if (/HABIT/i.test(em)) return 'habit';
  if (/COORDINATION|RSVP/i.test(em)) return 'coordination';
  return 'unknown';
}
```
- [ ] **Step 2: Call-site usa modo meta + loga disparo (linha SEPARADA):**
```js
const _hon = enforceNoMarkerHonesty(reply, {
  nothingPersisted: !_metrics.marker_emitted && !_metrics.auto_retry_succeeded,
  infoGathering: hasTrailingQuestion(reply) || isInfoGatheringReply(reply),
  awaitingConfirm: !!_metrics.awaiting_user_confirm,
}, { meta: true });
reply = _hon.reply;
if (_hon.fired) { try { await logMarker(collab.id, _domainOf(_metrics), 'chokepoint', `caught_${_hon.sense}`, reply); } catch (_) {} }
```
- [ ] **Step 3: Matar o silent-catch (liveness estrutural):** o `catch` em volta NÃO engole — alarme:
```js
catch (e) {
  console.error('[ConfabGuard] FALHOU (trava pode estar morta):', e.message, e.stack);
  try { await logMarker(collab.id, 'system', 'chokepoint', 'guard_error', String(e.message)); } catch (_) {}
}
```
> Assim, se um futuro ReferenceError voltar, ele vira métrica `guard_error` (a trava não morre mais calada). Essa é a defesa estrutural; a verificação ativa é a F0.5.
- [ ] **Step 4: `node --check src/engine.js`** (não pega ReferenceError — por isso a F0.5).

### Task F0.4: Detector provisório de derrotismo (módulo puro)
**Files:** Create `src/finance/derrotismo-detect.js` + `.test.js`.
- [ ] **Step 1: Teste falhando (frases reais)**
```js
const { detectDefeatism } = require('./derrotismo-detect');
test('pega a recusa do Matheus', () => {
  assert.equal(detectDefeatism('não tenho como editar transações pelo chat. Não existe o comando pra isso aqui.', { actionableIntent: true, markerEmitted: false }).suspect, true);
});
test('pega "vai no app" sem marker', () => {
  assert.equal(detectDefeatism('Vai direto no app: Finanças → Transações', { actionableIntent: true, markerEmitted: false }).suspect, true);
});
test('NÃO flagueia quando houve marker', () => {
  assert.equal(detectDefeatism('Pronto, ajustei pra você', { actionableIntent: true, markerEmitted: true }).suspect, false);
});
test('NÃO flagueia sem intent acionável', () => {
  assert.equal(detectDefeatism('não tenho como saber disso', { actionableIntent: false, markerEmitted: false }).suspect, false);
});
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Impl**
```js
// src/finance/derrotismo-detect.js — detector PROVISÓRIO de recusa falsa (impreciso de propósito;
// vira preciso na Fatia 1 com o resolver). Linha de métrica SEPARADA do confab.
const RE_DEFEAT = /\bn[ãa]o tenho como\b|\bn[ãa]o existe (o )?comando\b|\bn[ãa]o consigo\b|\bn[ãa]o d[áa] pra (fazer|mexer|editar|alterar)\b[^.?!]*\bchat\b|\bvai (direto )?(l[áa] )?no app\b|\bfaz mais de \d+ dias?\b/i;
function detectDefeatism(reply, { actionableIntent = false, markerEmitted = false } = {}) {
  const t = String(reply || ''); const m = RE_DEFEAT.exec(t);
  return { suspect: !!m && actionableIntent && !markerEmitted, phrase: m ? m[0] : null };
}
module.exports = { detectDefeatism };
```
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Ligar no call-site (linha SEPARADA, provisória):** após a F0.3:
```js
const _def = detectDefeatism(reply, { actionableIntent: !!_metrics.actionable_intent, markerEmitted: !!_metrics.marker_emitted });
if (_def.suspect) { try { await logMarker(collab.id, _domainOf(_metrics), 'chokepoint', 'caught_derrotismo_suspect', _def.phrase); } catch (_) {} }
```
- [ ] **Step 6:** `node --check src/engine.js`.

### Task F0.5: Deploy Fatia 0 + GATE DE LIVENESS NA PROD + baseline
> ⚠️ Correção do review: o canário tem que exercer o **call-site real**, não a função pura (o bug 11252 era a função OK + o call-site quebrado). Liveness = E2E que roda o `processMessage` real.

- [ ] **Step 1:** `cd /d/la-organizer/_remote && node --test src/lib/ src/finance/ && node --check src/engine.js`
- [ ] **Step 2: Deploy**
```bash
scp /d/la-organizer/_remote/src/lib/optimistic-confirm.js tom:/opt/LA-Organizer/src/lib/
scp /d/la-organizer/_remote/src/finance/derrotismo-detect.js tom:/opt/LA-Organizer/src/finance/
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && pm2 restart tom"
```
- [ ] **Step 3: GATE de liveness na prod (E2E real, não unit):** rodar na VPS um script que chama o `processMessage` real (`node --env-file=.env`) com um turno sintético que FORÇA confab (resposta com "✅ feito" + nenhum marker) e asserir: (a) o reply saiu rebaixado; (b) `marker_logs` ganhou uma linha `chokepoint/caught_confab`. Se não rebaixar OU não logar → a trava está morta → BLOQUEIA a Fatia 1.
- [ ] **Step 4: Baseline (retroativo + 24h):**
```sql
select date_trunc('day',created_at) d, reason, count(*)
from marker_logs where status='chokepoint' group by 1,2 order by 1 desc;
```
Anotar `caught_confab`, `caught_derrotismo_suspect` e `guard_error` SEPARADOS. Linha-base da curva.

---

## FATIA 1 — Finança / derrotismo (FECHA, não só mede)

### Task F1.1: `finance-capability.js` — resolvedor puro + janela compartilhada (TDD)
**Files:** Create `src/finance/finance-capability.js` + `.test.js`.
> Review minor: o "2h" mora hoje na query do caller. Exportar `EDIT_WINDOW_HOURS` daqui e usar nos 3 call-sites (handler, detectCorrection-path, resolver) pra promessa "~2h" do redirect nunca divergir.
- [ ] **Step 1: Teste falhando**
```js
const { resolveFinanceCapability, EDIT_WINDOW_HOURS } = require('./finance-capability');
test('criar sempre dá (sem janela) — caso Matheus', () => {
  const v = resolveFinanceCapability({ action: 'register_transaction', params: {} }, {});
  assert.deepEqual([v.can, v.reachable], [true, true]);
});
test('editar sem alvo recente → não alcança + redirect', () => {
  const v = resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [] });
  assert.equal(v.reachable, false); assert.equal(v.reason, 'no_recent_target'); assert.ok(v.redirect.app_path);
});
test('editar com 1 alvo → alcança', () => {
  assert.equal(resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [{ id: 'x' }] }).reachable, true);
});
test('editar com >1 alvo e sem which → ambíguo', () => {
  assert.equal(resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [{ id: 'a' }, { id: 'b' }] }).reason, 'ambiguous_target');
});
test('ação desconhecida → não pode', () => { assert.equal(resolveFinanceCapability({ action: 'foo' }, {}).can, false); });
test('EDIT_WINDOW_HOURS exportado', () => { assert.equal(EDIT_WINDOW_HOURS, 2); });
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Impl**
```js
// src/finance/finance-capability.js — resolvedor determinístico de capacidade & alcance (PURO).
const EDIT_WINDOW_HOURS = 2; // fonte única da janela ~2h (handler + detectCorrection-path + redirect)
const FINANCE_CAN = new Set(['register_transaction','card_purchase','card_refund','register_bill','pay_bill','delete_bill','pay_invoice','transfer','create_account','edit_account','edit_transaction','delete_transaction']);
const WINDOWED = new Set(['edit_transaction','delete_transaction']);
function appRedirectFor(_a){ return { app_path:'Finanças → Transações → toque no lançamento', why:`fora das ~${EDIT_WINDOW_HOURS}h que eu alcanço pra editar pelo chat` }; }
function resolveFinanceCapability(intent, ctx = {}) {
  const action = intent && intent.action;
  if (!action || !FINANCE_CAN.has(action)) return { can:false, reachable:false, reason:'unknown_action' };
  if (!WINDOWED.has(action)) return { can:true, reachable:true, reason:'ok' };
  const c = Array.isArray(ctx.candidates) ? ctx.candidates : [];
  if (c.length === 0) return { can:true, reachable:false, reason:'no_recent_target', redirect:appRedirectFor(action) };
  if (c.length > 1 && !(intent.params && intent.params.which)) return { can:true, reachable:false, reason:'ambiguous_target', redirect:appRedirectFor(action) };
  return { can:true, reachable:true, reason:'ok' };
}
module.exports = { resolveFinanceCapability, EDIT_WINDOW_HOURS, FINANCE_CAN, WINDOWED };
```
- [ ] **Step 4:** rodar → PASS.

### Task F1.2: `finance-honest-redirect.js` — construtor negativo (Modelo α, TDD c/ voz)
**Files:** Create `src/finance/finance-honest-redirect.js` + `.test.js`.
- [ ] **Step 1: Teste falhando (asserts de VOZ)**
```js
const { buildHonestRedirect } = require('./finance-honest-redirect');
test('linha honesta tem caminho do app e NÃO é robótica', () => {
  const l = buildHonestRedirect({ reason:'no_recent_target', redirect:{ app_path:'Finanças → Transações → toque no lançamento', why:'fora das ~2h que eu alcanço pra editar pelo chat' } });
  assert.match(l, /Finanças → Transações/);
  assert.doesNotMatch(l, /fora da janela permitida|opera[çc][ãa]o inv[áa]lida/i);
  assert.ok(l.length > 30);
});
test('ambíguo pede qual, sem recusar', () => {
  assert.match(buildHonestRedirect({ reason:'ambiguous_target', redirect:{ app_path:'Finanças → Transações' } }), /qual|valor|data/i);
});
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Impl (tom = referência launch_confirm)**
```js
// src/finance/finance-honest-redirect.js — Modelo α: o engine ESCREVE a linha honesta. Caloroso, NUNCA robótico.
function buildHonestRedirect(verdict = {}) {
  const r = verdict.redirect || {};
  const path = r.app_path || 'Finanças → Transações → toque no lançamento';
  const why = r.why || 'fora do que eu alcanço pelo chat';
  if (verdict.reason === 'ambiguous_target') return `Achei mais de um lançamento parecido — pra eu não mexer no errado, me diz qual (o valor ou a data). Ou ajusta rapidinho no app: *${path}*. 👍`;
  return `Esse lançamento já tá ${why} — mas no app você resolve em segundos: *${path}* → toca nele e edita. Qualquer coisa me chama! 👍`;
}
module.exports = { buildHonestRedirect };
```
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5 (CHECKPOINT Alf/coordenação — DoD §5.2):** colar TODAS as linhas que o engine escreve (α) e confirmar que soam como o TOM ANTES de plugar: (a) redirect `no_recent_target`; (b) redirect `ambiguous_target`; (c) o pedido honesto da F1.3b "manda um de cada vez que eu vou anotando 👍". Nenhuma pode soar brush-off/robótica.

### Task F1.3: FECHAR — rotear os caminhos marker-independentes por `resolve()` (o coração do fix)

> Este é o fix do review #1: o `resolve()` NÃO pode ficar só no handler cooperativo (que só roda se o LLM emite marker). Tem que ser alcançado pelos caminhos que rodam **mesmo quando o LLM recusa**.

**Files:** Modify `src/engine.js` (8285-8326, 10775-10806, 7265/7285); require dos 2 módulos novos.

- [ ] **Step 0 (verify, anti-ReferenceError — review v2):** `grep -n 'inboundVerbatimText' src/engine.js` — confirmar escopo no 10775 (já usado no 10779 pelo path existente, mas confirmar; classe `_domainOf`). E conferir se o re-registro create EXISTENTE (10789) também precisa de `_metrics.marker_emitted=true` (mesmo confab-inverso, latente) — se sim, corrigir junto.
- [ ] **Step 1: require no topo** (ao lado de `require('./finance/launch-confirm')`):
```js
const { resolveFinanceCapability, EDIT_WINDOW_HOURS } = require('./finance/finance-capability');
const { buildHonestRedirect } = require('./finance/finance-honest-redirect');
```

- [ ] **Step 2 (F1.3a — edit/delete fora de alcance NÃO cai no LLM):** no path `detectCorrection` (8285), trocar o `if (recent.length){...}` + o fall-through (8322) por roteamento via resolve(). Buscar com a janela compartilhada e, quando NÃO alcança, escrever a linha honesta (α) e RETORNAR:
```js
const corr = detectCorrection(String(text || ''));
if (corr) {
  const action = corr.op === 'delete' ? 'delete_transaction' : 'edit_transaction';
  const recent = await financeService.listRecentTransactions(collab.id, { hours: EDIT_WINDOW_HOURS, limit: 10 });
  const verdict = resolveFinanceCapability({ action, params: { which: corr.ref } }, { candidates: recent });
  if (!verdict.reachable) {
    const reply = buildHonestRedirect(verdict);            // ENGINE escreve a linha — NÃO cai no LLM
    try { await whatsapp.sendMessage(phone, reply); await logConversation(collab.id, 'outbound', reply); } catch (_) {}
    await logMarker(collab.id, 'finance', 'chokepoint', `honest_redirect_${corr.op}`, corr.ref || '');
    console.log(`[Correction] honest redirect (${corr.op}, ${verdict.reason}) phone=${_phoneTail}`);
    return;
  }
  // reachable → executa como hoje (handleFinanceAction), reusando `recent` (sem 2ª query)
  /* ...bloco de execução atual... */
}
```

- [ ] **Step 3 (F1.3b — RECUSA de create/edit é interceptada):** na guarda anti-fabricação (10775), o gatilho passa a incluir derrotismo (hoje só `looksLikeFinanceConfirmation`). Quando o LLM recusou (`_def.suspect`) num turno de finança acionável sem marker, o engine NÃO manda a recusa: cria (se extrair) / redireciona honesto (edit fora de alcance) / pede honesto (sem lie):
```js
if (!_finActionRan && typeof reply === 'string') {
  const _conf = looksLikeFinanceConfirmation(reply);
  const _def  = detectDefeatism(reply, { actionableIntent: !!_metrics.actionable_intent, markerEmitted: false });
  if (_conf || _def.suspect) {
    const _origMsg = String(inboundVerbatimText || text || '');
    const _det = detectRegisterIntent(_origMsg, { typeHint: reply });
    if (_det) {
      /* ...re-registro determinístico ATUAL (handleFinanceAction register_transaction → _real)... */
      // MUST-FIX #A (review v2): este path NÃO retorna — cai no chokepoint (11251, nothingPersisted=
      // !marker_emitted). Sem marker do LLM (ele recusou), o "💰 registrada!" REAL seria rebaixado
      // pra "não consegui" = CONFAB INVERSO. Sinalizar persistência:
      if (typeof _real === 'string' && _real.trim()) _metrics.marker_emitted = 'FINANCE_ACTION(anti_fabric)';
    } else {
      const _corr = detectCorrection(_origMsg);
      if (_corr) {
        const action = _corr.op === 'delete' ? 'delete_transaction' : 'edit_transaction';
        const recent = await financeService.listRecentTransactions(collab.id, { hours: EDIT_WINDOW_HOURS, limit: 10 });
        const v = resolveFinanceCapability({ action, params: { which: _corr.ref } }, { candidates: recent });
        if (v.reachable) {
          reply = await handleFinanceAction(collab, action, { which: _corr.ref, amount: _corr.amount, category: _corr.category });
          // MUST-FIX #A: sucesso real sem marker do LLM → sinalizar persistência (anti confab-inverso no 11251)
          if (typeof reply === 'string' && reply.trim()) _metrics.marker_emitted = 'FINANCE_ACTION(derrotismo_corr)';
        } else {
          reply = buildHonestRedirect(v);
        }
        await logMarker(collab.id, 'finance', 'chokepoint', `caught_derrotismo_${v.reachable ? 'acted' : 'redirect'}`, _def.phrase || '');
      } else if (_def.suspect) {
        // recusou mas não dá pra extrair determinístico → pede HONESTO, nunca a mentira "não existe comando"
        reply = 'Opa, deixa eu te ajudar com isso — me manda numa frase só: o que lançar/mudar, *quanto* e *de onde* (ex: "gastei 12 no lanche, débito"). Se forem vários, manda um de cada vez que eu vou anotando. 👍';
        await logMarker(collab.id, 'finance', 'chokepoint', 'caught_derrotismo_askhonest', _def.phrase || '');
      }
    }
  }
}
```

- [ ] **Step 4 (F1.3c — defesa em profundidade no handler cooperativo):** nos handlers `edit_transaction`/`delete_transaction` (7285/7265), trocar `{hours:2}` por `{hours:EDIT_WINDOW_HOURS}` e, antes do `resolveTxnTarget`, chamar `resolveFinanceCapability` com os `recent` já buscados; se `!reachable` → `return buildHonestRedirect(verdict)`. (Pré-condição única §7; reusa a MESMA lista, sem 2ª query.)

- [ ] **Step 5:** `node --check src/engine.js`.

### Task F1.4: Métrica de derrotismo PRECISA pra finança
**Files:** Modify `src/engine.js`.
- [ ] **Step 1:** Para o domínio finança, a F1.3b já loga `caught_derrotismo_acted|redirect|askhonest` (preciso, via resolver). Garantir que o log provisório da F0.4 (`caught_derrotismo_suspect`) **não duplica** quando a F1.3b já tratou (guardar com flag `_finDefeatHandled`). Redirect honesto legítimo (`reachable:false`) conta como `redirect`, não como mentira não-tratada.
- [ ] **Step 2:** `node --check`.

### Task F1.5: Testes da frase real — FECHA mesmo com o LLM RECUSANDO (a catraca da classe)
**Files:** Create `src/finance/caminho2-fatia1.realphrase.test.js`.
> A barra do review: o teste tem que passar **simulando a recusa do LLM**, não só quando ele coopera.
- [ ] **Step 1: Testes (compõem detector + resolver + builder = o caminho da F1.3, sem precisar do LLM)**
```js
const { resolveFinanceCapability } = require('./finance-capability');
const { buildHonestRedirect } = require('./finance-honest-redirect');
const { detectDefeatism } = require('./derrotismo-detect');
const { detectRegisterIntent } = require('./detect-register-intent');

test('Matheus single-item: LLM recusaria, mas o engine EXTRAI e cria', () => {
  // simula a recusa do LLM como reply; o que importa é a msg do usuário
  const def = detectDefeatism('não existe o comando pra isso aqui, vai no app', { actionableIntent: true, markerEmitted: false });
  assert.equal(def.suspect, true);                                   // interceptado (não vai a mentira)
  const det = detectRegisterIntent('gastei 12 no lanche, débito');   // 1 item → extrai
  assert.ok(det && det.amount === 12);                               // engine cria, não recusa
});
test('editar de 2 dias atrás: recusa interceptada → redirect honesto, sem mentira', () => {
  const v = resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [] });
  const line = buildHonestRedirect(v);
  assert.doesNotMatch(line, /n[ãa]o existe o comando|faz mais de 2 dias/i);
  assert.match(line, /app/i);
});
test('a recusa literal do Matheus seria flagrada', () => {
  assert.equal(detectDefeatism('Esses têm mais de 2 dias. Não existe o comando pra isso aqui. Vai no app.', { actionableIntent: true, markerEmitted: false }).suspect, true);
});
```
- [ ] **Step 2:** `cd /d/la-organizer/_remote && node --test src/finance/` → PASS.

### Task F1.6: Deploy + smoke real (FORÇANDO recusa) + KI + memória + handoff
- [ ] **Step 1:** `node --test src/finance/ src/lib/ && node --check src/engine.js`
- [ ] **Step 2: Deploy**
```bash
scp /d/la-organizer/_remote/src/finance/finance-capability.js tom:/opt/LA-Organizer/src/finance/
scp /d/la-organizer/_remote/src/finance/finance-honest-redirect.js tom:/opt/LA-Organizer/src/finance/
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && pm2 restart tom"
```
- [ ] **Step 3 (CHECKPOINT Alf — smoke real):** simular na VPS: (a) create-refusal ("joga esses dados / gastei 12 no lanche") → conferir que cria OU pede honesto, **nunca** "não existe comando"; (b) edit-de-2-dias → redirect honesto. Logs: `ssh tom "pm2 logs tom --lines 200 --nostream | grep -i chokepoint"`.
- [ ] **Step 4: Curva** — `select reason,count(*) from marker_logs where status='chokepoint' and created_at> now()-interval '1 day' group by 1;` — `caught_derrotismo_*` aparece e a linha começa a cair conforme cobre.
- [ ] **Step 5: KI** — INSERT `tom_known_issues` (`FIN-DERROTISMO-NOMARKER-NOCLOSE`): causa (resolve() só no caminho cooperativo; recusa do LLM não era interceptada), fix (F1.3a/b/c marker-independente + α), prova (métrica). Caso Matheus 24/06.
- [ ] **Step 6: Memória** — criar `project_caminho2_honestidade` (Modelo α; velocímetro; resolver; caminhos marker-independentes 8285/10775; ordem das fatias) + linha no `MEMORY.md`; cruzar com `[[project_confab_chokepoint]]`/`[[project_tom_nega_capacidade]]`.
- [ ] **Step 7: Handoff** — chat de coordenação revisa com a frase real do Matheus (DoD §4).

---

## YAGNI / limites de escopo (explícito p/ review)
- **Multi-item create determinístico** (Matheus mandou 3 valores): `detectRegisterIntent` é conservador (bail em ≥2 valores). Fatia 1 **fecha a MENTIRA** (recusa nunca vai; vira create-1-item, redirect honesto ou pedido honesto), **não** entrega auto-create de lista sem o LLM. Se o velocímetro mostrar que multi-item-refusal é frequente, vira fatia futura. **Não** construir agora.
- **detectCorrection coverage:** F1.3a depende do `detectCorrection` casar a frase. Se o smoke (F1.6 Step 3) mostrar frase real não-casada, estender os padrões de `detect-correction.js` com a frase real como teste (TDD) — dentro da Fatia 1.

## Self-review (writing-plans)
- **Review #1 (fecha, não mede):** F1.3a (edit fora de alcance → redirect, não cai no LLM) + F1.3b (recusa de create/edit interceptada, marker-independente) + F1.5/F1.6 testam SIMULANDO recusa. ✔
- **Review #2 (_domainOf ReferenceError):** F0.3 Step 1 define helper real; catch loga `guard_error`; F0.5 Step 3 gate de liveness E2E no call-site real. ✔
- **Minor (janela 2h):** `EDIT_WINDOW_HOURS` único em F1.1, usado em F1.3a/c. ✔
- **Confirmados OK pelo review:** `listRecentTransactions`, `hasTrailingQuestion`/`isInfoGatheringReply`, TDD/incremental/métricas separadas/pré-condição. ✔
- **Tipos consistentes:** `resolveFinanceCapability(intent,ctx)→{can,reachable,reason,redirect?}`, `buildHonestRedirect(verdict)`, `detectDefeatism(reply,{actionableIntent,markerEmitted})` idênticos em todas as tasks.
