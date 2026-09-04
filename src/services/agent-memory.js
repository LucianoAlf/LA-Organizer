'use strict';
// agent-memory.js — a lógica de memória que NÃO depende de tabela.
// Serve o sujeito PESSOA (collaborator_memory) e o sujeito GRUPO (group_memory).
// Nasceu extraindo `looksLikeMemory` do engine.js: uma implementação, dois consumidores,
// zero drift — que é a doença crônica deste repo quando duas superfícies copiam a mesma regra.

const TIPOS_VALIDOS = new Set(['fact', 'decision', 'lesson', 'preference', 'context']);

// VERBATIM do engine.js (~14380). Não mexer sem atualizar os testes de congelamento.
function looksLikeMemory(a, b, threshold = 0.6) {
  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4);
  const wa = new Set(norm(a));
  const wb = new Set(norm(b));
  if (!wa.size || !wb.size) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union > 0 && inter / union >= threshold;
}

// Memória entra em PROMPT. O chat de grupo carrega senha e token; isso é ficha com campo
// secreto, nunca memória. Filtro conservador por palavra-chave: falso positivo aqui só custa
// uma memória a menos, falso negativo custa credencial vazando pro contexto do modelo.
const CREDENCIAL_RE = /\b(senhas?|passwords?|passwd|tokens?|api[\s_-]?keys?|secret|credenciais?|credencial|cvv)\b/i;
function pareceCredencial(texto) {
  return CREDENCIAL_RE.test(String(texto || ''));
}

// O freio do Alf: `lesson` vira REGRA de comportamento, então nasce DESLIGADA e só entra no
// prompt com aprovação. Os outros tipos são registro do que foi dito — risco baixo, entram.
//
// ATENÇÃO (04/09): esta é a política do sujeito PESSOA (`collaborator_memory`), que NÃO tem
// fila de aprovação — gatear mais tipos aqui criaria memória que ninguém consegue aprovar.
// O sujeito GRUPO tem fila e usa política própria: `defaultsPorTipoDoGrupo` em group-memory.js,
// onde `fact` e `preference` também esperam o ok. As duas divergem de propósito.
function defaultsPorTipo(memoryType) {
  return { is_active: memoryType !== 'lesson' };
}

function prepararCandidatas(candidatas, existentes, opts = {}) {
  const teto = Number.isFinite(opts.teto) ? opts.teto : 8;
  const jaVistas = (existentes || []).map((e) => (e && e.content) || e).filter(Boolean);
  const descartadas = { duplicata: 0, credencial: 0, invalida: 0, teto: 0 };
  const aceitas = [];

  for (const c of (candidatas || [])) {
    const content = c && typeof c.content === 'string' ? c.content.trim() : '';
    if (!content || !TIPOS_VALIDOS.has(c.memory_type)) { descartadas.invalida++; continue; }
    if (pareceCredencial(content)) { descartadas.credencial++; continue; }
    if (jaVistas.some((t) => looksLikeMemory(content, t))) { descartadas.duplicata++; continue; }
    if (aceitas.length >= teto) { descartadas.teto++; continue; }
    aceitas.push(c);
    jaVistas.push(content); // a próxima candidata compara contra esta também
  }
  return { aceitas, descartadas };
}

module.exports = { looksLikeMemory, pareceCredencial, defaultsPorTipo, prepararCandidatas, TIPOS_VALIDOS };
