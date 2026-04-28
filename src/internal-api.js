// src/internal-api.js — Sprint 8 Etapa 4
// Endpoint interno chamado pelo PWA imediatamente após INSERT em projects.
// Faz bootstrap operacional do projeto:
//   1. Vincula criador como owner em project_members (idempotente)
//   2. Cria 1 checkpoint inicial "Definir primeiros passos" se nenhum existe
//   3. Manda WhatsApp pro criador (mensagem varia por requires_approval)
//   4. Se requires_approval=true: WhatsApp pro supervisor com identificador
//      explícito (APROVA / REJEITA <TOKEN>) — skill aprovar-projeto consome.
//   5. Loga marker_logs PROJECT_BOOTSTRAPPED com raw=project_id (idempotência).
//
// Auth: header x-internal-secret. Em dev é aceitável; produção idealmente
// migra pra validação de JWT do Supabase. Documentado em docs/PROJECT-WIZARD.md.
const express = require('express');
const supabase = require('./supabase/client');
const whatsapp = require('./services/whatsapp');

const router = express.Router();

const STOPWORDS = new Set([
  'LA','DA','DE','DO','DOS','DAS','O','A','OS','AS','UM','UMA',
  'NO','NA','EM','COM','PARA','POR','E','OU','SEM','SOB','PELO','PELA',
]);

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function extractApprovalToken(name) {
  const upper = stripDiacritics(name).toUpperCase();
  const words = upper.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const cleaned = w.replace(/[^A-Z0-9]/g, '');
    if (cleaned.length >= 3 && !STOPWORDS.has(cleaned)) return cleaned;
  }
  return (words[0] || '').replace(/[^A-Z0-9]/g, '') || 'PROJETO';
}

const CATEGORY_LABELS = {
  pedagogical: 'Pedagógico', commercial: 'Comercial', administrative: 'Administrativo',
  operational: 'Operacional', event: 'Evento', infrastructure: 'Infraestrutura',
};

const LOCATION_LABELS = {
  campo_grande: 'Campo Grande', recreio: 'Recreio', barra: 'Barra',
  online: 'Online', outro: 'Outro',
};

