// src/services/conversation-audit.test.js
// Trava os helpers puros + o parser de saída do LLM da Auditoria de Qualidade de Conversa.
// Rodar: node --test src/services/conversation-audit.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizeSummary, signatureFor, parseFindings, rankFindings, upsertFinding, formatGroupTranscript,
  loadGroupConversation, chaveDoAchado, rotuloDaLinha, loadConversation, linhasDeMarkers,
} = require('./conversation-audit');

// Fake que distingue conversation_history de marker_logs (a trilha do banco).
function fakeDuasTabelas(convRows, markerRows) {
  const mk = (rows) => ({
    select() { return this; }, eq() { return this; }, gte() { return this; },
    order() { return this; }, limit() { return Promise.resolve({ data: rows, error: null }); },
  });
  return { from(t) { return mk(t === 'marker_logs' ? markerRows : convRows); } };
}

// Fake p/ loadConversation: registra o sentido do order e devolve as linhas.
function fakeConvWindow(rows, sink = {}) {
  return {
    from() { return this; }, select() { return this; }, eq() { return this; },
    gte() { return this; },
    order(col, opts) { sink.orderCol = col; sink.ascending = !!(opts && opts.ascending); return this; },
    limit(n) { sink.limit = n; return Promise.resolve({ data: rows, error: null }); },
  };
}

// Supabase fake p/ upsertFinding: from→select→eq resolve {data}; update/insert registram.
function fakeSb(rows, calls) {
  const b = {
    _mode: null,
    from() { return this; },
    select() { this._mode = 'select'; return this; },
    update(p) { this._mode = 'update'; calls.updates.push(p); return this; },
    insert(p) { calls.inserts.push(p); return Promise.resolve({ data: null, error: null }); },
    eq() { return this; },
    in() { return this; },
    then(resolve) {
      const val = this._mode === 'select' ? { data: rows, error: null } : { data: null, error: null };
      this._mode = null;
      resolve(val);
    },
  };
  return b;
}

// ── normalize + signature ───────────────────────────────────────────
test('normalizeSummary: remove acento/pontuação/número, baixa, colapsa', () => {
  assert.strictEqual(
    normalizeSummary('TOM negou salvar 2 gastos!!!'),
    'tom negou salvar gastos',
  );
});
test('signatureFor: mesma entrada (variando espaço/pontuação/caixa) → mesma assinatura', () => {
  const a = signatureFor('confabulation', 'c1', 'TOM negou salvar gasto');
  const b = signatureFor('confabulation', 'c1', 'tom  negou salvar  gasto.');
  assert.strictEqual(a, b);
});
test('signatureFor: categoria diferente → assinatura diferente', () => {
  assert.notStrictEqual(
    signatureFor('confabulation', 'c1', 'x'),
    signatureFor('wrong_refusal', 'c1', 'x'),
  );
});
test('signatureFor: colaborador diferente → assinatura diferente', () => {
  assert.notStrictEqual(signatureFor('x', 'c1', 's'), signatureFor('x', 'c2', 's'));
});

// ── parseFindings ───────────────────────────────────────────────────
test('parseFindings: extrai JSON válido e filtra categoria inválida/sem evidence', () => {
  const raw = 'lixo antes {"findings":[' +
    '{"category":"confabulation","severity":"alto","summary":"negou salvar","evidence":"TOM: não consigo salvar"},' +
    '{"category":"inventada","severity":"alto","summary":"x","evidence":"y"},' +
    '{"category":"frustration","severity":"baixo","summary":"sem prova"}' +
    ']} lixo depois';
  const out = parseFindings(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].category, 'confabulation');
});
test('parseFindings: severity inválida vira "medio"', () => {
  const out = parseFindings('{"findings":[{"category":"frustration","severity":"urgente","summary":"s","evidence":"e"}]}');
  assert.strictEqual(out[0].severity, 'medio');
});
test('parseFindings: JSON quebrado → []', () => {
  assert.deepStrictEqual(parseFindings('não é json'), []);
});
test('parseFindings: lista vazia → []', () => {
  assert.deepStrictEqual(parseFindings('{"findings":[]}'), []);
});
test('parseFindings: null/undefined → []', () => {
  assert.deepStrictEqual(parseFindings(null), []);
  assert.deepStrictEqual(parseFindings(undefined), []);
});

