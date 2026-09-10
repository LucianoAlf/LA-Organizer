'use strict';
// PROMISE-NOMARKER-DOWNGRADE (audit 01/07, Reunião Time Gestão ×2) — rodar:
//   node --test src/lib/promise-honesty.test.js
// Buraco: ACTIONABLE_NO_MARKER detecta + auto-retry falha (NO_MARKER), mas a reply visual
// segue intocada ("Não toca na reply visual", Sprint 28.2) → o user recebe a promessa vazia
// do Codex ("Vou criar na agenda e disparar pros 8") como se fosse verdade. O chokepoint não
// pega (gate é verbo de CONCLUSÃO, não promessa futura). Este lib rebaixa: tira a(s) linha(s)
// de promessa (mesma REPLY_PROMISE_RE do engine — uma fonte de verdade) + anexa aviso honesto.
const test = require('node:test');
const assert = require('node:assert');
const { downgradeEmptyPromise, REPLY_PROMISE_RE, PROMISE_NOMARKER_DISCLAIMER } = require('./promise-honesty');

const CODEX_REUNIAO =
  'Beleza, Alf — agora sim: sexta 03/07, 9h, *Reunião Time Gestão*.\n' +
  '\n' +
  '📅 *Reunião Time Gestão*\n' +
  '🗓️ Sexta 03/07 · 9h–10h\n' +
  '📋 Pauta: Atividades e Calendário do Segundo Semestre\n' +
  '\n' +
  'Vou criar na agenda e disparar pros 8 confirmarem presença.';

test('caso real (Codex, 01/07): "Vou criar na agenda e disparar pros 8" → rebaixado', () => {
  const r = downgradeEmptyPromise(CODEX_REUNIAO);
  assert.strictEqual(r.fired, true, 'promessa vazia tem que ser rebaixada');
  assert.ok(!/vou criar na agenda/i.test(r.reply), 'a linha da promessa vazia some');
  assert.match(r.reply, /N[ÃA]O foi executad/i, 'entra o aviso honesto');
  assert.match(r.reply, /Beleza, Alf/, 'linha neutra permanece');
});

test('sem promessa → não age (reply intacto)', () => {
  const s = 'Show! A reunião tá marcada lá pra sexta.';
  const r = downgradeEmptyPromise(s);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reply, s);
});

test('reply 100% promessa vira só o aviso honesto', () => {
  const r = downgradeEmptyPromise('Vou criar a tarefa e te lembro às 9h.');
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /N[ÃA]O foi executad/i);
});

test('CONTROLE: recusa honesta ("não consigo criar por aqui") não dispara', () => {
  const s = 'Não consigo criar isso por aqui — faz pelo app.';
  const r = downgradeEmptyPromise(s);
  assert.strictEqual(r.fired, false, '"criar" bare não é promessa (RE exige "vou criar"/"criando"/"criei")');
});

test('CONTROLE: o próprio disclaimer não re-dispara (idempotente)', () => {
  const once = downgradeEmptyPromise('Vou criar a tarefa agora.');
  const twice = downgradeEmptyPromise(once.reply);
  assert.strictEqual(twice.fired, false, 'rodar 2x não pode duplicar aviso');
});

// CONFAB-INVERSO-OFERTA-CONDICIONAL (Ana Paula, 15/08 22:01 BRT).
// O PREFS_UPDATE dos "domingos silenciosos" executou ok=1 fail=0 às 22:00:58. No turno
// seguinte a Ana só encerrou o assunto ("Caso eu precise eu faço a anotação") e o TOM
// respondeu com uma OFERTA condicional. "registro" casou a REPLY_PROMISE_RE, era a única
// linha, e a resposta inteira virou "essa ação NÃO foi executada" — desmentindo um sucesso.
// Oferta que depende de um pedido FUTURO do user não é promessa deste turno: não há nada
// pra persistir, logo não há vazio a rebaixar.
const ANA_OFERTA = 'Perfeito, Ana! Qualquer coisa que surgir, só manda que eu registro. Bom domingo! ☀️';

