// Tela administrativa: CRUD de trilhas, pilares e checkpoints da trilha LA EDUCA
import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { CustomSelect } from '../../components/CustomSelect';
import { showToast } from '../../components/Toast';
import {
  fetchPilares,
  fetchCheckpoints,
  criarPilar,
  atualizarPilar,
  deletarPilar,
  criarCheckpoint,
  atualizarCheckpoint,
  deletarCheckpoint,
  fetchTrilhas,
  criarTrilha,
  atualizarTrilha,
  deletarTrilha,
} from '../../lib/laeduca';
import type { Pilar, Checkpoint, Trilha } from '../../lib/laeduca-types';

// --- Ícones disponíveis ---
const ICONE_OPCOES = [
  { value: 'BookOpen', label: 'BookOpen' },
  { value: 'Music', label: 'Music' },
  { value: 'Users', label: 'Users' },
  { value: 'School', label: 'School' },
  { value: 'GraduationCap', label: 'GraduationCap' },
  { value: 'Heart', label: 'Heart' },
  { value: 'Star', label: 'Star' },
  { value: 'Target', label: 'Target' },
  { value: 'Award', label: 'Award' },
  { value: 'Briefcase', label: 'Briefcase' },
];

// Form de Trilha
interface TrilhaForm {
  id: string;
  nome: string;
  icone: string;
  descricao: string;
}

const TRILHA_FORM_VAZIO: TrilhaForm = { id: '', nome: '', icone: '', descricao: '' };

