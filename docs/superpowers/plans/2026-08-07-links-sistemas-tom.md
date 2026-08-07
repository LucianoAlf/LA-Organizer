# Links de sistemas via TOM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o TOM responda o link de um sistema interno quando um colaborador perguntar, sem nunca expor qualquer outro dado da tabela `governance_credentials`.

**Architecture:** Uma coluna booleana marca quais credenciais são "links públicos". Uma RPC SQL expõe apenas `nome` e `url_ref` dessas linhas — o contrato de colunas vive no schema, não em JS. O modelo decide semanticamente quando precisa da lista emitindo o marker `<<PEDIR_CREDENCIAIS>>`; o engine detecta, busca via RPC (com cache de 30min) e faz uma segunda chamada ao modelo com a lista. Nenhuma tool nativa ou MCP é reativada.

**Tech Stack:** Node.js (CommonJS), Supabase JS client (service_role), PostgreSQL, `node:test` + `node --test` para testes.

## Global Constraints

- Projeto em **FEATURE FREEZE** — esta feature foi explicitamente aprovada pelo usuário; nenhuma outra funcionalidade nova deve ser adicionada junto.
- **NUNCA** reativar `--tools` ou MCP em `src/ai/claude.js`. O hardening (`--strict-mcp-config`, `--mcp-config '{"mcpServers":{}}'`, `--tools ''`) é intocável.
- Código backend é **CommonJS** (`require`/`module.exports`), não ESM.
- Timezone **BRT (UTC-3)**.
- A RPC expõe **exclusivamente** as colunas `nome` e `url_ref`. Nenhuma outra coluna, em nenhuma hipótese.
- Toda função nova deve degradar sem lançar: falha de link nunca pode impedir a mensagem do colaborador de ser respondida.
- Validar sintaxe com `node --check <arquivo>` antes de considerar qualquer task concluída.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_team_links_rpc.sql` (criar) | Coluna `visivel_tom`, RPC `get_credenciais_publicas()`, `revoke` da anon key |
| `src/services/credenciais-publicas.js` (criar) | Busca via RPC + cache 30min + degradação. Única porta de acesso ao dado. |
| `src/services/credenciais-publicas.test.js` (criar) | Testes de cache, degradação e formatação |
| `src/lib/pedir-credenciais.js` (criar) | Detecção do marker e formatação do bloco. Módulo puro, sem I/O — testável. |
| `src/lib/pedir-credenciais.test.js` (criar) | Testes do parser e do formatador |
| `src/prompts/system.js` (modificar, ~linha 3067) | Instrução do marker no system prompt |
| `src/engine.js` (modificar, linha 10647) | Two-pass: detectar marker, buscar, re-chamar o modelo |

**Ordem de execução obrigatória:** Task 1 → 2 → 3 → 4 → 5 → 6. Task 4 depende dos módulos das Tasks 2 e 3.

---

### Task 1: Migration — coluna, RPC e revoke

> **CONCLUÍDA** em `bc4ec381`, antes do rename da RPC. Foi aplicada com o nome
> `get_team_links()`; a Task 1b renomeia para `get_credenciais_publicas()`.
> O texto abaixo já reflete o nome final.

**Files:**
- Create: `supabase/migrations/20260807_team_links_rpc.sql`

**Interfaces:**
- Consumes: nada
- Produces: RPC `get_credenciais_publicas()` retornando `table (nome text, url_ref text)`; coluna `governance_credentials.visivel_tom boolean not null default false`

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260807_team_links_rpc.sql`:

