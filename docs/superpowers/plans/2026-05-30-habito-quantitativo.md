# Hábito Quantitativo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir hábitos com registro incremental de quantidade no dia (ex. "bebi 650ml" + "mais 500ml") comparado a uma meta (3L/dia), respondendo "quanto falta" com barra visual — tanto no WhatsApp (TOM) quanto no PWA.

**Architecture:** Estende o que já existe — NÃO cria tabela nova. `habits` ganha 3 colunas (`habit_type`, `target_value`, `unit`); `habit_logs` ganha 1 coluna (`value numeric`). O marker `<<HABIT_ACTION>>` ganha campo `amount` na action `log` e uma nova action `query_progress`. **O número exato (acumulado/meta/falta) é calculado pelo ENGINE e anexado como footer** — nunca pelo LLM (mesmo princípio de `src/finance/ritual-messages.js`: "NÚMERO vem daqui (código), nunca do LLM"). `habit_logs` já é UNIQUE(habit_id, log_date), então o acúmulo é seguro via SELECT-then-UPDATE/INSERT (padrão já usado no código).

**Tech Stack:** Node.js ES modules (engine), Supabase Postgres (migration via MCP `apply_migration`), React + Vite + TypeScript + Tailwind (PWA), markdown skills (system prompt do TOM).

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| Migration SQL (Supabase MCP) | 3 colunas em `habits` + 1 em `habit_logs` | aplicar via `apply_migration` |
| `src/engine.js` | validate + handler do marker HABIT; nova action `query_progress`; footer de progresso | modificar |
| `src/prompts/system.js` | query de habits + bloco de contexto exibe tipo/meta/unidade | modificar |
| `skills/habitos-pessoais.md` | ensinar TOM a detectar quantidade e "quanto falta" | modificar |
| `web/src/components/EditHabitSheet.tsx` | seletor binário/quantitativo + meta + unidade | modificar |
| `web/src/screens/HabitoDetalhe.tsx` | seção de progresso do dia + botões +incremento | modificar |
| `web/src/screens/Habitos.tsx` | subtítulo com progresso pra hábitos quantitativos | modificar |

**Convenção crítica:** o PWA usa `frequency: 'custom_days'` e o engine usa `'custom'` — são domínios separados, NÃO unificar nesse plano. Hábitos existentes ficam `habit_type='binary'` → comportamento 100% inalterado.

**Sem ambiente de teste automatizado backend:** o projeto não tem suite de testes JS rodável. Para o engine, "teste" = `node --check src/engine.js` (sintaxe) + smoke real no WhatsApp. Para o PWA = `npx tsc --noEmit` + `npx vite build` + validação no Preview (localhost:4173). Os steps abaixo refletem isso em vez de TDD com asserts.

---

## Task 1: Migration — colunas de quantidade

**Files:**
- Aplicar via Supabase MCP `apply_migration` (project `cesnbnrynvxvgdhfmaua`), name `habito_quantitativo`.

- [ ] **Step 1: Aplicar a migration**

Chamar `mcp__...__apply_migration` com:

```sql
alter table habits
  add column if not exists habit_type text not null default 'binary'
    check (habit_type in ('binary','quantitative')),
  add column if not exists target_value numeric,
  add column if not exists unit text;

alter table habit_logs
  add column if not exists value numeric not null default 0;
```

- [ ] **Step 2: Verificar schema**

Rodar via MCP `execute_sql`:

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name in ('habits','habit_logs')
  and column_name in ('habit_type','target_value','unit','value')
