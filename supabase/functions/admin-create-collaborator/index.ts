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

    // Buscar role do chamador na tabela collaborators (por email — mais robusto que id)
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
      onboarding_completed: true, // Admin já apresentou o TOM via WhatsApp — wizard não é necessário
    });
    if (collabErr) {
      console.error('[admin-create-collaborator] INSERT collaborators failed — code:', (collabErr as any).code, 'constraint:', (collabErr as any).details, 'message:', collabErr.message);
      // Rollback: remover auth user criado
      const { error: rollbackErr } = await adminClient.auth.admin.deleteUser(authData.user.id);
      if (rollbackErr) {
        console.error('[admin-create-collaborator] rollback failed — orphan auth user:', authData.user.id, rollbackErr.message);
      }
      throw collabErr;
    }

    // 3. Apresentar TOM ao novo colaborador via WhatsApp
    const firstName = String(full_name).trim().split(' ')[0];
    const uazapiUrl   = Deno.env.get('UAZAPI_URL')   || 'https://lamusic.uazapi.com';
    const uazapiToken = Deno.env.get('UAZAPI_TOKEN') || 'cfbb6715-3814-4b77-8270-8bbd07abf42e';

    // Sprint 23.6 — URL em linha própria (sem emoji prefix nem texto na MESMA linha).
    // Bug: WhatsApp não auto-linka quando URL vem grudada em emoji/texto.
    // Fix: linha 1 "Acessa o link abaixo:" + linha 2 URL crua → linkify garantido.
    const welcomeMsg =
      `👽 Oi, ${firstName}! Aqui é o TOM — assistente operacional da LA Music.\n\n` +
      `Você acabou de ser cadastrado no *LA Organizer*, o sistema de organização da equipe! 🎉\n\n` +
      `Tô aqui pra te ajudar no dia a dia: tarefas, agenda, projetos e checklists. E também pra organizar sua vida pessoal 🤐 — hábitos, lembretes particulares, o que você quiser.\n\n` +
      `Para acessar o app, instala no seu celular:\n\n` +
      `1. Acessa o link abaixo:\n` +
      `https://la-organizer.vercel.app\n\n` +
      `2. Toca nos *3 pontinhos* (⋮) do Chrome\n` +
      `3. Escolhe *"Adicionar à tela inicial"*\n\n` +
      `💡 Qualquer dúvida, é só me mandar *ajuda* aqui que eu te mostro tudo! 😉`;

    const waRes = await fetch(`${uazapiUrl}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: uazapiToken },
      body: JSON.stringify({ number: cleanPhone, text: welcomeMsg, readchat: true }),
    });

    return json({
      ok: true,
      collaborator_id: authData.user.id,
      whatsapp_sent: waRes.ok,
    });

  } catch (err) {
    console.error('[admin-create-collaborator]', err);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
});
