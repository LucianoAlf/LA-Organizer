'use strict';
// PHONE-9DIGIT-LOOKUP (caso Vitória 24/06).
//
// Por que existe: a JID do WhatsApp BR às vezes chega SEM o 9º dígito do celular
// (ex.: DDD 31 → `553171422022@s.whatsapp.net`), enquanto o cadastro guarda COM o 9
// (`5531971422022`). O lookup de colaborador fazia `.eq('phone', exato)` → não casava
// → o engine respondia "Não te encontrei no sistema. Fala com seu coordenador". Bug de
// IDENTIDADE, não de cadastro: a pessoa existe e está ativa.
//
// brPhoneVariants gera as duas formas (com/sem o 9) pra o lookup tentar `.in(variants)`.
// Conservador: só mexe no padrão BR celular (DDI 55 + DDD + [9] + 8 dígitos). Qualquer
// outra coisa volta só a forma limpa — nunca inventa número.

/** Só os dígitos. */
function digitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Formas equivalentes de um telefone BR cobrindo a variação do 9º dígito.
 * @param {string} phone
 * @returns {string[]} formas candidatas (deduplicadas); [] se vazio.
 */
function brPhoneVariants(phone) {
  const clean = digitsOnly(phone);
  if (!clean) return [];
  const out = new Set([clean]);
  if (clean.startsWith('55')) {
    const rest = clean.slice(2); // DDD(2) + número
    if (rest.length === 11 && rest[2] === '9') {
      // COM o 9 → adiciona a forma SEM o 9
      out.add('55' + rest.slice(0, 2) + rest.slice(3));
    } else if (rest.length === 10) {
      // SEM o 9 → adiciona a forma COM o 9
      out.add('55' + rest.slice(0, 2) + '9' + rest.slice(2));
    }
  }
  return [...out];
}

module.exports = { digitsOnly, brPhoneVariants };
