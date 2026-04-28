import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surface the misconfig early in dev; in prod the build would already inject these.
  console.warn('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. App will run in mock mode.');
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const supabaseConfigured = Boolean(url && anonKey);