```sql
-- Links de sistemas visíveis ao TOM.
-- default false: as 40+ credenciais existentes permanecem invisíveis sem ação.
alter table governance_credentials
  add column if not exists visivel_tom boolean not null default false;

comment on column governance_credentials.visivel_tom is
  'Se true, nome e url_ref desta linha podem ser lidos pelo TOM via get_credenciais_publicas(). Nunca expõe campos/observacoes/senhas.';

-- Contrato de colunas no schema: ampliar o que vaza exige reescrever esta
-- função via migration (mudança versionada e visível), não uma linha de .select() em JS.
create or replace function get_credenciais_publicas()
returns table (nome text, url_ref text)
language sql
stable
as $$
  select nome, url_ref
  from governance_credentials
  where visivel_tom = true
    and status = 'ok'
    and url_ref is not null
  order by nome;
$$;

-- A anon key do Supabase está no bundle público do PWA. Sem este revoke,
-- qualquer pessoa na internet poderia enumerar os sistemas internos da escola.
revoke execute on function get_credenciais_publicas() from public;
revoke execute on function get_credenciais_publicas() from anon;
revoke execute on function get_credenciais_publicas() from authenticated;
grant execute on function get_credenciais_publicas() to service_role;
```

- [ ] **Step 2: Aplicar a migration**

Aplicar via MCP do Supabase (`apply_migration`, projeto `cesnbnrynvxvgdhfmaua`), nome `team_links_rpc`.

- [ ] **Step 3: Verificar que a RPC retorna vazio (nada marcado ainda)**

Rodar via MCP `execute_sql`:
```sql
select * from get_credenciais_publicas();
```
Esperado: **0 linhas**. Se retornar qualquer linha, o `default false` falhou — parar e investigar antes de seguir.

- [ ] **Step 4: Verificar que as colunas expostas são exatamente duas**

```sql
select p.proname, pg_get_function_result(p.oid) as result_type
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'get_credenciais_publicas' and n.nspname = 'public';
```
Esperado: `result_type` = `TABLE(nome text, url_ref text)`.

- [ ] **Step 5: Verificar o revoke**

```sql
select has_function_privilege('anon', 'get_credenciais_publicas()', 'EXECUTE') as anon_pode,
       has_function_privilege('authenticated', 'get_credenciais_publicas()', 'EXECUTE') as auth_pode,
       has_function_privilege('service_role', 'get_credenciais_publicas()', 'EXECUTE') as service_pode;
```
Esperado: `anon_pode = false`, `auth_pode = false`, `service_pode = true`.
Se `anon_pode` vier `true`, **parar** — é o vazamento que o spec previu.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260807_team_links_rpc.sql
git commit -m "feat(credenciais-publicas): coluna visivel_tom + RPC get_credenciais_publicas com revoke da anon key"
```

---

### Task 1b: Renomear a RPC para `get_credenciais_publicas`

Decisão do usuário durante a execução: `get_team_links` sugeria uma tabela de links, mas a fonte é `governance_credentials` — o link é apenas o campo exposto. O marker também foi renomeado (`<<PEDIR_LINKS>>` → `<<PEDIR_CREDENCIAIS>>`), o que só afeta as Tasks 2, 4 e 5, cujo texto já está atualizado.

**Files:**
- Create: `supabase/migrations/20260807b_rename_rpc_credenciais_publicas.sql`

**Interfaces:**
- Consumes: RPC `get_team_links()` (Task 1)
- Produces: RPC `get_credenciais_publicas()` com o mesmo contrato `table (nome text, url_ref text)` e os mesmos privilégios

- [ ] **Step 1: Escrever a migration de rename**

Criar `supabase/migrations/20260807b_rename_rpc_credenciais_publicas.sql`:

```sql
-- Rename: a fonte é governance_credentials, não uma tabela de "links".
-- ALTER FUNCTION ... RENAME preserva os privilégios (o revoke de anon
-- continua valendo), mas o Step 3 verifica isso explicitamente.
alter function get_team_links() rename to get_credenciais_publicas;

comment on column governance_credentials.visivel_tom is
  'Se true, nome e url_ref desta linha podem ser lidos pelo TOM via get_credenciais_publicas(). Nunca expõe campos/observacoes/senhas.';
