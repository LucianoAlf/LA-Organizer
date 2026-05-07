---
name: consultar-projeto
description: Responde "como tá o projeto X?" / "como tá o festival?" / "minha parte no projeto Y?" filtrando o que cada papel pode ver (RLS já força isso, mas a skill ajusta o tom da resposta).
---

# Consultar status de projeto

## Quando usar

Usuário pergunta status de projeto pelo WhatsApp. Padrões:

- "Como tá o festival de cordas?"
- "Como tá o projeto X?"
- "Minha parte no festival?"
- "O que falta no festival?"
- "Tô envolvido em quais projetos?"

## Resolução do projeto pelo nome

Sprint 22.22 — projetos têm `name`. Pegue o termo da mensagem e busque por similaridade:

```sql
SELECT id, name, status, progress_percent, event_date
FROM projects
WHERE status IN ('planning', 'active', 'pending_approval', 'paused')
  AND name ILIKE '%' || $term || '%'
ORDER BY created_at DESC
LIMIT 5;
```

Se voltar mais de um, pergunte qual: *"Tem dois projetos com 'cordas' aqui — Festival de Cordas 2026 ou Workshop de Cordas 2025? Qual?"*

Se não voltar nenhum, fale direto: *"Não achei projeto com esse nome. Tem certeza que o nome é assim?"*

## O que o usuário pode ver (RLS faz o filtro automaticamente)

O RLS do banco já filtra. **NÃO tente burlar.** Apenas consulte e o banco devolve o que essa pessoa pode ver. Mas use o papel pra ajustar tom da resposta:

### Caso A — Usuário é `coordinator`/`director` global, OU `owner`/`coordinator` no projeto

Vê **tudo**: todas as tasks `context = 'work'` do projeto + checkpoints + contingências + time. Tasks `context = 'personal'` de qualquer pessoa **continuam invisíveis** mesmo pra ele (privacidade absoluta).

Resposta: visão completa.

### Caso B — Usuário é `member` do projeto

Vê: o projeto, checkpoints, contingências, time, **e só as tarefas dele mesmo** (`assigned_to = ele`). Não vê tasks de colegas.

Resposta: foque na parte dele. *"Sua parte no festival: 3 tarefas, 1 feita, 2 pendentes..."*

### Caso C — Usuário não é membro do projeto

RLS bloqueia. SELECT volta vazio. Responda: *"Você não tá nesse projeto. Quer que eu peça pro [owner] te incluir?"*

## Estrutura ideal da resposta

Use `computeProgress('project', collabId, projectId)` (helper Sprint 21) pra pegar % geral. Combine:

**Para coord/director / owner do projeto:**

```
🗂️ *Festival de Cordas 2026* — 30%
📅 Evento: 14/06

📋 *Próximo checkpoint:* Definir repertório (vence 03/05)

👥 *Time* (4):
- Luciano (owner) — 2 tasks, 1 feita
- Quintela (coordinator) — 5 tasks, 2 feitas
- Rafinha (member) — 3 tasks, 0 feitas
- Carlos Eduardo (externo, iluminador)

⚠️ *3 tarefas atrasadas.* Quer ver?
```

**Para member:**

```
🗂️ *Festival de Cordas 2026* — 30% (geral)
📅 Evento: 14/06

📋 *Sua parte:*
- ✅ Definir repertório de cordas baixas (concluída 02/05)
- ⏳ Ensaiar com 2º violinos (vence amanhã)
- ⏳ Conferir partituras (vence 06/05)

Tá em dia. Próxima: ensaio amanhã.
```

## Tom

- Direto. Sem firula.
- Numerado/bullet pra varredura visual rápida.
- Sempre puxa "próximo passo" se houver — usuário fica nutrido de contexto.
- Se atraso: marca com ⚠️, mas sem dramatizar.

## Diferença pra "como tá o time?" ou "o que o pessoal tá fazendo?"

Se a pergunta é sobre o time geral (não um projeto específico), não use essa skill — use `coordenacao-conversacional`. Esta skill é estritamente sobre status de **um projeto identificável**.

## Ações de follow-up que o TOM pode oferecer

Depois da resposta, ofereça (sem prescrever):

- *"Quer que eu liste as atrasadas?"*
- *"Quer adicionar uma tarefa pra alguém do time?"* (só pra owner/coord)
- *"Quer ver as contingências mapeadas?"*

Não force; ofereça uma só por vez.
