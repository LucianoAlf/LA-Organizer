'use strict';
// git-paridade.js — o que está em PRODUÇÃO é o que está no git?
//
// Nasceu de dois incidentes reais no mesmo dia (09/08), os dois SILENCIOSOS:
//
// 1. O agente de governança commitou o fix da fatura (9a4dffd) e o commit ficou só na VPS.
//    O próximo `git reset --hard origin/main` do deploy teria apagado o trabalho.
// 2. Um deploy meu rodou `reset --hard` no meio da varredura dele e apagou do disco a
//    correção já testada que ainda não estava commitada. Só o teste untracked denunciou.
//
// Nenhuma das duas quebra nada, loga nada ou falha em teste — o trabalho simplesmente some.
// Este check as transforma em alerta no relatório das 07h.
//
// Não faz `git fetch` de propósito: a direção perigosa é trabalho que existe SÓ aqui, e isso
// se enxerga sem rede. Estar atrás do remoto é inofensivo — o próximo deploy resolve.

const path = require('path');

const MAX_ITENS = 3;   // WhatsApp num celular: cita os primeiros e conta o resto

// Código que o processo REALMENTE carrega, ou a voz do TOM. O resto do que aparece sujo na
// VPS é ruído esperado: `.env` e seus backups, HOME do CLI, logs, artefatos de scratch.
// `.bak`/`.test.js` ficam de fora porque não são o que roda em produção.
function ehRelevante(caminho) {
  const p = String(caminho || '').replace(/\\/g, '/').trim();
  if (!p) return false;
  if (/\.bak(-|$)|\.pre-.*\.bak$/.test(p)) return false;
  if (/\.test\.js$/.test(p)) return false;
  if (/^src\/.+\.js$/.test(p)) return true;
  if (/^(skills|soul)\//.test(p)) return true;
  return false;
}

function _lista(itens) {
  const mostra = itens.slice(0, MAX_ITENS).join(', ');
  const resto = itens.length > MAX_ITENS ? ` (+${itens.length - MAX_ITENS})` : '';
  return `${itens.length}: ${mostra}${resto}`;
}

/**
 * PURA. Recebe o que o git disse e decide. `null` = não deu pra consultar o git, e aí o check
 * degrada para ok/skipped — indisponibilidade de ferramenta não é problema de saúde do TOM.
 */
function avaliarParidade(estado) {
  if (!estado || typeof estado !== 'object') {
    return { status: 'ok', detail: 'git indisponível — paridade não verificada (skipped)' };
  }
  const sujos = (Array.isArray(estado.sujos) ? estado.sujos : []).filter(ehRelevante);
  const commits = Array.isArray(estado.commitsNaoEmpurrados) ? estado.commitsNaoEmpurrados.filter(Boolean) : [];

  const partes = [];
  if (sujos.length) partes.push(`código fora do git — ${_lista(sujos)}`);
  if (commits.length) {
    const shas = commits.slice(0, MAX_ITENS).map((c) => String(c).split(/\s+/)[0]);
    const resto = commits.length > MAX_ITENS ? ` (+${commits.length - MAX_ITENS})` : '';
    partes.push(`${commits.length} commit(s) não empurrado(s) — ${shas.join(', ')}${resto}; o próximo reset --hard apaga`);
  }

  if (!partes.length) return { status: 'ok', detail: 'Produção em paridade com o git' };
  return { status: 'warning', detail: `Paridade git↔produção: ${partes.join(' · ')}` };
}

/** Lê o estado do git. Nunca lança: qualquer falha vira `null` e o check degrada. */
function lerEstadoGit({ repo = path.join(__dirname, '..', '..'), gitBin = process.env.TOM_GIT_BIN || '/usr/bin/git' } = {}) {
  try {
    const { execFileSync } = require('child_process');
    const git = (args) => execFileSync(gitBin, args, { cwd: repo, encoding: 'utf8', timeout: 15000 }).trim();
    const sujos = git(['status', '--porcelain'])
      .split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    // Se não houver upstream configurado, o comando falha e cai no catch — correto: sem
    // referência remota não dá pra afirmar nada sobre paridade.
    const commits = git(['log', '--oneline', 'origin/main..HEAD'])
      .split('\n').map((l) => l.trim()).filter(Boolean);
    return { sujos, commitsNaoEmpurrados: commits };
  } catch (e) {
    console.warn('[git-paridade] não consegui ler o git:', e.message);
    return null;
  }
}

module.exports = { avaliarParidade, lerEstadoGit, ehRelevante };
