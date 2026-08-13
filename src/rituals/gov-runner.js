#!/usr/bin/env node
'use strict';
// gov-runner.js — roda UM ciclo do agente de governança, em processo próprio.
//
// POR QUE UM PROCESSO SEPARADO, E NÃO DENTRO DO TICK DO DISPATCHER
// O cron do dispatcher roda sob `flock -n /tmp/la-dispatcher.lock` a cada 5 min. Um ciclo de
// governança leva minutos (refutar + reproduzir + corrigir + suíte inteira; o teto é 30 min).
// Se o tick esperasse por ele, o lock ficaria preso esse tempo todo e TODO o resto do
// dispatcher — lembretes, fila do LA EDUCA ("latência max 5min"), rituais — seria pulado por
// ~6 ticks toda manhã. E não dá pra só não esperar: o dispatcher termina em `process.exit(0)`,
// que mata o `.then()` que posta o resultado. Era assim que um pedido do Alf sumiu em silêncio
// em 08/08 19:29.
//
// Então o tick só DISPARA este processo (detached) e sai. Quem segura o tempo é aqui.
//
// Env e data vêm de fora de propósito: o pai passa o próprio `process.env` (já com o .env
// carregado) e o `--ymd` que ele calculou, então não há um segundo cálculo de data pra
// divergir do dispatcher — nem um toISOString().slice(0,10) que erraria o dia depois das 21h.
//
// Concorrência: o dispatcher chama isto sob `flock -n /tmp/la-gov.lock`. Segundo tick não
// entra. O gate de idempotência aqui dentro é a segunda trava, para o caso do lock estar livre
// porque o ciclo do dia já terminou.

const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const GIT = process.env.TOM_GIT_BIN || '/usr/bin/git';
const PM2 = process.env.TOM_PM2_BIN || '/usr/bin/pm2';

function arg(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : '';
}

// ── O RESTART NÃO FICA COM O LLM ───────────────────────────────────────────────────────────
// Primeira rodada autônoma (09/08 08:21): o agente consertou de verdade, commitou (f368e3b) e
// escreveu no grupo "restart do TOM disparado desacoplado". O processo estava com 12h de
// uptime — o restart não aconteceu, e o fix ficou no disco, fora do processo que atende as
// pessoas. O relatório dizia o contrário.
//
// A ETAPA 7 manda ele disparar desacoplado porque ele é FILHO do processo que reiniciaria.
// Aqui isso deixa de ser problema: o runner é descendente do cron, não do pm2, então pode
// reiniciar o TOM direto — depois de o relatório já ter sido postado.
//
// Só `.js` sob `src/` conta: é o que o processo carrega. Doc e teste mudam sem reiniciar, e
// mexer em `skills/`/`soul/` é violação de limite, não deploy — não vira restart.
function decidirRestart({ arquivosMudados = [], sintaxeOk = true } = {}) {
  const lista = Array.isArray(arquivosMudados) ? arquivosMudados : [];
  const codigo = lista.filter((f) => typeof f === 'string'
    && /^src\/.+\.js$/.test(f.replace(/\\/g, '/'))
    && !/\.test\.js$/.test(f));
  if (!codigo.length) return { restart: false, motivo: 'sem_mudanca_de_codigo', arquivos: [] };
  // Sintaxe quebrada + restart = pm2 em crash-loop e ninguém atendido. É o único desfecho
  // pior do que o fix não subir.
  if (!sintaxeOk) return { restart: false, motivo: 'sintaxe_quebrada', arquivos: codigo };
  return { restart: true, motivo: 'codigo_mudou', arquivos: codigo };
}

// ── INTERRUPÇÃO NO MEIO DO CICLO NÃO PODE MORRER CALADA ────────────────────────────────────
// O ops-agent registra um drain hook que avisa o grupo sobre pedido perdido num restart, mas
// aqui ele nasce órfão: hook só roda dentro do `installGracefulShutdown`, que o index.js
// instala no processo do TOM — e este runner é outro processo, sem handler de sinal nenhum.
// Resultado: `pm2 restart`/deploy no meio do ciclo (até 30 min de Opus 5) matava tudo sem uma
// linha pro grupo. Mesmo desfecho silencioso que a ETAPA 7 existe pra evitar.
//
// Não reusa o graceful shutdown do TOM de propósito: aquele espera a fila de webhooks drenar
// (`activeProcesses`), que aqui é sempre zero. O runner só precisa de: sinal → avisa → sai.
const SINAIS_DE_PARADA = ['SIGTERM', 'SIGINT'];

