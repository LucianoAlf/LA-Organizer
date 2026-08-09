# Agente de Governança Autônoma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um agente que roda todo dia às 08:00, trata os achados da auditoria e gera o ajuste sozinho — corrigindo apenas o que conseguir reproduzir.

**Architecture:** Reusa a infra do canal de ops já em produção (`ops-agent.js`: spawn do CLI `claude` com ferramentas, sanitizador markdown→WhatsApp, split em mensagens, typing sustentado, drain hook de restart). O que é novo: um briefing próprio (o protocolo), um placar de eficácia, e o gancho diário no dispatcher.

**Tech Stack:** Node.js 20 (CommonJS), `node:test`, Supabase (service_role), CLI `claude` (Opus 5), PM2 na VPS.

**Spec:** `docs/superpowers/specs/2026-08-08-agente-governanca-design.md`

## Global Constraints

- **`soul/` e `skills/` são INTOCÁVEIS** — voz do TOM, veto do Alf. Nenhuma task escreve neles.
- **Raio do agente: só `src/`.** PWA, migrations e apagar dado de produção estão fora.
- **Baseline da suíte:** `node --test "src/**/*.test.js"` termina em **`fail 3`** (env ausente). Qualquer número diferente = regressão, reverte.
- **TDD obrigatório:** teste vermelho antes do código, sempre.
- **`.deploy-hold` na raiz (`D:\la-organizer\.deploy-hold`) ANTES de editar `src/`**, removido depois do deploy — `engine.js` e `dispatcher.js` são compartilhados com outro chat.
- **Deploy cirúrgico:** conferir `md5sum` do arquivo na VPS contra `git show HEAD:<arquivo>` ANTES de subir. Divergiu = pare e investigue.
- **Toda comunicação e todo comentário de código em PT-BR.**
- **Nunca usar Haiku** em subagente.
- Rodar comandos com caminho absoluto ou `cd /d/la-organizer/_remote` — o cwd escorrega para o diretório pai e `wc -l src/engine.js` já devolveu 203 (arquivo morto) em vez de 14.960.

## File Structure

| arquivo | responsabilidade |
|---|---|
| `src/services/ops-agent.js` *(modificar)* | ganha `briefing` e `timeoutMs` opcionais; comportamento padrão inalterado |
| `src/lib/placar-governanca.js` *(criar)* | função pura: dos KIs do agente, quantos voltaram; quais famílias entram em parada |
| `docs/ops/PROTOCOLO-GOVERNANCA.md` *(criar)* | as 8 etapas, editável sem deploy |
| `docs/ops/ESCADA-GOVERNANCA.md` *(criar)* | degraus de evolução; o agente lê e atualiza |
| `src/services/governance-agent.js` *(criar)* | orquestra o ciclo, idempotência, entrega no grupo |
| `src/rituals/dispatcher.js` *(modificar)* | gancho diário 08:00 com janela de retry |

---

### Task 1: `ops-agent` aceita briefing e timeout próprios

**Files:**
- Modify: `src/services/ops-agent.js`
- Test: `src/services/ops-agent.test.js`

**Interfaces:**
- Produces: `runOpsAgent(pedido, { quem, briefing, timeoutMs })` — `briefing` substitui o texto do `buildBriefing(quem)`; `timeoutMs` substitui `OPS_TIMEOUT_MS`. Ambos opcionais; omitidos = comportamento de hoje.

- [ ] **Step 1: Escreva o teste que falha**

Adicione ao fim de `src/services/ops-agent.test.js`:

```js
// O canal de ops JÁ ESTÁ EM PRODUÇÃO. Estes parâmetros existem para o agente de governança
// reusar o spawn sem herdar o briefing genérico — e não podem mudar nada do que já roda.
test('runOpsAgent aceita briefing próprio sem alterar o padrão', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(typeof m.resolverBriefing, 'function');
  assert.strictEqual(m.resolverBriefing('Alf', 'PROTOCOLO XYZ'), 'PROTOCOLO XYZ');
  assert.match(m.resolverBriefing('Alf', null), /Alf/);
  assert.match(m.resolverBriefing('Alf', '   '), /Alf/, 'briefing em branco cai no padrão');
});

test('runOpsAgent aceita timeout próprio, com o default intacto', () => {
  const m = carregar(LIGADO);
  assert.strictEqual(m.resolverTimeout(1800000), 1800000);
  assert.strictEqual(m.resolverTimeout(undefined), m.OPS_TIMEOUT_MS);
  assert.strictEqual(m.resolverTimeout(0), m.OPS_TIMEOUT_MS, 'zero não pode virar timeout imediato');
  assert.strictEqual(m.resolverTimeout(-5), m.OPS_TIMEOUT_MS);
  assert.strictEqual(m.resolverTimeout('abc'), m.OPS_TIMEOUT_MS);
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd /d/la-organizer/_remote && node --test src/services/ops-agent.test.js
```
Esperado: FAIL — `m.resolverBriefing is not a function`.

- [ ] **Step 3: Implemente**

Em `src/services/ops-agent.js`, logo antes de `function runOpsAgent`:

```js
// Governança reusa este spawn com protocolo próprio. Extraído em funções puras para o
// zero-regressão do canal de ops ficar provado por teste, e não por leitura.
function resolverBriefing(quem, briefing) {
  return (typeof briefing === 'string' && briefing.trim()) ? briefing : buildBriefing(quem);
}

function resolverTimeout(timeoutMs) {
  return (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0)
    ? timeoutMs : OPS_TIMEOUT_MS;
}
```