test('caso real (Ana, 15/08): oferta condicional não é promessa vazia → não rebaixa', () => {
  const r = downgradeEmptyPromise(ANA_OFERTA);
  assert.strictEqual(r.fired, false, 'oferta condicional não pode ser rebaixada');
  assert.strictEqual(r.reply, ANA_OFERTA, 'reply sai intacta');
});

test('variantes de oferta condicional não disparam', () => {
  for (const s of [
    'Beleza! Se precisar, é só me mandar que eu anoto.',
    'Tranquilo. Quando quiser, me chama que eu registro.',
    'Fechado! Qualquer coisa, só falar que eu adiciono.',
  ]) {
    assert.strictEqual(downgradeEmptyPromise(s).fired, false, s);
  }
});

test('CONTROLE: promessa real + oferta condicional → rebaixa só a promessa', () => {
  const r = downgradeEmptyPromise('Vou criar na agenda pros 8.\nQualquer coisa, só manda que eu registro.');
  assert.strictEqual(r.fired, true, 'a promessa real ainda tem que ser pega');
  assert.ok(!/vou criar na agenda/i.test(r.reply), 'a promessa vazia some');
  assert.match(r.reply, /só manda que eu registro/i, 'a oferta condicional permanece');
});

test('REPLY_PROMISE_RE exportada casa o vocabulário do engine (amostra)', () => {
  for (const s of ['vou criar', 'criando', 'criei', 'reagendei pra sexta', 'marquei para amanhã', 'te lembro às 9h']) {
    assert.ok(REPLY_PROMISE_RE.test(s), s);
  }
});

// PROMISE-DOWNGRADE-COLAPSA-PARAGRAFO (achado bb26cbe6 — Dudu, 27/08 18:51 BRT).
// Literal do banco (marker_logs ACTIONABLE_NO_MARKER 18:51:27, raw_excerpt): o Dudu mandou
// áudio pedindo "guarda isso aí" sobre os cabos XLR e recebeu DUAS notas de erro empilhadas e
// mais NADA — o conteúdo (o que o TOM tinha entendido) sumiu da mensagem entregue.
//
// A raiz não está em nenhum dos dois guards isolados, está no encadeamento. O filtro daqui
// dropava TODA linha em branco, inclusive a que separa o cabeçalho do bloco de bullets. Sem
// esse separador, o `sanitizeOptimisticConfirm` do chokepoint (que roda depois, engine.js
// ~13946, sobre o MESMO reply) lê os bullets como parte do parágrafo da claim e come o bloco
// inteiro. Medido, com e sem a linha em branco: "• Cabos XLR…" vs "" — a diferença é 1 caractere.
const DUDU_CABOS =
  'Entendido, Dudu! Guardando:\n' +
  '\n' +
  '• 🔌 Cabos XLR com defeito + cabo do Vandinho → na sala do Rafinha\n' +
  '• 🔌 Cabo P10 com defeito (encontrado na sala do Rodrigo) → também colocado junto, na sala do Rafinha\n' +
  '\n' +
  'Tá anotado. Continua aí!';

test('caso real (Dudu, 27/08): rebaixar não pode colapsar o parágrafo do conteúdo', () => {
  const r = downgradeEmptyPromise(DUDU_CABOS);
  assert.strictEqual(r.fired, true, 'a promessa vazia ("Tá anotado") tem que ser rebaixada');
  assert.ok(!/tá anotado/i.test(r.reply), 'a linha da promessa vazia some');
  assert.match(r.reply, /Cabos XLR com defeito/, 'o conteúdo entendido permanece');
  assert.match(
    r.reply,
    /Guardando:\n\n• 🔌 Cabos XLR/,
    'a linha em branco ENTRE duas linhas mantidas sobrevive — é ela que impede o chokepoint seguinte de comer os bullets'
  );
});

test('caso real (Dudu, 27/08): a saída rebaixada não é destruída pelo chokepoint seguinte', () => {
  const { sanitizeOptimisticConfirm } = require('./optimistic-confirm');
  const rebaixado = downgradeEmptyPromise(DUDU_CABOS).reply;
  const sobrevive = sanitizeOptimisticConfirm(rebaixado, 'failed');
  assert.match(
    sobrevive,
    /Cabos XLR com defeito/,
    'encadeado com o guard seguinte, o usuário ainda tem que ver o que o TOM entendeu'
  );
});

