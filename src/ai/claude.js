// src/ai/claude.js — Spawn do CLI `claude` em modo headless (-p), passando
// o system prompt rico via --append-system-prompt.
//
// Sprint 10 hardening:
//   • HOME isolado (TOM_CLAUDE_HOME, default /opt/LA-Organizer/.claude-tom)
//     pra evitar herança de skills/memory/projects de /root/.claude. Era a
//     causa-raiz do leak de tool_call (CLI puxava arquivos de
//     /root/.claude/projects/-opt-LA-Organizer/memory/* e mostrava como
//     "tool_use" no output).
//   • --output-format json: o CLI devolve {type, result, ...}; lemos só o
//     campo `result` (texto final do assistant). Tool_use blocks ficam fora
//     antes de chegar no engine. Defesa em camada de provider.
//   • --strict-mcp-config + --mcp-config '{"mcpServers":{}}' + --tools ""
//     continuam (Sprint 7) pra desabilitar execução de tools.
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { classifyClaudeExit } = require('./classify-claude-exit');
const { buildUserPrompt } = require('./prompt');
const { sanitizeOutput } = require('./sanitize');

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/usr/bin/claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'sonnet';  // alias do CLI → Sonnet 4.6 atual
const TOM_CLAUDE_HOME = process.env.TOM_CLAUDE_HOME || '/opt/LA-Organizer/.claude-tom';
const CLAUDE_HOME = process.env.CLAUDE_HOME || `${TOM_CLAUDE_HOME}/.claude`;
const CLAUDE_USER_HOME = process.env.TOM_CLAUDE_HOME || TOM_CLAUDE_HOME;
const CLAUDE_PATH = process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
// LATÊNCIA (15/06): medido na VPS — floor do CLI = 2.4s e chamadas reais de
// produção = 8-12s (o "38-59s" do Sprint 27 era de versão/prompt antigos, hoje
// obsoleto). O timeout de 120s só ESCONDIA hang da Anthropic (429/5xx): a msg
// travava 2min e, como o acesso ao CLI é serializado (_claudeQueue), TODA msg
// atrás travava junto → "TOM escrevendo a vida toda / às vezes não responde".
// Fail-fast (19/06): 45s — Claude é o padrão; em overload cai pro Codex "só no
// extremo". p95 real da chamada ≈ 42s, então 45s quase não corta caso legítimo.
// O .env da VPS DEVE estar alinhado (estava em 120000 — fix no mesmo deploy).
// Override via CLAUDE_TIMEOUT_MS.
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 45000;

// Paralelismo (Fase 1, default OFF). Com a flag ≠ '1' tudo cai no caminho serial.
const { createSemaphore, decideRefreshMode, workerHomePath, needsCredSync, shouldRefreshCanon } = require('./claude-pool');
const PARALLEL_ENABLED = process.env.TOM_CLAUDE_PARALLEL === '1';
const POOL_SIZE = Math.max(1, Number(process.env.TOM_CLAUDE_POOL_SIZE) || 2);
const REFRESH_SLACK_MS = Number(process.env.TOM_CLAUDE_REFRESH_SLACK_MS) || 1800000; // 30 min
const WORKER_HOMES = Array.from({ length: POOL_SIZE }, (_, i) => workerHomePath(CLAUDE_USER_HOME, i));

// Keep-alive do CANON (REGRESSÃO 20/06 + re-tentativa 01/07): no modo paralelo o
// CANON só é tocado nos 30min de slack antes de expirar; sem tráfego nessa janela
// (madrugada) o token MORRE e `claude -p` não ressuscita token expirado → 100%
// fallback. Este timer refresca o CANON PROATIVAMENTE (margem 60min > slack 30min),
// enfileirado no _canonLock (nunca corre com chamadas canon-mode do engine). Roda
// SÓ no processo do engine (chamado no index.js), nunca no dispatcher (cron efêmero).
const KEEPALIVE_INTERVAL_MS = Number(process.env.TOM_CANON_KEEPALIVE_INTERVAL_MS) || 10 * 60 * 1000; // 10 min
const KEEPALIVE_MARGIN_MS = Number(process.env.TOM_CANON_KEEPALIVE_MARGIN_MS) || 60 * 60 * 1000; // 60 min
const KEEPALIVE_TIMEOUT_MS = Number(process.env.TOM_CANON_KEEPALIVE_TIMEOUT_MS) || 30000;
let _pool = null;        // semáforo, criado em ensureWorkerHomes()
let _canonLock = Promise.resolve(); // mutex SÓ para o refresh-no-CANON

