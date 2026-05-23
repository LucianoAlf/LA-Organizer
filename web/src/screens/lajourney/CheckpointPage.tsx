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
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [dados?.conteudo?.id]);

  function flashSaved() {
    setSavingState('saved');
    setTimeout(() => setSavingState('idle'), 1500);
    // Marca o cache do conteúdo como stale sem refetch imediato (refetchType:none).
    // Garante que outro usuário abrindo a mesma tela ou esta ao trocar de aba
    // pega a versão atualizada — sem interromper o textarea que está sendo digitado.
    qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId], refetchType: 'none' });
  }

  function saveHeader(field: 'perfil_entrada' | 'transformacao_esperada', value: string) {
    if (!checkpointId) return;
    // Sem curso selecionado num checkpoint que separa por curso, salvar é no-op
    // silencioso — usuário digita e nada acontece. Avisa explicitamente.
    if (checkpoint?.separa_por_curso && !cursoId) {
      showToast({ kind: 'info', title: 'Selecione um curso', msg: 'Esse checkpoint exige curso (bateria, canto, cordas, teclas...). Volte e abra pelo curso desejado.' });
      return;
    }
    if (!cursoId) return;
    if (dados?.conteudo?.status === 'publicado') return;
    const key: 'pe' | 'te' = field === 'perfil_entrada' ? 'pe' : 'te';
    if (headerTimerRef.current[key]) clearTimeout(headerTimerRef.current[key]);
    headerTimerRef.current[key] = setTimeout(async () => {
      setSavingState('saving');
      try {
        await upsertJourneyConteudoHeader({
          programaId: programa,
          cursoId,
          checkpointId,
          ...(field === 'perfil_entrada' ? { perfilEntrada: value } : { transformacaoEsperada: value }),
        });
        flashSaved();
        qc.invalidateQueries({ queryKey: ['lajourney-conteudo', programa, cursoId, checkpointId] });
      } catch (e) {
        showToast({ kind: 'error', title: 'Falha ao salvar', msg: (e as Error).message });
      }
    }, 600);
  }

  async function handleAddMarco(tipo: TipoMarco) {
    try {
      // Guard: checkpoint que separa por curso (ex: Foundation school) exige
      // ?curso=bateria|canto|... na URL. Sem isso, qualquer write quebra com
      // FK violation. Avisa explicitamente em vez de deixar estourar.
      if (checkpoint?.separa_por_curso && !cursoId) {
        showToast({ kind: 'error', title: 'Selecione um curso', msg: 'Esse checkpoint exige curso (bateria, canto, cordas, teclas...). Volte e abra pelo curso desejado.' });
        return;
      }
      // Primeira chamada num checkpoint vazio precisa criar o header antes do marco.
      // upsertJourneyConteudoHeader retorna o id do conteúdo (novo ou existente)
      // — usa direto, sem depender de refetch que não atualiza o closure local.
      const conteudoId = dados?.conteudo?.id
        ?? await upsertJourneyConteudoHeader({ programaId: programa, cursoId, checkpointId: checkpointId! });
      const nextNumero = (dados?.marcos?.[dados.marcos.length - 1]?.numero ?? 0) + 1;
      await adicionarJourneyMarco({ conteudoId, numero: nextNumero, tipo });
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
            <button type="button" onClick={handleReverter} className="ml-2 text-tom underline">
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

        {!readOnly && (() => {
          const cursoMissing = Boolean(checkpoint?.separa_por_curso) && !cursoId;
          return (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              disabled={cursoMissing}
              title={cursoMissing ? 'Selecione um curso primeiro (bateria, canto, cordas, teclas...)' : undefined}
              className="w-full border-2 border-dashed border-border text-fg-muted rounded-lg p-md font-semibold text-body-sm enabled:hover:border-tom enabled:hover:text-tom disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cursoMissing ? '+ Adicionar marco (selecione um curso)' : '+ Adicionar marco'}
            </button>
          );
        })()}
      </div>

      {!readOnly && (
        <div
          className="sticky bottom-0 -mx-md mt-md bg-bg-surface border-t border-border px-md py-md flex gap-sm z-40"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          {status === 'rascunho' && (
            <button
              type="button"
              onClick={handleSubmeter}
              className="flex-1 bg-tom text-black rounded-md py-sm font-semibold"
            >
              Enviar pra revisão
            </button>
          )}
          {status === 'em_revisao' && isCoord && (
            <>
              <button type="button" onClick={handleDevolver} className="flex-1 bg-bg-app border border-border text-fg rounded-md py-sm font-semibold">
                Devolver
              </button>
              <button type="button" onClick={handlePublicar} className="flex-1 bg-success text-white rounded-md py-sm font-semibold">
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
        description="Os campos preenchidos deste marco serão perdidos."
        confirmLabel="Remover"
        variant="danger"
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
