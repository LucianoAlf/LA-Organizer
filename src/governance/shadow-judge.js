'use strict';
// Judge da sombra: roda no Codex (modelo != Claude do corretor) e NÃO é o corretor.
// Cético: só 'reprovado' com evidência; na dúvida, 'inconclusivo'.
const VALIDOS = new Set(['aprovado', 'reprovado', 'inconclusivo']);

function buildJudgePrompt({ finding, fixIntent, transcript }) {
  const turns = (transcript && transcript.turns || []).map((t, i) =>
    `Turno ${i + 1}:\n  usuário: ${t.userText}\n  TOM respondeu: ${t.reply}\n  markers: ${(t.markers || []).join(', ') || '(nenhum)'}\n  persistiu: ${JSON.stringify(t.persisted || {})}`
  ).join('\n');
  return [
    'Você é um JUIZ independente de comportamento do agente TOM. NÃO é quem corrigiu.',
    'O BUG relatado era:', String(finding && finding.summary || ''),
    'O FIX deveria fazer:', String(fixIntent || '(não informado)'),
    'O TOM foi reproduzido AO VIVO e produziu:', turns,
    'Pergunta: o comportamento observado é o CORRIGIDO, ou ainda é o BUG?',
    'Regra: só responda "reprovado" se o transcript MOSTRAR o bug (ex.: afirma ação feita sem marker de domínio que persista). Na menor dúvida, "inconclusivo".',
    'Responda SÓ um JSON: {"verdict":"aprovado|reprovado|inconclusivo","reason":"curto"}',
  ].join('\n\n');
}

function parseVeredito(texto) {
  try {
    const m = String(texto).match(/\{[\s\S]*\}/);
    const o = JSON.parse(m ? m[0] : texto);
    if (o && VALIDOS.has(o.verdict)) return { verdict: o.verdict, reason: String(o.reason || '').slice(0, 300) };
  } catch (_) { /* cai no inconclusivo */ }
  return { verdict: 'inconclusivo', reason: 'veredito ilegível do judge' };
}

async function judgeShadow({ finding, fixIntent, transcript }, deps = {}) {
  const chat = deps.chat || require('../ai/openai').chat;
  try {
    const out = await chat('Juiz de comportamento — responda só JSON.', [{ role: 'user', content: buildJudgePrompt({ finding, fixIntent, transcript }) }]);
    return parseVeredito(out);
  } catch (e) {
    return { verdict: 'inconclusivo', reason: `judge falhou: ${String(e.message).slice(0, 80)}` };
  }
}

module.exports = { judgeShadow, parseVeredito, buildJudgePrompt };
