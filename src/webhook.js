// src/webhook.js — Handler do webhook da UAZAPI
// Formato: { event: "message", instance: "uuid", data: { chatid, sender, text, fromMe, isGroup, messageType, ... } }

const crypto = require('crypto');
const express = require('express');
const { processMessage } = require('./engine');
const whatsapp = require('./services/whatsapp');
const queue = require('./services/per-user-queue');
const dedupe = require('./services/dedupe');
const messageBuffer = require('./services/message-buffer');
const supabase = require('./supabase/client');
const audio = require('./services/audio');
const vision = require('./services/vision');
const gemini = require('./services/gemini');
const statementParse = require('./finance/statement-parse');
const pdfCrypt = require('./finance/pdf-crypt');
const pendingPdf = require('./services/pending-pdf');
const boletoParse = require('./finance/boleto-parse');
const inboundClaim = require('./services/inbound-claim');
const turnClaim = require('./services/turn-claim');

// Fatia 3 do router — claim de inbound. DESLIGADO por padrão: liga com
// TOM_ROUTER_CLAIM=1 no .env. Reversível sem deploy, porque o modo de falha desta
// feature é o TOM ficar mudo, e nesse caso o caminho mais rápido de volta tem que ser
// desligar, não corrigir código.
const CLAIM_ON = process.env.TOM_ROUTER_CLAIM === '1';

// PDF → texto pro engine: extrai boleto/fatura estruturada (Gemini) ou conteúdo cru. null se não leu.
async function pdfToText(buf, mime, caption) {
  const captionLine = caption ? `Legenda enviada pelo usuário: "${caption}"\n` : '';
  // Lê o texto cru UMA vez — serve pra detectar boleto E como fallback (evita chamar 2×).
  const cru = await gemini.analyzeMedia(buf, mime || 'application/pdf', caption);

  // BOLETO primeiro (Alf 17/07): sem isto, o boleto caía no analyzeInvoice e virava "fatura de
  // cartão de 1 item" → pedia o cartão. Testa a assinatura de boleto (linha digitável +
  // vocabulário) no texto cru; se for, extrai estruturado. FAIL-SAFE: qualquer erro na extração
  // NÃO cai no fluxo de cartão — segue pro analyzeInvoice como qualquer PDF.
  try {
    if (cru.ok && boletoParse.looksLikeBoleto(cru.text)) {
      const b = await gemini.analyzeBoleto(buf, caption);
      if (b.ok && b.isBoleto && b.boleto) {
        console.log(`[Webhook] boleto detectado: ${b.boleto.beneficiario || '?'} R$ ${b.boleto.valor}`);
        return `[BOLETO_JSON]${JSON.stringify(b.boleto)}[/BOLETO_JSON]\n${captionLine}Boleto ${b.boleto.beneficiario || ''} · R$ ${Number(b.boleto.valor || 0).toFixed(2)}`;
      }
    }
  } catch (e) { console.warn('[Webhook] rota boleto err (sigo pra fatura):', e.message); }

  const inv = await gemini.analyzeInvoice(buf, caption);
  if (inv.ok && inv.isInvoice && inv.invoice.itens.length > 0) {
    const resumo = `Fatura ${inv.invoice.emissor || ''} · ${inv.invoice.itens.length} compras · total R$ ${Number(inv.invoice.total || 0).toFixed(2)}`;
    console.log(`[Webhook] fatura detectada: ${inv.invoice.itens.length} itens, emissor=${inv.invoice.emissor || '?'}`);
    return `[FATURA_JSON]${JSON.stringify(inv.invoice)}[/FATURA_JSON]\n${captionLine}${resumo}`;
  }
  // fallback: texto cru já lido no topo (não relê).
  if (cru.ok) {
    console.log(`[Webhook] PDF analyzed (${cru.text.length} chars)`);
    return `[O usuário ACABOU DE ENVIAR um PDF agora — primeira vez vendo este arquivo. Conteúdo extraído:]\n${captionLine}${cru.text}`;
  }
  return null;
}
const shutdown = require('./services/shutdown');
const webhookPersistence = require('./services/webhook-persistence');
const pendingInventoryPhoto = require('./services/pending-inventory-photo');
const groupBridgeIn = require('./services/group-chat-bridge-in');
const uazapiGroups = require('./services/uazapi-groups');

