import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCollaborator } from '../_lib/auth.js';
import { checkAccess } from '../_lib/access-control.js';
import { lareport } from '../_lib/lareport-server.js';

type Categoria = 'compra' | 'reposicao' | 'reparo' | 'melhoria';
type Prioridade = 'urgente' | 'importante' | 'futuramente';
type Status = 'aberta' | 'em_andamento' | 'concluida' | 'cancelada';

const CATEGORIAS: Categoria[] = ['compra', 'reposicao', 'reparo', 'melhoria'];
const PRIORIDADES: Prioridade[] = ['urgente', 'importante', 'futuramente'];
const STATUSES: Status[] = ['aberta', 'em_andamento', 'concluida', 'cancelada'];

function err(res: VercelResponse, code: number, error: string) {
  return res.status(code).json({ ok: false, error });
}

async function checkUnit(
  access: ReturnType<typeof checkAccess>,
  unidadeId: string,
  res: VercelResponse,
): Promise<boolean> {
  if (!access.unitFilter) return true;
  const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
  if (!units.includes(unidadeId)) {
    err(res, 403, 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.');
    return false;
  }
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const collab = await requireCollaborator(req, res);
  if (!collab) return;

  const access = checkAccess(collab, 'inventario');
  if (!access.allowed) return err(res, 403, access.reason || 'forbidden');

  const collabName = (collab as any).full_name || (collab as any).nome || (collab as any).email || 'colaborador';

  if (req.method === 'GET') {
    const salaIdRaw = req.query.sala_id;
    const salaId = Number(Array.isArray(salaIdRaw) ? salaIdRaw[0] : salaIdRaw);
    if (!Number.isFinite(salaId)) return err(res, 400, 'sala_id obrigatorio');

    const statusRaw = (Array.isArray(req.query.status) ? req.query.status[0] : req.query.status) || '';
    const status = String(statusRaw || '').toLowerCase();

    let q = lareport
      .from('inventario_pendencias')
      .select('*')
      .eq('sala_id', salaId)
      .order('prioridade', { ascending: true })
      .order('created_at', { ascending: false });

    if (status === 'todas') {
      // sem filtro
    } else if (status && (STATUSES as string[]).includes(status)) {
      q = q.eq('status', status);
    } else {
      q = q.in('status', ['aberta', 'em_andamento']);
    }

    if (access.unitFilter) {
      const units = Array.isArray(access.unitFilter) ? access.unitFilter : [access.unitFilter];
      q = q.in('unidade_id', units);
    }

    const { data, error } = await q;
    if (error) return err(res, 500, error.message);
    return res.status(200).json({ ok: true, data: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { sala_id, unidade_id, titulo, descricao, categoria, prioridade, solicitante } = body;

    if (!sala_id || !Number.isFinite(Number(sala_id))) return err(res, 400, 'sala_id obrigatorio');
    if (!unidade_id || typeof unidade_id !== 'string') return err(res, 400, 'unidade_id obrigatorio');
    if (!titulo || typeof titulo !== 'string' || !titulo.trim()) return err(res, 400, 'titulo obrigatorio');
    if (!prioridade || !(PRIORIDADES as string[]).includes(prioridade)) {
      return err(res, 400, 'prioridade invalida');
    }
    if (categoria != null && !(CATEGORIAS as string[]).includes(categoria)) {
      return err(res, 400, 'categoria invalida');
    }

    if (!(await checkUnit(access, unidade_id, res))) return;

    const { data, error } = await lareport
      .from('inventario_pendencias')
      .insert({
        sala_id: Number(sala_id),
        unidade_id,
        titulo: titulo.trim().slice(0, 200),
        descricao: descricao ? String(descricao) : null,
        categoria: categoria || null,
        prioridade,
        status: 'aberta',
        solicitante: solicitante ? String(solicitante).slice(0, 100) : collabName,
        created_via: `via PWA por ${collabName}`,
      })
      .select('*')
      .single();

    if (error) return err(res, 500, error.message);
    return res.status(200).json({ ok: true, data });
  }

  if (req.method === 'PATCH') {
    const idRaw = req.query.id;
    const id = Number(Array.isArray(idRaw) ? idRaw[0] : idRaw);
    if (!Number.isFinite(id)) return err(res, 400, 'id obrigatorio');

    const body = req.body || {};
    const { titulo, descricao, categoria, prioridade, status, resolucao_obs, item_vinculado_id } = body;

    // Busca pendência existente pra validar acesso à unidade.
    const { data: existing, error: fetchErr } = await lareport
      .from('inventario_pendencias')
      .select('id, unidade_id, status')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) return err(res, 500, fetchErr.message);
    if (!existing) return err(res, 400, 'pendencia nao_encontrada');

    if (!(await checkUnit(access, existing.unidade_id as string, res))) return;

    const patch: Record<string, unknown> = {};
    if (titulo !== undefined) {
      if (typeof titulo !== 'string' || !titulo.trim()) return err(res, 400, 'titulo invalido');
      patch.titulo = titulo.trim().slice(0, 200);
    }
    if (descricao !== undefined) patch.descricao = descricao == null ? null : String(descricao);
    if (categoria !== undefined) {
      if (categoria != null && !(CATEGORIAS as string[]).includes(categoria)) return err(res, 400, 'categoria invalida');
      patch.categoria = categoria || null;
    }
    if (prioridade !== undefined) {
      if (!(PRIORIDADES as string[]).includes(prioridade)) return err(res, 400, 'prioridade invalida');
      patch.prioridade = prioridade;
    }
    if (resolucao_obs !== undefined) patch.resolucao_obs = resolucao_obs == null ? null : String(resolucao_obs);
    if (item_vinculado_id !== undefined) {
      patch.item_vinculado_id = item_vinculado_id == null ? null : Number(item_vinculado_id);
    }
    if (status !== undefined) {
      if (!(STATUSES as string[]).includes(status)) return err(res, 400, 'status invalido');
      patch.status = status;
      if (status === 'concluida' || status === 'cancelada') {
        patch.resolvido_em = new Date().toISOString();
        patch.resolvido_por = collabName;
      } else {
        patch.resolvido_em = null;
        patch.resolvido_por = null;
      }
    }

    patch.updated_at = new Date().toISOString();

    const { data, error } = await lareport
      .from('inventario_pendencias')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return err(res, 500, error.message);
    return res.status(200).json({ ok: true, data });
  }

  return err(res, 405, 'method_not_allowed');
}
