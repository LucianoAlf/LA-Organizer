'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeOptimisticConfirm, hasOptimisticConfirm, hasCompletionClaim, hasWeakCompletionClaim, enforceNoMarkerHonesty, isProgressStatusReply } = require('./optimistic-confirm');

// ─────────────────────────────────────────────────────────────────────────
// outcome = 'failed' (nada persistiu): rebaixa/remove TODA confirmação otimista
// ─────────────────────────────────────────────────────────────────────────

test('failed: "✅ Criado!" sozinho vira vazio (caso Fefê)', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('✅ Criado!', 'failed'), '');
});

// GROUPTASK-MOVE-TO-GROUP-CONFAB (caso Rose 26/07): claim de MOVIMENTAÇÃO escapava.
// O COMPLETION_CORE tem "movi/movido" mas exige o verbo NO INÍCIO da linha — a frase
// real veio com o verbo no meio e em gerúndio ("Beleza, movendo as 3 pro grupo!"), e o
// ESTADO RESULTANTE ("Agora estão no *Financeiro*") não tem verbo de conclusão nenhum.
// Resultado: marker rejeitado, aviso anexado embaixo, e a mentira sobreviveu acima dele.
test('failed: claim de movimentação some — "movendo as 3 pro grupo" (caso Rose 26/07)', () => {
  const real = 'Beleza, movendo as 3 pro grupo!\n\nAgora estão no *Financeiro* — qualquer membro do grupo pode concluir.';
  const out = sanitizeOptimisticConfirm(real, 'failed');
  assert.ok(!/movendo/i.test(out), 'a promessa "movendo" não pode sobreviver');
  assert.ok(!/Agora est[ãa]o\s+no/i.test(out), 'o estado resultante não pode sobreviver');
});

// FORMA-CONECTIVO (regressão detectada pela auditoria 29/07, caso Valcílio): o verbo
// ESTÁ no vocabulário ("criei"), mas a linha começa com conectivo ("E criei a visita...").
// O COMPLETION_ANCHORED só tolerava markup/emoji antes do verbo — uma conjunção derrubava
// o gate inteiro e a afirmação sobreviveu ACIMA do aviso "não consegui registrar agora".
test('failed: conectivo antes do verbo não salva a mentira — "E criei a visita" (Valcílio 28/07)', () => {
  const real = 'E criei a visita do Valcílio também:\n📅 *Visita Valcílio — ar condicionado*\n\n_não consegui registrar agora. Me passa de novo?_';
  const out = sanitizeOptimisticConfirm(real, 'failed');
  assert.ok(!/criei a visita/i.test(out), 'a afirmação "E criei" não pode sobreviver');
});

// TOM-AFIRMA-DEPOIS-DESMENTE (Rose 06/08 e Krissya 05/08) — dois buracos de FORMA que
// sobraram depois do fix do Valcílio. Nos dois a mensagem que chegou no WhatsApp foi a
// afirmação EM CIMA e o desmentido EMBAIXO, no mesmo texto:
//   "Entendido — Gabi entregou a lista. Fechando a tarefa dela.\n\n_não consegui registrar_"
//   "Fechou, reagendei pra amanhã.\n\n_não consegui registrar_"
// A pessoa lê as duas frases e não sabe em qual acreditar.
test('failed: GERÚNDIO de conclusão não sobrevive — "Fechando a tarefa dela" (Rose 06/08)', () => {
  const real = 'Entendido — Gabi entregou a lista. Fechando a tarefa dela.';
  const out = sanitizeOptimisticConfirm(real, 'failed');
  assert.ok(!/fechando/i.test(out), 'o gerúndio "Fechando" não pode sobreviver');
});

test('failed: 1ª pessoa no MEIO da linha não sobrevive — "Fechou, reagendei" (Krissya 05/08)', () => {
  const real = 'Fechou, reagendei pra amanhã.';
  const out = sanitizeOptimisticConfirm(real, 'failed');
  assert.ok(!/reagendei/i.test(out), 'a afirmação "reagendei" não pode sobreviver');
});

test('failed: mais formas das duas famílias', () => {
  for (const s of ['Fechando as duas.', 'Show, criei aqui pra você.',
                   'Beleza — já marquei tudo então.', 'Agendando pra sexta.']) {
    assert.strictEqual(sanitizeOptimisticConfirm(s, 'failed'), '', `"${s}" deveria sumir`);
  }
});

