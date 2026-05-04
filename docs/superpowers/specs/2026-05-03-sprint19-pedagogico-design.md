# Sprint 19 — Camada Pedagógica — Design Técnico

**Data:** 2026-05-03
**Status:** aprovado pelo PO (D1, D2, D3 ratificados; 2 regras explícitas adicionadas)
**Princípio mãe:** Pedagógico é configuração + skill + alçada — não é módulo. Reúsa Sprint 15/16/17 sem novo motor.

---

## 1. Goal

Implementar o departamento Pedagógico dentro da camada operacional replicável (Sprint 15), respeitando hierarquia (lead/assistant/mentor/teacher), subdomínios (School/Kids), e roteamento por unidade/especialidade — sem criar módulo paralelo nem novo marker no engine.

## 2. Architecture

- **Schema:** 3 mudanças mínimas (`tasks.subdomain`, `collaborators.pedagogical_role`, tabela `pedagogical_assignments`).
- **Engine:** 3 helpers novos + extensão de 2 handlers existentes (`applyTaskActions`, `applyCoordinationRequestAction`). Zero marker novo.
- **Skill:** `skills/pedagogico.md` carrega como auxiliar global (sempre, todos os roles).
- **Markers reutilizados:** `<<TASK_UPDATE>>` (criação), `<<COORDINATION_REQUEST>>` (relay/cobrança).

---

## 3. Schema Changes

```sql
-- 3.1 Subdomínio School/Kids (genérico, opt-in por request)
ALTER TABLE tasks
  ADD COLUMN subdomain text
  CHECK (subdomain IS NULL OR subdomain IN ('school','kids'));

-- 3.2 Papel pedagógico (NÃO mexe em collaborators.role nem RLS)
ALTER TABLE collaborators
  ADD COLUMN pedagogical_role text
  CHECK (pedagogical_role IS NULL OR pedagogical_role IN ('lead','assistant','mentor'));

-- 3.3 Mapa de escopo (assistente da Barra, assistente de bandas)
CREATE TABLE pedagogical_assignments (
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  scope_type      text NOT NULL CHECK (scope_type IN ('unit','specialty','subdomain')),
  scope_value     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collaborator_id, scope_type, scope_value)
);
CREATE INDEX idx_ped_assignments_scope ON pedagogical_assignments(scope_type, scope_value);

-- RLS: leitura pública (mesmo padrão de departments); escrita só director/coordinator
ALTER TABLE pedagogical_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ped_assignments_read ON pedagogical_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY ped_assignments_write ON pedagogical_assignments
  FOR ALL TO authenticated
  USING (current_collab_role() IN ('coordinator','director'))
  WITH CHECK (current_collab_role() IN ('coordinator','director'));
```

**O que não criamos:** `cases`, `pedagogical_events`, novos enums em `collaborators.role`, novos markers.

---

## 4. Seed Pedagógico

### 4.1 Department + request types

```sql
INSERT INTO departments (slug, name, description, is_active, unit_scope_enabled)
VALUES ('pedagogico', 'Pedagógico', 'Coordenação, professores e acompanhamento de alunos.', true, true);

INSERT INTO department_request_types (department_id, slug, label, description, default_priority, requires_approval, generates_task)
SELECT id, slug, label, description, prio, false, true
FROM departments d, (VALUES
  ('acompanhamento-professor',     'Acompanhamento de professor',     'Performance, relatórios de aula, plano individual.',                'medium'),
  ('apoio-ao-aluno',               'Apoio ao aluno',                  'Falta recorrente, dificuldade pedagógica, ajuste de trilha.',       'high'),
  ('alinhamento-de-turma',         'Alinhamento de turma',            'Troca de aluno, mudança de professor, encaixe, redistribuição.',    'medium'),
  ('alinhamento-com-responsavel',  'Alinhamento com responsável',     'Orientação ao responsável sobre aluno.',                            'medium'),
  ('evento-pedagogico',            'Evento pedagógico',               'Banda, show, recital — preparação/acompanhamento (NÃO o evento).',  'medium'),
  ('pendencia-pedagogica',         'Pendência pedagógica',            'Pendência aberta no contexto pedagógico.',                          'medium'),
  ('suporte-ao-professor',         'Suporte ao professor',            'Material, infra, recurso pedagógico para o professor.',             'low')
) AS rt(slug, label, description, prio)
WHERE d.slug = 'pedagogico';
```

