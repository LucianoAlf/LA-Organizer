# Ledger de Incidentes do TOM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a tabela `tom_known_issues` (ledger curado de incidentes) + um avaliador na auditoria diária que detecta regressões ("corrigido que voltou").

**Architecture:** Tabela no Supabase + uma função SQL `evaluate_known_issues()` (RPC) que faz match de sinais contra `marker_logs`, atualiza contadores e retorna regressões. O `health-check.js` (auditoria das 07:00, já existente) chama a RPC e adiciona uma seção de regressões no relatório. Sem cron novo, sem UI.

**Tech Stack:** Postgres/Supabase (projeto `cesnbnrynvxvgdhfmaua`), Node.js (`src/rituals/health-check.js`), deploy via SCP pro VPS `tom` + auto-deploy hook pro git.

**Notas de ambiente:**
- Aplicar SQL: Supabase MCP `apply_migration` / `execute_sql` (projeto `cesnbnrynvxvgdhfmaua`). Sempre permitido.
- Deploy de `.js`: `scp D:/la-organizer/_remote/<path> tom:/opt/LA-Organizer/<path>`. O health-check roda dentro do cron `node src/rituals/dispatcher.js` — SCP basta (sem restart). `pm2 restart tom` é seguro se quiser.
- Git: NÃO commitar manualmente — o auto-deploy hook (Stop) commita `_remote/` no fim do turno. Migrations SQL ficam versionadas em `supabase/migrations/`.
- Não há framework de teste formal; "testes" = queries SQL de verificação (via MCP) + script node smoke quando aplicável.

---

### Task 1: Migration — tabela `tom_known_issues` + RPC `evaluate_known_issues()`

**Files:**
- Create: `supabase/migrations/20260529150000_tom_known_issues.sql`

- [ ] **Step 1: Escrever a migration (schema + índices + checks + RPC)**

Conteúdo do arquivo:

```sql
-- Sprint 31.7 — Ledger curado de incidentes do TOM (Pilar 1).
create table if not exists public.tom_known_issues (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text unique not null,
  titulo                 text not null,
  area                   text not null,
  severidade             text not null check (severidade in ('critico','alto','medio','baixo')),
  status                 text not null default 'aberto' check (status in ('aberto','corrigido','wontfix')),
  causa_raiz             text,
  fix_resumo             text,
  sinal_tipo             text not null default 'manual' check (sinal_tipo in ('marker_log','manual')),
  sinal_padrao           text,
  colaboradores_afetados text[] not null default '{}',
  primeira_vez           timestamptz,
  ultima_vez             timestamptz,
  ocorrencias            int not null default 0,
  corrigido_em           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_known_issues_status_sev on public.tom_known_issues (status, severidade);
create index if not exists idx_known_issues_ultima_vez on public.tom_known_issues (ultima_vez desc);

alter table public.tom_known_issues enable row level security;
-- Stance de dev: só service-role acessa (dado operacional interno). Travar/expandir p/ produção.
drop policy if exists known_issues_service_all on public.tom_known_issues;
create policy known_issues_service_all on public.tom_known_issues
  for all to service_role using (true) with check (true);

-- Avaliador server-side: faz o match do sinal contra marker_logs (24h), atualiza
-- contadores/última-vez/afetados, e retorna as regressões (corrigido que voltou).
create or replace function public.evaluate_known_issues()
returns table(codigo text, titulo text, corrigido_em timestamptz, ocorrencias_novas int, afetados text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_n int;
  v_last timestamptz;
  v_names text[];
begin
  for rec in
    select id, codigo, titulo, sinal_padrao, status, corrigido_em
    from public.tom_known_issues
    where sinal_tipo = 'marker_log' and sinal_padrao is not null
  loop
    select count(*),
           max(ml.created_at),
           array_agg(distinct c.full_name) filter (where c.full_name is not null)
      into v_n, v_last, v_names
    from public.marker_logs ml
    left join public.collaborators c on c.id = ml.collaborator_id
    where (ml.marker_type || ' ' || coalesce(ml.reason,'')) ilike rec.sinal_padrao
      and ml.created_at > now() - interval '24 hours';

    if v_n > 0 then
      update public.tom_known_issues t
        set ocorrencias = t.ocorrencias + v_n,
            ultima_vez = greatest(coalesce(t.ultima_vez, v_last), v_last),
            colaboradores_afetados = (
              select array(select distinct e from unnest(coalesce(t.colaboradores_afetados,'{}') || coalesce(v_names,'{}')) e)
            ),
            updated_at = now()
      where t.id = rec.id;

      if rec.status = 'corrigido' and rec.corrigido_em is not null and v_last > rec.corrigido_em then
        codigo := rec.codigo; titulo := rec.titulo; corrigido_em := rec.corrigido_em;
        ocorrencias_novas := v_n; afetados := coalesce(v_names,'{}');
        return next;
      end if;
    end if;
  end loop;
end;
$$;
```

