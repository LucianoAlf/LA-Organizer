-- LOTE D (REPLY-QUOTE-PROATIVO, spec 2026-06-19)
-- Vincula uma mensagem proativa de saida (lembrete) ao objeto que a originou, para que
-- um reply-quote a esse lembrete resolva o alvo por id EXATO (stanzaID do WhatsApp).
-- A coluna whatsapp_message_id JA existe (ID externo UAZAPI) - so faltam ref_type/ref_id.
-- Nao-destrutivo: 2 colunas nullable + indice parcial. Sem CHECK (evita drift codigo-DB,
-- licao FIN-INVOICE-INTENT-KIND-CONSTRAINT). Linhas antigas seguem validas.
-- Aplicada via Supabase MCP em 2026-06-19 (projeto cesnbnrynvxvgdhfmaua).
ALTER TABLE public.conversation_history
  ADD COLUMN IF NOT EXISTS ref_type text,   -- 'task' | 'event'
  ADD COLUMN IF NOT EXISTS ref_id   uuid;

CREATE INDEX IF NOT EXISTS conversation_history_whatsapp_message_id_idx
  ON public.conversation_history (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;