// O texto HONESTO e as perguntas legítimas têm que sobreviver — se o sanitizador comer a
// nota de erro ou a pergunta, o TOM fica mudo (foi o que houve no caso Alf 01/08, quando o
// guard substituiu a resposta inteira pela nota de erro).
test('ANTI falso-positivo: nota honesta, negação e pergunta sobrevivem', () => {
  const preservar = [
    '_não consegui registrar agora. Me passa de novo?_',
    'Não reagendei nada ainda.',
    'Ainda não fechei essa.',
    'Quer que eu vá fechando as pendências?',
    'Comprar enfeite já tava marcado',
    'Quando você quiser, eu crio a tarefa.',
  ];
  for (const s of preservar) {
    assert.strictEqual(sanitizeOptimisticConfirm(s, 'failed'), s, `"${s}" tem que sobreviver`);
  }
});

test('failed: outros conectivos comuns também são cobertos', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Já registrei aqui!', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm('Também agendei pra sexta.', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm('Pronto, criei a tarefa.', 'failed'), '');
});

test('failed: ANTI falso-positivo — verbo no meio de palavra ou de outra frase sobrevive', () => {
  const s1 = 'Recriado o vínculo? Me confirma.';
  assert.strictEqual(sanitizeOptimisticConfirm(s1, 'failed'), s1);
  const s2 = 'Quando você quiser, eu crio a tarefa.';
  assert.strictEqual(sanitizeOptimisticConfirm(s2, 'failed'), s2);
});

// CHOKEPOINT-PROGRESS-FALSEFIRE (caso Alf 01/08): a cobrança das 13h perguntou "Resolve hoje
// ou reagenda?", o Alf respondeu "To fazendo, Tom" (PROGRESSO — não pede ação nenhuma), o TOM
// respondeu com cordialidade e o guard SUBSTITUIU a resposta inteira pela nota de erro. O que
// chegou no WhatsApp foi só "_⚠️ Na real não consegui registrar isso agora_". O guard assumiu
// que "nada persistiu" = "deveria ter persistido" — mas não havia o que persistir.
test('progresso do usuário ("tô fazendo") NÃO dispara a camada fraca (caso Alf 01/08)', () => {
  const r = enforceNoMarkerHonesty('Beleza, Alf! Fico no aguardo então.', {
    nothingPersisted: true, pendingActionRecent: true, userProgressStatus: true,
  });
  assert.strictEqual(r, 'Beleza, Alf! Fico no aguardo então.', 'resposta tem que sobreviver intacta');
});

test('NÃO-REGRESSÃO: sem progresso, a camada fraca segue disparando (caso Matheus)', () => {
  const r = enforceNoMarkerHonesty('Fechou!', { nothingPersisted: true, pendingActionRecent: true });
  assert.ok(/não consegui registrar/i.test(r), 'o NOOP do "Fechou" tem que continuar pego');
});

test('NÃO-REGRESSÃO: claim FORTE dispara mesmo com progresso do usuário', () => {
  const r = enforceNoMarkerHonesty('Concluí a tarefa!', {
    nothingPersisted: true, userProgressStatus: true,
  });
  assert.ok(/não consegui registrar/i.test(r), 'afirmar conclusão sem persistir é mentira, progresso ou não');
});

test('isProgressStatusReply: reconhece progresso e ignora conclusão/pedido', () => {
  assert.strictEqual(isProgressStatusReply('To fazendo, Tom'), true);
  assert.strictEqual(isProgressStatusReply('tô vendo isso agora'), true);
  assert.strictEqual(isProgressStatusReply('vou fazer hoje'), true);
  assert.strictEqual(isProgressStatusReply('já fiz'), false);            // conclusão
  assert.strictEqual(isProgressStatusReply('tô fazendo, marca como concluída'), false); // pede ação
  assert.strictEqual(isProgressStatusReply('reagenda pra amanhã'), false);
});

test('failed: "Transferi pro grupo" também some', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Transferi pro grupo Financeiro.', 'failed'), '');
});

test('failed: PERGUNTA "quer que eu mova pro grupo?" NÃO é claim (sobrevive)', () => {
  const q = 'Quer que eu mova pro grupo *Financeiro* pra qualquer membro poder concluir?';
  assert.strictEqual(sanitizeOptimisticConfirm(q, 'failed'), q);
});

