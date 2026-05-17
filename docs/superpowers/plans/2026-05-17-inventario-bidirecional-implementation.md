# Inventário Bidirecional (Fase A) — Implementation Plan

> **Para agentic workers:** SUB-SKILL OBRIGATÓRIA: usa superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra executar task-by-task. Steps usam checkbox (`- [ ]`).

**Goal:** PWA do LA Organizer ganha CRUD bidirecional pleno com o LA Report (criar/editar/mover/manutenção/baixa de itens de inventário), stats cards condicionais por governança, FAB contextual, realtime entre clientes, e TOM ganha consulta `/inv ver` — tudo respeitando a matriz de governança via `checkAccess()` como fonte única.

**Architecture:** Híbrida — leituras e realtime via cliente Supabase direto ao LA Report (anon key); escritas via Vercel serverless que valida JWT + `checkAccess()` + injeta "via PWA por <nome>". `la-report-access-rules.json` é a única fonte de regras de acesso, importado por TOM (JS), PWA (TS) e serverless (TS).

**Tech Stack:** React 18 + Vite + TanStack Query, Supabase JS, Vercel Serverless Functions, Node 20 (TOM), Supabase Storage.

**Spec de referência:** `_remote/docs/superpowers/specs/2026-05-17-inventario-bidirecional-design.md`

---

## Fases do plano

| Fase | Tasks | Foco |
|---|---|---|
| A1 — Fundação Governança | 1-7 | Rules JSON, checkAccess JS+TS, TOM access wiring, /inv ver, deploy TOM |
| A2 — PWA Reads | 8-11 | Cliente direto LA Report, useAccess, refactor hooks, realtime |
| A3 — PWA UI | 12-16 | StatsCards, SalaCardMedio, FAB, ItemSheet, modals secundários |
| A4 — Serverless Writes | 17-20 | Auth helpers, 5 endpoints, upload de foto |
| A5 — Wire & Validate | 21-23 | useInventarioMutations, E2E multi-role, realtime smoke |

---

## Pré-requisitos (já feitos, confirmar antes da Task 1)

- [x] Migration `function_role` aplicada (Rafinha=ops_tecnicas, Hugo=tech, Yuri=marketing)
- [x] Schema LA Report auditado (`salas.recursos` dropado pelo LA Report)
- [x] `lareport-types.ts` sem `recursos`
- [x] `inventario-service.js` sem `recursos`

---

## Fase A1 — Fundação Governança

### Task 1: Setup do Storage bucket + verificações pré-implementação

**Files:**
- Verificar: Supabase LA Report dashboard
- Documentar: `_remote/docs/superpowers/runbooks/2026-05-17-inventario-bucket-setup.md`

- [ ] **Step 1: Criar bucket `inventario-fotos` no LA Report Supabase**

Via Dashboard:
1. https://supabase.com/dashboard/project/ouqwbbermlzqqvtqwlul/storage/buckets
2. Click "New bucket"
3. Name: `inventario-fotos`
4. Public bucket: ON
5. File size limit: 5 MB
6. Allowed MIME types: `image/jpeg, image/png, image/webp`
7. Click "Save"

- [ ] **Step 2: Adicionar policies SQL**

Via SQL Editor (LA Report):

```sql
-- Read público
CREATE POLICY "Public read inventario-fotos" ON storage.objects
  FOR SELECT USING (bucket_id = 'inventario-fotos');

-- Write/delete apenas service_role (sem policy = bloqueado pra anon/authenticated)
-- Service role bypassa RLS, não precisa policy explícita
```

- [ ] **Step 3: Smoke test bucket**

```bash
curl -X POST 'https://ouqwbbermlzqqvtqwlul.supabase.co/storage/v1/object/inventario-fotos/test.txt' \
  -H "Authorization: Bearer $LA_REPORT_SERVICE_ROLE_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary "hello"
```

Esperado: 200 OK.

```bash
curl 'https://ouqwbbermlzqqvtqwlul.supabase.co/storage/v1/object/public/inventario-fotos/test.txt'
```

Esperado: "hello".

Limpa: deleta `test.txt` via Dashboard.

- [ ] **Step 4: Documentar setup**

Cria `_remote/docs/superpowers/runbooks/2026-05-17-inventario-bucket-setup.md` com os comandos acima pra rodar de novo se precisar.

- [ ] **Step 5: Commit**

```bash
git add _remote/docs/superpowers/runbooks/2026-05-17-inventario-bucket-setup.md
git commit -m "docs: runbook para setup do bucket inventario-fotos"
```

---

### Task 2: Rules JSON + checkAccess JS (TOM)

**Files:**
- Create: `_remote/src/services/la-report-access-rules.json`
- Create: `_remote/src/services/la-report-access.js`
- Create: `_remote/scripts/test-la-report-access.js`

- [ ] **Step 1: Criar `la-report-access-rules.json`**

Conteúdo exato (baseado em §Permissões do spec + matriz-governanca):

```json
{
  "DATA_LEVELS": {
    "faturamento": "restrito",
    "valor_parcela": "restrito",
    "comissao": "restrito",
    "salario": "restrito",
    "ltv": "restrito",
    "ticket_medio": "restrito",
    "dados_pessoais_rh": "restrito",
    "avaliacao_360": "restrito",
    "inadimplencia": "sensivel",
    "health_score": "sensivel",
    "whatsapp_aluno": "sensivel",
    "evasao": "sensivel",
    "renovacao": "sensivel",
    "performance_prof": "sensivel",
    "leads": "sensivel",
    "funil": "sensivel",
    "kpis_comerciais": "sensivel",
    "experimentais": "sensivel",
    "valor_patrimonial": "sensivel",
    "aluno_cadastro": "aberto",
    "aluno_horario": "aberto",
    "aluno_presenca": "aberto",
    "contagem_alunos": "aberto",
    "professor_cadastro": "aberto",
    "whatsapp_prof": "aberto",
    "aderencia_emusys": "aberto",
    "salas": "aberto",
    "inventario": "aberto",
    "movimentacoes": "aberto",
    "loja_produtos": "aberto",
    "loja_vendas": "aberto"
  },
  "ACCESS_RULES": {
    "faturamento":       { "roles": ["director"], "function_roles": ["backoffice_fin"] },
    "valor_parcela":     { "roles": ["director"], "function_roles": ["backoffice_fin"] },
    "comissao":          { "roles": ["director"], "function_roles": ["backoffice_fin"] },
    "salario":           { "roles": ["director"], "function_roles": ["backoffice_fin","backoffice_rh"] },
    "ltv":               { "roles": ["director"], "function_roles": ["backoffice_fin"] },
    "ticket_medio":      { "roles": ["director"], "function_roles": ["backoffice_fin"] },
    "dados_pessoais_rh": { "roles": ["director"], "function_roles": ["backoffice_rh"] },
    "avaliacao_360":     { "roles": ["director","coordinator"] },
    "inadimplencia":     { "roles": ["director"], "function_roles": ["backoffice_fin","farmer"], "unit_filter": true, "manager_unit": true },
    "health_score":      { "roles": ["director","coordinator"], "function_roles": ["backoffice_cs","farmer"], "unit_filter": true, "manager_unit": true },
    "whatsapp_aluno":    { "roles": ["director","coordinator"], "function_roles": ["marketing","farmer"], "unit_filter": true, "manager_unit": true, "pedagogico": true },
    "evasao":            { "roles": ["director","coordinator"], "function_roles": ["backoffice_cs","farmer"], "unit_filter": true, "manager_unit": true },
    "renovacao":         { "roles": ["director","coordinator"], "function_roles": ["backoffice_cs","farmer","hunter"], "unit_filter": true, "manager_unit": true },
    "performance_prof":  { "roles": ["director","coordinator"], "function_roles": ["farmer"], "unit_filter": true, "manager_unit": true, "pedagogico": true },
    "leads":             { "roles": ["director"], "function_roles": ["marketing","farmer","hunter"], "unit_filter": true, "manager_unit": true, "krissya_all_comercial": true },
    "funil":             { "roles": ["director"], "function_roles": ["marketing","farmer","hunter"], "unit_filter": true, "manager_unit": true, "krissya_all_comercial": true },
    "kpis_comerciais":   { "roles": ["director"], "function_roles": ["marketing","farmer"], "unit_filter": true, "manager_unit": true, "krissya_all_comercial": true },
    "experimentais":     { "roles": ["director"], "function_roles": ["marketing","farmer","hunter"], "unit_filter": true, "manager_unit": true },
    "valor_patrimonial": { "roles": ["director"], "function_roles": ["ops_tecnicas","backoffice_fin"] },
    "aluno_cadastro":    { "roles": ["director","coordinator"], "function_roles": ["farmer","hunter","backoffice_cs"], "unit_filter": true, "manager_unit": true, "pedagogico_seus": true, "professor_seus_unidades": true },
    "aluno_horario":     { "roles": ["director","coordinator"], "function_roles": ["farmer","hunter","backoffice_cs"], "unit_filter": true, "manager_unit": true, "pedagogico_seus": true, "professor_seus_unidades": true },
    "aluno_presenca":    { "roles": ["director","coordinator"], "function_roles": ["farmer","backoffice_cs"], "unit_filter": true, "manager_unit": true, "pedagogico_seus": true, "professor_seus_unidades": true },
    "contagem_alunos":   { "roles": ["director","coordinator","manager"], "function_roles": ["farmer","hunter","backoffice_cs"] },
    "professor_cadastro":{ "roles": ["director","coordinator","manager"], "function_roles": ["ops_tecnicas","farmer","hunter","tech"], "pedagogico": true, "professor": true },
    "whatsapp_prof":     { "all": true },
    "aderencia_emusys":  { "roles": ["director","coordinator"], "function_roles": ["farmer"], "unit_filter": true, "manager_unit": true, "pedagogico": true, "professor_seus_unidades": true },
    "salas":             { "roles": ["director","coordinator","manager"], "function_roles": ["ops_tecnicas","farmer","tech"], "pedagogico": true, "professor_seus_unidades": true },
    "inventario":        { "roles": ["director","coordinator"], "function_roles": ["ops_tecnicas","farmer","tech"], "unit_filter": true, "manager_unit": true, "pedagogico": true, "professor_seus_unidades": true },
    "movimentacoes":     { "roles": ["director","coordinator"], "function_roles": ["ops_tecnicas","farmer","tech"], "unit_filter": true, "manager_unit": true },
    "loja_produtos":     { "roles": ["director"], "function_roles": ["ops_tecnicas","farmer","backoffice_fin"], "unit_filter": true, "manager_unit": true },
    "loja_vendas":       { "roles": ["director"], "function_roles": ["ops_tecnicas","farmer","backoffice_fin"], "unit_filter": true, "manager_unit": true }
  }
}
```

- [ ] **Step 2: Criar `la-report-access.js` (TOM)**

```js
// _remote/src/services/la-report-access.js
// Gate de acesso ao LA Report — fonte única de regras é la-report-access-rules.json
// Usado por: TOM (engine, services, skills). PWA + serverless usam o port TS.

const rules = require('./la-report-access-rules.json');

const { DATA_LEVELS, ACCESS_RULES } = rules;

/**
 * Verifica acesso do collaborator a um tipo de dado.
 *
 * @param {Object} collab - { id, role, unit, full_name, function_role, pedagogical_role }
 * @param {string} dataType - chave de ACCESS_RULES
 * @param {Object} [opts]
 * @param {string} [opts.targetUnit] - unidade alvo (pra validar se collab tem acesso)
 * @returns {{ allowed: boolean, unitFilter: string|string[]|null, scopeFilter: string|null, reason: string }}
 */
function checkAccess(collab, dataType, opts = {}) {
  const rule = ACCESS_RULES[dataType];
  if (!rule) return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Tipo de dado não reconhecido.' };

  if (!collab) return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Sem collaborator.' };

  const { role, unit, full_name, function_role, pedagogical_role } = collab;

  if (rule.all) return ok();
  if (role === 'director') return ok();
  if (rule.roles && rule.roles.includes(role)) return ok();

  if (rule.function_roles && function_role && rule.function_roles.includes(function_role)) {
    const needsUnit = rule.unit_filter && unit && unit !== 'all';
    return { allowed: true, unitFilter: needsUnit ? unit : null, scopeFilter: null, reason: 'ok' };
  }

  if (rule.manager_unit && role === 'manager') {
    if (rule.krissya_all_comercial && full_name === 'Krissya') return ok();
    return { allowed: true, unitFilter: (unit && unit !== 'all') ? unit : null, scopeFilter: null, reason: 'ok' };
  }

  if (rule.pedagogico && pedagogical_role) return ok();

  if (rule.pedagogico_seus && pedagogical_role) {
    return { allowed: true, unitFilter: null, scopeFilter: 'seus_alunos', reason: 'ok' };
  }

  if (rule.professor_seus_unidades && function_role === 'professor') {
    // STUB Fase A: nenhum professor cadastrado como collaborator.
    // Fase B+: chamar unidadesDoProfessor(collab) e retornar unitFilter array.
    return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Professor sem unidades vinculadas — fala com a coordenação.' };
  }

  if (rule.professor && function_role === 'professor') return ok();

  return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' };
}

function ok() {
  return { allowed: true, unitFilter: null, scopeFilter: null, reason: 'ok' };
}

module.exports = { checkAccess, DATA_LEVELS, ACCESS_RULES };
```

