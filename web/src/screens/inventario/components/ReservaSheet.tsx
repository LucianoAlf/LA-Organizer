// Sprint Fase 2.3 — Sheet de criação de reserva.
import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '../../../components/BottomSheet';
import { Button } from '../../../components/Button';
import { Field } from '../../../components/Field';
import { CustomSelect } from '../../../components/CustomSelect';
import { DateInput } from '../../../components/DateInput';
import { ClienteAutocomplete } from '../../../components/ClienteAutocomplete';
import { showToast } from '../../../components/Toast';
import { useReportLoja } from '../../../hooks/useLaReport';
import { criarReserva } from '../../../lib/lareport-mutations';
import type { ReportProduto } from '../../../lib/lareport-types';
import type { ClienteSearchResult } from '../../../lib/lareport-mutations';

interface Props {
  open: boolean;
  onClose: () => void;
  unidadeId: string;
  produtoPreSelecionado?: ReportProduto | null;
}

function plus7DaysYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function ReservaSheet({ open, onClose, unidadeId, produtoPreSelecionado }: Props) {
  const qc = useQueryClient();
  const { data: produtos = [] } = useReportLoja(unidadeId || null);

  const [produtoId, setProdutoId] = useState<string>('');
  const [quantidade, setQuantidade] = useState<string>('1');
  const [aluno, setAluno] = useState<ClienteSearchResult | null>(null);
  const [tipoCliente, setTipoCliente] = useState<'aluno' | 'avulso'>('aluno');
  const [clienteAvulsoNome, setClienteAvulsoNome] = useState('');
  const [prazo, setPrazo] = useState<string>(plus7DaysYmd());
  const [observacoes, setObservacoes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProdutoId(produtoPreSelecionado ? String(produtoPreSelecionado.id) : '');
    setQuantidade('1');
    setAluno(null);
    setTipoCliente('aluno');
    setClienteAvulsoNome('');
    setPrazo(plus7DaysYmd());
    setObservacoes('');
    setSaving(false);
  }, [open, produtoPreSelecionado]);

  const produtoOptions = useMemo(
    () => produtos
      .filter(p => p.ativo)
      .map(p => ({
        value: String(p.id),
        label: p.nome,
        sublabel: `estq ${p.estoque_atual}`,
      })),
    [produtos],
  );

  const produtoSelecionado = useMemo(
    () => produtos.find(p => String(p.id) === produtoId) ?? produtoPreSelecionado ?? null,
    [produtos, produtoId, produtoPreSelecionado],
  );

  const qtdNum = Number(quantidade);
  const estoqueDisp = produtoSelecionado?.estoque_atual ?? 0;
  const aposReserva = estoqueDisp - (Number.isFinite(qtdNum) ? qtdNum : 0);

  const clienteNomeFinal =
    tipoCliente === 'aluno' ? (aluno?.nome ?? '') : clienteAvulsoNome.trim();

  const canSubmit =
    !saving &&
    produtoSelecionado != null &&
    Number.isInteger(qtdNum) &&
    qtdNum > 0 &&
    qtdNum <= estoqueDisp &&
    clienteNomeFinal.length > 0 &&
    prazo.length === 10;

  async function handleSubmit() {
    if (!canSubmit || !produtoSelecionado) return;
    setSaving(true);
    try {
      const res = await criarReserva({
        produto_id: produtoSelecionado.id,
        unidade_id: unidadeId,
        quantidade: qtdNum,
        cliente_nome: clienteNomeFinal,
        aluno_id: tipoCliente === 'aluno' ? aluno?.id ?? null : null,
        observacoes: observacoes.trim() || null,
        prazo,
      });
      qc.invalidateQueries({ queryKey: ['lareport', 'reservas'] });
      qc.invalidateQueries({ queryKey: ['lareport', 'loja'] });
      showToast({ kind: 'success', title: `Reserva #${res.reserva_id} criada`, msg: `Prazo: ${res.prazo}` });
      onClose();
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha ao criar reserva', msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Nova reserva">
      <div className="space-y-md">
        {/* Produto */}
        <Field label="Produto">
          {produtoPreSelecionado ? (
            <div className="bg-bg-elevated border border-border rounded-md px-3 py-2 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-body-md text-fg font-semibold truncate">{produtoPreSelecionado.nome}</div>
                <div className="text-body-sm text-fg-muted">Estoque atual: {produtoPreSelecionado.estoque_atual}</div>
              </div>
            </div>
          ) : (
            <CustomSelect
              value={produtoId}
              options={produtoOptions}
              onChange={setProdutoId}
              placeholder="Selecione o produto"
            />
          )}
        </Field>

        {/* Quantidade */}
        <Field label="Quantidade">
          <input
            type="number"
            min={1}
            step={1}
            value={quantidade}
            onChange={e => setQuantidade(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          />
          {produtoSelecionado && (
            <div className={[
              'text-body-sm mt-1',
              aposReserva < 0 ? 'text-danger font-semibold' : 'text-fg-muted',
            ].join(' ')}>
              Estoque disponível: <strong className="text-fg">{estoqueDisp}</strong>
              {Number.isFinite(qtdNum) && qtdNum > 0 && (
                <> · após reserva: <strong className={aposReserva < 0 ? 'text-danger' : 'text-fg'}>{aposReserva}</strong></>
              )}
              {aposReserva < 0 && <> — <span className="text-danger">estoque insuficiente</span></>}
            </div>
          )}
        </Field>

        {/* Tipo cliente */}
        <Field label="Cliente">
          <div className="space-y-2">
            <CustomSelect
              value={tipoCliente}
              options={[
                { value: 'aluno', label: 'Aluno LA' },
                { value: 'avulso', label: 'Avulso (nome livre)' },
              ]}
              onChange={v => { setTipoCliente(v as 'aluno' | 'avulso'); setAluno(null); setClienteAvulsoNome(''); }}
              size="sm"
            />
            {tipoCliente === 'aluno' ? (
              <ClienteAutocomplete
                tipo="aluno"
                unidadeId={unidadeId}
                value={aluno}
                onChange={setAluno}
                placeholder="Buscar aluno…"
              />
            ) : (
              <input
                type="text"
                value={clienteAvulsoNome}
                onChange={e => setClienteAvulsoNome(e.target.value)}
                placeholder="Nome do cliente"
                className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
              />
            )}
          </div>
        </Field>

        {/* Prazo */}
        <Field label="Prazo da reserva" sub="Default: hoje + 7 dias.">
          <DateInput value={prazo} onChange={setPrazo} />
        </Field>

        {/* Observações */}
        <Field label="Observações (opcional)">
          <textarea
            value={observacoes}
            onChange={e => setObservacoes(e.target.value)}
            rows={2}
            placeholder="Ex.: passar pra retirar sexta…"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom resize-none"
          />
        </Field>

        <div className="flex gap-sm pt-1">
          <Button variant="ghost" size="md" fullWidth onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={handleSubmit} disabled={!canSubmit} loading={saving}>
            Criar reserva
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
