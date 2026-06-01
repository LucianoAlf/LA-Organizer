-- Identidade do banco na carteira: slug (→ logo /banks/<slug>.svg) + cor da marca.
ALTER TABLE pf_accounts
  ADD COLUMN IF NOT EXISTS bank_slug text,
  ADD COLUMN IF NOT EXISTS color text;

-- Backfill dos bancos óbvios das carteiras existentes.
UPDATE pf_accounts SET bank_slug='itau',      color='#ec7000' WHERE bank_slug IS NULL AND lower(name) LIKE '%itau%';
UPDATE pf_accounts SET bank_slug='nubank',    color='#820ad1' WHERE bank_slug IS NULL AND lower(name) LIKE '%nubank%';
UPDATE pf_accounts SET bank_slug='santander', color='#ec0000' WHERE bank_slug IS NULL AND lower(name) LIKE '%santander%';
UPDATE pf_accounts SET bank_slug='c6',        color='#242424' WHERE bank_slug IS NULL AND lower(name) LIKE '%c6%';