Troque a assinatura e os dois usos dentro de `runOpsAgent`:

```js
function runOpsAgent(pedido, { quem = 'alguém do grupo', briefing = null, timeoutMs = null } = {}) {
```

```js
      '--append-system-prompt', resolverBriefing(quem, briefing),
```

```js
    const _limite = resolverTimeout(timeoutMs);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, _limite);
```

E no bloco que monta a mensagem de timeout, troque `OPS_TIMEOUT_MS` por `_limite`:

```js
        const motivo = code === null ? `passou de ${Math.round(_limite / 60000)} min e eu cortei`
          : `saiu com código ${code}`;
```

Adicione ao `module.exports`: `resolverBriefing, resolverTimeout, OPS_TIMEOUT_MS`.

- [ ] **Step 4: Rode os testes**

```bash
cd /d/la-organizer/_remote && node --test src/services/ops-agent.test.js
```
Esperado: PASS em todos (os 16 antigos + 2 novos = 18).

- [ ] **Step 5: Prove que o canal de ops não mudou**

```bash
cd /d/la-organizer/_remote && node --test "src/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Esperado: `fail 3` (baseline). Qualquer outro número = reverta.

- [ ] **Step 6: Commit**

```bash
git add src/services/ops-agent.js src/services/ops-agent.test.js
git commit -m "feat(ops): briefing e timeout injetáveis para o agente de governança reusar o spawn"
```

---

### Task 2: Placar de eficácia

**Files:**
- Create: `src/lib/placar-governanca.js`
- Test: `src/lib/placar-governanca.test.js`

**Interfaces:**
- Produces: `calcularPlacar(kis, findings)` → `{ fechados, reincidentes: [{codigo, vezes}], emParada: [codigo], taxa }`. `kis`: `[{codigo, corrigido_em, fix_resumo}]`. `findings`: `[{promoted_code, incident_at, auto_triage}]`.
- Produces: `MARCA_AGENTE` = `'[gov-agent]'`, `ehDoAgente(ki)`, `LIMITE_PARADA` = `2`.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/placar-governanca.test.js`:

```js
'use strict';
// ETAPA 1 do protocolo: antes de olhar achado novo, o agente pergunta "dos KIs que EU fechei,
// quantos voltaram?". Sem a marca de autoria ele mediria o trabalho dos outros como se fosse
// dele — daí o filtro por [gov-agent] ser testado junto.

const test = require('node:test');
const assert = require('node:assert');
const { calcularPlacar, ehDoAgente, MARCA_AGENTE, LIMITE_PARADA } = require('./placar-governanca');

const ki = (codigo, over = {}) => ({
  codigo, corrigido_em: '2026-08-01T12:00:00Z',
  fix_resumo: `${MARCA_AGENTE} consertei assim`, ...over,
});
const finding = (promoted_code, incident_at, decision = 'regression') => ({
  promoted_code, incident_at, auto_triage: { decision },
});

test('conta só os KIs marcados como do agente', () => {
  const kis = [ki('A'), ki('B'), ki('C', { fix_resumo: 'fix do Catraca, na mão' }), ki('D', { fix_resumo: null })];
  assert.strictEqual(calcularPlacar(kis, []).fechados, 2);
});

test('ehDoAgente exige a marca no início', () => {
  assert.strictEqual(ehDoAgente({ fix_resumo: '[gov-agent] x' }), true);
  assert.strictEqual(ehDoAgente({ fix_resumo: 'corrigido pelo [gov-agent]' }), false);
  assert.strictEqual(ehDoAgente({ fix_resumo: null }), false);
  assert.strictEqual(ehDoAgente(null), false);
});

test('reincidência só conta incidente DEPOIS do fix', () => {
  const kis = [ki('A', { corrigido_em: '2026-08-05T12:00:00Z' })];
  const antes = calcularPlacar(kis, [finding('A', '2026-08-04T10:00:00Z')]);
  assert.strictEqual(antes.reincidentes.length, 0, 'incidente anterior ao fix é cauda, não regressão');
  const depois = calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z')]);
  assert.strictEqual(depois.reincidentes.length, 1);
  assert.strictEqual(depois.reincidentes[0].vezes, 1);
});

test('só conta finding triado como regressão', () => {
  const kis = [ki('A')];
  const r = calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z', 'keep')]);
  assert.strictEqual(r.reincidentes.length, 0);
});

test('KI que voltou 2x entra em PARADA — não corrige mais essa família', () => {
  const kis = [ki('A')];
  const r = calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z'), finding('A', '2026-08-07T10:00:00Z')]);
  assert.strictEqual(r.reincidentes[0].vezes, LIMITE_PARADA);
  assert.deepStrictEqual(r.emParada, ['A']);
});

test('reincidência de KI que NÃO é do agente não entra no placar dele', () => {
  const kis = [ki('X', { fix_resumo: 'fix manual' })];
  const r = calcularPlacar(kis, [finding('X', '2026-08-06T10:00:00Z')]);
  assert.strictEqual(r.fechados, 0);
  assert.strictEqual(r.reincidentes.length, 0);
});

test('taxa é reincidentes sobre fechados, e não divide por zero', () => {
  assert.strictEqual(calcularPlacar([], []).taxa, 0);
  const kis = [ki('A'), ki('B'), ki('C'), ki('D')];
  const r = calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z')]);
  assert.strictEqual(r.taxa, 0.25);
});

test('entradas degeneradas não quebram', () => {
  for (const [a, b] of [[null, null], [undefined, []], [[], undefined], ['x', 'y']]) {
    const r = calcularPlacar(a, b);
    assert.strictEqual(typeof r.fechados, 'number');
    assert.ok(Array.isArray(r.emParada));
  }
});

test('KI sem corrigido_em não vira reincidência (não dá pra datar)', () => {
  const kis = [ki('A', { corrigido_em: null })];
  assert.strictEqual(calcularPlacar(kis, [finding('A', '2026-08-06T10:00:00Z')]).reincidentes.length, 0);
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd /d/la-organizer/_remote && node --test src/lib/placar-governanca.test.js
```
Esperado: FAIL — `Cannot find module './placar-governanca'`.

