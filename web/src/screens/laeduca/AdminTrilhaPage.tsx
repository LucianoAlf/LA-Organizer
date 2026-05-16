// Tela administrativa — LA EDUCA — abordagem trilha-first (Sprint 22.27)
// Layout: seletor de trilha no topo → pilares P1-P4 expandidos com checkpoints filtrados
import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { CustomSelect } from '../../components/CustomSelect';
import { showToast } from '../../components/Toast';
import {
  fetchPilares,
  fetchCheckpoints,
  atualizarPilar,
  criarCheckpoint,
  atualizarCheckpoint,
  deletarCheckpoint,
  fetchTrilhas,
  criarTrilha,
  atualizarTrilha,
  deletarTrilha,
} from '../../lib/laeduca';
import type { Pilar, Checkpoint, Trilha } from '../../lib/laeduca-types';

// ─── Ícones disponíveis para pilares ─────────────────────────────────────────
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

// ─── Modal genérico ───────────────────────────────────────────────────────────
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-md overflow-y-auto">
      <div className="bg-bg-surface rounded-lg border border-border w-full max-w-lg my-md">
        <div className="flex items-center justify-between p-md border-b border-border">
          <h2 className="font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg focus-ring rounded px-1">
            ✕
          </button>
        </div>
        <div className="p-md">{children}</div>
      </div>
    </div>
  );
}

// ─── Tipos de form ────────────────────────────────────────────────────────────
interface TrilhaForm {
  id: string;
  nome: string;
  icone: string;
  descricao: string;
}

interface PilarForm {
  nome: string;
  descricao_breve: string;
  foco: string;
  icone: string;
}

interface CheckpointForm {
  id: string;
  titulo: string;
  descricao: string;
  criterio: string;
  sort_order: string;
}

