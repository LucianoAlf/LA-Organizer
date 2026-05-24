-- Módulo de Governança: cofre de credenciais da empresa
-- Acesso restrito a director e coordinator via RLS

CREATE TABLE IF NOT EXISTS governance_credentials (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text        NOT NULL,
  categoria     text        NOT NULL CHECK (categoria IN ('whatsapp','api_key','token','vps','social','email','plataforma','outro')),
  servico       text,
  projeto       text,
  responsavel   text,
  campos        jsonb       NOT NULL DEFAULT '[]',
  url_ref       text,
  status        text        NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','atencao','critico')),
  observacoes   text,
  ordem         integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- updated_at automático
CREATE OR REPLACE FUNCTION update_governance_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER governance_credentials_updated_at
  BEFORE UPDATE ON governance_credentials
  FOR EACH ROW EXECUTE FUNCTION update_governance_updated_at();

-- RLS
ALTER TABLE governance_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "governance_select_admin"
  ON governance_credentials FOR SELECT
  USING (current_collab_role() IN ('director','coordinator'));

CREATE POLICY "governance_insert_admin"
  ON governance_credentials FOR INSERT
  WITH CHECK (current_collab_role() IN ('director','coordinator'));

CREATE POLICY "governance_update_admin"
  ON governance_credentials FOR UPDATE
  USING (current_collab_role() IN ('director','coordinator'));

CREATE POLICY "governance_delete_admin"
  ON governance_credentials FOR DELETE
  USING (current_collab_role() IN ('director','coordinator'));

-- Seed: 14 números WhatsApp do mapeamento inicial
INSERT INTO governance_credentials (nome, categoria, servico, projeto, responsavel, status, campos, observacoes) VALUES
  ('Ana — Personal Finance',     'whatsapp', 'Teleria', 'Personal Finance LA', 'Alf',  'ok',      '[{"label":"Número","valor":"(21) 2342-5316","sensivel":false},{"label":"Dispositivo","valor":"Tablet Alf","sensivel":false},{"label":"Local","valor":"Casa do Alf","sensivel":false},{"label":"Integração","valor":"UAZAPI","sensivel":false},{"label":"Custo/mês","valor":"R$9,89","sensivel":false}]', NULL),
  ('Sol — Sucesso do aluno',      'whatsapp', 'Teleria', 'LA Music',            'Hugo', 'ok',      '[{"label":"Número","valor":"(21) 3955-4415","sensivel":false},{"label":"Dispositivo","valor":"Emulador Hugo","sensivel":false},{"label":"Integração","valor":"UAZAPI","sensivel":false},{"label":"Custo/mês","valor":"R$10,99","sensivel":false}]', NULL),
  ('Secretaria Recreio + Sol',    'whatsapp', 'Teleria', 'LA Music Recreio',    'Hugo', 'ok',      '[{"label":"Número","valor":"(21) 3955-1135","sensivel":false},{"label":"Dispositivo","valor":"Emulador Hugo","sensivel":false},{"label":"Integração","valor":"Chatwoot/Waha","sensivel":false},{"label":"Custo/mês","valor":"R$10,99","sensivel":false}]', NULL),
  ('Mila Barra — SDR',            'whatsapp', 'Teleria', 'LA Music Barra',      'Hugo', 'ok',      '[{"label":"Número","valor":"(21) 3955-0932","sensivel":false},{"label":"Dispositivo","valor":"Emulador Hugo","sensivel":false},{"label":"Integração","valor":"Chatwoot/Waha","sensivel":false},{"label":"Custo/mês","valor":"R$10,99","sensivel":false}]', NULL),
  ('Mila Recreio — SDR',          'whatsapp', 'Teleria', 'LA Music Recreio',    'Hugo', 'ok',      '[{"label":"Número","valor":"(21) 3955-2420","sensivel":false},{"label":"Dispositivo","valor":"Emulador Hugo","sensivel":false},{"label":"Integração","valor":"Chatwoot/Waha","sensivel":false},{"label":"Custo/mês","valor":"R$10,99","sensivel":false}]', NULL),
  ('Mila CG — SDR',               'whatsapp', 'TIM',     'LA Music CG',         'Alf',  'atencao', '[{"label":"Número","valor":"(21) 98295-6809","sensivel":false},{"label":"Dispositivo","valor":"Tel. pessoal Alf","sensivel":false},{"label":"Integração","valor":"Chatwoot/Waha","sensivel":false},{"label":"Custo/mês","valor":"R$55","sensivel":false}]', 'Chip TIM no telefone pessoal do Alf'),
  ('Secretaria CG',               'whatsapp', 'TIM',     'LA Music CG',         'Jereh','atencao', '[{"label":"Número","valor":"(21) 96552-9851","sensivel":false},{"label":"Dispositivo","valor":"Tel. Jereh","sensivel":false},{"label":"Integração","valor":"WhatsApp Web","sensivel":false},{"label":"Custo/mês","valor":"~R$20","sensivel":false}]', 'TIM pré-pago, recarga manual'),
  ('Secretaria Barra',            'whatsapp', 'TIM',     'LA Music Barra',      'Hugo', 'atencao', '[{"label":"Número","valor":"(21) 96957-5619","sensivel":false},{"label":"Dispositivo","valor":"Tablet Barra","sensivel":false},{"label":"Local","valor":"Unidade Barra","sensivel":false},{"label":"Integração","valor":"Chatwoot/Waha","sensivel":false},{"label":"Custo/mês","valor":"~R$30","sensivel":false}]', 'TIM pré-pago, recarga manual'),
  ('Alfredo — Coordenador',       'whatsapp', 'Vivo',    'LA Music',            'Alf',  'atencao', '[{"label":"Número","valor":"(21) 99825-0178","sensivel":false},{"label":"Dispositivo","valor":"WhatsApp 2 Alf","sensivel":false},{"label":"Integração","valor":"OpenClaw","sensivel":false}]', 'Custo a confirmar'),
  ('Tom — LA Organizer',          'whatsapp', 'Vivo',    'LA Organizer',        'Hugo', 'atencao', '[{"label":"Número","valor":"(21) 99724-3082","sensivel":false},{"label":"Dispositivo","valor":"Tablet Luciano","sensivel":false},{"label":"Local","valor":"Casa Luciano","sensivel":false},{"label":"Integração","valor":"SDK/OpenClaw","sensivel":false}]', 'Custo a confirmar'),
  ('Mike — Marketing',            'whatsapp', 'NuCell',  'LA Music',            'Hugo', 'ok',      '[{"label":"Número","valor":"(21) 98978-4688","sensivel":false},{"label":"Integração","valor":"OpenClaw","sensivel":false},{"label":"Custo/mês","valor":"R$45","sensivel":false}]', NULL),
  ('Disparador campanhas',        'whatsapp', 'Meta',    'LA Music',            'Hugo', 'atencao', '[{"label":"Número","valor":"(21) 97451-6045","sensivel":false},{"label":"Integração","valor":"Meta API","sensivel":false}]', 'Operadora e custo a confirmar'),
  ('Meta — Sem finalidade 1',     'whatsapp', 'Meta',    'LA Music',            'Hugo', 'atencao', '[{"label":"Número","valor":"(21) 96665-0774","sensivel":false},{"label":"Integração","valor":"Meta API","sensivel":false}]', 'Sem finalidade definida'),
  ('Meta — Sem finalidade 2',     'whatsapp', 'Meta',    'LA Music',            'Hugo', 'ok',      '[{"label":"Número","valor":"(21) 96990-2322","sensivel":false},{"label":"Integração","valor":"Meta API","sensivel":false}]', 'Sem finalidade definida');
