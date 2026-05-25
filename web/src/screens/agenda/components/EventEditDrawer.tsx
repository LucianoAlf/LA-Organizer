import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DetailDrawer } from '../../../design/primitives/DetailDrawer';
import { DateInput } from '../../../components/DateInput';
import { TimeInput } from '../../../components/TimeInput';
import { CustomSelect } from '../../../components/CustomSelect';
import { Button } from '../../../components/Button';
import type { EventForGrid } from '../hooks/useAgendaEvents';

const CATEGORIES = [
  { value: 'la_music', label: 'LA Music' }, { value: 'mentoria', label: 'Mentoria' },
  { value: 'estudio',  label: 'Estúdio'  }, { value: 'show',     label: 'Show'     },
  { value: 'pessoal',  label: 'Pessoal'  },
];

export interface EventEditDrawerProps {
  event: EventForGrid | null;
  open: boolean;
  onClose: () => void;
  onSave: (id: string, patch: Partial<EventForGrid>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function EventEditDrawer(p: EventEditDrawerProps) {
  const ev = p.event;
  const [form, setForm] = useState<EventForGrid | null>(ev);

  useEffect(() => { setForm(ev); /* eslint-disable-next-line */ }, [ev?.id]);

  const patch = useMemo<Partial<EventForGrid>>(() => {
    if (!form || !ev) return {};
    const diff: Partial<EventForGrid> = {};
    (Object.keys(form) as (keyof EventForGrid)[]).forEach((k) => {
      if (form[k] !== ev[k]) (diff as any)[k] = form[k];
    });
    return diff;
  }, [form, ev]);

  if (!form || !ev) {
    return <DetailDrawer open={false} onClose={p.onClose} title="">{null}</DetailDrawer>;
  }

  const startDate = form.start_at.slice(0, 10);
  const startTime = new Date(form.start_at).toTimeString().slice(0, 5);
  const endDate = form.end_at.slice(0, 10);
  const endTime = new Date(form.end_at).toTimeString().slice(0, 5);

  const setStart = (date: string, time: string) => {
    const d = new Date(`${date}T${time}:00`);
    setForm({ ...form, start_at: d.toISOString() });
  };
  const setEnd = (date: string, time: string) => {
    const d = new Date(`${date}T${time}:00`);
    setForm({ ...form, end_at: d.toISOString() });
  };

  const error = validate(form);

  const handleSave = async () => {
    if (error) return;
    await p.onSave(ev.id, patch);
    p.onClose();
  };
  const handleDelete = async () => {
    if (!confirm('Deletar esse compromisso? Essa ação não pode ser desfeita.')) return;
    await p.onDelete(ev.id);
    p.onClose();
  };

  return (
    <DetailDrawer
      open={p.open} onClose={p.onClose} title="Editar compromisso"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleDelete}>
            <Trash2 size={14} /> Deletar
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={p.onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!!error}>Salvar</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Título">
          <input value={form.title} maxLength={200}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg" />
        </Field>

        <Field label="Descrição">
          <textarea value={form.description ?? ''} maxLength={2000} rows={3}
            onChange={(e) => setForm({ ...form, description: e.target.value || null })}
            placeholder="Pauta, contexto, o que tratar..."
            className="w-full px-2 py-1.5 rounded-md bg-bg-surface border border-border text-fg resize-y placeholder:text-fg-muted" />
        </Field>

        <Field label="Início">
          <div className="flex gap-2">
            <DateInput value={startDate} onChange={(d: string) => setStart(d, startTime)} />
            <TimeInput value={startTime} onChange={(t: string) => setStart(startDate, t)} />
          </div>
        </Field>
        <Field label="Fim">
          <div className="flex gap-2">
            <DateInput value={endDate} onChange={(d: string) => setEnd(d, endTime)} />
            <TimeInput value={endTime} onChange={(t: string) => setEnd(endDate, t)} />
          </div>
        </Field>

        <Field label="Categoria">
          <CustomSelect
            value={form.category} options={CATEGORIES}
            onChange={(v: string) => setForm({
              ...form, category: v,
              context: v === 'pessoal' ? 'personal' : 'work',
            })}
          />
        </Field>

        <Field label="Contexto">
          <div className="flex gap-2">
            {(['work','personal'] as const).map(c => (
              <button key={c} type="button"
                onClick={() => setForm({ ...form, context: c })}
                className={['h-8 px-3 rounded-md text-[12px] focus-ring',
                  form.context === c ? 'bg-tom text-black font-semibold' : 'bg-bg-elevated text-fg-muted'].join(' ')}>
                {c === 'work' ? 'Trabalho' : 'Pessoal'}
              </button>
            ))}
          </div>
          {form.category === 'pessoal' && (
            <div className="text-[10px] text-fg-muted mt-1">🛡 Pessoal não é visto por coordenação</div>
          )}
        </Field>

        <Field label="Modalidade">
          <div className="flex gap-2">
            {(['presencial','online','hibrido'] as const).map(m => (
              <button key={m} type="button"
                onClick={() => setForm({ ...form, modality: m })}
                className={['h-8 px-3 rounded-md text-[12px] focus-ring capitalize',
                  form.modality === m ? 'bg-tom text-black font-semibold' : 'bg-bg-elevated text-fg-muted'].join(' ')}>
                {m}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Local">
          <input value={form.location_text ?? ''}
            onChange={(e) => setForm({ ...form, location_text: e.target.value || null })}
            className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg" />
        </Field>

        {(form.modality === 'online' || form.modality === 'hibrido') && (
          <Field label="Link da reunião">
            <input type="url" value={form.meeting_url ?? ''}
              onChange={(e) => setForm({ ...form, meeting_url: e.target.value || null })}
              className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg" />
          </Field>
        )}

        <Field label="Status">
          <div className="flex gap-2">
            {(['scheduled','done','cancelled'] as const).map(s => (
              <button key={s} type="button"
                onClick={() => setForm({ ...form, status: s })}
                className={['h-8 px-3 rounded-md text-[12px] focus-ring',
                  form.status === s ? 'bg-tom text-black font-semibold' : 'bg-bg-elevated text-fg-muted'].join(' ')}>
                {s === 'scheduled' ? 'Agendado' : s === 'done' ? '✓ Concluído' : '✕ Cancelado'}
              </button>
            ))}
          </div>
        </Field>

        {/* Lembretes — chips relativos a start_at, escrevem em events.remind_at (single). */}
        <Field label="Lembrete">
          <div className="flex flex-wrap gap-1.5">
            {([
              { label: 'Na hora',       minutes: 0    },
              { label: '15min antes',   minutes: 15   },
              { label: '30min antes',   minutes: 30   },
              { label: '1h antes',      minutes: 60   },
              { label: '1 dia antes',   minutes: 1440 },
            ] as const).map(p => {
              const startMs = new Date(form.start_at).getTime();
              const presetMs = startMs - p.minutes * 60_000;
              const presetIso = new Date(presetMs).toISOString();
              const active = form.remind_at && Math.abs(new Date(form.remind_at).getTime() - presetMs) < 60_000;
              return (
                <button
                  key={p.minutes}
                  type="button"
                  onClick={() => setForm({ ...form, remind_at: active ? null : presetIso })}
                  className={[
                    'px-3 py-1 rounded-full text-[11px] border transition-colors focus-ring',
                    active
                      ? 'bg-tom text-black border-tom font-semibold'
                      : 'bg-bg-elevated text-fg-muted border-border hover:text-fg',
                  ].join(' ')}
                >
                  {p.label}
                </button>
              );
            })}
            {form.remind_at && (
              <button
                type="button"
                onClick={() => setForm({ ...form, remind_at: null })}
                className="px-3 py-1 rounded-full text-[11px] border border-border bg-bg-elevated text-danger hover:opacity-80 focus-ring"
              >
                Sem lembrete
              </button>
            )}
          </div>
          {form.remind_at && (
            <p className="text-[10px] text-fg-muted mt-1.5">
              TOM vai avisar em {new Date(form.remind_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}.
            </p>
          )}
        </Field>

        <div className="text-[10px] text-fg-muted pt-2 border-t border-border">
          Criado por {ev.source} · {new Date(form.start_at).toLocaleDateString('pt-BR')}
        </div>

        {error && <div className="text-[12px] text-danger">{error}</div>}
      </div>
    </DetailDrawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">{label}</div>
      {children}
    </div>
  );
}

function validate(f: EventForGrid): string | null {
  if (!f.title.trim()) return 'Título obrigatório';
  if (new Date(f.end_at) <= new Date(f.start_at)) return 'Fim deve ser após o início';
  const sameDay = f.start_at.slice(0,10) === f.end_at.slice(0,10);
  if (!sameDay) return 'Evento de múltiplos dias não suportado';
  if (f.modality === 'presencial' && f.meeting_url) return 'Eventos presenciais não têm link';
  return null;
}