// ── proactive_overreach (categoria nova) ────────────────────────────
test('parseFindings: aceita proactive_overreach (cobrança em dia indevido)', () => {
  const raw = '{"findings":[{"category":"proactive_overreach","severity":"medio",' +
    '"summary":"cobrou tarefa no domingo","evidence":"USUÁRIO: Tom hj é domingo"}]}';
  const out = parseFindings(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].category, 'proactive_overreach');
});

// ── prompt: trava da regra (Quintela/Arthur) + anti-falso-positivo ──
test('SYSTEM prompt: cobre proactive_overreach com exceção do "desculpa"', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /proactive_overreach/);
  assert.match(SYSTEM, /desculp/i); // exceção: emite mesmo se o TOM se desculpar
});
// AUDIT-GROUP-OUTRO-AGENTE-VIRA-TOM: o wa_sender_name entrou no SELECT em 15/08 (o DADO),
// mas o prompt seguia declarando que a conversa só tem "USUÁRIO:"/"TOM:" — o JULGAMENTO
// continuou cego e a Maria virou TOM de novo em 16, 18 e 19/08. O contrato do formato e a
// regra de atribuição são a trava.
test('SYSTEM prompt: declara o formato REAL do grupo (nome de quem falou) e só julga o TOM', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /Maria - Financeiro/);
  assert.match(SYSTEM, /S[ÓO] O TOM [ÉE] JULGADO/);
  assert.match(SYSTEM, /N[ÃA]O come[çc]a com "TOM:"/);
});
test('SYSTEM prompt: media_fail exige mídia realmente falha (áudio transcrito = funcionou)', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /\[[áa]udio transcrito\]/);
  assert.match(SYSTEM, /NUNCA "media_fail"/);
});
test('SYSTEM prompt: fios paralelos — resposta no fio errado não é "pedido largado"', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /RESPONDENDO a esta mensagem anterior/);
  assert.match(SYSTEM, /fio errado/);
});
test('SYSTEM prompt: ensina que AVISO AUTOMÁTICO não é fala do TOM', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /AVISO AUT[ÔO]MATICO|AVISO AUTOM[ÁA]TICO/);
  assert.match(SYSTEM, /N[ÃA]O [ÉE] FALA DO TOM/);
});
test('SYSTEM prompt: guarda anti-falso-positivo de confabulation (ritual posterior + nomes parecidos)', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /MESMA troca reativa/);
  assert.match(SYSTEM, /simulado de TCC/); // exemplo dos nomes parecidos
});

// ── rankFindings (amostragem honesta do relatório) ──────────────────
test('rankFindings: ALTO vem primeiro, independente de ocorrências', () => {
  const f = [
    { severity: 'baixo', occurrences: 9, collaborator_id: 'a' },
    { severity: 'alto', occurrences: 1, collaborator_id: 'b' },
    { severity: 'medio', occurrences: 5, collaborator_id: 'c' },
  ];
  const { sample } = rankFindings(f, { perPerson: 2, max: 7 });
  assert.strictEqual(sample[0].severity, 'alto');
});
test('rankFindings: diversifica — 1 pessoa não toma toda a amostra; o grave do outro aparece', () => {
  const many = [];
  for (let i = 0; i < 9; i++) many.push({ severity: 'medio', occurrences: 1, collaborator_id: 'matheus' });
  many.push({ severity: 'alto', occurrences: 1, collaborator_id: 'alf' });
  const { sample, byPerson, bySeverity } = rankFindings(many, { perPerson: 2, max: 7 });
  assert.ok(sample.some(s => s.collaborator_id === 'alf'), 'alf (alto) deve aparecer');
  assert.strictEqual(byPerson.matheus, 9);
  assert.strictEqual(byPerson.alf, 1);
  assert.strictEqual(bySeverity.alto, 1);
});

