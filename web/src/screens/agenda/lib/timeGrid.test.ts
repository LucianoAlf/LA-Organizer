import { describe, it, expect } from 'vitest';
import { timeToY, yToTime, computeLanes } from './timeGrid';

const CFG = { startHour: 6, hourHeight: 64, snapMinutes: 15 };

describe('timeToY', () => {
  it('06:00 → 0px', () => {
    expect(timeToY(new Date('2026-05-23T06:00:00-03:00'), CFG)).toBe(0);
  });
  it('07:30 → 96px', () => {
    expect(timeToY(new Date('2026-05-23T07:30:00-03:00'), CFG)).toBe(96);
  });
});

describe('yToTime', () => {
  it('0px → 06:00 (snap 15)', () => {
    const d = yToTime(0, new Date('2026-05-23'), CFG);
    expect(d.getHours()).toBe(6); expect(d.getMinutes()).toBe(0);
  });
  it('100px → snap pra 07:30 (mais próximo de 15min)', () => {
    const d = yToTime(100, new Date('2026-05-23'), CFG);
    expect(d.getHours()).toBe(7); expect(d.getMinutes()).toBe(30);
  });
});

describe('computeLanes (greedy)', () => {
  const ev = (id: string, start: string, end: string) => ({
    id, start_at: start, end_at: end,
  });
  it('2 events sem overlap → mesma lane', () => {
    const r = computeLanes([
      ev('a', '2026-05-23T09:00:00-03:00', '2026-05-23T10:00:00-03:00'),
      ev('b', '2026-05-23T10:00:00-03:00', '2026-05-23T11:00:00-03:00'),
    ]);
    expect(r.find(x => x.id === 'a')!.lane).toBe(0);
    expect(r.find(x => x.id === 'b')!.lane).toBe(0);
    expect(r.find(x => x.id === 'a')!.totalLanes).toBe(1);
  });
  it('2 events sobrepostos → 2 lanes', () => {
    const r = computeLanes([
      ev('a', '2026-05-23T09:00:00-03:00', '2026-05-23T10:30:00-03:00'),
      ev('b', '2026-05-23T09:30:00-03:00', '2026-05-23T10:00:00-03:00'),
    ]);
    expect(r.find(x => x.id === 'a')!.totalLanes).toBe(2);
    expect(r.find(x => x.id === 'b')!.totalLanes).toBe(2);
    expect(new Set(r.map(x => x.lane)).size).toBe(2);
  });
});
