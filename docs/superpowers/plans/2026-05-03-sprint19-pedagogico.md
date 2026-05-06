# Sprint 19 — Pedagógico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o departamento Pedagógico dentro da camada operacional replicável (Sprint 15) com hierarquia, subdomínio School/Kids e gate de alçada — sem novo módulo nem novo marker.

**Architecture:** 3 mudanças mínimas de schema, 3 helpers + 2 extensões de handler no engine, 1 skill nova carregada como auxiliar global, seed de 11 pessoas + 10 atribuições.

**Tech Stack:** Supabase (Postgres + RLS), Node.js engine, skills `.md` injected in system prompt.

---

## File Structure

| Arquivo | Ação | Por quê |
|---|---|---|
| `supabase` | **3 migrations** via Supabase MCP `apply_migration` | schema + seed |
| `src/engine.js` | **Modificar** | helpers `getPedagogicalRole`, `findPedagogicalAssignee`, `canDelegatePedagogical`, `scopeOverlap` + extensão de `applyTaskActions` (subdomain) e `applyCoordinationRequestAction` (gate pedagógico) |
| `skills/pedagogico.md` | **Criar** | skill auxiliar global ensinando hierarquia, request types, alçada |
| `src/prompts/system.js` | **Modificar** | loader do `pedagogico.md` (mesmo padrão de `coordenacao-conversacional.md`) |

---

## Task 1 — Fatia 1: Schema + Seed

**Estimativa:** 30min. Toca DB only. Sem deploy de código.

**Contexto:**
3 migrations + seed via Supabase MCP. Pré-condição: cada um dos 11 colaboradores listados em §4.2 do spec já existe em `collaborators` (validar antes de UPDATE).

- [ ] **Step 1.1 — Migration `add_pedagogical_columns_and_table`**

Aplicar via `mcp__supabase__apply_migration`:

```sql
ALTER TABLE tasks
  ADD COLUMN subdomain text
  CHECK (subdomain IS NULL OR subdomain IN ('school','kids'));

ALTER TABLE collaborators
  ADD COLUMN pedagogical_role text
  CHECK (pedagogical_role IS NULL OR pedagogical_role IN ('lead','assistant','mentor'));

CREATE TABLE pedagogical_assignments (
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  scope_type      text NOT NULL CHECK (scope_type IN ('unit','specialty','subdomain')),
  scope_value     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collaborator_id, scope_type, scope_value)
);
CREATE INDEX idx_ped_assignments_scope ON pedagogical_assignments(scope_type, scope_value);

ALTER TABLE pedagogical_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ped_assignments_read ON pedagogical_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY ped_assignments_write ON pedagogical_assignments
  FOR ALL TO authenticated
  USING (current_collab_role() IN ('coordinator','director'))
  WITH CHECK (current_collab_role() IN ('coordinator','director'));
```

Verificar: `\d tasks`, `\d collaborators`, `\d pedagogical_assignments`.

- [ ] **Step 1.2 — Validar pré-condição + criar faltantes (descoberto: só Juliana e Quintela existem)**

**OBSERVAÇÃO IMPORTANTE:** coluna é `full_name`, NÃO `name`.

```sql
SELECT full_name, phone, role, pedagogical_role
FROM collaborators
WHERE phone IN (
  '5521981708609','5521971751320','5521992053152','5521999715997',
  '5521986409985','5521978755351','5521981450588','5521997548859',
  '5521989366076','5521987375854','5521965736779'
);
```

Estado conhecido: apenas Juliana (5521981708609) e Quintela (5521971751320) presentes. Os 9 restantes **DEVEM** ser inseridos antes de qualquer UPDATE de `pedagogical_role` ou INSERT em `pedagogical_assignments`:

