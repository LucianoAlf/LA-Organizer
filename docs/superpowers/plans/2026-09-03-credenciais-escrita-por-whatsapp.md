# Credenciais por WhatsApp — escrita com executor determinístico (fatia 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hugo, Luciano e Anne passam a cadastrar, editar e apagar credenciais conversando com o TOM — por texto ou por imagem — sem que nenhuma escrita aconteça sem confirmação explícita e sem que o segredo circule em claro pelos logs.

**Architecture:** O modelo apenas **extrai** os dados da mensagem e emite `<<CREDENCIAL_ACTION>>`; o engine é quem decide e persiste. Antes de gravar, o engine roda uma checagem anti-duplicata determinística, monta um resumo com o valor sensível mascarado e abre uma `pending_intent` — a escrita só acontece quando a pessoa confirma. A gravação passa por RPCs que validam `is_system_admin` no próprio banco. Um redator roda **na entrada**, sobre o texto já com a análise de imagem injetada, para que nenhum log receba o segredo em claro.

**Tech Stack:** Node.js (CommonJS), Supabase JS (service_role), PostgreSQL, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-03-crud-credenciais-whatsapp-design.md`

## Global Constraints

- Projeto em **FEATURE FREEZE** — feature aprovada explicitamente pelo Hugo; nada além do escopo.
- **NUNCA** reativar `--tools` ou MCP em `src/ai/claude.js`.
- Código backend é **CommonJS** (`require`/`module.exports`), nunca ESM.
- Timezone **BRT (UTC-3)**.
- **Nenhuma escrita sem confirmação explícita.** Vale para `create`, `update` e `delete`, sem exceção.
- **O engine decide, o modelo só propõe.** Alvo de `update`/`delete` é resolvido pelo engine; havendo ambiguidade, ele pergunta em vez de escolher.
- **Fail-closed:** qualquer erro, dúvida ou ausência de dado resulta em não gravar. Nunca em gravar por padrão.
- **Cifragem em repouso está fora de escopo** (fatia 0 descartada). Valores seguem em texto plano no banco.
- **Nada disso funciona em grupo** — o fluxo de grupo usa `buildGroupChatPrompt`, prompt separado, e não recebe a instrução.
- Toda função nova degrada sem lançar: falha na escrita nunca impede a mensagem de ser respondida.
- Validar com `node --check <arquivo>` antes de concluir qualquer task.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/redigir-segredo.js` (criar) | Redação determinística de valores sensíveis em texto livre. Puro, sem I/O. |
| `src/lib/redigir-segredo.test.js` (criar) | Testes do redator |
| `src/lib/credencial-action.js` (criar) | Parser e validador do marker `<<CREDENCIAL_ACTION>>`. Puro. |
| `src/lib/credencial-action.test.js` (criar) | Testes do parser |
| `src/lib/credencial-duplicata.js` (criar) | Casamento determinístico contra credenciais existentes. Puro. |
| `src/lib/credencial-duplicata.test.js` (criar) | Testes do anti-duplicata |
| `supabase/migrations/20260903b_credenciais_escrita.sql` (criar) | RPCs `upsert_credencial` e `delete_credencial` + kind novo no CHECK |
| `src/services/credenciais.js` (modificar) | Ganha `upsertCredencial` e `deleteCredencial` |
| `src/services/pending-intents.js` (modificar, linha do `VALID_KINDS`) | Registrar o kind `credencial_write` |
| `src/engine.js` (modificar, 2 pontos) | Redação na entrada; bloco do `<<CREDENCIAL_ACTION>>` |
| `src/prompts/system.js` (modificar) | Instrução do marker de escrita |

**Ordem obrigatória:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

---

### Task 1: Redator de segredos

O redator existe para que nenhum log receba o valor em claro. Roda na entrada, sobre o texto que já inclui a análise de imagem.

**Files:**
- Create: `src/lib/redigir-segredo.js`
- Test: `src/lib/redigir-segredo.test.js`

**Interfaces:**
- Consumes: nada (puro)
- Produces:
  - `redigirSegredos(texto: string): { texto: string, achou: boolean }`
  - `MASCARA: string` (= `'***'`)

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/redigir-segredo.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { redigirSegredos, MASCARA } = require('./redigir-segredo');

test('redige valor apos rotulo de senha', () => {
  const r = redigirSegredos('conta do ADS\nsenha: 250178Alf#');
  assert.equal(r.achou, true);
  assert.match(r.texto, /senha: \*\*\*/);
  assert.doesNotMatch(r.texto, /250178Alf#/);
});

test('redige variantes de rotulo', () => {
  for (const rot of ['senha', 'Senha', 'SENHA', 'password', 'pwd', 'token', 'api key', 'api_key', 'chave', 'secret']) {
    const r = redigirSegredos(`${rot}: valorSuperSecreto123`);
    assert.equal(r.achou, true, `rotulo ${rot} deveria disparar`);
    assert.doesNotMatch(r.texto, /valorSuperSecreto123/, `rotulo ${rot} deveria mascarar`);
  }
});

test('aceita separadores = e espaco alem de dois-pontos', () => {
  assert.doesNotMatch(redigirSegredos('senha = abc123XYZ').texto, /abc123XYZ/);
  assert.doesNotMatch(redigirSegredos('senha abc123XYZ').texto, /abc123XYZ/);
});

test('preserva o rotulo e o resto da linha seguinte', () => {
  const r = redigirSegredos('email: a@b.com\nsenha: segredo123\nservico: Google');
  assert.match(r.texto, /email: a@b\.com/);
  assert.match(r.texto, /servico: Google/);
  assert.doesNotMatch(r.texto, /segredo123/);
});

test('nao mexe em texto sem rotulo de segredo', () => {
  const t = 'me manda o link da anamnese por favor';
  const r = redigirSegredos(t);
  assert.equal(r.achou, false);
  assert.equal(r.texto, t);
});

test('nao redige a palavra senha usada em pergunta', () => {
  const t = 'qual a senha do chatwoot?';
  const r = redigirSegredos(t);
  assert.equal(r.achou, false, 'pergunta nao tem valor a redigir');
  assert.equal(r.texto, t);
});

test('redige texto vindo de analise de imagem', () => {
  const t = '[Imagem analisada]\nA imagem mostra uma tela de login.\nUsuario: admin\nSenha: Tr0ub4dor&3';
  const r = redigirSegredos(t);
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /Tr0ub4dor&3/);
  assert.match(r.texto, /A imagem mostra uma tela de login/);
});

test('entrada nula ou vazia nao quebra', () => {
  assert.deepEqual(redigirSegredos(null), { texto: '', achou: false });
  assert.deepEqual(redigirSegredos(''), { texto: '', achou: false });
});

