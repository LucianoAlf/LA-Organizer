# LA Journey — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o módulo LA Journey no LA Organizer — governança pedagógica da jornada do aluno (School+Kids), com PWA mobile-first, integração TOM (WhatsApp), e workflow rascunho→em_revisão→publicado.

**Architecture:** PWA React/TS consome Supabase via TanStack Query; auto-save com debounce 600ms; RLS já configurada filtra o que cada mentor vê. Triggers PG enfileiram eventos em `la_journey_lembretes_log`; TOM (Node/PM2) faz poll a cada 5min e envia WhatsApp via UAZAPI. Skill `la-journey.md` injeta snapshot no system prompt; comando `/journey` faz early-return sem LLM.

**Tech Stack:** React 18 + TypeScript + Vite + TanStack Query + Tailwind + Supabase (PostgreSQL+RLS+Realtime) + Node TOM agent.

**Spec:** `docs/superpowers/specs/2026-05-16-la-journey-modulo-design.md`

**Pragmatic adaptations to project:**
- **No automated tests** — projeto não tem suite. Validação = `npx tsc --noEmit` + `npx vite build` + screenshot no Simple Browser via `mcp__Claude_Preview__preview_screenshot`.
- **No per-task commits** — auto-deploy hook (`scripts/auto-deploy.ps1`) commita tudo no fim do turno. Tasks são lógicas, não unidades de commit.
- **No worktree** — projeto trabalha direto em `_remote/` (não é git repo, é cópia de trabalho).
- **TOM deploy via SCP** quando arquivo em `src/` ou `skills/` muda; web via Vercel auto-deploy.

---

## File Structure

### Novos arquivos
```
_remote/docs/migrations/2026-05-16-la-journey-triggers.sql
_remote/web/src/lib/lajourney-types.ts
_remote/web/src/lib/lajourney.ts
_remote/web/src/hooks/useLaJourney.ts
_remote/web/src/screens/lajourney/ListaPage.tsx
_remote/web/src/screens/lajourney/CheckpointPage.tsx
_remote/web/src/screens/lajourney/AdminPage.tsx
_remote/web/src/screens/lajourney/components/ProgressBar.tsx
_remote/web/src/screens/lajourney/components/MarcoCard.tsx
_remote/web/src/screens/lajourney/components/MarcoBodyAprendizado.tsx
_remote/web/src/screens/lajourney/components/MarcoBodyConsolidacao.tsx
_remote/web/src/screens/lajourney/components/MarcoBodyRadial.tsx
_remote/web/src/screens/lajourney/components/CursoStatusCard.tsx
_remote/web/src/screens/lajourney/components/AddMarcoSheet.tsx
_remote/skills/la-journey.md
_remote/src/rituals/la-journey-lembretes.js
```

### Arquivos modificados
```
_remote/web/src/App.tsx                   (+ 3 rotas)
_remote/web/src/screens/Mais.tsx          (+ link 🎵 LA Journey)
_remote/src/rituals/dispatcher.js         (+ 2 crons + processar fila)
_remote/src/prompts/system.js             (+ trigger detection LA Journey)
_remote/src/engine.js                     (+ handler /journey)
_remote/src/internal-api.js               (+ 2 endpoints)
```

---

## Task 1: Migration — Triggers PG + RPC de validação

**Files:**
- Create: `_remote/docs/migrations/2026-05-16-la-journey-triggers.sql`
- Apply via: `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration`

- [ ] **Step 1: Criar arquivo da migration**

Conteúdo de `_remote/docs/migrations/2026-05-16-la-journey-triggers.sql`:

```sql
-- =====================================================================
-- LA Journey — Triggers de auditoria, notificação de status, kickoff + RPC
-- =====================================================================

-- 1. Função de auditoria — grava em la_journey_historico
CREATE OR REPLACE FUNCTION la_journey_log_historico() RETURNS TRIGGER AS $$
DECLARE
  v_user uuid;
BEGIN
  v_user := auth.uid();
  -- Para INSERT
  IF TG_OP = 'INSERT' THEN
    INSERT INTO la_journey_historico (entidade_tipo, entidade_id, acao, campo_alterado, valor_anterior, valor_novo, alterado_por)
    VALUES (TG_ARGV[0], NEW.id, 'created', NULL, NULL, NULL, COALESCE(NEW.updated_by, v_user));
    RETURN NEW;
  -- Para UPDATE
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO la_journey_historico (entidade_tipo, entidade_id, acao, campo_alterado, valor_anterior, valor_novo, alterado_por)
    VALUES (TG_ARGV[0], NEW.id, 'updated', NULL, NULL, NULL, COALESCE(NEW.updated_by, v_user));
    RETURN NEW;
  -- Para DELETE
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO la_journey_historico (entidade_tipo, entidade_id, acao, campo_alterado, valor_anterior, valor_novo, alterado_por)
    VALUES (TG_ARGV[0], OLD.id, 'deleted', NULL, NULL, NULL, v_user);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_la_journey_conteudo_audit ON la_journey_conteudo_checkpoint;
CREATE TRIGGER trg_la_journey_conteudo_audit
AFTER INSERT OR UPDATE ON la_journey_conteudo_checkpoint
FOR EACH ROW EXECUTE FUNCTION la_journey_log_historico('conteudo_checkpoint');

DROP TRIGGER IF EXISTS trg_la_journey_marcos_audit ON la_journey_marcos;
CREATE TRIGGER trg_la_journey_marcos_audit
AFTER INSERT OR UPDATE OR DELETE ON la_journey_marcos
FOR EACH ROW EXECUTE FUNCTION la_journey_log_historico('marco');

DROP TRIGGER IF EXISTS trg_la_journey_campos_audit ON la_journey_marco_campos;
CREATE TRIGGER trg_la_journey_campos_audit
AFTER INSERT OR UPDATE ON la_journey_marco_campos
FOR EACH ROW EXECUTE FUNCTION la_journey_log_historico('marco_campo');

-- 2. Trigger de notificação em mudança de status
CREATE OR REPLACE FUNCTION la_journey_notify_status_change() RETURNS TRIGGER AS $$
DECLARE
  v_mentores uuid[];
  v_coords uuid[];
  v_id uuid;
BEGIN
  -- mentores deste curso
  SELECT array_agg(collaborator_id) INTO v_mentores
  FROM la_journey_curso_mentores
  WHERE curso_id = NEW.curso_id AND programa_id = NEW.programa_id AND ativo = true;

  -- coords + directors (de qualquer unidade)
  SELECT array_agg(id) INTO v_coords
  FROM collaborators
  WHERE role IN ('coordinator','director') AND active = true;

  -- Mentor submeteu pra revisão → notifica coord
  IF NEW.status = 'em_revisao' AND OLD.status = 'rascunho' THEN
    FOREACH v_id IN ARRAY v_coords LOOP
      INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, conteudo_id)
      VALUES ('enviado_revisao', v_id, NEW.id);
    END LOOP;
  -- Coord publicou → notifica mentores + directors
  ELSIF NEW.status = 'publicado' AND OLD.status = 'em_revisao' THEN
    FOREACH v_id IN ARRAY (v_mentores || v_coords) LOOP
      INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, conteudo_id)
      VALUES ('publicado', v_id, NEW.id);
    END LOOP;
  -- Coord devolveu → notifica mentores
  ELSIF NEW.status = 'rascunho' AND OLD.status = 'em_revisao' THEN
    FOREACH v_id IN ARRAY v_mentores LOOP
      INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, conteudo_id)
      VALUES ('devolvido', v_id, NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_la_journey_status_notify ON la_journey_conteudo_checkpoint;
CREATE TRIGGER trg_la_journey_status_notify
AFTER UPDATE OF status ON la_journey_conteudo_checkpoint
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION la_journey_notify_status_change();

-- 3. Trigger de kickoff (mentor recém-atribuído)
CREATE OR REPLACE FUNCTION la_journey_notify_kickoff() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ativo = true THEN
    INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, mensagem)
    VALUES (
      'kickoff',
      NEW.collaborator_id,
      'Atribuído como ' || NEW.papel || ' no curso ' || NEW.curso_id || ' (' || NEW.programa_id || ')'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_la_journey_kickoff ON la_journey_curso_mentores;
CREATE TRIGGER trg_la_journey_kickoff
AFTER INSERT ON la_journey_curso_mentores
FOR EACH ROW EXECUTE FUNCTION la_journey_notify_kickoff();

-- 4. RPC pra validar antes de submeter (server-side)
CREATE OR REPLACE FUNCTION la_journey_can_submit(p_conteudo_id uuid) RETURNS jsonb AS $$
DECLARE
  v_conteudo record;
  v_marcos record;
  v_total_marcos int;
  v_campos_obrigatorios text[];
  v_faltando text[] := ARRAY[]::text[];
  v_marcos_incompletos int[] := ARRAY[]::int[];
BEGIN
  SELECT * INTO v_conteudo FROM la_journey_conteudo_checkpoint WHERE id = p_conteudo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conteudo_nao_encontrado');
  END IF;

  -- Cabeçalho
  IF coalesce(trim(v_conteudo.perfil_entrada), '') = '' THEN
    v_faltando := array_append(v_faltando, 'perfil_entrada');
  END IF;
  IF coalesce(trim(v_conteudo.transformacao_esperada), '') = '' THEN
    v_faltando := array_append(v_faltando, 'transformacao_esperada');
  END IF;

  -- Marcos
  SELECT count(*)::int INTO v_total_marcos FROM la_journey_marcos WHERE conteudo_id = p_conteudo_id;
  IF v_total_marcos = 0 THEN
    v_faltando := array_append(v_faltando, 'nenhum_marco');
  END IF;

  -- Por marco: validar campos esperados pelo tipo
  FOR v_marcos IN SELECT * FROM la_journey_marcos WHERE conteudo_id = p_conteudo_id ORDER BY sort_order, numero LOOP
    v_campos_obrigatorios := CASE v_marcos.tipo
      WHEN 'aprendizado' THEN ARRAY['tema_foco','teoria_conceitos','tecnica','ritmo_percepcao','repertorio_aplicacao','evidencia_ancoragem','musica_desafio']
      WHEN 'consolidacao' THEN ARRAY['ancoragens_reforcadas','lapidacao_tecnica','repertorio_recital','formato_celebracao']
      WHEN 'ancoragem_radial' THEN ARRAY['conquista_musical','manifestacao_crianca','vivencias_atividades','recursos_pedagogicos']
    END;

    IF (SELECT count(*) FROM unnest(v_campos_obrigatorios) ck
        WHERE NOT EXISTS (
          SELECT 1 FROM la_journey_marco_campos mc
          WHERE mc.marco_id = v_marcos.id
            AND mc.campo_chave = ck
            AND coalesce(trim(mc.campo_valor),'') != ''
        )) > 0 THEN
      v_marcos_incompletos := array_append(v_marcos_incompletos, v_marcos.numero);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', (array_length(v_faltando,1) IS NULL AND array_length(v_marcos_incompletos,1) IS NULL),
    'campos_faltando', v_faltando,
    'marcos_incompletos', v_marcos_incompletos
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION la_journey_can_submit(uuid) TO authenticated;

-- 5. RPC pra carregar lista de progresso (otimizada, evita N+1 no front)
CREATE OR REPLACE FUNCTION la_journey_lista_progresso(p_programa_id text) RETURNS TABLE (
  curso_id text, curso_nome text, curso_icone text,
  mentor_principal text, mentores_apoio text[],
  checkpoint_id text, checkpoint_nome text, checkpoint_codigo text, checkpoint_sort int,
  status text, percentual int, campos_preenchidos int, campos_total int,
  updated_at timestamptz, dias_sem_editar int
) AS $$
  SELECT
    c.id, c.nome, c.icone,
    (SELECT col.full_name FROM la_journey_curso_mentores cm
       JOIN collaborators col ON col.id=cm.collaborator_id
       WHERE cm.curso_id=c.id AND cm.programa_id=p_programa_id AND cm.papel='mentor_principal' AND cm.ativo=true LIMIT 1),
    (SELECT array_agg(col.full_name) FROM la_journey_curso_mentores cm
       JOIN collaborators col ON col.id=cm.collaborator_id
       WHERE cm.curso_id=c.id AND cm.programa_id=p_programa_id AND cm.papel='mentor_apoio' AND cm.ativo=true),
    cp.id, cp.nome, cp.codigo, cp.sort_order,
    COALESCE(cont.status, 'sem_inicio'),
    COALESCE((
      SELECT CASE WHEN total = 0 THEN 0 ELSE round(preenchidos::numeric / total * 100)::int END
      FROM (
        SELECT
          (SELECT count(*) FROM la_journey_marco_campos mc JOIN la_journey_marcos m ON m.id=mc.marco_id
            WHERE m.conteudo_id=cont.id AND coalesce(trim(mc.campo_valor),'')!='') AS preenchidos,
          (SELECT sum(CASE m.tipo
              WHEN 'aprendizado' THEN 7
              WHEN 'consolidacao' THEN 4
              WHEN 'ancoragem_radial' THEN 4
            END) FROM la_journey_marcos m WHERE m.conteudo_id=cont.id) +
          CASE WHEN coalesce(trim(cont.perfil_entrada),'')='' THEN 0 ELSE 1 END +
          CASE WHEN coalesce(trim(cont.transformacao_esperada),'')='' THEN 0 ELSE 1 END AS total
      ) t
    ), 0),
    COALESCE((
      SELECT count(*)::int FROM la_journey_marco_campos mc JOIN la_journey_marcos m ON m.id=mc.marco_id
      WHERE m.conteudo_id=cont.id AND coalesce(trim(mc.campo_valor),'')!=''
    ), 0) +
    CASE WHEN cont.id IS NOT NULL AND coalesce(trim(cont.perfil_entrada),'')!='' THEN 1 ELSE 0 END +
    CASE WHEN cont.id IS NOT NULL AND coalesce(trim(cont.transformacao_esperada),'')!='' THEN 1 ELSE 0 END,
    COALESCE((
      SELECT sum(CASE m.tipo WHEN 'aprendizado' THEN 7 WHEN 'consolidacao' THEN 4 WHEN 'ancoragem_radial' THEN 4 END)::int
      FROM la_journey_marcos m WHERE m.conteudo_id=cont.id
    ), cp.marcos_total * CASE cp.tipo WHEN 'musicalizacao' THEN 4 ELSE 6 END) + 2,
    cont.updated_at,
    CASE WHEN cont.updated_at IS NULL THEN NULL ELSE EXTRACT(DAY FROM now() - cont.updated_at)::int END
  FROM la_journey_cursos c
  CROSS JOIN la_journey_checkpoints cp
  LEFT JOIN la_journey_conteudo_checkpoint cont
    ON cont.curso_id = c.id AND cont.checkpoint_id = cp.id AND cont.programa_id = p_programa_id
  WHERE cp.programa_id = p_programa_id
    AND (cp.separa_por_curso = true OR c.id = 'musicalizacao_geral')
    AND (cp.separa_por_curso = false OR c.id != 'musicalizacao_geral')
    AND c.is_active = true
    AND EXISTS (
      SELECT 1 FROM la_journey_curso_mentores cm
      WHERE cm.curso_id = c.id AND cm.programa_id = p_programa_id AND cm.ativo = true
    )
  ORDER BY c.sort_order, cp.sort_order;
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION la_journey_lista_progresso(text) TO authenticated;
```