const router = express.Router();

// INFLIGHT-LOST-ON-RESTART (caso Rose 09/06 21:45): payloads de mensagens de user
// aceitos mas ainda não CONCLUÍDOS (no buffer 3.5s, na fila per-user ou dentro do
// processMessage). No graceful shutdown, o drain hook salva o que sobrou na fila de
// replay — a mensagem sobrevive ao pm2 restart em vez de evaporar com "digitando…".
const inFlightBodies = new Set();
shutdown.registerDrainHook(async () => {
  if (!inFlightBodies.size) return;
  console.log(`[Webhook] drain: salvando ${inFlightBodies.size} payload(s) in-flight pra replay`);
  for (const b of inFlightBodies) {
    try { await webhookPersistence.saveToQueue(b); }
    catch (e) { console.error('[Webhook] drain save err:', e.message); }
  }
  inFlightBodies.clear();
});

// ---------- Autenticação do webhook ----------
// Modos (controlados por env):
//   - disabled:   WEBHOOK_SECRET vazio → não valida (estado pré-Sprint 4).
//   - permissive: WEBHOOK_SECRET set + WEBHOOK_HMAC_ENFORCE != 'true' → valida e
//                 loga warning se inválido, mas continua processando. Janela de
//                 transição.
//   - strict:     WEBHOOK_SECRET set + WEBHOOK_HMAC_ENFORCE='true' → rejeita 401
//                 quando autenticação ausente ou inválida.
//
// Métodos de autenticação aceitos (em ordem):
//   1) URL token: POST /webhook/<token> — token = WEBHOOK_SECRET no path.
//      Usado pela UAZAPI que não envia headers customizados.
//   2) Static header: WEBHOOK_SIG_HEADER == WEBHOOK_SECRET (constant-time).
//   3) HMAC SHA256: WEBHOOK_SIG_HEADER = 'sha256=<hex>' OU '<hex>' direto,
//      computado sobre o raw body com o secret.
function verifyWebhookSignature(req) {
  const secret = process.env.WEBHOOK_SECRET || '';
  const headerName = (process.env.WEBHOOK_SIG_HEADER || 'x-webhook-signature').toLowerCase();
  const enforce = String(process.env.WEBHOOK_HMAC_ENFORCE || '').toLowerCase() === 'true';

  if (!secret) return { mode: 'disabled', ok: true };

  // 1) URL path token (`/webhook/:token`) — usado pela UAZAPI que não envia headers
  //    customizados. Token vai na URL configurada no painel UAZAPI.
  //    Constant-time comparison contra o secret.
  const urlToken = req.params && typeof req.params.token === 'string' ? req.params.token : '';
  if (urlToken) {
    try {
      const secretBuf = Buffer.from(secret);
      const tokenBuf = Buffer.from(urlToken);
      if (secretBuf.length === tokenBuf.length &&
          crypto.timingSafeEqual(secretBuf, tokenBuf)) {
        return { mode: enforce ? 'strict' : 'permissive', ok: true, method: 'url_token' };
      }
    } catch (_) {}
    return { mode: enforce ? 'strict' : 'permissive', ok: false, reason: 'url_token_mismatch' };
  }

  // 2) Header-based validation (futuro: se UAZAPI ou outro provider passar a enviar)
  const provided = req.headers[headerName];
  if (!provided || typeof provided !== 'string') {
    return { mode: enforce ? 'strict' : 'permissive', ok: false, reason: 'missing_header' };
  }

  // 2a) Static token no header (constant-time)
  try {
    const secretBuf = Buffer.from(secret);
    const providedBuf = Buffer.from(provided);
    if (secretBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(secretBuf, providedBuf)) {
      return { mode: enforce ? 'strict' : 'permissive', ok: true, method: 'static_header' };
    }
  } catch (_) {}

  // HMAC-SHA256 (formato 'sha256=<hex>' ou '<hex>' direto — compatível com GitHub/Stripe style).
  const sigHex = provided.startsWith('sha256=') ? provided.slice(7) : provided;
  if (!/^[a-f0-9]{64}$/i.test(sigHex)) {
    return { mode: enforce ? 'strict' : 'permissive', ok: false, reason: 'malformed' };
  }
  const raw = req.rawBody;
  if (!Buffer.isBuffer(raw) || raw.length === 0) {
    return { mode: enforce ? 'strict' : 'permissive', ok: false, reason: 'no_raw_body' };
  }
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  let match = false;
  try {
    match = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sigHex.toLowerCase(), 'hex'));
  } catch (_) {
    match = false;
  }
  return { mode: enforce ? 'strict' : 'permissive', ok: match, method: 'hmac', reason: match ? null : 'mismatch' };
}

