# Spec — Módulo Anotações (caderninho pessoal + vira-tarefa)

> Origem: uso real da Rose (10/06/2026, 00:54) — ditou uma ata de reunião completa pro TOM
> ("Cria uma anotação pra mim?"); foi parar em `collaborator_memory` (invisível no app).
> Brainstorm com Alf 10/06: decisões A/A/B/A + interação B com sheet de ajuste. Mockup
> aprovado em `.superpowers/brainstorm/111719-1781098068/content/anotacoes-layout.html`.

## Decisões de produto (fechadas com o Alf)

1. **Escopo**: caderninho pessoal — anotações soltas (ditadas pro TOM ou criadas no PWA),
   lista com busca, fixar, arquivar. NÃO é ata estruturada nem nota vinculada (v2).
2. **Arquitetura**: tabela própria `notes`. Anotação = documento do USUÁRIO;
   `collaborator_memory` segue separada como cérebro interno do TOM (intocada).
3. **Privacidade**: privada por default; dono pode **compartilhar** com pessoas
   específicas já no MVP (decisão do Alf, contra recomendação YAGNI). Compartilhado = leitura.
4. **Formato**: título + corpo de TEXTO LIVRE (verbatim do ditado). Estrutura é extraída
   na hora de agir, não imposta na escrita.
5. **Vira-tarefa**: modo "⚡ Virar tarefas" (leitura limpa; botão liga seleção por linha)
   → BottomSheet de ajuste: responsável + prazo em LOTE com ajuste fino por linha →
   tarefas nascem prontas (dono, prazo, vínculo de origem). Exigência do Alf: sem isso o
   vira-tarefa "muda o trabalho de lugar" (tarefa crua que a pessoa tem que reeditar).

## 1. Banco

```sql
create table notes (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references collaborators(id),  -- dono
  title text not null default '',
  body text not null default '',
  pinned boolean not null default false,
  archived boolean not null default false,
  source text not null default 'pwa' check (source in ('tom','pwa')),
  shared_with uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table note_task_links (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  line_no int not null,
  created_at timestamptz not null default now(),
  unique (note_id, line_no, task_id)
);
```

- **RLS** (padrão módulo pessoal — `current_collab_id()`, NUNCA `auth.uid()` — 17/24
  colaboradores têm id fora de auth.users):
  - `notes`: dono ALL (`collaborator_id = current_collab_id()`);
    compartilhado SELECT (`current_collab_id() = any(shared_with)`).
  - `note_task_links`: SELECT/INSERT pelo dono da note (subquery em notes).
- TOM escreve via service_role (bypassa RLS) → `collaborator_id` vem do REMETENTE no
  engine, **nunca** do marker (regra cravada do projeto).
- NÃO adicionar coluna em `tasks` — o vínculo mora em `note_task_links`.

## 2. TOM — marker, skill, contexto

**Marker `<<NOTE_ACTION>>`** (handler determinístico no engine, padrão dos demais):

```
{"action":"create", "title":"Reunião com ADMS", "body":"...texto verbatim...", "share_with":["Krissya","Clayton"]}
{"action":"append", "note":"latest"|"<id8>", "body":"...linhas a anexar..."}
{"action":"share",  "note":"latest"|"<id8>", "share_with":["Ana"]}
```

- `share_with`: NOMES resolvidos pelo engine contra `collaborators` (padrão do
  comunicados): match único → id; não encontrado/ambíguo → não aplica + avisa no reply.
  JAMAIS uuid vindo do LLM sem validação.
- `note:"latest"` = anotação mais recente DO REMETENTE (escopado, lição APROVACAO-SEM-FUNIL).
- Resultado executa com log em `marker_logs` (NOTE_ACTION executed/rejected) e o reply
  segue a regra fala=persistência (sem "Anotado!" se o insert falhou — branch igual ao
  all_failed do PREFS).

**Skill `skills/anotacoes.md`**: gatilhos "cria uma anotação", "anota aí", "adiciona na
anotação", "compartilha a anotação com X"; confirma leve antes de gravar (mostra título
+ 1ª linha); veto de jargão; instrução: anotação ≠ tarefa ≠ memória (se a pessoa pedir
"me lembra", é task; se pedir "anota", é note).

**Contexto no prompt** (`system.js`): bloco "📒 Anotações recentes" — últimas 5 do
colaborador (título · idade · 1ª linha, ~80 chars) + corpo da mais recente capado em
600 chars. Cobre "me lê a anotação da reunião" sem inflar o prompt.

## 3. PWA

- Rota `/anotacoes` — entrada em **Mais → Anotações** (mobile) e sidebar desktop (seção
  pessoal). Dispatcher `Anotacoes.tsx` → `AnotacoesMobile/Desktop` (guardrail das rotas).
- **Lista** (mockup aprovado): busca client-side, 📌 fixadas primeiro, badges 🔒/👥/📌,
  origem ("via TOM 💬" / "criada no app"), compartilhadas-comigo com badge "de <nome>",
  FAB `+`. Tokens DS: `bg-tom` + `text-black`, `bg-bg-surface`, `text-fg`, `border-border`.
- **Detalhe/editor**: título + textarea autosave (padrão Configurações, debounce),
  compartilhar via chips de pessoas (componente da Governança), fixar, arquivar, excluir
  (confirmação). Compartilhado abre read-only.
- **⚡ Virar tarefas**: botão no detalhe → linhas do corpo (split `\n`; REGRA: linha
  vazia e linha-header — terminada em `:` — não viram checkbox; o resto vira, com
  bullet `•/-/·/número.` removido do título proposto) viram checkboxes → barra "Criar N tarefas →" →
  **BottomSheet**: `CustomSelect` responsável (default eu) + `DateInput`/atalhos prazo
  (default sem prazo), aplicados ao lote; lista das linhas com título editável e
  override individual de responsável/prazo → cria via caminho de criação existente
  (mesmas permissões/notificações de atribuição de hoje) + insere `note_task_links` →
  linha ganha "✓ criada". Na tarefa, chip "📒 da anotação: <título>" (lookup do link).

## 4. Migração (dado vivo)

INSERT em `notes` a partir da `collaborator_memory 0080ea63` da Rose
(título "Reunião com ADMS CG, Recreio e Barra", source='tom', dono=Rose
8bfb18b6-3c2e-4579-b4a9-06409d7e84c4). A memória permanece ativa (cérebro do TOM).
Avisar a Rose ao final: a ata dela está no app.

## 5. Fora do MVP (v2 — anotado)

Markdown rico · anexos/fotos · ata estruturada (participantes/decisões) · vínculo a
evento/projeto/pessoa · edição por quem recebe compartilhado · comentários/recibo de
leitura · **tarefas de grupo/pool compartilhado** (pedido da Rose 10/06: "grupo do
financeiro eu+Ana, ela vê tudo sem eu delegar" — RADAR, brainstorm próprio, chip criado).

## 6. Validação

- Unit (node --test): resolução de nomes do `share_with` (único/ambíguo/ausente);
  parser do NOTE_ACTION (malformed → rejeita sem engolir reply); split de linhas do
  vira-tarefa (bullets, headers, vazias).
- Preview (antes de chamar o Alf): 375px e 1440px via preview_eval + screenshot
  (localhost:4173, limpando SW cache).
- E2E real: ditar anotação pro TOM na VPS (replay), conferir INSERT + bloco no prompt.
- Protocolo: consultar `tom_known_issues` antes de cada bug; registrar o que surgir.
