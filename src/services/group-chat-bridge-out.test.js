// src/services/group-chat-bridge-out.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildWhatsappText, buildWhatsappMedia, selectRevocable } = require('./group-chat-bridge-out');

test('selectRevocable: só rows app-origin, não sincronizadas, com wa_message_id real', () => {
  const rows = [
    { id: 1, deleted_origin: 'app', deleted_synced: false, wa_message_id: '3EBXYZ' },
    { id: 2, deleted_origin: 'app', deleted_synced: false, wa_message_id: 'sent' },
    { id: 3, deleted_origin: 'app', deleted_synced: false, wa_message_id: null },
    { id: 4, deleted_origin: 'whatsapp', deleted_synced: false, wa_message_id: '3EB' },
  ];
  assert.deepEqual(selectRevocable(rows).map((r) => r.id), [1]);
});

test('imagem de membro vira payload type=image com autoria na caption', () => {
  const r = buildWhatsappMedia(
    { role: 'member', kind: 'image', media_url: 'https://x/y.jpg', media_filename: 'y.jpg', content: 'olha o comprovante' },
    'Rose Silva'
  );
  assert.deepEqual(r, { type: 'image', url: 'https://x/y.jpg', caption: '💬 *Rose*: olha o comprovante', filename: 'y.jpg' });
});
test('pdf vira type=document', () => {
  const r = buildWhatsappMedia({ role: 'member', kind: 'pdf', media_url: 'https://x/b.pdf', media_filename: 'boleto.pdf' }, 'Ana');
  assert.equal(r.type, 'document');
  assert.equal(r.caption, '💬 *Ana*');
});
test('audio vira type=audio', () => {
  const r = buildWhatsappMedia({ role: 'member', kind: 'audio', media_url: 'https://x/a.webm' }, 'Ana');
  assert.equal(r.type, 'audio');
});
test('mídia sem media_url → null (ainda subindo)', () => {
  assert.equal(buildWhatsappMedia({ role: 'member', kind: 'image', media_url: null }, 'Ana'), null);
});
test('texto/report não é mídia → null', () => {
  assert.equal(buildWhatsappMedia({ role: 'member', kind: 'text', content: 'oi' }, 'Ana'), null);
  assert.equal(buildWhatsappMedia({ role: 'tom', kind: 'report', content: '<div/>' }, ''), null);
});

test('membro vira "💬 *Nome*: texto"', () => {
  assert.equal(
    buildWhatsappText({ role: 'member', kind: 'text', content: 'bom dia' }, 'Rose Silva'),
    '💬 *Rose*: bom dia'
  );
});
test('membro sem nome cai no fallback sem asterisco', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'text', content: 'oi' }, ''), '💬 oi');
});
test('TOM manda só a prosa, sem o bloco de ACTIONS', () => {
  const msg = { role: 'tom', kind: 'text', content: 'Pode deixar, Rose!\n‹‹ACTIONS››[{"kind":"task"}]' };
  assert.equal(buildWhatsappText(msg, ''), 'Pode deixar, Rose!');
});
test('TOM sem prosa (só ACTIONS) → null (não espelha)', () => {
  assert.equal(buildWhatsappText({ role: 'tom', kind: 'text', content: '‹‹ACTIONS››[{"x":1}]' }, ''), null);
});
test('report (card HTML) → espelha como texto formatado WhatsApp', () => {
  const html = '<div><h3>Resumo da sessão</h3><p>Rose pediu lembrete.</p><strong>Em aberto</strong><ul><li>Conferir caixa</li></ul></div>';
  const out = buildWhatsappText({ role: 'tom', kind: 'report', content: html }, '');
  assert.match(out, /\*Resumo da sessão\*/);
  assert.match(out, /Rose pediu lembrete\./);
  assert.match(out, /\*Em aberto\*/);
  assert.match(out, /• Conferir caixa/);
  assert.ok(!/[<>]/.test(out), 'não pode sobrar tag HTML');
});
test('report com cerca ```html é limpo (sem markdown fence no zap)', () => {
  const out = buildWhatsappText({ role: 'tom', kind: 'report', content: '```html\n<h3>Resumo</h3>\n```' }, '');
  assert.equal(out, '*Resumo*');
});
test('report com <hr> entre blocos vira linha separadora no WhatsApp', () => {
  const html = '<div><h3>🔴 Atrasadas · 1</h3><ul><li>01/06 — X</li></ul><hr><h3>⏰ Esta semana · 1</h3><ul><li>15/06 — Y</li></ul></div>';
  const out = buildWhatsappText({ role: 'tom', kind: 'report', content: html }, '');
  assert.match(out, /──────────/);              // <hr> virou linha de traços
  assert.match(out, /\*🔴 Atrasadas · 1\*/);
  assert.match(out, /\*⏰ Esta semana · 1\*/);
  assert.ok(!/[<>]/.test(out), 'não pode sobrar tag HTML');
});
test('report com <br><br> vira quebras (não confunde <br> com a tag <b> de negrito)', () => {
  const html = '<div>Linha 1<br><br>Linha 2</div>';
  const out = buildWhatsappText({ role: 'tom', kind: 'report', content: html }, '');
  assert.match(out, /Linha 1\n\nLinha 2/);
  assert.ok(!out.includes('*'), 'não pode virar asterisco de <b> falso: ' + JSON.stringify(out));
});
test('report vazio → null', () => {
  assert.equal(buildWhatsappText({ role: 'tom', kind: 'report', content: '   ' }, ''), null);
});
test('mídia (kind != text) → null no v1', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'image', content: '' }, 'Ana'), null);
});
test('membro com texto vazio → null', () => {
  assert.equal(buildWhatsappText({ role: 'member', kind: 'text', content: '   ' }, 'Ana'), null);
});

