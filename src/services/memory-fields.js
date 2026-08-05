// src/services/memory-fields.js
// Normalização do conteúdo de uma linha de <<MEMORY_SAVE>>.
//
// POR QUE ISTO EXISTE (caso Matheus, 04/08/2026)
// Ele pediu três vezes, em maiúsculas, que não o cobrassem antes de quinta. As duas
// primeiras tentativas foram recusadas pelo NOSSO validador: o TOM escreveu o texto no
// campo `body`, e o parser aceitava apenas content/text/value. Deu
// `MEMORY_SAVE/rejected:schema_invalid`, nada persistiu, e o TOM respondeu "anotado"
// assim mesmo — então ele repetiu, e se irritou com razão.
//
// O contrato era mais estreito que a variação natural do modelo. `body` é inequívoco:
// nenhuma outra parte do payload disputa esse nome. Aceitar não afrouxa o contrato,
// alinha ele com o que o emissor de fato produz.
//
// A segunda metade do conserto é a instrumentação: quando NENHUMA chave casa, o motivo
// passa a nomear as chaves recebidas. Sem isso, cada campo novo custa uma escavação no
// banco — foi exatamente o que custou aqui.
'use strict';

// Ordem = precedência. `content` é o canônico; os outros são variações observadas.
const CHAVES_CONTEUDO = ['content', 'text', 'value', 'body'];

function extrairConteudoMemoria(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, content: null, motivo: 'missing_content:row_invalido' };
  }
  for (const k of CHAVES_CONTEUDO) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return { ok: true, content: v, motivo: null };
  }
  const chaves = Object.keys(row).slice(0, 8).join(',');
  return { ok: false, content: null, motivo: `missing_content:keys=${chaves || '(vazio)'}` };
}

module.exports = { extrairConteudoMemoria, CHAVES_CONTEUDO };
