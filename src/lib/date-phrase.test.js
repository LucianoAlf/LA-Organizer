'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extrairPeriodo } = require('./date-phrase');

// CTX-LEITURA-DETERMINISTICA fatia 1 (27/08). O gatilho da pré-busca é DATA, não assunto:
// extração de entidade (finita, enumerável, testável), não classificação de intenção — que é o
// tipo de regex que já mordeu o projeto (conta provável por token, comerciante≠e-mail,
// tryShopBypass). Como o resultado só ENRIQUECE contexto (não grava, não envia, não muta), o
// falso-positivo custa ~500 chars e o falso-negativo custa o bug do Rafinha. Gatilho generoso.
//
// Datas SEM toISOString() sobre "agora" (project_localymd_utc_shift) e \b não vale pra acentuado
// em JS — as fronteiras usam \p{L} com flag u.

const QUA = '2026-08-26'; // quarta-feira — o dia em que o Rafinha perguntou
const QUI = '2026-08-27'; // quinta-feira

const p = (txt, hoje = QUA) => extrairPeriodo(txt, hoje);

test('CASO RAFINHA: "O que eu tenho pra quinta feira tom" → 27/08', () => {
  const r = p('O que eu tenho pra quinta feira tom');
  assert.deepStrictEqual([r.de, r.ate], ['2026-08-27', '2026-08-27']);
});

test('dia da semana pega a PRÓXIMA ocorrência, e HOJE conta como ela', () => {
  assert.strictEqual(p('e na quarta?').de, QUA, 'quarta dita na quarta = hoje');
  assert.strictEqual(p('tem algo terça?').de, '2026-09-01');
  assert.strictEqual(p('sábado').de, '2026-08-29');
  assert.strictEqual(p('domingo').de, '2026-08-30');
});

test('acento e abreviação não escapam (terça/terca, sábado/sabado, quinta-feira)', () => {
  for (const t of ['terça', 'terca', 'terça-feira', 'TERÇA']) assert.strictEqual(p(t).de, '2026-09-01', t);
  for (const t of ['sábado', 'sabado', 'sábado-feira']) assert.strictEqual(p(t).de, '2026-08-29', t);
  assert.strictEqual(p('quinta-feira').de, QUI);
});

test('"que vem" empurra pra semana seguinte', () => {
  assert.strictEqual(p('quarta que vem').de, '2026-09-02', 'não é hoje, é a próxima');
  assert.strictEqual(p('próxima quinta').de, '2026-09-03');
});

test('hoje / amanhã / depois de amanhã / ontem', () => {
  assert.deepStrictEqual([p('o que tenho hoje').de, p('o que tenho hoje').ate], [QUA, QUA]);
  assert.strictEqual(p('amanhã').de, QUI);
  assert.strictEqual(p('amanha cedo').de, QUI);
  assert.strictEqual(p('depois de amanhã').de, '2026-08-28');
  assert.strictEqual(p('o que eu tinha ontem').de, '2026-08-25');
});

test('"depois de amanhã" NÃO é lido como "amanhã" (o mais específico vence)', () => {
  assert.strictEqual(p('depois de amanhã tem algo?').de, '2026-08-28');
});

test('data explícita dd/mm e dd/mm/aaaa', () => {
  assert.deepStrictEqual([p('tem algo dia 10/09?').de, p('tem algo dia 10/09?').ate], ['2026-09-10', '2026-09-10']);
  assert.strictEqual(p('reunião 03/09/2026').de, '2026-09-03');
  assert.strictEqual(p('01/09').de, '2026-09-01');
});

test('"dia N" resolve no mês corrente, ou no próximo se já passou', () => {
  assert.strictEqual(p('dia 30').de, '2026-08-30', 'ainda vem neste mês');
  assert.strictEqual(p('dia 3').de, '2026-09-03', 'já passou em agosto → setembro');
});

test('períodos: semana / semana que vem / fim de semana', () => {
  const s = p('o que tenho essa semana');
  assert.deepStrictEqual([s.de, s.ate], [QUA, '2026-08-30'], 'hoje até domingo');
  const sv = p('semana que vem');
  assert.deepStrictEqual([sv.de, sv.ate], ['2026-08-31', '2026-09-06'], 'segunda a domingo');
  const fds = p('tem algo no fim de semana?');
  assert.deepStrictEqual([fds.de, fds.ate], ['2026-08-29', '2026-08-30']);
});

