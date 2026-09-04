# Credenciais por WhatsApp — leitura com escopo por perfil (fatias 1+2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hugo, Luciano e Anne passam a consultar qualquer credencial pelo WhatsApp — com senha, campos e observações — enquanto os demais colaboradores continuam recebendo apenas nome e link das credenciais públicas.

**Architecture:** Uma coluna `is_system_admin` marca os três. A RPC `get_credenciais_para(p_collaborator_id)` aplica o escopo **dentro do banco** e substitui a `get_credenciais_publicas()`. O marker `<<PEDIR_CREDENCIAIS>>` (já existente) continua sem payload: o engine passa o id do remetente e o próprio banco decide o que devolver. O modelo nunca escolhe escopo.

**Tech Stack:** Node.js (CommonJS), Supabase JS (service_role), PostgreSQL, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-03-crud-credenciais-whatsapp-design.md`

## Global Constraints

- Projeto em **FEATURE FREEZE** — feature aprovada explicitamente pelo Hugo; nada além do escopo.
- **NUNCA** reativar `--tools` ou MCP em `src/ai/claude.js`.
- Código backend é **CommonJS** (`require`/`module.exports`), nunca ESM.
- Timezone **BRT (UTC-3)**.
- **Cifragem está fora de escopo** (fatia 0 descartada). Valores seguem em texto plano no banco.
- **Nunca cachear conteúdo de escopo admin**: senha não fica em memória do processo. Só o escopo público é cacheado.
- Toda função nova degrada sem lançar: falha ao buscar credencial nunca impede a mensagem do colaborador de ser respondida.
- Validar com `node --check <arquivo>` antes de concluir qualquer task.
- **A escrita (`create`/`update`/`delete`) NÃO faz parte deste plano.** É a fatia 3, com plano próprio.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260903_credenciais_escopo_perfil.sql` (criar) | Coluna `is_system_admin`, marcação dos 3, RPC `get_credenciais_para`, drop da antiga |
| `src/lib/credenciais-format.js` (criar) | Formatação pura: markdown→WhatsApp, bloco público, bloco admin. Sem I/O. |
| `src/lib/credenciais-format.test.js` (criar) | Testes do formatador |
| `src/services/credenciais.js` (criar) | Busca via RPC com escopo. Cache só do público. Substitui `credenciais-publicas.js`. |
| `src/services/credenciais.test.js` (criar) | Testes de escopo, cache e degradação |
| `src/services/credenciais-publicas.js` (remover) | Aposentado junto com a RPC antiga |
| `src/lib/pedir-credenciais.js` (modificar) | Mantém só a detecção do marker; formatação sai para o módulo novo |
| `src/engine.js` (modificar, ~linha 10650) | Passa `collab.id` para o serviço; usa o formatador novo |
| `src/prompts/system.js` (modificar) | Ajusta a instrução: negativa que não revela a existência |

**Ordem obrigatória:** 1 → 2 → 3 → 4 → 5 → 6.

---

### Task 1: Migration — coluna, marcação e RPC com escopo

**Files:**
- Create: `supabase/migrations/20260903_credenciais_escopo_perfil.sql`

**Interfaces:**
- Consumes: RPC `get_credenciais_publicas()` (será removida)
- Produces: coluna `collaborators.is_system_admin`; RPC `get_credenciais_para(p_collaborator_id uuid)` retornando `table (id uuid, nome text, url_ref text, servico text, projeto text, responsavel text, categoria text, status text, observacoes text, campos jsonb, is_admin boolean)`

- [ ] **Step 1: Escrever a migration**

