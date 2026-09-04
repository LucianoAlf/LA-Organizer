const test = require('node:test');
const assert = require('node:assert');
const { acharDuplicatas, acharAlvo, acharReusoDeSegredo } = require('./credencial-duplicata');

const EXISTENTES = [
  { id: '1', nome: 'Gmail — Escola de Música LA (YouTube/Google Ads)', servico: 'Gmail', projeto: 'Marketing',
    campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }, { label: 'Senha', valor: 'x' }] },
  { id: '2', nome: 'Gmail — LA Music Barra', servico: 'Gmail', projeto: 'Marketing',
    campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
  { id: '3', nome: 'Cloudflare — DNS/CDN', servico: 'Cloudflare', projeto: 'Landing Pages', campos: [] },
];

// LAOR-3: identidade igual SOZINHA e `media`, nao `alta`. Evidencia da propria base — "Chave
// openai" e "Gmail — Escola de Musica LA" compartilham o mesmo e-mail e sao credenciais
// diferentes (uma chave de API e uma conta). Vira `alta` so com host ou servico batendo junto.
test('identidade igual sem host nem servico e sinal MEDIO', () => {
  const d = acharDuplicatas({ nome: 'Conta nova', campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }] }, EXISTENTES);
  assert.equal(d.length, 1);
  assert.equal(d[0].cred.id, '1');
  assert.equal(d[0].forca, 'media');
});

test('identidade igual COM o mesmo servico e sinal ALTO — mesma conta no mesmo sistema', () => {
  const d = acharDuplicatas(
    { nome: 'Conta nova', servico: 'Gmail', campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }] }, EXISTENTES);
  assert.equal(d.find(x => x.cred.id === '1').forca, 'alta');
});

test('identidade igual COM o mesmo host e sinal ALTO, mesmo sem servico', () => {
  const existentes = [{ id: 'h', nome: 'Ads antigo', url_ref: 'https://ads.google.com/campaigns?id=9',
    campos: [{ label: 'E-mail', valor: 'la@gmail.com' }] }];
  const d = acharDuplicatas(
    { nome: 'Ads novo', url_ref: 'http://www.ads.google.com', campos: [{ label: 'E-mail', valor: 'la@gmail.com' }] },
    existentes);
  assert.equal(d[0].forca, 'alta');
});

test('comparacao de valor ignora caixa e espacos', () => {
  const d = acharDuplicatas({ nome: 'X', campos: [{ label: 'E-mail', valor: '  ESCOLA@Gmail.com ' }] }, EXISTENTES);
  assert.equal(d[0].cred.id, '1');
});

test('mesmo servico e projeto e forca media', () => {
  const d = acharDuplicatas({ nome: 'Outra conta', servico: 'Gmail', projeto: 'Marketing', campos: [] }, EXISTENTES);
  assert.equal(d.length, 2);
  assert.equal(d[0].forca, 'media');
});

test('nome parecido e forca baixa', () => {
  const d = acharDuplicatas({ nome: 'cloudflare', campos: [] }, EXISTENTES);
  assert.equal(d.length, 1);
  assert.equal(d[0].cred.id, '3');
  assert.equal(d[0].forca, 'baixa');
});

