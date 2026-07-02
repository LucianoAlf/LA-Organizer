-- Paridade do ciclo de vida de recorrência p/ EVENTOS (02/07).
-- Bug EVENTS-MATERIALIZE-SERIES-ENDED-COLUMN-MISSING: a Fatia 2 (24/06) pôs
-- .is('series_ended_at', null) no SELECT de templates do materializeAll das DUAS tabelas
-- (tasks E events), mas a coluna só foi adicionada em `tasks`. Logo o SELECT de `events`
-- lança "column events.series_ended_at does not exist" → cai no if(error){continue} →
-- materialização de EVENTO recorrente fica cega desde 24/06 (~9 dias).
-- Fix = paridade da coluna. _cloneTemplate já deleta series_ended_at (instância não herda) e
-- o guard (shouldMaterializeTemplate) já é genérico → nenhum código muda.
alter table events add column if not exists series_ended_at timestamptz null;

-- Forward-only (igual à Fatia 1 das tasks, migration 20260624211825): templates de evento JÁ
-- fechados (done/cancelled) nascem "encerrados" → não ressuscitam ao ligar o filtro.
-- Hoje afeta 0 linhas (único template recorrente = "Reunião ADM" scheduled), mas correto
-- por construção p/ quando uma série de evento for encerrada no futuro.
update events set series_ended_at = updated_at
where recurrence_rule is not null and recurrence_parent_id is null
  and status in ('done','cancelled') and series_ended_at is null;
