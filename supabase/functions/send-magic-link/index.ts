// send-magic-link v8 — autenticação via WhatsApp OTP
//
// Sprint 29 — Fix definitivo de phone matching.
// Antes: usuária digitava "21960160852" mas banco tinha "5521960160852"
// → busca falhava silenciosamente e o front mostrava "não consegui enviar".
//
// Agora: gera VARIANTES do número (com/sem 55, com/sem 9 do celular) e busca
// usando `phone=in.(v1,v2,...)`. Match na primeira variante encontrada.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function err(data: unknown, status: number) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/**
 * Gera variantes BR do número pra cobrir todas as formas de cadastro/digitação:
 *   - com/sem 55 (código país)
 *   - com/sem 9 no celular (padrão antigo vs novo)
 * Exemplo:
 *   input "21960160852" → ["21960160852", "5521960160852", "2160160852", "552160160852"]
 *   input "5521960160852" → ["5521960160852", "21960160852", "552160160852", "2160160852"]
 */
function phoneVariants(input: string): string[] {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits || digits.length < 8) return digits ? [digits] : [];

  const variants = new Set<string>();
  variants.add(digits);

  // Versão sem prefixo 55 (se tiver)
  let local = digits;
  if (local.startsWith('55') && local.length >= 12) {
    local = local.slice(2);
    variants.add(local);
  }

  // Versão com prefixo 55 (se não tiver)
  if (!digits.startsWith('55')) {
    variants.add('55' + digits);
  }

  // Celular BR: DDD (2 dígitos) + 9 + 8 dígitos = 11 dígitos local
  //              ou DDD + 8 dígitos = 10 dígitos (padrão antigo)
  if (local.length === 11 && local[2] === '9') {
    // Remove o 9 → 10 dígitos (padrão antigo)
    const without9 = local.slice(0, 2) + local.slice(3);
    variants.add(without9);
    variants.add('55' + without9);
  } else if (local.length === 10) {
    // Adiciona o 9 → 11 dígitos (padrão novo)
    const with9 = local.slice(0, 2) + '9' + local.slice(2);
    variants.add(with9);
    variants.add('55' + with9);
  }

  return Array.from(variants).filter(v => v.length >= 8);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SB_URL   = Deno.env.get('SUPABASE_URL')!;
    const SB_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const WA_URL   = Deno.env.get('UAZAPI_URL')   || 'https://lamusic.uazapi.com';
    const WA_TOKEN = Deno.env.get('UAZAPI_TOKEN') || 'cfbb6715-3814-4b77-8270-8bbd07abf42e';
    const H = { 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY, 'Content-Type': 'application/json' };

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return err({ error: 'invalid_json' }, 400); }

    const phoneInput = String(body.phone || '').replace(/\D/g, '');
    if (!phoneInput) return err({ error: 'phone_required' }, 400);
    if (phoneInput.length < 10) return err({ error: 'phone_invalid' }, 400);

    // Sprint 29 — busca por variantes pra cobrir com/sem 55 e com/sem 9
    const variants = phoneVariants(phoneInput);
    console.log(`[send-magic-link] input="${phoneInput}" variants=${variants.join(',')}`);
    const inClause = variants.map(v => encodeURIComponent(v)).join(',');

    // 1. Busca colaborador por qualquer variante
    const cr = await fetch(`${SB_URL}/rest/v1/collaborators?phone=in.(${inClause})&select=id,full_name,preferred_name,email,phone&is_active=eq.true&limit=1`, { headers: H });
    if (!cr.ok) {
      console.error('[send-magic-link] collab lookup failed:', cr.status, await cr.text());
      return err({ error: 'lookup_failed' }, 502);
    }
    const collabs = await cr.json();
    if (!collabs.length) {
      console.log(`[send-magic-link] unknown — no collab for variants=${variants.join(',')}`);
      return ok({ ok: false, unknown: true });
    }
    const collab = collabs[0];
    const canonicalPhone: string = collab.phone;  // usa o phone exato do banco
    console.log(`[send-magic-link] matched collab=${collab.id} canonical_phone=${canonicalPhone}`);

    const firstName: string = collab.preferred_name || String(collab.full_name).split(' ')[0];

    // 2. Resolve email
    let email: string = collab.email || '';
    if (!email || email.endsWith('.local')) {
      email = `${canonicalPhone}@la.internal`;
      await fetch(`${SB_URL}/rest/v1/collaborators?id=eq.${collab.id}`, {
        method: 'PATCH',
        headers: H,
        body: JSON.stringify({ email }),
      });
      await fetch(`${SB_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: collab.full_name } }),
      });
    }

    // 3. Gera OTP
    const glRes = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ type: 'magiclink', email }),
    });
    if (!glRes.ok) {
      const glText = await glRes.text();
      console.error('[send-magic-link] generate_link failed:', glRes.status, glText);
      return err({ error: 'otp_failed' }, 500);
    }
    const glData = await glRes.json();
    const otp: string = glData.email_otp || glData.properties?.email_otp;
    if (!otp) {
      console.error('[send-magic-link] email_otp missing, keys:', Object.keys(glData).join(','));
      return err({ error: 'otp_missing' }, 500);
    }

    // 4. Envia via WhatsApp (usa canonicalPhone que tem 55 + 9 corretos)
    const msg = 'Seu codigo de acesso ao LA Organizer e: *' + otp + '*\n\nValido por 1 hora.';
    const waRes = await fetch(`${WA_URL}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': WA_TOKEN },
      body: JSON.stringify({ number: canonicalPhone, text: msg, readchat: false }),
    });

    // 5. Loga
    await fetch(`${SB_URL}/rest/v1/auth_magic_codes`, {
      method: 'POST',
      headers: { ...H, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        phone: canonicalPhone,
        collaborator_id: collab.id,
        email,
        ip_hint: req.headers.get('x-forwarded-for') || '',
        user_agent: req.headers.get('user-agent') || '',
        status: waRes.ok ? 'sent' : 'failed',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }),
    });

    if (!waRes.ok) {
      const waText = await waRes.text();
      console.error('[send-magic-link] uazapi failed:', waRes.status, waText.slice(0, 200));
      return err({ error: 'uazapi_failed' }, 502);
    }

    const masked = canonicalPhone.slice(0, 4) + 'xxxxxxx' + canonicalPhone.slice(-2);
    return ok({ ok: true, email, masked_phone: masked, first_name: firstName });

  } catch (e) {
    console.error('[send-magic-link] unhandled:', e);
    return err({ error: 'internal_error', msg: String(e) }, 500);
  }
});