test('NÃO dispara em texto sem data (o custo é baixo, mas ruído puro é ruído)', () => {
  for (const t of ['bom dia tom', 'como você está?', 'obrigado!', 'pode cancelar aquilo', '']) {
    assert.strictEqual(p(t), null, JSON.stringify(t));
  }
});

test('não confunde número solto / valor / hora com data', () => {
  assert.strictEqual(p('paguei 250 reais'), null);
  assert.strictEqual(p('me liga 14h'), null);
  assert.strictEqual(p('o pedido 4425'), null);
});

test('data absurda ou fora da faixa útil não vira janela', () => {
  assert.strictEqual(p('dia 99'), null);
  assert.strictEqual(p('45/13'), null);
  assert.strictEqual(p('era 10/01/2019'), null, 'passado distante não interessa ao contexto');
});

test('rótulo humano acompanha (o bloco do prompt precisa dizer QUAL período)', () => {
  assert.match(p('quinta').rotulo, /quinta/i);
  assert.match(p('semana que vem').rotulo, /semana/i);
  assert.match(p('10/09').rotulo, /10\/09/);
});

test('entrada lixo não quebra', () => {
  for (const v of [null, undefined, 123, {}, []]) assert.strictEqual(extrairPeriodo(v, QUA), null);
  assert.strictEqual(extrairPeriodo('quinta', 'nao-e-data'), null);
});

// ── Achados do teste adversarial contra 938 mensagens REAIS de produção (27/08) ────────────
test('ADVERSARIAL: data DENTRO da citação do TOM não vale — só a fala do usuário', () => {
  const t = '[O usuário está RESPONDENDO a esta mensagem anterior: "📅 Lucas — reunião 02/09 às 14h"] beleza, obrigado';
  assert.strictEqual(p(t), null, 'a data era do TOM, o usuário não perguntou nada');
});

test('ADVERSARIAL: variante "(conteúdo completo do banco)" da citação também é descartada', () => {
  // Texto REAL de produção — 2 em 400 escapavam do strip e vazavam "amanhã"/"hoje" da fala do TOM.
  const t = '[O usuário está RESPONDENDO a esta mensagem anterior (conteúdo completo do banco): "📌 Bianca, amanhã está marcado: *Mandar currículo*. Se rolar antes, me fala"] ok';
  assert.strictEqual(p(t), null);
});

test('ADVERSARIAL: a fala do usuário DEPOIS da citação continua valendo', () => {
  const t = '[O usuário está RESPONDENDO a esta mensagem anterior: "✅ Agora vai"] e na quinta, o que eu tenho?';
  assert.strictEqual(p(t).de, QUI);
});

test('ADVERSARIAL: "[mensagem 1/2]" é andaime do engine, não data (vazava 01/02 → 2027)', () => {
  assert.strictEqual(p('[mensagem 1/2]\nBarra'), null);
  assert.strictEqual(p('[O usuário enviou 2 mensagens em rápida sequência. Trate como UM contexto único, não responda cada uma separadamente:]\n\n[mensagem 1/2]\nOk\n\n[mensagem 2/2]\nPode confirmar'), null);
});

test('ADVERSARIAL: dd/mm sem ano que já passou NÃO vira chute de ano que vem', () => {
  // "1/2" em agosto é fração/parte, não 1º de fevereiro de 2027. Sem ano explícito e no passado,
  // ou é passado recente (vale) ou não é data (descarta) — nunca um palpite pro ano seguinte.
  assert.strictEqual(p('era 1/2 do total'), null);
  assert.strictEqual(p('dividi 3/4 da conta'), null);
});

test('ADVERSARIAL: dd/mm no passado RECENTE mantém o ano corrente (era jogado pra 2027)', () => {
  assert.strictEqual(p('Festa da Rosa dia 16/08 presencial pessoal').de, '2026-08-16');
});

test('ADVERSARIAL: data explícita inservível não pode matar o resto da frase', () => {
  // "07/08" cai fora da faixa → antes retornava null e engolia o "dia 11" e o "hoje".
  assert.strictEqual(p('Me lembra dia 11 às 13h de colocar que ngm veio dia 07/08').de, '2026-09-11');
  assert.strictEqual(p('tom, você me perguntou do dia... hoje são 24/08').de, QUA);
});

test('vira do mês/ano funciona (31/12 → 01/01)', () => {
  assert.strictEqual(extrairPeriodo('amanhã', '2026-12-31').de, '2027-01-01');
  assert.strictEqual(extrairPeriodo('sexta', '2026-12-31').de, '2027-01-01');
});