/** Liga canal + handler de sinal. Devolve a função que desfaz — o teste precisa, produção não. */
function instalarAvisoDeInterrupcao(postar) {
  const opsAgent = require('../services/ops-agent');
  opsAgent.configurarCanalAviso(postar);
  const registrados = SINAIS_DE_PARADA.map((sig) => {
    const h = () => {
      console.warn(`[GovRunner] ${sig} no meio do ciclo — avisando o grupo antes de sair`);
      Promise.resolve(opsAgent.avisarPedidosPerdidos())
        .catch((e) => console.error('[GovRunner] nem o aviso de interrupção foi:', e.message))
        .finally(() => process.exit(0));
    };
    process.on(sig, h);
    return [sig, h];
  });
  return () => {
    for (const [sig, h] of registrados) process.removeListener(sig, h);
    opsAgent.configurarCanalAviso(null);
  };
}

function git(args) {
  try { return execFileSync(GIT, args, { cwd: REPO, encoding: 'utf8' }).trim(); }
  catch (e) { console.error(`[GovRunner] git ${args.join(' ')} falhou: ${e.message}`); return ''; }
}

/** Caminhos que o `git status` reporta como sujos/untracked agora. */
function pathsSujos() {
  return git(['status', '--porcelain']).split('\n')
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

// Sujeira PRÉ-EXISTENTE não é mudança do ciclo. A VPS carrega um `src/system.js` órfão
// (untracked desde 03/08, cópia velha de prompts/system.js que ninguém requer): sem descontar
// o que já estava sujo antes, todo ciclo concluiria "mudou código" e reiniciaria o TOM à toa.
function novosEmRelacaoA(agora, antes) {
  const jaEstava = new Set(Array.isArray(antes) ? antes : []);
  return (Array.isArray(agora) ? agora : []).filter((f) => !jaEstava.has(f));
}

/** Committed durante o ciclo + o que ficou sem commitar. O processo carrega os dois. */
function arquivosAlterados(headAntes, sujosAntes = []) {
  const set = new Set();
  if (headAntes) {
    for (const f of git(['diff', '--name-only', `${headAntes}`, 'HEAD']).split('\n')) {
      if (f.trim()) set.add(f.trim());
    }
  }
  for (const f of novosEmRelacaoA(pathsSujos(), sujosAntes)) set.add(f);
  return [...set];
}

function sintaxeOkDe(arquivos) {
  for (const f of arquivos) {
    try { execFileSync(process.execPath, ['--check', path.join(REPO, f)], { stdio: 'ignore' }); }
    catch (e) { console.error(`[GovRunner] node --check reprovou ${f}`); return false; }
  }
  return true;
}

async function main() {
  // Requires tardios: o teste da decisão de restart não precisa de banco nem do engine.
  const supabase = require('../supabase/client');
  const { rodarCicloGovernanca } = require('../services/governance-agent');
  const { postOpsResult } = require('../services/group-chat-engine');

  const grupo = (process.env.TOM_OPS_GROUP_ID || '').trim();
  const ymd = arg('ymd');
  if (!grupo) return console.error('[GovRunner] sem TOM_OPS_GROUP_ID — nada a fazer');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return console.error(`[GovRunner] --ymd inválido: "${ymd}"`);

  // quiet-exempt: canal de engenharia do Alf e do Hugo, não é envio a colaborador.
  //
  // GATE DE VERBO DE ENTREGA (13/08): ponto ÚNICO de saída do ciclo — todo texto publicado
  // passa aqui, então a trava fica aqui e não espalhada por quem escreve. Em 10/08 o
  // relatório afirmou que o Rafinha "recebeu" o recado; no banco só havia registro de envio.
  // Rebaixa a palavra, não bloqueia o achado: "foi enviado" é a verdade que ele tinha.
  const { rebaixarClaimDeEntrega } = require('../lib/claim-entrega');
  const { conferirNumerosAfirmados } = require('../lib/confere-numero');

  // CAMADA 2 da trava anti-vacuidade: o número que o relatório AFIRMA, conferido contra a
  // fonte. A camada textual não pega isto — ela depende de o agente declarar que não
  // conseguiu ler, e o caso pior não declara nada: afirma errado com confiança. Em 10/08 ele
  // somou "1+9" e escreveu 10; eram 11.
  // Falha na consulta devolve `null` → INDEFINIDO, nunca "conferido".
  const fontesDeControle = async () => {
    const out = { achados: null, corrigidos: null };
    try {
      const { count } = await supabase.from('tom_audit_findings')
        .select('id', { count: 'exact', head: true }).in('status', ['novo', 'confirmado']);
      if (Number.isFinite(count)) out.achados = count;
    } catch (_) { /* indefinido, de propósito */ }
    try {
      const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await supabase.from('tom_known_issues')
        .select('id', { count: 'exact', head: true }).gte('corrigido_em', desde);
      if (Number.isFinite(count)) out.corrigidos = count;
    } catch (_) { /* indefinido, de propósito */ }
    return out;
  };

  const postar = async (txt) => {
    const g = rebaixarClaimDeEntrega(txt);
    if (g.rebaixou) console.log(`[GovRunner] claim de entrega rebaixado: ${g.termos.join(' · ')}`);
    const c = conferirNumerosAfirmados(g.texto, await fontesDeControle());
    if (c.divergiu) {
      console.log(`[GovRunner] CONFERE NÃO BATEU: ${c.conflitos.map((x) => `${x.chave} ${x.afirmado}≠${x.real}`).join(' · ')}`);
    }
    return postOpsResult(supabase, grupo, c.texto);
  };
  instalarAvisoDeInterrupcao(postar);
  const force = process.argv.includes('--force');
  const headAntes = git(['rev-parse', 'HEAD']) || null;
  // Fotografia da sujeira ANTES: o que já estava assim não é obra deste ciclo.
  const sujosAntes = pathsSujos();

  try {
    const r = await rodarCicloGovernanca(supabase, { ymd, force, postar });
    console.log(`[GovRunner] ${ymd} ${JSON.stringify(r)}`);
    if (r && r.rodou) await aplicarRestart(headAntes, sujosAntes, postar);
  } catch (e) {
    // Falhar calado é o pior desfecho: ninguém olha log, e o grupo assume que rodou.
    console.error('[GovRunner] ciclo quebrou:', e.stack || e.message);
    try {
      await postar(`⚠️ O ciclo de governança de hoje quebrou no meio: ${e.message}\n\n`
        + 'Não confie em nada dele. Vou tentar de novo amanhã.');
    } catch (e2) {
      console.error('[GovRunner] nem o aviso foi:', e2.message);
    }
  }
}

/** Roda DEPOIS do relatório já postado. Só fala com o grupo quando houve mudança de código. */
async function aplicarRestart(headAntes, sujosAntes, postar) {
  const mudados = arquivosAlterados(headAntes, sujosAntes);
  const previa = decidirRestart({ arquivosMudados: mudados });
  if (!previa.restart && previa.motivo === 'sem_mudanca_de_codigo') {
    console.log('[GovRunner] nada de código mudou — sem restart');
    return;
  }

  const d = decidirRestart({ arquivosMudados: mudados, sintaxeOk: sintaxeOkDe(previa.arquivos) });
  const lista = d.arquivos.join(', ');
  if (!d.restart) {
    console.error(`[GovRunner] restart RECUSADO (${d.motivo}): ${lista}`);
    try {
      await postar(`⚠️ Mexi em ${lista} mas *não reiniciei*: o arquivo não passa no `
        + '`node --check`. Reiniciar assim derrubaria o TOM em crash-loop. '
        + 'O código está no disco e fora do ar — precisa de olho humano.');
    } catch (_) {}
    return;
  }

  try {
    execFileSync(PM2, ['restart', 'tom'], { stdio: 'ignore' });
    console.log(`[GovRunner] TOM reiniciado — ${lista}`);
    try { await postar(`♻️ TOM reiniciado, o fix está no ar (${lista}).`); } catch (_) {}
  } catch (e) {
    console.error('[GovRunner] pm2 restart falhou:', e.message);
    try {
      await postar(`⚠️ Corrigi ${lista} e commitei, mas *o restart falhou* (${e.message}). `
        + 'O fix está no disco e NÃO está no ar.');
    } catch (_) {}
  }
}

module.exports = {
  decidirRestart, arquivosAlterados, novosEmRelacaoA, pathsSujos, sintaxeOkDe,
  instalarAvisoDeInterrupcao,
};

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[GovRunner] erro fatal:', e); process.exit(1); });
}
