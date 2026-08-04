select category || ' | ' || count(*) || ' casos | ' || count(distinct collaborator_id) || ' pessoas'
  from tom_audit_findings
 where incident_at > now() - interval '30 days'
 group by category order by count(*) desc limit 10;