test('MASCARA e ***', () => {
  assert.equal(MASCARA, '***');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/lib/redigir-segredo.test.js`
Expected: FAIL — `Cannot find module './redigir-segredo'`

- [ ] **Step 3: Implementar**

Criar `src/lib/redigir-segredo.js`:

```js
// Redacao deterministica de valores sensiveis em texto livre.
//
// POR QUE NA ENTRADA, e nao no ponto de gravacao: engine.js grava os 200
// primeiros chars da mensagem em marker_logs.reason quando o TOM deixa de
// emitir marker para uma mensagem acionavel; o check actionable_no_marker le
// esse campo e o relatorio das 7h o transmite por WhatsApp. Redigir so no
// conversation_history deixaria esse caminho aberto.
//
// DETERMINISTICO de proposito: nao depende de o modelo reconhecer que a
// mensagem tem credencial. O reconhecimento do modelo falha exatamente no
// cenario em que o vazamento acontece.

const MASCARA = '***';

// Rotulos que indicam segredo. Ancorado no inicio da linha ou apos separador,
// para nao casar no meio de palavra.
const ROTULOS = 'senha|password|pwd|passwd|token|api[ _-]?key|chave|secret|segredo';

// <rotulo> <sep> <valor>  — valor e o resto da linha, e precisa existir.
const RE_ROTULO_VALOR = new RegExp(
  `(^|[\\n\\r]|[\\s(\\[])((?:${ROTULOS}))\\s*(:|=|\\s)[ \\t]*([^\\n\\r]+)`,
  'gi'
);

function redigirSegredos(texto) {
  if (!texto || typeof texto !== 'string') return { texto: '', achou: false };
  let achou = false;
  const out = texto.replace(RE_ROTULO_VALOR, (m, pre, rotulo, sep, valor) => {
    const v = String(valor).trim();
    // Pergunta ("qual a senha do chatwoot?") nao tem valor a redigir.
    if (!v || /^[?!.]/.test(v) || /\?$/.test(v)) return m;
    achou = true;
    const sepOut = sep === ' ' ? ' ' : `${sep} `;
    return `${pre}${rotulo}${sepOut}${MASCARA}`;
  });
  return { texto: out, achou };
}

module.exports = { redigirSegredos, MASCARA };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/lib/redigir-segredo.test.js`
Expected: PASS — 9 testes.

- [ ] **Step 5: Validar sintaxe e commitar**

```bash
node --check src/lib/redigir-segredo.js
git add src/lib/redigir-segredo.js src/lib/redigir-segredo.test.js
git commit -m "feat(credenciais): redator deterministico de segredos em texto livre"
```

---

### Task 2: Parser do marker `<<CREDENCIAL_ACTION>>`

**Files:**
- Create: `src/lib/credencial-action.js`
- Test: `src/lib/credencial-action.test.js`

**Interfaces:**
- Consumes: nada (puro)
- Produces:
  - `parseCredencialAction(text: string): {action, nome, servico, projeto, url_ref, observacoes, campos, alvo} | null`
  - `stripCredencialAction(text: string): string`
  - `ACOES_VALIDAS: Set<string>` (= `create`, `update`, `delete`)

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/credencial-action.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { parseCredencialAction, stripCredencialAction, ACOES_VALIDAS } = require('./credencial-action');

const MK = (json) => `<<CREDENCIAL_ACTION>>\n${JSON.stringify(json)}\n<<END>>`;

test('parseia create com campos', () => {
  const p = parseCredencialAction(MK({
    action: 'create', nome: 'Google Ads', servico: 'Google',
    campos: [{ label: 'E-mail', valor: 'a@b.com', sensivel: false },
             { label: 'Senha', valor: 's3cr3t', sensivel: true }],
  }));
  assert.equal(p.action, 'create');
  assert.equal(p.nome, 'Google Ads');
  assert.equal(p.campos.length, 2);
  assert.equal(p.campos[1].sensivel, true);
});

test('parseia update com alvo', () => {
  const p = parseCredencialAction(MK({ action: 'update', alvo: 'Google Ads', campos: [{ label: 'Senha', valor: 'nova', sensivel: true }] }));
  assert.equal(p.action, 'update');
  assert.equal(p.alvo, 'Google Ads');
});

test('parseia delete', () => {
  const p = parseCredencialAction(MK({ action: 'delete', alvo: 'Credencial Velha' }));
  assert.equal(p.action, 'delete');
  assert.equal(p.alvo, 'Credencial Velha');
});

test('rejeita acao invalida', () => {
  assert.equal(parseCredencialAction(MK({ action: 'drop_table', nome: 'x' })), null);
});

test('rejeita create sem nome', () => {
  assert.equal(parseCredencialAction(MK({ action: 'create', servico: 'Google' })), null);
});

test('rejeita update e delete sem alvo', () => {
  assert.equal(parseCredencialAction(MK({ action: 'update', campos: [] })), null);
  assert.equal(parseCredencialAction(MK({ action: 'delete' })), null);
});

test('rejeita JSON malformado sem lancar', () => {
  assert.equal(parseCredencialAction('<<CREDENCIAL_ACTION>>{nao é json}<<END>>'), null);
});

test('rejeita texto sem marker', () => {
  assert.equal(parseCredencialAction('cadastra a senha do google'), null);
  assert.equal(parseCredencialAction(null), null);
});

test('normaliza campos: descarta item sem label e sensivel vira boolean', () => {
  const p = parseCredencialAction(MK({
    action: 'create', nome: 'X',
    campos: [{ label: '', valor: 'v' }, { label: 'Ok', valor: 'v2' }, { label: 'S', valor: 'v3', sensivel: 'sim' }],
  }));
  assert.equal(p.campos.length, 2);
  assert.equal(p.campos[0].label, 'Ok');
  assert.equal(p.campos[0].sensivel, false, 'ausente vira false');
  assert.equal(p.campos[1].sensivel, true, 'string truthy vira true');
});

test('campos ausente vira lista vazia', () => {
  const p = parseCredencialAction(MK({ action: 'create', nome: 'X' }));
  assert.deepEqual(p.campos, []);
});

test('stripCredencialAction remove o marker do texto', () => {
  const t = `ok, vou cadastrar\n${MK({ action: 'create', nome: 'X' })}\nfim`;
  const out = stripCredencialAction(t);
  assert.doesNotMatch(out, /CREDENCIAL_ACTION/);
  assert.match(out, /ok, vou cadastrar/);
  assert.equal(stripCredencialAction(null), '');
});

test('ACOES_VALIDAS tem exatamente create, update, delete', () => {
  assert.deepEqual([...ACOES_VALIDAS].sort(), ['create', 'delete', 'update']);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/lib/credencial-action.test.js`
Expected: FAIL — `Cannot find module './credencial-action'`

- [ ] **Step 3: Implementar**

Criar `src/lib/credencial-action.js`:

```js
// Parser do marker <<CREDENCIAL_ACTION>>. Modulo PURO.
//
// O modelo PROPOE; quem decide e persiste e o engine. Este parser so valida
// forma — nunca decide se a escrita acontece. Payload invalido vira null, e o
// engine trata como "nao entendi" em vez de gravar lixo.

const ACOES_VALIDAS = new Set(['create', 'update', 'delete']);

const RE_MARKER = /<<CREDENCIAL_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
const RE_MARKER_G = /<<CREDENCIAL_ACTION>>\s*[\s\S]*?\s*<<END>>/gi;

function _normalizaCampos(campos) {
  if (!Array.isArray(campos)) return [];
  return campos
    .filter(c => c && typeof c.label === 'string' && c.label.trim())
    .map(c => ({
      label: String(c.label).trim(),
      valor: c.valor === undefined || c.valor === null ? '' : String(c.valor),
      sensivel: Boolean(c.sensivel),
    }));
}

function parseCredencialAction(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(RE_MARKER);
  if (!m) return null;
  let json;
  try {
    json = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;

  const action = String(json.action || '').toLowerCase();
  if (!ACOES_VALIDAS.has(action)) return null;

  const nome = json.nome ? String(json.nome).trim() : '';
  const alvo = json.alvo ? String(json.alvo).trim() : '';

  if (action === 'create' && !nome) return null;
  if ((action === 'update' || action === 'delete') && !alvo) return null;

  return {
    action,
    nome,
    alvo,
    servico: json.servico ? String(json.servico).trim() : null,
    projeto: json.projeto ? String(json.projeto).trim() : null,
    url_ref: json.url_ref ? String(json.url_ref).trim() : null,
    observacoes: json.observacoes ? String(json.observacoes) : null,
    campos: _normalizaCampos(json.campos),
  };
}

function stripCredencialAction(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(RE_MARKER_G, '').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { parseCredencialAction, stripCredencialAction, ACOES_VALIDAS };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/lib/credencial-action.test.js`
Expected: PASS — 12 testes.

- [ ] **Step 5: Validar sintaxe e commitar**

```bash
node --check src/lib/credencial-action.js
git add src/lib/credencial-action.js src/lib/credencial-action.test.js
git commit -m "feat(credenciais): parser do marker CREDENCIAL_ACTION"
```

---

### Task 3: Anti-duplicata determinística

**Files:**
- Create: `src/lib/credencial-duplicata.js`
- Test: `src/lib/credencial-duplicata.test.js`

**Interfaces:**
- Consumes: nada (puro)
- Produces:
  - `acharDuplicatas(proposta, existentes): Array<{cred, motivo, forca}>` — `forca` é `'alta'|'media'|'baixa'`, ordenado da mais forte para a mais fraca
  - `acharAlvo(termo, existentes): {exato: object|null, candidatos: Array<object>}`

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/credencial-duplicata.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { acharDuplicatas, acharAlvo } = require('./credencial-duplicata');

const EXISTENTES = [
  { id: '1', nome: 'Gmail — Escola de Música LA (YouTube/Google Ads)', servico: 'Gmail', projeto: 'Marketing',
    campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }, { label: 'Senha', valor: 'x' }] },
  { id: '2', nome: 'Gmail — LA Music Barra', servico: 'Gmail', projeto: 'Marketing',
    campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
  { id: '3', nome: 'Cloudflare — DNS/CDN', servico: 'Cloudflare', projeto: 'Landing Pages', campos: [] },
];

test('valor de campo igual e sinal de forca alta', () => {
  const d = acharDuplicatas({ nome: 'Conta nova', campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }] }, EXISTENTES);
  assert.equal(d.length, 1);
  assert.equal(d[0].cred.id, '1');
  assert.equal(d[0].forca, 'alta');
});