order by table_name, column_name;
```

Esperado: 4 linhas — `habits.habit_type` (text, default `'binary'::text`), `habits.target_value` (numeric, null), `habits.unit` (text, null), `habit_logs.value` (numeric, default `0`).

---

## Task 2: Engine — validação do marker (create + log + query_progress)

**Files:**
- Modify: `src/engine.js:4533-4550` (`validateHabitAction`)

- [ ] **Step 1: Estender `validateHabitAction`**

Substituir a função inteira (`src/engine.js:4533`) por:

```javascript
function validateHabitAction(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'not_object';
  if (a.action === 'create') {
    if (typeof a.name !== 'string' || !a.name.trim()) return 'name_missing';
    if (a.frequency !== undefined && !VALID_HABIT_FREQUENCIES.has(a.frequency)) return 'bad_frequency';
    if (a.reminder_time !== undefined && a.reminder_time !== null
        && (typeof a.reminder_time !== 'string' || !HABIT_TIME_RE.test(a.reminder_time))) return 'bad_reminder_time';
    if (a.custom_days !== undefined && !Array.isArray(a.custom_days)) return 'bad_custom_days';
    // Quantitativo (opcional): se habit_type='quantitative', exige target_value>0 e unit string.
    if (a.habit_type !== undefined && a.habit_type !== 'binary' && a.habit_type !== 'quantitative') return 'bad_habit_type';
    if (a.habit_type === 'quantitative') {
      if (typeof a.target_value !== 'number' || !(a.target_value > 0)) return 'bad_target_value';
      if (typeof a.unit !== 'string' || !a.unit.trim()) return 'bad_unit';
    }
  } else if (a.action === 'log') {
    const hasId = typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id);
    const hasName = typeof a.habit_name === 'string' && a.habit_name.trim().length > 0;
    if (!hasId && !hasName) return 'bad_habit_id';
    if (a.completed !== undefined && typeof a.completed !== 'boolean') return 'completed_not_bool';
    // Quantitativo: amount é delta numérico; mode controla add vs set.
    if (a.amount !== undefined && (typeof a.amount !== 'number' || Number.isNaN(a.amount))) return 'bad_amount';
    if (a.mode !== undefined && a.mode !== 'add' && a.mode !== 'set') return 'bad_mode';
  } else if (a.action === 'query_progress') {
    const hasId = typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id);
    const hasName = typeof a.habit_name === 'string' && a.habit_name.trim().length > 0;
    if (!hasId && !hasName) return 'bad_habit_id';
  } else {
    return 'unknown_action';
  }
  return null;
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/engine.js`
Expected: sem saída (exit 0).

---

## Task 3: Engine — resolvers retornam colunas de quantidade

**Files:**
- Modify: `src/engine.js:4557` e `:4572` (selects de `resolveHabitByShortId` e `resolveHabitByName`)

- [ ] **Step 1: Incluir colunas no select de `resolveHabitByShortId`**

Em `src/engine.js:4557`, trocar:

```javascript
    .from('habits').select('id, name, icon, current_streak, best_streak, is_active')
```

por:

```javascript
    .from('habits').select('id, name, icon, current_streak, best_streak, is_active, habit_type, target_value, unit')
```

- [ ] **Step 2: Incluir colunas no select de `resolveHabitByName`**

Em `src/engine.js:4572`, fazer a MESMA troca (mesma string antiga → mesma string nova do Step 1).

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/engine.js`
Expected: exit 0.

---

## Task 4: Engine — helpers de quantidade (fmt + barra + leitura/escrita de progresso)

**Files:**
- Modify: `src/engine.js` — inserir logo ANTES de `async function applyHabitActions(` (atualmente em `:4614`).

- [ ] **Step 1: Inserir os helpers**

Inserir este bloco imediatamente antes da linha `async function applyHabitActions(collaborator, actions) {`:

```javascript
// ---------- Hábito quantitativo: helpers (NÚMERO vem do código, nunca do LLM) ----------

// Barra visual de 10 blocos (espelha src/finance/ritual-messages.js bar()).
function habitBar(pct) {
  const filled = Math.max(0, Math.min(10, Math.round((pct || 0) / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// Formata número PT-BR sem casas decimais desnecessárias (1150 -> "1.150", 1.5 -> "1,5").
function fmtQty(n) {
  const v = Number(n) || 0;
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

// Lê o value acumulado de hoje pra um hábito (0 se não houver log).
async function readHabitTodayValue(habitId, today) {
  const { data } = await supabase
    .from('habit_logs').select('value')
    .eq('habit_id', habitId).eq('log_date', today).maybeSingle();
  return data && data.value != null ? Number(data.value) : 0;
}

// Monta o footer de progresso pro WhatsApp. Ex:
// "💧 Água: ████░░░░░░ 38% — 1.150/3.000 ml · faltam 1.850 ml"
function buildHabitProgressFooter(habit, value) {
  const target = Number(habit.target_value) || 0;
  const unit = habit.unit ? ` ${habit.unit}` : '';
  const icon = habit.icon || '💧';
  if (!(target > 0)) {
    return `${icon} ${habit.name}: ${fmtQty(value)}${unit} hoje`;
  }
  const pct = Math.min(100, Math.round((value / target) * 100));
  const remaining = Math.max(0, target - value);
  const done = value >= target ? ' ✅ meta batida!' : ` · faltam ${fmtQty(remaining)}${unit}`;
  return `${icon} ${habit.name}: ${habitBar(pct)} ${pct}% — ${fmtQty(value)}/${fmtQty(target)}${unit}${done}`;
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/engine.js`
Expected: exit 0.

---

## Task 5: Engine — `create` persiste tipo/meta/unidade

**Files:**
- Modify: `src/engine.js:4637-4652` (objeto `insertRow` da action create)

- [ ] **Step 1: Adicionar campos ao insertRow**

Em `src/engine.js`, no objeto `const insertRow = { ... }` da action `create`, adicionar 3 campos logo após a linha `best_streak: 0,` (antes do `};`):

```javascript
          current_streak: 0,
          best_streak: 0,
          habit_type: a.habit_type === 'quantitative' ? 'quantitative' : 'binary',
          target_value: a.habit_type === 'quantitative' ? a.target_value : null,
          unit: a.habit_type === 'quantitative' ? a.unit.trim().slice(0, 20) : null,
        };
```

