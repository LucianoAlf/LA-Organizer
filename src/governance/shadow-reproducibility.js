'use strict';
// v1 conservador: só aceita turno curto encenável. Na dúvida, ok:false (a sombra não
// finge cobrir cron/grupo/multi-turno — esses caem no gate determinístico via inconclusivo).
const CATS_OK = new Set(['confabulation', 'dropped_request']);
// Sinais de cenário caro/irreproduzível no texto do finding.
const MULTITURNO_RE = /fatura|parte\s*[1-9]|cruzamento|cobran[çc]a|lote|todos os dias|parcial|em lote|menu.*dup|reply-quote/i;

// SHADOW-VERDE-VACUO (27/08): a fala LITERAL do usuário é o eixo do replay — sem ela não há
// caminho quebrado pra repetir. O `summary` é prosa do AUDITOR sobre o bug; encenar isso faz o
// TOM conversar SOBRE o defeito e o juiz aprovar um turno vazio. Chokepoint único: o gate e o
// runner extraem a fala pela MESMA função, então não dá pra um aceitar o que o outro recusa.
// O `[carimbo]` opcional é obrigatório aqui: a evidência real vem como
// "[14/08 (sex) 19:56] USUÁRIO: Confirma" (fix AUDIT-RELATIVE-DATE-BLIND, 02/08). Sem tolerá-lo,
// o rótulo nunca casa e findings que TÊM a fala do usuário são recusados como se não tivessem —
// a mesma armadilha que já tinha cegado o pickProbe em 19/08. Só no INÍCIO da linha: colchete no
// meio do texto é conteúdo ("manda o [relatório] hoje").
const FALA_RE = /^\s*(?:\[[^\]]*\]\s*)?(?:USU[ÁA]RIO|Pessoa)\s*:\s*(.+)$/i;
function extrairFalasDoUsuario(finding) {
  return String((finding && finding.evidence) || '')
    .split('\n')
    .map((l) => l.match(FALA_RE))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((s) => s.length > 0);
}

function isReproducible(finding) {
  const f = finding || {};
  if (f.group_id) return { ok: false, motivo: 'grupo (v1 não encena chat de grupo)' };
  if (!CATS_OK.has(f.category)) return { ok: false, motivo: `categoria ${f.category || '?'} fora do escopo v1` };
  const txt = String(f.evidence || f.summary || '').trim();
  if (!txt) return { ok: false, motivo: 'sem evidência aferível' };
  if (MULTITURNO_RE.test(txt)) return { ok: false, motivo: 'cenário cron/multi-turno' };
  if (!extrairFalasDoUsuario(f).length) {
    return { ok: false, motivo: 'sem fala literal do usuário no evidence (resumo do finding NÃO é fala)' };
  }
  return { ok: true, motivo: 'turno curto encenável' };
}

module.exports = { isReproducible, extrairFalasDoUsuario };
