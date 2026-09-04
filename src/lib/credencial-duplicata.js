// Casamento deterministico de credencial proposta contra as existentes.
// Modulo PURO — o engine faz a busca e passa a lista.
//
// Deterministico de proposito: o TASK_UPDATE erra 14% deixando o modelo
// escolher o alvo. Aqui a escolha e do codigo, e havendo duvida o engine
// pergunta em vez de chutar.

function _norm(s) {
  return String(s === undefined || s === null ? '' : s).trim().toLowerCase();
}

// I-1 (review 04/09): o `motivo` vai INTEIRO pra tela do WhatsApp. Quando o campo que
// casou e um segredo, citar o VALOR devolvia a senha em claro na lista de duplicatas
// ("mesmo valor de campo: hunter2") — justo o que esta feature existe pra proteger.
// A flag `sensivel` e o contrato, mas a lista ja cadastrada tem campo "Senha" sem flag
// nenhuma, entao o label tambem denuncia. Campo nao sensivel (e-mail, login) segue
// mostrando o valor — e ele que torna a mensagem util pra pessoa decidir.
const LABEL_SENSIVEL_RE = /senha|password|passwd|secret|token|api[\s_-]*key|chave|credencial|\bpin\b/i;

function _ehSensivel(campo) {
  if (!campo) return false;
  return Boolean(campo.sensivel) || LABEL_SENSIVEL_RE.test(String(campo.label || ''));
}

// valor normalizado -> campo original (primeira ocorrencia vence, preservando a ordem
// de declaracao: o "primeiro valor que bate" continua sendo o mesmo de antes).
function _indiceValores(cred) {
  const m = new Map();
  if (!cred || !Array.isArray(cred.campos)) return m;
  for (const c of cred.campos) {
    const v = _norm(c && c.valor);
    if (v && !m.has(v)) m.set(v, c);
  }
  return m;
}

const ORDEM = { alta: 0, media: 1, baixa: 2 };

function acharDuplicatas(proposta, existentes) {
  if (!proposta || !Array.isArray(existentes)) return [];
  const achados = new Map(); // id -> {cred, motivo, forca}

  const registra = (cred, motivo, forca) => {
    const atual = achados.get(cred.id);
    if (!atual || ORDEM[forca] < ORDEM[atual.forca]) achados.set(cred.id, { cred, motivo, forca });
  };

  const idxProp = _indiceValores(proposta);
  const nomeProp = _norm(proposta.nome);
  const servProp = _norm(proposta.servico);
  const projProp = _norm(proposta.projeto);

  for (const c of existentes) {
    if (!c || !c.id) continue;

    // ALTA: algum valor de campo identico (e-mail/login ja cadastrado)
    const idxEx = _indiceValores(c);
    let bate = null;
    for (const [v, campoProp] of idxProp) {
      const campoEx = idxEx.get(v);
      if (campoEx) { bate = { v, campoProp, campoEx }; break; }
    }
    if (bate) {
      // Basta UM dos lados marcar o campo como sensivel pra o valor nao aparecer.
      const _sens = _ehSensivel(bate.campoProp) || _ehSensivel(bate.campoEx);
      const _label = _norm(bate.campoEx && bate.campoEx.label)
        ? String(bate.campoEx.label).trim()
        : String((bate.campoProp && bate.campoProp.label) || 'campo').trim();
      registra(c, _sens ? `mesmo valor no campo ${_label}` : `mesmo valor de campo: ${bate.v}`, 'alta');
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