/**
 * Processa o payload de um webhook após autenticação e 200.
 * Extraído do router para permitir replay de webhooks salvos durante graceful
 * shutdown (Sprint WQ). Chamado também por webhook-persistence.replayPending().
 *
 * @param {object} body - req.body original (payload da UAZAPI)
 */
async function processWebhookBody(body) {
  try {
    console.log('[DEBUG] Body:', JSON.stringify(body).substring(0, 2000));

    // Guard 2: dedupe — descarta reentrega do MESMO evento (UAZAPI retry ou curl duplicado).
    // Chave preferencial é o id da mensagem; fallback é hash(phone+content+minuto+event).
    if (dedupe.isDuplicate(body)) {
      console.log(`[Webhook] SKIP duplicate event key=${dedupe.eventKey(body)}`);
      return;
    }

    // Fase 4 v2 — deleção vinda do WhatsApp (messages_update): trata e para (não é msg nova).
    const del = await groupBridgeIn.maybeHandleGroupDelete(supabase, body);
    if (del.handled) return;

    // Fase 4 — espelho de grupo: se a mensagem é de um grupo LINKADO, trata aqui e para.
    // (Grupos não-linkados continuam caindo no isIgnorable abaixo e sendo descartados.)
    const grp = await groupBridgeIn.maybeHandleGroupMessage(supabase, body, {
      extractText: whatsapp.extractText,
      extractMessageId: audio.extractMessageId,
      getGroupParticipants: uazapiGroups.getGroupParticipants,
      mediaDetectors: {
        isAudioMessage: whatsapp.isAudioMessage,
        isImageMessage: whatsapp.isImageMessage,
        isDocumentMessage: whatsapp.isDocumentMessage,
      },
      downloadMedia: async (b) => {
        const mid = audio.extractMessageId(b);
        if (!mid) return null;
        const r = await audio.downloadMediaFromUazapi(mid); // { buffer, mime }
        return r ? { buffer: r.buffer, mime: r.mime } : null;
      },
    });
    if (grp.handled) return;

    // Ignorar mensagens de status, grupo, e do próprio bot
    if (whatsapp.isIgnorable(body)) {
      console.log('[Webhook] SKIP: isIgnorable=true', JSON.stringify(body).substring(0, 300));
      return;
    }

    // Extrair phone e texto
    const phone = whatsapp.extractPhone(body);
    let text = whatsapp.extractText(body);

    if (!phone) {
      console.log('[Webhook] SKIP: no phone extracted', JSON.stringify(body).substring(0, 500));
      return;
    }

    // ---- Audio handling: try transcription, fall back gracefully ----
    if ((!text || typeof text !== 'string') && whatsapp.isAudioMessage(body)) {
      console.log(`[Webhook] audio detected from ${phone.slice(-4)} — attempting transcription`);
      const r = await audio.transcribeAudio(body);
      if (r.ok && r.text) {
        // Prefix signals downstream pickSkill + Claude that the input came
        // from audio — `tratamento-audio` skill is loaded, which mandates
        // confirmation before any action marker is emitted.
        text = `[áudio transcrito] ${r.text}`;
        console.log(`[Webhook] audio transcribed (${r.text.length} chars): ${r.text.slice(0, 80)}`);
      } else {
        const reasons = {
          no_provider: 'recebi seu áudio. Por enquanto eu não tô processando áudio aqui — me manda o mesmo recado em texto, por favor?',
          no_audio_url: 'recebi seu áudio mas não consegui baixar o arquivo. Tenta de novo, ou me manda em texto?',
          download_failed: 'recebi seu áudio, mas tive uma instabilidade pra baixar ele agora (acontece de vez em quando do lado do WhatsApp). Me manda de novo, por favor — costuma funcionar na segunda tentativa. 🙏',
          empty_audio: 'o áudio veio vazio. Manda de novo?',
          transcription_empty: 'não consegui entender o áudio. Pode mandar de novo, ou em texto?',
          transcription_error: 'tive um erro tentando entender o áudio. Pode mandar em texto?',
        };
        const fallback = reasons[r.reason] || 'recebi seu áudio mas não consegui processar. Manda em texto?';
        whatsapp.sendMessage(phone, fallback).catch(e => console.error('[Webhook] audio-fallback send err:', e.message));
        return;
      }
    }

    // ---- PDF protegido aguardando senha: a senha veio numa mensagem SEPARADA (Rose 14/06). ----
    // Se há um PDF travado e chegou um texto com cara de senha, decifra com qpdf e processa.
    if (text && typeof text === 'string' && pendingPdf.has(phone)
        && !whatsapp.isImageMessage(body) && !whatsapp.isVideoMessage(body) && !whatsapp.isDocumentMessage(body)) {
      const senha = pdfCrypt.extractPassword(text);
      if (senha) {
        const pend = pendingPdf.get(phone);
        console.log(`[Webhook] PDF pendente + senha de ${phone.slice(-4)} — decifrando com qpdf`);
        const dec = await pdfCrypt.decryptPdf(pend.buffer, senha);
        if (dec.ok) {
          pendingPdf.clear(phone);
          const t = await pdfToText(dec.buffer, pend.mime, '');
          if (t) { text = t; }
          else { whatsapp.sendMessage(phone, 'Abri o PDF com a senha, mas tive problema pra ler o conteúdo. Cola os lançamentos aqui?').catch(() => {}); return; }
        } else {
          whatsapp.sendMessage(phone, '🔒 Essa senha não abriu o PDF. Confere e me manda de novo (ou cola os lançamentos aqui).').catch(() => {});
          return;
        }
      }
    }

    // ---- Sprint 22.X — Imagem: análise via vision e injeção como texto ----
    if (whatsapp.isImageMessage(body)) {
      const caption = (typeof text === 'string' && text.trim()) ? text.trim() : '';
      console.log(`[Webhook] image detected from ${phone.slice(-4)} caption="${caption.slice(0, 60)}"`);
      const messageId = audio.extractMessageId(body);
      let buf = null, mime = 'image/jpeg';
      if (messageId) {
        try {
          const r = await audio.downloadMediaFromUazapi(messageId);
          buf = r.buffer; mime = r.mime || mime;
        } catch (err) {
          console.warn('[Webhook] image download falhou:', err.message);
        }
      }
      if (!buf) {
        whatsapp.sendMessage(phone, 'recebi sua imagem mas não consegui baixar. Tenta enviar de novo?').catch(() => {});
        return;
      }
      // Guarda a foto pra eventual anexo no inventário — o insert costuma vir
      // turnos depois ("qual sala?"). Consumida no handler <<INVENTORY_ACTION>>.
      try { pendingInventoryPhoto.set(phone, buf.toString('base64'), mime); } catch (e) { /* não-fatal */ }
      const r = await vision.analyzeImage(buf, mime, caption);
      if (r.ok) {
        const captionLine = caption ? `Legenda enviada pelo usuário: "${caption}"\n` : '';
        text = `[O usuário ACABOU DE ENVIAR uma imagem agora — primeira vez vendo este arquivo. Análise automática:]\n${captionLine}${r.text}`;
        console.log(`[Webhook] image analyzed (${r.text.length} chars)`);
      } else {
        const reasons = {
          no_provider: 'recebi sua imagem, mas ainda não tô analisando imagens aqui. Me conta em texto o que tá nela?',
          unsupported_mime: 'recebi um formato de imagem que ainda não consigo ler. Pode mandar como JPG ou PNG?',
        };
        const fallback = reasons[r.reason] || 'recebi sua imagem mas tive um problema pra analisar. Pode descrever em texto?';
        whatsapp.sendMessage(phone, fallback).catch(() => {});
        return;
      }
    }
    // ---- Sprint 22.X — Vídeo: análise via Gemini 3.1 Flash Lite ----
    else if (whatsapp.isVideoMessage(body)) {
      const caption = (typeof text === 'string' && text.trim()) ? text.trim() : '';
      console.log(`[Webhook] video detected from ${phone.slice(-4)} caption="${caption.slice(0, 60)}"`);
      const messageId = audio.extractMessageId(body);
      let buf = null, mime = 'video/mp4';
      if (messageId) {
        try {
          const r = await audio.downloadMediaFromUazapi(messageId);
          buf = r.buffer; mime = r.mime || mime;
        } catch (err) {
          console.warn('[Webhook] video download falhou:', err.message);
        }
      }
      if (!buf) {
        whatsapp.sendMessage(phone, 'recebi seu vídeo mas não consegui baixar. Tenta enviar de novo?').catch(() => {});
        return;
      }
      const r = await gemini.analyzeMedia(buf, mime, caption);
      if (r.ok) {
        const captionLine = caption ? `Legenda enviada pelo usuário: "${caption}"\n` : '';
        text = `[O usuário ACABOU DE ENVIAR um vídeo agora — primeira vez vendo este arquivo. Análise automática:]\n${captionLine}${r.text}`;
        console.log(`[Webhook] video analyzed (${r.text.length} chars)`);
      } else {
        const reasons = {
          no_provider: 'recebi seu vídeo, mas análise de vídeo ainda não tá configurada aqui.',
          file_too_large: 'recebi seu vídeo, mas ele tá maior do que consigo processar. Tenta um trecho menor?',
          unsupported_mime: 'recebi um formato de vídeo que ainda não consigo analisar.',
        };
        const fallback = reasons[r.reason] || 'recebi seu vídeo mas tive um problema pra analisar. Pode descrever em texto o que precisa?';
        whatsapp.sendMessage(phone, fallback).catch(() => {});
        return;
      }
    }
    // ---- Sprint 22.X — Documento: OFX/CSV (parser determinístico) ou PDF (Gemini) ----
    else if (whatsapp.isDocumentMessage(body)) {
      const caption = (typeof text === 'string' && text.trim()) ? text.trim() : '';
      const fileName = whatsapp.extractFileName(body) || '';
      console.log(`[Webhook] document detected from ${phone.slice(-4)} file="${fileName}" caption="${caption.slice(0, 40)}"`);
      const messageId = audio.extractMessageId(body);
      let buf = null, mime = '';
      if (messageId) {
        try {
          const r = await audio.downloadMediaFromUazapi(messageId);
          buf = r.buffer; mime = r.mime || '';
        } catch (err) {
          console.warn('[Webhook] document download falhou:', err.message);
        }
      }
      if (!buf) {
        whatsapp.sendMessage(phone, 'recebi seu documento, mas não consegui baixar. Tenta enviar de novo?').catch(() => {});
        return;
      }
      const lowerName = String(fileName).toLowerCase();
      const head = buf.slice(0, 800).toString('utf8');
      const isOfx = /\.ofx$/.test(lowerName) || /<OFX>|OFXHEADER|<STMTTRN>/i.test(head);
      const isCsv = /\.csv$/.test(lowerName) || mime === 'text/csv';
      const isPdf = mime === 'application/pdf' || /\.pdf$/.test(lowerName) || /^%PDF/.test(head);
      // ---- OFX / CSV: fatura estruturada, parser determinístico (sem LLM). Alf 14/06 ----
      if (isOfx || isCsv) {
        const content = statementParse.decodeBuffer(buf);
        const st = statementParse.statementToInvoice({ filename: fileName, text: content });
        console.log(`[Webhook] statement ${st.ok ? 'OK' : 'FAIL:' + st.reason} fmt=${st.format || '?'} kind=${st.kind || '?'} itens=${st.ok ? st.invoice.itens.length : 0} emissor=${st.ok ? st.invoice.emissor : '?'}`);
        if (st.ok && st.kind === 'account') {
          whatsapp.sendMessage(phone, `Recebi um *extrato de conta* (${st.invoice.itens.length} lançamentos). Por enquanto importo *fatura de cartão*; o extrato de conta tá chegando. 🙏`).catch(() => {});
          return;
        }
        if (st.ok && st.invoice.itens.length > 0) {
          const captionLine = caption ? `Legenda enviada pelo usuário: "${caption}"\n` : '';
          const resumo = `Fatura ${st.invoice.emissor || ''} · ${st.invoice.itens.length} compras · total R$ ${Number(st.invoice.total || 0).toFixed(2)}`;
          text = `[FATURA_JSON]${JSON.stringify(st.invoice)}[/FATURA_JSON]\n${captionLine}${resumo}`;
          console.log(`[Webhook] fatura (${st.format}) detectada: ${st.invoice.itens.length} itens, emissor=${st.invoice.emissor || '?'}`);
        } else {
          whatsapp.sendMessage(phone, 'recebi seu arquivo, mas não consegui ler os lançamentos. Confere se é um OFX/CSV de fatura?').catch(() => {});
          return;
        }
      }
      // ---- PDF: se protegido por SENHA, decifra antes (qpdf); depois análise via Gemini. ----
      else if (isPdf) {
        if (pdfCrypt.isEncryptedPdf(buf)) {
          // 1) MUITAS vezes o /Encrypt é só de DONO/permissões e a senha de usuário é VAZIA (extrato
          //    Mercado Pago/banco abre em qualquer leitor sem pedir nada). Tenta a vazia ANTES de pedir
          //    senha — senão o TOM inventava "tem senha" num PDF que abre normal (Rose 17/07).
          const semSenha = await pdfCrypt.decryptEmptyPassword(buf);
          if (semSenha.ok) {
            buf = semSenha.buffer; // abriu sem senha (restrições removidas); segue e lê
          } else {
            // 2) Precisa de senha de usuário DE VERDADE: tenta a do caption; senão guarda o PDF e pede
            //    (a senha costuma vir em mensagem separada). Rose 14/06.
            let okBuf = null;
            const senhaCaption = pdfCrypt.extractPassword(caption);
            if (senhaCaption) { const dec = await pdfCrypt.decryptPdf(buf, senhaCaption); if (dec.ok) okBuf = dec.buffer; }
            if (!okBuf) {
              pendingPdf.put(phone, { buffer: buf, mime, fileName });
              whatsapp.sendMessage(phone, '🔒 Esse PDF tá protegido por senha. Me manda a senha (pode ser só o número) que eu abro e leio certinho.').catch(() => {});
              return;
            }
            buf = okBuf; // segue com o PDF aberto
          }
        }
        const t = await pdfToText(buf, mime, caption);
        if (t) { text = t; }
        else { whatsapp.sendMessage(phone, 'recebi seu PDF mas tive um problema pra ler. Me conta em texto o que precisa?').catch(() => {}); return; }
      } else {
        whatsapp.sendMessage(phone, 'recebi seu documento. Me conta em texto o que precisa que eu faça com ele?').catch(() => {});
        return;
      }
    }

    if (!text || typeof text !== 'string') {
      console.log('[Webhook] SKIP: no text or non-string text', JSON.stringify(body).substring(0, 500));
      return;
    }

    // ---- Sprint 28 — Reply/quoted: UAZAPI manda quoted truncado (caso Quintela
    // 26/05: TOM mandou msg com 300+ chars, quoted veio só "Registrado!\n").
    // Solução: tenta enriquecer com a msg completa do conversation_history
    // (lookup por prefix nas últimas 48h de outbound desse user). Cai fallback
    // pro snippet se DB não achar.
    try {
      const quoted = whatsapp.extractQuotedMessage(body);
      if (quoted && quoted.text) {
        let fullText = quoted.text;
        let enriched = false;
        try {
          const { data: collab } = await supabase
            .from('collaborators')
            .select('id')
            .or(`phone.eq.${phone},phone.eq.55${phone}`)
            .maybeSingle();
          if (collab?.id) {
            const sinceIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
            const probe = quoted.text.slice(0, 40);
            const { data: rows } = await supabase
              .from('conversation_history')
              .select('content')
              .eq('collaborator_id', collab.id)
              .eq('direction', 'outbound')
              .gte('created_at', sinceIso)
              .order('created_at', { ascending: false })
              .limit(50);
            const match = (rows || []).find(r => typeof r.content === 'string' && r.content.startsWith(probe));
            if (match && match.content.length > quoted.text.length) {
              fullText = match.content;
              enriched = true;
            }
          }
        } catch (lookupErr) {
          console.warn('[Webhook] reply enrichment lookup err:', lookupErr.message);
        }
        const snippet = fullText.length > 1500 ? fullText.slice(0, 1500) + '…' : fullText;
        text = `[O usuário está RESPONDENDO a esta mensagem anterior${enriched ? ' (conteúdo completo do banco)' : ''}: "${snippet}"]\n${text}`;
        console.log(`[Webhook] reply detectado — quoted="${snippet.slice(0, 60)}" enriched=${enriched} len=${snippet.length}`);
      } else if (quoted && quoted.type !== 'text') {
        text = `[O usuário está RESPONDENDO a uma mídia anterior do tipo ${quoted.type}]\n${text}`;
        console.log(`[Webhook] reply a mídia detectado — type=${quoted.type}`);
      }
    } catch (e) {
      console.warn('[Webhook] extractQuotedMessage err (silent):', e.message);
    }

    console.log(`[Webhook] Mensagem de ${phone.slice(-4)}: ${text.substring(0, 50)}`);

    // UX: dispara "digitando..." imediatamente, em paralelo ao engine (Claude leva 6-30s).
    // Fire-and-forget — nunca bloqueia o fluxo principal.
    whatsapp.setTyping(`${phone}@s.whatsapp.net`).catch(() => {});

    // ---- Sprint 28 — Buffer de agregação (debounce 3.5s).
    // Caso real: user manda PDF + 👀 + texto curto em rápida sequência. Sem buffer,
    // cada um vira processMessage isolado; TOM responde 3 vezes e alucina contexto
    // ("chegou duas vezes"). Com buffer, todas as msgs do user dentro da janela
    // viram UMA chamada processMessage com texto concatenado.
    // - per-user-queue continua serializando o flush.
    // - shutdown.withTracking ainda protege em SIGTERM.
    inFlightBodies.add(body); // sai do registro no finally do flush (abaixo)
    messageBuffer.add(phone, text, body, (items) => {
      let combinedText;
      let latestRaw;
      if (items.length === 1) {
        combinedText = items[0].text;
        latestRaw = items[0].raw;
      } else {
        // Header explícito pro TOM saber que são N msgs em sequência (anti-alucinação
        // "chegou duas vezes"). Numera cada uma. Usa o raw da ÚLTIMA pro extractMessageId
        // (reação vai pra última msg do user, que é o gesto mais recente).
        const header = `[O usuário enviou ${items.length} mensagens em rápida sequência. Trate como UM contexto único, não responda cada uma separadamente:]`;
        const numbered = items.map((it, i) => `[mensagem ${i + 1}/${items.length}]\n${it.text}`).join('\n\n');
        combinedText = `${header}\n\n${numbered}`;
        latestRaw = items[items.length - 1].raw;
        console.log(`[Webhook] buffer flush phone=${phone.slice(-4)} items=${items.length} combinedLen=${combinedText.length}`);
      }
      queue.enqueue(phone, () => shutdown.withTracking(async () => {
        // ---- Fatia 3: claim ANTES de processar ----
        // Fica AQUI, e não dentro do engine, por dois motivos: este é o único ponto por
        // onde passam tanto a mensagem nova quanto o REPLAY de restart (handleIncoming é
        // reusado por replayPending), e daqui o claim cobre todos os early-returns do
        // processMessage de graça.
        // decideClaim é fail-open: só três recibos explícitos calam o TOM.
        let _waId = null;
        try { _waId = whatsapp.extractMessageId(latestRaw); } catch (_) { _waId = null; }
        const _claim = await inboundClaim.claimInbound({
          supabase, enabled: CLAIM_ON, waMessageId: _waId, phone,
        });
        if (!_claim.proceed) {
          console.log(`[Claim] SKIP phone=...${String(phone).slice(-4)} motivo=${_claim.reason} id=...${String(_waId).slice(-8)}`);
          for (const it of items) inFlightBodies.delete(it.raw);
          return;
        }
        if (_claim.degraded) {
          console.warn(`[Claim] degradado (${_claim.reason}${_claim.detail ? ': ' + _claim.detail : ''}) — processa assim mesmo`);
        }
        try {
          // Abre o TURNO: daqui pra dentro, todo whatsapp.sendMessage — resposta final,
          // early-return de ramo ou aviso a terceiro — valida a lease antes de sair e
          // registra o outbound amarrado a esta operação. Ver services/turn-claim.js.
          await turnClaim.runInTurn(
            { waMessageId: _waId, leaseToken: _claim.leaseToken, operationId: _claim.operationId },
            () => processMessage(phone, combinedText, latestRaw),
          );
        } finally {
          // Fecha o claim: é o que faz o replay reconhecer `already_completed` depois.
          // Nunca lança — no pior caso a linha vence por lease em vez de fechar limpo.
          const _fin = await inboundClaim.finishInbound({
            supabase, enabled: CLAIM_ON, waMessageId: _waId, leaseToken: _claim.leaseToken,
          });
          if (CLAIM_ON && !_fin.ok && _fin.code !== 'no_lease') {
            console.warn(`[Claim] finish não confirmou: ${_fin.code}${_fin.detail ? ' — ' + _fin.detail : ''}`);
          }
          // Concluiu (ou falhou no app, não em restart): não precisa de replay.
          for (const it of items) inFlightBodies.delete(it.raw);
        }
      }));
    });

  } catch (err) {
    console.error(`[Webhook] Erro ao processar: ${err.message}`);
  }
}