```sql
-- Quem opera credenciais: ve valor sensivel na tela e pelo TOM.
-- Resolve o TODO(roadmap) de src/rituals/dispatcher.js.
alter table collaborators
  add column if not exists is_system_admin boolean not null default false;

comment on column collaborators.is_system_admin is
  'Se true, acessa qualquer credencial de governance_credentials (inclusive valores sensiveis) pelo TOM. Nao confundir com role=director, que governa a tela do PWA.';

update collaborators
set is_system_admin = true
where is_active = true
  and email in ('hugogmilesi@gmail.com', 'lucianoalf.la@gmail.com', '5521966950296@la.internal');

-- Leitura com escopo decidido NO BANCO, nao na aplicacao.
-- Admin ve todas as 45 com tudo; qualquer outro ve so nome+url das visivel_tom.
-- O campo is_admin no retorno diz ao engine qual formato usar, sem ele
-- precisar consultar collaborators de novo.
create or replace function get_credenciais_para(p_collaborator_id uuid)
returns table (
  id uuid, nome text, url_ref text, servico text, projeto text,
  responsavel text, categoria text, status text, observacoes text,
  campos jsonb, is_admin boolean
)
language plpgsql
stable
as $$
declare v_admin boolean;
begin
  select coalesce(c.is_system_admin, false) into v_admin
  from collaborators c
  where c.id = p_collaborator_id and c.is_active = true;

  if v_admin is null then v_admin := false; end if;

  if v_admin then
    return query
      select g.id, g.nome, g.url_ref, g.servico, g.projeto, g.responsavel,
             g.categoria, g.status, g.observacoes, g.campos, true
      from governance_credentials g
      order by g.nome;
  else
    return query
      select g.id, g.nome, g.url_ref,
             null::text, null::text, null::text, null::text, null::text, null::text,
             '[]'::jsonb, false
      from governance_credentials g
      where g.visivel_tom = true
        and g.status = 'ok'
        and g.url_ref is not null
      order by g.nome;
  end if;
end; $$;

-- A anon key esta no bundle publico do PWA.
revoke execute on function get_credenciais_para(uuid) from public;
revoke execute on function get_credenciais_para(uuid) from anon;
revoke execute on function get_credenciais_para(uuid) from authenticated;
grant execute on function get_credenciais_para(uuid) to service_role;

-- NAO dropar get_credenciais_publicas aqui. O engine em producao so passa a
-- usar a RPC nova no deploy (Task 6); dropar agora deixaria o TOM respondendo
-- "nao tenho nenhum sistema cadastrado" ate la. O drop e o Step 2 da Task 6.
```

- [ ] **Step 2: Aplicar via MCP**

Aplicar via `apply_migration` (projeto `cesnbnrynvxvgdhfmaua`), nome `credenciais_escopo_perfil`.

- [ ] **Step 3: Verificar a marcação — exatamente 3 admins**

```sql
select full_name, email, role, is_system_admin
from collaborators where is_system_admin = true order by full_name;
```
Esperado: **exatamente 3 linhas** — Anne Susan, Hugo, Luciano Alf. Se vier número diferente, os e-mails divergiram — **parar** e conferir antes de seguir.

- [ ] **Step 4: Verificar o escopo admin**

```sql
select count(*) as total, count(*) filter (where is_admin) as marcadas_admin,
       count(*) filter (where campos is not null and campos <> '[]'::jsonb) as com_campos
from get_credenciais_para((select id from collaborators where email = 'hugogmilesi@gmail.com'));
```
Esperado: `total = 45`, `marcadas_admin = 45`, `com_campos > 0`.

- [ ] **Step 5: Verificar o escopo não-admin**

```sql
select count(*) as total,
       count(*) filter (where observacoes is not null or campos <> '[]'::jsonb) as vazou_campo_extra
from get_credenciais_para((select id from collaborators where is_system_admin = false and is_active = true limit 1));
```
Esperado: `total = 3` (as `visivel_tom`), `vazou_campo_extra = 0`. Qualquer valor acima de zero em `vazou_campo_extra` significa vazamento — **parar**.

- [ ] **Step 6: Verificar id inexistente (fail-closed)**

```sql
select count(*) as total from get_credenciais_para('00000000-0000-0000-0000-000000000000');
```
Esperado: `3` — trata como não-admin, nunca como admin.

- [ ] **Step 7: Verificar o revoke**

```sql
select has_function_privilege('anon','get_credenciais_para(uuid)','EXECUTE') as anon_pode,
       has_function_privilege('authenticated','get_credenciais_para(uuid)','EXECUTE') as auth_pode,
       has_function_privilege('service_role','get_credenciais_para(uuid)','EXECUTE') as service_pode,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='get_credenciais_publicas') as antiga_ainda_existe;
```
Esperado: `anon_pode=false`, `auth_pode=false`, `service_pode=true`, e `antiga_ainda_existe=1` — a antiga **continua existindo de propósito** até o deploy da Task 6, para não quebrar o TOM em produção nesse intervalo.

- [ ] **Step 8: Commit**

```bash
git add -f supabase/migrations/20260903_credenciais_escopo_perfil.sql
git commit -m "feat(credenciais): coluna is_system_admin + RPC get_credenciais_para com escopo por perfil"
```

---

### Task 2: Módulo de formatação

**Files:**
- Create: `src/lib/credenciais-format.js`
- Test: `src/lib/credenciais-format.test.js`

