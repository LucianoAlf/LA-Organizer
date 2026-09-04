import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/PageHeader';
import { showToast } from '../components/Toast';
import { CustomSelect } from '../components/CustomSelect';
import { Checkbox } from '../components/Checkbox';
import { estadoVisibilidadeTom, LABEL_VISIVEL_TOM } from '../lib/visibilidadeTom';
import type { Categoria, Status } from './GovernancaPage';

type Campo = { label: string; valor: string; sensivel: boolean };

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

export function GovernancaNovo() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const [nome,        setNome]        = useState('');
  const [categoria,   setCategoria]   = useState<Categoria>('outro');
  const [status,      setStatus]      = useState<Status>('ok');
  const [servico,     setServico]     = useState('');
  const [projeto,     setProjeto]     = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [urlRef,      setUrlRef]      = useState('');
  const [observacoes, setObservacoes] = useState('');
  // LAOR-2: nasce FALSE, igual ao default da coluna e ao que a RPC de escrita do TOM grava.
  const [visivelTom,  setVisivelTom]  = useState(false);
  const [campos,      setCampos]      = useState<Campo[]>([{ label: '', valor: '', sensivel: false }]);
  const [revealed,    setRevealed]    = useState<Set<number>>(new Set());

  function addCampo() {
    setCampos(prev => [...prev, { label: '', valor: '', sensivel: false }]);
  }

  function removeCampo(i: number) {
    setCampos(prev => prev.filter((_, idx) => idx !== i));
    setRevealed(prev => {
      const next = new Set<number>();
      prev.forEach(n => { if (n < i) next.add(n); else if (n > i) next.add(n - 1); });
      return next;
    });
  }

  function updateCampo(i: number, patch: Partial<Campo>) {
    setCampos(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  function toggleReveal(i: number) {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) {
      showToast({ kind: 'error', title: 'Informe o nome da credencial.' });
      return;
    }
    setSaving(true);
    try {
      const camposValidos = campos.filter(c => c.label.trim() || c.valor.trim());
      const { error } = await supabase.from('governance_credentials').insert({
        nome:        nome.trim(),
        categoria,
        status,
        servico:     servico.trim() || null,
        projeto:     projeto.trim() || null,
        responsavel: responsavel.trim() || null,
        url_ref:     urlRef.trim() || null,
        observacoes: observacoes.trim() || null,
        // Sem link nao ha o que o time receba: grava false pra nao deixar a flag ligada
        // num registro onde ela nunca vai valer (e reaparecer sozinha se alguem puser link).
        visivel_tom: visivelTom && !!urlRef.trim(),
        campos:      camposValidos,
      });
      if (error) throw error;
      showToast({ kind: 'success', title: 'Credencial salva!' });
      navigate('/mais/governanca');
    } catch (err: unknown) {
      showToast({ kind: 'error', title: 'Erro ao salvar.', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none';
  const visibilidade = estadoVisibilidadeTom(urlRef, status);

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader title="Nova credencial" backTo="/mais/governanca" />

      <form onSubmit={handleSubmit} className="space-y-lg">

        {/* Identificação */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Identificação</h2>

          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">Nome *</label>
            <input
              type="text" required value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Ex: Claude API Key, Mila Barra — SDR"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-body-sm text-fg-muted">Categoria *</label>
              <CustomSelect
                value={categoria}
                options={CATEGORIA_OPTIONS}
                onChange={v => setCategoria(v as Categoria)}
                size="sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-body-sm text-fg-muted">Status</label>
              <CustomSelect
                value={status}
                options={STATUS_OPTIONS}
                onChange={v => setStatus(v as Status)}
                size="sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-body-sm text-fg-muted">Serviço</label>
              <input type="text" value={servico} onChange={e => setServico(e.target.value)} placeholder="Ex: Anthropic" className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-body-sm text-fg-muted">Projeto</label>
              <input type="text" value={projeto} onChange={e => setProjeto(e.target.value)} placeholder="Ex: LA Organizer" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-body-sm text-fg-muted">Responsável</label>
              <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)} placeholder="Ex: Hugo" className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-body-sm text-fg-muted">Link / Referência</label>
              <input type="text" value={urlRef} onChange={e => setUrlRef(e.target.value)} placeholder="URL do Notion..." className={inputCls} />
            </div>
          </div>

          {/* LAOR-2 item 2 — ate 04/09 `visivel_tom` so existia como coluna: nao havia como
              marcar nem no app nem falando com o TOM, e as 3 ligadas vieram de migration. */}
          <div className="pt-1">
            <Checkbox
              checked={visivelTom && visibilidade.podeMarcar}
              onChange={setVisivelTom}
              disabled={!visibilidade.podeMarcar}
              label={LABEL_VISIVEL_TOM}
              hint={visibilidade.hint}
            />
          </div>
        </section>

        {/* Campos dinâmicos */}
        <section className="surface p-lg space-y-md">
          <div className="flex items-center justify-between">
            <h2 className="text-label text-fg-muted uppercase tracking-wide">Campos de credencial</h2>
            <button
              type="button" onClick={addCampo}
              className="flex items-center gap-1.5 text-body-sm text-tom hover:opacity-80 transition-opacity"
            >
              <Plus size={14} /> Adicionar
            </button>
          </div>

          <p className="text-body-sm text-fg-muted">
            Pares label / valor. Marque como <strong>sensível</strong> para mascarar na listagem.
          </p>

          {campos.length === 0 ? (
            <p className="text-body-sm text-fg-muted italic text-center py-2">Nenhum campo adicionado.</p>
          ) : (
            <div className="space-y-2">
              {campos.map((campo, i) => (
                <div key={i} className="bg-bg-elevated border border-border rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Label"
                      value={campo.label}
                      onChange={e => updateCampo(i, { label: e.target.value })}
                      className="bg-bg-app border border-border rounded-md px-3 py-2 text-body-sm focus-ring outline-none w-full"
                    />
                    <div className="relative">
                      <input
                        type={campo.sensivel && !revealed.has(i) ? 'password' : 'text'}
                        placeholder="Valor"
                        value={campo.valor}
                        onChange={e => updateCampo(i, { valor: e.target.value })}
                        className="bg-bg-app border border-border rounded-md px-3 py-2 text-body-sm focus-ring outline-none w-full pr-9"
                      />
                      {campo.sensivel && (
                        <button
                          type="button"
                          onClick={() => toggleReveal(i)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
                        >
                          {revealed.has(i) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div
                        role="checkbox"
                        aria-checked={campo.sensivel}
                        onClick={() => updateCampo(i, { sensivel: !campo.sensivel })}
                        className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${campo.sensivel ? 'bg-tom' : 'bg-fg-subtle'}`}
                      >
                        <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${campo.sensivel ? 'right-0.5' : 'left-0.5'}`} />
                      </div>
                      <span className="text-body-sm text-fg-muted">Sensível</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeCampo(i)}
                      className="text-fg-muted hover:text-danger transition-colors"
                      aria-label="Remover campo"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Observações */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Observações</h2>
          <textarea
            value={observacoes}
            onChange={e => setObservacoes(e.target.value)}
            placeholder="Notas adicionais, contexto, alertas..."
            rows={3}
            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none resize-none"
          />
        </section>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 rounded-xl bg-tom text-black font-semibold text-body-md disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {saving ? 'Salvando...' : 'Salvar credencial'}
        </button>
      </form>
    </div>
  );
}
