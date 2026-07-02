// src/internal-api.js — Sprint 8 Etapa 4 + Sprint 9 Etapa 1
// Endpoint interno chamado pelo PWA imediatamente após INSERT em projects.
// Faz bootstrap operacional do projeto:
//   1. Vincula criador como owner em project_members (idempotente)
//   2. Sprint 9: gera 3-6 etapas contextuais via Claude. Fallback determinístico
//      por categoria se LLM falhar/timeout/output inválido.
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
const ai = require('./ai/provider');
const claude = require('./ai/claude');
const { validateFormatRequest, systemPromptFor } = require('./services/format-note');
const inventarioService = require('./services/inventario-service');
const { PRESETS: GROUP_REPORT_PRESETS, buildPresetPreview, sendPresetNow } = require('./rituals/group-reports');
const { buildCobrancaMessage } = require('./services/cobranca');

const router = express.Router();

// Sprint 22.34g — CORS para /internal/* (browser cross-origin do localhost e Vercel).
// Auth continua via x-internal-secret; CORS apenas abre o canal no browser.
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-secret');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const STOPWORDS = new Set([
  'LA','DA','DE','DO','DOS','DAS','O','A','OS','AS','UM','UMA',
  'NO','NA','EM','COM','PARA','POR','E','OU','SEM','SOB','PELO','PELA',
]);

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function extractApprovalTokenBase(name) {
  const upper = stripDiacritics(name).toUpperCase();
  const words = upper.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const cleaned = w.replace(/[^A-Z0-9]/g, '');
    if (cleaned.length >= 3 && !STOPWORDS.has(cleaned)) return cleaned;
  }
  return (words[0] || '').replace(/[^A-Z0-9]/g, '') || 'PROJETO';
}

function extractApprovalToken(name, id) {
  const base = extractApprovalTokenBase(name);
  if (!id) return base;
  const suffix = String(id).replace(/-/g, '').slice(0, 4).toUpperCase();
  return suffix ? `${base}-${suffix}` : base;
}

// Versão async: omite o sufixo -XXXX quando não há ambiguidade
// (zero ou um único pending com a mesma base). Só usa sufixo quando há colisão.
async function extractApprovalTokenSmart(name, id) {
  const base = extractApprovalTokenBase(name);
  if (!id) return base;
  try {
    const { data: pendings } = await supabase
      .from('projects')
      .select('id, name')
      .eq('status', 'pending_approval')
      .eq('requires_approval', true);
    const collisions = (pendings || []).filter(p =>
      p.id !== id && extractApprovalTokenBase(p.name) === base
    );
    if (collisions.length === 0) return base;
  } catch (err) {
    console.warn('[InternalAPI] extractApprovalTokenSmart fallback:', err.message);
  }
  const suffix = String(id).replace(/-/g, '').slice(0, 4).toUpperCase();
  return suffix ? `${base}-${suffix}` : base;
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

// ---------- Sprint 9: geração de etapas (checkpoints) ----------
// Templates fallback por categoria. Acionados se LLM timeout/inválido.
const FALLBACK_TEMPLATES = {
  event: ['Repertório e formato', 'Logística e local', 'Comunicação', 'Ensaio geral', 'Dia do evento'],
  pedagogical: ['Planejamento', 'Preparação de material', 'Execução', 'Avaliação'],
  commercial: ['Prospecção', 'Proposta', 'Negociação', 'Fechamento'],
  administrative: ['Alinhamento', 'Execução', 'Revisão e entrega'],
  operational: ['Planejamento', 'Implementação', 'Verificação', 'Conclusão'],
  infrastructure: ['Levantamento', 'Execução', 'Testes', 'Entrega'],
};

// Distribui N datas proporcionalmente entre start e end (inclusivo no end).
function distributeDates(startISO, endISO, n) {
  const startMs = new Date(startISO + 'T12:00:00Z').getTime();
  const endMs = new Date(endISO + 'T12:00:00Z').getTime();
  if (endMs < startMs || n < 1) return [endISO];
  const dates = [];
  for (let i = 1; i <= n; i++) {
    const t = startMs + Math.round((i / n) * (endMs - startMs));
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  // Garante que último é exatamente endISO.
  dates[dates.length - 1] = endISO;
  return dates;
}

function targetCheckpointCount(startISO, endISO) {
  const startMs = new Date(startISO + 'T12:00:00Z').getTime();
  const endMs = new Date(endISO + 'T12:00:00Z').getTime();
  const days = Math.max(0, Math.round((endMs - startMs) / 86400000));
  if (days < 7) return 3;
  if (days <= 30) return 5;
  return 6;
}

function fallbackCheckpoints(project) {
  const template = FALLBACK_TEMPLATES[project.category] || FALLBACK_TEMPLATES.operational;
  const dates = distributeDates(project.start_date, project.end_date, template.length);
  return template.map((name, i) => ({ name, due_date: dates[i] }));
}

function isValidCheckpointArray(arr, project) {
  if (!Array.isArray(arr) || arr.length < 3 || arr.length > 6) return false;
  const startMs = new Date(project.start_date + 'T00:00:00Z').getTime();
  const endMs = new Date(project.end_date + 'T23:59:59Z').getTime();
  for (const c of arr) {
    if (!c || typeof c !== 'object') return false;
    if (typeof c.name !== 'string') return false;
    const n = c.name.trim();
    if (n.length < 3 || n.length > 80) return false;
    if (typeof c.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.due_date)) return false;
    const t = new Date(c.due_date + 'T12:00:00Z').getTime();
    if (Number.isNaN(t) || t < startMs || t > endMs) return false;
  }
  return true;
}

// Tenta gerar checkpoints via Claude. Retorna array válido ou null.
async function generateCheckpointsViaLLM(project) {
  const targetN = targetCheckpointCount(project.start_date, project.end_date);
  const systemPrompt = [
    'Você gera etapas iniciais para um projeto. Sua resposta é APENAS um JSON array, sem texto antes ou depois, sem markdown, sem explicação.',
    '',
    'Formato exato:',
    '[',
    '  {"name": "Nome curto da etapa", "due_date": "YYYY-MM-DD"},',
    '  ...',
    ']',
    '',
    'Regras inflexíveis:',
    `- Quantidade: ${targetN} etapas (entre 3 e 6, baseado na janela do projeto).`,
    '- Linguagem humana, simples, do dia-a-dia. Sem jargão técnico (nada de "milestone", "sprint", "framework", "roadmap", "5W2H").',
    '- Cada nome: 3 a 80 caracteres. Descritivo e acionável.',
    `- Toda due_date entre ${project.start_date} e ${project.end_date} (formato ISO YYYY-MM-DD).`,
    `- Última etapa SEMPRE com due_date = ${project.end_date}.`,
    '- Distribua as etapas proporcionalmente na janela. Não bote todas no mesmo dia.',
    '- Etapas devem fazer sentido pelo nome do projeto e categoria, não ser genéricas.',
    '- Pra projetos pessoais (festa, viagem, aniversário, casa), adapte: lista de convidados, fornecedores, confirmações, dia final, etc.',
    '',
    'Não saia desse formato. Não adicione campos extras. Sem comentários no JSON.',
  ].join('\n');

  const userMsg = [
    'Contexto do projeto:',
    `- Nome: ${project.name}`,
    `- Por que existe: ${project.justification || '—'}`,
    `- Categoria: ${project.category}`,
    `- Janela: ${project.start_date} → ${project.end_date}`,
    `- Como executar: ${project.methodology || '—'}`,
    `- Quem participa: ${project.description || '—'}`,
    '',
    `Gere ${targetN} etapas.`,
  ].join('\n');

  const TIMEOUT_MS = 10000;
  const aiPromise = ai.chat(systemPrompt, [{ role: 'user', content: userMsg }], 800);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('llm_timeout_10s')), TIMEOUT_MS),
  );

  let raw;
  try {
    const r = await Promise.race([aiPromise, timeoutPromise]);
    raw = (r && r.text ? r.text : '').trim();
  } catch (err) {
    console.warn(`[Checkpoints] LLM falhou: ${err.message?.slice(0, 200)}`);
    return null;
  }

  // Tenta extrair o JSON array. Claude às vezes envolve em markdown.
  const m = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!m) {
    console.warn(`[Checkpoints] LLM output sem JSON array: ${raw.slice(0, 200)}`);
    return null;
  }
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch (err) {
    console.warn(`[Checkpoints] LLM JSON inválido: ${err.message}`);
    return null;
  }
  if (!isValidCheckpointArray(parsed, project)) {
    console.warn(`[Checkpoints] LLM array fora do schema: ${JSON.stringify(parsed).slice(0, 300)}`);
    return null;
  }
  // Garante último = end_date (LLM pode ter dado dia anterior).
  parsed[parsed.length - 1].due_date = project.end_date;
  return parsed;
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
    console.warn(`[InternalAPI] auth fail — header_present=${!!got} method=${req.method} url=${req.originalUrl} ua=${req.get('user-agent') || '-'}`);
    return res.status(401).json({ error: 'invalid_internal_secret' });
  }
  next();
}

