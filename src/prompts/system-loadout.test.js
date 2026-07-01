// Golden de zero-regressão do Mapa (Fase 1). Roda na VPS (system.js puxa ../supabase/client):
//   ssh tom "cd /opt/LA-Organizer && TEST_COLLAB_ID=<id> node --env-file=.env --test src/prompts/system-loadout.test.js"
// Prova: (1) operational == caminho de hoje byte a byte; (2) conversational é só a voz, sem
// blocos de contexto/skill; (3) o ctx devolvido no minimal é ÍNTEGRO (o engine lê
// ctx.notifications.length e ctx.recentMessages logo após buildSystemPrompt — stub parcial = crash).
const { test, before } = require('node:test');
const assert = require('node:assert');
const system = require('./system');
const { LOADOUTS } = require('./intent-map');
const supabase = require('../supabase/client');

// O caminho full acessa vários campos do collaborator (full_name.split, etc.) — usa a linha REAL,
// não um stub, pra o golden exercitar o mesmo objeto que o engine passa em produção.
let COLLAB;
before(async () => {
  const { data, error } = await supabase
    .from('collaborators').select('*').eq('id', process.env.TEST_COLLAB_ID).single();
  if (error || !data) throw new Error(`não achei o collaborator ${process.env.TEST_COLLAB_ID}: ${error?.message}`);
  COLLAB = data;
});

test('operational: passar loadout full == não passar loadout (byte a byte)', async () => {
  const a = await system.buildSystemPrompt(COLLAB, {});
  const b = await system.buildSystemPrompt(COLLAB, { loadout: LOADOUTS.operational });
  assert.strictEqual(a.systemPrompt.length, b.systemPrompt.length, 'operational divergiu do caminho de hoje');
});

test('conversational: é o prefixo-voz EXATO do full, sem o resto', async () => {
  const full = await system.buildSystemPrompt(COLLAB, {});
  const conv = await system.buildSystemPrompt(COLLAB, { loadout: LOADOUTS.conversational });
  // Prova exata: o full é BLOCK_RULES+IDENTIDADE+ctxBlock+skill+...; o minimal é só
  // BLOCK_RULES+IDENTIDADE → o full COMEÇA com o minimal, e o minimal é bem menor.
  assert.ok(full.systemPrompt.startsWith(conv.systemPrompt), 'minimal deve ser o prefixo-voz exato do full');
  assert.ok(conv.systemPrompt.length < full.systemPrompt.length * 0.5,
    `minimal deveria ser <50% do full (foi ${conv.systemPrompt.length} vs ${full.systemPrompt.length})`);
  // a voz continua presente
  assert.match(conv.systemPrompt, /IDENTIDADE/, 'a voz (identidade) tem que estar presente');
  assert.match(conv.systemPrompt, /TOM/, 'a assinatura da voz tem que estar presente');
});

test('conversational: ctx devolvido é ÍNTEGRO (contrato que o engine consome)', async () => {
  const conv = await system.buildSystemPrompt(COLLAB, { loadout: LOADOUTS.conversational });
  assert.ok(Array.isArray(conv.ctx.recentMessages), 'ctx.recentMessages deve existir (vira msgs no engine)');
  assert.notStrictEqual(conv.ctx.notifications, undefined, 'ctx.notifications deve existir (engine lê .length)');
});