// ── upsertFinding: guarda de re-surgimento ──────────────────────────
test('upsertFinding: assinatura já fechada (falso_positivo) NÃO re-surge', async () => {
  const calls = { inserts: [], updates: [] };
  const sb = fakeSb([{ id: 'x1', occurrences: 1, status: 'falso_positivo' }], calls);
  const r = await upsertFinding(sb, { id: 'c1' }, { category: 'confabulation', severity: 'alto', summary: 's', evidence: 'e' });
  assert.strictEqual(r, 'suppressed_closed');
  assert.strictEqual(calls.inserts.length, 0);
});
test('upsertFinding: assinatura inédita → insere novo', async () => {
  const calls = { inserts: [], updates: [] };
  const sb = fakeSb([], calls);
  const r = await upsertFinding(sb, { id: 'c1' }, { category: 'confabulation', severity: 'alto', summary: 's2', evidence: 'e' });
  assert.strictEqual(r, 'inserted');
  assert.strictEqual(calls.inserts.length, 1);
});

// ── resolveIncidentAt (evidence-anchored) ───────────────────────────
const { resolveIncidentAt, pickProbe } = require('./conversation-audit');

// fakeSb p/ conversation_history: select→eq→gte→order→limit resolve {data}.
function fakeConvSb(rows) {
  const b = {
    from() { return this; }, select() { return this; }, eq() { return this; },
    gte() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: rows, error: null }); },
  };
  return b;
}

test('resolveIncidentAt: evidence casa com mensagem → high + created_at da msg', async () => {
  const sb = fakeConvSb([
    { created_at: '2026-06-09T10:00:00Z', content: 'oi tom', media_extracted_text: null },
    { created_at: '2026-06-09T14:30:00Z', content: 'TOM não consigo salvar o gasto agora', media_extracted_text: null },
  ]);
  const out = await resolveIncidentAt(sb, 'c1', 'TOM: não consigo salvar o gasto agora', null, '2026-06-08T00:00:00Z');
  assert.strictEqual(out.incident_confidence, 'high');
  assert.strictEqual(out.incident_at, '2026-06-09T14:30:00Z');
});
test('resolveIncidentAt: sem casar mas com occurredAt → low', async () => {
  const sb = fakeConvSb([{ created_at: '2026-06-09T10:00:00Z', content: 'nada a ver', media_extracted_text: null }]);
  const out = await resolveIncidentAt(sb, 'c1', 'evidência inexistente xyz', '2026-06-09T23:59:00Z', '2026-06-08T00:00:00Z');
  assert.strictEqual(out.incident_confidence, 'low');
  assert.strictEqual(out.incident_at, '2026-06-09T23:59:00Z');
});
test('resolveIncidentAt: sem casar e sem occurredAt → none', async () => {
  const sb = fakeConvSb([]);
  const out = await resolveIncidentAt(sb, 'c1', 'qualquer', null, '2026-06-08T00:00:00Z');
  assert.strictEqual(out.incident_confidence, 'none');
  assert.strictEqual(out.incident_at, null);
});

// AUDIT-OUTBOUND-TUDO-VIRA-FALA-DO-TOM (medido 19/08) — loadConversation rotulava TODO
// outbound como "TOM:", mas boa parte do outbound é AVISO AUTOMÁTICO gerado por template do
// engine: lembrete, cobrança de ritual, RSVP de terceiro, devolutiva de delegação, repasse de
// recado. O auditor lia "✅ Ana, o Mayra concluiu a tarefa que você pediu" como o TOM afirmando
// ter feito algo → confabulação fabricada. É a irmã 1:1 do AUDIT-GROUP-OUTRO-AGENTE-VIRA-TOM.
// São strings determinísticas do engine (não prosa de LLM), então casar por template é exato.
test('rótulo: inbound é USUÁRIO', () => {
  assert.strictEqual(rotuloDaLinha({ direction: 'inbound', content: 'oi tom' }), 'USUÁRIO');
});
test('rótulo: resposta conversacional do TOM continua TOM', () => {
  assert.strictEqual(rotuloDaLinha({ direction: 'outbound', content: 'Fechou, Rose! Marquei pra amanhã 14h.' }), 'TOM');
});
test('rótulo: lembrete por ref_type vira AVISO AUTOMÁTICO', () => {
  assert.strictEqual(rotuloDaLinha({ direction: 'outbound', ref_type: 'task', content: '⏰ Lembrete: *Renovação* — hoje 08:00' }), 'AVISO AUTOMÁTICO');
  assert.strictEqual(rotuloDaLinha({ direction: 'outbound', ref_type: 'event', content: '📅 *Lembrete:* Reunião MKT' }), 'AVISO AUTOMÁTICO');
});
test('rótulo: repasse/devolutiva/RSVP de TERCEIRO vira AVISO AUTOMÁTICO', () => {
  const casos = [
    '✅ Ana, o Mayra concluiu a tarefa que você pediu: _"Presenças"_',
    '✅ *John* confirmou presença em _"Reunião MKT - NBG!"_ (2/2 confirmaram)',
    'Boa! O Fefê respondeu: "Ok tom"',
    'Oi, Anne 👋 O Fefê me pediu pra te avisar: tem cheques de dois alunos',
    '🔴 *Trocar spot quadrado branco quente* atrasou 1 dia. Resolve hoje ou reagenda?',
    '🟠 *Comprar ingresso pro Congresso Bryan* tá parada há 3 dias.',
  ];
  for (const c of casos) {
    assert.strictEqual(rotuloDaLinha({ direction: 'outbound', content: c }), 'AVISO AUTOMÁTICO', c);
  }
});
test('rótulo: "📨 Recado enviado!" É fala do TOM (confirmação da ação dele)', () => {
  assert.strictEqual(rotuloDaLinha({ direction: 'outbound', content: '📨 Recado enviado!' }), 'TOM');
});

