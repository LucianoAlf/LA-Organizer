// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Tela final pos-submit. Dois fluxos:
//  - Coord/director: "Projeto criado" + botao "Ver projeto" / "Criar outro".
//  - Collaborator comum: "Enviado para aprovacao" + lembrete sobre supervisor.

import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import {
  PROJECT_CATEGORY_LABELS,
  PROJECT_LOCATION_LABELS,
} from '../lib/projectLabels';
import { formatBR, formatBRShort } from '../utils/wizardDate';
import type { ProjectLocation } from '../types';
import type { SubmittedProject } from '../hooks/useCreateProject';

interface Props {
  submitted: SubmittedProject;
  isCoordOrDir: boolean;
  onCreateAnother: () => void;
}

export function NovoProjetoCreatedScreen({ submitted, isCoordOrDir, onCreateAnother }: Props) {
  const navigate = useNavigate();
  const s = submitted.snapshot;
  const periodo = `${formatBRShort(s.start_date)} → ${formatBR(s.end_date)}`;

  if (isCoordOrDir) {
    return (
      <div className="space-y-lg max-w-md mx-auto pt-md">
        <div className="text-center pt-md">
          <div className="text-6xl mb-sm" aria-hidden>✅</div>
          <h2 className="text-section-title">Projeto criado</h2>
          <p className="text-body-sm text-fg-muted mt-1">
            O TOM já foi notificado e vai começar a estruturar.
          </p>
        </div>

        <Card padded variant="elevated">
          <div className="space-y-md">
            <div className="flex items-start justify-between gap-sm flex-wrap">
              <div className="text-body-lg font-semibold text-fg leading-tight min-w-0 flex-1 break-words">{s.name}</div>
              <span className="shrink-0 text-body-xs text-fg-muted bg-bg-surface rounded-full px-2 py-1 border border-border whitespace-nowrap">
                Em planejamento
              </span>
            </div>

            <div className="space-y-1 text-body-sm text-fg-secondary">
              <div>📍 {PROJECT_LOCATION_LABELS[s.location as ProjectLocation] || '—'}</div>
              <div>🗓️ {periodo}</div>
              <div>🏷️ {PROJECT_CATEGORY_LABELS[s.category]}</div>
            </div>

            <div className="border-t border-border pt-md">
              <div className="text-body-xs text-fg-muted mb-1">🎯 Por que existe</div>
              <div className="text-body-sm text-fg italic">"{s.justification.trim()}"</div>
            </div>

            <div className="border-t border-border pt-md text-body-sm text-fg-secondary">
              Agora ele pode começar a distribuir checkpoints e tarefas pelo time.
            </div>
          </div>
        </Card>

        <div className="flex gap-md">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => navigate(`/projetos/${submitted.projectId}`)}
          >
            Ver projeto
          </Button>
          <Button
            variant="primary"
            fullWidth
            onClick={onCreateAnother}
          >
            Criar outro
          </Button>
        </div>
      </div>
    );
  }

  // Collaborator comum
  const sup = submitted.supervisorName ?? 'um supervisor';
  return (
    <div className="space-y-lg max-w-md mx-auto pt-md">
      <div className="text-center pt-md">
        <div className="text-6xl mb-sm" aria-hidden>⏳</div>
        <h2 className="text-section-title">Enviado para aprovação</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          O projeto foi estruturado — agora aguarda o ok.
        </p>
      </div>

      <Card padded variant="elevated">
        <div className="space-y-md">
          <div className="flex items-start justify-between gap-md">
            <div className="text-body-lg font-semibold text-fg leading-tight">{s.name}</div>
            <span className="shrink-0 text-body-xs text-fg-muted bg-bg-surface rounded-full px-2 py-1 border border-border">
              Aguardando aprovação
            </span>
          </div>

          <div className="space-y-1 text-body-sm text-fg-secondary">
            <div>📍 {PROJECT_LOCATION_LABELS[s.location as ProjectLocation] || '—'}</div>
            <div>🗓️ {periodo}</div>
            <div>🏷️ {PROJECT_CATEGORY_LABELS[s.category]}</div>
          </div>

          <div className="border-t border-border pt-md">
            <div className="text-body-xs text-fg-muted mb-1">🎯 Por que existe</div>
            <div className="text-body-sm text-fg italic">"{s.justification.trim()}"</div>
          </div>

          <div className="border-t border-border pt-md space-y-1">
            <div className="text-body-sm">
              <span className="font-semibold text-fg">Próximo passo:</span>{' '}
              <span className="text-fg-secondary">{sup} precisa aprovar este projeto no WhatsApp.</span>
            </div>
            <div className="text-body-xs text-fg-muted">
              Assim que ele aprovar, o TOM continua o fluxo automaticamente.
            </div>
          </div>
        </div>
      </Card>

      <Button variant="secondary" fullWidth onClick={() => navigate('/projetos')}>
        Ver meus projetos
      </Button>
    </div>
  );
}