(A linha `current_streak: 0,` / `best_streak: 0,` já existe — o objetivo é inserir as 3 linhas novas entre `best_streak: 0,` e o `};` de fechamento.)

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/engine.js`
Expected: exit 0.

---

## Task 6: Engine — `log` acumula value + `query_progress` + footers

**Files:**
- Modify: `src/engine.js:4688-4731` (corpo da action `log`) e `:4614-4619` (declarações no topo de `applyHabitActions`) e `:4738` (return).

- [ ] **Step 1: Adicionar acumulador de footers no topo de `applyHabitActions`**

Em `src/engine.js:4619`, trocar:

```javascript
  const created = [], logged = [];
```

por:

```javascript
  const created = [], logged = [];
  const progressFooters = []; // strings de barra (quantitativo) anexadas à resposta
```

- [ ] **Step 2: Substituir o corpo da action `log`**

Substituir todo o bloco `} else if (a.action === 'log') { ... okCount++;` (de `src/engine.js:4688` até o `okCount++;` que fecha o ramo log, antes do `}` do try) por:

```javascript
      } else if (a.action === 'log') {
        const completed = a.completed !== false; // default true
        let h = null;
        if (typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id)) {
          h = await resolveHabitByShortId(collaborator.id, a.habit_id);
        }
        if (!h && typeof a.habit_name === 'string' && a.habit_name.trim()) {
          h = await resolveHabitByName(collaborator.id, a.habit_name);
        }
        if (!h) {
          console.warn(`[Habit] log REJECTED — habit ${a.habit_id || a.habit_name} not owned by ${last4}`);
          failCount++;
          continue;
        }
        const isQuant = h.habit_type === 'quantitative' && Number(h.target_value) > 0;
        const hasAmount = typeof a.amount === 'number' && !Number.isNaN(a.amount);
        // Valor acumulado do dia: add (default) soma ao existente; set substitui.
        let newValue = 0;
        if (isQuant) {
          const prev = await readHabitTodayValue(h.id, today);
          newValue = a.mode === 'set' ? a.amount : prev + (hasAmount ? a.amount : 0);
          if (newValue < 0) newValue = 0;
        }
        // is_completed: quantitativo fecha quando value>=target; binário usa o flag.
        const isCompleted = isQuant ? (newValue >= Number(h.target_value)) : completed;
        // Upsert habit_logs (habit_id, log_date) — SELECT-then-UPDATE/INSERT.
        const { data: existing } = await supabase
          .from('habit_logs').select('id')
          .eq('habit_id', h.id).eq('log_date', today).maybeSingle();
        const row = {
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
          notes: a.notes || null,
        };
        if (isQuant) row.value = newValue;
        if (existing) {
          await supabase.from('habit_logs').update(row).eq('id', existing.id);
        } else {
          await supabase.from('habit_logs').insert({
            habit_id: h.id,
            collaborator_id: collaborator.id,
            log_date: today,
            ...row,
          });
        }
        // Recompute streak.
        const newStreak = await calcHabitStreak(h.id, today);
        const newBest = Math.max(newStreak, h.best_streak || 0);
        await supabase.from('habits').update({
          current_streak: newStreak,
          best_streak: newBest,
        }).eq('id', h.id);
        console.log(`[Habit] log "${h.name}" qty=${isQuant ? newValue : 'n/a'} completed=${isCompleted} streak=${newStreak} (best=${newBest})`);
        if (isQuant) progressFooters.push(buildHabitProgressFooter(h, newValue));
        logged.push({ habit: h, streak: newStreak, completed: isCompleted });
        okCount++;
      } else if (a.action === 'query_progress') {
        let h = null;
        if (typeof a.habit_id === 'string' && SHORT_ID_RE.test(a.habit_id)) {
          h = await resolveHabitByShortId(collaborator.id, a.habit_id);
        }
        if (!h && typeof a.habit_name === 'string' && a.habit_name.trim()) {
          h = await resolveHabitByName(collaborator.id, a.habit_name);
        }
        if (!h) {
          console.warn(`[Habit] query_progress REJECTED — habit ${a.habit_id || a.habit_name} not owned by ${last4}`);
          failCount++;
          continue;
        }
        const value = await readHabitTodayValue(h.id, today);
        progressFooters.push(buildHabitProgressFooter(h, value));
        console.log(`[Habit] query_progress "${h.name}" value=${value}/${h.target_value}`);
        okCount++;
      }
