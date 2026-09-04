const test = require('node:test');
const assert = require('node:assert');
const { mdParaWhatsapp, formatListaPublica, formatCredencialAdmin, MAX_ITENS, MAX_CAMPOS } = require('./credenciais-format');

test('mdParaWhatsapp: headings viram negrito do whatsapp', () => {
  assert.equal(mdParaWhatsapp('# Titulo'), '*Titulo*');
  assert.equal(mdParaWhatsapp('### Sub'), '*Sub*');
});

test('mdParaWhatsapp: bold markdown vira bold whatsapp', () => {
  assert.equal(mdParaWhatsapp('isso e **importante**'), 'isso e *importante*');
});

test('mdParaWhatsapp: heading com bold inline produz exatamente um par de asteriscos', () => {
  assert.equal(mdParaWhatsapp('# **Bold Heading**'), '*Bold Heading*');
  assert.equal(mdParaWhatsapp('## **Atencao:** texto normal'), '*Atencao: texto normal*');
  assert.equal(mdParaWhatsapp('# Prefixo **negrito** sufixo'), '*Prefixo negrito sufixo*');
});

test('mdParaWhatsapp: callouts viram prefixo legivel', () => {
  assert.match(mdParaWhatsapp('> [!critico]\n> cuidado'), /⚠️/);
  assert.match(mdParaWhatsapp('> [!nota]\n> veja'), /📌/);
});

test('mdParaWhatsapp: entrada vazia ou nula devolve string vazia', () => {
  assert.equal(mdParaWhatsapp(''), '');
  assert.equal(mdParaWhatsapp(null), '');
});

test('formatListaPublica: so nome e url, um por linha', () => {
  const out = formatListaPublica([{ nome: 'Anamnese', url_ref: 'https://a' }]);
  assert.match(out, /Anamnese: https:\/\/a/);
});

test('formatListaPublica: ignora item sem url e respeita cap', () => {
  assert.equal(formatListaPublica([]), '');
  assert.equal(formatListaPublica(null), '');
  const muitos = Array.from({ length: MAX_ITENS + 5 }, (_, i) => ({ nome: `S${i}`, url_ref: `https://x/${i}` }));
  const linhas = formatListaPublica(muitos).split('\n').filter(l => l.startsWith('- '));
  assert.equal(linhas.length, MAX_ITENS);
});

test('formatListaPublica: nao vaza servico, observacoes, ou campos sensivel', () => {
  const out = formatListaPublica([{
    nome: 'Sistema A',
    url_ref: 'https://sistema-a.com',
    servico: 'Google Cloud',
    observacoes: '# Config importante\n**Nao compartilhar**',
    campos: [{ label: 'Senha', valor: 'SEGREDO_NAO_PODE_VAZAR', sensivel: true }]
  }]);
  assert.match(out, /Sistema A/);
  assert.match(out, /https:\/\/sistema-a\.com/);
  assert.doesNotMatch(out, /Google Cloud/, 'nao expoe servico');
  assert.doesNotMatch(out, /Config importante/, 'nao expoe observacoes');
  assert.doesNotMatch(out, /SEGREDO_NAO_PODE_VAZAR/, 'nao expoe campos');
});

test('formatCredencialAdmin: mostra nome, url e campos', () => {
  const out = formatCredencialAdmin({
    nome: 'Google Ads', url_ref: 'https://ads.google.com', servico: 'Google',
    observacoes: null,
    campos: [{ label: 'E-mail', valor: 'a@b.com', sensivel: false },
             { label: 'Senha', valor: 'segredo123', sensivel: true }],
  });
  assert.match(out, /Google Ads/);
  assert.match(out, /https:\/\/ads\.google\.com/);
  assert.match(out, /E-mail.*a@b\.com/s);
  assert.match(out, /Senha.*segredo123/s, 'admin ve o valor sensivel');
});