- [ ] **Step 3: Implemente**

Crie `src/lib/placar-governanca.js`:

```js
'use strict';
// placar-governanca.js — ETAPA 1 do protocolo do agente de governança.
//
// A pergunta que ele faz antes de qualquer coisa: "dos KIs que EU fechei, quantos voltaram?".
// É pré-requisito, não lembrete: sem o placar não há etapa 2. Isso existe porque a lição de
// 27/07 do Alf — 391 known-issues corrigidos e o sistema seguia instável — precisa virar algo
// que o próprio agente meça, e não uma frase num documento.
//
// A marca de autoria vive no `fix_resumo` e não numa coluna nova: a tabela já tem o campo e
// ele é livre, então zero migration. Sem a marca o agente mediria os fixes do Catraca e do
// Hugo como se fossem dele.

const MARCA_AGENTE = '[gov-agent]';
const LIMITE_PARADA = 2;   // mesmo KI voltando 2x = fix pontual não resolve; escala

function ehDoAgente(ki) {
  return !!(ki && typeof ki.fix_resumo === 'string' && ki.fix_resumo.trimStart().startsWith(MARCA_AGENTE));
}

/**
 * Placar dos consertos do agente. Puro: sem banco, sem relógio.
 * Só conta como reincidência o finding TRIADO como regressão cujo incidente é POSTERIOR ao
 * fix — incidente anterior é cauda de detecção, não volta (lição do AUDIT-REGRESSION-LASTSEEN).
 */
function calcularPlacar(kis, findings) {
  const meus = (Array.isArray(kis) ? kis : []).filter(ehDoAgente);
  const porCodigo = new Map();
  for (const k of meus) {
    if (k && k.codigo) porCodigo.set(String(k.codigo), Date.parse(k.corrigido_em || ''));
  }

  const vezesPorCodigo = new Map();
  for (const f of (Array.isArray(findings) ? findings : [])) {
    if (!f || !f.promoted_code) continue;
    const codigo = String(f.promoted_code);
    if (!porCodigo.has(codigo)) continue;                       // não é KI meu
    if ((f.auto_triage || {}).decision !== 'regression') continue;
    const tFix = porCodigo.get(codigo);
    const tInc = Date.parse(f.incident_at || '');
    if (!Number.isFinite(tFix) || !Number.isFinite(tInc)) continue;
    if (tInc <= tFix) continue;                                 // anterior ao fix: cauda
    vezesPorCodigo.set(codigo, (vezesPorCodigo.get(codigo) || 0) + 1);
  }

  const reincidentes = [...vezesPorCodigo.entries()].map(([codigo, vezes]) => ({ codigo, vezes }));
  const emParada = reincidentes.filter((r) => r.vezes >= LIMITE_PARADA).map((r) => r.codigo);
  const fechados = porCodigo.size;
  return {
    fechados,
    reincidentes,
    emParada,
    taxa: fechados ? reincidentes.length / fechados : 0,
  };
}

module.exports = { calcularPlacar, ehDoAgente, MARCA_AGENTE, LIMITE_PARADA };
```

- [ ] **Step 4: Rode os testes**

```bash
cd /d/la-organizer/_remote && node --test src/lib/placar-governanca.test.js
```
Esperado: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/placar-governanca.js src/lib/placar-governanca.test.js
git commit -m "feat(gov): placar de eficácia — dos KIs do agente, quantos voltaram"
```

---

### Task 3: O protocolo e a escada

**Files:**
- Create: `docs/ops/PROTOCOLO-GOVERNANCA.md`
- Create: `docs/ops/ESCADA-GOVERNANCA.md`

**Interfaces:**
- Produces: dois arquivos `.md` lidos em runtime pelo `governance-agent.js` (Task 4). Ficam **fora de `skills/`** de propósito: o loader de skills varre aquele diretório e isto não pode vazar pro TOM que fala com o time.

- [ ] **Step 1: Escreva o protocolo**

Crie `docs/ops/PROTOCOLO-GOVERNANCA.md` com o conteúdo abaixo. É lido a cada rodada — **editar este arquivo muda o comportamento do agente na hora, sem deploy**.

```markdown
# Protocolo do agente de governança

Você é o TOM tratando os achados da auditoria, sozinho, uma vez por dia. Você tem acesso real
ao repositório em produção, à VPS e ao banco. As etapas abaixo são uma ORDEM, não uma lista de
sugestões: pular etapa é o erro mais caro que você pode cometer aqui.

## ETAPA 1 — Placar (antes de olhar qualquer achado novo)

Dos known-issues que VOCÊ fechou (`fix_resumo` começa com `[gov-agent]`), quantos voltaram?

- Um mesmo KI reincidiu 2 vezes → **pare de corrigir essa família**. Leve ao grupo: "consertei
  isso duas vezes e voltou — não é fix pontual, a raiz é outra. Proposta: ...".
- Sem o placar você não passa para a etapa 2.

## ETAPA 2 — Escolha UM achado

