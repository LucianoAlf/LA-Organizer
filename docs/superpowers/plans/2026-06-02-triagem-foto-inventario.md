# Triagem de foto + Trava de sala no inventário — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que o TOM cadastre foto de item no inventário sem confirmar a sala (bug da Sala 13 chutada) e sem triar a intenção (problema vs inventário vs lojinha).

**Architecture:** Trava de sala **determinística no engine** (função pura testável + guard no handler `<<INVENTORY_ACTION>>`, alimentado por contexto de sala do `system.js`) + **roteador de triagem no prompt** (`skills/inventario.md`).

**Tech Stack:** Node.js (ES CommonJS), `node:test`, skills em Markdown. Deploy via auto-deploy/scp + `pm2 restart tom`. Projeto: NÃO commitar entre tasks (convenção CLAUDE.md) — o auto-deploy faz o bundle.

---

## Convenções deste projeto (ler antes)
- `_remote` **não é git repo** → **sem `git commit` por task**. Verificação = `node --test` / `node --check`.
- Módulos puros (sem `require` de supabase) são testáveis local; o que carrega o engine só roda no VPS.
- Anti-mentira já implementado: no bloco `<<INVENTORY_ACTION>>`, `reply` é zerado e cada branch seta o texto real do engine. A trava reusa isso (em bloqueio, seta a pergunta).

---

### Task 1: Função pura `salaConfirmada` (TDD)

**Files:**
- Create: `src/services/inventory-sala-guard.js`
- Test: `src/services/inventory-sala-guard.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { salaConfirmada } = require('./inventory-sala-guard');

const SESSAO_13 = { sala_id: 36, sala_nome: 'Sala 13 Cordas' };

test('sessão travada + marker sem sala → confirmada (fluxo batch)', () => {
  assert.strictEqual(salaConfirmada({ persisted: SESSAO_13, inboundText: 'guitarra tagima' }), true);
});

test('sessão travada + marker com a MESMA sala → confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13 Cordas', persisted: SESSAO_13, inboundText: '' }), true);
});

test('sessão travada + marker sala DIFERENTE dita no turno → confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 14', persisted: SESSAO_13, inboundText: 'agora a Sala 14' }), true);
});

test('sem sessão + user disse a sala no texto → confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13', persisted: null, inboundText: 'Sala 13 - Campo Grande' }), true);
});

test('sem sessão + nome cheio no marker mas número bate no texto → confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13 Cordas', persisted: null, inboundText: 'campo grande, sala 13' }), true);
});

test('caption da foto com a sala conta (vem no inboundText) → confirmada', () => {
  const t = '[O usuário ACABOU DE ENVIAR uma imagem agora — Análise: guitarra]\nLegenda enviada pelo usuário: "Guitarra X — Sala 13"';
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13', persisted: null, inboundText: t }), true);
});

test('BUG-ALVO: sem sessão + texto sem sala + marker herdou sala do histórico → NÃO confirmada', () => {
  const t = '[O usuário ACABOU DE ENVIAR uma imagem agora — Análise: guitarra vermelha]';
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13', persisted: null, inboundText: t }), false);
});

test('normalização: acento/caixa não atrapalham', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Salão Nobre', persisted: null, inboundText: 'cadastra no salao nobre' }), true);
});

test('nada confirmado (sem sessão, sem texto) → NÃO confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13', persisted: null, inboundText: '' }), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote && node --test src/services/inventory-sala-guard.test.js`
Expected: FAIL — `Cannot find module './inventory-sala-guard'`

- [ ] **Step 3: Implementar o mínimo**

