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
const os = require('os');

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

// A VOZ. Até 04/09 o briefing carregava só o FORMATO (COMO entregar) e personalidade nenhuma —
// por isso o TOM daqui soava como outra pessoa: mesmo nome, jeito de formulário. A voz NÃO é
// escrita aqui: é CARREGADA da fonte única, `soul/SOUL.md`, reusando o mesmo loader que o chat
// de grupo com a equipe usa. Redigir "a personalidade dele" neste arquivo criaria um segundo
// TOM que diverge do primeiro no dia em que alguém editar só um dos dois.
//
// DIREÇÃO DA TRAVA (ver o comentário do FORMATO acima): o que não pode vazar é ops → equipe —
// nada do que se fala aqui pode chegar no TOM que atende as escolas. Trazer a voz da equipe
// PRA cá é o caminho inverso, e é exatamente o que o dono pediu.
//
// Lido a cada pedido, igual ao FORMATO: editar o SOUL muda a resposta na hora.
function loadSoulDoTom() {
  try {
    // Require tardio de propósito: o módulo de grupo puxa utils próprios e está em mudança por
    // outras frentes. Um problema lá não pode derrubar o canal de ops — sem a voz ele ainda
    // responde, só volta a soar genérico, e o warn diz por quê.
    return String(require('./group-chat-prompt').loadGroupChatSoul() || '').trim();
  } catch (e) {
    console.warn(`[OpsAgent] sem a voz do TOM (soul/SOUL.md): ${e.message}`);
    return '';
  }
}

// O briefing existe pra ele não redescobrir a casa a cada pedido, e pra fixar o que NÃO faz.
function buildBriefing(quem) {
  const soul = loadSoulDoTom();
  const formato = loadFormatoGrupo();
  return `Você é o TOM operando no grupo de engenharia "LA ORGANIZER - TOM", no WhatsApp.
Quem está te pedindo agora: ${quem}. O grupo tem só o Alf (desenvolvedor, dono do produto) e
o Hugo (coordenador de tecnologia) — os dois têm autonomia total sobre este sistema.

Você é o MESMO TOM do 1:1 com a equipe. O que muda aqui é o assunto (engenharia deste sistema)
e o que você pode fazer (tem ferramenta de verdade) — não a pessoa que fala. Nada abaixo te
autoriza a virar um relatório com nome de gente.
${soul ? `
── QUEM VOCÊ É (soul/SOUL.md — a mesma voz do 1:1, não um resumo dela) ──
${soul}
── FIM DE QUEM VOCÊ É ──
` : ''}
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

A disciplina acima é sobre o que você AFIRMA, não sobre como você fala: ela não te transforma
em relatório. O padrão aqui é conversa — responda como o TOM responderia no 1:1, e monte
relatório só quando pedirem um. Não abra a resposta confirmando o recebimento nem repetindo o
pedido de volta: comece pela resposta.
${formato ? `\n${formato}` : ''}`;
}

// ── PEDIDO PERDIDO NO RESTART ──────────────────────────────────────────────────────────────
// Caso Alf, 08/08 19:29: pedido entrou, `pm2 restart` 61s depois (deploy meu), e o grupo
// ficou com o "Tô nisso" pra sempre. O CLI é processo FILHO: mata-se o pai, o filho vai
// junto e o `.then()` que postaria a resposta nunca roda — sem erro, sem log, sem aviso.
// O auto-deploy reinicia a cada push, então isto é o caminho comum, não a exceção.
//
// Não uso `shutdown.trackStart()` de propósito: ele faria TODO deploy esperar 30s à toa
// (o agente leva minutos, o timeout estoura e mata igual). O que resolve o pior sintoma —
// o silêncio — é avisar antes de morrer, via drain hook, que roda sempre antes do exit.
const _emAndamento = new Map();
let _seqPedido = 0;

function _registrarPedido(quem, pedido) {
  const id = ++_seqPedido;
  _emAndamento.set(id, { quem, pedido: String(pedido || ''), iniciadoEm: Date.now() });
  return id;
}
function _concluirPedido(id) { _emAndamento.delete(id); }
function pedidosEmAndamento() { return [..._emAndamento.values()]; }