```

- [ ] **Step 2: Aplicar via MCP**

Aplicar via MCP do Supabase (`apply_migration`, projeto `cesnbnrynvxvgdhfmaua`), nome `rename_rpc_credenciais_publicas`.

- [ ] **Step 3: Verificar nome, contrato e privilégios de uma vez**

```sql
select p.proname,
       pg_get_function_result(p.oid) as result_type,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_pode,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_pode
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('get_team_links', 'get_credenciais_publicas') and n.nspname = 'public';
```

Esperado: exatamente **1 linha**, com `proname = get_credenciais_publicas`, `result_type = TABLE(nome text, url_ref text)`, `anon_pode = false`, `auth_pode = false`, `service_pode = true`.

Se `get_team_links` ainda aparecer, o rename não pegou. Se `anon_pode = true`, o rename perdeu os privilégios — reaplicar os `revoke` do Step 1 da Task 1 com o nome novo antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add -f supabase/migrations/20260807b_rename_rpc_credenciais_publicas.sql
git commit -m "refactor(credenciais-publicas): renomeia RPC get_team_links para get_credenciais_publicas"
```

---

### Task 2: Módulo puro — parser do marker e formatador do bloco

**Files:**
- Create: `src/lib/pedir-credenciais.js`
- Test: `src/lib/pedir-credenciais.test.js`

**Interfaces:**
- Consumes: nada (módulo puro, sem I/O)
- Produces:
  - `hasPedirCredenciaisMarker(text: string): boolean`
  - `stripPedirCredenciaisMarker(text: string): string`
  - `formatCredenciaisBlock(links: Array<{nome: string, url_ref: string}>): string`
  - `MAX_CREDENCIAIS: number` (= 30)

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/pedir-credenciais.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { hasPedirCredenciaisMarker, stripPedirCredenciaisMarker, formatCredenciaisBlock, MAX_CREDENCIAIS } = require('./pedir-credenciais');

test('hasPedirCredenciaisMarker: detecta o marker com e sem END', () => {
  assert.equal(hasPedirCredenciaisMarker('<<PEDIR_CREDENCIAIS>><<END>>'), true);
  assert.equal(hasPedirCredenciaisMarker('texto antes <<PEDIR_CREDENCIAIS>> depois'), true);
  assert.equal(hasPedirCredenciaisMarker('<<pedir_credenciais>>'), true, 'case-insensitive');
});

test('hasPedirCredenciaisMarker: não confunde com outros markers', () => {
  assert.equal(hasPedirCredenciaisMarker('<<TASK_UPDATE>>[]<<END>>'), false);
  assert.equal(hasPedirCredenciaisMarker('me manda o link da anamnese'), false);
  assert.equal(hasPedirCredenciaisMarker(''), false);
  assert.equal(hasPedirCredenciaisMarker(null), false);
});

test('stripPedirCredenciaisMarker: remove marker e normaliza espaços', () => {
  assert.equal(stripPedirCredenciaisMarker('<<PEDIR_CREDENCIAIS>><<END>>'), '');
  assert.equal(stripPedirCredenciaisMarker('oi <<PEDIR_CREDENCIAIS>><<END>> tudo bem'), 'oi  tudo bem'.replace(/\s+/g, ' ').trim());
  assert.equal(stripPedirCredenciaisMarker(null), '');
});