test('failed: estado PRÉ-EXISTENTE sem "agora" sobrevive (anti falso-positivo)', () => {
  const s = 'A tarefa está no grupo Financeiro desde ontem.';
  assert.strictEqual(sanitizeOptimisticConfirm(s, 'failed'), s);
});

test('failed: linha com emoji no meio é removida, pergunta preservada', () => {
  const out = sanitizeOptimisticConfirm('Boa! ✅ Criado!\n\nQuer que eu te lembre depois?', 'failed');
  assert.strictEqual(out, 'Quer que eu te lembre depois?');
});

test('failed: "✅ *Título*" é removido, ack em presente preservado (caso Juliana)', () => {
  const input = 'Beleza, crio separado.\n\n✅ *Conversar com a Dai sobre o evento LA Love Songs* — prazo terça (16/06).';
  assert.strictEqual(sanitizeOptimisticConfirm(input, 'failed'), 'Beleza, crio separado.');
});

test('failed: verbos de conclusão em 1a pessoa são removidos', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Criei a tarefa pra você.', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm('Reagendei pra amanhã.', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm('Fechei todas as pendências.', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm('Anotado: comprar pão.', 'failed'), '');
});

test('failed: NÃO remove presente/futuro (intenção, não conclusão)', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Vou criar isso já já.', 'failed'), 'Vou criar isso já já.');
  assert.strictEqual(sanitizeOptimisticConfirm('Crio agora pra você?', 'failed'), 'Crio agora pra você?');
});

test('failed: preserva texto neutro / perguntas', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Qual horário você prefere?', 'failed'), 'Qual horário você prefere?');
});

test('failed: "✅ Os dois fechados." é removido (bonus EVENT_UPDATE)', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('✅ Os dois fechados.', 'failed'), '');
});

// NOTE-ACTION-CONFAB-NOPROSE (25/06) — os 3 ramos de falha do NOTE_ACTION
// (malformed / dup-skip / res.ok=false) passam o cleanText por sanitize('failed').
// Ancora o caso real do Alf (24/06): NOTE schema_invalid não pode sair com "Anotado!".
// EXPECTATIVA ALTERADA EM 08/08, DE PROPÓSITO — antes este teste exigia que o gerúndio
// SOBREVIVESSE ("Salvando nas suas anotações"), pela premissa da época de que gerúndio é
// intenção, não conclusão. Essa premissa já tinha sido derrubada em 27/07 pelo MOVE_CLAIM_RE,
// com a razão certa: este sanitizador SÓ roda quando o engine já sabe que nada persistiu, e
// aí "estou salvando" é tão falso quanto "salvei" — nada está sendo salvo. O caso Rose 06/08
// ("Fechando a tarefa dela." + "_não consegui registrar_" na mesma mensagem) provou em
// produção. O que o teste ancorava de essencial — "Anotado!" não pode sobreviver — segue
// valendo; o que mudou é que a promessa em gerúndio também não sobrevive.
test('failed: caso NOTE Alf — "Anotado!" E o gerúndio somem (nada foi salvo)', () => {
  const cleanText = 'Claro, Alf! Salvando nas suas anotações.\n\nAnotado! Agora me conta o resto.';
  const out = sanitizeOptimisticConfirm(cleanText, 'failed');
  assert.ok(!/Anotado!/.test(out), 'não pode sobrar "Anotado!"');
  assert.ok(!/Salvando/i.test(out), 'a promessa em gerúndio também é falsa aqui');
  assert.strictEqual(out, '');
});

test('failed: NOTE dup-skip — linha única toda otimista vira vazio', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('Claro! Anotado! ✅', 'failed'), '');
});

// ─────────────────────────────────────────────────────────────────────────
// outcome = 'partial' (parte persistiu): rebaixa totalizador absoluto
// ─────────────────────────────────────────────────────────────────────────

test('partial: "fechei todas as pendências" → "a maioria das" (caso Anne)', () => {
  assert.strictEqual(
    sanitizeOptimisticConfirm('fechei todas as pendências', 'partial'),
    'fechei a maioria das pendências',
  );
});

test('partial: emoji removido + totalizador rebaixado', () => {
  assert.strictEqual(
    sanitizeOptimisticConfirm('✅ Fechei todas as pendências!', 'partial'),
    'Fechei a maioria das pendências!',
  );
});