test('resultado vem ordenado da forca maior para a menor', () => {
  const d = acharDuplicatas(
    { nome: 'Gmail', servico: 'Gmail', projeto: 'Marketing', campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
    EXISTENTES);
  assert.equal(d[0].forca, 'alta');
  assert.equal(d[0].cred.id, '2');
});

test('cada credencial aparece uma vez so, com o sinal mais forte', () => {
  const d = acharDuplicatas(
    { nome: 'Gmail — LA Music Barra', servico: 'Gmail', projeto: 'Marketing', campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
    EXISTENTES);
  const ids = d.map(x => x.cred.id);
  assert.equal(new Set(ids).size, ids.length, 'sem repeticao');
  assert.equal(d.find(x => x.cred.id === '2').forca, 'alta');
});

test('proposta sem sinal nenhum devolve lista vazia', () => {
  assert.deepEqual(acharDuplicatas({ nome: 'Sistema Totalmente Novo', campos: [] }, EXISTENTES), []);
});

test('entrada invalida nao quebra', () => {
  assert.deepEqual(acharDuplicatas(null, EXISTENTES), []);
  assert.deepEqual(acharDuplicatas({ nome: 'X' }, null), []);
});

test('acharAlvo: nome exato ignorando caixa', () => {
  const r = acharAlvo('cloudflare — dns/cdn', EXISTENTES);
  assert.equal(r.exato.id, '3');
});

test('acharAlvo: termo parcial devolve candidatos sem exato', () => {
  const r = acharAlvo('gmail', EXISTENTES);
  assert.equal(r.exato, null);
  assert.equal(r.candidatos.length, 2);
});

test('acharAlvo: termo sem correspondencia devolve vazio', () => {
  const r = acharAlvo('inexistente', EXISTENTES);
  assert.equal(r.exato, null);
  assert.deepEqual(r.candidatos, []);
});

test('acharAlvo: entrada invalida nao quebra', () => {
  assert.deepEqual(acharAlvo(null, EXISTENTES), { exato: null, candidatos: [] });
  assert.deepEqual(acharAlvo('x', null), { exato: null, candidatos: [] });
});

// =====================================================================
// LAOR-3 — SEGREDO IGUAL NAO E DUPLICATA
// O caso real (Hugo, 04/09 15:08): "conta do ADS Google" foi barrada porque a senha dela
// aparecia em registro.br, Mila Openclaw e Mila Supabase. Nenhuma tem relacao com o Google
// Ads — o que elas compartilham e uma senha reaproveitada. A credencial nunca foi criada.
// =====================================================================

test('senha igual NAO gera duplicata — nem alta, nem nenhuma', () => {
  const existentes = [{ id: '9', nome: 'Domínio — registro.br', campos: [{ label: 'Senha', valor: 'hunter2', sensivel: true }] }];
  const d = acharDuplicatas({ nome: 'Conta do ADS Google', campos: [{ label: 'Senha', valor: 'hunter2', sensivel: true }] }, existentes);
  assert.deepEqual(d, [], 'senha reaproveitada voltou a virar duplicata');
});

test('senha igual sem a flag tambem nao gera — o label ja denuncia', () => {
  const existentes = [{ id: '9', nome: 'VPS', campos: [{ label: 'Senha', valor: 'p4ss' }] }];
  assert.deepEqual(acharDuplicatas({ nome: 'VPS nova', campos: [{ label: 'Senha', valor: 'p4ss' }] }, existentes), []);
});

test('basta um dos lados marcar sensivel para o campo sair da conta', () => {
  const existentes = [{ id: '9', nome: 'Token X', campos: [{ label: 'Valor', valor: 'abc123' }] }];
  assert.deepEqual(
    acharDuplicatas({ nome: 'Token Y', campos: [{ label: 'Valor', valor: 'abc123', sensivel: true }] }, existentes), []);
});

test('campo que NAO identifica nao gera duplicata (custo, dispositivo, integracao)', () => {
  // Medido na base: Custo/mes igual em 4 cadastros, Dispositivo em 4, Integracao em 5.
  // Dois cadastros que custam o mesmo por mes eram "alta duplicata".
  for (const label of ['Custo/mês', 'Dispositivo', 'Integração', 'Observação']) {
    const existentes = [{ id: '9', nome: 'Mila Barra — SDR', campos: [{ label, valor: 'mesmo-valor-aqui' }] }];
    const d = acharDuplicatas({ nome: 'Coisa nova', campos: [{ label, valor: 'mesmo-valor-aqui' }] }, existentes);
    assert.deepEqual(d, [], `campo ${label} voltou a casar`);
  }
});

test('valor que nao identifica ninguem nao gera duplicata (admin, root)', () => {
  // Os dois WordPress da base casavam como duplicata forte por usuario = admin.
  for (const valor of ['admin', 'root', 'user', 'ADMIN ']) {
    const existentes = [{ id: '9', nome: 'WordPress — LPs', campos: [{ label: 'Usuário', valor: 'admin' }] }];
    const d = acharDuplicatas({ nome: 'WordPress — outro', campos: [{ label: 'Usuário', valor }] }, existentes);
    assert.deepEqual(d, [], `valor "${valor}" voltou a casar`);
  }
});

test('nome curto nao casa mais por conter/estar contido', () => {
  const existentes = [{ id: '9', nome: 'Sol — Atendimento', campos: [] }];
  assert.deepEqual(acharDuplicatas({ nome: 'Sol', campos: [] }, existentes), []);
});

test('identidade segue mostrando o valor — e ele que torna a mensagem util', () => {
  const existentes = [{ id: '9', nome: 'Gmail A', campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }] }];
  const d = acharDuplicatas({ nome: 'Gmail B', campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }] }, existentes);
  assert.equal(d[0].motivo, 'mesmo E-mail: escola@gmail.com');
});

// ---- aviso de reuso: a informacao nao some, muda de lugar ----

test('reuso de segredo devolve as credenciais e o LABEL — nunca o valor', () => {
  const existentes = [
    { id: 'a', nome: 'Domínio — registro.br', campos: [{ label: 'Senha', valor: 'hunter2' }] },
    { id: 'b', nome: 'Mila Openclaw', campos: [{ label: 'Senha', valor: 'hunter2', sensivel: true }] },
    { id: 'c', nome: 'Outra', campos: [{ label: 'Senha', valor: 'diferente' }] },
  ];
  const r = acharReusoDeSegredo({ nome: 'ADS Google', campos: [{ label: 'Senha', valor: 'hunter2', sensivel: true }] }, existentes);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.cred.id), ['a', 'b']);
  assert.equal(r[0].label, 'Senha');
  assert.ok(!JSON.stringify(r.map(x => ({ id: x.cred.id, label: x.label }))).includes('hunter2'));
});