test('formatCredenciaisBlock: renderiza nome e url', () => {
  const out = formatCredenciaisBlock([
    { nome: 'Anamnese de alunos', url_ref: 'https://a.app/' },
    { nome: 'Chatwoot', url_ref: 'https://b.com' },
  ]);
  assert.match(out, /Anamnese de alunos: https:\/\/a\.app\//);
  assert.match(out, /Chatwoot: https:\/\/b\.com/);
});

test('formatCredenciaisBlock: lista vazia devolve string vazia', () => {
  assert.equal(formatCredenciaisBlock([]), '');
  assert.equal(formatCredenciaisBlock(null), '');
});

test('formatCredenciaisBlock: aplica cap de MAX_CREDENCIAIS', () => {
  const many = Array.from({ length: MAX_CREDENCIAIS + 10 }, (_, i) => ({ nome: `S${i}`, url_ref: `https://x/${i}` }));
  const out = formatCredenciaisBlock(many);
  const linhas = out.split('\n').filter(l => l.startsWith('- '));
  assert.equal(linhas.length, MAX_CREDENCIAIS);
});

test('formatCredenciaisBlock: ignora linha sem url', () => {
  const out = formatCredenciaisBlock([{ nome: 'Sem url', url_ref: null }, { nome: 'Ok', url_ref: 'https://ok' }]);
  assert.doesNotMatch(out, /Sem url/);
  assert.match(out, /Ok: https:\/\/ok/);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test src/lib/pedir-credenciais.test.js`
Expected: FAIL — `Cannot find module './pedir-credenciais'`

- [ ] **Step 3: Implementar o módulo**

Criar `src/lib/pedir-credenciais.js`:

```js
// Marker <<PEDIR_CREDENCIAIS>> — o modelo sinaliza que precisa da lista de links de
// sistemas. Módulo PURO (sem I/O) pra ser testável sem tocar no Supabase.
// O engine faz o two-pass; aqui só detecção, limpeza e formatação.

const MAX_CREDENCIAIS = 30;

// Aceita com ou sem <<END>> — o modelo às vezes omite o fechamento.
const PEDIR_CREDENCIAIS_RE = /<<PEDIR_CREDENCIAIS>>(?:\s*<<END>>)?/i;
const PEDIR_CREDENCIAIS_RE_G = /<<PEDIR_CREDENCIAIS>>(?:\s*<<END>>)?/gi;

function hasPedirCredenciaisMarker(text) {
  if (!text || typeof text !== 'string') return false;
  return PEDIR_CREDENCIAIS_RE.test(text);
}

function stripPedirCredenciaisMarker(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(PEDIR_CREDENCIAIS_RE_G, ' ').replace(/\s+/g, ' ').trim();
}

function formatCredenciaisBlock(links) {
  if (!Array.isArray(links) || !links.length) return '';
  const linhas = links
    .filter(l => l && l.nome && l.url_ref)
    .slice(0, MAX_CREDENCIAIS)
    .map(l => `- ${l.nome}: ${l.url_ref}`);
  if (!linhas.length) return '';
  return `**Links dos sistemas do time:**\n${linhas.join('\n')}`;
}

module.exports = { hasPedirCredenciaisMarker, stripPedirCredenciaisMarker, formatCredenciaisBlock, MAX_CREDENCIAIS };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test src/lib/pedir-credenciais.test.js`
Expected: PASS — 6 testes.

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/lib/pedir-credenciais.js`
Expected: sem saída (sucesso).

- [ ] **Step 6: Commit**

```bash
git add src/lib/pedir-credenciais.js src/lib/pedir-credenciais.test.js
git commit -m "feat(credenciais-publicas): modulo puro do marker PEDIR_CREDENCIAIS (parser + formatador)"
```

---

### Task 3: Serviço — busca via RPC com cache

**Files:**
- Create: `src/services/credenciais-publicas.js`
- Test: `src/services/credenciais-publicas.test.js`

**Interfaces:**
- Consumes: RPC `get_credenciais_publicas()` (Task 1)
- Produces:
  - `getCredenciaisPublicas(): Promise<Array<{nome: string, url_ref: string}>>`
  - `_resetCache(): void` (usado só em teste)
  - `CACHE_TTL_MS: number` (= 1800000)

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/services/credenciais-publicas.test.js`. O módulo faz `require('../supabase/client')` de forma **lazy** (dentro da função), então o teste injeta um fake antes da primeira chamada via `require.cache`:

```js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Injeta um client fake no require.cache ANTES do módulo sob teste resolvê-lo.
const clientPath = require.resolve('../supabase/client');
let rpcCalls = 0;
let rpcImpl = async () => ({ data: [], error: null });
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true, exports: {
    rpc: async (...args) => { rpcCalls++; return rpcImpl(...args); },
  },
};

const { getCredenciaisPublicas, _resetCache, CACHE_TTL_MS } = require('./credenciais-publicas');

test('getCredenciaisPublicas: retorna as linhas da RPC', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ nome: 'Anamnese', url_ref: 'https://a' }], error: null });
  const out = await getCredenciaisPublicas();
  assert.deepEqual(out, [{ nome: 'Anamnese', url_ref: 'https://a' }]);
  assert.equal(rpcCalls, 1);
});