test('partial: "tudo" → "a maior parte"', () => {
  assert.strictEqual(
    sanitizeOptimisticConfirm('Marquei tudo como feito.', 'partial'),
    'Marquei a maior parte como feito.',
  );
});

test('partial: confirmação pura sem totalizador é removida', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('✅ Criado!', 'partial'), '');
});

test('partial: preserva capitalização do totalizador no início', () => {
  assert.strictEqual(
    sanitizeOptimisticConfirm('Todos os itens registrados.', 'partial'),
    'A maioria dos itens registrados.',
  );
});

// ─────────────────────────────────────────────────────────────────────────
// hasOptimisticConfirm
// ─────────────────────────────────────────────────────────────────────────

test('hasOptimisticConfirm: detecta ✅ e verbos de conclusão', () => {
  assert.strictEqual(hasOptimisticConfirm('✅ Criado!'), true);
  assert.strictEqual(hasOptimisticConfirm('Fechei tudo!'), true);
  assert.strictEqual(hasOptimisticConfirm('Reagendei pra amanhã.'), true);
});

test('hasOptimisticConfirm: false em ack/pergunta/presente', () => {
  assert.strictEqual(hasOptimisticConfirm('Beleza, crio separado.'), false);
  assert.strictEqual(hasOptimisticConfirm('Qual horário?'), false);
  assert.strictEqual(hasOptimisticConfirm('Vou criar isso já já.'), false);
});

// ─────────────────────────────────────────────────────────────────────────
// robustez
// ─────────────────────────────────────────────────────────────────────────

test('entrada vazia/nula', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('', 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm(null, 'failed'), '');
  assert.strictEqual(sanitizeOptimisticConfirm(undefined, 'partial'), '');
});

test('outcome desconhecido = não mexe', () => {
  assert.strictEqual(sanitizeOptimisticConfirm('✅ Criado!', 'ok'), '✅ Criado!');
});

// ---------------------------------------------------------------------------
// AUDIT 16/07 (confab-noop sweep) — o backstop tinha buracos nas frases CANÔNICAS
// que as próprias skills mandam o TOM dizer: "Delegado pro X", "Excluí o hábito",
// "Comunicado despachado ✓" passavam inteiras (nenhum verbo no COMPLETION_CORE).
// Superfícies afetadas: delegate/cancel de tarefa, HABIT delete, ANNOUNCEMENT.
// ---------------------------------------------------------------------------

test('AUDIT-16/07: "Delegado pro Arthur!" é claim (skill de delegação)', () => {
  assert.strictEqual(hasCompletionClaim('Delegado pro Arthur!'), true);
});
test('AUDIT-16/07: "Deleguei pro Rafinha." é claim', () => {
  assert.strictEqual(hasCompletionClaim('Deleguei pro Rafinha.'), true);
});
test('AUDIT-16/07: "Excluí o *Ler*." é claim (habit delete)', () => {
  assert.strictEqual(hasCompletionClaim('Excluí o *Ler*.'), true);
});
test('AUDIT-16/07: "Apaguei o hábito *Ler*." é claim', () => {
  assert.strictEqual(hasCompletionClaim('Apaguei o hábito *Ler*.'), true);
});
test('AUDIT-16/07: "Avisei o Rafinha sobre a sala." é claim', () => {
  assert.strictEqual(hasCompletionClaim('Avisei o Rafinha sobre a sala.'), true);
});
test('AUDIT-16/07: "Comunicado despachado. ✓" é claim (✓ U+2713 + verbo)', () => {
  assert.strictEqual(hasCompletionClaim('Comunicado despachado. ✓'), true);
});
test('AUDIT-16/07: "Despachei o comunicado pra coordenação." é claim', () => {
  assert.strictEqual(hasCompletionClaim('Despachei o comunicado pra coordenação.'), true);
});