// ─── Modal de Trilha ──────────────────────────────────────────────────────────
function ModalTrilha({
  trilha,
  onClose,
  onSaveSuccess,
}: {
  trilha: Trilha | null;
  onClose: () => void;
  onSaveSuccess?: (newId: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<TrilhaForm>(
    trilha
      ? { id: trilha.id, nome: trilha.nome, icone: trilha.icone ?? '', descricao: trilha.descricao ?? '' }
      : { id: '', nome: '', icone: '', descricao: '' },
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
      if (!trilha && onSaveSuccess) {
        onSaveSuccess(form.id.trim().toLowerCase().replace(/\s+/g, '-'));
      }
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
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">
              ID * (slug, ex: bateria-eletrica)
            </label>
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
          <button
            onClick={onClose}
            className="px-md py-sm rounded-lg border border-border text-fg-muted hover:text-fg focus-ring"
          >
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

// ─── Modal de Pilar ───────────────────────────────────────────────────────────
function ModalPilar({ pilar, onClose }: { pilar: Pilar; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PilarForm>({
    nome: pilar.nome,
    descricao_breve: pilar.descricao_breve ?? '',
    foco: pilar.foco ?? '',
    icone: pilar.icone,
  });

  const mut = useMutation({
    mutationFn: () =>
      atualizarPilar(pilar.id, {
        nome: form.nome.trim(),
        descricao_breve: form.descricao_breve.trim() || null,
        foco: form.foco.trim() || null,
        icone: form.icone || 'BookOpen',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-pilares'] });
      showToast({ kind: 'success', title: 'Pilar atualizado.' });
      onClose();
    },
    onError: e => showToast({ kind: 'error', title: 'Erro', msg: (e as Error).message }),
  });

  function set(k: keyof PilarForm, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  return (
    <Modal title={`Editar pilar — ${pilar.codigo.toUpperCase()}`} onClose={onClose}>
      <div className="space-y-md">
        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Código</label>
          <input
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring opacity-60"
            value={pilar.codigo}
            disabled
          />
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
            rows={7}
            className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring resize-y min-h-[160px]"
            placeholder="Texto exibido em banner amarelo na tela de avaliação do pilar"
            value={form.foco}
            onChange={e => set('foco', e.target.value)}
          />
        </div>

        <div>
          <label className="text-body-sm font-semibold text-fg-muted mb-1 block">Ícone</label>
          <CustomSelect value={form.icone} onChange={v => set('icone', v)} options={ICONE_OPCOES} />
        </div>

        <div className="flex justify-end gap-sm pt-sm">
          <button
            onClick={onClose}
            className="px-md py-sm rounded-lg border border-border text-fg-muted hover:text-fg focus-ring"
          >
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.nome.trim()}
            className="px-md py-sm rounded-lg bg-tom text-white font-semibold focus-ring disabled:opacity-50"
          >
            {mut.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal de Checkpoint ──────────────────────────────────────────────────────
function ModalCheckpoint({
  checkpoint,
  pilar,
  trilhaSelecionada,
  isUniversal,
  checkpointsDoPilar,
  onClose,
}: {
  checkpoint: Checkpoint | null;
  pilar: Pilar;
  trilhaSelecionada: Trilha;
  isUniversal: boolean; // true para P1/P3/P4
  checkpointsDoPilar: Checkpoint[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const nextNum = checkpointsDoPilar.length + 1;

  // Sugestão de ID: universal usa `p1.7`, específico usa `p2-bateria.6`
  const suggestedId = isUniversal
    ? `${pilar.codigo}.${nextNum}`
    : `${pilar.codigo}-${trilhaSelecionada.id}.${nextNum}`;

  const [form, setForm] = useState<CheckpointForm>(
    checkpoint
      ? {
          id: checkpoint.id,
          titulo: checkpoint.titulo,
          descricao: checkpoint.descricao,
          criterio: checkpoint.criterio,
          sort_order: String(checkpoint.sort_order),
        }
      : { id: suggestedId, titulo: '', descricao: '', criterio: '', sort_order: String(nextNum) },
  );

  const mut = useMutation({
    mutationFn: async () => {
      const sortOrder = form.sort_order ? parseInt(form.sort_order) : nextNum;
      const trilhaId = isUniversal ? null : trilhaSelecionada.id;
      if (checkpoint) {
        return atualizarCheckpoint(checkpoint.id, {
          titulo: form.titulo.trim(),
          descricao: form.descricao.trim(),
          criterio: form.criterio.trim(),
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

  const isEditing = !!checkpoint;
  const titleModal = isEditing ? 'Editar checkpoint' : `Adicionar checkpoint${isUniversal ? ' universal' : ` de ${trilhaSelecionada.nome}`}`;

  return (
    <Modal title={titleModal} onClose={onClose}>
      <div className="space-y-md">
        {/* Banner de aviso universal */}
        {isUniversal && (
          <div className="flex gap-sm items-start bg-yellow-50 border border-yellow-300 rounded-lg px-sm py-sm text-yellow-800 text-body-sm">
            <span className="shrink-0 mt-0.5">⚠️</span>
            <span>
              <strong>Checkpoint universal</strong> — afeta TODOS os estagiários de TODAS as trilhas.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-md">
          <div>
            <label className="text-body-sm font-semibold text-fg-muted mb-1 block">ID *</label>
            <input
              className="w-full border border-border rounded-lg px-sm py-sm text-fg bg-bg-app focus-ring disabled:opacity-60"
              placeholder={suggestedId}
              value={form.id}
              disabled={isEditing}
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

        <div className="flex justify-end gap-sm pt-sm">
          <button
            onClick={onClose}
            className="px-md py-sm rounded-lg border border-border text-fg-muted hover:text-fg focus-ring"
          >
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={
              mut.isPending ||
              (!isEditing && !form.id.trim()) ||
              !form.titulo.trim() ||
              !form.descricao.trim() ||
              !form.criterio.trim()
            }
            className="px-md py-sm rounded-lg bg-tom text-white font-semibold focus-ring disabled:opacity-50"
          >
            {mut.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Card de Pilar ────────────────────────────────────────────────────────────
function PilarCard({
  pilar,
  checkpoints,
  trilhaSelecionada,
  isUniversal,
  onEditPilar,
  onAddCheckpoint,
  onEditCheckpoint,
}: {
  pilar: Pilar;
  checkpoints: Checkpoint[];
  trilhaSelecionada: Trilha;
  isUniversal: boolean;
  onEditPilar: (p: Pilar) => void;
  onAddCheckpoint: (p: Pilar) => void;
  onEditCheckpoint: (cp: Checkpoint, p: Pilar) => void;
}) {
  const qc = useQueryClient();

  const deleteCpMut = useMutation({
    mutationFn: (cpId: string) => deletarCheckpoint(cpId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['laeduca-checkpoints'] });
      showToast({ kind: 'success', title: 'Checkpoint removido.' });
    },
    onError: e => showToast({ kind: 'error', title: 'Erro', msg: (e as Error).message }),
  });

  function handleDeleteCp(cp: Checkpoint) {
    const msg = isUniversal
      ? `Você tem certeza? Isto removerá o checkpoint "${cp.titulo}" de TODAS as trilhas e remove avaliações pendentes dele em TODOS os estagiários.`
      : `Remover checkpoint "${cp.titulo}"?`;
    if (confirm(msg)) {
      deleteCpMut.mutate(cp.id);
    }
  }

  const checkpointIcon = isUniversal ? '🌐' : (trilhaSelecionada.icone ?? '🎵');
  const addLabel = isUniversal
    ? '+ Adicionar checkpoint universal'
    : `+ Adicionar checkpoint de ${trilhaSelecionada.nome}`;

  return (
    <div className="bg-bg-surface rounded-lg border border-border overflow-hidden">
      {/* Header do pilar */}
      <div className="flex items-start justify-between gap-sm p-md border-b border-border">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-sm flex-wrap">
            <span className="font-semibold text-fg">
              {pilar.codigo.toUpperCase()} · {pilar.nome}
            </span>
            <span className="ml-auto text-[12px] font-mono text-fg-muted shrink-0">
              {checkpoints.length}
            </span>
          </div>
          {pilar.descricao_breve && (
            <p className="text-body-sm text-fg-muted mt-0.5">{pilar.descricao_breve}</p>
          )}
        </div>
        <button
          onClick={() => onEditPilar(pilar)}
          className="shrink-0 inline-flex items-center gap-1 text-body-sm text-fg-muted hover:text-tom border border-border rounded px-sm py-1 focus-ring"
          title="Editar pilar"
        >
          <Pencil size={13} /> Editar pilar
        </button>
      </div>

      {/* Lista de checkpoints */}
      <div>
        {checkpoints.length === 0 ? (
          <p className="px-md py-sm text-body-sm text-fg-muted italic">Nenhum checkpoint ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {checkpoints.map(cp => (
              <li key={cp.id} className="flex items-center gap-sm px-md py-sm">
                <span className="text-[11px] text-fg-muted font-mono shrink-0">[{cp.id}]</span>
                <span className="text-sm shrink-0">{checkpointIcon}</span>
                <span className="text-body-sm text-fg flex-1 min-w-0">{cp.titulo}</span>
                <div className="flex items-center gap-1 shrink-0">
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
            className="inline-flex items-center gap-1 text-body-sm text-tom hover:underline focus-ring"
          >
            <Plus size={14} /> {addLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tela principal ───────────────────────────────────────────────────────────
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
  const { data: trilhasRaw = [], isLoading: trilhasLoading } = useQuery({
    queryKey: ['laeduca-trilhas'],
    queryFn: fetchTrilhas,
    staleTime: 60_000,
  });

  // Apenas trilhas ativas
  const trilhas = useMemo(() => trilhasRaw.filter(t => t.is_active), [trilhasRaw]);

  // Trilha selecionada — default 'padrao' ou primeira disponível
  const [trilhaId, setTrilhaId] = useState<string>('padrao');
  const trilhaSelecionada: Trilha | undefined = useMemo(
    () => trilhas.find(t => t.id === trilhaId) ?? trilhas[0],
    [trilhas, trilhaId],
  );

  // Modais
  const [modalTrilha, setModalTrilha] = useState<{ open: boolean; trilha: Trilha | null }>({
    open: false,
    trilha: null,
  });
  const [modalPilar, setModalPilar] = useState<{ open: boolean; pilar: Pilar | null }>({
    open: false,
    pilar: null,
  });
  const [modalCp, setModalCp] = useState<{
    open: boolean;
    checkpoint: Checkpoint | null;
    pilar: Pilar | null;
  }>({ open: false, checkpoint: null, pilar: null });

  // Fecha modais ao trocar trilha
  function handleTrilhaChange(id: string) {
    setTrilhaId(id);
    setModalCp({ open: false, checkpoint: null, pilar: null });
    setModalPilar({ open: false, pilar: null });
  }

  // Delete trilha
  const qc = useQueryClient();
  const deleteTrilhaMut = useMutation({
    mutationFn: (id: string) => deletarTrilha(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['laeduca-trilhas'] });
      showToast({ kind: 'success', title: 'Trilha desativada.' });
      // Se era a trilha selecionada, voltar pra padrao
      if (id === trilhaId) setTrilhaId('padrao');
    },
    onError: e => showToast({ kind: 'error', title: 'Erro', msg: (e as Error).message }),
  });

  // Checkpoints por pilar (codigo) filtrados conforme contexto
  const checkpointsByPilar = useMemo(() => {
    const all = checkpoints ?? [];
    const map: Record<string, Checkpoint[]> = {};
    if (!trilhaSelecionada) return map;
    for (const pilar of pilares ?? []) {
      const isP2 = pilar.codigo === 'p2';
      map[pilar.codigo] = all.filter(cp => {
        if (isP2) {
          // P2: checkpoints específicos da trilha selecionada
          return cp.pilar === pilar.codigo && cp.trilha_id === trilhaSelecionada.id;
        }
        // P1/P3/P4: checkpoints universais
        return cp.pilar === pilar.codigo && cp.trilha_id === null;
      });
    }
    return map;
  }, [checkpoints, pilares, trilhaSelecionada]);

  if (pilaresLoading || cpsLoading || trilhasLoading) return <LoadingState />;

  const trilhaOpcoes = trilhas.map(t => ({
    value: t.id,
    label: `${t.icone ?? '🎵'} ${t.nome}`,
  }));

  const currentTrilhaId = trilhaSelecionada?.id ?? trilhaId;
  const isPadrao = currentTrilhaId === 'padrao';

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader title="Administração — LA EDUCA" backTo="/la-educa" />

      {/* ── Seletor de trilha ── */}
      <div className="bg-bg-surface rounded-lg border border-border p-md space-y-sm">
        {/* Header: título + ação global "Nova trilha" */}
        <div className="flex items-center justify-between gap-sm">
          <p className="text-body-sm font-semibold text-fg-muted uppercase tracking-wide">
            Trilha selecionada
          </p>
          <button
            onClick={() => setModalTrilha({ open: true, trilha: null })}
            className="inline-flex items-center gap-1 text-body-sm bg-tom text-white px-sm py-1.5 rounded font-semibold focus-ring"
          >
            <Plus size={14} /> Nova trilha
          </button>
        </div>

        {/* Dropdown da trilha (full width) */}
        <CustomSelect
          value={currentTrilhaId}
          onChange={handleTrilhaChange}
          options={trilhaOpcoes}
          placeholder="Selecionar trilha…"
        />

        {/* Ações da trilha selecionada (agrupadas) */}
        {trilhaSelecionada && (
          <div className="flex items-center gap-sm">
            <button
              onClick={() => setModalTrilha({ open: true, trilha: trilhaSelecionada })}
              className="inline-flex items-center gap-1 text-body-sm border border-border bg-bg-surface hover:border-tom text-fg px-sm py-1.5 rounded focus-ring"
            >
              <Pencil size={13} /> Editar trilha
            </button>
            {!isPadrao && (
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Desativar trilha "${trilhaSelecionada.nome}"? Os estagiários existentes não são afetados.`,
                    )
                  ) {
                    deleteTrilhaMut.mutate(trilhaSelecionada.id);
                  }
                }}
                disabled={deleteTrilhaMut.isPending}
                className="inline-flex items-center gap-1 text-body-sm border border-border bg-bg-surface hover:border-danger text-fg-muted hover:text-danger px-sm py-1.5 rounded focus-ring"
              >
                <Trash2 size={13} /> Desativar trilha
              </button>
            )}
          </div>
        )}

        {trilhaSelecionada?.descricao && (
          <p className="text-body-sm text-fg-muted">{trilhaSelecionada.descricao}</p>
        )}
      </div>

      {/* ── Pilares da trilha ── */}
      {trilhaSelecionada && (
        <>
          <h2 className="font-semibold text-fg">
            PILARES DA TRILHA — {trilhaSelecionada.nome.toUpperCase()}
          </h2>

          <div className="space-y-md">
            {(pilares ?? []).map(pilar => {
              const isUniversal = pilar.codigo !== 'p2';
              const cps = checkpointsByPilar[pilar.codigo] ?? [];
              return (
                <PilarCard
                  key={pilar.id}
                  pilar={pilar}
                  checkpoints={cps}
                  trilhaSelecionada={trilhaSelecionada}
                  isUniversal={isUniversal}
                  onEditPilar={p => setModalPilar({ open: true, pilar: p })}
                  onAddCheckpoint={p => setModalCp({ open: true, checkpoint: null, pilar: p })}
                  onEditCheckpoint={(cp, p) => setModalCp({ open: true, checkpoint: cp, pilar: p })}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Modais ── */}
      {modalTrilha.open && (
        <ModalTrilha
          trilha={modalTrilha.trilha}
          onClose={() => setModalTrilha({ open: false, trilha: null })}
          onSaveSuccess={newId => setTrilhaId(newId)}
        />
      )}

      {modalPilar.open && modalPilar.pilar && (
        <ModalPilar
          pilar={modalPilar.pilar}
          onClose={() => setModalPilar({ open: false, pilar: null })}
        />
      )}

      {modalCp.open && modalCp.pilar && trilhaSelecionada && (
        <ModalCheckpoint
          checkpoint={modalCp.checkpoint}
          pilar={modalCp.pilar}
          trilhaSelecionada={trilhaSelecionada}
          isUniversal={modalCp.pilar.codigo !== 'p2'}
          checkpointsDoPilar={checkpointsByPilar[modalCp.pilar.codigo] ?? []}
          onClose={() => setModalCp({ open: false, checkpoint: null, pilar: null })}
        />
      )}
    </div>
  );
}