// AUDIT-JANELA-CORTA-O-FIM (medido 19/08) — limit(300) com order ASC devolve as 300 mensagens
// MAIS ANTIGAS: num dia cheio o FIM da conversa some, e é lá que mora a resolução. O auditor
// via o pedido e não via a resposta → dropped_request fabricado. Além disso lastAt virava a
// 300ª msg, envenenando o occurred_at. A janela agora é ancorada no FIM.
test('janela: pega as mensagens mais RECENTES (DESC no banco) e devolve em ordem cronológica', async () => {
  const sink = {};
  const sb = fakeConvWindow([
    { created_at: '2026-08-18T20:00:00Z', direction: 'outbound', content: 'ultima' },
    { created_at: '2026-08-18T10:00:00Z', direction: 'inbound', content: 'primeira' },
  ], sink);
  const { text, lastAt } = await loadConversation(sb, 'c1', 24);
  assert.strictEqual(sink.ascending, false, 'tem que pedir DESC pro banco');
  assert.ok(text.indexOf('primeira') < text.indexOf('ultima'), 'texto sai em ordem cronologica');
  assert.strictEqual(lastAt, '2026-08-18T20:00:00Z', 'lastAt e a msg mais recente');
});

// AUDIT-ACUSA-SEM-OLHAR-O-BANCO (medido 19/08) — o auditor julgava só pelo texto. O veredito
// de execução já existe em marker_logs e era ignorado: foi assim que o achado do Anne afirmou
// "TOM não resolveu nem encaminhou" com a tarefa cancelada 53s depois. A trilha entra
// INTERCALADA, onde o julgamento acontece.
test('trilha: só ação de domínio executed/rejected vira linha SISTEMA', () => {
  const st = () => '18/08 13:23';
  const out = linhasDeMarkers([
    { marker_type: 'TASK_UPDATE', result: 'executed', reason: 'ok=1 fail=0', created_at: 'x' },
    { marker_type: 'CHOKEPOINT', result: 'redirected', reason: 'confab', created_at: 'x' },
    { marker_type: 'COORDINATION_REQUEST', result: 'skipped', reason: 'staged_coord:1', created_at: 'x' },
    { marker_type: 'EVENT_CREATE', result: 'rejected', reason: 'schema_invalid', created_at: 'x' },
  ], st);
  assert.strictEqual(out.length, 2, 'META e skipped ficam de fora');
  assert.match(out[0].linha, /SISTEMA: TASK_UPDATE executed \(ok=1 fail=0\)/);
  assert.match(out[1].linha, /SISTEMA: EVENT_CREATE rejected/);
});
test('trilha: entrada inválida não quebra', () => {
  assert.deepStrictEqual(linhasDeMarkers(null, () => ''), []);
  assert.deepStrictEqual(linhasDeMarkers([null, {}], () => ''), []);
});
test('trilha: SISTEMA aparece INTERCALADO na transcrição, na ordem do tempo', async () => {
  const sb = fakeDuasTabelas(
    [{ created_at: '2026-08-18T16:22:16Z', direction: 'inbound', content: 'Cancela os ingressos' },
      { created_at: '2026-08-18T16:23:11Z', direction: 'outbound', content: 'Aviso o Fefê? Confirma?' }],
    [{ created_at: '2026-08-18T16:23:09Z', marker_type: 'TASK_UPDATE', result: 'executed', reason: 'ok=1 fail=0' }],
  );
  const { text } = await loadConversation(sb, 'c1', 24);
  const l = text.split('\n');
  assert.match(l[0], /USUÁRIO: Cancela os ingressos/);
  assert.match(l[1], /SISTEMA: TASK_UPDATE executed/, 'a prova entra ANTES da resposta visivel');
  assert.match(l[2], /TOM: Aviso o Fefê\? Confirma\?/);
});
test('SYSTEM prompt: ensina que SISTEMA é o veredito do banco e não serve de evidence', () => {
  const { SYSTEM } = require('../prompts/conversation-audit-prompt');
  assert.match(SYSTEM, /SISTEMA:/);
  assert.match(SYSTEM, /VEREDITO DO BANCO/);
  assert.match(SYSTEM, /Nunca cite a linha SISTEMA como "evidence"/);
});