function ddmm(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function ddmmyyyy(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

async function logBootstrap(collabId, projectId, result, reason = null) {
  try {
    await supabase.from('marker_logs').insert({
      collaborator_id: collabId,
      marker_type: 'PROJECT_BOOTSTRAPPED',
      result,
      reason: reason ? String(reason).slice(0, 300) : null,
      raw_excerpt: String(projectId).slice(0, 500),
    });
  } catch (e) {
    console.error(`[InternalAPI] logBootstrap failed: ${e.message}`);
  }
}

function requireInternalSecret(req, res, next) {
  const expected = process.env.INTERNAL_API_SECRET;
  const got = req.get('x-internal-secret');
  if (!expected) {
    console.warn('[InternalAPI] INTERNAL_API_SECRET not configured — rejecting');
    return res.status(503).json({ error: 'internal_api_disabled' });
  }
  if (!got || got !== expected) {
    console.warn(`[InternalAPI] auth fail — header_present=${!!got}`);
    return res.status(401).json({ error: 'invalid_internal_secret' });
  }
  next();
}

router.post('/internal/project-created', requireInternalSecret, async (req, res) => {
  const t0 = Date.now();
  const projectId = String(req.body?.project_id || '').trim();
  if (!projectId) return res.status(400).json({ error: 'missing_project_id' });

  // Idempotência: PROJECT_BOOTSTRAPPED com raw=project_id e result='executed'
  const { data: prior } = await supabase
    .from('marker_logs')
    .select('id')
    .eq('marker_type', 'PROJECT_BOOTSTRAPPED')
    .eq('result', 'executed')
    .eq('raw_excerpt', projectId)
    .limit(1);
  if (prior && prior.length > 0) {
    console.log(`[InternalAPI] PROJECT_BOOTSTRAPPED já existe para ${projectId} — skip`);
    return res.json({ status: 'already_processed', project_id: projectId });
  }

  // Carrega projeto
  const { data: project, error: pErr } = await supabase
    .from('projects')
    .select('id, name, justification, location, start_date, end_date, category, status, requires_approval, created_by')
    .eq('id', projectId)
    .single();
  if (pErr || !project) {
    console.error(`[InternalAPI] project not found: ${projectId} err=${pErr?.message}`);
    return res.status(404).json({ error: 'project_not_found' });
  }

  // Carrega criador
  const { data: creator } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role')
    .eq('id', project.created_by)
    .single();
  if (!creator) {
    console.error(`[InternalAPI] creator not found: ${project.created_by}`);
    await logBootstrap(null, projectId, 'rejected', 'creator_not_found');
    return res.status(500).json({ error: 'creator_not_found' });
  }

  // 1) project_members: vincula criador como owner se ainda não estiver
  const { data: existingMem } = await supabase
    .from('project_members')
    .select('id')
    .eq('project_id', project.id)
    .eq('collaborator_id', creator.id)
    .limit(1);
  if (!existingMem || existingMem.length === 0) {
    const { error: mErr } = await supabase.from('project_members').insert({
      project_id: project.id,
      collaborator_id: creator.id,
      role_in_project: 'owner',
    });
    if (mErr) console.error(`[InternalAPI] project_members insert err: ${mErr.message}`);
  }

  // 2) project_checkpoints: cria 1 inicial se nenhum existe
  const { data: existingCk } = await supabase
    .from('project_checkpoints')
    .select('id')
    .eq('project_id', project.id)
    .limit(1);
  if (!existingCk || existingCk.length === 0) {
    const { error: ckErr } = await supabase.from('project_checkpoints').insert({
      project_id: project.id,
      name: 'Definir primeiros passos',
      description: 'Mapear tarefas iniciais e responsáveis pra começar a execução.',
      due_date: project.start_date,
      status: 'pending',
      sort_order: 0,
    });
    if (ckErr) console.error(`[InternalAPI] project_checkpoints insert err: ${ckErr.message}`);
  }

  // Helpers de mensagem
  const local = LOCATION_LABELS[project.location] || project.location || '—';
  const cat = CATEGORY_LABELS[project.category] || project.category;
  const periodo = `${ddmm(project.start_date)} → ${ddmmyyyy(project.end_date)}`;

  // 3) WhatsApp pro criador (fire-and-forget)
  if (creator.phone) {
    let creatorMsg;
    if (project.requires_approval) {
      creatorMsg =
        `✅ Recebi seu projeto *${project.name}*.\n\n` +
        `Mandei pra aprovação. Te aviso assim que sair o ok.`;
    } else {
      creatorMsg =
        `✅ *${project.name}* criado!\n\n` +
        `📍 ${local}\n🗓️ ${periodo}\n🏷️ ${cat}\n\n` +
        `Bora estruturar — vou começar a montar os checkpoints.`;
    }
    whatsapp.sendMessage(creator.phone, creatorMsg).catch(e =>
      console.error(`[InternalAPI] WA criador falhou: ${e.message}`));
  } else {
    console.warn(`[InternalAPI] criador sem phone: ${creator.id}`);
  }

  // 4) WhatsApp pro supervisor (se requires_approval)
  if (project.requires_approval) {
    const { data: supervisors } = await supabase
      .from('collaborators')
      .select('id, full_name, phone, role')
      .in('role', ['coordinator', 'director'])
      .eq('is_active', true)
      .neq('id', creator.id)
      .order('role', { ascending: true });
    const supervisor = (supervisors || [])[0] || null;
    if (supervisor && supervisor.phone) {
      const token = extractApprovalToken(project.name);
      const supMsg =
        `*${creator.full_name}* criou um projeto novo:\n\n` +
        `🗂️ *${project.name}*\n` +
        `🎯 ${project.justification || '—'}\n` +
        `📍 ${local} · ${periodo}\n\n` +
        `Pra aprovar, responde: *APROVA ${token}*\n` +
        `Pra rejeitar, responde: *REJEITA ${token} motivo*`;
      whatsapp.sendMessage(supervisor.phone, supMsg).catch(e =>
        console.error(`[InternalAPI] WA supervisor falhou: ${e.message}`));
    } else {
      console.warn(`[InternalAPI] supervisor não encontrado pra projeto ${projectId}`);
    }
  }

  // 5) Marker_logs PROJECT_BOOTSTRAPPED (idempotência futura)
  await logBootstrap(creator.id, projectId, 'executed', `name:${project.name} approval:${project.requires_approval}`);

  console.log(`[InternalAPI] project ${projectId} bootstrap OK in ${Date.now() - t0}ms (approval=${project.requires_approval})`);
  return res.json({ status: 'ok', project_id: projectId });
});

module.exports = router;
