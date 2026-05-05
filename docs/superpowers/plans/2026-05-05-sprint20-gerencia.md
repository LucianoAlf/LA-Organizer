# Sprint 20 — Camada de Gerência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox `- [ ]` syntax.

**Goal:** Implementar departamento Gerência com seed (sem schema novo), skill de roteamento inteligente, helper de unidade, mensagem custom do gate pedagógico para manager, branch pickSkill restrito e extensão da PWA.

**Architecture:** zero migrations. 1 helper engine (`findAssistantByUnit`), 1 ajuste de mensagem em `applyCoordinationRequestAction`, 1 skill nova, 1 branch pickSkill, 1 branch PWA Q3. Reúsa Sprint 15/16/19.

**Tech Stack:** Supabase (Postgres + RLS existente), Node.js engine, skills `.md`, React PWA.

---

## File Structure

| Arquivo | Ação | Por quê |
|---|---|---|
| `supabase` | seed via Supabase MCP `execute_sql` | dept gerencia + 8 request types + 3 INSERT collaborators |
| `src/engine.js` | **Modificar** | helper `findAssistantByUnit` + ajuste mensagem manager no gate pedagógico |
| `skills/gerencia.md` | **Criar** | skill primary com 6 exemplos + UUIDs reais |
| `src/prompts/system.js` | **Modificar** | pickSkill Priority 4.65 |
| `web/src/screens/OperacoesFilaTecnica.tsx` | **Modificar** | Q3 branch para `dept.slug === 'gerencia'` |

---

## Task 1 — Fatia 1: Seed Gerência (DB only)

**Estimativa:** 20min.

- [ ] **Step 1.1 — Pré-validação: confirmar 3 phones livres + dept livre**

Via Supabase MCP `execute_sql`:
```sql
SELECT 'phones_used' AS check, count(*) AS n
FROM collaborators
WHERE phone IN ('5521985525984','5521990450802','5521966875271')
UNION ALL
SELECT 'gerencia_exists' AS check, count(*) AS n FROM departments WHERE slug='gerencia';
```
Esperado: `phones_used=0, gerencia_exists=0`. Se algum diferente, parar e reportar.

- [ ] **Step 1.2 — Seed department + 8 request types**

```sql
INSERT INTO departments (slug, name, description, is_active, unit_scope_enabled)
VALUES ('gerencia', 'Gerência', 'Gestão relacional da unidade — retenção, experiência, atendimento, articulação.', true, true)
ON CONFLICT (slug) DO UPDATE SET is_active = true, unit_scope_enabled = true;

WITH d AS (SELECT id FROM departments WHERE slug='gerencia')
INSERT INTO department_request_types (department_id, slug, label, description, default_priority, requires_approval, generates_task)
SELECT d.id, rt.slug, rt.label, rt.description, rt.prio, false, true
FROM d, (VALUES
  ('risco-de-evasao',            'Risco de evasão',           'Aluno em risco de saída — sinais de cansaço, queda de frequência, descontentamento.', 'high'),
  ('recuperacao-de-aluno',       'Recuperação de aluno',      'Reativação, reconquista, reaproximação estruturada.',                                  'high'),
  ('alinhamento-com-responsavel','Alinhamento com responsável (Gerência)', 'Contato com pai/mãe no contexto de retenção/experiência (não pedagógico).',  'medium'),
  ('problema-de-atendimento',    'Problema de atendimento',   'Falha de recepção, atendimento, comunicação inicial.',                                 'high'),
  ('experiencia-da-unidade',     'Experiência da unidade',    'Conflito de experiência, percepção ruim, ajuste de jornada do aluno na unidade.',     'medium'),
  ('negociacao-relacional',      'Negociação relacional',     'Negociação sensível de permanência, conversa difícil estruturada.',                    'high'),
  ('pendencia-gerencial',        'Pendência gerencial',       'Pendência aberta no contexto gerencial — coringa controlado.',                         'medium'),
  ('articulacao-interna',        'Articulação interna',       'Mobilizar múltiplas áreas (recepção, secretaria, coordenação, atendimento, comercial).', 'medium')
) AS rt(slug, label, description, prio)
ON CONFLICT (department_id, slug) DO NOTHING;
```

