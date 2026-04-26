const cron = require('node-cron');
const supabase = require('../supabase/client');
const { sendRitual } = require('../engine');
function isTimeMatch(t, now) {
  const [h,m] = t.split(':').map(Number);
  const rMin = h*60+m, nMin = now.getHours()*60+now.getMinutes();
  return nMin >= rMin && nMin < rMin+15;
}
async function dispatchRituals() {
  const now = new Date(), dow = now.getDay(), isWeekend = dow===0||dow===6;
  const { data: collabs } = await supabase.from('collaborators').select('id,full_name,user_preferences(*)').eq('is_active',true).eq('onboarding_completed',true);
  if (!collabs?.length) return;
  for (const c of collabs) {
    const p = c.user_preferences;
    if (!p) continue;
    try {
      const today = now.toISOString().split('T')[0];
      const sent = async (type) => { const {data} = await supabase.from('ritual_logs').select('id').eq('collaborator_id',c.id).eq('ritual_type',type).eq('reference_date',today).limit(1); return !!(data?.length); };
      if (!isWeekend && isTimeMatch(p.briefing_time,now) && !await sent('daily_briefing')) await sendRitual(c.id,'daily_briefing');
      if (!isWeekend && isTimeMatch(p.closing_time,now) && !await sent('daily_closing')) await sendRitual(c.id,'daily_closing');
      if (now.getDay()===p.planning_day && isTimeMatch(p.planning_time,now) && !await sent('weekly_planning')) await sendRitual(c.id,'weekly_planning');
    } catch(err) { console.error('[Cron] Erro pra',c.full_name,':',err.message); }
  }
}
function startCrons() {
  cron.schedule('*/15 * * * *', async () => { try { await dispatchRituals(); } catch(e) { console.error('[Cron]',e.message); } });
  console.log('⏰ Crons iniciados');
}
module.exports = { startCrons };
