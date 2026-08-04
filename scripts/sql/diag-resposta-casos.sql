with f as (
  select id, collaborator_id, incident_at, left(summary, 95) as sumario
    from tom_audit_findings
   where category = 'dropped_request'
     and incident_at is not null
     and incident_at > now() - interval '25 days'
     and summary ~* '(confirm|marcou|informou|já (fiz|foi|est)|feito|conclu|atualiza|corrigiu|autoriz|respondeu)'
   order by incident_at desc
   limit 8
)
select '════ CASO ' || row_number() over (order by f.incident_at desc) || ' — ' || f.sumario || E'\n' ||
  coalesce((
    select string_agg(
             to_char(ch.created_at at time zone 'America/Sao_Paulo','HH24:MI') || ' ' ||
             case ch.direction when 'inbound' then 'USER' else 'TOM ' end || ': ' ||
             left(regexp_replace(ch.content, '\s+', ' ', 'g'), 105), E'\n' order by ch.created_at)
      from conversation_history ch
     where ch.collaborator_id = f.collaborator_id
       and ch.created_at between f.incident_at - interval '3 minutes' and f.incident_at + interval '3 minutes'
  ), '(sem conversa na janela)')
  || E'\n  MARKERS: ' ||
  coalesce((
    select string_agg(ml.marker_type || '/' || ml.result || coalesce(':' || left(ml.reason, 35), ''), ' · ' order by ml.created_at)
      from marker_logs ml
     where ml.collaborator_id = f.collaborator_id
       and ml.created_at between f.incident_at - interval '3 minutes' and f.incident_at + interval '3 minutes'
  ), '>>> NENHUM MARKER <<<')
from f;
