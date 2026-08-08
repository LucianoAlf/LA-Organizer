'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { detectExplicitDayIntent, resolveExplicitWeekdayDate, dowFromYmd } = require('./temporal-intent');
const { stripReplyScaffold } = require('../events/detect-approval-reply');

// Caso real Ana (29/06 13:01): reply-quote a uma cobrança que diz "Resolve hoje
// ou reagenda?" + fala "remarcar para dia 05/07". O "hoje" da CITAÇÃO não pode
// contar como intenção do usuário, senão o auto-align clobbera o 05/07 pra hoje.
const ANA = '[O usuário está RESPONDENDO a esta mensagem anterior: "🔴 *Pagamento Rescisão professor Lana* atrasou 1 dia. Resolve hoje ou reagenda? Me responde aqui — pode ser áudio."]\nTom, eu pedi para remarcar para dia 05/07. Será incluído na folha';

test('CONTROLE: a forma BUGGY (texto cru) casaria "hoje" da citação — prova que o teste pega o bug', () => {
  const cruLC = ANA.toLowerCase();
  // Reproduz a detecção antiga (sem stripReplyScaffold): o bug era exatamente este.
  const buggyWantsToday = /\b(hoje)\b/.test(cruLC) && !/\bamanh[ãa]/.test(cruLC);
  assert.strictEqual(buggyWantsToday, true, 'o texto cru DEVE casar "hoje" (da citação) — é o bug que estamos matando');
});

test('Ana: "hoje" na CITAÇÃO não conta — reschedule p/ 05/07 não vira hoje', () => {
  const r = detectExplicitDayIntent(ANA);
  assert.strictEqual(r.wantsToday, false);
  assert.strictEqual(r.wantsTomorrow, false);
  // sanity: o scaffold realmente separa a fala real
  assert.match(stripReplyScaffold(ANA).userText, /^Tom, eu pedi/);
});

test('Ana 28/06: variação "Reagenda... Me lembra dia 05/07" também não contamina', () => {
  const txt = '[O usuário está RESPONDENDO a esta mensagem anterior: "🔴 Pagamento Rescisão professor Lana atrasou 1 dia. Resolve hoje ou reagenda?"]\nReagenda tom\nVai ser incluído no pagamento.\n\nMe lembra dia 05/07 apenas';
  assert.deepStrictEqual(detectExplicitDayIntent(txt), { wantsToday: false, wantsTomorrow: false });
});

test('NEGATIVO: "amanhã" na CITAÇÃO (cobrança "vence amanhã") não contamina', () => {
  const txt = '[O usuário está RESPONDENDO a esta mensagem anterior: "Colocar cabo na planilha vence amanhã. Tá encaminhado?"]\nremarca pra dia 10';
  assert.deepStrictEqual(detectExplicitDayIntent(txt), { wantsToday: false, wantsTomorrow: false });
});

test('LEGÍTIMO preservado: "hoje" na fala REAL ainda alinha', () => {
  assert.deepStrictEqual(detectExplicitDayIntent('paga isso hoje'), { wantsToday: true, wantsTomorrow: false });
});

test('LEGÍTIMO preservado: "amanhã" na fala real tem precedência sobre "hoje"', () => {
  assert.deepStrictEqual(detectExplicitDayIntent('hoje não, me lembra amanhã'), { wantsToday: false, wantsTomorrow: true });
});

test('LEGÍTIMO preservado: sem scaffold, "hoje" puro conta', () => {
  assert.deepStrictEqual(detectExplicitDayIntent('hoje'), { wantsToday: true, wantsTomorrow: false });
});

test('reply-quote LEGÍTIMO: "hoje" na fala real (não na citação) ainda conta', () => {
  const txt = '[O usuário está RESPONDENDO a esta mensagem anterior: "Quer reagendar?"]\npode deixar pra hoje mesmo';
  assert.deepStrictEqual(detectExplicitDayIntent(txt), { wantsToday: true, wantsTomorrow: false });
});

