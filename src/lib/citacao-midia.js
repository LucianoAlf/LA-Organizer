'use strict';
// citacao-midia.js — CITACAO-MIDIA-SEM-CONTEUDO (triagem 11/09 — cee727e5).
//
// Anne respondeu citando um ÁUDIO; o WhatsApp manda a citação de mídia sem texto e o webhook
// só escrevia "[O usuário está RESPONDENDO a uma mídia anterior do tipo audio]". O TOM não sabia
// o que tinha sido dito e respondeu "não consegui captar" — com a transcrição salva no banco.
// PURO: recebe a linha de conversation_history achada pelo id da mensagem citada e devolve a
// citação no MESMO formato do reply de texto (stripReplyScaffold, SCAFFOLD_RE e date-phrase já
// leem esse formato), ou null quando não há conteúdo — aí fica o aviso genérico de antes.
const ROTULO = { audio: 'áudio', image: 'imagem', video: 'vídeo', document: 'documento' };

function montarCitacaoDeMidia(tipo, linha) {
  if (!linha) return null;
  const bruto = [linha.content, linha.media_extracted_text, linha.media_caption]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .find(Boolean);
  if (!bruto) return null;
  const limpo = bruto.replace(/^\[[áa]udio transcrito\]\s*/i, '').replace(/"/g, "'").trim();
  if (!limpo) return null;
  const snippet = limpo.length > 1500 ? limpo.slice(0, 1500) + '…' : limpo;
  const rotulo = ROTULO[tipo] || String(tipo || 'mídia');
  return '[O usuário está RESPONDENDO a esta mensagem anterior (' + rotulo + ' — conteúdo do banco): "' + snippet + '"]';
}

module.exports = { montarCitacaoDeMidia };
