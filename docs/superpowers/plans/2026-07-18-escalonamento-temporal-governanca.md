# Escalonamento temporal da governança — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans pra implementar task-a-task. Steps usam checkbox (`- [ ]`).

**Goal:** Fazer a cobrança de tarefa atrasada escalar por faixa de dias úteis — 1-2 = pessoa, 3-5 = líder, 6+ = CEO — trocando o filtro que hoje deixa tarefa de 1 dia vazar pro digest do CEO.

**Architecture:** Uma função pura nova (`businessDaysOverdue`, dias úteis pulando domingo) + uma linha de filtro trocada em `dispatcher.js`. A exibição do card não muda (usa outra função); o gate passa a ser determinístico por dias úteis. Zero migration, zero mudança na cobrança individual da pessoa.

**Tech Stack:** Node.js CommonJS (`node:test` + `node:assert`), Supabase JS. Deploy por scp cirúrgico na VPS.

**Spec:** `docs/superpowers/specs/2026-07-18-escalonamento-temporal-governanca-design.md` — aprovada pelo Alf em 18/07. Referências `§N` apontam pra ela.

## Global Constraints

- **`.deploy-hold` fica em `D:\la-organizer\.deploy-hold`** — o diretório **PAI** de `_remote`, **não** dentro dele. Criar em `_remote/.deploy-hold` é inerte e o deploy dispara mesmo assim.
- **NÃO commitar entre tasks.** `_remote` **não é repo git** — não rode `git` lá dentro. 1 commit bundle no fim (via Stop hook, quando o hold sair).
- **Datas: `Date.UTC` sobre componentes YMD.** NUNCA `new Date(str)` local nem `toISOString().slice(0,10)` (desloca o dia após 21h BRT).
- **A exibição do card NÃO muda.** `leader-cards.js → daysBetweenYmd` (dias corridos) segue intacta — o card que subiu 17/07 mostra "7d" igual. O gate é OUTRA função. Zero-regressão no card.
- **`checkOverdueAlerts` (cobrança da pessoa, 1-5 dias) NÃO muda** — já é a fronteira certa da escada (§5).
- **`perLeaderUnclosedTasksReport` é código MORTO** — não tocar (dívida separada).
- **Comando da suíte: `node --test 'src/**/*.test.js'`** (aspas + glob). **`node --test src/` NÃO funciona** (node v24 trata o diretório como 1 teste → `fail 1` sempre).
- **Baseline local (medido 18/07): `pass 1977 / fail 2`.** Os 2 (`system-loadout.test.js`, `pending-intents-detect.test.js`) falham por AMBIENTE (`.env`/`src/supabase` gitignored, não existem local). **Não pode virar 3.** `dates.test.js` roda **verde local** (7/7) — a Task 1 é 100% observável sem VPS.
- **Nada que faça `require` de banco roda local.** `dispatcher.js` importa supabase no topo → o gate (Task 2) só valida por `node --check` local + dry-run na VPS (Task 3).
- **Zero migration.** Tudo lê `due_date`/`status`, que já existem.
- **Voz do TOM sagrada** — nada toca prompt/skill.
- Todos os comandos a partir de `D:\la-organizer\_remote` (git-bash: `cd /d/la-organizer/_remote`).

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/utils/dates.js` | utils de data. **Ganha** `businessDaysOverdue`. | 1 |
| `src/utils/dates.test.js` | testa `dates.js` (7 testes hoje). **Ganha** os casos de dias úteis. | 1 |
| `src/rituals/dispatcher.js` | I/O + montagem dos digests. **Troca** 1 linha de filtro (:2734). | 2 |

---

### Task 1: `businessDaysOverdue` — dias úteis pulando domingo

**Por que primeiro:** é pura, roda verde local, não deploya. A base de tudo. Se a régua de dias estiver errada, a escada dispara errado — então ela nasce com TDD antes de qualquer fio no dispatcher.

**Files:**
- Modify: `src/utils/dates.js` (adicionar função + export)
- Test: `src/utils/dates.test.js` (append)

**Interfaces:**
- Consumes: nada.
- Produces: `businessDaysOverdue(dueYmd, todayYmd) → int` — dias ÚTEIS decorridos após o vencimento (domingo não conta). `0` se `todayYmd <= dueYmd`. Ambos os args são strings `'YYYY-MM-DD'`.

- [ ] **Step 1: Registrar o baseline (antes de tocar em nada)**

```bash
cd /d/la-organizer/_remote && node --test src/utils/dates.test.js 2>&1 | grep -aE "(tests|pass|fail) [0-9]+"
```

Esperado: `pass 7 / fail 0`. Se não for 7, **pare** — o baseline mudou.

- [ ] **Step 2: Escrever os testes que falham**

Append em `src/utils/dates.test.js`. Os casos vêm da §7/§9 da spec. **`2026-07-17` é uma sexta** — âncora usada nos casos (confira: sáb 18, dom 19, seg 20, ter 21, qua 22).

```js
// ── businessDaysOverdue (§7/§9) — dias ÚTEIS de atraso, domingo não conta ────
const { businessDaysOverdue } = require('./dates');

