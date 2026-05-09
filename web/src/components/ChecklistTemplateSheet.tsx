// web/src/components/ChecklistTemplateSheet.tsx
// Sprint 22.39 — Refactor pro design system unificado: CustomSelect (não <select>),
// TimeInput (não <input type="time">), Button (não bg-brand cru). Day chips bg-tom.
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { CustomSelect } from './CustomSelect'
import { TimeInput } from './TimeInput'
import { ChecklistItemEditRow } from './ChecklistItemEditRow'
import type { OpChecklistTemplate, OpChecklistItem, OpChecklistItemDraft } from '../types'

type TemplateWithItems = OpChecklistTemplate & { op_checklist_items?: OpChecklistItem[] }

const FUNCTION_ROLES = [
  { value: 'secretary_morning',     label: 'Secretária (manhã)' },
  { value: 'secretary_evening',     label: 'Secretária (noite)' },
  { value: 'pedagogical_assistant', label: 'Assistente pedagógica' },
  { value: 'cleaning',              label: 'Limpeza' },
] as const

const UNITS = [
  { value: 'all',          label: 'Todas as unidades' },
  { value: 'barra',        label: 'Barra' },
  { value: 'recreio',      label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
] as const

const SHIFTS = [
  { value: 'morning',   label: 'Manhã' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'evening',   label: 'Noite' },
  { value: 'full',      label: 'Integral' },
] as const

const DAYS = [
  { n: 1, label: 'Seg' }, { n: 2, label: 'Ter' }, { n: 3, label: 'Qua' },
  { n: 4, label: 'Qui' }, { n: 5, label: 'Sex' }, { n: 6, label: 'Sáb' },
  { n: 7, label: 'Dom' },
]

interface Props {
  open: boolean
  template: TemplateWithItems | null  // null = create mode
  onClose: () => void
}

export function ChecklistTemplateSheet({ open, template, onClose }: Props) {
  const { collaborator } = useAuth()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [functionRole, setFunctionRole] = useState('secretary_morning')
  const [unit, setUnit] = useState('all')
  const [shift, setShift] = useState('morning')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1,2,3,4,5])
  const [dispatchTime, setDispatchTime] = useState('08:00')
  const [threshold, setThreshold] = useState(80)
  const [items, setItems] = useState<OpChecklistItemDraft[]>([])
  const [newItemText, setNewItemText] = useState('')

  useEffect(() => {
    if (!open) return
    if (template) {
      setName(template.name)
      setFunctionRole(template.function_role)
      setUnit(template.unit)
      setShift(template.shift)
      setDaysOfWeek(template.days_of_week)
      setDispatchTime(template.dispatch_time)
      setThreshold(template.completion_threshold)
      const activeItems = (template.op_checklist_items ?? [])
        .filter((i: OpChecklistItem) => i.is_active !== false)
        .sort((a: OpChecklistItem, b: OpChecklistItem) => a.sort_order - b.sort_order)
        .map((i: OpChecklistItem) => ({ id: i.id, description: i.description,
                     sort_order: i.sort_order, is_active: true as const }))
      setItems(activeItems)
    } else {
      setName('')
      setFunctionRole('secretary_morning')
      setUnit('all')
      setShift('morning')
      setDaysOfWeek([1,2,3,4,5])
      setDispatchTime('08:00')
      setThreshold(80)
      setItems([])
    }
    setNewItemText('')
  }, [open, template])

  const isValid = name.trim().length > 0
    && daysOfWeek.length > 0
    && threshold >= 0 && threshold <= 100

  const toggleDay = (n: number) =>
    setDaysOfWeek(prev =>
      prev.includes(n) ? prev.filter(d => d !== n) : [...prev, n].sort((a,b) => a-b)
    )

  const moveItem = (index: number, dir: -1 | 1) => {
    setItems(prev => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((item, i) => ({ ...item, sort_order: i + 1 }))
    })
  }

  const addItem = () => {
    const text = newItemText.trim()
    if (!text) return
    setItems(prev => [...prev, {
      description: text,
      sort_order: prev.length + 1,
      is_active: true,
    }])
    setNewItemText('')
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        function_role: functionRole,
        unit,
        shift,
        days_of_week: daysOfWeek,
        dispatch_time: dispatchTime,
        completion_threshold: threshold,
        is_active: true,
        updated_by: collaborator!.id,
        ...(template ? { id: template.id } : {}),
      }

      const { data: saved, error: upsertErr } = await supabase
        .from('op_checklists')
        .upsert(payload)
        .select('id')
        .single()
      if (upsertErr) throw upsertErr

      // Soft-delete items that were removed from the list
      if (template) {
        const existingIds = (template.op_checklist_items ?? [])
          .filter((i: OpChecklistItem) => i.is_active !== false)
          .map((i: OpChecklistItem) => i.id)
        const keepIds = new Set(items.filter(i => i.id).map(i => i.id!))
        const removedIds = existingIds.filter((id: string) => !keepIds.has(id))
        for (const rid of removedIds) {
          await supabase
            .from('op_checklist_items')
            .update({ is_active: false, updated_by: collaborator!.id })
            .eq('id', rid)
        }
      }

      // Upsert all active items
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const { error } = await supabase
          .from('op_checklist_items')
          .upsert({
            checklist_id: saved.id,
            description: item.description,
            sort_order: i + 1,
            is_active: true,
            updated_by: collaborator!.id,
            ...(item.id ? { id: item.id } : {}),
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists-templates'] })
      onClose()
    },
  })

  return (
    <BottomSheet open={open} onClose={onClose}
      title={template ? 'Editar template' : 'Novo template'}>
      <div className="space-y-4 pb-4">

        <div>
          <label className="text-caption text-fg-muted block mb-1">Nome *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            maxLength={80} placeholder="ex: Abertura Escola"
            className="w-full bg-bg-surface border border-border rounded-md px-3 py-2
                       text-body text-fg focus:outline-none focus:border-tom focus-ring" />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Função *</label>
          <CustomSelect
            value={functionRole}
            onChange={setFunctionRole}
            options={FUNCTION_ROLES.map(r => ({ value: r.value, label: r.label }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-caption text-fg-muted block mb-1">Unidade *</label>
            <CustomSelect
              value={unit}
              onChange={setUnit}
              options={UNITS.map(u => ({ value: u.value, label: u.label }))}
            />
          </div>
          <div>
            <label className="text-caption text-fg-muted block mb-1">Turno *</label>
            <CustomSelect
              value={shift}
              onChange={setShift}
              options={SHIFTS.map(s => ({ value: s.value, label: s.label }))}
            />
          </div>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-2">Dias *</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAYS.map(d => {
              const isSel = daysOfWeek.includes(d.n)
              return (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDay(d.n)}
                  className={[
                    'h-9 px-3 rounded-md text-body-sm font-semibold transition-colors focus-ring',
                    isSel
                      ? 'bg-tom text-white shadow-card dark:shadow-none'
                      : 'bg-bg-subtle text-fg-muted border border-border hover:text-fg',
                  ].join(' ')}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-caption text-fg-muted block mb-1">Horário *</label>
            <TimeInput value={dispatchTime} onChange={setDispatchTime} />
          </div>
          <div>
            <label className="text-caption text-fg-muted block mb-1">Threshold (%) *</label>
            <input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-full h-12 bg-bg-surface border border-border rounded-md px-3
                         text-body text-fg focus:outline-none focus:border-tom focus-ring"
            />
          </div>
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-2">Itens ({items.length})</label>
          <div className="space-y-0.5">
            {items.map((item, index) => (
              <ChecklistItemEditRow key={index}
                description={item.description}
                index={index + 1}
                isFirst={index === 0}
                isLast={index === items.length - 1}
                onMoveUp={() => moveItem(index, -1)}
                onMoveDown={() => moveItem(index, 1)}
                onChange={val => setItems(prev =>
                  prev.map((it, i) => i === index ? { ...it, description: val } : it))}
                onDelete={() => setItems(prev => prev.filter((_, i) => i !== index))}
              />
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newItemText}
              onChange={e => setNewItemText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder="Adicionar item..."
              className="flex-1 bg-bg-surface border border-border rounded-md px-3 py-2
                         text-body-sm text-fg focus:outline-none focus:border-tom focus-ring"
            />
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={addItem}
              disabled={!newItemText.trim()}
            >
              Adicionar
            </Button>
          </div>
        </div>

        {saveMutation.isError && (
          <p className="text-danger text-caption">
            Erro ao salvar. Verifique sua conexão e tente novamente.
          </p>
        )}

        <Button
          variant="primary"
          size="md"
          fullWidth
          type="button"
          loading={saveMutation.isPending}
          disabled={!isValid}
          onClick={() => saveMutation.mutate()}
        >
          {template ? 'Salvar alterações' : 'Salvar template'}
        </Button>
      </div>
    </BottomSheet>
  )
}
