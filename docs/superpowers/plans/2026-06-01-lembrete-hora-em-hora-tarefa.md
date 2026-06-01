# Lembretes por horário na tarefa ("de hora em hora") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma tarefa (especialmente recorrente) dispare múltiplos lembretes em horários do dia — inclusive "de hora em hora" numa janela — via UI e via chat com o TOM, sem poluir a lista nem spammar o WhatsApp.

**Architecture:** O backend já tem tudo (`task_reminders`, disparo com DND/silêncio, clonagem por recorrência, engine aceita `reminders_at[]` + `recurrence_rule`). O trabalho novo é: (1) **gerador de intervalo** no componente `RemindersField` (PWA), (2) **skill + fluxo de confirmação** pro TOM montar 1 recorrente + N lembretes, (3) **guardrail** que bloqueia criação em massa de tarefas idênticas.

**Tech Stack:** Node.js (engine, `node:test`), React+TS+Tailwind (PWA, validado via `tsc`+`vite build`+Preview), Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-06-01-lembrete-hora-em-hora-tarefa-design.md`

---

## File Structure

- `src/engine.js` — adicionar guardrail anti-bomba em `applyTaskActions` (~3515). Modify.
- `src/engine.guardrail.test.js` — teste do guardrail. Create.
- `src/services/recurrence-engine.test.js` — teste de regressão da clonagem clock-time. Create (ou append se existir).
- `skills/lembrete-recorrente.md` — skill nova. Create.
- `src/prompts/system.js` — registrar a skill no loader contextual. Modify.
- `web/src/components/RemindersField.tsx` — gerador de intervalo. Modify.
- `web/src/lib/reminderInterval.ts` — função pura `generateIntervalTimes`. Create.

---

## Task 1: Guardrail anti-bomba no engine

**Files:**
- Create: `src/engine.guardrail.test.js`
- Modify: `src/engine.js` (helper novo no topo do módulo + chamada no início de `applyTaskActions`, ~3515)

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/engine.guardrail.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { splitBulkIdenticalCreates } = require('./engine');

// Caso Jhonatan 29/05: lote com >10 creates de título idêntico = bomba.
function mk(title) { return { action: 'create', title }; }

test('lote com >10 creates de título idêntico é bloqueado', () => {
  const actions = Array.from({ length: 12 }, () => mk('Dar presença dos alunos'));
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 0, 'nenhum create idêntico deveria passar');
  assert.strictEqual(blocked.length, 12);
  assert.strictEqual(blocked[0].title, 'Dar presença dos alunos');
});

test('normaliza título (case/espaço) ao agrupar', () => {
  const actions = [
    ...Array.from({ length: 6 }, () => mk('  DAR Presença dos Alunos ')),
    ...Array.from({ length: 6 }, () => mk('dar presença dos alunos')),
  ];
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 0);
  assert.strictEqual(blocked.length, 12);
});

test('lote pequeno (<=10) passa normalmente', () => {
  const actions = Array.from({ length: 8 }, () => mk('Comprar lâmpada'));
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 8);
  assert.strictEqual(blocked.length, 0);
});

test('títulos distintos não somam entre si', () => {
  const actions = [
    ...Array.from({ length: 7 }, () => mk('Tarefa A')),
    ...Array.from({ length: 7 }, () => mk('Tarefa B')),
  ];
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 14, 'grupos diferentes não estouram o teto');
  assert.strictEqual(blocked.length, 0);
});

test('não-creates (reschedule/complete) nunca são bloqueados', () => {
  const actions = [
    ...Array.from({ length: 12 }, () => ({ action: 'reschedule', id: 'x', new_due_date: '2026-06-02' })),
  ];
  const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
  assert.strictEqual(allowed.length, 12);
  assert.strictEqual(blocked.length, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/engine.guardrail.test.js`
Expected: FAIL — `splitBulkIdenticalCreates is not a function`.

- [ ] **Step 3: Implementar o helper em `src/engine.js`**

Adicionar perto do topo do módulo (após os outros helpers de task, antes de `applyTaskActions`):

```js
// Guardrail anti-bomba (Bug BULK-RECUR 29/05 — Jhonatan): bloqueia lote com
// muitas tarefas de título idêntico. Rotina repetida deve ser 1 tarefa
// recorrente + lembretes, não N tarefas avulsas. Conta SÓ action=create,
// agrupando por título normalizado. Grupos com mais de `cap` itens são
// bloqueados inteiros; o resto passa.
function splitBulkIdenticalCreates(actions, cap = 10) {
  const groups = new Map();
  for (const a of actions) {
    if (!a || a.action !== 'create' || typeof a.title !== 'string') continue;
    const key = a.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const blockedSet = new Set();
  for (const [, group] of groups) {
    if (group.length > cap) group.forEach(a => blockedSet.add(a));
  }
  return {
    allowed: actions.filter(a => !blockedSet.has(a)),
    blocked: actions.filter(a => blockedSet.has(a)),
  };
}
```

