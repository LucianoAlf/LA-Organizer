---
name: cadastro-projeto-5w2h
description: Skill para cadastrar projetos através de conversa guiada que preenche os 7 campos do 5W2H sem o usuário saber que está respondendo um framework. Use quando coordenador+ disser "criar projeto", "novo projeto" ou descrever algo que precisa virar projeto.
---

# Cadastro de Projeto (5W2H)

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| collaborator_id | uuid | Identificado pelo phone | Sim |
| role | text | collaborators.role (deve ser coordinator+) | Sim |
| conversa livre | text/áudio | Coordenador via WhatsApp | Sim |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| project | record | Supabase (projects) |
| project_members | record[] | Supabase (project_members) |
| project_checkpoints | record[] | Supabase (project_checkpoints) |
| confirmação | mensagem | Coordenador via UAZAPI |

## Fases de Execução

### Fase 1 — Verificar permissão
- Se collaborators.role NOT IN ('coordinator', 'manager', 'director') → rejeitar:
  "Criação de projeto é com seu coordenador. Quer que eu avise [supervisor] que você tem uma ideia?"

### Fase 2 — Conversa guiada (uma pergunta por vez)

| Ordem | Pergunta do TOM | Campo 5W2H | Campo no banco | Obrigatório |
|-------|-----------------|------------|----------------|-------------|
| 1 | "Qual é o projeto? O que precisa ser feito?" | What (O quê) | name + description | Sim |
| 2 | "Por que esse projeto é importante agora?" | Why (Por quê) | justification | Sim |
| 3 | "Quando precisa estar pronto?" | When (Quando) | end_date | Sim |
| 4 | "E quando começa?" | When (Quando) | start_date | Sim |
| 5 | "Quem vai trabalhar nisso?" | Who (Quem) | project_members[] | Sim |
| 6 | "Quais são as etapas, na ordem?" | How (Como) | project_checkpoints[] | Sim |
| 7 | Pra cada etapa: "Até quando?" e "Quem é responsável?" | When + Who | checkpoint.due_date + assigned_to | Sim |
| 8 | "Quanto tempo por semana vai demandar?" | How much (Quanto) | estimated_hours_week | Não |
| 9 | "Onde vai acontecer?" | Where (Onde) | location | Não |

Regras da conversa:
- Uma pergunta por vez — nunca despejar tudo
- Se o colaborador manda tudo de uma vez num textão ou áudio: TOM extrai os campos, confirma cada um
- Se o colaborador pula uma pergunta ("não sei"): campo fica null, TOM segue
- Se o colaborador manda áudio: transcrever, extrair, confirmar

### Fase 3 — Confirmar antes de salvar
```
Projeto criado:
- Nome: [name]
- Por quê: [justification]
- Prazo: [start_date] a [end_date]
- Equipe: [nomes]
- [N] checkpoints com datas
- Horas/semana: [estimated_hours_week]

Tá tudo certo?
```

Só salvar após confirmação explícita.

### Fase 4 — Salvar no banco
```sql
-- 1. Criar projeto
INSERT INTO projects (name, description, justification, location, start_date, end_date, 
  methodology, estimated_hours_week, category, status, color, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'planning', $10, $11)
RETURNING id;

-- 2. Criar membros
INSERT INTO project_members (project_id, collaborator_id, role_in_project)
VALUES ($project_id, $member_id, 'member') -- owner pra quem criou
ON CONFLICT DO NOTHING;

-- 3. Criar checkpoints
INSERT INTO project_checkpoints (project_id, name, description, due_date, assigned_to, sort_order)
VALUES ($project_id, $name, $desc, $due_date, $assigned_to, $order);
```

### Fase 5 — Confirmar e comunicar
```
Projeto "[name]" criado. [N] checkpoints, prazo final: [end_date].
Próximo checkpoint: [nome] — [due_date] ([responsável]).
Vou cobrar nos briefings diários. Bora.
```

Notificar todos os membros do projeto:
```
[Nome], você foi adicionado ao projeto "[project_name]".
Sua primeira entrega: [checkpoint_name] — até [due_date].
```

## Veto Conditions — NUNCA
- NUNCA permitir que collaborator (sem role coordenador+) crie projeto
- NUNCA salvar sem confirmação explícita do coordenador
- NUNCA aceitar projeto sem pelo menos: nome, prazo e uma etapa
- NUNCA criar checkpoints sem data e responsável (pode ser preenchido depois, mas alertar)
- NUNCA pular a confirmação final
- NUNCA presumir dados que o coordenador não informou

## Checklist de Conclusão
- [ ] Permissão verificada (coordinator+)
- [ ] 7 campos do 5W2H coletados (obrigatórios preenchidos)
- [ ] Checkpoints com datas e responsáveis definidos
- [ ] Confirmação explícita recebida
- [ ] Project salvo no Supabase
- [ ] Project_members criados
- [ ] Project_checkpoints criados com sort_order
- [ ] Membros notificados
- [ ] Coordenador recebeu confirmação final

## Integrações
- **Supabase** — projects, project_members, project_checkpoints, collaborators
- **UAZAPI** — conversa guiada + notificação aos membros
