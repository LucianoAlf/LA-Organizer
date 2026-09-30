'use strict';
// resultado-parcial-por-item.js — sucesso PARCIAL nunca sai como sucesso TOTAL. PURO.
//
// O CASO (achado ae5f4b42, Alf 29/09 15:23 BRT). Ele pediu pra desmarcar os dois compromissos
// de amanhã. O EVENT_UPDATE voltou ok=1 fail=1: a *Mentoria com pessoal da Benji* foi cancelada,
// a *Jornada de Cordas* não (é do Quintela; convidado não cancela). A fala que saiu:
//
//   Entendi, Alf — desmarco os dois de amanhã:
//   🗓️ *Mentoria com pessoal da Benji* (08:30)
//   🗓️ *Jornada de Cordas* (13h–17h, com Quintela)
//   Cancelados ✅ — remarca quando resolver essa questão pessoal. Força aí.
//   Sobre *Jornada de Cordas*: quem pode cancelar é o dono do compromisso, *Quintela* — …
//
// "Cancelados ✅" pros dois, e a recusa colada embaixo. A RAIZ: o ramo de EVENT_UPDATE com
// ok>0 só rebaixava CONTAGEM (count-honesty, que exige numeral) e anexava as falhas — nunca
// chamava o sanitizador na prosa. O chokepoint não vê: algo persistiu (ok=1), ele é binário.
//
// O que este módulo faz, só quando o lote tem ok E falha E a prosa afirma sucesso que não se
// restringe aos itens que deram certo:
//   1. linha de afirmação ("Cancelados ✅", "✅ Cancelei os dois") sai — fica só o trecho que
//      não afirma nada ("remarca quando resolver…");
//   2. a linha de cartão de cada item ("🗓️ *X* (08:30)") vira o resultado DELE:
//      "✅ *X* (08:30) — cancelado" / "⚠️ *Y* (13h) — não consegui cancelar: <motivo>";
//      se a prosa não lista os itens, o bloco por item entra no lugar da afirmação;
//   3. a introdução com totalizador ("desmarco os dois:") vira "olha como ficou:";
//   4. a mensagem de falha vira o motivo curto do item, e o que ela PERGUNTA segue no fim
//      ("Sobre *Y*: quer que eu mande um recado propondo a mudança?") — pergunta nunca some.
// Afirmação que nomeia só itens que deram certo é verdadeira e fica.
// JS: `\b` falha depois de letra acentuada — fronteiras por lookaround de \p{L}.
const { hasCompletionClaim, hasOptimisticConfirm } = require('./optimistic-confirm');

const VERBOS = {
  cancel: ['cancelado', 'cancelar'],
  reschedule: ['remarcado', 'remarcar'],
  complete: ['concluído', 'concluir'],
  update: ['atualizado', 'atualizar'],
  add_participants: ['participante adicionado', 'adicionar o participante'],
  remove_participants: ['participante removido', 'remover o participante'],
};
const _verbo = (acao) => VERBOS[acao] || ['alterado', 'alterar'];

const PARTICIPIO_EVENTO_RE = /(?<![\p{L}])(?:cancelad|desmarcad|remarcad|reagendad|movid|conclu[íi]d|atualizad|adiad)[oa]s?(?![\p{L}])/iu;
const PRIMEIRA_PESSOA_EVENTO_RE = /(?<![\p{L}])(?:cancelei|desmarquei|remarquei|reagendei|movi|adiei|conclu[íi]|atualizei)(?![\p{L}])/iu;
const EMOJI_OK_RE = /[✅☑✔✓]/u;
const TOTALIZADOR_RE = /(?<![\p{L}])(?:os\s+dois|as\s+duas|ambos|ambas|todos|todas|tudo|(?:os|as)\s+(?:\d+|tr[êe]s|quatro|cinco))(?![\p{L}])/iu;
const INICIO_DE_LISTA_RE = /^[\s>*_•\-–—]*(?:\p{Extended_Pictographic}️?\s*|[•\-–—]\s*|\d+[.)]\s*)/u;

function _norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*_~]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function _cita(linha, titulo) { const t = _norm(titulo); return !!t && t.length >= 3 && _norm(linha).includes(t); }

function _afirmaSucesso(l) {
  return hasCompletionClaim(l) || hasOptimisticConfirm(l) || PRIMEIRA_PESSOA_EVENTO_RE.test(l)
    || (PARTICIPIO_EVENTO_RE.test(l) && EMOJI_OK_RE.test(l));
}

