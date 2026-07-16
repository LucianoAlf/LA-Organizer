// src/prompts/finding-triage-prompt.js
// Casamento semântico: cada FALHA de conversa ↔ algum BUG CONHECIDO já corrigido.
// O LLM SÓ casa (julgamento). A decisão de ocultar/mostrar é determinística (finding-triage.js).
'use strict';

const SYSTEM = [
  'Você é um classificador técnico. Recebe (A) FALHAS detectadas em conversas do assistente TOM',
  'e (B) BUGS CONHECIDOS já corrigidos. Para cada falha, decida se ela descreve o MESMO problema',
  'técnico (mesma causa-raiz/sintoma) de algum bug conhecido — não basta ser a mesma pessoa ou a',
  'mesma data. Responda SOMENTE JSON, sem texto fora do bloco. NÃO invente código fora da lista B.',
  // AUDIT-TRIAGE-TOPIC-MATCH (15/07): 6 [REGRESSÃO] falsas seguidas por casar TÓPICO sem
  // aterrar no mecanismo. Ex.: "continuou cobrando após pedir pra não lembrar" (reschedule
  // não persistido, SEM rejeição de snooze) casava com o bug de snooze só por falar de "lembrete".
  'CRÍTICO: só case se a EVIDÊNCIA da falha mostrar o SINAL MECÂNICO do bug (campo "sinal" de B) —',
  'o MESMO marker/erro/mecanismo. Semelhança de TÓPICO ou de PALAVRA (os dois falam de "lembrete",',
  '"fatura", "reagendar"…) NÃO basta sozinha: se o sinal mecânico do bug não aparece na evidência,',
  'matched_code = null (ainda que o assunto seja parecido). Na dúvida sobre o mecanismo, use null.',
  'Para cada falha: matched_code = código do bug casado ou null; confidence = 0..1 (quão certo).',
  'Formato exato:',
  '{"matches":[{"finding_id":"<id>","matched_code":"<codigo|null>","confidence":0.0,"reason":"<curto>"}]}',
].join('\n');

/** Monta as mensagens do casamento. Retorna {system, messages}. */
function buildMatchMessages(findings, knownIssues) {
  const fLines = (findings || []).map(f =>
    `- id=${f.id} [${f.category}] ${String(f.summary || '').slice(0, 160)} | evidência: ${String(f.evidence || '').slice(0, 250)}`,
  ).join('\n');
  const kLines = (knownIssues || []).map(k =>
    `- ${k.codigo} [${k.area}] ${k.titulo} | causa: ${String(k.causa_raiz || '').slice(0, 120)}` +
    ` | sinal: ${String(k.sinal_padrao || '(não registrado)').slice(0, 180)} | corrigido_em: ${k.corrigido_em}`,
  ).join('\n');
  const user =
    `FALHAS (A):\n${fLines || '(nenhuma)'}\n\nBUGS CONHECIDOS CORRIGIDOS (B):\n${kLines || '(nenhum)'}\n\n` +
    'Para CADA falha de A, devolva um item em "matches". Use null quando nenhuma casar.';
  return { system: SYSTEM, messages: [{ role: 'user', content: user }] };
}

module.exports = { SYSTEM, buildMatchMessages };