// AUTOALIGN-EXPLANATORY-DAY (caso Rose 01/08) — "amanhã" numa oração EXPLICATIVA não é
// destino. Ela escreveu: "Tom muda essa tarefa pra segunda pfvr, amanhã é domingo, n trabalho".
// O TOM entendeu certo e emitiu reschedule pra SEGUNDA (03/08); o auto-align viu a palavra
// "amanhã" e sobrescreveu pra 02/08 — DOMINGO, o dia que ela acabara de dizer que não trabalha.
// Log do turno: TASK_DATE_AUTO_ALIGNED count=2 target=2026-08-02.
test('caso Rose: "amanhã é domingo" é explicação, não destino', () => {
  const r = detectExplicitDayIntent('Tom muda essa tarefa pra segunda pfvr, amanhã é domingo, n trabalho');
  assert.strictEqual(r.wantsTomorrow, false);
  assert.strictEqual(r.wantsToday, false);
});

test('dia da semana nomeado vence "amanhã/hoje" solto (destino concorrente)', () => {
  assert.strictEqual(detectExplicitDayIntent('passa pra sexta, hoje não dá').wantsToday, false);
  assert.strictEqual(detectExplicitDayIntent('deixa pro dia 12, amanhã tô fora').wantsTomorrow, false);
});

test('NÃO-REGRESSÃO: pedido direto de amanhã/hoje continua valendo', () => {
  assert.strictEqual(detectExplicitDayIntent('Amanhã preciso pagar o boleto, me lembra 8h30?').wantsTomorrow, true);
  assert.strictEqual(detectExplicitDayIntent('muda pra amanhã').wantsTomorrow, true);
  assert.strictEqual(detectExplicitDayIntent('faz isso hoje ainda').wantsToday, true);
});

test('NÃO-REGRESSÃO: "hoje é" explicativo não força hoje', () => {
  assert.strictEqual(detectExplicitDayIntent('hoje é feriado, joga pra quarta').wantsToday, false);
});

test('replay lab 06/08: "pra sábado" resolve determinístico para 08/08, não domingo', () => {
  const resolved = resolveExplicitWeekdayDate('passa essa do inventário pra sábado', { baseYmd: '2026-08-06' });
  assert.strictEqual(resolved, '2026-08-08');
  assert.strictEqual(dowFromYmd(resolved), 6);
  assert.strictEqual(dowFromYmd('2026-08-09'), 0, 'controle: 09/08/2026 é domingo');
});

test('weekday resolver aceita acento ausente', () => {
  assert.strictEqual(resolveExplicitWeekdayDate('joga pra sabado', { baseYmd: '2026-08-06' }), '2026-08-08');
  assert.strictEqual(resolveExplicitWeekdayDate('muda pra terca-feira', { baseYmd: '2026-08-06' }), '2026-08-11');
});

test('weekday resolver não briga com data numérica explícita nem frase ambígua', () => {
  assert.strictEqual(resolveExplicitWeekdayDate('joga pra sábado 15/08', { baseYmd: '2026-08-06' }), null);
  assert.strictEqual(resolveExplicitWeekdayDate('entre sábado e domingo eu vejo', { baseYmd: '2026-08-06' }), null);
});

// ── Buracos de ABSTENÇÃO (catraca, 06/08) ─────────────────────────────────────
// O guard roda DEPOIS do marker e é determinístico, então ele ganha sempre. Isso
// inverte o risco: onde ele erra, ele atropela um marker que estava certo. Os dois
// casos abaixo estavam vivos em produção — o conjunto de abstenção cobria data
// numérica e dois-dias, mas não estes.
test('"próxima sexta" / "sexta que vem" ABSTÊM — a próxima sexta cai na MESMA semana', () => {
  // Numa quinta 06/08 o guard devolvia 07/08 (amanhã!) para um pedido de semana que vem.
  // Aqui a ambiguidade é real: a próxima sexta (07/08) ainda é desta semana, então "sexta que
  // vem" pode ser 07/08 ou 14/08 — e o resolvedor não tem como saber. Segue abstendo.
  for (const t of ['passa pra próxima sexta', 'passa pra sexta que vem']) {
    assert.strictEqual(resolveExplicitWeekdayDate(t, { baseYmd: '2026-08-06' }), null, t);
  }
});