Validar: `SELECT count(*) FROM department_request_types WHERE department_id=(SELECT id FROM departments WHERE slug='gerencia');` → 8.

- [ ] **Step 1.3 — INSERT 3 gerentes**

```sql
INSERT INTO collaborators (full_name, phone, role, unit, is_active, onboarding_completed)
VALUES
  ('Jereh',   '5521985525984', 'manager', 'campo_grande', true, false),
  ('Clayton', '5521990450802', 'manager', 'recreio',      true, false),
  ('Krissya', '5521966875271', 'manager', 'barra',        true, false)
ON CONFLICT (phone) DO NOTHING
RETURNING full_name, phone, role, unit;
```

Esperado: 3 linhas retornadas.

- [ ] **Step 1.4 — Smoke validação (UUIDs do dept + 8 request types)**

```sql
SELECT 'department' AS kind, slug, id::text FROM departments WHERE slug='gerencia'
UNION ALL
SELECT 'request_type' AS kind, drt.slug, drt.id::text
FROM department_request_types drt JOIN departments d ON d.id=drt.department_id
WHERE d.slug='gerencia'
ORDER BY kind, slug;
```

**Capturar os 9 UUIDs (1 dept + 8 rt) — vão ser embutidos na skill `gerencia.md` no F3.**

```sql
SELECT
  (SELECT count(*) FROM departments WHERE slug='gerencia') AS dept,
  (SELECT count(*) FROM department_request_types WHERE department_id=(SELECT id FROM departments WHERE slug='gerencia')) AS rt,
  (SELECT count(*) FROM collaborators WHERE role='manager') AS managers_total,
  (SELECT count(*) FROM collaborators WHERE role='manager' AND unit IN ('campo_grande','recreio','barra')) AS managers_unidade;
```

Esperado: `dept=1, rt=8, managers_total=4, managers_unidade=3`.

---

## Task 2 — Fatia 2: Engine helpers + ajuste mensagem manager

**Estimativa:** 30min.

- [ ] **Step 2.1 — Inserir helper `findAssistantByUnit` em `src/engine.js`**

Local: junto aos helpers Sprint 19 (`getPedagogicalRole`, `findPedagogicalAssignee`, `scopeOverlap`, `canDelegatePedagogical`). Inserir DEPOIS de `findPedagogicalAssignee`:

```js
// Sprint 20 — resolve assistente pedagógico da unidade do gerente.
// Ponte snake_case (collaborators.unit) → Title Case (pedagogical_assignments.scope_value).
const UNIT_DB_TO_PEDAG_SCOPE = {
  'campo_grande': 'Campo Grande',
  'recreio':      'Recreio',
  'barra':        'Barra',
};

async function findAssistantByUnit(unitDb) {
  const scope = UNIT_DB_TO_PEDAG_SCOPE[unitDb];
  if (!scope) return null;
  const { data } = await supabase
    .from('pedagogical_assignments')
    .select('collaborator_id')
    .eq('scope_type', 'unit')
    .eq('scope_value', scope)
    .limit(1);
  if (!data || !data.length) return null;
  const { data: c } = await supabase
    .from('collaborators').select('*').eq('id', data[0].collaborator_id).single();
  return c || null;
}
```

- [ ] **Step 2.2 — Localizar o gate pedagógico em `applyCoordinationRequestAction`**

```bash
grep -n "pedagogical_authority_denied" D:/la-organizer/_remote/src/engine.js
```

Esperado: 1 ocorrência (na linha onde `return` com esse `reason`).

- [ ] **Step 2.3 — Customizar mensagem para manager**

