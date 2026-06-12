-- GROUPCHAT-FASE4-BACKLOG-FLOOD
-- Guard anti-flood do espelho App→WhatsApp (Fase 4).
-- Quando um work_group é linkado a um grupo de WhatsApp (wa_group_jid gravado), TODO o
-- histórico do chat do app (Fase 3) fica com wa_message_id NULL e o poller de saída
-- (runOutboundOnce) despejaria tudo de uma vez no grupo real. Aconteceu com o Financeiro
-- em 12/06. wa_linked_at marca o corte: só mensagens criadas DEPOIS do link são espelhadas.
-- Não destrutivo: adiciona coluna + trigger; backfill marca grupos já linkados com epoch
-- (= "espelhar tudo que ainda não saiu", preservando o comportamento atual do Financeiro).

ALTER TABLE public.work_groups
  ADD COLUMN IF NOT EXISTS wa_linked_at timestamptz;

-- Auto-stamp: ao gravar wa_group_jid (link) por INSERT ou UPDATE, carimba wa_linked_at=now().
-- Assim qualquer link futuro é protegido sem depender de quem fez o UPDATE lembrar disso.
CREATE OR REPLACE FUNCTION public.set_wa_linked_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.wa_group_jid IS NOT NULL AND NEW.wa_linked_at IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.wa_linked_at := now();
    ELSIF OLD.wa_group_jid IS NULL THEN
      NEW.wa_linked_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_wa_linked_at ON public.work_groups;
CREATE TRIGGER trg_set_wa_linked_at
  BEFORE INSERT OR UPDATE OF wa_group_jid ON public.work_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_wa_linked_at();

-- Backfill: grupos já linkados antes desta migration. Epoch = não drena nada do histórico
-- deles (suas mensagens pendentes legítimas continuam espelhando como hoje). O guard só
-- passa a recortar a partir dos PRÓXIMOS links (trigger carimba now()).
UPDATE public.work_groups
   SET wa_linked_at = '1970-01-01T00:00:00Z'
 WHERE wa_group_jid IS NOT NULL AND wa_linked_at IS NULL;
