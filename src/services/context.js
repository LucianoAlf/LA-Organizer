const fs = require('fs'), path = require('path');
const supabase = require('../supabase/client');
let soulCache = null, agentsCache = null;
function loadSoul() { if (!soulCache) soulCache = fs.readFileSync(path.join(__dirname,'../../soul/SOUL.md'),'utf-8'); return soulCache; }
function loadSkill(name) { const p = path.join(__dirname,'../../skills',name+'.md'); return fs.existsSync(p) ? fs.readFileSync(p,'utf-8') : null; }
async function buildContext(collaborator, opts = {}) {
  const id = collaborator.id;
  const today = new Date().toISOString().split('T')[0];
  const [memories, msgs, tasks, projects] = await Promise.all([
    supabase.from('collaborator_memory').select('content,memory_type,importance').eq('collaborator_id',id).eq('is_active',true).order('importance').limit(10).then(r=>r.data||[]),
    supabase.from('conversation_history').select('direction,content,created_at').eq('collaborator_id',id).order('created_at',{ascending:false}).limit(20).then(r=>(r.data||[]).reverse()),
    supabase.from('tasks').select('title,status,priority,eisenhower_quadrant,due_date,context').eq('assigned_to',id).in('status',['pending','in_progress','overdue']).order('eisenhower_quadrant').then(r=>r.data||[]),
    supabase.from('project_members').select('project_id,role_in_project').eq('collaborator_id',id).then(async r => {
      if (!r.data?.length) return [];
      const ids = r.data.map(m=>m.project_id);
      const {data} = await supabase.from('projects').select('name,status,progress_percent,end_date').in('id',ids).in('status',['planning','active']);
      return data||[];
    }),
  ]);
  return { soul: loadSoul(), memories, recentMessages: msgs, todayTasks: tasks, activeProjects: projects, skill: opts.skillName ? loadSkill(opts.skillName) : null, collaborator };
}
module.exports = { buildContext };
