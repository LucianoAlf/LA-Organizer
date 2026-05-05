# Sprint 20 — Camada de Gerência — Design Técnico

**Data:** 2026-05-05
**Status:** aprovado pelo PO (D1–D6 ratificados)
**Princípio mãe:** Gerência é configuração + skill + roteamento inteligente — sem schema novo, sem mexer no gate pedagógico Sprint 19. Reúsa Sprint 15/16/17/19.

---

## 1. Goal

Implementar o departamento Gerência dentro da camada operacional replicável (Sprint 15), formalizando o gerente como **filtro inteligente da unidade** que avalia, articula e roteia demandas — sem confundir com Pedagógico, sem quebrar o gate pedagógico, e respeitando a fronteira: gerente **encaminha** (relay) para pedagógico, **não cobra** (followup).

## 2. Architecture

- **Schema:** ZERO mudanças. `role='manager'` e `unit IN (campo_grande,recreio,barra,all)` já existem no CHECK.
- **Diferenciação manager:** unit específica = gerente de unidade; `unit='all'` = líder de departamento (Yuri/Marketing).
- **Engine:** 1 helper novo (`findAssistantByUnit`) + ajuste de 1 mensagem em `applyCoordinationRequestAction` quando manager tenta followup pedagógico.
- **Skill:** `skills/gerencia.md` carrega APENAS como primary (via pickSkill). NÃO é auxiliar global.
- **pickSkill:** novo branch Priority 4.65 antes de pedagogico (4.7), com gatilhos restritos (nomes dos gerentes + termos gerenciais explícitos).
- **PWA:** filtro Responsável aba Gerência popula com manager+coordinator+director.

---

## 3. Schema Changes — ZERO

Sprint 20 NÃO adiciona colunas, tabelas ou constraints. Conflito identificado em auditoria: PRD §5.3 escreveu `unit='Campo Grande'/'Recreio'/'Barra'`, mas CHECK existente exige snake_case lowercased. **Decisão D1:** seguir o banco — usar `campo_grande`, `recreio`, `barra`.

---

## 4. Seed

### 4.1 Department + 8 request types

```sql
INSERT INTO departments (slug, name, description, is_active, unit_scope_enabled)
VALUES ('gerencia', 'Gerência', 'Gestão relacional da unidade — retenção, experiência, atendimento, articulação.', true, true);

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

### 4.2 INSERT 3 gerentes

```sql
INSERT INTO collaborators (full_name, phone, role, unit, is_active, onboarding_completed)
VALUES
  ('Jereh',   '5521985525984', 'manager', 'campo_grande', true, false),
  ('Clayton', '5521990450802', 'manager', 'recreio',      true, false),
  ('Krissya', '5521966875271', 'manager', 'barra',        true, false)
