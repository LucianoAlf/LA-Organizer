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
    console.warn(`[InternalAPI] auth fail — header_present=${!!got}`);
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
      .select('latency_ms, provider_used, fallback_from, leak_blocked, sanitized_chars, error_kind, message_kind, input_tokens, output_tokens')
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

module.exports = router;