```sql
INSERT INTO collaborators (full_name, phone, role, is_active)
VALUES
  ('Leo',             '5521992053152', 'collaborator', true),
  ('Ramon',           '5521999715997', 'collaborator', true),
  ('Dai',             '5521986409985', 'collaborator', true),
  ('Matheus Felipe',  '5521978755351', 'collaborator', true),
  ('Jordan',          '5521981450588', 'collaborator', true),
  ('Rodrigo',         '5521997548859', 'collaborator', true),
  ('Peterson',        '5521989366076', 'collaborator', true),
  ('Kinho',           '5521987375854', 'collaborator', true),
  ('Renan',           '5521965736779', 'collaborator', true)
ON CONFLICT (phone) DO NOTHING;
```

Validar (esperado: 11 linhas):
```sql
SELECT count(*) FROM collaborators
WHERE phone IN ('5521981708609','5521971751320','5521992053152','5521999715997',
'5521986409985','5521978755351','5521981450588','5521997548859',
'5521989366076','5521987375854','5521965736779');
```

**SÓ APÓS 11/11 OK, prosseguir para Step 1.3.**

- [ ] **Step 1.3 — Seed: department `pedagogico` + 7 request types**

```sql
INSERT INTO departments (slug, name, description, is_active, unit_scope_enabled)
VALUES ('pedagogico', 'Pedagógico', 'Coordenação, professores e acompanhamento de alunos.', true, true)
ON CONFLICT (slug) DO UPDATE SET is_active = true, unit_scope_enabled = true;

WITH d AS (SELECT id FROM departments WHERE slug='pedagogico')
INSERT INTO department_request_types (department_id, slug, label, description, default_priority, requires_approval, generates_task)
SELECT d.id, rt.slug, rt.label, rt.description, rt.prio, false, true
FROM d, (VALUES
  ('acompanhamento-professor',     'Acompanhamento de professor',     'Performance, relatórios de aula, plano individual.',                'medium'),
  ('apoio-ao-aluno',               'Apoio ao aluno',                  'Falta recorrente, dificuldade pedagógica, ajuste de trilha.',       'high'),
  ('alinhamento-de-turma',         'Alinhamento de turma',            'Troca de aluno, mudança de professor, encaixe, redistribuição.',    'medium'),
  ('alinhamento-com-responsavel',  'Alinhamento com responsável',     'Orientação ao responsável sobre aluno.',                            'medium'),
  ('evento-pedagogico',            'Evento pedagógico',               'Banda, show, recital — preparação/acompanhamento (NÃO o evento).',  'medium'),
  ('pendencia-pedagogica',         'Pendência pedagógica',            'Pendência aberta no contexto pedagógico.',                          'medium'),
  ('suporte-ao-professor',         'Suporte ao professor',            'Material, infra, recurso pedagógico para o professor.',             'low')
) AS rt(slug, label, description, prio)
ON CONFLICT (department_id, slug) DO NOTHING;
```

Verificar:
```sql
SELECT slug, label, default_priority FROM department_request_types
WHERE department_id = (SELECT id FROM departments WHERE slug='pedagogico')
ORDER BY slug;
```
Esperado: 7 linhas.

- [ ] **Step 1.4 — Seed: pedagogical_role por telefone**

```sql
UPDATE collaborators SET pedagogical_role = 'lead'      WHERE phone IN ('5521981708609','5521971751320');
UPDATE collaborators SET pedagogical_role = 'assistant' WHERE phone IN ('5521992053152','5521999715997','5521986409985','5521978755351','5521981450588','5521997548859');
UPDATE collaborators SET pedagogical_role = 'mentor'    WHERE phone IN ('5521989366076','5521987375854','5521965736779');
```

Verificar:
```sql
SELECT name, phone, pedagogical_role FROM collaborators
WHERE pedagogical_role IS NOT NULL ORDER BY pedagogical_role, name;
```
Esperado: 2 lead + 6 assistant + 3 mentor = 11 linhas.

- [ ] **Step 1.5 — Seed: pedagogical_assignments**

