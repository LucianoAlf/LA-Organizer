#!/usr/bin/env node
// scripts/verificar-rpc-params.js
// Confere que TODA chamada supabase.rpc('fn', {...}) no src/ usa parâmetros que existem
// de verdade na função do banco.
//
// POR QUE ISTO EXISTE: em 03/08/2026 o finish do claim de inbound foi escrito com
// `p_reason`, mas a função real tem `p_error`. Os testes unitários passaram — o fake
// supabase aceita qualquer nome de parâmetro. O erro só apareceu em produção, como
// "Could not find the function", DEPOIS da mensagem já ter sido processada.
//
// Teste com dublê prova a lógica de quem chama, nunca o contrato de quem atende. Esta
// checagem bate contra pg_proc, que é a única fonte de verdade.
//
//   node scripts/verificar-rpc-params.js            # exige DATABASE_URL (ou .env)
//
// Sai 0 se todas as chamadas batem; 1 na primeira divergência.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = path.join(ROOT, '.env');
  if (fs.existsSync(env)) {
    const l = fs.readFileSync(env, 'utf8').split('\n').find(x => x.startsWith('DATABASE_URL='));
    if (l) return l.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function arquivosJs(dir, acc = []) {
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    const st = fs.statSync(p);
    if (st.isDirectory()) arquivosJs(p, acc);
    else if (nome.endsWith('.js') && !nome.endsWith('.test.js')) acc.push(p);
  }
  return acc;
}

// Só o cliente do banco do TOM. `_lrc` (LA Report/inventário) e qualquer outro cliente
// falam com OUTRO projeto Supabase — conferir contra este catálogo acusaria função
// inexistente que existe, só que noutro banco. Falso positivo em massa é pior que
// checagem nenhuma: vira ruído, e aí o achado real passa batido.
const CLIENTES_DESTE_BANCO = new Set(['supabase', 'sb', 'client']);

// Extrai {fn, params[]} de cada <cliente>.rpc('fn', { ... }).
// As chaves são colhidas SÓ no primeiro nível do objeto: `p_start_date: (() => { ... new
// Intl.DateTimeFormat('en-CA', { timeZone: ... }) ... })()` tem `timeZone` aninhado, que
// não é parâmetro da RPC. A primeira versão disto marcou exatamente esse caso como erro.
function chavesDeNivel1(s) {
  const chaves = [];
  let prof = 0, aspas = null, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (aspas) {
      if (c === '\\') { i += 2; continue; }
      if (c === aspas) aspas = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { aspas = c; i++; continue; }
    if (c === '{' || c === '(' || c === '[') { prof++; i++; continue; }
    if (c === '}' || c === ')' || c === ']') { prof--; i++; continue; }
    if (prof === 0) {
      const resto = s.slice(i);
      const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/.exec(resto);
      // só conta se for começo de item: início do objeto ou logo após vírgula
      if (m) {
        const antes = s.slice(0, i).replace(/\s+$/, '');
        if (antes === '' || antes.endsWith(',')) { chaves.push(m[1]); i += m[0].length; continue; }
      }
    }
    i++;
  }
  return chaves;
}

function chamadasRpc(codigo, arquivo) {
  const out = [];
  const re = /([a-zA-Z_$][\w$]*)\s*\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]\s*,\s*\{/g;
  let m;
  while ((m = re.exec(codigo)) !== null) {
    const cliente = m[1], fn = m[2];
    let i = re.lastIndex - 1, nivel = 0, fim = -1;
    for (; i < codigo.length; i++) {
      if (codigo[i] === '{') nivel++;
      else if (codigo[i] === '}') { nivel--; if (nivel === 0) { fim = i; break; } }
    }
    if (fim === -1) continue;
    const corpo = codigo.slice(re.lastIndex, fim);
    const linha = codigo.slice(0, m.index).split('\n').length;
    out.push({
      cliente, fn, params: [...new Set(chavesDeNivel1(corpo))],
      arquivo: path.relative(ROOT, arquivo), linha,
      desteBanco: CLIENTES_DESTE_BANCO.has(cliente),
    });
  }
  return out;
}

const url = dbUrl();
if (!url) { console.error('DATABASE_URL ausente'); process.exit(1); }

const chamadas = arquivosJs(SRC).flatMap(f => chamadasRpc(fs.readFileSync(f, 'utf8'), f));
if (!chamadas.length) { console.log('nenhuma chamada .rpc(fn, {...}) encontrada'); process.exit(0); }

// Parâmetros reais, direto do catálogo.
const sql = `select p.proname || '|' || coalesce(array_to_string(p.proargnames, ','), '')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public';`;
const saida = execFileSync('psql', [url, '-qAt', '-c', sql], { encoding: 'utf8' });
const reais = new Map();
for (const linha of saida.split('\n')) {
  if (!linha.trim()) continue;
  const [nome, args] = linha.split('|');
  const lista = (args || '').split(',').filter(Boolean);
  // sobrecarga: aceita o parâmetro se existir em QUALQUER assinatura daquele nome
  if (!reais.has(nome)) reais.set(nome, new Set());
  for (const a of lista) reais.get(nome).add(a);
}

let falhas = 0;
const foraDoBanco = chamadas.filter(c => !c.desteBanco);
for (const c of chamadas.filter(c => c.desteBanco)) {
  if (!reais.has(c.fn)) {
    console.log(`  FALHOU: ${c.arquivo}:${c.linha} chama '${c.fn}' — função não existe em public`);
    falhas++;
    continue;
  }
  const conhecidos = reais.get(c.fn);
  const orfaos = c.params.filter(p => !conhecidos.has(p));
  if (orfaos.length) {
    console.log(`  FALHOU: ${c.arquivo}:${c.linha} '${c.fn}' — parâmetro(s) inexistente(s): ${orfaos.join(', ')}`);
    console.log(`          a função aceita: ${[...conhecidos].join(', ')}`);
    falhas++;
  } else {
    console.log(`  OK   ${c.arquivo}:${c.linha} ${c.fn}(${c.params.join(', ')})`);
  }
}

console.log();
// O que ficou de fora é DECLARADO, não silenciado: cobertura escondida vira "está tudo
// verificado" quando não está.
if (foraDoBanco.length) {
  const clientes = [...new Set(foraDoBanco.map(c => c.cliente))].join(', ');
  console.log(`  (${foraDoBanco.length} chamada(s) NÃO conferidas — cliente de outro projeto Supabase: ${clientes})`);
}
if (falhas) {
  console.log(`=== ${falhas} chamada(s) com parâmetro que o banco não tem ===`);
  process.exit(1);
}
console.log(`=== ${chamadas.length - foraDoBanco.length} chamada(s) .rpc conferem com o banco do TOM ===`);
