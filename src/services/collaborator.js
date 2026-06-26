const supabase = require('../supabase/client');
const { brPhoneVariants, digitsOnly } = require('../utils/phone');

// PHONE-9DIGIT-LOOKUP (Vitória 24/06): a JID do WhatsApp BR varia no 9º dígito.
// Casa qualquer forma equivalente (com/sem o 9), em vez de match exato.
async function findByPhone(phone) {
  const variants = brPhoneVariants(phone);
  if (!variants.length) return null;
  const { data } = await supabase
    .from('collaborators')
    .select('*, user_preferences(*), collaborator_profiles(*)')
    .in('phone', variants)
    .eq('is_active', true);
  if (!data || !data.length) return null;
  if (data.length === 1) return data[0];
  // múltiplos (raro): prefere o match exato da forma recebida
  const exact = digitsOnly(phone);
  return data.find((c) => digitsOnly(c.phone) === exact) || data[0];
}
module.exports = { findByPhone };