ON CONFLICT (phone) DO NOTHING;
```

`onboarding_completed=false` → ativa o self-introduction da Sprint 19 R3 quando TOM mandar a primeira mensagem para qualquer um deles via relay.

### 4.3 Confirma Yuri continua como manager+all
```sql
SELECT full_name, role, unit FROM collaborators WHERE role='manager' ORDER BY full_name;
```
Esperado: 4 linhas (Clayton, Jereh, Krissya, Yuri).

---

## 5. Engine — Helpers + ajuste de mensagem

### 5.1 Helper novo: `findAssistantByUnit(unitDb)`

`unitDb` é o valor armazenado em `collaborators.unit` (snake_case). Mapeamento para `pedagogical_assignments.scope_value` (Title Case) é interno do helper:

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

### 5.2 Ajuste em `applyCoordinationRequestAction`

Quando gate pedagógico nega (linha onde retorna `pedagogical_authority_denied`), customizar `replyText` se `requester.role === 'manager'`:

```js
if (!ok) {
  let replyText = 'Esse tipo de cobrança precisa vir de quem tem alçada pedagógica para isso. Posso te ajudar a formular para mandar pra Juliana ou Quintela?';
  if (collab.role === 'manager') {
    const assistente = await findAssistantByUnit(collab.unit);
    const assistName = assistente ? assistente.full_name.split(' ')[0] : 'o assistente da unidade';
    replyText = `Como gerente, você não cobra (followup) o pedagógico — você encaminha (relay).\n\nQuer que eu mande como recado para *${assistName}* (assistente pedagógico da sua unidade) ou direto para *Juliana* (LA Music School) ou *Quintela* (LA Music Kids)?`;
  }
  return { ok: false, reason: 'pedagogical_authority_denied', replyText };
}
```

**Importante:** o gate `canDelegatePedagogical` em si **não muda**. Apenas a mensagem de erro fica contextual.

### 5.3 Não muda
- `canDelegatePedagogical` — manager continua **não autorizado** (return false). Correto.
- `applyTaskActions` — sem alteração; gerência usa o mesmo fluxo Sprint 15.
- ACC, integridade, COORD_HINT — sem alteração.

---

## 6. Skill `skills/gerencia.md`

### 6.1 Carregamento
**Apenas primary**, via pickSkill (Decisão D4). Não é auxiliar global. Carrega 6KB no prompt apenas quando o contexto é gerencial claro.

### 6.2 Estrutura obrigatória

1. **Cabeçalho** + 1 frase de propósito
2. **Quando usar** — gatilhos: risco evasão, retenção, recuperação, experiência da unidade, atendimento, recepção, secretaria, articulação, "gerência da [unidade]", nomes Jereh/Clayton/Krissya
3. **UUIDs do departamento** (department_id + 8 request_type_ids reais — tabela)
4. **Princípio do filtro inteligente** — gerente avalia antes de agir; 3 caminhos: trata direto / encaminha / articula
5. **Mapa de gerentes por unidade**:
   - Jereh — Campo Grande
   - Clayton — Recreio (interino)
   - Krissya — Barra
   - Yuri — líder Marketing (`unit=all` — distinção)
6. **Fronteira com Pedagógico (NÃO NEGOCIÁVEL):**
   - Gerente NUNCA emite `followup` para alguém com `pedagogical_role`
   - Gerente sempre usa `relay_assisted` para pedagógico
   - Quando demanda chega ao gerente e é claramente pedagógica, TOM **sugere encaminhamento** (assistente da unidade ou coordenação)
7. **8 request types** com gatilhos resumidos
8. **Diferenciação `alinhamento-com-responsavel`:**
   - Gerência: experiência/retenção/insatisfação
   - Pedagógico: devolutiva sobre aprendizado/trilha
9. **Markers emitidos:**
   - Criação: `<<TASK_UPDATE>>` com `department_id` (gerência), `request_type_id`, `assigned_to` (gerente da unidade), `description`
   - Encaminhamento pedagógico: `<<COORDINATION_REQUEST>>` com `mode='relay_assisted'` (NUNCA followup)
10. **6 exemplos canônicos:**
    - "esse aluno está em risco de evasão" → `risco-de-evasao`, gerente da unidade
    - "fala com a Krissya sobre esse pai insatisfeito" → relay para Krissya
    - "pai reclamando que o filho não aprende" → TOM sugere encaminhar pro pedagógico (oferece assistente ou coordenação)
    - "isso virou problema de atendimento" → `problema-de-atendimento`
    - "preciso articular recepção, secretaria e coordenação" → `articulacao-interna`
    - "aciona a gerência da Barra" → relay para Krissya
11. **Não faça:**
    - NÃO emita followup para mentor/lead/assistant pedagógico
    - NÃO crie task em departamento errado quando o caso for claramente pedagógico
    - NÃO confunda Yuri (manager+all/Marketing) com gerente de unidade

---

## 7. pickSkill — branch novo

### Priority 4.65 (antes de pedagogico=4.7)

```js
// Sprint 20 — Priority 4.65: contexto GERENCIAL EXPLÍCITO.
// Gatilhos restritos para não roubar casos pedagógicos (que vencem em 4.7).
// Frases com "aluno"/"responsável" SEM qualificador gerencial caem em pedagogico abaixo.
if (/(\brisco\s+de\s+evas|\bevas[ãa]o\b|\bretenç[ãa]o\b|\brecuperaç[ãa]o\s+(?:de\s+)?aluno|\bexperi[êe]ncia\s+da\s+unidade|\bproblema\s+de\s+atendimento|\barticul(?:ar|ação)\s+(?:recepç|secretari|coord)|\bgerente\b|\bgerência\b|\bjereh\b|\bclayton\b|\bkrissya\b|\bnegoci(?:ar|ação)\s+(?:permanência|sa[ií]da)|\bpai\s+(?:insatisfeito|querendo\s+sair|reclamando\s+do\s+atendimento)|\baciona\s+(?:a\s+)?ger[êe]ncia|\brecepç[ãa]o\b|\bsecretari[ao]\b|\bpr[ée][\s-]?atendimento)/i.test(lastUserMessage || '')) {
  return { name: 'gerencia', body: loadSkill('gerencia') };
}
```

**Crítico:** gatilhos como `aluno`, `responsável`, `professor` sem qualificador NÃO entram. Pedagogico (4.7 abaixo) continua vencendo nesses casos.

### Priorities 4.7 e 4.8 — sem mudança
Pedagogico e operacoes-tecnicas continuam.

---

## 8. PWA — filtro Responsável aba Gerência

`OperacoesFilaTecnica.tsx` Q3 ganha branch:

```js
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