// AUDIT-SIGNATURE-INSTAVEL (medido 19/08) — a assinatura era sha1 do RESUMO em texto livre do
// LLM. Bastava ele reescrever a frase pro achado virar linha nova: medido 398 de 399 achados
// com occurrences=1, e falso positivo fechado ontem voltando hoje como 🆕. A triagem não
// acumulava. Agora a chave é o INCIDENTE (incident_at, quando a âncora é confiável) e o
// fallback é um CONJUNTO DE TOKENS do resumo — imune a ordem, artigo e reformulação.
test('chave: âncora confiável usa o incident_at, não o resumo', () => {
  const a = chaveDoAchado({ summary: 'TOM não registrou o gasto', incident_at: '2026-08-18T16:06:06Z', incident_confidence: 'high' });
  const b = chaveDoAchado({ summary: 'O TOM deixou de registrar a despesa!', incident_at: '2026-08-18T16:06:06Z', incident_confidence: 'high' });
  assert.strictEqual(a, b);
  assert.match(a, /^at:/);
});
test('chave: incidentes DIFERENTES não colidem', () => {
  const a = chaveDoAchado({ summary: 'x', incident_at: '2026-08-18T16:06:06Z', incident_confidence: 'high' });
  const b = chaveDoAchado({ summary: 'x', incident_at: '2026-08-18T17:00:00Z', incident_confidence: 'high' });
  assert.notStrictEqual(a, b);
});
test('chave: sem âncora, resumo reformulado dá a MESMA chave (token-set)', () => {
  const a = chaveDoAchado({ summary: 'TOM nao registrou o gasto', incident_confidence: 'none' });
  const b = chaveDoAchado({ summary: 'O TOM nao registrou o gasto.', incident_confidence: 'none' });
  const c = chaveDoAchado({ summary: 'Nao registrou o gasto, o TOM', incident_confidence: 'low' });
  assert.strictEqual(a, b);
  assert.strictEqual(a, c);
  assert.match(a, /^rs:/);
});
test('chave: resumos de assunto diferente seguem diferentes', () => {
  const a = chaveDoAchado({ summary: 'TOM nao registrou o gasto', incident_confidence: 'none' });
  const b = chaveDoAchado({ summary: 'TOM nao criou o evento da reuniao', incident_confidence: 'none' });
  assert.notStrictEqual(a, b);
});
test('assinatura: mesma chave + categorias diferentes → assinaturas diferentes', () => {
  const f = { summary: 's', incident_at: '2026-08-18T16:06:06Z', incident_confidence: 'high' };
  assert.notStrictEqual(
    signatureFor('confabulation', 'c1', f.summary, chaveDoAchado(f)),
    signatureFor('frustration', 'c1', f.summary, chaveDoAchado(f)));
});
// Migração: a assinatura mudou, então o achado JÁ fechado precisa continuar sendo encontrado
// pela chave ANTIGA — senão a troca ressuscitaria de uma vez todo falso positivo já triado,
// que é exatamente a doença que este fix cura.
test('upsertFinding acha pela assinatura LEGADA e não ressuscita o fechado', async () => {
  const calls = { inserts: [], updates: [] };
  const legado = signatureFor('confabulation', 'c1', 'TOM nao registrou o gasto');
  const sb = fakeSb([{ id: 'f1', occurrences: 2, status: 'falso_positivo', signature: legado }], calls);
  const r = await upsertFinding(sb, { id: 'c1' }, {
    category: 'confabulation', severity: 'medio', summary: 'O TOM nao registrou o gasto!',
    evidence: 'e', incident_at: '2026-08-18T16:06:06Z', incident_confidence: 'high',
  });
  assert.strictEqual(r, 'suppressed_closed');
  assert.strictEqual(calls.inserts.length, 0, 'não pode inserir linha nova');
});