**Interfaces:**
- Consumes: nada (módulo puro, sem I/O)
- Produces:
  - `mdParaWhatsapp(md: string): string`
  - `formatListaPublica(creds: Array<{nome, url_ref}>): string`
  - `formatCredencialAdmin(cred: object, opts?: {maxCampos?: number}): string`
  - `MAX_ITENS: number` (= 30)
  - `MAX_CAMPOS: number` (= 6)

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/credenciais-format.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { mdParaWhatsapp, formatListaPublica, formatCredencialAdmin, MAX_ITENS, MAX_CAMPOS } = require('./credenciais-format');

test('mdParaWhatsapp: headings viram negrito do whatsapp', () => {
  assert.equal(mdParaWhatsapp('# Titulo'), '*Titulo*');
  assert.equal(mdParaWhatsapp('### Sub'), '*Sub*');
});

test('mdParaWhatsapp: bold markdown vira bold whatsapp', () => {
  assert.equal(mdParaWhatsapp('isso e **importante**'), 'isso e *importante*');
});

test('mdParaWhatsapp: callouts viram prefixo legivel', () => {
  assert.match(mdParaWhatsapp('> [!critico]\n> cuidado'), /⚠️/);
  assert.match(mdParaWhatsapp('> [!nota]\n> veja'), /📌/);
});

test('mdParaWhatsapp: entrada vazia ou nula devolve string vazia', () => {
  assert.equal(mdParaWhatsapp(''), '');
  assert.equal(mdParaWhatsapp(null), '');
});

test('formatListaPublica: so nome e url, um por linha', () => {
  const out = formatListaPublica([{ nome: 'Anamnese', url_ref: 'https://a' }]);
  assert.match(out, /Anamnese: https:\/\/a/);
});

test('formatListaPublica: ignora item sem url e respeita cap', () => {
  assert.equal(formatListaPublica([]), '');
  assert.equal(formatListaPublica(null), '');
  const muitos = Array.from({ length: MAX_ITENS + 5 }, (_, i) => ({ nome: `S${i}`, url_ref: `https://x/${i}` }));
  const linhas = formatListaPublica(muitos).split('\n').filter(l => l.startsWith('- '));
  assert.equal(linhas.length, MAX_ITENS);
});

test('formatCredencialAdmin: mostra nome, url e campos', () => {
  const out = formatCredencialAdmin({
    nome: 'Google Ads', url_ref: 'https://ads.google.com', servico: 'Google',
    observacoes: null,
    campos: [{ label: 'E-mail', valor: 'a@b.com', sensivel: false },
             { label: 'Senha', valor: 'segredo123', sensivel: true }],
  });
  assert.match(out, /Google Ads/);
  assert.match(out, /https:\/\/ads\.google\.com/);
  assert.match(out, /E-mail.*a@b\.com/s);
  assert.match(out, /Senha.*segredo123/s, 'admin ve o valor sensivel');
});