/** Texto do aviso, ou null quando não havia nada rodando (reinício limpo é silencioso). */
function textoDePedidosPerdidos() {
  const pend = pedidosEmAndamento();
  if (!pend.length) return null;
  const linhas = pend.map((p) => {
    const trecho = p.pedido.length > 90 ? `${p.pedido.slice(0, 90).trimEnd()}…` : p.pedido;
    return `• ${p.quem}: "${trecho}"`;
  });
  return `⚠️ Tive que reiniciar aqui no meio e perdi ${pend.length > 1 ? 'estes pedidos' : 'este pedido'}:\n`
    + `${linhas.join('\n')}\n\nNão cheguei a terminar. Manda de novo que eu faço.`;
}

// O canal de postagem é injetado pelo group-chat-engine (que tem o supabase e o groupId).
// Sem ele o hook degrada pra log — nunca derruba o shutdown.
let _canalAviso = null;
function configurarCanalAviso(fn) { _canalAviso = typeof fn === 'function' ? fn : null; }

/**
 * Corpo do drain hook, com nome e retorno de propósito: pelo caminho real só dá pra exercitar
 * com um SIGTERM de verdade (o handler termina em `process.exit`), e é ele que o gov-runner
 * chama direto — lá o hook registrado abaixo nunca roda, porque aquele processo não instala o
 * graceful shutdown do TOM. Nunca lança: aviso é o último passo antes de sair.
 */
async function avisarPedidosPerdidos() {
  const texto = textoDePedidosPerdidos();
  if (!texto) return { avisou: false, motivo: 'reinício limpo' };
  console.warn(`[OpsAgent] reinício com ${pedidosEmAndamento().length} pedido(s) em andamento`);
  if (!_canalAviso) return { avisou: false, motivo: 'sem canal de aviso configurado' };
  try {
    await _canalAviso(texto);
    return { avisou: true, texto };
  } catch (e) {
    console.error('[OpsAgent] aviso falhou:', e.message);
    return { avisou: false, motivo: e.message };
  }
}

try {
  require('./shutdown').registerDrainHook(avisarPedidosPerdidos);
} catch (e) {
  console.warn('[OpsAgent] sem drain hook de shutdown:', e.message);
}

// ── ACK DO PEDIDO ──────────────────────────────────────────────────────────────────────────
// Era a constante "Tô nisso — já te falo.": a MESMA frase pra um "👀" e pra 40 linhas de
// análise técnica. Quem manda coisa densa lê aquilo como recusa automática de robô — foi a
// queixa do Alf em 31/08, e ele estava certo: o ack não provava que alguém tinha LIDO.
//
// É determinístico DE PROPÓSITO, e isso não é preguiça. O ack é o único retorno que a pessoa
// tem durante uma rodada de até 30 min; gerar por LLM colocaria uma chamada de rede — e uma
// falha possível — na frente da única mensagem que PRECISA sair na hora. Aqui custa zero e
// nunca falha. O que faltava não era prosa bonita: era o ack carregar o que foi entendido.
//
// Devolve SEMPRE string não-vazia: o chamador entrega isso ao `postTomText` e usa o retorno
// como prova de entrega. Devolver null aqui faria o watcher tratar o turno como não-atendido.
const ACK_CURTO_MAX = 40;

/** Itens que a pessoa enumerou: "1." / "2)" / bullet. Só conta linha que ABRE com o marcador. */
function contarItensDoPedido(texto) {
  let n = 0;
  for (const l of String(texto || '').split('\n')) {
    if (/^\s*(?:\d+[.)]\s|[-•*]\s)/.test(l)) n += 1;
  }
  return n;
}

