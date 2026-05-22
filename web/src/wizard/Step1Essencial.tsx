// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Passo 1: nome + justificativa ("Vamos partir do essencial").

import { Field } from '../components/Field';
import { wizardInputClass, wizardTextareaClass } from './wizardTypes';
import type { WizardData } from './wizardTypes';

interface Props {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}

export function Step1Essencial({ data, update }: Props) {
  return (
    <>
      <header>
        <h2 className="text-section-title">Vamos partir do essencial</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          Antes de tudo: o que é esse projeto, e por que vale a pena fazer?
        </p>
      </header>
      <Field label="🗂️ Como vai chamar?">
        <input
          type="text"
          value={data.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="Ex: Sarau de Violinos"
          maxLength={100}
          className={wizardInputClass}
          autoFocus
        />
      </Field>
      <Field
        label="🎯 Por que esse projeto existe?"
        sub="O que justifica investir tempo nisso? É isso que o TOM vai usar pra alinhar prioridade."
      >
        <textarea
          value={data.justification}
          onChange={(e) => update('justification', e.target.value)}
          placeholder="Ex: Celebrar 14 anos da escola"
          rows={3}
          className={wizardTextareaClass}
        />
      </Field>
      <Field
        label="📝 Descrição do projeto (opcional)"
        sub="Um parágrafo livre sobre o escopo, contexto ou observações. Pode deixar em branco."
      >
        <textarea
          value={data.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="Ex: Apresentação ao vivo com alunos do módulo avançado, aberta ao público..."
          rows={3}
          className={wizardTextareaClass}
        />
      </Field>
    </>
  );
}
