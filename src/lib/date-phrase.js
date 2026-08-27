'use strict';
// CTX-LEITURA-DETERMINISTICA — fatia 1 (27/08).
//
// Extrai um PERÍODO da fala do usuário pra pré-buscar contexto. O gatilho é DATA, não assunto:
// extração de entidade (finita, enumerável, testável) em vez de classificação de intenção — que é
// a forma de regex que já mordeu o projeto (conta provável por token, comerciante≠e-mail,
// tryShopBypass). E como o resultado só ENRIQUECE o contexto (não grava, não envia, não muta), a
// assimetria permite gatilho generoso: falso-positivo custa ~500 chars; falso-negativo custa o
// "não vejo nada cadastrado" do Rafinha.
//
// Datas em YMD puro, ancoradas ao meio-dia UTC (BRT = UTC-3, então meio-dia UTC é o MESMO dia
// civil) — nunca toISOString() sobre "agora" (project_localymd_utc_shift). Fronteiras usam \p{L}
// com flag `u`: \b em JS é ASCII e não segura "terça"/"sábado".

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const PASSADO_MAX = 45;   // "o que eu tinha" olha pra trás, mas não pra outra era
const FUTURO_MAX = 180;

function _d(ymd) { return new Date(String(ymd) + 'T12:00:00.000Z'); }
function _ymd(d) { return d.toISOString().slice(0, 10); }
function _mais(ymd, n) { const d = _d(ymd); d.setUTCDate(d.getUTCDate() + n); return _ymd(d); }
function _dow(ymd) { return _d(ymd).getUTCDay(); }              // 0=domingo
function _delta(a, b) { return Math.round((_d(b) - _d(a)) / 86400000); }

// Sem \b: em JS ele é ASCII e quebra em palavra acentuada. `(?<![\p{L}\d])…(?![\p{L}\d])` segura
// "terça" e evita casar dentro de outra palavra.
function _re(corpo) { return new RegExp(`(?<![\\p{L}\\d])(?:${corpo})(?![\\p{L}\\d])`, 'iu'); }

const DIAS = [
  { dow: 0, re: 'domingo' },
  { dow: 1, re: 'segunda(?:[-\\s]?feira)?' },
  { dow: 2, re: 'ter[çc]a(?:[-\\s]?feira)?' },
  { dow: 3, re: 'quarta(?:[-\\s]?feira)?' },
  { dow: 4, re: 'quinta(?:[-\\s]?feira)?' },
  { dow: 5, re: 'sexta(?:[-\\s]?feira)?' },
  { dow: 6, re: 's[áa]bado(?:[-\\s]?feira)?' },
];
const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
// "que vem" / "próxima" empurram pra semana seguinte; sem isso, o dia de HOJE conta como a
// ocorrência (quem pergunta "e na quarta?" numa quarta está falando de hoje).
const PROXIMA_RE = /(?:que\s+vem|pr[óo]xim[ao])/iu;

// O engine prefixa a fala com o bloco de CITAÇÃO da mensagem respondida. Achado no teste
// adversarial contra 938 mensagens reais (27/08): sem tirar isso, o parser lia a data que o TOM
// escreveu e pré-buscava o período ERRADO — o usuário só disse "beleza". A citação é contexto,
// não pedido. Ver project_marcacao_gemeos_e_quote_cego.
// `anterior[^:\]]*:` cobre a variante real "(conteúdo completo do banco):" — 2 em 400 mensagens
// escapavam do strip por causa dela e vaziam "amanhã"/"hoje" da fala do TOM.
const CITACAO_RE = /\[\s*O usu[áa]rio est[áa] RESPONDENDO a esta mensagem anterior[^:\]]*:[\s\S]*?\]\s*/giu;
// Andaime do próprio engine: "[mensagem 1/2]" e o cabeçalho de mensagens em sequência. O "1/2"
// virava 01/02 e, com o chute de ano que vem, 2027-02-01 — em falas que eram só "Ok"/"Kkkkk".
// Texto que o ENGINE escreveu não é fala do usuário.
const ANDAIME_RE = /\[\s*mensagem\s+\d+\s*\/\s*\d+\s*\]|\[\s*O usu[áa]rio enviou\s+\d+\s+mensagens[\s\S]*?\]/giu;

function _janela(de, ate, rotulo) { return { de, ate, rotulo }; }
function _dentroDaFaixa(hoje, de) {
  const k = _delta(hoje, de);
  return k >= -PASSADO_MAX && k <= FUTURO_MAX;
}
function _apaga(t, m) {
  return t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length);
}

