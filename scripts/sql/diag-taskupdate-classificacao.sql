with r as (
  select reason, raw_excerpt,
    case
      when reason like 'integrity_%'                              then '3. duplicata (pediu escolha)'
      when reason = 'schema_invalid'                              then '4. schema invalido (falha real)'
      when raw_excerpt ~ 'Confirma o fechamento'                  then '1. pediu CONFIRMACAO (nao e falha)'
      when raw_excerpt ~ 'está marcado pra'                       then '2. avisou data futura (nao e falha)'
      when raw_excerpt is null                                    then '5. sem raw (cego)'
      else '6. outra'
    end as classe
  from marker_logs
  where marker_type='TASK_UPDATE' and result='rejected'
    and created_at > now() - interval '30 days'
)
select classe || ' = ' || count(*) from r group by classe order by classe;
