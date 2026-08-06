# Executor determinístico do ALVO da tarefa — Fatia A — Plano de implementação

> **Para quem executa:** use `superpowers:subagent-driven-development` ou
> `superpowers:executing-plans`, tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Spec:** `docs/superpowers/specs/2026-08-06-executor-deterministico-alvo-tarefa-design.md` (commit `87a02d28`)

**Objetivo:** parar de escolher a tarefa errada quando o título casa com várias instâncias da
mesma série recorrente — trocando `order('created_at', desc).limit(1)` por uma regra
determinística (ciclo corrente = menor `due_date`), nos três handlers que têm o defeito.

**Arquitetura:** módulo puro `src/lib/task-target.js` decide; `engine.js` só busca candidatos e
consulta. Atrás da flag `TOM_TASK_TARGET_SERIES`, desligada por padrão. Ambiguidade real
mantém o comportamento de hoje e loga com payload completo.

**Stack:** Node 20 CommonJS, `node:test` + `node:assert`, supabase-js.

## Restrições globais

Valem para TODAS as tarefas:

- `TOM_TASK_TARGET_SERIES` **desligada por padrão**. Desligada, o caminho é o de hoje, byte a byte.
- **Manter o `ilike`.** O bug é o `.limit(1)` fingindo certeza, não o `LIKE`. Igualdade exata explodiria a taxa de "não achei" — ninguém fala o título completo.
- **Ambiguidade real não muda de comportamento** nesta fatia: mantém `created_at desc` e loga.
- **Voz do TOM intocada.** Nada em `soul/`, nada em `skills/`, nenhuma prosa nova.
- **Zero-regressão.** Baseline da suíte: `pass 2262 / fail 3` (os 3 são por `SUPABASE_URL` ausente ao carregar 3 arquivos; não são regressão). Rodar `node --test "src/**/*.test.js"`.
- **`.deploy-hold` ANTES de editar `src/`** — mas **confira o path do seu ambiente**, não copie o daqui. O hook (`scripts/auto-deploy.ps1`) deriva assim:
  ```powershell
  $srcRoot  = "D:\la-organizer\_remote"                              # CRAVADO no script
  $holdFile = Join-Path (Split-Path $srcRoot -Parent) ".deploy-hold" # → D:\la-organizer\.deploy-hold
  ```
  **O hook só roda nesta máquina Windows** (é Stop hook desta sessão, com path absoluto). Quem
  executar do **LAHQ ou direto na VPS não tem hold para colocar** — lá o auto-deploy não existe.
  O risco naquele ambiente é o oposto e é pior: o patch fica só em `/opt/LA-Organizer` e o
  próximo `git reset --hard origin/main` o apaga em silêncio. **Ali a trava é commitar, não segurar.**
- **Commitar.** Patch que vive só em `/opt/LA-Organizer` é apagado pelo próximo `git reset --hard origin/main`, em silêncio. Aconteceu em 06/08.
- **Data local** por `todayYmdSP()` de `src/utils/dates.js` ou `Intl` com `America/Sao_Paulo`. **Nunca** `toISOString().slice(0,10)` — depois das 21h BRT o UTC já virou o dia.
- **Timestamp do banco** compara por `Date.parse`, nunca como string: o Postgres devolve `+00:00` e o JS escreve `.000Z` para o mesmo instante.

## Desvio deliberado da spec

A spec descreve `resolveTaskTarget({ candidatos, hoje })`. **O `hoje` foi removido.** A regra
"se está atrasada é ela; se todas são futuras, a mais próxima" é, nos dois ramos, *menor
`due_date`* — não depende do dia corrente. Parâmetro não usado convida uso errado e mente sobre
a dependência da função. Assinatura final: `resolveTaskTarget({ candidatos })`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/task-target.js` **(criar)** | Decisão pura: candidatos → `exato` / `ambiguo` / `nenhum`. Sem banco, sem LLM, sem `engine`. |
| `src/lib/task-target.test.js` **(criar)** | Os 8 casos da tabela 7.1 da spec + estabilidade de ordenação. |
| `src/engine.js` **(modificar)** | 3 pontos de consumo (`complete` ~4405, `cancel` ~4654, `reschedule` ~4735) + `logMarker` sem truncar. |
| `scripts/replay-lab-cenario-serie.js` **(criar)** | Cenário B do Replay Lab. |

---

### Task 1: Módulo puro `task-target.js`

**Arquivos:**
- Criar: `src/lib/task-target.js`
- Testar: `src/lib/task-target.test.js`

**Interfaces:**
- Consome: nada (função pura, primeira tarefa).
- Produz: `resolveTaskTarget({ candidatos }) → { modo: 'exato'|'ambiguo'|'nenhum', tarefa?, candidatos?, motivo }` e `serieDe(tarefa) → string|null`. As tarefas de 3 a 5 consomem `resolveTaskTarget`; a tarefa 3 consome `serieDe` para montar o payload de log.

- [ ] **Passo 1: escrever o teste que falha**

Criar `src/lib/task-target.test.js`:

```js
'use strict';
// A regra que este módulo protege: quando o título casa com VÁRIAS instâncias da mesma
// série recorrente, o alvo é o CICLO CORRENTE — a de menor due_date. O código legado usava
// `order('created_at' desc).limit(1)`, que numa série materializada devolve a instância mais
// FUTURA. Medido em 06/08 na série "Presença Emusys": legado escolhia 04/09, corrente era 01/08.
const test = require('node:test');
const assert = require('node:assert');
const { resolveTaskTarget, serieDe } = require('./task-target');