test('formatCredencialAdmin: converte observacoes de markdown', () => {
  const out = formatCredencialAdmin({
    nome: 'X', url_ref: null, campos: [],
    observacoes: '# Contexto\nSistema **principal**',
  });
  assert.match(out, /\*Contexto\*/);
  assert.match(out, /\*principal\*/);
  assert.doesNotMatch(out, /#/, 'nao deixa markdown cru');
});

test('formatCredencialAdmin: acima do cap avisa quantos faltam (sem opts, cap padrao continua valendo)', () => {
  const campos = Array.from({ length: MAX_CAMPOS + 8 }, (_, i) => ({ label: `L${i}`, valor: `v${i}`, sensivel: false }));
  const out = formatCredencialAdmin({ nome: 'Sol', url_ref: null, observacoes: null, campos });
  assert.match(out, new RegExp(`mais ${8} campo`), 'diz quantos ficaram de fora');
  // I-3 (review final 03/09): a sugestao "peça todos os campos" foi removida — o
  // engine agora sempre passa maxCampos:Infinity pro modelo, entao a frase virou
  // um loop sem saida (o admin pedia e recebia o mesmo bloco truncado de novo).
  assert.doesNotMatch(out, /peça/i, 'nao sugere mais "peça todos os campos"');
});

test('formatCredencialAdmin: opts.maxCampos ilimitado mostra todos', () => {
  const campos = Array.from({ length: 14 }, (_, i) => ({ label: `L${i}`, valor: `v${i}`, sensivel: false }));
  const out = formatCredencialAdmin({ nome: 'Sol', url_ref: null, observacoes: null, campos }, { maxCampos: Infinity });
  assert.match(out, /L13/);
  assert.doesNotMatch(out, /mais \d+ campo/);
});

test('formatCredencialAdmin: credencial sem campos nao quebra', () => {
  const out = formatCredencialAdmin({ nome: 'Vazia', url_ref: null, observacoes: null, campos: null });
  assert.match(out, /Vazia/);
});

// =====================================================================
// LAOR-2 item 1 — o admin precisa VER o que o time enxerga
// Origem (04/09): Hugo pediu "quais links voce tem", recebeu as 46 (correto, e admin) e nao
// tinha como saber que o time so ve 3. Estado invisivel nao e estado revisavel — foi por isso
// que as 3 marcadas ficaram congeladas desde 07/08.
// =====================================================================
const {
  rodapeVisibilidade, contarNomesNaResposta, MAX_NOMES_RODAPE,
} = require('./credenciais-format');

const PUB = (nome) => ({ nome, visivel_tom: true, url_ref: 'https://x' });
const PRIV = (nome) => ({ nome, visivel_tom: false, url_ref: 'https://x' });
const TRES = [PUB('LA Performance Report — ERP principal'), PUB('Chatwoot — CRM da empresa'), PRIV('Canva — criativos')];

test('globo marca so as publicas', () => {
  assert.match(formatCredencialAdmin(PUB('LA Performance Report')), /^\*🌐 LA Performance Report\*/);
  assert.ok(!/🌐/.test(formatCredencialAdmin(PRIV('Canva'))), 'marcou uma restrita como publica');
});

test('visivel_tom ausente (RPC antiga) NAO marca — fail-closed', () => {
  // Se a migration nao tiver rodado, o campo vem undefined. Marcar por omissao diria ao
  // admin que o time ve coisa que o time nao ve.
  assert.ok(!/🌐/.test(formatCredencialAdmin({ nome: 'X' })));
  assert.ok(!/🌐/.test(formatCredencialAdmin({ nome: 'X', visivel_tom: 'true' })), 'string aceita como boolean');
});

test('rodape aparece em listagem e nomeia as publicas', () => {
  const r = rodapeVisibilidade(TRES, 'Tenho o LA Performance Report, o Chatwoot e o Canva.');
  assert.match(r, /2 de 3/);
  assert.match(r, /LA Performance Report/);
  assert.match(r, /Chatwoot/);
});

test('rodape NAO aparece em pergunta pontual (seria ruido todo turno)', () => {
  assert.strictEqual(rodapeVisibilidade(TRES, 'A senha do Canva é xyz.'), '');
});

test('rodape sobrevive ao modelo reescrever: acento, caixa e nome sem o sufixo', () => {
  // O 2o passe reescreve com as proprias palavras — "... — ERP principal" some quase sempre.
  const r = rodapeVisibilidade(TRES, 'os sistemas sao LA PERFORMANCE REPORT e CHATWOOT');
  assert.match(r, /2 de 3/);
});

test('nenhuma publica tambem e informacao — e a mais surpreendente', () => {
  const so_privadas = [PRIV('Canva'), PRIV('Notion'), PRIV('Figma')];
  const r = rodapeVisibilidade(so_privadas, 'Tenho Canva, Notion e Figma.');
  assert.match(r, /Nenhuma dessas o time enxerga/);
});

test('lista longa de publicas e truncada com "e mais N"', () => {
  const muitas = [];
  for (let i = 0; i < MAX_NOMES_RODAPE + 3; i++) muitas.push(PUB(`Sistema ${i}`));
  const r = rodapeVisibilidade(muitas, muitas.map(c => c.nome).join(', '));
  assert.match(r, /e mais 3/);
  assert.ok(!r.includes(`Sistema ${MAX_NOMES_RODAPE}`), 'nao truncou a lista de nomes');
});

test('entradas degeneradas nao quebram nem inventam rodape', () => {
  assert.strictEqual(rodapeVisibilidade(null, 'x'), '');
  assert.strictEqual(rodapeVisibilidade([], 'x'), '');
  assert.strictEqual(rodapeVisibilidade([PUB('A')], 'A'), '', 'uma credencial so nao e listagem');
  assert.strictEqual(rodapeVisibilidade(TRES, ''), '');
  assert.strictEqual(rodapeVisibilidade(TRES, null), '');
  assert.strictEqual(contarNomesNaResposta([{ nome: 'ab' }, { nome: 'cd' }], 'ab cd'), 0,
    'nome curto demais casaria em qualquer texto');
});