// ── PLACEHOLDER DE wa_message_id TEM UNIQUE ───────────────────────────────────────────────
// `gcm_wa_msg_uq` é UNIQUE em wa_message_id, e o bridge marcava com as strings literais
// 'skipped'/'sent'. Só a PRIMEIRA linha do banco conseguia; da segunda em diante o UPDATE batia
// em 23505 e o erro era descartado (`await update()` sem checar error). Resultado: mensagem
// não-espelhável presa na fila pra sempre, repescada a cada 4s. Em 02/09 eram 4 linhas, a mais
// velha há 82 dias, ocupando 4 das 10 vagas do tick — e quando chegasse a 10, o espelho
// app→WhatsApp pararia inteiro, em silêncio.
const { ehPlaceholderWa, placeholderWa } = require('./group-chat-bridge-out');

test('placeholderWa é único por linha', () => {
  const a = placeholderWa('skipped', 'id-1');
  const b = placeholderWa('skipped', 'id-2');
  assert.notStrictEqual(a, b, 'dois valores iguais violariam o UNIQUE');
  assert.match(a, /^skipped:/);
  assert.match(placeholderWa('sent', 'id-3'), /^sent:/);
});

test('ehPlaceholderWa reconhece o formato novo E os valores nus antigos', () => {
  assert.ok(ehPlaceholderWa('skipped:abc'));
  assert.ok(ehPlaceholderWa('sent:abc'));
  assert.ok(ehPlaceholderWa('skipped'), 'a linha de junho que já está no banco continua valendo');
  assert.ok(ehPlaceholderWa('sent'));
});

test('ehPlaceholderWa NÃO confunde id real do WhatsApp com placeholder', () => {
  assert.ok(!ehPlaceholderWa('3EB0D19F334BA486C9D484'));
  assert.ok(!ehPlaceholderWa('5521997243082:AC190A74F059BA48'));
  assert.ok(!ehPlaceholderWa(null));
  assert.ok(!ehPlaceholderWa(''));
  assert.ok(!ehPlaceholderWa('skippedish'), 'prefixo tem que ser seguido de : ou fim');
});

// selectRevocable existe pra revogar no WhatsApp o que foi apagado no app. Quem nunca chegou
// lá (placeholder) não pode entrar — e agora o placeholder tem sufixo.
test('selectRevocable ignora placeholder no formato novo', () => {
  const base = { deleted_origin: 'app', deleted_synced: false };
  const r = selectRevocable([
    { ...base, id: 1, wa_message_id: 'skipped:xyz' },
    { ...base, id: 2, wa_message_id: 'sent:xyz' },
    { ...base, id: 3, wa_message_id: 'skipped' },
    { ...base, id: 4, wa_message_id: '3EB0REAL' },
    { ...base, id: 5, wa_message_id: null },
  ]);
  assert.deepStrictEqual(r.map((x) => x.id), [4], 'só o id real do WhatsApp é revogável');
});

