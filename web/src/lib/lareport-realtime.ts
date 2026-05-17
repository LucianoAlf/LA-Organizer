import { useEffect } from 'react';
import { laReportClient } from './lareport-client';
import type { RealtimeChannel } from '@supabase/supabase-js';

type Filter = string | undefined;

export function useRealtimeRow(
  table: string,
  filter: Filter,
  onChange: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const ch: RealtimeChannel = laReportClient
      .channel(`rt:${table}:${filter ?? 'all'}:${Math.random()}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table, filter } as any, () => onChange())
      .subscribe();
    return () => { laReportClient.removeChannel(ch); };
  }, [table, filter, enabled, onChange]);
}
