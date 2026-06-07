import { useEffect, useState } from 'react';
import { BottomSheet } from '../../../components/BottomSheet';
import { Field } from '../../../components/Field';
import { Button } from '../../../components/Button';
import { useCreateCategory } from '../../../hooks/useFinanceiro';
import { CustomCategoryList } from './CustomCategoryList';

const EMOJIS = ['🏷️','🎤','🎸','🎵','🎬','🎨','📚','💼','🏆','🎁','🍔','🛒','🚗','🏠','💊','✈️','🐾','💡','🔧','💰','📈','🤝'];

// showManage: quando true (padrão), mostra também "suas categorias" com excluir — usado ao abrir
// pelo seletor do lançamento (cria + gerencia sem sair). A CategoriasPage passa false (já lista).
export function NovaCategoriaSheet({ open, onClose, type, onCreated, showManage = true }: {
  open: boolean; onClose: () => void; type: 'expense' | 'income'; onCreated: (slug: string) => void; showManage?: boolean;
}) {
  const createMut = useCreateCategory();
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('🏷️');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setLabel(''); setEmoji('🏷️'); setError(null); } }, [open]);

  async function submit() {
    setError(null);
    try {
      const r = await createMut.mutateAsync({ label, emoji, type });
      onCreated((r as { slug: string }).slug);
      onClose();
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title={`Nova categoria de ${type === 'income' ? 'receita' : 'despesa'}`}>
      <div className="flex flex-col gap-md">
        <Field label="Nome">
          <div className="flex items-center gap-2">
            <span className="text-2xl shrink-0" aria-hidden>{emoji}</span>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Shows"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom" />
          </div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => setEmoji(e)} aria-label={`Ícone ${e}`}
                className={['h-8 w-8 rounded-full flex items-center justify-center text-lg focus-ring',
                  emoji === e ? 'bg-tom/15 ring-2 ring-tom' : 'bg-bg-elevated hover:bg-bg-surface'].join(' ')}>{e}</button>
            ))}
          </div>
        </Field>
        {error && <p className="text-body-sm text-danger">{error}</p>}
        <Button variant="primary" fullWidth loading={createMut.isPending} onClick={submit} disabled={!label.trim()}>
          Criar categoria
        </Button>

        {showManage && (
          <div className="border-t border-border pt-md">
            <h3 className="text-label uppercase tracking-wide text-fg-muted mb-2">
              Suas categorias de {type === 'income' ? 'receita' : 'despesa'}
            </h3>
            <CustomCategoryList type={type} />
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
