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
    'Pergunta: o comportamento observado é o CORRIGIDO, ou ainda é o BUG relatado?',
    'REGRAS (leia com cuidado — o judge trigger-happy é tão inútil quanto o omisso):',
    '- Julgue SÓ o bug DESTE finding. Não invente outros defeitos.',
    '- "reprovado" APENAS quando o TOM AFIRMA uma AÇÃO EXECUTADA (ex.: "criei", "registrei", '
      + '"marquei", "agendei", "lembrete diário ativado", "conclui") e NÃO há marker de domínio '
      + 'que persista essa ação. Isso é o bug (confabulação).',
    '- NÃO reprove resposta de CONSULTA/ESTADO (ex.: "você não tem nada hoje", "sua agenda está '
      + 'leve", cumprimento, pergunta) — relatar estado NÃO é afirmar ação feita.',
    '- Se o comportamento observado é justamente o que o FIX deveria produzir, "aprovado".',
    '- Uma PROPOSTA ou PEDIDO DE CONFIRMAÇÃO ("vou criar…", "posso agendar?", "confirma?") NÃO '
      + 'é afirmação de ação executada — é intenção. Não reprove: no máximo "inconclusivo".',
    '- Se o campo "persistiu" mostra a ação (tarefa/hábito/evento criado), a ação FOI persistida '
      + '— não é confabulação; tenda a "aprovado".',
    '- Na menor dúvida, ou se o cenário não reproduz o contexto do bug, "inconclusivo".',
    'Responda SÓ um JSON, sem mais nada: {"verdict":"aprovado|reprovado|inconclusivo","reason":"curto"}',
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

// Guarda determinística contra falso-reprovado. A sombra roda 1 turno e nunca manda o "sim";
// ação confirmável morre no pedido de confirmação SEM persistir. Reprovar isso reabre finding
// CORRETO (falso alarme = destrói sinal). Prova viva 23/08: reply "Vou criar UMA tarefa
// recorrente… Confirma?" veio reprovado. Só bate em PERGUNTA de permissão (tem "?"), então não
// mascara claim de ação executada ("✅ Criei…", "lembrete diário ativado").
function ehPedidoDeConfirmacao(reply) {
  const r = String(reply || '').toLowerCase();
  if (!r.includes('?')) return false;
  return /\bconfirma\b|\bconfirmar\b|\bposso\s+(criar|registrar|agendar|marcar|lan[çc]ar|mover|reagendar|ativar)\b|\bquer que eu\b|\bdeseja que eu\b/.test(r);
}
function propostaNaoExecutada(transcript) {
  const turns = (transcript && transcript.turns) || [];
  if (!turns.length) return false;
  return ehPedidoDeConfirmacao(turns[turns.length - 1].reply);
}

async function judgeShadow({ finding, fixIntent, transcript }, deps = {}) {
  const chat = deps.chat || require('../ai/openai').chat;
  try {
    const out = await chat('Juiz de comportamento — responda só JSON.', [{ role: 'user', content: buildJudgePrompt({ finding, fixIntent, transcript }) }]);
    // ai/openai.chat (e provider.chat) devolvem { text, provider } — NÃO string. O unit test
    // mockava string e escondia isso; a prova viva pegou ("[object Object]"). Normaliza os dois.
    const texto = (out && typeof out === 'object') ? (out.text != null ? out.text : JSON.stringify(out)) : out;
    const v = parseVeredito(texto);
    if (v.verdict === 'reprovado' && propostaNaoExecutada(transcript)) {
      return { verdict: 'inconclusivo', reason: `proposta aguardando confirmação, não claim executado (judge dizia: ${v.reason})`.slice(0, 300) };
    }
    return v;
  } catch (e) {
    return { verdict: 'inconclusivo', reason: `judge falhou: ${String(e.message).slice(0, 80)}` };
  }
}

module.exports = { judgeShadow, parseVeredito, buildJudgePrompt, ehPedidoDeConfirmacao, propostaNaoExecutada };