```sql
INSERT INTO pedagogical_assignments (collaborator_id, scope_type, scope_value)
SELECT c.id, x.scope_type, x.scope_value
FROM collaborators c, (VALUES
  ('5521981708609','subdomain','school'),
  ('5521971751320','subdomain','kids'),
  ('5521978755351','subdomain','kids'),
  ('5521992053152','unit','Barra'),
  ('5521999715997','unit','Recreio'),
  ('5521999715997','specialty','bandas'),
  ('5521986409985','unit','Campo Grande'),
  ('5521981450588','specialty','eventos'),
  ('5521981450588','specialty','bateria'),
  ('5521997548859','specialty','cordas')
) AS x(phone, scope_type, scope_value)
WHERE c.phone = x.phone
ON CONFLICT DO NOTHING;
```

Verificar:
```sql
SELECT c.name, pa.scope_type, pa.scope_value
FROM pedagogical_assignments pa JOIN collaborators c ON c.id = pa.collaborator_id
ORDER BY c.name, pa.scope_type;
```
Esperado: 10 linhas.

- [ ] **Step 1.6 — Smoke test: estrutura completa**

```sql
SELECT
  (SELECT count(*) FROM departments WHERE slug='pedagogico') AS dept,
  (SELECT count(*) FROM department_request_types WHERE department_id=(SELECT id FROM departments WHERE slug='pedagogico')) AS rt,
  (SELECT count(*) FROM collaborators WHERE pedagogical_role IS NOT NULL) AS roles,
  (SELECT count(*) FROM pedagogical_assignments) AS assignments;
```
Esperado: `dept=1, rt=7, roles=11, assignments=10`.

---

## Task 2 — Fatia 2: Engine helpers + handler extensions

**Estimativa:** 60min. Toca `src/engine.js` apenas.

**Contexto:**
3 helpers novos + 1 helper interno + extensão de 2 handlers existentes. Reusa `supabase` do módulo.

- [ ] **Step 2.1 — Localizar a região de helpers no engine.js**

Buscar âncora: comentário `// Sprint 18` ou função `jaroWinkler`. Inserir helpers pedagógicos **antes** do bloco `applyTaskActions` (mesmo grupo de helpers da Sprint 18).

```bash
grep -n "function applyTaskActions\|function applyCoordinationRequestAction\|jaroWinkler" D:/la-organizer/_remote/src/engine.js
```

- [ ] **Step 2.2 — Inserir helpers pedagógicos**

```js
// ============================================================
// Sprint 19 — Camada Pedagógica: helpers de papel e alçada
// ============================================================

function getPedagogicalRole(collab) {
  return collab && collab.pedagogical_role ? collab.pedagogical_role : null;
}

// NOTA DE USO: helper de APOIO/LOOKUP, não automação opaca.
// A skill pedagogico.md tipicamente já resolve `assigned_to` por nome
// (ex.: "fala com o assistente da Barra" → Leo). Este helper só entra quando:
//   (a) a skill emite explicitamente um marker com {subdomain|unit|specialty} mas sem assigned_to, OU
//   (b) lookup interno do engine precisa validar/resolver um escopo.
// Não é chamado para "adivinhar" assignee em criação onde a skill já decidiu.
async function findPedagogicalAssignee({ subdomain, unit, specialty }) {
  const filters = [];
  if (subdomain) filters.push({ type: 'subdomain', value: subdomain });
  if (specialty) filters.push({ type: 'specialty', value: specialty });
  if (unit)      filters.push({ type: 'unit',      value: unit });
  for (const f of filters) {
    const { data } = await supabase
      .from('pedagogical_assignments')
      .select('collaborator_id')
      .eq('scope_type', f.type)
      .eq('scope_value', f.value)
      .limit(1);
    if (data && data.length) {
      const { data: c } = await supabase
        .from('collaborators').select('*').eq('id', data[0].collaborator_id).single();
      if (c) return c;
    }
  }
  return null;
}

async function scopeOverlap(idA, idB) {
  const { data: aSc } = await supabase
    .from('pedagogical_assignments')
    .select('scope_type, scope_value').eq('collaborator_id', idA);
  const { data: bSc } = await supabase
    .from('pedagogical_assignments')
    .select('scope_type, scope_value').eq('collaborator_id', idB);
  if (!aSc || !aSc.length || !bSc || !bSc.length) return false;
  return aSc.some(x => bSc.some(y => x.scope_type === y.scope_type && x.scope_value === y.scope_value));
}

// REGRA DE PRECEDÊNCIA: se este helper retornar false em contexto pedagógico,
// o gate genérico (Sprint 16) NÃO pode autorizar acima dele.
async function canDelegatePedagogical(requester, target) {
  if (!requester || !target) return false;
  const rRole = requester.role;
  const rPed  = getPedagogicalRole(requester);
  const tPed  = getPedagogicalRole(target);

  if (rRole === 'director' || rRole === 'coordinator') return true;
  if (rPed === 'mentor') return false;
  if (rPed === 'lead')   return true;
  if (rPed === 'assistant') {
    if (!tPed) return false;
    if (tPed === 'lead' || tPed === 'mentor') return false;
    if (tPed === 'assistant') return await scopeOverlap(requester.id, target.id);
  }
  return false;
}
```

