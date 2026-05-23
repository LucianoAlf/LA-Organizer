export interface GridConfig {
  startHour: number;
  hourHeight: number;
  snapMinutes: number;
}

export function timeToY(date: Date, cfg: GridConfig): number {
  const totalMin = (date.getHours() - cfg.startHour) * 60 + date.getMinutes();
  return (totalMin / 60) * cfg.hourHeight;
}

export function yToTime(y: number, day: Date, cfg: GridConfig): Date {
  const rawMin = (y / cfg.hourHeight) * 60;
  const snapped = Math.round(rawMin / cfg.snapMinutes) * cfg.snapMinutes;
  const totalMin = cfg.startHour * 60 + Math.max(0, snapped);
  const out = new Date(day);
  out.setHours(Math.floor(totalMin / 60), totalMin % 60, 0, 0);
  return out;
}

export interface LaneEvent { id: string; start_at: string; end_at: string }
export interface LanedEvent extends LaneEvent { lane: number; totalLanes: number }

export function computeLanes<T extends LaneEvent>(events: T[]): (T & { lane: number; totalLanes: number })[] {
  const sorted = [...events].sort((a, b) =>
    new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  const result: (T & { lane: number; totalLanes: number })[] = [];
  let cluster: T[] = [];
  let clusterEnd = 0;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((ev) => {
      const start = new Date(ev.start_at).getTime();
      const end = new Date(ev.end_at).getTime();
      let lane = laneEnds.findIndex(e => e <= start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(end); }
      else laneEnds[lane] = end;
      return { ...ev, lane, totalLanes: 0 };
    });
    const total = laneEnds.length;
    assigned.forEach(a => { a.totalLanes = total; result.push(a); });
    cluster = []; clusterEnd = 0;
  };
  for (const ev of sorted) {
    const start = new Date(ev.start_at).getTime();
    const end = new Date(ev.end_at).getTime();
    if (cluster.length && start >= clusterEnd) flush();
    cluster.push(ev); clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return result;
}
