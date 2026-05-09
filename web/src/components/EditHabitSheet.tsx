// Sprint 22.53 — CRUD de habits no PWA. Cria, edita, apaga (soft delete via is_active).
// Quando habit=null → modo criar com grid de templates.
// Quando habit=Habit → modo editar (sem grid, com Delete button).

import { useState, useEffect, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { TimeInput } from './TimeInput';

interface Habit {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  frequency: 'daily' | 'weekdays' | 'weekly' | 'custom_days';
  custom_days: number[] | null;
  reminder_time: string | null;
  notify_whatsapp: boolean;
}

interface Props {
  open: boolean;
  habit: Habit | null;
  onClose: () => void;
}

interface HabitTemplate {
  id: string;
  name: string;
  icon: string;
  color: string;
  default_frequency: 'daily' | 'weekdays' | 'weekly' | 'custom_days';
  category: string;
}

const FREQUENCY_LABELS: Record<Habit['frequency'], string> = {
  daily: 'Todo dia',
  weekdays: 'Seg–Sex',
  weekly: '1x por semana',
  custom_days: 'Dias específicos',
};

const DOW_LABELS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']; // seg, ter, qua, qui, sex, sab, dom (1..7)
const COLORS = ['#10B981', '#EF4444', '#3B82F6', '#84CC16', '#F97316', '#8B5CF6', '#E91E63', '#F59E0B', '#7C3AED', '#06B6D4'];
const ICON_SUGGESTIONS = ['💪', '🧘', '📚', '🎸', '💧', '💊', '🚶', '✍️', '✨', '💰', '🏃', '🍎', '😴', '🙏', '🎯', '🐶'];

export function EditHabitSheet({ open, habit, onClose }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const isNew = !habit;

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('💪');
  const [color, setColor] = useState(COLORS[0]);
  const [frequency, setFrequency] = useState<Habit['frequency']>('daily');
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [reminderTime, setReminderTime] = useState('');
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Fetch templates só no modo criar.
  const { data: templates = [] } = useQuery({
    queryKey: ['habit_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('habit_templates')
        .select('id, name, icon, color, default_frequency, category')
        .order('category, name');
      if (error) return [];
      return (data ?? []) as HabitTemplate[];
    },
    enabled: open && isNew,
    staleTime: 30 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    if (habit) {
      setName(habit.name || '');
      setIcon(habit.icon || '💪');
      setColor(habit.color || COLORS[0]);
      setFrequency(habit.frequency);
      setCustomDays(Array.isArray(habit.custom_days) ? habit.custom_days : []);
      setReminderTime(habit.reminder_time ? habit.reminder_time.slice(0, 5) : '');
      setNotifyWhatsapp(Boolean(habit.notify_whatsapp));
    } else {
      // Modo criar — defaults.
      setName('');
      setIcon('💪');
      setColor(COLORS[0]);
      setFrequency('daily');
      setCustomDays([]);
      setReminderTime('');
      setNotifyWhatsapp(false);
    }
    setError(null);
    setConfirmDelete(false);
  }, [open, habit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyTemplate(t: HabitTemplate) {
    setName(t.name);
    setIcon(t.icon);
    setColor(t.color);
    setFrequency(t.default_frequency);
    if (t.default_frequency === 'weekdays') setCustomDays([]);
    else if (t.default_frequency === 'weekly') setCustomDays([1]);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!collaborator) throw new Error('no_user');
      if (!name.trim()) throw new Error('Nome obrigatório.');
      const payload: Record<string, unknown> = {
        name: name.trim().slice(0, 100),
        icon,
        color,
        frequency,
        custom_days: (frequency === 'weekly' || frequency === 'custom_days')
          ? (customDays.length > 0 ? customDays : null)
          : null,
        reminder_time: reminderTime ? `${reminderTime}:00` : null,
        notify_whatsapp: notifyWhatsapp,
      };
      if (habit) {
        const { error } = await supabase
          .from('habits')
          .update(payload)
          .eq('id', habit.id)
          .eq('collaborator_id', collaborator.id);
        if (error) throw error;
      } else {
        payload.collaborator_id = collaborator.id;
        payload.is_active = true;
        payload.current_streak = 0;
        payload.best_streak = 0;
        const { error } = await supabase.from('habits').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!habit || !collaborator) throw new Error('no_habit');
      const { error } = await supabase
        .from('habits')
        .update({ is_active: false })
        .eq('id', habit.id)
        .eq('collaborator_id', collaborator.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  function toggleCustomDay(d: number) {
    setCustomDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={isNew ? 'Novo hábito' : 'Editar hábito'}>
      <form onSubmit={onSubmit} className="space-y-md">
        {/* Templates só no modo criar */}
        {isNew && templates.length > 0 && (
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Sugestões rápidas</div>
            <div className="grid grid-cols-3 gap-2">
              {templates.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="flex flex-col items-center gap-1 p-2 rounded-md bg-bg-elevated border border-border hover:border-tom focus-ring text-center"
                  style={{ borderTopColor: t.color, borderTopWidth: '2px' }}
                >
                  <span className="text-xl">{t.icon}</span>
                  <span className="text-body-sm text-fg leading-tight">{t.name}</span>
                </button>
              ))}
            </div>
            <div className="text-body-sm text-fg-muted mt-2">Ou escreve do zero abaixo.</div>
          </div>
        )}

        <label className="block">
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Nome</div>
          <input
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex.: Beber 2L de água"
            className="w-full h-12 px-3 rounded-md bg-bg-elevated border border-border text-fg focus-ring"
          />
        </label>

        <div>
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Ícone</div>
          <div className="flex flex-wrap gap-2">
            {ICON_SUGGESTIONS.map(em => (
              <button
                key={em}
                type="button"
                onClick={() => setIcon(em)}
                className={[
                  'w-10 h-10 grid place-items-center rounded-md border text-lg focus-ring transition-colors',
                  icon === em ? 'border-tom bg-tom/10' : 'border-border bg-bg-elevated hover:border-fg-muted',
                ].join(' ')}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Cor</div>
          <div className="flex flex-wrap gap-2">
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Cor ${c}`}
                className={[
                  'w-8 h-8 rounded-full border-2 focus-ring transition-transform',
                  color === c ? 'border-fg scale-110' : 'border-transparent',
                ].join(' ')}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Frequência</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(FREQUENCY_LABELS) as Habit['frequency'][]).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={[
                  'h-11 rounded-md border text-body-sm font-semibold transition-colors focus-ring',
                  frequency === f ? 'bg-tom text-black border-tom' : 'bg-bg-elevated text-fg-secondary border-border',
                ].join(' ')}
              >
                {FREQUENCY_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {(frequency === 'weekly' || frequency === 'custom_days') && (
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Dias da semana</div>
            <div className="grid grid-cols-7 gap-1">
              {DOW_LABELS.map((lbl, idx) => {
                const d = idx + 1; // 1=seg..7=dom
                const active = customDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleCustomDay(d)}
                    className={[
                      'h-10 rounded-md border text-body-sm font-semibold focus-ring',
                      active ? 'bg-tom text-black border-tom' : 'bg-bg-elevated text-fg-secondary border-border',
                    ].join(' ')}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
            {frequency === 'weekly' && customDays.length === 0 && (
              <div className="text-body-sm text-fg-muted mt-1.5">Escolhe pelo menos 1 dia. Default: segunda.</div>
            )}
          </div>
        )}

        <div>
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5 flex items-baseline gap-2">
            <span>Lembrete</span>
            <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">opcional · WhatsApp</span>
          </div>
          <TimeInput value={reminderTime} onChange={setReminderTime} />
          {reminderTime && (
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyWhatsapp}
                onChange={e => setNotifyWhatsapp(e.target.checked)}
                className="w-5 h-5 rounded border-border text-tom focus-ring"
              />
              <span className="text-body-sm text-fg">
                Mandar lembrete pelo WhatsApp às {reminderTime}
              </span>
            </label>
          )}
        </div>

        {error && (
          <p role="alert" className="text-body-sm text-danger">{error}</p>
        )}

        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={save.isPending} className="flex-1">
            {save.isPending ? 'Salvando…' : isNew ? 'Criar hábito' : 'Salvar'}
          </Button>
          {!isNew && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                remove.mutate();
              }}
              disabled={remove.isPending}
              className="text-danger"
            >
              <Trash2 size={16} />
              {confirmDelete ? 'Confirmar' : ''}
            </Button>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}