Garantir o export. Encontrar o `module.exports` de `engine.js` e adicionar `splitBulkIdenticalCreates`:

```js
module.exports = { /* ...exports existentes..., */ splitBulkIdenticalCreates };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/engine.guardrail.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: Ligar o guardrail em `applyTaskActions`**

Em `src/engine.js`, no início de `async function applyTaskActions(collaborator, actions) {` (~3515), logo após `const failMessages = [];` e `const last4 = ...`, inserir:

```js
  // Guardrail anti-bomba (BULK-RECUR): se o lote tem >10 creates de título
  // idêntico, bloqueia esse grupo e orienta o caminho recorrente. Backstop
  // independente da skill (mesmo se o LLM ignorar a orientação).
  {
    const { allowed, blocked } = splitBulkIdenticalCreates(actions, 10);
    if (blocked.length > 0) {
      const exemplo = (blocked[0].title || '').trim().slice(0, 60);
      console.warn(`[Task] BULK_CREATE_BLOCKED — ${blocked.length} creates idênticos "${exemplo}" (collab ${last4})`);
      try {
        await logMarker(collaborator.id, 'BULK_CREATE_BLOCKED', 'rejected',
          `count=${blocked.length} title=${exemplo}`, null);
      } catch (_) { /* não-fatal */ }
      failMessages.push(
        `Isso parece uma rotina que se repete ("${exemplo}"). Em vez de criar ${blocked.length} tarefas iguais, melhor 1 tarefa recorrente com lembretes nos horários. Quer que eu monte assim?`
      );
      actions = allowed; // segue só com o que não é bomba
    }
  }
```

- [ ] **Step 6: Verificar syntax + rodar o teste de novo**

Run: `node --check src/engine.js && node --test src/engine.guardrail.test.js`
Expected: sem erro de syntax; PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine.js src/engine.guardrail.test.js
git commit -m "feat(engine): guardrail anti-bomba — bloqueia criação em massa de tarefas idênticas"
```

---

## Task 2: Teste de regressão — recorrência preserva horário de relógio

Confirma que os lembretes clonados pela recorrência mantêm o mesmo HH:MM local em cada dia (risco de timezone do spec). A lógica já existe em `_cloneRemindersForInstances`; este teste trava o comportamento.

**Files:**
- Modify: `src/services/recurrence-engine.js` (exportar helper puro de cálculo, se ainda não exportado)
- Create: `src/services/recurrence-engine.test.js`

- [ ] **Step 1: Extrair a aritmética pra função pura testável**

Em `src/services/recurrence-engine.js`, adicionar e exportar uma função pura que isola o cálculo já usado dentro de `_cloneRemindersForInstances`:

```js
// Calcula o remind_at de uma instância preservando o delta entre o remind_at
// do template e a meia-noite BRT do due_date do template. Brasil não tem DST,
// então o delta reproduz o mesmo HH:MM local em qualquer dia.
function shiftReminderToInstance(templateDueDateYmd, templateRemindIso, instanceDueDateYmd) {
  const tplAnchor = new Date(`${templateDueDateYmd}T00:00:00-03:00`);
  const instAnchor = new Date(`${instanceDueDateYmd}T00:00:00-03:00`);
  const delta = new Date(templateRemindIso).getTime() - tplAnchor.getTime();
  return new Date(instAnchor.getTime() + delta).toISOString();
}
```

Refatorar o corpo de `_cloneRemindersForInstances` pra usar essa função no lugar do cálculo inline (mesma matemática, agora compartilhada). Adicionar ao `module.exports`: `shiftReminderToInstance`.

- [ ] **Step 2: Escrever o teste**

Criar `src/services/recurrence-engine.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { shiftReminderToInstance } = require('./recurrence-engine');

// Função utilitária local: extrai HH:MM no fuso BRT de um ISO UTC.
function hhmmBrt(iso) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(11, 16);
}

test('lembrete 13h no template vira 13h em outro dia (mesmo HH:MM local)', () => {
  const out = shiftReminderToInstance('2026-06-01', '2026-06-01T13:00:00-03:00', '2026-06-15');
  assert.strictEqual(hhmmBrt(out), '13:00');
});

test('lembrete 20h preserva 20h em dia distante', () => {
  const out = shiftReminderToInstance('2026-06-01', '2026-06-01T20:00:00-03:00', '2026-06-30');
  assert.strictEqual(hhmmBrt(out), '20:00');
});

test('a data do remind_at acompanha a data da instância', () => {
  const out = shiftReminderToInstance('2026-06-01', '2026-06-01T13:00:00-03:00', '2026-06-15');
  // 13:00 BRT do dia 15 = 16:00 UTC do dia 15
  assert.ok(out.startsWith('2026-06-15'), `esperava dia 15, veio ${out}`);
});
```

- [ ] **Step 3: Rodar e ver passar**

Run: `node --test src/services/recurrence-engine.test.js`
Expected: PASS (3 testes). Se algum falhar, o bug de timezone é real → corrigir `shiftReminderToInstance` pra ancorar por HH:MM local explicitamente antes de seguir.

- [ ] **Step 4: Verificar syntax**

Run: `node --check src/services/recurrence-engine.js`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/services/recurrence-engine.js src/services/recurrence-engine.test.js
git commit -m "test(recurrence): trava clonagem de lembrete preservando HH:MM local"
```

---

## Task 3: Gerador de intervalo — função pura

**Files:**
- Create: `web/src/lib/reminderInterval.ts`

- [ ] **Step 1: Implementar a função pura**

Criar `web/src/lib/reminderInterval.ts`:

```ts
// Gera horários datetime-local "YYYY-MM-DDTHH:MM" de `start` a `end` (HH:MM),
// a cada `stepMin` minutos, todos na data `ymd`. Inclui o `end` se cair no passo.
// Usado pelo gerador de intervalo do RemindersField ("de 13h às 20h, a cada 1h").
export function generateIntervalTimes(
  ymd: string,        // "2026-06-01"
  start: string,      // "13:00"
  end: string,        // "20:00"
  stepMin: number,    // 60 | 30
): string[] {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const s = toMin(start);
  const e = toMin(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || stepMin <= 0 || e < s) return [];
  const out: string[] = [];
  for (let t = s; t <= e; t += stepMin) {
    const hh = String(Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    out.push(`${ymd}T${hh}:${mm}`);
  }
  return out;
}
```

- [ ] **Step 2: Validar tipos**

Run: `cd web && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Smoke test manual da lógica via node**

Run (na raiz do repo):
```bash
node -e "const f=(ymd,s,e,st)=>{const m=x=>{const[a,b]=x.split(':').map(Number);return a*60+b};const S=m(s),E=m(e);const o=[];for(let t=S;t<=E;t+=st){o.push(ymd+'T'+String(t/60|0).padStart(2,'0')+':'+String(t%60).padStart(2,'0'))}return o};console.log(f('2026-06-01','13:00','20:00',60).length, f('2026-06-01','13:00','20:00',30).length)"
```
Expected: `8 15` (13–20h a cada 60min = 8 horários; a cada 30min = 15).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/reminderInterval.ts
git commit -m "feat(web): generateIntervalTimes — gera horários de intervalo pra lembretes"
```

---

## Task 4: Gerador de intervalo na UI (RemindersField)

**Files:**
- Modify: `web/src/components/RemindersField.tsx`

- [ ] **Step 1: Importar o gerador e derivar o ymd da referência**

No topo de `RemindersField.tsx`, adicionar import:

```ts
import { generateIntervalTimes } from '../lib/reminderInterval';
import { TimeInput } from './TimeInput';
import { CustomSelect } from './CustomSelect';
import { useState } from 'react';
```

Dentro do componente, derivar a data-base (usa a referência; cai pra hoje se não houver) e o estado do gerador:

```ts
  const baseYmd = (referenceDateTime || '').slice(0, 10) || new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const [intStart, setIntStart] = useState('13:00');
  const [intEnd, setIntEnd] = useState('20:00');
  const [intStep, setIntStep] = useState('60');

  function applyInterval() {
    const gen = generateIntervalTimes(baseYmd, intStart, intEnd, Number(intStep));
    if (!gen.length) return;
    const merged = Array.from(new Set([...value, ...gen])).sort();
    onChange(merged);
  }
```

- [ ] **Step 2: Renderizar o bloco do gerador** (logo abaixo dos preset chips, antes da lista de lembretes)

Inserir após o `</div>` que fecha o bloco de preset chips (~linha 123):

```tsx
      {/* Gerador de intervalo — "de hora em hora" */}
      <div className="flex flex-wrap items-end gap-2 mb-3 p-2 rounded-md bg-bg-elevated border border-border">
        <span className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold w-full">
          De hora em hora
        </span>
        <div className="flex items-center gap-1">
          <TimeInput value={intStart} onChange={setIntStart} />
          <span className="text-[12px] text-fg-muted">às</span>
          <TimeInput value={intEnd} onChange={setIntEnd} />
        </div>
        <CustomSelect
          value={intStep}
          onChange={setIntStep}
          options={[{ value: '60', label: 'a cada 1h' }, { value: '30', label: 'a cada 30min' }]}
          size="sm"
        />
        <button
          type="button"
          onClick={applyInterval}
          disabled={disabled}
          className="px-3 py-1 rounded-full text-[12px] border border-tom bg-tom text-black font-semibold hover:opacity-90 focus-ring disabled:opacity-40"
        >
          Gerar
        </button>
      </div>
```

- [ ] **Step 3: Ajustar o gate `disabled`/`hasRef` do gerador**

O gerador NÃO depende de `referenceDateTime` (usa `baseYmd` com fallback). Garantir que os controles do gerador não fiquem `disabled` por `!hasRef` — só por `disabled` (prop). Os preset chips relativos seguem dependendo de `hasRef` como hoje.

- [ ] **Step 4: Validar tipos + build**

Run: `cd web && npx tsc --noEmit && npx vite build`
Expected: sem erros de tipo; build conclui.

- [ ] **Step 5: Validar visualmente no Preview (mobile 375 + desktop 1440)**

Usar `mcp__Claude_Preview__preview_eval` + `preview_screenshot` em `localhost:4173`: abrir o sheet de criar tarefa, conferir que o bloco "De hora em hora" aparece, gerar 13–20h a cada 1h e ver 8 lembretes na lista. Limpar caches de SW antes de navegar.
Expected: 8 lembretes gerados; layout sem quebra em 375px e 1440px.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/RemindersField.tsx
git commit -m "feat(web): gerador 'de hora em hora' no RemindersField"
```

---

## Task 5: Skill — TOM monta rotina como recorrente + lembretes (com confirmação)

**Files:**
- Create: `skills/lembrete-recorrente.md`
- Modify: `src/prompts/system.js` (loader contextual de skills)

- [ ] **Step 1: Verificar o padrão de carregamento de skills**

Ler em `src/prompts/system.js` como `criar-recorrencia.md` é carregada (gatilho/keywords). Replicar o mesmo mecanismo pra `lembrete-recorrente.md`.

- [ ] **Step 2: Escrever a skill**

Criar `skills/lembrete-recorrente.md`:

```markdown
# Skill: Lembrete recorrente de hora em hora

## Quando usar
Quando o usuário pede pra ser lembrado REPETIDAMENTE de uma rotina — "me lembra
de X de hora em hora", "me cobra a cada hora", "vários lembretes por dia", "todo
dia nesses horários". Ex.: "me lembra de dar presença de hora em hora, seg a sex,
das 13h às 20h".

## Regra de ouro
NUNCA crie uma tarefa por horário/dia. Rotina repetida = UMA tarefa recorrente
com MÚLTIPLOS lembretes. Criar dezenas de tarefas iguais é proibido (o engine
bloqueia via guardrail) e polui a lista do usuário.

## Como montar
1 marker `<<TASK_UPDATE>>` action="create" com:
- `recurrence_rule`: a recorrência (ex.: dias úteis seg-sex). Use o mesmo formato
  aceito hoje pela skill criar-recorrencia.
- `reminders_at`: ARRAY com os horários do dia em ISO BRT (-03:00). Para "de hora
  em hora das 13h às 20h": 13:00,14:00,...,20:00 na data da primeira ocorrência.
- `reminders_labels` (opcional): rótulos curtos ("13h","14h",...).
A recorrência clona os lembretes pra cada dia automaticamente. Domingo/sábado
ficam de fora se a regra for "dias úteis".

## SEMPRE confirme antes de gravar
Monte o resumo e pergunte antes de emitir o marker (use o fluxo de pending_intents
"Confirmo?"). Ex.:
"Vou criar UMA tarefa recorrente *Dar presença dos alunos*, seg a sex, com lembrete
de hora em hora das 13h às 20h (8 avisos/dia). Domingo fica de fora. Confirma?"
Só emita o marker após o "sim".

## O que NÃO fazer
- Não emita N markers de create.
- Não use o check-in global (task_checkin_times) — ele lista TODAS as tarefas e vira spam.
- Se o usuário quer horários diferentes por dia (ex.: sábado 8–15h), crie uma
  segunda tarefa recorrente só pra esse dia.
```

- [ ] **Step 3: Registrar a skill no loader**

Em `src/prompts/system.js`, no mesmo ponto onde `criar-recorrencia.md` é injetada por keyword, adicionar `lembrete-recorrente.md` com gatilhos: `de hora em hora`, `a cada hora`, `vários lembretes`, `me lembra ... todo dia`, `de X às Y`. Seguir exatamente o padrão existente (mesma função de leitura/append).

- [ ] **Step 4: Verificar syntax**

Run: `node --check src/prompts/system.js`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add skills/lembrete-recorrente.md src/prompts/system.js
git commit -m "feat(tom): skill lembrete-recorrente — rotina vira 1 recorrente + lembretes, confirma antes"
```

---

## Task 6: Deploy + validação end-to-end + fechar radar

**Files:** nenhum novo (deploy + verificação)

- [ ] **Step 1: Rodar toda a suíte de testes backend**

Run: `node --test src/engine.guardrail.test.js src/services/recurrence-engine.test.js`
Expected: todos PASS.

- [ ] **Step 2: Deploy do backend (SCP + restart)**

```bash
scp src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp src/services/recurrence-engine.js tom:/opt/LA-Organizer/src/services/recurrence-engine.js
scp src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp skills/lembrete-recorrente.md tom:/opt/LA-Organizer/skills/lembrete-recorrente.md
ssh tom "pm2 restart tom"
```
Expected: `tom` online.

- [ ] **Step 2b: Confirmar boot limpo**

Run: `ssh tom "pm2 logs tom --nostream --lines 8 | grep -E 'PROCESS START|pronto|Error'"`
Expected: "TOM pronto", sem Error.

- [ ] **Step 3: Validação end-to-end TOM (mensagem real de teste do próprio Alf)**

Enviar ao TOM (WhatsApp do Alf): "me lembra de hora em hora de dar presença, seg a sex, das 13h às 20h".
Expected: TOM responde com RESUMO e pede confirmação (não cria nada ainda). Após "sim", criar UMA tarefa recorrente. Verificar no banco:

```sql
-- (via mcp execute_sql, project cesnbnrynvxvgdhfmaua)
SELECT count(*) FILTER (WHERE recurrence_rule IS NOT NULL) AS templates,
       (SELECT count(*) FROM task_reminders tr JOIN tasks t ON t.id=tr.task_id
        WHERE t.assigned_to='<id_alf>' AND lower(t.title) LIKE '%presença%') AS reminders
FROM tasks WHERE assigned_to='<id_alf>' AND lower(title) LIKE '%presença%';
```
Expected: 1 template + 8 reminders (não dezenas de tarefas).

- [ ] **Step 4: Validação do guardrail**

Forçar (via teste já passado em Task 1) cobre o unitário. Em produção, se o TOM tentar criar lote idêntico, conferir log:
Run: `ssh tom "pm2 logs tom --nostream --lines 200 | grep BULK_CREATE_BLOCKED"`
Expected: vazio em uso normal; aparece só se houver tentativa de bomba.

- [ ] **Step 5: Fechar o incidente no radar**

Via `mcp execute_sql` (project `cesnbnrynvxvgdhfmaua`):

```sql
UPDATE tom_known_issues
SET status='corrigido', corrigido_em=now(),
    fix_resumo = fix_resumo || ' [FIX 01/06: gerador de intervalo no RemindersField + skill lembrete-recorrente (1 recorrente + N lembretes, confirma antes) + guardrail splitBulkIdenticalCreates (teto 10) no applyTaskActions.]'
WHERE codigo='BULK-RECUR';
```
Expected: 1 linha atualizada, status=corrigido.

- [ ] **Step 6: Commit final + push**

```bash
git add -A
git commit -m "chore: deploy lembrete hora-em-hora + fecha BULK-RECUR"
```
(O auto-deploy hook faz o push do `_remote/` no fim do turno.)

---

## Notas de validação manual (fora de teste automatizado)
- O PWA não tem runner de teste unitário; UI validada via `tsc --noEmit` + `vite build` + Preview (mobile 375 / desktop 1440), conforme convenção do CLAUDE.md.
- Editar horários de uma tarefa recorrente já existente: o re-sync das instâncias futuras já materializadas NÃO está neste escopo (o clone roda na materialização, idempotente, pra dias ainda não criados). Se virar necessidade, abrir tarefa separada.