// --- ANTI-FALSO-FIRE: o custo de errar aqui é colar "não consegui registrar" numa
// mensagem legítima (ver SENDHONESTY-FALSEFIRE-FINANCE, Rose 14/07). Futuro/intenção
// e relato de terceiro NUNCA podem virar claim.
test('AUDIT-16/07 anti-FP: futuro "Vou delegar pro Arthur" NÃO é claim', () => {
  assert.strictEqual(hasCompletionClaim('Vou delegar pro Arthur.'), false);
});
test('AUDIT-16/07 anti-FP: "te aviso depois" NÃO é claim', () => {
  assert.strictEqual(hasCompletionClaim('Beleza, te aviso depois.'), false);
});
test('AUDIT-16/07 anti-FP: "Vou excluir?" (pergunta) NÃO é claim', () => {
  assert.strictEqual(hasCompletionClaim('Quer que eu exclua o hábito Ler?'), false);
});
test('AUDIT-16/07 anti-FP: ✓ decorativo em lista SEM verbo NÃO é claim', () => {
  assert.strictEqual(hasCompletionClaim('• Reunião com Juliana ✓\n• Panorama do Matheus ✓'), false);
});
test('AUDIT-16/07 anti-FP: "enviado" segue FORA do core (falso-fire financeiro histórico)', () => {
  assert.strictEqual(hasCompletionClaim('O boleto foi enviado pelo banco.'), false);
});
test('AUDIT-16/07 anti-FP: menção a estado alheio no meio da linha NÃO é claim', () => {
  assert.strictEqual(hasCompletionClaim('A tarefa do Rafinha já tava delegada antes.'), false);
});

// AUDIT 16/07 — BUG PRÉ-EXISTENTE: `\b` do JS é ASCII, então verbo terminado em vogal
// ACENTUADA ("Concluí", "Excluí") nunca casava o gate → a claim mais óbvia de todas
// ("Concluí a tarefa") escapava do chokepoint desde sempre. Mesma classe do
// CONFIRM-SHORTYES-TA-ACCENT-BOUNDARY (audit 28/06). Fix: lookahead unicode (?![\p{L}]).
test('AUDIT-16/07 acento: "Concluí a tarefa." é claim (\b ASCII quebrava)', () => {
  assert.strictEqual(hasCompletionClaim('Concluí a tarefa.'), true);
});
test('AUDIT-16/07 acento: "Concluí." é claim', () => {
  assert.strictEqual(hasCompletionClaim('Concluí.'), true);
});
test('AUDIT-16/07 acento: "Concluído!" segue claim (não regride)', () => {
  assert.strictEqual(hasCompletionClaim('Concluído!'), true);
});
test('AUDIT-16/07 acento anti-FP: "Concluímos?" (pergunta) NÃO é claim', () => {
  assert.strictEqual(hasCompletionClaim('Concluímos isso ontem?'), false);
});
test('AUDIT-16/07 acento anti-FP: verbo no MEIO de palavra não casa', () => {
  assert.strictEqual(hasCompletionClaim('Recriado do zero pelo time.'), false);
});

// CONFAB-GERUNDIO-CHOKEPOINT (Rose 09/08 00:30 BRT) — o fix de 08/08 pôs o gerúndio no
// _isOptimisticLine (sanitizador), mas DEIXOU FORA do _isCompletionClaimLine (chokepoint).
// O sanitizador só roda quando ALGUM marker falhou; aqui não houve marker NENHUM, então o
// único gate no caminho era o chokepoint — e ele não via gerúndio. A fala saiu inteira e a
// Rose leu como feito ("A do Nubank vc havia dito que tinha lançado").
test('GERUNDIO-CHOKEPOINT: "lançando todas as 14 parcelas" é claim (Rose 09/08)', () => {
  const real = 'Beleza, Rose — lançando todas as 14 parcelas!\n\n📅 Nubank · vence 14/08 · R$ 593,32. Pode editar as categorias depois pelo app. 👍';
  assert.strictEqual(hasCompletionClaim(real), true);
});
test('GERUNDIO-CHOKEPOINT: sem marker nenhum, a promessa não sobrevive (Rose 09/08)', () => {
  const real = 'Beleza, Rose — lançando todas as 14 parcelas!\n\n📅 Nubank · vence 14/08 · R$ 593,32. Pode editar as categorias depois pelo app. 👍';
  const out = enforceNoMarkerHonesty(real, { nothingPersisted: true, infoGathering: false, awaitingConfirm: false }, { meta: true });
  assert.strictEqual(out.fired, true);
  assert.ok(!/lan[çc]ando/i.test(out.reply), 'a promessa "lançando" não pode sobreviver');
  assert.ok(/n[ãa]o consegui registrar/i.test(out.reply), 'a nota honesta precisa estar lá');
});
test('GERUNDIO-CHOKEPOINT anti-FP: pergunta com gerúndio NÃO é claim', () => {
  assert.strictEqual(hasCompletionClaim('Quer que eu vá fechando as pendências?'), false);
});
test('GERUNDIO-CHOKEPOINT anti-FP: gerúndio negado NÃO é claim', () => {
  assert.strictEqual(hasCompletionClaim('Não estou lançando nada ainda.'), false);
});

