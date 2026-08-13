'use strict';
// ops-fallback.js — quem assume o canal de ops e a governança quando o Claude não atende. PURO.
//
// GOVAGENT-SEM-FALLBACK (13/08/2026). O `ops-agent` spawna `claude --model claude-opus-5` e não
// tinha rede: quando a cota semanal do Opus estourou (11 e 12/08, 62 e 33 quedas do TOM
// conversacional para o Codex), o ciclo de governança das 08:00 rodava no fio — se a cota
// tivesse estourado de manhã em vez de à noite, ele morreria e ninguém assumiria.
//
// O TOM conversacional já tinha rede desde sempre (src/ai/openai.js → Codex). O canal de
// engenharia não. É o mesmo padrão do "lado sem irmão": a proteção existia de um lado só.
//
// POR QUE OUTRO PROVEDOR, E NÃO OUTRO MODELO CLAUDE: a cota é da CONTA. Quando o Opus cai por
// `exit_rate_limit`, o Sonnet cai junto — trocar de modelo dentro da mesma conta não é rede,
// é a mesma corda. O fallback só vale se atravessar o provedor.
//
// O NOME DO MODELO: "GPT-5.6 Sol High" é `--model gpt-5.6-sol` + `model_reasoning_effort=high`
// — o "high" é o esforço, não parte do nome (`gpt-5.6-sol-high` devolve 400). Exige Codex CLI
// >= 0.147; na 0.131 a família 5.6 inteira era recusada com "not supported ... ChatGPT account".

const MODELO_PADRAO = 'gpt-5.6-sol';
const EFFORT_PADRAO = 'high';

/**
 * O fracasso do Claude justifica gastar uma segunda rodada no outro provedor?
 * Só para falta de capacidade (cota/limite/hang) — erro de USO (prompt inválido, ferramenta
 * negada) repetiria igual no Codex e queimaria tempo e dinheiro por nada.
 * @param {{kind?: string}} classificacao  saída de classifyClaudeExit
 */
function deveTentarFallback(classificacao) {
  const kind = String((classificacao && classificacao.kind) || '');
  return kind === 'exit_rate_limit' || kind === 'timeout' || kind === 'exit_overloaded';
}

/**
 * Args do `codex exec`. O prompt NÃO vai aqui: vai por stdin ('-'), porque o briefing do agente
 * de governança tem ~15KB e argv estoura o ARG_MAX do Linux — foi exatamente esse o bug que
 * deixava o Codex preso em "Reading additional input from stdin" (Sprint 27, src/ai/openai.js).
 *
 * `workspace-write` é o mínimo que serve: o ciclo precisa escrever teste e correção. Ele
 * continua sendo um sandbox — não é `--dangerously-bypass-approvals-and-sandbox`.
 * `-o arquivoSaida` entrega só a mensagem final, sem a telemetria ("tokens used", contadores)
 * que sujaria o relatório se a gente tentasse recortar o stdout.
 */
function argsCodex({ modelo, effort, repo, arquivoSaida } = {}) {
  return [
    'exec',
    '--model', String(modelo || MODELO_PADRAO),
    '-c', `model_reasoning_effort=${String(effort || EFFORT_PADRAO)}`,
    '--sandbox', 'workspace-write',
    '--skip-git-repo-check',
    '-C', String(repo || '/opt/LA-Organizer'),
    '-o', String(arquivoSaida),
    '-',
  ];
}

/**
 * O que entra no stdin: briefing (system) + pedido, na ordem. O Codex não tem
 * `--append-system-prompt`, então o briefing vira o cabeçalho do próprio prompt.
 */
function stdinCodex(briefing, pedido) {
  const b = String(briefing || '').trim();
  const p = String(pedido || '').trim();
  return b ? `${b}\n\n---\n\n${p}` : p;
}

/**
 * Marca de qual motor produziu o texto. Sem isto, um ciclo do GPT chega ao grupo com a mesma
 * cara de um ciclo do Opus — e a régua de confiança de quem lê é diferente para cada um.
 */
function selarModelo(texto, modelo) {
  const t = String(texto || '').trim();
  if (!t) return t;
  return `${t}\n\n_(ciclo rodado no ${modelo} — o Claude estava fora de cota)_`;
}

module.exports = { deveTentarFallback, argsCodex, stdinCodex, selarModelo, MODELO_PADRAO, EFFORT_PADRAO };