```js
// src/services/inventory-sala-guard.js
//
// Trava DETERMINÍSTICA de sala no cadastro de inventário. O LLM não pode inserir
// numa sala "herdada" do histórico (bug Sala 13, 02/06). Só confirma quando:
//   (a) há sessão de inventário travada (salaRecentePersistida) que casa, ou
//   (b) o user disse a sala na mensagem atual (texto ou legenda da foto).
// Módulo puro → testável isolado. Consumido no handler <<INVENTORY_ACTION>>.
'use strict';

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function salaConfirmada({ markerSalaNome, markerSalaId, persisted, inboundText } = {}) {
  // (a) sessão de inventário travada
  if (persisted) {
    if (markerSalaId && persisted.sala_id && String(markerSalaId) === String(persisted.sala_id)) return true;
    if (markerSalaNome && persisted.sala_nome && norm(markerSalaNome) === norm(persisted.sala_nome)) return true;
    if (!markerSalaNome && !markerSalaId) return true; // marker usa a sala da sessão
  }
  // (b) user disse a sala no turno atual (texto ou legenda)
  const t = norm(inboundText);
  if (markerSalaNome && t) {
    const sn = norm(markerSalaNome);
    if (sn && t.includes(sn)) return true;
    const num = (String(markerSalaNome).match(/\d+/) || [])[0];
    if (num && new RegExp(`sala\\s*${num}\\b`).test(t)) return true;
  }
  return false;
}

module.exports = { salaConfirmada, norm };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote && node --test src/services/inventory-sala-guard.test.js`
Expected: PASS — 9 tests, 0 fail.

---

### Task 2: Expor o contexto de sala no `ctx` (system.js)

**Files:**
- Modify: `src/prompts/system.js` (onde `salaRecentePersistida` é calculado, ~linha 3118-3143, e onde `ctx`/retorno é montado)

- [ ] **Step 1: Localizar o retorno do ctx e a var salaRecentePersistida**

Run: `cd _remote && grep -n "salaRecentePersistida\|return { systemPrompt\|ctx\." src/prompts/system.js | head`
Expected: ver a linha onde `salaRecentePersistida` é resolvida e onde o objeto `ctx`/retorno é construído.

- [ ] **Step 2: Adicionar `invSalaContext` ao ctx**

No ponto onde o `ctx` (objeto retornado junto com `systemPrompt`) é montado, adicionar:

```js
// Contexto de sala travada do inventário — consumido pela trava no engine
// (impede insert com sala herdada do histórico). null = sem sessão.
ctx.invSalaContext = salaRecentePersistida
  ? { sala_id: salaRecentePersistida.sala_id ?? null, sala_nome: salaRecentePersistida.sala_nome ?? null }
  : null;
```

> Nota: se `salaRecentePersistida` estiver fora do escopo do retorno, atribuir
> `ctx.invSalaContext` logo após a linha 3143 (onde já está resolvida) usando o
> mesmo `ctx` que será retornado. Garantir que `ctx` já existe nesse ponto.

- [ ] **Step 3: Verificar sintaxe**

Run: `cd _remote && node --check src/prompts/system.js`
Expected: sem erro (exit 0).

---

### Task 3: Trava de sala no handler `<<INVENTORY_ACTION>>` (engine.js)

**Files:**
- Modify: `src/engine.js` (require no topo + branch de insert, perto de `inserirItem`)

- [ ] **Step 1: Adicionar o require no topo (junto aos outros services)**

Anchor (já existe, adicionado em fix anterior):
```js
const pendingInventoryPhoto = require('./services/pending-inventory-photo');
```
Adicionar logo após:
```js
const { salaConfirmada } = require('./services/inventory-sala-guard');
```

- [ ] **Step 2: Aplicar a trava ANTES do inserirItem**

No branch de insert (action create/add_item), localizar:
```js
                    const item = await inventarioService.inserirItem(itemPayload, userName);
```
Inserir ANTES dela:
```js
                    // TRAVA DE SALA (determinística): não insere com sala herdada
                    // do histórico. Confirmada = sessão travada OU sala dita no turno.
                    if (!salaConfirmada({
                      markerSalaNome: p.sala_nome,
                      markerSalaId: p.sala_id || salaId,
                      persisted: ctx && ctx.invSalaContext,
                      inboundText: inboundVerbatimText,
                    })) {
                      reply = `Em qual *unidade* e *sala* você quer cadastrar a *${String(p.nome || itemPayload.nome || 'item').trim()}*? (ex: Sala 13 — Campo Grande)`;
                    } else {
                    const item = await inventarioService.inserirItem(itemPayload, userName);
```

E FECHAR o `else` logo após o bloco de anexo de foto + a linha do "✅ Item adicionado"
(que termina o sucesso do insert). Ou seja, envolver o trecho `inserirItem → anexo de
foto → reply '✅ Item adicionado...'` no `else { ... }`.

