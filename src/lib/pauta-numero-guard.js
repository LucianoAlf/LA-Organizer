'use strict';
// src/lib/pauta-numero-guard.js — PAUTA-BOMDIA-NUMERO-DO-EXEMPLO (Kailane 03/10 08:01).
// O bom dia disse "26 anamneses pendentes hoje na Barra"; a fonte tinha 19 (o Arthur, 2 min depois,
// recebeu 19). O 26 era o número do EXEMPLO da regra do prompt. O número de anamnese/contrato do
// bom dia é dado da fonte: o código confere linha a linha e troca o que divergir. Pura.
//
// Linha que cita UMA unidade usa a dela; linha sem unidade só é conferida quando a pessoa tem uma
// unidade só. Linha com "total" fica de fora (é o total da unidade, outro número, rotulado).
const UNIDADES = [
  { nome: 'Campo Grande', re: /campo\s+grande|\bCG\b/i },
  { nome: 'Recreio', re: /recreio/i },
  { nome: 'Barra', re: /\bbarra\b/i },
];
const RE_ANAMNESE = /(\d+)(\s+(?:anamneses?\b|alunos?\s+(?:ainda\s+)?sem\s+anamnese))/gi;
const RE_CONTRATO = /(\d+)(\s+(?:contratos?\b|sem\s+contrato))/gi;

function _validas(porUnidade) {
  const m = new Map();
  for (const u of porUnidade || []) {
    if (!u || u.motivo || !Array.isArray(u.anamnese)) continue;
    m.set(u.unidadeNome, { anamnese: u.anamnese.length, contrato: Array.isArray(u.contrato) ? u.contrato.length : null });
  }
  return m;
}

function corrigirNumerosDaPauta(texto, porUnidade) {
  const trocas = [];
  if (typeof texto !== 'string' || !texto) return { texto: texto || '', trocas };
  const fonte = _validas(porUnidade);
  if (!fonte.size) return { texto, trocas };
  const unica = fonte.size === 1 ? [...fonte.keys()][0] : null;
  const linhas = texto.split('\n').map((linha) => {
    if (/\btotal\b/i.test(linha)) return linha;
    const citadas = UNIDADES.filter((u) => u.re.test(linha) && fonte.has(u.nome)).map((u) => u.nome);
    const nome = citadas.length === 1 ? citadas[0] : (citadas.length === 0 ? unica : null);
    if (!nome) return linha;
    const real = fonte.get(nome);
    const fix = (re, campo) => (l) => l.replace(re, (m, n, resto) => {
      const certo = real[campo];
      if (certo == null || Number(n) === certo) return m;
      trocas.push({ unidade: nome, campo, de: Number(n), para: certo });
      return `${certo}${resto}`;
    });
    return fix(RE_CONTRATO, 'contrato')(fix(RE_ANAMNESE, 'anamnese')(linha));
  });
  return { texto: linhas.join('\n'), trocas };
}

module.exports = { corrigirNumerosDaPauta };