Substituir o bloco de `return` do gate por:

```js
if (!ok) {
  let replyText = 'Esse tipo de cobrança precisa vir de quem tem alçada pedagógica para isso. Posso te ajudar a formular para mandar pra Juliana ou Quintela?';
  if (collab.role === 'manager') {
    const assistente = await findAssistantByUnit(collab.unit);
    const assistName = assistente ? assistente.full_name.split(' ')[0] : 'o assistente da unidade';
    replyText = `Como gerente, você não cobra (followup) o pedagógico — você encaminha (relay).\n\nQuer que eu mande como recado para *${assistName}* (assistente pedagógico da sua unidade) ou direto para *Juliana* (LA Music School) ou *Quintela* (LA Music Kids)?`;
  }
  return {
    ok: false,
    reason: 'pedagogical_authority_denied',
    replyText,
  };
}
```

- [ ] **Step 2.4 — Verificar sintaxe + grep helpers**

```bash
node -c D:/la-organizer/_remote/src/engine.js && echo "syntax OK"
grep -c "findAssistantByUnit\|UNIT_DB_TO_PEDAG_SCOPE" D:/la-organizer/_remote/src/engine.js
```

Esperado: syntax OK, count ≥ 3 (1 const + 1 função + 1 chamada).

---

## Task 3 — Fatia 3: Skill `gerencia.md`

**Estimativa:** 40min.

- [ ] **Step 3.1 — Buscar UUIDs do seed F1 e embutir na skill**

Via Supabase MCP query do Step 1.4. Anotar:
- `<UUID-gerencia>` = id do department
- 8 UUIDs dos request types

- [ ] **Step 3.2 — Criar `D:/la-organizer/_remote/skills/gerencia.md`**

Estrutura (~6KB):

````markdown
# Skill: Gerência

Captura demandas gerenciais (retenção, experiência da unidade, atendimento, articulação interna) e roteia inteligentemente: trata direto, encaminha para pedagógico, aciona comercial/financeiro/marketing, ou articula múltiplas áreas. Emite `<<TASK_UPDATE>>` (criação) ou `<<COORDINATION_REQUEST>>` (relay/cobrança operacional).

---

## Quando usar

Gatilhos: risco de evasão, retenção, recuperação de aluno, experiência da unidade, problema de atendimento, recepção, secretaria, pré-atendimento, articulação interna, "aciona a gerência", nomes Jereh/Clayton/Krissya, "pai insatisfeito", "pai querendo sair", negociação de permanência.

NÃO ative para: aprendizado, plano de aula, relatório de aula, trilha do aluno, recital, banda — esses são pedagógicos (skill `pedagogico.md`).

---

## UUIDs do departamento (use **exatos**)

**`department_id` (Gerência):** `<UUID-gerencia>`

**`request_type_id` por slug:**

| slug | request_type_id |
|---|---|
| `risco-de-evasao` | `<UUID>` |
| `recuperacao-de-aluno` | `<UUID>` |
| `alinhamento-com-responsavel` | `<UUID>` |
| `problema-de-atendimento` | `<UUID>` |
| `experiencia-da-unidade` | `<UUID>` |
| `negociacao-relacional` | `<UUID>` |
| `pendencia-gerencial` | `<UUID>` |
| `articulacao-interna` | `<UUID>` |

---

## Princípio do filtro inteligente

O gerente é o **primeiro filtro da unidade**. Quando uma demanda chega, ele avalia e decide um de 3 caminhos:

1. **Trata direto** — retenção, experiência, atendimento, articulação interna
2. **Encaminha (relay) para pedagógico** — aprendizado, plano de aula, professor com dificuldade, conflito pedagógico
3. **Aciona outras áreas** — comercial puro, financeiro, marketing

> Gerente NÃO resolve demandas pedagógicas sozinho. Ele articula e roteia.

---

## Mapa de gerentes por unidade