```

(Importante: o ramo `query_progress` substitui o que antes era só o fim do `log`; o `} catch (err) {` logo abaixo permanece intacto.)

- [ ] **Step 3: Retornar os footers**

Em `src/engine.js:4738`, trocar:

```javascript
  return { okCount, failCount, created, logged };
```

por:

```javascript
  return { okCount, failCount, created, logged, progressFooters };
```

- [ ] **Step 4: Verificar sintaxe**

Run: `node --check src/engine.js`
Expected: exit 0.

---

## Task 7: Engine — anexar footers de progresso à resposta

**Files:**
- Modify: `src/engine.js:6562-6568` (bloco de despacho do marker HABIT)

- [ ] **Step 1: Capturar e anexar progressFooters**

Em `src/engine.js:6563`, trocar:

```javascript
      const { okCount, failCount } = await applyHabitActions(collab, parsedHab.actions);
```

por:

```javascript
      const { okCount, failCount, progressFooters } = await applyHabitActions(collab, parsedHab.actions);
```

- [ ] **Step 2: Anexar os footers ao `base`**

Em `src/engine.js`, logo após a linha `let base = parsedHab.cleanText || '';` (`:6568`), inserir:

```javascript
      let base = parsedHab.cleanText || '';
      // Progresso quantitativo: número vem do engine (não do LLM). Anexa a barra exata.
      if (Array.isArray(progressFooters) && progressFooters.length) {
        base = (base ? base.trim() + '\n\n' : '') + progressFooters.join('\n');
      }
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/engine.js`
Expected: exit 0.

- [ ] **Step 4: Deploy do engine (scp + restart)**

```bash
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
ssh tom "pm2 restart tom"
```

Esperado: `pm2 restart tom` retorna status `online`.

---

## Task 8: System prompt — contexto expõe tipo/meta/unidade

**Files:**
- Modify: `src/prompts/system.js:1251-1252` (query de habits)
- Modify: `src/prompts/system.js:522-528` (bloco de contexto de hábitos)

- [ ] **Step 1: Incluir colunas na query de habits**

Em `src/prompts/system.js:1252`, trocar:

```javascript
      .select('id, name, icon, current_streak, frequency, reminder_time')
```

por:

```javascript
      .select('id, name, icon, current_streak, frequency, reminder_time, habit_type, target_value, unit')
```

- [ ] **Step 2: Exibir meta/unidade no bloco de contexto**

Em `src/prompts/system.js:524-528`, substituir o corpo do `habits.slice(0, 10).forEach(h => { ... })` por (preservando as variáveis `sid`/`streak`/`time` já calculadas — adicionar só a parte `meta`):

```javascript
    habits.slice(0, 10).forEach(h => {
      const sid = String(h.id).slice(0, 8);
      const streak = h.current_streak ? ` — streak ${h.current_streak}d` : '';
      const time = h.reminder_time ? ` ⏰ ${String(h.reminder_time).slice(0, 5)}` : '';
      const meta = (h.habit_type === 'quantitative' && Number(h.target_value) > 0)
        ? ` 📊 meta ${h.target_value}${h.unit ? ' ' + h.unit : ''}/dia (quantitativo)`
        : '';
      lines.push(`• [id=${sid}] ${h.icon || '💪'} ${h.name}${streak}${time}${meta}`);
    });
```

(Confira no arquivo as linhas originais 525-527 para `sid`/`streak`/`time` — se os nomes/cálculos diferirem, mantenha os originais e só acrescente `meta` + concatene `${meta}` no `lines.push`.)

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/prompts/system.js`
Expected: exit 0.

- [ ] **Step 4: Deploy**

```bash
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
ssh tom "pm2 restart tom"
```

---

## Task 9: Skill — ensinar o TOM (criar quantitativo, log com amount, query_progress)

**Files:**
- Modify: `skills/habitos-pessoais.md`

- [ ] **Step 1: Adicionar seção de hábito quantitativo após o schema de `create` (após a linha 134, antes de "### Múltiplos lembretes")**

Inserir:

```markdown
### Hábito QUANTITATIVO (acumular valor no dia — água, páginas, minutos)

Alguns hábitos não são "feito/não feito": o user quer somar quantidade ao longo do dia até uma meta. Ex: beber 3L de água, ler 50 páginas, meditar 30 min.

**Criar quantitativo** — inclua `habit_type:"quantitative"`, `target_value` (número > 0) e `unit` (string curta: `"ml"`, `"páginas"`, `"min"`, `"copos"`, `"km"`):

User: "criar hábito beber 3 litros de água por dia"
TOM: 💧 Boa! *Beber água* com meta de **3.000 ml/dia**. Quer lembrete em algum horário?
→ Marker:
```
<<HABIT_ACTION>>
[{"action":"create","name":"Beber água","frequency":"daily","icon":"💧","habit_type":"quantitative","target_value":3000,"unit":"ml"}]
<<END>>
```

**Registrar quantidade (log com `amount`)** — quando o user diz quanto fez/consumiu, use `amount` (delta a somar). Default soma ao que já tem hoje (`mode:"add"`). Use `mode:"set"` só se o user der o TOTAL ("já bebi 2L no total hoje").

User: "bebi 650ml" / "mais 500ml de água" / "li 20 páginas"
→ Marker:
```
<<HABIT_ACTION>>
[{"action":"log","habit_id":"ab12cd34","amount":650}]
<<END>>
```

User: "já bebi 2 litros no total hoje"
→ Marker (set, não add):
```
<<HABIT_ACTION>>
[{"action":"log","habit_id":"ab12cd34","amount":2000,"mode":"set"}]
<<END>>
```

**Consultar progresso (`query_progress`)** — quando o user pergunta "quanto falta?", "quanto já bebi hoje?", "como tá a água?":
→ Marker:
```
<<HABIT_ACTION>>
[{"action":"query_progress","habit_id":"ab12cd34"}]
<<END>>
```

**REGRA DURA — NÃO invente o número.** Para hábito quantitativo, o ENGINE calcula e anexa a barra exata embaixo da sua resposta (ex: `💧 Beber água: ████░░░░░░ 38% — 1.150/3.000 ml · faltam 1.850 ml`). Então:
- Sua resposta de texto deve ser curta e SEM número total inventado. Diga algo como "💧 Anotado!" ou "💧 Deixa eu ver..." — o número vem logo abaixo, do engine.
- NUNCA escreva você mesmo "faltam X ml" ou "você bebeu Y" — você não tem o acumulado fresco e vai errar. O engine põe o número certo.
- Schema do `log`: campo `amount` (number, delta), `mode` (`"add"` default | `"set"`).
- Schema do `query_progress`: `action:"query_progress"` + `habit_id` (ou `habit_name`).
```

- [ ] **Step 2: Atualizar a tabela "Templates de resposta" (linha ~192) para incluir o caso quantitativo**

Adicionar uma linha na tabela:

```markdown
| Logou quantitativo / "quanto falta" | Resposta CURTA ("💧 Anotado!" ou "💧 Deixa eu ver...") — o engine anexa a barra com o número exato abaixo |
```

- [ ] **Step 3: Deploy da skill**

```bash
scp D:/la-organizer/_remote/skills/habitos-pessoais.md tom:/opt/LA-Organizer/skills/habitos-pessoais.md
ssh tom "pm2 restart tom"
```

---

## Task 10: SMOKE TEST no WhatsApp (Jhonatan / qualquer número de teste)

**Files:** nenhum — validação end-to-end.

- [ ] **Step 1: Criar hábito quantitativo**

Mandar no WhatsApp: "criar hábito beber água, meta 3 litros por dia"
Esperado: TOM cria com `habit_type=quantitative`, `target_value=3000`, `unit=ml`. Confirmar via MCP `execute_sql`:

```sql
select name, habit_type, target_value, unit from habits
where name ilike '%água%' order by created_at desc limit 1;
```

Esperado: `quantitative | 3000 | ml`.

- [ ] **Step 2: Logar 650ml**

WhatsApp: "bebi 650ml"
Esperado: resposta do TOM + footer do engine `💧 ... 650/3.000 ml · faltam 2.350 ml`.

- [ ] **Step 3: Logar mais 500ml (acúmulo)**

WhatsApp: "bebi mais 500ml"
Esperado: footer `... 1.150/3.000 ml · faltam 1.850 ml`.

- [ ] **Step 4: Consultar progresso**

WhatsApp: "quanto falta de água?"
Esperado: footer `💧 Beber água: ███░░░░░░░ 38% — 1.150/3.000 ml · faltam 1.850 ml`.

- [ ] **Step 5: Conferir o banco**

```sql
select hl.value, hl.is_completed, h.target_value
from habit_logs hl join habits h on h.id = hl.habit_id
where h.name ilike '%água%' and hl.log_date = (now() at time zone 'America/Sao_Paulo')::date;
```

Esperado: `value=1150`, `is_completed=false`, `target_value=3000`.

- [ ] **Step 6: Ler logs do engine se algo falhar**

```bash
ssh tom "pm2 logs tom --lines 80 --nostream"
```

---

## Task 11: PWA — EditHabitSheet ganha tipo + meta + unidade

**Files:**
- Modify: `web/src/components/EditHabitSheet.tsx`

- [ ] **Step 1: Estender a interface `Habit`**

Em `web/src/components/EditHabitSheet.tsx:13-22`, adicionar 3 campos à interface `Habit`:

```typescript
interface Habit {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  frequency: 'daily' | 'weekdays' | 'weekly' | 'custom_days';
  custom_days: number[] | null;
  reminder_time: string | null;
  notify_whatsapp: boolean;
  habit_type?: 'binary' | 'quantitative' | null;
  target_value?: number | null;
  unit?: string | null;
}
```

- [ ] **Step 2: Adicionar state + presets de unidade**

Logo após `const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);` (`:63`), adicionar:

```typescript
  const [habitType, setHabitType] = useState<'binary' | 'quantitative'>('binary');
  const [targetValue, setTargetValue] = useState<string>(''); // string no input, parse no save
  const [unit, setUnit] = useState<string>('');
```

E perto das constantes do topo (após `ICON_SUGGESTIONS`, `:48`), adicionar:

```typescript
const UNIT_PRESETS = ['ml', 'L', 'copos', 'páginas', 'min', 'km', 'reps'];
```

- [ ] **Step 3: Popular state no `useEffect` de abertura**

No `useEffect` (`:98-119`), no ramo `if (habit) { ... }` adicionar após `setNotifyWhatsapp(...)`:

```typescript
      setHabitType(habit.habit_type === 'quantitative' ? 'quantitative' : 'binary');
      setTargetValue(habit.target_value != null ? String(habit.target_value) : '');
      setUnit(habit.unit ?? '');
```

E no ramo `else { ... }` (modo criar), após `setNotifyWhatsapp(false);`:

```typescript
      setHabitType('binary');
      setTargetValue('');
      setUnit('');
```

- [ ] **Step 4: Persistir no payload do `save`**

No `mutationFn` do `save` (`:142-153`), dentro do objeto `payload`, adicionar (e validar quantitativo antes):

```typescript
      if (!name.trim()) throw new Error('Nome obrigatório.');
      const tv = parseFloat(targetValue.replace(',', '.'));
      if (habitType === 'quantitative') {
        if (!(tv > 0)) throw new Error('Meta tem que ser um número maior que zero.');
        if (!unit.trim()) throw new Error('Escolha uma unidade (ml, páginas, min…).');
      }
      const payload: Record<string, unknown> = {
        name: name.trim().slice(0, 100),
        icon,
        color,
        frequency,
        custom_days: (frequency === 'weekly' || frequency === 'custom_days')
          ? (customDays.length > 0 ? customDays : null)
          : null,
        reminder_time: reminderTimes.length > 0 ? `${reminderTimes[0]}:00` : null,
        notify_whatsapp: notifyWhatsapp,
        habit_type: habitType,
        target_value: habitType === 'quantitative' ? tv : null,
        unit: habitType === 'quantitative' ? unit.trim().slice(0, 20) : null,
      };
```

- [ ] **Step 5: Adicionar a UI do seletor (depois do bloco de Frequência, antes do bloco de Lembretes — após `:327`)**

Inserir entre o fechamento do bloco `{(frequency === 'weekly' || frequency === 'custom_days') && (...)}` e o `<div>` de Lembretes:

```tsx
        <div>
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Tipo</div>
          <div className="grid grid-cols-2 gap-2">
            {([['binary', 'Feito / não feito'], ['quantitative', 'Quantidade + meta']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setHabitType(val)}
                className={[
                  'h-11 rounded-md border text-body-sm font-semibold transition-colors focus-ring',
                  habitType === val ? 'bg-tom text-black border-tom' : 'bg-bg-elevated text-fg-secondary border-border',
                ].join(' ')}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {habitType === 'quantitative' && (
          <div className="space-y-md rounded-md border border-border bg-bg-elevated/40 p-3">
            <label className="block">
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Meta por dia</div>
              <input
                type="text"
                inputMode="decimal"
                value={targetValue}
                onChange={e => setTargetValue(e.target.value)}
                placeholder="Ex.: 3000"
                className="w-full h-12 px-3 rounded-md bg-bg-surface border border-border text-fg focus-ring"
              />
            </label>
            <div>
              <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Unidade</div>
              <div className="flex flex-wrap gap-2 mb-2">
                {UNIT_PRESETS.map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    className={[
                      'px-3 py-1 rounded-full text-body-sm border transition-colors focus-ring',
                      unit === u ? 'bg-tom text-black border-tom' : 'bg-bg-surface text-fg-muted border-border hover:text-fg',
                    ].join(' ')}
                  >
                    {u}
                  </button>
                ))}
              </div>
              <input
                type="text"
                maxLength={20}
                value={unit}
                onChange={e => setUnit(e.target.value)}
                placeholder="Ou escreva (ex.: garrafas)"
                className="w-full h-11 px-3 rounded-md bg-bg-surface border border-border text-fg focus-ring"
              />
            </div>
          </div>
        )}
```

- [ ] **Step 6: Validar tipos e build**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros.

Run: `cd _remote/web && npx vite build`
Expected: build sucesso.

---

## Task 12: PWA — HabitoDetalhe mostra progresso do dia + +incremento

**Files:**
- Modify: `web/src/screens/HabitoDetalhe.tsx`

- [ ] **Step 1: Estender o type `Habit` e `Log`**

Em `web/src/screens/HabitoDetalhe.tsx:20-34`, adicionar à `Habit`:

```typescript
  habit_type?: 'binary' | 'quantitative' | null;
  target_value?: number | null;
  unit?: string | null;
```

E ao `Log`:

```typescript
type Log = { id: string; log_date: string; is_completed: boolean; notes: string | null; value?: number | null };
```

- [ ] **Step 2: Incluir colunas nas queries**

Em `HabitoDetalhe.tsx:89`, trocar o select de habits para incluir as novas colunas:

```typescript
        .select('id, name, icon, color, frequency, custom_days, reminder_time, notify_whatsapp, current_streak, best_streak, is_active, habit_type, target_value, unit')
```

Em `HabitoDetalhe.tsx:97`, trocar o select de habit_logs:

```typescript
          .select('id, log_date, is_completed, notes, value')
```

- [ ] **Step 3: Derivar progresso de hoje + mutation de incremento**

Após o bloco `const doneToday = Boolean(todayLog?.is_completed);` (`:139`), adicionar:

```typescript
  const isQuant = habit?.habit_type === 'quantitative' && Number(habit?.target_value) > 0;
  const todayValue = Number(todayLog?.value ?? 0);
  const target = Number(habit?.target_value ?? 0);
  const quantPct = isQuant && target > 0 ? Math.min(100, Math.round((todayValue / target) * 100)) : 0;
  const remaining = isQuant ? Math.max(0, target - todayValue) : 0;

  const addAmount = useMutation({
    mutationFn: async (delta: number) => {
      if (!habit || !collaborator) return;
      const newValue = Math.max(0, todayValue + delta);
      const isCompleted = newValue >= target;
      if (todayLog) {
        await supabase.from('habit_logs').update({
          value: newValue,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
        }).eq('id', todayLog.id);
      } else {
        await supabase.from('habit_logs').insert({
          habit_id: habit.id,
          collaborator_id: collaborator.id,
          log_date: today,
          value: newValue,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
        });
      }
      await supabase.rpc('recalc_habit_streak', { p_habit_id: habit.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habit-detail', id] });
      qc.invalidateQueries({ queryKey: ['habits'] });
    },
  });
```

- [ ] **Step 4: Renderizar a seção de progresso (só quantitativo), logo após o `</section>` do bloco "Stats: ring + numbers + toggle hoje" (`:266`)**

Inserir:

```tsx
      {isQuant && (
        <section className="surface p-md space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-label uppercase tracking-wide text-fg-muted">Hoje</div>
            <div className="text-body-sm text-fg-muted tabular-nums">
              {todayValue.toLocaleString('pt-BR')} / {target.toLocaleString('pt-BR')} {habit.unit}
            </div>
          </div>
          <div className="h-3 w-full rounded-full bg-bg-elevated overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${quantPct}%`, backgroundColor: color }}
            />
          </div>
          <div className="text-body-sm text-fg-muted tabular-nums">
            {remaining > 0
              ? `Faltam ${remaining.toLocaleString('pt-BR')} ${habit.unit}`
              : '✅ Meta batida hoje!'}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {[
              Math.round(target / 12) || 1,
              Math.round(target / 6) || 1,
              Math.round(target / 4) || 1,
            ].map((step, i) => (
              <button
                key={i}
                type="button"
                onClick={() => addAmount.mutate(step)}
                disabled={addAmount.isPending}
                className="px-3 py-1.5 rounded-full text-body-sm border border-border bg-bg-elevated text-fg hover:border-tom focus-ring tabular-nums"
              >
                +{step.toLocaleString('pt-BR')} {habit.unit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { const v = prompt('Quanto adicionar?'); const n = v ? parseFloat(v.replace(',', '.')) : NaN; if (n > 0) addAmount.mutate(n); }}
              disabled={addAmount.isPending}
              className="px-3 py-1.5 rounded-full text-body-sm border border-dashed border-border text-fg-muted hover:text-fg focus-ring"
            >
              + outro
            </button>
          </div>
        </section>
      )}
```

(Nota: o `prompt()` nativo é aceitável aqui como entrada rápida de valor arbitrário — não é select/date/time, então não viola a regra do DS. Se preferir um BottomSheet depois, fica como melhoria v2.)

- [ ] **Step 5: Validar tipos e build**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros.

Run: `cd _remote/web && npx vite build`
Expected: build sucesso.

---

## Task 13: PWA — Habitos lista mostra progresso quantitativo

**Files:**
- Modify: `web/src/screens/Habitos.tsx`

- [ ] **Step 1: Estender o type `Habit` e o select**

Em `web/src/screens/Habitos.tsx:18-30`, adicionar à `Habit`:

```typescript
  habit_type?: 'binary' | 'quantitative' | null;
  target_value?: number | null;
  unit?: string | null;
```

Em `Habitos.tsx:92`, incluir as colunas no select e também o `value` no select de logs (`:106`):

```typescript
    .select('id, name, icon, color, frequency, custom_days, reminder_time, notify_whatsapp, current_streak, best_streak, is_active, habit_type, target_value, unit')
```

```typescript
    .select('habit_id, log_date, is_completed, value')
```

- [ ] **Step 2: Capturar value de hoje no augment**

No `fetchHabits`, adicionar um mapa de value de hoje. Após construir `doneSet` (`:111-114`), adicionar:

```typescript
  const today = days[0];
  const todayValueByHabit = new Map<string, number>();
  for (const l of (logs || [])) {
    if (l.log_date === today && l.value != null) todayValueByHabit.set(l.habit_id, Number(l.value));
  }
```

(Atenção: já existe `const today = days[0];` mais abaixo na função — neste step mova/reuse essa declaração para não duplicar `const today`. Se já declarado, só adicione o `todayValueByHabit`.)

E no `HabitWithLog` type (`:32-38`) adicionar `today_value: number;`, e no `.map` (`:117-129`) adicionar `today_value: todayValueByHabit.get(h.id) ?? 0,`.

- [ ] **Step 3: Mostrar subtítulo de progresso no item da lista**

Em `Habitos.tsx`, dentro do `<div className="mt-0.5 flex items-center gap-3 ...">` (`:266`), adicionar como PRIMEIRO filho (antes do `<span>...% nos últimos 30d</span>`), um trecho condicional:

```tsx
                      {h.habit_type === 'quantitative' && Number(h.target_value) > 0 ? (
                        <span className="tabular-nums text-tom">
                          {h.today_value.toLocaleString('pt-BR')}/{Number(h.target_value).toLocaleString('pt-BR')} {h.unit}
                        </span>
                      ) : null}
```

- [ ] **Step 4: Validar tipos e build**

Run: `cd _remote/web && npx tsc --noEmit`
Expected: sem erros.

Run: `cd _remote/web && npx vite build`
Expected: build sucesso.

---

## Task 14: Validação do PWA no Preview

**Files:** nenhum — validação visual.

- [ ] **Step 1: Garantir server e navegar pra /habitos**

Preview já roda em localhost:4173. Usar `preview_eval` pra limpar SW cache + reload, depois `preview_screenshot`.

- [ ] **Step 2: Criar hábito quantitativo pela UI**

Abrir o sheet "Novo hábito", escolher Tipo = "Quantidade + meta", meta 3000, unidade ml, nome "Água teste". Salvar. Screenshot confirmando que aparece na lista com "0/3.000 ml".

- [ ] **Step 3: Abrir detalhe e usar +incremento**

Navegar pra /habitos/<id>, clicar num botão +incremento, confirmar barra de progresso enchendo e "Faltam X ml" atualizando. Screenshot.

- [ ] **Step 4: Verificar mobile (375px) e desktop (1440px)**

`preview_resize` pra 375 e 1440, screenshot em cada. Confirmar que o sheet e a seção de progresso não quebram layout.

---

## Task 15: Deploy final do PWA

**Files:** nenhum — o Stop hook commita+pusha `_remote/` automaticamente ao fim do turno (Vercel deploya `web/`). Engine/skills já foram via scp nas Tasks 7/8/9.

- [ ] **Step 1: Confirmar que tudo de `web/` está salvo em `_remote/`**

Nenhuma ação manual de git. Ao terminar o turno, o auto-deploy hook cuida do commit+push.

---

## Self-Review

**1. Spec coverage:**
- Migration (habits 3 cols + habit_logs value) → Task 1 ✅
- create aceita habit_type/target_value/unit → Tasks 2, 5 ✅
- log aceita amount (add/set), upsert somando value, is_completed=(value>=target) → Tasks 2, 6 ✅
- nova action query_progress retorna value/target/remaining/pct → Tasks 2, 6 ✅
- streak continua via is_completed → mantido (calcHabitStreak inalterado), Task 6 ✅
- system prompt/skill ensina detectar quantidade e "quanto falta" → Tasks 8, 9 ✅
- barra visual reusada → Task 4 (habitBar espelha bar() dos rituais) ✅
- PWA Habitos/EditHabitSheet form + HabitoDetalhe anel/incremento → Tasks 11, 12, 13 ✅
- Smoke WhatsApp 1.150/3.000 faltam 1.850 → Task 10 ✅
- Validação Preview → Task 14 ✅

**2. Placeholder scan:** sem TBD/TODO; todo código está completo nos steps.

**3. Type consistency:** `habit_type`/`target_value`/`unit`/`value` consistentes entre migration, engine selects, system.js, e os 3 arquivos PWA. `buildHabitProgressFooter`/`habitBar`/`fmtQty`/`readHabitTodayValue` definidos na Task 4 e usados na Task 6. `progressFooters` definido (Task 6 Step 1), retornado (Step 3) e consumido (Task 7).

**Desvio consciente da spec:** a spec dizia "form em Habitos.tsx" — na real o form vive em `EditHabitSheet.tsx` (Task 11). O anel do detalhe permanece como aderência 30d (StreakRing) e o progresso value/target vira uma **barra dedicada** na seção "Hoje" (Task 12), em vez de remapear o anel — mais legível e não quebra o significado do anel existente.
