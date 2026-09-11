'use strict';
// referencia-a-fala.js — REFERENCIA-A-PROPRIA-FALA (Fabi 20/06 — finding edba1c46).
//
// O TOM escreveu "a tarefa é da *Gabi*, não sua: *Enviar e Verificar Respostas de Renovação (Ago)*" e,
// 77 s depois, a Fabi mandou "essa da Gabi que não entendi"; a resposta foi "não tenho registro claro de
// qual 'da Gabi' é essa". Todos os turnos daquela rajada rodaram no fallback Codex (Claude
// exit_unavailable). Replay 11/09 no código de hoje: Claude 3/3 retoma a tarefa, Codex 0/2 ("não vejo
// essa tarefa na sua lista") — o fallback responde pela LISTA e ignora a própria fala. A referência está
// na fala recente do TOM: o engine resolve e entrega ancorada, pra qualquer modelo. PURO.

const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const JANELA_MS = 15 * 60000;

/** Nomes que a pessoa usa como referência curta: "essa da Gabi", "a do Hugo". Só fala curta (≤ 12 palavras). */
function nomesReferidos(fala) {
  const t = String(fala || '').trim();
  if (!t || t.split(/\s+/).length > 12) return [];
  const nomes = [];
  for (const m of t.matchAll(/\bd[ao]s?\s+([A-ZÀ-Ý][a-zà-ÿ]{2,})\b/g)) if (!nomes.includes(m[1])) nomes.push(m[1]);
  return nomes;
}

/** A tarefa que o TOM citou pra esse nome na fala recente: { titulo, minutos } ou null. */
function resolverReferencia(nome, recentes, agoraMs) {
  const alvo = _norm(nome);
  const nomeRe = new RegExp(`(^|[^a-z])${alvo}([^a-z]|$)`);
  const falas = (recentes || [])
    .filter((m) => m && m.direction === 'outbound' && agoraMs - new Date(m.created_at).getTime() <= JANELA_MS)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const m of falas) {
    const titulos = [...String(m.content || '').matchAll(/\*([^*\n]{3,120})\*/g)].map((x) => x[1].trim())
      .filter((b) => b.split(/\s+/).length >= 3);
    const comNome = titulos.filter((b) => nomeRe.test(_norm(b)));
    const titulo = comNome.length === 1 ? comNome[0]
      : (!comNome.length && titulos.length === 1 && nomeRe.test(_norm(m.content)) ? titulos[0] : null);
    if (titulo) return { titulo, minutos: Math.max(1, Math.round((agoraMs - new Date(m.created_at).getTime()) / 60000)) };
  }
  return null;
}

/** Pista pro modelo: cada referência curta resolvida pela própria fala do TOM. '' se nada resolve. */
function pistaDeReferencia(fala, recentes, agoraMs) {
  const linhas = [];
  for (const nome of nomesReferidos(fala)) {
    const r = resolverReferencia(nome, recentes, agoraMs);
    if (r) linhas.push(`"da ${nome}" = *${r.titulo}* — você mesmo citou isso há ${r.minutos} min.`);
  }
  if (!linhas.length) return '';
  return '\n\n[CONTEXTO INTERNO — referência resolvida pela sua própria fala; não verbalize este bloco]\n'
    + linhas.join('\n')
    + '\nResponda sobre ESSE item, com o que você mesmo disse dele. Não diga que não tem registro nem que não o vê na lista.';
}

module.exports = { nomesReferidos, resolverReferencia, pistaDeReferencia };
