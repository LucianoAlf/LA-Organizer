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

export function MarcoBodyAprendizado({ marco, readOnly, onSaving, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>(marco.campos);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { setValues(marco.campos); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [marco.id]);

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
        className="w-full bg-bg-surface text-fg rounded-md border border-border focus:border-tom focus:outline-none p-sm resize-y leading-relaxed"
        style={{ minHeight: rows * 22 }}
      />
    </div>
  );
}
