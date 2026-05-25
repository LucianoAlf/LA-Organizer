import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, Eye, EyeOff, Pencil, Copy, Check, AlertCircle, Search, Trash2,
  ShieldCheck, CheckCircle2, AlertTriangle, AlertOctagon, MinusCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingState } from '../components/LoadingState';
import { showToast } from '../components/Toast';
import { CustomSelect } from '../components/CustomSelect';
import { KpiCard } from '../components/KpiCard';

export type Categoria = 'whatsapp' | 'api_key' | 'token' | 'vps' | 'social' | 'email' | 'plataforma' | 'outro';
export type Status = 'ok' | 'atencao' | 'critico';
type Campo = { label: string; valor: string; sensivel: boolean };

export type CredRow = {
  id: string;
  nome: string;
  categoria: Categoria;
  servico: string | null;
  projeto: string | null;
  responsavel: string | null;
  campos_count: number;
  status: Status;
};

type CredFull = CredRow & { campos: Campo[]; url_ref: string | null; observacoes: string | null };

const CATEGORIA_LABELS: Record<Categoria, string> = {
  whatsapp: 'WhatsApp', api_key: 'API Key', token: 'Token', vps: 'VPS',
  social: 'Social', email: 'E-mail', plataforma: 'Plataforma', outro: 'Outro',
};

const CATEGORIA_BADGE: Record<Categoria, string> = {
  whatsapp:   'bg-green-500/10  text-green-400  border-green-500/25',
  api_key:    'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
  token:      'bg-purple-500/10 text-purple-400 border-purple-500/25',
  vps:        'bg-red-500/10    text-red-400    border-red-500/25',
  social:     'bg-pink-500/10   text-pink-400   border-pink-500/25',
  email:      'bg-blue-500/10   text-blue-400   border-blue-500/25',
  plataforma: 'bg-cyan-500/10   text-cyan-400   border-cyan-500/25',
  outro:      'bg-fg-muted/10   text-fg-muted   border-fg-muted/20',
};

const STATUS_BADGE: Record<Status, string> = {
  ok:      'bg-green-500/10  text-green-400  border-green-500/25',
  atencao: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
  critico: 'bg-red-500/10    text-red-400    border-red-500/25',
};

const STATUS_DOT: Record<Status, string> = {
  ok: 'bg-green-400', atencao: 'bg-yellow-400', critico: 'bg-red-400',
};

const STATUS_LABELS: Record<Status, string> = {
  ok: 'OK', atencao: 'Atenção', critico: 'Crítico',
};

const CATEGORIA_OPTIONS: { value: Categoria; label: string }[] = [
  { value: 'whatsapp',   label: 'WhatsApp'  },
  { value: 'api_key',    label: 'API Key'   },
  { value: 'token',      label: 'Token'     },
  { value: 'vps',        label: 'VPS'       },
  { value: 'social',     label: 'Social'    },
  { value: 'email',      label: 'E-mail'    },
  { value: 'plataforma', label: 'Plataforma'},
  { value: 'outro',      label: 'Outro'     },
];

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'ok',      label: 'OK'      },
  { value: 'atencao', label: 'Atenção' },
  { value: 'critico', label: 'Crítico' },
];

type Filter = 'todos' | Categoria;

const FILTER_OPTIONS: { key: Filter; label: string }[] = [
  { key: 'todos',      label: 'Todos'     },
  { key: 'whatsapp',   label: 'WhatsApp'  },
  { key: 'api_key',    label: 'API Key'   },
  { key: 'token',      label: 'Token'     },
  { key: 'vps',        label: 'VPS'       },
  { key: 'social',     label: 'Social'    },
  { key: 'email',      label: 'E-mail'    },
  { key: 'plataforma', label: 'Plataforma'},
  { key: 'outro',      label: 'Outro'     },
];


async function copyToClipboard(val: string) {
  await navigator.clipboard.writeText(val);
  showToast({ kind: 'success', title: 'Copiado!' });
}

