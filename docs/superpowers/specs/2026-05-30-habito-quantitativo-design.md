# Design — Hábito Quantitativo (acumular valor no dia: água, páginas, minutos)

> **Origem:** pedido real do colaborador **Jhonatan** (`collaborators.id = 5d74b86b-da6a-4aa1-8783-4b80a2a6d102`), via áudio + prompt que o próprio TOM redigiu.
> **Status:** design aprovado pelo Alf em 2026-05-30.
> **Ordem no roadmap:** este é o **2º** dos dois pedidos (fazer depois do "checklist diário com histórico").

---

## 1. Problema (na voz do usuário)

*"Tô tentando fazer o TOM mostrar quanto de água bebi no dia. De manhã mandei 650ml, depois mandei mais — e ele não acumula. Não dá pra ver quanto falta pra meta."*

Hábito hoje é **100% binário**: feito ✅ / não feito ❌. Não existe campo de quantidade nem meta. O usuário quer registro **incremental** ao longo do dia (650ml + 500ml + …) comparado a uma meta (ex. 3L/dia) → "faltam X".

---

## 2. Diagnóstico + correção do prompt do TOM

Estado real no banco:

- `habits`: `name, icon, frequency, custom_days, reminder_time, current_streak, best_streak, is_active`. **Sem** tipo/meta/unidade.
- `habit_logs`: `habit_id, collaborator_id, log_date, is_completed (boolean), completed_at, notes`. **Sem** valor numérico.
- Constraint: `habit_logs` é **UNIQUE (habit_id, log_date)** → já é "uma linha por hábito por dia".
- Engine: marker `<<HABIT_ACTION>>[...]<<END>>` já existe (`src/engine.js:4491`), com actions `create` e `log`, validação (`VALID_HABIT_FREQUENCIES`, `HABIT_TIME_RE`) e lógica de streak + heatmap (`web/src/screens/agenda/leftPanel/HabitWeekHeatmap.tsx`).

### ⚠️ Correção obrigatória ao prompt gerado pelo TOM

O prompt que o TOM mandou pro Alf pede **criar uma tabela nova `daily_habit_logs`**. Isso é **redundante e NÃO deve ser feito**: `habit_logs` **já é por-dia** (UNIQUE habit_id+log_date). Basta adicionar uma coluna `value` em `habit_logs` e acumular via upsert. Criar tabela nova duplicaria o histórico que já existe e quebraria o heatmap/streak atuais.

**Conclusão:** é uma extensão pequena do que já existe — 3 colunas, ajuste no marker `log` + 1 action de consulta, e UI do form/anel.

---

## 3. Design proposto

### 3.1 Migration (schema)

```sql
-- habits: tipo + meta + unidade
alter table habits
  add column habit_type text not null default 'binary'
    check (habit_type in ('binary','quantitative')),
  add column target_value numeric,         -- ex. 3000 (ml/dia)
  add column unit text;                     -- ex. 'ml', 'páginas', 'min', 'copos'

-- habit_logs: valor acumulado no dia (NÃO criar tabela nova)
alter table habit_logs
  add column value numeric not null default 0;
```

Hábitos existentes ficam `habit_type='binary'` → comportamento inalterado.

### 3.2 Engine — estender `<<HABIT_ACTION>>` (`src/engine.js:4491+`)

- **action `create`**: aceitar `habit_type`, `target_value`, `unit` (validar: se `quantitative`, `target_value` numérico > 0 e `unit` string).
- **action `log`** (hoje só marca `is_completed`): aceitar campo opcional **`amount`** (delta a somar). Semântica:
  - upsert em `habit_logs` por (habit_id, log_date=hoje);
  - `value = coalesce(value,0) + amount`;
  - `is_completed = (value >= habits.target_value)` para quantitativo; para binário, mantém o fluxo atual (sem amount).
  - opcional: `mode: 'add' | 'set'` (default `add`) caso o usuário diga "já bebi 2L no total".
- **nova action `query_progress`**: retorna `{ value_today, target_value, unit, remaining = max(target-value,0), pct }` pro hábito quantitativo do dia. (ou reusar a leitura de progresso que o ritual já faz).
- Recalcular `current_streak`/`best_streak` usando `is_completed` como já é feito (quantitativo "fecha o dia" quando atinge a meta).

### 3.3 System prompt / skill

Ensinar o TOM (skill de hábitos ou nova `habitos-quantitativos.md`) a:

- detectar quantidade + hábito: *"bebi mais 650ml"*, *"adiciona 500ml de água"*, *"li 20 páginas"* → `log` com `amount`;
- detectar consulta: *"quanto falta de água?"*, *"quanto já bebi hoje?"* → `query_progress`;
- responder com barra visual (reusar as barras dos rituais): `Água: ████░░░░ 53% (1.600/3.000 ml) — faltam 1.400 ml`.

### 3.4 PWA

- **`web/src/screens/Habitos.tsx`** (form de criar/editar): seletor de tipo **Binário / Quantitativo**; quando quantitativo, mostrar campos **meta** (`target_value`) + **unidade** (`unit`, ex. CustomSelect com presets ml/min/páginas/copos + custom). Usar DS (`CustomSelect`, `Field`, input numérico com as classes do DS).
- **`web/src/screens/HabitoDetalhe.tsx`** + anel de progresso: para quantitativo, o anel/percentual reflete `value/target` do dia (não 0/1). Botão de **+incremento rápido** (ex. +250ml) e/ou input pra somar valor. Mostrar "1.600 / 3.000 ml — faltam 1.400".
- Heatmap (`HabitWeekHeatmap.tsx`): pode continuar usando `is_completed` para a cor (dia "fechado" = meta batida); opcionalmente intensidade por `value/target`. Manter simples — `is_completed` basta no v1.

---

## 4. Fora de escopo (v1)

- Múltiplas metas por hábito / metas por faixa de horário.
- Crédito parcial no streak (dia conta só se bateu a meta).
- Decremento ("bebi a menos") — só `add`/`set`.
- Gráfico histórico de consumo (recharts) — fica pra depois.

---

## 5. Anchors de código (para o chat executor)

| O quê | Arquivo |
|---|---|
| Marker HABIT + handler (create/log) | `src/engine.js:4491` (`parseHabitMarker`, `validateHabitAction`) |
| Leitura de logs/streak/heatmap | `src/engine.js` (~4585, query `habit_logs`), `web/src/screens/agenda/leftPanel/HabitWeekHeatmap.tsx` |
| Tela de hábitos (form) | `web/src/screens/Habitos.tsx` |
| Detalhe do hábito (anel/progresso) | `web/src/screens/HabitoDetalhe.tsx` |
| Barras visuais dos rituais (reusar no WhatsApp) | `src/rituals/` (componente de barra usado nos rituais financeiros/aderência) |

**Constraint a confiar:** `habit_logs` UNIQUE (habit_id, log_date) → upsert `onConflict: 'habit_id,log_date'` acumula com segurança.

**Deploy:** PWA via Vercel (auto-deploy). Engine via scp + `pm2 restart tom`. Smoke no WhatsApp: criar hábito quantitativo (água, meta 3000ml) → "bebi 650ml" → "bebi mais 500ml" → "quanto falta?" deve responder 1.150/3.000, faltam 1.850.
