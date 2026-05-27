// Edge Function: send-onboarding-message
// Dispara mensagem proativa do TOM para o colaborador que acabou de tocar
// em "Falar com o TOM agora" no wizard PWA.
// Chamada via: supabase.functions.invoke('send-onboarding-message')
// Env vars necessárias no Supabase Dashboard → Settings → Edge Functions:
//   UAZAPI_URL   — ex: https://lamusic.uazapi.com
//   UAZAPI_TOKEN — token da instância

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const uazapiUrl   = Deno.env.get('UAZAPI_URL')!;
  const uazapiToken = Deno.env.get('UAZAPI_TOKEN')!;

  // Identifica o usuário pelo JWT
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  // Busca dados do colaborador (phone + nome)
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: collab, error: collabErr } = await adminClient
    .from('collaborators')
    .select('phone, full_name, preferred_name, function_title, role')
    .eq('email', user.email!)
    .single();

  if (collabErr || !collab) return json({ error: 'collaborator_not_found' }, 404);
  if (!collab.phone) return json({ error: 'no_phone' }, 400);

  // Nome de tratamento
  const name =
    (collab.preferred_name as string | null) ??
    ((collab.full_name as string).split(' ')[0]);

  // Mensagem de boas-vindas proativa
  const msg =
    `👽 *Oi, ${name}! Aqui é o TOM* — seu assistente operacional da LA Music.\n\n` +
    `Tô aqui pra te ajudar em duas frentes:\n\n` +
    `💼 *Trabalho* — tarefas, projetos, agenda e checklists\n` +
    `🏡 *Vida pessoal* — hábitos, lembretes e organização particular _(fica só entre a gente)_\n\n` +
    `📲 Salva meu contato como *TOM - LA* pra me achar fácil.\n\n` +
    `Antes de começar, quero entender como você prefere trabalhar. *São só 5 perguntinhas rápidas — pode ser?*`;

  // Envia via UZapi (mesmo formato de src/services/whatsapp.js)
  const waRes = await fetch(`${uazapiUrl}/send/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: uazapiToken,
    },
    body: JSON.stringify({
      number: collab.phone as string,
      text: msg,
      readchat: true,
    }),
  });

  if (!waRes.ok) {
    const errBody = await waRes.text().catch(() => '');
    console.error('[send-onboarding-message] UZapi error:', waRes.status, errBody);
    return json({ error: 'whatsapp_failed' }, 500);
  }

  return json({ ok: true });
});