/**
 * POST /webhook (ou /webhook/:token) — Recebe mensagens da UAZAPI.
 *
 * Dois métodos de autenticação suportados:
 *   1. URL token (UAZAPI atual): /webhook/<WEBHOOK_SECRET>
 *      → token vai no path, validado em verifyWebhookSignature.
 *   2. Header HMAC (futuro): X-Webhook-Signature: sha256=<hex>
 *      → suportado para providers que computam HMAC do body.
 */
router.post(['/webhook', '/webhook/:token'], async (req, res) => {
  // 0) HMAC. Em strict mode rejeita ANTES do 200 — UAZAPI deve reenviar até autenticar.
  const sig = verifyWebhookSignature(req);
  if (sig.mode === 'strict' && !sig.ok) {
    console.warn(`[Webhook] REJECT 401 — auth ${sig.reason}`);
    return res.status(401).json({ error: 'invalid_signature' });
  }
  // Responder 200 imediatamente pra UAZAPI não reenviar
  res.status(200).json({ status: 'received' });
  if (sig.mode === 'permissive' && !sig.ok) {
    console.warn(`[Webhook] auth permissive — ${sig.reason} (would-401 in strict mode)`);
  } else if (sig.mode !== 'disabled') {
    console.log(`[Webhook] auth ok (mode=${sig.mode}, method=${sig.method || '?'})`);
  }

  // Sprint WQ — durante graceful shutdown, salva payload no banco em vez de processar.
  // Porta 3100 fica aberta (server.close() removido do shutdown.js), uazapi recebe 200.
  // No próximo startup, index.js chama replayPending() 2s após TOM estar pronto.
  if (shutdown.isInShutdown()) {
    const phone = whatsapp.extractPhone(req.body) || '?';
    console.log(`[Webhook] shutdown — queuing for replay (phone=...${String(phone).slice(-4)})`);
    await webhookPersistence.saveToQueue(req.body);
    return;
  }

  await processWebhookBody(req.body);
});

/**
 * GET /health — Healthcheck
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    agent: 'TOM',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * GET / — Info
 */
router.get('/', (req, res) => {
  res.json({
    agent: '👽 TOM — LA Organizer',
    status: 'running',
    docs: 'https://github.com/LucianoAlf/LA-Organizer',
  });
});

module.exports = router;
module.exports.processWebhookBody = processWebhookBody;