// Sprint 26 — Mutex serializa chamadas ao CLI pra impedir race no .claude.json.
// Causa-raiz: dois `claude -p` em paralelo abriam o mesmo arquivo de config e
// o último a fechar truncava (virava 50 bytes). Backups corrompidos em
// .claude-tom/.claude/backups/.claude.json.backup.* confirmam o padrão.
// Solução: fila promise. Latência sobe um pouco quando 2+ msgs chegam juntas,
// mas elimina o corrompimento e o "TOM ficou mudo" subsequente.
let _claudeQueue = Promise.resolve();

function buildEnv(home = CLAUDE_USER_HOME) {
  const env = {
    HOME: home,
    PATH: CLAUDE_PATH,
    CLAUDE_HOME: path.join(home, '.claude'),
    LANG: process.env.LANG || 'C.UTF-8',
    // RAIZ DA RAJADA NOTURNA DE DATA (provado 01/09): o CLI carimba a data de HOJE no
    // envelope proprio dele e segue o TZ do processo — medido com o mesmo binario no mesmo
    // instante: TZ=UTC -> 2026-09-01, TZ=Pacific/Kiritimati -> 2026-09-02. A VPS e UTC, entao
    // das 21h a meia-noite BRT o envelope dizia ao modelo que ja era AMANHA — por BAIXO de
    // toda ancora que o prompt monta (a re-ancoragem perdia a disputa: envelope de sistema
    // parece mais autoritativo que texto de prompt). E o motivo de o erro de "hoje" vir
    // sempre em RAJADA a noite (42% medido no grupo; caso Rose 31/08 22:46, a noite que
    // tirou o financeiro do TOM). Data civil do TOM e BRT em toda parte; o envelope agora
    // concorda com a ancora em vez de brigar com ela.
    TZ: process.env.TOM_TZ || 'America/Sao_Paulo',
  };
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

// Copia o .credentials.json fresco do CANON → worker, só se o do worker estiver
// ausente/mais velho. NÃO copia .claude.json (cada worker tem o seu, descartável).
function syncCredsToWorker(workerHome) {
  const src = path.join(CLAUDE_HOME, '.credentials.json');
  const dstDir = path.join(workerHome, '.claude');
  const dst = path.join(dstDir, '.credentials.json');
  try {
    const srcMtime = fs.statSync(src).mtimeMs;
    let dstMtime = null;
    try { dstMtime = fs.statSync(dst).mtimeMs; } catch (_) { dstMtime = null; }
    if (needsCredSync(srcMtime, dstMtime)) {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(src, dst);
      try { fs.chmodSync(dst, 0o600); } catch (_) {}
    }
  } catch (e) {
    console.warn(`[Pool] syncCredsToWorker(${workerHome}) falhou: ${e.message}`);
  }
}

// Boot: cria os K worker HOMEs, faz a 1ª cópia das credenciais e monta o semáforo.
// Idempotente. Só roda quando o paralelismo está ligado.
function ensureWorkerHomes() {
  for (const home of WORKER_HOMES) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    syncCredsToWorker(home);
  }
  _pool = createSemaphore(WORKER_HOMES);
  console.log(`[Pool] ${WORKER_HOMES.length} worker HOMEs prontos (K=${POOL_SIZE})`);
}

/**
 * @param {string} systemPrompt - Conteúdo SOUL+AGENTS+contexto. Pode ter dezenas de KB.
 * @param {Array<{role:string,content:string}>} messages - Histórico + mensagem atual.
 * @returns {Promise<{text:string, provider:string}>}
 */
