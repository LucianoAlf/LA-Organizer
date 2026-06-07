#!/usr/bin/env node
'use strict';
//
// TRAVA DE SILÊNCIO (anti-regressão do vazamento de domingo / quiet hours).
//
// Varre o engine procurando envios PROATIVOS (whatsapp.sendMessage) e falha
// (exit 2) se algum NÃO estiver protegido por um gate de silêncio na função que
// o contém. Gate válido = chamada a isQuietNow(...) ou sendProativo(...) dentro
// da mesma função, OU um marcador explícito de isenção no envio/função:
//     // quiet-exempt: <motivo>
//
// Por que existe: o vazamento de domingo (jobs proativos sem gate) reincidiu
// porque o silêncio era checado caller-a-caller e era fácil um job novo esquecer.
// Esta trava torna "esquecer o gate" um erro de build, não um problema jurídico.
//
// Rodada pelo auto-deploy.ps1 ANTES do push e por src/rituals/quiet-gate-guard.test.js.
// Exit: 0 = limpo | 2 = violação (bloqueia deploy) | 1 = erro interno.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// Arquivos REATIVOS: respondem a uma mensagem do usuário (ou são o próprio
// primitivo de envio). Silêncio NÃO se aplica — resposta a humano nunca cala.
const REACTIVE_FILES = new Set([
  'webhook.js',
  'index.js',
  'internal-api.js',
  'engine.js',
  path.join('services', 'whatsapp.js'),
  path.join('services', 'send-proativo.js'),
]);

const SEND_RE = /whatsapp\s*\.\s*sendMessage\s*\(/g;
const GATE_RE = /isQuietNow\s*\(|sendProativo\s*\(/;
const EXEMPT_RE = /quiet-exempt\s*:/;

// Substitui o conteúdo de strings ('...', "...", `...`) e comentários por
// espaços (preservando comprimento e quebras de linha) para que a contagem de
// chaves { } não seja enganada por texto. Não há templates aninhados (`${`...`}`)
// com backticks internos neste código, então o tratamento ingênuo é seguro.
function blankStringsAndComments(code) {
  const out = code.split('');
  let i = 0;
  const n = code.length;
  const blankTo = (start, end) => {
    for (let k = start; k < end && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < n) {
    const c = code[i];
    const c2 = code[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i + 2;
      while (j < n && code[j] !== '\n') j++;
      blankTo(i, j); i = j; continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      blankTo(i, j); i = j; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === c) { j++; break; }
        j++;
      }
      blankTo(i + 1, j - 1); i = j; continue;
    }
    i++;
  }
  return out.join('');
}

// Para o código (já sem strings/comentários), devolve os pares de chaves de
// FUNÇÃO: { cujo char não-branco anterior é ')' (function/method) ou que vem de
// '=>' (arrow). Retorna lista de {open, close}.
function functionBraceSpans(stripped) {
  const spans = [];
  const stack = [];
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') {
      // olha o char não-branco anterior
      let k = i - 1;
      while (k >= 0 && /\s/.test(stripped[k])) k--;
      let isFn = false;
      if (k >= 0) {
        if (stripped[k] === ')') isFn = true;
        else if (stripped[k] === '>' && stripped[k - 1] === '=') isFn = true; // =>
      }
      stack.push({ open: i, isFn });
    } else if (ch === '}') {
      const top = stack.pop();
      if (top && top.isFn) spans.push({ open: top.open, close: i });
    }
  }
  return spans;
}

function lineOf(code, idx) {
  return code.slice(0, idx).split('\n').length;
}

function checkFile(absPath, relPath) {
  const code = fs.readFileSync(absPath, 'utf8');
  const stripped = blankStringsAndComments(code);
  const spans = functionBraceSpans(stripped);

  const violations = [];
  let m;
  SEND_RE.lastIndex = 0;
  while ((m = SEND_RE.exec(stripped)) !== null) {
    const idx = m.index;
    // spans de função que contêm este envio (qualquer nível)
    const enclosing = spans.filter(s => s.open < idx && idx < s.close);
    // isenção na própria linha do envio
    const lineStart = code.lastIndexOf('\n', idx) + 1;
    const lineEnd = code.indexOf('\n', idx);
    const sendLine = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd);

    const gated = enclosing.some(s => {
      const body = code.slice(s.open, s.close);
      return GATE_RE.test(body) || EXEMPT_RE.test(body);
    }) || EXEMPT_RE.test(sendLine);

    if (!gated) {
      violations.push({ line: lineOf(code, idx), snippet: sendLine.trim().slice(0, 80) });
    }
  }
  return violations;
}

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, acc);
    else if (name.endsWith('.js') && !name.endsWith('.test.js')) acc.push(abs);
  }
  return acc;
}

function main() {
  let files;
  try {
    files = walk(SRC, []);
  } catch (e) {
    console.error('[check-quiet-gates] erro ao varrer src/:', e.message);
    process.exit(1);
  }

  const report = [];
  for (const abs of files) {
    const rel = path.relative(SRC, abs);
    if (REACTIVE_FILES.has(rel)) continue;
    try {
      const v = checkFile(abs, rel);
      if (v.length) report.push({ rel, v });
    } catch (e) {
      console.error(`[check-quiet-gates] erro analisando ${rel}:`, e.message);
      process.exit(1);
    }
  }

  if (report.length === 0) {
    console.log('[check-quiet-gates] OK — todo envio proativo está protegido por gate de silêncio.');
    process.exit(0);
  }

  console.error('\n❌ [check-quiet-gates] ENVIO PROATIVO SEM GATE DE SILÊNCIO:\n');
  for (const r of report) {
    console.error(`  ${r.rel}`);
    for (const item of r.v) {
      console.error(`    L${item.line}: ${item.snippet}`);
    }
  }
  console.error('\n  Corrija com isQuietNow()/sendProativo() na função, ou marque o');
  console.error('  envio como isento:  // quiet-exempt: <motivo>\n');
  process.exit(2);
}

if (require.main === module) main();

module.exports = { checkFile, blankStringsAndComments, functionBraceSpans, REACTIVE_FILES, SRC, walk };
