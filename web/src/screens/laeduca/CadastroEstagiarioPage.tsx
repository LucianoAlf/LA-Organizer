// Cadastra estagiário e gera as avaliações automaticamente (universais + da trilha).
// Acesso restrito (gating na rota — ProtectedRoute requireRoles=['coordinator','director'])
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { CustomSelect } from '../../components/CustomSelect';
import { DateInput } from '../../components/DateInput';
import { cadastrarEstagiario, fetchMentoresDisponiveis } from '../../lib/laeduca';
import { useLaEducaTrilhas } from '../../hooks/useLaEducaTrilhas';
import { showToast } from '../../components/Toast';
import type { CadastroEstagiarioForm, Unidade } from '../../lib/laeduca-types';
import { UNIDADE_LABELS } from '../../lib/laeduca-types';

const UNIDADES: Unidade[] = ['campo_grande', 'recreio', 'barra', 'all'];

export function LaEducaCadastroPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState<CadastroEstagiarioForm>({
    nome: '',
    unidade: 'campo_grande',
    mentor_id: '',
    trilha_id: '',
    instrumento: '',
    data_inicio: new Date().toISOString().slice(0, 10),
    diagnostico_entrada: '',
  });
  const [saving, setSaving] = useState(false);

  const { data: mentores = [] } = useQuery({
    queryKey: ['laeduca-mentores', form.unidade],
    queryFn: () => fetchMentoresDisponiveis(form.unidade),
  });

  const { data: trilhas = [] } = useLaEducaTrilhas();

  const valido =
    form.nome.trim().length > 2 &&
    form.mentor_id !== '' &&
    form.trilha_id !== '' &&
    form.data_inicio !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || saving) return;
    setSaving(true);
    try {
      const id = await cadastrarEstagiario(form);
      qc.invalidateQueries({ queryKey: ['laeduca-progresso'] });
      showToast({ kind: 'success', title: 'Estagiário cadastrado.' });
      navigate(`/la-educa/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      showToast({ kind: 'error', title: 'Falha ao cadastrar', msg });
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof CadastroEstagiarioForm>(k: K, v: CadastroEstagiarioForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader title="Novo estagiário" backTo="/la-educa" />

      <form onSubmit={handleSubmit} className="space-y-md max-w-md">
        <Field label="Nome completo">
          <input
            type="text"
            value={form.nome}
            onChange={e => update('nome', e.target.value)}
            className="w-full bg-bg-surface text-fg rounded p-sm border border-border focus-ring"
            required
          />
        </Field>

        <Field label="Unidade">
          <CustomSelect
            value={form.unidade}
            onChange={v => update('unidade', v as Unidade)}
            options={UNIDADES.map(u => ({ value: u, label: UNIDADE_LABELS[u] }))}
          />
        </Field>

        <Field label={`Mentor responsável (${mentores.length} disponíveis)`}>
          <CustomSelect
            value={form.mentor_id}
            onChange={v => update('mentor_id', v)}
            placeholder="— Selecione —"
            options={mentores.map(m => ({ value: m.id, label: m.full_name }))}
          />
        </Field>

        <Field label="Trilha pedagógica">
          <CustomSelect
            value={form.trilha_id}
            onChange={v => update('trilha_id', v)}
            placeholder="— Selecione a trilha —"
            options={trilhas.map(t => ({
              value: t.id,
              label: t.icone ? `${t.icone} ${t.nome}` : t.nome,
            }))}
          />
        </Field>

        <Field label="Instrumento (opcional — texto livre)">
          <input
            type="text"
            value={form.instrumento ?? ''}
            onChange={e => update('instrumento', e.target.value)}
            placeholder="Ex: Bateria 5 peças, Violão clássico"
            className="w-full bg-bg-surface text-fg rounded p-sm border border-border focus-ring"
          />
        </Field>

        <Field label="Data de início">
          <div className="[&>div]:!block [&>div]:w-full [&>div>button]:w-full [&>div>button]:!justify-start [&>div>button]:!py-sm">
            <DateInput
              value={form.data_inicio}
              onChange={v => update('data_inicio', v)}
            />
          </div>
        </Field>

        <Field label="Diagnóstico de entrada (opcional)">
          <textarea
            value={form.diagnostico_entrada ?? ''}
            onChange={e => update('diagnostico_entrada', e.target.value)}
            className="w-full bg-bg-surface text-fg rounded p-sm border border-border focus-ring"
            rows={3}
          />
        </Field>

        <button
          type="submit"
          disabled={!valido || saving}
          className="w-full px-md py-sm bg-tom text-black rounded font-semibold disabled:opacity-50 focus-ring"
        >
          {saving ? 'Salvando...' : 'Cadastrar e gerar avaliações'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-body-sm text-fg-muted font-semibold">{label}</span>
      {children}
    </label>
  );
}
