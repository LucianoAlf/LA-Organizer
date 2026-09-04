// Casamento deterministico de credencial proposta contra as existentes.
// Modulo PURO — o engine faz a busca e passa a lista.
//
// Deterministico de proposito: o TASK_UPDATE erra 14% deixando o modelo
// escolher o alvo. Aqui a escolha e do codigo, e havendo duvida o engine
// pergunta em vez de chutar.

function _norm(s) {
  return String(s === undefined || s === null ? '' : s).trim().toLowerCase();
}

function _valoresDe(cred) {
  if (!cred || !Array.isArray(cred.campos)) return [];
  return cred.campos.map(c => _norm(c && c.valor)).filter(Boolean);
}

const ORDEM = { alta: 0, media: 1, baixa: 2 };

function acharDuplicatas(proposta, existentes) {
  if (!proposta || !Array.isArray(existentes)) return [];
  const achados = new Map(); // id -> {cred, motivo, forca}

  const registra = (cred, motivo, forca) => {
    const atual = achados.get(cred.id);
    if (!atual || ORDEM[forca] < ORDEM[atual.forca]) achados.set(cred.id, { cred, motivo, forca });
  };

  const valoresProp = _valoresDe(proposta);
  const nomeProp = _norm(proposta.nome);
  const servProp = _norm(proposta.servico);
  const projProp = _norm(proposta.projeto);

  for (const c of existentes) {
    if (!c || !c.id) continue;

    // ALTA: algum valor de campo identico (e-mail/login ja cadastrado)
    const valoresEx = _valoresDe(c);
    const iguais = valoresProp.filter(v => valoresEx.includes(v));
    if (iguais.length) {
      registra(c, `mesmo valor de campo: ${iguais[0]}`, 'alta');
      continue;
    }

    // MEDIA: mesmo servico E mesmo projeto
    if (servProp && projProp && _norm(c.servico) === servProp && _norm(c.projeto) === projProp) {
      registra(c, `mesmo serviço e projeto: ${c.servico} / ${c.projeto}`, 'media');
      continue;
    }

    // BAIXA: nome de um contido no do outro
    const nomeEx = _norm(c.nome);
    if (nomeProp && nomeEx && (nomeEx.includes(nomeProp) || nomeProp.includes(nomeEx))) {
      registra(c, `nome parecido: ${c.nome}`, 'baixa');
    }
  }

  return [...achados.values()].sort((a, b) => ORDEM[a.forca] - ORDEM[b.forca]);
}

function acharAlvo(termo, existentes) {
  if (!termo || !Array.isArray(existentes)) return { exato: null, candidatos: [] };
  const t = _norm(termo);
  if (!t) return { exato: null, candidatos: [] };

  const exato = existentes.find(c => c && _norm(c.nome) === t) || null;
  if (exato) return { exato, candidatos: [] };

  const candidatos = existentes.filter(c => c && _norm(c.nome).includes(t));
  return { exato: null, candidatos };
}

module.exports = { acharDuplicatas, acharAlvo };