test('formatCredencialAdmin: converte observacoes de markdown', () => {
  const out = formatCredencialAdmin({
    nome: 'X', url_ref: null, campos: [],
    observacoes: '# Contexto\nSistema **principal**',
  });
  assert.match(out, /\*Contexto\*/);
  assert.match(out, /\*principal\*/);
  assert.doesNotMatch(out, /#/, 'nao deixa markdown cru');
});

test('formatCredencialAdmin: acima do cap avisa quantos faltam', () => {
  const campos = Array.from({ length: MAX_CAMPOS + 8 }, (_, i) => ({ label: `L${i}`, valor: `v${i}`, sensivel: false }));
  const out = formatCredencialAdmin({ nome: 'Sol', url_ref: null, observacoes: null, campos });
  assert.match(out, new RegExp(`mais ${8} campo`), 'diz quantos ficaram de fora');
});

test('formatCredencialAdmin: opts.maxCampos ilimitado mostra todos', () => {
  const campos = Array.from({ length: 14 }, (_, i) => ({ label: `L${i}`, valor: `v${i}`, sensivel: false }));
  const out = formatCredencialAdmin({ nome: 'Sol', url_ref: null, observacoes: null, campos }, { maxCampos: Infinity });
  assert.match(out, /L13/);
  assert.doesNotMatch(out, /mais \d+ campo/);
});

test('formatCredencialAdmin: credencial sem campos nao quebra', () => {
  const out = formatCredencialAdmin({ nome: 'Vazia', url_ref: null, observacoes: null, campos: null });
  assert.match(out, /Vazia/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/lib/credenciais-format.test.js`
Expected: FAIL — `Cannot find module './credenciais-format'`

- [ ] **Step 3: Implementar**

Criar `src/lib/credenciais-format.js`:

```js
// Formatacao de credenciais para o WhatsApp. Modulo PURO (sem I/O).
// O banco guarda observacoes em markdown (renderizado bonito no PWA), mas o
// WhatsApp nao renderiza `#`, `**`, tabelas nem callouts — apareceria cru.
// Aqui converte para a formatacao do WhatsApp; o banco fica intacto.

const MAX_ITENS = 30;    // itens numa listagem publica
const MAX_CAMPOS = 6;    // campos mostrados por credencial antes de resumir

function mdParaWhatsapp(md) {
  if (!md || typeof md !== 'string') return '';
  return md
    .replace(/^>\s*\[!critico\]\s*/gim, '⚠️ ')
    .replace(/^>\s*\[!atencao\]\s*/gim, '⚠️ ')
    .replace(/^>\s*\[!nota\]\s*/gim, '📌 ')
    .replace(/^#{1,6}\s*(.+)$/gm, '*$1*')   // headings → bold
    .replace(/\*\*(.+?)\*\*/g, '*$1*')      // bold md → bold wa
    .replace(/^>\s?/gm, '')                 // resto das citacoes
    .replace(/^\s*[-*]\s+/gm, '- ')         // bullets normalizados
    .replace(/\|/g, ' ')                    // tabelas viram texto corrido
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatListaPublica(creds) {
  if (!Array.isArray(creds) || !creds.length) return '';
  const linhas = creds
    .filter(c => c && c.nome && c.url_ref)
    .slice(0, MAX_ITENS)
    .map(c => `- ${c.nome}: ${c.url_ref}`);
  if (!linhas.length) return '';
  return `**Links dos sistemas do time:**\n${linhas.join('\n')}`;
}

function formatCredencialAdmin(cred, opts = {}) {
  if (!cred || !cred.nome) return '';
  const maxCampos = opts.maxCampos === undefined ? MAX_CAMPOS : opts.maxCampos;
  const linhas = [`*${cred.nome}*`];
  if (cred.servico) linhas.push(`Serviço: ${cred.servico}`);
  if (cred.url_ref) linhas.push(`Link: ${cred.url_ref}`);

  const campos = Array.isArray(cred.campos) ? cred.campos.filter(c => c && c.label) : [];
  const mostrados = campos.slice(0, maxCampos === Infinity ? campos.length : maxCampos);
  for (const c of mostrados) {
    linhas.push(`${c.label}: ${c.valor === undefined || c.valor === null ? '' : c.valor}`);
  }
  const restantes = campos.length - mostrados.length;
  if (restantes > 0) linhas.push(`_(mais ${restantes} campos — peça "todos os campos" pra ver)_`);

  const obs = mdParaWhatsapp(cred.observacoes);
  if (obs) linhas.push('', obs);
  return linhas.join('\n');
}

module.exports = { mdParaWhatsapp, formatListaPublica, formatCredencialAdmin, MAX_ITENS, MAX_CAMPOS };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/lib/credenciais-format.test.js`
Expected: PASS — 11 testes.

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/lib/credenciais-format.js`

- [ ] **Step 6: Commit**

```bash
git add src/lib/credenciais-format.js src/lib/credenciais-format.test.js
git commit -m "feat(credenciais): modulo de formatacao (markdown->whatsapp, lista publica, credencial admin)"
```

---

### Task 3: Serviço com escopo por perfil

**Files:**
- Create: `src/services/credenciais.js`
- Test: `src/services/credenciais.test.js`
- Delete: `src/services/credenciais-publicas.js`, `src/services/credenciais-publicas.test.js`

**Interfaces:**
- Consumes: RPC `get_credenciais_para(p_collaborator_id uuid)` (Task 1)
- Produces:
  - `getCredenciaisPara(collaboratorId: string): Promise<{isAdmin: boolean, creds: Array<object>}>`
  - `_resetCache(): void`
  - `CACHE_TTL_MS: number` (= 1800000)

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/services/credenciais.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

const clientPath = require.resolve('../supabase/client');
let rpcCalls = 0;
let rpcImpl = async () => ({ data: [], error: null });
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true, exports: {
    rpc: async (...args) => { rpcCalls++; return rpcImpl(...args); },
  },
};

const { getCredenciaisPara, _resetCache, CACHE_TTL_MS } = require('./credenciais');

const ADMIN = '11111111-1111-1111-1111-111111111111';
const COMUM = '22222222-2222-2222-2222-222222222222';

test('getCredenciaisPara: admin recebe isAdmin true e os campos', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ id: 'x', nome: 'Google', url_ref: 'https://g', campos: [{ label: 'Senha', valor: 's3cr3t', sensivel: true }], is_admin: true }], error: null });
  const out = await getCredenciaisPara(ADMIN);
  assert.equal(out.isAdmin, true);
  assert.equal(out.creds[0].campos[0].valor, 's3cr3t');
});

