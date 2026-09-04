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

test('formatCredencialAdmin: acima do cap avisa quantos faltam', () => {
  const campos = Array.from({ length: MAX_CAMPOS + 8 }, (_, i) => ({ label: `L${i}`, valor: `v${i}`, sensivel: false }));
  const out = formatCredencialAdmin({ nome: 'Sol', url_ref: null, observacoes: null, campos });
  assert.match(out, new RegExp(`mais ${8} campo`), 'diz quantos ficaram de fora');
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
