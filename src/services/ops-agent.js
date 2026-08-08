'use strict';
// ops-agent.js — o TOM do grupo LA ORGANIZER - TOM com poder de engenharia.
//
// O Alf e o Hugo pedem por WhatsApp o que hoje só dá pra pedir abrindo o Claude: "roda a
// auditoria de ontem", "corrige isso", "traz as evidências". Este módulo roda o CLI `claude`
// na VPS com FERRAMENTAS HABILITADAS (Bash/Read/Write/Edit/Grep/Glob) e cwd no repositório —
// o que dá, por consequência, acesso ao banco (script node sobre src/supabase/client, que usa
// service_role), à VPS (Bash) e ao repositório (git).
//
// POR QUE UM CAMINHO SEPARADO, E NÃO UM FLAG NO ai/claude.js
// O `chat()` normal roda com `--tools ''` de propósito: o TOM que fala com ~30 pessoas NÃO
// pode executar nada. Misturar os dois caminhos faria uma mudança aqui vazar pra lá. São
// spawns distintos, com modelo, permissões e prompt distintos, e nada é compartilhado.
//
// CONTROLE DE ACESSO — DUAS CONDIÇÕES, NO CÓDIGO, NUNCA NO PROMPT
// `group_id` é o grupo de ops E `sender_id` está na allowlist. Só "é membro do grupo" não
// bastaria: quem fosse adicionado ao grupo um dia herdaria a VPS. Prompt não é controle de
// acesso — um pedido escrito por terceiro e repassado não passa por aqui, porque quem decide
// é o `senderCollabId` que o bridge resolveu, não o texto.
//
// Decisão do Alf em 08/08, com o Hugo (coordenador de tecnologia) ciente: acesso total, sem
// faseamento. A ressalva de que telefone é identificação e não autenticação foi levantada,
// registrada no RETOMADA, e eles assumiram.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = process.env.TOM_OPS_REPO || '/opt/LA-Organizer';
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/usr/bin/claude';
const OPS_MODEL = process.env.TOM_OPS_MODEL || 'claude-opus-5';
// HOME isolado, o mesmo do TOM — é onde vive o login OAuth do CLI na VPS.
const OPS_HOME = process.env.TOM_CLAUDE_HOME || '/opt/LA-Organizer/.claude-tom';
const OPS_TIMEOUT_MS = Number(process.env.TOM_OPS_TIMEOUT_MS || 600000);   // 10 min
// bypassPermissions é RECUSADO pelo CLI rodando como root (a VPS roda como root), então o
// acesso vem de allowlist explícita de ferramentas — testado na VPS, permission_denials=[].
const OPS_TOOLS = (process.env.TOM_OPS_TOOLS || 'Bash Read Write Edit Grep Glob WebFetch').split(/\s+/);

const _ids = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const OPS_GROUP_ID = (process.env.TOM_OPS_GROUP_ID || '').trim();
const OPS_ALLOWLIST = new Set(_ids(process.env.TOM_OPS_ALLOWLIST));
const OPS_ENABLED = process.env.TOM_OPS_ENABLED === '1';   // kill switch: nasce DESLIGADO

/**
 * Este turno é um comando de engenharia autorizado?
 * Fail-closed em tudo: sem flag, sem grupo configurado ou sem remetente na lista → false.
 */
function isOpsChannel({ groupId, senderCollabId }) {
  if (!OPS_ENABLED) return false;
  if (!OPS_GROUP_ID || !groupId || String(groupId) !== OPS_GROUP_ID) return false;
  if (!senderCollabId || !OPS_ALLOWLIST.has(String(senderCollabId))) return false;
  return true;
}

// Regras de entrega (formatação e tom no grupo). Ficam em .md, FORA de `skills/`, porque o
// loader de skills varre aquele diretório e isto não pode vazar pro TOM que fala com o time.
// Lido a cada pedido de propósito: editar o arquivo muda a resposta na hora, sem deploy nem
// restart — o formato é dado, não código, e o Alf/Hugo podem ajustar pelo próprio grupo.
const FORMATO_PATH = process.env.TOM_OPS_FORMATO || path.join(REPO, 'docs/ops/FORMATO-GRUPO.md');

function loadFormatoGrupo() {
  try {
    return fs.readFileSync(FORMATO_PATH, 'utf8').trim();
  } catch (e) {
    // Sem o arquivo o agente ainda responde — só perde o capricho. Nunca derruba o pedido.
    console.warn(`[OpsAgent] sem regras de formato (${FORMATO_PATH}): ${e.message}`);
    return '';
  }
}