// ── O ESPELHO NÃO PODE REORDENAR ──────────────────────────────────────────────────────────
// 02/09, Sucesso do Aluno: o card chegava ANTES da fala e o "👇" apontava pro vazio. A causa
// era a ordem de INSERT (corrigida no engine: fala primeiro, card na fila depois). Mas a ordem
// no banco só vale se o espelho enviar na mesma ordem — e ele lê `.order('created_at', asc)` e
// manda num for/await sequencial. Isso aqui TRAVA esse contrato: um refactor que troque o laço
// por Promise.all embaralharia tudo de novo, e no WhatsApp ninguém veria teste nenhum falhar.
const { runOutboundOnce } = require('./group-chat-bridge-out');

function fakeSupabase(mensagens) {
  const updates = [];
  const q = (tabela) => {
    const estado = { tabela, filtros: {} };
    const api = {
      select() { return api; },
      not() { return api; },
      eq(col, val) { estado.filtros[col] = val; return api; },
      is() { return api; },
      in() { return api; },
      lt() { return api; },
      order() { return api; },
      update(patch) { estado.patch = patch; return api; },
      limit() { return api; },
      then(resolve) { return Promise.resolve(api._resultado()).then(resolve); },
      _resultado() {
        if (estado.patch) { updates.push({ id: estado.filtros.id, ...estado.patch }); return { data: null, error: null }; }
        if (tabela === 'work_groups') {
          return { data: [{ id: 'g1', wa_group_jid: 'jid-1', wa_linked_at: null }], error: null };
        }
        // o drain pré-link não roda (wa_linked_at null); esta é a busca da fila
        return { data: mensagens, error: null };
      },
    };
    return api;
  };
  return { from: q, _updates: updates };
}

test('o espelho envia na ordem de created_at, não na ordem que o banco devolveu', async () => {
  const enviados = [];
  // De propósito fora de ordem no array: quem ordena é a query, e o laço tem que respeitar.
  const sb = fakeSupabase([
    { id: 'm1', group_id: 'g1', role: 'tom', kind: 'text', content: 'Já busco aqui 👇', created_at: '2026-09-03T10:00:00.100Z' },
    { id: 'm2', group_id: 'g1', role: 'tom', kind: 'report', content: '<h3>👥 Recreio</h3><p>232 sem anamnese</p>', created_at: '2026-09-03T10:00:00.200Z' },
  ]);
  await runOutboundOnce(sb, {
    sendGroupText: async (jid, texto) => { enviados.push(texto); return 'wa-' + enviados.length; },
    sendGroupMedia: async () => 'wa-media',
  });
  assert.strictEqual(enviados.length, 2, 'fala e card, os dois espelhados');
  assert.match(enviados[0], /Já busco aqui/, 'a FALA sai primeiro — senão o 👇 aponta pro vazio');
  assert.match(enviados[1], /232 sem anamnese/, 'o card vem depois');
});

test('cada mensagem enviada é marcada com o id REAL do WhatsApp, não com placeholder', async () => {
  const sb = fakeSupabase([
    { id: 'm1', group_id: 'g1', role: 'tom', kind: 'text', content: 'oi', created_at: '2026-09-03T10:00:00.100Z' },
  ]);
  await runOutboundOnce(sb, { sendGroupText: async () => 'ID-REAL-DO-WA', sendGroupMedia: async () => null });
  assert.deepStrictEqual(sb._updates, [{ id: 'm1', wa_message_id: 'ID-REAL-DO-WA' }]);
});

test('mensagem sem nada a espelhar sai da fila com placeholder ÚNICO (o UNIQUE não deixa repetir)', async () => {
  const sb = fakeSupabase([
    { id: 'm1', group_id: 'g1', role: 'tom', kind: 'text', content: '‹‹ACTIONS››[]', created_at: '2026-09-03T10:00:00.100Z' },
    { id: 'm2', group_id: 'g1', role: 'tom', kind: 'text', content: '‹‹ACTIONS››[]', created_at: '2026-09-03T10:00:00.200Z' },
  ]);
  await runOutboundOnce(sb, { sendGroupText: async () => 'x', sendGroupMedia: async () => null });
  const vals = sb._updates.map((u) => u.wa_message_id);
  assert.strictEqual(vals.length, 2);
  assert.notStrictEqual(vals[0], vals[1], 'dois valores iguais violariam gcm_wa_msg_uq e prenderiam a fila');
  vals.forEach((v) => assert.match(v, /^skipped:/));
});