### 4.2 Pessoas mapeadas (UPDATE collaborators)

| Nome | telefone | pedagogical_role |
|---|---|---|
| Juliana | 5521981708609 | lead |
| Quintela | 5521971751320 | lead |
| Leo | 5521992053152 | assistant |
| Ramon | 5521999715997 | assistant |
| Dai | 5521986409985 | assistant |
| Matheus Felipe | 5521978755351 | assistant |
| Jordan | 5521981450588 | assistant |
| Rodrigo | 5521997548859 | assistant |
| Peterson | 5521989366076 | mentor |
| Kinho | 5521987375854 | mentor |
| Renan | 5521965736779 | mentor |

Pré-condição: cada um deve já existir em `collaborators` (caso contrário, INSERT com role=`collaborator` antes).

### 4.3 pedagogical_assignments

| collaborator | scope_type | scope_value |
|---|---|---|
| Juliana | subdomain | school |
| Quintela | subdomain | kids |
| Matheus Felipe | subdomain | kids |
| Leo | unit | Barra |
| Ramon | unit | Recreio |
| Ramon | specialty | bandas |
| Dai | unit | Campo Grande |
| Jordan | specialty | eventos |
| Jordan | specialty | bateria |
| Rodrigo | specialty | cordas |

Mentores (Peterson/Kinho/Renan) **não** entram em `pedagogical_assignments` — orientam, não recebem demanda automática.

---

## 5. Engine: Helpers + Handler Extensions

### 5.1 Helpers novos (`src/engine.js`)

```js
// Retorna 'lead' | 'assistant' | 'mentor' | null
function getPedagogicalRole(collab) {
  return collab && collab.pedagogical_role ? collab.pedagogical_role : null;
}

// Resolve o melhor assignee pedagógico dado um escopo
// args = { subdomain?, unit?, specialty? } — pelo menos 1
// Prioridade: subdomain (lead) > specialty > unit. Retorna primeiro match.
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

// Decide se requester pode delegar/cobrar target no contexto pedagógico
// REGRA DE PRECEDÊNCIA: se esta função negar, gate genérico NÃO pode autorizar.
async function canDelegatePedagogical(requester, target) {
  if (!requester || !target) return false;
  const rRole = requester.role;       // 'director' | 'coordinator' | 'collaborator'
  const rPed  = getPedagogicalRole(requester);
  const tPed  = getPedagogicalRole(target);

  // director/coordinator: autoridade total no pedagógico
  if (rRole === 'director' || rRole === 'coordinator') return true;

  // mentor pedagógico: NUNCA delega
  if (rPed === 'mentor') return false;

  // lead pedagógico (collaborator+lead): pode tudo dentro do pedagógico
  if (rPed === 'lead') return true;

  // assistant pedagógico: só sobre target dentro do escopo
  if (rPed === 'assistant') {
    // Se target não é pedagógico (ou é só professor externo), bloqueia neste MVP
    // — professores não estão em collaborators no MVP (decisão fechada §10)
    if (!tPed) return false; // target sem pedagogical_role
    if (tPed === 'lead' || tPed === 'mentor') return false; // não cobra acima/lateral
    if (tPed === 'assistant') {
      // 1 match de escopo (unit OU specialty OU subdomain) já autoriza
      return await scopeOverlap(requester.id, target.id);
    }
  }

  return false;
}

// Helper interno: 1 match válido em qualquer scope_type já é true
async function scopeOverlap(a, b) {
  const { data: aSc } = await supabase
    .from('pedagogical_assignments')
    .select('scope_type, scope_value').eq('collaborator_id', a);
  const { data: bSc } = await supabase
    .from('pedagogical_assignments')
    .select('scope_type, scope_value').eq('collaborator_id', b);
  if (!aSc || !bSc) return false;
  return aSc.some(x => bSc.some(y => x.scope_type === y.scope_type && x.scope_value === y.scope_value));
}
```

