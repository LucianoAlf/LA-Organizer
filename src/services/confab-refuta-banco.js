// confab-refuta-banco.js -- o auditor conferindo o BANCO antes de acusar confabulacao.
//
// O buraco (01/09, finding bb00609d severidade ALTA): o TOM disse "✅ Conclui: *Ligar para
// Salome*, *Ligar para Patricia*, *Ligar para Viviane*" e o auditor acusou confabulacao porque
// "nao ha SISTEMA executed para elas". E nao ha -- NAQUELE TURNO. As tres estavam `done` no
// banco desde 20:26:33, 1h45 ANTES da fala. O TOM reafirmou verdade e levou acusacao de mentira.
//
// E a MESMA cegueira estrutural que o chokepoint tinha ate 31/08 (CHOKEPOINT-NEGA-ESCRITA-RECENTE
// e CHOKEPOINT-CEGO-PRA-DELEGACAO): julgar pelo marker do turno em vez do estado real. Do lado
// do auditor e pior, porque falso positivo de severidade ALTA e o que faz a pessoa parar de ler
// o sensor -- e ai o dia em que ele estiver certo passa junto.
//
// ESTREITO de proposito: so mexe em `confabulation`, so refuta quando TODOS os titulos citados
// forem encontrados no estado que a fala afirma. Um titulo que nao bate mantem o achado inteiro.
// Puro: recebe as tarefas ja lidas do banco.

// O TOM cita tarefa em *negrito*. Pega blocos entre asteriscos com pelo menos 3 caracteres.
const NEGRITO_RE = /\*([^*\n]{3,120})\*/g;

function titulosCitados(evidencia) {
  const s = String(evidencia == null ? '' : evidencia);
  const out = [];
  let m;
  NEGRITO_RE.lastIndex = 0;
  while ((m = NEGRITO_RE.exec(s)) !== null) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function _norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// A fala afirma CONCLUSAO ("conclui", "fechei", "✅") ou CRIACAO ("registrei", "anotei")?
const DIZ_CONCLUSAO_RE = /\b(?:conclu[ií](?:do|da|das|dos)?|finaliz|fech(?:ei|ado|ada)|dei\s+baixa|marqu(?:ei|ado))/i;

/**
 * @param {{evidencia:string, tarefas:Array<{title:string,status:string}>}} args
 * @returns {{refuta:boolean, motivo:string, titulos:string[]}}
 */
function refutarPeloBanco({ evidencia, tarefas }) {
  const titulos = titulosCitados(evidencia);
  if (!titulos.length) return { refuta: false, motivo: 'a fala nao cita titulo em negrito', titulos };
  const lista = Array.isArray(tarefas) ? tarefas : [];
  if (!lista.length) return { refuta: false, motivo: 'nenhuma tarefa correspondente no banco', titulos };

  const exigeConclusao = DIZ_CONCLUSAO_RE.test(String(evidencia || ''));
  const faltando = [];
  for (const t of titulos) {
    const alvo = lista.find((x) => _norm(x.title) === _norm(t));
    if (!alvo) { faltando.push(`${t} (nao existe)`); continue; }
    if (exigeConclusao && alvo.status !== 'done') faltando.push(`${t} (status=${alvo.status})`);
  }
  if (faltando.length) {
    return { refuta: false, motivo: `nao bate: ${faltando.join('; ')}`, titulos };
  }
  return {
    refuta: true,
    motivo: `os ${titulos.length} item(ns) citados existem no banco no estado afirmado`,
    titulos,
  };
}

module.exports = { refutarPeloBanco, titulosCitados };