- [ ] **Step 2: Aplicar a migration**

Via Supabase MCP `apply_migration` (projeto `cesnbnrynvxvgdhfmaua`, name `tom_known_issues`) com o SQL acima.

- [ ] **Step 3: Verificar que aplicou (deve ter colunas + função)**

Rodar via MCP `execute_sql`:
```sql
select count(*) as cols from information_schema.columns where table_name='tom_known_issues';
select proname from pg_proc where proname = 'evaluate_known_issues';
```
Esperado: `cols` = 17; `proname` = `evaluate_known_issues`.

---

### Task 2: Seed dos incidentes de 29/05

**Files:**
- Create: `supabase/migrations/20260529150100_seed_known_issues.sql`

- [ ] **Step 1: Escrever o seed (idempotente via ON CONFLICT)**

```sql
-- Sprint 31.7 — Seed dos incidentes do Sprint 31.6 (status corrigido, hoje).
insert into public.tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao, colaboradores_afetados, primeira_vez, corrigido_em)
values
  ('B1','EVENT_UPDATE não editava evento','marker','alto','corrigido',
   'VALID_EVENT_UPDATE_ACTIONS só tinha reschedule/cancel/complete; action:"update" rejeitado',
   'Adicionado action update no engine + skill criar-compromisso.md','marker_log','%EVENT_UPDATE%schema_invalid%','{}', now(), now()),
  ('B2','Dup-task agressivo em "Tarefa — Nome"','marker','alto','corrigido',
   'stripSuffix removia o sufixo "— Nome" antes de comparar → títulos idênticos',
   'Sufixos distintos após "—" não bloqueiam (probable→possible)','marker_log','%integrity_dup_task%','{Quintela}', now(), now()),
  ('B3','HABIT_ACTION schema_invalid','marker','medio','corrigido',
   'Validador exigia name/habit_id; TOM mandava title/habit_slug',
   'Parser normaliza title→name e habit_slug→habit_name','marker_log','%HABIT_ACTION%schema_invalid%','{}', now(), now()),
  ('B4','STICKER logado como UNKNOWN_MARKER','marker','baixo','corrigido',
   'Parser de sticker não removia o marker do texto → catch-all logava como desconhecido',
   'Parser remove o marker (igual REACT). Envio já funcionava via sendMedia','marker_log','%UNKNOWN_MARKER_STRIPPED%STICKER%','{}', now(), now()),
  ('B5','Coordination recipient_not_found silencioso','coordination','medio','corrigido',
   'Falha só era mostrada com 2+ destinatários; com 1, texto otimista do LLM prevalecia',
   'Superficia falha de 1 destinatário com msg específica do handler','marker_log','%recipient_not_found%','{}', now(), now()),
  ('C1','ACTIONABLE_NO_MARKER inflado','marker','medio','corrigido',
   'Detector marcava perguntas e auto-relato do user como ação não-persistida',
   'Exclui pergunta + auto-relato; replyHasPromise sempre conta','marker_log','%ACTIONABLE_NO_MARKER%','{}', now(), now()),
  ('E2','Reschedule de tarefa delegada falhava','dispatcher','medio','corrigido',
   'Lookup escopado a assigned_to; delegador (created_by) não achava a task',
   'Lookup+update por assigned_to OU created_by; delegador remarca e avisa o executor','manual',null,'{Krissya,Arthur}', now(), now()),
  ('DUP-SOURCE','Dup-bypass "2" travava (tasks_source_check)','marker','alto','corrigido',
   'Bypass inseria source=tom, inválido no CHECK constraint da tabela tasks',
   'Trocado p/ source=manual no bypass e na auto-criação de hábitos','manual',null,'{Quintela}', now(), now()),
  ('AUDIO-RETRY','Áudio não baixava (falha transitória UAZAPI/CDN)','audio','alto','corrigido',
   'downloadFromUazapi fazia 1 tentativa só; CDN do WhatsApp falha transitoriamente',
   'Retry com backoff em downloadFromUazapi (beneficia áudio/imagem/vídeo)','manual',null,'{Krissya}', now(), now()),
  ('D1','Métrica "vencidas sem cobrança" falsa','health-check','baixo','corrigido',
   'Auditoria rodava antes do chaser e contava todas as vencidas (chaser só cobre 1-5d)',
   'Métrica escopada a 1-5d + lookback 48h','manual',null,'{}', now(), now()),
  ('D2','[Realtime] Erro de canal: undefined','realtime','baixo','corrigido',
   'CHANNEL_ERROR logava err cru (undefined em queda transitória) com console.error',
   'Mensagem com detalhe real + downgrade p/ warn','manual',null,'{}', now(), now()),
  ('D3','Admin (conta de sistema) na métrica de silêncio','health-check','baixo','corrigido',
   'checkSilentCollaborators não filtrava contas de sistema (phone 00000000000)',
   'Ignora contas de sistema (nome conhecido OU phone só de zeros)','manual',null,'{}', now(), now())
on conflict (codigo) do nothing;
```