// ESTES DOIS SAÍRAM DO TESTE ACIMA em 08/08, e a mudança é deliberada.
// O teste original mandava abster de TODO "próxima X" porque, na época, o guard não sabia
// distinguir os casos. Sabe agora: quando a próxima ocorrência já cai na semana seguinte, as
// duas leituras de "que vem" apontam para o MESMO dia e não há decisão a tomar. Abster ali
// devolvia ao LLM um cálculo que ele erra — 4 casos medidos entre 01 e 06/08
// (TASK-RESCHEDULE-WEEKDAY-OFFBY).
test('semana seguinte SEM ambiguidade agora resolve (numa quinta, segunda e terça só existem lá)', () => {
  assert.strictEqual(resolveExplicitWeekdayDate('joga pra proxima segunda', { baseYmd: '2026-08-06' }), '2026-08-10');
  assert.strictEqual(resolveExplicitWeekdayDate('deixa pra semana que vem na terça', { baseYmd: '2026-08-06' }), '2026-08-11');
});

test('dia da semana IGUAL ao de hoje ABSTÉM — "pra quinta" numa quinta não é hoje', () => {
  // Devolvia o próprio dia: reagendar para hoje é no-op na melhor hipótese, e sobrescreve
  // o marker do LLM que provavelmente resolveu para a semana seguinte.
  assert.strictEqual(resolveExplicitWeekdayDate('passa essa pra quinta', { baseYmd: '2026-08-06' }), null);
  assert.strictEqual(resolveExplicitWeekdayDate('remarca pra segunda', { baseYmd: '2026-08-03' }), null);
});

test('o caso do Alfredo (06/08 → sábado) continua resolvendo — a abstenção não pode comer o fix', () => {
  assert.strictEqual(resolveExplicitWeekdayDate('passa essa do inventário pra sábado', { baseYmd: '2026-08-06' }), '2026-08-08');
  assert.strictEqual(resolveExplicitWeekdayDate('muda pra terca-feira', { baseYmd: '2026-08-06' }), '2026-08-11');
});

// TASK-RESCHEDULE-WEEKDAY-OFFBY (findings de 01 a 06/08): "terça QUE VEM" caía na abstenção
// do WEEK_SHIFT_RE e voltava pro LLM, que erra o cálculo. Mas "que vem" só é ambíguo quando a
// próxima ocorrência ainda cai na MESMA semana da base. Quando ela já cai na semana seguinte,
// "próxima terça" e "terça que vem" apontam para o MESMO dia — e aí não há o que decidir.
test('semana-seguinte sem ambiguidade: "terça que vem" numa quinta resolve (as duas leituras coincidem)', () => {
  // 06/08/2026 é quinta. A próxima terça é 11/08 e JÁ está na semana seguinte.
  assert.equal(resolveExplicitWeekdayDate('passa pra próxima terça', { baseYmd: '2026-08-06' }), '2026-08-11');
  assert.equal(resolveExplicitWeekdayDate('joga pra terça que vem', { baseYmd: '2026-08-06' }), '2026-08-11');
});

test('ambiguidade REAL continua abstendo: "quinta que vem" numa segunda', () => {
  // 03/08 é segunda; a próxima quinta (06/08) está na MESMA semana. "Que vem" pode ser 06/08
  // ou 13/08 — o resolvedor não tem como saber, então deixa o marker do LLM valer.
  assert.equal(resolveExplicitWeekdayDate('passa pra quinta que vem', { baseYmd: '2026-08-03' }), null);
});

test('caso direto segue igual (anti-regressão do guard)', () => {
  assert.equal(resolveExplicitWeekdayDate('passa pra terça', { baseYmd: '2026-08-06' }), '2026-08-11');
  assert.equal(resolveExplicitWeekdayDate('reagenda pra quinta', { baseYmd: '2026-08-03' }), '2026-08-06');
});
