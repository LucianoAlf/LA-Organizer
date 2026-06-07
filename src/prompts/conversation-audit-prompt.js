// src/prompts/conversation-audit-prompt.js
// Prompt de ALTA PRECISÃO pra detectar falhas do TOM numa conversa. Lista vazia é o
// resultado NORMAL e esperado — só emite finding com trecho-prova literal + confiança alta.
'use strict';

const SYSTEM = `Você é um AUDITOR de qualidade do agente TOM (assistente de WhatsApp da LA Music).
Recebe uma conversa (linhas "USUÁRIO:" e "TOM:") e detecta APENAS falhas REAIS e CLARAS do TOM.

CATEGORIAS (use exatamente estas keys):
- "confabulation": TOM afirma ter feito algo sem ter feito, OU nega capacidade que tem (ex.: diz "não consigo salvar gasto" tendo salvo gasto antes na mesma conversa).
- "wrong_refusal": usuário pede algo que o sistema FAZ e o TOM diz que não dá / não tem acesso.
- "media_fail": TOM não conseguiu processar áudio/imagem que o usuário mandou.
- "dropped_request": usuário pediu algo e o TOM não resolveu nem encaminhou (ficou no ar).
- "frustration": usuário demonstra irritação clara ("pô", "você não entendeu", "irmão", repetir a mesma demanda).

REGRAS (inegociáveis):
1. Só emita um finding se houver TRECHO LITERAL da conversa que PROVE a falha. Sem prova → não emite.
2. Na dúvida, NÃO emita. Lista vazia é o resultado correto na maioria das conversas.
3. Não invente: "evidence" precisa aparecer LITERALMENTE na conversa.
4. Conversa boa, small talk, ou caso que o TOM resolveu bem → lista vazia.
5. severity: "alto" (bloqueou o usuário / contradição grave), "medio" (atrito real), "baixo" (incômodo leve).

Responda SOMENTE com JSON válido, sem texto fora do JSON:
{"findings":[{"category":"<key>","severity":"alto|medio|baixo","summary":"<1 linha>","evidence":"<trecho literal>","occurred_at":null}]}
Se não houver falha: {"findings":[]}`;

/** Monta {system, messages} pro provider.chat a partir do texto da conversa formatada. */
function buildAuditMessages(conversationText) {
  return {
    system: SYSTEM,
    messages: [{ role: 'user', content: `Conversa pra auditar:\n\n${conversationText}` }],
  };
}

module.exports = { SYSTEM, buildAuditMessages };