test('businessDaysOverdue: não atrasada → 0', () => {
  assert.strictEqual(businessDaysOverdue('2026-07-17', '2026-07-17'), 0); // hoje == vencimento
  assert.strictEqual(businessDaysOverdue('2026-07-17', '2026-07-16'), 0); // hoje ANTES do vencimento
});

test('businessDaysOverdue: vence sexta → sáb=1, dom=1, seg=2, ter=3, qua=4', () => {
  const sex = '2026-07-17';
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-18'), 1); // sábado CONTA
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-19'), 1); // domingo NÃO conta (segue 1)
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-20'), 2); // segunda
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-21'), 3); // terça → entra no líder
  assert.strictEqual(businessDaysOverdue(sex, '2026-07-22'), 4); // quarta
});

test('businessDaysOverdue: vence sábado, hoje domingo → 0 (§9 caso 4)', () => {
  // o único dia decorrido é domingo, que não é útil. Segunda vira 1.
  assert.strictEqual(businessDaysOverdue('2026-07-18', '2026-07-19'), 0); // sáb→dom
  assert.strictEqual(businessDaysOverdue('2026-07-18', '2026-07-20'), 1); // sáb→seg
});

test('businessDaysOverdue: intervalo com 2 domingos = corridos − 2', () => {
  // sex 17/07 → sex 31/07 = 14 dias corridos, 2 domingos (19 e 26) no meio → 12 úteis
  assert.strictEqual(businessDaysOverdue('2026-07-17', '2026-07-31'), 12);
});