| Gerente | Unidade | role | unit |
|---|---|---|---|
| Jereh | Campo Grande | manager | campo_grande |
| Clayton | Recreio (interino) | manager | recreio |
| Krissya | Barra | manager | barra |

**Distinção importante:** Yuri também é `manager`, mas com `unit='all'` — ele lidera Marketing, NÃO é gerente de unidade. Não confundir.

---

## Fronteira com Pedagógico (NÃO NEGOCIÁVEL)

- Gerente NUNCA emite `followup` para alguém com `pedagogical_role` (lead/assistant/mentor)
- Gerente sempre usa `relay_assisted` para pedagógico — encaminha, não cobra
- O gate pedagógico do engine bloqueia followup. Quando isso acontecer, TOM oferece relay como alternativa
- Quando demanda chega ao gerente e é claramente pedagógica, **sugira encaminhamento**: assistente da unidade ou coordenação (Juliana/Quintela)

---

## 8 tipos de demanda

| slug | quando |
|---|---|
| `risco-de-evasao` | sinais de saída — cansaço, faltas, descontentamento |
| `recuperacao-de-aluno` | reativação/reconquista de aluno |
| `alinhamento-com-responsavel` | pai/mãe no contexto de retenção/experiência |
| `problema-de-atendimento` | falha de recepção/atendimento/comunicação |
| `experiencia-da-unidade` | conflito de experiência, percepção ruim |
| `negociacao-relacional` | conversa difícil estruturada de permanência |
| `pendencia-gerencial` | coringa controlado |
| `articulacao-interna` | mobilizar 2+ áreas (recepção, secretaria, coord, atendimento) |

---

## Diferenciação `alinhamento-com-responsavel`

Existe nos dois departamentos. Diferença de natureza:
- **Pedagógico** → devolutiva sobre aprendizado, plano, trilha
- **Gerência** → experiência/retenção/insatisfação

Use o contexto da frase do user para decidir.

---

## Markers

### Criação → `<<TASK_UPDATE>>`

```
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "<título curto>",
  "description": "<contexto: pai/aluno/situação>",
  "to_name": "<gerente da unidade>",
  "due_date": "<YYYY-MM-DD>",
  "priority": "<critical|high|medium|low>",
  "context": "work",
  "department_id": "<UUID-gerencia>",
  "request_type_id": "<UUID do tipo escolhido>",
  "notes": "Origem: <quem reportou>."
}]
<<END>>
```

### Encaminhamento pedagógico → `<<COORDINATION_REQUEST>>` (sempre relay_assisted)

```
<<COORDINATION_REQUEST>>
{
  "recipient_name": "<assistente da unidade ou Juliana/Quintela>",
  "mode": "relay_assisted",
  "message_body": "<texto do encaminhamento>",
  "message_original": "<texto original do gerente>",
  "expects_response": true,
  "response_deadline_hours": 24
}
<<END>>
```

**NUNCA emita `mode: "followup"` para alvo com `pedagogical_role`.** O gate bloqueia.

---

## 6 exemplos canônicos

### Ex.1 — "esse aluno está em risco de evasão" (Krissya, Barra)
- Tipo: `risco-de-evasao`, prioridade `high`
- Marker: `TASK_UPDATE` com `to_name="Krissya"`, contexto da unidade Barra
- TOM pode perguntar nome do aluno e contexto se faltar

### Ex.2 — "fala com a Krissya sobre esse pai insatisfeito"
- Modo: `relay_assisted` para Krissya
- Marker: `COORDINATION_REQUEST` com `recipient_name="Krissya"`, mode=relay_assisted
- Krissya é gerente da Barra → resolve via nome ou unit

### Ex.3 — "pai reclamando que o filho não aprende" (Jereh, Campo Grande recebe)
- Avaliação: claramente pedagógico
- TOM sugere: "Isso parece pedagógico. Encaminho pra Dai (assistente Campo Grande) ou direto pra Juliana (LA Music School) / Quintela (LA Music Kids)?"
- Após confirmação: `COORDINATION_REQUEST` mode=relay_assisted para o destinatário escolhido
- NÃO criar task em gerência; pedagogico cuida

