const { createClient } = require('@supabase/supabase-js');

const url = process.env.LA_REPORT_SUPABASE_URL;
const key = process.env.LA_REPORT_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[la-report-client] credenciais LA Report ausentes — feature inventário desabilitada');
}

const laReportClient = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-key',
  {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  }
);

function isLaReportConfigured() {
  return !!(url && key);
}

module.exports = { laReportClient, isLaReportConfigured };