test('getCredenciaisPara: nao-admin recebe isAdmin false', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ id: 'y', nome: 'Anamnese', url_ref: 'https://a', campos: [], is_admin: false }], error: null });
  const out = await getCredenciaisPara(COMUM);
  assert.equal(out.isAdmin, false);
});

test('getCredenciaisPara: escopo publico usa cache na segunda chamada', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ id: 'y', nome: 'A', url_ref: 'https://a', campos: [], is_admin: false }], error: null });
  await getCredenciaisPara(COMUM);
  await getCredenciaisPara(COMUM);
  assert.equal(rpcCalls, 1, 'publico e cacheado');
});

test('getCredenciaisPara: escopo admin NUNCA e cacheado (senha fora da memoria)', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ id: 'x', nome: 'G', url_ref: null, campos: [{ label: 'Senha', valor: 'p', sensivel: true }], is_admin: true }], error: null });
  await getCredenciaisPara(ADMIN);
  await getCredenciaisPara(ADMIN);
  assert.equal(rpcCalls, 2, 'admin sempre consulta de novo');
});

test('getCredenciaisPara: erro da RPC nao lanca — devolve vazio e nao-admin', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: null, error: { message: 'boom' } });
  const out = await getCredenciaisPara(ADMIN);
  assert.deepEqual(out.creds, []);
  assert.equal(out.isAdmin, false, 'fail-closed: erro nunca vira admin');
});

test('getCredenciaisPara: excecao nao lanca — fail-closed', async () => {
  _resetCache();
  rpcImpl = async () => { throw new Error('rede caiu'); };
  const out = await getCredenciaisPara(ADMIN);
  assert.deepEqual(out.creds, []);
  assert.equal(out.isAdmin, false);
});

test('getCredenciaisPara: id nulo nem chama a RPC', async () => {
  _resetCache(); rpcCalls = 0;
  const out = await getCredenciaisPara(null);
  assert.equal(rpcCalls, 0);
  assert.equal(out.isAdmin, false);
  assert.deepEqual(out.creds, []);
});