// ── HABIT-UPDATE-SILENT-LIE (Bianca 09/08 08:30) — DUAS portas na mesma fala ────────────────
// Ela pediu por áudio: "tira o lembrete de tomar os remédios às 6h". O LLM emitiu
// {"action":"update"} — ação que não existe no engine nem na skill — o parser rejeitou com
// schema_invalid, e ela recebeu: "✅ Lembrete das 6h removido." O lembrete continua tocando.
//
// O chokepoint tinha o sinal certo (nothingPersisted) e ainda assim não disparou, por DUAS
// razões independentes — fechar só uma deixaria o caso passando igual:
//   1) VOCABULÁRIO: "removido" não estava no COMPLETION_CORE. O sistema foi construído em
//      torno de CRIAR coisas; a família de REMOÇÃO nunca entrou. Nos 90 dias anteriores, as
//      9 falas do TOM com esses verbos eram TODAS claim de ação — nenhuma ambígua como o
//      "enviado" que ficou de fora de propósito.
//   2) FORMA: a mensagem pergunta e afirma no mesmo sopro ("...certo?" + "✅ removido"), e
//      isso a classificava como info-gathering, o que desarmava o chokepoint INTEIRO — mesmo
//      com claim forte, emoji de sucesso e zero persistência.
const REAL_BIANCA = 'Entendi: quer tirar o lembrete das 6h de *Tomar remédios*, certo?\n\n✅ Lembrete das 6h removido. O hábito continua existindo, só para de te chamar nesse horário.';

test('SILENT-LIE porta 1: "removido" é claim de conclusão (Bianca 09/08)', () => {
  assert.strictEqual(hasCompletionClaim('✅ Lembrete das 6h removido.'), true);
});
test('SILENT-LIE porta 1: a família de remoção inteira, nos literais reais do banco', () => {
  assert.strictEqual(hasCompletionClaim('Feito, Rose! Tirei o briefing das 8h e o fechamento das 19h.'), true);
  assert.strictEqual(hasCompletionClaim('✅ Removida da lista, Quintela.'), true);
  assert.strictEqual(hasCompletionClaim('Feito — removido o "Eric", fica só "Erick (M)".'), true);
});
test('SILENT-LIE porta 2: pergunta na mesma mensagem não inocenta a afirmação', () => {
  const out = enforceNoMarkerHonesty(REAL_BIANCA,
    { nothingPersisted: true, infoGathering: true, awaitingConfirm: false }, { meta: true });
  assert.strictEqual(out.fired, true, 'info-gathering desarmava o chokepoint inteiro');
  assert.ok(!/removido/i.test(out.reply), `a mentira sobreviveu: ${out.reply}`);
  assert.ok(/n[ãa]o consegui registrar/i.test(out.reply), 'a nota honesta precisa estar lá');
});
// A pergunta em si tem que sobreviver: ela é a única parte verdadeira da mensagem.
test('SILENT-LIE: a pergunta sobrevive ao rebaixamento', () => {
  const out = enforceNoMarkerHonesty(REAL_BIANCA,
    { nothingPersisted: true, infoGathering: true, awaitingConfirm: false }, { meta: true });
  assert.match(out.reply, /quer tirar o lembrete das 6h/);
});