- [ ] **Step 2: Aplicar a migration**

Usar `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` com `project_id: cesnbnrynvxvgdhfmaua` e o conteúdo SQL acima (nome: `la_journey_triggers_rpc`).

- [ ] **Step 3: Verificar aplicação**

Rodar via `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`:
```sql
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table LIKE 'la_journey_%' ORDER BY trigger_name;
```
Esperado: 5 triggers (audit conteudo, audit marcos, audit campos, status notify, kickoff).

```sql
SELECT proname FROM pg_proc WHERE proname LIKE 'la_journey_%' ORDER BY proname;
```
Esperado: 5 funções (`la_journey_can_submit`, `la_journey_lista_progresso`, `la_journey_log_historico`, `la_journey_notify_kickoff`, `la_journey_notify_status_change`).

---

## Task 2: Types — `lib/lajourney-types.ts`

**Files:**
- Create: `_remote/web/src/lib/lajourney-types.ts`

- [ ] **Step 1: Escrever o arquivo de tipos completo**

Conteúdo de `_remote/web/src/lib/lajourney-types.ts`:

```ts
// LA Journey — Tipos alinhados ao schema Supabase
// Schema confirmado em 2026-05-16 via execute_sql.

export type Programa = 'school' | 'kids';

export const PROGRAMA_LABELS: Record<Programa, string> = {
  school: 'LA Music School',
  kids: 'LA Music Kids',
};

export type TipoCheckpoint = 'checkpoint' | 'musicalizacao' | 'iniciacao';
export type TipoMarco = 'aprendizado' | 'consolidacao' | 'ancoragem_radial';
export type StatusConteudo = 'rascunho' | 'em_revisao' | 'publicado';

export const STATUS_LABELS: Record<StatusConteudo, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  publicado: 'Publicado',
};

export interface JourneyCurso {
  id: string;             // 'bateria' | 'canto' | 'cordas' | 'teclas' | 'musicalizacao_geral'
  nome: string;
  icone: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface JourneyCheckpoint {
  id: string;             // 'school_foundation', 'kids_baby1', etc.
  programa_id: Programa;
  codigo: string;         // 'foundation', 'baby1', etc.
  nome: string;
  equivalencia: string | null;
  foco: string | null;
  tipo: TipoCheckpoint;
  separa_por_curso: boolean;
  marcos_total: number;
  tem_consolidacao: boolean;
  sort_order: number;
}

export interface JourneyMentor {
  collaborator_id: string;
  full_name: string;
  papel: 'mentor_principal' | 'mentor_apoio';
}

export interface JourneyConteudo {
  id: string;
  programa_id: Programa;
  curso_id: string;
  checkpoint_id: string;
  perfil_entrada: string | null;
  transformacao_esperada: string | null;
  status: StatusConteudo;
  publicado_em: string | null;
  publicado_por: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JourneyMarco {
  id: string;
  conteudo_id: string;
  numero: number;
  tipo: TipoMarco;
  titulo: string | null;
  tema_foco: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface JourneyMarcoCampo {
  id: string;
  marco_id: string;
  campo_chave: string;
  campo_valor: string | null;
  updated_at: string;
  updated_by: string | null;
}

// Marco com campos já agrupados como dicionário (mais ergonômico no front)
export interface JourneyMarcoComCampos extends JourneyMarco {
  campos: Record<string, string>;
}

export interface JourneyConteudoCompleto {
  conteudo: JourneyConteudo | null;
  marcos: JourneyMarcoComCampos[];
  progresso: { preenchidos: number; total: number; percentual: number };
}

export interface JourneyCursoProgresso {
  curso_id: string;
  curso_nome: string;
  curso_icone: string | null;
  mentor_principal: string | null;
  mentores_apoio: string[] | null;
  checkpoints: Array<{
    checkpoint_id: string;
    checkpoint_nome: string;
    checkpoint_codigo: string;
    checkpoint_sort: number;
    status: StatusConteudo | 'sem_inicio';
    percentual: number;
    campos_preenchidos: number;
    campos_total: number;
    updated_at: string | null;
    dias_sem_editar: number | null;
  }>;
  total_percentual: number;
  ultima_edicao: string | null;
}

export interface JourneyPendencia {
  conteudo_id: string;
  programa_id: Programa;
  curso_id: string;
  curso_nome: string;
  checkpoint_id: string;
  checkpoint_nome: string;
  mentor_nome: string | null;
  submetido_em: string | null;
}

export interface CanSubmitResult {
  ok: boolean;
  erro?: string;
  campos_faltando?: string[];
  marcos_incompletos?: number[];
}

// Helpers
export function camposDoTipo(tipo: TipoMarco): string[] {
  switch (tipo) {
    case 'aprendizado':
      return ['tema_foco', 'teoria_conceitos', 'tecnica', 'ritmo_percepcao', 'repertorio_aplicacao', 'evidencia_ancoragem', 'musica_desafio'];
    case 'consolidacao':
      return ['ancoragens_reforcadas', 'lapidacao_tecnica', 'repertorio_recital', 'formato_celebracao'];
    case 'ancoragem_radial':
      return ['conquista_musical', 'manifestacao_crianca', 'vivencias_atividades', 'recursos_pedagogicos'];
  }
}

export const CAMPO_LABELS: Record<string, string> = {
  tema_foco: 'Tema / foco do marco',
  teoria_conceitos: 'Teoria e Conceitos',
  tecnica: 'Técnica',
  ritmo_percepcao: 'Ritmo e Percepção',
  repertorio_aplicacao: 'Repertório e Aplicação',
  evidencia_ancoragem: 'Evidência de Ancoragem',
  musica_desafio: 'Música Desafio',
  ancoragens_reforcadas: 'Ancoragens que serão reforçadas',
  lapidacao_tecnica: 'Foco da lapidação técnica',
  repertorio_recital: 'Música / Repertório do Recital',
  formato_celebracao: 'Formato de Celebração',
  conquista_musical: 'Conquista Musical do Marco',
  manifestacao_crianca: 'Como se Manifesta na Criança',
  vivencias_atividades: 'Vivências e Atividades Propostas',
  recursos_pedagogicos: 'Recursos Pedagógicos e Instrumentos',
};

export const CAMPO_PLACEHOLDERS: Record<string, string> = {
  tema_foco: 'Descreva o tema central e o foco pedagógico deste período de aulas...',
  teoria_conceitos: 'O que o aluno precisa compreender? (notas, leitura, anatomia do instrumento)',
  tecnica: 'O que o aluno precisa executar? (postura, digitação, coordenação motora)',
  ritmo_percepcao: 'O que o aluno precisa sentir e reconhecer? (pulso, andamento, padrões)',
  repertorio_aplicacao: 'Onde o conteúdo vira música? (prática de conjunto, música desafio)',
  evidencia_ancoragem: 'Como o professor percebe que o conteúdo foi realmente absorvido?',
  musica_desafio: 'Nome da música ou tipo de repertório trabalhado neste marco...',
  ancoragens_reforcadas: 'Quais fundamentos dos marcos anteriores precisam de mais atenção?',
  lapidacao_tecnica: 'O que precisa estar polido? Postura, expressividade, segurança no repertório...',
  repertorio_recital: 'Repertório esperado para este Checkpoint...',
  formato_celebracao: 'Como o avanço será celebrado? Gravação, recital, feedback formal...',
  conquista_musical: 'Qual é a conquista musical específica que se ancora neste marco?',
  manifestacao_crianca: 'Como esta conquista aparece no comportamento da criança?',
  vivencias_atividades: 'Que tipos de atividades, jogos musicais e propostas pedagógicas exploram esta ancoragem?',
  recursos_pedagogicos: 'Quais instrumentos, objetos sonoros, canções ou recursos são usados nesta fase?',
};
```

- [ ] **Step 2: Validar TypeScript**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```
Expected: zero erros relacionados ao novo arquivo (pode ter erros pré-existentes em outros módulos — ignorar).

---

## Task 3: Data layer — `lib/lajourney.ts`

**Files:**
- Create: `_remote/web/src/lib/lajourney.ts`

- [ ] **Step 1: Criar arquivo com todas as funções de leitura/escrita**

Conteúdo de `_remote/web/src/lib/lajourney.ts`:

```ts
// LA Journey — Data layer
// Funções de leitura/escrita contra Supabase. Espelha o padrão de lib/laeduca.ts.

import { supabase } from './supabase';
import type {
  Programa, JourneyCheckpoint, JourneyCurso, JourneyMentor,
  JourneyConteudo, JourneyMarco, JourneyMarcoCampo, JourneyMarcoComCampos,
  JourneyConteudoCompleto, JourneyCursoProgresso, JourneyPendencia,
  CanSubmitResult, TipoMarco
} from './lajourney-types';
import { camposDoTipo } from './lajourney-types';

// ─── LEITURA ───────────────────────────────────────────────────────────

export async function fetchJourneyCheckpoints(programaId: Programa): Promise<JourneyCheckpoint[]> {
  const { data, error } = await supabase
    .from('la_journey_checkpoints')
    .select('*')
    .eq('programa_id', programaId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as JourneyCheckpoint[];
}

export async function fetchJourneyCursos(programaId: Programa): Promise<JourneyCurso[]> {
  // RLS já filtra; coord/director veem todos, mentores só os atribuídos.
  // Filtramos por cursos que tenham mentor no programa atual.
  const { data, error } = await supabase
    .from('la_journey_curso_mentores')
    .select('curso_id, la_journey_cursos!inner(id, nome, icone, sort_order, is_active)')
    .eq('programa_id', programaId)
    .eq('ativo', true);
  if (error) throw error;
  const seen = new Set<string>();
  const out: JourneyCurso[] = [];
  for (const row of (data ?? []) as unknown as Array<{ curso_id: string; la_journey_cursos: JourneyCurso }>) {
    if (seen.has(row.curso_id)) continue;
    seen.add(row.curso_id);
    out.push(row.la_journey_cursos);
  }
  out.sort((a, b) => a.sort_order - b.sort_order);
  return out;
}

export async function fetchJourneyMentoresPorCurso(programaId: Programa, cursoId: string): Promise<JourneyMentor[]> {
  const { data, error } = await supabase
    .from('la_journey_curso_mentores')
    .select('collaborator_id, papel, collaborators!inner(id, full_name)')
    .eq('programa_id', programaId)
    .eq('curso_id', cursoId)
    .eq('ativo', true);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    collaborator_id: string; papel: 'mentor_principal' | 'mentor_apoio';
    collaborators: { full_name: string };
  }>).map(r => ({
    collaborator_id: r.collaborator_id,
    papel: r.papel,
    full_name: r.collaborators.full_name,
  }));
}