test('CACHE_TTL_MS: 30 minutos', () => {
  assert.equal(CACHE_TTL_MS, 30 * 60 * 1000);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/services/credenciais.test.js`
Expected: FAIL — `Cannot find module './credenciais'`

- [ ] **Step 3: Implementar**

Criar `src/services/credenciais.js`:

```js
// Unica porta de acesso do TOM a governance_credentials.
// O ESCOPO e decidido no banco pela RPC get_credenciais_para(collaborator_id):
// admin recebe tudo, qualquer outro recebe so nome+url das visivel_tom.
// Nunca montar query direta na tabela aqui.
//
// Cache: SO o escopo publico. O escopo admin traz senha em texto plano —
// manter isso 30min na memoria do processo seria ampliar a exposicao sem
// necessidade, ja que a consulta e pontual.

const CACHE_TTL_MS = 30 * 60 * 1000;

// Cache keyed por collaboratorId. SO entra aqui quem NAO e admin — entao um
// hit ja implica escopo publico, e o resultado admin (que traz senha em texto
// plano) nunca fica residente na memoria do processo.
const _cachePublico = new Map();

function _resetCache() {
  _cachePublico.clear();
}

function _cacheHit(collaboratorId) {
  const hit = _cachePublico.get(collaboratorId);
  if (!hit) return null;
  if (Date.now() - hit.ts >= CACHE_TTL_MS) { _cachePublico.delete(collaboratorId); return null; }
  return hit.creds;
}

async function getCredenciaisPara(collaboratorId) {
  if (!collaboratorId) return { isAdmin: false, creds: [] };

  const cached = _cacheHit(collaboratorId);
  if (cached) return { isAdmin: false, creds: cached };

  try {
    const supabase = require('../supabase/client'); // lazy: evita init no load (testes)
    const { data, error } = await supabase.rpc('get_credenciais_para', { p_collaborator_id: collaboratorId });
    if (error) {
      console.warn('[Credenciais] RPC erro:', error.message);
      return { isAdmin: false, creds: [] };   // fail-closed
    }
    const rows = data || [];
    const isAdmin = rows.length > 0 && rows[0].is_admin === true;
    if (!isAdmin) _cachePublico.set(collaboratorId, { ts: Date.now(), creds: rows });
    return { isAdmin, creds: rows };
  } catch (e) {
    console.warn('[Credenciais] fetch falhou:', e.message);
    return { isAdmin: false, creds: [] };     // fail-closed
  }
}

module.exports = { getCredenciaisPara, _resetCache, CACHE_TTL_MS };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/services/credenciais.test.js`
Expected: PASS — 8 testes.

- [ ] **Step 5: Remover o serviço antigo**

```bash
git rm src/services/credenciais-publicas.js src/services/credenciais-publicas.test.js
```

- [ ] **Step 6: Confirmar que nada mais referencia o antigo**

Run: `grep -rn "credenciais-publicas\|getCredenciaisPublicas" src/ --include=*.js`
Expected: apenas ocorrências em `src/engine.js` (corrigidas na Task 4). Se aparecer em outro arquivo, tratar antes de seguir.

- [ ] **Step 7: Validar sintaxe e commitar**

```bash
node --check src/services/credenciais.js
git add src/services/credenciais.js src/services/credenciais.test.js
git commit -m "feat(credenciais): servico com escopo por perfil; aposenta credenciais-publicas"
```

---

### Task 4: Engine — usar escopo e formatador novos

**Files:**
- Modify: `src/engine.js` (bloco `// TWO-PASS <<PEDIR_CREDENCIAIS>>`, ~linha 10650)

**Interfaces:**
- Consumes: `getCredenciaisPara` (Task 3); `formatListaPublica`, `formatCredencialAdmin` (Task 2); `hasPedirCredenciaisMarker` (já existe em `src/lib/pedir-credenciais.js`)
- Produces: nada para tasks seguintes

- [ ] **Step 1: Localizar o bloco atual**

Run: `grep -n "TWO-PASS <<PEDIR_CREDENCIAIS>>" src/engine.js`
Ler o bloco inteiro (cerca de 35 linhas a partir dali) antes de editar. Ele hoje chama `getCredenciaisPublicas()` e `formatCredenciaisBlock()`.

- [ ] **Step 2: Substituir o corpo do bloco**

Manter o `try/catch` externo e o comentário de cabeçalho. Trocar o miolo por:

```js
    const { hasPedirCredenciaisMarker } = require('./lib/pedir-credenciais');
    if (hasPedirCredenciaisMarker(reply)) {
      const { getCredenciaisPara } = require('./services/credenciais');
      const { formatListaPublica, formatCredencialAdmin } = require('./lib/credenciais-format');
      const { isAdmin, creds } = await getCredenciaisPara(collab.id);
      console.log(`[PedirCredenciais] marker detectado — admin=${isAdmin} itens=${creds.length}`);
      await logMarker(collab.id, 'PEDIR_CREDENCIAIS', creds.length ? 'executed' : 'rejected',
        `admin:${isAdmin} itens:${creds.length}`, null);

      let bloco = '';
      if (creds.length) {
        bloco = isAdmin
          ? creds.map(c => formatCredencialAdmin(c)).join('\n\n')
          : formatListaPublica(creds);
      }

      if (!bloco) {
        reply = 'Não tenho nenhum sistema cadastrado com link por aqui ainda.';
      } else {
        reply = bloco; // degrada para o bloco cru se a 2a chamada falhar
        const credSys = `${bloco}\n\n`
          + `O colaborador perguntou sobre acesso a algum desses sistemas. `
          + `Responda em português, de forma curta e natural, APENAS o que ele pediu — `
          + `não despeje a lista inteira nem todos os campos se ele perguntou por um item só. `
          + `Só liste tudo se ele tiver pedido explicitamente a lista completa. `
          + `Não mencione banco de dados, tabela ou qualquer detalhe técnico interno. `
          + `Não emita nenhum marker nesta resposta.`;
        const segunda = await ai.chat(credSys, msgs);
        const textoSegundo = String(segunda?.text || '').trim();
        reply = textoSegundo || bloco;
      }
    }
```

- [ ] **Step 3: Validar sintaxe**

Run: `node --check src/engine.js`

- [ ] **Step 4: Confirmar que nenhuma referência antiga sobrou**

Run: `grep -rn "getCredenciaisPublicas\|formatCredenciaisBlock\|credenciais-publicas" src/ --include=*.js`
Expected: **nenhuma saída**. Se `formatCredenciaisBlock` ainda for exportado por `src/lib/pedir-credenciais.js` sem uso, removê-lo desse módulo e ajustar `src/lib/pedir-credenciais.test.js` (apagar os testes daquela função — ela foi substituída pelo módulo de formatação).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `node --test src/lib/*.test.js src/services/*.test.js src/rituals/*.test.js src/utils/*.test.js`
Expected: PASS. Duas falhas por `SUPABASE_URL` ausente são pré-existentes do ambiente local — confirmar com `git stash` se aparecerem, para provar que não vieram desta task.

- [ ] **Step 6: Commit**

```bash
git add src/engine.js src/lib/pedir-credenciais.js src/lib/pedir-credenciais.test.js
git commit -m "feat(credenciais): engine usa escopo por perfil e formatador novo"
```

---

### Task 5: System prompt — negativa que não revela

**Files:**
- Modify: `src/prompts/system.js` (seção `# 🔗 LINKS DE SISTEMAS`)

**Interfaces:**
- Consumes: nada
- Produces: instrução que rege quando o modelo emite `<<PEDIR_CREDENCIAIS>>`

- [ ] **Step 1: Localizar a seção**

Run: `grep -n "LINKS DE SISTEMAS" src/prompts/system.js`

- [ ] **Step 2: Substituir a seção inteira**

Trocar o `systemPrompt += ...` daquela seção por:

```js
  systemPrompt += `\n\n---\n\n# 🔗 SISTEMAS E ACESSOS\n\nQuando o colaborador pedir o **link, endereço, site, acesso, login ou senha** de algum sistema interno (ex: anamnese, CRM, chatwoot, relatórios, ERP, Google Ads), responda **apenas** com:\n\n<<PEDIR_CREDENCIAIS>><<END>>\n\nNada além disso — sem texto antes ou depois. A informação será fornecida e você responderá em seguida.\n\nO que volta depende de quem perguntou, e **isso é decidido pelo sistema, não por você**. Você nunca sabe de antemão o que vai receber: pode vir só nome e link, ou a credencial completa. Emita o marker e trabalhe com o que vier.\n\nSe vier apenas nome e link, é porque essa pessoa só tem acesso a isso. Nesse caso, **não diga que existe informação restrita, nem que ela não tem permissão, nem cite quem teria**. Se ela insistir por senha ou login, responda de forma simples que isso você não consegue ajudar e que ela deve falar com o Luciano — sem explicar o motivo.\n\nNÃO use esse marker para outros assuntos (tarefas, agenda, financeiro). NÃO invente URL, login ou senha em hipótese alguma: se não tiver a informação, use o marker.`;
```

- [ ] **Step 3: Validar sintaxe**

Run: `node --check src/prompts/system.js`

- [ ] **Step 4: Confirmar que o texto não foi corrompido**

Run: `grep -c "PEDIR_CREDENCIAIS" src/prompts/system.js`
Expected: `1`. Ler o trecho e conferir que acentos e emoji estão íntegros.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/system.js
git commit -m "feat(credenciais): instrucao de escopo por perfil, com negativa que nao revela"
```

---

### Task 6: Deploy e verificação em produção

**Files:** nenhum. SCP + verificação.

**Interfaces:**
- Consumes: tudo das Tasks 1-5
- Produces: feature no ar

- [ ] **Step 1: Deploy**

```bash
scp src/engine.js src/prompts/system.js root@89.116.73.186:/tmp/
scp src/lib/credenciais-format.js src/services/credenciais.js root@89.116.73.186:/tmp/
ssh root@89.116.73.186 "cd /opt/LA-Organizer && cp /tmp/engine.js src/engine.js && cp /tmp/system.js src/prompts/system.js && cp /tmp/credenciais-format.js src/lib/ && cp /tmp/credenciais.js src/services/ && rm -f src/services/credenciais-publicas.js src/services/credenciais-publicas.test.js && node --check src/engine.js && node --check src/prompts/system.js && node --check src/lib/credenciais-format.js && node --check src/services/credenciais.js && echo SYNTAX_OK && pm2 restart tom"
```

Nota: o alias SSH `tom` não funciona neste ambiente (`~/.ssh/config` vazio) — usar o IP direto.

- [ ] **Step 2: Confirmar que o processo voltou**

```bash
ssh root@89.116.73.186 "pm2 list | grep tom"
```
Expected: `online`.

- [ ] **Step 2b: Dropar a RPC antiga (só agora)**

A `get_credenciais_publicas` sobreviveu à Task 1 de propósito, para o TOM em produção não ficar sem leitura entre a migration e este deploy. Com o código novo no ar, ela sai:

```sql
drop function if exists get_credenciais_publicas();
```

Verificar que sumiu e que a nova ficou:
```sql
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'get_credenciais%';
```
Esperado: apenas `get_credenciais_para`.

- [ ] **Step 3: Teste E2E — admin pedindo credencial completa**

Pedir ao usuário que mande no WhatsApp do TOM: **"me manda a credencial do Chatwoot"**

Esperado: responde com nome, link e os campos cadastrados. Verificar:
```bash
ssh root@89.116.73.186 "pm2 logs tom --lines 60 --nostream | grep -i 'PedirCredenciais\|LEAK_BLOCKED'"
```
Expected: `[PedirCredenciais] marker detectado — admin=true itens=45`, e **nenhum** `LEAK_BLOCKED`.

- [ ] **Step 4: Teste E2E — admin pedindo só o link**

Pedir ao usuário: **"qual o link da anamnese?"**

Esperado: responde o link, sem despejar as 45 credenciais nem os campos de outras.

- [ ] **Step 5: Teste E2E — não-admin**

Pedir ao usuário que peça a alguém do time (ex: da secretaria) para mandar ao TOM: **"qual o link da anamnese?"** e depois **"me passa a senha do chatwoot"**.

Esperado: a primeira responde o link; a segunda nega **sem revelar** que existe informação restrita nem quem teria acesso.

```sql
select collaborator_id, result, reason, created_at
from marker_logs where marker_type = 'PEDIR_CREDENCIAIS'
order by created_at desc limit 10;
```
Expected: linha do não-admin com `reason` contendo `admin:false itens:3`.

- [ ] **Step 6: Teste de não-regressão**

Pedir ao usuário: **"o que eu tenho pra hoje?"**
Esperado: responde as tarefas; logs **sem** `[PedirCredenciais]`.

- [ ] **Step 7: Commit e push**

```bash
git add -A
git commit -m "feat(credenciais): deploy da leitura com escopo por perfil"
git push origin main
```

- [ ] **Step 8: Registrar no daily-notes**

Acrescentar seção em `daily-notes/2026-09-03.md` (não sobrescrever) com o que foi implementado, os resultados dos Steps 3-6 e a pendência abaixo.

**👁️ OBSERVAR:** confirmar em produção que nenhum não-admin obtém valor sensível.
- **Query:** `select c.full_name, c.is_system_admin, m.reason, m.created_at from marker_logs m join collaborators c on c.id = m.collaborator_id where m.marker_type = 'PEDIR_CREDENCIAIS' order by m.created_at desc limit 30;`
- **Sinal de fracasso:** linha com `is_system_admin = false` e `reason` contendo `admin:true`.
- **Concluir após:** ao menos 5 usos reais por não-admins.

---

## Self-Review

**Cobertura do spec (fatias 1+2):**

| Requisito do spec | Task |
|---|---|
| Coluna `is_system_admin` (Hugo, Luciano, Anne) | 1 |
| Escopo decidido no banco, não pela aplicação | 1 |
| `get_credenciais_publicas` aposentada | 1 (Step 1 e 7), 3 (Step 5) |
| `revoke` da anon key | 1 (Steps 1 e 7) |
| Não-admin vê só `nome`+`url_ref` das `visivel_tom` | 1 (Step 5), 2, 4 |
| Negativa não revela a funcionalidade | 5 |
| `observacoes` na resposta, convertidas para WhatsApp | 2 |
| Cap de campos com oferta de ver todos | 2 |
| Degradação sem lançar | 3 |
| Senha nunca cacheada em memória | 3 (Step 1 e 3) |
| Critérios 1, 2, 9 do spec | 6 (Steps 3-5) |

**Fora deste plano, por decisão de escopo:** escrita (`create`/`update`/`delete`), anti-duplicata, redação na entrada e o marker `<<CREDENCIAL_ACTION>>` — tudo isso é a fatia 3, com plano próprio. A **cifragem (fatia 0) foi descartada** pelo Hugo e não tem task aqui.

**Consistência de tipos:** `getCredenciaisPara(id)` devolve `{isAdmin, creds}`, consumido exatamente assim na Task 4. `formatListaPublica(creds)` e `formatCredencialAdmin(cred)` têm os nomes definidos na Task 2 e usados na Task 4. A RPC devolve `is_admin` (snake_case, SQL) que o serviço lê como `rows[0].is_admin` e expõe como `isAdmin` (camelCase, JS) — a fronteira é explícita e está em um lugar só.

**Ponto de atenção herdado:** o anti-leak `STACK_LEAK_RE` continua ativo. Credenciais cujo nome ou campos contenham "supabase", "mcp" ou "sql" (até 4 das 45, ex. "Mila Supabase", "Hostinger API (MCP)") ainda cairão nele, e o admin receberá erro genérico ao consultá-las. A isenção estreita foi desenhada no spec mas **não** entra neste plano — sem a fatia 0, ela deixou de ser pré-requisito de entrega. Fica registrado como limitação conhecida da fatia 2, a resolver junto com a fatia 3 se incomodar na prática.