- [ ] **Step 2: Aplicar via MCP `apply_migration`** (name `seed_known_issues`).

- [ ] **Step 3: Verificar seed**

```sql
select count(*) as total, count(*) filter (where sinal_tipo='marker_log') as com_sinal from tom_known_issues;
```
Esperado: `total` = 12, `com_sinal` = 6.

---

### Task 3: Avaliador na auditoria diária (`health-check.js`)

**Files:**
- Modify: `src/rituals/health-check.js`

- [ ] **Step 1: Ler o arquivo pra achar (a) o array/registry de checks e (b) onde `sendHealthReport` monta a string do relatório**

Run (contexto): abrir `src/rituals/health-check.js`. Localizar o array de checks (padrão `['silent_collaborators', checkSilentCollaborators]`) e a função que monta/envia o relatório (`sendHealthReport` ou equivalente). Anotar a variável que acumula o texto do relatório.

- [ ] **Step 2: Adicionar a função que chama a RPC e formata as regressões**

Adicionar perto dos outros checks:
```js
// Sprint 31.7 — Avalia o ledger de incidentes (tom_known_issues): chama a RPC que
// bumpa contadores e retorna regressões (incidente 'corrigido' que voltou a disparar).
// Retorna string pronta p/ o relatório (vazia se não houver regressão).
async function buildKnownIssuesRegressionBlock() {
  try {
    const { data: regs, error } = await supabase.rpc('evaluate_known_issues');
    if (error) { console.warn('[HealthCheck] evaluate_known_issues err:', error.message); return ''; }
    if (!regs || regs.length === 0) return '';
    const fmt = (d) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '?';
    const linhas = regs.map(r => {
      const quem = (r.afetados && r.afetados.length) ? ` · afetou: ${r.afetados.join(', ')}` : '';
      return `• *${r.codigo}* ${r.titulo} — corrigido ${fmt(r.corrigido_em)}, reincidiu hoje (${r.ocorrencias_novas}×)${quem}`;
    });
    return `\n\n🔁 *Regressões (corrigido mas voltou):*\n${linhas.join('\n')}`;
  } catch (e) {
    console.warn('[HealthCheck] buildKnownIssuesRegressionBlock throw:', e.message);
    return '';
  }
}
```

