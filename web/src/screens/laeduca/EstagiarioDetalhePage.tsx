// Detalhe do estagiário: header com info, PilarCards dinâmicos, botão Certificar Alfa (só coord/director com 100%)
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useLaEducaEstagiario } from '../../hooks/useLaEducaEstagiario';
import { useLaEducaPilares } from '../../hooks/useLaEducaPilares';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { ProgressBar } from './components/ProgressBar';
import { PilarCard } from './components/PilarCard';
import { emitirCertificado } from '../../lib/laeduca';
import type { Unidade, Modalidade } from '../../lib/laeduca-types';
import { UNIDADE_LABELS, MODALIDADE_LABELS } from '../../lib/laeduca-types';
import { showToast } from '../../components/Toast';

export function LaEducaEstagiarioDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useLaEducaEstagiario(id);
  const { data: pilares, isLoading: pilaresLoading } = useLaEducaPilares();
  const [showDiagnostico, setShowDiagnostico] = useState(false);

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
            <PilarCard
              key={p.id}
              pilarCodigo={p.codigo}
              pilarNome={p.nome}
              iconeName={p.icone}
              ancorados={ancorados}
              total={items.length}
              to={`/la-educa/${id}/${p.codigo}`}
            />
          );
        })}
      </div>

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
    </div>
  );
}
