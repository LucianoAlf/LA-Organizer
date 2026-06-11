// useRealtimeSync — Sincronia real-time entre TOM (backend WhatsApp) e PWA.
//
// Por que existe: TOM escreve no banco via markers (EVENT_CREATE, TASK_CREATE,
// etc) quando o user conversa no WhatsApp. Sem realtime, o PWA só refletia
// essas mudanças no próximo refetch (staleTime=30s + interação). Isso quebrava
// a expectativa de "fala com TOM, vê no app na hora".
//
// Estratégia: 1 canal Supabase Realtime escutando INSERT/UPDATE/DELETE em
// todas as tabelas que o TOM toca. Qualquer mudança → invalidateQueries() em
// QUALQUER queryKey do TanStack. Apenas queries ativas (montadas) refazem
// fetch. Queries em background ficam marcadas como stale.
//
// Custo: 1 WebSocket por aba aberta + 1 invalidation por write. Suficiente
// para single-user / pequeno time.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Tabelas que TOM escreve via engine.js. Cada uma vira uma subscrição no canal.
const WATCHED_TABLES = [
  'events',
  'event_participants',
  'event_reminders',
  'tasks',
  'task_reminders',
  'task_comments',
  'projects',
  'project_members',
  'project_checkpoints',
  'habits',
  'habit_logs',
  'habit_reminders',
  'op_checklist_completions',
  'op_checklist_item_completions',
  'announcements',
  'announcement_jobs',
  'notifications',
  'personal_checklists',
  'personal_checklist_items',
  'coordination_requests',
  'group_chat_messages',
  // LA EDUCA
  'la_educa_estagiarios',
  'la_educa_avaliacoes',
  'la_educa_historico',
  'la_educa_lembretes_log',
];

export function useRealtimeSync(collabId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!collabId) return;

    const channel = supabase.channel(`realtime-sync-${collabId}`);

    for (const table of WATCHED_TABLES) {
      channel.on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table },
        (payload: { table: string; eventType: string }) => {
          if (import.meta.env.DEV) {
            console.debug(`[realtime] ${payload.table} ${payload.eventType} → invalidate`);
          }
          qc.invalidateQueries();
        },
      );
    }

    channel.subscribe((status, err) => {
      if (import.meta.env.DEV) {
        console.debug(`[realtime] channel status: ${status}`, err);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [collabId, qc]);
}