// AUDIT-PROBE-CARIMBO-CEGA-ANCORA (medido 19/08) — o transcript passou a ser
// "[18/08 (ter) 13:06] USUÁRIO: texto" (fix AUDIT-RELATIVE-DATE-BLIND, 02/08), mas o pickProbe
// só tirava o rótulo ancorado em `^`. Com o carimbo na frente o rótulo nunca saía, o probe
// carregava "[18/08 (ter) 13:06] usuário: ..." e o includes() contra conversation_history.content
// (que NÃO tem carimbo) falhava sempre → tudo caía em low/none → finding-triage carimbava
// "regressão" falsa. Os testes antigos passavam evidência SEM carimbo: por isso ficou verde 17 dias.
test('pickProbe: tira o carimbo do transcript antes do rótulo (formato REAL)', () => {
  const probe = pickProbe('[18/08 (ter) 13:06] USUÁRIO: já chegou do mercado livre essas encomendas');
  assert.strictEqual(probe, 'já chegou do mercado livre essas encomendas');
});
test('pickProbe: carimbo sem rótulo também sai', () => {
  assert.strictEqual(pickProbe('[05/08 (qua) 13:15] fechou o mês com tudo pago'), 'fechou o mês com tudo pago');
});
test('pickProbe: linha sem carimbo segue funcionando (zero-regressão)', () => {
  assert.strictEqual(pickProbe('TOM: não consigo salvar o gasto agora'), 'não consigo salvar o gasto agora');
});
test('pickProbe: colchete no MEIO do texto não é tocado', () => {
  assert.strictEqual(pickProbe('USUÁRIO: manda [urgente] o relatório pra Rose'), 'manda [urgente] o relatório pra rose');
});
test('resolveIncidentAt: evidence no formato REAL (com carimbo) ancora → high', async () => {
  const sb = fakeConvSb([
    { created_at: '2026-08-18T16:00:24Z', content: 'Trocar spot quadrado branco quente atrasou 1 dia', media_extracted_text: null },
    { created_at: '2026-08-18T16:06:06Z', content: '[áudio transcrito] já chegou do mercado livre essas encomendas', media_extracted_text: null },
  ]);
  const out = await resolveIncidentAt(
    sb, 'c1', '[18/08 (ter) 13:06] USUÁRIO: já chegou do mercado livre essas encomendas',
    '2026-08-18T23:00:00Z', '2026-08-17T00:00:00Z');
  assert.strictEqual(out.incident_confidence, 'high');
  assert.strictEqual(out.incident_at, '2026-08-18T16:06:06Z');
});

test('upsertFinding: inserção grava incident_at e incident_confidence', async () => {
  const calls = { inserts: [], updates: [] };
  const sb = fakeSb([], calls); // sem finding prévio → insere
  await upsertFinding(sb, { id: 'c1' }, {
    category: 'confabulation', severity: 'alto', summary: 's3', evidence: 'e',
    occurred_at: '2026-06-09T23:00:00Z', incident_at: '2026-06-09T14:30:00Z', incident_confidence: 'high',
  });
  assert.strictEqual(calls.inserts.length, 1);
  assert.strictEqual(calls.inserts[0].incident_at, '2026-06-09T14:30:00Z');
  assert.strictEqual(calls.inserts[0].incident_confidence, 'high');
});