test('CONTROLE: linha em branco órfã (sobra da promessa removida) continua colapsando', () => {
  const r = downgradeEmptyPromise('Beleza, Alf!\n\nVou criar na agenda pros 8.');
  assert.strictEqual(r.fired, true);
  assert.ok(!/\n\n\n/.test(r.reply), 'não sobra buraco triplo onde a promessa foi removida');
  assert.match(r.reply, /^Beleza, Alf!\n\n_⚠️/, 'a nota honesta encosta direto na linha neutra');
});

// PROMISE-DOWNGRADE-REBAIXA-ADMISSAO (achados ab345c8f / ac7517b8).
// O engine já sabe desde 01/06 que RECUSA não é promessa: `_replyIsDecline` (engine.js ~13543)
// zera `replyHasPromise` quando a reply nega o verbo. Mas aquele flag só governa a MÉTRICA —
// o strip aqui re-testa a RE crua, não enxerga a negação, e apaga a linha assim mesmo. Como
// nesses casos a admissão é a ÚNICA linha, o usuário recebe só o disclaimer genérico: uma
// troca ESTRITAMENTE PIOR, porque a mensagem original já era honesta E trazia os detalhes.
//
// Literais do banco (marker_logs ACTIONABLE_NO_MARKER, raw_excerpt), medidos contra o
// conversation_history: nos dois turnos o outbound entregue foi só o disclaimer.
const RAFINHA_ADMISSAO =
  'Vacilei aqui — não consegui registrar essa mudança de horário do Dudu agora. ' +
  'Me repete: hoje fechamento às 18h30, e toda terça e quinta também às 18h30 — é isso? ' +
  'Me confirma de novo que eu ajusto já.';

test('caso real (Rafinha, 27/08 11:09): admissão de falha não pode ser rebaixada', () => {
  const r = downgradeEmptyPromise(RAFINHA_ADMISSAO);
  assert.strictEqual(r.fired, false, 'quem já admitiu que NÃO registrou não está prometendo nada');
  assert.strictEqual(r.reply, RAFINHA_ADMISSAO, 'a reply sai intacta');
  assert.match(r.reply, /18h30/, 'o horário que o usuário precisa confirmar permanece');
  assert.match(r.reply, /é isso\?/i, 'a re-pergunta permanece — sem ela o fluxo morre');
});

test('variantes de admissão de falha não disparam', () => {
  for (const s of [
    'Pô, tive um problema aqui e não consegui registrar. Pode repetir o pedido?',
    'Não deu pra anotar isso agora — me manda de novo?',
    'Não rolou criar a tarefa aqui, tenta de novo?',
    'Não tenho como registrar isso por aqui.',
  ]) {
    assert.strictEqual(downgradeEmptyPromise(s).fired, false, s);
  }
});

test('CONTROLE: negação de UMA ação não blinda a claim de OUTRA na mesma linha', () => {
  // "não consegui criar o evento" é admissão, mas "já registrei a tarefa" é afirmação de
  // persistência — e nada persistiu. A exceção é por OCORRÊNCIA do verbo, não por linha:
  // blindar a linha inteira aqui deixaria passar exatamente a mentira que o guard existe
  // pra pegar.
  const r = downgradeEmptyPromise('Não consegui criar o evento, mas já registrei a tarefa.');
  assert.strictEqual(r.fired, true, 'a claim não-negada ainda tem que ser pega');
});

// Vizinhos do fix de 31/08 (Alf, rodada 31/08): a exceção cobria só a negação do verbo de
// CAPACIDADE no passado. A mesma admissão honesta, negada pelo próprio verbo ("não registrei")
// ou no futuro ("não vou conseguir registrar"), continuava sendo apagada — a uma palavra de
// distância do caso Rafinha.
test('admissão negando o PRÓPRIO verbo não dispara', () => {
  for (const s of [
    'não registrei ainda porque o sistema recusou',
    'não anotei isso, deu erro aqui',
    'Não criei o evento — o app devolveu erro.',
    'Ainda não adicionei na lista, deu pau aqui.',
  ]) {
    assert.strictEqual(downgradeEmptyPromise(s).fired, false, s);
  }
});