// O briefing existe pra ele não redescobrir a casa a cada pedido, e pra fixar o que NÃO faz.
function buildBriefing(quem) {
  const formato = loadFormatoGrupo();
  return `Você é o TOM operando no grupo de engenharia "LA ORGANIZER - TOM", no WhatsApp.
Quem está te pedindo agora: ${quem}. O grupo tem só o Alf (desenvolvedor, dono do produto) e
o Hugo (coordenador de tecnologia) — os dois têm autonomia total sobre este sistema.

VOCÊ TEM ACESSO REAL. O diretório atual é o repositório em produção (${REPO}), você roda Bash
nesta VPS e pode ler/escrever arquivos. Para o banco (Supabase, service_role), escreva e rode
um script node que use \`src/supabase/client\`. Você NÃO precisa pedir permissão para
investigar, medir, ler logs, rodar testes ou consultar o banco: faça.

ONDE FICAM AS COISAS
- Bugs conhecidos e histórico de correções: tabela \`tom_known_issues\` (campo \`codigo\`).
- Achados da auditoria de conversa: \`tom_audit_findings\` (use \`incident_at\`, não \`created_at\`).
- Conversas: \`conversation_history\`. Markers emitidos: \`marker_logs\`.
- Logs: \`${REPO}/logs/tom-out.log\` (console.log), \`tom-error.log\` (warn/error — é aqui que
  falha aparece) e \`rituals.log\` (dispatcher/cron). Contar falha só no out.log dá zero.
- Checkpoint do trabalho: \`docs/superpowers/RETOMADA.md\`.

COMO TRABALHAR (regras que já custaram caro aqui)
- Date antes de somar: total histórico não é problema vivo.
- O resumo de um finding NÃO é a fala da pessoa — puxe o literal de \`conversation_history\`.
- Raiz escrita num KI é hipótese até você rodar o caso contra o código.
- Antes de corrigir, reproduza; um teste que passa antes do fix não prova nada.
- Baseline da suíte: \`node --test "src/**/*.test.js"\` termina com \`fail 3\` (env ausente).

LIMITES
- NÃO apague dado de produção sem OK explícito no grupo. Investigar e corrigir, sim; deletar,
  só com autorização na hora.
- NÃO altere a voz do TOM (\`soul/\`, \`skills/\`) — isso é vetado pelo Alf.
- Se fizer deploy, siga o que o repositório manda e confirme o que subiu.

COMO RESPONDER
Sua resposta vai direto pro WhatsApp, num celular. Curto e concreto: o que você fez, o que
achou, o número que importa. Se mediu, diga o número. Se não conseguiu, diga o que faltou —
nunca diga que fez o que não fez.
${formato ? `\n${formato}` : ''}`;
}

/**
 * Roda o pedido no CLI com ferramentas. Resolve com o texto final do agente.
 * Nunca lança: devolve `{ ok:false, text }` com mensagem já pronta pro grupo.
 */
function runOpsAgent(pedido, { quem = 'alguém do grupo' } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-p', String(pedido || '').slice(0, 4000),
      '--model', OPS_MODEL,
      '--allowedTools', ...OPS_TOOLS,
      '--append-system-prompt', buildBriefing(quem),
      '--output-format', 'json',
    ];
    const env = { ...process.env, HOME: OPS_HOME };
    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, text: `Não consegui subir o agente aqui (${e.message}).` });
    }

    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} },
      OPS_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: `Falhei ao rodar aqui: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let texto = '', custo = null;
      try {
        const j = JSON.parse(out);
        texto = String(j.result || '').trim();
        custo = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null;
        if (j.is_error) texto = texto || 'O agente terminou com erro.';
      } catch (_) {
        texto = out.trim();
      }
      if (!texto) {
        const motivo = code === null ? `passou de ${Math.round(OPS_TIMEOUT_MS / 60000)} min e eu cortei`
          : `saiu com código ${code}`;
        const cauda = String(err || '').trim().slice(-300);
        return resolve({ ok: false, text: `Não terminei esse — ${motivo}.${cauda ? `\n\n_${cauda}_` : ''}` });
      }
      resolve({ ok: true, text: texto, custo });
    });
  });
}

module.exports = { isOpsChannel, runOpsAgent, buildBriefing, OPS_GROUP_ID, OPS_ALLOWLIST, OPS_ENABLED };
