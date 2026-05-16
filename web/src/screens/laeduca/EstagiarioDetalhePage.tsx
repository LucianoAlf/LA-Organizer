// Detalhe do estagiário: header com info, PilarCards dinâmicos, responsáveis por pilar, botão Certificar Alfa
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useLaEducaEstagiario } from '../../hooks/useLaEducaEstagiario';
import { useLaEducaPilares } from '../../hooks/useLaEducaPilares';
import { useLaEducaResponsaveis } from '../../hooks/useLaEducaResponsaveis';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { CustomSelect } from '../../components/CustomSelect';
import { ProgressBar } from './components/ProgressBar';
import { PilarCard } from './components/PilarCard';
import {
  emitirCertificado,
  fetchMentoresDisponiveis,
  atribuirInstrutorAoPilar,
  removerInstrutorDoPilar,
} from '../../lib/laeduca';
import type { Unidade, Modalidade, Pilar } from '../../lib/laeduca-types';
import { UNIDADE_LABELS, MODALIDADE_LABELS } from '../../lib/laeduca-types';
import { showToast } from '../../components/Toast';

// ─── Modal inline ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-md overflow-y-auto">
      <div className="bg-bg-surface rounded-lg border border-border w-full max-w-md mt-xl">
        <div className="flex items-center justify-between px-md pt-md pb-sm border-b border-border">
          <h3 className="font-semibold text-fg">{title}</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-lg leading-none">✕</button>
        </div>
        <div className="p-md">{children}</div>
      </div>
    </div>
  );
}