test('comparacao de valor ignora caixa e espacos', () => {
  const d = acharDuplicatas({ nome: 'X', campos: [{ label: 'E-mail', valor: '  ESCOLA@Gmail.com ' }] }, EXISTENTES);
  assert.equal(d[0].cred.id, '1');
});

test('mesmo servico e projeto e forca media', () => {
  const d = acharDuplicatas({ nome: 'Outra conta', servico: 'Gmail', projeto: 'Marketing', campos: [] }, EXISTENTES);
  assert.equal(d.length, 2);
  assert.equal(d[0].forca, 'media');
});

test('nome parecido e forca baixa', () => {
  const d = acharDuplicatas({ nome: 'cloudflare', campos: [] }, EXISTENTES);
  assert.equal(d.length, 1);
  assert.equal(d[0].cred.id, '3');
  assert.equal(d[0].forca, 'baixa');
});

test('resultado vem ordenado da forca maior para a menor', () => {
  const d = acharDuplicatas(
    { nome: 'Gmail', servico: 'Gmail', projeto: 'Marketing', campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
    EXISTENTES);
  assert.equal(d[0].forca, 'alta');
  assert.equal(d[0].cred.id, '2');
});

test('cada credencial aparece uma vez so, com o sinal mais forte', () => {
  const d = acharDuplicatas(
    { nome: 'Gmail — LA Music Barra', servico: 'Gmail', projeto: 'Marketing', campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
    EXISTENTES);
  const ids = d.map(x => x.cred.id);
  assert.equal(new Set(ids).size, ids.length, 'sem repeticao');
  assert.equal(d.find(x => x.cred.id === '2').forca, 'alta');
});

test('proposta sem sinal nenhum devolve lista vazia', () => {
  assert.deepEqual(acharDuplicatas({ nome: 'Sistema Totalmente Novo', campos: [] }, EXISTENTES), []);
});

test('entrada invalida nao quebra', () => {
  assert.deepEqual(acharDuplicatas(null, EXISTENTES), []);
  assert.deepEqual(acharDuplicatas({ nome: 'X' }, null), []);
});

test('acharAlvo: nome exato ignorando caixa', () => {
  const r = acharAlvo('cloudflare — dns/cdn', EXISTENTES);
  assert.equal(r.exato.id, '3');
});

test('acharAlvo: termo parcial devolve candidatos sem exato', () => {
  const r = acharAlvo('gmail', EXISTENTES);
  assert.equal(r.exato, null);
  assert.equal(r.candidatos.length, 2);
});

test('acharAlvo: termo sem correspondencia devolve vazio', () => {
  const r = acharAlvo('inexistente', EXISTENTES);
  assert.equal(r.exato, null);
  assert.deepEqual(r.candidatos, []);
});

test('acharAlvo: entrada invalida nao quebra', () => {
  assert.deepEqual(acharAlvo(null, EXISTENTES), { exato: null, candidatos: [] });
  assert.deepEqual(acharAlvo('x', null), { exato: null, candidatos: [] });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/lib/credencial-duplicata.test.js`
Expected: FAIL — `Cannot find module './credencial-duplicata'`

- [ ] **Step 3: Implementar**

Criar `src/lib/credencial-duplicata.js`:

```js
// Casamento deterministico de credencial proposta contra as existentes.
// Modulo PURO — o engine faz a busca e passa a lista.
//
// Deterministico de proposito: o TASK_UPDATE erra 14% deixando o modelo
// escolher o alvo. Aqui a escolha e do codigo, e havendo duvida o engine
// pergunta em vez de chutar.

function _norm(s) {
  return String(s === undefined || s === null ? '' : s).trim().toLowerCase();
}

function _valoresDe(cred) {
  if (!cred || !Array.isArray(cred.campos)) return [];
  return cred.campos.map(c => _norm(c && c.valor)).filter(Boolean);
}

const ORDEM = { alta: 0, media: 1, baixa: 2 };

function acharDuplicatas(proposta, existentes) {
  if (!proposta || !Array.isArray(existentes)) return [];
  const achados = new Map(); // id -> {cred, motivo, forca}

  const registra = (cred, motivo, forca) => {
    const atual = achados.get(cred.id);
    if (!atual || ORDEM[forca] < ORDEM[atual.forca]) achados.set(cred.id, { cred, motivo, forca });
  };

  const valoresProp = _valoresDe(proposta);
  const nomeProp = _norm(proposta.nome);
  const servProp = _norm(proposta.servico);
  const projProp = _norm(proposta.projeto);

  for (const c of existentes) {
    if (!c || !c.id) continue;

    // ALTA: algum valor de campo identico (e-mail/login ja cadastrado)
    const valoresEx = _valoresDe(c);
    const iguais = valoresProp.filter(v => valoresEx.includes(v));
    if (iguais.length) {
      registra(c, `mesmo valor de campo: ${iguais[0]}`, 'alta');
      continue;
    }

    // MEDIA: mesmo servico E mesmo projeto
    if (servProp && projProp && _norm(c.servico) === servProp && _norm(c.projeto) === projProp) {
      registra(c, `mesmo serviço e projeto: ${c.servico} / ${c.projeto}`, 'media');
      continue;
    }

    // BAIXA: nome de um contido no do outro
    const nomeEx = _norm(c.nome);
    if (nomeProp && nomeEx && (nomeEx.includes(nomeProp) || nomeProp.includes(nomeEx))) {
      registra(c, `nome parecido: ${c.nome}`, 'baixa');
    }
  }

  return [...achados.values()].sort((a, b) => ORDEM[a.forca] - ORDEM[b.forca]);
}

function acharAlvo(termo, existentes) {
  if (!termo || !Array.isArray(existentes)) return { exato: null, candidatos: [] };
  const t = _norm(termo);
  if (!t) return { exato: null, candidatos: [] };

  const exato = existentes.find(c => c && _norm(c.nome) === t) || null;
  if (exato) return { exato, candidatos: [] };

  const candidatos = existentes.filter(c => c && _norm(c.nome).includes(t));
  return { exato: null, candidatos };
}

module.exports = { acharDuplicatas, acharAlvo };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/lib/credencial-duplicata.test.js`
Expected: PASS — 12 testes.

- [ ] **Step 5: Validar sintaxe e commitar**

```bash
node --check src/lib/credencial-duplicata.js
git add src/lib/credencial-duplicata.js src/lib/credencial-duplicata.test.js
git commit -m "feat(credenciais): anti-duplicata deterministica e resolucao de alvo"
```

---

### Task 4: Migration — RPCs de escrita e kind novo

**Files:**
- Create: `supabase/migrations/20260903b_credenciais_escrita.sql`

**Interfaces:**
- Consumes: coluna `collaborators.is_system_admin` (fatia 1)
- Produces: `upsert_credencial(...) returns uuid`; `delete_credencial(p_collaborator_id uuid, p_cred_id uuid) returns boolean`; kind `credencial_write` aceito em `pending_intents`

- [ ] **Step 1: Descobrir o nome exato da constraint de kind**

```sql
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'pending_intents'::regclass and contype = 'c';
```
Anotar o nome e a definição atual — o Step 2 recria essa constraint acrescentando um valor, e ela precisa manter **todos** os valores atuais.

- [ ] **Step 2: Escrever a migration**

Criar `supabase/migrations/20260903b_credenciais_escrita.sql`. Substituir `<NOME_DA_CONSTRAINT>` e a lista de kinds pelo que o Step 1 devolveu, **acrescentando** `credencial_write` sem remover nenhum:

```sql
-- Escrita de credenciais pelo TOM. O gate de acesso mora AQUI, alem do engine:
-- se algum dia alguem chamar estas funcoes de outro ponto do codigo esquecendo
-- de checar is_system_admin, elas negam sozinhas.

create or replace function upsert_credencial(
  p_collaborator_id uuid,
  p_cred_id uuid,            -- null = create; preenchido = update
  p_nome text,
  p_servico text,
  p_projeto text,
  p_url_ref text,
  p_observacoes text,
  p_campos jsonb
)
returns uuid
language plpgsql
as $$
declare v_admin boolean; v_id uuid;
begin
  select coalesce(c.is_system_admin, false) into v_admin
  from collaborators c where c.id = p_collaborator_id and c.is_active = true;
  if v_admin is null or v_admin = false then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_cred_id is null then
    insert into governance_credentials (nome, servico, projeto, url_ref, observacoes, campos, status, visivel_tom)
    values (p_nome, p_servico, p_projeto, p_url_ref, p_observacoes, coalesce(p_campos, '[]'::jsonb), 'ok', false)
    returning id into v_id;
  else
    update governance_credentials g set
      nome        = coalesce(p_nome, g.nome),
      servico     = coalesce(p_servico, g.servico),
      projeto     = coalesce(p_projeto, g.projeto),
      url_ref     = coalesce(p_url_ref, g.url_ref),
      observacoes = coalesce(p_observacoes, g.observacoes),
      campos      = coalesce(p_campos, g.campos),
      updated_at  = now()
    where g.id = p_cred_id
    returning g.id into v_id;
    if v_id is null then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end; $$;

create or replace function delete_credencial(p_collaborator_id uuid, p_cred_id uuid)
returns boolean
language plpgsql
as $$
declare v_admin boolean; v_ok boolean;
begin
  select coalesce(c.is_system_admin, false) into v_admin
  from collaborators c where c.id = p_collaborator_id and c.is_active = true;
  if v_admin is null or v_admin = false then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from governance_credentials where id = p_cred_id returning true into v_ok;
  return coalesce(v_ok, false);
end; $$;

-- A anon key esta no bundle publico do PWA.
revoke execute on function upsert_credencial(uuid,uuid,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function delete_credencial(uuid,uuid) from public, anon, authenticated;
grant execute on function upsert_credencial(uuid,uuid,text,text,text,text,text,jsonb) to service_role;
grant execute on function delete_credencial(uuid,uuid) to service_role;

-- Kind novo para a confirmacao de escrita. PORTA 1 DE 2 — a outra e o
-- VALID_KINDS de src/services/pending-intents.js (Task 5).
alter table pending_intents drop constraint <NOME_DA_CONSTRAINT>;
alter table pending_intents add constraint <NOME_DA_CONSTRAINT>
  check (kind = any (array[<LISTA_ATUAL_COMPLETA>, 'credencial_write']));
```

- [ ] **Step 3: Aplicar via MCP**

Aplicar via `apply_migration` (projeto `cesnbnrynvxvgdhfmaua`), nome `credenciais_escrita`.

- [ ] **Step 4: Verificar que não-admin é negado no `upsert`**

```sql
select upsert_credencial(
  (select id from collaborators where is_system_admin = false and is_active = true limit 1),
  null, 'TESTE NAO DEVE EXISTIR', null, null, null, null, '[]'::jsonb);
```
Esperado: **erro `forbidden`**. Se inserir, é falha crítica — **parar**.

- [ ] **Step 5: Verificar que não-admin é negado no `delete`**

```sql
select delete_credencial(
  (select id from collaborators where is_system_admin = false and is_active = true limit 1),
  (select id from governance_credentials limit 1));
```
Esperado: **erro `forbidden`**. Se retornar `true`, apagou credencial real — **parar imediatamente e reportar**.

- [ ] **Step 6: Verificar o ciclo completo com admin, e limpar**

```sql
select upsert_credencial(
  (select id from collaborators where email = 'hugogmilesi@gmail.com'),
  null, 'ZZ TESTE MIGRATION', 'Teste', 'Teste', null, 'registro de teste', '[]'::jsonb) as criado;

select count(*) as deve_ser_1 from governance_credentials where nome = 'ZZ TESTE MIGRATION';

select delete_credencial(
  (select id from collaborators where email = 'hugogmilesi@gmail.com'),
  (select id from governance_credentials where nome = 'ZZ TESTE MIGRATION')) as apagado;

select count(*) as deve_ser_0 from governance_credentials where nome = 'ZZ TESTE MIGRATION';
```
Esperado: `criado` com uuid, `deve_ser_1 = 1`, `apagado = true`, `deve_ser_0 = 0`.

⚠️ Esse é o único `delete` autorizado neste plano, e só sobre o registro de teste que a própria query criou. Nenhuma outra linha pode ser apagada.

- [ ] **Step 7: Verificar total intacto e revoke**

```sql
select count(*) as total_credenciais from governance_credentials;
select has_function_privilege('anon','upsert_credencial(uuid,uuid,text,text,text,text,text,jsonb)','EXECUTE') as anon_upsert,
       has_function_privilege('anon','delete_credencial(uuid,uuid)','EXECUTE') as anon_delete;
```
Esperado: `total_credenciais = 45`, `anon_upsert = false`, `anon_delete = false`.

- [ ] **Step 8: Commit**

```bash
git add -f supabase/migrations/20260903b_credenciais_escrita.sql
git commit -m "feat(credenciais): RPCs upsert_credencial e delete_credencial com gate no banco"
```

---

### Task 5: Serviço de escrita e registro do kind

**Files:**
- Modify: `src/services/credenciais.js`
- Modify: `src/services/pending-intents.js` (linha do `VALID_KINDS`)
- Test: `src/services/credenciais.test.js` (acrescentar)

**Interfaces:**
- Consumes: RPCs da Task 4
- Produces:
  - `upsertCredencial(collaboratorId, { id, nome, servico, projeto, url_ref, observacoes, campos }): Promise<{ok: boolean, id: string|null, erro: string|null}>`
  - `deleteCredencial(collaboratorId, credId): Promise<{ok: boolean, erro: string|null}>`

- [ ] **Step 1: Registrar o kind — as DUAS portas**

Em `src/services/pending-intents.js`, acrescentar `'credencial_write'` ao `Set` do `VALID_KINDS`, mantendo todos os valores atuais.

O comentário logo acima dessa linha explica por que isso importa: em 15/07 um kind entrou só no CHECK do banco e não nesta whitelist; `openIntent` lançou, o executor virou NOOP silencioso e o bug ficou pior que o que ele consertava. A Task 4 fez a porta do banco; esta é a outra.

Run: `grep -n "credencial_write" src/services/pending-intents.js`
Expected: uma linha, dentro do `VALID_KINDS`.

- [ ] **Step 2: Escrever os testes que falham**

Acrescentar ao fim de `src/services/credenciais.test.js` (o arquivo já injeta um client fake via `require.cache`; reaproveite o mesmo `rpcImpl`):

```js
const { upsertCredencial, deleteCredencial } = require('./credenciais');

test('upsertCredencial: sucesso devolve ok e id', async () => {
  rpcImpl = async () => ({ data: 'uuid-novo', error: null });
  const r = await upsertCredencial(ADMIN, { nome: 'X', campos: [] });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'uuid-novo');
  assert.equal(r.erro, null);
});

test('upsertCredencial: forbidden do banco vira erro, nao excecao', async () => {
  rpcImpl = async () => ({ data: null, error: { message: 'forbidden', code: '42501' } });
  const r = await upsertCredencial(COMUM, { nome: 'X', campos: [] });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'forbidden');
});

test('upsertCredencial: excecao nao lanca', async () => {
  rpcImpl = async () => { throw new Error('rede caiu'); };
  const r = await upsertCredencial(ADMIN, { nome: 'X', campos: [] });
  assert.equal(r.ok, false);
  assert.equal(r.id, null);
});

test('upsertCredencial: rejeicao non-Error nao lanca', async () => {
  rpcImpl = async () => { throw null; };
  const r = await upsertCredencial(ADMIN, { nome: 'X', campos: [] });
  assert.equal(r.ok, false);
});

test('upsertCredencial: id nulo do colaborador nem chama a RPC', async () => {
  rpcCalls = 0;
  const r = await upsertCredencial(null, { nome: 'X', campos: [] });
  assert.equal(rpcCalls, 0);
  assert.equal(r.ok, false);
});

test('deleteCredencial: sucesso', async () => {
  rpcImpl = async () => ({ data: true, error: null });
  const r = await deleteCredencial(ADMIN, 'cred-1');
  assert.equal(r.ok, true);
});

test('deleteCredencial: forbidden vira erro', async () => {
  rpcImpl = async () => ({ data: null, error: { message: 'forbidden' } });
  const r = await deleteCredencial(COMUM, 'cred-1');
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'forbidden');
});

test('deleteCredencial: sem credId nem chama a RPC', async () => {
  rpcCalls = 0;
  const r = await deleteCredencial(ADMIN, null);
  assert.equal(rpcCalls, 0);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node --test src/services/credenciais.test.js`
Expected: FAIL — `upsertCredencial is not a function`

- [ ] **Step 4: Implementar**

Acrescentar a `src/services/credenciais.js`, antes do `module.exports`:

```js
function _msgErro(e) {
  if (!e) return 'erro_desconhecido';
  if (typeof e === 'string') return e;
  return e.message ? String(e.message) : String(e);
}

// Escrita. O gate de is_system_admin esta NA RPC — estas funcoes nao decidem
// permissao, so transportam. Nunca lancam: erro vira {ok:false, erro}.
async function upsertCredencial(collaboratorId, dados) {
  if (!collaboratorId || !dados) return { ok: false, id: null, erro: 'parametros_invalidos' };
  try {
    const supabase = require('../supabase/client');
    const { data, error } = await supabase.rpc('upsert_credencial', {
      p_collaborator_id: collaboratorId,
      p_cred_id: dados.id || null,
      p_nome: dados.nome || null,
      p_servico: dados.servico || null,
      p_projeto: dados.projeto || null,
      p_url_ref: dados.url_ref || null,
      p_observacoes: dados.observacoes || null,
      p_campos: Array.isArray(dados.campos) ? dados.campos : [],
    });
    if (error) {
      console.warn('[Credenciais] upsert erro:', _msgErro(error));
      return { ok: false, id: null, erro: _msgErro(error) };
    }
    return { ok: true, id: data || null, erro: null };
  } catch (e) {
    console.warn('[Credenciais] upsert falhou:', _msgErro(e));
    return { ok: false, id: null, erro: _msgErro(e) };
  }
}

async function deleteCredencial(collaboratorId, credId) {
  if (!collaboratorId || !credId) return { ok: false, erro: 'parametros_invalidos' };
  try {
    const supabase = require('../supabase/client');
    const { data, error } = await supabase.rpc('delete_credencial', {
      p_collaborator_id: collaboratorId,
      p_cred_id: credId,
    });
    if (error) {
      console.warn('[Credenciais] delete erro:', _msgErro(error));
      return { ok: false, erro: _msgErro(error) };
    }
    return { ok: data === true, erro: data === true ? null : 'nao_encontrada' };
  } catch (e) {
    console.warn('[Credenciais] delete falhou:', _msgErro(e));
    return { ok: false, erro: _msgErro(e) };
  }
}
```

E acrescentar `upsertCredencial, deleteCredencial` ao `module.exports` existente, mantendo os exports atuais.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test src/services/credenciais.test.js`
Expected: PASS — 18 testes (10 existentes + 8 novos).

- [ ] **Step 6: Validar sintaxe e commitar**

```bash
node --check src/services/credenciais.js
node --check src/services/pending-intents.js
git add src/services/credenciais.js src/services/credenciais.test.js src/services/pending-intents.js
git commit -m "feat(credenciais): servico de escrita + kind credencial_write nas duas portas"
```

---

### Task 6: Redação na entrada

**Files:**
- Modify: `src/engine.js` (imediatamente antes de `await logConversation(collab.id, 'inbound', ...)`)

**Interfaces:**
- Consumes: `redigirSegredos` (Task 1)
- Produces: variável `textForLogs` usada nos pontos de log

**Por que aqui:** `logConversation` grava o texto integral em `conversation_history`, e mais adiante `engine.js` grava os 200 primeiros chars em `marker_logs.reason` quando o TOM deixa de emitir marker — campo que o relatório das 7h transmite por WhatsApp. Redigir num só desses pontos deixaria o outro aberto. O texto neste ponto **já inclui** a análise de imagem injetada pelo webhook, então cobre print de senha também.

- [ ] **Step 1: Localizar o ponto**

Run: `grep -n "await logConversation(collab.id, 'inbound'" src/engine.js`
Ler as 15 linhas anteriores para confirmar que `text` já está definido e que a análise de mídia já foi injetada.

- [ ] **Step 2: Inserir a redação**

Imediatamente **antes** da linha do `logConversation` inbound:

```js
  // REDACAO NA ENTRADA (03/09) — o texto que segue para QUALQUER log vai
  // mascarado. Nao basta redigir no conversation_history: engine grava os 200
  // primeiros chars em marker_logs.reason quando falta marker, e o relatorio
  // das 7h transmite esse trecho por WhatsApp. `text` aqui ja inclui a analise
  // de imagem injetada pelo webhook, entao print de senha tambem e coberto.
  // Deterministico de proposito: nao depende de o modelo reconhecer a credencial.
  const { redigirSegredos } = require('./lib/redigir-segredo');
  const _red = redigirSegredos(text);
  const textForLogs = _red.texto;
  if (_red.achou) console.log('[Redacao] valor sensivel mascarado no texto que vai para os logs');
```

E trocar a chamada seguinte para usar o texto redigido:

```js
  await logConversation(collab.id, 'inbound', textForLogs, _inboundWaId);
```

⚠️ **Trocar apenas o argumento do `logConversation`.** A variável `text` continua sendo usada pelo resto do pipeline (é ela que vai para o modelo, e o modelo precisa do valor real para propor o cadastro). Não substitua `text` globalmente.

- [ ] **Step 3: Redigir também o `reason` do marker ausente**

Run: `grep -n 'text:\${String(text)' src/engine.js`

Nessa linha, trocar `String(text)` por `String(textForLogs)`. Se `textForLogs` não estiver no escopo daquele ponto, chamar `redigirSegredos(text).texto` inline ali mesmo.

- [ ] **Step 4: Validar sintaxe**

Run: `node --check src/engine.js`

- [ ] **Step 5: Verificar que nenhum log recebe o texto cru**

Run: `grep -n "logConversation(collab.id, 'inbound'" src/engine.js` e `grep -n 'text:\${String' src/engine.js`
Expected: ambos usando a versão redigida.

- [ ] **Step 6: Rodar a suíte**

Run: `node --test src/lib/*.test.js src/services/*.test.js`
Expected: os testes da feature passam. Falhas pré-existentes por `SUPABASE_URL`/`UAZAPI_URL` ausentes no ambiente são esperadas — confirmar com `git stash` se aparecerem.

- [ ] **Step 7: Commit**

```bash
git add src/engine.js
git commit -m "feat(credenciais): redacao deterministica de segredo na entrada, antes de qualquer log"
```

---

### Task 7: Engine — executor determinístico com confirmação

**Files:**
- Modify: `src/engine.js` (logo após o bloco `// TWO-PASS <<PEDIR_CREDENCIAIS>>`)

**Interfaces:**
- Consumes: `parseCredencialAction`, `stripCredencialAction` (Task 2); `acharDuplicatas`, `acharAlvo` (Task 3); `getCredenciaisPara`, `upsertCredencial`, `deleteCredencial` (Tasks da fatia 1 e 5); `openIntent`, `resolveIntent`, `listOpenIntents` (`src/services/pending-intents.js`)
- Produces: nada para tasks seguintes

- [ ] **Step 1: Localizar o ponto de inserção**

Run: `grep -n "TWO-PASS <<PEDIR_CREDENCIAIS>>" src/engine.js`
O bloco novo entra **logo após o fechamento** desse bloco (`} catch (e) { ... }` dele), antes dos parsers de marker existentes.

- [ ] **Step 2: Inserir o executor**

```js
  // EXECUTOR DETERMINISTICO <<CREDENCIAL_ACTION>> (03/09)
  // O modelo PROPOE; aqui o engine decide. Nada e gravado sem confirmacao:
  // este bloco monta o resumo e abre uma pending_intent. A gravacao acontece
  // no ramo de confirmacao (Step 3), quando a pessoa responde.
  try {
    const { parseCredencialAction, stripCredencialAction } = require('./lib/credencial-action');
    const _acao = parseCredencialAction(reply);
    if (_acao) {
      _credenciaisNoTurno = true;   // isencao do anti-leak, mesma flag do two-pass
      reply = stripCredencialAction(reply);

      const { getCredenciaisPara } = require('./services/credenciais');
      const { isAdmin, creds } = await getCredenciaisPara(collab.id);

      if (!isAdmin) {
        // Negativa que nao revela a existencia da funcionalidade.
        await logMarker(collab.id, 'CREDENCIAL_ACTION', 'rejected', 'nao_admin', null);
        reply = 'Isso eu não consigo te ajudar por aqui — fala com o Luciano.';
      } else {
        const { acharDuplicatas, acharAlvo } = require('./lib/credencial-duplicata');
        const pi = require('./services/pending-intents');

        if (_acao.action === 'create') {
          const dups = acharDuplicatas(_acao, creds);
          if (dups.length) {
            const lista = dups.slice(0, 3).map((d, i) => `${i + 1}. *${d.cred.nome}* — ${d.motivo}`).join('\n');
            await logMarker(collab.id, 'CREDENCIAL_ACTION', 'skipped', `duplicata:${dups.length}`, null);
            reply = `Antes de criar: já existe algo parecido.\n\n${lista}\n\n`
              + `Quer atualizar uma dessas (responde o número) ou criar assim mesmo (responde *criar*)?`;
            await pi.openIntent(collab.id, 'credencial_write',
              { modo: 'duplicata', proposta: _acao, candidatos: dups.slice(0, 3).map(d => d.cred.id) }, reply);
          } else {
            const resumo = _resumoCredencial(_acao);
            await logMarker(collab.id, 'CREDENCIAL_ACTION', 'skipped', 'aguardando_confirmacao', null);
            reply = `Vou cadastrar assim:\n\n${resumo}\n\nConfirma?`;
            await pi.openIntent(collab.id, 'credencial_write', { modo: 'create', proposta: _acao }, reply);
          }
        } else {
          const { exato, candidatos } = acharAlvo(_acao.alvo, creds);
          if (!exato && !candidatos.length) {
            await logMarker(collab.id, 'CREDENCIAL_ACTION', 'rejected', 'alvo_nao_encontrado', null);
            reply = `Não achei nenhuma credencial com esse nome. Me diz o nome exato?`;
          } else if (!exato && candidatos.length > 1) {
            const lista = candidatos.slice(0, 5).map((c, i) => `${i + 1}. *${c.nome}*`).join('\n');
            await logMarker(collab.id, 'CREDENCIAL_ACTION', 'skipped', `alvo_ambiguo:${candidatos.length}`, null);
            reply = `Achei mais de uma. Qual delas?\n\n${lista}`;
            await pi.openIntent(collab.id, 'credencial_write',
              { modo: 'alvo_ambiguo', proposta: _acao, candidatos: candidatos.slice(0, 5).map(c => c.id) }, reply);
          } else {
            const alvo = exato || candidatos[0];
            const verbo = _acao.action === 'delete' ? 'APAGAR' : 'atualizar';
            const detalhe = _acao.action === 'delete' ? '' : `\n\n${_resumoCredencial(_acao)}`;
            await logMarker(collab.id, 'CREDENCIAL_ACTION', 'skipped', `aguardando_confirmacao:${_acao.action}`, null);
            reply = `Vou ${verbo} *${alvo.nome}*.${detalhe}\n\nConfirma?`;
            await pi.openIntent(collab.id, 'credencial_write',
              { modo: _acao.action, proposta: _acao, alvo_id: alvo.id, alvo_nome: alvo.nome }, reply);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[CredencialAction] falhou:', e instanceof Error ? e.message : String(e));
  }
```

- [ ] **Step 3: Inserir o ramo de confirmação**

Imediatamente **antes** do bloco do Step 2 (a confirmação tem de ser avaliada antes de uma nova proposta), inserir:

```js
  // Confirmacao de escrita de credencial pendente. Roda ANTES do executor:
  // a resposta curta ("confirma", "1", "criar") nao carrega marker nenhum.
  try {
    const pi = require('./services/pending-intents');
    // listOpenIntents NAO filtra por kind (opts so aceita limit/expiryHours) —
    // filtrar aqui. Sem isso, uma intent de task_creation mais recente seria
    // pega no lugar e a confirmacao de credencial nunca seria processada.
    const abertas = await pi.listOpenIntents(collab.id, { limit: 5 });
    const intent = (abertas || []).find(i => i && i.kind === 'credencial_write');
    if (intent) {
      const { detectUserConfirmation } = require('./services/user-confirmation');
      const conf = detectUserConfirmation(text);
      const escolha = String(text || '').trim().match(/^([1-5])$/);
      const querCriar = /^\s*criar\s*$/i.test(String(text || ''));
      const p = intent.payload || {};
      const { upsertCredencial, deleteCredencial } = require('./services/credenciais');

      const _gravar = async (credId) => {
        const d = p.proposta || {};
        return upsertCredencial(collab.id, {
          id: credId || null, nome: d.nome, servico: d.servico, projeto: d.projeto,
          url_ref: d.url_ref, observacoes: d.observacoes, campos: d.campos,
        });
      };

      let tratou = true;
      if (conf === 'denied') {
        await pi.resolveIntent(intent.id, 'denied');
        reply = 'Ok, não gravei nada.';
      } else if (p.modo === 'duplicata' && escolha) {
        const alvoId = (p.candidatos || [])[Number(escolha[1]) - 1];
        const r = alvoId ? await _gravar(alvoId) : { ok: false, erro: 'indice_invalido' };
        await pi.resolveIntent(intent.id, r.ok ? 'confirmed' : 'denied', r.erro || null);
        reply = r.ok ? '✅ Atualizei a credencial que já existia.' : '_Não consegui atualizar. Tenta de novo?_';
      } else if (p.modo === 'duplicata' && querCriar) {
        const r = await _gravar(null);
        await pi.resolveIntent(intent.id, r.ok ? 'confirmed' : 'denied', r.erro || null);
        reply = r.ok ? '✅ Criei a credencial nova.' : '_Não consegui criar. Tenta de novo?_';
      } else if (p.modo === 'alvo_ambiguo' && escolha) {
        const alvoId = (p.candidatos || [])[Number(escolha[1]) - 1];
        if (!alvoId) { reply = '_Número fora da lista. Responde de novo?_'; }
        else if (p.proposta && p.proposta.action === 'delete') {
          const r = await deleteCredencial(collab.id, alvoId);
          await pi.resolveIntent(intent.id, r.ok ? 'confirmed' : 'denied', r.erro || null);
          reply = r.ok ? '✅ Apaguei.' : '_Não consegui apagar. Tenta de novo?_';
        } else {
          const r = await _gravar(alvoId);
          await pi.resolveIntent(intent.id, r.ok ? 'confirmed' : 'denied', r.erro || null);
          reply = r.ok ? '✅ Atualizei.' : '_Não consegui atualizar. Tenta de novo?_';
        }
      } else if (conf === 'confirmed' && p.modo === 'create') {
        const r = await _gravar(null);
        await pi.resolveIntent(intent.id, r.ok ? 'confirmed' : 'denied', r.erro || null);
        reply = r.ok ? '✅ Cadastrei.' : '_Não consegui cadastrar. Tenta de novo?_';
      } else if (conf === 'confirmed' && p.modo === 'update') {
        const r = await _gravar(p.alvo_id);
        await pi.resolveIntent(intent.id, r.ok ? 'confirmed' : 'denied', r.erro || null);
        reply = r.ok ? `✅ Atualizei *${p.alvo_nome}*.` : '_Não consegui atualizar. Tenta de novo?_';
      } else if (conf === 'confirmed' && p.modo === 'delete') {
        const r = await deleteCredencial(collab.id, p.alvo_id);
        await pi.resolveIntent(intent.id, r.ok ? 'confirmed' : 'denied', r.erro || null);
        reply = r.ok ? `✅ Apaguei *${p.alvo_nome}*.` : '_Não consegui apagar. Tenta de novo?_';
      } else {
        tratou = false;   // nao era confirmacao: segue o fluxo normal
      }

      if (tratou) {
        _credenciaisNoTurno = true;
        await logMarker(collab.id, 'CREDENCIAL_ACTION', 'executed', `confirmacao:${p.modo}`, null);
      }
    }
  } catch (e) {
    console.warn('[CredencialConfirm] falhou:', e instanceof Error ? e.message : String(e));
  }
```

- [ ] **Step 4: Inserir o helper de resumo**

No mesmo arquivo, junto das outras funções auxiliares de `engine.js` (fora de `processMessage`, no nível do módulo):

```js
// Resumo de credencial para confirmacao. Valor sensivel SEMPRE mascarado —
// a mensagem de confirmacao nao precisa repetir a senha de volta.
function _resumoCredencial(a) {
  const l = [`*${a.nome || a.alvo}*`];
  if (a.servico) l.push(`Serviço: ${a.servico}`);
  if (a.projeto) l.push(`Projeto: ${a.projeto}`);
  if (a.url_ref) l.push(`Link: ${a.url_ref}`);
  for (const c of (a.campos || [])) {
    l.push(`${c.label}: ${c.sensivel ? '●●●●●●' : c.valor}`);
  }
  return l.join('\n');
}
```

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/engine.js`

- [ ] **Step 6: Verificar a ordem dos blocos**

Run: `grep -n "CredencialConfirm\|EXECUTOR DETERMINISTICO <<CREDENCIAL_ACTION>>\|TWO-PASS <<PEDIR_CREDENCIAIS>>" src/engine.js`
Expected, nesta ordem: `TWO-PASS`, depois `CredencialConfirm`, depois `EXECUTOR DETERMINISTICO`. Se a confirmação vier depois do executor, uma resposta "confirma" abriria uma intent nova em vez de resolver a pendente.

- [ ] **Step 7: Rodar a suíte**

Run: `node --test src/lib/*.test.js src/services/*.test.js`
Expected: testes da feature passam; falhas pré-existentes de ambiente confirmadas com `git stash` se aparecerem.

- [ ] **Step 8: Commit**

```bash
git add src/engine.js
git commit -m "feat(credenciais): executor deterministico com confirmacao e anti-duplicata"
```

---

### Task 8: Prompt, deploy e verificação

**Files:**
- Modify: `src/prompts/system.js` (seção `# 🔗 SISTEMAS E ACESSOS`)

**Interfaces:**
- Consumes: tudo das tasks anteriores
- Produces: feature no ar

- [ ] **Step 1: Acrescentar a instrução de escrita**

Logo após o `systemPrompt += ...` da seção `# 🔗 SISTEMAS E ACESSOS` (localizar com `grep -n "SISTEMAS E ACESSOS" src/prompts/system.js`), inserir:

```js
  systemPrompt += `\n\n---\n\n# 🔐 CADASTRAR E EDITAR CREDENCIAIS\n\nQuando a pessoa te passar uma credencial para guardar (conta, login, senha, chave de API), ou pedir para alterar ou apagar uma já existente — inclusive quando isso vier numa **imagem** (print de tela, foto de papel) — emita o marker abaixo com o que você conseguiu extrair, e **nada além dele**:\n\n<<CREDENCIAL_ACTION>>\n{"action":"create","nome":"Conta do Google Ads","servico":"Google","projeto":"Marketing","url_ref":"https://ads.google.com","observacoes":"","campos":[{"label":"E-mail","valor":"a@b.com","sensivel":false},{"label":"Senha","valor":"xxx","sensivel":true}]}\n<<END>>\n\nRegras do payload:\n- \`action\` é **create**, **update** ou **delete**. Nunca outra coisa.\n- Em **create**, \`nome\` é obrigatório — dê um nome descritivo (ex: "Conta do Google Ads", não "conta").\n- Em **update** e **delete**, use \`alvo\` com o nome da credencial existente, no lugar de \`nome\`.\n- Marque \`sensivel: true\` em senha, token, chave e qualquer segredo. E-mail, login, URL e telefone são \`sensivel: false\`.\n- Se a pessoa não descreveu para que serve, escreva uma linha curta em \`observacoes\` com o que dá para inferir com segurança (serviço e finalidade). **Não invente** para que serve, quem usa ou criticidade.\n\nVocê **não grava nada** — quem grava é o sistema, e só depois de confirmar com a pessoa. Não prometa que já cadastrou; o sistema responde por você em seguida.\n\nSe quem pediu não tiver permissão, o sistema recusa sozinho — não avise, não explique, não diga que é restrito.`;
```

- [ ] **Step 2: Validar sintaxe e conferir integridade**

```bash
node --check src/prompts/system.js
grep -c "CREDENCIAL_ACTION" src/prompts/system.js
```
Expected: `node --check` limpo, `grep -c` = 1. Ler o trecho e conferir acentos e emoji.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/system.js
git commit -m "feat(credenciais): instrucao do marker CREDENCIAL_ACTION, com imagem no escopo"
```

- [ ] **Step 4: Deploy**

```bash
scp src/engine.js src/prompts/system.js src/services/credenciais.js src/services/pending-intents.js root@89.116.73.186:/tmp/
scp src/lib/redigir-segredo.js src/lib/credencial-action.js src/lib/credencial-duplicata.js root@89.116.73.186:/tmp/
ssh root@89.116.73.186 "cd /opt/LA-Organizer && cp /tmp/engine.js src/engine.js && cp /tmp/system.js src/prompts/system.js && cp /tmp/credenciais.js src/services/ && cp /tmp/pending-intents.js src/services/ && cp /tmp/redigir-segredo.js src/lib/ && cp /tmp/credencial-action.js src/lib/ && cp /tmp/credencial-duplicata.js src/lib/ && node --check src/engine.js && node --check src/prompts/system.js && node --check src/services/credenciais.js && node --check src/services/pending-intents.js && node --check src/lib/redigir-segredo.js && node --check src/lib/credencial-action.js && node --check src/lib/credencial-duplicata.js && echo SYNTAX_OK && pm2 restart tom"
```

Nota: o alias SSH `tom` não funciona neste ambiente (`~/.ssh/config` vazio) — usar o IP direto.

- [ ] **Step 5: Confirmar que subiu**

```bash
ssh root@89.116.73.186 "pm2 list | grep tom"
ssh root@89.116.73.186 "pm2 logs tom --lines 40 --nostream | grep -icE 'cannot find module'"
```
Expected: `online`, e `0` no grep.

- [ ] **Step 6: Teste E2E — cadastro simples**

Pedir ao usuário que mande: **"cadastra a conta do Canva: login teste@lamusic.com.br, senha TesteAqui123"**

Esperado: o TOM responde com o resumo e a senha **mascarada** (`●●●●●●`), perguntando "Confirma?". Nada gravado ainda.

Verificar que a senha não vazou para os logs:
```sql
select content from conversation_history
where collaborator_id = (select id from collaborators where email = 'hugogmilesi@gmail.com')
order by created_at desc limit 3;
```
Expected: a mensagem inbound aparece com `senha: ***`, **nunca** com `TesteAqui123`.

- [ ] **Step 7: Teste E2E — confirmação grava**

Pedir ao usuário que responda: **"confirma"**

Esperado: "✅ Cadastrei." Verificar:
```sql
select nome, servico, campos from governance_credentials where nome ilike '%canva%' order by created_at desc limit 2;
```
Expected: a credencial nova, com a senha **real** em `campos` (o banco recebe o valor verdadeiro; só os logs são redigidos).

- [ ] **Step 8: Teste E2E — anti-duplicata**

Pedir ao usuário que mande: **"cadastra a conta do Google Ads: la.tecnology.system@gmail.com"**

Esperado: o TOM aponta que já existem credenciais falando de Google Ads e oferece atualizar em vez de criar.

- [ ] **Step 9: Teste E2E — não-admin é recusado**

Pedir ao usuário que peça a alguém do time que **não** é admin: **"cadastra a senha do meu email: teste123"**

Esperado: recusa genérica, sem revelar que existe funcionalidade de credenciais. Verificar:
```sql
select c.full_name, c.is_system_admin, m.result, m.reason
from marker_logs m join collaborators c on c.id = m.collaborator_id
where m.marker_type = 'CREDENCIAL_ACTION' order by m.created_at desc limit 10;
```
Expected: linha com `is_system_admin = false`, `result = 'rejected'`, `reason = 'nao_admin'`. **Nenhuma** credencial criada por ela.

- [ ] **Step 10: Limpar o registro de teste**

Depois que o usuário confirmar que os testes passaram, apagar a credencial "Canva" criada no Step 7 — **pedindo o OK dele antes**, já que é dado em produção.

- [ ] **Step 11: Commit, push e daily-notes**

```bash
git add -A
git commit -m "feat(credenciais): deploy da escrita por WhatsApp"
git push origin main
```

Acrescentar seção em `daily-notes/2026-09-03.md` (não sobrescrever) com o que foi implementado, os resultados dos Steps 6-9, e a pendência abaixo.

**👁️ OBSERVAR:** confirmar que nenhuma escrita acontece sem confirmação, e que segredo nenhum chega aos logs.
- **Query 1:** `select result, reason, count(*) from marker_logs where marker_type = 'CREDENCIAL_ACTION' group by 1,2 order by 3 desc;` — toda escrita deve ter passado por `skipped` (aguardando confirmação) antes de `executed`.
- **Query 2:** `select count(*) from conversation_history where content ~* '(senha|password|token)\s*[:=]\s*\S{6,}' and content !~ '\*\*\*' and created_at > '2026-09-03';` — deve ser **0**. Qualquer valor acima indica segredo em claro no histórico.
- **Concluir após:** ao menos 5 cadastros reais.

---

## Self-Review

**Cobertura do spec (fatia 3):**

| Requisito do spec | Task |
|---|---|
| Marker `<<CREDENCIAL_ACTION>>` com `create`/`update`/`delete` | 2, 8 |
| Modelo só propõe; engine decide e persiste | 7 |
| Anti-duplicata determinística (valor de campo > serviço+projeto > nome) | 3, 7 |
| Oferecer editar em vez de criar quando há candidato | 7 (ramo `duplicata`) |
| Resumo com valor sensível mascarado | 7 (`_resumoCredencial`) |
| Nenhuma escrita sem confirmação explícita | 7 (Steps 2 e 3) |
| Alvo resolvido pelo engine; ambiguidade pergunta | 3 (`acharAlvo`), 7 |
| `delete` sempre com confirmação | 7 |
| Gate `is_system_admin` na RPC, além do engine | 4 |
| Negativa a não-admin não revela a funcionalidade | 7, 8 |
| Descrição gerada quando não informada, sem inventar | 8 (instrução) |
| Redação na entrada, cobrindo texto de imagem | 1, 6 |
| `marker_logs` sem o texto cru | 6, 7 (`logMarker` com `raw = null` em todas as chamadas) |
| Cadastro por imagem | 8 (instrução), coberto por 1 e 6 |
| Nada em grupo | herdado: `buildGroupChatPrompt` é separado e não recebe a instrução |

**Consistência de tipos:** `parseCredencialAction` devolve `{action, nome, alvo, servico, projeto, url_ref, observacoes, campos}`, consumido com esses nomes na Task 7 e repassado a `upsertCredencial({id, nome, servico, projeto, url_ref, observacoes, campos})` na Task 5. `acharDuplicatas` devolve `{cred, motivo, forca}` e `acharAlvo` devolve `{exato, candidatos}` — ambos usados com essas chaves na Task 7. `upsertCredencial` devolve `{ok, id, erro}` e `deleteCredencial` devolve `{ok, erro}`, lidos como `r.ok`/`r.erro` na Task 7.

**Bug encontrado no self-review e corrigido inline:** a Task 7 Step 3 chamava `listOpenIntents(collab.id, { kind: 'credencial_write' })`, mas essa função **não filtra por kind** — seu `opts` só aceita `limit` e `expiryHours` (verificado em `src/services/pending-intents.js`). O código pegaria a intent aberta mais recente de qualquer tipo; se houvesse uma `task_creation` mais nova, a confirmação de credencial nunca seria processada e a feature falharia em silêncio. Corrigido para filtrar por `kind` no JS.

**Dependência externa registrada:** a Task 7 usa `detectUserConfirmation` de `src/services/user-confirmation.js` (verificado: exporta essa função) e `openIntent`/`resolveIntent`/`listOpenIntents` de `src/services/pending-intents.js` — módulos que já existem no projeto e não são criados por este plano. A Task 5 Step 1 registra o kind novo na whitelist do segundo; a Task 4 Step 2 faz a porta correspondente no CHECK do banco. **As duas portas são obrigatórias** — o comentário em `pending-intents.js:19-24` documenta um incidente de 15/07 em que só uma foi feita e o executor virou NOOP silencioso.

**Risco residual conhecido, herdado da fatia 1+2:** a linha que decide o escopo de leitura no engine não tem teste automatizado, e os blocos novos desta fatia também vivem dentro de `processMessage`, sem suíte própria. A garantia primária continua sendo as RPCs, que negam por conta própria — e a Task 4 Steps 4 e 5 verificam isso diretamente contra o banco.