- [ ] **Step 2.3 — Estender `applyTaskActions` create para aceitar `subdomain`**

Localizar o whitelist de campos em `applyTaskActions` (action create). Adicionar `subdomain` ao whitelist. Validar:

```js
// Dentro do bloco create — após validar department_id/request_type_id:
if (parsed.subdomain !== undefined) {
  if (parsed.subdomain !== null && !['school','kids'].includes(parsed.subdomain)) {
    return { ok: false, reason: 'invalid_subdomain', replyText: 'Subdomain inválido (use school/kids).' };
  }
  taskRow.subdomain = parsed.subdomain;
}
```

- [ ] **Step 2.4 — Estender `applyCoordinationRequestAction` com gate pedagógico**

Localizar a função e o ponto onde `parsed.mode` é verificado. **Antes** do gate genérico de Sprint 16 (collaborator não pode followup), inserir:

```js
// Sprint 19 — Gate pedagógico tem PRECEDÊNCIA sobre o gate genérico
if (parsed.mode === 'followup') {
  // Lookup do target — usar a mesma função que o handler já usa para resolver recipient
  const targetCollab = await lookupCollaboratorByName(parsed.recipient_name); // ajustar para nome real do helper de lookup
  const isPedContext = !!getPedagogicalRole(collab) || (targetCollab && !!getPedagogicalRole(targetCollab));
  if (isPedContext) {
    const ok = await canDelegatePedagogical(collab, targetCollab);
    if (!ok) {
      return {
        ok: false,
        reason: 'pedagogical_authority_denied',
        replyText: 'Esse tipo de cobrança precisa vir de quem tem alçada pedagógica para isso. Posso te ajudar a formular para mandar pra Juliana ou Quintela?'
      };
    }
  }
}
```

**Atenção:** o nome do helper de lookup pode variar (`resolveRecipient`, `findCollaboratorByName`, etc.). Verificar no engine.js antes de aplicar.

- [ ] **Step 2.5 — Verificar sintaxe**

```bash
node -c D:/la-organizer/_remote/src/engine.js && echo "syntax OK"
```

---

## Task 3 — Fatia 3: Skill `pedagogico.md`

**Estimativa:** 45min. Cria 1 arquivo novo.

- [ ] **Step 3.1 — Criar `D:/la-organizer/_remote/skills/pedagogico.md`**

Estrutura completa (copiar e ajustar):

````markdown
# Skill: Pedagógico

Você opera o departamento Pedagógico do LA Organizer — coordenação, professores, alunos, turmas, recitais.

## Quando usar

Frases que ativam esta skill (sempre carregada, mas estes são gatilhos típicos):
- aluno, professor, turma, recital, banda
- "kids", "school", "infantil", "avançado"
- nomes: Juliana, Quintela, Peterson, Kinho, Renan, Leo, Ramon, Dai, Matheus, Jordan, Rodrigo
- "coordenação pedagógica", "assistente da [unidade]"

## Hierarquia (alçada)

