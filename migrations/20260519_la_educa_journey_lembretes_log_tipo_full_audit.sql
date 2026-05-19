-- ============================================================
-- 20260519_la_educa_journey_lembretes_log_tipo_full_audit
--
-- Auditoria sistemática após bug do Quintela (estagiario_cadastrado_envio
-- não estava no CHECK constraint). Encontrados mais 5 triggers com o mesmo
-- padrão — tipos novos sem extensão do constraint, causando falhas
-- silenciosas em fluxos do LA Educa e LA Journey:
--
-- la_educa_lembretes_log:
--   • atribuicao_pendente_envio     (atribuir instrutor a estagiário)
--   • certificado_emitido_envio     (emitir certificado)
--   • checkpoint_custom_criado_envio (criar avaliação custom)
--   • nota_anormal_envio            (ancorar nota <5 ou ≥9.5)
--
-- la_journey_lembretes_log:
--   • enviado_revisao    (status rascunho → em_revisao)
--   • publicado          (status em_revisao → publicado)
--   • devolvido          (status em_revisao → rascunho)
--
-- ============================================================

ALTER TABLE la_educa_lembretes_log DROP CONSTRAINT la_educa_lembretes_log_tipo_check;
ALTER TABLE la_educa_lembretes_log ADD CONSTRAINT la_educa_lembretes_log_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'avaliacao_pendente',
    'avaliacao_atrasada',
    'certificado_pronto',
    'estagiario_cadastrado_envio',
    'atribuicao_pendente_envio',
    'certificado_emitido_envio',
    'checkpoint_custom_criado_envio',
    'nota_anormal_envio'
  ]));

ALTER TABLE la_journey_lembretes_log DROP CONSTRAINT la_journey_lembretes_log_tipo_check;
ALTER TABLE la_journey_lembretes_log ADD CONSTRAINT la_journey_lembretes_log_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'campo_pendente',
    'prazo_proximo',
    'atraso',
    'checkpoint_publicado',
    'kickoff',
    'enviado_revisao',
    'publicado',
    'devolvido'
  ]));
