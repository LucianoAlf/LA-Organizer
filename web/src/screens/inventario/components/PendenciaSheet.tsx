// Pendências de Inventário — Sheet de criar/editar.
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { showToast } from '../../../components/Toast';
import { useAuth } from '../../../contexts/AuthContext';
import { criarPendencia, atualizarPendencia } from '../../../lib/lareport-mutations';
import type { ReportPendencia } from '../../../hooks/useLaReport';

interface Props {
  open: boolean;
  onClose: () => void;
  salaId: number;
  unidadeId: string;
  pendencia?: ReportPendencia | null;
}

type Prioridade = 'urgente' | 'importante' | 'futuramente';
type Categoria = '' | 'compra' | 'reposicao' | 'reparo' | 'melhoria';

const CATEGORIAS: { value: Categoria; label: string }[] = [
  { value: '', label: 'Sem categoria' },
  { value: 'compra', label: '🛒 Compra' },
  { value: 'reposicao', label: '🔁 Reposição' },
  { value: 'reparo', label: '🔧 Reparo' },
  { value: 'melhoria', label: '✨ Melhoria' },
];

const PRIORIDADES: { value: Prioridade; label: string }[] = [
  { value: 'urgente', label: '🔴 Urgente' },
  { value: 'importante', label: '🟠 Importante' },
  { value: 'futuramente', label: '🟡 Futuramente' },
];

export function PendenciaSheet({ open, onClose, salaId, unidadeId, pendencia }: Props) {
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  const isEdit = !!pendencia;

  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState<Categoria>('');
  const [prioridade, setPrioridade] = useState<Prioridade>('importante');
  const [solicitante, setSolicitante] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (pendencia) {
      setTitulo(pendencia.titulo || '');
      setDescricao(pendencia.descricao || '');
      setCategoria((pendencia.categoria as Categoria) || '');
      setPrioridade(pendencia.prioridade);
      setSolicitante(pendencia.solicitante || '');
    } else {
      setTitulo('');
      setDescricao('');
      setCategoria('');
      setPrioridade('importante');
      setSolicitante(collaborator?.full_name || '');
    }
    setSaving(false);
  }, [open, pendencia, collaborator]);

  const canSubmit = !saving && titulo.trim().length > 0 && titulo.length <= 200 && !!prioridade;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      if (isEdit && pendencia) {
        await atualizarPendencia(pendencia.id, {
          titulo: titulo.trim(),
          descricao: descricao.trim() || null,
          categoria: (categoria || null) as 'compra' | 'reposicao' | 'reparo' | 'melhoria' | null,
          prioridade,
        });
        showToast({ kind: 'success', title: 'Pendência atualizada' });
      } else {
        await criarPendencia({
          sala_id: salaId,
          unidade_id: unidadeId,
          titulo: titulo.trim(),
          descricao: descricao.trim() || null,
          categoria: (categoria || null) as 'compra' | 'reposicao' | 'reparo' | 'melhoria' | null,
          prioridade,
          solicitante: solicitante.trim() || null,
        });
        showToast({ kind: 'success', title: 'Pendência criada' });
      }
      qc.invalidateQueries({ queryKey: ['lareport', 'pendencias', salaId] });
      onClose();
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha ao salvar', msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={isEdit ? 'Editar pendência' : 'Nova pendência'}>
      <div className="space-y-md">
        <Field label="Título *">
          <input
            type="text"
            maxLength={200}
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Ex.: comprar 2 estantes pra sala 3"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
        </Field>

        <Field label="Descrição (opcional)">
          <textarea
            value={descricao}
            onChange={e => setDescricao(e.target.value)}
            rows={3}
            placeholder="Contexto, urgência, especificações…"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom resize-none"
          />
        </Field>

        <Field label="Categoria">
          <CustomSelect
            value={categoria}
            options={CATEGORIAS.map(c => ({ value: c.value, label: c.label }))}
            onChange={v => setCategoria(v as Categoria)}
            placeholder="Sem categoria"
          />
        </Field>

        <Field label="Prioridade *">
          <CustomSelect
            value={prioridade}
            options={PRIORIDADES.map(p => ({ value: p.value, label: p.label }))}
            onChange={v => setPrioridade(v as Prioridade)}
          />
        </Field>

        {!isEdit && (
          <Field label="Solicitante (opcional)">
            <input
              type="text"
              value={solicitante}
              onChange={e => setSolicitante(e.target.value)}
              placeholder="Quem está pedindo"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
            />
          </Field>
        )}

        <div className="flex gap-sm pt-1">
          <Button variant="ghost" size="md" fullWidth onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={handleSubmit} disabled={!canSubmit} loading={saving}>
            {isEdit ? 'Salvar' : 'Criar'}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
