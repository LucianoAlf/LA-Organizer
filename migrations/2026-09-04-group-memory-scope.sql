-- group_memory.scope — o que é DO GRUPO e o que é DO TOM.
--
-- POR QUÊ (medido em 04/09): a regra "chame a pessoa pelo nome, não com @" estava aprovada e
-- ativa como `lesson` em ADM CG e, com outra redação, em Administração Recreio — e ia nascer uma
-- TERCEIRA na Barra naquela noite. `group_memory.group_id` é NOT NULL e `carregarMemoriasDoGrupo`
-- lia só o grupo corrente, então o dono precisava reensinar a mesma coisa em cada grupo.
--
-- A distinção: uma lição sobre COMO O TOM SE COMPORTA (como fala, como trata as pessoas) vale em
-- todo lugar — ele é uma pessoa só. Uma memória de CONTEXTO LOCAL ("o Arthur cuida da matrícula
-- na Barra") é do grupo por natureza.
--
-- QUEM PROMOVE É A PESSOA, nunca a LLM: a promoção é um verbo no card de aprovação ("aprova a 1
-- pra todos os grupos"), conferido em código contra a frase de quem pediu. Um erro de
-- classificação da LLM contaminaria todos os grupos de uma vez.
--
-- DEFAULT 'group': no dia em que isto subir, NADA muda de comportamento — toda linha existente
-- continua valendo só onde nasceu. O código já está no ar preparado para os dois estados (sem a
-- coluna ele cai no SELECT antigo), então esta migration só LIGA a promoção; ela não conserta
-- nada sozinha e não quebra nada se demorar.
--
-- Idempotente: pode rodar duas vezes.

alter table public.group_memory
  add column if not exists scope text not null default 'group';

alter table public.group_memory
  drop constraint if exists group_memory_scope_chk;

alter table public.group_memory
  add constraint group_memory_scope_chk check (scope in ('group', 'tom'));

-- Índice PARCIAL: a consulta de leitura é
--   where (group_id = $1 or scope = 'tom') and is_active order by occurred_on desc limit 60
-- e o lado global dela é uma fatia pequena da tabela. Indexar (is_active, occurred_on desc)
-- dentro do recorte scope='tom' serve o filtro e a ordenação de uma vez, sem pesar no insert
-- das linhas locais (que não entram no índice).
create index if not exists idx_group_memory_scope_tom
  on public.group_memory (is_active, occurred_on desc) where scope = 'tom';
