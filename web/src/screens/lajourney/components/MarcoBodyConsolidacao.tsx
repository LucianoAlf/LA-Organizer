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
