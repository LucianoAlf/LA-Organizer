-- ============================================================
-- 20260519_la_educa_lembretes_log_tipo_fix — aplicada via mcp em prod
--
-- Bug: Quintela (e qualquer coordinator) recebia "Falha ao cadastrar"
-- ao tentar cadastrar novo estagiário no LA Educa.
--
-- Causa raiz: trigger_la_educa_estagiario_cadastrado() insere em
-- la_educa_lembretes_log com tipo='estagiario_cadastrado_envio', mas
-- la_educa_lembretes_log_tipo_check só aceitava 3 valores:
-- avaliacao_pendente, avaliacao_atrasada, certificado_pronto.
--
-- O trigger foi criado depois do constraint e não foi acompanhado de
-- migration estendendo o check. INSERT do estagiário falhava silencioso
-- com violação de CHECK constraint na tabela auxiliar — front mostrava
-- "Erro desconhecido" porque o erro vinha do trigger, não do INSERT direto.
--
-- Fix: estende o constraint pra incluir o novo tipo.
-- ============================================================

ALTER TABLE la_educa_lembretes_log DROP CONSTRAINT la_educa_lembretes_log_tipo_check;
ALTER TABLE la_educa_lembretes_log ADD CONSTRAINT la_educa_lembretes_log_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'avaliacao_pendente',
    'avaliacao_atrasada',
    'certificado_pronto',
    'estagiario_cadastrado_envio'
  ]));
