// Cadastra estagiário e gera as 21 ou 26 avaliações automaticamente.
// Acesso restrito (gating na rota — ProtectedRoute requireRoles=['coordinator','director'])
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/PageHeader';
import { cadastrarEstagiario, fetchMentoresDisponiveis } from '../../lib/laeduca';
import { showToast } from '../../components/Toast';
import type { CadastroEstagiarioForm, Modalidade, Unidade } from '../../lib/laeduca-types';
import { UNIDADE_LABELS } from '../../lib/laeduca-types';

const UNIDADES: Unidade[] = ['campo_grande', 'recreio', 'barra'];

export function LaEducaCadastroPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState<CadastroEstagiarioForm>({
    nome: '',
    unidade: 'campo_grande',
    mentor_id: '',
    modalidade: 'musicalizacao',
    instrumento: '',
    data_inicio: new Date().toISOString().slice(0, 10),
    diagnostico_entrada: '',
  });
  const [saving, setSaving] = useState(false);

  const { data: mentores = [] } = useQuery({
    queryKey: ['laeduca-mentores', form.unidade],
    queryFn: () => fetchMentoresDisponiveis(form.unidade),
  });

  const precisaInstrumento = form.modalidade !== 'musicalizacao';
  const valido =
    form.nome.trim().length > 2 &&
    form.mentor_id &&
    form.data_inicio &&
    (!precisaInstrumento || (form.instrumento && form.instrumento.trim().length > 0));

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
          <select
            value={form.unidade}
            onChange={e => update('unidade', e.target.value as Unidade)}
            className="w-full bg-bg-surface text-fg rounded p-sm border border-border focus-ring"
          >
            {UNIDADES.map(u => <option key={u} value={u}>{UNIDADE_LABELS[u]}</option>)}
          </select>
        </Field>

        <Field label={`Mentor responsável (${mentores.length} disponíveis)`}>
          <select
            value={form.mentor_id}
            onChange={e => update('mentor_id', e.target.value)}
            className="w-full bg-bg-surface text-fg rounded p-sm border border-border focus-ring"
            required
          >
            <option value="">— Selecione —</option>
            {mentores.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </Field>

        <Field label="Modalidade">
          <div className="flex gap-sm">
            {(['musicalizacao', 'instrumento', 'ambos'] as Modalidade[]).map(m => (
              <label key={m} className="flex items-center gap-1 text-body-sm">
                <input
                  type="radio"
                  name="modalidade"
                  value={m}
                  checked={form.modalidade === m}
                  onChange={() => update('modalidade', m)}
                />
                {m === 'musicalizacao' ? 'Musicalização' : m === 'instrumento' ? 'Instrumento' : 'Ambos'}
              </label>
            ))}
          </div>
        </Field>

        {precisaInstrumento && (
          <Field label="Instrumento">
            <input
              type="text"
              value={form.instrumento ?? ''}
              onChange={e => update('instrumento', e.target.value)}
              placeholder="Ex: Violão, Piano"
              className="w-full bg-bg-surface text-fg rounded p-sm border border-border focus-ring"
              required
            />
          </Field>
        )}

        <Field label="Data de início">
          <input
            type="date"
            value={form.data_inicio}
            onChange={e => update('data_inicio', e.target.value)}
            className="w-full bg-bg-surface text-fg rounded p-sm border border-border focus-ring"
            required
          />
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
          className="w-full px-md py-sm bg-tom text-white rounded font-semibold disabled:opacity-50 focus-ring"
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