// ── AUDIT-GRUPO-CEGO (13/08/2026) ────────────────────────────────────────────────────
// A auditoria lia SÓ `conversation_history`: zero refs a `group_chat_messages`. O caso Rose
// (10 tarefas concluídas erradas no grupo Financeiro, 12/08) nunca poderia ter sido visto —
// o sensor apontava pro outro lado. Não é falha do agente de governança, é falha do sensor.
//
// O transcript de grupo tem uma diferença que importa: são VÁRIAS pessoas. Sem o nome de quem
// falou, o auditor lê um diálogo embaralhado e inventa atribuição — falso positivo caro.
test('formatGroupTranscript nomeia quem falou e marca o TOM', () => {
  const linhas = [
    { role: 'member', content: 'Tom, conclui os dois por favor', created_at: '2026-08-12T21:44:00-03:00',
      sender: { preferred_name: 'Rose', full_name: 'Rose Silva' } },
    { role: 'tom', content: 'Marquei como feitos os dois de hoje', created_at: '2026-08-12T21:45:00-03:00', sender: null },
  ];
  const t = formatGroupTranscript(linhas);
  assert.match(t, /Rose: Tom, conclui os dois/);
  assert.match(t, /TOM: Marquei como feitos/);
  assert.match(t, /12\/08/); // carimbo de data — o auditor julga "hoje" contra o dia da conversa
});

// GROUPCHAT-SENDER-ID-NULL: 710 das 1633 mensagens de membro estão sem sender_id. Cair pra
// "alguém do grupo" é melhor que quebrar ou omitir a linha — omitir tira o pedido do
// contexto e o auditor passa a ver a resposta do TOM sem a pergunta que a gerou.
test('formatGroupTranscript aguenta sender ausente sem perder a linha', () => {
  const t = formatGroupTranscript([
    { role: 'member', content: 'pode finalizar', created_at: '2026-08-12T19:21:00-03:00', sender: null },
  ]);
  assert.match(t, /pode finalizar/);
  assert.match(t, /alguém do grupo/i);
});

// AUDIT-GROUP-OUTRO-AGENTE-VIRA-TOM (15/08): no grupo "Financeiro" quem responde a Rose é a
// MARIA — outro agente, com WhatsApp próprio. Ela entra como role='member' e sender_id=null
// (não é colaboradora cadastrada), então caía em "alguém do grupo". O auditor recebia
//   Rose: Destrincha o e-mail 1 pfvr
//   alguém do grupo: Sobre o e-mail: nada de novo nas caixas até agora hoje
// e concluiu "o TOM respondeu outra coisa e não destrinchou" — achado f2ed069e, além de uma
// "contradição" (5e1861e0) montada com duas falas da Maria sobre prints diferentes. O TOM
// levou a culpa pelo trabalho de outro agente, e o nome estava na tabela o tempo todo:
// group_chat_messages.wa_sender_name = 'Maria - Financeiro'.
test('formatGroupTranscript usa wa_sender_name quando quem falou não é colaborador', () => {
  const t = formatGroupTranscript([
    { role: 'member', content: 'Destrincha o e-mail 1 pfvr', created_at: '2026-08-14T09:03:00-03:00',
      sender: { preferred_name: 'Rose', full_name: 'Rose Silva' }, wa_sender_name: null },
    { role: 'member', content: 'Sobre o e-mail: nada de novo nas caixas até agora hoje',
      created_at: '2026-08-14T09:06:00-03:00', sender: null, wa_sender_name: 'Maria - Financeiro' },
  ]);
  assert.match(t, /Maria - Financeiro: Sobre o e-mail/);
  assert.doesNotMatch(t, /alguém do grupo/i); // era aqui que a Maria virava "o TOM"
});

// Colaborador cadastrado é fonte mais forte que o nome que veio do WhatsApp (apelido editável,
// pode vir vazio ou trocado). wa_sender_name é FALLBACK, não substituto.
test('formatGroupTranscript prefere o colaborador cadastrado ao wa_sender_name', () => {
  const t = formatGroupTranscript([
    { role: 'member', content: 'pode finalizar', created_at: '2026-08-12T19:21:00-03:00',
      sender: { preferred_name: 'Rose', full_name: 'Rose Silva' }, wa_sender_name: 'Rosinha 📱' },
  ]);
  assert.match(t, /Rose: pode finalizar/);
});