// Coleta TODOS os candidatos e escolhe depois. "Mais específico vence" estava errado: em
// "me lembra dia 11 às 13h de colocar que ngm veio dia 07/08" (fala real de produção), o dd/mm é
// detalhe e o "dia 11" é o pedido. Regra: o mais PRÓXIMO que ainda não passou; se todos passaram,
// o mais recente. Contexto se enriquece pra frente. Cada padrão que casa apaga o próprio trecho,
// então o específico continua ganhando do genérico que vive dentro dele ("depois de amanhã").
function _candidatos(t0, hoje) {
  let t = t0;
  const out = [];
  const push = (de, ate, rotulo) => { if (_dentroDaFaixa(hoje, de)) out.push(_janela(de, ate, rotulo)); };
  const comer = (corpo, fn) => {
    for (;;) {
      const m = t.match(_re(corpo));
      if (!m) return;
      t = _apaga(t, m);
      fn(m);
    }
  };

  comer('(\\d{1,2})\\s*/\\s*(\\d{1,2})(?:\\s*/\\s*(\\d{2,4}))?', (m) => {
    const dd = parseInt(m[1], 10); const mm = parseInt(m[2], 10);
    let yy = m[3] ? parseInt(m[3], 10) : parseInt(hoje.slice(0, 4), 10);
    if (m[3] && yy < 100) yy += 2000;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return;
    const monta = (a) => `${String(a).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const alvo = monta(yy);
    if (_ymd(_d(alvo)) !== alvo) return;   // 31/02 escorregaria pro dia 3 — descarta
    // Sem ano explícito: vale o ano corrente e nada mais. Chutar "ano que vem" pro passado
    // transformava "1/2" (fração, parte de mensagem, placar) em 01/02/2027 — falso-positivo puro.
    // Passado RECENTE ainda vale ("Festa da Rosa dia 16/08" dito em 26/08 é deste ano); o resto
    // cai no _dentroDaFaixa e some.
    push(alvo, alvo, `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}`);
  });

  // Relativos — o mais específico primeiro, porque apaga o trecho do genérico.
  comer('depois\\s+de\\s+amanh[ãa]', () => push(_mais(hoje, 2), _mais(hoje, 2), 'depois de amanhã'));
  comer('anteontem', () => push(_mais(hoje, -2), _mais(hoje, -2), 'anteontem'));
  comer('amanh[ãa]', () => push(_mais(hoje, 1), _mais(hoje, 1), 'amanhã'));
  comer('ontem', () => push(_mais(hoje, -1), _mais(hoje, -1), 'ontem'));

  comer('(?:fim|final)\\s+de\\s+semana', () => {
    const sab = _mais(hoje, (6 - _dow(hoje) + 7) % 7);
    push(sab, _mais(sab, 1), 'fim de semana');
  });
  comer('semana', () => {
    if (PROXIMA_RE.test(t0)) {
      const seg = _mais(hoje, ((1 - _dow(hoje) + 7) % 7) || 7);
      push(seg, _mais(seg, 6), 'semana que vem');
    } else {
      const dom = _mais(hoje, (7 - _dow(hoje)) % 7);
      push(hoje, dom, 'esta semana');
    }
  });

  for (const d of DIAS) {
    comer(d.re, () => {
      let salto = (d.dow - _dow(hoje) + 7) % 7;
      if (PROXIMA_RE.test(t0)) salto = salto === 0 ? 7 : salto + 7;
      push(_mais(hoje, salto), _mais(hoje, salto), NOMES[d.dow]);
    });
  }

  comer('hoje', () => push(hoje, hoje, 'hoje'));

  // "dia N" exige a palavra "dia": número solto ("paguei 250", "pedido 4425", "14h") não é data.
  comer('dia\\s+(\\d{1,2})', (m) => {
    const dd = parseInt(m[1], 10);
    if (dd < 1 || dd > 31) return;
    const y = parseInt(hoje.slice(0, 4), 10); const mo = parseInt(hoje.slice(5, 7), 10);
    const monta = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    let alvo = monta(y, mo);
    if (_ymd(_d(alvo)) !== alvo || _delta(hoje, alvo) < 0) {
      const ny = mo === 12 ? y + 1 : y; const nm = mo === 12 ? 1 : mo + 1;
      alvo = monta(ny, nm);
      if (_ymd(_d(alvo)) !== alvo) return;
    }
    push(alvo, alvo, `dia ${dd}`);
  });

  return out;
}

function extrairPeriodo(texto, hojeYmd) {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  if (!YMD_RE.test(String(hojeYmd || ''))) return null;
  const t = String(texto).replace(ANDAIME_RE, ' ').replace(CITACAO_RE, ' ');
  if (!t.trim()) return null;
  const cands = _candidatos(t, hojeYmd);
  if (!cands.length) return null;
  const futuros = cands.filter((c) => c.de >= hojeYmd).sort((a, b) => (a.de < b.de ? -1 : a.de > b.de ? 1 : 0));
  if (futuros.length) return futuros[0];
  return cands.sort((a, b) => (a.de < b.de ? 1 : a.de > b.de ? -1 : 0))[0];
}

module.exports = { extrairPeriodo };
