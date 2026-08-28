#!/bin/bash
# lib-baseline-queries.sh — as consultas que definem o BASELINE estrutural do banco.
#
# Uma fonte só, usada pelo backup-db.sh (que grava) e pelo restore-drill.sh (que confere).
# Antes elas viviam duplicadas nos dois arquivos: bastava editar um e o drill passava a
# comparar contra pergunta diferente da que gerou o baseline — divergência que apareceria
# como "conjunto DIVERGE" sem causa visível.
#
# MUDANÇA (revisão do Alfredo, item 2): antes comparávamos NOMES. Agora cada objeto carrega
# o md5 da sua DEFINIÇÃO. Uma função reescrita, uma policy com predicado trocado, um índice
# com outra expressão ou uma coluna que mudou de tipo passavam batido: o nome continuava lá.
# Também entraram categorias que faltavam: colunas, views, sequences, triggers e types.
#
# Cada linha: "chave|SQL". O SQL devolve UMA coluna de texto por objeto.

BASELINE_QUERIES=(
  "tabelas|select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"

  # Coluna a coluna: pega tipo trocado, NOT NULL removido, default alterado.
  "colunas|select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-') from information_schema.columns where table_schema='public'"

  # Definicao completa da funcao, nao so a assinatura. Exclui membros de extensao.
  "funcoes|select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')"

  "views|select table_name||'|'||md5(coalesce(view_definition,'')) from information_schema.views where table_schema='public'"

  "sequences|select sequence_name||':'||data_type from information_schema.sequences where sequence_schema='public'"

  "triggers|select c.relname||':'||t.tgname||'|'||md5(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal"

  # typtype e do tipo "char": sem ::text o Postgres nao escolhe o operador || (42725).
  # Só enum ('e') e domain ('d'): tipo composto ('c') existe um por tabela e apenas
  # duplicaria o que `tabelas` e `colunas` ja cobrem.
  "types|select t.typname||':'||t.typtype::text||'|'||md5(coalesce((select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'')) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d')"

  # Predicado da policy junto: policy com USING trocado deixa de passar por igual.
  "policies|select tablename||':'||policyname||'|'||md5(coalesce(qual,'')||'/'||coalesce(with_check,'')||'/'||cmd||'/'||coalesce(array_to_string(roles,','),'')) from pg_policies where schemaname='public'"

  "indices|select indexname||'|'||md5(indexdef) from pg_indexes where schemaname='public'"

  "constraints|select c.conrelid::regclass::text||':'||c.conname||'|'||md5(pg_get_constraintdef(c.oid)) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'"

  "grants|select table_name||':'||grantee||':'||privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role')"
  # ACL DE FUNCAO (laudo v2.3): `grants` acima le `role_table_grants` — TABELAS. Nenhuma
  # medicao cobria EXECUTE em funcao, e o drill tolera generico `must be owner of`, entao um
  # restore que perdesse a ACL das funcoes passava aprovado. Sao 45+ funcoes SECURITY DEFINER
  # neste banco: privilegio de funcao nao e detalhe.
  "acl_funcoes|select p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||r.rolname||':EXECUTE' from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (select unnest(array['anon','authenticated','service_role']) as rolname) r where n.nspname='public' and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') and has_function_privilege(r.rolname, p.oid, 'EXECUTE')"
  # ESTADO DAS SEQUENCES (laudo v2.3): `sequences` acima compara nome e tipo — nao o VALOR.
  # Uma sequence restaurada zerada passava. NAO entra na comparacao por identidade: entre o
  # dump e o baseline (~15 s) o TOM pode avancar sequences, o que daria falso vermelho. E
  # comparada com a mesma regra assimetrica das ancoras de dados: restaurado <= baseline.
  "sequences_estado|select sequencename||':'||coalesce(last_value::text,'0') from pg_sequences where schemaname='public'"

  "rls|select c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity"

  "extensoes|select extname from pg_extension"

  # CONTAGEM REAL das tabelas-âncora na ORIGEM. Antes o drill só exigia "> 0": uma tabela
  # que voltasse com 1 linha de 28 mil passava. Agora o número da origem viaja com o dump.
  # O drill compara com tolerância declarada — o pg_dump é um snapshot consistente tirado
  # ANTES desta consulta, então o restaurado é sempre <= este número, e a diferença é o que
  # entrou nos segundos entre um e outro.
  "dados|select t||':'||n::text from (select 'collaborators' t,(select count(*) from public.collaborators) n union all select 'tasks',(select count(*) from public.tasks) union all select 'conversation_history',(select count(*) from public.conversation_history) union all select 'marker_logs',(select count(*) from public.marker_logs) union all select 'health_check_runs',(select count(*) from public.health_check_runs)) s"
)

# Chaves na ordem, para quem precisa iterar sem reparsear.
BASELINE_CHAVES=(tabelas colunas funcoes views sequences triggers types policies indices constraints grants acl_funcoes rls extensoes dados sequences_estado)

# Categorias comparadas por IDENTIDADE (conjunto identico, tolerancia zero). `dados` e
# `sequences_estado` ficam de fora: sao NUMEROS que so crescem entre o dump e a consulta do
# baseline, e comparar numero movel por identidade produz falso vermelho.
BASELINE_CHAVES_IDENTIDADE=(tabelas colunas funcoes views sequences triggers types policies indices constraints grants acl_funcoes rls extensoes)

# Versao do formato. Mudou a lista de categorias ou o SELECT de alguma? Suba isto. O drill
# recusa baseline de versao diferente em vez de comparar consulta nova contra dado velho —
# que produziria centenas de diferencas falsas e um REPROVADO sem sentido.
BASELINE_VERSAO=2