export async function fetchJourneyConteudoCompleto(
  programaId: Programa, cursoId: string, checkpointId: string
): Promise<JourneyConteudoCompleto> {
  // 1. conteudo
  const { data: conteudo, error: e1 } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select('*')
    .eq('programa_id', programaId)
    .eq('curso_id', cursoId)
    .eq('checkpoint_id', checkpointId)
    .maybeSingle();
  if (e1) throw e1;

  if (!conteudo) {
    return { conteudo: null, marcos: [], progresso: { preenchidos: 0, total: 0, percentual: 0 } };
  }

  // 2. marcos + campos
  const { data: marcosRaw, error: e2 } = await supabase
    .from('la_journey_marcos')
    .select('*, la_journey_marco_campos(*)')
    .eq('conteudo_id', conteudo.id)
    .order('sort_order')
    .order('numero');
  if (e2) throw e2;

  const marcos: JourneyMarcoComCampos[] = ((marcosRaw ?? []) as Array<
    JourneyMarco & { la_journey_marco_campos: JourneyMarcoCampo[] }
  >).map(m => {
    const campos: Record<string, string> = {};
    for (const c of m.la_journey_marco_campos ?? []) {
      campos[c.campo_chave] = c.campo_valor ?? '';
    }
    return {
      id: m.id, conteudo_id: m.conteudo_id, numero: m.numero, tipo: m.tipo,
      titulo: m.titulo, tema_foco: m.tema_foco, sort_order: m.sort_order,
      created_at: m.created_at, updated_at: m.updated_at, updated_by: m.updated_by,
      campos,
    };
  });

  // 3. progresso
  let preenchidos = 0;
  let total = 2; // perfil + transformacao
  if ((conteudo.perfil_entrada ?? '').trim()) preenchidos++;
  if ((conteudo.transformacao_esperada ?? '').trim()) preenchidos++;
  for (const m of marcos) {
    const chaves = camposDoTipo(m.tipo);
    total += chaves.length;
    for (const k of chaves) {
      if ((m.campos[k] ?? '').trim()) preenchidos++;
    }
  }
  const percentual = total === 0 ? 0 : Math.round((preenchidos / total) * 100);
  return { conteudo: conteudo as JourneyConteudo, marcos, progresso: { preenchidos, total, percentual } };
}

export async function fetchJourneyListaProgresso(programaId: Programa): Promise<JourneyCursoProgresso[]> {
  const { data, error } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: programaId });
  if (error) throw error;
  // Agrupa por curso
  type Row = {
    curso_id: string; curso_nome: string; curso_icone: string | null;
    mentor_principal: string | null; mentores_apoio: string[] | null;
    checkpoint_id: string; checkpoint_nome: string; checkpoint_codigo: string; checkpoint_sort: number;
    status: string; percentual: number; campos_preenchidos: number; campos_total: number;
    updated_at: string | null; dias_sem_editar: number | null;
  };
  const grouped = new Map<string, JourneyCursoProgresso>();
  for (const r of (data ?? []) as Row[]) {
    if (!grouped.has(r.curso_id)) {
      grouped.set(r.curso_id, {
        curso_id: r.curso_id, curso_nome: r.curso_nome, curso_icone: r.curso_icone,
        mentor_principal: r.mentor_principal, mentores_apoio: r.mentores_apoio,
        checkpoints: [], total_percentual: 0, ultima_edicao: null,
      });
    }
    const g = grouped.get(r.curso_id)!;
    g.checkpoints.push({
      checkpoint_id: r.checkpoint_id, checkpoint_nome: r.checkpoint_nome,
      checkpoint_codigo: r.checkpoint_codigo, checkpoint_sort: r.checkpoint_sort,
      status: r.status as JourneyCursoProgresso['checkpoints'][number]['status'],
      percentual: r.percentual, campos_preenchidos: r.campos_preenchidos,
      campos_total: r.campos_total, updated_at: r.updated_at, dias_sem_editar: r.dias_sem_editar,
    });
    if (r.updated_at && (!g.ultima_edicao || r.updated_at > g.ultima_edicao)) {
      g.ultima_edicao = r.updated_at;
    }
  }
  // calcula total_percentual = média
  for (const g of grouped.values()) {
    g.checkpoints.sort((a, b) => a.checkpoint_sort - b.checkpoint_sort);
    g.total_percentual = Math.round(
      g.checkpoints.reduce((s, c) => s + c.percentual, 0) / Math.max(1, g.checkpoints.length)
    );
  }
  return Array.from(grouped.values());
}

export async function fetchJourneyPendencias(): Promise<JourneyPendencia[]> {
  const { data, error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select(`
      id, programa_id, curso_id, checkpoint_id, updated_at,
      la_journey_cursos!inner(nome),
      la_journey_checkpoints!inner(nome)
    `)
    .eq('status', 'em_revisao')
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    id: string; programa_id: Programa; curso_id: string; checkpoint_id: string; updated_at: string;
    la_journey_cursos: { nome: string };
    la_journey_checkpoints: { nome: string };
  }>).map(r => ({
    conteudo_id: r.id,
    programa_id: r.programa_id,
    curso_id: r.curso_id,
    curso_nome: r.la_journey_cursos.nome,
    checkpoint_id: r.checkpoint_id,
    checkpoint_nome: r.la_journey_checkpoints.nome,
    mentor_nome: null,
    submetido_em: r.updated_at,
  }));
}

// ─── ESCRITA ───────────────────────────────────────────────────────────

async function getCurrentCollaboratorId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');
  const { data, error } = await supabase
    .from('collaborators').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Colaborador não encontrado');
  return data.id;
}

