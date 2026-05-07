// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Passo 3: time + extras + metodologia + horas/sem ("Quem vai junto, e como").

import { Field } from '../components/Field';
import { MemberPicker } from '../components/MemberPicker';
import { wizardInputClass, wizardTextareaClass } from './wizardTypes';
import type { CollabLite, WizardData } from './wizardTypes';

interface Props {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
  collabsAvailable: CollabLite[];
}

export function Step3TimeComo({ data, update, collabsAvailable }: Props) {
  return (
    <>
      <header>
        <h2 className="text-section-title">Quem vai junto, e como</h2>
        <p className="text-body-sm text-fg-muted mt-1">
          Pessoas e caminho. O TOM precisa entender o time pra distribuir tarefas certo.
        </p>
      </header>
      <Field
        label="👥 Quem vai participar?"
        sub="Marca quem do time vai junto. Cada um recebe um aviso pelo WhatsApp quando o projeto começar."
      >
        <MemberPicker
          collabs={collabsAvailable}
          selected={data.member_ids}
          onToggle={(id) => {
            update(
              'member_ids',
              data.member_ids.includes(id)
                ? data.member_ids.filter((x) => x !== id)
                : [...data.member_ids, id],
            );
          }}
        />
      </Field>
      <Field
        label="Alguém de fora do time?"
        sub="Opcional. Texto livre — quem não está cadastrado aqui."
      >
        <textarea
          value={data.extra_members}
          onChange={(e) => update('extra_members', e.target.value)}
          placeholder="Ex: pais dos alunos, professor convidado da escola X"
          rows={2}
          className={wizardTextareaClass}
        />
      </Field>
      <Field
        label="🛠️ Como você imagina executar?"
        sub="Que abordagem ou caminho você tá vendo? Não precisa de plano detalhado, só o método."
      >
        <textarea
          value={data.methodology}
          onChange={(e) => update('methodology', e.target.value)}
          placeholder="Ex: 4 ensaios coletivos + ensaio geral + show"
          rows={3}
          className={wizardTextareaClass}
        />
      </Field>
      <Field
        label="⏱️ Quantas horas por semana o time vai investir?"
        sub="Opcional. Ajuda o TOM a calcular carga. De 0 a 80."
      >
        <input
          type="number"
          inputMode="numeric"
          value={data.estimated_hours_week}
          onChange={(e) => update('estimated_hours_week', e.target.value)}
          min={0}
          max={80}
          placeholder="Ex: 6"
          className={wizardInputClass}
        />
      </Field>
    </>
  );
}