test('getCredenciaisPublicas: segunda chamada usa cache (nao bate na RPC)', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ nome: 'X', url_ref: 'https://x' }], error: null });
  await getCredenciaisPublicas();
  await getCredenciaisPublicas();
  assert.equal(rpcCalls, 1, 'RPC chamada uma unica vez dentro do TTL');
});

test('getCredenciaisPublicas: erro da RPC nao lanca — devolve []', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: null, error: { message: 'boom' } });
  const out = await getCredenciaisPublicas();
  assert.deepEqual(out, []);
});

test('getCredenciaisPublicas: excecao da RPC nao lanca — devolve cache stale', async () => {
  _resetCache();
  rpcImpl = async () => ({ data: [{ nome: 'Velho', url_ref: 'https://v' }], error: null });
  await getCredenciaisPublicas();                       // popula cache
  rpcImpl = async () => { throw new Error('rede caiu'); };
  _resetCache({ keepData: true });            // expira o ts, mantem os dados
  const out = await getCredenciaisPublicas();
  assert.deepEqual(out, [{ nome: 'Velho', url_ref: 'https://v' }], 'stale em vez de vazio');
});

test('CACHE_TTL_MS: 30 minutos', () => {
  assert.equal(CACHE_TTL_MS, 30 * 60 * 1000);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test src/services/credenciais-publicas.test.js`
Expected: FAIL — `Cannot find module './credenciais-publicas'`

- [ ] **Step 3: Implementar o serviço**

Criar `src/services/credenciais-publicas.js`. Segue o padrão de cache de `src/services/audio.js:36-52`:

```js
// Links de sistemas do time — única porta de acesso ao dado.
// Lê via RPC get_credenciais_publicas(), que expõe SOMENTE nome e url_ref de linhas
// marcadas visivel_tom=true. Nunca montar query direta em governance_credentials
// aqui: o contrato de colunas mora no schema (migration 20260807_team_links_rpc).

const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache = { ts: 0, links: [] };

function _resetCache(opts = {}) {
  _cache = { ts: 0, links: opts.keepData ? _cache.links : [] };
}

async function getCredenciaisPublicas() {
  if (_cache.links.length && (Date.now() - _cache.ts) < CACHE_TTL_MS) {
    return _cache.links;
  }
  try {
    const supabase = require('../supabase/client'); // lazy: evita init no load (testes)
    const { data, error } = await supabase.rpc('get_credenciais_publicas');
    if (error) {
      console.warn('[CredenciaisPublicas] RPC erro:', error.message);
      return _cache.links; // stale (ou [] se nunca populou)
    }
    const links = (data || []).filter(l => l && l.nome && l.url_ref);
    _cache = { ts: Date.now(), links };
    return links;
  } catch (e) {
    console.warn('[CredenciaisPublicas] fetch falhou:', e.message);
    return _cache.links; // nunca lança — link não pode derrubar a mensagem
  }
}

module.exports = { getCredenciaisPublicas, _resetCache, CACHE_TTL_MS };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test src/services/credenciais-publicas.test.js`
Expected: PASS — 5 testes.

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/services/credenciais-publicas.js`
Expected: sem saída.

- [ ] **Step 6: Commit**

```bash
git add src/services/credenciais-publicas.js src/services/credenciais-publicas.test.js
git commit -m "feat(credenciais-publicas): servico de busca via RPC com cache de 30min"
```

---

### Task 4: Engine — two-pass

**Files:**
- Modify: `src/engine.js:10647` (logo após `let reply = response.text;`)

**Interfaces:**
- Consumes: `hasPedirCredenciaisMarker`, `stripPedirCredenciaisMarker`, `formatCredenciaisBlock` (Task 2); `getCredenciaisPublicas` (Task 3); `ai.chat` (já importado como `ai` na linha 15)
- Produces: nada para tasks seguintes

**Por que exatamente na linha 10647:** substituir `reply` logo após a primeira resposta faz todo o resto do pipeline (parsers de marker, `UNKNOWN_MARKER_STRIPPED` da linha 12697, anti-leak guard, envio) rodar normalmente sobre a resposta final. Inserir depois dos parsers quebraria essa garantia.

**Guard anti-loop:** o prompt da segunda passada **não** contém a instrução do `<<PEDIR_CREDENCIAIS>>`, então o modelo não tem motivo para reemiti-lo. Se ainda assim reemitir, o `UNKNOWN_MARKER_STRIPPED` (linha 12697) já remove o marker do texto — nenhuma terceira chamada acontece, porque esta lógica roda uma única vez, sem laço.

- [ ] **Step 1: Ler o contexto atual antes de editar**

Run: `sed -n '10640,10652p' src/engine.js`
Confirmar que a linha 10647 é `  let reply = response.text;`. Se o número mudou (outra sessão editou o arquivo), localizar com `grep -n "let reply = response.text" src/engine.js` e usar a linha correta.

- [ ] **Step 2: Inserir o bloco two-pass**

Logo **depois** de `let reply = response.text;`, inserir:

```js
  // TWO-PASS <<PEDIR_CREDENCIAIS>> (07/08) — o modelo decide semanticamente que precisa
  // dos links de sistemas e emite o marker; buscamos e re-perguntamos com a lista.
  // É tool-calling dentro do protocolo de markers: --tools/MCP seguem desligados
  // (hardening do Sprint 7, incidente 28/04). Roda ANTES dos parsers pra que a
  // resposta final passe por todo o pipeline normal (strip, anti-leak, envio).
  // Anti-loop: a 2ª chamada não recebe a instrução do marker, e não há laço —
  // se o modelo reemitir mesmo assim, UNKNOWN_MARKER_STRIPPED limpa o texto.
  try {
    const { hasPedirCredenciaisMarker, stripPedirCredenciaisMarker, formatCredenciaisBlock } = require('./lib/pedir-credenciais');
    if (hasPedirCredenciaisMarker(reply)) {
      const { getCredenciaisPublicas } = require('./services/credenciais-publicas');
      const links = await getCredenciaisPublicas();
      const bloco = formatCredenciaisBlock(links);
      console.log(`[PedirCredenciais] marker detectado — ${links.length} link(s) disponivel(is)`);
      await logMarker(collab.id, 'PEDIR_CREDENCIAIS', links.length ? 'applied' : 'rejected',
        `links:${links.length}`, null);
      if (!bloco) {
        reply = 'Não tenho nenhum sistema cadastrado com link por aqui ainda.';
      } else {
        const credSys = `${bloco}\n\nO colaborador perguntou sobre acesso a algum desses sistemas. `
          + `Responda em português, de forma curta e natural, APENAS o link que ele pediu. `
          + `Só liste todos se ele tiver pedido explicitamente a lista completa. `
          + `Não mencione banco de dados, tabela ou qualquer detalhe técnico interno. `
          + `Não emita nenhum marker nesta resposta.`;
        const segunda = await ai.chat(credSys, msgs);
        const textoSegundo = String(segunda?.text || '').trim();
        reply = textoSegundo || bloco;
      }
    }
  } catch (e) {
    // Nunca derruba a mensagem: se o two-pass falhar, segue com o reply original
    // (o marker sobrando será removido pelo UNKNOWN_MARKER_STRIPPED adiante).
    console.warn('[PedirCredenciais] two-pass falhou:', e.message);
  }
```

- [ ] **Step 3: Validar sintaxe**

Run: `node --check src/engine.js`
Expected: sem saída.

- [ ] **Step 4: Rodar a suíte do engine para garantir zero regressão**

Run: `node --test src/lib/*.test.js src/services/*.test.js src/rituals/*.test.js`
Expected: PASS em todos. Se algo quebrar, é regressão desta task — corrigir antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add src/engine.js
git commit -m "feat(credenciais-publicas): two-pass do marker PEDIR_CREDENCIAIS no engine"
```

---

### Task 5: System prompt — instrução do marker

**Files:**
- Modify: `src/prompts/system.js` (~linha 3067, logo após o bloco `# 🇧🇷 LÍNGUA E TOM`)

**Interfaces:**
- Consumes: nada
- Produces: instrução que faz o modelo emitir `<<PEDIR_CREDENCIAIS>>` (consumida pela Task 4)

- [ ] **Step 1: Localizar o ponto de inserção**

Run: `grep -n "Fim do hotfix linguístico" src/prompts/system.js`
A inserção vai imediatamente **depois** dessa linha de comentário.

- [ ] **Step 2: Inserir a instrução**

```js
  // Links de sistemas (07/08) — o modelo decide quando precisa da lista.
  // O engine detecta o marker e faz a 2ª chamada já com os links (two-pass).
  systemPrompt += `\n\n---\n\n# 🔗 LINKS DE SISTEMAS\n\nQuando o colaborador pedir o **link, endereço, site ou acesso** de algum sistema interno (ex: anamnese, CRM, chatwoot, relatórios, ERP) e você não tiver essa informação no contexto acima, responda **apenas** com:\n\n<<PEDIR_CREDENCIAIS>><<END>>\n\nNada além disso — sem texto antes ou depois. A lista será fornecida e você responderá em seguida.\n\nIMPORTANTE — apesar do nome, esse marker devolve **somente o nome do sistema e o endereço (URL)**. Ele NUNCA devolve senha, login, token ou chave de API, e você NUNCA tem acesso a esses dados. Se pedirem senha ou login de algum sistema, responda que isso não fica com você e oriente a procurar o responsável — nunca use esse marker para isso.\n\nNÃO use esse marker para outros assuntos (tarefas, agenda, financeiro). NÃO invente URLs em hipótese alguma: se não tiver o link, use o marker.`;
```

- [ ] **Step 3: Validar sintaxe**

Run: `node --check src/prompts/system.js`
Expected: sem saída.

- [ ] **Step 4: Commit**

```bash
git add src/prompts/system.js
git commit -m "feat(credenciais-publicas): instrucao do marker PEDIR_CREDENCIAIS no system prompt"
```

---

### Task 6: Cadastro inicial, deploy e verificação em produção

**Files:**
- Nenhum arquivo novo. SQL via MCP + deploy via SCP.

**Interfaces:**
- Consumes: tudo das Tasks 1-5
- Produces: feature no ar

- [ ] **Step 1: Marcar as três linhas como visíveis**

Via MCP `execute_sql`:
```sql
update governance_credentials
set visivel_tom = true
where nome in (
  'Anamnese de alunos',
  'Chatwoot — CRM da empresa',
  'LA Performance Report — ERP principal'
)
returning nome, url_ref, visivel_tom;
```
Esperado: exatamente **3 linhas**. Se vier número diferente, os nomes divergiram — conferir antes de seguir.

- [ ] **Step 2: Verificar que a RPC devolve só essas três**

```sql
select * from get_credenciais_publicas();
```
Esperado: 3 linhas, apenas com `nome` e `url_ref`.

- [ ] **Step 3: Confirmar que nenhuma credencial sensível vazou**

```sql
select count(*) as marcadas_indevidamente
from governance_credentials
where visivel_tom = true
  and (jsonb_array_length(coalesce(campos, '[]'::jsonb)) > 0 or categoria = 'api_key');
```
Esperado: `0`. Qualquer valor acima de zero significa que uma credencial com campos/senha foi marcada — **reverter imediatamente** com `update governance_credentials set visivel_tom = false where nome = '<nome>'`.

- [ ] **Step 4: Deploy no VPS**

```bash
scp src/engine.js root@89.116.73.186:/opt/LA-Organizer/src/engine.js
scp src/prompts/system.js root@89.116.73.186:/opt/LA-Organizer/src/prompts/system.js
scp src/lib/pedir-credenciais.js root@89.116.73.186:/opt/LA-Organizer/src/lib/pedir-credenciais.js
scp src/services/credenciais-publicas.js root@89.116.73.186:/opt/LA-Organizer/src/services/credenciais-publicas.js
ssh root@89.116.73.186 "cd /opt/LA-Organizer && node --check src/engine.js && node --check src/prompts/system.js && node --check src/lib/pedir-credenciais.js && node --check src/services/credenciais-publicas.js && pm2 restart tom"
```

Nota: o alias `tom` do `~/.ssh/config` pode não estar configurado neste ambiente — usar o IP direto como acima.

- [ ] **Step 5: Teste end-to-end real**

Pedir ao usuário que mande no WhatsApp do TOM: **"qual o link da anamnese?"**

Esperado: responde com `https://anamnese-la-music.vercel.app/` e **não** lista os outros dois.

Verificar nos logs:
```bash
ssh root@89.116.73.186 "pm2 logs tom --lines 80 --nostream | grep -i 'PedirCredenciais\|UNKNOWN_MARKER'"
```
Esperado: linha `[PedirCredenciais] marker detectado — 3 link(s) disponivel(is)`, e **nenhum** `UNKNOWN_MARKER_STRIPPED` com `PEDIR_CREDENCIAIS`.

- [ ] **Step 6: Teste de não-regressão conversacional**

Pedir ao usuário que mande algo sem relação: **"o que eu tenho pra hoje?"**

Esperado: responde as tarefas normalmente, e os logs **não** mostram `[PedirCredenciais]` (sem segunda chamada, sem latência extra).

- [ ] **Step 7: Commit e push final**

```bash
git add -A
git commit -m "feat(credenciais-publicas): cadastro inicial dos 3 sistemas + deploy"
git push origin main
```

- [ ] **Step 8: Registrar no daily-notes**

Acrescentar seção em `daily-notes/2026-08-07.md` (não sobrescrever o que já está lá) com: o que foi implementado, os resultados dos testes E2E dos Steps 5 e 6, e a pendência de observação abaixo.

**👁️ OBSERVAR:** o TOM tem falha conhecida de **não emitir markers** quando deveria (é o check `actionable_no_marker` do health report diário). Se ele esquecer o `<<PEDIR_CREDENCIAIS>>`, vai responder que não sabe o link em vez de buscar.
- **Sinal de sucesso:** perguntas sobre link resultam em `[PedirCredenciais] marker detectado` nos logs.
- **Sinal de fracasso:** TOM responde "não tenho essa informação" para pergunta clara sobre link, sem log de `[PedirCredenciais]`.
- **Query pronta:** `select created_at, status, detail from marker_logs where marker_type = 'PEDIR_CREDENCIAIS' order by created_at desc limit 20;`
- **Concluir após:** no mínimo 5 perguntas reais sobre links. Não decidir com 1 ou 2.

---

## Self-Review

**Cobertura do spec:**

| Requisito do spec | Task |
|---|---|
| Coluna `visivel_tom` default false | 1 |
| RPC com contrato de 2 colunas | 1 |
| `revoke` da anon key | 1 (Steps 1 e 5) |
| Serviço com cache 30min | 3 |
| Degradação sem lançar | 3 (Steps 1, 3) |
| Cap de 30 itens | 2 |
| Marker `<<PEDIR_CREDENCIAIS>>` | 2, 5 |
| Two-pass no engine | 4 |
| Guard anti-loop | 4 (sem laço + prompt da 2ª passada sem a instrução + `UNKNOWN_MARKER_STRIPPED`) |
| Resposta seletiva (só o link pedido) | 4 (prompt da 2ª passada), verificado em 6 Step 5 |
| Degradação com lista vazia | 4 |
| Cadastro das 3 linhas | 6 Step 1 |
| Critério "nenhuma credencial com flag false aparece" | 6 Steps 2, 3 |

**Consistência de tipos:** `getCredenciaisPublicas()` devolve `Array<{nome, url_ref}>`, que é exatamente o que `formatCredenciaisBlock()` consome (Task 2 define, Task 4 usa). `hasPedirCredenciaisMarker`/`stripPedirCredenciaisMarker`/`formatCredenciaisBlock` têm os mesmos nomes na definição (Task 2) e no uso (Task 4).

**Nota:** `stripPedirCredenciaisMarker` é exportado e testado, mas o engine não o usa no caminho feliz — a resposta da segunda passada substitui o `reply` inteiro. Ele fica disponível como utilitário e é coberto pelo `UNKNOWN_MARKER_STRIPPED` no caminho de falha. Mantido de propósito, não é sobra acidental.