// ECO DE RECEBIMENTO — REMOVIDO EM 04/09. O ack longo devolvia a frase da pessoa entre aspas
// ("👽 Peguei, Alf: '<a pergunta dele>' — vou olhar e te falo"). A intenção de 31/08 era boa
// (provar leitura), mas o efeito medido no grupo foi o oposto do TOM: como o group-chat-engine
// posta o ack em TODO turno do canal, um "coé Tom" também levava a pergunta de volta, e o
// personagem virou formulário de protocolo. Citar o que a pessoa acabou de escrever não é
// conversa em lugar nenhum — é recibo.
//
// O que sobra continua distinguindo as três formas de pedido (o contrato de 31/08 era não ter
// UMA frase só pra tudo): pauta enumerada devolve a CONTA — que ainda prova leitura, porque
// exigiu ler o pedido inteiro —, mensagem curta ganha aceno curto, pedido denso avisa que a
// medição começou. Nenhuma delas repete o que a pessoa disse.
function ackDoPedido(texto, quem = null) {
  const t = String(texto || '').trim();
  const nome = (quem && quem !== 'alguém do grupo') ? `, ${quem}` : '';
  // A CONTA vem antes do corte por tamanho: uma pauta enumerada curta cairia no aceno
  // genérico — mas quem enumera não está batendo papo, está passando pauta. Teste pegou.
  const itens = contarItensDoPedido(t);
  if (itens >= 2) return `👽 Peguei os ${itens}${nome}. Vou medir e te falo.`;
  if (t.length <= ACK_CURTO_MAX) return `👽 Opa${nome} — deixa eu ver aqui.`;
  return `👽 Tô nessa${nome} — vou medir e já te falo.`;
}

// Governança reusa este spawn com protocolo próprio. Extraído em funções puras para o
// zero-regressão do canal de ops ficar provado por teste, e não por leitura.
function resolverBriefing(quem, briefing) {
  return (typeof briefing === 'string' && briefing.trim()) ? briefing : buildBriefing(quem);
}

function resolverTimeout(timeoutMs) {
  return (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0)
    ? timeoutMs : OPS_TIMEOUT_MS;
}

/**
 * Roda o pedido no CLI com ferramentas. Resolve com o texto final do agente.
 * Nunca lança: devolve `{ ok:false, text }` com mensagem já pronta pro grupo.
 */
function _rodarClaude(pedido, { quem = 'alguém do grupo', briefing = null, timeoutMs = null } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-p', String(pedido || '').slice(0, 4000),
      '--model', OPS_MODEL,
      '--allowedTools', ...OPS_TOOLS,
      '--append-system-prompt', resolverBriefing(quem, briefing),
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
    const _limite = resolverTimeout(timeoutMs);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, _limite);
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
        const motivo = code === null ? `passou de ${Math.round(_limite / 60000)} min e eu cortei`
          : `saiu com código ${code}`;
        const cauda = String(err || '').trim().slice(-300);
        // `code`/`err` sobem junto (GOVAGENT-SEM-FALLBACK): quem orquestra precisa saber se foi
        // falta de CAPACIDADE (cota/hang → vale o outro provedor) ou erro de USO (repetiria igual).
        return resolve({ ok: false, text: `Não terminei esse — ${motivo}.${cauda ? `\n\n_${cauda}_` : ''}`, code, err, out });
      }
      resolve({ ok: true, text: texto, custo, modelo: OPS_MODEL });
    });
  });
}

// ── FALLBACK DE PROVEDOR (GOVAGENT-SEM-FALLBACK, 13/08) ───────────────────────────────────────
// Outro PROVEDOR, não outro modelo Claude: a cota é da conta, então quando o Opus cai por
// rate limit o Sonnet cai junto — seria a mesma corda, não uma rede.
const FALLBACK_ON = process.env.TOM_OPS_FALLBACK !== '0';
const FALLBACK_MODEL = process.env.TOM_OPS_FALLBACK_MODEL || 'gpt-5.6-sol';
const FALLBACK_EFFORT = process.env.TOM_OPS_FALLBACK_EFFORT || 'high';
const CODEX_BIN = process.env.CODEX_BIN || 'codex';