### Ex.4 — "isso virou problema de atendimento" (Clayton, Recreio)
- Tipo: `problema-de-atendimento`, prioridade `high`
- Marker: `TASK_UPDATE` com `to_name="Clayton"`

### Ex.5 — "preciso articular recepção, secretaria e coordenação"
- Tipo: `articulacao-interna`, prioridade `medium`
- Marker: `TASK_UPDATE` com gerente da unidade do contexto

### Ex.6 — "aciona a gerência da Barra"
- Resolve por unit: Barra → Krissya
- Modo: `relay_assisted` para Krissya
- Marker: `COORDINATION_REQUEST` com `recipient_name="Krissya"`

---

## Não faça

- NÃO emita followup para mentor/lead/assistant pedagógico — sempre relay_assisted
- NÃO crie task em `gerencia` quando o caso é claramente pedagógico — encaminhe
- NÃO confunda Yuri (manager+all/Marketing) com gerente de unidade
- NÃO use `articulacao-interna` para casos simples — só para mobilizar 2+ áreas
````

- [ ] **Step 3.3 — Substituir placeholders pelos UUIDs reais**

Após criar o arquivo com placeholders `<UUID-...>`, fazer Edit substituindo cada placeholder pelo UUID real capturado no Step 1.4.

- [ ] **Step 3.4 — Validação tamanho + markers corretos**

```bash
wc -c D:/la-organizer/_remote/skills/gerencia.md
grep -c "<<TASK_UPDATE>>\|<<COORDINATION_REQUEST>>\|<<END>>" D:/la-organizer/_remote/skills/gerencia.md
grep -c "<</TASK_UPDATE>>\|<</COORDINATION_REQUEST>>" D:/la-organizer/_remote/skills/gerencia.md
grep -c "<UUID-" D:/la-organizer/_remote/skills/gerencia.md
```

Esperado: 5K-8K, markers corretos ≥ 4, markers errados = 0, placeholders restantes = 0.

---

## Task 4 — Fatia 4: pickSkill branch 4.65

**Estimativa:** 10min.

- [ ] **Step 4.1 — Localizar Priority 4.7 (pedagogico) em system.js**

```bash
grep -n "Priority 4.7: contexto PEDAGÓGICO\|Priority 4.65" D:/la-organizer/_remote/src/prompts/system.js
```

- [ ] **Step 4.2 — Inserir Priority 4.65 ANTES de Priority 4.7**

```js
// Sprint 20 — Priority 4.65: contexto GERENCIAL EXPLÍCITO.
// Gatilhos restritos para não roubar casos pedagógicos (que vencem em 4.7).
// Frases com "aluno"/"responsável" SEM qualificador gerencial caem em pedagogico abaixo.
if (/(\brisco\s+de\s+evas|\bevas[ãa]o\b|\bretenç[ãa]o\b|\brecuperaç[ãa]o\s+(?:de\s+)?aluno|\bexperi[êe]ncia\s+da\s+unidade|\bproblema\s+de\s+atendimento|\barticul(?:ar|ação)\s+(?:recepç|secretari|coord)|\bgerente\b|\bgerência\b|\bjereh\b|\bclayton\b|\bkrissya\b|\bnegoci(?:ar|ação)\s+(?:permanência|sa[ií]da)|\bpai\s+(?:insatisfeito|querendo\s+sair|reclamando\s+do\s+atendimento)|\baciona\s+(?:a\s+)?ger[êe]ncia|\brecepç[ãa]o\b|\bsecretari[ao]\b|\bpr[ée][\s-]?atendimento)/i.test(lastUserMessage || '')) {
  return { name: 'gerencia', body: loadSkill('gerencia') };
}
```