test('reuso ignora campo NAO sensivel — e-mail repetido nao e reuso de segredo', () => {
  const existentes = [{ id: 'a', nome: 'X', campos: [{ label: 'E-mail', valor: 'a@b.com' }] }];
  assert.deepEqual(acharReusoDeSegredo({ nome: 'Y', campos: [{ label: 'E-mail', valor: 'a@b.com' }] }, existentes), []);
});

test('reuso conta cada credencial UMA vez, mesmo com varios campos batendo', () => {
  const existentes = [{ id: 'a', nome: 'Sol', campos: [{ label: 'senha gmail', valor: 's3' }, { label: 'senha supabase', valor: 's3' }] }];
  const r = acharReusoDeSegredo({ nome: 'Nova', campos: [{ label: 'Senha', valor: 's3' }] }, existentes);
  assert.equal(r.length, 1);
});

test('reuso: entrada invalida e proposta sem segredo devolvem vazio', () => {
  assert.deepEqual(acharReusoDeSegredo(null, []), []);
  assert.deepEqual(acharReusoDeSegredo({ nome: 'X' }, []), []);
  assert.deepEqual(acharReusoDeSegredo({ nome: 'X', campos: [{ label: 'E-mail', valor: 'a@b' }] }, null), []);
  assert.deepEqual(acharReusoDeSegredo({ nome: 'X', campos: [{ label: 'Senha', valor: '' }] },
    [{ id: 'a', nome: 'Y', campos: [{ label: 'Senha', valor: '' }] }]), [], 'valor vazio casou');
});

test('mesmo host SOZINHO nao casa — reprovado na prova contra as 46', () => {
  // Gerava 12 pares novos, e os piores eram hosts genericos: tres contas de Gmail diferentes
  // viravam "parecidas" so por morarem em mail.google.com. O caso legitimo (recadastro do
  // mesmo sistema) e coberto por host+identidade = alta.
  const existentes = [
    { id: 'a', nome: 'Gmail — Barra', url_ref: 'https://mail.google.com', campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
  ];
  const d = acharDuplicatas(
    { nome: 'Gmail — backup', url_ref: 'https://mail.google.com', campos: [{ label: 'E-mail', valor: 'backup@gmail.com' }] },
    existentes);
  assert.deepEqual(d, [], 'host sozinho voltou a casar');
});

// --- acharAlvo: o modelo reescreve o nome, o casamento tem que aguentar --------------------
// 04/09: o cadastro e "Google Ads API - LA Music" (hifen ASCII) e o modelo devolve travessao.
// O `includes` cru reprovava por UM caractere e o turno morria em "me diz o nome exato".
const BASE_ALVO = [
  { id: 'g', nome: 'Google Ads API - LA Music' },
  { id: 'm', nome: 'Gmail — Escola de Música LA (YouTube/Google Ads)' },
  { id: 'c', nome: 'Canva — criativos' },
];

test('acharAlvo: travessao no lugar do hifen ainda e o mesmo alvo', () => {
  const { exato } = acharAlvo('Google Ads API — LA Music', BASE_ALVO);
  assert.ok(exato && exato.id === 'g');
});

test('acharAlvo: acento e caixa nao atrapalham', () => {
  const { exato } = acharAlvo('gmail — escola de musica la (youtube/google ads)', BASE_ALVO);
  assert.ok(exato && exato.id === 'm');
});

test('acharAlvo: nome parcial continua casando por conter', () => {
  const { candidatos } = acharAlvo('Google Ads API', BASE_ALVO);
  assert.deepStrictEqual(candidatos.map(c => c.id), ['g']);
});

// "Google" casa por CONTER em dois nomes — comportamento antigo, mantido de proposito: dois
// candidatos caem no ramo "Achei mais de uma. Qual delas?", que pergunta em vez de chutar.
// O que nao pode e a 3a passada (tokens) eleger alvo com uma palavra generica so — por isso
// ela exige 2+ tokens significativos.
test('acharAlvo: token generico nunca ELEGE alvo sozinho', () => {
  const { exato, candidatos } = acharAlvo('Google', BASE_ALVO);
  assert.strictEqual(exato, null);
  assert.ok(candidatos.length > 1, 'ambiguo => o engine pergunta, nao escreve');

  // Sem containment, um token generico nao pode virar candidato por score.
  const semConter = acharAlvo('Ads', [{ id: 'x', nome: 'Meta — Destino leads Ads (LPs)' }, { id: 'y', nome: 'Canva' }]);
  assert.strictEqual(semConter.exato, null);
});

test('acharAlvo: 2+ tokens significativos em comum viram candidato ordenado', () => {
  const { exato, candidatos } = acharAlvo('API do Google Ads da LA Music', BASE_ALVO);
  assert.strictEqual(exato, null);
  assert.strictEqual(candidatos[0].id, 'g', 'o de mais tokens em comum vem primeiro');
});

test('acharAlvo: nada parecido continua devolvendo vazio', () => {
  const { exato, candidatos } = acharAlvo('Notion do financeiro', BASE_ALVO);
  assert.strictEqual(exato, null);
  assert.strictEqual(candidatos.length, 0);
});
