# Anotações do Grupo v2 (Fichas tipadas, tela cheia) — Plano

> Executado inline (executing-plans). Backend da v1 reaproveitado; foco = UI nova + fields/type.

**Goal:** Trocar a UI das anotações do grupo por um módulo de tela cheia com fichas tipadas
(campos rótulo:valor + copiar), mantendo backend/RLS/TOM da v1.

---

## Task 1 — Migration: `type` + `fields`
`apply_migration` (cesnbnrynvxvgdhfmaua): `alter table group_notes add column type text not null
default 'livre'; add column fields jsonb not null default '[]';`. Verificar colunas.

## Task 2 — Backend `group-notes.js` + teste
- `createGroupNote`/`appendGroupNote`: aceitam `note.type` (default 'livre') e `note.fields`
  (array, sane-default []). `appendGroupNote` continua só body.
- `groupNotesContext`: índice = `- <title> (<type>)<tags>`; fixadas renderizam fields
  (`label: value`) + body.
- Estender `group-notes.test.js`: create grava type+fields; context de fixada inclui valor de field.

## Task 3 — Marker + prompt
- `group-chat-engine.js`: parse já genérico (JSON.parse) — passar `type` e `fields` ao
  createGroupNote. Render do chip inalterado.
- `group-chat-prompt.js`: doc do marker com `type` + `fields` + quando usar campo vs body.

## Task 4 — PWA `lib/groupNotes.ts` + vitest
- `GroupNote` ganha `type: NoteType` e `fields: NoteField[]` (`{label,value,kind?,secret?}`).
- `TEMPLATES: Record<NoteType,{label,icon,fields:{label,kind?,secret?}[]}>`.
- `NOTE_TYPES` (ordem dos chips) + `typeMeta(type)`.
- `filterNotes` ganha `type?`; `upsertGroupNote` grava type+fields.
- vitest: filterNotes por type; template tem campos certos.

## Task 5 — PWA componentes (`screens/grupos/notes/`)
- `NoteCard.tsx` (item lista: ícone tipo, título, valor-chave/secundário, tags, 📌).
- `FieldRow.tsx` (rótulo + valor; copiar; se secret → mascara + 👁; se kind=url → abrir).
- `NoteDetail.tsx` (cabeçalho com tipo/autor/data + ações pin/edit/delete; FieldRows; obs; dica TOM).
- `NoteEditor.tsx` (CustomSelect de tipo → semeia template; linhas rótulo/valor editáveis +
  add/remove + toggle secret; tags; textarea body; auto-save debounce).
- `NotesSummary.tsx` (4 StatCard) + `NotesTypeFilter.tsx` (chips).
- `GrupoAnotacoes.tsx` (página: header+busca+Nova, summary, chips, lista+detalhe; responsivo
  desktop two-pane / mobile lista→detalhe).

## Task 6 — Rota + navegação + aposentar drawer
- Rota `/grupos/:groupId/anotacoes` no router; botão 📒 do `GrupoWorkspace` navega (remove o
  overlay `notesOpen` + `GroupNotesEnv`). Header da página com voltar pro grupo.
- tsc + vite build limpos.

## Task 7 — Re-migrar conta da Rose
Script `migrate-rose-conta-to-fields.js`: a group_note "Contas a Pagar 15/06/2026" → `type='conta'`
+ fields resumo (Vencimento 15/06, Lançamentos N, Saldo —), body mantém a lista. Idempotente.

## Task 8 — Validação + registro
Preview localhost:4173 (criar ficha Acesso com login/senha/URL → copiar/olho/abrir, filtro por
tipo, fixar → TOM lê) + screenshot. Deploy backend. Atualizar known issue GROUPCHAT-GROUP-NOTES-V1
(v2) + memória.