| Papel | Quem | Pode |
|---|---|---|
| `lead` (coordenação) | Juliana (school), Quintela (kids) | criar/delegar/cobrar qualquer pedagógico |
| `assistant` | Leo, Ramon, Dai, Matheus, Jordan, Rodrigo | abrir demanda, cobrar professor **no escopo** |
| `mentor` | Peterson, Kinho, Renan | orientar, abrir demanda — **nunca cobrar** |
| `teacher` (não-collaborator) | professores | abrir demanda via assistente/coord — **nunca cobra** |

## Subdomínio School ↔ Kids

- **School:** Juliana
- **Kids:** Quintela, Matheus Felipe
- Quando o pedido for ambíguo entre school/kids, **pergunte** antes de criar

## 7 tipos de demanda (request types)

| slug | quando |
|---|---|
| `acompanhamento-professor` | performance, relatório de aula, plano individual |
| `apoio-ao-aluno` | falta recorrente, dificuldade, ajuste de trilha |
| `alinhamento-de-turma` | troca de aluno, encaixe, redistribuição |
| `alinhamento-com-responsavel` | conversa com pai/mãe sobre o aluno |
| `evento-pedagogico` | banda, show, recital — **preparação/acompanhamento**, NÃO o evento em si |
| `pendencia-pedagogica` | pendência pedagógica genérica |
| `suporte-ao-professor` | material, infra, recurso para professor |

## Mapa de escopo

| Assistente | Escopo |
|---|---|
| Leo | unidade Barra |
| Ramon | unidade Recreio + bandas |
| Dai | unidade Campo Grande |
| Matheus Felipe | subdomain Kids |
| Jordan | eventos + bateria |
| Rodrigo | cordas |

Para "fala com o assistente da Barra" → Leo. "Assistente de cordas" → Rodrigo. Etc.

## Regra de precedência de gate (NÃO NEGOCIÁVEL)

Se a regra pedagógica negar uma cobrança (`followup`), a regra genérica de coordenação **NÃO autoriza** acima dela. O gate pedagógico é restritivo e tem precedência.

## Regra de match de escopo para `assistant`

Para um assistente cobrar outro assistente (caso raro mas válido), basta **1 match** em qualquer eixo:
- mesma unidade **OU**
- mesma especialidade **OU**
- mesmo subdomínio

## Markers que você emite

### Criação de demanda → `<<TASK_UPDATE>>`

```
<<TASK_UPDATE>>
{
  "action": "create",
  "title": "Relatório de aula do Prof. Tal",
  "department_id": "<uuid_pedagogico>",
  "request_type_id": "<uuid_acompanhamento_professor>",
  "subdomain": "school",
  "assigned_to": "<uuid_juliana_ou_assistente>",
  "description": "Acompanhamento solicitado por Alf. Originada com Prof. Tal."
}
<<END>>
```

`subdomain` é opcional (pode ser null se a demanda não for school/kids específica).

### Cobrança/relay → `<<COORDINATION_REQUEST>>`

Use o marker padrão da skill `coordenacao-conversacional.md`. **Antes de emitir followup**, verifique alçada:
- mentor/teacher → recuse
- assistant → confirme escopo (1 match basta)

## Exemplos canônicos

**1. "cobra o professor X sobre o relatório de aula"**
- Requester: assistente ou coord
- Mode: depende — se é "lembra ele de mandar" → relay_assisted; se é "preciso saber se ele vai entregar" → followup
- Para assistant, validar escopo (mesma unidade do prof X)

**2. "alinha com a Juliana o planejamento do recital"**
- Cria task `evento-pedagogico` com `subdomain=school`, `assigned_to=Juliana`
- OU emite relay_assisted para Juliana, dependendo do tom

**3. "isso é Kids, leva pro Quintela"**
- Cria task com `subdomain=kids`, `assigned_to=Quintela`
- Se já houver task aberta no contexto → mover via update (não create novo)

**4. "abre uma pendência pedagógica do aluno Y"**
- Cria task `pendencia-pedagogica`, infere subdomínio pelo contexto do aluno; se ambíguo, pergunta

**5. "fala com o assistente pedagógico da Barra"**
- Resolve via mapa de escopo: Leo (Barra)
- Emite relay_assisted ou followup conforme intent

