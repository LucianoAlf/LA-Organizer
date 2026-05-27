// Sprint 23 — DeriveTaskDialog: cria tarefa derivada de um item do checklist

import { useState } from 'react';
import { useDeriveTask } from './hooks/useDeriveTask';

interface Props {
  scope: 'work' | 'personal';
  completionId: string;
  itemId: string;
  itemDescription: string;
  onClose: () => void;
  onCreated: () => void;
}

export function DeriveTaskDialog({
  scope,
  completionId,
  itemId,
  itemDescription,
  onClose,
  onCreated,
}: Props) {
  const derive = useDeriveTask();
  const [title, setTitle] = useState(`Resolver: ${itemDescription}`);
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    derive.mutate(
      {
        scope,
        completionId,
        itemId,
        title: title.trim(),
        description: description.trim(),
      },
      {
        onSuccess: onCreated,
        onError: (e: Error) => alert(`Erro ao criar tarefa: ${e.message}`),
      }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-lg max-w-md w-full p-4">
        <h3 className="font-semibold text-fg mb-3">Gerar tarefa</h3>
        <p className="text-xs text-fg/60 mb-3">
          Item: <span className="text-fg/80">{itemDescription}</span>
        </p>

        <label className="block text-xs text-fg/60 mb-1">Título da tarefa</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-bg-app border border-border rounded-md p-2 text-sm text-fg focus:outline-none focus:border-tom mb-3"
        />

        <label className="block text-xs text-fg/60 mb-1">Descrição (opcional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Detalhes adicionais…"
          className="w-full bg-bg-app border border-border rounded-md p-2 text-sm text-fg resize-none focus:outline-none focus:border-tom mb-4"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2 text-fg/60 hover:text-fg">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || derive.isPending}
            className="text-xs px-4 py-2 bg-tom text-bg-app rounded-md font-semibold disabled:opacity-50"
          >
            {derive.isPending ? 'Criando…' : 'Criar tarefa'}
          </button>
        </div>
      </div>
    </div>
  );
}