let _tmpCounter = 0;

// Monta o array de args do CLI. PURA (sem I/O) → testável. O system prompt vai por
// --append-system-prompt-file (arquivo), NÃO por argv, pra não estourar ARG_MAX (E2BIG).
function buildArgs(userPrompt, sysPromptFile) {
  return [
    '-p', userPrompt,
    '--model', CLAUDE_MODEL,
    '--append-system-prompt-file', sysPromptFile,
    '--output-format', 'json',
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--tools', '',
  ];
}

// Lê o expiresAt do CANON e decide pool vs canon. Se não conseguir ler → 'canon' (seguro).
function getValidToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CLAUDE_HOME, '.credentials.json'), 'utf8'));
    const expiresAt = raw.claudeAiOauth?.expiresAt || 0;
    return decideRefreshMode(expiresAt, Date.now(), REFRESH_SLACK_MS);
  } catch (_) {
    return 'canon';
  }
}

// Caminho paralelo (flag ON). Token em folga → worker do pool; token perto de
// expirar → serializa no CANON (canonLock) e deixa o CLI refrescar por carona.
async function _chatParallel(systemPrompt, messages, enqueuedAt) {
  if (!_pool) ensureWorkerHomes();
  if (getValidToken() === 'canon') {
    const job = _canonLock.then(() => _chatInner(systemPrompt, messages, enqueuedAt, CLAUDE_USER_HOME));
    _canonLock = job.catch(() => {});
    return job;
  }
  const slot = await _pool.acquire();
  try {
    syncCredsToWorker(slot.home);
    return await _chatInner(systemPrompt, messages, enqueuedAt, slot.home);
  } finally {
    _pool.release(slot);
  }
}

// ---- Keep-alive do CANON (só no processo do engine, com paralelo ON) ----
let _keepAliveInFlight = false;
let _keepAliveTimer = null;

// Lê o expiresAt do token do CANON (0 se não conseguir ler).
function _readCanonExpiresAt() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CLAUDE_HOME, '.credentials.json'), 'utf8'));
    return (raw.claudeAiOauth && raw.claudeAiOauth.expiresAt) || 0;
  } catch (_) { return 0; }
}

// Chamada MÍNIMA no CANON só pra forçar o refresh-por-carona do CLI (antes de expirar).
function _spawnCanonKeepAlive() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, info) => { if (done) return; done = true; resolve({ ok, info }); };
    let child;
    try {
      child = spawn(CLAUDE_BIN, ['-p', 'ping', '--model', CLAUDE_MODEL, '--output-format', 'json',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', ''],
      { stdio: ['ignore', 'ignore', 'ignore'], env: buildEnv(CLAUDE_USER_HOME), cwd: os.tmpdir() });
    } catch (e) { return finish(false, 'spawn:' + e.message); }
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} finish(false, 'timeout'); }, KEEPALIVE_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(t); finish(false, 'err:' + e.message); });
    child.on('close', (code) => { clearTimeout(t); finish(code === 0, 'exit=' + code); });
  });
}

// 1 tick: se o token do CANON está dentro da margem, refresca AGORA (enfileirado no
// _canonLock, nunca corre com canon-mode do engine). Guard anti-reentrada.
async function _canonKeepAliveTick() {
  if (_keepAliveInFlight) return;
  const expiresAt = _readCanonExpiresAt();
  if (!shouldRefreshCanon(expiresAt, Date.now(), KEEPALIVE_MARGIN_MS)) return;
  _keepAliveInFlight = true;
  const minsBefore = expiresAt ? Math.round((expiresAt - Date.now()) / 60000) : null;
  const job = _canonLock.then(() => _spawnCanonKeepAlive());
  _canonLock = job.catch(() => {});
  try {
    const r = await job;
    const after = _readCanonExpiresAt();
    const minsAfter = after ? Math.round((after - Date.now()) / 60000) : null;
    console.log(`[Pool] keep-alive CANON: ${r.ok ? 'OK' : 'FALHOU'} (${r.info}); expiresAt ${minsBefore}min -> ${minsAfter}min`);
  } catch (e) {
    console.warn('[Pool] keep-alive CANON erro:', e.message);
  } finally {
    _keepAliveInFlight = false;
  }
}