### 5.2 Extensões de handlers existentes

**`applyTaskActions` create:** adicionar `subdomain` ao whitelist + validar CHECK ('school'|'kids'|null).

**`applyCoordinationRequestAction`:** antes do gate atual (Sprint 16: collaborator não emite followup), inserir:

```js
// Sprint 19 — gate pedagógico tem PRECEDÊNCIA sobre o gate genérico:
// se canDelegatePedagogical retornar false, REJEITA mesmo que o gate genérico autorizaria.
if (parsed.mode === 'followup') {
  const targetCollab = await lookupRecipient(parsed.recipient_name);
  const isPedContext = getPedagogicalRole(collab) || (targetCollab && getPedagogicalRole(targetCollab));
  if (isPedContext) {
    const ok = await canDelegatePedagogical(collab, targetCollab);
    if (!ok) {
      return { ok: false, reason: 'pedagogical_authority_denied',
        replyText: 'Esse tipo de cobrança precisa vir de quem tem alçada pedagógica para isso. Posso te ajudar a formular para mandar pra Juliana ou Quintela?' };
    }
  }
}
// ... gate genérico Sprint 16 segue depois
```

---

## 6. Skill `skills/pedagogico.md`

### 6.1 Carregamento

**Auxiliar global** — mesmo padrão de `coordenacao-conversacional.md` e `integridade-agenda.md`. Carrega para **todos os roles** (não usa pickSkill).

Em `src/prompts/system.js`, adicionar bloco análogo ao loader de `integridade-agenda`:

```js
const pedagogicoPath = path.join(skillsDir, 'pedagogico.md');
if (fs.existsSync(pedagogicoPath)) {
  systemPrompt += '\n\n' + fs.readFileSync(pedagogicoPath, 'utf8');
}
```

### 6.2 Conteúdo da skill (estrutura obrigatória)

1. **Quando usar** — gatilhos: aluno, professor, turma, recital, banda, kids, school, juliana, quintela, peterson, kinho, renan, [nomes dos assistentes]
2. **Hierarquia** — tabela lead/assistant/mentor/teacher com quem pode cobrar quem
3. **Subdomínio School ↔ Kids** — Juliana = school; Quintela + Matheus = kids
4. **7 request types** com 2-3 frases-gatilho cada
5. **Mapa de escopo** — lista de assistentes e seus escopos (unidade/especialidade)
6. **Como rotear:**
   - Pedido toca aluno/turma → infere subdomain pelo contexto; se ambíguo, pergunta
   - "Assistente da Barra" → Leo. "De cordas" → Rodrigo. Etc.
   - Se subdomain claro mas sem assistente específico → vai pro lead (Juliana/Quintela)
7. **Regras de alçada (REGRA DE PRECEDÊNCIA explícita):**
   - Mentor (Peterson/Kinho/Renan) NUNCA emite followup, mesmo que peça
   - Teacher (não-collaborator) NUNCA emite followup
   - Assistant cobra **só professor no próprio escopo** — 1 match (unidade OU especialidade OU subdomínio) já autoriza
   - **Se a regra pedagógica negar, a regra genérica de coordenação NÃO autoriza acima dela**
8. **Marker emitido:**
   - Criação: `<<TASK_UPDATE>>` com `department_id` (do pedagógico), `request_type_id`, `subdomain`, `assigned_to`, `description`
   - Cobrança/relay: `<<COORDINATION_REQUEST>>` (Sprint 16)