// "Sobre *Y*: quem pode cancelar é o dono, *Q* — convidado não altera… Quer que eu mande um recado?"
//  → motivo "quem pode cancelar é o dono, *Q*"; pergunta "quer que eu mande um recado?".
function _partirMensagem(msg, titulo) {
  let m = String(msg || '').trim();
  if (!m) return { motivo: null, resto: null };
  if (m.includes('\n') || m.length > 240) return { motivo: 'detalhe abaixo', resto: m };
  m = m.replace(/^Sobre\s+\*[^*]+\*\s*:\s*/u, '');
  const [cabeca, ...cauda] = m.split(/\s+[—–]\s+/u);
  let motivo = cabeca.replace(/[.\s]+$/u, '');
  let pergunta = null;
  if (motivo.endsWith('?')) { pergunta = motivo; motivo = null; }
  const restoTxt = cauda.join(' — ');
  const perguntas = (restoTxt.match(/[^.!?]*\?/gu) || []).map((s) => s.trim()).filter(Boolean);
  if (perguntas.length) pergunta = perguntas.join(' ');
  if (!pergunta) return { motivo, resto: null };
  const p = pergunta.charAt(0).toLowerCase() + pergunta.slice(1);
  return { motivo, resto: titulo ? `Sobre *${titulo}*: ${p}` : pergunta.charAt(0).toUpperCase() + pergunta.slice(1) };
}

function _linhaDoItem(item, cartao) {
  const [feito, fazer] = _verbo(item.acao);
  const corpo = cartao ? cartao.replace(INICIO_DE_LISTA_RE, '').trim() : (item.titulo ? `*${item.titulo}*` : 'um compromisso');
  if (item.ok) return `✅ ${corpo} — ${feito}`;
  return `⚠️ ${corpo} — não consegui ${fazer}${item.motivo ? `: ${item.motivo}` : ''}`;
}

/**
 * @param {string} prosa  cleanText do LLM (sem o marker)
 * @param {Array<{titulo:string|null, acao:string, ok:boolean, mensagens?:string[]}>} itens
 * @returns {{fired:boolean, texto:string}}  texto já inclui o que as mensagens de falha perguntam
 */
function relatoParcialPorItem(prosa, itens) {
  const lista = (Array.isArray(itens) ? itens : []).filter(Boolean);
  const texto = String(prosa == null ? '' : prosa);
  const ok = lista.filter((i) => i.ok);
  const falhos = lista.filter((i) => !i.ok);
  if (!ok.length || !falhos.length || !texto.trim()) return { fired: false, texto };

  const linhas = texto.split('\n');
  const soDeItensOk = (l) => ok.some((i) => _cita(l, i.titulo)) && !falhos.some((i) => _cita(l, i.titulo));
  const afirmacoesFalsas = linhas.map((l, idx) => (l.trim() && _afirmaSucesso(l) && !soDeItensOk(l) ? idx : -1)).filter((i) => i >= 0);
  if (!afirmacoesFalsas.length) return { fired: false, texto };

  const itensDet = lista.map((i) => {
    const partes = (i.mensagens || []).map((m) => _partirMensagem(m, i.titulo));
    return { ...i, motivo: i.ok ? null : ((partes[0] && partes[0].motivo) || null), restos: partes.map((p) => p.resto).filter(Boolean),
      mensagensInteiras: i.ok ? (i.mensagens || []) : [] };
  });

  const usados = new Set();
  const out = [];
  let posBloco = -1;
  for (let idx = 0; idx < linhas.length; idx++) {
    const l = linhas[idx];
    if (!l.trim()) { out.push(l); continue; }
    if (afirmacoesFalsas.includes(idx)) {
      // tira só o trecho que afirma; o resto da frase ("remarca quando resolver…") fica.
      const sobra = l.split(/\s+[—–]\s+/u).filter((seg) => seg.trim() && !_afirmaSucesso(seg)).join(' — ').trim();
      if (posBloco < 0) posBloco = out.length;
      if (sobra) out.push(sobra.charAt(0).toUpperCase() + sobra.slice(1));
      continue;
    }
    const item = itensDet.find((i, k) => !usados.has(k) && _cita(l, i.titulo));
    if (item && INICIO_DE_LISTA_RE.test(l)) {
      usados.add(itensDet.indexOf(item));
      out.push(_linhaDoItem(item, l));
      continue;
    }
    if (/:\s*$/u.test(l) && TOTALIZADOR_RE.test(l)) {
      const segs = l.replace(/:\s*$/u, '').split(/\s+[—–]\s+/u);
      const novos = segs.map((s) => (TOTALIZADOR_RE.test(s) ? 'olha como ficou' : s));
      const linha = novos.join(' — ');
      out.push((linha === 'olha como ficou' ? 'Olha como ficou' : linha) + ':');
      continue;
    }
    out.push(l);
  }
  const faltando = itensDet.filter((_, k) => !usados.has(k)).map((i) => _linhaDoItem(i, null));
  if (faltando.length) {
    const at = posBloco < 0 ? out.length : posBloco;
    out.splice(at, 0, ...faltando);
  }
  const fim = [];
  for (const i of itensDet) { fim.push(...i.restos.filter((r) => !i.ok), ...i.mensagensInteiras); }
  let txt = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (fim.length) txt += '\n\n' + fim.join('\n');
  return { fired: true, texto: txt };
}

module.exports = { relatoParcialPorItem };
