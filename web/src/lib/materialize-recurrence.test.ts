// ============================================================================
// REDE DE SEGURANÇA (golden), espelho PWA do guard de recorrência.
// FATIA 2 (flip): o guard inline (materialize-recurrence.ts) bloqueia por SÉRIE
// ENCERRADA (series_ended_at), não por status da ocorrência — espelho do backend.
//
// done/cancelled/ended retornam ANTES de tocar o supabase → teste puro, sem mock.
// "ativo/concluído passa do guard" é provado por DIFERENCIAL determinístico:
// due_date inválido cai no parse (error:'invalid_dtstart') → logo passou do guard;
// série encerrada com o MESMO due inválido para no guard (sem error).
// ============================================================================
import { describe, it, expect } from 'vitest';
import { materializeSeriesClient } from './materialize-recurrence';

const baseTpl = { id: 'tpl-pwa-1', recurrence_rule: 'FREQ=DAILY', due_date: '2026-06-24' };
const TS = '2026-06-24T12:00:00Z';

describe('materializeSeriesClient — guard de ciclo de vida (Fatia 2: series_ended_at)', () => {
  // GM7a — série ENCERRADA (series_ended_at preenchido) → {created:0} (retorna no guard).
  it('GM7a — série encerrada (series_ended_at set) não materializa', async () => {
    const r = await materializeSeriesClient('tasks', { ...baseTpl, series_ended_at: TS } as never);
    expect(r).toEqual({ created: 0, skipped: 0 });
  });

  // GM7b — ÂNCORA: ocorrência concluída (status=done) mas série NÃO encerrada → passa do guard.
  // Diferencial: due inválido cai no parse (provando que NÃO foi bloqueada pelo guard).
  it('GM7b — done sem series_ended_at passa do guard (concluir ocorrência ≠ encerrar série)', async () => {
    const r = await materializeSeriesClient('tasks', { ...baseTpl, due_date: 'data-invalida', status: 'done', series_ended_at: null } as never);
    expect(r.error).toBe('invalid_dtstart');
  });

  // GM7c — contraprova: série encerrada com o MESMO due inválido PARA no guard (sem error).
  it('GM7c — série encerrada para no guard mesmo com due inválido (sem error)', async () => {
    const r = await materializeSeriesClient('tasks', { ...baseTpl, due_date: 'data-invalida', series_ended_at: TS } as never);
    expect(r).toEqual({ created: 0, skipped: 0 });
    expect(r.error).toBeUndefined();
  });

  // fail-open (trava C): sem a coluna (undefined) NÃO bloqueia — passa do guard.
  it('fail-open — sem series_ended_at (coluna ausente no SELECT) passa do guard', async () => {
    const r = await materializeSeriesClient('tasks', { ...baseTpl, due_date: 'data-invalida' } as never);
    expect(r.error).toBe('invalid_dtstart');
  });
});
