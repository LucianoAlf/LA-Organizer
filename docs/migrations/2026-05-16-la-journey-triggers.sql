-- =====================================================================
-- LA Journey — Triggers de auditoria, notificação de status, kickoff + RPC
-- =====================================================================

-- 1. Função de auditoria — grava em la_journey_historico
CREATE OR REPLACE FUNCTION la_journey_log_historico() RETURNS TRIGGER AS $$
DECLARE
  v_user uuid;
BEGIN
  v_user := auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO la_journey_historico (entidade_tipo, entidade_id, acao, campo_alterado, valor_anterior, valor_novo, alterado_por)
    VALUES (TG_ARGV[0], NEW.id, 'created', NULL, NULL, NULL, COALESCE(NEW.updated_by, v_user));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO la_journey_historico (entidade_tipo, entidade_id, acao, campo_alterado, valor_anterior, valor_novo, alterado_por)
    VALUES (TG_ARGV[0], NEW.id, 'updated', NULL, NULL, NULL, COALESCE(NEW.updated_by, v_user));
    RETURN NEW;
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
  SELECT array_agg(collaborator_id) INTO v_mentores
  FROM la_journey_curso_mentores
  WHERE curso_id = NEW.curso_id AND programa_id = NEW.programa_id AND ativo = true;

  SELECT array_agg(id) INTO v_coords
  FROM collaborators
  WHERE role IN ('coordinator','director') AND active = true;

  IF NEW.status = 'em_revisao' AND OLD.status = 'rascunho' THEN
    FOREACH v_id IN ARRAY v_coords LOOP
      INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, conteudo_id)
      VALUES ('enviado_revisao', v_id, NEW.id);
    END LOOP;
  ELSIF NEW.status = 'publicado' AND OLD.status = 'em_revisao' THEN
    FOREACH v_id IN ARRAY (v_mentores || v_coords) LOOP
      INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, conteudo_id)
      VALUES ('publicado', v_id, NEW.id);
    END LOOP;
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

-- 3. Trigger de kickoff
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

-- 4. RPC pra validar antes de submeter
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

  IF coalesce(trim(v_conteudo.perfil_entrada), '') = '' THEN
    v_faltando := array_append(v_faltando, 'perfil_entrada');
  END IF;
  IF coalesce(trim(v_conteudo.transformacao_esperada), '') = '' THEN
    v_faltando := array_append(v_faltando, 'transformacao_esperada');
  END IF;

  SELECT count(*)::int INTO v_total_marcos FROM la_journey_marcos WHERE conteudo_id = p_conteudo_id;
  IF v_total_marcos = 0 THEN
    v_faltando := array_append(v_faltando, 'nenhum_marco');
  END IF;

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

-- 5. RPC pra carregar lista de progresso (otimizada)
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