export async function upsertJourneyConteudoHeader(input: {
  programaId: Programa; cursoId: string; checkpointId: string;
  perfilEntrada?: string; transformacaoEsperada?: string;
}): Promise<string> {
  const userId = await getCurrentCollaboratorId();
  const { data: existing } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select('id, status')
    .eq('programa_id', input.programaId)
    .eq('curso_id', input.cursoId)
    .eq('checkpoint_id', input.checkpointId)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'publicado') {
      throw new Error('Conteúdo publicado — edição bloqueada.');
    }
    const patch: Record<string, unknown> = { updated_by: userId, updated_at: new Date().toISOString() };
    if (input.perfilEntrada !== undefined) patch.perfil_entrada = input.perfilEntrada;
    if (input.transformacaoEsperada !== undefined) patch.transformacao_esperada = input.transformacaoEsperada;
    const { error } = await supabase
      .from('la_journey_conteudo_checkpoint')
      .update(patch)
      .eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  } else {
    const { data, error } = await supabase
      .from('la_journey_conteudo_checkpoint')
      .insert({
        programa_id: input.programaId,
        curso_id: input.cursoId,
        checkpoint_id: input.checkpointId,
        perfil_entrada: input.perfilEntrada ?? null,
        transformacao_esperada: input.transformacaoEsperada ?? null,
        status: 'rascunho',
        updated_by: userId,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }
}

export async function adicionarJourneyMarco(input: {
  conteudoId: string; numero: number; tipo: TipoMarco; titulo?: string;
}): Promise<string> {
  const userId = await getCurrentCollaboratorId();
  const { data, error } = await supabase
    .from('la_journey_marcos')
    .insert({
      conteudo_id: input.conteudoId,
      numero: input.numero,
      tipo: input.tipo,
      titulo: input.titulo ?? null,
      sort_order: input.numero,
      updated_by: userId,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function removerJourneyMarco(marcoId: string): Promise<void> {
  // Bloqueia consolidação (UI já bloqueia, mas defesa em profundidade)
  const { data: m } = await supabase
    .from('la_journey_marcos').select('tipo').eq('id', marcoId).single();
  if (m?.tipo === 'consolidacao') {
    throw new Error('Marco de consolidação não pode ser removido.');
  }
  const { error } = await supabase.from('la_journey_marcos').delete().eq('id', marcoId);
  if (error) throw error;
}

export async function upsertJourneyMarcoCampo(input: {
  marcoId: string; campoChave: string; campoValor: string;
}): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_marco_campos')
    .upsert({
      marco_id: input.marcoId,
      campo_chave: input.campoChave,
      campo_valor: input.campoValor,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'marco_id,campo_chave' });
  if (error) throw error;
}

export async function upsertJourneyMarcoHeader(input: {
  marcoId: string; titulo?: string; temaFoco?: string;
}): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const patch: Record<string, unknown> = { updated_by: userId, updated_at: new Date().toISOString() };
  if (input.titulo !== undefined) patch.titulo = input.titulo;
  if (input.temaFoco !== undefined) patch.tema_foco = input.temaFoco;
  const { error } = await supabase
    .from('la_journey_marcos').update(patch).eq('id', input.marcoId);
  if (error) throw error;
}

export async function canSubmitJourney(conteudoId: string): Promise<CanSubmitResult> {
  const { data, error } = await supabase.rpc('la_journey_can_submit', { p_conteudo_id: conteudoId });
  if (error) throw error;
  return data as CanSubmitResult;
}

export async function submeterJourneyParaRevisao(conteudoId: string): Promise<void> {
  const check = await canSubmitJourney(conteudoId);
  if (!check.ok) {
    throw new Error('Faltam campos: ' + JSON.stringify(check));
  }
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .update({ status: 'em_revisao', updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', conteudoId);
  if (error) throw error;
}

export async function publicarJourneyConteudo(conteudoId: string): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
      publicado_por: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conteudoId);
  if (error) throw error;
}

export async function reverterJourneyParaRascunho(conteudoId: string): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .update({ status: 'rascunho', updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', conteudoId);
  if (error) throw error;
}

export async function devolverJourneyParaRevisao(conteudoId: string): Promise<void> {
  const userId = await getCurrentCollaboratorId();
  const { error } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .update({
      status: 'em_revisao',
      publicado_em: null,
      publicado_por: null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conteudoId);
  if (error) throw error;
}
```

- [ ] **Step 2: Validar TypeScript**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

---

## Task 4: Hooks — `hooks/useLaJourney.ts`

**Files:**
- Create: `_remote/web/src/hooks/useLaJourney.ts`

- [ ] **Step 1: Criar hooks**

```ts
// _remote/web/src/hooks/useLaJourney.ts
import { useQuery } from '@tanstack/react-query';
import {
  fetchJourneyCheckpoints, fetchJourneyCursos, fetchJourneyMentoresPorCurso,
  fetchJourneyConteudoCompleto, fetchJourneyListaProgresso, fetchJourneyPendencias,
} from '../lib/lajourney';
import type { Programa } from '../lib/lajourney-types';

export function useJourneyCheckpoints(programaId: Programa) {
  return useQuery({
    queryKey: ['lajourney-checkpoints', programaId],
    queryFn: () => fetchJourneyCheckpoints(programaId),
    staleTime: 60 * 60_000, // 1h — checkpoints são seed estática
  });
}

export function useJourneyCursos(programaId: Programa) {
  return useQuery({
    queryKey: ['lajourney-cursos', programaId],
    queryFn: () => fetchJourneyCursos(programaId),
    staleTime: 5 * 60_000,
  });
}

export function useJourneyMentores(programaId: Programa, cursoId: string | null) {
  return useQuery({
    queryKey: ['lajourney-mentores', programaId, cursoId],
    queryFn: () => fetchJourneyMentoresPorCurso(programaId, cursoId!),
    enabled: !!cursoId,
    staleTime: 5 * 60_000,
  });
}

export function useJourneyConteudo(programaId: Programa, cursoId: string | null, checkpointId: string | null) {
  return useQuery({
    queryKey: ['lajourney-conteudo', programaId, cursoId, checkpointId],
    queryFn: () => fetchJourneyConteudoCompleto(programaId, cursoId!, checkpointId!),
    enabled: !!cursoId && !!checkpointId,
    staleTime: 0,
  });
}

export function useJourneyListaProgresso(programaId: Programa) {
  return useQuery({
    queryKey: ['lajourney-lista-progresso', programaId],
    queryFn: () => fetchJourneyListaProgresso(programaId),
    staleTime: 30_000,
  });
}

export function useJourneyPendencias() {
  return useQuery({
    queryKey: ['lajourney-pendencias'],
    queryFn: fetchJourneyPendencias,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Validar TypeScript**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

---

## Task 5: Componente ProgressBar (local pra Journey)

**Files:**
- Create: `_remote/web/src/screens/lajourney/components/ProgressBar.tsx`

- [ ] **Step 1: Espelhar o ProgressBar do laeduca**

```tsx
// _remote/web/src/screens/lajourney/components/ProgressBar.tsx
// Espelha ProgressBar do laeduca para isolamento do módulo

interface Props {
  percentual: number;
  className?: string;
}

export function ProgressBar({ percentual, className = '' }: Props) {
  const safe = Math.max(0, Math.min(100, percentual));
  return (
    <div className={`h-1.5 bg-border rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full bg-tom transition-all duration-300"
        style={{ width: `${safe}%` }}
        aria-valuenow={safe}
        aria-valuemin={0}
        aria-valuemax={100}
        role="progressbar"
      />
    </div>
  );
}
```

---

## Task 6: Adicionar rotas no App.tsx

**Files:**
- Modify: `_remote/web/src/App.tsx` (após linha 91, antes do bloco `time`)

- [ ] **Step 1: Adicionar imports no topo do App.tsx (junto com outros imports de laeduca)**

```tsx
import { LaJourneyListaPage } from './screens/lajourney/ListaPage';
import { LaJourneyCheckpointPage } from './screens/lajourney/CheckpointPage';
import { LaJourneyAdminPage } from './screens/lajourney/AdminPage';
```

- [ ] **Step 2: Adicionar bloco de rotas (após bloco LA EDUCA, antes do bloco `time`)**

```tsx
{/* LA JOURNEY — RLS filtra o que mentor vê. Admin gated por role.
    Manager NÃO vê (não é pedagógico). */}
<Route path="la-journey" element={<LaJourneyListaPage />} />
<Route path="la-journey/:checkpointId" element={<LaJourneyCheckpointPage />} />
<Route element={<ProtectedRoute requireRoles={['coordinator', 'director']} />}>
  <Route path="la-journey/admin" element={<LaJourneyAdminPage />} />
</Route>
```

- [ ] **Step 3: Validar TypeScript (vai dar erro até as 3 telas existirem — esperado nesta fase)**

---

## Task 7: Link no /mais — `Mais.tsx`

**Files:**
- Modify: `_remote/web/src/screens/Mais.tsx`

- [ ] **Step 1: Ler `Mais.tsx` pra identificar o bloco de links**

Encontrar onde está o link `🎓 LA Educa` (pattern já existente).

- [ ] **Step 2: Adicionar link logo abaixo do LA Educa**

Padrão visual idêntico:

```tsx
{role !== 'manager' && (
  <Link
    to="/la-journey"
    className="flex items-center gap-md p-md bg-bg-surface rounded-lg border border-border hover:border-tom transition"
  >
    <span className="text-2xl">🎵</span>
    <div className="flex-1">
      <div className="font-semibold text-fg">LA Journey</div>
      <div className="text-body-sm text-fg-muted">Jornada pedagógica do aluno</div>
    </div>
    <span className="text-fg-muted">›</span>
  </Link>
)}
```

(O check `role !== 'manager'` reflete a regra de gating no spec §5.)

- [ ] **Step 3: Validar TypeScript**

---

## Task 8: ListaPage — `/la-journey`

**Files:**
- Create: `_remote/web/src/screens/lajourney/ListaPage.tsx`

- [ ] **Step 1: Implementar a tela completa**

```tsx
// _remote/web/src/screens/lajourney/ListaPage.tsx
// Lista de checkpoints por programa+curso. Mobile-first, sem sidebar.

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { CustomSelect } from '../../components/CustomSelect';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Tabs } from '../../components/Tabs';
import { Badge } from '../../components/Badge';
import { useJourneyCheckpoints, useJourneyCursos, useJourneyListaProgresso } from '../../hooks/useLaJourney';
import { ProgressBar } from './components/ProgressBar';
import type { Programa, StatusConteudo } from '../../lib/lajourney-types';
import { STATUS_LABELS } from '../../lib/lajourney-types';

function statusBadgeVariant(status: StatusConteudo | 'sem_inicio'): 'success' | 'warning' | 'neutral' {
  if (status === 'publicado') return 'success';
  if (status === 'em_revisao') return 'warning';
  return 'neutral';
}

export function LaJourneyListaPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [programa, setPrograma] = useState<Programa>('school');
  const [cursoIdSelected, setCursoIdSelected] = useState<string>('');

  const { data: cursos = [], isLoading: lCursos } = useJourneyCursos(programa);
  const { data: checkpoints = [], isLoading: lCps } = useJourneyCheckpoints(programa);
  const { data: progresso = [], isLoading: lProg } = useJourneyListaProgresso(programa);

  // Curso default = primeiro disponível
  const cursoId = cursoIdSelected || cursos[0]?.id || '';

  // Para Kids: separar Musicalização (musicalizacao_geral) vs Iniciação (bateria/canto/cordas/teclas)
  const [kidsTab, setKidsTab] = useState<'musicalizacao' | 'iniciacao'>('musicalizacao');

  const cursoEscolhido = cursos.find(c => c.id === cursoId);
  const progressoDoCurso = progresso.find(p => p.curso_id === cursoId);

  // Filtra checkpoints exibidos
  const checkpointsExibidos = useMemo(() => {
    if (programa === 'school') return checkpoints;
    if (kidsTab === 'musicalizacao') return checkpoints.filter(c => c.tipo === 'musicalizacao');
    return checkpoints.filter(c => c.tipo === 'iniciacao');
  }, [checkpoints, programa, kidsTab]);

  // Pra Musicalização Kids, o curso é fixo musicalizacao_geral
  const cursoEfetivoId = (programa === 'kids' && kidsTab === 'musicalizacao')
    ? 'musicalizacao_geral'
    : cursoId;

  const showCursoSelect = programa === 'school' || (programa === 'kids' && kidsTab === 'iniciacao');

  function handleCardClick(checkpointId: string) {
    navigate(`/la-journey/${checkpointId}?curso=${cursoEfetivoId}`);
  }

  if (lCursos || lCps || lProg) return <LoadingState />;
  if (cursos.length === 0) {
    return (
      <div className="space-y-lg pb-xl">
        <PageHeader title="LA Journey" backTo="/mais" />
        <EmptyState
          icon="🎵"
          title="Sem cursos disponíveis"
          message="Você não está atribuído como mentor de nenhum curso no programa atual."
        />
      </div>
    );
  }

  const cursoOptions = (programa === 'school'
    ? cursos.filter(c => c.id !== 'musicalizacao_geral')
    : cursos.filter(c => c.id !== 'musicalizacao_geral')
  ).map(c => ({ value: c.id, label: `${c.icone ?? ''} ${c.nome}`.trim() }));

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader
        title="LA Journey"
        subtitle="Jornada pedagógica do aluno"
        backTo="/mais"
        right={
          (role === 'coordinator' || role === 'director') ? (
            <button
              onClick={() => navigate('/la-journey/admin')}
              className="text-body-sm text-tom font-semibold hover:underline"
            >
              ⚙ Admin
            </button>
          ) : null
        }
      />

      {/* Tabs programa */}
      <Tabs
        tabs={[{ id: 'school', label: 'School' }, { id: 'kids', label: 'Kids' }]}
        active={programa}
        onChange={(id) => { setPrograma(id as Programa); setCursoIdSelected(''); }}
      />

      {/* Tabs secundárias Kids */}
      {programa === 'kids' && (
        <Tabs
          tabs={[
            { id: 'musicalizacao', label: 'Musicalização' },
            { id: 'iniciacao', label: 'Iniciação' },
          ]}
          active={kidsTab}
          onChange={(id) => setKidsTab(id as 'musicalizacao' | 'iniciacao')}
        />
      )}

      {showCursoSelect && (
        <div className="space-y-1">
          <label className="text-body-sm text-fg-muted font-semibold">Curso</label>
          <CustomSelect
            value={cursoId}
            onChange={setCursoIdSelected}
            options={cursoOptions}
            placeholder="Selecione um curso"
          />
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">
          Checkpoints
        </h3>
        {checkpointsExibidos.map((cp, idx) => {
          const cpProgresso = progressoDoCurso?.checkpoints.find(c => c.checkpoint_id === cp.id);
          const status = cpProgresso?.status ?? 'sem_inicio';
          const pct = cpProgresso?.percentual ?? 0;
          const preenchidos = cpProgresso?.campos_preenchidos ?? 0;
          const total = cpProgresso?.campos_total ?? 0;

          return (
            <button
              key={cp.id}
              onClick={() => handleCardClick(cp.id)}
              className="w-full bg-bg-surface rounded-lg border border-border p-md flex items-center gap-md hover:border-tom transition text-left"
            >
              <div className="w-10 h-10 rounded-full bg-tom/10 text-tom font-bold flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-fg">{cp.nome}</span>
                  {status !== 'sem_inicio' && (
                    <Badge variant={statusBadgeVariant(status)}>
                      {STATUS_LABELS[status as StatusConteudo]}
                    </Badge>
                  )}
                </div>
                {cp.equivalencia && (
                  <div className="text-[11px] text-fg-muted mb-2">{cp.equivalencia}</div>
                )}
                <ProgressBar percentual={pct} />
                <div className="text-[11px] text-fg-muted mt-1">
                  {pct}% · {preenchidos}/{total} campos
                </div>
              </div>
              <span className="text-fg-muted">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Validar TypeScript**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

- [ ] **Step 3: Validar visualmente no Simple Browser**

Acessar `http://localhost:4173/la-journey`. Tirar screenshot com `mcp__Claude_Preview__preview_screenshot` no serverId do `web-preview`. Verificar paridade com `mockup 01-lista-checkpoints.html`.

---

## Task 9: MarcoCard component (header + collapse)

**Files:**
- Create: `_remote/web/src/screens/lajourney/components/MarcoCard.tsx`

- [ ] **Step 1: Implementar**

```tsx
// _remote/web/src/screens/lajourney/components/MarcoCard.tsx
import { useState, type ReactNode } from 'react';
import { Badge } from '../../../components/Badge';
import type { JourneyMarcoComCampos } from '../../../lib/lajourney-types';
import { camposDoTipo } from '../../../lib/lajourney-types';

interface Props {
  marco: JourneyMarcoComCampos;
  total: number;
  defaultOpen?: boolean;
  readOnly?: boolean;
  onRemove?: () => void;
  children: ReactNode;
}

function tipoLabel(tipo: string): string {
  if (tipo === 'aprendizado') return 'Aprendizado';
  if (tipo === 'consolidacao') return 'Consolidação';
  return 'Ancoragem Radial';
}

function tipoColor(tipo: string): 'success' | 'warning' | 'info' {
  if (tipo === 'aprendizado') return 'success';
  if (tipo === 'consolidacao') return 'warning';
  return 'info';
}

export function MarcoCard({ marco, total, defaultOpen = false, readOnly = false, onRemove, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const chaves = camposDoTipo(marco.tipo);
  const preenchidos = chaves.filter(k => (marco.campos[k] ?? '').trim()).length;

  return (
    <div className={`bg-bg-surface rounded-lg border border-border overflow-hidden ${open ? 'shadow-sm' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-md py-sm flex items-center gap-sm text-left hover:bg-bg-app/40"
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
          marco.tipo === 'aprendizado' ? 'bg-tom/10 text-tom' :
          marco.tipo === 'consolidacao' ? 'bg-warning/20 text-warning' :
          'bg-info/20 text-info'
        }`}>
          {marco.numero}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">
            Marco {marco.numero} de {total}
          </div>
          <div className="text-body-sm font-semibold text-fg truncate">
            {marco.titulo || marco.tema_foco || tipoLabel(marco.tipo)}
          </div>
          <div className="text-[10px] text-fg-muted">
            {preenchidos}/{chaves.length} campos
          </div>
        </div>
        <Badge variant={tipoColor(marco.tipo)}>{tipoLabel(marco.tipo)}</Badge>
        <span className={`text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="border-t border-border p-md space-y-md">
          {children}
          {!readOnly && onRemove && marco.tipo !== 'consolidacao' && (
            <button
              onClick={onRemove}
              className="text-body-sm text-danger hover:underline mt-md"
            >
              🗑 Remover marco
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Validar TypeScript**

---

## Task 10: MarcoBodyAprendizado component

**Files:**
- Create: `_remote/web/src/screens/lajourney/components/MarcoBodyAprendizado.tsx`

- [ ] **Step 1: Implementar com auto-save**

```tsx
// _remote/web/src/screens/lajourney/components/MarcoBodyAprendizado.tsx
import { useState, useEffect, useRef } from 'react';
import type { JourneyMarcoComCampos } from '../../../lib/lajourney-types';
import { CAMPO_LABELS, CAMPO_PLACEHOLDERS } from '../../../lib/lajourney-types';
import { upsertJourneyMarcoCampo } from '../../../lib/lajourney';
import { showToast } from '../../../components/Toast';

interface Props {
  marco: JourneyMarcoComCampos;
  readOnly?: boolean;
  onSaving?: () => void;
  onSaved?: () => void;
}

const AXES = ['teoria_conceitos', 'tecnica', 'ritmo_percepcao', 'repertorio_aplicacao'] as const;

function useDebouncedSave(marcoId: string, onSaving?: () => void, onSaved?: () => void) {
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  return (campoChave: string, valor: string) => {
    if (timersRef.current[campoChave]) clearTimeout(timersRef.current[campoChave]);
    timersRef.current[campoChave] = setTimeout(async () => {
      onSaving?.();
      try {
        await upsertJourneyMarcoCampo({ marcoId, campoChave, campoValor: valor });
        onSaved?.();
      } catch (e) {
        showToast({ kind: 'error', title: 'Falha ao salvar', msg: (e as Error).message });
      }
    }, 600);
  };
}

export function MarcoBodyAprendizado({ marco, readOnly, onSaving, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>(marco.campos);
  const debouncedSave = useDebouncedSave(marco.id, onSaving, onSaved);

  useEffect(() => { setValues(marco.campos); }, [marco.id]);

  function update(k: string, v: string) {
    setValues(prev => ({ ...prev, [k]: v }));
    debouncedSave(k, v);
  }

  return (
    <>
      <Field
        label={CAMPO_LABELS.tema_foco}
        value={values.tema_foco ?? ''}
        onChange={(v) => update('tema_foco', v)}
        placeholder={CAMPO_PLACEHOLDERS.tema_foco}
        readOnly={readOnly}
        rows={2}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        {AXES.map(ax => (
          <Field
            key={ax}
            label={CAMPO_LABELS[ax]}
            value={values[ax] ?? ''}
            onChange={(v) => update(ax, v)}
            placeholder={CAMPO_PLACEHOLDERS[ax]}
            readOnly={readOnly}
            rows={3}
            compact
          />
        ))}
      </div>

      <Field
        label={CAMPO_LABELS.evidencia_ancoragem}
        value={values.evidencia_ancoragem ?? ''}
        onChange={(v) => update('evidencia_ancoragem', v)}
        placeholder={CAMPO_PLACEHOLDERS.evidencia_ancoragem}
        readOnly={readOnly}
        rows={2}
      />

      <Field
        label={CAMPO_LABELS.musica_desafio}
        value={values.musica_desafio ?? ''}
        onChange={(v) => update('musica_desafio', v)}
        placeholder={CAMPO_PLACEHOLDERS.musica_desafio}
        readOnly={readOnly}
        rows={2}
      />
    </>
  );
}

function Field({ label, value, onChange, placeholder, readOnly, rows = 3, compact = false }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; readOnly?: boolean; rows?: number; compact?: boolean;
}) {
  const padding = compact ? 'p-sm' : 'p-md';
  return (
    <div className={compact ? 'bg-bg-app/40 rounded-md p-sm border border-border' : ''}>
      <label className="block text-[10px] uppercase tracking-wide text-fg-muted font-semibold mb-1">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        rows={rows}
        className={`w-full bg-bg-surface text-fg rounded-md border border-border focus:border-tom focus:outline-none ${padding} resize-y leading-relaxed`}
        style={{ minHeight: rows * 22 }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Validar TypeScript**

---

## Task 11: MarcoBodyConsolidacao component

**Files:**
- Create: `_remote/web/src/screens/lajourney/components/MarcoBodyConsolidacao.tsx`

- [ ] **Step 1: Implementar**

```tsx
// _remote/web/src/screens/lajourney/components/MarcoBodyConsolidacao.tsx
import { useState, useEffect, useRef } from 'react';
import type { JourneyMarcoComCampos } from '../../../lib/lajourney-types';
import { CAMPO_LABELS, CAMPO_PLACEHOLDERS } from '../../../lib/lajourney-types';
import { upsertJourneyMarcoCampo } from '../../../lib/lajourney';
import { showToast } from '../../../components/Toast';

interface Props {
  marco: JourneyMarcoComCampos;
  readOnly?: boolean;
  onSaving?: () => void;
  onSaved?: () => void;
}

const CAMPOS = ['ancoragens_reforcadas', 'lapidacao_tecnica', 'repertorio_recital', 'formato_celebracao'] as const;

export function MarcoBodyConsolidacao({ marco, readOnly, onSaving, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>(marco.campos);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { setValues(marco.campos); }, [marco.id]);

  function update(k: string, v: string) {
    setValues(prev => ({ ...prev, [k]: v }));
    if (timersRef.current[k]) clearTimeout(timersRef.current[k]);
    timersRef.current[k] = setTimeout(async () => {
      onSaving?.();
      try {
        await upsertJourneyMarcoCampo({ marcoId: marco.id, campoChave: k, campoValor: v });
        onSaved?.();
      } catch (e) {
        showToast({ kind: 'error', title: 'Falha ao salvar', msg: (e as Error).message });
      }
    }, 600);
  }

  return (
    <>
      <div className="bg-warning/10 border border-warning/40 rounded-md p-md text-body-sm text-fg flex gap-sm">
        <span className="text-base">⚓</span>
        <span>
          Este marco é de <strong>polimento</strong>, não de conteúdo novo.
          Os assuntos que ainda não foram absorvidos são reforçados aqui, preparando o aluno para o recital.
        </span>
      </div>

      {CAMPOS.map(k => (
        <div key={k}>
          <label className="block text-[10px] uppercase tracking-wide text-fg-muted font-semibold mb-1">
            {CAMPO_LABELS[k]}
          </label>
          <textarea
            value={values[k] ?? ''}
            onChange={(e) => update(k, e.target.value)}
            placeholder={CAMPO_PLACEHOLDERS[k]}
            readOnly={readOnly}
            rows={3}
            className="w-full bg-bg-surface text-fg rounded-md border border-border focus:border-tom focus:outline-none p-md resize-y leading-relaxed"
            style={{ minHeight: 80 }}
          />
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Validar TypeScript**

---

## Task 12: MarcoBodyRadial component

**Files:**
- Create: `_remote/web/src/screens/lajourney/components/MarcoBodyRadial.tsx`

- [ ] **Step 1: Implementar** (mesma estrutura do Consolidacao, campos diferentes)

```tsx
// _remote/web/src/screens/lajourney/components/MarcoBodyRadial.tsx
import { useState, useEffect, useRef } from 'react';
import type { JourneyMarcoComCampos } from '../../../lib/lajourney-types';
import { CAMPO_LABELS, CAMPO_PLACEHOLDERS } from '../../../lib/lajourney-types';
import { upsertJourneyMarcoCampo } from '../../../lib/lajourney';
import { showToast } from '../../../components/Toast';

interface Props {
  marco: JourneyMarcoComCampos;
  readOnly?: boolean;
  onSaving?: () => void;
  onSaved?: () => void;
}

const CAMPOS = ['conquista_musical', 'manifestacao_crianca', 'vivencias_atividades', 'recursos_pedagogicos'] as const;

export function MarcoBodyRadial({ marco, readOnly, onSaving, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>(marco.campos);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { setValues(marco.campos); }, [marco.id]);

  function update(k: string, v: string) {
    setValues(prev => ({ ...prev, [k]: v }));
    if (timersRef.current[k]) clearTimeout(timersRef.current[k]);
    timersRef.current[k] = setTimeout(async () => {
      onSaving?.();
      try {
        await upsertJourneyMarcoCampo({ marcoId: marco.id, campoChave: k, campoValor: v });
        onSaved?.();
      } catch (e) {
        showToast({ kind: 'error', title: 'Falha ao salvar', msg: (e as Error).message });
      }
    }, 600);
  }

  return (
    <>
      {CAMPOS.map(k => (
        <div key={k}>
          <label className="block text-[10px] uppercase tracking-wide text-fg-muted font-semibold mb-1">
            {CAMPO_LABELS[k]}
          </label>
          <textarea
            value={values[k] ?? ''}
            onChange={(e) => update(k, e.target.value)}
            placeholder={CAMPO_PLACEHOLDERS[k]}
            readOnly={readOnly}
            rows={3}
            className="w-full bg-bg-surface text-fg rounded-md border border-border focus:border-tom focus:outline-none p-md resize-y leading-relaxed"
            style={{ minHeight: 80 }}
          />
        </div>
      ))}
    </>
  );
}
```

---

## Task 13: AddMarcoSheet component (BottomSheet pra escolher tipo)

**Files:**
- Create: `_remote/web/src/screens/lajourney/components/AddMarcoSheet.tsx`

- [ ] **Step 1: Implementar**

```tsx
// _remote/web/src/screens/lajourney/components/AddMarcoSheet.tsx
import { BottomSheet } from '../../../components/BottomSheet';
import type { TipoCheckpoint, TipoMarco } from '../../../lib/lajourney-types';

interface Props {
  open: boolean;
  onClose: () => void;
  tipoCheckpoint: TipoCheckpoint;
  jaTemConsolidacao: boolean;
  onAdd: (tipo: TipoMarco) => void;
}

export function AddMarcoSheet({ open, onClose, tipoCheckpoint, jaTemConsolidacao, onAdd }: Props) {
  // Pra musicalização, só permite radial
  // Pra School/Heart: aprendizado sempre. Consolidação só se não tiver.
  const opcoes: Array<{ tipo: TipoMarco; label: string; descricao: string }> = [];
  if (tipoCheckpoint === 'musicalizacao') {
    opcoes.push({
      tipo: 'ancoragem_radial',
      label: 'Marco de Ancoragem Radial',
      descricao: 'Novo marco com 4 campos: conquista musical, manifestação, vivências, recursos.',
    });
  } else {
    opcoes.push({
      tipo: 'aprendizado',
      label: 'Marco de Aprendizado',
      descricao: 'Tema/foco + 4 eixos de ancoragem + evidência + música desafio.',
    });
    if (!jaTemConsolidacao) {
      opcoes.push({
        tipo: 'consolidacao',
        label: 'Marco de Consolidação',
        descricao: 'Polimento e recital. Apenas 1 por checkpoint.',
      });
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Adicionar marco">
      <div className="space-y-sm pb-md">
        {opcoes.map(o => (
          <button
            key={o.tipo}
            onClick={() => { onAdd(o.tipo); onClose(); }}
            className="w-full bg-bg-surface border border-border rounded-md p-md text-left hover:border-tom transition"
          >
            <div className="font-semibold text-fg mb-1">{o.label}</div>
            <div className="text-body-sm text-fg-muted">{o.descricao}</div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Validar TypeScript**

---

## Task 14: CheckpointPage — `/la-journey/:checkpointId`

**Files:**
- Create: `_remote/web/src/screens/lajourney/CheckpointPage.tsx`

- [ ] **Step 1: Implementar a tela completa de edição**

```tsx
// _remote/web/src/screens/lajourney/CheckpointPage.tsx
import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { showToast } from '../../components/Toast';
import {
  useJourneyCheckpoints, useJourneyCursos, useJourneyConteudo,
} from '../../hooks/useLaJourney';
import {
  upsertJourneyConteudoHeader, adicionarJourneyMarco, removerJourneyMarco,
  submeterJourneyParaRevisao, publicarJourneyConteudo,
  reverterJourneyParaRascunho, devolverJourneyParaRevisao,
  canSubmitJourney,
} from '../../lib/lajourney';
import type { Programa, TipoMarco } from '../../lib/lajourney-types';
import { STATUS_LABELS } from '../../lib/lajourney-types';
import { MarcoCard } from './components/MarcoCard';
import { MarcoBodyAprendizado } from './components/MarcoBodyAprendizado';
import { MarcoBodyConsolidacao } from './components/MarcoBodyConsolidacao';
import { MarcoBodyRadial } from './components/MarcoBodyRadial';
import { AddMarcoSheet } from './components/AddMarcoSheet';

export function LaJourneyCheckpointPage() {
  const { checkpointId } = useParams<{ checkpointId: string }>();
  const [searchParams] = useSearchParams();
  const cursoId = searchParams.get('curso') ?? '';
  const qc = useQueryClient();
  const { role } = useAuth();

  // Detecta programa pelo prefixo do checkpointId ('school_*' | 'kids_*')
  const programa: Programa = (checkpointId?.startsWith('kids_') ? 'kids' : 'school');

  const { data: checkpoints = [] } = useJourneyCheckpoints(programa);
  const { data: cursos = [] } = useJourneyCursos(programa);
  const checkpoint = checkpoints.find(c => c.id === checkpointId);
  const curso = cursos.find(c => c.id === cursoId);

  const { data: dados, isLoading, refetch } = useJourneyConteudo(programa, cursoId, checkpointId ?? null);

  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const headerTimerRef = useRef<{ pe?: ReturnType<typeof setTimeout>; te?: ReturnType<typeof setTimeout> }>({});
  const [perfilEntrada, setPerfilEntrada] = useState('');
  const [transformacaoEsperada, setTransformacaoEsperada] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemoveMarcoId, setConfirmRemoveMarcoId] = useState<string | null>(null);

  useEffect(() => {
    if (dados?.conteudo) {
      setPerfilEntrada(dados.conteudo.perfil_entrada ?? '');
      setTransformacaoEsperada(dados.conteudo.transformacao_esperada ?? '');
    }
  }, [dados?.conteudo?.id]);

  function flashSaved() {
    setSavingState('saved');
    setTimeout(() => setSavingState('idle'), 1500);
  }

  function saveHeader(field: 'perfil_entrada' | 'transformacao_esperada', value: string) {
    if (!checkpointId || !cursoId) return;
    if (dados?.conteudo?.status === 'publicado') return;
    const key = field === 'perfil_entrada' ? 'pe' : 'te';
    if (headerTimerRef.current[key]) clearTimeout(headerTimerRef.current[key]);
    headerTimerRef.current[key] = setTimeout(async () => {
      setSavingState('saving');
      try {
        await upsertJourneyConteudoHeader({
          programaId: programa,
          cursoId,
          checkpointId,
          [field === 'perfil_entrada' ? 'perfilEntrada' : 'transformacaoEsperada']: value,
        });
        flashSaved();
        qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId] });
      } catch (e) {
        showToast({ kind: 'error', title: 'Falha ao salvar', msg: (e as Error).message });
      }
    }, 600);
  }

  async function handleAddMarco(tipo: TipoMarco) {
    if (!dados?.conteudo) {
      // cria o conteudo primeiro (se nunca foi salvo)
      await upsertJourneyConteudoHeader({ programaId: programa, cursoId, checkpointId: checkpointId! });
      await refetch();
      return;
    }
    const nextNumero = (dados.marcos[dados.marcos.length - 1]?.numero ?? 0) + 1;
    try {
      await adicionarJourneyMarco({ conteudoId: dados.conteudo.id, numero: nextNumero, tipo });
      showToast({ kind: 'success', title: 'Marco adicionado.' });
      qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId] });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    }
  }

  async function handleRemoveMarco(marcoId: string) {
    try {
      await removerJourneyMarco(marcoId);
      showToast({ kind: 'success', title: 'Marco removido.' });
      qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId] });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    } finally {
      setConfirmRemoveMarcoId(null);
    }
  }

  async function handleSubmeter() {
    if (!dados?.conteudo) return;
    const check = await canSubmitJourney(dados.conteudo.id);
    if (!check.ok) {
      const partes: string[] = [];
      if (check.campos_faltando?.length) partes.push(`Cabeçalho: ${check.campos_faltando.join(', ')}`);
      if (check.marcos_incompletos?.length) partes.push(`Marcos: ${check.marcos_incompletos.join(', ')}`);
      showToast({ kind: 'error', title: 'Faltam campos', msg: partes.join(' · ') });
      return;
    }
    try {
      await submeterJourneyParaRevisao(dados.conteudo.id);
      showToast({ kind: 'success', title: 'Enviado para revisão da coordenação.' });
      qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId] });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    }
  }

  async function handlePublicar() {
    if (!dados?.conteudo) return;
    try {
      await publicarJourneyConteudo(dados.conteudo.id);
      showToast({ kind: 'success', title: 'Publicado!' });
      qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId] });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    }
  }

  async function handleDevolver() {
    if (!dados?.conteudo) return;
    try {
      await reverterJourneyParaRascunho(dados.conteudo.id);
      showToast({ kind: 'success', title: 'Devolvido pra rascunho.' });
      qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId] });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    }
  }

  async function handleReverter() {
    if (!dados?.conteudo) return;
    try {
      await devolverJourneyParaRevisao(dados.conteudo.id);
      showToast({ kind: 'success', title: 'Voltou pra revisão.' });
      qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId] });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    }
  }

  if (isLoading || !checkpoint) return <LoadingState />;

  const status = dados?.conteudo?.status ?? 'rascunho';
  const readOnly = status === 'publicado';
  const isCoord = role === 'coordinator' || role === 'director';
  const isMusicalizacao = checkpoint.tipo === 'musicalizacao';
  const jaTemConsolidacao = (dados?.marcos ?? []).some(m => m.tipo === 'consolidacao');

  return (
    <div className="space-y-md pb-32">
      <PageHeader
        title={checkpoint.nome}
        subtitle={`${curso?.icone ?? ''} ${curso?.nome ?? cursoId} · ${programa === 'school' ? 'School' : 'Kids'}`}
        backTo="/la-journey"
        right={
          savingState === 'saving' ? <span className="text-body-sm text-fg-muted">salvando…</span> :
          savingState === 'saved' ? <span className="text-body-sm text-success">✓ salvo</span> : null
        }
      />

      {/* Status bar */}
      <div className="bg-bg-surface border border-border rounded-md px-md py-sm flex justify-between text-body-sm">
        <span>Status: <strong>{STATUS_LABELS[status]}</strong></span>
        <span className="text-fg-muted">
          {dados?.progresso.percentual ?? 0}% · {dados?.progresso.preenchidos ?? 0}/{dados?.progresso.total ?? 0} campos
        </span>
      </div>

      {readOnly && (
        <div className="bg-success/10 border border-success/30 rounded-md p-md text-body-sm">
          ✅ <strong>Publicado</strong> em {dados?.conteudo?.publicado_em ? new Date(dados.conteudo.publicado_em).toLocaleDateString('pt-BR') : ''}.
          Edição bloqueada.
          {isCoord && (
            <button onClick={handleReverter} className="ml-2 text-tom underline">
              Reverter pra revisão
            </button>
          )}
        </div>
      )}

      {isMusicalizacao && (
        <div className="bg-info/10 border border-info/30 rounded-md p-md text-body-sm flex gap-sm">
          <span className="text-base">◎</span>
          <span>
            <strong>Ensino Radial.</strong> Na Musicalização o processo é expansivo,
            sem marco de consolidação. A consolidação dos fundamentos acontece na Iniciação ao Instrumento.
          </span>
        </div>
      )}

      <div className="space-y-md">
        <FieldHeader
          label={isMusicalizacao ? 'Onde a criança chega' : 'Perfil de entrada'}
          placeholder={isMusicalizacao
            ? 'O que a criança traz desta faixa etária? Como ela chega a esta fase?'
            : 'O que o aluno já sabe ao iniciar este checkpoint?'}
          value={perfilEntrada}
          onChange={(v) => { setPerfilEntrada(v); saveHeader('perfil_entrada', v); }}
          readOnly={readOnly}
        />
        <FieldHeader
          label={isMusicalizacao ? 'O que se desenvolve' : 'Transformação esperada'}
          placeholder={isMusicalizacao
            ? 'Quais conquistas musicais e comportamentais são desenvolvidas aqui?'
            : 'O que o aluno será capaz de fazer ao concluir?'}
          value={transformacaoEsperada}
          onChange={(v) => { setTransformacaoEsperada(v); saveHeader('transformacao_esperada', v); }}
          readOnly={readOnly}
        />
      </div>

      <div className="flex items-center gap-sm">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">
          {isMusicalizacao ? 'Marcos do Desenvolvimento Musical' : 'Marcos do Checkpoint'}
          {' '}({dados?.marcos.length ?? 0})
        </h3>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div className="space-y-2">
        {(dados?.marcos ?? []).map((m, idx) => (
          <MarcoCard
            key={m.id}
            marco={m}
            total={dados?.marcos.length ?? 0}
            defaultOpen={idx === 0}
            readOnly={readOnly}
            onRemove={readOnly ? undefined : () => setConfirmRemoveMarcoId(m.id)}
          >
            {m.tipo === 'aprendizado' && (
              <MarcoBodyAprendizado marco={m} readOnly={readOnly} onSaving={() => setSavingState('saving')} onSaved={flashSaved} />
            )}
            {m.tipo === 'consolidacao' && (
              <MarcoBodyConsolidacao marco={m} readOnly={readOnly} onSaving={() => setSavingState('saving')} onSaved={flashSaved} />
            )}
            {m.tipo === 'ancoragem_radial' && (
              <MarcoBodyRadial marco={m} readOnly={readOnly} onSaving={() => setSavingState('saving')} onSaved={flashSaved} />
            )}
          </MarcoCard>
        ))}

        {!readOnly && (
          <button
            onClick={() => setAddOpen(true)}
            className="w-full border-2 border-dashed border-border text-fg-muted hover:border-tom hover:text-tom rounded-lg p-md font-semibold text-body-sm"
          >
            + Adicionar marco
          </button>
        )}
      </div>

      {/* Sticky workflow footer */}
      {!readOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-bg-surface border-t border-border p-md flex gap-sm" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {status === 'rascunho' && (
            <button
              onClick={handleSubmeter}
              className="flex-1 bg-tom text-black rounded-md py-sm font-semibold"
            >
              Enviar pra revisão
            </button>
          )}
          {status === 'em_revisao' && isCoord && (
            <>
              <button onClick={handleDevolver} className="flex-1 bg-bg-app border border-border text-fg rounded-md py-sm font-semibold">
                Devolver
              </button>
              <button onClick={handlePublicar} className="flex-1 bg-success text-white rounded-md py-sm font-semibold">
                Publicar
              </button>
            </>
          )}
          {status === 'em_revisao' && !isCoord && (
            <div className="flex-1 text-center text-body-sm text-fg-muted py-sm">
              Aguardando revisão da coordenação.
            </div>
          )}
        </div>
      )}

      <AddMarcoSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        tipoCheckpoint={checkpoint.tipo}
        jaTemConsolidacao={jaTemConsolidacao}
        onAdd={handleAddMarco}
      />

      <ConfirmDialog
        open={confirmRemoveMarcoId !== null}
        title="Remover marco?"
        message="Os campos preenchidos deste marco serão perdidos."
        confirmLabel="Remover"
        danger
        onConfirm={() => handleRemoveMarco(confirmRemoveMarcoId!)}
        onCancel={() => setConfirmRemoveMarcoId(null)}
      />
    </div>
  );
}