// Liga o timer. Só no engine (index.js) e só com paralelo ON — no serial toda msg
// já exercita o CANON. unref() pra não segurar o shutdown.
function startCanonKeepAlive() {
  if (!PARALLEL_ENABLED) return;
  if (_keepAliveTimer) return;
  _keepAliveTimer = setInterval(() => { _canonKeepAliveTick().catch(() => {}); }, KEEPALIVE_INTERVAL_MS);
  if (_keepAliveTimer.unref) _keepAliveTimer.unref();
  console.log(`[Pool] keep-alive CANON ativo (check ${Math.round(KEEPALIVE_INTERVAL_MS / 60000)}min, margem ${Math.round(KEEPALIVE_MARGIN_MS / 60000)}min)`);
  // Kick imediato: se já está dentro da margem no boot, refresca agora (não espera 1 ciclo).
  _canonKeepAliveTick().catch(() => {});
}

// Wrapper público: enfileira na _claudeQueue pra serializar acesso ao .claude.json.
async function chat(systemPrompt, messages, maxTokens) {
  const enqueuedAt = Date.now();
  if (PARALLEL_ENABLED) {
    return _chatParallel(systemPrompt, messages, enqueuedAt);
  }
  // Caminho serial (flag OFF) — idêntico ao de hoje.
  const job = _claudeQueue.then(() => _chatInner(systemPrompt, messages, enqueuedAt));
  // Mantém a cadeia viva mesmo se este job rejeitar (catch silencioso só pra fila).
  _claudeQueue = job.catch(() => {});
  return job;
}