**6. "professor tal está precisando de material"**
- Cria task `suporte-ao-professor`, `assigned_to=lead do subdomínio` (Juliana ou Quintela)

## Não faça

- NÃO crie entrada em `events` para `evento-pedagogico` — é só task
- NÃO trate professor como collaborator — quem registra é o assistente/coord
- NÃO emita followup quando requester é mentor (Peterson/Kinho/Renan) ou teacher
- NÃO contorne o gate pedagógico via fallback genérico — DENY pedagógico é DENY final
````

- [ ] **Step 3.2 — Validar tamanho e ASCII**

```bash
wc -c D:/la-organizer/_remote/skills/pedagogico.md
file D:/la-organizer/_remote/skills/pedagogico.md
```
Esperado: 5-7K caracteres, UTF-8 sem BOM.

---

## Task 4 — Fatia 4: Loader em system.js

**Estimativa:** 15min.

- [ ] **Step 4.1 — Localizar loader das skills auxiliares globais**

```bash
grep -n "coordenacao-conversacional\|integridade-agenda" D:/la-organizer/_remote/src/prompts/system.js
```

- [ ] **Step 4.2 — Adicionar loader pedagógico análogo**

Após o último loader auxiliar global (provavelmente `integridade-agenda`), adicionar bloco análogo:

```js
// Sprint 19 — Skill Pedagógica (auxiliar global, todos os roles)
const pedagogicoPath = path.join(skillsDir, 'pedagogico.md');
if (fs.existsSync(pedagogicoPath)) {
  systemPrompt += '\n\n' + fs.readFileSync(pedagogicoPath, 'utf8');
}
```

- [ ] **Step 4.3 — Verificar duplicação no `composeSystemPrompt` (versão sync)**

`system.js` tem duas versões do builder (sync via composeSystemPrompt + async). Garantir que o loader entra nas DUAS, espelhando o padrão das outras skills auxiliares globais.

- [ ] **Step 4.4 — Verificar sintaxe**

```bash
node -c D:/la-organizer/_remote/src/prompts/system.js && echo "syntax OK"
```

---

## Task 5 — Fatia 5: Bundle deploy + smoke E2E

**Estimativa:** 45min. Padrão Sprint 18 (clone temporário).

- [ ] **Step 5.1 — Smoke local (sintaxe + carregamento)**

```bash
node -c D:/la-organizer/_remote/src/engine.js
node -c D:/la-organizer/_remote/src/prompts/system.js
ls -lh D:/la-organizer/_remote/skills/pedagogico.md
grep -c "pedagogico\|pedagogical_role\|canDelegatePedagogical" D:/la-organizer/_remote/src/engine.js
grep -c "pedagogico" D:/la-organizer/_remote/src/prompts/system.js
```
Esperado: syntax OK x2, skill ~6K, engine ≥10 ocorrências, system.js ≥2.

- [ ] **Step 5.2 — Bundle deploy via clone temporário**

```bash
cd /tmp && rm -rf la-organizer-deploy
git clone https://github.com/LucianoAlf/LA-Organizer.git la-organizer-deploy
cp D:/la-organizer/_remote/src/engine.js          /tmp/la-organizer-deploy/src/engine.js
cp D:/la-organizer/_remote/src/prompts/system.js  /tmp/la-organizer-deploy/src/prompts/system.js
cp D:/la-organizer/_remote/skills/pedagogico.md   /tmp/la-organizer-deploy/skills/pedagogico.md
cd /tmp/la-organizer-deploy && git status --short && git diff --stat
```

- [ ] **Step 5.3 — Commit + push**

