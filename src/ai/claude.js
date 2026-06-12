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

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/usr/bin/claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'sonnet';  // alias do CLI → Sonnet 4.6 atual
const TOM_CLAUDE_HOME = process.env.TOM_CLAUDE_HOME || '/opt/LA-Organizer/.claude-tom';
const CLAUDE_HOME = process.env.CLAUDE_HOME || `${TOM_CLAUDE_HOME}/.claude`;
const CLAUDE_USER_HOME = process.env.TOM_CLAUDE_HOME || TOM_CLAUDE_HOME;
const CLAUDE_PATH = process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
// Sprint 27 — 60s era apertado: tasks normais já estavam em 38-59s.
// Subindo pra 120s pra dar folga em prompts pesados (criar_compromisso com
// validação cruzada, leitura de inventário grande, etc).
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 120000;

// Sprint 26 — Mutex serializa chamadas ao CLI pra impedir race no .claude.json.
// Causa-raiz: dois `claude -p` em paralelo abriam o mesmo arquivo de config e
// o último a fechar truncava (virava 50 bytes). Backups corrompidos em
// .claude-tom/.claude/backups/.claude.json.backup.* confirmam o padrão.
// Solução: fila promise. Latência sobe um pouco quando 2+ msgs chegam juntas,
// mas elimina o corrompimento e o "TOM ficou mudo" subsequente.
let _claudeQueue = Promise.resolve();

function buildEnv() {
  const env = {
    HOME: CLAUDE_USER_HOME,
    PATH: CLAUDE_PATH,
    CLAUDE_HOME,
    LANG: process.env.LANG || 'C.UTF-8',
  };
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
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

// Wrapper público: enfileira na _claudeQueue pra serializar acesso ao .claude.json.
async function chat(systemPrompt, messages, maxTokens) {
  const job = _claudeQueue.then(() => _chatInner(systemPrompt, messages, maxTokens));
  // Mantém a cadeia viva mesmo se este job rejeitar (catch silencioso só pra fila).
  _claudeQueue = job.catch(() => {});
  return job;
}

async function _chatInner(systemPrompt, messages /*, maxTokens */) {
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';

  // Histórico recente como contexto na mensagem do usuário (para Claude ver o turno anterior).
  const history = messages
    .slice(0, -1)
    .map(m => (m.role === 'user' ? 'Usuário: ' : 'TOM: ') + m.content)
    .join('\n');
  const userPrompt = history
    ? `Conversa recente:\n${history}\n\nMensagem atual do usuário:\n${lastUser}`
    : lastUser;

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
      env: buildEnv(),
      cwd: '/opt/LA-Organizer',
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
      const sanitized = rawResult
        // 1) Tags XML/HTML de tool_use que o modelo embute mesmo com --tools ""
        .replace(/<tool_(call|use|name|result)[\s\S]*?<\/tool_\1>/gi, '')
        .replace(/<\/?tool_(call|use|name|result)\b[^>]*>/gi, '')
        .replace(/<function_call[\s\S]*?<\/function_call>/gi, '')
        .replace(/<\/?function_call\b[^>]*>/gi, '')
        .replace(/<parameters?[\s\S]*?<\/parameters?>/gi, '')
        .replace(/<\/?parameters?\b[^>]*>/gi, '')
        // Sprint 11.5 hotfix — bloquear <details>/<summary> que Claude usa
        // pra exibir "feedback memory" ou meta-estrutura interna. Caso real
        // 29/04 13:55: TOM emitiu literal `<details><summary>feedback memory
        // </summary>Vou salvar esse feedback...</details>` no WhatsApp.
        .replace(/<details[\s\S]*?<\/details>/gi, '')
        .replace(/<\/?details\b[^>]*>/gi, '')
        .replace(/<summary[\s\S]*?<\/summary>/gi, '')
        .replace(/<\/?summary\b[^>]*>/gi, '')
        // Linhas residuais de "feedback memory" / "memory hint" (caso textual)
        .replace(/^.*\b(?:feedback\s+memory|memory\s+hint|saving\s+feedback)\b.*$/gim, '')
        // 2) Linhas de narração em inglês (Claude é treinado em EN; quando tenta
        // usar tool, narra em EN mesmo se contexto é PT). Matar a linha inteira.
        .replace(/^.*\b(Based on|Now let me|Let me (?:update|read|write|check|create|save|run|verify|now)|I.ll (?:update|read|write|check|create|save|run|now)|I need to (?:update|read|write|check|create|save|run))\b.*$/gim, '')
        // 3) Linhas que referenciam filesystem do Claude CLI (memória, projects, paths)
        .replace(/^.*\b(MEMORY\.md|memory\/[\w-]+\.md|\/root\/\.claude|\.claude\/projects|\/opt\/LA-Organizer\/(?!docs\b))\b.*$/gim, '')
        // 4) "Vou salvar isso na memória" / "Saving to memory" — promessa falsa de tool.
        //    EN-LEAK-SANITIZER (caso Rose 10/06): "Saving the audio preference to local
        //    memory." escapava porque a regra exigia "saving to memory" contíguo. Agora
        //    qualquer linha com sav(e|ing|ando)…memór(ia|y) na MESMA linha cai inteira.
        .replace(/^.*\b(?:vou\s+salvar\s+isso\s+na\s+mem[óo]ria|salvando\s+na\s+mem[óo]ria|saving\s+to\s+memory)\b.*$/gim, '')
        .replace(/^.*\bsav(?:e[ds]?|ing)\b.*\bmemor(?:y|ies|[óo]ria)\b.*$/gim, '')
        .replace(/^.*\bsalv(?:o|a|ei|ando)\b.*\bmem[óo]ria\s+local\b.*$/gim, '')
        // 5) Limpa linhas em branco múltiplas resultantes
        .replace(/\n{3,}/g, '\n\n');
      const text = sanitized.trim();
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
        },
      });
    });
  });
}

module.exports = { chat, buildArgs };
