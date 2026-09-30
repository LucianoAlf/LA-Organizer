'use strict';
// META-NARRACAO (Kailane 29/09 19:05 BRT). O TOM mandou pra Kailane, no 1:1, o raciocinio interno
// dele em TERCEIRA PESSOA:
//   "Kailane quer que eu avise a Krissya + dê retorno da tarefa, sem concluir (o lead não atendeu).
//    Vou marcar a tarefa como concluída com nota (...), mas primeiro preciso confirmar o envio do
//    recado à Krissya."
// e SO DEPOIS a resposta de verdade ("Vou fechar a tarefa ... — confirma?").
//
// POR QUE PASSOU (medido no turno — tom_metrics 02832073): provider `claude`, sem fallback,
// sanitized_chars=0, leak_blocked=false. O modelo devolveu a prosa de planejamento como parte da
// resposta, e nenhuma das tres redes existentes olha pra isso:
//   - src/ai/sanitize.js tira narracao em INGLES ("Let me…", "I'll…"), nao em portugues;
//   - STACK_LEAK_RE (engine) so pega infra (supabase/sql/paths);
//   - mechanism-leak.js so pega vocabulario interno (marker/engine/payload…).
// "Kailane quer que eu…" nao tem nenhuma palavra proibida — e prosa comum, so que endereçada a
// ninguem. Esta rede e SEPARADA e paragrafo-a-paragrafo: tira so o paragrafo que e o TOM falando
// SOBRE a pessoa (e sobre o que ele vai fazer), preserva a resposta.
//
// CONSERVADORA DE PROPOSITO (replay de 30 dias de saidas no 1:1 — ver o teste): so dispara quando o
// paragrafo COMECA com
//   (a) o NOME DA PROPRIA PESSOA como sujeito de verbo de pedido ("Kailane quer/pediu/está
//       pedindo…") E carrega plano em 1a pessoa ("que eu", "pra eu", "vou", "preciso"…); ou
//   (b) "o usuário / a usuária / the user" como sujeito ("O usuário quer…"); ou
//   (c) plano de mecanismo ("Vou emitir…", "Preciso emitir…").
// Falar COM a pessoa pelo nome ("Kailane, …"), falar de OUTRA pessoa ("O Krissya pediu pra eu te
// repassar…") e prometer ação na 2a pessoa ("Vou marcar pra amanhã, beleza?") NAO disparam.
// Se o texto inteiro era meta-narracao, devolve vazio — quem chama cai no fallback honesto.

function _norm(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function _escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Verbos de "a pessoa me pediu algo" — a forma exata da narracao de planejamento.
const VERBO_PEDIDO = '(?:quer|queria|pediu|pede|esta pedindo|ta pedindo|precisa|mandou|solicitou|confirmou|respondeu|disse|perguntou|informou)';
// Plano em 1a pessoa no MESMO paragrafo — sem isso, "Mayra pediu reagendamento" (dito a um lider
// sobre a Mayra) nunca chega aqui, porque o nome ja nao e o da pessoa; e mesmo quando for, a frase
// sem plano nenhum nao e o vazamento que queremos pegar.
const PLANO_1P = /\b(que eu|pra eu|para eu|vou|preciso|devo|tenho que|irei)\b/;
const USUARIO_SUJEITO = /^(o|a) (usuari[oa]|colaborador[a]?) (quer|queria|pediu|pede|esta|ta|precisa|mandou|disse|confirmou|respondeu)\b|^the user\b/;
const PLANO_MECANISMO = /^(vou|preciso|devo) (emitir|disparar|acionar o marcador)\b/;

// Tira do comeco do paragrafo o que nao e palavra (negrito, emoji, bullet) — "*Kailane quer…*" e
// "• Kailane quer…" sao a mesma coisa.
function _inicio(p) {
  return _norm(p).replace(/^[^a-z0-9]+/, '');
}

function _primeirosNomes(nomes) {
  const out = new Set();
  for (const n of (nomes || [])) {
    const f = _norm(n).split(' ')[0];
    if (f && f.length >= 3) out.add(f);
  }
  return [...out];
}

// -> motivo (string) ou null
function motivoDaMetaNarracao(paragrafo, { nomes = [] } = {}) {
  const t = _inicio(paragrafo);
  if (!t) return null;
  for (const n of _primeirosNomes(nomes)) {
    const re = new RegExp(`^${_escRe(n)} ${VERBO_PEDIDO}\\b`);
    if (re.test(t) && PLANO_1P.test(t)) return 'terceira_pessoa';
  }
  if (USUARIO_SUJEITO.test(t)) return 'usuario_sujeito';
  if (PLANO_MECANISMO.test(t)) return 'plano_de_mecanismo';
  return null;
}

// -> { reply, fired, removidos: [{ motivo, trecho }] }
function stripMetaNarracao(text, { nomes = [] } = {}) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return { reply: s, fired: false, removidos: [] };
  const paragrafos = s.split(/\n[ \t]*\n/);
  const kept = [];
  const removidos = [];
  for (const p of paragrafos) {
    const motivo = motivoDaMetaNarracao(p, { nomes });
    if (motivo) { removidos.push({ motivo, trecho: p.trim().slice(0, 200) }); continue; }
    kept.push(p);
  }
  if (!removidos.length) return { reply: s, fired: false, removidos };
  const out = kept.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { reply: out, fired: true, removidos };
}

module.exports = { stripMetaNarracao, motivoDaMetaNarracao };