router.post('/internal/project-created', requireInternalSecret, async (req, res) => {
  const t0 = Date.now();
  const projectId = String(req.body?.project_id || '').trim();
  if (!projectId) return res.status(400).json({ error: 'missing_project_id' });
  // Sprint 9: member_ids opcional do PWA. Engine insere project_members + manda WA.
  const memberIds = Array.isArray(req.body?.member_ids)
    ? req.body.member_ids.filter(x => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))
    : [];

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
    if (mErr) console.error(`[InternalAPI] project_members owner insert err: ${mErr.message}`);
  }

  // 1.5) Sprint 9: project_members adicionais (member_ids[] do PWA).
  // Insere cada membro distinto do criador, idempotente, depois manda WA.
  const membersToAdd = memberIds.filter(id => id !== creator.id);
  const addedMembers = []; // pra disparar WA depois sem segurar idempotência
  if (membersToAdd.length > 0) {
    // Filtra os que já existem
    const { data: alreadyMembers } = await supabase
      .from('project_members')
      .select('collaborator_id')
      .eq('project_id', project.id)
      .in('collaborator_id', membersToAdd);
    const alreadySet = new Set((alreadyMembers || []).map(r => r.collaborator_id));
    const fresh = membersToAdd.filter(id => !alreadySet.has(id));
    if (fresh.length > 0) {
      const rows = fresh.map(cid => ({
        project_id: project.id,
        collaborator_id: cid,
        role_in_project: 'member',
      }));
      const { error: addErr } = await supabase.from('project_members').insert(rows);
      if (addErr) {
        console.error(`[InternalAPI] project_members member insert err: ${addErr.message}`);
      } else {
        addedMembers.push(...fresh);
        console.log(`[InternalAPI] +${fresh.length} membros em ${project.id}`);
      }
    }
  }

  // 2) project_checkpoints: gera etapas contextuais (Sprint 9). Se nenhum existe.
  const { data: existingCk } = await supabase
    .from('project_checkpoints')
    .select('id')
    .eq('project_id', project.id)
    .limit(1);
  if (!existingCk || existingCk.length === 0) {
    let checkpoints = null;
    let source = 'llm';
    try {
      checkpoints = await generateCheckpointsViaLLM(project);
    } catch (err) {
      console.warn(`[Checkpoints] generateCheckpointsViaLLM threw: ${err.message}`);
    }
    if (!checkpoints) {
      checkpoints = fallbackCheckpoints(project);
      source = 'fallback';
    }
    console.log(`[Checkpoints] ${source}: ${checkpoints.length} etapas pra projeto ${project.id} (${project.name})`);
    const rows = checkpoints.map((c, i) => ({
      project_id: project.id,
      name: c.name.trim(),
      due_date: c.due_date,
      status: 'pending',
      sort_order: i,
    }));
    const { error: ckErr } = await supabase.from('project_checkpoints').insert(rows);
    if (ckErr) {
      console.error(`[InternalAPI] project_checkpoints insert err: ${ckErr.message}`);
      // Última linha de defesa: se até o insert do fallback falhou, tenta 1 generic.
      await supabase.from('project_checkpoints').insert({
        project_id: project.id,
        name: 'Primeira etapa do projeto',
        due_date: project.end_date,
        status: 'pending',
        sort_order: 0,
      });
    }
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
        `Bora estruturar — já mapeei as etapas iniciais.`;
    }
    whatsapp.sendMessage(creator.phone, creatorMsg).catch(e =>
      console.error(`[InternalAPI] WA criador falhou: ${e.message}`));
  } else {
    console.warn(`[InternalAPI] criador sem phone: ${creator.id}`);
  }

  // 4) WhatsApp pro supervisor (se requires_approval)
  if (project.requires_approval) {
    // F4 (GOV-APROVADOR-DIVERGENTE): aprovador = LÍDER de quem criou, pela matriz de
    // governança. A cascata legada (supervisor_id → director ALFABÉTICO → coordinator)
    // só acertava o Alf por dado legado e, vazia, mandaria pro "Admin". supervisor_id
    // deixa de ser lido (consistente com a matriz de 08/06).
    let supervisor = null;
    try {
      const approvalsService = require('./services/approvals');
      supervisor = await approvalsService.resolveApproverFor(supabase, creator.id);
    } catch (e) { console.warn('[InternalAPI] resolveApproverFor err:', e.message); }

    if (supervisor && supervisor.phone) {
      const token = await extractApprovalTokenSmart(project.name, project.id);
      const supMsg =
        `*${creator.full_name}* criou um projeto novo:\n\n` +
        `🗂️ *${project.name}*\n` +
        `🎯 ${project.justification || '—'}\n` +
        `📍 ${local} · ${periodo}\n\n` +
        `Pra aprovar, responde: *APROVA ${token}*\n` +
        `Pra rejeitar, responde: *REJEITA ${token} motivo*`;
      whatsapp.sendMessage(supervisor.phone, supMsg).catch(e =>
        console.error(`[InternalAPI] WA supervisor falhou: ${e.message}`));
      console.log(`[InternalAPI] approval notif → ${supervisor.full_name} (${supervisor.role}) for project ${projectId}`);
      // F1 (APROVACAO-SEM-FUNIL): o pedido vira ESTADO — intent no aprovador + card no
      // histórico (reply-quote enriquece; intercept Approval-bare e prompt enxergam).
      try {
        const approvalsService = require('./services/approvals');
        await approvalsService.openProjectApproval(supabase, { approverId: supervisor.id, projectId: project.id, token });
        await supabase.from('conversation_history').insert({
          collaborator_id: supervisor.id, direction: 'outbound', message_type: 'text', content: supMsg,
        });
      } catch (e) { console.warn('[InternalAPI] approval state err:', e.message); }
    } else {
      console.warn(`[InternalAPI] supervisor não encontrado pra projeto ${projectId} (creator=${creator.full_name})`);
    }
  }

  // 4.5) Sprint 9: WhatsApp pra membros adicionados (só quando projeto já está
  // ativo — não notifica membros de pending_approval pra evitar ruído se for
  // rejeitado depois).
  if (!project.requires_approval && addedMembers.length > 0) {
    const { data: memberRecords } = await supabase
      .from('collaborators')
      .select('id, full_name, phone')
      .in('id', addedMembers);
    const memberMsg = `Você foi adicionado ao projeto *${project.name}* por *${creator.full_name}*.\n\nAcompanhe pelo app.`;
    for (const m of (memberRecords || [])) {
      if (m.phone) {
        whatsapp.sendMessage(m.phone, memberMsg).catch(e =>
          console.error(`[InternalAPI] WA membro ${m.id} falhou: ${e.message}`));
      }
    }
  }

  // 5) Marker_logs PROJECT_BOOTSTRAPPED (idempotência futura)
  await logBootstrap(creator.id, projectId, 'executed', `name:${project.name} approval:${project.requires_approval}`);

  console.log(`[InternalAPI] project ${projectId} bootstrap OK in ${Date.now() - t0}ms (approval=${project.requires_approval})`);
  return res.json({ status: 'ok', project_id: projectId });
});

// Sprint 22.22p — celebracao no TOM (WhatsApp) quando checkpoint ou projeto
// fecha. Body: { type: 'checkpoint'|'project', project_id, checkpoint_id?, actor_id }
// Idempotente via marker_logs (raw_excerpt = type:project:checkpoint).
router.post('/internal/celebration', requireInternalSecret, async (req, res) => {
  const type = String(req.body?.type || '').trim();
  const projectId = String(req.body?.project_id || '').trim();
  const checkpointId = req.body?.checkpoint_id ? String(req.body.checkpoint_id).trim() : null;
  if (!['checkpoint', 'project'].includes(type)) return res.status(400).json({ error: 'invalid_type' });
  if (!projectId) return res.status(400).json({ error: 'missing_project_id' });

  // Idempotencia: nao manda 2x pra mesma celebracao
  const dedupeKey = `${type}:${projectId}:${checkpointId || 'none'}`;
  const { data: prior } = await supabase
    .from('marker_logs')
    .select('id')
    .eq('marker_type', 'CELEBRATION')
    .eq('raw_excerpt', dedupeKey)
    .limit(1);
  if (prior && prior.length > 0) {
    return res.json({ status: 'already_celebrated', key: dedupeKey });
  }

  // Carrega projeto
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, progress_percent')
    .eq('id', projectId)
    .single();
  if (!project) return res.status(404).json({ error: 'project_not_found' });

  // Carrega members internos com phone
  const { data: members } = await supabase
    .from('project_members')
    .select('collaborator_id, role_in_project, function_in_project, collaborators(id, full_name, phone, is_active)')
    .eq('project_id', projectId);
  const internal = (members || [])
    .map(m => {
      const c = Array.isArray(m.collaborators) ? m.collaborators[0] : m.collaborators;
      return c && c.phone && c.is_active
        ? { id: c.id, name: c.full_name, phone: c.phone, role: m.role_in_project, fn: m.function_in_project }
        : null;
    })
    .filter(Boolean);

  let recipients = [];
  let body = '';

  if (type === 'checkpoint' && checkpointId) {
    const { data: cp } = await supabase
      .from('project_checkpoints')
      .select('id, name')
      .eq('id', checkpointId)
      .single();
    if (!cp) return res.status(404).json({ error: 'checkpoint_not_found' });
    // Owner + coordinators recebem
    recipients = internal.filter(m => m.role === 'owner' || m.role === 'coordinator');
    body = `🎉 *Checkpoint fechado!*\n\n*${cp.name}* — ${project.name}\n\nTime bateu. Progresso geral: *${project.progress_percent || 0}%*.`;
  } else if (type === 'project') {
    // Todo mundo
    recipients = internal;
    const namesList = internal.map(m => `• ${m.name}${m.fn ? ` (${m.fn})` : ''}`).join('\n');
    body = `🏆 *Projeto fechado, 100%!*\n\n*${project.name}*\n\nParabéns ao time:\n${namesList}\n\nMissão cumprida.`;
  }

  if (recipients.length === 0) {
    await supabase.from('marker_logs').insert({
      marker_type: 'CELEBRATION', result: 'skipped', reason: 'no_recipients', raw_excerpt: dedupeKey,
    });
    return res.json({ status: 'no_recipients', key: dedupeKey });
  }

  // Dispara em paralelo, nao espera (fire-and-forget)
  for (const r of recipients) {
    whatsapp.sendMessage(r.phone, body).catch(e =>
      console.error(`[InternalAPI] celebration WA send err pra ${r.id}: ${e.message}`),
    );
  }

  await supabase.from('marker_logs').insert({
    marker_type: 'CELEBRATION', result: 'executed',
    reason: `${type} sent to ${recipients.length}`, raw_excerpt: dedupeKey,
  });

  console.log(`[InternalAPI] celebration ${type} for ${projectId} → ${recipients.length} msgs`);
  return res.json({ status: 'ok', sent: recipients.length, key: dedupeKey });
});

