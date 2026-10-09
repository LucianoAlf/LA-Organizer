'use strict';
// src/ai/cli-cwd.js — pasta de trabalho PRÓPRIA e VAZIA para os CLIs de modelo (Claude e Codex). Alfredo/Alf 09/10.
//
// Incidente 04–09/10: o TOM rodava o CLI com cwd = os.tmpdir() (/tmp), pasta compartilhada por todos os agentes
// do servidor. Um AGENTS.md de outro agente (Mike, marketing) ficou solto em /tmp num deploy e entrou como
// instrução em TODO turno do TOM por 5 dias — ele só não obedeceu porque estranhou (10 avisos no rituals.log).
// Os CLIs carregam AGENTS.md / CLAUDE.md da pasta onde rodam e dos ancestrais. Então o cwd tem de ser uma pasta
// que só o TOM usa, vazia, fora da árvore do projeto (GROUPCHAT-INFRA-LEAK 12/06: no repo ele lia o CLAUDE.md de
// DevOps). FALHA FECHADO: pasta ausente, não vazia ou com arquivo de instrução no caminho → não roda o CLI.
const fs = require('fs');
const path = require('path');

const CLI_CWD = process.env.TOM_CLI_CWD || '/var/lib/tom-cli-cwd';
// nomes que algum CLI lê como instrução de projeto
const INSTRUCAO = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'CLAUDE.local.md', '.claude', '.codex'];

/** @returns {{ok:true, dir:string} | {ok:false, motivo:string}} — PURO sobre fsImpl. */
function conferirCwd(dir = CLI_CWD, fsImpl = fs) {
  try {
    if (!path.isAbsolute(dir)) return { ok: false, motivo: `cwd não absoluto: ${dir}` };
    const st = fsImpl.statSync(dir);
    if (!st.isDirectory()) return { ok: false, motivo: `cwd não é pasta: ${dir}` };
    const dentro = fsImpl.readdirSync(dir);
    if (dentro.length) return { ok: false, motivo: `cwd não está vazio (${dentro.slice(0, 5).join(', ')}): ${dir}` };
    for (let d = path.dirname(dir); ; d = path.dirname(d)) {
      for (const n of INSTRUCAO) if (fsImpl.existsSync(path.join(d, n))) return { ok: false, motivo: `arquivo de instrução no caminho: ${path.join(d, n)}` };
      if (d === path.dirname(d)) break;
    }
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, motivo: `cwd inacessível (${e.code || e.message}): ${dir}` };
  }
}

/** Para os pontos de spawn: devolve a pasta ou um Error kind='spawn' (o caminho de falha que já existe). */
function cwdDoCli(fsImpl = fs) {
  const r = conferirCwd(CLI_CWD, fsImpl);
  if (r.ok) return { dir: r.dir };
  console.error(`[CLI-CWD] 🚨 não rodo o CLI: ${r.motivo}`);
  const err = new Error(`cli_cwd_inseguro: ${r.motivo}`);
  err.kind = 'spawn';
  return { erro: err };
}

module.exports = { conferirCwd, cwdDoCli, CLI_CWD, INSTRUCAO };
