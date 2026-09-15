'use strict';
// projeto-pausa.js — PROJETO-SEM-COMO-PAUSAR-COBRANCA (Juliana 14/09/2026 — achado e1ad051e).
//
// O balanço de aderência cobrou "LA THEATER — sem mexer há 5d. Reagenda? Cancela?". Ela explicou: "estou
// colocando ela pra frente, pq é um curso novo, e ainda está no período de divulgação". O TOM respondeu
// "Vou parar de cobrar por enquanto" — e não tinha COMO: projeto só tinha criar/aprovar/rejeitar. A
// cobrança voltaria no dia seguinte e a promessa virou nota de erro.
//
// Aqui: o marcador <<PROJECT_UPDATE>> com action "pausar_cobranca". O projeto é resolvido entre os
// projetos ATIVOS em que a pessoa tem tarefa, sem chutar (igual, ou contém, e único). A data de volta
// é a que ela disse; sem data, uma semana; nunca mais que 60 dias (pausa sem fim é projeto esquecido).
// O texto de confirmação é do sistema — o TOM não anuncia a data sozinho. PURO.

const MARCA_RE = /<<PROJECT_UPDATE>>\s*([\s\S]*?)\s*<<END>>/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const PADRAO_DIAS = 7;
const TETO_DIAS = 60;

const _norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

function _somaDias(ymd, dias) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/** { itens: [{action, project, ate, motivo}], cleanText } ou null (sem marcador). */
function parseProjectUpdate(texto) {
  const s = String(texto == null ? '' : texto);
  const m = s.match(MARCA_RE);
  if (!m) return null;
  const cleanText = s.replace(MARCA_RE, '').trim();
  let dado;
  try { dado = JSON.parse(m[1]); } catch (_) { return { itens: [], cleanText, invalido: true }; }
  const lista = Array.isArray(dado) ? dado : [dado];
  const itens = lista.filter((x) => x && typeof x === 'object').map((x) => ({
    action: _norm(x.action).replace(/ /g, '_'),
    project: String(x.project || x.projeto || x.name || '').trim(),
    ate: typeof x.ate === 'string' ? x.ate.trim() : (typeof x.until === 'string' ? x.until.trim() : null),
    motivo: typeof x.motivo === 'string' ? x.motivo.trim() : null,
  }));
  return { itens, cleanText, invalido: false };
}

/** O projeto ÚNICO que casa o nome dito; null se nenhum ou ambíguo. */
function resolverProjeto(nome, projetos) {
  const q = _norm(nome);
  if (q.length < 3) return null;
  const lista = (projetos || []).filter((p) => p && p.id && p.name);
  const iguais = lista.filter((p) => _norm(p.name) === q);
  if (iguais.length) return iguais.length === 1 ? iguais[0] : null;
  const contem = lista.filter((p) => { const n = _norm(p.name); return n.includes(q) || q.includes(n); });
  return contem.length === 1 ? contem[0] : null;
}

/** Data de volta da cobrança: a pedida (futura, até 60 dias) ou uma semana. */
function dataDaPausa(ate, hojeYmd) {
  const teto = _somaDias(hojeYmd, TETO_DIAS);
  if (typeof ate === 'string' && YMD_RE.test(ate) && ate > hojeYmd) return ate > teto ? teto : ate;
  return _somaDias(hojeYmd, PADRAO_DIAS);
}

/** O projeto está com a cobrança pausada HOJE? */
function estaPausado(projeto, hojeYmd) {
  const ate = projeto && projeto.cobranca_pausada_ate ? String(projeto.cobranca_pausada_ate).slice(0, 10) : null;
  return !!ate && ate >= hojeYmd;
}

function textoPausa({ nome, ate, motivo }) {
  const [, mm, dd] = String(ate).split('-');
  return `⏸️ Paro de cobrar *${nome}* até ${dd}/${mm}${motivo ? ` (${motivo})` : ''}. Se voltar antes, é só me falar.`;
}

function textoProjetoNaoAchado(nome) {
  return `Não achei um projeto ativo seu com o nome _${nome || '(sem nome)'}_ — me diz o nome como aparece na lista que eu pauso a cobrança.`;
}

module.exports = { parseProjectUpdate, resolverProjeto, dataDaPausa, estaPausado, textoPausa, textoProjetoNaoAchado, PADRAO_DIAS, TETO_DIAS };
