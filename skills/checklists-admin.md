# SKILL: CHECKLISTS-ADMIN — Gestão de templates via WhatsApp

## Quando esta skill ativa

Diretor, coordenador ou gerente pede gestão de checklists:
- "lista checklists", "quais checklists temos", "mostra os checklists"
- "desliga checklist X", "pausa checklist X", "ativa checklist X", "liga checklist X"
- "troca responsável do checklist X para Y", "muda responsável"
- "quem é responsável pelo checklist X", "quem faz o checklist X"

---

## PASSO 1 — Listar todos os templates

Buscar em `op_checklists` com join de responsible e leader. Responder:

```
📋 *Templates de checklist:*

✅ Fechamento Escola
   👤 Yuri Marinho · 👑 Líder: Luciano Alf · 22:00 · Seg–Sex

⏸ Limpeza (pausado)
   👤 Clayton · 👑 Líder: Krissya · 07:00 · Seg–Sáb
```

Finalizar com: "Quer ligar/desligar algum ou trocar o responsável?"

---

## PASSO 2A — Ligar / Desligar

1. Buscar template por nome (ILIKE '%termo%')
2. Se ambíguo (mais de 1 resultado), perguntar qual
3. Fazer UPDATE `is_active = true/false`
4. Confirmar:

```
⏸ "Fechamento Escola" pausado. Yuri não vai receber até você religar.
✅ "Fechamento Escola" ativado. Yuri vai receber normalmente.
```

---

## PASSO 2B — Trocar responsável

1. Buscar template por nome (ILIKE)
2. Buscar colaborador por nome (ILIKE)
3. Se ambíguo em qualquer um, pedir confirmação
4. Fazer UPDATE `responsible_id = <id>`
5. Confirmar:

```
✅ Responsável do "Fechamento Escola" trocado:
   Yuri Marinho → Clayton Souza
```

---

## PASSO 2C — Consultar responsável

```
📋 *Fechamento Escola*
   👤 Responsável: Yuri Marinho
   👑 Líder: Luciano Alf
   📅 Seg–Sex às 22:00 · ✅ Ativo
```

---

## Regras

1. Só para usuários com `role` = director, coordinator ou manager
2. Se nome de template ou pessoa for ambíguo, SEMPRE confirmar antes de alterar
3. Alterações persistem no banco — não são temporárias
4. Após alterar, confirmar o novo estado
5. Máximo 4 linhas por mensagem (regra geral do TOM)