export function LaEducaEstagiarioDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useLaEducaEstagiario(id);
  const { data: pilares, isLoading: pilaresLoading } = useLaEducaPilares();
  const { data: responsaveis = [] } = useLaEducaResponsaveis(id);
  const [showDiagnostico, setShowDiagnostico] = useState(false);
  const [modalAtrib, setModalAtrib] = useState<{ open: boolean; pilar: Pilar | null }>({ open: false, pilar: null });
  const [instrutorSelecionado, setInstrutorSelecionado] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: mentores = [] } = useQuery({
    queryKey: ['laeduca-mentores'],
    queryFn: () => fetchMentoresDisponiveis(),
    staleTime: 60_000,
  });

  const certMutation = useMutation({
    mutationFn: () => emitirCertificado({ estagiarioId: id!, emissorId: collaborator!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-estagiario', id] });
      qc.invalidateQueries({ queryKey: ['laeduca-progresso'] });
      showToast({ kind: 'success', title: 'Certificado Alfa emitido!' });
    },
    onError: e => showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message }),
  });

  if (isLoading || pilaresLoading) return <LoadingState />;
  if (error || !data) return <div className="p-md text-danger">Estagiário não encontrado.</div>;

  const { estagiario, progresso, avaliacoes_por_pilar } = data;
  const podeCertificar =
    (role === 'coordinator' || role === 'director') &&
    progresso.percentual === 100 &&
    !estagiario.certificado_emitido;

  const podeDelegar =
    role === 'coordinator' ||
    role === 'director' ||
    collaborator?.id === estagiario.mentor_id;

  function responsavelDoPilar(codigo: string) {
    const r = responsaveis.find(r => r.pilar_codigo === codigo);
    return r ? r.instrutor_nome : (progresso.mentor_nome ?? '—');
  }

  function temInstrutor(codigo: string) {
    return responsaveis.some(r => r.pilar_codigo === codigo);
  }

  function abrirModal(pilar: Pilar) {
    const atual = responsaveis.find(r => r.pilar_codigo === pilar.codigo);
    setInstrutorSelecionado(atual?.instrutor_id ?? '');
    setModalAtrib({ open: true, pilar });
  }

  function fecharModal() {
    setModalAtrib({ open: false, pilar: null });
    setInstrutorSelecionado('');
  }

  async function handleSalvar() {
    if (!modalAtrib.pilar || !instrutorSelecionado || !collaborator) return;
    setSaving(true);
    try {
      await atribuirInstrutorAoPilar({
        estagiarioId: id!,
        pilarId: modalAtrib.pilar.id,
        instrutorId: instrutorSelecionado,
        atribuidoPor: collaborator.id,
      });
      qc.invalidateQueries({ queryKey: ['laeduca-responsaveis', id] });
      showToast({ kind: 'success', title: 'Instrutor atribuído.' });
      fecharModal();
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemover() {
    if (!modalAtrib.pilar || !collaborator) return;
    setSaving(true);
    try {
      await removerInstrutorDoPilar({
        estagiarioId: id!,
        pilarId: modalAtrib.pilar.id,
      });
      qc.invalidateQueries({ queryKey: ['laeduca-responsaveis', id] });
      showToast({ kind: 'success', title: 'Atribuição removida. Mentor assume o pilar.' });
      fecharModal();
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const mentoresOptions = mentores.map(m => ({ value: m.id, label: m.full_name }));

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader
        title={estagiario.nome}
        subtitle={`${UNIDADE_LABELS[estagiario.unidade as Unidade] ?? estagiario.unidade} · Mentor: ${progresso.mentor_nome || '—'}`}
        backTo="/la-educa"
      />

      <div className="bg-bg-surface rounded-lg p-md border border-border space-y-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-body-sm text-fg-muted">Progresso geral</span>
          <span className="font-semibold">{progresso.checkpoints_ancorados}/{progresso.checkpoints_total}</span>
        </div>
        <ProgressBar percentual={progresso.percentual} />
        <div className="text-[11px] text-fg-muted">
          {progresso.trilha_nome
            ? `Trilha: ${progresso.trilha_icone ?? ''} ${progresso.trilha_nome}`.trim()
            : `Modalidade: ${MODALIDADE_LABELS[estagiario.modalidade as Modalidade] ?? estagiario.modalidade}`}
          {estagiario.instrumento ? ` · ${estagiario.instrumento}` : ''} ·
          {' '}Início: {new Date(estagiario.data_inicio).toLocaleDateString('pt-BR')}
        </div>
        {estagiario.certificado_emitido && (
          <div className="text-success text-body-sm font-semibold">
            🏆 Certificado emitido em {new Date(estagiario.certificado_emitido_em!).toLocaleDateString('pt-BR')}
          </div>
        )}
      </div>

      {estagiario.diagnostico_entrada && (
        <div className="bg-bg-surface rounded-lg p-md border border-border">
          <button
            onClick={() => setShowDiagnostico(s => !s)}
            className="text-body-sm font-semibold text-tom"
          >
            {showDiagnostico ? '▾' : '▸'} Diagnóstico de entrada
          </button>
          {showDiagnostico && (
            <p className="text-body-sm text-fg-muted mt-2 whitespace-pre-line">{estagiario.diagnostico_entrada}</p>
          )}
        </div>
      )}

      <div className="grid gap-sm md:grid-cols-2">
        {(pilares ?? []).map(p => {
          const items = avaliacoes_por_pilar[p.codigo] ?? [];
          const ancorados = items.filter(i => i.ancorado).length;
          return (
            <div key={p.id} className="space-y-1">
              <PilarCard
                pilarCodigo={p.codigo}
                pilarNome={p.nome}
                iconeName={p.icone}
                ancorados={ancorados}
                total={items.length}
                to={`/la-educa/${id}/${p.codigo}`}
              />
              <div className="flex items-center justify-between text-[11px] text-fg-muted px-1">
                <span>
                  Responsável: <strong className="text-fg">{responsavelDoPilar(p.codigo)}</strong>
                  {!temInstrutor(p.codigo) && <span className="text-fg-muted"> (mentor)</span>}
                </span>
                {podeDelegar && (
                  <button
                    onClick={() => abrirModal(p)}
                    className="text-tom hover:underline ml-2 whitespace-nowrap"
                  >
                    {temInstrutor(p.codigo) ? '✎ Trocar' : '+ Delegar'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(role === 'coordinator' || role === 'director' || estagiario.mentor_id === collaborator?.id) && (
        <div className="bg-bg-surface rounded-lg p-md border border-border space-y-sm">
          <h3 className="text-body-sm font-semibold text-fg-muted">📱 Notificações do estagiário</h3>
          <div className="text-body-sm text-fg">
            Telefone: <strong>{estagiario.phone || '— não cadastrado'}</strong>
          </div>
          <div className="text-body-sm text-fg">
            Opt-in: <strong>{estagiario.notificacoes_opt_in ? '✅ Sim' : '❌ Não'}</strong>
          </div>
          <p className="text-[11px] text-fg-muted">
            {estagiario.notificacoes_opt_in && estagiario.phone
              ? 'O estagiário recebe notificações em marcos importantes (cadastro, certificado Alfa).'
              : 'Pra ativar, edite via tela admin ou peça pra coord cadastrar o telefone.'}
          </p>
        </div>
      )}

      {podeCertificar && (
        <button
          onClick={() => {
            if (confirm(`Confirmar emissão do Certificado Alfa pra ${estagiario.nome}? Esta ação não pode ser revertida pelo PWA.`)) {
              certMutation.mutate();
            }
          }}
          disabled={certMutation.isPending}
          className="w-full px-md py-md bg-success text-white rounded-lg font-semibold focus-ring"
        >
          🏆 Emitir Certificado Alfa
        </button>
      )}

      {/* Modal de atribuição de instrutor */}
      {modalAtrib.open && modalAtrib.pilar && (
        <Modal
          title={`Atribuir instrutor — ${modalAtrib.pilar.nome}`}
          onClose={fecharModal}
        >
          <div className="space-y-md">
            <div>
              <label className="block text-body-sm text-fg-muted mb-1">Instrutor</label>
              <CustomSelect
                value={instrutorSelecionado}
                onChange={setInstrutorSelecionado}
                options={mentoresOptions}
                placeholder="Selecionar instrutor..."
              />
            </div>
            <div className="flex flex-col gap-sm">
              <button
                onClick={handleSalvar}
                disabled={saving || !instrutorSelecionado}
                className="w-full py-sm bg-tom text-black rounded-lg font-semibold focus-ring disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar atribuição'}
              </button>
              {temInstrutor(modalAtrib.pilar.codigo) && (
                <button
                  onClick={handleRemover}
                  disabled={saving}
                  className="w-full py-sm bg-bg-app border border-danger text-danger rounded-lg font-semibold focus-ring disabled:opacity-50"
                >
                  Remover atribuição (volta ao mentor)
                </button>
              )}
              <button
                onClick={fecharModal}
                disabled={saving}
                className="w-full py-sm text-fg-muted hover:text-fg focus-ring rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
