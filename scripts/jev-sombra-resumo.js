'use strict';
// scripts/jev-sombra-resumo.js — resumo da SOMBRA do Jev (Alf 09/10). Só lê logs/jev-sombra.jsonl.
// Uso: node scripts/jev-sombra-resumo.js [AAAA-MM-DD] [AAAA-MM-DD]   (sem data = tudo; uma data = só o dia)
// Responde: acerto por assunto (Jev × pickSkill × marcador que o TOM emitiu), pedidos que o Jev viu e o TOM
// não emitiu marcador, e assuntos pedidos que o TOM não tem como gravar.
const fs = require('fs');
const path = require('path');
const { resumir } = require('../src/lib/jev-sombra-resumo');

const arq = path.join(__dirname, '..', 'logs', 'jev-sombra.jsonl');
const [de, ate] = process.argv.slice(2);
const linhas = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const sp = (ts) => new Date(new Date(ts).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const sel = linhas.filter((l) => (!de || sp(l.ts) >= de) && (!(ate || de) || sp(l.ts) <= (ate || de)));
console.log(resumir(sel));