test('businessDaysOverdue: limiar 6 úteis — vence sexta cai no CEO 8 dias corridos depois', () => {
  // sex 17 → seg 27 = 10 corridos, domingos 19+26 = 2 → 8 úteis (>= 6, entra no CEO)
  assert.strictEqual(businessDaysOverdue('2026-07-17', '2026-07-27'), 8);
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
cd /d/la-organizer/_remote && node --test src/utils/dates.test.js 2>&1 | grep -aE "(tests|pass|fail) [0-9]+"
```

Esperado: falha — `businessDaysOverdue is not a function` (os 5 novos vermelhos, os 7 antigos verdes).

- [ ] **Step 4: Implementar a função**

Em `src/utils/dates.js`, adicionar antes do `module.exports` (linha ~132). Mesmo estilo do `daysOverdue` do dispatcher (`Date.UTC` sobre componentes):

```js
/**
 * Dias ÚTEIS de atraso — quantos dias úteis (domingo excluído) decorreram DESDE o
 * vencimento até hoje. Sábado CONTA (a LA dá aula sábado); só domingo é pulado.
 * Determinístico: weekday via Date.UTC sobre componentes YMD, sem fuso.
 *   businessDaysOverdue('2026-07-17'(sex), '2026-07-21'(ter)) === 3
 * @param {string} dueYmd   'YYYY-MM-DD'
 * @param {string} todayYmd 'YYYY-MM-DD'
 * @returns {number} 0 se today <= due; senão nº de dias úteis decorridos.
 */
function businessDaysOverdue(dueYmd, todayYmd) {
  const [dy, dm, dd] = String(dueYmd).split('-').map(Number);
  const [ty, tm, td] = String(todayYmd).split('-').map(Number);
  const due = Date.UTC(dy, dm - 1, dd);
  const today = Date.UTC(ty, tm - 1, td);
  if (today <= due) return 0;
  let uteis = 0;
  // Conta cada dia APÓS o vencimento até hoje (inclusive); domingo (getUTCDay===0) não soma.
  for (let t = due + 86400000; t <= today; t += 86400000) {
    if (new Date(t).getUTCDay() !== 0) uteis += 1;
  }
  return uteis;
}
```

E no `module.exports` (linha ~132), adicionar `businessDaysOverdue`:

```js
module.exports = { safeIsoDate, safeDate, formatRelativeDate, withinConfirmWindow, FRESH_WINDOW_MIN, buildBrtDateAnchor, todayYmdSP, businessDaysOverdue };
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd /d/la-organizer/_remote && node --test src/utils/dates.test.js 2>&1 | grep -aE "(tests|pass|fail) [0-9]+"
```

Esperado: `pass 12 / fail 0` (7 antigos + 5 novos).

- [ ] **Step 6: Suíte inteira — não piorou o baseline**

```bash
cd /d/la-organizer/_remote && node --test 'src/**/*.test.js' 2>&1 | grep -aE "(tests|pass|fail) [0-9]+"
```

Esperado: `pass 1982 / fail 2` (1977+5 novos; os 2 de ambiente intactos). **Se `fail` virar 3, pare.**

---

### Task 2: trocar o filtro do digest — a escada determinística

**Files:**
- Modify: `src/rituals/dispatcher.js:2734` (o filtro `filteredStale`)

**Interfaces:**
- Consumes: `businessDaysOverdue(dueYmd, todayYmd)` (Task 1), importado de `../utils/dates`.
- Produces: `ceoTeamUnclosedTasksReport` passa a filtrar por dias úteis — `>= 6` sem `leaderId` (digest do CEO), `>= 3` com `leaderId` (digest do líder). Contrato de retorno (`{ text, staleIds, eventStaleIds }`) **inalterado**.

- [ ] **Step 1: Criar o HOLD de deploy (antes de tocar em `src/`)**

O Stop hook robocopia `_remote/` → commit → push → VPS `reset --hard` + `pm2 restart`. Sem o hold, encerrar o turno no meio deste plano empacota trabalho pela metade em produção.

```bash
touch /d/la-organizer/.deploy-hold && ls -la /d/la-organizer/.deploy-hold
```

Esperado: existe. **É em `/d/la-organizer/`, NÃO em `/d/la-organizer/_remote/`.**

- [ ] **Step 2: Confirmar que o `import` de `../utils/dates` cabe e ler o filtro atual**

```bash
cd /d/la-organizer/_remote && grep -n "require('../utils/dates')\|require(\"../utils/dates\")" src/rituals/dispatcher.js | head -2
sed -n '2725,2740p' src/rituals/dispatcher.js
```

Anote se `dates` já é importado (pra reusar o require) ou se precisa adicionar. Confirme que a linha 2734 é `return days >= 6 || !cobradas24h.has(t.id);` (se o número mudou, localize pelo texto).

- [ ] **Step 3: Ver quem mais usa `cobradas24h` / `notified` / `hiddenCount` antes de remover**

```bash
cd /d/la-organizer/_remote && grep -n "cobradas24h\|hiddenCount\|const { data: notified }\|notification_type" src/rituals/dispatcher.js | head -12
```

**Regra:** se `hiddenCount` alimenta um texto/log que sobrevive (ex.: "_N já cobradas hoje_"), **não apague** — só o filtro muda. Se `cobradas24h` fica órfão (só era usado no `return` da 2734), remova a query dos `notifications` que o alimenta. **Se tiver qualquer uso além do filtro, preserve e me diga no report.**

- [ ] **Step 4: Trocar o filtro**

Adicionar o import no topo do arquivo se ainda não existir (junto dos outros `require` de utils):

```js
const { businessDaysOverdue } = require('../utils/dates');
```

Substituir o bloco do `filteredStale` (~2732-2734). **De:**

```js
    const filteredStale = scoped.filter(t => {
      const days = daysOverdue(t.due_date);
      return days >= 6 || !cobradas24h.has(t.id);
    });
```

**Para:**

```js
    // Fase 8 — ESCADA POR DIAS ÚTEIS (§2/§3 spec 18/07). Cada nível só recebe quando o
    // atraso vira problema DELE: líder a partir de 3 dias úteis, CEO a partir de 6. O
    // `|| !cobradas24h` antigo deixava tarefa de 1 dia vazar pro CEO (a cobrança individual
    // ainda não tinha rodado) — era o ruído que o Alf reclamou (18/07). Dias ÚTEIS pulam
    // domingo (a LA dá aula sábado). A EXIBIÇÃO ("7d") segue corrida no leader-cards — só o
    // GATE mudou. A cobrança da pessoa (checkOverdueAlerts, 1-5d) é o degrau 1-2 e não muda.
    const limiarDias = opts.leaderId ? 3 : 6;
    const filteredStale = scoped.filter(t => businessDaysOverdue(t.due_date, sp.ymd) >= limiarDias);
```

Se o Step 3 mostrou que `cobradas24h` e a query `notified` ficaram órfãos, remova-os (a query dos `notifications` logo acima do filtro). Se `hiddenCount` sobrevive num texto, mantenha-o calculado de outra forma OU remova a menção — **decida pelo que o Step 3 mostrou e documente no report**.

- [ ] **Step 5: `node --check` (não roda local — importa banco)**

```bash
cd /d/la-organizer/_remote && node --check src/rituals/dispatcher.js && echo "SINTAXE OK"
grep -n "cobradas24h" src/rituals/dispatcher.js || echo "cobradas24h REMOVIDO (ok se ficou órfão)"
```

Esperado: `SINTAXE OK`.

- [ ] **Step 6: Suíte — baseline intacto**

```bash
cd /d/la-organizer/_remote && node --test 'src/**/*.test.js' 2>&1 | grep -aE "(tests|pass|fail) [0-9]+"
```

Esperado: `fail 2` (o baseline; `dispatcher.js` não tem teste local que rode). **Virou 3 → pare.**

---

### Task 3: dry-run na VPS, deploy cirúrgico e commit

**Files:** nenhum novo — validação e deploy.

**Interfaces:**
- Consumes: tudo das Tasks 1-2.
- Produces: escada no ar; hold removido; KI registrado.

- [ ] **Step 1: Subir os 2 arquivos pra VPS — SEM restart**

⚠️ O dry-run NÃO roda local (`dispatcher.js` importa `../supabase/client`, gitignored). Sobe primeiro; o pm2 só vê o disco novo no `restart`.

Conferir divergência antes (outro chat pode ter mexido):

```bash
cd /d/la-organizer/_remote && for f in src/utils/dates.js src/rituals/dispatcher.js; do
  echo "--- $f"; md5sum "$f"; ssh tom "md5sum /opt/LA-Organizer/$f"; done
```

`dates.js` e `dispatcher.js` **na VPS devem bater com o que tinham ANTES das minhas mudanças** (o card-por-líder já subiu o dispatcher; confirme que o md5 da VPS == o do meu arquivo pré-Task-2). Se divergir por obra de terceiro, **pare** e refaça sobre cópia fresca. Então:

```bash
cd /d/la-organizer/_remote && scp src/utils/dates.js tom:/opt/LA-Organizer/src/utils/dates.js
scp src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
ssh tom "cd /opt/LA-Organizer && node --check src/utils/dates.js && node --check src/rituals/dispatcher.js && echo 'CHECK OK'"
```

Esperado: `CHECK OK`.

- [ ] **Step 2: Dry-run NA VPS — o CEO só vê 6+ úteis**

`sendGovernanceDigest({dryRun:true})` monta e retorna sem enviar. `dotenv` não está instalado → carregar o `.env` pelo shell.

```bash
ssh tom "cd /opt/LA-Organizer && set -a && . ./.env && set +a && node -e \"
const d = require('./src/rituals/dispatcher');
d.sendGovernanceDigest(new Date(), { dryRun: true, force: true }).then(r => {
  const arr = Array.isArray(r) ? r : (r && r.results) || [];
  for (const item of arr) { console.log('=== CEO:', item.ceo, '| partes:', item.parts, '==='); (item.messages||[]).forEach(m => console.log(m)); }
  process.exit(0);
}).catch(e => { console.error('ERR', e.message); process.exit(1); });
\"" 2>&1 | head -70
```

**Conferir item por item:**
1. **Nenhuma tarefa com menos de 6 dias úteis** no digest do CEO. O caso do Peterson ("Revisar mensagem — 1d") que vazava ontem **tem que sumir**.
2. As órfãs de 47d/17d (`Conciliação`, `Anamnese`) **continuam** — elas são 6+ dias, é o degrau do CEO.
3. Nada quebrou (sem `ERR`).

- [ ] **Step 3: Dry-run do digest do LÍDER — ele vê 3+ úteis**

```bash
ssh tom "cd /opt/LA-Organizer && set -a && . ./.env && set +a && node -e \"
const d = require('./src/rituals/dispatcher');
d.sendLeaderGovernanceDigest(new Date(), { dryRun: true, force: true }).then(r => {
  const arr = Array.isArray(r) ? r : (r && r.results) || [];
  for (const item of arr) { console.log('=== LÍDER:', item.leader, '==='); (item.messages||[]).forEach(m => console.log(m)); }
  process.exit(0);
}).catch(e => { console.error('ERR', e.message); process.exit(1); });
\"" 2>&1 | head -60
```

**Conferir:** o digest do líder mostra tarefas de **3+ dias úteis** (não 6+). Uma tarefa de 3-5 úteis que NÃO aparece no digest do CEO (Step 2) **deve** aparecer aqui — é a prova de que os dois limiares diferem. (`sendLeaderGovernanceDigest` aceita `dryRun` e retorna `{ results: [...] }` igual ao do CEO — confirmado em `dispatcher.js:3140`.)

- [ ] **Step 4: md5 VPS == local ANTES do restart**

```bash
cd /d/la-organizer/_remote && md5sum src/utils/dates.js src/rituals/dispatcher.js
ssh tom "cd /opt/LA-Organizer && md5sum src/utils/dates.js src/rituals/dispatcher.js"
```

Esperado: os 2 hashes **idênticos** nos dois lados. Divergiu → **não reinicia**.

- [ ] **Step 5: Restart e log limpo**

```bash
ssh tom "pm2 restart tom && sleep 4 && pm2 logs tom --lines 12 --nostream" 2>&1 | tail -8
```

Esperado: `✅ TOM pronto`. Log REAL em `/opt/LA-Organizer/logs/` (`/root/.pm2/logs` é falso-zero):

```bash
ssh tom "tail -30 /opt/LA-Organizer/logs/*.log 2>/dev/null | grep -iE 'error|businessDays|dispatcher' | tail -8"
```

- [ ] **Step 6: Suíte inteira da VPS verde**

```bash
ssh tom "cd /opt/LA-Organizer && CID=9df91fd3-c949-4ca0-a872-bfb321e7778d && set -a && . ./.env && set +a && TEST_COLLAB_ID=\$CID node --test \$(find src -name '*.test.js') 2>&1 | grep -aE '^# (tests|pass|fail)'"
```

Esperado: `fail 0` (a VPS estava 1968/1968; agora +5 dos testes de dias úteis = **1973/1973**). Virou vermelho → regressão, **pare**.

- [ ] **Step 7: Remover o hold e commitar**

O hold sai **por último**, depois do md5 bater e do log limpo.

```bash
rm /d/la-organizer/.deploy-hold && ls /d/la-organizer/.deploy-hold 2>&1 | head -1
```

Esperado: `No such file or directory`. Encerrar o turno: o Stop hook commita `_remote/`, pusha.

- [ ] **Step 8: Registrar o KI**

```sql
INSERT INTO tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
   colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
VALUES
  ('GOVDIGEST-ESCALADA-TEMPORAL', 'Digest do CEO recebia tarefa de 1 dia de atraso (escalava cedo demais)',
   'dispatcher', 'medio', 'corrigido',
   'O filtro compartilhado dos digests (dispatcher.js:2734) era `days >= 6 || !cobradas24h.has(id)`. O `|| !cobradas24h` deixava QUALQUER tarefa ainda-não-cobrada vazar pro digest, independente da idade: a cobrança individual da pessoa (checkOverdueAlerts) ainda não tinha rodado -> tarefa de 1 dia caía no colo do CEO. Escalar cedo demais queima a cobranca: o lider responde "a pessoa faz hoje".',
   'Escada por DIAS UTEIS (businessDaysOverdue em utils/dates.js, domingo nao conta, sabado conta): lider a partir de 3 uteis, CEO a partir de 6. Filtro determinístico `businessDaysOverdue(due, hoje) >= (leaderId ? 3 : 6)`, sem o `|| !cobrada`. A exibicao do card ("7d") segue corrida (leader-cards.daysBetweenYmd) - so o gate mudou. A cobranca individual da pessoa (1-5d) ja parava aos 5d e NAO mudou - e o degrau 1-2/3-5 da escada.',
   'manual', 'tarefa com < 6 dias uteis aparecendo no digest do CEO; lider recebendo atraso de 1-2 dias',
   ARRAY['Alf'], '2026-07-18', '2026-07-18', 1, now());
```

- [ ] **Step 9: Prova viva (amanhã)**

O digest sai 9h. Confirmar que o teu digest **não tem mais nenhuma tarefa com menos de 6 dias úteis** — e que uma tarefa de 3-5 úteis apareceu no digest do líder correspondente, não no teu.

---

## Notas de risco

- **A ordem importa:** Task 2 depende do `businessDaysOverdue` da Task 1. Sem ela, o filtro referencia função inexistente e o `node --check` passa mas o runtime quebra (require resolve, símbolo é `undefined` → `undefined(...)` lança). Por isso a Task 1 fecha verde antes.
- **O `sp.ymd` no filtro:** confirmado que existe no escopo de `ceoTeamUnclosedTasksReport` (o `daysOverdue` local já usa `sp.ymd`). Se o dry-run acusar `sp is not defined`, o escopo mudou — pare e releia.
- **`cobradas24h` órfão:** o Step 3 da Task 2 decide se remove. Se `hiddenCount` alimentava o rodapé "_N já cobradas hoje_", removê-lo muda o texto — **decida pelo grep, documente no report, não no escuro.**
- **A cobrança da pessoa não é tocada** — se alguém "melhorar" o `checkOverdueAlerts` junto, saiu do escopo. Só o filtro dos digests muda.
