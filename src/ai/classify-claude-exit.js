'use strict';

// ANTHROPIC-API-EXIT-1 (melhoria de observabilidade, 12/06).
//
// O Claude CLI (--output-format json) sai com código !=0 em instabilidade da API
// (429 rate-limit, 529 overloaded, 5xx) e frequentemente emite o payload de erro no
// STDOUT com o STDERR vazio. Antes o handler descartava esse stdout no caminho de
// erro e logava só "Claude saiu com código 1" — impossível distinguir rate-limit de
// erro real. Esta função pura classifica o motivo a partir de code/stdout/stderr.
//
// NÃO altera o fluxo: o fallback Codex (provider.js) dispara em qualquer erro do
// Claude. O ganho é só de log/marker_logs (kind mais específico + detalhe do stdout).

function _extractStdoutDetail(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    const sub = j.subtype || j.type || (j.error && j.error.type) || '?';
    const msg = String(j.result || (j.error && j.error.message) || j.message || '').slice(0, 160);
    return ` stdout.subtype=${sub} is_error=${j.is_error === true}${msg ? ` result="${msg}"` : ''}`;
  } catch (_) {
    return ` stdout[0..200]: ${raw.slice(0, 200)}`;
  }
}

// Classifica o exit !=0. Prioriza os `type` nomeados da Anthropic (confiáveis);
// status HTTP nu é fallback. Retorna { kind, message }.
function classifyClaudeExit(code, stdout, stderr) {
  const probe = `${stdout || ''} ${stderr || ''}`.toLowerCase();

  let kind = 'exit';
  if (/rate_limit_error|rate[ _-]?limit|too many requests|\b429\b/.test(probe)) {
    kind = 'exit_rate_limit';
  } else if (/overloaded_error|overloaded|\b529\b/.test(probe)) {
    kind = 'exit_overloaded';
  } else if (/api_error|service unavailable|internal server error|bad gateway|gateway timeout|\b50[023]\b/.test(probe)) {
    kind = 'exit_unavailable';
  }

  const errStr = String(stderr || '').trim().slice(0, 300) || '(vazio)';
  const message = `Claude saiu com código ${code} (${kind}). stderr: ${errStr}.${_extractStdoutDetail(stdout)}`;
  return { kind, message };
}

module.exports = { classifyClaudeExit };
