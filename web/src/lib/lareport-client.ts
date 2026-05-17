// _remote/web/src/lib/lareport-client.ts
// Cliente Supabase direto ao LA Report — usado para leituras e realtime.
// Para escritas, usar fetch em /api/lareport/... (Vercel serverless).

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_LA_REPORT_URL;
const anon = import.meta.env.VITE_LA_REPORT_ANON_KEY;

if (!url || !anon) {
  console.warn('[lareport-client] VITE_LA_REPORT_URL ou VITE_LA_REPORT_ANON_KEY não definidos. Reads do LA Report vão falhar.');
}

// Placeholders evitam exception sincronica em createClient quando env vazia.
// Uso real depende de `isLaReportConfigured` — hooks gateam via useAccess + enabled.
export const laReportClient = createClient(
  url || 'https://placeholder.supabase.co',
  anon || 'placeholder-anon-key',
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 5 } },
  }
);

export const isLaReportConfigured = Boolean(url && anon);