9. **6 exemplos verbatim do doc base §7:**
   - "cobra o professor X sobre o relatório de aula"
   - "alinha com a Juliana o planejamento do recital"
   - "isso é Kids, leva pro Quintela"
   - "abre uma pendência pedagógica do aluno Y"
   - "fala com o assistente pedagógico da Barra"
   - "professor tal está precisando de material" → suporte-ao-professor

### 6.3 Não-objetivos da skill (afirmados)

- Não tenta criar entrada em `events` para evento-pedagogico
- Não trata professor como collaborator (não inventa lookup nem cria registro)
- Não emite marker novo
- Não interpreta dados de aluno (sem PII storage além do nome em `description`/`notes`)

---

## 7. Regras Explícitas (PO ratificadas)

### 7.1 Regra de precedência de gate

**Se a regra pedagógica negar, a regra genérica não pode autorizar.**

Implementação: gate pedagógico (`canDelegatePedagogical`) é avaliado **antes** do gate genérico (Sprint 16). Retorno `false` → rejeição imediata, sem fallback.

### 7.2 Regra de match de escopo

**Para `assistant`, 1 match válido de escopo já autoriza:**
- unidade **OU**
- especialidade **OU**
- subdomínio

Implementação: `scopeOverlap(a, b)` retorna `true` no primeiro `(scope_type, scope_value)` em comum entre as listas dos dois assistentes. Não exige overlap em múltiplos eixos.

---

## 8. Não-objetivos da Sprint (afirmados)

- Não cria módulo Eventos. `evento-pedagogico` = task com nota "preparação/acompanhamento".
- Professor não vira collaborator no MVP. Quem registra demanda em nome do professor é assistente/coord.
- Sem dashboard pedagógico analítico, sem timeline custom de caso, sem auditoria pedagógica.
- Sem expansão de Sprint 15 RLS — `coordinator/director` continuam sendo os únicos com escrita ampla; pedagogical_role é gating de skill/engine, não RLS.

---

## 9. Decisões fechadas (ratificadas)

| ID | Decisão | Motivo |
|---|---|---|
| D1 | `tasks.subdomain` como coluna explícita com CHECK | School/Kids é estrutural; melhora roteamento e filtro |
| D2 | `collaborators.pedagogical_role` como coluna com CHECK | Gating limpo, query direta, type-safe |
| D3 | Skill `pedagogico.md` carrega sempre (auxiliar global) | Pedagógico é central no piloto; perda por keyword > peso de prompt |
| R1 | Regra de precedência: gate pedagógico DENY > gate genérico ALLOW | Alçada estrutural não pode ser contornada |
| R2 | Assistant: 1 match de escopo (unit OR specialty OR subdomain) autoriza | Cobertura pragmática sem inflar regra |

**Hipótese monitorada (D3 ressalva):** se skill pesar demais no prompt ou gerar overlap com outras, revisitar para `pickSkill` por keyword.

---

## 10. Riscos e mitigações

| # | Risco | Mitigação |
|---|---|---|
| R1 | `pedagogical_assignments` vira tabela morta se outros depts não usarem | Aceitar — é específica do pedagógico; custo é 1 tabela enxuta |
| R2 | Skill auxiliar global infla **todos** os prompts em ~6K | Aceitável no piloto; revisar se passar 30% do system prompt |
| R3 | `canDelegatePedagogical` cria 2 caminhos de gating em `applyCoordinationRequestAction` | Documentar inline; testar `assistant→teacher` (deny) e `mentor→qualquer` (deny) |
| R4 | Subdomain mal inferido em casos ambíguos | Skill pergunta antes do marker (pattern Sprint 16/18) |
| R5 | `coordinator/director` segue podendo tudo — sem "Anne só Kids" | Aceitar — fora de escopo MVP, governança fina é Sprint futura |