test('admissão de incapacidade FUTURA não dispara', () => {
  for (const s of [
    'não vou conseguir registrar agora',
    'Não vou conseguir anotar isso hoje, me cobra amanhã.',
    'Não vou dar conta de criar tudo isso agora.',
    'Não vou poder registrar por aqui.',
  ]) {
    assert.strictEqual(downgradeEmptyPromise(s).fired, false, s);
  }
});

test('CONTROLE: negar o verbo não blinda a claim seguinte na mesma linha', () => {
  // O par do controle de sempre, agora pelo lado da negação direta: quem escapa da exceção é
  // o verbo que tem "já" na frente, não "não".
  const r = downgradeEmptyPromise('Não registrei o horário, mas já criei a tarefa do Dudu.');
  assert.strictEqual(r.fired, true, 'a claim não-negada ainda tem que ser pega');
});

test('CONTROLE: admitir agora e prometer depois continua caindo', () => {
  const r = downgradeEmptyPromise('Não registrei ainda, mas vou registrar assim que voltar.');
  assert.strictEqual(r.fired, true, 'a promessa futura é vazia e tem que cair');
});

test('CONTROLE: promessa real continua sendo rebaixada mesmo com negação em outra frase', () => {
  const r = downgradeEmptyPromise('Não consigo mexer no app. Vou criar na agenda pros 8 confirmarem.');
  assert.strictEqual(r.fired, true, 'a promessa da 2ª frase é vazia e tem que cair');
  assert.ok(!/vou criar na agenda/i.test(r.reply), 'a promessa vazia some');
});

// ── Oferta sem "que" (caso real 24/08, medido no corpus de 25 disparos) ──────
// "manda pra mim — eu leio e registro os itens" é oferta CONDICIONAL a um ato futuro
// do usuário, igual a "só manda que eu registro". Faltavam DUAS coisas na RE: o gatilho
// "manda pra mim" (só havia "me manda") e o consequente ligado por travessão em vez de
// "que". Resultado: a resposta inteira — que já era honesta, começando com "Não consigo" —
// virou só o aviso de erro. 1 dos 3 disparos recentes com evidência viva.
test('caso real (24/08): "manda pra mim — eu leio e registro" não é promessa vazia', () => {
  const t = 'Não consigo jogar o arquivo direto no app, mas manda pra mim — eu leio e registro os itens um por um pelo sistema. Pode ser foto, PDF, planilha, o que tiver.';
  assert.strictEqual(downgradeEmptyPromise(t).fired, false);
});
test('variantes de oferta ligada por travessão/vírgula não disparam', () => {
  for (const t of [
    'manda pra mim — eu registro tudo aqui',
    'me manda, eu anoto na hora',
    'qualquer coisa — eu registro depois',
  ]) assert.strictEqual(downgradeEmptyPromise(t).fired, false, t);
});
// CONTRA-EXEMPLO que o comentário da RE já avisava: relaxar o "que eu" não pode deixar
// uma promessa REAL escapar pelo "qualquer coisa".
test('CONTROLE: promessa real com "qualquer coisa" continua rebaixando', () => {
  const t = 'Vou criar a tarefa e qualquer coisa te aviso às 15h.';
  assert.strictEqual(downgradeEmptyPromise(t).fired, true);
});
test('CONTROLE: "eu" longe do gatilho não vira oferta', () => {
  const t = 'Registrei o pedido. Amanhã eu passo na loja.';
  assert.strictEqual(downgradeEmptyPromise(t).fired, true);
});

// ---------------------------------------------------------------------------
// PROMISE-STRIP-POR-LINHA-COME-A-FRASE-BOA (Ana, 04/09/2026 19:46:21 BRT, finding bb3cbd5d)
//
// Ela respondeu "Ok" por reply-quote a uma NOTIFICAÇÃO de reagendamento (nada foi pedido) e
// o TOM devolveu "Beleza, anotado! A Mayra segue com isso pra amanhã." — a 2ª frase é
// verdadeira e é o conteúdo todo da mensagem. O strip é por LINHA: as duas frases moram na
// mesma linha, "anotado" casa a RE, e a linha inteira morre. O que chegou no WhatsApp foi
// só o disclaimer de erro — mesma classe do caso Dudu 27/08 ("sumiu conteúdo que não era
// mentira"), agora dentro de uma linha só.
//
// O módulo já raciocina em FRASE no veto (OFERTA_CONDICIONAL_RE usa `[^.!?]*` justamente
// pra não atravessar fim de frase) e mesmo assim apaga por linha. É essa assimetria.
const ANA_REPLY = 'Beleza, anotado! A Mayra segue com isso pra amanhã.';