- [ ] **Step 3: Splice o bloco no relatório**

Na função que monta o texto do relatório (`sendHealthReport`), ANTES de enviar a mensagem final, concatenar o bloco:
```js
const regressionBlock = await buildKnownIssuesRegressionBlock();
// `report` é a variável-string do relatório já existente:
report += regressionBlock;
```
(Se o relatório for montado por partes/array, fazer push do `regressionBlock` quando não-vazio, seguindo o padrão existente do arquivo.)

- [ ] **Step 4: Validar sintaxe**

Run: `node --check D:/la-organizer/_remote/src/rituals/health-check.js`
Esperado: sem saída (OK).

- [ ] **Step 5: Deploy**

Run: `scp D:/la-organizer/_remote/src/rituals/health-check.js tom:/opt/LA-Organizer/src/rituals/health-check.js`
(cron pega no próximo tick; sem restart obrigatório.)

---

### Task 4: Verificação end-to-end do radar (caso controlado)

**Files:**
- (nenhum — só queries de verificação via MCP `execute_sql`)

- [ ] **Step 1: Provar o avaliador no estado real (deve bumpar quem tem match em 24h)**

```sql
select * from evaluate_known_issues();
```
Esperado: retorna 0+ regressões. Como todos os incidentes foram `corrigido_em = hoje` (agora há pouco), só haverá regressão se o sinal disparou DEPOIS do corrigido_em de hoje — provavelmente vazio agora. Anotar o resultado.

- [ ] **Step 2: Forçar uma regressão controlada (B2) e confirmar que o radar pega**

```sql
-- finge que B2 foi corrigido ONTEM, pra qualquer dup_task de hoje contar como regressão
update tom_known_issues set corrigido_em = now() - interval '1 day' where codigo = 'B2';
select codigo, titulo, ocorrencias_novas, afetados from evaluate_known_issues() where codigo = 'B2';
```
Esperado: SE houver algum `integrity_dup_task` em marker_logs nas últimas 24h, B2 aparece como regressão. Se não houver dup recente, inserir um marker_log de teste:
```sql
insert into marker_logs (marker_type, result, reason, created_at)
values ('TASK_UPDATE','rejected','integrity_dup_task:candidate="__RADAR_TEST__"', now());
select codigo, ocorrencias_novas from evaluate_known_issues() where codigo='B2';  -- deve listar B2
```

- [ ] **Step 3: Limpar o teste e restaurar B2**

```sql
delete from marker_logs where reason like '%__RADAR_TEST__%';
update tom_known_issues set corrigido_em = now(), ocorrencias = 0, ultima_vez = null where codigo = 'B2';
```
Esperado: B2 restaurado (corrigido hoje, sem reincidência falsa).

- [ ] **Step 4: Confirmar estado final limpo**

```sql
select codigo, status, ocorrencias from tom_known_issues where codigo='B2';
```
Esperado: `B2 | corrigido | 0`.

---

## Self-review (preenchido)

- **Cobertura do spec:** schema (T1) ✓, RPC avaliador (T1) ✓, seed 12 casos (T2) ✓, integração no relatório das 07:00 (T3) ✓, teste do radar (T4) ✓. Decisão técnica nova vs spec: o avaliador virou RPC SQL (em vez de Node) porque ILIKE em expressão concatenada não é expressável no supabase-js — fiel ao comportamento do spec.
- **Placeholders:** nenhum — todo SQL/JS está completo.
- **Consistência de tipos:** RPC `evaluate_known_issues()` retorna (codigo, titulo, corrigido_em, ocorrencias_novas, afetados) e o health-check consome exatamente esses campos. `sinal_padrao` ILIKE em `marker_type||' '||reason` consistente entre RPC e seed (padrões incluem marker_type quando preciso desambiguar).