async function _chatInner(systemPrompt, messages, enqueuedAt, home = CLAUDE_USER_HOME) {
  const startedAt = Date.now();
  const queueWaitMs = enqueuedAt ? (startedAt - enqueuedAt) : 0;
  const userPrompt = buildUserPrompt(messages);

  // Anti-E2BIG: grava o system prompt (~90KB) num arquivo temp e passa por
  // --append-system-prompt-file, tirando o gigante do argv (estourava ARG_MAX).
  const tmpFile = path.join(os.tmpdir(), `tom-sysprompt-${process.pid}-${Date.now()}-${_tmpCounter++}.txt`);
  try {
    fs.writeFileSync(tmpFile, systemPrompt, 'utf8');
  } catch (e) {
    const err = new Error('Claude: falha ao gravar system prompt temporário: ' + e.message);
    err.kind = 'spawn'; err.provider = 'claude';
    throw err;
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };
    // --append-system-prompt mantém o system prompt separado do user prompt,
    // permitindo que o Claude trate identidade/contexto como instrução de sistema.
    //
    // Sprint 7 — isolamento do TOM:
    //   --strict-mcp-config + --mcp-config '{"mcpServers":{}}' — desliga TODOS
    //     os MCP servers que poderiam vir do CLAUDE_HOME do user root. TOM só
    //     produz texto + marker; tool calls externos quebram contrato.
    //   --tools "" — desabilita o conjunto built-in (Bash, Edit, Read, etc).
    //
    // Causa-raiz documentada em docs/TOM-AGENTS.md (anti-leak guard):
    // sem essa restrição, Claude CLI improvisava tool calls quando a skill
    // não dava direção suficiente, vazando "preciso de permissão pra Supabase"
    // ao usuário e estourando latência (58s vs 4s típico).
    const args = buildArgs(userPrompt, tmpFile);

    const child = spawn(CLAUDE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // GROUPCHAT-INFRA-LEAK (caso Rose 12/06): com cwd=/opt/LA-Organizer o CLI
      // auto-carregava o /opt/LA-Organizer/CLAUDE.md (instruções de DevOps: ssh tom,
      // cat .env, setup-vps-key, /mnt/d/...) como "project memory" e o LLM regurgitava
      // esses comandos no chat de grupo. cwd FORA da árvore do projeto mata o
      // carregamento de CLAUDE.md (o CLI sobe pelos ancestrais do cwd — um subdir de
      // /opt/LA-Organizer não resolveria). sysprompt e tmp são absolutos; tools/MCP já
      // estão off → o cwd não importa pra mais nada.
      env: buildEnv(home),
      cwd: os.tmpdir(),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const reject_ = (kind, msg) => {
      cleanup();
      const e = new Error(msg);
      e.kind = kind;
      e.provider = 'claude';
      reject(e);
    };

    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      reject_('timeout', `Claude timeout após ${CLAUDE_TIMEOUT_MS}ms. stderr: ${stderr.slice(0, 300)}`);
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      reject_('spawn', 'Claude spawn falhou: ' + err.message);
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      const raw = stdout.trim();
      if (code !== 0) {
        // ANTHROPIC-API-EXIT-1: o CLI costuma emitir o payload de erro (429/529/5xx)
        // no STDOUT com STDERR vazio. Classifica o motivo p/ log/marker em vez de
        // engolir tudo como "exit" genérico. Fallback Codex dispara igual.
        const { kind, message } = classifyClaudeExit(code, stdout, stderr);
        return reject_(kind, message);
      }
      if (!raw) {
        return reject_('empty', `Claude retornou vazio. stderr: ${stderr.trim().slice(0, 500) || '(vazio)'}`);
      }
      // Sprint 10: --output-format json devolve {type, result, is_error, ...}.
      // Só lemos result (texto final). Tool_use/narração interna ficam fora.
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return reject_('bad_json', `Claude JSON inválido (output-format): ${err.message}. raw[0..200]: ${raw.slice(0, 200)}`);
      }
      if (parsed.is_error) {
        return reject_('cli_error', `Claude is_error=true subtype=${parsed.subtype} result=${String(parsed.result || '').slice(0, 200)}`);
      }
      const rawResult = typeof parsed.result === 'string' ? parsed.result : '';
      // Sprint 10 sanitizer: o modelo ainda tenta embutir tags de tool_use
      // dentro de `result` (ex.: <parameter ...>...</parameter>, <tool_result>)
      // mesmo com --tools "" e diretiva de prompt. Strip agressivo no provider
      // — antes de chegar no engine. Não cresce regex do anti-leak no engine.
      // Sanitização (tool-tags, narração EN, cercas, infra, "salvar na memória")
      // extraída pra src/ai/sanitize.js — compartilhada com o fallback Codex.
      const text = sanitizeOutput(rawResult);
      const sanitizedDelta = rawResult.length - text.length;
      if (sanitizedDelta > 0) {
        console.warn(`[Claude] sanitizer stripped ${sanitizedDelta} chars (tool tags/narração) — raw result had tool_use embed`);
      }
      if (!text) {
        return reject_('empty', `Claude result vazio. parsed.subtype=${parsed.subtype} stop_reason=${parsed.stop_reason}`);
      }
      cleanup();
      resolve({
        text,
        provider: 'claude',
        meta: {
          duration_ms: parsed.duration_ms,
          duration_api_ms: parsed.duration_api_ms,
          num_turns: parsed.num_turns,
          stop_reason: parsed.stop_reason,
          input_tokens: parsed.usage?.input_tokens,
          output_tokens: parsed.usage?.output_tokens,
          sanitized_chars: sanitizedDelta,
          queue_wait_ms: queueWaitMs,
        },
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// chatRaw — CLI OAuth pra saída HTML (ex.: "Formatar com o TOM" das anotações).
// Caminho SEPARADO do chat() de WhatsApp: NÃO passa pelo sanitizer anti-leak (que
// destruiria HTML legítimo) e NÃO tem fallback OpenAI. Reusa a fila _claudeQueue
// (anti-race do .claude.json) e os mesmos flags (buildArgs). O spawn é duplicado de
// propósito pra NÃO tocar no caminho de produção do WhatsApp (claude.js é crítico).
// ─────────────────────────────────────────────────────────────────────────────

// Limpeza leve da saída HTML: tira cercas de código que o modelo às vezes embute.
// NÃO é o sanitizer de WhatsApp.
function stripModelHtml(raw) {
  return String(raw || '')
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

// Spawn + parse → { rawResult, meta }. SEM sanitizer. Mesma mecânica do _chatInner.
function _spawnRaw(systemPrompt, userPrompt, home = CLAUDE_USER_HOME) {
  const tmpFile = path.join(os.tmpdir(), `tom-fmt-${process.pid}-${Date.now()}-${_tmpCounter++}.txt`);
  try {
    fs.writeFileSync(tmpFile, systemPrompt, 'utf8');
  } catch (e) {
    const err = new Error('Claude(raw): falha ao gravar system prompt temporário: ' + e.message);
    err.kind = 'spawn'; err.provider = 'claude';
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };
    const args = buildArgs(userPrompt, tmpFile);
    const child = spawn(CLAUDE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], env: buildEnv(home), cwd: os.tmpdir() });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const reject_ = (kind, msg) => { cleanup(); const e = new Error(msg); e.kind = kind; e.provider = 'claude'; reject(e); };
    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      reject_('timeout', `Claude(raw) timeout após ${CLAUDE_TIMEOUT_MS}ms. stderr: ${stderr.slice(0, 300)}`);
    }, CLAUDE_TIMEOUT_MS);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      reject_('spawn', 'Claude(raw) spawn falhou: ' + err.message);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      const raw = stdout.trim();
      if (code !== 0) {
        const { kind, message } = classifyClaudeExit(code, stdout, stderr);
        return reject_(kind, message);
      }
      if (!raw) return reject_('empty', `Claude(raw) retornou vazio. stderr: ${stderr.trim().slice(0, 500) || '(vazio)'}`);
      let parsed;
      try { parsed = JSON.parse(raw); } catch (err) {
        return reject_('bad_json', `Claude(raw) JSON inválido: ${err.message}. raw[0..200]: ${raw.slice(0, 200)}`);
      }
      if (parsed.is_error) return reject_('cli_error', `Claude(raw) is_error=true subtype=${parsed.subtype}`);
      const rawResult = typeof parsed.result === 'string' ? parsed.result : '';
      cleanup();
      resolve({ rawResult, meta: {
        duration_ms: parsed.duration_ms,
        input_tokens: parsed.usage?.input_tokens,
        output_tokens: parsed.usage?.output_tokens,
      } });
    });
  });
}