export function GovernancaPage() {
  const queryClient = useQueryClient();

  // ── List state ─────────────────────────────────────────
  const [search,        setSearch]        = useState('');
  const [filter,        setFilter]        = useState<Filter>('todos');

  // ── Drawer state ────────────────────────────────────────
  const [drawerMode,   setDrawerMode]   = useState<'none' | 'create' | 'detail'>('none');
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [deleting,     setDeleting]     = useState(false);
  const drawerOpen = drawerMode !== 'none';

  // Shared form state (create + edit)
  const [nome,        setNome]        = useState('');
  const [categoria,   setCategoria]   = useState<Categoria>('outro');
  const [status,      setStatus]      = useState<Status>('ok');
  const [servico,     setServico]     = useState('');
  const [projeto,     setProjeto]     = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [urlRef,      setUrlRef]      = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [campoRev,    setCampoRev]    = useState<Set<number>>(new Set());

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // ── List query ──────────────────────────────────────────
  const { data, isLoading, error } = useQuery({
    queryKey: ['governance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('governance_credentials')
        .select('id, nome, categoria, servico, projeto, responsavel, campos_count, status')
        .order('categoria').order('nome');
      if (error) throw error;
      return data as CredRow[];
    },
  });

  // ── Detail query ────────────────────────────────────────
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['governance-item', selectedId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('governance_credentials')
        .select('*')
        .eq('id', selectedId!)
        .single();
      if (error) throw error;
      return data as CredFull;
    },
    enabled: !!selectedId && drawerMode === 'detail',
  });

  // Populate form when detail data arrives (url_ref + observacoes)
  useEffect(() => {
    if (detailData && drawerMode === 'detail') {
      setUrlRef(detailData.url_ref ?? '');
      setObservacoes(detailData.observacoes ?? '');
      setCampos(Array.isArray(detailData.campos) ? detailData.campos : []);
    }
  }, [detailData]);

  // ── Create mutation ─────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      const camposValidos = campos.filter(c => c.label.trim() || c.valor.trim());
      const { error } = await supabase.from('governance_credentials').insert({
        nome: nome.trim(), categoria, status,
        servico:     servico.trim()     || null,
        projeto:     projeto.trim()     || null,
        responsavel: responsavel.trim() || null,
        url_ref:     urlRef.trim()      || null,
        observacoes: observacoes.trim() || null,
        campos: camposValidos,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance'] });
      showToast({ kind: 'success', title: 'Credencial salva!' });
      closeDrawer();
    },
    onError: (err: Error) =>
      showToast({ kind: 'error', title: 'Erro ao salvar.', msg: err.message }),
  });

  // ── Update mutation ─────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: async () => {
      const camposValidos = campos.filter(c => c.label.trim() || c.valor.trim());
      const { error } = await supabase
        .from('governance_credentials')
        .update({
          nome: nome.trim(), categoria, status,
          servico:     servico.trim()     || null,
          projeto:     projeto.trim()     || null,
          responsavel: responsavel.trim() || null,
          url_ref:     urlRef.trim()      || null,
          observacoes: observacoes.trim() || null,
          campos: camposValidos,
        })
        .eq('id', selectedId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance'] });
      queryClient.invalidateQueries({ queryKey: ['governance-item', selectedId] });
      showToast({ kind: 'success', title: 'Alterações salvas!' });
      closeDrawer();
    },
    onError: (err: Error) =>
      showToast({ kind: 'error', title: 'Erro ao salvar.', msg: err.message }),
  });

  // ── Drawer helpers ──────────────────────────────────────
  function openCreate() {
    setSelectedId(null);
    setNome(''); setCategoria('outro'); setStatus('ok');
    setServico(''); setProjeto(''); setResponsavel('');
    setUrlRef(''); setObservacoes(''); setCampos([]);
    setCampoRev(new Set());
    setDrawerMode('create');
  }

  function openDetail(row: CredRow) {
    // Pre-populate from list data immediately; detail query fills url_ref + observacoes
    setNome(row.nome);
    setCategoria(row.categoria);
    setStatus(row.status);
    setServico(row.servico ?? '');
    setProjeto(row.projeto ?? '');
    setResponsavel(row.responsavel ?? '');
    setUrlRef('');
    setObservacoes('');
    setCampos([]);
    setCampoRev(new Set());
    setSelectedId(row.id);
    setDrawerMode('detail');
  }

  function closeDrawer() {
    setDrawerMode('none');
    setSelectedId(null);
  }

  function handleDrawerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) {
      showToast({ kind: 'error', title: 'Informe o nome da credencial.' });
      return;
    }
    if (drawerMode === 'create') createMutation.mutate();
    else updateMutation.mutate();
  }

  async function handleDelete() {
    if (!confirm(`Excluir "${nome}"? Esta ação não pode ser desfeita.`)) return;
    setDeleting(true);
    const { error } = await supabase.from('governance_credentials').delete().eq('id', selectedId!);
    setDeleting(false);
    if (error) { showToast({ kind: 'error', title: 'Erro ao excluir.' }); return; }
    queryClient.invalidateQueries({ queryKey: ['governance'] });
    showToast({ kind: 'success', title: 'Credencial excluída.' });
    closeDrawer();
  }

  // ── Campo helpers ───────────────────────────────────────
  function addCampo() {
    setCampos(prev => [...prev, { label: '', valor: '', sensivel: false }]);
  }

  function removeCampo(i: number) {
    setCampos(prev => prev.filter((_, idx) => idx !== i));
    setCampoRev(prev => {
      const next = new Set<number>();
      prev.forEach(n => { if (n < i) next.add(n); else if (n > i) next.add(n - 1); });
      return next;
    });
  }

  function updateCampo(i: number, patch: Partial<Campo>) {
    setCampos(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  function toggleCampoRev(i: number) {
    setCampoRev(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  // ── Stats ───────────────────────────────────────────────
  const rows = data ?? [];
  const total      = rows.length;
  const countOk    = rows.filter(c => c.status === 'ok').length;
  const countAtenc = rows.filter(c => c.status === 'atencao').length;
  const countCrit  = rows.filter(c => c.status === 'critico').length;
  const countVaz   = rows.filter(c => c.campos_count === 0).length;

  // ── Filtered rows ───────────────────────────────────────
  const visible = rows.filter(c => {
    if (filter !== 'todos' && c.categoria !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!c.nome.toLowerCase().includes(q) && !(c.servico ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <LoadingState />;
  if (error) return <div className="p-md text-danger">Erro ao carregar credenciais.</div>;

  const fieldCls = 'w-full h-9 bg-bg-elevated border border-border rounded-lg px-3 text-[13px] text-fg placeholder:text-fg-muted focus-ring outline-none';

  return (
    <>
      <div className="space-y-4 pb-xl">

        {/* Header */}
        <div className="px-5 pt-1 flex items-center gap-2">
          <ShieldCheck size={20} className="text-tom shrink-0" />
          <div>
            <h1 className="text-[15px] font-bold text-fg leading-tight">Credenciais</h1>
            <p className="text-[12px] text-fg-muted">Credenciais e acessos da empresa</p>
          </div>
        </div>

        {/* Stats — KpiCard pattern (alinhado com Projetos / Dashboard time) */}
        <div className="px-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard label="Total"   value={total}      Icon={ShieldCheck}   accentColor="#A3BE50" />
          <KpiCard label="OK"      value={countOk}    Icon={CheckCircle2}  accentColor="#34d399" />
          <KpiCard label="Atenção" value={countAtenc} Icon={AlertTriangle} accentColor="#facc15" />
          <KpiCard label="Crítico" value={countCrit}  Icon={AlertOctagon}  accentColor="#f87171" />
          <KpiCard label="Vazios"  value={countVaz}   Icon={MinusCircle}   accentColor="#94a3b8" />
        </div>

        {/* Toolbar */}
        <div className="px-5 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
            <input
              type="search"
              placeholder="Buscar por nome ou serviço..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 bg-bg-elevated border border-border rounded-lg pl-9 pr-3 text-[13px] text-fg placeholder:text-fg-muted focus-ring outline-none"
            />
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="h-9 px-4 bg-tom text-[#1a1a1a] text-[13px] font-semibold rounded-lg flex items-center gap-1.5 hover:opacity-90 transition-opacity shrink-0"
          >
            <Plus size={14} strokeWidth={2.5} />
            Nova credencial
          </button>
        </div>

        {/* Filter pills */}
        <div className="px-5 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {FILTER_OPTIONS.map(f => {
            const count = f.key === 'todos' ? total : rows.filter(c => c.categoria === f.key).length;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`h-7 px-3 text-[12px] font-medium rounded-full border whitespace-nowrap transition-colors shrink-0 ${
                  filter === f.key
                    ? 'bg-tom text-[#1a1a1a] border-tom font-semibold'
                    : 'bg-bg-elevated border-border text-fg-muted hover:text-fg hover:border-border'
                }`}
              >
                {f.label} <span className="opacity-60">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="px-5">
          <div className="bg-bg-surface border border-border rounded-2xl overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-bg-elevated border-b border-border">
                  {['Nome', 'Categoria', 'Serviço / Projeto', 'Responsável', 'Campos', 'Status', ''].map((h, i) => (
                    <th key={i} className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-fg-muted">
                      Nenhuma credencial encontrada.
                    </td>
                  </tr>
                ) : visible.map(c => {

                  return (
                    <tr
                      key={c.id}
                      onClick={() => openDetail(c)}
                      className="border-b border-border/60 last:border-b-0 hover:bg-bg-elevated transition-colors group cursor-pointer"
                    >
                      {/* Nome */}
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[13px] font-medium text-fg">{c.nome}</span>
                          {c.servico && <span className="text-[11px] text-fg-muted">{c.servico}</span>}
                        </div>
                      </td>

                      {/* Categoria */}
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CATEGORIA_BADGE[c.categoria]}`}>
                          {CATEGORIA_LABELS[c.categoria]}
                        </span>
                      </td>

                      {/* Serviço / Projeto */}
                      <td className="px-4 py-2.5">
                        {(c.servico || c.projeto) ? (
                          <span className="text-[13px] text-fg-secondary">
                            {c.servico ?? ''}
                            {c.servico && c.projeto && <span className="text-fg-muted text-[11px]"> / {c.projeto}</span>}
                            {!c.servico && c.projeto && c.projeto}
                          </span>
                        ) : <span className="text-fg-muted text-[12px]">—</span>}
                      </td>

                      {/* Responsável */}
                      <td className="px-4 py-2.5">
                        <span className="text-[13px] text-fg-secondary">{c.responsavel ?? <span className="text-fg-muted">—</span>}</span>
                      </td>

                      {/* Campos */}
                      <td className="px-4 py-2.5">
                        {c.campos_count > 0 ? (
                          <div className="flex items-center gap-1 text-[11px] text-fg-muted">
                            <Check size={11} />
                            {c.campos_count} campo{c.campos_count !== 1 ? 's' : ''}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-[11px] text-danger italic">
                            <AlertCircle size={11} />
                            não preenchido
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_BADGE[c.status]}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.status]}`} />
                          {STATUS_LABELS[c.status]}
                        </span>
                      </td>

                      {/* Ações */}
                      <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => openDetail(c)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-elevated border border-border text-fg-muted hover:text-fg transition-colors"
                            title="Ver / Editar"
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-[12px] text-fg-muted text-center px-5">
          {visible.length} credencial{visible.length !== 1 ? 'is' : ''}
        </p>
      </div>

      {/* Drawer overlay */}
      <div
        className={`fixed inset-0 bg-black/55 z-40 transition-opacity duration-200 ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={closeDrawer}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 bottom-0 w-[480px] z-50 bg-bg-surface border-l border-border flex flex-col transition-transform duration-300 ease-in-out ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="h-14 flex items-center gap-3 px-5 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <span className="text-[15px] font-bold text-fg block truncate">
              {drawerMode === 'create' ? 'Nova credencial' : nome || 'Credencial'}
            </span>
            {drawerMode === 'detail' && (
              <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border mt-0.5 ${CATEGORIA_BADGE[categoria]}`}>
                {CATEGORIA_LABELS[categoria]}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-bg-elevated border border-border text-fg-muted hover:text-fg transition-colors shrink-0"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        {/* Body */}
        {drawerMode === 'detail' && detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[13px] text-fg-muted">Carregando…</span>
          </div>
        ) : (
          <form id="drawer-form" onSubmit={handleDrawerSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* Identificação */}
            <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted pb-1 border-b border-border">
              Identificação
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Nome *</label>
              <input
                type="text" required value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Ex: Claude API Key, Mila Barra — SDR"
                className={fieldCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Categoria *</label>
                <CustomSelect
                  value={categoria}
                  options={CATEGORIA_OPTIONS}
                  onChange={v => setCategoria(v as Categoria)}
                  size="sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Status</label>
                <CustomSelect
                  value={status}
                  options={STATUS_OPTIONS}
                  onChange={v => setStatus(v as Status)}
                  size="sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Serviço</label>
                <input type="text" value={servico} onChange={e => setServico(e.target.value)} placeholder="Ex: Anthropic" className={fieldCls} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Projeto</label>
                <input type="text" value={projeto} onChange={e => setProjeto(e.target.value)} placeholder="Ex: LA Organizer" className={fieldCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Responsável</label>
                <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)} placeholder="Ex: Hugo" className={fieldCls} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Link / Referência</label>
                <input type="text" value={urlRef} onChange={e => setUrlRef(e.target.value)} placeholder="URL do Notion…" className={fieldCls} />
              </div>
            </div>

            {/* Campos dinâmicos */}
            <div className="text-[10px] font-bold uppercase tracking-wider text-fg-muted pt-1 pb-1 border-b border-border">
              Campos de credencial
            </div>

            <p className="text-[12px] text-fg-muted -mt-1">
              Pares label / valor. Marque como <strong className="text-fg-secondary">sensível</strong> para mascarar.
            </p>

            <div className="bg-bg-elevated border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Campos</span>
                <button
                  type="button" onClick={addCampo}
                  className="h-[26px] px-2.5 flex items-center gap-1 text-[11px] font-semibold text-fg-muted border border-dashed border-border rounded-lg hover:border-tom hover:text-tom transition-colors"
                >
                  <Plus size={11} strokeWidth={2.5} />
                  Adicionar campo
                </button>
              </div>

              {campos.length === 0 ? (
                <p className="py-5 text-center text-[12px] text-fg-muted italic">Nenhum campo adicionado.</p>
              ) : (
                <div className="p-2 space-y-1.5">
                  {campos.map((campo, i) => (
                    <div key={i} className="bg-bg-subtle border border-border rounded-lg px-2 py-1.5 space-y-1.5">
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="text" placeholder="Label" value={campo.label}
                          onChange={e => updateCampo(i, { label: e.target.value })}
                          className="h-[30px] bg-bg-elevated border border-border rounded-lg px-2 text-[12px] text-fg placeholder:text-fg-muted focus-ring outline-none"
                        />
                        <div className="relative">
                          <input
                            type={campo.sensivel && !campoRev.has(i) ? 'password' : 'text'}
                            placeholder="Valor" value={campo.valor}
                            onChange={e => updateCampo(i, { valor: e.target.value })}
                            className="h-[30px] w-full bg-bg-elevated border border-border rounded-lg px-2 pr-8 text-[12px] text-fg placeholder:text-fg-muted focus-ring outline-none"
                          />
                          {campo.sensivel && (
                            <button
                              type="button" onClick={() => toggleCampoRev(i)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
                            >
                              {campoRev.has(i) ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <div
                            role="checkbox"
                            aria-checked={campo.sensivel}
                            onClick={() => updateCampo(i, { sensivel: !campo.sensivel })}
                            className={`w-7 h-4 rounded-full relative cursor-pointer transition-colors border ${campo.sensivel ? 'bg-tom/20 border-tom' : 'bg-bg-elevated border-border'}`}
                          >
                            <span className={`absolute top-[3px] w-[10px] h-[10px] rounded-full shadow transition-all ${campo.sensivel ? 'right-[3px] bg-tom' : 'left-[3px] bg-fg-muted'}`} />
                          </div>
                          <span className="text-[10px] text-fg-muted">Sensível</span>
                        </label>

                        <div className="flex items-center gap-1">
                          {campo.valor.trim() && (
                            <button
                              type="button"
                              onClick={() => copyToClipboard(campo.valor)}
                              className="w-[26px] h-[26px] flex items-center justify-center rounded-lg border border-border text-fg-muted hover:text-tom hover:border-tom/50 transition-colors"
                              title={`Copiar ${campo.label || 'valor'}`}
                            >
                              <Copy size={12} />
                            </button>
                          )}
                          <button
                            type="button" onClick={() => removeCampo(i)}
                            className="w-[26px] h-[26px] flex items-center justify-center rounded-lg border border-border text-fg-muted hover:text-danger hover:border-danger/40 hover:bg-danger/10 transition-colors"
                            title="Remover campo"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Observações */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Observações</label>
              <textarea
                value={observacoes} onChange={e => setObservacoes(e.target.value)}
                placeholder="Notas adicionais, contexto, alertas…"
                rows={3}
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-[13px] text-fg placeholder:text-fg-muted focus-ring outline-none resize-none"
              />
            </div>

          </form>
        )}

        {/* Footer */}
        <div className="shrink-0 px-5 py-3.5 border-t border-border flex items-center gap-2">
          {drawerMode === 'detail' && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="h-9 px-3 rounded-lg border border-danger/40 text-[13px] font-medium text-danger hover:bg-danger/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Trash2 size={13} />
              {deleting ? 'Excluindo…' : 'Excluir'}
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button" onClick={closeDrawer}
            className="h-9 px-4 rounded-lg border border-border text-[13px] font-medium text-fg-muted hover:text-fg hover:border-border/80 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit" form="drawer-form"
            disabled={isSaving || (drawerMode === 'detail' && detailLoading)}
            className="h-9 px-4 rounded-lg bg-tom text-[#1a1a1a] text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isSaving ? 'Salvando…' : drawerMode === 'create' ? 'Salvar credencial' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </>
  );
}