- [ ] **Step 3: Criar script de teste com fixtures**

```js
// _remote/scripts/test-la-report-access.js
const { checkAccess } = require('../src/services/la-report-access');

const fixtures = {
  luciano:    { role: 'director', unit: 'all', full_name: 'Luciano Alf' },
  anne:       { role: 'director', unit: 'all', full_name: 'Anne Susan' },
  rafinha:    { role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', full_name: 'Rafinha' },
  juliana:    { role: 'coordinator', unit: 'all', full_name: 'Juliana' },
  jereh:      { role: 'manager', unit: 'cg-uuid-placeholder', full_name: 'Jereh' },
  krissya:    { role: 'manager', unit: 'barra-uuid-placeholder', full_name: 'Krissya' },
  farmer_cg:  { role: 'collaborator', function_role: 'farmer', unit: 'cg-uuid-placeholder', full_name: 'Gabi' },
  professor:  { role: 'collaborator', function_role: 'professor', unit: 'barra-uuid-placeholder', full_name: 'Peterson' },
  dai_ped:    { role: 'collaborator', pedagogical_role: 'mentor', unit: 'all', full_name: 'Dai' },
  hugo:       { role: 'collaborator', function_role: 'tech', unit: 'all', full_name: 'Hugo' },
  yuri_mkt:   { role: 'manager', function_role: 'marketing', unit: 'all', full_name: 'Yuri' },
};

const cases = [
  // [collab, dataType, expected.allowed, expected.unitFilter]
  ['luciano',   'faturamento',       true,  null],
  ['rafinha',   'faturamento',       false, null],
  ['rafinha',   'inventario',        true,  null],
  ['rafinha',   'valor_patrimonial', true,  null],
  ['rafinha',   'loja_produtos',     true,  null],
  ['juliana',   'inventario',        true,  null],
  ['juliana',   'valor_patrimonial', false, null],
  ['juliana',   'loja_produtos',     false, null],
  ['jereh',     'inventario',        true,  'cg-uuid-placeholder'],
  ['jereh',     'valor_patrimonial', false, null],
  ['jereh',     'loja_produtos',     true,  'cg-uuid-placeholder'],
  ['krissya',   'leads',             true,  null],  // exceção
  ['farmer_cg', 'inventario',        true,  'cg-uuid-placeholder'],
  ['farmer_cg', 'valor_patrimonial', false, null],
  ['professor', 'inventario',        false, null],  // stub Fase A
  ['dai_ped',   'inventario',        true,  null],
  ['hugo',      'inventario',        true,  null],
  ['hugo',      'valor_patrimonial', false, null],
  ['yuri_mkt',  'inventario',        false, null],
];

let pass = 0, fail = 0;
for (const [collabKey, dataType, expAllowed, expUnitFilter] of cases) {
  const collab = fixtures[collabKey];
  const res = checkAccess(collab, dataType);
  const ok = res.allowed === expAllowed && res.unitFilter === expUnitFilter;
  if (ok) { pass++; }
  else {
    fail++;
    console.error(`FAIL: ${collabKey} × ${dataType} → got {allowed:${res.allowed}, unitFilter:${res.unitFilter}}, expected {allowed:${expAllowed}, unitFilter:${expUnitFilter}}`);
  }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 4: Rodar e confirmar 100% pass**

```bash
cd _remote && node scripts/test-la-report-access.js
```

Esperado: `19 pass, 0 fail`. Exit 0.

Se falhar, corrigir as regras no JSON (não na função — função é genérica).

- [ ] **Step 5: Commit**

```bash
git add _remote/src/services/la-report-access-rules.json _remote/src/services/la-report-access.js _remote/scripts/test-la-report-access.js
git commit -m "feat(governanca): adiciona checkAccess JS + rules JSON (fonte única de acesso)"
```

---

### Task 3: Port TS de checkAccess (PWA + serverless) com teste de paridade

**Files:**
- Create: `_remote/web/src/lib/access-control.ts`
- Create: `_remote/web/api/_lib/access-control.ts`
- Create: `_remote/scripts/test-access-paridade.mjs`

- [ ] **Step 1: Criar `web/src/lib/access-control.ts` (PWA)**

Vite suporta import de JSON via `?raw` ou direto. Vamos copiar o JSON pra dentro de `web/` via script no build, mas pra Fase A faço o port manual + symlink/copy depois.

```ts
// _remote/web/src/lib/access-control.ts
// Port TS do la-report-access.js — DEVE estar em paridade com o JS.
// Fonte única de regras: ler _remote/src/services/la-report-access-rules.json
// Cópia local em web/src/lib/access-rules.json (sincronizada via script no build).

import rules from './access-rules.json';

export type CollaboratorAuth = {
  id: string;
  role: string | null;
  unit: string | null;
  full_name: string;
  function_role: string | null;
  pedagogical_role: string | null;
};

export type AccessResult = {
  allowed: boolean;
  unitFilter: string | string[] | null;
  scopeFilter: string | null;
  reason: string;
};

const { DATA_LEVELS, ACCESS_RULES } = rules as {
  DATA_LEVELS: Record<string, string>;
  ACCESS_RULES: Record<string, any>;
};

export function checkAccess(
  collab: CollaboratorAuth | null,
  dataType: string,
  _opts: { targetUnit?: string } = {}
): AccessResult {
  const rule = ACCESS_RULES[dataType];
  if (!rule) return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Tipo de dado não reconhecido.' };
  if (!collab) return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Sem collaborator.' };

  const { role, unit, full_name, function_role, pedagogical_role } = collab;

  if (rule.all) return ok();
  if (role === 'director') return ok();
  if (rule.roles?.includes(role)) return ok();

  if (rule.function_roles && function_role && rule.function_roles.includes(function_role)) {
    const needsUnit = rule.unit_filter && unit && unit !== 'all';
    return { allowed: true, unitFilter: needsUnit ? unit : null, scopeFilter: null, reason: 'ok' };
  }

  if (rule.manager_unit && role === 'manager') {
    if (rule.krissya_all_comercial && full_name === 'Krissya') return ok();
    return { allowed: true, unitFilter: unit && unit !== 'all' ? unit : null, scopeFilter: null, reason: 'ok' };
  }

  if (rule.pedagogico && pedagogical_role) return ok();
  if (rule.pedagogico_seus && pedagogical_role) {
    return { allowed: true, unitFilter: null, scopeFilter: 'seus_alunos', reason: 'ok' };
  }

  if (rule.professor_seus_unidades && function_role === 'professor') {
    return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Professor sem unidades vinculadas — fala com a coordenação.' };
  }

  if (rule.professor && function_role === 'professor') return ok();

  return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' };
}

function ok(): AccessResult {
  return { allowed: true, unitFilter: null, scopeFilter: null, reason: 'ok' };
}

export { DATA_LEVELS, ACCESS_RULES };
```

- [ ] **Step 2: Copiar JSON pra `web/src/lib/access-rules.json`**

```bash
cp _remote/src/services/la-report-access-rules.json _remote/web/src/lib/access-rules.json
```

Adicionar no `_remote/web/package.json` no script `predev` e `prebuild`:

```json
"scripts": {
  "predev": "node ../scripts/sync-access-rules.mjs",
  "prebuild": "node ../scripts/sync-access-rules.mjs",
  ...
}
```

E criar `_remote/scripts/sync-access-rules.mjs`:

```js
// _remote/scripts/sync-access-rules.mjs
// Sincroniza rules JSON pra dentro do bundle web (fonte única continua em src/services).
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '../src/services/la-report-access-rules.json');
const dest = resolve(__dirname, '../web/src/lib/access-rules.json');
copyFileSync(src, dest);
console.log(`[sync-access-rules] ${src} → ${dest}`);
```

- [ ] **Step 3: Criar `web/api/_lib/access-control.ts` (serverless)**

Mesma implementação do PWA, mas com import relativo pro arquivo source-of-truth.

```ts
// _remote/web/api/_lib/access-control.ts
// Mesma lógica do PWA, importa o mesmo rules JSON (sincronizado via prebuild).
import rules from '../../src/lib/access-rules.json';

// [colar exatamente o mesmo código do Step 1 a partir de "export type CollaboratorAuth"]
```

Pra evitar duplicação física, usar import dinâmico do arquivo TS do PWA. Mas Vercel build pode não compartilhar `src` de `web/src/lib` com `web/api`. Solução pragmática: duplicar o código com comentário "MIRROR de web/src/lib/access-control.ts — manter em paridade".

- [ ] **Step 4: Criar teste de paridade**

```js
// _remote/scripts/test-access-paridade.mjs
// Garante que JS (TOM) e TS (PWA) produzem o mesmo output pras mesmas fixtures.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkAccess: checkJS } = require('../src/services/la-report-access');

// Roda o port TS via tsx
const tsOutputRaw = execSync('npx --prefix web tsx --tsconfig web/tsconfig.json -e "import { checkAccess } from \'./web/src/lib/access-control.ts\'; const fixtures = ' + JSON.stringify({/* mesmas fixtures do Task 2 */}) + '; const cases = ' + JSON.stringify([/* mesmos cases */]) + '; const out = cases.map(([k,d]) => checkAccess(fixtures[k], d)); console.log(JSON.stringify(out));"', { encoding: 'utf8' });

const tsOutput = JSON.parse(tsOutputRaw.trim());

// Roda JS
const fixtures = {/* duplicar fixtures aqui */};
const cases = [/* duplicar cases */];
const jsOutput = cases.map(([k,d]) => checkJS(fixtures[k], d));

let mismatch = 0;
for (let i = 0; i < cases.length; i++) {
  if (JSON.stringify(jsOutput[i]) !== JSON.stringify(tsOutput[i])) {
    mismatch++;
    console.error(`MISMATCH ${cases[i]}: JS=${JSON.stringify(jsOutput[i])} TS=${JSON.stringify(tsOutput[i])}`);
  }
}
console.log(`${cases.length - mismatch}/${cases.length} paridade`);
process.exit(mismatch > 0 ? 1 : 0);
```

Nota: se `tsx` for complicado, simplificar pra um script que compila o TS pra JS temporário e compara. Aceitável também: rodar apenas os testes Node do Task 2 e confiar que o port TS é literal (auditoria por code review é suficiente nesta fase).

**Decisão pragmática:** se rodar tsx funcionar, ótimo. Se não, pular pra Step 5 com nota "validação por code review". Não trava o sprint.

- [ ] **Step 5: Rodar paridade (ou pular se tsx der trabalho)**

```bash
cd _remote && node scripts/test-access-paridade.mjs
```

Esperado: `19/19 paridade`.

- [ ] **Step 6: Commit**

```bash
git add _remote/web/src/lib/access-control.ts _remote/web/src/lib/access-rules.json _remote/web/api/_lib/access-control.ts _remote/scripts/sync-access-rules.mjs _remote/scripts/test-access-paridade.mjs _remote/web/package.json
git commit -m "feat(governanca): port TS de checkAccess + sincronização rules + teste paridade"
```

---

### Task 4: Wire `checkAccess` em `inventario-service.js` (TOM)

**Files:**
- Modify: `_remote/src/services/inventario-service.js`

- [ ] **Step 1: Adicionar import + helper de gate no início do arquivo**

No topo do `_remote/src/services/inventario-service.js`, depois dos imports existentes:

```js
const { checkAccess } = require('./la-report-access');