// chatRaw(systemPrompt, userPrompt) → { text, provider, meta }. Enfileira igual ao chat().
async function chatRaw(systemPrompt, userPrompt) {
  let job;
  if (PARALLEL_ENABLED) {
    if (!_pool) ensureWorkerHomes();
    if (getValidToken() === 'canon') {
      job = _canonLock.then(() => _spawnRaw(systemPrompt, userPrompt, CLAUDE_USER_HOME));
      _canonLock = job.catch(() => {});
    } else {
      job = (async () => {
        const slot = await _pool.acquire();
        try { syncCredsToWorker(slot.home); return await _spawnRaw(systemPrompt, userPrompt, slot.home); }
        finally { _pool.release(slot); }
      })();
    }
  } else {
    job = _claudeQueue.then(() => _spawnRaw(systemPrompt, userPrompt));
    _claudeQueue = job.catch(() => {});
  }
  const { rawResult, meta } = await job;
  const text = stripModelHtml(rawResult);
  if (!text) { const e = new Error('Claude chatRaw vazio'); e.kind = 'empty'; e.provider = 'claude'; throw e; }
  return { text, provider: 'claude', meta };
}

module.exports = { chat, chatRaw, buildArgs, stripModelHtml, ensureWorkerHomes, getValidToken, startCanonKeepAlive };
