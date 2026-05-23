// Drawer lateral direito que permite editar TODOS os campos do projeto num lugar so.
// Substitui a edicao tap-to-edit espalhada pelo header — agora o botao "Editar"
// abre esse drawer com nome, descricao, justificativa, categoria, status, datas,
// evento (data + hora), local, metodologia e esforco semanal.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';
import { Button } from './Button';
import { PROJECT_CATEGORY_LABELS, PROJECT_STATUS_LABELS } from '../lib/projectLabels';
import type { ProjectFull } from '../types/projectDetail';
import type { ProjectCategory, ProjectStatus } from '../types';

interface ProjectEditDrawerProps {
  open: boolean;
  onClose: () => void;
  project: ProjectFull;
  onSave: (patch: Partial<ProjectFull>) => void | Promise<void>;
}

const CATEGORY_OPTIONS = (Object.keys(PROJECT_CATEGORY_LABELS) as ProjectCategory[]).map(v => ({
  value: v,
  label: PROJECT_CATEGORY_LABELS[v],
}));

const STATUS_OPTIONS = (Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map(v => ({
  value: v,
  label: PROJECT_STATUS_LABELS[v],
}));

interface FormState {
  name: string;
  description: string;
  justification: string;
  category: ProjectCategory;
  status: ProjectStatus;
  start_date: string;
  end_date: string;
  event_date: string;
  event_start_time: string;
  location: string;
  methodology: string;
  estimated_hours_week: string;
}

function toForm(p: ProjectFull): FormState {
  return {
    name: p.name ?? '',
    description: p.description ?? '',
    justification: p.justification ?? '',
    category: p.category,
    status: p.status,
    start_date: p.start_date ?? '',
    end_date: p.end_date ?? '',
    event_date: p.event_date ?? '',
    event_start_time: p.event_start_time ?? '',
    location: p.location ?? '',
    methodology: p.methodology ?? '',
    estimated_hours_week: p.estimated_hours_week != null ? String(p.estimated_hours_week) : '',
  };
}

function diff(p: ProjectFull, f: FormState): Partial<ProjectFull> {
  const patch: Partial<ProjectFull> = {};
  const name = f.name.trim().slice(0, 200);
  if (name && name !== p.name) patch.name = name;

  const description = f.description.trim().slice(0, 1000) || null;
  if (description !== (p.description ?? null)) patch.description = description;

  const justification = f.justification.trim() || null;
  if (justification !== (p.justification ?? null)) patch.justification = justification;

  if (f.category !== p.category) patch.category = f.category;
  if (f.status !== p.status) patch.status = f.status;

  const start_date = f.start_date || null;
  if (start_date !== (p.start_date ?? null)) patch.start_date = start_date;

  const end_date = f.end_date || null;
  if (end_date !== (p.end_date ?? null)) patch.end_date = end_date;

  // Evento: so persiste se categoria for 'event'. Se trocar pra outra categoria,
  // limpa event_date/event_start_time pra nao deixar lixo.
  if (f.category === 'event') {
    const event_date = f.event_date || null;
    if (event_date !== (p.event_date ?? null)) patch.event_date = event_date;
    const event_start_time = f.event_start_time || null;
    if (event_start_time !== (p.event_start_time ?? null)) patch.event_start_time = event_start_time;
  } else {
    if (p.event_date) patch.event_date = null;
    if (p.event_start_time) patch.event_start_time = null;
  }

  const location = f.location.trim() || null;
  if (location !== (p.location ?? null)) patch.location = location;

  const methodology = f.methodology.trim() || null;
  if (methodology !== (p.methodology ?? null)) patch.methodology = methodology;

  const hoursRaw = f.estimated_hours_week.trim();
  const hours = hoursRaw === '' ? null : Number(hoursRaw);
  const hoursValid = hours === null || (Number.isFinite(hours) && hours >= 0);
  if (hoursValid && hours !== (p.estimated_hours_week ?? null)) {
    patch.estimated_hours_week = hours;
  }

  return patch;
}

const LABEL_CLS = 'block text-label text-fg-muted uppercase tracking-wide mb-1';
const INPUT_CLS = 'w-full h-10 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring';
const TEXTAREA_CLS = 'w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring resize-none';

export function ProjectEditDrawer({ open, onClose, project, onSave }: ProjectEditDrawerProps) {
  const [form, setForm] = useState<FormState>(() => toForm(project));
  const [saving, setSaving] = useState(false);
  // Sprint — controla a fase do mount pra animar entrada com translate-x.
  const [mounted, setMounted] = useState(false);

  // Reseta o form ao abrir e dispara a animacao de entrada no proximo frame.
  useEffect(() => {
    if (open) {
      setForm(toForm(project));
      setSaving(false);
      const r = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(r);
    } else {
      setMounted(false);
    }
  }, [open, project]);

  // Escape fecha.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleSave() {
    const patch = diff(project, form);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      setSaving(true);
      await onSave(patch);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const isEvent = form.category === 'event';

  return (
    <>
      {/* Overlay clicavel */}
      <div
        onClick={onClose}
        className={[
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
          mounted ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-hidden
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Editar projeto"
        className={[
          'fixed inset-y-0 right-0 w-[480px] max-w-full bg-bg-surface border-l border-border z-50',
          'flex flex-col shadow-soft transition-transform duration-200 ease-out',
          mounted ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-md py-3 border-b border-border shrink-0">
          <h2 className="text-card-title text-fg">Editar projeto</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated focus-ring transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body scrollavel */}
        <div className="flex-1 overflow-y-auto p-md space-y-md">
          <div>
            <label className={LABEL_CLS}>Nome</label>
            <input
              type="text"
              value={form.name}
              maxLength={200}
              onChange={e => update('name', e.target.value)}
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Descrição</label>
            <textarea
              rows={3}
              value={form.description}
              maxLength={1000}
              onChange={e => update('description', e.target.value)}
              className={TEXTAREA_CLS}
              placeholder="O que é esse projeto"
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Justificativa</label>
            <textarea
              rows={3}
              value={form.justification}
              onChange={e => update('justification', e.target.value)}
              className={TEXTAREA_CLS}
              placeholder="Por que esse projeto existe"
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Categoria</label>
            <CustomSelect
              value={form.category}
              options={CATEGORY_OPTIONS}
              onChange={v => update('category', v as ProjectCategory)}
              size="sm"
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Status</label>
            <CustomSelect
              value={form.status}
              options={STATUS_OPTIONS}
              onChange={v => update('status', v as ProjectStatus)}
              size="sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Início</label>
              <DateInput value={form.start_date} onChange={v => update('start_date', v)} />
            </div>
            <div>
              <label className={LABEL_CLS}>Fim</label>
              <DateInput value={form.end_date} onChange={v => update('end_date', v)} />
            </div>
          </div>

          {isEvent && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Data do evento</label>
                <DateInput value={form.event_date} onChange={v => update('event_date', v)} />
              </div>
              <div>
                <label className={LABEL_CLS}>Horário</label>
                <TimeInput value={form.event_start_time} onChange={v => update('event_start_time', v)} />
              </div>
            </div>
          )}

          <div>
            <label className={LABEL_CLS}>Local</label>
            <input
              type="text"
              value={form.location}
              onChange={e => update('location', e.target.value)}
              className={INPUT_CLS}
              placeholder="Onde acontece"
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Metodologia</label>
            <textarea
              rows={3}
              value={form.methodology}
              onChange={e => update('methodology', e.target.value)}
              className={TEXTAREA_CLS}
              placeholder="Como vai ser executado"
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Esforço semanal estimado</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step="0.5"
                value={form.estimated_hours_week}
                onChange={e => update('estimated_hours_week', e.target.value)}
                className={`${INPUT_CLS} flex-1`}
              />
              <span className="text-body-sm text-fg-muted">horas/semana</span>
            </div>
          </div>
        </div>

        {/* Footer com acoes */}
        <div className="flex items-center justify-end gap-2 px-md py-3 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
            Salvar
          </Button>
        </div>
      </aside>
    </>
  );
}