// Modal de Trilha
function ModalTrilha({ trilha, onClose }: { trilha: Trilha | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<TrilhaForm>(
    trilha
      ? { id: trilha.id, nome: trilha.nome, icone: trilha.icone ?? '', descricao: trilha.descricao ?? '' }
      : TRILHA_FORM_VAZIO,
  );

  const mut = useMutation({
    mutationFn: async () => {
      if (trilha) {
        return atualizarTrilha(trilha.id, {
          nome: form.nome.trim(),
          icone: form.icone.trim() || null,
          descricao: form.descricao.trim() || null,
        });
      }
      return criarTrilha({
        id: form.id.trim().toLowerCase().replace(/\s+/g, '-'),
        nome: form.nome.trim(),
        icone: form.icone.trim() || undefined,
        descricao: form.descricao.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-trilhas'] });
      showToast({ kind: 'success', title: trilha ? 'Trilha atualizada.' : 'Trilha criada.' });
      onClose();
    },
    onError: e => showToast({ kind: 'error', title: 'Erro', msg: (e as Error).message }),
  });

  function set(k: keyof TrilhaForm, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  return (
    <Modal title={trilha ? 'Editar trilha' : 'Adicionar trilha'} onClose={onClose}>
      <div className="space-y-md">
        {!trilha && (
          <div>
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">ID * (slug, ex: bateria-eletrica)</label>
            <input
              className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
              placeholder="bateria"
              value={form.id}
              onChange={e => set('id', e.target.value)}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-md">
          <div>
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Nome *</label>
            <input
              className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
              placeholder="Bateria"
              value={form.nome}
              onChange={e => set('nome', e.target.value)}
            />
          </div>
          <div>
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Ícone (emoji)</label>
            <input
              className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
              placeholder="🥁"
              value={form.icone}
              onChange={e => set('icone', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Descrição (opcional)</label>
          <textarea
            rows={2}
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring resize-none"
            value={form.descricao}
            onChange={e => set('descricao', e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-sm pt-sm">
          <button onClick={onClose} className="px-md py-sm rounded-lg border border-border text-fg-muted hover:text-fg focus-ring">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.nome.trim() || (!trilha && !form.id.trim())}
            className="px-md py-sm rounded-lg bg-tom text-white font-semibold focus-ring disabled:opacity-50"
          >
            {mut.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Seção de listagem de trilhas
function SecaoTrilhas({
  trilhas,
  onEdit,
  onAdd,
}: {
  trilhas: Trilha[];
  onEdit: (t: Trilha) => void;
  onAdd: () => void;
}) {
  const qc = useQueryClient();
  const desativarMut = useMutation({
    mutationFn: (id: string) => deletarTrilha(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-trilhas'] });
      showToast({ kind: 'success', title: 'Trilha desativada.' });
    },
    onError: e => showToast({ kind: 'error', title: 'Erro', msg: (e as Error).message }),
  });

  return (
    <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between p-md border-b border-border">
        <h2 className="font-semibold text-fg">Trilhas Pedagógicas</h2>
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-sm text-body-sm bg-tom text-white px-sm py-1.5 rounded-lg font-semibold focus-ring"
        >
          <Plus size={14} /> Adicionar
        </button>
      </div>
      {trilhas.length === 0 ? (
        <p className="px-md py-sm text-body-sm text-fg-muted italic">Nenhuma trilha ativa.</p>
      ) : (
        <ul className="divide-y divide-border">
          {trilhas.map(t => (
            <li key={t.id} className="flex items-center gap-sm px-md py-sm">
              <span className="text-xl shrink-0">{t.icone ?? '🎵'}</span>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-fg">{t.nome}</span>
                <span className="text-[11px] text-fg-muted ml-2">({t.id})</span>
                {t.descricao && (
                  <p className="text-body-sm text-fg-muted truncate">{t.descricao}</p>
                )}
              </div>
              <div className="flex items-center gap-sm shrink-0">
                <button
                  onClick={() => onEdit(t)}
                  className="p-1 text-fg-muted hover:text-tom focus-ring rounded"
                  title="Editar trilha"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Desativar trilha "${t.nome}"? Os estagiários existentes não são afetados.`)) {
                      desativarMut.mutate(t.id);
                    }
                  }}
                  disabled={desativarMut.isPending}
                  className="p-1 text-fg-muted hover:text-danger focus-ring rounded"
                  title="Desativar trilha"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Form de Pilar ---
interface PilarForm {
  codigo: string;
  nome: string;
  descricao_breve: string;
  foco: string;
  icone: string;
  sort_order: string;
}

const PILAR_FORM_VAZIO: PilarForm = {
  codigo: '',
  nome: '',
  descricao_breve: '',
  foco: '',
  icone: 'BookOpen',
  sort_order: '',
};

// --- Form de Checkpoint ---
interface CheckpointForm {
  id: string;
  titulo: string;
  descricao: string;
  criterio: string;
  trilha_id: string;  // '' = universal (NULL no banco)
  sort_order: string;
}

const CP_FORM_VAZIO: CheckpointForm = {
  id: '',
  titulo: '',
  descricao: '',
  criterio: '',
  trilha_id: '',
  sort_order: '',
};

// --- Modal genérico ---
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-md overflow-y-auto">
      <div className="bg-bg-surface rounded-lg border border-border w-full max-w-lg my-md">
        <div className="flex items-center justify-between p-md border-b border-border">
          <h2 className="font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg focus-ring rounded">✕</button>
        </div>
        <div className="p-md">{children}</div>
      </div>
    </div>
  );
}

// --- Modal de Pilar ---
function ModalPilar({
  pilar,
  onClose,
  maxSortOrder,
}: {
  pilar: Pilar | null;
  onClose: () => void;
  maxSortOrder: number;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PilarForm>(
    pilar
      ? {
          codigo: pilar.codigo,
          nome: pilar.nome,
          descricao_breve: pilar.descricao_breve ?? '',
          foco: pilar.foco ?? '',
          icone: pilar.icone,
          sort_order: String(pilar.sort_order),
        }
      : { ...PILAR_FORM_VAZIO, sort_order: String(maxSortOrder + 1) },
  );

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        codigo: form.codigo.trim(),
        nome: form.nome.trim(),
        descricao_breve: form.descricao_breve.trim() || undefined,
        foco: form.foco.trim() || undefined,
        icone: form.icone || 'BookOpen',
        sort_order: form.sort_order ? parseInt(form.sort_order) : maxSortOrder + 1,
      };
      if (pilar) {
        return atualizarPilar(pilar.id, payload);
      }
      return criarPilar(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-pilares'] });
      showToast({ kind: 'success', title: pilar ? 'Pilar atualizado.' : 'Pilar criado.' });
      onClose();
    },
    onError: e => showToast({ kind: 'error', title: 'Erro', msg: (e as Error).message }),
  });

  function set(k: keyof PilarForm, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  return (
    <Modal title={pilar ? 'Editar pilar' : 'Adicionar pilar'} onClose={onClose}>
      <div className="space-y-md">
        <div className="grid grid-cols-2 gap-md">
          <div>
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Código *</label>
            <input
              className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
              placeholder="p5"
              value={form.codigo}
              disabled={!!pilar}
              onChange={e => set('codigo', e.target.value)}
            />
          </div>
          <div>
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Sort order</label>
            <input
              type="number"
              className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
              value={form.sort_order}
              onChange={e => set('sort_order', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Nome *</label>
          <input
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
            placeholder="Ex: Teoria Musical"
            value={form.nome}
            onChange={e => set('nome', e.target.value)}
          />
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Descrição breve</label>
          <input
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
            placeholder="Resumo em uma frase"
            value={form.descricao_breve}
            onChange={e => set('descricao_breve', e.target.value)}
          />
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Foco (banner de destaque)</label>
          <textarea
            rows={2}
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring resize-none"
            placeholder="Texto exibido em banner amarelo na tela de avaliação"
            value={form.foco}
            onChange={e => set('foco', e.target.value)}
          />
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Ícone</label>
          <CustomSelect
            value={form.icone}
            onChange={v => set('icone', v)}
            options={ICONE_OPCOES}
          />
        </div>

        <div className="flex justify-end gap-sm pt-sm">
          <button onClick={onClose} className="px-md py-sm rounded-lg border border-border text-fg-muted hover:text-fg focus-ring">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.codigo.trim() || !form.nome.trim()}
            className="px-md py-sm rounded-lg bg-tom text-white font-semibold focus-ring disabled:opacity-50"
          >
            {mut.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --- Modal de Checkpoint ---
function ModalCheckpoint({
  checkpoint,
  pilar,
  checkpointsDoPilar,
  trilhas,
  onClose,
}: {
  checkpoint: Checkpoint | null;
  pilar: Pilar;
  checkpointsDoPilar: Checkpoint[];
  trilhas: Trilha[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const nextSortOrder = checkpointsDoPilar.length + 1;
  const suggestedId = `${pilar.codigo}.${nextSortOrder}`;

  const [form, setForm] = useState<CheckpointForm>(
    checkpoint
      ? {
          id: checkpoint.id,
          titulo: checkpoint.titulo,
          descricao: checkpoint.descricao,
          criterio: checkpoint.criterio,
          trilha_id: checkpoint.trilha_id ?? '',
          sort_order: String(checkpoint.sort_order),
        }
      : { ...CP_FORM_VAZIO, id: suggestedId, sort_order: String(nextSortOrder) },
  );

  const trilhaOpcoes = [
    { value: '', label: 'Universal (todas as trilhas)' },
    ...trilhas.map(t => ({ value: t.id, label: `${t.icone ?? ''} ${t.nome}`.trim() })),
  ];

  const mut = useMutation({
    mutationFn: async () => {
      const sortOrder = form.sort_order ? parseInt(form.sort_order) : nextSortOrder;
      const trilhaId = form.trilha_id.trim() || null;
      if (checkpoint) {
        return atualizarCheckpoint(checkpoint.id, {
          titulo: form.titulo.trim(),
          descricao: form.descricao.trim(),
          criterio: form.criterio.trim(),
          trilha_id: trilhaId,
          sort_order: sortOrder,
        });
      }
      return criarCheckpoint({
        id: form.id.trim(),
        pilar: pilar.codigo,
        pilar_id: pilar.id,
        pilar_nome: pilar.nome,
        titulo: form.titulo.trim(),
        descricao: form.descricao.trim(),
        criterio: form.criterio.trim(),
        trilha_id: trilhaId,
        sort_order: sortOrder,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-checkpoints'] });
      showToast({ kind: 'success', title: checkpoint ? 'Checkpoint atualizado.' : 'Checkpoint criado.' });
      onClose();
    },
    onError: e => showToast({ kind: 'error', title: 'Erro', msg: (e as Error).message }),
  });

  function set(k: keyof CheckpointForm, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  return (
    <Modal title={checkpoint ? 'Editar checkpoint' : 'Adicionar checkpoint'} onClose={onClose}>
      <div className="space-y-md">
        <div className="grid grid-cols-2 gap-md">
          <div>
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">ID *</label>
            <input
              className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
              placeholder={suggestedId}
              value={form.id}
              disabled={!!checkpoint}
              onChange={e => set('id', e.target.value)}
            />
          </div>
          <div>
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Sort order</label>
            <input
              type="number"
              className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
              value={form.sort_order}
              onChange={e => set('sort_order', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Título *</label>
          <input
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring"
            value={form.titulo}
            onChange={e => set('titulo', e.target.value)}
          />
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Descrição *</label>
          <textarea
            rows={3}
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring resize-none"
            value={form.descricao}
            onChange={e => set('descricao', e.target.value)}
          />
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Critério de ancoragem *</label>
          <textarea
            rows={3}
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring resize-none"
            value={form.criterio}
            onChange={e => set('criterio', e.target.value)}
          />
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Trilha</label>
          <CustomSelect
            value={form.trilha_id}
            onChange={v => set('trilha_id', v)}
            options={trilhaOpcoes}
          />
        </div>

        <div className="flex justify-end gap-sm pt-sm">
          <button onClick={onClose} className="px-md py-sm rounded-lg border border-border text-fg-muted hover:text-fg focus-ring">
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.id.trim() || !form.titulo.trim() || !form.descricao.trim() || !form.criterio.trim()}
            className="px-md py-sm rounded-lg bg-tom text-white font-semibold focus-ring disabled:opacity-50"
          >
            {mut.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --- Card de Pilar com checkpoints ---
function PilarAdminCard({
  pilar,
  checkpoints,
  trilhas,
  onEditPilar,
  onAddCheckpoint,
  onEditCheckpoint,
}: {
  pilar: Pilar;
  checkpoints: Checkpoint[];
  trilhas: Trilha[];
  onEditPilar: (p: Pilar) => void;
  onAddCheckpoint: (p: Pilar) => void;
  onEditCheckpoint: (cp: Checkpoint, p: Pilar) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const qc = useQueryClient();

  const deletePilarMut = useMutation({
    mutationFn: () => deletarPilar(pilar.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-pilares'] });
      showToast({ kind: 'success', title: 'Pilar removido.' });
    },
    onError: e => showToast({ kind: 'error', title: 'Erro ao remover pilar', msg: (e as Error).message }),
  });

  const deleteCpMut = useMutation({
    mutationFn: (cpId: string) => deletarCheckpoint(cpId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-checkpoints'] });
      showToast({ kind: 'success', title: 'Checkpoint removido.' });
    },
    onError: e => showToast({ kind: 'error', title: 'Erro ao remover checkpoint', msg: (e as Error).message }),
  });

  function handleDeletePilar() {
    if (!pilar.editavel) return;
    if (confirm(`Remover pilar "${pilar.nome}"? Os checkpoints vinculados também serão removidos.`)) {
      deletePilarMut.mutate();
    }
  }

  function handleDeleteCp(cp: Checkpoint) {
    if (confirm(`Remover checkpoint "${cp.titulo}"?`)) {
      deleteCpMut.mutate(cp.id);
    }
  }

  return (
    <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
      {/* Header do pilar */}
      <div className="flex items-center gap-sm p-md">
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-fg-muted hover:text-fg focus-ring rounded"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-sm">
            <span className="font-semibold text-fg">{pilar.nome}</span>
            <span className="text-[11px] text-fg-muted">({pilar.codigo})</span>
            {!pilar.editavel && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-bg-app text-fg-muted font-semibold">
                <Lock size={10} /> Bloqueado
              </span>
            )}
          </div>
          {pilar.descricao_breve && (
            <p className="text-body-sm text-fg-muted mt-0.5">{pilar.descricao_breve}</p>
          )}
        </div>

        {pilar.editavel && (
          <div className="flex items-center gap-sm shrink-0">
            <button
              onClick={() => onEditPilar(pilar)}
              className="p-1 text-fg-muted hover:text-tom focus-ring rounded"
              title="Editar pilar"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={handleDeletePilar}
              disabled={deletePilarMut.isPending}
              className="p-1 text-fg-muted hover:text-danger focus-ring rounded"
              title="Remover pilar"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Checkpoints */}
      {expanded && (
        <div className="border-t border-border">
          {checkpoints.length === 0 ? (
            <p className="px-md py-sm text-body-sm text-fg-muted italic">Nenhum checkpoint ainda.</p>
          ) : (
            <ul className="divide-y divide-border">
              {checkpoints.map(cp => (
                <li key={cp.id} className="flex items-start gap-sm px-md py-sm">
                  <span className="text-[11px] text-fg-muted font-mono shrink-0 mt-0.5">[{cp.id}]</span>
                  <span className="text-body-sm text-fg flex-1">{cp.titulo}</span>
                  {cp.trilha_id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-app text-fg-muted shrink-0">
                      {trilhas.find(t => t.id === cp.trilha_id)?.icone ?? ''} {cp.trilha_id}
                    </span>
                  )}
                  <div className="flex items-center gap-sm shrink-0">
                    <button
                      onClick={() => onEditCheckpoint(cp, pilar)}
                      className="p-1 text-fg-muted hover:text-tom focus-ring rounded"
                      title="Editar checkpoint"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDeleteCp(cp)}
                      disabled={deleteCpMut.isPending}
                      className="p-1 text-fg-muted hover:text-danger focus-ring rounded"
                      title="Remover checkpoint"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="px-md py-sm border-t border-border">
            <button
              onClick={() => onAddCheckpoint(pilar)}
              className="inline-flex items-center gap-sm text-body-sm text-tom hover:underline focus-ring"
            >
              <Plus size={14} /> Adicionar checkpoint
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Tela principal ---
export function LaEducaAdminTrilhaPage() {
  const { data: pilares, isLoading: pilaresLoading } = useQuery({
    queryKey: ['laeduca-pilares'],
    queryFn: fetchPilares,
    staleTime: 30_000,
  });
  const { data: checkpoints, isLoading: cpsLoading } = useQuery({
    queryKey: ['laeduca-checkpoints'],
    queryFn: fetchCheckpoints,
    staleTime: 30_000,
  });
  const { data: trilhas = [], isLoading: trilhasLoading } = useQuery({
    queryKey: ['laeduca-trilhas'],
    queryFn: fetchTrilhas,
    staleTime: 60_000,
  });

  const [modalPilar, setModalPilar] = useState<{ open: boolean; pilar: Pilar | null }>({ open: false, pilar: null });
  const [modalCp, setModalCp] = useState<{ open: boolean; checkpoint: Checkpoint | null; pilar: Pilar | null }>({
    open: false, checkpoint: null, pilar: null,
  });
  const [modalTrilha, setModalTrilha] = useState<{ open: boolean; trilha: Trilha | null }>({ open: false, trilha: null });

  const checkpointsByPilar = useMemo(() => {
    const map: Record<string, Checkpoint[]> = {};
    for (const cp of checkpoints ?? []) {
      if (!map[cp.pilar]) map[cp.pilar] = [];
      map[cp.pilar].push(cp);
    }
    return map;
  }, [checkpoints]);

  const maxSortOrder = useMemo(
    () => Math.max(0, ...(pilares ?? []).map(p => p.sort_order)),
    [pilares],
  );

  if (pilaresLoading || cpsLoading || trilhasLoading) return <LoadingState />;

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader
        title="Administração — LA EDUCA"
        backTo="/la-educa"
      />

      {/* Seção Trilhas */}
      <SecaoTrilhas
        trilhas={trilhas}
        onEdit={t => setModalTrilha({ open: true, trilha: t })}
        onAdd={() => setModalTrilha({ open: true, trilha: null })}
      />

      {/* Seção Pilares */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-fg">Pilares e Checkpoints</h2>
        <button
          onClick={() => setModalPilar({ open: true, pilar: null })}
          className="inline-flex items-center gap-sm bg-tom text-white px-md py-sm rounded-lg font-semibold focus-ring"
        >
          <Plus size={16} /> Adicionar pilar
        </button>
      </div>

      <div className="space-y-md">
        {(pilares ?? []).map(pilar => (
          <PilarAdminCard
            key={pilar.id}
            pilar={pilar}
            checkpoints={checkpointsByPilar[pilar.codigo] ?? []}
            trilhas={trilhas}
            onEditPilar={p => setModalPilar({ open: true, pilar: p })}
            onAddCheckpoint={p => setModalCp({ open: true, checkpoint: null, pilar: p })}
            onEditCheckpoint={(cp, p) => setModalCp({ open: true, checkpoint: cp, pilar: p })}
          />
        ))}
      </div>

      {modalTrilha.open && (
        <ModalTrilha
          trilha={modalTrilha.trilha}
          onClose={() => setModalTrilha({ open: false, trilha: null })}
        />
      )}

      {modalPilar.open && (
        <ModalPilar
          pilar={modalPilar.pilar}
          maxSortOrder={maxSortOrder}
          onClose={() => setModalPilar({ open: false, pilar: null })}
        />
      )}

      {modalCp.open && modalCp.pilar && (
        <ModalCheckpoint
          checkpoint={modalCp.checkpoint}
          pilar={modalCp.pilar}
          checkpointsDoPilar={checkpointsByPilar[modalCp.pilar.codigo] ?? []}
          trilhas={trilhas}
          onClose={() => setModalCp({ open: false, checkpoint: null, pilar: null })}
        />
      )}
    </div>
  );
}