function _rodarCodex(pedido, { quem = 'alguém do grupo', briefing = null, timeoutMs = null } = {}) {
  const { argsCodex, stdinCodex } = require('./ops-fallback');
  return new Promise((resolve) => {
    // Arquivo por processo: dois ciclos concorrentes não podem ler a resposta um do outro.
    const arquivoSaida = path.join(os.tmpdir(), `ops-fallback-${process.pid}-${Date.now()}.txt`);
    let child;
    try {
      child = spawn(CODEX_BIN, argsCodex({ modelo: FALLBACK_MODEL, effort: FALLBACK_EFFORT, repo: REPO, arquivoSaida }),
        { cwd: REPO, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, text: `Nem o fallback subiu aqui (${e.message}).` });
    }
    let err = '';
    const _limite = resolverTimeout(timeoutMs);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, _limite);
    child.stdout.on('data', () => {});   // telemetria do codex — a resposta vem pelo arquivo
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, text: `Falhei no fallback: ${e.message}` }); });
    child.on('close', () => {
      clearTimeout(timer);
      let texto = '';
      try { texto = fs.readFileSync(arquivoSaida, 'utf8').trim(); } catch (_) { texto = ''; }
      try { fs.unlinkSync(arquivoSaida); } catch (_) {}
      if (!texto) {
        const cauda = String(err || '').trim().slice(-300);
        return resolve({ ok: false, text: `O fallback (${FALLBACK_MODEL}) também não terminou.${cauda ? `\n\n_${cauda}_` : ''}` });
      }
      resolve({ ok: true, text: texto, custo: null, modelo: FALLBACK_MODEL });
    });
    try { child.stdin.write(stdinCodex(resolverBriefing(quem, briefing), String(pedido || ''))); child.stdin.end(); } catch (_) {}
  });
}

/**
 * Orquestra: Claude primeiro; o outro provedor só quando faltou CAPACIDADE.
 * Nunca lança — devolve `{ok, text}` já pronto pro grupo, como antes.
 */
function runOpsAgent(pedido, opts = {}) {
  const _idPedido = _registrarPedido(opts.quem || 'alguém do grupo', pedido);
  return (async () => {
    try {
      const r = await _rodarClaude(pedido, opts);
      if (r.ok || !FALLBACK_ON) return r;
      const { classifyClaudeExit } = require('../ai/classify-claude-exit');
      const { deveTentarFallback, selarModelo } = require('./ops-fallback');
      const cls = classifyClaudeExit(r.code, r.err || '', r.out || '');
      if (!deveTentarFallback(cls)) return r;
      console.warn(`[OpsAgent] Claude fora (${cls.kind}) — assumindo com ${FALLBACK_MODEL}`);
      const rf = await _rodarCodex(pedido, opts);
      // O selo é obrigatório: sem ele um ciclo do GPT chega ao grupo com a mesma cara de um do
      // Opus, e quem lê aplica a régua de confiança errada.
      return rf.ok ? { ...rf, text: selarModelo(rf.text, FALLBACK_MODEL) } : rf;
    } finally {
      // Baixa o pedido em QUALQUER saída (sucesso, erro, timeout) — um registro que vaza faria
      // o próximo restart avisar sobre pedido que já tinha sido respondido.
      _concluirPedido(_idPedido);
    }
  })();
}

/**
 * Linha de log do que a rodada custou. O canal interativo não tem onde gravar isso no banco
 * (não existe linha em `ritual_logs` pra pedido sob demanda), então o custo vive no log — mesmo
 * dialeto `custo=` que o ciclo automático usa no `detail`, pra um grep só pegar os dois.
 * Sem número, devolve null e ninguém loga: "custo=null" cairia no mesmo grep de quem for somar.
 */
function linhaDeCusto(quem, custo) {
  if (typeof custo !== 'number' || !Number.isFinite(custo)) return null;
  return `[OpsAgent] custo=${Number(custo.toFixed(6))} quem="${quem}"`;
}

module.exports = {
  isOpsChannel, runOpsAgent, buildBriefing, OPS_GROUP_ID, OPS_ALLOWLIST, OPS_ENABLED,
  pedidosEmAndamento, textoDePedidosPerdidos, configurarCanalAviso, avisarPedidosPerdidos,
  resolverBriefing, resolverTimeout, OPS_TIMEOUT_MS, linhaDeCusto,
  ackDoPedido, contarItensDoPedido, ACK_CURTO_MAX,
  _registrarPedido, _concluirPedido,   // expostos para o teste do registro
};