Prioridade: regressão > severidade alta > o que tem literal claro. **Um por rodada.** Ninguém
revisa cinco mudanças de engine por dia.

## ETAPA 3 — Refute antes de acreditar

Nesta ordem, sem pular:

1. **`grep` o caso no `src/`**: nome da pessoa, data do incidente, código do marker. Em 08/08,
   quatro alvos seguidos JÁ TINHAM conserto no código — em três, o comentário citava o caso
   pelo nome.
2. **Puxe o literal** de `conversation_history`. O resumo do finding NÃO é a fala da pessoa.
3. **Date**: o fix que existe é anterior ou posterior ao incidente?
4. **Rode o caso contra o código atual.**

Ficou claro que já está corrigido? **Feche o finding com o veredito e encerre a rodada.**
Refutar é entrega, não fracasso. Não invente trabalho para justificar a rodada.

## ETAPA 4 — Prova de reversão

Escreva um teste que FALHA contra o código atual, reproduzindo o caso real.

⚠️ **Reproduza com a entrada real do turno, não com o pedido original da conversa.** Em 08/08
isso custou 8 tentativas em branco: com o áudio completo do usuário o modelo acertava 4/4; a
entrada real daquele turno era só "O q?", e aí errava 2/4.

**Sem teste vermelho, não corrija.** Relate o que tentou e pare.

## ETAPA 5 — Corrija

A menor mudança que faz o teste passar. Depois rode a suíte inteira:
`node --test "src/**/*.test.js"` — tem que terminar em `fail 3` (baseline de env ausente).
Qualquer teste a mais quebrado: reverta tudo e relate.

## ETAPA 6 — Registre

Grave o known-issue em `tom_known_issues` com causa-raiz, a prova de reversão (números antes e
depois) e `fix_resumo` começando com `[gov-agent]`. Feche o finding apontando para o KI.

## ETAPA 7 — Relate e SÓ ENTÃO suba

Poste o resultado no grupo ANTES de reiniciar o TOM.

⚠️ Você roda como processo FILHO do TOM: se reiniciar o TOM, mata a si mesmo e o relatório
nunca chega. Foi assim que um pedido do Alf sumiu em silêncio em 08/08 19:29. Reporte
primeiro; dispare o restart desacoplado (`nohup`/`setsid`), nunca por chamada direta.

## ETAPA 8 — Atualize a escada

Alguma etapa falhou de forma repetida? Registre em `docs/ops/ESCADA-GOVERNANCA.md` com o caso
concreto e a proposta de virar código.

## Limites — pare e leve ao grupo

- Decisão de negócio: mudar comportamento que o time inteiro sente, política, trade-off de produto.
- Fora de `src/`: PWA (`web/`), migration, config de infra.
- **Apagar dado de produção: SEMPRE OK explícito**, sem exceção.
- `soul/` e `skills/`: intocáveis. Isso é veto do Alf sobre a voz do TOM.
- Suíte fora do baseline depois do fix.
- Família em parada (reincidiu 2×).
- Não conseguiu reproduzir.

## Como escrever no grupo

Siga `docs/ops/FORMATO-GRUPO.md`. É WhatsApp, num celular, lido por duas pessoas ocupadas.
```

- [ ] **Step 2: Escreva a escada**

Crie `docs/ops/ESCADA-GOVERNANCA.md`:

```markdown
# Escada de evolução do agente de governança

O agente LÊ este arquivo no início de cada rodada e ESCREVE nele no fim, quando tiver
evidência. Subir de degrau é mudança no próprio agente — **precisa de OK do Alf ou do Hugo no
grupo**, não cabe na autonomia dele.

## Onde estamos

**Degrau 1** — o LLM executa todas as etapas, guiado pelo protocolo.

## Os degraus

| degrau | o que é | quando sobe |
|---|---|---|
| 1 | LLM executa tudo, guiado pelo protocolo | — |
| 2 | as etapas que provarem ser mecânicas viram código | uma etapa erra ≥3× no mesmo padrão |
| 3 | pipeline determinístico; LLM só onde exige julgamento | maioria das etapas no degrau 2 |

## Regra para propor subida

Não proponha melhoria genérica ("acho que devia ser mais determinístico"). Proponha a partir
do próprio erro medido, com o caso na mão:

> etapa X falhou N vezes, no padrão Y. Casos: [links/códigos]. Proposta: virar código assim.

## Registro de falhas por etapa

_(vazio — o agente preenche conforme errar)_
```

- [ ] **Step 3: Confirme que os arquivos não vazam para o prompt do TOM**

```bash
cd /d/la-organizer/_remote && grep -rn "docs/ops" src/prompts/ src/services/group-chat-prompt.js 2>/dev/null | grep -v ops-agent
```
Esperado: nenhuma linha. O loader de skills varre `skills/`, e estes arquivos estão em `docs/ops/`.

- [ ] **Step 4: Commit**

```bash
git add docs/ops/PROTOCOLO-GOVERNANCA.md docs/ops/ESCADA-GOVERNANCA.md
git commit -m "docs(gov): protocolo em 8 etapas e escada de evolução do agente"
```

---

### Task 4: `governance-agent.js` — o ciclo

**Files:**
- Create: `src/services/governance-agent.js`
- Test: `src/services/governance-agent.test.js`

**Interfaces:**
- Consumes: `runOpsAgent(pedido, { quem, briefing, timeoutMs })` (Task 1); `calcularPlacar`, `MARCA_AGENTE` (Task 2); `PROTOCOLO-GOVERNANCA.md`, `ESCADA-GOVERNANCA.md` (Task 3).
- Produces: `rodarCicloGovernanca(sb, { postar, ymd, force, rodar })` → `{ rodou, motivo }`. `montarPedido(placar)` → string. `carregarPlacar(sb)` → placar.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/services/governance-agent.test.js`:

```js
'use strict';
// O ciclo diário. O que este teste protege: (a) não rodar duas vezes no mesmo dia — o cron
// bate a cada 5min dentro de uma janela de retry; (b) a família em parada chegar ao pedido,
// senão o agente reincide no mesmo fix que já falhou duas vezes; (c) nunca ficar em silêncio.

const test = require('node:test');
const assert = require('node:assert');

const DONO = '0576f4b6-183d-4cf1-980e-5c8d5da0177f';

function carregar(env) {
  const ANTES = { ...process.env };
  Object.assign(process.env, { TOM_GOV_AGENT: '1', TOM_OPS_ALLOWLIST: DONO, ...env });
  delete require.cache[require.resolve('./governance-agent')];
  const mod = require('./governance-agent');
  process.env = ANTES;
  return mod;
}

function fakeSb({ jaRodou = false, kis = [], findings = [] } = {}) {
  const inserts = [];
  const mk = (resultado) => {
    const o = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'not', 'ilike']) o[m] = () => o;
    o.insert = (row) => { inserts.push(row); return mk({ data: null, error: null }); };
    o.then = (ok) => ok(resultado);
    return o;
  };
  return {
    inserts,
    from: (t) => {
      if (t === 'ritual_logs') return mk({ data: jaRodou ? [{ id: 'x' }] : [], error: null });
      if (t === 'tom_known_issues') return mk({ data: kis, error: null });
      return mk({ data: findings, error: null });
    },
  };
}

test('não roda duas vezes no mesmo dia', async () => {
  const m = carregar();
  const chamadas = [];
  const r = await m.rodarCicloGovernanca(fakeSb({ jaRodou: true }), {
    postar: () => {}, ymd: '2026-08-09', rodar: () => { chamadas.push(1); return Promise.resolve({ ok: true, text: 'x' }); },
  });
  assert.strictEqual(r.rodou, false);
  assert.strictEqual(chamadas.length, 0, 'gastou uma rodada de Opus 5 à toa');
});

test('force ignora o gate do dia', async () => {
  const m = carregar();
  let chamou = 0;
  const r = await m.rodarCicloGovernanca(fakeSb({ jaRodou: true }), {
    postar: () => {}, ymd: '2026-08-09', force: true,
    rodar: () => { chamou++; return Promise.resolve({ ok: true, text: 'feito' }); },
  });
  assert.strictEqual(r.rodou, true);
  assert.strictEqual(chamou, 1);
});

test('desligado por env não roda', async () => {
  const m = carregar({ TOM_GOV_AGENT: '0' });
  const r = await m.rodarCicloGovernanca(fakeSb(), { postar: () => {}, ymd: '2026-08-09', rodar: () => Promise.resolve({ ok: true, text: 'x' }) });
  assert.strictEqual(r.rodou, false);
});

test('grava o log do dia só DEPOIS de postar', async () => {
  const m = carregar();
  const sb = fakeSb();
  const postadas = [];
  await m.rodarCicloGovernanca(sb, {
    postar: (t) => postadas.push(t), ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: true, text: 'relatório do ciclo' }),
  });
  assert.strictEqual(postadas.length, 1);
  assert.strictEqual(sb.inserts.length, 1);
  assert.strictEqual(sb.inserts[0].ritual_type, 'gov_agent');
});

test('se postar falhar, NÃO grava o log — o próximo tick retenta', async () => {
  const m = carregar();
  const sb = fakeSb();
  await assert.rejects(() => m.rodarCicloGovernanca(sb, {
    postar: () => { throw new Error('uazapi 503'); }, ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: true, text: 'x' }),
  }));
  assert.strictEqual(sb.inserts.length, 0);
});

test('agente que volta sem texto vira aviso, não silêncio', async () => {
  const m = carregar();
  const postadas = [];
  await m.rodarCicloGovernanca(fakeSb(), {
    postar: (t) => postadas.push(t), ymd: '2026-08-09',
    rodar: () => Promise.resolve({ ok: false, text: '' }),
  });
  assert.strictEqual(postadas.length, 1);
  assert.match(postadas[0], /n[ãa]o/i);
});

test('o pedido carrega a família em parada — senão ele reincide no mesmo fix', () => {
  const m = carregar();
  const pedido = m.montarPedido({ fechados: 3, reincidentes: [{ codigo: 'FOO-BAR', vezes: 2 }], emParada: ['FOO-BAR'], taxa: 0.33 });
  assert.match(pedido, /FOO-BAR/);
  assert.match(pedido, /parada|n[ãa]o corrij/i);
});

test('o pedido cita o protocolo e o placar mesmo quando está tudo limpo', () => {
  const m = carregar();
  const pedido = m.montarPedido({ fechados: 0, reincidentes: [], emParada: [], taxa: 0 });
  assert.match(pedido, /ETAPA 1|placar/i);
  assert.ok(pedido.length > 100);
});
```

- [ ] **Step 2: Rode e veja falhar**

```bash
cd /d/la-organizer/_remote && node --test src/services/governance-agent.test.js
```
Esperado: FAIL — `Cannot find module './governance-agent'`.

- [ ] **Step 3: Implemente**

Crie `src/services/governance-agent.js`:

```js
'use strict';
// governance-agent.js — o ciclo diário do agente de governança.
//
// Reusa o spawn do canal de ops (ops-agent.js): CLI `claude` com ferramentas, cwd no repo,
// sanitizador markdown→WhatsApp, split em mensagens, typing sustentado e drain hook de
// restart — tudo provado em produção em 08/08. O que é novo aqui é o PROTOCOLO e o PLACAR.
//
// Spec: docs/superpowers/specs/2026-08-08-agente-governanca-design.md

const fs = require('fs');
const path = require('path');
const opsAgent = require('./ops-agent');
const { calcularPlacar, MARCA_AGENTE } = require('../lib/placar-governanca');

const REPO = process.env.TOM_OPS_REPO || '/opt/LA-Organizer';
const PROTOCOLO_PATH = process.env.TOM_GOV_PROTOCOLO || path.join(REPO, 'docs/ops/PROTOCOLO-GOVERNANCA.md');
const ESCADA_PATH = process.env.TOM_GOV_ESCADA || path.join(REPO, 'docs/ops/ESCADA-GOVERNANCA.md');
// Um ciclo é refutar + reproduzir + corrigir + suíte inteira. 10 min (o default do canal de
// ops) não cobre: a suíte sozinha leva minutos.
const GOV_TIMEOUT_MS = Number(process.env.TOM_GOV_TIMEOUT_MS || 30 * 60 * 1000);
const GOV_ON = process.env.TOM_GOV_AGENT === '1';
const GOV_OWNER = (process.env.TOM_OPS_ALLOWLIST || '').split(',')[0].trim();
const JANELA_FINDINGS_DIAS = Number(process.env.TOM_GOV_JANELA_DIAS || 2);

function lerArquivo(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); }
  catch (e) { console.warn(`[GovAgent] não li ${p}: ${e.message}`); return ''; }
}

/** Placar + escada do banco. Nunca lança: sem placar, o ciclo não começa. */
async function carregarPlacar(sb) {
  const desde = new Date(Date.now() - 90 * 86400000).toISOString();
  const [kisRes, findRes] = await Promise.all([
    sb.from('tom_known_issues').select('codigo, corrigido_em, fix_resumo')
      .not('corrigido_em', 'is', null).gte('corrigido_em', desde),
    sb.from('tom_audit_findings').select('promoted_code, incident_at, auto_triage')
      .not('promoted_code', 'is', null).gte('incident_at', desde),
  ]);
  return calcularPlacar(kisRes.data || [], findRes.data || []);
}

/** O pedido que vai ao agente. O protocolo inteiro vai no briefing; aqui vai o estado do dia. */
function montarPedido(placar) {
  const p = placar || { fechados: 0, reincidentes: [], emParada: [], taxa: 0 };
  const parada = p.emParada.length
    ? `\n\n🛑 EM PARADA — NÃO corrija nada destas famílias, elas já voltaram 2x depois de um fix seu: `
      + `${p.emParada.join(', ')}. Para cada uma, leve ao grupo a proposta de raiz, não um novo fix pontual.`
    : '';
  const reincid = p.reincidentes.length
    ? `\nReincidiram: ${p.reincidentes.map((r) => `${r.codigo} (${r.vezes}x)`).join(', ')}.`
    : '';
  return `Rode o ciclo de governança de hoje, seguindo o protocolo do seu briefing na ordem.

ETAPA 1 já foi medida pra você (confira no banco se quiser, mas não repita o trabalho):
- Known-issues fechados por você (${MARCA_AGENTE}): ${p.fechados}
- Reincidentes: ${p.reincidentes.length}${reincid}
- Taxa de reincidência: ${(p.taxa * 100).toFixed(0)}%${parada}

Agora siga da ETAPA 2 em diante: escolha UM achado dos últimos ${JANELA_FINDINGS_DIAS} dias em
tom_audit_findings (status novo/confirmado), refute antes de acreditar, e só corrija o que
conseguir reproduzir com teste vermelho.

Se refutar, isso é entrega: feche o finding com o veredito e relate. Não invente trabalho.`;
}

/**
 * Roda o ciclo e entrega no grupo. `postar` e `rodar` são injetados (testável, sem ciclo de
 * require com o group-chat-engine). Só grava o log DEPOIS de postar: se o envio falhar, o
 * próximo tick da janela retenta.
 */
async function rodarCicloGovernanca(sb, { postar, ymd, force = false, rodar = null } = {}) {
  if (!GOV_ON) return { rodou: false, motivo: 'desligado' };
  if (typeof postar !== 'function') return { rodou: false, motivo: 'sem canal de envio' };
  if (!GOV_OWNER) return { rodou: false, motivo: 'sem owner para idempotência' };

  if (!force) {
    const { data: ja } = await sb.from('ritual_logs').select('id')
      .eq('collaborator_id', GOV_OWNER).eq('ritual_type', 'gov_agent')
      .eq('reference_date', ymd).eq('status', 'sent').limit(1);
    if (ja && ja.length) return { rodou: false, motivo: 'já rodou hoje' };
  }

  const placar = await carregarPlacar(sb);
  const briefing = [lerArquivo(PROTOCOLO_PATH), lerArquivo(ESCADA_PATH)].filter(Boolean).join('\n\n---\n\n');
  const executar = rodar || ((pedido) => opsAgent.runOpsAgent(pedido, {
    quem: 'o ciclo automático de governança', briefing, timeoutMs: GOV_TIMEOUT_MS,
  }));

  const r = await executar(montarPedido(placar), { briefing });
  const texto = (r && typeof r.text === 'string' && r.text.trim())
    ? r.text
    : '⚠️ Rodei o ciclo de governança e voltei sem texto — isso é bug meu, não resultado. Não mexi em nada.';

  await postar(texto);
  await sb.from('ritual_logs').insert({
    collaborator_id: GOV_OWNER, ritual_type: 'gov_agent', reference_date: ymd,
    status: 'sent', sent_at: new Date().toISOString(),
    detail: `fechados=${placar.fechados} reincidentes=${placar.reincidentes.length} parada=${placar.emParada.length}`,
  });
  return { rodou: true, motivo: 'ok', placar };
}

module.exports = {
  rodarCicloGovernanca, montarPedido, carregarPlacar, GOV_TIMEOUT_MS, JANELA_FINDINGS_DIAS,
};
```

