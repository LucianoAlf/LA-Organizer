'use strict';
// DUP-CHOICE1-FALSE-ASSERT — Ana Paula, 28/07/2026 22:09:58 BRT (finding cc2d226a).
//
// Cadeia medida no banco:
//   22:04:56  CHOKEPOINT rebaixa a resposta — "Iniciar lançamento planilha gestão" (14h) NÃO persiste.
//   22:06:59  TASK_CREATE skipped self_recent_skip:existing=32fb8ab9 age=4min score=1.00 (okCount++).
//   22:09:29  TASK_UPDATE rejected integrity_dup_task:candidate="Iniciar lançamento planilha gestão"
//             → menu de dup exibido, com `existing` e `cand` IDÊNTICOS.
//   22:09:58  Ana responde "1"; 0,122s depois (determinístico, sem LLM) o TOM afirma
//             "Certo! Já está anotado como _Iniciar lançamento planilha gestão_. Nada mudou."
//   22:12:00  Ana insiste "Se não for duplicar , pode criar" → a tarefa é criada (b1fc866b).
//
// A afirmação das 22:09:58 era FALSA: varredura das 3396 linhas de `tasks` não encontra NENHUM id
// começando em 32fb8ab9 (o "existing" do skip é fantasma) e existe UMA só tarefa com esse título —
// a b1fc866b, criada às 22:12:00, depois da fala. Ou seja: no instante da afirmação a tarefa não
// existia em lugar nenhum.
//
// Raiz: no choice '1' o engine monta a frase com `tk.title` — o título do DRAFT, a tarefa que ele
// estava PRESTES a criar — e afirma um fato de banco sem NUNCA ler o banco. A identidade do
// conflito existe no `_taskIntegrityPayload.conflicts[]` (engine.js, integrity check) e é
// descartada nos dois pontos de persistência (Map `pendingDupTasks` e `pending_intents`).
//
// NÃO é o mesmo bug do DUP-INTENT-NOT-CLOSED, que cita ESTE mesmo caso: aquele fix fechou a intent
// (sintoma de 22:12); a afirmação falsa de 22:09:58 seguiu intacta.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key';

const assert = require('node:assert');
const { test, beforeEach, after } = require('node:test');
const fs = require('fs');
const path = require('path');

const { buildDupChoice1Reply } = require('./dup-choice');
const pendingIntents = require('../services/pending-intents');
const supabase = require('../supabase/client');
const { tryDupBypass } = require('../engine');
const ENGINE_SRC = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');

const DRAFT = { title: 'Iniciar lançamento planilha gestão' };

test('choice 1 sem tarefa no banco NÃO afirma que já está anotado (caso Ana 28/07 22:09:58)', () => {
  const reply = buildDupChoice1Reply(DRAFT, null);
  assert.ok(
    !/j[áa] est[áa] anotad/i.test(reply),
    `afirmou registro sem tarefa no banco — a fala falsa de 22:09:58 se repete: ${reply}`,
  );
  assert.ok(
    !/nada mudou/i.test(reply),
    `"Nada mudou" afirma que o estado já contemplava o pedido, e não contemplava: ${reply}`,
  );
  assert.ok(/crio|criar/i.test(reply), `não ofereceu o caminho de criar: ${reply}`);
});

test('choice 1 com a tarefa viva no banco nomeia o título REAL, não o do draft', () => {
  // Controle positivo: quando o conflito existe de verdade, a fala antiga é a correta — e tem que
  // sair do registro do banco, não do rascunho (é o que distingue ler de supor).
  const existing = { id: 'b1fc866b-0000-0000-0000-000000000000', title: 'Lançamento planilha gestão — julho', status: 'pending' };
  const reply = buildDupChoice1Reply(DRAFT, existing);
  assert.match(reply, /j[áa] est[áa] anotad/i);
  assert.ok(reply.includes(existing.title), `não citou o título real do banco: ${reply}`);
  assert.ok(!reply.includes(DRAFT.title), `citou o título do draft em vez do registro: ${reply}`);
});