- [ ] **Step 4.3 — Verificar sintaxe**

```bash
node -c D:/la-organizer/_remote/src/prompts/system.js && echo "syntax OK"
grep -c "gerencia" D:/la-organizer/_remote/src/prompts/system.js
```

Esperado: syntax OK, count ≥ 1.

---

## Task 5 — Fatia 5: PWA filtro Responsável

**Estimativa:** 10min.

- [ ] **Step 5.1 — Localizar Q3 deptAssignees em OperacoesFilaTecnica.tsx**

```bash
grep -n "dept-assignees\|dept.slug === 'pedagogico'" D:/la-organizer/_remote/web/src/screens/OperacoesFilaTecnica.tsx
```

- [ ] **Step 5.2 — Adicionar branch `gerencia` no Q3**

Antes do `return [];` final do queryFn:

```ts
if (dept.slug === 'gerencia') {
  const { data, error } = await supabase
    .from('collaborators')
    .select('id, full_name, role, unit')
    .in('role', ['manager', 'coordinator', 'director'])
    .eq('is_active', true)
    .order('full_name');
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; full_name: string }>;
}
```

- [ ] **Step 5.3 — Verificar sintaxe (mental — Vercel build vai validar)**

```bash
grep -c "dept.slug === 'gerencia'" D:/la-organizer/_remote/web/src/screens/OperacoesFilaTecnica.tsx
```

Esperado: 1.

---

## Task 6 — Fatia 6: Bundle deploy + smoke E2E

**Estimativa:** 30min.

- [ ] **Step 6.1 — Smoke local**

```bash
node -c D:/la-organizer/_remote/src/engine.js
node -c D:/la-organizer/_remote/src/prompts/system.js
ls -lh D:/la-organizer/_remote/skills/gerencia.md
```

- [ ] **Step 6.2 — Bundle deploy via clone temporário**

```bash
cd /tmp && rm -rf la-organizer-deploy
git clone --depth 1 https://github.com/LucianoAlf/LA-Organizer.git la-organizer-deploy
cp D:/la-organizer/_remote/src/engine.js                                  /tmp/la-organizer-deploy/src/engine.js
cp D:/la-organizer/_remote/src/prompts/system.js                          /tmp/la-organizer-deploy/src/prompts/system.js
cp D:/la-organizer/_remote/skills/gerencia.md                             /tmp/la-organizer-deploy/skills/gerencia.md
cp D:/la-organizer/_remote/web/src/screens/OperacoesFilaTecnica.tsx       /tmp/la-organizer-deploy/web/src/screens/OperacoesFilaTecnica.tsx
cd /tmp/la-organizer-deploy
git status --short && git diff --stat
```

- [ ] **Step 6.3 — Commit + push + VPS pull**

```bash
git add src/engine.js src/prompts/system.js skills/gerencia.md web/src/screens/OperacoesFilaTecnica.tsx
git commit -m "feat(sprint20): camada gerencia — seed + skill + pickSkill + PWA filtro

- engine: helper findAssistantByUnit + mensagem custom do gate pedagogico para manager
- skill gerencia.md: filtro inteligente, fronteira pedagogica, 6 exemplos, UUIDs reais
- pickSkill: Priority 4.65 (antes de pedagogico) com gatilhos restritos
- PWA: filtro Responsavel aba Gerencia popula manager+coordinator+director
- seed via Supabase MCP (separado): dept gerencia + 8 request types + 3 gerentes
  (Jereh/CG, Clayton/Recreio, Krissya/Barra) com onboarding_completed=false

Sem schema novo. Gate pedagogico Sprint 19 intacto.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
ssh tom 'cd /opt/LA-Organizer && git pull origin main && pm2 restart tom'
```

- [ ] **Step 6.4 — Smoke E2E positivos (6 casos PRD §6)**