// Helper: instância de série. `serie` é o recurrence_parent_id.
const inst = (id, due, serie, created = '2026-08-01T12:00:00Z') =>
  ({ id, title: 'Presença Emusys', due_date: due, recurrence_parent_id: serie,
     recurrence_rule: null, created_at: created });
// Helper: tarefa avulsa, sem recorrência nenhuma.
const avulsa = (id, due, created = '2026-08-01T12:00:00Z') =>
  ({ id, title: 'Presença Emusys', due_date: due, recurrence_parent_id: null,
     recurrence_rule: null, created_at: created });

test('sem candidato → nenhum', () => {
  assert.deepEqual(resolveTaskTarget({ candidatos: [] }), { modo: 'nenhum', motivo: 'sem_candidato' });
  assert.equal(resolveTaskTarget({}).modo, 'nenhum');
  assert.equal(resolveTaskTarget({ candidatos: null }).modo, 'nenhum');
});

test('um candidato → exato, sem precisar de regra', () => {
  const t = avulsa('a', '2026-08-20');
  const r = resolveTaskTarget({ candidatos: [t] });
  assert.equal(r.modo, 'exato');
  assert.equal(r.motivo, 'unico');
  assert.equal(r.tarefa.id, 'a');
});

test('série com uma ATRASADA → escolhe a atrasada, não a criada por último', () => {
  // Reproduz "Presença Emusys": a de setembro foi criada depois, o legado pegava ela.
  const candidatos = [
    inst('set', '2026-09-04', 'S1', '2026-08-05T12:00:00Z'),
    inst('ago', '2026-08-01', 'S1', '2026-07-01T12:00:00Z'),
    inst('meio', '2026-08-15', 'S1', '2026-07-20T12:00:00Z'),
  ];
  const r = resolveTaskTarget({ candidatos });
  assert.equal(r.modo, 'exato');
  assert.equal(r.motivo, 'serie');
  assert.equal(r.tarefa.id, 'ago', 'pegou a instância errada da série');
});

test('série TODA no futuro → a mais próxima', () => {
  const candidatos = [
    inst('longe', '2026-09-04', 'S1'),
    inst('perto', '2026-08-10', 'S1'),
  ];
  assert.equal(resolveTaskTarget({ candidatos }).tarefa.id, 'perto');
});

test('linhagens DISTINTAS → ambiguo (é Fatia B, não chuta)', () => {
  const r = resolveTaskTarget({ candidatos: [inst('a', '2026-08-10', 'S1'), inst('b', '2026-08-12', 'S2')] });
  assert.equal(r.modo, 'ambiguo');
  assert.equal(r.motivo, 'linhagens_distintas');
  assert.equal(r.candidatos.length, 2);
});

test('série + UMA avulsa de mesmo nome → ambiguo (avulsa não é "a série")', () => {
  const r = resolveTaskTarget({ candidatos: [inst('a', '2026-08-10', 'S1'), avulsa('x', '2026-08-11')] });
  assert.equal(r.modo, 'ambiguo');
  assert.equal(r.motivo, 'linhagens_distintas');
});

test('série inteira SEM due_date → ambiguo: não dá para ordenar sem chutar', () => {
  const r = resolveTaskTarget({ candidatos: [inst('a', null, 'S1'), inst('b', null, 'S1')] });
  assert.equal(r.modo, 'ambiguo');
  assert.equal(r.motivo, 'serie_sem_data');
});

test('série com data PARCIAL → escolhe entre as que têm data; nula nunca é o ciclo', () => {
  const r = resolveTaskTarget({ candidatos: [inst('semdata', null, 'S1'), inst('comdata', '2026-08-10', 'S1')] });
  assert.equal(r.modo, 'exato');
  assert.equal(r.tarefa.id, 'comdata');
});

test('empate de due_date → created_at mais antigo, e a ordem de entrada não muda o resultado', () => {
  const a = inst('velha', '2026-08-10', 'S1', '2026-07-01T00:00:00Z');
  const b = inst('nova', '2026-08-10', 'S1', '2026-07-09T00:00:00Z');
  assert.equal(resolveTaskTarget({ candidatos: [a, b] }).tarefa.id, 'velha');
  assert.equal(resolveTaskTarget({ candidatos: [b, a] }).tarefa.id, 'velha', 'resultado dependeu da ordem de entrada');
});

