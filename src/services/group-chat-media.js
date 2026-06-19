// src/services/group-chat-media.js
// Chat de grupo Fase 2 — extrai texto de mídia (imagem→Vision, áudio→Whisper) pro contexto.
// Degrada gracioso: nunca lança (o watcher segue mesmo sem extração).
//
// ASSINATURAS REAIS (confirmadas em 2026-06-12):
//   vision.analyzeImage(buffer, mime, userCaption) — exige Buffer (base64 interno), NÃO URL
//   audio.transcribeAudio(body) — exige body do webhook UAZAPI (com message_id) → NÃO serve aqui.
//   audio.whisperTranscribe(buffer, filename, mime, {prompt, language}) — baixo nível, aceita BUFFER.
//
// ADAPTAÇÃO: mensagens do group_chat têm media_url (path de bucket público), sem buffer e sem
// body UAZAPI. Baixamos o buffer via URL pública do bucket e:
//   - imagem → vision.analyzeImage(buffer, mime, caption)
//   - áudio  → audio.whisperTranscribe(buffer, ...) com o glossário de domínio (nomes/marca).
// O áudio do chat vem do MediaRecorder (Fase 1) como arquivo real não-encriptado (webm/ogg/mp3),
// então o Whisper aceita direto — diferente do áudio UAZAPI (ciphertext, exige /message/download).
// PDF: sem extração nesta fase (Vision/Whisper não leem PDF).

const https = require('https');
const http = require('http');
const { URL } = require('url');
const vision = require('./vision');
const audio = require('./audio');
const gemini = require('./gemini');
const statementParse = require('../finance/statement-parse');
const { formatFinancialDoc } = require('../finance/group-doc-format');

// Marca um documento financeiro lido (fatura/extrato) no media_extracted_text → o engine
// oferece salvar nas anotações e usa este texto como BODY determinístico da ficha (Parte 3-B).
const DOC_FIN_PREFIX = '[FATURA/EXTRATO]';

/**
 * Baixa um buffer de uma URL pública (http ou https).
 * Retorna Buffer ou null se falhar.
 */
async function fetchBuffer(publicUrl, timeoutMs = 10000) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(publicUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(publicUrl, { timeout: timeoutMs }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return resolve(null);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Detecta o mime type de imagem a partir da extensão da URL (fallback: image/jpeg).
 */
function mimeFromUrl(url) {
  const ext = (url || '').split('?')[0].split('.').pop().toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  return map[ext] || 'image/jpeg';
}

/**
 * Detecta {filename, mime} de áudio a partir da extensão da URL (fallback: webm — o que o
 * MediaRecorder do Composer da Fase 1 grava por padrão). Whisper aceita webm/ogg/mp3/m4a/wav.
 */
function audioMetaFromUrl(url) {
  const ext = (url || '').split('?')[0].split('.').pop().toLowerCase();
  const map = {
    webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg',
    m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav',
  };
  const safeExt = map[ext] ? ext : 'webm';
  return { filename: `audio.${safeExt}`, mime: map[ext] || 'audio/webm' };
}

async function extractMediaText({ supabase, message }) {
  try {
    if (!message || !message.media_url) return null;

    // media_url já vem como URL pública COMPLETA (o frontend salva getPublicUrl().publicUrl).
    // Chamar getPublicUrl de novo embrulharia a URL duas vezes → download quebra → sem extração.
    // Só resolve via getPublicUrl se vier um path relativo (defensivo p/ chamadas legadas).
    const url = /^https?:\/\//i.test(message.media_url || '')
      ? message.media_url
      : supabase.storage.from('group-chat').getPublicUrl(message.media_url).data?.publicUrl;
    if (!url) return null;

    let extracted = null;

    if (message.kind === 'image') {
      // analyzeImage exige Buffer — baixa o conteúdo da URL pública e passa o buffer.
      const buf = await fetchBuffer(url);
      if (!buf || !buf.length) return null;
      const mime = mimeFromUrl(message.media_url);
      const result = await vision.analyzeImage(buf, mime, message.content || '');
      if (result && result.ok && result.text) {
        extracted = result.text;
      }
    } else if (message.kind === 'audio') {
      // Áudio do bucket é arquivo real não-encriptado → whisperTranscribe direto com buffer.
      if (!audio.isProviderConfigured || !audio.isProviderConfigured()) return null;
      const buf = await fetchBuffer(url);
      if (!buf || !buf.length) return null;
      const { filename, mime } = audioMetaFromUrl(message.media_url);
      // Glossário de domínio (nomes/marca) reduz erro de ASR em nomes próprios.
      let prompt;
      try {
        const names = await audio.getCollaboratorNames();
        prompt = audio.buildTranscriptionPrompt(names);
      } catch (_) { prompt = undefined; }
      const text = await audio.whisperTranscribe(buf, filename, mime, { prompt, language: 'pt' });
      if (text && text.trim()) extracted = text;
    } else if (message.kind === 'pdf') {
      const buf = await fetchBuffer(url);
      if (!buf || !buf.length) return null;
      // ── Parte 3-B: fatura/extrato → conteúdo ESTRUTURADO e CATEGORIZADO (vira ficha sob oferta) ──
      let invoice = null;
      try {
        const fname = String(message.media_filename || '');
        const headTxt = buf.slice(0, 1200).toString('utf8');
        if (/\.(ofx|csv)$/i.test(fname) || /<OFX>|OFXHEADER|<STMTTRN>/i.test(headTxt)) {
          // OFX/CSV: parser determinístico (igual ao 1:1) → invoice categorizável.
          const s = statementParse.statementToInvoice({ filename: fname, text: buf.toString('utf8') });
          invoice = (s && s.invoice && Array.isArray(s.invoice.itens) && s.invoice.itens.length) ? s.invoice : null;
        } else {
          // PDF: Gemini detecta fatura estruturada.
          const inv = await gemini.analyzeInvoice(buf, message.content || '');
          invoice = (inv && inv.ok && inv.isInvoice && inv.invoice && Array.isArray(inv.invoice.itens) && inv.invoice.itens.length) ? inv.invoice : null;
        }
      } catch (e) { console.warn(`[GroupChat] parse fatura/extrato falhou msg=${message.id}: ${e.message}`); }
      if (invoice) {
        extracted = `${DOC_FIN_PREFIX}\n${formatFinancialDoc(invoice)}`;
      } else {
        // PDF comum (não-fatura): Gemini lê o texto (3-A).
        const result = await gemini.analyzeMedia(buf, message.media_mime || 'application/pdf', message.content || '');
        if (result && result.ok && result.text) extracted = result.text;
      }
    } else {
      // demais kinds: sem extração
      return null;
    }

    if (extracted && typeof extracted === 'string' && extracted.trim()) {
      // Doc financeiro pode ter muitos itens → cap maior (preserva itens p/ a ficha). Comum = 4000.
      const cap = extracted.startsWith(DOC_FIN_PREFIX) ? 15000 : 4000;
      await supabase.from('group_chat_messages')
        .update({ media_extracted_text: extracted.trim().slice(0, cap) })
        .eq('id', message.id);
      return extracted.trim();
    }
    return null;
  } catch (err) {
    console.warn(`[GroupChat] extração de mídia falhou msg=${message?.id}: ${err.message}`);
    return null;
  }
}

module.exports = { extractMediaText };