// A OUTRA PORTA: nomear certo no formatter não adianta se a query não trouxer a coluna. O
// achado de 15/08 nasceu de um SELECT cego — wa_sender_name existia na tabela, preenchida, e
// loadGroupConversation não pedia. Sem este teste o fix vira NOOP silencioso em produção.
test('loadGroupConversation pede wa_sender_name no select', async () => {
  let colunas = '';
  const sbFake = {
    from: () => ({
      select: (cols) => { colunas = cols; return {
        eq: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }),
      }; },
    }),
  };
  await loadGroupConversation(sbFake, 'grupo-x', 24);
  assert.match(colunas, /wa_sender_name/);
});

test('formatGroupTranscript: entrada vazia ou inválida vira string vazia', () => {
  assert.strictEqual(formatGroupTranscript([]), '');
  assert.strictEqual(formatGroupTranscript(null), '');
  assert.strictEqual(formatGroupTranscript(undefined), '');
});

test('upsertFinding com groupId grava group_id e deixa collaborator_id nulo', async () => {
  const calls = { inserts: [], updates: [] };
  const sb = fakeSb([], calls);
  const grupo = { id: 'g1', full_name: 'Financeiro' }; // work_groups usa `name`; quem chama normaliza
  const r = await upsertFinding(sb, grupo, { category: 'confabulacao', severity: 'alto', summary: 's', evidence: 'e' }, { groupId: 'g1' });
  assert.strictEqual(r, 'inserted');
  assert.strictEqual(calls.inserts[0].group_id, 'g1');
  assert.strictEqual(calls.inserts[0].collaborator_id, null);
});

// O cenário D do Replay Lab roda num grupo `[QA] ...` e produz exatamente os sintomas que
// este detector procura. Sem o guard, cada bateria injetaria falha FABRICADA na base que
// usamos pra priorizar — eu contaminando o meu próprio diagnóstico.
test('upsertFinding ignora grupo de QA', async () => {
  const calls = { inserts: [], updates: [] };
  const sb = fakeSb([], calls);
  const r = await upsertFinding(sb, { id: 'g2', full_name: '[QA] Financeiro Replay' },
    { category: 'confabulacao', severity: 'alto', summary: 's', evidence: 'e' }, { groupId: 'g2' });
  assert.strictEqual(r, 'ignorado_qa');
});

// JANELA COM FIM (01/09) ----------------------------------------------------
// Sem fim de janela, 'as ultimas 24h' so sabe olhar pro dia de HOJE -- e um dia que a
// auditoria perdeu ficava perdido pra sempre. Isso existe pro reprocessamento dos dias
// em que o detector ficou cego (29/08 a 01/09). O `.lt` so entra QUANDO ha fim: sem ele a
// cadeia e identica a de sempre, que e por que nenhum chamador antigo muda de forma.
test('janela com fim: filtra pelas duas pontas e nao vaza pro futuro', async () => {
  const chamadas = { gte: null, lt: null };
  const q = {
    select: () => q, eq: () => q, order: () => q,
    gte: (_c, v) => { chamadas.gte = v; return q; },
    lt: (_c, v) => { chamadas.lt = v; return q; },
    limit: async () => ({ data: [] }),
  };
  const sb = { from: () => q };
  const fim = '2026-08-30T03:00:00.000Z';
  await loadConversation(sb, 'c1', 24, fim);
  assert.strictEqual(chamadas.lt, fim, 'o fim da janela tem que virar filtro');
  assert.strictEqual(chamadas.gte, '2026-08-29T03:00:00.000Z', 'o inicio e fim-24h');
});

test('sem fim de janela: NENHUM filtro de fim e aplicado (caminho de sempre)', async () => {
  let usouLt = false;
  const q = {
    select: () => q, eq: () => q, order: () => q, gte: () => q,
    lt: () => { usouLt = true; return q; },
    limit: async () => ({ data: [] }),
  };
  await loadConversation({ from: () => q }, 'c1', 24);
  assert.strictEqual(usouLt, false, 'sem fim, a cadeia nao pode ganhar .lt');
});
