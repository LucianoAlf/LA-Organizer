import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { EventoSheet } from '../components/EventoSheet';
import { PageHeader } from '../components/PageHeader';
import { Fab } from '../components/Fab';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CustomSelect } from '../components/CustomSelect';
import { RowMenu } from '../components/RowMenu';
import { Badge } from '../components/Badge';
import { showToast } from '../components/Toast';
import { unitsLabel, formatEventRange } from '../types';
import type { SchoolEvent, EventType, SchoolUnit } from '../types';

type Period = 'calendar' | 'month' | 'quarter' | 'semester' | 'year';
type UnitFilter = 'all' | SchoolUnit;
const DOW_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

interface EventoRow extends SchoolEvent {
  // O select traz announcements como join se houver — opcional pra futura integração.
  announcements?: { id: string; status: string }[];
}

const PERIOD_LABEL: Record<Period, string> = {
  calendar: 'Calendário',
  month: 'Mês',
  quarter: 'Trimestre',
  semester: 'Semestre',
  year: 'Ano',
};

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'calendar', label: 'Calendário' },
  { value: 'month', label: 'Mês' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'semester', label: 'Semestre' },
  { value: 'year', label: 'Ano' },
];

const UNIT_OPTIONS: { value: UnitFilter; label: string }[] = [
  { value: 'all', label: 'Todas as unidades' },
  { value: 'barra', label: 'Barra' },
  { value: 'recreio', label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
];

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function ymdToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ymdAt(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Range [inicio, fim] em YMD para o período + ref escolhidos.
 * - month: 1 mês completo
 * - quarter: 3 meses (jan-mar, abr-jun, jul-set, out-dez)
 * - semester: 6 meses (jan-jun, jul-dez)
 * - year: ano todo
 */
function periodRange(period: Period, refYear: number, refMonth: number): { from: string; to: string; label: string } {
  if (period === 'month' || period === 'calendar') {
    const last = lastDayOfMonth(refYear, refMonth);
    return {
      from: ymdAt(refYear, refMonth, 1),
      to: ymdAt(refYear, refMonth, last),
      label: `${MONTHS_PT[refMonth]} ${refYear}`,
    };
  }
  if (period === 'quarter') {
    const qIdx = Math.floor(refMonth / 3); // 0..3
    const startMonth = qIdx * 3;
    const endMonth = startMonth + 2;
    const last = lastDayOfMonth(refYear, endMonth);
    return {
      from: ymdAt(refYear, startMonth, 1),
      to: ymdAt(refYear, endMonth, last),
      label: `${qIdx + 1}º trimestre · ${refYear}`,
    };
  }
  if (period === 'semester') {
    const isFirst = refMonth < 6;
    const startMonth = isFirst ? 0 : 6;
    const endMonth = isFirst ? 5 : 11;
    const last = lastDayOfMonth(refYear, endMonth);
    return {
      from: ymdAt(refYear, startMonth, 1),
      to: ymdAt(refYear, endMonth, last),
      label: `${isFirst ? '1º' : '2º'} semestre · ${refYear}`,
    };
  }
  // year
  return {
    from: ymdAt(refYear, 0, 1),
    to: ymdAt(refYear, 11, 31),
    label: `${refYear}`,
  };
}

function shiftPeriod(period: Period, refYear: number, refMonth: number, dir: -1 | 1): { y: number; m: number } {
  let y = refYear;
  let m = refMonth;
  const step =
    period === 'month' || period === 'calendar' ? 1 :
    period === 'quarter' ? 3 :
    period === 'semester' ? 6 :
    12;
  m = m + dir * step;
  while (m < 0) { m += 12; y -= 1; }
  while (m > 11) { m -= 12; y += 1; }
  return { y, m };
}

function daysUntil(ymd: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(ymd + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function proximityBadge(eventDate: string, endDate: string | null) {
  // Considera evento "ativo" se hoje está dentro do range
  const today = ymdToday();
  if (endDate && today >= eventDate && today <= endDate) {
    return { label: 'Em curso', tone: 'tom' as const };
  }
  const d = daysUntil(eventDate);
  if (d === 0) return { label: 'Hoje', tone: 'warning' as const };
  if (d === 1) return { label: 'Amanhã', tone: 'warning' as const };
  if (d > 0 && d <= 7) return { label: `Em ${d} dias`, tone: 'success' as const };
  return null;
}

function monthKey(ymd: string): string {
  return ymd.slice(0, 7); // YYYY-MM
}

function monthHeader(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_PT[m - 1]} ${y}`;
}

export function AgendaEscolar() {
  const { collaborator, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'director' || role === 'coordinator';

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EventoRow | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [unitFilter, setUnitFilter] = useState<UnitFilter>('all');

  const today = new Date();
  const [refYear, setRefYear] = useState(today.getFullYear());
  const [refMonth, setRefMonth] = useState(today.getMonth());

  const range = useMemo(() => periodRange(period, refYear, refMonth), [period, refYear, refMonth]);

  // Tipos vêm do banco (cores + emojis).
  const typesQ = useQuery({
    queryKey: ['event-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_types')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as EventType[];
    },
  });
  const typesById = useMemo(() => {
    const map = new Map<string, EventType>();
    for (const t of typesQ.data ?? []) map.set(t.id, t);
    return map;
  }, [typesQ.data]);

  const { data: rawEvents = [], isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['agenda-escolar', range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_events')
        .select('*')
        .gte('event_date', range.from)
        .lte('event_date', range.to)
        .order('event_date', { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as EventoRow[];
    },
  });

  // Filtro de unidade no client: evento sem unidades = escola toda (sempre aparece).
  const events = useMemo(() => {
    if (unitFilter === 'all') return rawEvents;
    return rawEvents.filter(ev => {
      const list = (ev.units && ev.units.length > 0) ? ev.units : (ev.unit ? [ev.unit] : []);
      if (list.length === 0) return true;
      return list.includes(unitFilter);
    });
  }, [rawEvents, unitFilter]);

  const cancelMutation = useMutation({
    mutationFn: async (eventId: string) => {
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });
      const { error: evErr } = await supabase
        .from('school_events')
        .update({ status: 'cancelled' })
        .eq('id', eventId);
      if (evErr) throw evErr;
      await supabase
        .from('announcements')
        .update({ status: 'cancelled' })
        .eq('source_event_id', eventId)
        .in('status', ['scheduled', 'sending']);
      // Cascata (Alf 24/06): cancelar o show cancela as tarefas de preparo (school_event_id),
      // senão viram órfãs e o dispatcher segue cobrando. Preserva done (histórico).
      await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('school_event_id', eventId)
        .not('status', 'in', '("done","cancelled")');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agenda-escolar'] });
      showToast({ kind: 'success', title: 'Evento cancelado', msg: 'Comunicações pendentes também foram canceladas.' });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao cancelar', msg: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (eventId: string) => {
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator!.id });
      // Cascata ANTES do delete: o FK tasks.school_event_id é ON DELETE SET NULL → sem isto as
      // tarefas de preparo viram órfãs (school_event_id=null) e vazam pros lembretes
      // operacional/pessoal. Cancela enquanto o vínculo existe. Preserva done.
      await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('school_event_id', eventId)
        .not('status', 'in', '("done","cancelled")');
      const { error } = await supabase.from('school_events').delete().eq('id', eventId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agenda-escolar'] });
      showToast({ kind: 'success', title: 'Evento excluído' });
    },
    onError: (err: Error) => showToast({ kind: 'error', title: 'Falha ao excluir', msg: err.message }),
  });

  // Agrupamento por mês para renderização.
  const grouped = useMemo(() => {
    const map = new Map<string, EventoRow[]>();
    for (const ev of events) {
      const key = monthKey(ev.event_date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  const totalCount = events.length;
  const activeCount = events.filter(e => e.status === 'active').length;

  function goToday() {
    const d = new Date();
    setRefYear(d.getFullYear());
    setRefMonth(d.getMonth());
  }

  const isCurrentPeriod = useMemo(() => {
    const d = new Date();
    if (period === 'month' || period === 'calendar') {
      return refYear === d.getFullYear() && refMonth === d.getMonth();
    }
    if (period === 'quarter') {
      return refYear === d.getFullYear() && Math.floor(refMonth / 3) === Math.floor(d.getMonth() / 3);
    }
    if (period === 'semester') {
      return refYear === d.getFullYear() && Math.floor(refMonth / 6) === Math.floor(d.getMonth() / 6);
    }
    return refYear === d.getFullYear();
  }, [period, refYear, refMonth]);

  // Eventos por dia (YMD) — usado pelo grid Calendário. Considera ranges (event_date..end_date).
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventoRow[]>();
    for (const ev of events) {
      const start = ev.event_date;
      const end = ev.end_date || ev.event_date;
      // Itera dia a dia entre start e end (limitado a 1 ano por segurança).
      let d = new Date(start + 'T00:00:00');
      const endD = new Date(end + 'T00:00:00');
      let guard = 0;
      while (d <= endD && guard < 400) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
        d = new Date(d.getTime() + 86400000);
        guard++;
      }
    }
    return map;
  }, [events]);

  // Grid 6×7 (42 células) começando no domingo da semana do dia 1.
  const calendarCells = useMemo(() => {
    if (period !== 'calendar') return [];
    const first = new Date(refYear, refMonth, 1);
    const startDow = first.getDay(); // 0=dom
    const startDate = new Date(refYear, refMonth, 1 - startDow);
    const cells: { ymd: string; day: number; inMonth: boolean; isToday: boolean }[] = [];
    const todayYmd = ymdToday();
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDate.getTime() + i * 86400000);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      cells.push({
        ymd,
        day: d.getDate(),
        inMonth: d.getMonth() === refMonth && d.getFullYear() === refYear,
        isToday: ymd === todayYmd,
      });
    }
    return cells;
  }, [period, refYear, refMonth]);

  const [calendarSelectedDay, setCalendarSelectedDay] = useState<string | null>(null);
  const calendarSelectedEvents = calendarSelectedDay ? (eventsByDay.get(calendarSelectedDay) ?? []) : [];

  return (
    <div className="space-y-md">
      <PageHeader
        title="Agenda LA Music"
        subtitle={totalCount > 0 ? `${activeCount} ativos · ${totalCount - activeCount} cancelados` : 'Calendário institucional de eventos'}
        backTo="/mais"
        right={canEdit ? (
          <Link
            to="/mais/agenda-escolar/equipe"
            className="text-caption text-tom underline focus-ring rounded-sm whitespace-nowrap"
          >
            Equipe
          </Link>
        ) : null}
      />

      {/* Período (5 chips) */}
      <div className="flex items-center gap-1 overflow-x-auto -mx-md px-md">
        {PERIOD_OPTIONS.map(p => {
          const active = p.value === period;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={[
                'shrink-0 h-8 px-3 rounded-full text-body-sm font-medium transition-colors focus-ring',
                active
                  ? 'bg-tom text-black'
                  : 'bg-bg-elevated text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Navegação do período — estilo unificado ao DateNavHeader (Hoje/Semana). */}
      <div className="surface px-md py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { const r = shiftPeriod(period, refYear, refMonth, -1); setRefYear(r.y); setRefMonth(r.m); }}
            aria-label={`${PERIOD_LABEL[period]} anterior`}
            className="h-8 w-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1 min-w-0 text-center text-body-md text-fg truncate capitalize">
            {range.label}
          </div>
          <button
            type="button"
            onClick={() => { const r = shiftPeriod(period, refYear, refMonth, 1); setRefYear(r.y); setRefMonth(r.m); }}
            aria-label={`${PERIOD_LABEL[period]} seguinte`}
            className="h-8 w-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring"
          >
            <ChevronRight size={18} />
          </button>
          {!isCurrentPeriod && (
            <button
              type="button"
              onClick={goToday}
              className="ml-1 px-2 py-1 text-body-sm rounded-sm bg-bg-elevated text-fg-secondary hover:text-fg focus-ring"
            >
              Hoje
            </button>
          )}
        </div>
      </div>

      <div>
        <CustomSelect
          value={unitFilter}
          options={UNIT_OPTIONS as { value: string; label: string }[]}
          onChange={(v) => setUnitFilter(v as UnitFilter)}
          size="sm"
        />
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <LoadingState rows={3} />
      ) : queryError ? (
        <ErrorState
          title="Não consegui carregar a agenda"
          description={(queryError as Error).message}
          onRetry={() => refetch()}
        />
      ) : period === 'calendar' ? (
        <div className="space-y-md">
          <div className="bg-bg-surface rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border bg-bg-elevated">
              {DOW_LABELS.map((d, i) => (
                <div
                  key={i}
                  className={[
                    'text-center text-caption font-semibold py-2',
                    i === 0 ? 'text-brand' : 'text-fg-muted',
                  ].join(' ')}
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calendarCells.map((cell, i) => {
                const dayEvents = eventsByDay.get(cell.ymd) ?? [];
                const isSelected = calendarSelectedDay === cell.ymd;
                const dow = i % 7;
                return (
                  <button
                    key={cell.ymd + '-' + i}
                    type="button"
                    onClick={() => setCalendarSelectedDay(isSelected ? null : cell.ymd)}
                    className={[
                      'min-h-[64px] p-1.5 text-left border-b border-r border-border focus-ring transition-colors',
                      'flex flex-col gap-1',
                      (i + 1) % 7 === 0 ? 'border-r-0' : '',
                      i >= 35 ? 'border-b-0' : '',
                      cell.inMonth ? 'bg-bg-surface' : 'bg-bg-app/40',
                      isSelected ? 'ring-2 ring-tom ring-inset' : 'hover:bg-bg-elevated',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'text-body-sm tabular-nums leading-none',
                        cell.isToday
                          ? 'inline-flex items-center justify-center w-6 h-6 rounded-full bg-tom text-black font-semibold'
                          : cell.inMonth
                            ? (dow === 0 ? 'text-brand font-medium' : 'text-fg')
                            : 'text-fg-muted/60',
                      ].join(' ')}
                    >
                      {cell.day}
                    </span>
                    {dayEvents.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-auto">
                        {dayEvents.slice(0, 3).map(ev => {
                          const t = typesById.get(ev.event_type);
                          return (
                            <span
                              key={ev.id}
                              className="block w-full h-1 rounded-full"
                              style={{ backgroundColor: t?.color_hex ?? '#9DB85B' }}
                              aria-hidden
                            />
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <span className="text-[9px] text-fg-muted leading-none">+{dayEvents.length - 3}</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Painel do dia selecionado */}
          {calendarSelectedDay && (
            <section className="space-y-2">
              <h3 className="text-body-sm uppercase tracking-wide text-fg-muted font-semibold">
                {(() => {
                  const [y, m, dd] = calendarSelectedDay.split('-').map(Number);
                  const d = new Date(y, m - 1, dd);
                  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
                })()}
              </h3>
              {calendarSelectedEvents.length === 0 ? (
                <p className="text-body-sm text-fg-muted">Nada nesse dia.</p>
              ) : (
                <ul className="space-y-2">
                  {calendarSelectedEvents.map(ev => {
                    const type = typesById.get(ev.event_type);
                    const isCancelled = ev.status === 'cancelled';
                    return (
                      <li key={ev.id}>
                        <Link
                          to={`/mais/eventos/${ev.id}`}
                          className={[
                            'flex items-center gap-2 p-2.5 rounded-lg bg-bg-surface border border-border',
                            'hover:border-tom/40 transition-colors',
                            isCancelled ? 'opacity-60' : '',
                          ].join(' ')}
                        >
                          <span
                            className="w-1 self-stretch rounded-full"
                            style={{ backgroundColor: type?.color_hex ?? '#6B7280' }}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <p className={['text-body-sm font-medium truncate', isCancelled ? 'line-through' : ''].join(' ')}>
                              {type?.emoji ?? '📅'} {ev.title}
                            </p>
                            <p className="text-caption text-fg-muted truncate">
                              {ev.is_all_day ? 'Dia inteiro' : (ev.start_time?.slice(0, 5) ?? 'Sem horário')}
                              {' · '}
                              {unitsLabel(ev.units, ev.unit)}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          title="Nenhum evento neste período"
          description={canEdit
            ? `Use o + pra criar um evento em ${range.label}.`
            : `Nada cadastrado para ${range.label} ainda.`}
        />
      ) : (
        <div className="space-y-lg">
          {grouped.map(([key, evs]) => (
            <section key={key} className="space-y-2">
              <h3 className="text-body-sm uppercase tracking-wide text-fg-muted font-semibold sticky top-0 bg-bg-app py-1 z-10">
                {monthHeader(key)}
              </h3>
              <ul className="space-y-3">
                {evs.map(ev => {
                  const type = typesById.get(ev.event_type);
                  const isCancelled = ev.status === 'cancelled';
                  const prox = !isCancelled ? proximityBadge(ev.event_date, ev.end_date) : null;
                  const items: Array<{ label: string; onClick: () => void; danger?: boolean; confirm?: string }> = [];
                  if (canEdit) {
                    items.push({ label: 'Editar', onClick: () => { setEditTarget(ev); setSheetOpen(true); } });
                    if (!isCancelled) {
                      items.push({
                        label: 'Cancelar evento',
                        danger: true,
                        confirm: 'Cancelar? Comunicações pendentes também serão canceladas.',
                        onClick: () => cancelMutation.mutate(ev.id),
                      });
                    }
                    items.push({
                      label: 'Excluir evento',
                      danger: true,
                      confirm: 'Excluir permanentemente? Não dá pra desfazer.',
                      onClick: () => deleteMutation.mutate(ev.id),
                    });
                  }
                  return (
                    <li
                      key={ev.id}
                      className={[
                        'relative bg-bg-surface rounded-xl border border-border',
                        'transition-all duration-150',
                        isCancelled ? 'opacity-60' : 'hover:border-tom/40 hover:shadow-[0_0_0_1px_rgba(157,184,91,0.15),0_8px_24px_-12px_rgba(157,184,91,0.30)]',
                      ].join(' ')}
                    >
                      <Link to={`/mais/eventos/${ev.id}`} className="flex gap-3 p-3 pr-10">
                        {ev.image_url && (
                          <img
                            src={ev.image_url}
                            alt=""
                            className="w-16 h-16 rounded-md object-cover shrink-0 border border-border"
                          />
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className="text-caption rounded-md px-1.5 py-0.5 font-medium"
                              style={{
                                backgroundColor: (type?.color_hex ?? '#6B7280') + '22',
                                color: type?.color_hex ?? '#6B7280',
                              }}
                            >
                              {type?.emoji ?? '📅'} {type?.label ?? 'Outro'}
                            </span>
                            {prox && <Badge tone={prox.tone === 'tom' ? 'success' : prox.tone}>{prox.label}</Badge>}
                            {isCancelled && <Badge tone="danger">Cancelado</Badge>}
                          </div>
                          <p className={['text-body font-medium', isCancelled ? 'line-through' : ''].join(' ')}>
                            {ev.title}
                          </p>
                          <p className="text-caption text-fg-muted tabular-nums">
                            {formatEventRange(ev.event_date, ev.end_date)}
                            {!ev.is_all_day && ev.start_time ? ` · ${ev.start_time.slice(0, 5)}` : ''}
                            {ev.is_all_day ? ' · dia inteiro' : ''}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap text-caption text-fg-muted">
                            <span className="inline-flex items-center gap-0.5">
                              <MapPin size={11} />
                              {unitsLabel(ev.units, ev.unit)}
                            </span>
                            {ev.location && <span>· {ev.location}</span>}
                          </div>
                        </div>
                      </Link>
                      {items.length > 0 && (
                        <div className="absolute top-2 right-2">
                          <RowMenu items={items} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {canEdit && (
        <Fab
          onClick={() => { setEditTarget(null); setSheetOpen(true); }}
          label="Novo"
          ariaLabel="Novo evento"
        />
      )}

      <EventoSheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setEditTarget(null); }}
        editTarget={editTarget}
      />
    </div>
  );
}