- [ ] **Step 4: Rode os testes**

```bash
cd /d/la-organizer/_remote && node --test src/services/governance-agent.test.js
```
Esperado: PASS, 8 testes.

- [ ] **Step 5: Suíte inteira**

```bash
cd /d/la-organizer/_remote && node --test "src/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Esperado: `fail 3`.

- [ ] **Step 6: Commit**

```bash
git add src/services/governance-agent.js src/services/governance-agent.test.js
git commit -m "feat(gov): ciclo diário do agente de governança com placar e idempotência"
```

---

### Task 5: Gancho diário no dispatcher

**Files:**
- Modify: `src/rituals/dispatcher.js` (constantes de horário ~linha 85; bloco novo depois do digest de ops; lista de `force` ~linha 3685)

**Interfaces:**
- Consumes: `rodarCicloGovernanca(sb, { postar, ymd, force })` (Task 4); `postOpsResult(supabase, groupId, texto)` (já exportado do `group-chat-engine.js`).

- [ ] **Step 1: `.deploy-hold` antes de tocar em `src/`**

```bash
echo "governanca task5" > /d/la-organizer/.deploy-hold
```

- [ ] **Step 2: Adicione a constante de horário**

Em `src/rituals/dispatcher.js`, logo abaixo de `const OPS_DIGEST_TIME = '07:30';`:

```js
const GOV_AGENT_TIME = '08:00';                 // Every day — ciclo do agente de governança (após o digest)
```

- [ ] **Step 3: Libere o `force`**

Na linha que lista as exceções de `opts.force` (procure por `opts.force !== 'ops_digest'`), acrescente `&& opts.force !== 'gov_agent'` na mesma cadeia.

- [ ] **Step 4: Adicione o bloco de disparo**

Logo APÓS o bloco `if (opts.force === 'ops_digest' || ...) { ... }` e antes do comentário `// LA EDUCA — lembretes semanais`:

```js
  // Agente de governança — 08:00 BRT, depois do digest das 07:30 (que já mostrou os achados
  // ao Alf e ao Hugo). Ele trata UM achado por rodada e só corrige o que reproduzir.
  // Spec: docs/superpowers/specs/2026-08-08-agente-governanca-design.md
  // Janela de retry até 12h pelo mesmo motivo do health report: UAZAPI hibernada devolve 503.
  const _gaSlot = timeToSlot(GOV_AGENT_TIME);    // 480 (08:00)
  const _gaCutoff = timeToSlot('12:00');         // 720 — desiste por hoje, sem spam
  if (opts.force === 'gov_agent' || (slotNow >= _gaSlot && slotNow < _gaCutoff)) {
    try {
      const { rodarCicloGovernanca } = require('../services/governance-agent');
      const { postOpsResult } = require('../services/group-chat-engine');
      const _gaGrupo = (process.env.TOM_OPS_GROUP_ID || '').trim();
      if (_gaGrupo) {
        const r = await rodarCicloGovernanca(supabase, {
          ymd: now.ymd,
          force: opts.force === 'gov_agent',
          // quiet-exempt: canal de engenharia do Alf e do Hugo, não é envio a colaborador.
          postar: (txt) => postOpsResult(supabase, _gaGrupo, txt),
        });
        if (r.rodou) console.log(`[GovAgent] ciclo concluído: ${JSON.stringify(r.placar || {})}`);
      }
    } catch (err) {
      console.error('[GovAgent] erro (retenta no próximo tick até 12h):', err.message);
    }
  }
```

- [ ] **Step 5: Verifique sintaxe e suíte**

