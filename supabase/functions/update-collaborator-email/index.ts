import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user?.email) return json({ ok: false, error: 'unauthorized' }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: caller } = await adminClient
      .from('collaborators')
      .select('role, is_active')
      .eq('email', user.email!)
      .maybeSingle();

    if (!caller?.is_active || !['director', 'coordinator', 'manager'].includes(caller.role)) {
      return json({ ok: false, error: 'role_not_allowed' }, 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }

    const { collaborator_id, new_email } = body;
    if (!collaborator_id || !new_email) {
      return json({ ok: false, error: 'missing_required_fields' }, 400);
    }

    const cleanEmail = String(new_email).trim().toLowerCase();

    const { error: authErr } = await adminClient.auth.admin.updateUserById(
      String(collaborator_id),
      { email: cleanEmail, email_confirm: true },
    );
    if (authErr) {
      const errMsg = authErr.message?.toLowerCase() ?? '';
      if (
        errMsg.includes('already registered') ||
        errMsg.includes('already exists') ||
        errMsg.includes('email_exists')
      ) {
        return json({ ok: false, error: 'email_already_exists' }, 409);
      }
      throw authErr;
    }

    return json({ ok: true });

  } catch (err) {
    console.error('[update-collaborator-email]', err);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});