// POST /internal/project-approved — chamado pelo PWA quando usuário aprova projeto via UI.
// Notifica o criador via WhatsApp (equivalente ao marker <<PROJECT_APPROVE>> do engine).
router.post('/internal/project-approved', requireInternalSecret, async (req, res) => {
  const t0 = Date.now();
  const { projectId } = req.body || {};
  if (!projectId) return res.status(400).json({ error: 'projectId required' });

  try {
    const { data: project } = await supabase
      .from('projects')
      .select('id, name, created_by, approved_by')
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return res.status(404).json({ error: 'project not found' });
    if (!project.approved_by) return res.status(400).json({ error: 'project not approved yet' });

    const { data: creator } = await supabase
      .from('collaborators')
      .select('id, full_name, phone')
      .eq('id', project.created_by)
      .maybeSingle();
    const { data: approver } = await supabase
      .from('collaborators')
      .select('full_name')
      .eq('id', project.approved_by)
      .maybeSingle();

    if (creator?.phone) {
      const msg = `🎉 *${project.name}* foi aprovado por *${approver?.full_name || 'a liderança'}*!\n\nO TOM já vai começar a estruturar e distribuir as tarefas.`;
      whatsapp.sendMessage(creator.phone, msg).catch(e =>
        console.error(`[InternalAPI] approval-notify WA falhou: ${e.message}`));
      console.log(`[InternalAPI] project-approved notif → ${creator.full_name} (project ${projectId}) in ${Date.now() - t0}ms`);
    } else {
      console.warn(`[InternalAPI] project-approved: criador sem phone (project ${projectId})`);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[InternalAPI] project-approved erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /internal/project-rejected — chamado pelo PWA quando usuário rejeita projeto via UI.
// Notifica o criador via WhatsApp com o motivo da rejeição.
router.post('/internal/project-rejected', requireInternalSecret, async (req, res) => {
  const t0 = Date.now();
  const { projectId, reason } = req.body || {};
  if (!projectId) return res.status(400).json({ error: 'projectId required' });

  try {
    const { data: project } = await supabase
      .from('projects')
      .select('id, name, created_by, rejection_reason')
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return res.status(404).json({ error: 'project not found' });

    const { data: creator } = await supabase
      .from('collaborators')
      .select('id, full_name, phone')
      .eq('id', project.created_by)
      .maybeSingle();

    if (creator?.phone) {
      const finalReason = reason || project.rejection_reason || 'sem motivo informado';
      const msg = `❌ *${project.name}* foi rejeitado.\n\nMotivo: ${finalReason}`;
      whatsapp.sendMessage(creator.phone, msg).catch(e =>
        console.error(`[InternalAPI] reject-notify WA falhou: ${e.message}`));
      console.log(`[InternalAPI] project-rejected notif → ${creator.full_name} (project ${projectId}) in ${Date.now() - t0}ms`);
    } else {
      console.warn(`[InternalAPI] project-rejected: criador sem phone (project ${projectId})`);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[InternalAPI] project-rejected erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Sprint 22.33 — task delegada via PWA → notifica assignee no WhatsApp.
// PWA envia { task_id } depois do INSERT. Endpoint le task + assignee + creator,
// dispara mensagem amigavel. Idempotente via marker_logs.
router.post('/internal/task-delegated', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });

  const dedupeKey = `task-delegated:${taskId}`;
  const { data: prior } = await supabase
    .from('marker_logs')
    .select('id')
    .eq('marker_type', 'TASK_DELEGATED')
    .eq('raw_excerpt', dedupeKey)
    .limit(1);
  if (prior && prior.length > 0) {
    return res.json({ status: 'already_notified', key: dedupeKey });
  }

  // Carrega task + creator + assignee (com phone/is_active)
  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .select('id, title, description, due_date, remind_at, context, eisenhower_quadrant, created_by, assigned_to')
    .eq('id', taskId)
    .single();
  if (taskErr || !task) return res.status(404).json({ error: 'task_not_found' });
  if (task.assigned_to === task.created_by) {
    return res.json({ status: 'skipped', reason: 'self-assigned' });
  }

  const { data: creator } = await supabase
    .from('collaborators')
    .select('id, full_name')
    .eq('id', task.created_by)
    .single();
  const { data: assignee } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active')
    .eq('id', task.assigned_to)
    .single();
  if (!assignee || !assignee.phone || !assignee.is_active) {
    await supabase.from('marker_logs').insert({
      marker_type: 'TASK_DELEGATED', result: 'skipped',
      reason: 'no_phone_or_inactive', raw_excerpt: dedupeKey,
    });
    return res.json({ status: 'no_recipient', key: dedupeKey });
  }

  // Formata data ("hoje" / "amanhã" / DD/MM)
  function fmtDay(ymd) {
    if (!ymd) return null;
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
      .toISOString().slice(0, 10);
    const tmrw = new Date(today + 'T03:00:00Z'); tmrw.setUTCDate(tmrw.getUTCDate() + 1);
    if (ymd === today) return 'hoje';
    if (ymd === tmrw.toISOString().slice(0, 10)) return 'amanhã';
    const [, m, d] = ymd.split('-');
    return `${d}/${m}`;
  }
  function fmtTime(iso) {
    if (!iso) return null;
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  }

  const dayStr = fmtDay(task.due_date);
  const timeStr = fmtTime(task.remind_at);
  const whenLine = dayStr ? (timeStr ? ` *${dayStr}* às *${timeStr}*` : ` *${dayStr}*`) : '';

  const body =
    `📌 *${creator?.full_name || 'Alguém'}* delegou uma tarefa pra você:\n\n` +
    `*${task.title}*${whenLine ? `\n\nPra${whenLine}.` : ''}` +
    (task.description ? `\n\n💬 "${String(task.description).slice(0, 300)}"` : '') +
    `\n\nQuando concluir, marca aqui ou no app.`;

  whatsapp.sendMessage(assignee.phone, body).catch(e =>
    console.error(`[InternalAPI] task-delegated WA send err pra ${assignee.id}: ${e.message}`),
  );

  await supabase.from('marker_logs').insert({
    marker_type: 'TASK_DELEGATED', result: 'executed',
    reason: `delegated to ${assignee.full_name}`, raw_excerpt: dedupeKey,
  });
  console.log(`[InternalAPI] task-delegated ${taskId} → ${assignee.full_name}`);
  return res.json({ status: 'ok', key: dedupeKey });
});

// #em-copia (Fabi 29/06): avisa cada pessoa recém-posta em cópia de uma tarefa.
// PWA envia { task_id, watcher_ids } após inserir em task_watchers. Idempotente por (task, watcher).
router.post('/internal/watchers-added', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const watcherIds = Array.isArray(req.body?.watcher_ids) ? req.body.watcher_ids.map(String) : [];
  if (!taskId || !watcherIds.length) return res.status(400).json({ error: 'missing_task_or_watchers' });

  const { data: task } = await supabase
    .from('tasks').select('id, title, due_date, created_by, assigned_to').eq('id', taskId).single();
  if (!task) return res.status(404).json({ error: 'task_not_found' });

  const { data: execColl } = await supabase
    .from('collaborators').select('full_name').eq('id', task.assigned_to).maybeSingle();
  const execFirst = (execColl?.full_name || '').split(' ')[0] || 'a pessoa';

  const { data: ws } = await supabase
    .from('collaborators').select('id, full_name, phone, is_active').in('id', watcherIds);
  function fmtDay(ymd) { if (!ymd) return null; const [, m, d] = ymd.split('-'); return `${d}/${m}`; }
  const dayStr = fmtDay(task.due_date);
  let sent = 0;
  for (const w of (ws || [])) {
    if (!w.phone || !w.is_active) continue;
    const dedupeKey = `watchers-added:${taskId}:${w.id}`;
    const { data: prior } = await supabase
      .from('marker_logs').select('id').eq('marker_type', 'WATCHER_ADDED').eq('raw_excerpt', dedupeKey).limit(1);
    if (prior && prior.length) continue;
    const body =
      `👀 Você entrou em *cópia* de uma tarefa de *${execFirst}*:\n\n*${task.title}*` +
      (dayStr ? `\n\nPrazo: ${dayStr}.` : '') +
      `\n\nVocê acompanha e pode cobrar — não precisa concluir. Vou te lembrar junto com ${execFirst}.`;
    try {
      await whatsapp.sendMessage(w.phone, body);
      await supabase.from('conversation_history').insert({
        collaborator_id: w.id, direction: 'outbound', message_type: 'text', content: body,
      });
      sent++;
    } catch (e) { console.error(`[InternalAPI] watchers-added WA err ${w.id}: ${e.message}`); }
    await supabase.from('marker_logs').insert({
      marker_type: 'WATCHER_ADDED', result: 'executed', reason: `cc ${w.full_name}`, raw_excerpt: dedupeKey,
    });
  }
  console.log(`[InternalAPI] watchers-added ${taskId} → ${sent}/${watcherIds.length}`);
  return res.json({ status: 'ok', sent });
});

// Sprint 22.34m — atualização de tarefa delegada → avisa o assignee.
// Disparado pelo PWA quando user editou/reagendou tarefa criada por ele
// e atribuída a outro colab. Sem idempotência: cada update real notifica.
router.post('/internal/task-updated', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const changeType = String(req.body?.change_type || 'edited').trim(); // 'rescheduled' | 'edited'
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });

  const { data: task, error: tErr } = await supabase
    .from('tasks')
    .select('id, title, due_date, remind_at, status, context, assigned_to, created_by')
    .eq('id', taskId)
    .single();
  if (tErr || !task) return res.status(404).json({ error: 'task_not_found' });

  // Só notifica se delegada (assignee != creator) e ambos existem.
  if (!task.assigned_to || task.assigned_to === task.created_by) {
    await supabase.from('marker_logs').insert({
      marker_type: 'TASK_UPDATED', result: 'skipped',
      reason: 'not_delegated', raw_excerpt: `task-updated:${taskId}`,
    });
    return res.json({ status: 'not_delegated' });
  }

  const [{ data: assignee }, { data: creator }] = await Promise.all([
    supabase.from('collaborators').select('id, full_name, phone, is_active').eq('id', task.assigned_to).single(),
    supabase.from('collaborators').select('id, full_name').eq('id', task.created_by).single(),
  ]);

  if (!assignee || !assignee.phone || !assignee.is_active) {
    await supabase.from('marker_logs').insert({
      marker_type: 'TASK_UPDATED', result: 'skipped',
      reason: 'no_recipient', raw_excerpt: `task-updated:${taskId}`,
    });
    return res.json({ status: 'no_recipient' });
  }

  // Formata data BR
  const dateBR = task.due_date
    ? `${task.due_date.slice(8,10)}/${task.due_date.slice(5,7)}`
    : 'sem data';
  let timeStr = '';
  if (task.remind_at) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(task.remind_at));
    const hh = parts.find(p => p.type === 'hour')?.value || '00';
    const mm = parts.find(p => p.type === 'minute')?.value || '00';
    timeStr = `\n🕐 ${parseInt(hh, 10)}h${mm === '00' ? '' : mm}`;
  }

  const verb = changeType === 'rescheduled' ? 'reagendou' : 'atualizou';
  const body =
    `🔄 *${creator?.full_name || 'Alguém'}* ${verb} uma tarefa que tá com você:\n\n` +
    `*${task.title}*\n` +
    `📅 ${dateBR}${timeStr}\n\n` +
    `Quer continuar do mesmo jeito? Responde aqui.`;

  whatsapp.sendMessage(assignee.phone, body).catch(e =>
    console.error(`[InternalAPI] task-updated WA send err pra ${assignee.id}: ${e.message}`),
  );

  await supabase.from('marker_logs').insert({
    marker_type: 'TASK_UPDATED', result: 'executed',
    reason: `${changeType} → ${assignee.full_name}`,
    raw_excerpt: `task-updated:${taskId}`,
  });
  console.log(`[InternalAPI] task-updated ${taskId} (${changeType}) → ${assignee.full_name}`);
  return res.json({ status: 'ok', sent: 1 });
});