test('strip remove a frase da promessa e preserva a frase verdadeira (caso Ana 04/09)', () => {
  const r = downgradeEmptyPromise(ANA_REPLY);
  assert.strictEqual(r.fired, true, 'a promessa vazia segue sendo rebaixada');
  assert.match(r.reply, /A Mayra segue com isso pra amanh[ãa]\./, 'o conteúdo verdadeiro sobrevive');
  assert.doesNotMatch(r.reply, /anotado/i, 'a frase da promessa sai');
  assert.match(r.reply, /NÃO foi executada/, 'o aviso honesto continua anexado');
});

test('frase única com promessa segue sendo apagada inteira (controle Arthur 04/08)', () => {
  // "Isso" → "✅ Tá registrado, Arthur — te lembro amanhã às 10h de passar o Levy pra BIA na
  // quinta." Promessa vazia REAL: uma frase só, claim e lembrete juntos. Tem que continuar
  // virando só o disclaimer — senão o fix da Ana abriria a porta que o guard existe pra fechar.
  const r = downgradeEmptyPromise('✅ Tá registrado, Arthur — te lembro amanhã às 10h de passar o Levy pra BIA na quinta.');
  assert.strictEqual(r.fired, true);
  assert.doesNotMatch(r.reply, /registrado/i);
  assert.doesNotMatch(r.reply, /Levy/);
});

test('frase sem promessa na mesma linha de outra COM promessa não é arrastada', () => {
  const r = downgradeEmptyPromise('Registrei aqui. O ensaio é às 20h no Recreio.');
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /O ensaio é às 20h no Recreio\./);
  assert.doesNotMatch(r.reply, /Registrei/);
});

test('linha sem fim de frase continua caindo inteira', () => {
  const r = downgradeEmptyPromise('Registrei o pedido do Dudu');
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.reply, PROMISE_NOMARKER_DISCLAIMER);
});

// PROMISE-NOMARKER-CEGO-PRA-ESCRITA-RECENTE (Rafinha 08/09 11:11:09 BRT).
// Literal do raw_excerpt do CHOKEPOINT. Às 11:06:45 o TASK_UPDATE gravou 3 tarefas
// (ok=3 fail=0), entre elas "Buscar os filhos no Marvin" e "Pegar a tinta no Monteiro".
// 4min19s depois o TOM REAFIRMA o que já escreveu ("no áudio anterior eu registrei…")
// pra PERGUNTAR se era correção — e o `registrei` casa a REPLY_PROMISE_RE.
// A porta A (downgradeEmptyPromise) roda ANTES do enforceNoMarkerHonesty e não tem
// nenhum dos vetos dele: apagou a frase VERDADEIRA e colou "essa ação NÃO foi executada".
// O mecanismo que separa reafirmação de promessa já existe desde 19/08
// (restatesRecentWrite, CHOKEPOINT-NEGA-ESCRITA-RECENTE) — só não estava ligado aqui.
const RAFINHA_REAFIRMA =
  'Entendido essa parte, Rafinha.\n' +
  '\n' +
  'No áudio anterior eu registrei "*filhos* no Marvin" (pessoal), mas agora você falou ' +
  '"*fios, fios, fios*" bem marcado. É correção — eram os fios mesmo, não buscar as crianças?\n' +
  '\n' +
  'A tinta no Monteiro tá igual: aguardando a Rose. Pode continuar.';

test('reafirmação de escrita recente não é rebaixada (caso Rafinha 08/09)', () => {
  const r = downgradeEmptyPromise(RAFINHA_REAFIRMA, { restatesRecentWrite: true });
  assert.strictEqual(r.fired, false, 'não é promessa vazia: as tarefas foram gravadas 4min antes');
  assert.strictEqual(r.reply, RAFINHA_REAFIRMA, 'a pergunta e a frase verdadeira ficam intactas');
});

