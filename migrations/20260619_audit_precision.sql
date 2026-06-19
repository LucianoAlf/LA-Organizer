-- 20260619_audit_precision.sql
-- Precisão da auditoria: tempo real do incidente + veredito de auto-triagem.
-- Aditivo e não-destrutivo (IF NOT EXISTS). Aplicar via Supabase apply_migration.
-- Spec: docs/superpowers/specs/2026-06-19-precisao-auditoria-tom-design.md
ALTER TABLE public.tom_audit_findings
  ADD COLUMN IF NOT EXISTS incident_at         timestamptz,
  ADD COLUMN IF NOT EXISTS incident_confidence text,   -- 'high' | 'low' | 'none'
  ADD COLUMN IF NOT EXISTS auto_triage         jsonb;  -- {decision, matched_code, match_confidence, reason, decided_at}

COMMENT ON COLUMN public.tom_audit_findings.incident_at IS
  'Tempo real do incidente (evidence-anchored). NULL quando desconhecido.';
COMMENT ON COLUMN public.tom_audit_findings.incident_confidence IS
  'Confiança do incident_at: high (casou no evidence) | low (proxy occurred_at) | none.';
COMMENT ON COLUMN public.tom_audit_findings.auto_triage IS
  'Veredito da auto-triagem (finding-triage.js). NUNCA substitui o status humano.';
