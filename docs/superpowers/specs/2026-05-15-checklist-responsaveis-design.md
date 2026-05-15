# Checklist Templates — Responsável, Líder e Controles Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar campos de responsável e líder explícitos nos templates de checklist, com toggle de ativo/pausado no card e controle total via TOM no WhatsApp.

**Architecture:** Migração DB adiciona duas FKs nullable em `op_checklists`. O dispatcher usa essas FKs para envio e escalação, com fallback na lógica atual para templates legados sem responsável configurado. O frontend exibe campos customizados (sem selects nativos) e o TOM ganha skill de gestão de checklists.

**Tech Stack:** Supabase (PostgreSQL + RLS), Deno Edge Functions, React + Tailwind (design system próprio), TOM WhatsApp via UAZAPI.

---

## 1. Banco de Dados

### Novos campos em `op_checklists`

```sql
ALTER TABLE op_checklists
  ADD COLUMN responsible_id UUID REFERENCES collaborators(id) ON DELETE SET NULL,
  ADD COLUMN leader_id      UUID REFERENCES collaborators(id) ON DELETE SET NULL;
```

- Ambos **nullable** — templates existentes sem responsável configurado continuam funcionando via fallback (lógica atual de `function_role + shift`).
- `is_active` já existe — sem alteração.
- `function_role` e `shift` permanecem como metadado/categoria, mas o dispatcher **para de usá-los para roteamento** quando `responsible_id` está definido.

### RLS

Mesma política existente: só `director` e `coordinator` editam templates. A leitura de `collaborators` para popular os selects usa a política pública de leitura já existente.

---

## 2. Dispatcher (`src/rituals/dispatcher.js`)

### Quem recebe o checklist

```
se responsible_id IS NOT NULL:
  enviar só para esse colaborador (busca por ID)
senão:
  fallback: lógica atual (function_role + shift + unit)
```

### Escalação (líder)

```
se leader_id IS NOT NULL:
  escalar para esse colaborador
senão:
  fallback: gerente da unidade (comportamento atual)
```

### Pausa (`is_active = false`)

Template ignorado completamente pelo dispatcher — sem envio, sem log de erro.

### Timings — sem alteração

- 6h após dispatch sem conclusão → lembrete para o responsável
- 20min após lembrete sem resposta → escalação para o líder

### Justificativa do líder

Quando o líder responde ao TOM justificando a não-conclusão:
- TOM captura o texto da resposta
- Registra em `op_checklist_completions`: campos `justification TEXT`, `justified_at TIMESTAMPTZ`, `justified_by_id UUID`
- TOM para de cobrar aquela instância do dia

```sql
ALTER TABLE op_checklist_completions
  ADD COLUMN justification   TEXT,
  ADD COLUMN justified_at    TIMESTAMPTZ,
  ADD COLUMN justified_by_id UUID REFERENCES collaborators(id) ON DELETE SET NULL;
```

---

## 3. Frontend (`web/src/`)

### 3a. ChecklistTemplateSheet.tsx

Dois novos campos no formulário de edição, **abaixo de "Unidade"**:

**Responsável**
- Label: "RESPONSÁVEL"
- Componente: select customizado com avatar de iniciais + nome completo
- Dados: lista de `collaborators` ativos com `phone IS NOT NULL`, ordenada por `full_name`
- **Não usar `<select>` nativo** — usar componente do design system (popover/listbox customizado, mesmo padrão dos outros dropdowns do app)

**Líder (recebe alerta se não fizer)**
- Label: "LÍDER"
- Mesmo componente de select customizado
- Mesma fonte de dados (todos os colaboradores ativos)

**Status (Ativo/Pausado)**
- Toggle booleano visível dentro do modal, linha com label "STATUS" + toggle + texto "Ativo"/"Pausado"

### 3b. TemplateCard.tsx (card na lista)

Substituir linha de `function_role` label por:

```
[avatar YM] Responsável: Yuri Marinho
[avatar LA] Líder: Luciano Alf
```

- Avatar: iniciais com cor gerada por hash do nome (padrão existente no app)
- Se `responsible_id` não está configurado: exibir `function_role` label como fallback (backward compat)

**Toggle de ativo/pausado** no canto superior direito do card:
- Estado visual: vermelho/on vs cinza/off
- Badge: "● Ativo" (verde) ou "● Pausado" (vermelho)
- Click no toggle chama `PATCH op_checklists SET is_active = !current` sem abrir modal

### 3c. Constraint de UI

> **Todos os selects/dropdowns nesta feature devem usar o componente customizado do design system do app — nunca o `<select>` nativo do browser/OS.**

---

## 4. TOM — Skill `checklists-admin`

### Triggers de ativação

- "lista checklists", "quais checklists temos", "mostra os checklists"
- "desliga checklist X", "pausa checklist X", "liga checklist X"
- "troca responsável do checklist X para Y"
- "quem é responsável pelo checklist X"

### Comandos e respostas

**Listar:**
```
📋 Checklists ativos (3):
• Fechamento Escola — Yuri Marinho | Líder: Luciano | ✅ Ativo
• Abertura Escola — Jereh | Líder: Luciano | ✅ Ativo
• Limpeza — Clayton | Líder: Krissya | ⏸ Pausado
```

**Ligar/Desligar:**
```
TOM: ⏸ "Fechamento Escola" pausado. Yuri não vai receber até você religar.
TOM: ✅ "Fechamento Escola" ativado. Yuri vai receber normalmente a partir de amanhã.
```

**Trocar responsável:**
```
TOM: ✅ Responsável do "Fechamento Escola" trocado de Yuri para Clayton.
```

**Implementação:**
- Skill lê templates via Supabase client com service_role (dentro do sistema TOM)
- Edições via `UPDATE op_checklists SET ... WHERE name ILIKE '%termo%'`
- Ambiguidade (mais de um template com nome parecido): TOM pergunta qual
- Pessoa não encontrada: TOM lista colaboradores ativos com nome parecido

---

## 5. Fluxo Completo (end-to-end)

```
[Dispatcher] 22:00 → Yuri recebe checklist
[Yuri] não responde em 6h
[Dispatcher] → lembrete para Yuri
[Yuri] não responde em 20min
[Dispatcher] → alerta para Luciano (líder configurado):
  "⚠️ Yuri não fechou Fechamento Escola (7 itens faltando)"
[Luciano] responde: "ele saiu mais cedo, eu fechei"
[TOM] registra justificativa em op_checklist_completions
[TOM] para de cobrar Yuri/Luciano por aquela instância
```

---

## 6. O que NÃO muda

- Timings de reminder/escalação (6h + 20min) — hardcoded, não configurável por template agora
- Lógica de idempotência (`op_checklist_completions` por reference_date + collaborator_id)
- Permissões de visualização (só director e coordinator veem gestão de templates)
- Tabela `op_checklists_audit` para histórico de edições