test('contrato: o engine verifica no banco antes de responder ao choice 1', () => {
  const i = ENGINE_SRC.indexOf("dup_bypass choice=1");
  assert.ok(i > 0, 'âncora do choice=1 sumiu do engine — teste desatualizado');
  const bloco = ENGINE_SRC.slice(i - 400, i + 900);
  assert.ok(
    bloco.includes('buildDupChoice1Reply'),
    'o choice=1 do engine monta a resposta sem passar pelo helper que exige o registro do banco — ' +
    'volta a afirmar "Já está anotado" com o título do draft (caso Ana 28/07, finding cc2d226a)',
  );
});

// ── caminho real: o turno inteiro pelo tryDupBypass ───────────────────────────
const COLLAB = { id: 'collab-ana' };
const GHOST_ID = '32fb8ab9-0000-0000-0000-000000000000'; // o "existing" do self_recent_skip
const origList = pendingIntents.listOpenIntents;
const origResolve = pendingIntents.resolveIntent;
const origFrom = supabase.from;

let intents;
let linhas; // o que existe em `tasks` no instante da resposta

beforeEach(() => {
  intents = [];
  linhas = {};
  pendingIntents.listOpenIntents = async () => intents.filter((i) => !i.resolved_at);
  pendingIntents.resolveIntent = async (id) => {
    const i = intents.find((x) => x.id === id);
    if (i) i.resolved_at = new Date().toISOString();
  };
  supabase.from = (tbl) => {
    if (tbl !== 'tasks') throw new Error(`tabela inesperada no teste: ${tbl}`);
    return {
      select: () => ({ eq: (_c, v) => ({ maybeSingle: async () => ({ data: linhas[v] || null, error: null }) }) }),
      insert: () => { throw new Error('choice=1 não pode inserir nada'); },
    };
  };
});

after(() => {
  pendingIntents.listOpenIntents = origList;
  pendingIntents.resolveIntent = origResolve;
  supabase.from = origFrom;
});

function seed(conflito) {
  intents = [{
    id: 'intent-planilha',
    kind: 'task_creation',
    asked_at: new Date(Date.now() - 30000).toISOString(),
    resolved_at: null,
    payload: { _dup_bypass: true, drafts: [{ ...DRAFT, _dup_conflict: conflito }] },
  }];
}

test('turno real: "1" com o conflito FANTASMA não afirma registro (Ana 28/07 22:09:58)', async () => {
  seed({ id: GHOST_ID, title: DRAFT.title }); // 32fb8ab9 não existe em `tasks` — `linhas` vazio
  const r = await tryDupBypass(COLLAB, '1');
  assert.ok(
    !/j[áa] est[áa] anotad/i.test(r.reply),
    `o turno real repete a afirmação falsa de 22:09:58: ${r.reply}`,
  );
  assert.ok(intents[0].resolved_at, 'a intent tem que seguir fechando (DUP-INTENT-NOT-CLOSED)');
});

test('turno real: "1" com o conflito VIVO afirma registro e nomeia a tarefa do banco', async () => {
  // Controle: se o conflito existe mesmo, a fala antiga é a certa. Sem este par, "não afirma
  // registro" seria indistinguível de um guard que nunca deixa afirmar nada.
  linhas[GHOST_ID] = { id: GHOST_ID, title: 'Lançamento planilha gestão — julho', status: 'pending' };
  seed({ id: GHOST_ID, title: DRAFT.title });
  const r = await tryDupBypass(COLLAB, '1');
  assert.match(r.reply, /j[áa] est[áa] anotad/i);
  assert.ok(r.reply.includes('Lançamento planilha gestão — julho'), `não citou o registro: ${r.reply}`);
});

test('contrato: a identidade do conflito sobrevive até o turno da resposta', () => {
  // Sem isto o helper nunca teria o que verificar: o conflito é conhecido no integrity check e
  // hoje morre ali — nem o Map nem o pending_intents carregam o id da tarefa conflitante.
  assert.ok(
    /_dup_conflict/.test(ENGINE_SRC),
    'o engine descarta conflicts[] ao persistir a dup pendente — no turno seguinte não há id ' +
    'nenhum pra conferir no banco',
  );
  const ins = ENGINE_SRC.indexOf("delete insertRow._intentId");
  assert.ok(ins > 0, 'âncora do insertRow do bypass sumiu — teste desatualizado');
  assert.ok(
    ENGINE_SRC.slice(ins - 300, ins + 300).includes('delete insertRow._dup_conflict'),
    'o campo interno _dup_conflict entra no insert do choice=2 e quebra a criação da tarefa',
  );
});