// Checklist ativo (2026-06-28): o PWA concluiu a tarefa-PAI (última filha do checklist marcada)
// → avisa o DELEGADOR (created_by) + confirma pro EXECUTOR. Anti-confab: só notifica se o BANCO
// confirmar status='done' (se o update do app não persistiu, NÃO confabula). Replica a lógica de
// notifyTaskCreatorOfAction (engine.js) aqui pra evitar dependência circular engine↔internal-api.
// Body: { task_id, actor_id? }.
router.post('/internal/subtask-parent-complete', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const actorId = req.body?.actor_id ? String(req.body.actor_id).trim() : null;
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });
  const logMk = (result, reason) => supabase.from('marker_logs').insert({
    marker_type: 'SUBTASK_PARENT_COMPLETE', result, reason: String(reason).slice(0, 200),
    raw_excerpt: `subtask-complete:${taskId}`,
  }).then(() => {}, () => {});
  try {
    const { data: task } = await supabase
      .from('tasks')
      .select('id, title, status, created_by, assigned_to')
      .eq('id', taskId).single();
    // Anti-confab: só avisa se o pai está REALMENTE done no banco.
    if (!task || task.status !== 'done') {
      logMk('skipped', !task ? 'not_found' : `not_done:${task.status}`);
      return res.json({ status: 'not_done' });
    }
    // Só delegada (created_by != assigned_to) gera aviso ao delegador.
    if (!task.created_by || !task.assigned_to || task.created_by === task.assigned_to) {
      logMk('skipped', 'not_delegated');
      return res.json({ status: 'not_delegated' });
    }
    const actId = actorId || task.assigned_to;
    const [{ data: creator }, { data: actor }] = await Promise.all([
      supabase.from('collaborators').select('id, full_name, preferred_name, phone, is_active').eq('id', task.created_by).single(),
      supabase.from('collaborators').select('id, full_name, preferred_name, phone').eq('id', actId).single(),
    ]);
    const titleShort = String(task.title || '').slice(0, 80);
    let sent = 0;
    // 1) Delegador (created_by) — mesmo texto do notifyTaskCreatorOfAction('complete').
    if (creator && creator.is_active && creator.phone) {
      const creatorName = creator.preferred_name || (creator.full_name || '').split(' ')[0];
      const actorName = (actor && (actor.preferred_name || (actor.full_name || '').split(' ')[0])) || 'alguém';
      const msg = `✅ ${creatorName}, o ${actorName} concluiu a tarefa que você pediu:\n_"${titleShort}"_`;
      whatsapp.sendMessage(creator.phone, msg).catch(e => console.error(`[InternalAPI] subtask-complete creator WA err: ${e.message}`));
      await supabase.from('conversation_history').insert({
        collaborator_id: creator.id, direction: 'outbound', message_type: 'text', content: msg,
      }).then(() => {}, () => {});
      sent++;
    }
    // 2) Executor (D2) — confirma a conclusão.
    if (actor && actor.phone) {
      whatsapp.sendMessage(actor.phone, `✅ você fechou: ${titleShort} (todos os itens)`)
        .catch(e => console.error(`[InternalAPI] subtask-complete actor WA err: ${e.message}`));
      sent++;
    }
    logMk('executed', `creator+actor sent=${sent}`);
    console.log(`[InternalAPI] subtask-parent-complete ${taskId} → sent=${sent}`);
    return res.json({ status: 'ok', sent });
  } catch (err) {
    console.error('[InternalAPI] subtask-parent-complete err:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Volta da delegação (2026-07-02) — conclusão pelo APP de uma tarefa delegada: avisa o
// delegador + quem está em cópia (+ devolutiva opcional). Anti-confab no helper (re-lê done
// no banco). Body: { task_id, actor_id, note? }.
router.post('/internal/task-complete-return', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const actorId = req.body?.actor_id ? String(req.body.actor_id).trim() : null;
  const note = req.body?.note ? String(req.body.note) : null;
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });
  try {
    const taskReturn = require('./services/task-return');
    const whatsapp = require('./services/whatsapp');
    await taskReturn.saveReturnComment({ supabase, taskId, authorId: actorId, note });
    const { sent } = await taskReturn.notifyTaskReturn({ supabase, whatsapp, taskId, actorId, kind: 'completion', note });
    return res.json({ status: 'ok', sent });
  } catch (err) {
    console.error('[InternalAPI] task-complete-return err:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Devolutiva AVULSA (executor OU em-cópia, a qualquer momento) pelo APP → círculo da tarefa
// (menos o autor). Body: { task_id, author_id, note }.
router.post('/internal/task-return', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const authorId = req.body?.author_id ? String(req.body.author_id).trim() : null;
  const note = req.body?.note ? String(req.body.note) : null;
  if (!taskId || !note || !note.trim()) return res.status(400).json({ error: 'missing_fields' });
  try {
    const taskReturn = require('./services/task-return');
    const whatsapp = require('./services/whatsapp');
    await taskReturn.saveReturnComment({ supabase, taskId, authorId, note });
    const { sent } = await taskReturn.notifyTaskReturn({ supabase, whatsapp, taskId, actorId: authorId, kind: 'return', note });
    return res.json({ status: 'ok', sent });
  } catch (err) {
    console.error('[InternalAPI] task-return err:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Dashboard de time — botão "Cobrar agora": cobrança MANUAL disparada pelo líder/CEO. Manda
// WhatsApp IMEDIATO pro responsável da tarefa, em nome de quem clicou. Transacional (ação do
// líder, não job proativo) → envia na hora, sem gate de quiet-hours (mesma classe do task-delegated).
// Body: { task_id, requester_id? }. Resposta: { ok, sent, reason? }.
router.post('/internal/task-cobrar', requireInternalSecret, async (req, res) => {
  const taskId = String(req.body?.task_id || '').trim();
  const requesterId = req.body?.requester_id ? String(req.body.requester_id).trim() : null;
  if (!taskId) return res.status(400).json({ error: 'missing_task_id' });

  const { data: task, error: tErr } = await supabase
    .from('tasks')
    .select('id, title, due_date, status, assigned_to')
    .eq('id', taskId)
    .maybeSingle();
  if (tErr) { console.error('[InternalAPI] task-cobrar task err:', tErr.message); return res.status(500).json({ error: tErr.message }); }
  if (!task) return res.status(404).json({ error: 'task_not_found' });
  if (!task.assigned_to) return res.json({ ok: true, sent: false, reason: 'no_assignee' });

  const { data: assignee } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active')
    .eq('id', task.assigned_to)
    .maybeSingle();
  if (!assignee || !assignee.phone || assignee.is_active === false) {
    return res.json({ ok: true, sent: false, reason: 'no_phone_or_inactive' });
  }

  let requesterName = null;
  if (requesterId) {
    const { data: rq } = await supabase.from('collaborators').select('full_name').eq('id', requesterId).maybeSingle();
    requesterName = rq?.full_name || null;
  }

  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const body = buildCobrancaMessage({
    assigneeName: assignee.full_name, taskTitle: task.title,
    dueYmd: task.due_date, todayYmd, requesterName,
  });

  try {
    await whatsapp.sendMessage(assignee.phone, body); // quiet-exempt: cobrança manual disparada pelo líder (transacional, igual task-delegated)
  } catch (e) {
    console.error(`[InternalAPI] task-cobrar WA falhou task=${taskId}: ${e.message}`);
    return res.status(502).json({ ok: false, error: 'send_failed', message: e.message });
  }

  try {
    await supabase.from('marker_logs').insert({
      collaborator_id: requesterId || null,
      marker_type: 'TASK_COBRADA',
      result: 'executed',
      reason: `cobrou ${assignee.full_name} sobre ${String(task.title).slice(0, 60)}`,
      raw_excerpt: String(taskId).slice(0, 500),
    });
  } catch (e) { console.error('[InternalAPI] task-cobrar log err:', e.message); }

  console.log(`[InternalAPI] task-cobrar ${taskId} → ${assignee.full_name}`);
  return res.json({ ok: true, sent: true });
});

// Dashboard de time — status das cobranças por tarefa, pra UI mostrar "já cobrado / quando /
// respondeu" e evitar re-envio às cegas. Lê marker_logs TASK_COBRADA (quando/quantas) + o ÚLTIMO
// inbound do responsável (SÓ timestamp, sem conteúdo — privacidade) pra inferir resposta.
// Body: { task_ids: [], assignee_id? }. Resposta: { statuses: { [taskId]: {sentCount,lastSentAt,responded} } }.
router.post('/internal/cobranca-status', requireInternalSecret, async (req, res) => {
  const taskIds = Array.isArray(req.body?.task_ids) ? req.body.task_ids.filter((x) => typeof x === 'string') : [];
  const assigneeId = req.body?.assignee_id ? String(req.body.assignee_id).trim() : null;
  if (!taskIds.length) return res.json({ statuses: {} });

  const { data: logs } = await supabase
    .from('marker_logs')
    .select('raw_excerpt, created_at')
    .eq('marker_type', 'TASK_COBRADA')
    .in('raw_excerpt', taskIds);
  const byTask = {};
  for (const l of (logs || [])) {
    const k = l.raw_excerpt;
    if (!byTask[k]) byTask[k] = { sentCount: 0, lastSentAt: null };
    byTask[k].sentCount += 1;
    if (!byTask[k].lastSentAt || l.created_at > byTask[k].lastSentAt) byTask[k].lastSentAt = l.created_at;
  }

  // "Respondeu" = o responsável mandou ALGO depois da última cobrança (sinal de engajamento;
  // não amarra à tarefa específica). Só o timestamp do último inbound — nunca o conteúdo.
  let lastInboundAt = null;
  if (assigneeId) {
    const { data: inb } = await supabase
      .from('conversation_history')
      .select('created_at')
      .eq('collaborator_id', assigneeId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1);
    lastInboundAt = inb && inb[0] ? inb[0].created_at : null;
  }

  const statuses = {};
  for (const id of taskIds) {
    const s = byTask[id];
    if (!s) { statuses[id] = { sentCount: 0, lastSentAt: null, responded: false }; continue; }
    statuses[id] = {
      sentCount: s.sentCount,
      lastSentAt: s.lastSentAt,
      responded: Boolean(lastInboundAt && s.lastSentAt && lastInboundAt > s.lastSentAt),
    };
  }
  return res.json({ statuses });
});

// Sprint 22.33 — convidados em compromisso → notifica cada participant.
// PWA envia { event_id } depois do INSERT (evento + participants).
router.post('/internal/event-invites', requireInternalSecret, async (req, res) => {
  const eventId = String(req.body?.event_id || '').trim();
  if (!eventId) return res.status(400).json({ error: 'missing_event_id' });

  // Idempotencia por event (assume mandar so 1x na criacao; updates futuros
  // poderiam ter outro endpoint).
  const dedupeKey = `event-invites:${eventId}`;
  const { data: prior } = await supabase
    .from('marker_logs')
    .select('id')
    .eq('marker_type', 'EVENT_INVITES')
    .eq('raw_excerpt', dedupeKey)
    .limit(1);
  if (prior && prior.length > 0) {
    return res.json({ status: 'already_notified', key: dedupeKey });
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, title, start_at, end_at, modality, location_text, meeting_url, created_by')
    .eq('id', eventId)
    .single();
  if (!event) return res.status(404).json({ error: 'event_not_found' });

  const { data: creator } = await supabase
    .from('collaborators')
    .select('id, full_name')
    .eq('id', event.created_by)
    .single();

  // Sprint 22.34l — FIX: event_participants tem 2 FKs pra collaborators
  // (collaborator_id + invited_by), entao supabase-js nao sabe qual join
  // usar com `collaborators(...)`. Disambiguar via hint explicito.
  const { data: participants, error: pErr } = await supabase
    .from('event_participants')
    .select('id, collaborator_id, status, collaborators!event_participants_collaborator_id_fkey(id, full_name, phone, is_active)')
    .eq('event_id', eventId)
    .is('notified_at', null);
  if (pErr) {
    console.error(`[InternalAPI] event-invites participants query err: ${pErr.message}`);
    return res.status(500).json({ error: 'participants_query_failed', detail: pErr.message });
  }

  const recipients = (participants || [])
    .map(p => {
      const c = Array.isArray(p.collaborators) ? p.collaborators[0] : p.collaborators;
      return c && c.phone && c.is_active
        ? { participantId: p.id, id: c.id, name: c.full_name, phone: c.phone }
        : null;
    })
    .filter(Boolean);

  if (recipients.length === 0) {
    // Sprint 22.34l — marker_logs.result CHECK só aceita 'executed'/'rejected'.
    await supabase.from('marker_logs').insert({
      marker_type: 'EVENT_INVITES', result: 'rejected',
      reason: 'no_recipients', raw_excerpt: dedupeKey,
    });
    return res.json({ status: 'no_recipients', key: dedupeKey });
  }

  // Formata janela "DD/MM HH:MM–HH:MM"
  function fmtSP(iso) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  }
  const startStr = fmtSP(event.start_at);
  const endTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(event.end_at));
  // Sprint 23.6 — URL em linha própria (sem emoji prefix na MESMA linha).
  // Bug: WhatsApp não auto-linka quando emoji vem antes do URL sem newline
  // forte. Fix: 🔗 Link: em linha 1, URL crua em linha 2 → linkify garantido.
  const where = event.modality === 'online'
    ? (event.meeting_url ? `🔗 Link da reunião:\n${event.meeting_url}` : '🌐 Online')
    : event.location_text || (event.modality === 'hibrido' ? '🏠/🌐 Híbrido' : '📍 Presencial');

  // Sprint EV-LEAK (08/06) — SEM [ev:...] visível: o marcador vazava código interno
  // pro usuário. O RSVP agora é resolvido pelo engine via convite pendente do
  // colaborador (applyRsvp → resolvePendingInviteEventId), sem token na mensagem.
  for (const r of recipients) {
    const body =
      `📅 *${creator?.full_name || 'Alguém'}* te convidou pra um compromisso:\n\n` +
      `*${event.title}*\n` +
      `🕐 ${startStr} — ${endTime}\n` +
      `${where}\n\n` +
      `Confirma presença respondendo "sim" ou "não" aqui.`;
    whatsapp.sendMessage(r.phone, body).catch(e =>
      console.error(`[InternalAPI] event-invite WA send err pra ${r.id}: ${e.message}`),
    );
  }

  // Marca notified_at (best-effort)
  const ids = recipients.map(r => r.participantId);
  await supabase.from('event_participants')
    .update({ notified_at: new Date().toISOString() })
    .in('id', ids);

  await supabase.from('marker_logs').insert({
    marker_type: 'EVENT_INVITES', result: 'executed',
    reason: `${recipients.length} invites sent`, raw_excerpt: dedupeKey,
  });
  console.log(`[InternalAPI] event-invites ${eventId} → ${recipients.length} msgs`);
  return res.json({ status: 'ok', sent: recipients.length, key: dedupeKey });
});

// Sprint 10: telemetria operacional do TOM. Auth via x-internal-secret (mesma
// porta /internal/, sem novo secret). Sem dashboard nesta sprint — só JSON.
router.get('/internal/metrics', requireInternalSecret, async (req, res) => {
  const ranges = {
    '24h': new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    '7d': new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
  };
  const out = { generated_at: new Date().toISOString(), windows: {} };

  for (const [label, since] of Object.entries(ranges)) {
    const { data: rows, error } = await supabase
      .from('tom_metrics')
      .select('latency_ms, provider_used, fallback_from, leak_blocked, sanitized_chars, error_kind, message_kind, input_tokens, output_tokens, actionable_intent, marker_emitted')
      .gte('ts', since);
    if (error) {
      out.windows[label] = { error: error.message };
      continue;
    }
    const r = rows || [];
    const lat = r.map(x => x.latency_ms).filter(x => Number.isFinite(x)).sort((a, b) => a - b);
    const median = lat.length ? lat[Math.floor(lat.length / 2)] : null;
    const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : null;
    const p99 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.99))] : null;
    const breakdown = (key) => r.reduce((a, x) => {
      const k = x[key] || '(none)';
      a[k] = (a[k] || 0) + 1;
      return a;
    }, {});
    const sum = (key) => r.reduce((a, x) => a + (Number(x[key]) || 0), 0);

    const actionable = r.filter(x => x.actionable_intent);
    const actionableNoMarker = actionable.filter(x => !x.marker_emitted);
    out.windows[label] = {
      total: r.length,
      latency: { median_ms: median, p95_ms: p95, p99_ms: p99 },
      provider: breakdown('provider_used'),
      fallback_count: r.filter(x => x.fallback_from).length,
      leak_blocked_count: r.filter(x => x.leak_blocked).length,
      sanitized_chars_total: sum('sanitized_chars'),
      sanitized_messages_count: r.filter(x => (x.sanitized_chars || 0) > 0).length,
      error_count: r.filter(x => x.error_kind).length,
      kind: breakdown('message_kind'),
      tokens: { input_total: sum('input_tokens'), output_total: sum('output_tokens') },
      // Sprint 10.1: regressão silenciosa — user pediu ação, marker não saiu
      actionable_intent_count: actionable.length,
      actionable_no_marker_count: actionableNoMarker.length,
      actionable_no_marker_rate: actionable.length ? (actionableNoMarker.length / actionable.length) : null,
    };
  }

  // Markers do período mais curto via marker_logs (auditoria adicional).
  const { data: markers } = await supabase
    .from('marker_logs')
    .select('marker_type, result')
    .gte('created_at', ranges['24h']);
  out.markers_24h = (markers || []).reduce((a, m) => {
    const k = `${m.marker_type}.${m.result}`;
    a[k] = (a[k] || 0) + 1;
    return a;
  }, {});

  res.json(out);
});

// Sprint 22.36 Fatia 6 — Checklist celebra + escalação ===========================

// Helper: encontra o gerente operacional responsável pela unidade.
// Sprint 22.36 (fix) — busca role='manager' (NÃO coordinator). Coordinators
// pedagogical (Quintela, Juliana) NÃO devem receber escalação operacional.
// Hierarquia já documentada em TOM-LIMITES.md (Sprint 20):
//   - director (Alf, Anne) — vê tudo
//   - coordinator (Quintela, Juliana, pedagogical_role='lead') — pedagogical, NÃO operacional
//   - manager (Jereh/campo_grande, Clayton/recreio, Krissya/barra) — operacional por unidade
//   - manager unit='all' (Yuri/Marketing) — NÃO é gerente de unidade operacional
async function findUnitManager(unit) {
  if (unit && unit !== 'all') {
    const { data: manager } = await supabase
      .from('collaborators')
      .select('id, full_name, phone')
      .eq('role', 'manager')
      .eq('unit', unit) // unit específica — exclui Yuri (unit='all')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (manager && manager.phone) return manager;
  }
  // Fallback: director ativo (sem manager mapeado pra unit, ou unit='all')
  const { data: director } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('role', 'director')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return director && director.phone ? director : null;
}

// Sprint 22.36 — Fluxo de celebração: 2 Zaps quando checklist fecha 100%.
// Idempotente via marker_logs CHECKLIST_COMPLETED.
async function runChecklistCompletedFlow(completionId) {
  const dedupeKey = `checklist-completed:${completionId}`;
  const { data: prior } = await supabase
    .from('marker_logs')
    .select('id')
    .eq('marker_type', 'CHECKLIST_COMPLETED')
    .eq('raw_excerpt', dedupeKey)
    .limit(1);
  if (prior && prior.length > 0) {
    return { status: 'already_notified', sent: 0 };
  }

  const { data: completion, error: fetchErr } = await supabase
    .from('op_checklist_completions')
    .select('id, completed_at, collaborator_id, op_checklists(name, unit)')
    .eq('id', completionId)
    .single();
  if (fetchErr || !completion) {
    console.warn('[ChecklistCompleted] completion not found:', completionId);
    return { status: 'not_found', sent: 0 };
  }

  const { data: collab } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, unit')
    .eq('id', completion.collaborator_id)
    .single();

  const tplName = completion.op_checklists?.name || 'checklist';
  const tplUnit = completion.op_checklists?.unit || (collab && collab.unit) || 'all';
  const manager = await findUnitManager(tplUnit);

  let sent = 0;

  if (collab && collab.phone && collab.is_active) {
    const managerName = manager && manager.id !== collab.id
      ? (manager.full_name || '').split(' ')[0]
      : null;
    const body = managerName
      ? `🎉 Fechado! Checklist *${tplName}* 100%. Mandei aviso pro ${managerName}.`
      : `🎉 Fechado! Checklist *${tplName}* 100%. Boa!`;
    try {
      await whatsapp.sendMessage(collab.phone, body);
      sent++;
    } catch (e) {
      console.error('[ChecklistCompleted] WA send (collab) err:', e.message);
    }
  }

  if (manager && manager.phone && manager.id !== completion.collaborator_id) {
    const body =
      `✅ *${(collab && collab.full_name) || 'Colaborador'}* fechou o checklist ` +
      `*${tplName}*${tplUnit && tplUnit !== 'all' ? ` na unidade *${tplUnit}*` : ''}. 100%, sem pendência.`;
    try {
      await whatsapp.sendMessage(manager.phone, body);
      sent++;
    } catch (e) {
      console.error('[ChecklistCompleted] WA send (manager) err:', e.message);
    }
  }

  await supabase.from('marker_logs').insert({
    marker_type: 'CHECKLIST_COMPLETED',
    result: 'executed',
    reason: `sent=${sent} unit=${tplUnit}`,
    raw_excerpt: dedupeKey,
  });

  return { status: 'sent', sent };
}

router.post('/internal/checklist-completed', requireInternalSecret, async (req, res) => {
  const completionId = String(req.body?.completion_id || '').trim();
  if (!completionId) return res.status(400).json({ error: 'missing_completion_id' });
  try {
    const out = await runChecklistCompletedFlow(completionId);
    res.json(out);
  } catch (err) {
    console.error('[InternalAPI] checklist-completed err:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Fatia B/D — IA "Formatar com o TOM" das anotações de grupo. Assinatura OAuth (CLI
// claude.chatRaw), SEM API key e SEM fallback OpenAI. Body: { action, html, instruction?, emoji? }.
// action ∈ format|summarize|fix|tone. Fatia D: systemPrompt semântico por padrão (separa
// itens, agrupa por categoria); instruction = "formata desse jeito"; emoji = toggle.
// Auth via x-internal-secret (mesma porta /internal/).
router.post('/internal/format-note', requireInternalSecret, async (req, res) => {
  const v = validateFormatRequest(req.body || {});
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

  // 90s: o motor semântico (Fatia D) gera HTML estruturado longo em textos grandes
  // (descarga mental real) e estourava os 30s antigos → "fechou e não fez nada".
  // CLI tem timeout próprio de 120s; 90s dá folga e ainda responde antes dele.
  const RACE_MS = 90000;
  const logFmt = (result, reason) => {
    supabase.from('marker_logs').insert({
      marker_type: 'NOTE_FORMATTED', result, reason: String(reason).slice(0, 200), raw_excerpt: v.action,
    }).then(() => {}, () => {});
  };
  try {
    const aiPromise = claude.chatRaw(systemPromptFor(v.action, { instruction: v.instruction, emoji: v.emoji }), v.html);
    const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('format_timeout_30s')), RACE_MS));
    const r = await Promise.race([aiPromise, timeoutPromise]);
    const html = (r && r.text ? r.text : '').trim();
    if (!html) {
      logFmt('rejected', `empty action=${v.action}`);
      return res.status(502).json({ ok: false, error: 'tom_unavailable' });
    }
    logFmt('executed', `action=${v.action} instr=${v.instruction ? 'y' : 'n'} emoji=${v.emoji ? 'y' : 'n'} chars=${html.length}`);
    return res.json({ ok: true, html });
  } catch (err) {
    console.warn(`[InternalAPI] format-note falhou action=${v.action}: ${err.message?.slice(0, 200)}`);
    logFmt('rejected', err.message);
    return res.status(502).json({ ok: false, error: 'tom_unavailable' });
  }
});

// Grupos B2 — "Pré-visualizar" o relatório de um preset SEM enviar pro grupo (read-only).
// Reutiliza buildPresetPreview (mesma montagem dos rituais proativos), mas não claima em
// group_ritual_logs nem insere card. Body: { group_id, preset }. Auth via x-internal-secret.
router.post('/internal/group-report-preview', requireInternalSecret, async (req, res) => {
  const groupId = String(req.body?.group_id || '').trim();
  const preset = String(req.body?.preset || '').trim();
  if (!groupId) return res.status(400).json({ ok: false, error: 'missing_group_id' });
  if (!GROUP_REPORT_PRESETS.includes(preset)) return res.status(400).json({ ok: false, error: 'invalid_preset' });
  try {
    const r = await buildPresetPreview({ supabase, groupId, preset, now: new Date() });
    if (!r.ok) return res.status(r.error === 'group_not_found' ? 404 : 400).json({ ok: false, error: r.error });
    return res.json({ ok: true, html: r.html, isEmpty: r.isEmpty, heading: r.heading });
  } catch (err) {
    console.warn(`[InternalAPI] group-report-preview falhou group=${groupId} preset=${preset}: ${err.message?.slice(0, 200)}`);
    return res.status(502).json({ ok: false, error: 'preview_failed' });
  }
});

// Grupos B2 — "Enviar pro grupo agora": dispara o relatório do preset NA HORA (manual).
// Read-WRITE: insere o card no chat (app) + espelho WhatsApp via bridge-out. Sem claim
// diário (ação explícita). overdue sem atrasadas → sent:false. Body: { group_id, preset }.
router.post('/internal/group-report-send', requireInternalSecret, async (req, res) => {
  const groupId = String(req.body?.group_id || '').trim();
  const preset = String(req.body?.preset || '').trim();
  if (!groupId) return res.status(400).json({ ok: false, error: 'missing_group_id' });
  if (!GROUP_REPORT_PRESETS.includes(preset)) return res.status(400).json({ ok: false, error: 'invalid_preset' });
  try {
    const r = await sendPresetNow({ supabase, groupId, preset, now: new Date() });
    if (!r.ok) return res.status(r.error === 'group_not_found' ? 404 : 400).json({ ok: false, error: r.error });
    return res.json({ ok: true, sent: r.sent, isEmpty: r.isEmpty });
  } catch (err) {
    console.warn(`[InternalAPI] group-report-send falhou group=${groupId} preset=${preset}: ${err.message?.slice(0, 200)}`);
    return res.status(502).json({ ok: false, error: 'send_failed' });
  }
});

// G8 — LA EDUCA: notify-event
router.post('/internal/la-educa/notify-event', requireInternalSecret, async (req, res) => {
  try {
    const { tipo, estagiarioId, destinatarioId, payload } = req.body || {};
    if (!tipo || !destinatarioId) return res.status(400).json({ error: 'tipo e destinatarioId obrigatórios' });
    const tipoFinal = tipo.endsWith('_envio') ? tipo : (tipo + '_envio');
    const { data, error } = await supabase.from('la_educa_lembretes_log').insert({
      tipo: tipoFinal,
      destinatario_id: destinatarioId,
      estagiario_id: estagiarioId || null,
      mensagem: null,
      enviado_em: new Date().toISOString(),
    }).select('id').single();
    if (error) throw error;
    res.json({ enqueued: true, id: data.id, tipo: tipoFinal });
  } catch (err) {
    console.error('[InternalAPI] la-educa/notify-event err:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// G8 — LA EDUCA: status snapshot
router.get('/internal/la-educa/status', requireInternalSecret, async (_req, res) => {
  try {
    const { data: lista } = await supabase.from('la_educa_progresso').select('*');
    const all = lista || [];
    const ativos = all.filter(e => Number(e.percentual) < 100);
    const atrasados = all.filter(e => {
      if (!e.ultima_atualizacao) return false;
      const dias = Math.floor((Date.now() - new Date(e.ultima_atualizacao).getTime()) / 86400000);
      return dias > 14 && Number(e.percentual) < 100;
    });
    const limite30 = new Date(Date.now() - 30 * 86400 * 1000);
    const certMes = all.filter(e => e.certificado_emitido && e.certificado_emitido_em && new Date(e.certificado_emitido_em) > limite30);
    const { count: customCount } = await supabase
      .from('la_educa_avaliacoes').select('id', { count: 'exact', head: true }).is('checkpoint_id', null);
    res.json({
      total_estagiarios: all.length,
      ativos: ativos.length,
      atrasados: atrasados.length,
      certificados_30d: certMes.length,
      checkpoints_custom_total: customCount || 0,
    });
  } catch (err) {
    console.error('[InternalAPI] la-educa/status err:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// LA JOURNEY: notify-event — enfileira lembretes por destinatário
router.post('/internal/la-journey/notify-event', requireInternalSecret, async (req, res) => {
  try {
    const { conteudoId, tipo, destinatarios } = req.body || {};
    if (!conteudoId || !tipo || !Array.isArray(destinatarios) || destinatarios.length === 0) {
      return res.status(400).json({ error: 'conteudoId, tipo e destinatarios (array não-vazio) são obrigatórios' });
    }
    const rows = destinatarios.map(dest => ({
      conteudo_id: conteudoId,
      tipo,
      destinatario_id: dest,
      enviado: false,
      created_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('la_journey_lembretes_log').insert(rows);
    if (error) throw error;
    res.json({ ok: true, enfileirados: rows.length });
  } catch (err) {
    console.error('[InternalAPI] la-journey/notify-event err:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// LA JOURNEY: status snapshot — retorna progresso school + kids + pendências
router.get('/internal/la-journey/status', requireInternalSecret, async (_req, res) => {
  try {
    const [{ data: school }, { data: kids }] = await Promise.all([
      supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'school' }),
      supabase.rpc('la_journey_lista_progresso', { p_programa_id: 'kids' }),
    ]);
    const { data: pendencias } = await supabase
      .from('la_journey_conteudo_checkpoint')
      .select('id, programa_id, curso_id, checkpoint_id, updated_at, la_journey_cursos(nome), la_journey_checkpoints(nome)')
      .eq('status', 'em_revisao');
    res.json({ school: school || [], kids: kids || [], pendencias: pendencias || [] });
  } catch (err) {
    console.error('[InternalAPI] la-journey/status err:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// INVENTÁRIO (cross-project LA Report)
// ═══════════════════════════════════════════════════════════

// GET /internal/lareport/unidades
router.get('/internal/lareport/unidades', requireInternalSecret, async (_req, res) => {
  try {
    const data = await inventarioService.listarUnidades();
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/unidades:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /internal/lareport/salas?unit=<uuid>
router.get('/internal/lareport/salas', requireInternalSecret, async (req, res) => {
  const unit = req.query.unit;
  if (!unit) return res.status(400).json({ ok: false, error: 'unit_obrigatorio' });
  try {
    const data = await inventarioService.listarSalasPorUnidade(unit);
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/salas:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /internal/lareport/sala/:salaId
router.get('/internal/lareport/sala/:salaId', requireInternalSecret, async (req, res) => {
  const salaId = parseInt(req.params.salaId, 10);
  if (!Number.isInteger(salaId)) return res.status(400).json({ ok: false, error: 'sala_id_invalido' });
  try {
    const data = await inventarioService.detalheSala(salaId);
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/sala/:id:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /internal/lareport/loja?unit=<uuid>
router.get('/internal/lareport/loja', requireInternalSecret, async (req, res) => {
  const unit = req.query.unit;
  if (!unit) return res.status(400).json({ ok: false, error: 'unit_obrigatorio' });
  try {
    const data = await inventarioService.listarLojaPorUnidade(unit);
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/loja:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// Fase 2.3 — proxies pra dev local (PWA via Vite proxy → VPS).
// Em produção, PWA usa serverless Vercel direto. Aqui replicamos
// pra que localhost:4173 também funcione.
// ============================================================
const { laReportClient: _lrcInternal } = require('./services/la-report-client');

// GET /internal/lareport/loja/historico-vendas?unit=&dias=&status=&professor_id=&forma_pagamento=&limit=
router.get('/internal/lareport/loja/historico-vendas', requireInternalSecret, async (req, res) => {
  const unidadeId = req.query.unidade_id || req.query.unit;
  if (!unidadeId) return res.status(400).json({ ok: false, error: 'unit_obrigatorio' });
  const dias = Math.min(Math.max(parseInt(req.query.dias || '30', 10) || 30, 1), 90);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
  const status = ['ativa', 'estornada', 'todas'].includes(req.query.status) ? req.query.status : 'ativa';
  const cutoff = new Date(Date.now() - dias * 86400000).toISOString();
  let q = _lrcInternal
    .from('loja_vendas')
    .select(`
      id, unidade_id, data_venda, tipo_cliente, aluno_id, colaborador_cliente_id,
      cliente_nome, professor_indicador_id, subtotal, desconto, desconto_tipo,
      total, forma_pagamento, parcelas, observacoes, status,
      estornada_em, estornada_por, motivo_estorno, vendedor_id, created_at,
      loja_venda_itens:loja_vendas_itens (
        id, produto_id, variacao_id, produto_nome, variacao_nome,
        quantidade, preco_unitario, subtotal
      ),
      loja_alunos:alunos!aluno_id ( nome ),
      loja_colaboradores:colaboradores!colaborador_cliente_id ( nome ),
      loja_professores:professores!professor_indicador_id ( nome )
    `)
    .eq('unidade_id', unidadeId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status !== 'todas') q = q.eq('status', status);
  if (req.query.professor_id) q = q.eq('professor_indicador_id', parseInt(req.query.professor_id, 10));
  if (req.query.forma_pagamento) q = q.eq('forma_pagamento', req.query.forma_pagamento);
  try {
    const { data, error } = await q;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/loja/historico-vendas:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /internal/lareport/loja/estorno  body: {venda_id, motivo}
router.post('/internal/lareport/loja/estorno', requireInternalSecret, async (req, res) => {
  const { venda_id, motivo } = req.body || {};
  if (!venda_id) return res.status(400).json({ ok: false, error: 'venda_id_obrigatorio' });
  if (!motivo || String(motivo).trim().length < 5) {
    return res.status(400).json({ ok: false, error: 'motivo_obrigatorio_min_5' });
  }
  try {
    const { data, error } = await _lrcInternal.rpc('estornar_venda', {
      p_venda_id: parseInt(venda_id, 10),
      p_motivo: String(motivo).trim(),
      p_via_audit: 'estorno via PWA-dev local',
    });
    if (error) {
      const code = /ja_estornada|inexistente|invalida|obrigatorio/i.test(error.message) ? 400 : 500;
      return res.status(code).json({ ok: false, error: error.message });
    }
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/loja/estorno:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /internal/lareport/loja/reserva  body: {produto_id, variacao_id?, unidade_id, quantidade, cliente_nome, aluno_id?, observacoes?, prazo?}
router.post('/internal/lareport/loja/reserva', requireInternalSecret, async (req, res) => {
  const b = req.body || {};
  if (!b.produto_id) return res.status(400).json({ ok: false, error: 'produto_id_obrigatorio' });
  if (!b.unidade_id) return res.status(400).json({ ok: false, error: 'unidade_id_obrigatorio' });
  if (!b.quantidade || Number(b.quantidade) <= 0) return res.status(400).json({ ok: false, error: 'quantidade_invalida' });
  if (!b.cliente_nome || !String(b.cliente_nome).trim()) return res.status(400).json({ ok: false, error: 'cliente_nome_obrigatorio' });
  try {
    const { data: disp, error: dErr } = await _lrcInternal.rpc('estoque_disponivel', {
      p_produto_id: parseInt(b.produto_id, 10),
      p_unidade_id: b.unidade_id,
      p_variacao_id: b.variacao_id ?? null,
    });
    if (dErr) return res.status(500).json({ ok: false, error: dErr.message });
    if (Number(disp) < Number(b.quantidade)) {
      return res.status(400).json({ ok: false, error: `estoque_insuficiente — disp=${disp}, pedido=${b.quantidade}` });
    }
    const prazoIso = (typeof b.prazo === 'string' ? b.prazo.slice(0, 10) : null)
      || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await _lrcInternal.from('loja_reservas').insert({
      produto_id: parseInt(b.produto_id, 10),
      variacao_id: b.variacao_id ?? null,
      unidade_id: b.unidade_id,
      aluno_id: b.aluno_id ?? null,
      cliente_nome: String(b.cliente_nome).trim().slice(0, 200),
      quantidade: parseInt(b.quantidade, 10),
      prazo: prazoIso,
      status: 'ativa',
      observacoes: b.observacoes ? String(b.observacoes) : null,
      created_via: 'pwa-dev',
    }).select('id, prazo').single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, reserva_id: data.id, prazo: data.prazo });
  } catch (e) {
    console.error('[internal-api] /lareport/loja/reserva:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /internal/lareport/loja/reserva/cancelar  body: {reserva_id, motivo?}
router.post('/internal/lareport/loja/reserva/cancelar', requireInternalSecret, async (req, res) => {
  const { reserva_id, motivo } = req.body || {};
  if (!reserva_id) return res.status(400).json({ ok: false, error: 'reserva_id_obrigatorio' });
  try {
    const { data, error } = await _lrcInternal
      .from('loja_reservas')
      .update({
        status: 'cancelada',
        cancelada_em: new Date().toISOString(),
        motivo_cancelamento: motivo ? String(motivo).trim().slice(0, 500) : null,
      })
      .eq('id', parseInt(reserva_id, 10))
      .eq('status', 'ativa')
      .select('id')
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(400).json({ ok: false, error: 'reserva_nao_ativa' });
    res.json({ ok: true, reserva_id: data.id });
  } catch (e) {
    console.error('[internal-api] /lareport/loja/reserva/cancelar:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /internal/lareport/loja/reserva/finalizar  body: {reserva_id, forma_pagamento, preco_unitario, ...}
router.post('/internal/lareport/loja/reserva/finalizar', requireInternalSecret, async (req, res) => {
  const b = req.body || {};
  if (!b.reserva_id) return res.status(400).json({ ok: false, error: 'reserva_id_obrigatorio' });
  if (!b.forma_pagamento) return res.status(400).json({ ok: false, error: 'forma_pagamento_obrigatoria' });
  if (b.preco_unitario == null) return res.status(400).json({ ok: false, error: 'preco_unitario_obrigatorio' });
  try {
    const reservaId = parseInt(b.reserva_id, 10);
    const { data: r, error: rErr } = await _lrcInternal
      .from('loja_reservas')
      .select('id, status, unidade_id, produto_id, variacao_id, quantidade, aluno_id, cliente_nome')
      .eq('id', reservaId)
      .maybeSingle();
    if (rErr) return res.status(500).json({ ok: false, error: rErr.message });
    if (!r) return res.status(400).json({ ok: false, error: 'reserva_inexistente' });
    if (r.status !== 'ativa') return res.status(400).json({ ok: false, error: 'reserva_nao_ativa' });

    const tipoCli = ['aluno', 'avulso', 'colaborador'].includes(b.tipo_cliente)
      ? b.tipo_cliente : (r.aluno_id ? 'aluno' : 'avulso');
    const itens = [{
      produto_id: r.produto_id,
      variacao_id: r.variacao_id,
      quantidade: r.quantidade,
      preco_unitario: Number(b.preco_unitario),
      desconto: b.desconto != null ? Number(b.desconto) : 0,
      desconto_tipo: b.desconto_tipo === 'percentual' ? 'percentual' : 'valor',
    }];
    const { data: vendaData, error: vErr } = await _lrcInternal.rpc('registrar_venda_v2', {
      p_unidade_id: r.unidade_id,
      p_itens: itens,
      p_forma_pagamento: b.forma_pagamento,
      p_via_audit: `reserva:${reservaId} pwa-dev`,
      p_tipo_cliente: tipoCli,
      p_cliente_nome: r.cliente_nome ?? null,
      p_aluno_id: r.aluno_id ?? null,
      p_colaborador_cliente_id: b.colaborador_id ?? null,
      p_professor_indicador_id: b.professor_indicador_id ?? null,
      p_desconto: 0,
      p_desconto_tipo: 'valor',
      p_parcelas: b.parcelas ?? 1,
      p_observacoes: b.observacoes ?? null,
    });
    if (vErr) return res.status(500).json({ ok: false, error: vErr.message });

    let vendaId = null;
    if (vendaData && typeof vendaData === 'object') {
      vendaId = vendaData.venda_id ?? vendaData.id ?? (Array.isArray(vendaData) ? vendaData[0]?.venda_id : null);
    }
    if (typeof vendaData === 'number') vendaId = vendaData;

    await _lrcInternal.from('loja_reservas').update({
      status: 'finalizada',
      finalizada_em: new Date().toISOString(),
      finalizada_venda_id: vendaId,
    }).eq('id', reservaId).eq('status', 'ativa');

    res.json({ ok: true, venda_id: vendaId });
  } catch (e) {
    console.error('[internal-api] /lareport/loja/reserva/finalizar:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /internal/lareport/alertas (consolidado: estoque baixo + manutenções + revisões)
router.get('/internal/lareport/alertas', requireInternalSecret, async (req, res) => {
  const unit = req.query.unit; // opcional
  try {
    const [estoque, manut, revisoes] = await Promise.all([
      inventarioService.listarEstoqueBaixo(unit),
      inventarioService.listarManutencoesPendentes(14),
      inventarioService.listarRevisoesProgramadas(7),
    ]);
    res.json({ ok: true, data: { estoque_baixo: estoque, manutencoes_pendentes: manut, revisoes_proximas: revisoes } });
  } catch (e) {
    console.error('[internal-api] /lareport/alertas:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.runChecklistCompletedFlow = runChecklistCompletedFlow;
module.exports.findUnitManager = findUnitManager;