```bash
cd /d/la-organizer/_remote && node --check src/rituals/dispatcher.js && node --test "src/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Esperado: sem erro de sintaxe; `fail 3`.

- [ ] **Step 6: Commit e libere o hold**

```bash
cd /d/la-organizer/_remote && git add src/rituals/dispatcher.js && git commit -m "feat(gov): gancho diário do agente de governança às 08:00"
rm -f /d/la-organizer/.deploy-hold
```

---

### Task 6: Deploy, validação em produção e registro

**Files:**
- Modify: `docs/superpowers/RETOMADA.md`
- Modify: `.env` na VPS (via ssh)

- [ ] **Step 1: Confira paridade antes de subir (deploy cirúrgico)**

```bash
cd /d/la-organizer/_remote && for f in src/rituals/dispatcher.js src/services/ops-agent.js; do echo -n "$f HEAD: "; git show HEAD:$f | md5sum | cut -c1-8; done; echo "--- VPS:"; ssh tom "cd /opt/LA-Organizer && md5sum src/rituals/dispatcher.js src/services/ops-agent.js | cut -c1-8"
```
Esperado: hashes iguais nos dois lados. **Divergiu = pare** e investigue antes de subir (outro chat mexeu).

- [ ] **Step 2: Ligue as envs na VPS, com backup**

```bash
ssh tom "cd /opt/LA-Organizer && cp .env .env.bak-gov && printf '\n# Agente de governanca (spec 08/08). Kill switch: TOM_GOV_AGENT=0\nTOM_GOV_AGENT=1\nTOM_GOV_TIMEOUT_MS=1800000\n' >> .env && grep -n 'TOM_GOV' .env"
```
Esperado: as duas linhas listadas.

- [ ] **Step 3: Suba os arquivos e reinicie**

```bash
cd /d/la-organizer/_remote && ssh tom "mkdir -p /opt/LA-Organizer/src/lib /opt/LA-Organizer/docs/ops" && scp -q src/lib/placar-governanca.js tom:/opt/LA-Organizer/src/lib/ && scp -q src/services/governance-agent.js src/services/ops-agent.js tom:/opt/LA-Organizer/src/services/ && scp -q src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/ && scp -q docs/ops/PROTOCOLO-GOVERNANCA.md docs/ops/ESCADA-GOVERNANCA.md tom:/opt/LA-Organizer/docs/ops/ && ssh tom "cd /opt/LA-Organizer && node --check src/rituals/dispatcher.js && pm2 restart tom >/dev/null 2>&1 && sleep 4 && pm2 describe tom | grep -E '│ status'"
```
Esperado: `online`.

- [ ] **Step 4: Rode UM ciclo de verdade, forçado**

⚠️ Isto vai postar no grupo e **pode mexer no `src/` em produção**. É a validação que importa: sem ela, "está no ar" é chute.

```bash
ssh tom "cd /opt/LA-Organizer && nohup node --env-file=.env src/rituals/dispatcher.js --force=gov_agent > /tmp/gov-run.log 2>&1 & sleep 5; echo disparado"
```

- [ ] **Step 5: Acompanhe e confira o resultado**

```bash
ssh tom "sleep 240; tail -20 /tmp/gov-run.log; echo '--- log:'; grep -a 'GovAgent' /opt/LA-Organizer/logs/*.log | tail -5"
```

Confira no banco que a entrega aconteceu e que o log do dia foi gravado:

```sql
select role, to_char(created_at at time zone 'America/Sao_Paulo','HH24:MI:SS') as brt,
       left(content, 200) as msg
from group_chat_messages
where group_id = 'b3bd198a-c81a-40dc-addc-16838614cbae' and created_at > now() - interval '20 minutes'
order by created_at;

select ritual_type, reference_date, status, detail from ritual_logs
where ritual_type = 'gov_agent' order by sent_at desc limit 2;
```

Esperado: mensagem no grupo com o resultado do ciclo, e uma linha em `ritual_logs`.

- [ ] **Step 6: Confira que ele NÃO mexeu no que não devia**

```bash
ssh tom "cd /opt/LA-Organizer && git status --short && git log --oneline -3"
```
Esperado: nenhuma mudança em `soul/`, `skills/` ou `web/`. Se houver, **reverta e desligue** (`TOM_GOV_AGENT=0` + restart) antes de qualquer outra coisa.

- [ ] **Step 7: Rode de novo e prove a idempotência**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e \"const sb=require('./src/supabase/client'); const g=require('./src/services/governance-agent'); g.rodarCicloGovernanca(sb,{postar:()=>{console.log('POSTOU DE NOVO — BUG')},ymd:new Date().toISOString().slice(0,10),rodar:()=>Promise.resolve({ok:true,text:'x'})}).then(r=>console.log('2a rodada:',JSON.stringify(r)))\""
```
Esperado: `{"rodou":false,"motivo":"já rodou hoje"}` e nenhum "POSTOU DE NOVO".

- [ ] **Step 8: Registre no checkpoint e faça o commit final**

Atualize `docs/superpowers/RETOMADA.md`: mova o agente de governança de "não esquecer" para "no ar", com a data, o kill switch (`TOM_GOV_AGENT=0` + restart), o horário (08:00, janela até 12h) e o que medir em 15/08 — quantos ciclos rodaram, quantos refutaram, quantos corrigiram, e se algum KI `[gov-agent]` já reincidiu.

```bash
cd /d/la-organizer/_remote && git add -A && git commit -m "feat(gov): agente de governança no ar — ciclo diário 08:00" && git pull --rebase -q origin main && git push -q origin main && ssh tom "cd /opt/LA-Organizer && git fetch -q origin && git reset --hard origin/main -q && git log --oneline -1"
```

---

## Self-review

**Cobertura da spec:** autonomia com prova obrigatória → protocolo etapas 3-5 (Task 3) · raio só `src/` → limites do protocolo (Task 3) + verificação no Step 6 da Task 6 · cadência diária 08:00 → Task 5 · arquitetura A → Task 1 + Task 4 · placar como etapa 1 → Task 2 + `montarPedido` (Task 4) · marca `[gov-agent]` → Task 2 · escada → Task 3 · trava de 2 reincidências → Task 2 (`LIMITE_PARADA`) e o pedido carrega `emParada` (Task 4) · reportar antes de subir → protocolo etapa 7 · nunca silêncio → teste "volta sem texto vira aviso" (Task 4) · idempotência → Task 4 + Task 5.

**Riscos que ficam de pé, conscientemente:**
- A **primeira rodada real** (Task 6 Step 4) pode mexer no `engine.js` em produção. É por isso que o Step 6 confere `git status` e o Step 2 guarda `.env.bak-gov`. Rollback: `TOM_GOV_AGENT=0` + restart.
- O agente decide sozinho o que é "decisão de negócio". Isso é julgamento de LLM e não tem trava de código — é a aposta explícita da spec, aprovada pelo Alf.
