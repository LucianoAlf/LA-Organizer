const supabase = require('../supabase/client');
async function findByPhone(phone) {
  const normalized = phone.replace(/[\s\-\+]/g, '');
  const { data } = await supabase
    .from('collaborators')
    .select('*, user_preferences(*), collaborator_profiles(*)')
    .eq('phone', normalized)
    .eq('is_active', true)
    .single();
  return data || null;
}
module.exports = { findByPhone };
