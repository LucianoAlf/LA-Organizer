'use strict';
// cardapio-tarefa-recebida.js — CARDAPIO-SEM-EXECUTOR (Rafinha 14/09/2026 — achado 85a251a4).
//
// Quem recebe tarefa de outra pessoa ganha o cardápio "❓ Como você quer tratar? 1️⃣ Resolvo agora ·
// 2️⃣ Agendo · 3️⃣ Delego · 4️⃣ Preciso de apoio — Responde com o número". O texto "Resolvo agora" só
// existia DENTRO da própria mensagem: nenhum código lia a resposta. O Rafinha recebeu dois cardápios
// seguidos (as baquetas da CG) e respondeu "Resolve aí"; caiu no LLM, que disse "ficam no seu radar", o
// chokepoint rebaixou, e ele levou "não consegui registrar" por responder exatamente o que o TOM pediu.
//
// Aqui mora a leitura da resposta (número, emoji ou palavras) e os textos do sistema. PURO.

const CARDAPIO_RE = /abriu uma tarefa pra você[\s\S]*Como você quer tratar\?/;

const _norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim();

/** A mensagem é o cardápio de tarefa recebida? */
function ehCardapio(conteudo) {
  return CARDAPIO_RE.test(String(conteudo || ''));
}

/** '1' | '2' | '3' | '4' | null — número, emoji-número ou a resposta em palavras (fala curta). */
function escolhaDoCardapio(texto) {
  const bruto = String(texto == null ? '' : texto).trim();
  const num = bruto.match(/^(?:op[çc][ãa]o\s*)?([1-4])(?:️?⃣)?\s*[.!]?$/i);
  if (num) return num[1];
  const t = _norm(bruto);
  if (!t || t.split(' ').length > 8) return null;
  if (/\b(preciso de (apoio|ajuda)|me ajuda|nao consigo|(to|tou|estou) travad[oa]|travou)\b/.test(t)) return '4';
  if (/\b(delego|delega|delegar|repassa|passa (pra|para) (o|a)?)\b/.test(t)) return '3';
  if (/\b(agendo|vou agendar|deixo pra|faco (amanha|depois|semana que vem))\b/.test(t)) return '2';
  if (/\b(resolvo|resolve ai|resolve|vou resolver|eu resolvo|deixa comigo|pode deixar|cuido disso|faco hoje)\b/.test(t)) return '1';
  return null;
}

const _lista = (titulos) => (titulos.length === 1
  ? `*${titulos[0]}*`
  : titulos.map((t) => `\n• *${t}*`).join(''));

function textoResolvoAgora(titulos) {
  return titulos.length === 1
    ? `✅ Fechado — ${_lista(titulos)} fica com você pra hoje. Quando resolver, me fala que eu dou baixa.`
    : `✅ Fechado — ficam com você pra hoje:${_lista(titulos)}\n\nQuando resolver, me fala qual que eu dou baixa.`;
}

function textoPerguntaAgendo(titulos) {
  return titulos.length === 1
    ? `📅 Pra quando você agenda ${_lista(titulos)}? Me diz o dia.`
    : `📅 Pra quando você agenda essas?${_lista(titulos)}\n\nMe diz o dia.`;
}

function textoPerguntaDelego(titulos) {
  return titulos.length === 1
    ? `👥 Pra quem você passa ${_lista(titulos)}?`
    : `👥 Pra quem você passa essas?${_lista(titulos)}`;
}

function textoApoioAvisado({ criadores, titulos }) {
  const quem = criadores.map((n) => `*${n}*`).join(' e ');
  return titulos.length === 1
    ? `📣 Avisei ${quem} que você precisa de apoio pra destravar ${_lista(titulos)}.`
    : `📣 Avisei ${quem} que você precisa de apoio pra destravar:${_lista(titulos)}`;
}

function textoApoioParaCriador({ quemPede, titulos }) {
  return titulos.length === 1
    ? `🆘 ${quemPede} precisa de apoio pra destravar ${_lista(titulos)}. Dá uma força?`
    : `🆘 ${quemPede} precisa de apoio pra destravar:${_lista(titulos)}\n\nDá uma força?`;
}

/** A sequência de cardápios mais recente (outbound, do mais novo pro mais velho) até a 1ª fala que não é cardápio. */
function cardapiosEmAberto(outboundsRecentes) {
  const run = [];
  for (const r of outboundsRecentes || []) {
    if (!ehCardapio(r.content)) break;
    if (r.ref_type === 'task' && r.ref_id) run.push(r);
  }
  return run;
}

module.exports = { ehCardapio, escolhaDoCardapio, cardapiosEmAberto,textoResolvoAgora, textoPerguntaAgendo, textoPerguntaDelego, textoApoioAvisado, textoApoioParaCriador };
