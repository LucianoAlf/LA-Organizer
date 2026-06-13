# Anotações do Grupo — v2 (Fichas tipadas, tela cheia) — Design

**Data:** 2026-06-12
**Status:** Aprovado (mockup validado pelo Alf — tela cheia, fichas tipadas)
**Relacionado:** [[project_groupchat_anotacoes_grupo]] (v1) — substitui a UI; mantém backend.

## 1. Motivação
A v1 entregou um bloco de notas markdown num drawer apertado — reprovado pelo Alf (UI/UX
abaixo do padrão, nada a ver com a referência Notion da Rose). A Rose é organizadíssima:
ela **arquiva registros estruturados e busca rápido** (acessos login/senha/URL, CNPJs,
contas, reuniões), não escreve textão. A v2 troca a UI por **fichas tipadas** num **módulo
de tela cheia** (como Finanças/Transações), mantendo 100% do backend já validado.

## 2. Decisões (aprovadas via mockup)
1. **Tela cheia, rota própria** — não drawer. Layout: cabeçalho (migalha + título + busca +
   "Nova ficha") · barra de resumo (Fichas/Acessos/Contas/Fixadas) · chips de filtro por
   **tipo** · painel **lista + detalhe** com respiro. Mobile colapsa lista→detalhe.
2. **Fichas tipadas** — cada ficha tem um **tipo** com **campos `rótulo: valor`** (não corpo
   markdown cru). Tipos v1: `acesso` · `cnpj` · `conta` · `reuniao` · `livre`.
3. **Campos** = `fields` JSONB (`[{label, value, kind?, secret?}]`) — flexível, sem schema
   rígido; templates só pré-semeiam os rótulos. `kind`: `text|url|password`. `secret:true` →
   mascarado na UI com 👁 + copiar.
4. **Copiar 1-clique** em qualquer campo (login/senha/CNPJ); `kind:url` ganha "abrir".
5. **Observações livres** (`body`, markdown) embaixo dos campos — pro que não encaixa.
6. **TOM** preenche `fields` por tipo (marker estendido) e, quando a ficha está **fixada**,
   os valores dos campos entram no prompt → ele responde "a senha do Zoho é X".

## 3. Dados — alteração mínima em `group_notes`
Adiciona 2 colunas (migration aditiva, não quebra v1):
- `type text not null default 'livre'` (`acesso|cnpj|conta|reuniao|livre`).
- `fields jsonb not null default '[]'` — array de `{label, value, kind, secret}`.
`category` deixa de ser o eixo de filtro (vira o `type`); fica na tabela mas não central.
`tags`, `body`, `pinned`, RLS — inalterados.

## 4. Backend
- `group-notes.js`: `createGroupNote`/`appendGroupNote` aceitam `type` + `fields`.
  `groupNotesContext`: índice por `título (tipo) · tags`; **fixadas** renderizam os `fields`
  (`label: value`, sem mascarar — é o prompt server-side) + body.
- Marker `<<GROUP_NOTE>>` ganha `type` e `fields`:
  `{"action":"create","type":"acesso","title":"…","tags":[…],"fields":[{"label":"Login","value":"…"},{"label":"Senha","value":"…","secret":true,"kind":"password"}],"body":"…"}`
- Prompt (`group-chat-prompt.js`): doc dos tipos + quando usar `fields` vs `body`.

## 5. UI — módulo de tela cheia
- **Rota** `/grupos/:groupId/anotacoes` (botão 📒 navega; aposenta o drawer/overlay da v1).
- `GrupoAnotacoes.tsx` (responsivo: desktop = lista+detalhe lado a lado; mobile = lista→detalhe).
- Componentes: `NotesSummary` (4 métricas) · `NotesTypeFilter` (chips) · `NoteCard` (item da
  lista: ícone do tipo, título, valor-chave, tags, 📌) · `NoteDetail` (cabeçalho + `FieldRow`
  com copiar/olho/abrir + observações + dica TOM) · `NoteEditor` (CustomSelect de tipo →
  template de campos; linhas editáveis rótulo/valor + toggle secret; tags; body; auto-save).
- Ícones por tipo (Lucide): acesso=KeyRound, cnpj=Building2, conta=Banknote, reuniao=NotebookPen,
  livre=FileText. DS obrigatório, cor `tom`, tema escuro, guardrail 375/1440.
- `lib/groupNotes.ts`: estende `GroupNote` (type, fields) + `TEMPLATES` por tipo + `filterNotes`
  passa a filtrar por `type`. Hook `useGroupNotes` ganha fields/type no upsert.

## 6. Migração
Re-migrar a "Contas a Pagar 15/06/2026" da Rose: hoje está como group_note `livre` (body).
Reclassificar `type='conta'` + extrair um resumo em `fields` (Vencimento, Nº lançamentos,
Saldo) mantendo a lista no `body`. Script idempotente `migrate-rose-conta-to-fields.js`.

## 7. Fora de escopo (v3)
Line-items estruturados de "conta a pagar" (cada lançamento como linha com status/valor);
histórico/versão; templates customizáveis pelo grupo; anexos.
