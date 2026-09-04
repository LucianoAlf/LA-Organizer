-- PAUTA DE ANAMNESE (spec 2026-09-03)
-- Livro de APARIÇÕES: uma linha por aluno por dia em que ele entrou na pauta do dia.
-- O `resultado` é gravado na passada da noite, lendo a fonte (LA Report).
-- Por que tabela e não as tarefas arquivadas: o título da tarefa carrega o NOME, e nome não é
-- chave (23 "Maria" só no Recreio). `pessoa_chave` é a chave canônica da RPC.
-- 'sem_verificacao' existe porque dia em que a RPC caiu NÃO pode contar contra o aluno.
CREATE TABLE IF NOT EXISTS public.anamnese_pauta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id    uuid NOT NULL,
  pessoa_chave  text NOT NULL,
  dia           date NOT NULL,
  resultado     text,          -- preencheu | nao_preencheu | sem_verificacao | null (dia em curso)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A chave que impede linha dupla quando o ritual roda duas vezes no mesmo slot.
CREATE UNIQUE INDEX IF NOT EXISTS anamnese_pauta_uq
  ON public.anamnese_pauta (unidade_id, pessoa_chave, dia);

-- A contagem da escada lê por (unidade, pessoa) filtrando resultado.
CREATE INDEX IF NOT EXISTS anamnese_pauta_escada_idx
  ON public.anamnese_pauta (unidade_id, pessoa_chave, resultado);

-- Dado de pendência de aluno. Só o ritual (service_role, que ignora RLS) escreve e lê.
-- RLS ligada SEM policy = ninguém mais entra. E revogar de anon/authenticated
-- explicitamente, porque REVOKE de PUBLIC não tira o que foi concedido a esses papéis.
ALTER TABLE public.anamnese_pauta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.anamnese_pauta FROM anon, authenticated;