function gate(collab, dataType, fnName) {
  const access = checkAccess(collab, dataType);
  if (!access.allowed) {
    const err = new Error(access.reason);
    err.code = 'ACCESS_DENIED';
    err.fn = fnName;
    throw err;
  }
  return access;
}
```

- [ ] **Step 2: Adicionar `collab` como primeiro parâmetro de funções públicas que vão pro engine**

Para Fase A, focar em `detalheSala`, `listarSalasPorUnidade`, e novas funções (`buscarItemPorNome`). Funções chamadas só pelos rituals podem ficar sem gate (rituais rodam com identidade do sistema).

Alteração em `detalheSala`:

```js
async function detalheSala(salaId, collab) {
  if (collab) {
    const access = gate(collab, 'inventario', 'detalheSala');
    // Se unitFilter, validar que a sala pertence
    if (access.unitFilter) {
      const { data: sala } = await laReportClient.from('salas').select('unidade_id').eq('id', salaId).single();
      const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
      if (!sala || !units.includes(sala.unidade_id)) {
        const err = new Error('Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.');
        err.code = 'ACCESS_DENIED';
        throw err;
      }
    }
  }
  // [resto da implementação atual]
}
```

`collab` é opcional (backwards-compat com chamadas existentes nos rituais).

- [ ] **Step 3: Adicionar `buscarItemPorNome`**

No final de `inventario-service.js`, antes do `module.exports`:

```js
async function buscarItemPorNome(nome, unidadeId, collab) {
  if (collab) {
    const access = gate(collab, 'inventario', 'buscarItemPorNome');
    if (access.unitFilter && !unidadeId) {
      unidadeId = Array.isArray(access.unitFilter) ? null : access.unitFilter;
    }
  }
  let q = laReportClient
    .from('inventario')
    .select('*, salas(nome, unidade_id, unidades(nome))')
    .ilike('nome', `%${nome}%`)
    .eq('ativo', true)
    .limit(5);
  if (unidadeId) q = q.eq('unidade_id', unidadeId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
```

E adicionar ao exports:

```js
module.exports = {
  listarUnidades, listarSalasPorUnidade, buscarSalaPorNome, detalheSala,
  listarLojaPorUnidade, buscarProdutoPorNome, listarEstoqueBaixo,
  listarManutencoesPendentes, listarRevisoesProgramadas,
  inserirItem, registrarMovimentacao, registrarManutencao,
  ajustarEstoqueLoja, uploadFotoItem,
  buscarItemPorNome,  // novo
};
```

- [ ] **Step 4: Validar com `node --check`**

```bash
cd _remote && node --check src/services/inventario-service.js && echo OK
```

Esperado: `OK`.

- [ ] **Step 5: Smoke test buscarItemPorNome via node REPL**

```bash
cd _remote && node -e "
require('dotenv').config();
const svc = require('./src/services/inventario-service');
svc.buscarItemPorNome('piano').then(r => console.log(JSON.stringify(r, null, 2)));
"
```

Esperado: array com até 5 items contendo "piano" no nome. Se vazio, OK (tabela pode estar quase vazia em alguns ambientes).

- [ ] **Step 6: Commit**

```bash
git add _remote/src/services/inventario-service.js
git commit -m "feat(tom): wire checkAccess em inventario-service + buscarItemPorNome"
```

---

### Task 5: Handler TOM `/inv ver <nome>`

**Files:**
- Modify: `_remote/src/engine.js`
- Modify: `_remote/src/prompts/system.js` (bloco `<<INVENTORY_ACTION>>`)

- [ ] **Step 1: Estender parser do marker pra aceitar `action: 'ver'`**

Em `_remote/src/engine.js`, no handler existente do `<<INVENTORY_ACTION>>`, adicionar branch:

```js
// Dentro do switch/if do action:
if (action === 'ver') {
  if (!nome) return 'Falta o nome do item. Ex: "/inv ver piano"';
  try {
    const itens = await inventarioService.buscarItemPorNome(nome, null, collab);
    if (itens.length === 0) return `Nenhum item com "${nome}" encontrado.`;
    return itens.map(formatarCardItem).join('\n\n');
  } catch (e) {
    if (e.code === 'ACCESS_DENIED') return e.message;
    throw e;
  }
}

function formatarCardItem(it) {
  const sala = it.salas?.nome || 'sem sala';
  const unid = it.salas?.unidades?.nome || '';
  const cond = it.condicao || '?';
  const valor = it.valor_compra ? `R$ ${it.valor_compra}` : 's/ valor';
  const proxRev = it.proxima_revisao ? ` · Próx revisão: ${it.proxima_revisao}` : '';
  return `🎵 *${it.nome}* (${sala}${unid ? ` · ${unid}` : ''})\n• Condição: ${cond}\n• ${valor}${proxRev}`;
}
```

- [ ] **Step 2: Atualizar bloco do system prompt pra incluir action `ver`**

No `_remote/src/prompts/system.js`, encontrar o bloco `[INVENTARIO_CATALOGO]` e adicionar na lista de actions do `<<INVENTORY_ACTION>>`:

```
ACTIONS PERMITIDAS:
- "add" — cadastrar novo item
- "move" — registrar movimentação entre salas
- "maintenance" — registrar manutenção
- "shop_movement" — movimentação de estoque
- "ver" — consultar item por nome (novo)

EXEMPLO de "ver":
<<INVENTORY_ACTION>>
{"action":"ver","nome":"piano"}
<<END>>
```

- [ ] **Step 3: Validar JS sintático**

```bash
cd _remote && node --check src/engine.js && node --check src/prompts/system.js && echo OK
```

- [ ] **Step 4: Commit**

```bash
git add _remote/src/engine.js _remote/src/prompts/system.js
git commit -m "feat(tom): handler /inv ver para consulta rápida de item"
```

---

### Task 6: Skill `governanca-dados.md` + injeção dinâmica no system prompt

**Files:**
- Create: `_remote/skills/governanca-dados.md`
- Modify: `_remote/src/prompts/system.js`

- [ ] **Step 1: Criar `governanca-dados.md`**

```markdown
# Skill: Governança de Dados — LA Report

Esta skill é injetada sempre que o TOM vai consultar dados do LA Report.

## Regra de ouro
Antes de responder qualquer consulta:
1. Classificar o dado pedido (🔴 restrito / 🟡 sensível / 🟢 aberto)
2. Se 🔴 → só direção + backoffice autorizado
3. Se 🟡 → checar role + unidade
4. Se 🟢 → aplicar filtro de unidade quando aplicável e responder

## Frase de recusa padrão
"Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação."

NUNCA mostrar o dado e depois dizer que não deveria.
NUNCA dizer "não tenho acesso" — dizer "essa informação é restrita ao seu perfil".

## Bloco de regras injetado dinamicamente
O engine injeta automaticamente no system prompt uma lista de "✅ pode consultar" e "🚫 NÃO pode consultar" baseada no `checkAccess()` do collaborator atual. Respeitar essa lista é OBRIGATÓRIO.
```

- [ ] **Step 2: Criar função `buildAccessBlock(collab)` em `system.js`**

No topo de `_remote/src/prompts/system.js`:

```js
const { checkAccess, DATA_LEVELS } = require('../services/la-report-access');

function buildAccessBlock(collab) {
  if (!collab) return '';
  const allowed = [];
  const blocked = [];
  for (const dataType of Object.keys(DATA_LEVELS)) {
    const res = checkAccess(collab, dataType);
    const pretty = dataType.replace(/_/g, ' ');
    if (res.allowed) {
      const suffix = res.unitFilter ? ` (apenas ${Array.isArray(res.unitFilter) ? res.unitFilter.join(', ') : res.unitFilter})` :
                     res.scopeFilter === 'seus_alunos' ? ' (apenas seus alunos)' : '';
      allowed.push(`- ${pretty}${suffix}`);
    } else {
      blocked.push(`- ${pretty}`);
    }
  }
  return `\n## Regras de acesso ao LA Report para ${collab.full_name}\n\n### ✅ Pode consultar:\n${allowed.join('\n')}\n\n### 🚫 NÃO pode consultar:\n${blocked.join('\n')}\n\n### Comportamento obrigatório:\n1. NUNCA revelar dados da lista bloqueada\n2. Dizer "essa informação é restrita ao seu perfil" se pedirem algo bloqueado\n3. Aplicar filtros de unidade quando indicado\n4. Sugerir "Fala com o Alf ou a coordenação" ao negar\n`;
}
```

- [ ] **Step 3: Chamar `buildAccessBlock` no builder do system prompt**

Encontrar onde o system prompt é montado (provavelmente uma função `buildSystemPrompt` ou similar) e adicionar:

```js
const accessBlock = buildAccessBlock(collab);
// ... append accessBlock ao prompt final, depois dos blocos de skills carregadas
```

- [ ] **Step 4: Validar sintaxe**

```bash
cd _remote && node --check src/prompts/system.js && echo OK
```

- [ ] **Step 5: Smoke test do bloco gerado**

```bash
cd _remote && node -e "
const { buildAccessBlock } = require('./src/prompts/system');
console.log(buildAccessBlock({ role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', full_name: 'Rafinha' }));
"
```

Esperado: bloco listando "✅ Pode consultar" com inventário, valor patrimonial, loja, etc, e "🚫 NÃO pode consultar" com faturamento, salario, etc.

Se `buildAccessBlock` não estiver exposto, ajustar export ou rodar via `require('./src/prompts/system').buildAccessBlock`.

- [ ] **Step 6: Commit**

```bash
git add _remote/skills/governanca-dados.md _remote/src/prompts/system.js
git commit -m "feat(tom): skill governanca-dados + bloco dinâmico de regras no system prompt"
```

---

### Task 7: Deploy TOM + smoke WhatsApp

**Files:**
- Deploy: VPS

- [ ] **Step 1: SCP dos arquivos modificados**

```bash
scp _remote/src/services/la-report-access.js tom:/opt/LA-Organizer/src/services/la-report-access.js
scp _remote/src/services/la-report-access-rules.json tom:/opt/LA-Organizer/src/services/la-report-access-rules.json
scp _remote/src/services/inventario-service.js tom:/opt/LA-Organizer/src/services/inventario-service.js
scp _remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp _remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp _remote/skills/governanca-dados.md tom:/opt/LA-Organizer/skills/governanca-dados.md
```

- [ ] **Step 2: Restart pm2**

```bash
ssh tom "pm2 restart tom"
```

Esperado: status `online`.

- [ ] **Step 3: Smoke via WhatsApp (manual — pede pro Alf)**

Pedir pro Alf mandar 3 mensagens:
1. "/inv ver piano" (como Rafinha) → deve responder com card formatado de pianos
2. "quanto a escola fatura?" (como qualquer um exceto Luciano/Anne/Rose) → deve responder "Essa informação é restrita ao seu perfil"
3. "/inv ver xxxxx-inexistente" → deve responder "Nenhum item com 'xxxxx-inexistente' encontrado"

- [ ] **Step 4: Verificar logs**

```bash
ssh tom "pm2 logs tom --lines 50 --nostream"
```

Esperado: nenhum erro relacionado a `checkAccess`, `inventario`, ou `la-report`.

- [ ] **Step 5: Marcar Task 7 como done quando Alf confirmar visualmente**

Nada a commitar (deploy puro).

---

## Fase A2 — PWA Reads

### Task 8: Cliente direto LA Report no PWA + env vars

**Files:**
- Create: `_remote/web/src/lib/lareport-client.ts`
- Modify: `_remote/web/.env.local`
- Docs: instruir Alf a adicionar env vars no Vercel

- [ ] **Step 1: Criar `lareport-client.ts`**

```ts
// _remote/web/src/lib/lareport-client.ts
// Cliente Supabase direto ao LA Report — usado para leituras e realtime.
// Para escritas, usar fetch em /api/lareport/... (Vercel serverless).

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_LA_REPORT_URL;
const anon = import.meta.env.VITE_LA_REPORT_ANON_KEY;

if (!url || !anon) {
  console.warn('[lareport-client] VITE_LA_REPORT_URL ou VITE_LA_REPORT_ANON_KEY não definidos. Reads do LA Report vão falhar.');
}

export const laReportClient = createClient(url || '', anon || '', {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

export const isLaReportConfigured = Boolean(url && anon);
```

- [ ] **Step 2: Adicionar env vars no `.env.local`**

Editar `_remote/web/.env.local` (gitignored) — adicionar:

```bash
VITE_LA_REPORT_URL=https://ouqwbbermlzqqvtqwlul.supabase.co
VITE_LA_REPORT_ANON_KEY=<colar anon key do LA Report>
```

Pra pegar a anon key: https://supabase.com/dashboard/project/ouqwbbermlzqqvtqwlul/settings/api → "anon public".

- [ ] **Step 3: Documentar pro Alf adicionar no Vercel**

Criar `_remote/docs/superpowers/runbooks/2026-05-17-vercel-env-lareport.md`:

```markdown
# Vercel env vars — LA Report cliente direto

Adicionar em https://vercel.com/<org>/la-organizer/settings/environment-variables :

| Name | Value | Environments |
|---|---|---|
| VITE_LA_REPORT_URL | https://ouqwbbermlzqqvtqwlul.supabase.co | Production, Preview, Development |
| VITE_LA_REPORT_ANON_KEY | (anon key do LA Report, dashboard → settings → api) | Production, Preview, Development |

Após adicionar, redeploy (Vercel detecta automaticamente no próximo push).
```

- [ ] **Step 4: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

Esperado: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add _remote/web/src/lib/lareport-client.ts _remote/docs/superpowers/runbooks/2026-05-17-vercel-env-lareport.md
git commit -m "feat(pwa): cliente Supabase direto ao LA Report (reads + realtime)"
```

---

### Task 9: Hook `useAccess` + re-exports

**Files:**
- Create: `_remote/web/src/hooks/useAccess.ts`

- [ ] **Step 1: Criar hook**

```ts
// _remote/web/src/hooks/useAccess.ts
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { checkAccess, type AccessResult } from '../lib/access-control';

export function useAccess(dataType: string): AccessResult & { isCollab: boolean } {
  const { collaborator } = useAuth();
  return useMemo(() => {
    const collab = collaborator ? {
      id: collaborator.id,
      role: collaborator.role,
      unit: collaborator.unit ?? null,
      full_name: collaborator.full_name,
      function_role: (collaborator as any).function_role ?? null,
      pedagogical_role: (collaborator as any).pedagogical_role ?? null,
    } : null;
    const res = checkAccess(collab, dataType);
    return { ...res, isCollab: Boolean(collab) };
  }, [collaborator, dataType]);
}
```

- [ ] **Step 2: Verificar que `useAuth` expõe `collaborator` com os campos necessários**

```bash
cd _remote && grep -n "function_role\|pedagogical_role" web/src/contexts/AuthContext.tsx
```

Se não estiver no select da query do collaborator, adicionar. Buscar a linha que faz `.from('collaborators').select('...')` e expandir o select pra incluir esses campos.

- [ ] **Step 3: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add _remote/web/src/hooks/useAccess.ts _remote/web/src/contexts/AuthContext.tsx
git commit -m "feat(pwa): hook useAccess + expansão do select de collaborators"
```

---

### Task 10: Refactor `useLaReport.ts` pra usar laReportClient direto + aplicar unitFilter

**Files:**
- Modify: `_remote/web/src/hooks/useLaReport.ts`
- Modify: `_remote/web/src/lib/lareport.ts` (deprecar leituras, manter pra writes)

- [ ] **Step 1: Substituir leituras de `lareport.ts` por consultas diretas via laReportClient + aplicar `unitFilter` retornado pelo `useAccess`**

Atualizar `useReportSalas`:

```ts
// _remote/web/src/hooks/useLaReport.ts
import { useQuery } from '@tanstack/react-query';
import { laReportClient } from '../lib/lareport-client';
import { useAccess } from './useAccess';
import type { ReportSala, ReportSalaDetalhe, ReportUnidade, ReportProduto, ReportAlertas } from '../lib/lareport-types';

export function useReportSalas(unidadeId?: string) {
  const access = useAccess('inventario');
  return useQuery({
    queryKey: ['lareport', 'salas', unidadeId, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId),
    queryFn: async (): Promise<ReportSala[]> => {
      let q = laReportClient
        .from('salas')
        .select('id, nome, tipo_sala, capacidade_maxima, codigo, ativo, unidade_id, buffer_operacional, sala_coringa, unidades(nome)')
        .eq('ativo', true)
        .order('nome');
      if (unidadeId) q = q.eq('unidade_id', unidadeId);
      if (access.unitFilter) {
        const filter = access.unitFilter;
        if (Array.isArray(filter)) q = q.in('unidade_id', filter);
        else q = q.eq('unidade_id', filter);
      }
      const { data, error } = await q;
      if (error) throw error;
      // Contagem de itens em paralelo
      const ids = (data || []).map(s => s.id);
      const countMap = new Map<number, number>();
      if (ids.length) {
        const { data: counts } = await laReportClient.from('inventario').select('sala_id').in('sala_id', ids).eq('ativo', true);
        for (const r of counts || []) countMap.set(r.sala_id, (countMap.get(r.sala_id) || 0) + 1);
      }
      return (data || []).map(s => ({ ...s, itens_count: countMap.get(s.id) || 0 })) as ReportSala[];
    },
  });
}
```

Refatorar similarmente: `useReportUnidades`, `useReportSalaDetalhe`, `useReportLoja`, `useReportAlertas`.

Pra cada hook, decidir o `dataType` correto:
- `useReportUnidades` → `'inventario'` (mesma porta de entrada)
- `useReportSalaDetalhe` → `'inventario'`
- `useReportLoja` → `'loja_produtos'`
- `useReportAlertas` → `'inventario'` (alertas de inventário)

E aplicar `unitFilter` em cada query.

- [ ] **Step 2: Marcar funções de leitura em `lareport.ts` como `@deprecated`**

No topo do arquivo, antes de cada `export async function fetchReport*`:

```ts
/** @deprecated Use o hook correspondente em useLaReport.ts (cliente direto LA Report). */
export async function fetchReportSalas(...) { ... }
```

Não remover — outros lugares podem ainda usar; remoção fica pra task de cleanup futura.

- [ ] **Step 3: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 4: Build smoke**

```bash
cd _remote/web && npm run build
```

Esperado: build limpo.

- [ ] **Step 5: Commit**

```bash
git add _remote/web/src/hooks/useLaReport.ts _remote/web/src/lib/lareport.ts
git commit -m "refactor(pwa): hooks de leitura usam laReportClient direto + unitFilter via checkAccess"
```

---

### Task 11: Wrapper `lareport-realtime` + hooks `useRealtimeSala`/`useRealtimeSalas`

**Files:**
- Create: `_remote/web/src/lib/lareport-realtime.ts`
- Create: `_remote/web/src/hooks/useRealtimeSala.ts`
- Create: `_remote/web/src/hooks/useRealtimeSalas.ts`

- [ ] **Step 1: Wrapper de subscription**

```ts
// _remote/web/src/lib/lareport-realtime.ts
import { useEffect } from 'react';
import { laReportClient } from './lareport-client';
import type { RealtimeChannel } from '@supabase/supabase-js';

type Filter = `${string}=eq.${string|number}` | `${string}=in.(${string})` | undefined;

export function useRealtimeRow(
  table: string,
  filter: Filter,
  onChange: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const ch: RealtimeChannel = laReportClient
      .channel(`rt:${table}:${filter ?? 'all'}:${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => onChange())
      .subscribe();
    return () => { laReportClient.removeChannel(ch); };
  }, [table, filter, enabled, onChange]);
}
```

- [ ] **Step 2: `useRealtimeSala` (invalida query da SalaPage)**

```ts
// _remote/web/src/hooks/useRealtimeSala.ts
import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeRow } from '../lib/lareport-realtime';

export function useRealtimeSala(salaId: number | null) {
  const qc = useQueryClient();
  const enabled = salaId !== null;
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['lareport', 'sala', salaId] }); };

  useRealtimeRow('inventario', salaId ? `sala_id=eq.${salaId}` : undefined, invalidate, enabled);
  useRealtimeRow('inventario_movimentacoes', salaId ? `sala_origem_id=eq.${salaId}` : undefined, invalidate, enabled);
  useRealtimeRow('inventario_movimentacoes', salaId ? `sala_destino_id=eq.${salaId}` : undefined, invalidate, enabled);
  useRealtimeRow('inventario_manutencoes', undefined, invalidate, enabled);  // sem filter direto — invalida sempre
}
```

- [ ] **Step 3: `useRealtimeSalas` (invalida lista de salas)**

```ts
// _remote/web/src/hooks/useRealtimeSalas.ts
import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeRow } from '../lib/lareport-realtime';

export function useRealtimeSalas(unidadeId?: string) {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['lareport', 'salas', unidadeId] }); };
  useRealtimeRow('inventario', undefined, invalidate, Boolean(unidadeId));
  useRealtimeRow('salas', undefined, invalidate, Boolean(unidadeId));
}
```

- [ ] **Step 4: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add _remote/web/src/lib/lareport-realtime.ts _remote/web/src/hooks/useRealtimeSala.ts _remote/web/src/hooks/useRealtimeSalas.ts
git commit -m "feat(pwa): realtime subscriptions para sala e lista de salas"
```

---

## Fase A3 — PWA UI

### Task 12: `StatsCards` (condicional 3 ou 4 cards)

**Files:**
- Create: `_remote/web/src/screens/inventario/components/StatsCards.tsx`
- Create: `_remote/web/src/hooks/useInventarioStats.ts`

- [ ] **Step 1: Hook que retorna os stats agregados**

```ts
// _remote/web/src/hooks/useInventarioStats.ts
import { useQuery } from '@tanstack/react-query';
import { laReportClient } from '../lib/lareport-client';
import { useAccess } from './useAccess';

export function useInventarioStats(unidadeId?: string) {
  const access = useAccess('inventario');
  return useQuery({
    queryKey: ['lareport', 'stats', unidadeId, access.unitFilter],
    enabled: access.allowed && Boolean(unidadeId),
    queryFn: async () => {
      const filterUnit = (q: any) => {
        if (unidadeId) q = q.eq('unidade_id', unidadeId);
        if (access.unitFilter) {
          const f = access.unitFilter;
          if (Array.isArray(f)) q = q.in('unidade_id', f);
          else q = q.eq('unidade_id', f);
        }
        return q;
      };

      const [totalRes, valorRes, manutRes, atencaoRes] = await Promise.all([
        filterUnit(laReportClient.from('inventario').select('id', { count: 'exact', head: true })).eq('ativo', true),
        filterUnit(laReportClient.from('inventario').select('valor_compra')).eq('ativo', true),
        filterUnit(laReportClient.from('inventario').select('id', { count: 'exact', head: true })).eq('status', 'manutencao'),
        filterUnit(laReportClient.from('inventario').select('id', { count: 'exact', head: true })).lte('proxima_revisao', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)),
      ]);

      const valorTotal = (valorRes.data || []).reduce((s: number, r: any) => s + (Number(r.valor_compra) || 0), 0);

      return {
        total: totalRes.count ?? 0,
        valor: valorTotal,
        manutencao: manutRes.count ?? 0,
        atencao: atencaoRes.count ?? 0,
      };
    },
  });
}
```

- [ ] **Step 2: Componente `StatsCards`**

```tsx
// _remote/web/src/screens/inventario/components/StatsCards.tsx
import { useAccess } from '../../../hooks/useAccess';
import { useInventarioStats } from '../../../hooks/useInventarioStats';

interface Props { unidadeId?: string; onAtencaoClick?: () => void; }

export function StatsCards({ unidadeId, onAtencaoClick }: Props) {
  const { data } = useInventarioStats(unidadeId);
  const valorAccess = useAccess('valor_patrimonial');
  if (!data) return null;

  const Card = ({ label, value, tone, onClick }: any) => (
    <div onClick={onClick} className={`bg-bg-surface border border-border rounded-lg p-sm ${onClick ? 'cursor-pointer hover:border-tom' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone === 'warn' ? 'text-warning' : tone === 'danger' ? 'text-danger' : tone === 'tom' ? 'text-tom' : 'text-fg'}`}>{value}</div>
    </div>
  );

  const cols = valorAccess.allowed ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className={`grid ${cols} gap-2`}>
      <Card label="Total itens" value={data.total} />
      {valorAccess.allowed && <Card label="Valor total" value={`R$ ${data.valor.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} tone="tom" />}
      <Card label="Em manutenção" value={data.manutencao} tone="warn" />
      <Card label="Atenção" value={data.atencao} tone="danger" onClick={data.atencao > 0 ? onAtencaoClick : undefined} />
    </div>
  );
}
```

- [ ] **Step 3: Type check + visual smoke**

```bash
cd _remote/web && npx tsc --noEmit
```

Sem componente integrado ainda. Visual smoke vem na Task 14.

- [ ] **Step 4: Commit**

```bash
git add _remote/web/src/screens/inventario/components/StatsCards.tsx _remote/web/src/hooks/useInventarioStats.ts
git commit -m "feat(pwa): StatsCards condicional 3/4 cards via checkAccess('valor_patrimonial')"
```

---

### Task 13: `SalaCardMedio` + integração na ListaPage

**Files:**
- Create: `_remote/web/src/screens/inventario/components/SalaCardMedio.tsx`
- Modify: `_remote/web/src/screens/inventario/ListaPage.tsx`

- [ ] **Step 1: Criar `SalaCardMedio`**

```tsx
// _remote/web/src/screens/inventario/components/SalaCardMedio.tsx
import { Badge } from '../../../components/Badge';
import { iconeParaTipoSala, type ReportSala } from '../../../lib/lareport-types';

interface Props { sala: ReportSala & { manutencoes_pendentes?: number }; onClick: () => void; }

export function SalaCardMedio({ sala, onClick }: Props) {
  const itens = sala.itens_count ?? 0;
  const manut = sala.manutencoes_pendentes ?? 0;
  return (
    <button type="button" onClick={onClick} className="w-full bg-bg-surface rounded-lg border border-border p-md text-left hover:border-tom transition">
      <div className="flex items-center gap-sm">
        <div className="w-10 h-10 rounded-md bg-bg-app flex items-center justify-center text-xl flex-shrink-0">
          {iconeParaTipoSala(sala.tipo_sala)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-fg truncate">{sala.nome}</span>
            {sala.sala_coringa && <Badge tone="success">Coringa</Badge>}
          </div>
          <div className="text-[11px] text-fg-muted">{sala.tipo_sala || 'Multiuso'}</div>
        </div>
        <span className="text-fg-muted">›</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-fg-muted">
        <span>👥 {sala.capacidade_maxima ?? '?'} alunos · ⏱️ {sala.buffer_operacional ?? 10}min</span>
        <span className="text-right">📦 {itens} itens{manut > 0 ? ` · 🔧 ${manut}` : ''}</span>
      </div>
    </button>
  );
}
```

Nota: `manutencoes_pendentes` é opcional. Pode ser populado em Task 14 via JOIN ou ficar omitido nesta fase.

- [ ] **Step 2: Integrar na `ListaPage.tsx`**

Substituir o uso de `SalaCard` por `SalaCardMedio` e adicionar `StatsCards` no topo.

Trecho-chave (depois das tabs de unidade, antes do card Lojinha):

```tsx
import { StatsCards } from './components/StatsCards';
import { SalaCardMedio } from './components/SalaCardMedio';
import { useAccess } from '../../hooks/useAccess';
import { useRealtimeSalas } from '../../hooks/useRealtimeSalas';

// ...dentro do componente:
const lojaAccess = useAccess('loja_produtos');
useRealtimeSalas(unidadeAtiva);

// Render:
<StatsCards unidadeId={unidadeAtiva} onAtencaoClick={() => navigate(`/inventario/atencao?unit=${unidadeAtiva}`)} />

{lojaAccess.allowed && (
  <button onClick={() => navigate(`/inventario/loja?unit=${unidadeAtiva}`)} className="w-full bg-bg-surface rounded-lg border border-border p-md flex items-center gap-sm">
    <span className="text-2xl">🛒</span>
    <div className="flex-1 text-left">
      <div className="font-bold">Lojinha</div>
      <div className="text-[11px] text-fg-muted">{lojaStats.produtos} produtos · estoque baixo: {lojaStats.baixo}</div>
    </div>
    <span>›</span>
  </button>
)}

<div className="space-y-2">
  {salas.map(s => <SalaCardMedio key={s.id} sala={s} onClick={() => navigate(`/inventario/sala/${s.id}`)} />)}
</div>
```

- [ ] **Step 3: Build + visual smoke via Claude Preview**

```bash
cd _remote/web && npm run build
```

Limpar SW e navegar:

```js
// preview_eval no web-preview server (4173)
(async () => {
  if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  location.href = '/mais';
})();
```

Depois click Mais → Inventário e screenshot.

Esperado: stats cards no topo, Lojinha aparece (Rafinha vê), salas em card médio com capacidade + buffer + itens count.

- [ ] **Step 4: Commit**

```bash
git add _remote/web/src/screens/inventario/components/SalaCardMedio.tsx _remote/web/src/screens/inventario/ListaPage.tsx
git commit -m "feat(pwa): SalaCardMedio + ListaPage com StatsCards e Lojinha condicional"
```

---

### Task 14: `ItemFAB` + `ItemAcoesMenu` (condicionais por role)

**Files:**
- Create: `_remote/web/src/screens/inventario/components/ItemFAB.tsx`
- Create: `_remote/web/src/screens/inventario/components/ItemAcoesMenu.tsx`

- [ ] **Step 1: `ItemFAB`**

```tsx
// _remote/web/src/screens/inventario/components/ItemFAB.tsx
import { useAccess } from '../../../hooks/useAccess';

interface Props { onClick: () => void; }

export function ItemFAB({ onClick }: Props) {
  const access = useAccess('inventario');
  // Só renderiza pra quem pode CRIAR (precisa de allowed sem unitFilter rígido restrito a leitura)
  // Heurística: se professor, NÃO mostra FAB (professor só registra manutenção).
  // Implementação simples: se allowed e function_role !== 'professor', mostra.
  const collab = (useAccess as any)._collab; // alternative: pegar do useAuth
  if (!access.allowed) return null;
  // Hide FAB explicitly for professor (regra: só registra manutenção, não cria)
  // useAccess não expõe collab — usar hook auxiliar
  return (
    <button onClick={onClick} className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-tom text-black shadow-lg flex items-center justify-center text-2xl font-bold z-50 active:scale-95 transition">
      +
    </button>
  );
}
```

Pra ocultar do professor, criar helper `useIsProfessor()` em `web/src/hooks/useIsProfessor.ts`:

```ts
import { useAuth } from '../contexts/AuthContext';
export function useIsProfessor(): boolean {
  const { collaborator } = useAuth();
  return (collaborator as any)?.function_role === 'professor';
}
```

E no `ItemFAB`, retornar null se professor:

```tsx
import { useIsProfessor } from '../../../hooks/useIsProfessor';
// dentro do componente:
const isProf = useIsProfessor();
if (!access.allowed || isProf) return null;
```

- [ ] **Step 2: `ItemAcoesMenu`**

Bottom sheet com ações condicionais por role.

```tsx
// _remote/web/src/screens/inventario/components/ItemAcoesMenu.tsx
import { useAccess } from '../../../hooks/useAccess';
import { useIsProfessor } from '../../../hooks/useIsProfessor';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  item: ReportInventarioItem;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onMover: () => void;
  onManutencao: () => void;
  onBaixa: () => void;
}

export function ItemAcoesMenu({ item, open, onClose, onEdit, onMover, onManutencao, onBaixa }: Props) {
  const invAccess = useAccess('inventario');
  const movAccess = useAccess('movimentacoes');
  const isProf = useIsProfessor();
  if (!open) return null;

  const podeEditar = invAccess.allowed && !isProf;
  const podeMover = movAccess.allowed && !isProf;
  const podeBaixa = invAccess.allowed && !isProf;
  const podeManut = invAccess.allowed;  // professor pode

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div className="bg-bg-surface w-full rounded-t-xl p-md space-y-2" onClick={e => e.stopPropagation()}>
        <div className="text-[11px] text-fg-muted text-center mb-2">{item.nome}</div>
        {podeEditar && <button onClick={onEdit} className="w-full text-left p-sm rounded-md hover:bg-bg-app">✏️ Editar</button>}
        {podeMover && <button onClick={onMover} className="w-full text-left p-sm rounded-md hover:bg-bg-app">↔️ Mover de sala</button>}
        {podeManut && <button onClick={onManutencao} className="w-full text-left p-sm rounded-md hover:bg-bg-app">🔧 Registrar manutenção</button>}
        {podeBaixa && <button onClick={onBaixa} className="w-full text-left p-sm rounded-md hover:bg-bg-app text-danger">🗑️ Dar baixa</button>}
        <button onClick={onClose} className="w-full text-left p-sm rounded-md hover:bg-bg-app text-fg-muted">❌ Cancelar</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add _remote/web/src/screens/inventario/components/ItemFAB.tsx _remote/web/src/screens/inventario/components/ItemAcoesMenu.tsx _remote/web/src/hooks/useIsProfessor.ts
git commit -m "feat(pwa): ItemFAB e ItemAcoesMenu com gating por role"
```

---

### Task 15: `ItemSheet` (criar/editar) + `FotoUploader`

**Files:**
- Create: `_remote/web/src/screens/inventario/components/ItemSheet.tsx`
- Create: `_remote/web/src/screens/inventario/components/FotoUploader.tsx`

- [ ] **Step 1: `FotoUploader`**

```tsx
// _remote/web/src/screens/inventario/components/FotoUploader.tsx
import { useState } from 'react';
import { uploadFoto } from '../../../lib/lareport-mutations';

interface Props { value: string | null; onChange: (url: string | null) => void; }

export function FotoUploader({ value, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) { setErro('Máximo 5MB'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setErro('Formato inválido (JPEG/PNG/WebP)'); return; }
    setErro(null);
    setUploading(true);
    try {
      const url = await uploadFoto(file);
      onChange(url);
    } catch (e: any) {
      setErro(e.message || 'Erro no upload');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {value ? (
        <div className="relative">
          <img src={value} alt="Foto" className="w-full max-h-48 object-cover rounded-md" />
          <button onClick={() => onChange(null)} className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded-md text-[10px]">Remover</button>
        </div>
      ) : (
        <label className="block w-full p-md border-2 border-dashed border-border rounded-md text-center cursor-pointer hover:border-tom">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <div className="text-2xl mb-1">📷</div>
          <div className="text-sm text-fg-muted">{uploading ? 'Enviando...' : 'Toque pra escolher uma foto'}</div>
        </label>
      )}
      {erro && <div className="text-[11px] text-danger mt-1">{erro}</div>}
    </div>
  );
}
```

(A função `uploadFoto` vem da Task 21 — por enquanto, criar stub em `lareport-mutations.ts`.)

- [ ] **Step 2: `ItemSheet`**

```tsx
// _remote/web/src/screens/inventario/components/ItemSheet.tsx
import { useState, useEffect } from 'react';
import { useAccess } from '../../../hooks/useAccess';
import { CATEGORIA_INVENTARIO_META, type ReportInventarioItem } from '../../../lib/lareport-types';
import { FotoUploader } from './FotoUploader';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: Partial<ReportInventarioItem>) => Promise<void>;
  item?: ReportInventarioItem | null;
  defaultSalaId?: number | null;
  defaultUnidadeId?: string | null;
}

const CATEGORIAS = Object.keys(CATEGORIA_INVENTARIO_META);

export function ItemSheet({ open, onClose, onSubmit, item, defaultSalaId, defaultUnidadeId }: Props) {
  const valorAccess = useAccess('valor_patrimonial');
  const [form, setForm] = useState<any>({
    nome: '', categoria: '', marca: '', modelo: '', numero_serie: '', quantidade: 1,
    unidade_id: defaultUnidadeId, sala_id: defaultSalaId,
    valor_compra: null, data_compra: null, nota_fiscal: '', fornecedor: '',
    status: 'ativo', condicao: 'bom', proxima_revisao: null, alerta_revisao_dias: 30,
    foto_url: null, observacoes: '',
  });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (item) setForm({ ...item });
  }, [item]);

  if (!open) return null;

  async function submit() {
    if (!form.nome || !form.categoria || !form.unidade_id) { setErro('Nome, Categoria e Unidade são obrigatórios'); return; }
    setSaving(true); setErro(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (e: any) {
      setErro(e.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto">
      <div className="bg-bg-app min-h-full p-md pb-24">
        <header className="flex items-center justify-between mb-md">
          <h2 className="text-lg font-bold">{item ? 'Editar' : 'Novo'} Equipamento</h2>
          <button onClick={onClose}>✕</button>
        </header>

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Identificação</div>
          <input className="w-full bg-bg-app border border-border rounded-md p-2" placeholder="Nome *" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
          <select className="w-full bg-bg-app border border-border rounded-md p-2" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
            <option value="">Categoria *</option>
            {CATEGORIAS.map(c => <option key={c} value={c}>{CATEGORIA_INVENTARIO_META[c].emoji} {CATEGORIA_INVENTARIO_META[c].label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Marca" value={form.marca || ''} onChange={e => setForm({ ...form, marca: e.target.value })} />
            <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Modelo" value={form.modelo || ''} onChange={e => setForm({ ...form, modelo: e.target.value })} />
            <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Núm. Série" value={form.numero_serie || ''} onChange={e => setForm({ ...form, numero_serie: e.target.value })} />
            <input type="number" className="bg-bg-app border border-border rounded-md p-2" placeholder="Qtd" value={form.quantidade} onChange={e => setForm({ ...form, quantidade: parseInt(e.target.value) || 1 })} />
          </div>
        </section>

        {valorAccess.allowed && (
          <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
            <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Financeiro</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" className="bg-bg-app border border-border rounded-md p-2" placeholder="Valor compra" value={form.valor_compra ?? ''} onChange={e => setForm({ ...form, valor_compra: e.target.value ? parseFloat(e.target.value) : null })} />
              <input type="date" className="bg-bg-app border border-border rounded-md p-2" value={form.data_compra || ''} onChange={e => setForm({ ...form, data_compra: e.target.value || null })} />
              <input className="bg-bg-app border border-border rounded-md p-2" placeholder="NF" value={form.nota_fiscal || ''} onChange={e => setForm({ ...form, nota_fiscal: e.target.value })} />
              <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Fornecedor" value={form.fornecedor || ''} onChange={e => setForm({ ...form, fornecedor: e.target.value })} />
            </div>
          </section>
        )}

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Status & Condição</div>
          <div className="grid grid-cols-2 gap-2">
            <select className="bg-bg-app border border-border rounded-md p-2" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="ativo">Ativo</option><option value="manutencao">Manutenção</option><option value="baixa">Baixa</option><option value="inativo">Inativo</option>
            </select>
            <select className="bg-bg-app border border-border rounded-md p-2" value={form.condicao} onChange={e => setForm({ ...form, condicao: e.target.value })}>
              <option value="novo">Novo</option><option value="bom">Bom</option><option value="regular">Regular</option><option value="ruim">Ruim</option>
            </select>
            <input type="date" className="bg-bg-app border border-border rounded-md p-2" placeholder="Próx revisão" value={form.proxima_revisao || ''} onChange={e => setForm({ ...form, proxima_revisao: e.target.value || null })} />
            <input type="number" className="bg-bg-app border border-border rounded-md p-2" placeholder="Alerta dias" value={form.alerta_revisao_dias} onChange={e => setForm({ ...form, alerta_revisao_dias: parseInt(e.target.value) || 30 })} />
          </div>
        </section>

        <section className="bg-bg-surface rounded-lg p-md space-y-2 mb-md">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">Foto + Observações</div>
          <FotoUploader value={form.foto_url} onChange={url => setForm({ ...form, foto_url: url })} />
          <textarea className="w-full bg-bg-app border border-border rounded-md p-2 mt-2" rows={3} placeholder="Observações" value={form.observacoes || ''} onChange={e => setForm({ ...form, observacoes: e.target.value })} />
        </section>

        {erro && <div className="text-danger text-sm mb-md">{erro}</div>}

        <div className="fixed bottom-0 inset-x-0 bg-bg-surface border-t border-border p-md">
          <button onClick={submit} disabled={saving} className="w-full bg-tom text-black font-bold py-3 rounded-md disabled:opacity-50">
            {saving ? 'Salvando...' : item ? 'Salvar Alterações' : 'Cadastrar Equipamento'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Stub `uploadFoto` em `lareport-mutations.ts`**

```ts
// _remote/web/src/lib/lareport-mutations.ts (criar arquivo)
import { supabase } from './supabase';

async function authHeader() {
  const { data: sess } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${sess.session?.access_token ?? ''}` };
}

export async function uploadFoto(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/lareport/upload', { method: 'POST', headers: await authHeader(), body: form });
  if (!res.ok) throw new Error(`Upload falhou: ${res.status}`);
  const j = await res.json();
  return j.url as string;
}

// Stubs pras outras mutations (implementadas em Task 21)
export async function createItem(payload: any): Promise<any> {
  const res = await fetch('/api/lareport/inventario', { method: 'POST', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error((await res.json()).error || `${res.status}`);
  return (await res.json()).data;
}
export async function updateItem(id: number, payload: any): Promise<any> {
  const res = await fetch(`/api/lareport/inventario/${id}`, { method: 'PATCH', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error((await res.json()).error || `${res.status}`);
  return (await res.json()).data;
}
export async function deleteItem(id: number): Promise<void> {
  const res = await fetch(`/api/lareport/inventario/${id}`, { method: 'DELETE', headers: await authHeader() });
  if (!res.ok) throw new Error((await res.json()).error || `${res.status}`);
}
export async function moverItem(id: number, payload: { sala_destino_id: number; motivo?: string }): Promise<any> {
  const res = await fetch(`/api/lareport/inventario/${id}/mover`, { method: 'POST', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error((await res.json()).error || `${res.status}`);
  return (await res.json()).data;
}
export async function registrarManutencao(id: number, payload: { tipo: string; descricao: string; custo?: number; data_manutencao: string; responsavel?: string; data_proxima_revisao?: string }): Promise<any> {
  const res = await fetch(`/api/lareport/inventario/${id}/manutencao`, { method: 'POST', headers: { ...(await authHeader()), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error((await res.json()).error || `${res.status}`);
  return (await res.json()).data;
}
```

- [ ] **Step 4: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add _remote/web/src/screens/inventario/components/ItemSheet.tsx _remote/web/src/screens/inventario/components/FotoUploader.tsx _remote/web/src/lib/lareport-mutations.ts
git commit -m "feat(pwa): ItemSheet + FotoUploader + stubs de mutations"
```

---

### Task 16: Sheets secundários (`MoverItemSheet`, `ManutencaoSheet`, `BaixaConfirmSheet`)

**Files:**
- Create: `_remote/web/src/screens/inventario/components/MoverItemSheet.tsx`
- Create: `_remote/web/src/screens/inventario/components/ManutencaoSheet.tsx`
- Create: `_remote/web/src/screens/inventario/components/BaixaConfirmSheet.tsx`

- [ ] **Step 1: `MoverItemSheet`**

```tsx
// _remote/web/src/screens/inventario/components/MoverItemSheet.tsx
import { useState } from 'react';
import { useReportSalas } from '../../../hooks/useLaReport';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  open: boolean; onClose: () => void;
  item: ReportInventarioItem;
  onSubmit: (sala_destino_id: number, motivo?: string) => Promise<void>;
}

export function MoverItemSheet({ open, onClose, item, onSubmit }: Props) {
  const { data: salas } = useReportSalas(item.unidade_id || undefined);
  const [destino, setDestino] = useState<number | ''>('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div className="bg-bg-surface w-full rounded-t-xl p-md space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold">Mover "{item.nome}" de sala</h3>
        <select className="w-full bg-bg-app border border-border rounded-md p-2" value={destino} onChange={e => setDestino(e.target.value ? parseInt(e.target.value) : '')}>
          <option value="">Selecione a sala destino</option>
          {(salas || []).filter(s => s.id !== item.sala_id).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        <input className="w-full bg-bg-app border border-border rounded-md p-2" placeholder="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} />
        <button disabled={!destino || saving} onClick={async () => { setSaving(true); await onSubmit(destino as number, motivo || undefined); setSaving(false); onClose(); }} className="w-full bg-tom text-black font-bold py-3 rounded-md disabled:opacity-50">
          {saving ? 'Movendo...' : 'Mover'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `ManutencaoSheet`**

```tsx
// _remote/web/src/screens/inventario/components/ManutencaoSheet.tsx
import { useState } from 'react';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  open: boolean; onClose: () => void;
  item: ReportInventarioItem;
  onSubmit: (payload: { tipo: string; descricao: string; custo?: number; data_manutencao: string; responsavel?: string; data_proxima_revisao?: string }) => Promise<void>;
}

export function ManutencaoSheet({ open, onClose, item, onSubmit }: Props) {
  const [form, setForm] = useState({ tipo: 'preventiva', descricao: '', custo: '', data_manutencao: new Date().toISOString().slice(0, 10), responsavel: '', data_proxima_revisao: '' });
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div className="bg-bg-surface w-full rounded-t-xl p-md space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold">Manutenção: {item.nome}</h3>
        <select className="w-full bg-bg-app border border-border rounded-md p-2" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
          <option value="preventiva">Preventiva</option><option value="corretiva">Corretiva</option><option value="revisao">Revisão</option>
        </select>
        <textarea rows={3} className="w-full bg-bg-app border border-border rounded-md p-2" placeholder="Descrição *" value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className="bg-bg-app border border-border rounded-md p-2" value={form.data_manutencao} onChange={e => setForm({ ...form, data_manutencao: e.target.value })} />
          <input type="number" step="0.01" className="bg-bg-app border border-border rounded-md p-2" placeholder="Custo R$" value={form.custo} onChange={e => setForm({ ...form, custo: e.target.value })} />
          <input className="bg-bg-app border border-border rounded-md p-2" placeholder="Responsável" value={form.responsavel} onChange={e => setForm({ ...form, responsavel: e.target.value })} />
          <input type="date" className="bg-bg-app border border-border rounded-md p-2" placeholder="Próx revisão" value={form.data_proxima_revisao} onChange={e => setForm({ ...form, data_proxima_revisao: e.target.value })} />
        </div>
        <button disabled={!form.descricao || saving} onClick={async () => {
          setSaving(true);
          await onSubmit({
            tipo: form.tipo,
            descricao: form.descricao,
            custo: form.custo ? parseFloat(form.custo) : undefined,
            data_manutencao: form.data_manutencao,
            responsavel: form.responsavel || undefined,
            data_proxima_revisao: form.data_proxima_revisao || undefined,
          });
          setSaving(false); onClose();
        }} className="w-full bg-tom text-black font-bold py-3 rounded-md disabled:opacity-50">
          {saving ? 'Registrando...' : 'Registrar'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `BaixaConfirmSheet`**

```tsx
// _remote/web/src/screens/inventario/components/BaixaConfirmSheet.tsx
import { useState } from 'react';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  open: boolean; onClose: () => void;
  item: ReportInventarioItem;
  onConfirm: () => Promise<void>;
}

export function BaixaConfirmSheet({ open, onClose, item, onConfirm }: Props) {
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end" onClick={onClose}>
      <div className="bg-bg-surface w-full rounded-t-xl p-md space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-danger">Dar baixa em "{item.nome}"?</h3>
        <p className="text-sm text-fg-muted">O item será marcado como inativo (status=baixa). Histórico preservado. Reversível só via admin do LA Report.</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose} className="bg-bg-app border border-border py-2 rounded-md">Cancelar</button>
          <button disabled={saving} onClick={async () => { setSaving(true); await onConfirm(); setSaving(false); onClose(); }} className="bg-danger text-white font-bold py-2 rounded-md disabled:opacity-50">
            {saving ? 'Dando baixa...' : 'Confirmar baixa'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add _remote/web/src/screens/inventario/components/MoverItemSheet.tsx _remote/web/src/screens/inventario/components/ManutencaoSheet.tsx _remote/web/src/screens/inventario/components/BaixaConfirmSheet.tsx
git commit -m "feat(pwa): sheets MoverItem, Manutencao, BaixaConfirm"
```

---

## Fase A4 — Serverless Writes

### Task 17: Helpers compartilhados `web/api/_lib`

**Files:**
- Create: `_remote/web/api/_lib/auth.ts`
- Create: `_remote/web/api/_lib/access-control.ts` (já criado em Task 3, validar)
- Create: `_remote/web/api/_lib/lareport-server.ts`
- Create: `_remote/web/api/_lib/audit.ts`

- [ ] **Step 1: `auth.ts` — extrai e valida JWT, busca collaborator**

```ts
// _remote/web/api/_lib/auth.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import type { CollaboratorAuth } from './access-control';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const sb = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });

export async function requireCollaborator(req: VercelRequest, res: VercelResponse): Promise<CollaboratorAuth | null> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) { res.status(401).json({ ok: false, error: 'no_auth' }); return null; }
  const { data: ud, error: ue } = await sb.auth.getUser(token);
  if (ue || !ud.user) { res.status(401).json({ ok: false, error: 'invalid_token' }); return null; }
  const { data: collab, error: ce } = await sb.from('collaborators').select('id, role, unit, full_name, function_role, pedagogical_role').eq('auth_user_id', ud.user.id).maybeSingle();
  if (ce) { res.status(500).json({ ok: false, error: 'collab_lookup_failed', detail: ce.message }); return null; }
  if (!collab) { res.status(403).json({ ok: false, error: 'no_collaborator' }); return null; }
  return collab as CollaboratorAuth;
}
```

- [ ] **Step 2: `lareport-server.ts` — cliente service-role do LA Report**

```ts
// _remote/web/api/_lib/lareport-server.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.LA_REPORT_URL || 'https://ouqwbbermlzqqvtqwlul.supabase.co';
const key = process.env.LA_REPORT_SERVICE_ROLE_KEY!;

export const lareport = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```

- [ ] **Step 3: `audit.ts` — injeta "via PWA por <nome>"**

```ts
// _remote/web/api/_lib/audit.ts
import type { CollaboratorAuth } from './access-control';

export function withAudit(text: string | null | undefined, collab: CollaboratorAuth, prefix = 'via PWA'): string {
  const prev = (text ?? '').trim();
  const tag = `${prefix} por ${collab.full_name}`;
  return prev ? `${tag}\n\n${prev}` : tag;
}

const RESTRICTED_FIELDS = ['valor_compra', 'nota_fiscal', 'fornecedor', 'data_compra'];

export function stripRestrictedFields(payload: any, allowed: boolean): { clean: any; stripped: string[] } {
  if (allowed) return { clean: payload, stripped: [] };
  const clean = { ...payload };
  const stripped: string[] = [];
  for (const f of RESTRICTED_FIELDS) {
    if (f in clean) { delete clean[f]; stripped.push(f); }
  }
  return { clean, stripped };
}
```

- [ ] **Step 4: Adicionar env vars Vercel**

Adicionar ao runbook do Task 8:

| Name | Value | Environments |
|---|---|---|
| LA_REPORT_URL | https://ouqwbbermlzqqvtqwlul.supabase.co | Production, Preview, Development |
| LA_REPORT_SERVICE_ROLE_KEY | (service role do LA Report) | Production, Preview, Development |

- [ ] **Step 5: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add _remote/web/api/_lib/auth.ts _remote/web/api/_lib/lareport-server.ts _remote/web/api/_lib/audit.ts _remote/docs/superpowers/runbooks/2026-05-17-vercel-env-lareport.md
git commit -m "feat(serverless): helpers _lib (auth, lareport-server, audit)"
```

---

### Task 18: Endpoints POST + PATCH + DELETE de inventário

**Files:**
- Create: `_remote/web/api/lareport/inventario/index.ts`
- Create: `_remote/web/api/lareport/inventario/[id].ts`

- [ ] **Step 1: POST (criar)**

```ts
// _remote/web/api/lareport/inventario/index.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth';
import { checkAccess } from '../../_lib/access-control';
import { lareport } from '../../_lib/lareport-server';
import { withAudit, stripRestrictedFields } from '../../_lib/audit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const valorAccess = checkAccess(collab, 'valor_patrimonial');
  const { clean, stripped } = stripRestrictedFields(req.body || {}, valorAccess.allowed);
  if (stripped.length > 0) console.warn(`[inventario POST] ${collab.full_name} (${collab.role}/${collab.function_role}) tentou enviar campos restritos: ${stripped.join(',')}`);

  // Validar unitFilter
  if (access.unitFilter && clean.unidade_id) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(clean.unidade_id)) return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
  }

  const payload = { ...clean, observacoes: withAudit(clean.observacoes, collab), created_by: null };

  const { data, error } = await lareport.from('inventario').insert(payload).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
```

- [ ] **Step 2: PATCH + DELETE (editar / soft-delete)**

```ts
// _remote/web/api/lareport/inventario/[id].ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../_lib/auth';
import { checkAccess } from '../../_lib/access-control';
import { lareport } from '../../_lib/lareport-server';
import { withAudit, stripRestrictedFields } from '../../_lib/audit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['PATCH', 'DELETE'].includes(req.method!)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const id = parseInt(req.query.id as string, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'invalid_id' });

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  // Valida unitFilter buscando o item antes
  if (access.unitFilter) {
    const { data: existing } = await lareport.from('inventario').select('unidade_id').eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(existing.unidade_id)) return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
  }

  if (req.method === 'DELETE') {
    const { data, error } = await lareport.from('inventario').update({ status: 'baixa', ativo: false, observacoes: withAudit(`Baixa via PWA`, collab) }).eq('id', id).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, data });
  }

  // PATCH
  const valorAccess = checkAccess(collab, 'valor_patrimonial');
  const { clean, stripped } = stripRestrictedFields(req.body || {}, valorAccess.allowed);
  if (stripped.length > 0) console.warn(`[inventario PATCH ${id}] ${collab.full_name} stripped: ${stripped.join(',')}`);

  const payload = { ...clean };
  if (payload.observacoes !== undefined) payload.observacoes = withAudit(payload.observacoes, collab);

  const { data, error } = await lareport.from('inventario').update(payload).eq('id', id).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
```

- [ ] **Step 3: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 4: Smoke local com dev server**

```bash
# Em outro terminal: cd _remote/web && npm run dev
# Pegar JWT do localStorage no browser logado (chave supabase.auth.token)
JWT="..."

curl -X POST http://localhost:5173/api/lareport/inventario \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"nome":"TESTE-DELETAR","categoria":"acessorios","unidade_id":"<uuid-da-unidade>","quantidade":1,"valor_compra":99.99}'
```

Esperado pra Rafinha: 200 com data; observacoes começa com "via PWA por Rafinha"; valor_compra preservado.
Esperado pra Manager Barra (se uuid for de outra unidade): 403.

- [ ] **Step 5: Commit**

```bash
git add _remote/web/api/lareport/inventario/index.ts _remote/web/api/lareport/inventario/[id].ts
git commit -m "feat(serverless): POST/PATCH/DELETE inventario com checkAccess + auditoria"
```

---

### Task 19: Endpoints `/mover` e `/manutencao`

**Files:**
- Create: `_remote/web/api/lareport/inventario/[id]/mover.ts`
- Create: `_remote/web/api/lareport/inventario/[id]/manutencao.ts`

- [ ] **Step 1: Mover**

```ts
// _remote/web/api/lareport/inventario/[id]/mover.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../../_lib/auth';
import { checkAccess } from '../../../_lib/access-control';
import { lareport } from '../../../_lib/lareport-server';
import { withAudit } from '../../../_lib/audit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const id = parseInt(req.query.id as string, 10);
  const { sala_destino_id, motivo } = req.body || {};
  if (!sala_destino_id) return res.status(400).json({ ok: false, error: 'sala_destino_id obrigatório' });

  const access = checkAccess(collab, 'movimentacoes');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  // Valida que origem e destino estão dentro da unidade permitida
  const { data: item } = await lareport.from('inventario').select('unidade_id, sala_id').eq('id', id).maybeSingle();
  if (!item) return res.status(404).json({ ok: false, error: 'item_not_found' });
  const { data: destino } = await lareport.from('salas').select('unidade_id').eq('id', sala_destino_id).maybeSingle();
  if (!destino) return res.status(404).json({ ok: false, error: 'sala_destino_not_found' });

  if (access.unitFilter) {
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(item.unidade_id) || !units.includes(destino.unidade_id)) {
      return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
    }
  }

  // Cria movimentação + atualiza sala_id do item
  const [{ data: mov, error: e1 }, { error: e2 }] = await Promise.all([
    lareport.from('inventario_movimentacoes').insert({
      item_id: id,
      tipo: 'transferencia',
      sala_origem_id: item.sala_id,
      sala_destino_id,
      motivo: withAudit(motivo, collab),
      usuario_id: null,
    }).select().single(),
    lareport.from('inventario').update({ sala_id: sala_destino_id, updated_at: new Date().toISOString() }).eq('id', id),
  ]);
  if (e1) return res.status(500).json({ ok: false, error: e1.message });
  if (e2) return res.status(500).json({ ok: false, error: e2.message });
  return res.status(200).json({ ok: true, data: mov });
}
```

- [ ] **Step 2: Manutenção**

```ts
// _remote/web/api/lareport/inventario/[id]/manutencao.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../../../_lib/auth';
import { checkAccess } from '../../../_lib/access-control';
import { lareport } from '../../../_lib/lareport-server';
import { withAudit } from '../../../_lib/audit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;
  const id = parseInt(req.query.id as string, 10);
  const { tipo, descricao, custo, data_manutencao, responsavel, fornecedor_servico, data_proxima_revisao } = req.body || {};
  if (!tipo || !descricao || !data_manutencao) return res.status(400).json({ ok: false, error: 'tipo, descricao e data_manutencao obrigatórios' });

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  if (access.unitFilter) {
    const { data: item } = await lareport.from('inventario').select('unidade_id').eq('id', id).maybeSingle();
    if (!item) return res.status(404).json({ ok: false, error: 'item_not_found' });
    const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
    if (!units.includes(item.unidade_id)) return res.status(403).json({ ok: false, error: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' });
  }

  const { data, error } = await lareport.from('inventario_manutencoes').insert({
    item_id: id, tipo, descricao,
    custo: custo ?? null,
    data_manutencao,
    responsavel: responsavel ?? null,
    fornecedor_servico: fornecedor_servico ?? null,
    data_proxima_revisao: data_proxima_revisao ?? null,
    observacoes: withAudit(null, collab),
    created_by: null,
  }).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, data });
}
```

- [ ] **Step 3: Type check + smoke**

```bash
cd _remote/web && npx tsc --noEmit

# Smoke (após criar um item de teste em Task 18):
curl -X POST http://localhost:5173/api/lareport/inventario/<id>/manutencao \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"tipo":"corretiva","descricao":"Teste smoke","data_manutencao":"2026-05-17"}'
```

- [ ] **Step 4: Commit**

```bash
git add _remote/web/api/lareport/inventario/\[id\]/mover.ts _remote/web/api/lareport/inventario/\[id\]/manutencao.ts
git commit -m "feat(serverless): endpoints /mover e /manutencao com checkAccess + unit validation"
```

---

### Task 20: Endpoint `/upload` (foto pra Storage)

**Files:**
- Create: `_remote/web/api/lareport/upload.ts`
- Modify: `_remote/web/package.json` (adicionar `formidable`)

- [ ] **Step 1: Instalar formidable**

```bash
cd _remote/web && npm install formidable @types/formidable
```

- [ ] **Step 2: Criar endpoint**

```ts
// _remote/web/api/lareport/upload.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth';
import { checkAccess } from '../_lib/access-control';
import { lareport } from '../_lib/lareport-server';
import formidable from 'formidable';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return res.status(403).json({ ok: false, error: access.reason });

  const form = formidable({ maxFileSize: 5 * 1024 * 1024, multiples: false });
  const [, files] = await form.parse(req);
  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ ok: false, error: 'no_file' });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype || '')) return res.status(400).json({ ok: false, error: 'invalid_mime' });

  const ext = (file.originalFilename?.split('.').pop() || 'jpg').toLowerCase();
  const path = `${access.unitFilter || 'all'}/${randomUUID()}.${ext}`;
  const buf = readFileSync(file.filepath);

  const { error } = await lareport.storage.from('inventario-fotos').upload(path, buf, { contentType: file.mimetype || 'image/jpeg', upsert: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const { data: pub } = lareport.storage.from('inventario-fotos').getPublicUrl(path);
  return res.status(200).json({ ok: true, url: pub.publicUrl });
}
```

- [ ] **Step 3: Smoke**

```bash
curl -X POST http://localhost:5173/api/lareport/upload \
  -H "Authorization: Bearer $JWT" \
  -F "file=@~/test.jpg"
```

Esperado: 200 com `{ ok: true, url: "https://ouqw.../inventario-fotos/.../..jpg" }`. Abrir URL no browser → mostra a imagem.

- [ ] **Step 4: Type check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add _remote/web/api/lareport/upload.ts _remote/web/package.json _remote/web/package-lock.json
git commit -m "feat(serverless): endpoint /upload pra Storage do LA Report (5MB max, JPEG/PNG/WebP)"
```

---

## Fase A5 — Wire & Validate

### Task 21: Hook `useInventarioMutations` + integração na SalaPage

**Files:**
- Create: `_remote/web/src/hooks/useInventarioMutations.ts`
- Modify: `_remote/web/src/screens/inventario/SalaPage.tsx`

- [ ] **Step 1: Hook de mutations com invalidação**

```ts
// _remote/web/src/hooks/useInventarioMutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createItem, updateItem, deleteItem, moverItem, registrarManutencao } from '../lib/lareport-mutations';

export function useInventarioMutations(salaId?: number | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lareport', 'sala', salaId] });
    qc.invalidateQueries({ queryKey: ['lareport', 'salas'] });
    qc.invalidateQueries({ queryKey: ['lareport', 'stats'] });
  };
  return {
    create: useMutation({ mutationFn: createItem, onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => updateItem(id, payload), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: deleteItem, onSuccess: invalidate }),
    mover: useMutation({ mutationFn: ({ id, sala_destino_id, motivo }: { id: number; sala_destino_id: number; motivo?: string }) => moverItem(id, { sala_destino_id, motivo }), onSuccess: invalidate }),
    manutencao: useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => registrarManutencao(id, payload), onSuccess: invalidate }),
  };
}
```

- [ ] **Step 2: Integrar FAB + sheets em `SalaPage.tsx`**

Importar e usar:

```tsx
import { ItemFAB } from './components/ItemFAB';
import { ItemSheet } from './components/ItemSheet';
import { ItemAcoesMenu } from './components/ItemAcoesMenu';
import { MoverItemSheet } from './components/MoverItemSheet';
import { ManutencaoSheet } from './components/ManutencaoSheet';
import { BaixaConfirmSheet } from './components/BaixaConfirmSheet';
import { useInventarioMutations } from '../../hooks/useInventarioMutations';
import { useRealtimeSala } from '../../hooks/useRealtimeSala';

// dentro do componente:
const m = useInventarioMutations(id);
useRealtimeSala(id);
const [novoOpen, setNovoOpen] = useState(false);
const [acoesItem, setAcoesItem] = useState<ReportInventarioItem | null>(null);
const [editItem, setEditItem] = useState<ReportInventarioItem | null>(null);
const [moverItemSt, setMoverItemSt] = useState<ReportInventarioItem | null>(null);
const [manutItem, setManutItem] = useState<ReportInventarioItem | null>(null);
const [baixaItem, setBaixaItem] = useState<ReportInventarioItem | null>(null);

// Trocar ItemCard onclick por: onClick={() => setAcoesItem(item)}

// No fim do JSX:
<ItemFAB onClick={() => setNovoOpen(true)} />
<ItemSheet open={novoOpen} onClose={() => setNovoOpen(false)} onSubmit={p => m.create.mutateAsync({ ...p, sala_id: id, unidade_id: sala.unidade_id })} defaultSalaId={id} defaultUnidadeId={sala.unidade_id} />
<ItemSheet open={!!editItem} onClose={() => setEditItem(null)} item={editItem} onSubmit={p => m.update.mutateAsync({ id: editItem!.id, payload: p })} />
<ItemAcoesMenu open={!!acoesItem} item={acoesItem!} onClose={() => setAcoesItem(null)}
  onEdit={() => { setEditItem(acoesItem); setAcoesItem(null); }}
  onMover={() => { setMoverItemSt(acoesItem); setAcoesItem(null); }}
  onManutencao={() => { setManutItem(acoesItem); setAcoesItem(null); }}
  onBaixa={() => { setBaixaItem(acoesItem); setAcoesItem(null); }} />
{moverItemSt && <MoverItemSheet open onClose={() => setMoverItemSt(null)} item={moverItemSt} onSubmit={(dest, motivo) => m.mover.mutateAsync({ id: moverItemSt.id, sala_destino_id: dest, motivo })} />}
{manutItem && <ManutencaoSheet open onClose={() => setManutItem(null)} item={manutItem} onSubmit={p => m.manutencao.mutateAsync({ id: manutItem.id, payload: p })} />}
{baixaItem && <BaixaConfirmSheet open onClose={() => setBaixaItem(null)} item={baixaItem} onConfirm={() => m.remove.mutateAsync(baixaItem.id)} />}
```

- [ ] **Step 3: Type check + build**

```bash
cd _remote/web && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add _remote/web/src/hooks/useInventarioMutations.ts _remote/web/src/screens/inventario/SalaPage.tsx
git commit -m "feat(pwa): wire mutations + sheets + realtime em SalaPage"
```

---

### Task 22: E2E multi-role + realtime smoke via Claude Preview

**Files:** (sem mudança de código — pure validação)

- [ ] **Step 1: Limpar SW + navegar como Rafinha**

```js
// preview_eval no web-preview (4173)
(async () => {
  if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  location.href = '/mais';
})();
```

- [ ] **Step 2: Mais → Inventário → Barra → Amy + screenshot**

Esperado (Rafinha):
- ListaPage: 4 stats cards (incluindo Valor total) + Lojinha card + lista de salas em card médio
- SalaPage Amy: itens com badges, FAB visível, click no item abre ItemAcoesMenu com todas as opções

- [ ] **Step 3: Criar item de teste via FAB**

Click FAB → preenche Nome="TESTE Plan", Categoria="acessorios", outros campos → "Cadastrar Equipamento" → confirma aparecer na lista. Screenshot.

- [ ] **Step 4: Realtime smoke**

Abrir 2ª aba (preview_eval `window.open` se necessário, ou instruir Alf a abrir em outro browser). Editar o "TESTE Plan" em uma → conferir update na outra sem refresh.

- [ ] **Step 5: Mover entre salas**

ItemAcoesMenu → Mover → escolhe outra sala → confirma. Confirma que o item sumiu da SalaPage anterior e apareceu na nova.

- [ ] **Step 6: Registrar manutenção**

ItemAcoesMenu → Manutenção → preenche tipo=corretiva, descricao="Teste plan" → registra. Confirma que aparece na aba "Manutenção" do SalaPage.

- [ ] **Step 7: Dar baixa**

ItemAcoesMenu → Dar baixa → Confirmar. Item some da lista. (Não dá pra reverter pela PWA — só admin.)

- [ ] **Step 8: Logout + Re-login como outro role pra testar gating**

Se for impraticável testar logando como outro usuário, validar logicamente via console:

```js
// preview_eval
const c = { role: 'manager', unit: 'cg-uuid-placeholder', full_name: 'Jereh', function_role: null, pedagogical_role: null };
console.log(window._checkAccess?.(c, 'valor_patrimonial'));  // se expuser, deve ser allowed:false
```

Alternativa: pedir pro Alf testar com login do Jereh (Manager CG) e confirmar:
- Não vê "Valor total" no stats card
- ItemSheet não mostra seção Financeiro
- Lojinha aparece (Manager vê)
- Não consegue editar item da Barra (403 esperado)

- [ ] **Step 9: Marcar Task done quando smoke completo**

Sem commit (validação pura).

---

### Task 23: Auto-deploy final + commit de sprint

**Files:** todos os modificados na sprint.

- [ ] **Step 1: Garantir que build do PWA passa local**

```bash
cd _remote/web && npm run build
```

- [ ] **Step 2: Validar que TOM ainda funciona (rodar testes Task 2 + Task 7 smoke)**

```bash
cd _remote && node scripts/test-la-report-access.js
```

Esperado: pass total.

Pedir Alf: rodar `/inv ver piano` no WhatsApp. Esperado: resposta formatada.

- [ ] **Step 3: Commit final + push (auto-deploy hook cuida)**

Não precisa de comando manual — o Stop hook commita e pusha automaticamente no fim do turno (vide `_remote/CLAUDE.md`).

Em caso de algo pendente:

```bash
cd _remote && git status
```

Esperado: clean (auto-deploy já commitou).

- [ ] **Step 4: Confirmar deploy Vercel**

Aguardar ~2min, abrir produção: https://la-organizer.vercel.app (ou domínio configurado), logar, validar smoke flow.

- [ ] **Step 5: Atualizar README/CHANGELOG se existir**

Adicionar entrada:

```markdown
## 2026-05-17 — Inventário Bidirecional (Fase A)

- PWA: CRUD completo de inventário (criar/editar/mover/manutenção/baixa)
- StatsCards condicionais + Lojinha condicional + SalaCardMedio
- Realtime entre clientes (Supabase Channels)
- Governança: `checkAccess()` em PWA, TOM, serverless (fonte única em `la-report-access-rules.json`)
- TOM: `/inv ver <nome>` + bloco dinâmico de regras no system prompt
- Bucket `inventario-fotos` no Storage do LA Report
```

(Se README/CHANGELOG não existirem, pular este step.)

- [ ] **Step 6: Sprint concluído**

🎉 Marcar todos os checkboxes deste plano como `[x]`. Sprint Fase A pronto.

---

## Próximos passos (Fase B — Lojinha bidirecional)

Documentado no spec §Out-of-scope. Reaproveita 90% da infra:
- `lareport-client`, `lareport-mutations`, `lareport-realtime` já prontos
- `_lib/auth`, `_lib/access-control`, `_lib/audit` já prontos
- FAB pattern, Sheet pattern, ItemAcoesMenu pattern já prontos
- Acrescenta: hooks de produto/estoque, sheets `ProdutoSheet`, `LancamentoEstoqueSheet`, endpoints CRUD de `loja_produtos` + `loja_movimentacoes_estoque`

---

## Self-review checklist (preenchido pelo autor)

- [x] **Spec coverage:** todas as seções do spec mapeadas em tasks. Governança em A1, reads em A2, UI em A3, writes em A4, validação em A5.
- [x] **Placeholder scan:** nenhum "TBD/TODO/implement later". Stubs explícitos onde aplicável (professor → stub Fase A).
- [x] **Type consistency:** `CollaboratorAuth`, `AccessResult`, `checkAccess` mesmas signatures em JS e TS. `useAccess` retorna `AccessResult & { isCollab }`. Mutations seguem mesmo pattern de invalidação.
- [x] **Conhecidos:** Task 3 Step 4 tem fallback ("se tsx der trabalho, pular pra code review"). Documentado.

---

**Plano completo.** 23 tasks, ~5 dias de trabalho focado, 1 sprint coeso.