Resultado: Alf, Anne, Clayton, Jereh, Krissya, Yuri (e qualquer outro coordinator/director ativo).

---

## 9. Decisões fechadas (PO ratificadas)

| ID | Decisão | Implementação |
|---|---|---|
| **D1** | `unit` snake_case (`campo_grande`, `recreio`, `barra`) | INSERT seed §4.2 + helper `UNIT_DB_TO_PEDAG_SCOPE` para mapear |
| **D2** | pickSkill antes do pedagogico, gatilhos restritos | Priority 4.65 §7 |
| **D3** | Mensagem custom do gate pedagógico para manager | `applyCoordinationRequestAction` §5.2 |
| **D4** | Gerência só primary (não auxiliar global) | system.js sem block auxiliar; pickSkill 4.65 |
| **D5** | Filtro Responsável: manager + coordinator + director | PWA §8 |
| **D6** | INSERTs com `onboarding_completed=false` | TOM apresenta-se na 1ª mensagem (Sprint 19 R3) |

---

## 10. Não-objetivos afirmados

- ❌ Sem CRM gigante, sem analytics
- ❌ Sem mudança no gate pedagógico (Sprint 19 R1 mantida intacta)
- ❌ Sem migration nova
- ❌ Sem mistura com Eventos
- ❌ Pedagogico continua resolvendo aprendizado/trilha — gerência só roteia/articula

---

## 11. Riscos e mitigações

| # | Risco | Mitigação |
|---|---|---|
| R1 | pickSkill captura demanda pedagógica genuína (ex: "aluno tendo dificuldade") | Gatilhos restritos no Priority 4.65; pedagogico permanece em 4.7 |
| R2 | Manager tenta followup pedagógico e mensagem confunde | D3: customização contextual + sugestão de assistente da unidade |
| R3 | Confusão `alinhamento-com-responsavel` ped vs ger | Skill ensina critério: ped=aprendizado, ger=experiência/retenção |
| R4 | `articulacao-interna` vira "categoria genérica de tudo" | Skill restringe a "mobilizar 2+ áreas" — para casos simples, request type específico |
| R5 | Yuri (manager+all) confundido com gerente de unidade | Skill diferencia explicitamente |
| R6 | Bug B2 "Registrado!" alucinado em criação de task gerencial | Já coberto pelo `_buildIntegrityConfirmText` Sprint 19 R4 |
| R7 | TOM aciona o gerente errado por ambiguidade de unidade | ACC + skill orientam a pedir confirmação quando unit ambígua |