function FieldHeader({ label, value, onChange, placeholder, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; readOnly?: boolean;
}) {
  return (
    <div className="bg-bg-surface rounded-lg border border-border p-md">
      <label className="block text-[10px] uppercase tracking-wide text-fg-muted font-semibold mb-2">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        rows={3}
        className="w-full bg-bg-app text-fg rounded-md border border-border focus:border-tom focus:outline-none p-md resize-y leading-relaxed"
        style={{ minHeight: 80 }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Validar TypeScript**

- [ ] **Step 3: Validar visualmente no Simple Browser**

Acessar `http://localhost:4173/la-journey/school_foundation?curso=bateria`. Screenshot. Comparar com mockup 02.

---

## Task 15: CursoStatusCard component (pro dashboard)

**Files:**
- Create: `_remote/web/src/screens/lajourney/components/CursoStatusCard.tsx`

- [ ] **Step 1: Implementar**

```tsx
// _remote/web/src/screens/lajourney/components/CursoStatusCard.tsx
import { useNavigate } from 'react-router-dom';
import type { JourneyCursoProgresso, Programa } from '../../../lib/lajourney-types';

interface Props {
  programaId: Programa;
  curso: JourneyCursoProgresso;
}

function cellClasses(status: string, percentual: number): string {
  if (percentual === 0 && status === 'sem_inicio') return 'bg-bg-app border-border text-fg-muted';
  if (status === 'publicado') return 'bg-success/10 border-success/40 text-success';
  if (status === 'em_revisao') return 'bg-warning/10 border-warning/40 text-warning';
  return 'bg-bg-surface border-border text-fg';
}

export function CursoStatusCard({ programaId, curso }: Props) {
  const navigate = useNavigate();
  const apoio = (curso.mentores_apoio ?? []).join(' · ');
  const atrasoDias = curso.checkpoints
    .map(c => c.dias_sem_editar ?? 0)
    .reduce((max, d) => Math.max(max, d), 0);
  const atrasado = atrasoDias > 14;

  const cpEmRevisao = curso.checkpoints.find(c => c.status === 'em_revisao');

  return (
    <div className="bg-bg-surface rounded-lg border border-border p-md">
      <div className="flex items-center gap-sm mb-3">
        <span className="text-2xl">{curso.curso_icone}</span>
        <div className="flex-1">
          <div className="font-semibold text-fg">{curso.curso_nome}</div>
          <div className="text-[11px] text-fg-muted">
            {curso.mentor_principal}{apoio ? ` · ${apoio}` : ''}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {curso.checkpoints.map(cp => (
          <button
            key={cp.checkpoint_id}
            onClick={() => navigate(`/la-journey/${cp.checkpoint_id}?curso=${curso.curso_id}`)}
            className={`p-2 rounded-md border text-center hover:shadow-sm transition ${cellClasses(cp.status, cp.percentual)}`}
          >
            <div className="text-[9px] font-semibold truncate">{cp.checkpoint_nome}</div>
            <div className="text-base font-bold">{cp.percentual}%</div>
          </button>
        ))}
      </div>

      <div className="flex justify-between items-center text-[11px] pt-2 border-t border-border">
        <span className={atrasado ? 'text-danger font-semibold' : 'text-fg-muted'}>
          {curso.ultima_edicao
            ? (atrasado ? `⚠ ${atrasoDias}d sem editar` : `Última edição: ${formatRelativa(curso.ultima_edicao)}`)
            : 'Sem edições'}
        </span>
        {cpEmRevisao && (
          <button
            onClick={() => navigate(`/la-journey/${cpEmRevisao.checkpoint_id}?curso=${curso.curso_id}`)}
            className="text-tom font-semibold"
          >
            Revisar {cpEmRevisao.checkpoint_nome} →
          </button>
        )}
      </div>
    </div>
  );
}

function formatRelativa(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 7) return `${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}
```

- [ ] **Step 2: Validar TypeScript**

---

## Task 16: AdminPage — `/la-journey/admin`

**Files:**
- Create: `_remote/web/src/screens/lajourney/AdminPage.tsx`

- [ ] **Step 1: Implementar dashboard**

```tsx
// _remote/web/src/screens/lajourney/AdminPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { Tabs } from '../../components/Tabs';
import { StatCard } from '../../components/StatCard';
import { useJourneyListaProgresso, useJourneyPendencias } from '../../hooks/useLaJourney';
import { CursoStatusCard } from './components/CursoStatusCard';
import type { Programa } from '../../lib/lajourney-types';

export function LaJourneyAdminPage() {
  const navigate = useNavigate();
  const [programa, setPrograma] = useState<Programa>('school');
  const { data: cursos = [], isLoading } = useJourneyListaProgresso(programa);
  const { data: pendencias = [] } = useJourneyPendencias();

  if (isLoading) return <LoadingState />;

  // Estatísticas globais do programa
  const todosCheckpoints = cursos.flatMap(c => c.checkpoints);
  const pctGlobal = todosCheckpoints.length === 0
    ? 0
    : Math.round(todosCheckpoints.reduce((s, c) => s + c.percentual, 0) / todosCheckpoints.length);
  const emRevisao = todosCheckpoints.filter(c => c.status === 'em_revisao').length;
  const publicados = todosCheckpoints.filter(c => c.status === 'publicado').length;

  const atrasados = cursos.filter(c =>
    c.checkpoints.some(cp => (cp.dias_sem_editar ?? 0) > 14 && cp.status !== 'publicado' && cp.status !== 'sem_inicio')
  );

  const pendenciasPrograma = pendencias.filter(p => p.programa_id === programa);

  return (
    <div className="space-y-md pb-xl">
      <PageHeader
        title="Governança"
        subtitle="LA Journey"
        backTo="/la-journey"
      />

      <Tabs
        tabs={[{ id: 'school', label: 'School' }, { id: 'kids', label: 'Kids' }]}
        active={programa}
        onChange={(id) => setPrograma(id as Programa)}
      />

      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Preenchido" value={`${pctGlobal}%`} />
        <StatCard label="Em revisão" value={emRevisao} />
        <StatCard label="Publicado" value={publicados} />
      </div>

      {atrasados.length > 0 && (
        <div className="bg-warning/10 border border-warning/40 border-l-4 rounded-md p-md text-body-sm">
          <strong>⚠️ {atrasados.length} curso{atrasados.length > 1 ? 's' : ''} sem atualização há 14+ dias.</strong>
          {' '}Tom já enviou lembrete pra {atrasados.map(c => c.mentor_principal ?? '?').join(', ')} na segunda.
        </div>
      )}

      <div className="flex items-center gap-sm">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Status por curso</h3>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div className="space-y-sm">
        {cursos.map(c => (
          <CursoStatusCard key={c.curso_id} programaId={programa} curso={c} />
        ))}
      </div>

      {pendenciasPrograma.length > 0 && (
        <>
          <div className="flex items-center gap-sm mt-md">
            <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">
              Pendências de revisão
            </h3>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="bg-bg-surface border border-border rounded-md divide-y divide-border">
            {pendenciasPrograma.map(p => (
              <button
                key={p.conteudo_id}
                onClick={() => navigate(`/la-journey/${p.checkpoint_id}?curso=${p.curso_id}`)}
                className="w-full flex justify-between items-center p-md text-body-sm hover:bg-bg-app/40"
              >
                <span className="font-semibold text-fg">{p.curso_nome} · {p.checkpoint_nome}</span>
                <span className="text-tom">Revisar →</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Validar TypeScript**

- [ ] **Step 3: Validar visualmente no Simple Browser**

`http://localhost:4173/la-journey/admin`. Screenshot. Comparar com mockup 03.

---

## Task 17: Skill `la-journey.md` (TOM)

**Files:**
- Create: `_remote/skills/la-journey.md`

- [ ] **Step 1: Escrever a skill**

```markdown
# Skill: LA Journey

## Triggers
Detecta perguntas sobre a **jornada pedagógica do aluno** (LA Journey — School + Kids):

- "como tá o LA Journey", "status journey", "como tá a journey"
- "atrasados journey", "pendências journey", "publicado journey"
- Nome de curso isolado: "bateria", "canto", "cordas", "teclas", "musicalização"
- "quem é mentor de [curso]"
- "/journey", "/journey [curso]"

## Contexto disponível

Quando o trigger for detectado, injeta no system prompt `[LA_JOURNEY_STATUS]`
com snapshot atualizado:

- Por programa: % preenchido global
- Por curso: status de cada checkpoint (% + emoji ✅🟡⚪)
- Mentores responsáveis por curso
- Pendências de revisão
- Cursos atrasados (>14 dias sem editar)

## Padrões de resposta

### "como tá o LA Journey?"
Apresentar visão geral por programa:
```
School: X% preenchido
- 🥁 Bateria (mentores): F<emoji>% G<emoji>% A<emoji>% M<emoji>%
[...]
Kids: Y% — [observação]
Pendências de revisão (N): [lista]
Atrasados >14d: [lista]
Quer detalhe de algum curso específico?
```

### "[curso]"
Drill-down do curso:
```
[emoji] [Curso] — mentores: X + Y
Foundation [emoji] status · X% · última edição [data]
Grow [...]
[etc]
[Pergunta de seguimento]
```

### "atrasados journey"
```
Cursos parados há >14 dias:
- [curso] (X dias) — mentor: [nome]
[...]
```

### "publicado journey"
```
Checkpoints publicados:
- [curso] [checkpoint] — em [data] por [coord]
[...]
```

## Comportamento

- **Sempre** usar dados do `[LA_JOURNEY_STATUS]` injetado. Nunca inventar números.
- **Não comparar** com período anterior (não temos histórico de snapshots).
- Emojis de status: ✅ publicado, 🟡 em revisão, ⚪ rascunho, ⬜ sem início.
- Sugerir ação seguinte sempre que possível ("Quer revisar?" / "Quer ping pro mentor?").
- Se o usuário não tem permissão (não é coord/director nem mentor do curso), responder educadamente sem expor dados.
```

- [ ] **Step 2: Deploy SCP pra VPS**

```bash
scp D:/la-organizer/_remote/skills/la-journey.md tom:/opt/LA-Organizer/skills/
```

(Não precisa restart porque skills são lidas a cada turno do TOM.)

---

## Task 18: System prompt — detecção LA Journey

**Files:**
- Modify: `_remote/src/prompts/system.js`

- [ ] **Step 1: Localizar bloco de injeção do LA EDUCA**

Pattern atual (já existente):
```js
if (lowerMsg.includes('la educa') || /* ... */) {
  systemPrompt += `\n\n[LA_EDUCA_STATUS]\n${...}`;
}
```

- [ ] **Step 2: Adicionar bloco análogo pro LA Journey**

Logo após o bloco do LA EDUCA, inserir:

```js
// ─── LA JOURNEY — detecção e injeção de contexto ───────────────────
const cursosJourney = ['bateria', 'canto', 'cordas', 'teclas', 'musicalização', 'musicalizacao'];
const triggersJourney = ['la journey', 'la-journey', 'lajourney', 'journey', 'jornada', 'jornada pedagógica',
  'atrasados journey', 'pendências journey', 'publicado journey'];

const matchJourney = triggersJourney.some(t => lowerMsg.includes(t)) ||
                     cursosJourney.some(c => lowerMsg.includes(c)) ||
                     /^\s*\/journey\b/.test(lowerMsg);

if (matchJourney) {
  try {
    // Carrega snapshot via supabase (já injetado no escopo)
    const { data: school } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'school' });
    const { data: kids } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'kids' });
    const { data: pendencias } = await supabase
      .from('la_journey_conteudo_checkpoint')
      .select('id, programa_id, curso_id, checkpoint_id, updated_at, la_journey_cursos(nome), la_journey_checkpoints(nome)')
      .eq('status', 'em_revisao');

    const fmt = (rows, label) => {
      if (!rows || rows.length === 0) return `${label}: sem dados`;
      const porCurso = {};
      for (const r of rows) {
        if (!porCurso[r.curso_id]) porCurso[r.curso_id] = { nome: r.curso_nome, icone: r.curso_icone, mp: r.mentor_principal, ma: r.mentores_apoio || [], cps: [] };
        const emoji = r.status === 'publicado' ? '✅' : r.status === 'em_revisao' ? '🟡' : r.percentual > 0 ? '⚪' : '⬜';
        porCurso[r.curso_id].cps.push({ nome: r.checkpoint_nome, codigo: r.checkpoint_codigo, emoji, pct: r.percentual, dias: r.dias_sem_editar });
      }
      const linhas = Object.values(porCurso).map(c => {
        const mentores = [c.mp, ...(c.ma || [])].filter(Boolean).join(' + ');
        const cps = c.cps.map(cp => `${cp.codigo}${cp.emoji}${cp.pct}%`).join(' ');
        const atrasos = c.cps.filter(cp => cp.dias && cp.dias > 14).map(cp => `${cp.nome}=${cp.dias}d`);
        return `- ${c.icone||''} ${c.nome} (${mentores}): ${cps}${atrasos.length ? ` [⚠${atrasos.join(',')}]` : ''}`;
      });
      const media = Math.round(rows.reduce((s,r)=>s+r.percentual,0) / rows.length);
      return `${label}: ${media}% preenchido\n${linhas.join('\n')}`;
    };

    systemPrompt += `\n\n[LA_JOURNEY_STATUS]\n`;
    systemPrompt += fmt(school, 'School') + '\n\n';
    systemPrompt += fmt(kids, 'Kids') + '\n\n';
    if (pendencias && pendencias.length) {
      systemPrompt += `Pendências de revisão (${pendencias.length}):\n`;
      systemPrompt += pendencias.map(p => `- ${p.la_journey_cursos?.nome} ${p.la_journey_checkpoints?.nome}`).join('\n');
    }
  } catch (e) {
    systemPrompt += `\n[LA_JOURNEY_STATUS]\nErro ao carregar snapshot: ${e.message}\n`;
  }
}
```

- [ ] **Step 2.5: Garantir que `supabase` está no escopo da função que monta o system prompt**

Verificar `system.js` — provavelmente já está disponível (laeduca usa). Se não, adicionar `const supabase = require('../supabase').supabase` ou padrão atual.

- [ ] **Step 3: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/prompts/system.js
```

- [ ] **Step 4: Deploy SCP**

```bash
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/
```

---

## Task 19: Handler `/journey` no engine.js

**Files:**
- Modify: `_remote/src/engine.js`

- [ ] **Step 1: Localizar handler `/educa` existente**

Pattern: early return sem chamar LLM, query direta no Supabase.

- [ ] **Step 2: Adicionar handler análogo `/journey`**

Logo após o handler `/educa`:

```js
// ─── /journey [curso?] ───────────────────────────────────────────
const journeyMatch = userMessage.trim().match(/^\/journey(?:\s+(.+))?$/i);
if (journeyMatch) {
  const cursoArg = (journeyMatch[1] || '').trim().toLowerCase();
  try {
    const { data: rows, error } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'school' });
    if (error) throw error;
    const { data: rowsKids } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'kids' });
    const all = [...(rows || []), ...(rowsKids || [])];

    let reply;
    if (cursoArg) {
      const matched = all.filter(r => r.curso_nome.toLowerCase().includes(cursoArg));
      if (matched.length === 0) {
        reply = `Não achei curso "${cursoArg}". Tente: bateria, canto, cordas, teclas, musicalização.`;
      } else {
        const cursoNome = matched[0].curso_nome;
        const icone = matched[0].curso_icone || '';
        const mp = matched[0].mentor_principal;
        const ma = (matched[0].mentores_apoio || []).join(' · ');
        reply = `${icone} *${cursoNome}* · ${mp}${ma ? ' + ' + ma : ''}\n`;
        for (const r of matched) {
          const emoji = r.status === 'publicado' ? '✅' : r.status === 'em_revisao' ? '🟡' : r.percentual > 0 ? '⚪' : '⬜';
          const atraso = r.dias_sem_editar && r.dias_sem_editar > 14 ? ` *(${r.dias_sem_editar}d sem editar ⚠️)*` : '';
          reply += `${r.checkpoint_nome}: ${emoji} ${r.percentual}%${atraso}\n`;
        }
      }
    } else {
      // resumo geral
      const porCurso = {};
      for (const r of all) {
        if (!porCurso[r.curso_id]) porCurso[r.curso_id] = { nome: r.curso_nome, icone: r.curso_icone, cps: [] };
        const emoji = r.status === 'publicado' ? '✅' : r.status === 'em_revisao' ? '🟡' : r.percentual > 0 ? '⚪' : '⬜';
        porCurso[r.curso_id].cps.push(`${r.checkpoint_codigo}${emoji}${r.percentual}%`);
      }
      reply = '*LA Journey* — visão geral:\n\n';
      for (const c of Object.values(porCurso)) {
        reply += `${c.icone||''} ${c.nome}: ${c.cps.join(' ')}\n`;
      }
      reply += '\nUse `/journey [curso]` pra ver detalhes.';
    }

    return { type: 'text', text: reply, _skipLLM: true };
  } catch (e) {
    return { type: 'text', text: `Erro ao consultar LA Journey: ${e.message}`, _skipLLM: true };
  }
}
```

- [ ] **Step 3: Validar sintaxe + Deploy**

```bash
node --check D:/la-organizer/_remote/src/engine.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/
ssh tom "pm2 restart tom"
```

---

## Task 20: Ritual de lembrete LA Journey

**Files:**
- Create: `_remote/src/rituals/la-journey-lembretes.js`

- [ ] **Step 1: Implementar funções**

```js
// _remote/src/rituals/la-journey-lembretes.js
// Cron semanal + alerta de atraso + processamento de fila la_journey_lembretes_log

const { supabase } = require('../supabase');
const { enviarWhatsApp } = require('../uazapi'); // ajustar import pro pattern do projeto

async function runLaJourneyLembreteSemanal() {
  // Para cada mentor, lista checkpoints rascunho com pendências
  const { data: programas } = await supabase.from('la_journey_programas').select('id');
  for (const prog of programas || []) {
    const { data: rows } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: prog.id });
    const porMentor = {};
    for (const r of rows || []) {
      if (r.status === 'publicado' || r.status === 'sem_inicio') continue;
      // busca o mentor principal collaborator_id pra inserir fila
      const { data: ment } = await supabase
        .from('la_journey_curso_mentores')
        .select('collaborator_id, collaborators(full_name, phone, notification_opt_in)')
        .eq('curso_id', r.curso_id).eq('programa_id', prog.id)
        .eq('papel', 'mentor_principal').eq('ativo', true).maybeSingle();
      if (!ment?.collaborators?.phone) continue;
      const key = ment.collaborator_id;
      if (!porMentor[key]) porMentor[key] = { ment, items: [] };
      porMentor[key].items.push(r);
    }
    for (const { ment, items } of Object.values(porMentor)) {
      let msg = `Oi ${ment.collaborators.full_name.split(' ')[0]}, bom dia 👋\n\n`;
      msg += `Passei pra avisar sobre o LA Journey:\n\n`;
      for (const it of items) {
        msg += `*${it.checkpoint_nome} · ${it.curso_nome}* — ${it.percentual}% (${it.campos_preenchidos}/${it.campos_total} campos)\n`;
      }
      msg += `\nQuer abrir? https://la-organizer.com/la-journey`;
      await supabase.from('la_journey_lembretes_log').insert({
        tipo: 'lembrete_semanal',
        destinatario_id: ment.collaborator_id,
        mensagem: msg,
      });
    }
  }
}

async function runLaJourneyAlertaAtraso() {
  const { data: conteudos } = await supabase
    .from('la_journey_conteudo_checkpoint')
    .select(`
      id, programa_id, curso_id, checkpoint_id, status, updated_at,
      la_journey_cursos(nome), la_journey_checkpoints(nome)
    `)
    .neq('status', 'publicado')
    .lt('updated_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());
  for (const c of conteudos || []) {
    // mentor principal + coord
    const { data: ment } = await supabase
      .from('la_journey_curso_mentores')
      .select('collaborator_id')
      .eq('curso_id', c.curso_id).eq('programa_id', c.programa_id)
      .eq('papel', 'mentor_principal').eq('ativo', true).maybeSingle();
    const { data: coords } = await supabase
      .from('collaborators').select('id').eq('role', 'coordinator').eq('active', true);
    const dias = Math.floor((Date.now() - new Date(c.updated_at).getTime()) / (1000*60*60*24));
    const msg = `🚨 *Alerta de atraso* — ${c.la_journey_checkpoints.nome} · ${c.la_journey_cursos.nome} está sem alterações há ${dias} dias.`;
    if (ment) {
      await supabase.from('la_journey_lembretes_log').insert({
        tipo: 'alerta_atraso', destinatario_id: ment.collaborator_id, conteudo_id: c.id, mensagem: msg,
      });
    }
    for (const co of coords || []) {
      await supabase.from('la_journey_lembretes_log').insert({
        tipo: 'alerta_atraso', destinatario_id: co.id, conteudo_id: c.id, mensagem: msg,
      });
    }
  }
}

async function processarFilaLaJourney() {
  const { data: pendentes } = await supabase
    .from('la_journey_lembretes_log')
    .select('id, tipo, destinatario_id, conteudo_id, mensagem, collaborators(phone, notification_opt_in, full_name)')
    .is('enviado_em', null)
    .limit(50);

  for (const item of pendentes || []) {
    try {
      const phone = item.collaborators?.phone;
      const optIn = item.collaborators?.notification_opt_in;
      if (!phone || !optIn) {
        // Marca como skip
        await supabase.from('la_journey_lembretes_log').update({
          enviado_em: new Date().toISOString(),
          mensagem: (item.mensagem || '[sem msg]') + ' [SKIP: sem phone ou opt-out]',
        }).eq('id', item.id);
        continue;
      }
      let msg = item.mensagem;
      if (!msg) {
        // monta msg padrão por tipo
        msg = montarMsgPadrao(item.tipo, item);
      }
      await enviarWhatsApp(phone, msg);
      await supabase.from('la_journey_lembretes_log').update({
        enviado_em: new Date().toISOString(),
      }).eq('id', item.id);
    } catch (e) {
      console.error('[la-journey-lembretes] falha', item.id, e.message);
    }
  }
}

function montarMsgPadrao(tipo, item) {
  if (tipo === 'enviado_revisao') return `Um mentor submeteu um checkpoint do LA Journey pra revisão. Veja em la-organizer.com/la-journey/admin`;
  if (tipo === 'publicado') return `Um checkpoint do LA Journey foi publicado.`;
  if (tipo === 'devolvido') return `A coordenação devolveu seu checkpoint do LA Journey para revisão. Veja o feedback.`;
  if (tipo === 'kickoff') return `Bem-vindo ao LA Journey! Você foi atribuído como mentor. Comece em la-organizer.com/la-journey`;
  return `Notificação LA Journey.`;
}

module.exports = {
  runLaJourneyLembreteSemanal,
  runLaJourneyAlertaAtraso,
  processarFilaLaJourney,
};
```

- [ ] **Step 2: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/rituals/la-journey-lembretes.js
```

- [ ] **Step 3: Deploy SCP**

```bash
scp D:/la-organizer/_remote/src/rituals/la-journey-lembretes.js tom:/opt/LA-Organizer/src/rituals/
```

---

## Task 21: Dispatcher.js — registrar crons + processar fila

**Files:**
- Modify: `_remote/src/rituals/dispatcher.js`

- [ ] **Step 1: Adicionar import no topo**

```js
const {
  runLaJourneyLembreteSemanal,
  runLaJourneyAlertaAtraso,
  processarFilaLaJourney,
} = require('./la-journey-lembretes');
```

- [ ] **Step 2: Adicionar cron seg 09:00 (após bloco análogo do laeduca)**

```js
// LA JOURNEY — Segunda 09:00
if (dow === 1 && hour === 9 && !(await logExists('la_journey_lembrete_semanal'))) {
  console.log('[dispatcher] rodando LA Journey lembrete semanal');
  try {
    await runLaJourneyLembreteSemanal();
    await logRitual('la_journey_lembrete_semanal');
  } catch (e) { console.error('[dispatcher] falha lembrete semanal LA Journey:', e); }
}

if (dow === 1 && hour === 9 && !(await logExists('la_journey_alerta_atraso'))) {
  console.log('[dispatcher] rodando LA Journey alerta de atraso');
  try {
    await runLaJourneyAlertaAtraso();
    await logRitual('la_journey_alerta_atraso');
  } catch (e) { console.error('[dispatcher] falha alerta atraso LA Journey:', e); }
}
```

- [ ] **Step 3: Adicionar processamento de fila no tick (no mesmo bloco do laeduca)**

```js
// Processar fila LA Journey (tick 5min)
try {
  await processarFilaLaJourney();
} catch (e) { console.error('[dispatcher] falha fila LA Journey:', e); }
```

- [ ] **Step 4: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/rituals/dispatcher.js
```

- [ ] **Step 5: Deploy + restart**

```bash
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/
ssh tom "pm2 restart tom"
ssh tom "pm2 logs tom --lines 20 --nostream"
```

Verificar que startup não dá erro de import.

---

## Task 22: Internal API endpoints

**Files:**
- Modify: `_remote/src/internal-api.js`

- [ ] **Step 1: Adicionar 2 endpoints (após os do laeduca)**

```js
// ─── LA JOURNEY ─────────────────────────────────────────────────
app.post('/internal/la-journey/notify-event', requireInternalSecret, async (req, res) => {
  const { conteudoId, tipo, destinatarios } = req.body || {};
  if (!conteudoId || !tipo || !Array.isArray(destinatarios)) {
    return res.status(400).json({ error: 'bad_payload' });
  }
  try {
    const rows = destinatarios.map(d => ({
      tipo, destinatario_id: d, conteudo_id: conteudoId,
    }));
    const { error } = await supabase.from('la_journey_lembretes_log').insert(rows);
    if (error) throw error;
    res.json({ ok: true, enfileirados: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/internal/la-journey/status', requireInternalSecret, async (_req, res) => {
  try {
    const { data: school } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'school' });
    const { data: kids } = await supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'kids' });
    const { data: pendencias } = await supabase
      .from('la_journey_conteudo_checkpoint')
      .select('id, programa_id, curso_id, checkpoint_id, updated_at')
      .eq('status', 'em_revisao');
    res.json({ school, kids, pendencias });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Validar sintaxe + deploy**

```bash
node --check D:/la-organizer/_remote/src/internal-api.js
scp D:/la-organizer/_remote/src/internal-api.js tom:/opt/LA-Organizer/src/
ssh tom "pm2 restart tom"
```

---

## Task 23: Validação E2E + smoke test

- [ ] **Step 1: TypeScript final**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```
Esperado: zero erros nos arquivos novos/modificados do LA Journey.

- [ ] **Step 2: Vite build**

```bash
cd D:/la-organizer/_remote/web && npx vite build
```
Esperado: build verde, sem erros de import.

- [ ] **Step 3: Validar Lista visualmente**

```js
mcp__Claude_Preview__preview_screenshot({ serverId: '<web-preview server id>' })
```
URL: `http://localhost:4173/la-journey`. Comparar com mockup 01.

- [ ] **Step 4: Validar Edição**

Acessar `http://localhost:4173/la-journey/school_foundation?curso=bateria`. Tirar screenshot. Comparar com mockup 02.

- [ ] **Step 5: Validar Admin**

Acessar `http://localhost:4173/la-journey/admin`. Screenshot. Comparar com mockup 03.

- [ ] **Step 6: Smoke test funcional**

1. Logar como Peterson (mentor de bateria) — vê só Bateria na lista.
2. Abrir Foundation, escrever em "Perfil de entrada", esperar 600ms — verificar badge "✓ salvo".
3. Recarregar a página — texto persiste.
4. Adicionar marco aprendizado — aparece na lista.
5. Tentar remover marco de consolidação — bloqueado.
6. Preencher tudo, clicar "Enviar pra revisão" — vai pra status `em_revisao`.
7. Logar como Quintela (coord) — vê pendência no /la-journey/admin, clica, publica.
8. Voltar como Peterson — vê banner "Publicado".

- [ ] **Step 7: Smoke test TOM**

Via WhatsApp:
1. `/journey` → resumo geral.
2. `/journey bateria` → drill-down.
3. "como tá o LA Journey?" → resposta com `[LA_JOURNEY_STATUS]`.

- [ ] **Step 8: Validar triggers**

Via SQL:
```sql
SELECT entidade_tipo, acao, count(*) FROM la_journey_historico GROUP BY 1,2;
SELECT tipo, count(*) FROM la_journey_lembretes_log GROUP BY 1;
```
Esperado: entradas correspondentes às ações feitas no smoke test.

---

## Self-Review

### Spec coverage

| Item do spec | Task |
|---|---|
| Banco já criado — só triggers + RPC | Task 1 |
| Rotas + ProtectedRoute admin | Task 6 |
| Link no /mais (oculto pra manager) | Task 7 |
| Types | Task 2 |
| Data layer | Task 3 |
| Hooks TanStack | Task 4 |
| ProgressBar | Task 5 |
| ListaPage (tabs + select + cards) | Task 8 |
| MarcoCard (collapse) | Task 9 |
| MarcoBodyAprendizado (eixos + evidência + música) | Task 10 |
| MarcoBodyConsolidacao (banner dourado + 4 campos) | Task 11 |
| MarcoBodyRadial (4 campos) | Task 12 |
| AddMarcoSheet (BottomSheet) | Task 13 |
| CheckpointPage (header + sticky footer + workflow) | Task 14 |
| Auto-save debounce 600ms | Tasks 10/11/12/14 |
| Status transitions (rascunho/em_revisao/publicado) | Task 14 |
| Validação canSubmit RPC | Tasks 1 + 14 |
| CursoStatusCard | Task 15 |
| AdminPage (stats + alerta + cursos + pendências) | Task 16 |
| Skill la-journey.md | Task 17 |
| System prompt detection | Task 18 |
| Comando /journey | Task 19 |
| Ritual lembrete semanal | Task 20 |
| Ritual alerta atraso | Task 20 |
| Processar fila | Task 20 |
| Dispatcher.js wiring | Task 21 |
| Internal API endpoints | Task 22 |
| Validação E2E | Task 23 |
| Zero componente nativo | Reforçado em cada tela (CustomSelect, Tabs, Badge, BottomSheet, ConfirmDialog) |
| Validação visual no Simple Browser | Tasks 8/14/16/23 |

### Placeholder scan
Sem "TBD", "TODO", "implement later". Todo código foi escrito por extenso.

### Type consistency
- `Programa`, `JourneyCheckpoint`, `JourneyMarcoComCampos`, `JourneyCursoProgresso` usados consistentemente
- Função `upsertJourneyConteudoHeader` retorna `Promise<string>` em todas as tasks
- `submeterJourneyParaRevisao` chama `canSubmitJourney` internamente (Task 3) e CheckpointPage também valida antes (Task 14) — defesa em profundidade
- RPC `la_journey_lista_progresso` returns the same row shape used in Tasks 3, 15, 18, 19

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-16-la-journey-implementation.md`.**