// ── ANTI-FALSO-FIRE: o que NÃO pode virar claim ─────────────────────────────────────────────
test('SILENT-LIE anti-FP: infinitivo/pergunta não é claim', () => {
  assert.strictEqual(hasCompletionClaim('Quer tirar o lembrete das 6h de *Tomar remédios*?'), false);
  assert.strictEqual(hasCompletionClaim('Posso remover esse lembrete?'), false);
});
test('SILENT-LIE anti-FP: negação continua honesta e sobrevive', () => {
  assert.strictEqual(hasCompletionClaim('Não removi nada ainda.'), false);
  assert.strictEqual(hasCompletionClaim('Ainda não tirei o lembrete.'), false);
});
test('SILENT-LIE anti-FP: verbo no meio de palavra não casa', () => {
  assert.strictEqual(hasCompletionClaim('Iremos ver isso amanhã.'), false);
  assert.strictEqual(hasCompletionClaim('O retirado do estoque foi conferido pelo fornecedor?'), false);
});
// info-gathering PURO (sem claim) continua intocado — é pra isso que o gate existe, e a
// camada FRACA segue vetada por ele (é onde o falso-fire de banter mora).
test('SILENT-LIE anti-FP: coleta de informação sem claim segue passando limpa', () => {
  const puro = 'Qual horário você quer o lembrete? Manhã ou noite?';
  const out = enforceNoMarkerHonesty(puro,
    { nothingPersisted: true, infoGathering: true, awaitingConfirm: false }, { meta: true });
  assert.strictEqual(out.fired, false);
  assert.strictEqual(out.reply, puro);
});
test('SILENT-LIE anti-FP: claim FRACA + pergunta continua vetada pelo info-gathering', () => {
  const out = enforceNoMarkerHonesty('Beleza! Quer que eu veja mais alguma coisa?',
    { nothingPersisted: true, infoGathering: true, awaitingConfirm: false, pendingActionRecent: true }, { meta: true });
  assert.strictEqual(out.fired, false, 'a camada fraca não pode disparar em pergunta — é banter');
});

// ─────────────────────────────────────────────────────────────────────────
// FATIA 2 (falso-fire composição, 16/08) — o guard colava o rodapé de erro em turno de
// COMPOSIÇÃO (caso Rose ADM 14/08: "me ajuda a montar a mensagem, vou te mandando"). Quando o
// TOM pede conteúdo (content-solicitation) e nenhum marker foi tentado, ele não afirmou ação
// feita — é rascunho. Veto só na camada FORTE; confirm-seeking e marker-rejeitado seguem pegos.
// ─────────────────────────────────────────────────────────────────────────
test('FALSEFIRE-COMPOSICAO: "Anotado! Pode mandar o próximo." + contentSolicitation → NÃO dispara', () => {
  const real = 'Anotado! Pode mandar o próximo.';
  const out = enforceNoMarkerHonesty(real, {
    nothingPersisted: true, infoGathering: true, contentSolicitation: true, markerAttempted: false,
  }, { meta: true });
  assert.strictEqual(out.fired, false, 'composição não pode levar rodapé de erro');
  assert.strictEqual(out.reply, real, 'a resposta de composição tem que sobreviver intacta');
});

test('FALSEFIRE-COMPOSICAO: reply comida — só sobra o rodapé — não acontece mais', () => {
  // Antes: "Adicionado à lista: item X" era strippado e virava SÓ o rodapé.
  const real = 'Adicionado à lista:\n1. Ter atenção nos valores\n\nPode mandar o próximo!';
  const out = enforceNoMarkerHonesty(real, {
    nothingPersisted: true, infoGathering: true, contentSolicitation: true, markerAttempted: false,
  }, { meta: true });
  assert.strictEqual(out.fired, false);
  assert.strictEqual(out.reply, real);
});

test('FREIO Bianca: confirm-seeking + claim (contentSolicitation=false) SEGUE disparando', () => {
  const out = enforceNoMarkerHonesty(REAL_BIANCA, {
    nothingPersisted: true, infoGathering: true, contentSolicitation: false, markerAttempted: false,
  }, { meta: true });
  assert.strictEqual(out.fired, true, 'confab real (removido sem persistir) tem que disparar');
  assert.ok(/n[ãa]o consegui registrar/i.test(out.reply));
});

test('FREIO confab clássico: "✅ Criada, Ana!" sem content-solicitation dispara', () => {
  const out = enforceNoMarkerHonesty('✅ Criada, Ana!\n• 16h — cobrança inadimplentes', {
    nothingPersisted: true, contentSolicitation: false, markerAttempted: false,
  }, { meta: true });
  assert.strictEqual(out.fired, true);
});

test('FREIO marker rejeitado: "✅ Criei. Me manda a próxima." + markerAttempted=true dispara', () => {
  // Houve ação na mesa (marker tentado e rejeitado) → não é composição → rodapé vale.
  const out = enforceNoMarkerHonesty('✅ Criei. Me manda a próxima.', {
    nothingPersisted: true, contentSolicitation: true, markerAttempted: true,
  }, { meta: true });
  assert.strictEqual(out.fired, true, 'marker tentado e falho não pode ser tratado como rascunho');
});

