// Dev-only preview route — renderiza TimeGrid com eventos mockados pra screenshot de QA.
// Não usa auth nem supabase. Pode ser deletado depois do screenshot ou mantido como demo.

import { useState } from 'react';
import { TimeGrid } from './agenda/components/TimeGrid';
import { MonthView } from './agenda/views/MonthView';
import type { EventForGrid } from './agenda/hooks/useAgendaEvents';

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const MOCK_EVENTS: EventForGrid[] = [
  { id: 'e1', title: 'Reunião com Rodrigo', start_at: todayAt(7), end_at: todayAt(8),
    context: 'work', category: 'la_music', category_color: '#A3BE50',
    modality: 'presencial', location_text: 'Sede Barra', meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
  { id: 'e2', title: 'Review do Sprint', start_at: todayAt(9), end_at: todayAt(10, 30),
    context: 'work', category: 'la_music', category_color: '#A3BE50',
    modality: 'online', location_text: null, meeting_url: 'https://meet.google.com/x',
    status: 'scheduled', project_id: null, source: 'tom' },
  { id: 'e3', title: 'Mentoria Levi', start_at: todayAt(11), end_at: todayAt(12),
    context: 'work', category: 'mentoria', category_color: '#7B61FF',
    modality: 'online', location_text: null, meeting_url: 'https://meet.google.com/y',
    status: 'scheduled', project_id: null, source: 'tom' },
  { id: 'e4', title: 'Academia', start_at: todayAt(13), end_at: todayAt(14),
    context: 'personal', category: 'pessoal', category_color: '#64748B',
    modality: 'presencial', location_text: 'Smart Fit', meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
  { id: 'e5', title: 'Reunião pedagógica', start_at: todayAt(14, 30), end_at: todayAt(15, 30),
    context: 'work', category: 'la_music', category_color: '#A3BE50',
    modality: 'presencial', location_text: 'Sede Barra', meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
  { id: 'e6', title: 'Gravação estúdio', start_at: todayAt(16), end_at: todayAt(17, 30),
    context: 'work', category: 'estudio', category_color: '#EC4899',
    modality: 'presencial', location_text: 'Estúdio', meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
  // overlap proposital pra testar lanes
  { id: 'e7', title: '1:1 Peterson', start_at: todayAt(9, 30), end_at: todayAt(10),
    context: 'work', category: 'mentoria', category_color: '#7B61FF',
    modality: 'online', location_text: null, meeting_url: null,
    status: 'scheduled', project_id: null, source: 'manual' },
];

export default function AgendaPreviewDev() {
  const [view, setView] = useState<'day'|'month'>('day');
  const today = new Date();
  const monthDate = new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <div className="fixed inset-0 flex flex-col bg-bg-app text-fg">
      <header className="h-14 shrink-0 border-b border-border bg-bg-surface flex items-center px-4 gap-4">
        <span className="text-[14px] font-semibold">📅 Agenda DEV Preview (sem auth)</span>
        <div className="inline-flex rounded-md border border-border bg-bg-elevated overflow-hidden">
          {(['day','month'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={['h-8 px-3 text-[12px]', view === v ? 'bg-tom text-black font-semibold' : 'text-fg-muted hover:text-fg'].join(' ')}>
              {v === 'day' ? 'Dia' : 'Mês'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-fg-muted">7 eventos mockados (inclui overlap 09:00–10:30 / 09:30–10:00)</span>
      </header>
      <main className="flex-1 min-h-0">
        {view === 'day' ? (
          <TimeGrid
            days={[today]} events={MOCK_EVENTS}
            onSlotClick={() => {}} onEventClick={() => {}}
            onEventDrop={() => {}} onEventResize={() => {}}
          />
        ) : (
          <MonthView
            monthDate={monthDate} events={MOCK_EVENTS}
            selectedDay={today}
            onDayClick={() => {}} onDayDoubleClick={() => {}}
            onEventClick={() => {}} onEmptyAreaClick={() => {}}
          />
        )}
      </main>
    </div>
  );
}
