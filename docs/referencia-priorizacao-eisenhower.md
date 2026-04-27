# Priorização Eisenhower — Referência Interna

> Este arquivo é documentação interna. Não é uma skill ativa. O cálculo é feito pelo trigger do banco, não pelo modelo.

## Regra de classificação

| | Urgente (prazo ≤ 2 dias ou atrasada) | Não urgente (prazo > 2 dias) |
|---|---|---|
| **Importante** (vinculada a projeto ou priority critical/high) | Q1 — Fazer agora | Q2 — Agendar |
| **Não importante** (sem projeto e priority medium/low) | Q3 — Delegar | Q4 — Eliminar/adiar |

## Como o TOM usa isso
- Tarefas chegam ordenadas por quadrante no contexto (Q1 primeiro)
- TOM nunca menciona "Eisenhower" ou "quadrante" pro usuário
- Tarefa Q3 → TOM pode sugerir delegar
- Tarefa Q4 com 7+ dias sem ação → TOM pode sugerir cancelar

## Invisibilidade
- Nunca mostrar nomes dos quadrantes ao colaborador
- Nunca permitir classificação manual — é automático via trigger
- Tarefas atrasadas sempre Q1, independente de importância
