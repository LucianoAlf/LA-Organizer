'use strict';
// DUP-INTENT-NOT-CLOSED (Ana 28/07 22:09→22:12 BRT, findings efc89931 / f262a60d).
//
// O menu de duplicidade ficou aberto no banco depois de RESPONDIDO. Ana escolheu "1"
// (mesma situação) para "Iniciar lançamento planilha gestão"; três minutos depois o TOM
// ofereceu criar OUTRA tarefa (16h — cobrança inadimplentes) e ela respondeu "Se não for
// duplicar , pode criar". Esse "pode criar" casa CHOICE2_RE, o Map já tinha sido limpo, o
// fallback do banco ressuscitou a intent de dup ainda aberta (3min < janela de 10min) e o
// TOM criou de novo a tarefa ERRADA: "✅ Anotado: Iniciar lançamento planilha gestão".
//
// O env é stubado antes do require porque o supabase/client exige as duas vars e a suíte
// roda sem --env-file.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');

const pendingIntents = require('../services/pending-intents');
const supabase = require('../supabase/client');
const { tryDupBypass } = require('../engine');

const COLLAB = { id: 'collab-ana' };
const STALE_TITLE = 'Iniciar lançamento planilha gestão';

const origList = pendingIntents.listOpenIntents;
const origResolve = pendingIntents.resolveIntent;
const origFrom = supabase.from;

let intents;
let inserted;

function seedDupIntent(askedMinutesAgo) {
  intents = [{
    id: 'intent-planilha',
    kind: 'task_creation',
    asked_at: new Date(Date.now() - askedMinutesAgo * 60000).toISOString(),
    resolved_at: null,
    payload: { _dup_bypass: true, drafts: [{ title: STALE_TITLE }] },
  }];
}

beforeEach(() => {
  intents = [];
  inserted = [];
  pendingIntents.listOpenIntents = async () => intents.filter((i) => !i.resolved_at);
  pendingIntents.resolveIntent = async (id, resolution, note) => {
    const i = intents.find((x) => x.id === id);
    if (i) { i.resolved_at = new Date().toISOString(); i.resolution = resolution; i.resolution_note = note; }
  };
  supabase.from = (tbl) => {
    if (tbl !== 'tasks') throw new Error(`tabela inesperada no teste: ${tbl}`);
    return {
      insert(row) {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 'task-novo', title: row.title }, error: null }) }) };
      },
    };
  };
});

after(() => {
  pendingIntents.listOpenIntents = origList;
  pendingIntents.resolveIntent = origResolve;
  supabase.from = origFrom;
});

test('escolha "1" (mesma situação) FECHA a intent — afirmativa posterior não ressuscita a dup', async () => {
  seedDupIntent(3);

  const r1 = await tryDupBypass(COLLAB, '1');
  assert.match(r1.reply, /Já está anotado/, 'turno 1 deveria resolver o menu de dup');
  assert.equal(inserted.length, 0, 'escolha "1" não cria nada');
  assert.ok(intents[0].resolved_at, 'a intent tem que ficar FECHADA no banco após a escolha "1"');

  // Turno 2, 3 min depois: o "pode criar" é sobre OUTRA tarefa (16h). Não pode virar
  // criação da tarefa que já foi descartada no turno 1.
  const r2 = await tryDupBypass(COLLAB, 'Se não for duplicar , pode criar');
  assert.equal(inserted.length, 0, `criou a tarefa errada: ${inserted.map((i) => i.title).join(', ')}`);
  assert.equal(r2, null, 'sem dup pendente, o turno tem que seguir para o fluxo normal (LLM)');
});

test('escolha "3" (cancela) também FECHA a intent no banco', async () => {
  seedDupIntent(3);

  const r1 = await tryDupBypass(COLLAB, 'cancela');
  assert.match(r1.reply, /cancelado/i);
  assert.ok(intents[0].resolved_at, 'a intent tem que ficar FECHADA no banco após o cancelamento');

  assert.equal(await tryDupBypass(COLLAB, 'pode criar'), null, 'dup cancelada não pode ser ressuscitada');
  assert.equal(inserted.length, 0);
});

// ── não-regressão: o caminho legítimo continua criando ────────────────────────
test('escolha "2" (outro caso) segue criando a tarefa e fechando a intent', async () => {
  seedDupIntent(3);

  const r = await tryDupBypass(COLLAB, '2');
  assert.match(r.reply, /✅ Anotado/);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].title, STALE_TITLE);
  assert.ok(intents[0].resolved_at, 'o caminho "2" já fechava a intent — não pode regredir');
});
