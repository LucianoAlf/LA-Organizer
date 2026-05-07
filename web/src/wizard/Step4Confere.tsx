// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Passo 4: categoria + resumo + aviso de aprovacao ("Confere se ta certo").

import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { SummaryBlock, SummaryInline } from '../components/Summary';
import {
  PROJECT_CATEGORY_LABELS,
  PROJECT_LOCATION_LABELS,
} from '../lib/projectLabels';
import { formatBR } from '../utils/wizardDate';
import { wizardInputClass } from './wizardTypes';
import type { ProjectCategory } from '../types';
import type { CollabLite, WizardData } from './wizardTypes';

interface Props {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
  collabsAvailable: CollabLite[];
  isCoordOrDir: boolean;
}

export function Step4Confere({ data, update, collabsAvailable, isCoordOrDir }: Props) {
  return (
    <>
      <header>
        <h2 className="text-section-title">Confere se tá certo</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          Última conferida antes do TOM começar a estruturar.
        </p>
      </header>

      <Field
        label="🏷️ Categoria"
        sub="Ajuda na visualização e nos relatórios. Dá pra mudar depois."
      >
        <select
          value={data.category}
          onChange={(e) => update('category', e.target.value as ProjectCategory)}
          className={wizardInputClass}
        >
          {(Object.entries(PROJECT_CATEGORY_LABELS) as [ProjectCategory, string][]).map(
            ([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ),
          )}
        </select>
      </Field>

      <Card padded variant="outline">
        <div className="space-y-lg">
          <SummaryInline label="Nome">{data.name || '—'}</SummaryInline>
          <SummaryBlock label="🎯 Por que existe">
            {data.justification || '—'}
          </SummaryBlock>
          <SummaryInline label="📍 Local">
            {data.location ? PROJECT_LOCATION_LABELS[data.location] : '—'}
          </SummaryInline>
          <SummaryInline label="🗓️ Janela">
            {formatBR(data.start_date)} → {formatBR(data.end_date)}
          </SummaryInline>
          <SummaryBlock label="👥 Quem participa">
            {(() => {
              const names = data.member_ids
                .map((id) => collabsAvailable.find((c) => c.id === id)?.full_name)
                .filter(Boolean) as string[];
              if (names.length === 0 && !data.extra_members.trim()) return '—';
              return (
                <div className="space-y-1">
                  {names.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {names.map((n) => (
                        <span
                          key={n}
                          className="inline-block text-body-xs bg-bg-elevated rounded-full px-2 py-0.5 border border-border"
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  )}
                  {data.extra_members.trim() && (
                    <div className="text-body-sm text-fg-secondary italic">
                      + {data.extra_members.trim()}
                    </div>
                  )}
                </div>
              );
            })()}
          </SummaryBlock>
          <SummaryBlock label="🛠️ Como executar">
            {data.methodology || '—'}
          </SummaryBlock>
          {data.estimated_hours_week && (
            <SummaryInline label="⏱️ Horas/sem">
              {data.estimated_hours_week}h
            </SummaryInline>
          )}
          <SummaryInline label="🏷️ Categoria">
            {PROJECT_CATEGORY_LABELS[data.category]}
          </SummaryInline>
        </div>
      </Card>

      {!isCoordOrDir && (
        <div className="text-body-sm text-fg-secondary bg-bg-surface rounded-md px-md py-sm border border-border">
          Como você é colaborador, ao confirmar este projeto vai pra aprovação antes de começar.
        </div>
      )}
    </>
  );
}
