import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLE_RANK: Record<string, number> = {
  collaborator: 0,
  leader: 1,
  coordinator: 2,
  manager: 3,
  director: 4,
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

    // Verificar identidade do chamador via JWT
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user?.email) return json({ ok: false, error: 'unauthorized' }, 401);

    // Client com service_role para operações privilegiadas
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Buscar role do chamador na tabela collaborators
    const { data: caller } = await adminClient
      .from('collaborators')
      .select('role, is_active')
      .eq('id', user.id)
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
    const { full_name, phone, email, function_title, role, unit } = body;

    if (!full_name || !phone || !email) {
      return json({ ok: false, error: 'missing_required_fields' }, 400);
    }
    if (!role || ROLE_RANK[role] === undefined) {
      return json({ ok: false, error: 'invalid_role' }, 400);
    }
    // Chamador não pode criar role superior ao seu
    if (ROLE_RANK[role] > ROLE_RANK[caller.role]) {
      return json({ ok: false, error: 'role_not_allowed' }, 403);
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return json({ ok: false, error: 'invalid_phone' }, 400);
    }
    const cleanEmail = String(email).trim().toLowerCase();

    // 1. Criar usuário no Supabase Auth
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (authErr) {
      const errMsg = authErr.message?.toLowerCase() ?? '';
      if (authErr.status === 422 || errMsg.includes('already registered') || errMsg.includes('already exists') || errMsg.includes('email_exists')) {
        return json({ ok: false, error: 'email_already_exists' }, 409);
      }
      throw authErr;
    }

    // 2. Inserir na tabela collaborators
    const { error: collabErr } = await adminClient.from('collaborators').insert({
      id: authData.user.id,
      full_name: String(full_name).trim(),
      phone: cleanPhone,
      email: cleanEmail,
      function_title: function_title ? String(function_title).trim() : null,
      role,
      unit: unit || null,
      is_active: true,
      onboarding_completed: false,
    });
    if (collabErr) {
      // Rollback: remover auth user criado
      const { error: rollbackErr } = await adminClient.auth.admin.deleteUser(authData.user.id);
      if (rollbackErr) {
        console.error('[admin-create-collaborator] rollback failed — orphan auth user:', authData.user.id, rollbackErr.message);
      }
      throw collabErr;
    }

    // 3. Disparar magic link pelo WhatsApp
    const { error: waErr } = await adminClient.functions.invoke('send-magic-link', {
      body: { phone: cleanPhone },
    });

    return json({
      ok: true,
      collaborator_id: authData.user.id,
      whatsapp_sent: !waErr,
    });

  } catch (err) {
    console.error('[admin-create-collaborator]', err);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});
