// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Passo 2: local + datas ("Onde e quando acontece").

import { CustomSelect } from '../components/CustomSelect';
import { Field } from '../components/Field';
import { PROJECT_LOCATION_LABELS } from '../lib/projectLabels';
import { todayISO } from '../utils/wizardDate';
import { wizardInputClass } from './wizardTypes';
import type { ProjectLocation } from '../types';
import type { WizardData } from './wizardTypes';

interface Props {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}

export function Step2OndeQuando({ data, update }: Props) {
  return (
    <>
      <header>
        <h2 className="text-section-title">Onde e quando acontece</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          Pra ancorar o projeto no mundo real.
        </p>
      </header>
      <Field label="📍 Onde vai rolar?">
        <CustomSelect
          value={data.location ?? ''}
          onChange={(v) => update('location', v as ProjectLocation)}
          options={[
            { value: '', label: 'Selecione…' },
            ...(Object.entries(PROJECT_LOCATION_LABELS) as [ProjectLocation, string][]).map(
              ([k, lbl]) => ({ value: k, label: lbl }),
            ),
          ]}
        />
      </Field>
      <Field label="🗓️ Quando começa">
        <input
          type="date"
          value={data.start_date}
          min={todayISO()}
          onChange={(e) => update('start_date', e.target.value)}
          className={wizardInputClass}
        />
      </Field>
      <Field label="🗓️ Quando termina">
        <input
          type="date"
          value={data.end_date}
          min={data.start_date || todayISO()}
          onChange={(e) => update('end_date', e.target.value)}
          className={wizardInputClass}
        />
      </Field>
    </>
  );
}