| # | Mensagem | Esperado |
|---|---|---|
| P1 | "TOM, esse aluno X está em risco de evasão na Barra" | task `risco-de-evasao`, dept=gerencia, assignee=Krissya, priority=high |
| P2 | "TOM, fala com a Krissya sobre o pai do aluno Y que está insatisfeito" | relay_assisted para Krissya |
| P3 | "TOM, pai do aluno Z reclamando que o filho não aprende" | TOM sugere encaminhar (assistente ou coord); NÃO cria task gerencial |
| P4 | "TOM, isso virou problema de atendimento no Recreio" | task `problema-de-atendimento`, assignee=Clayton |
| P5 | "TOM, preciso articular recepção, secretaria e coordenação no caso da aluna W" | task `articulacao-interna` |
| P6 | "TOM, aciona a gerência da Barra sobre o evento de amanhã" | relay para Krissya |

Validar via Supabase:
```sql
SELECT t.created_at, t.title, d.slug AS dept, drt.slug AS req_type, c.full_name AS assignee, t.priority::text
FROM tasks t
LEFT JOIN department_request_types drt ON drt.id=t.request_type_id
LEFT JOIN departments d ON d.id=COALESCE(t.department_id, drt.department_id)
LEFT JOIN collaborators c ON c.id=t.assigned_to
WHERE d.slug='gerencia' AND t.created_at > now() - interval '30 minutes'
ORDER BY t.created_at DESC;
```

- [ ] **Step 6.5 — Smoke E2E negativos (gate pedagógico via gerente)**

| # | Cenário | Esperado |
|---|---|---|
| N1 | Krissya envia "TOM, cobra a Juliana sobre o relatório" | gate pedagógico nega; mensagem custom para manager: "Como gerente, você não cobra... Quer que eu mande como recado para Leo (assistente Barra) ou direto para Juliana/Quintela?" |
| N2 | Jereh envia "TOM, cobra o Peterson" (mentor) | gate nega com mensagem custom de manager + sugere relay para Dai (assistente Campo Grande) |

Validar `coordination_requests`:
```sql
SELECT created_at, mode, status, cancelled_reason
FROM coordination_requests
WHERE created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 10;
```

Rows com `cancelled_reason='pedagogical_authority_denied'` confirmam que o gate disparou.

- [ ] **Step 6.6 — Smoke PWA**

Abrir aba Gerência em `/mais/operacoes`:
- Filtro Responsável mostra: Alf, Anne, Clayton, Jereh, Krissya, Yuri (e qualquer outro coord/director ativo)
- Cards das tasks criadas em P1/P4/P5 aparecem na aba

- [ ] **Step 6.7 — Smoke self-introduction (Sprint 19 R3)**

Após P2 (relay Krissya) ou N1, Krissya recebe a mensagem do TOM. Como `onboarding_completed=false`, ela deve receber prepend:
```
Oi, Krissya! Aqui é o TOM, organizador da LA Music. Vou te passar um recado:
```

Confirmar via screenshot ou logs.

---

## Self-Review do plano

- [x] Spec coverage: todas as decisões D1-D6 têm step específico
- [x] Sem placeholders: cada step tem comando ou código completo
- [x] Type consistency: `unit` snake_case consistente em F1 (INSERT) e F2 (helper UNIT_DB_TO_PEDAG_SCOPE)
- [x] Smoke positivos cobrem 6 exemplos PRD; negativos cobrem critério de fracasso "manager bloqueado sem orientação"

## Riscos do plano

- **Step 1.1 pré-validação:** se algum dos 3 phones já existir, parar e reportar — não duplicar
- **Step 2.3 ajuste de mensagem:** o `return` exato pode estar em formato diferente — adaptar conforme contexto real
- **Step 3.3 substituição UUIDs:** 9 UUIDs reais devem substituir todos os placeholders — verificar grep `<UUID-` retorna 0
- **Step 6.5 N1/N2:** Krissya/Jereh precisam estar no banco (F1) antes de enviarem mensagens — testar só após pull/restart
