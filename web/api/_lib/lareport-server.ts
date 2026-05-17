import { createClient } from '@supabase/supabase-js';

const url = process.env.LA_REPORT_URL || 'https://ouqwbbermlzqqvtqwlul.supabase.co';
const key = process.env.LA_REPORT_SERVICE_ROLE_KEY!;

export const lareport = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