> Cuidado: balancear as chaves. O `else {` abre antes do `const item`; o `}` de
> fechamento vai logo depois da linha:
> `reply = (reply ? reply + '\n\n' : '') + ` + "`✅ Item adicionado: ...${_fotoMsg}`;"

- [ ] **Step 3: Verificar sintaxe + suíte**

Run: `cd _remote && node --check src/engine.js && node --test 'src/**/*.test.js'`
Expected: ENGINE OK; suíte passa (1 falha conhecida ambiental `engine.guardrail.test.js` por falta de `src/supabase/client.js` local — ignorar essa).

---

### Task 4: Roteador de triagem (skills/inventario.md)

**Files:**
- Modify: `skills/inventario.md` (adicionar seção de triagem no topo, antes da regra "EMITA IMEDIATAMENTE")

- [ ] **Step 1: Inserir a seção de triagem**

Adicionar, logo após a introdução da skill (antes da instrução de emitir o marker):

```markdown
## ⚠️ TRIAGEM — foto de item NÃO é cadastro automático

Quando chega uma **foto de instrumento/equipamento**, decida a rota ANTES de agir:

- **Intenção clara = cadastrar** ("cadastra", "registra no inventário", "adiciona no estoque da sala") → `<<INVENTORY_ACTION>>` (você AINDA precisa da unidade+sala confirmadas — ver abaixo).
- **Intenção clara = problema** ("tá com defeito", "corda velha", "quebrado", "não funciona", "estragado", "precisa de conserto") → isto é OPERAÇÃO TÉCNICA: crie uma task pro responsável (Operações Técnicas → Rafinha). NÃO cadastre no inventário.
- **Intenção clara = lojinha** ("pra vender", "produto novo da lojinha") → fluxo da lojinha.
- **Sessão de inventário ABERTA** (o user disse "tô fazendo o inventário da Sala X" e a sala está travada) → as fotos seguintes vão direto pro inventário daquela sala. NÃO pergunte de novo.
- **AMBÍGUO** (só a foto, ou descrição que não deixa claro o que fazer) → **PERGUNTE**, não chute:
  > O que você quer com essa *[item]*?
  > 1) Cadastrar no inventário
  > 2) Reportar um problema (mando pro responsável)
  > 3) Outra coisa

**Regra de sala (NÃO NEGOCIÁVEL):** só emita `<<INVENTORY_ACTION>>` de cadastro com a
sala que o user **confirmou nesta conversa** (sessão aberta) ou **disse na mensagem
atual**. NUNCA herde a sala de mensagens antigas do histórico. Sem sala confirmada,
PERGUNTE "em qual unidade e sala?". (O engine também trava isso — se você chutar, o
cadastro é recusado.)

"Condição" do item (ex.: "sem cordas") **dentro de uma sessão de inventário** vira o
campo `condicao` do item. **Fora** de sessão, "tá com problema" é task pro Rafinha.
```

- [ ] **Step 2: Verificar que não quebrou nada óbvio**

Run: `cd _remote && grep -c "TRIAGEM" skills/inventario.md`
Expected: `1`

---

## Self-Review (cobertura da spec)

- Parte 1 (roteador de triagem) → **Task 4** ✓ (inventário/problema/lojinha/sessão/ambíguo + regra de sala no prompt).
- Parte 2 (trava de sala determinística) → **Task 1** (função pura + TDD) + **Task 2** (contexto no ctx) + **Task 3** (guard no engine) ✓.
- Roteamento de problema → Rafinha: reusa `operacoes-tecnicas` (instruído no prompt da Task 4) ✓.
- Edge cases (caption com sala, sessão aberta, foto fria, número da sala, normalização) → cobertos nos testes da Task 1 ✓.
- Anti-mentira: a trava seta `reply` direto (engine = fonte da verdade) ✓.

## Verificação final (teste controlado, pós-deploy)
1. `pm2 restart tom` no VPS com o código novo.
2. **Foto fria** (sem sessão, sem dizer sala) → TOM deve **perguntar** unidade+sala (não cadastrar).
3. **Foto + "tá com a corda velha"** → vira **task pro Rafinha** (não inventário).
4. **Sessão aberta** ("inventário da Sala 13") + fotos → cadastra direto na Sala 13.
5. Conferir no `ouqwbber` que cadastros só aconteceram com sala confirmada.