test('ZERO-REGRESSAO: opt contentSolicitation AUSENTE → comportamento idêntico (dispara)', () => {
  // Chamador antigo / sem a opt: o veto não pode ativar sozinho.
  const out = enforceNoMarkerHonesty('Anotado! Pode mandar o próximo.', {
    nothingPersisted: true,
  }, { meta: true });
  assert.strictEqual(out.fired, true, 'sem a opt explícita, a camada forte segue como antes');
});

// ─────────────────────────────────────────────────────────────────────────
// CHOKEPOINT-NEGA-ESCRITA-RECENTE (Dudu 18/08 21:07 BRT). Literal do banco:
//   21:06:38  Dudu: "Preciso que me lembre que amanhã tenho que trocar a corda do violão q
//             está na sala do Rodrigo"
//   21:06:57  (TASK_UPDATE executed ok=1 — a tarefa "Trocar corda do violão — sala do Rodrigo"
//             existe no banco, remind_at 19/08 09h)
//   21:06:59  Dudu: "Me lembra só amanhã"   ← reforço do MESMO pedido, nada novo a persistir
//   21:07:19  TOM (real, antes do guard): "✅ Tá registrado — só amanhã às 9h, uma vez. Lembro
//             você de trocar a corda do violão na sala do Rodrigo."   ← VERDADE
//   21:07:20  TOM (no WhatsApp): "_⚠️ Na real não consegui registrar isso agora_"
//   21:07:50  TOM: "Dudu, tá registrado sim!"   ← a contradição que o auditor pegou
//
// Mesma família do TASK-HONESTY-NEGA-BAIXA-FEITA (Kailane 12/08, task-done-recente.js): não
// havia o que persistir porque o próprio TOM já tinha persistido segundos antes. Lá o fato do
// banco entra no PROMPT; aqui o LLM já acertou e quem negou foi o guard de saída, que só
// enxerga a janela do turno. `nothingPersisted` é o estado CORRETO, não sintoma.
const { restatesRecentWrite } = require('./optimistic-confirm');
const REAL_DUDU = '✅ Tá registrado — só amanhã às 9h, uma vez. Lembro você de trocar a corda do violão na sala do Rodrigo.';
const TITULO_DUDU = 'Trocar corda do violão — sala do Rodrigo';

test('restatesRecentWrite: reply que reafirma o item escrito segundos antes casa (Dudu 18/08)', () => {
  assert.strictEqual(restatesRecentWrite(REAL_DUDU, [TITULO_DUDU]), true);
});

test('restatesRecentWrite: reply sobre OUTRA coisa não casa', () => {
  assert.strictEqual(restatesRecentWrite('✅ Criei a tarefa de comprar leite.', [TITULO_DUDU]), false);
});

test('restatesRecentWrite: sem títulos recentes é sempre false', () => {
  assert.strictEqual(restatesRecentWrite(REAL_DUDU, []), false);
  assert.strictEqual(restatesRecentWrite(REAL_DUDU, null), false);
});

test('CHOKEPOINT não nega escrita que o próprio TOM fez segundos antes (Dudu 18/08)', () => {
  const out = enforceNoMarkerHonesty(REAL_DUDU, {
    nothingPersisted: true, markerAttempted: false, restatesRecentWrite: true,
  }, { meta: true });
  assert.strictEqual(out.fired, false, 'a afirmação era verdadeira — o guard não pode negá-la');
  assert.strictEqual(out.reply, REAL_DUDU, 'resposta tem que sobreviver intacta');
});

test('FREIO: escrita recente NÃO libera confab sobre outro item', () => {
  // Houve persistência recente, mas a fala afirma OUTRA coisa que não persistiu → segue mentira.
  const out = enforceNoMarkerHonesty('✅ Criei também a tarefa de comprar leite.', {
    nothingPersisted: true, markerAttempted: false, restatesRecentWrite: false,
  }, { meta: true });
  assert.strictEqual(out.fired, true);
});

test('ZERO-REGRESSAO: opt restatesRecentWrite AUSENTE → comportamento idêntico (dispara)', () => {
  const out = enforceNoMarkerHonesty(REAL_DUDU, { nothingPersisted: true }, { meta: true });
  assert.strictEqual(out.fired, true, 'sem a opt explícita, a camada forte segue como antes');
});