test('serieDe: parent_id manda; molde usa o próprio id; avulsa é null', () => {
  assert.equal(serieDe({ id: 'x', recurrence_parent_id: 'P', recurrence_rule: 'FREQ=DAILY' }), 'P');
  assert.equal(serieDe({ id: 'molde', recurrence_parent_id: null, recurrence_rule: 'FREQ=DAILY' }), 'molde');
  assert.equal(serieDe({ id: 'y', recurrence_parent_id: null, recurrence_rule: null }), null);
  assert.equal(serieDe(null), null);
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
node --test src/lib/task-target.test.js
```
Esperado: `fail` com `Cannot find module './task-target'`.

- [ ] **Passo 3: implementar o mínimo**

Criar `src/lib/task-target.js`:

```js
// src/lib/task-target.js
// Decide QUAL tarefa uma frase se refere, quando o título casa com várias.
//
// O defeito que este módulo existe para matar (medido em 06/08/2026): os três handlers de
// tarefa do engine resolviam por `ilike(title) + order('created_at' desc) + limit(1)`. O
// `.limit(1)` esconde a pluralidade — escolhe um e segue como se tivesse certeza — e o
// critério "criada por último" é o pior possível numa série recorrente materializada, porque
// as instâncias futuras nascem depois. Série "Presença Emusys", 35 abertas: o legado escolhia
// a de 04/09 quando a corrente era a de 01/08. Resultado: "passa pra amanhã" mexia numa
// ocorrência de setembro, a pessoa não via nada mudar e concluía que o TOM ignorou.
//
// PURO de propósito: sem banco, sem LLM, sem engine. O engine busca os candidatos e entrega;
// aqui só se decide. É o que permite provar por mutação que a regra existe de verdade.
'use strict';

/**
 * Chave da série recorrente de uma tarefa. Instância aponta para o molde; o molde é a
 * própria raiz; tarefa avulsa não tem série (null).
 */
function serieDe(t) {
  if (!t) return null;
  if (t.recurrence_parent_id) return String(t.recurrence_parent_id);
  if (t.recurrence_rule) return String(t.id);
  return null;
}

/**
 * @param {{candidatos?: Array}} arg
 * @returns {{modo:'exato'|'ambiguo'|'nenhum', tarefa?:object, candidatos?:Array, motivo:string}}
 */
function resolveTaskTarget({ candidatos } = {}) {
  const lista = Array.isArray(candidatos) ? candidatos.filter(Boolean) : [];
  if (lista.length === 0) return { modo: 'nenhum', motivo: 'sem_candidato' };
  if (lista.length === 1) return { modo: 'exato', tarefa: lista[0], motivo: 'unico' };

  // Uma avulsa com o mesmo nome no meio da lista NÃO é "a série" — é ambiguidade real.
  const series = lista.map(serieDe);
  const distintas = new Set(series.filter(Boolean));
  if (series.some((s) => s === null) || distintas.size !== 1) {
    return { modo: 'ambiguo', candidatos: lista, motivo: 'linhagens_distintas' };
  }

  const comData = lista.filter((t) => t.due_date);
  if (comData.length === 0) return { modo: 'ambiguo', candidatos: lista, motivo: 'serie_sem_data' };

  // Ciclo corrente = menor due_date. Atrasada e "mais próxima no futuro" são o mesmo ramo.
  // due_date é `date` (YYYY-MM-DD): comparação de string é segura e ordena igual a data.
  // created_at é timestamp do banco — comparado por Date.parse, nunca como string
  // (`+00:00` vs `.000Z` são o mesmo instante escrito diferente).
  const ordenado = comData.slice().sort((a, b) => {
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    const ca = Date.parse(a.created_at) || 0;
    const cb = Date.parse(b.created_at) || 0;
    if (ca !== cb) return ca - cb;
    return String(a.id) < String(b.id) ? -1 : 1; // estabilidade: nunca depender da ordem de entrada
  });
  return { modo: 'exato', tarefa: ordenado[0], motivo: 'serie' };
}

module.exports = { resolveTaskTarget, serieDe };
```

- [ ] **Passo 4: rodar e ver passar**

```bash
node --test src/lib/task-target.test.js
```
Esperado: `pass 10 / fail 0`.

- [ ] **Passo 5: prova de mutação (item 7.2 da spec)**

Cada sabotagem tem de derrubar teste. Rodar as três, uma por vez, restaurando entre elas.

```bash
cp src/lib/task-target.js /tmp/tt.orig
```

Sabotagem 1 — voltar ao critério legado:
```bash
node -e "const f='src/lib/task-target.js',fs=require('fs');let s=fs.readFileSync(f,'utf8');const a=s;s=s.replace('if (ca !== cb) return ca - cb;','if (ca !== cb) return cb - ca;').replace(\"if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;\",'if (a.due_date !== b.due_date) return a.due_date > b.due_date ? -1 : 1;');if(s===a){console.error('NAO MUTOU');process.exit(1)}fs.writeFileSync(f,s)"
node --test src/lib/task-target.test.js   # esperado: fail >= 2
cp /tmp/tt.orig src/lib/task-target.js
```

Sabotagem 2 — aceitar linhagens distintas como série:
```bash
node -e "const f='src/lib/task-target.js',fs=require('fs');let s=fs.readFileSync(f,'utf8');const a=s;s=s.replace(\"if (series.some((s) => s === null) || distintas.size !== 1) {\",'if (false) {');if(s===a){console.error('NAO MUTOU');process.exit(1)}fs.writeFileSync(f,s)"
node --test src/lib/task-target.test.js   # esperado: fail >= 2
cp /tmp/tt.orig src/lib/task-target.js
```

Sabotagem 3 — devolver exato sem candidato:
```bash
node -e "const f='src/lib/task-target.js',fs=require('fs');let s=fs.readFileSync(f,'utf8');const a=s;s=s.replace(\"if (lista.length === 0) return { modo: 'nenhum', motivo: 'sem_candidato' };\",\"if (lista.length === 0) return { modo: 'exato', motivo: 'sem_candidato' };\");if(s===a){console.error('NAO MUTOU');process.exit(1)}fs.writeFileSync(f,s)"
node --test src/lib/task-target.test.js   # esperado: fail >= 1
cp /tmp/tt.orig src/lib/task-target.js
```

Conferir que não sobrou resíduo:
```bash
node --test src/lib/task-target.test.js   # 10/10 verde
git diff --stat src/lib/task-target.js    # tem que estar como o passo 3 deixou
```

- [ ] **Passo 6: commit**

```bash
git add src/lib/task-target.js src/lib/task-target.test.js
git commit -m "feat(task-target): modulo puro do alvo de tarefa — ciclo corrente da serie"
```

---

### Task 2: `logMarker` sem truncar o payload

**Arquivos:**
- Modificar: `src/engine.js:221-236` (função `logMarker`)
- Testar: sem teste unitário próprio — `logMarker` escreve no banco e não é exportada. A cobertura vem da Task 3, que verifica o payload gravado.

**Interfaces:**
- Consome: nada.
- Produz: `logMarker(collaboratorId, markerType, result, reason, raw, { rawLimit })` — sexto argumento opcional. As tarefas 3 a 5 chamam com `{ rawLimit: 4000 }`.

**Por quê:** o payload de ambiguidade que o Alfredo exigiu (seção 7.5 da spec) não cabe em 500
caracteres. A coluna `marker_logs.raw_excerpt` é `text` **sem limite no banco** — o corte é só
no JS. Um parâmetro opcional resolve sem tocar nos 100+ call sites existentes.

- [ ] **Passo 1: aplicar a mudança**

Em `src/engine.js`, trocar a assinatura e a linha do corte:

```js
// ANTES
async function logMarker(collaboratorId, markerType, result, reason = null, raw = null) {
  try {
    let excerpt = null;
    if (raw) excerpt = typeof raw === 'string' ? raw.slice(0, 500) : JSON.stringify(raw).slice(0, 500);

// DEPOIS
// `rawLimit` existe para o payload de TASK_TARGET_AMBIGUOUS, que precisa carregar a lista de
// candidatos para desenhar a Fatia B — em 500 chars ele chegaria cortado no meio do JSON, o que
// é pior que não gravar (parece dado e não é). A coluna é `text` sem limite no banco.
async function logMarker(collaboratorId, markerType, result, reason = null, raw = null, { rawLimit = 500 } = {}) {
  try {
    let excerpt = null;
    if (raw) excerpt = typeof raw === 'string' ? raw.slice(0, rawLimit) : JSON.stringify(raw).slice(0, rawLimit);
```

- [ ] **Passo 2: verificar sintaxe e zero-regressão**

```bash
node --check src/engine.js
node --test "src/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Esperado: `pass 2272 / fail 3` (2262 do baseline + 10 da Task 1).

- [ ] **Passo 3: PREFLIGHT — provar que a linha entra no banco (trava do Alfredo)**

Não basta ler o schema. `logMarker` engole erro de insert (`if (error) console.error`), então
uma constraint violada faz o log rico morrer **em silêncio** e a Fatia B nasce cega. A prova é
inserir de verdade.

Já conferido em 06/08, e o resultado mudou o plano:

- `marker_logs.marker_type` — **sem CHECK**, aceita `TASK_TARGET_AMBIGUOUS`. ✅
- `marker_logs.result` — **TEM CHECK**: `['executed','rejected','skipped','redirected','fallback']`.
  A primeira versão deste plano usava `'observed'`, que **teria falhado calado**. Corrigido para `'fallback'`.
- `raw_excerpt` é `text` **sem limite** no banco — o corte de 500 era só no JS.

Rodar contra o banco real (Supabase MCP ou psql), com um colaborador válido:

```sql
insert into marker_logs (collaborator_id, marker_type, result, reason, raw_excerpt)
values (
  (select id from collaborators limit 1),
  'TASK_TARGET_AMBIGUOUS', 'fallback', 'preflight',
  repeat('x', 4000)
)
returning id, marker_type, result, length(raw_excerpt) as chars;
```

Esperado: **1 linha, `chars = 4000`**. Se o insert falhar, ou se `chars` vier menor que 4000,
**pare** — o payload não cabe e a Task 3 precisa de outro destino antes de seguir.

A linha de preflight fica no banco de propósito (é evidência, e `marker_logs` é tabela de log).
Ela é identificável por `reason = 'preflight'` — **as consultas de medição da Task 7 já
excluem**, e é por isso que elas filtram `reason <> 'preflight'`.

- [ ] **Passo 4: commit**

```bash
git add src/engine.js
git commit -m "chore(marker): rawLimit opcional no logMarker (payload de ambiguidade nao cabe em 500)"
```

---

### Task 3: Ligar no handler `reschedule` + payload de ambiguidade

**Arquivos:**
- Modificar: `src/engine.js:4735-4763` (bloco `title-lookup` do `reschedule`)

**Interfaces:**
- Consome: `resolveTaskTarget`, `serieDe` (Task 1); `logMarker(..., { rawLimit })` (Task 2).
- Produz: o helper `_logAlvoAmbiguo(handler, tituloPedido, collaboratorId, candidatos)`, usado igual nas tarefas 4 e 5.

**Antes de editar `src/`:**

```bash
printf 'fatia A do alvo de tarefa (%s)\n' "$(date -u +%FT%TZ)" > /d/la-organizer/.deploy-hold
```

- [ ] **Passo 1: adicionar o import e o helper de log**

No topo de `src/engine.js`, junto dos outros `require('./lib/...')` (perto da linha 46):

```js
const { resolveTaskTarget, serieDe } = require('./lib/task-target');
```

Logo depois da função `logMarker` (após a linha ~236), adicionar:

```js
// Ambiguidade real (linhagens distintas) NÃO é resolvida na Fatia A — mantém o comportamento
// legado e registra. O payload precisa ser rico: contar ocorrência diz QUANTO, não diz O QUE, e
// é o o-que que desenha o desempate da Fatia B. `vencedor_legado` é o campo que depois
// transforma "7% ambíguo" em "X% ambíguo E ERRADO" — sem ele não dá para saber quantas vezes o
// comportamento mantido aqui acertou por acaso.
async function _logAlvoAmbiguo(handler, tituloPedido, collaboratorId, candidatos) {
  try {
    const porLegado = candidatos.slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const comData = candidatos.filter((t) => t.due_date)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
    const payload = {
      handler,
      titulo_pedido: String(tituloPedido || ''),
      collaborator_id: collaboratorId,
      n: candidatos.length,
      motivo: 'linhagens_distintas',
      // Cap de 10 na LISTA (o `n` acima continua exato). Grupos ambíguos reais medidos em 06/08
      // têm ~3 candidatos; 10 é folga. Sem cap, uma série de 42 geraria 6 KB por linha de log.
      candidatos: candidatos.slice(0, 10).map((t) => ({
        id: t.id, title: t.title, due_date: t.due_date,
        serie: serieDe(t), created_at: t.created_at,
      })),
      linhagens: [...new Set(candidatos.map(serieDe))],
      vencedor_legado: porLegado[0] ? porLegado[0].id : null,
      vencedor_serie: comData[0] ? comData[0].id : null,
    };
    console.warn(`[TaskTarget] ambiguo handler=${handler} n=${candidatos.length} motivo=linhagens_distintas pedido="${String(tituloPedido).slice(0, 60)}" legado=${String(payload.vencedor_legado).slice(0, 8)}`);
    // `result` tem CHECK no banco: só ['executed','rejected','skipped','redirected','fallback'].
    // Qualquer outro valor viola a constraint, e `logMarker` NÃO lança — só faz console.error.
    // O log rico morreria em silêncio, que é exatamente o que esta instrumentação existe para
    // evitar. 'fallback' é o valor honesto: a Fatia A caiu no comportamento legado.
    await logMarker(collaboratorId, 'TASK_TARGET_AMBIGUOUS', 'fallback', handler, payload, { rawLimit: 4000 });
  } catch (e) {
    console.error('[TaskTarget] falha ao logar ambiguidade:', e.message);
  }
}
```

- [ ] **Passo 2: trocar o lookup do `reschedule`**

Em `src/engine.js`, no ramo do `reschedule` (~4735), substituir a consulta e a escolha:

```js
// ANTES
          const { data: byTitle } = await supabase
            .from('tasks')
            .select('id, title, status, due_date, assigned_to, created_by')
            .or(`assigned_to.eq.${collaborator.id},created_by.eq.${collaborator.id}`)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

// DEPOIS
          // FATIA A: busca TODOS os candidatos (o `.limit(1)` escondia a pluralidade) e deixa a
          // decisão para o módulo puro. O `ilike` fica — o bug é o limit(1) fingindo certeza,
          // não o LIKE, que é o que dá recall para fala humana incompleta.
          const _SERIE_ON = process.env.TOM_TASK_TARGET_SERIES === '1';
          const _q = supabase
            .from('tasks')
            .select('id, title, status, due_date, assigned_to, created_by, recurrence_rule, recurrence_parent_id, created_at')
            .or(`assigned_to.eq.${collaborator.id},created_by.eq.${collaborator.id}`)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")');
          const { data: _cands } = _SERIE_ON
            ? await _q.order('due_date', { ascending: true, nullsFirst: false }).limit(100)
            : await _q.order('created_at', { ascending: false }).limit(1);
          if (_SERIE_ON && _cands && _cands.length === 100) {
            console.warn(`[TaskTarget] cap atingido handler=reschedule pedido="${String(a.title).slice(0, 60)}" — teto silencioso vira falso-verde`);
          }
          let byTitle = null;
          if (!_SERIE_ON) {
            byTitle = (_cands && _cands[0]) || null;
          } else {
            const _r = resolveTaskTarget({ candidatos: _cands || [] });
            if (_r.modo === 'exato') {
              byTitle = _r.tarefa;
              if (_r.motivo === 'serie') console.log(`[TaskTarget] serie handler=reschedule n=${(_cands || []).length} → ${String(byTitle.id).slice(0, 8)} due=${byTitle.due_date}`);
            } else if (_r.modo === 'ambiguo') {
              // Fatia A não resolve ambiguidade real: mantém o legado e registra.
              await _logAlvoAmbiguo('reschedule', a.title, collaborator.id, _r.candidatos);
              byTitle = _r.candidatos.slice().sort((x, y) => (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0))[0] || null;
            }
          }
```

O resto do bloco (`if (byTitle) { … } else { … }`) fica **exatamente como está**, incluindo a
mensagem de "a tarefa é de outra pessoa".

- [ ] **Passo 3: golden de zero-regressão**

Criar `src/lib/task-target.golden.test.js`:

```js
'use strict';
// Zero-regressão: para título SEM duplicata, o alvo com a flag ligada tem de ser o mesmo da
// flag desligada. Se divergir aqui, a fatia mudou comportamento onde não devia.
const test = require('node:test');
const assert = require('node:assert');
const { resolveTaskTarget } = require('./task-target');

const legado = (cands) => cands.slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))[0] || null;

test('titulo SEM duplicata: flag ligada e desligada escolhem a MESMA tarefa', () => {
  const um = [{ id: 'so-essa', title: 'Renovar contrato', due_date: '2026-08-20',
                recurrence_parent_id: null, recurrence_rule: null, created_at: '2026-08-01T10:00:00Z' }];
  const comFlag = resolveTaskTarget({ candidatos: um });
  assert.equal(comFlag.modo, 'exato');
  assert.equal(comFlag.tarefa.id, legado(um).id);
});

test('ambiguidade real: a Fatia A tem de escolher o MESMO que o legado (so loga)', () => {
  const cands = [
    { id: 'nova', title: 'Anamnese', due_date: '2026-08-30', recurrence_parent_id: 'A', recurrence_rule: null, created_at: '2026-08-05T10:00:00Z' },
    { id: 'velha', title: 'Anamnese', due_date: '2026-08-10', recurrence_parent_id: 'B', recurrence_rule: null, created_at: '2026-07-01T10:00:00Z' },
  ];
  const r = resolveTaskTarget({ candidatos: cands });
  assert.equal(r.modo, 'ambiguo', 'linhagens distintas nao podem virar exato na Fatia A');
  assert.equal(legado(cands).id, 'nova', 'controle: o legado escolhe a criada por ultimo');
});
```

- [ ] **Passo 4: rodar tudo**

```bash
node --check src/engine.js
node --test src/lib/task-target.test.js src/lib/task-target.golden.test.js
node --test "src/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Esperado: `pass 2274 / fail 3`.

- [ ] **Passo 5: commit**

```bash
git add src/engine.js src/lib/task-target.golden.test.js
git commit -m "fix(reschedule): alvo por ciclo corrente da serie atras da flag TOM_TASK_TARGET_SERIES"
```

---

### Task 4: Ligar no handler `complete`

**Arquivos:**
- Modificar: `src/engine.js:4405-4424` (bloco `title-lookup` do `complete`)

**Interfaces:**
- Consome: `resolveTaskTarget` e `_logAlvoAmbiguo` (Task 3).
- Produz: nada novo.

**Por que é o mais importante dos três:** *"conclui a Presença Emusys"* marcava a instância de
setembro como feita e deixava a de agosto, atrasada, aberta. O TOM afirma "✅ concluí" e o
trabalho continua lá — isso é confabulação, não só pedido perdido.

**Atenção ao escopo:** este handler filtra por `.eq('assigned_to', collaborator.id)` — **só o
responsável**, diferente do `reschedule` que aceita `assigned_to OR created_by`. **Preservar
como está.** Unificar seria mudança de comportamento fora do escopo desta fatia.

- [ ] **Passo 1: trocar o lookup**

```js
// ANTES
          const { data: byTitleC } = await supabase
            .from('tasks')
            .select('id')
            .eq('assigned_to', collaborator.id)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

// DEPOIS
          const _SERIE_ON_C = process.env.TOM_TASK_TARGET_SERIES === '1';
          const _qC = supabase
            .from('tasks')
            .select('id, title, due_date, recurrence_rule, recurrence_parent_id, created_at')
            .eq('assigned_to', collaborator.id)   // escopo do complete: SÓ responsável — não unificar
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")');
          const { data: _candsC } = _SERIE_ON_C
            ? await _qC.order('due_date', { ascending: true, nullsFirst: false }).limit(100)
            : await _qC.order('created_at', { ascending: false }).limit(1);
          if (_SERIE_ON_C && _candsC && _candsC.length === 100) {
            console.warn(`[TaskTarget] cap atingido handler=complete pedido="${String(a.title).slice(0, 60)}"`);
          }
          let byTitleC = null;
          if (!_SERIE_ON_C) {
            byTitleC = (_candsC && _candsC[0]) || null;
          } else {
            const _rC = resolveTaskTarget({ candidatos: _candsC || [] });
            if (_rC.modo === 'exato') {
              byTitleC = _rC.tarefa;
              if (_rC.motivo === 'serie') console.log(`[TaskTarget] serie handler=complete n=${(_candsC || []).length} → ${String(byTitleC.id).slice(0, 8)} due=${byTitleC.due_date}`);
            } else if (_rC.modo === 'ambiguo') {
              await _logAlvoAmbiguo('complete', a.title, collaborator.id, _rC.candidatos);
              byTitleC = _rC.candidatos.slice().sort((x, y) => (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0))[0] || null;
            }
          }
```

O `if (byTitleC) { a.id = byTitleC.id.replace(...) … }` seguinte fica intacto.

- [ ] **Passo 2: rodar**

```bash
node --check src/engine.js
node --test "src/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Esperado: `pass 2274 / fail 3` (sem teste novo — a prova é o cenário B, Task 6).

- [ ] **Passo 3: commit**

```bash
git add src/engine.js
git commit -m "fix(complete): alvo por ciclo corrente — concluir a instancia de setembro deixava a atrasada aberta"
```

---

### Task 5: Ligar no handler `cancel`

**Arquivos:**
- Modificar: `src/engine.js:4654-4673` (bloco `title-lookup` do `cancel`)

**Interfaces:**
- Consome: `resolveTaskTarget` e `_logAlvoAmbiguo` (Task 3).
- Produz: nada novo.

**Por que não pular:** deixar 1 dos 3 sem a regra é exatamente a armadilha recorrente da casa —
regra presente em N leitores e ausente no N+1 (`GROUPPKG-CONTAINER-PHANTOM-FLATLIST`, 20/06;
caso Rose, 03/08). O escopo aqui é `.eq('assigned_to', …)`, igual ao `complete`.

- [ ] **Passo 1: trocar o lookup**

```js
// ANTES
          const { data: byTitleCan } = await supabase
            .from('tasks')
            .select('id')
            .eq('assigned_to', collaborator.id)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

// DEPOIS
          const _SERIE_ON_X = process.env.TOM_TASK_TARGET_SERIES === '1';
          const _qX = supabase
            .from('tasks')
            .select('id, title, due_date, recurrence_rule, recurrence_parent_id, created_at')
            .eq('assigned_to', collaborator.id)
            .ilike('title', `%${String(a.title).slice(0, 60)}%`)
            .not('status', 'in', '("done","cancelled")');
          const { data: _candsX } = _SERIE_ON_X
            ? await _qX.order('due_date', { ascending: true, nullsFirst: false }).limit(100)
            : await _qX.order('created_at', { ascending: false }).limit(1);
          if (_SERIE_ON_X && _candsX && _candsX.length === 100) {
            console.warn(`[TaskTarget] cap atingido handler=cancel pedido="${String(a.title).slice(0, 60)}"`);
          }
          let byTitleCan = null;
          if (!_SERIE_ON_X) {
            byTitleCan = (_candsX && _candsX[0]) || null;
          } else {
            const _rX = resolveTaskTarget({ candidatos: _candsX || [] });
            if (_rX.modo === 'exato') {
              byTitleCan = _rX.tarefa;
              if (_rX.motivo === 'serie') console.log(`[TaskTarget] serie handler=cancel n=${(_candsX || []).length} → ${String(byTitleCan.id).slice(0, 8)} due=${byTitleCan.due_date}`);
            } else if (_rX.modo === 'ambiguo') {
              await _logAlvoAmbiguo('cancel', a.title, collaborator.id, _rX.candidatos);
              byTitleCan = _rX.candidatos.slice().sort((x, y) => (Date.parse(y.created_at) || 0) - (Date.parse(x.created_at) || 0))[0] || null;
            }
          }
```

- [ ] **Passo 2: rodar**

```bash
node --check src/engine.js
node --test "src/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Esperado: `pass 2274 / fail 3`.

- [ ] **Passo 3: commit**

```bash
git add src/engine.js
git commit -m "fix(cancel): alvo por ciclo corrente — fecha a terceira porta do mesmo defeito"
```

---

### Task 6: Cenário B do Replay Lab + prova de reversão

**Arquivos:**
- Criar: `scripts/replay-lab-cenario-serie.js`

**Interfaces:**
- Consome: `scripts/replay-lab-run.sh` (runner já existente — exporta `TOM_QA_RUN_ID`, `TOM_QA_PHONES`, `TOM_QA_EVIDENCE_FILE`, `WEBHOOK_SECRET` e sobe a instância efêmera na 3199); `src/services/turn-claim.js` (`evidenciasQA`, `limparEvidenciasQA`).
- Produz: cenário rodável por `N=20 bash scripts/replay-lab-run.sh cenario-serie`.

**Modelo:** copiar a estrutura de `scripts/replay-lab-cenario-piso.js` (já em produção, 8
verificações, N=20 verde). Reaproveitar dele: `ymdBrt`, `injetar`, `esperarTurno`, `falasDoTom`,
`limparFixture` (fail-closed por `run_id` **e** faixa `5500…`), e o bloco de taxa.

- [ ] **Passo 1: escrever o cenário**

Fixture por repetição: criar **uma série** de 12 instâncias do mesmo título, com
`recurrence_parent_id` comum, `due_date` de `hoje-2` até `hoje+40`, todas `pending`. Reproduz
`Presença Emusys` em escala menor (12 em vez de 35 — o suficiente para o defeito aparecer, e
12× mais rápido de montar e limpar).

Pedido injetado: `"passa a <TITULO> pra <NOME_DIA>"`, com `<NOME_DIA>` derivado de `hoje+2`
como no cenário A (datas relativas — cravadas, o cenário muda de significado sozinho depois da
meia-noite).

Verificações, todas **absolutas**:

| Verificação | Critério |
|---|---|
| `webhook_200` | injeção respondeu 200 |
| `tom_respondeu` | ao menos 1 outbound suprimido COM texto |
| `mexeu_na_corrente` | a instância alterada é a de **menor `due_date`** (a de `hoje-2`) |
| `nao_mexeu_nas_outras` | as outras 11 instâncias seguem com `due_date` original |
| `fala_confere` | se a fala nomeia um dia da semana, é o do alvo |
| `evidencia_com_run` | recibo carrega o `run_id` |

Piso: `mexeu_na_corrente` e `nao_mexeu_nas_outras` são **N/N** (absolutos). `fala_confere` e o
reconhecimento do pedido são estatísticos (`ceil(N*0.95)`) — o LLM não é determinístico.

Limpeza: `tasks` do run por prefixo `[<RUN_ID>]` no título, `notifications` por `reference_id`
das criadas, e `conversation_history` do perfil QA a partir do início do run. Fail-closed:
sem `run_id` válido ou telefone fora da faixa `5500…`, **recusa limpar**.

- [ ] **Passo 2: rodar com a flag LIGADA — tem de passar**

```bash
TOM_TASK_TARGET_SERIES=1 N=5 bash scripts/replay-lab-run.sh cenario-serie
```
Esperado: `=== CENÁRIO B: APROVADO ===`, resíduo 0.

- [ ] **Passo 3: prova de reversão — flag DESLIGADA tem de REPROVAR**

```bash
N=3 bash scripts/replay-lab-run.sh cenario-serie
```
Esperado: `=== CENÁRIO B: REPROVADO ===`, com `mexeu_na_corrente` em `0/3`.

**Se passar verde com a flag desligada, PARE.** O cenário não está medindo nada — foi
exatamente assim que o cenário A passou por vacuidade na primeira versão (dirigia
`remindOperationalTasks`, que nem lê `remind_at`). Nesse caso o defeito está no cenário, não no
código, e ele precisa ser refeito antes de qualquer deploy.

- [ ] **Passo 4: bateria oficial**

```bash
TOM_TASK_TARGET_SERIES=1 N=20 bash scripts/replay-lab-run.sh cenario-serie
```
Esperado: absolutos 20/20, estatísticos ≥ 19/20, resíduo 0.

- [ ] **Passo 5: commit**

```bash
git add scripts/replay-lab-cenario-serie.js
git commit -m "test(replay-lab): cenario B — alvo por ciclo corrente, com prova de reversao"
```

---

### Task 7: Deploy com a flag e medição

**Arquivos:**
- Modificar: `/opt/LA-Organizer/.env` na VPS (só a linha da flag)

**Interfaces:**
- Consome: tudo das tarefas 1 a 6.
- Produz: a medição que dimensiona a Fatia B.

- [ ] **Passo 1: push ANTES do SCP**

```bash
cd /d/la-organizer/_remote
git fetch -q origin main && git push origin main
git log --oneline origin/main -1
```

Patch que vive só na VPS é apagado pelo próximo `git reset --hard origin/main`, **em silêncio**.
Aconteceu em 06/08.

- [ ] **Passo 2: conferir paridade ANTES de sobrescrever**

```bash
for f in src/engine.js src/lib/task-target.js; do
  vps=$(ssh tom "md5sum /opt/LA-Organizer/$f 2>/dev/null | cut -d' ' -f1")
  ori=$(git show origin/main:$f | md5sum | cut -d' ' -f1)
  [ "$vps" = "$ori" ] && echo "ja em paridade $f" || echo "precisa subir  $f"
done
```

- [ ] **Passo 3: subir e conferir checksum**

```bash
scp -q src/lib/task-target.js src/lib/task-target.test.js src/lib/task-target.golden.test.js tom:/opt/LA-Organizer/src/lib/
scp -q src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp -q scripts/replay-lab-cenario-serie.js tom:/opt/LA-Organizer/scripts/
for f in src/engine.js src/lib/task-target.js; do
  [ "$(md5sum $f | cut -d' ' -f1)" = "$(ssh tom "md5sum /opt/LA-Organizer/$f | cut -d' ' -f1")" ] && echo "confere $f" || echo "DIVERGE $f"
done
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && node --test src/lib/task-target.test.js 2>&1 | grep -E '^# (pass|fail)'"
```

- [ ] **Passo 4: ligar a flag e reiniciar**

```bash
ssh tom "cd /opt/LA-Organizer && cp .env /root/.env.bak-serie-\$(date +%s) && \
  (grep -qE '^TOM_TASK_TARGET_SERIES=' .env && sed -i 's|^TOM_TASK_TARGET_SERIES=.*|TOM_TASK_TARGET_SERIES=1|' .env || echo 'TOM_TASK_TARGET_SERIES=1' >> .env) && \
  grep -E '^TOM_TASK_TARGET_SERIES=' .env && pm2 restart tom --update-env >/dev/null 2>&1 && sleep 7 && pm2 list | grep ' tom '"
ssh tom "tail -5 /opt/LA-Organizer/logs/tom-out.log; tail -5 /opt/LA-Organizer/logs/tom-error.log | grep -viE 'ExperimentalWarning|punycode'"
```

`--update-env` é obrigatório: sem ele o pm2 reinicia com o ambiente antigo e a flag não vale.

- [ ] **Passo 5: rollback em 10 segundos, se precisar**

```bash
ssh tom "cd /opt/LA-Organizer && sed -i 's|^TOM_TASK_TARGET_SERIES=.*|TOM_TASK_TARGET_SERIES=0|' .env && pm2 restart tom --update-env"
```

- [ ] **Passo 6: soltar o `.deploy-hold`**

Só com a árvore limpa (`git status --short` vazio para `src/`):

```bash
rm -f /d/la-organizer/.deploy-hold
```

- [ ] **Passo 7: medir depois de 7 dias**

```sql
-- Quantas vezes a regra de série agiu, e quantas ficou ambíguo
select marker_type, reason as handler, count(*)
from marker_logs
where marker_type = 'TASK_TARGET_AMBIGUOUS' and reason <> 'preflight'
  and created_at > now() - interval '7 days'
group by 1,2 order by 3 desc;

-- O número que decide a Fatia B: com que frequência o legado escolheria diferente da série
select count(*) filter (where (raw_excerpt::jsonb->>'vencedor_legado') is distinct from (raw_excerpt::jsonb->>'vencedor_serie')) as legado_teria_errado,
       count(*) as ambiguos_total
from marker_logs
where marker_type = 'TASK_TARGET_AMBIGUOUS' and reason <> 'preflight'
  and created_at > now() - interval '7 days';
```

E a métrica que justifica a trilha inteira — `dropped_request` antes x depois:

```sql
select date_trunc('week', occurred_at)::date as semana, count(*), count(distinct collaborator_id) as pessoas
from tom_audit_findings
where category = 'dropped_request' and occurred_at > now() - interval '6 weeks'
group by 1 order by 1;
```

---

## Auto-revisão do plano

**Cobertura da spec:** §3 arquitetura → Task 1. §4 regra → Task 1 (passos 1 e 3). §5 três
handlers → Tasks 3, 4, 5. §6 flag → Tasks 3-5 (leitura) e 7 (ativação). §7.1 unitário → Task 1
passo 1. §7.2 mutação → Task 1 passo 5. §7.3 zero-regressão → Task 3 passo 3 + suíte cheia em
todas as tarefas. §7.4 cenário B e reversão → Task 6. §7.5 log rico → Task 2 (limite) + Task 3
(payload). §8 Fatia B → fora do escopo, declarada. Sem lacuna.

**Placeholders:** nenhum "TBD"/"tratar erros adequadamente"/"similar à Task N" — cada bloco de
código está escrito por extenso, inclusive os repetidos entre as Tasks 4 e 5, de propósito
(quem executa pode ler fora de ordem).

**Consistência de tipos:** `resolveTaskTarget({ candidatos })` e `serieDe(t)` usados com a mesma
assinatura nas Tasks 1, 3, 4, 5. `logMarker(..., { rawLimit })` definido na Task 2 e usado na
Task 3. As variáveis de cada handler têm sufixo próprio (`_qC`/`_candsC`/`_rC` no complete,
`_qX`/`_candsX`/`_rX` no cancel) — estão no mesmo `try` do mesmo laço e colidiriam sem isso.
