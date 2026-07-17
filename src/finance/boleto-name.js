'use strict';
// Nome LIMPO pra conta a pagar extraída de boleto por IA. Hoje o nome sai feio (número da
// apólice, ex: "Apólice 145.431..."). Função pura, zero rede/IO: monta um nome humano a
// partir dos campos extraídos, SEM inventar dado e SEM deixar o número da apólice virar nome
// (por isso o guard final — ver buildBoletoName).

function _s(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Baixa pra minúsculo e remove acentos, só pra casar palavra-chave (nunca usado no texto
// devolvido — o resultado preserva a grafia original de beneficiário/descrição/veículo).
function _fold(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Rejeita string como nome: número de apólice/linha (só dígitos, >=6 depois de tirar
// pontuação) ou texto que explicitamente diz "apólice".
function isPolicyLike(s) {
  const str = _s(s);
  const stripped = str.replace(/[.\-/\s]/g, '');
  if (/^\d+$/.test(stripped) && stripped.length >= 6) return true;
  if (/ap[óo]lice/i.test(str)) return true;
  return false;
}

// "HDI Seguros" -> "HDI". Remove só a família seguro/seguros/segurador/seguradora/
// seguradoras (variações reais de razão social de seguradora), nunca outra palavra.
function _insurerShort(beneficiario) {
  const b = _s(beneficiario);
  if (!b) return b;
  const stripped = b
    .replace(/\b(seguradoras|seguradora|segurador|seguros|seguro)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || b;
}

function buildBoletoName({ beneficiario, descricao, veiculo } = {}) {
  const benef = _s(beneficiario);
  const desc = _s(descricao);
  const veiculoLimpo = _s(veiculo);
  const veiculoPresente = veiculoLimpo !== '' && !isPolicyLike(veiculoLimpo);

  const hay = _fold(`${benef} ${desc}`);
  const isSeguro = /(seguro|seguradora)/.test(hay);
  // hay é folded (sem acento). \b em cada termo: "auto" DENTRO de "autorização/automático"
  // NÃO conta como carro (senão um seguro que não é de carro viraria "Seguro do carro" —
  // confab de nome).
  const auto = /\b(carro|auto|automovel|veiculo)\b/.test(hay);
  const vida = /\bvida\b/.test(hay);
  const resid = /(residencial|imovel|\bcasa\b)/.test(hay);

  let resultado;
  if (veiculoPresente) {
    resultado = `Seguro ${veiculoLimpo}`;
  } else if (isSeguro && auto) {
    resultado = 'Seguro do carro';
  } else if (isSeguro && vida) {
    resultado = 'Seguro de vida';
  } else if (isSeguro && resid) {
    resultado = 'Seguro residencial';
  } else if (isSeguro) {
    const short = _insurerShort(benef);
    resultado = short ? `Seguro ${short}` : 'Seguro';
  } else if (desc && !isPolicyLike(desc)) {
    resultado = desc;
  } else if (benef && !isPolicyLike(benef)) {
    resultado = benef;
  } else {
    resultado = 'Conta a pagar';
  }

  // Guard final: mesmo escolhendo por regra, se o que sobrou ainda parece número de
  // apólice (ex.: insurerShort só tira "Seguros" e deixa "Apólice 12345" no meio),
  // não deixa vazar — cai pro nome genérico.
  if (isPolicyLike(resultado)) {
    resultado = 'Conta a pagar';
  }
  return resultado.slice(0, 60).trim();
}

module.exports = { buildBoletoName, isPolicyLike };