```bash
cd /tmp/la-organizer-deploy
git add src/engine.js src/prompts/system.js skills/pedagogico.md
git commit -m "feat(sprint19): camada pedagogica — schema + helpers + skill + gate

- migrations: tasks.subdomain, collaborators.pedagogical_role, pedagogical_assignments
- engine helpers: getPedagogicalRole, findPedagogicalAssignee, scopeOverlap, canDelegatePedagogical
- gate pedagogico tem PRECEDENCIA sobre gate generico (Sprint 16): DENY pedagogico = DENY final
- regra de match de escopo: 1 match (unit OR specialty OR subdomain) autoriza assistant
- skill pedagogico.md como auxiliar global (todos os roles)
- 7 request types iniciais
- seed: 11 colaboradores com pedagogical_role + 10 assignments

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
rm -rf /tmp/la-organizer-deploy
```

- [ ] **Step 5.4 — VPS pull + restart (manual via user)**

User executa: `ssh tom "cd /opt/LA-Organizer && git pull origin main && pm2 restart all"`

- [ ] **Step 5.5 — Smoke E2E: 6 casos PRD §7 verbatim**

Cada caso enviado via WhatsApp e validado em logs/Supabase:

| # | Mensagem (Alf) | Esperado |
|---|---|---|
| 1 | "TOM, cobra o Prof. Y sobre o relatório de aula" | task `acompanhamento-professor` criada OR relay para assistente; gate respeita alçada |
| 2 | "TOM, alinha com a Juliana o planejamento do recital" | task `evento-pedagogico` `subdomain=school` `assigned_to=Juliana` OR relay_assisted Juliana |
| 3 | "TOM, isso é Kids, leva pro Quintela" | task assigned a Quintela com `subdomain=kids` |
| 4 | "TOM, abre uma pendência pedagógica do aluno Z" | task `pendencia-pedagogica`; se ambíguo school/kids, TOM pergunta antes |
| 5 | "TOM, fala com o assistente pedagógico da Barra" | resolve para Leo via `pedagogical_assignments(unit=Barra)` |
| 6 | "TOM, professor tal está precisando de material" | task `suporte-ao-professor`, `assigned_to` = lead do subdomínio inferido |

- [ ] **Step 5.6 — Smoke E2E negativo (gate pedagógico)**

| # | Cenário | Esperado |
|---|---|---|
| N1 | Mentor (Peterson) tenta `followup` qualquer pedagógico | recusa com `pedagogical_authority_denied` |
| N2 | Assistente (Leo) tenta `followup` outro assistente fora de escopo (Rodrigo, cordas) | recusa (sem match de escopo) |
| N3 | Assistente (Ramon, Recreio+bandas) tenta `followup` Jordan (eventos+bateria) | depende — sem overlap em unit/specialty/subdomain → recusa |
| N4 | Lead (Juliana) tenta `followup` qualquer assistente | autoriza |

- [ ] **Step 5.7 — Smoke SQL pós-deploy**

```sql
-- Confirmar que tasks Pedagógicas estão sendo criadas com department_id correto
SELECT t.title, t.subdomain, drt.slug AS req_type, c.name AS assignee
FROM tasks t
JOIN department_request_types drt ON drt.id = t.request_type_id
JOIN departments d ON d.id = drt.department_id
LEFT JOIN collaborators c ON c.id = t.assigned_to
WHERE d.slug = 'pedagogico'
ORDER BY t.created_at DESC LIMIT 10;
```

---

## Self-Review (do plano)

- [x] Spec coverage: schema (T1), engine (T2), skill (T3), loader (T4), deploy+E2E (T5) — todas as seções §3-§7 do spec mapeadas
- [x] No placeholders: cada step tem comando ou código completo
- [x] Type consistency: `subdomain text`, `pedagogical_role text`, `scope_type text` consistentes em migration → helper → skill
- [x] Regras explícitas (precedência + match de escopo) aparecem em §7 do spec, no código (T2.2/T2.4) e na skill (T3.1)

## Riscos do plano

- **Lookup de target em `applyCoordinationRequestAction` (T2.4)** — nome real do helper precisa ser confirmado no engine antes da inserção. Plano marca atenção.
- **Pré-condição T1.2** — se algum dos 11 telefones não existir, parar e criar antes de seedar role.
- **T4.3** — se o `composeSystemPrompt` sync existir paralelo ao async, esquecer de espelhar quebra alguns paths.