test('sem o sinal de escrita recente o rebaixamento segue igual (controle Rafinha)', () => {
  const r = downgradeEmptyPromise(RAFINHA_REAFIRMA);
  assert.strictEqual(r.fired, true, 'opt ausente ⇒ comportamento antigo, zero regressão');
  assert.doesNotMatch(r.reply, /eu registrei/i);
});

test('promessa vazia REAL não é salva pelo sinal de escrita recente', () => {
  // Controle do lado perigoso: o veto não pode virar carimbo. Aqui não há reafirmação —
  // é claim + lembrete futuro numa frase só (mesmo texto do controle Arthur 04/08).
  const r = downgradeEmptyPromise(
    '✅ Tá registrado, Arthur — te lembro amanhã às 10h de passar o Levy pra BIA na quinta.',
    { restatesRecentWrite: false },
  );
  assert.strictEqual(r.fired, true);
  assert.doesNotMatch(r.reply, /registrado/i);
});

// ---------------------------------------------------------------------------
// LISTAGEM-REBAIXADA-COMO-PROMESSA (medido 09/09/2026, corpus limpo de 32 disparos).
//
// Quando o TOM APRESENTA o que existe, ele nao promete nada — mas os ITENS carregam o
// vocabulario da RE (um pendente chamado "Perguntar orcamento", outro com "registrar" no
// titulo) e a linha do bullet casava como compromisso do turno.
//
// Dos 10 disparos desta porta no corpus limpo, QUATRO sao listagem. Dois deles sao o caso do
// Yuri em 08/09, que apareceu no relatorio de governanca da manha seguinte.
// ---------------------------------------------------------------------------
test('listar nao e prometer — o caso do Yuri (08/09)', () => {
  const listagem = [
    'Yuri, o que tenho no contexto aqui pra setembro:',
    '',
    '📋 *Com prazo em setembro:*',
    '• 🔴 *Perguntar orçamento da fonte* — era 03/09 (5d de atraso)',
    '• *Postar feed do Evolução* — 12/09',
  ].join('\n');
  const out = downgradeEmptyPromise(listagem);
  assert.strictEqual(out.fired, false, 'apresentar o que existe nao e prometer agir');
  assert.strictEqual(out.reply, listagem, 'a lista tem que sair intacta');
});

test('o outro caso real: pauta da semana com bullets', () => {
  const pauta = [
    'Bora! Aqui o que tá na mesa pra essa semana:',
    '',
    '📋 *Pendências arrastadas:*',
    '• 🔴 *Registrar contrato do Théo* — 04/09',
  ].join('\n');
  assert.strictEqual(downgradeEmptyPromise(pauta).fired, false);
});

test('promessa FORA da lista continua caindo — o veto e por LINHA', () => {
  // Vetar o texto inteiro por causa de um bullet abriria a porta pra mentira embalada em lista.
  const misto = [
    'Aqui o que tem hoje:',
    '• *Comprar cabo* — 10/09',
    'Vou criar na agenda e disparar pros 8 confirmarem.',
  ].join('\n');
  const out = downgradeEmptyPromise(misto);
  assert.strictEqual(out.fired, true, 'a promessa da ultima linha tem que ser rebaixada');
  assert.match(out.reply, /Aqui o que tem hoje/, 'o cabecalho da lista fica');
  assert.match(out.reply, /Comprar cabo/, 'o item da lista fica');
  assert.doesNotMatch(out.reply, /disparar pros 8/, 'a promessa sai');
});

test('varias formas de bullet — a fala do TOM nao usa uma so', () => {
  const { LINHA_DE_LISTA_RE } = require('./promise-honesty');
  for (const l of ['• item', '- item', '* item', '1. item', '2) item', '  • recuado', '▪ item']) {
    assert.ok(LINHA_DE_LISTA_RE.test(l), `deveria reconhecer: ${JSON.stringify(l)}`);
  }
  for (const l of ['Vou criar a tarefa', 'Registrei o pedido', '']) {
    assert.ok(!LINHA_DE_LISTA_RE.test(l), `NAO e lista: ${JSON.stringify(l)}`);
  }
});
