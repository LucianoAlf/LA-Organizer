// MEDIA-IMG-CONTEXT-LOST (caso Rose 11/06) — quando o usuário envia imagem/vídeo/PDF,
// o webhook (src/webhook.js) injeta a análise automática DENTRO do `content` da mensagem
// inbound, mas `media_extracted_text` ficava NULL e a janela de histórico que vai pro LLM
// é curta (5 msgs em system.js). Resultado: no 1º turno o TOM lê a imagem; alguns turnos
// depois a inbound da análise sai da janela e o TOM diz "não recebi a imagem aqui".
//
// Este util resolve as duas pontas, sem threading frágil pelo buffer do webhook:
//   1. extractMediaAnalysis(content): detecta o marker determinístico do PRÓPRIO TOM no
//      content e devolve { media_type, media_extracted_text } pra persistir na ingestão.
//   2. renderRecentMediaBlock(recentMedia): monta um bloco pinado no system prompt com as
//      mídias recentes (media_extracted_text != NULL), que SOBREVIVE à janela de 5 msgs.

// Markers escritos pelo webhook ao analisar mídia. São texto do sistema, não input do
// usuário — por isso o match é seguro. Mapeia a frase pro tipo persistido.
const MEDIA_MARKER_RE = /\[O usuário ACABOU DE ENVIAR (uma imagem|um vídeo|um PDF) agora[^\]]*\]\n?/;
const PHRASE_TO_TYPE = {
  'uma imagem': 'image',
  'um vídeo': 'video',
  'um PDF': 'document',
};
const MEDIA_TEXT_CAP = 4000; // mesmo teto de group-chat-media.js

const TYPE_LABEL = { image: 'imagem', video: 'vídeo', document: 'PDF' };

/**
 * Detecta no `content` de uma inbound a análise automática de mídia injetada pelo webhook.
 * Robusto ao buffer de agregação (header "[mensagem i/N]") e ao scaffolding de reply:
 * busca o marker em qualquer posição e corta no próximo limite "[mensagem i/N]".
 * @param {string} content
 * @returns {{ media_type: string, media_extracted_text: string } | null}
 */
function extractMediaAnalysis(content) {
  if (typeof content !== 'string' || !content) return null;
  const m = content.match(MEDIA_MARKER_RE);
  if (!m) return null;
  const media_type = PHRASE_TO_TYPE[m[1]];
  if (!media_type) return null;
  let rest = content.slice(m.index + m[0].length);
  // Se veio agregado em buffer (image numa msg, texto noutra), não engole a próxima.
  const cut = rest.search(/\n\[mensagem \d+\/\d+\]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  const extracted = rest.trim();
  if (!extracted) return null;
  return { media_type, media_extracted_text: extracted.slice(0, MEDIA_TEXT_CAP) };
}

function ageLabel(ts) {
  const min = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  if (min < 60) return `há ${min}min`;
  return `há ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/**
 * Bloco pinado no system prompt com as mídias recentes que o usuário enviou — garante que o
 * TOM continue "enxergando" a análise mesmo depois que a inbound saiu da janela de 5 msgs.
 * @param {Array<{media_type?: string, media_extracted_text?: string, created_at?: string}>} recentMedia
 *   ordenado do mais recente pro mais antigo (order desc na query).
 * @param {{ perItemCap?: number }} [opts]
 * @returns {string} bloco markdown (ou '' se não houver mídia)
 */
function renderRecentMediaBlock(recentMedia, opts = {}) {
  const perItemCap = opts.perItemCap || 1500;
  const rows = (recentMedia || []).filter(r => r && r.media_extracted_text);
  if (!rows.length) return '';
  // Renderiza em ordem cronológica (mais antiga primeiro) pra leitura natural.
  const lines = rows.slice().reverse().map(r => {
    const label = TYPE_LABEL[r.media_type] || 'arquivo';
    const when = r.created_at ? ` · ${ageLabel(r.created_at)}` : '';
    const txt = String(r.media_extracted_text).slice(0, perItemCap);
    return `• [${label}${when}] ${txt}`;
  });
  return `\n\n## 📎 Mídias que o usuário enviou nesta conversa (você JÁ recebeu e analisou)\n\n${lines.join('\n\n')}\n\n**REGRA:** Esses arquivos JÁ chegaram e foram analisados acima — NUNCA diga "não recebi a imagem/arquivo" nem peça pra reenviar. Use a análise pra responder. Só peça reenvio se o usuário falar de um arquivo que NÃO está listado aqui.`;
}

module.exports = { extractMediaAnalysis, renderRecentMediaBlock };
