# Espelho do módulo de Anotações: Grupo → Pessoal — Design

**Data:** 2026-06-13
**Autor:** Claude + Alf
**Fatia:** Espelho pessoal (paridade do `/anotacoes` com o módulo de grupo)
**Status:** design aprovado (aguarda review da spec)

---

## 1. Objetivo

Levar **exatamente o módulo de anotações do grupo** (fichas tipadas + editor rico +
IA semântica + cor/ícone + reorder + tipos custom + senhas cifradas) para as
**Anotações pessoais** (`/anotacoes`, tabela `notes`), **preservando** o que é
exclusivo do pessoal e **descartando** o que é de grupo.

Decisões do Alf (13/06): **completo, com senhas** · **tipos custom por usuário** ·
**layout two-pane igual ao grupo** · **parametrizar** os componentes do grupo (não
duplicar) — com validação do grupo no fim pra garantir zero regressão.

## 2. Escopo

**Entra (espelho):** colunas `type/fields/color/icon/sort_order/tags` em `notes`;
editor rico (TipTap) no corpo; IA "Formatar com o TOM" (motor já compartilhado);
fichas tipadas com campos rótulo:valor; tipos custom por usuário; reorder dnd-kit;
senhas cifradas + TOM recupera no WhatsApp 1:1; layout two-pane.

**Preserva (exclusivo do pessoal):** **"Virar tarefas"** (linhas do corpo → tarefas),
**compartilhar** (`shared_with`, leitura), **arquivar**, "de fulano (leitura)",
badge via TOM/app, `source`.

**Não entra (de grupo):** membros/governança, "fixar pro TOM do chat de grupo"
(no pessoal o TOM lê via prompt 1:1). Estender o marker `<<NOTE_ACTION>>` pra
type/fields fica fora (TOM continua criando/lendo texto; ficha tipada via app).

## 3. Não-objetivos

- Não criar tabela nova: **estende `notes`**.
- Não tocar no comportamento do módulo de grupo (parametrização é aditiva,
  default = grupo).
- Não mudar modelo/auth da IA (Sonnet via OAuth, já entregue na Fatia D).

## 4. Arquitetura — reuso vs parametrização vs específico

A infra de cripto já é **genérica** (confirmado no banco):
`gn_encrypt_secret_fields()` opera em `NEW.fields` sem citar `group_notes`;
`gn_decrypt(text)` e a key do Vault `group_notes_secret_key` são reusáveis.

**Reuso direto (sem tocar — zero risco pro grupo):** `IconRegistry`/`NoteGlyph`,
`RichEditor`, `FormatPreview`, `NoteCard`, `NotesSummary`, `NotesTypeFilter`, e os
puros de `lib/groupNotes.ts` (`buildTypeIndex`, `resolveColor/Icon`, `typeLabel`,
`templateForType`, `slugifyType`, `bodyToHtml`, `isEncrypted`, `notesWithSecrets`,
`typesWithCount`, `renumber`, `NOTE_COLORS/ICONS`).

**Parametrizar (prop opcional, default = grupo):**
- `FieldRow` ganha `onReveal?: (noteId, index) => Promise<string>`. Sem a prop →
  usa `revealNoteSecret` (grupo) como hoje. Pessoal passa `revealPersonalNoteSecret`.
- `NoteEditor` ganha `onNewType?: () => void`/fonte de tipos opcional — sem ela,
  abre o `NoteTypeForm` de grupo (atual). Pessoal passa o form pessoal.
- `NoteTypeForm` ganha `save?` (mutation) — default = grupo.

**Específico do pessoal (novos arquivos):**
- `screens/anotacoes/Anotacoes.tsx` — **reescrita** two-pane espelhando
  `GrupoAnotacoes.tsx` (lista + detalhe, resumo, chips, reorder), mas com a barra de
  ações do pessoal.
- `screens/anotacoes/NotaDetalhe` vira o detalhe pessoal: reusa os blocos (campos via
  `FieldRow` com `onReveal` pessoal; corpo via `bodyToHtml`) + os extras pessoais
  (virar tarefas / compartilhar / arquivar / "de fulano").
- `hooks/useNotes.ts` — estende `Note` (+`type/fields/color/icon/sort_order/tags`),
  `create/update` aceitam os campos, `reorder`, e `useNoteTypes` (pessoal).
- `lib/personalNotes.ts` — IO pessoal: `loadNoteTypes/upsert/delete` (por dono),
  `revealPersonalNoteSecret(noteId,index)` = `rpc('reveal_personal_note_secret')`.
  Resolvers/índice reaproveitados de `groupNotes.ts` (re-export).

## 5. Banco (migration)

```sql
-- 5.1 Estende notes (espelho de group_notes)
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS type       text   NOT NULL DEFAULT 'livre',
  ADD COLUMN IF NOT EXISTS fields     jsonb  NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS color      text,
  ADD COLUMN IF NOT EXISTS icon       text,
  ADD COLUMN IF NOT EXISTS sort_order int    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags       text[] NOT NULL DEFAULT '{}';

-- 5.2 Tipos custom POR USUÁRIO
CREATE TABLE IF NOT EXISTS note_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  key text NOT NULL, label text NOT NULL,
  color text, icon text, fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collaborator_id, key)
);
ALTER TABLE note_types ENABLE ROW LEVEL SECURITY;
-- RLS = dono (current_collab_id) + service_role ALL
CREATE POLICY nt_owner_all ON note_types FOR ALL
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY nt_service_all ON note_types FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 5.3 Cripto em notes.fields — REUSA o trigger fn genérico do grupo
CREATE TRIGGER notes_encrypt_secrets BEFORE INSERT OR UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION gn_encrypt_secret_fields();

-- 5.4 Reveal pessoal (só DONO; mesmo numa nota compartilhada o segredo não vaza)
CREATE OR REPLACE FUNCTION reveal_personal_note_secret(p_note_id uuid, p_field_index int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','vault','extensions' AS $$
declare o uuid; val text;
begin
  select collaborator_id, (fields->p_field_index->>'value') into o, val from public.notes where id=p_note_id;
  if o is null then raise exception 'not_found'; end if;
  if o <> current_collab_id() then raise exception 'forbidden'; end if;
  return public.gn_decrypt(val);
end; $$;
GRANT EXECUTE ON FUNCTION reveal_personal_note_secret(uuid,int) TO authenticated, service_role;
```

`gn_decrypt` e a key do Vault são reusados como estão. Notas existentes têm
`fields='[]'` → nada a cifrar (backfill desnecessário). RLS de CRUD do `notes` já
existe (dono tudo; `shared_with` leitura) — inalterada.

## 6. PWA

**`lib/personalNotes.ts`** (novo): re-exporta resolvers/índice de `groupNotes.ts`;
IO de tipos pessoais (`note_types` por dono) e `revealPersonalNoteSecret`.

**`hooks/useNotes.ts`** (estende): `Note` += `type/fields/color/icon/sort_order/tags`;
`createNote` aceita os campos (default tipo 'livre'); `updateNote` idem; `reorder`
(renumber + update otimista, anti-reshuffle [[project_sort_reload_reshuffle]]);
`useNoteTypes()` (React Query por dono). `list` ordena `pinned, sort_order, updated_at`.

**UI two-pane** (`Anotacoes.tsx` reescrita, espelha `GrupoAnotacoes`): cabeçalho
(busca + "Nova ficha"), `NotesSummary`, `NotesTypeFilter` (+ chip 🔑 Senhas),
lista `NoteCard` com reorder (dnd-kit, só na visão "Todas"), detalhe = `NotaDetalhe`
pessoal. Mobile lista→detalhe. Detalhe pessoal: `NoteEditor` (reusado) em edição;
em leitura, campos via `FieldRow`+`onReveal` pessoal + corpo `bodyToHtml` + barra de
ações pessoal (📌 fixar, ⚡ virar tarefas, 👥 compartilhar, 🗄️ arquivar, 🗑️ excluir).

**"Virar tarefas" com corpo HTML:** `splitNoteLines(htmlToPlain(body))` — extrai
texto do HTML antes de detectar linhas acionáveis. Resto do fluxo
(`VirarTarefasSheet`, `note_task_links`) inalterado.

## 7. TOM no WhatsApp 1:1 (senhas pessoais)

- `src/services/notes.js`: `credentialLookupContext({ supabase, collaboratorId, text })`
  — espelha o do grupo: `looksLikeCredentialRequest` (reusa o de group-notes) +
  `scoreNoteMatch` nas notas **do dono** (título/rótulo/valor-não-secreto/tag) →
  top match → `gn_decrypt` dos campos secret → bloco de texto.
- `src/engine.js`: antes de `buildSystemPrompt`, chama `credentialLookupContext` e
  passa um `credentialBlock` pra `buildContext` (system.js) → novo bloco no prompt 1:1
  ("🔑 Credencial pedida: …"), só na intenção, só a ficha que casa. Escopo = o próprio
  colaborador (id do remetente, **nunca** do LLM).
- "Tom, qual minha senha da Netflix?" → acha + decifra + responde. `<<NOTE_ACTION>>`
  inalterado.

## 8. Segurança

- Campo `secret` só o **dono** decifra (`reveal_personal_note_secret` checa
  `collaborator_id = current_collab_id()`); numa nota **compartilhada** o destinatário
  vê a ficha mas a senha fica `••••`.
- TOM decifra via service_role (`gn_decrypt`) só pro próprio dono (id do remetente).
- ⚠️ Pré-prod [[project_rotate_keys_before_prod]]: rotacionar `group_notes_secret_key`
  + JWT/rate-limit no `/internal/format-note`. Cripto protege dump/backup, não
  service_role comprometido.

## 9. Testes

- Puros: `lib/personalNotes` (re-exports/índice) + `useNotes` (campos novos) via
  vitest; `notes.js` `credentialLookupContext` via node --test (TDD, espelha
  group-notes.test).
- Migration validada por SQL (trigger cifra `notes.fields`; `reveal_personal_note_secret`
  round-trip; reveal por NÃO-dono → forbidden).
- `npx tsc --noEmit` + `npx vite build` + `node --test`.
- e2e preview (ficha descartável / read-only — **preview muta dado REAL**): criar ficha
  pessoal com senha → olho revela (dono) → 🔑 filtro → IA Organizar (Descartar) →
  "virar tarefas" → apagar ficha. Dry-run VPS: TOM 1:1 "qual minha senha da X?".
- **Regressão grupo:** revalidar o grupo da Rose (FieldRow reveal + editor) pós-parametrização.

## 10. Arquivos

| Arquivo | Ação |
|---|---|
| migration `anotacoes_pessoais_espelho` | notes +cols, note_types +RLS, trigger, reveal RPC |
| `web/src/lib/personalNotes.ts` | novo (IO pessoal + re-export resolvers) |
| `web/src/hooks/useNotes.ts` | estende Note + create/update/reorder + useNoteTypes |
| `web/src/screens/anotacoes/Anotacoes.tsx` | reescrita two-pane |
| `web/src/screens/anotacoes/NotaDetalhe.tsx` | detalhe pessoal (reusa blocos + extras) |
| `web/src/screens/grupos/notes/FieldRow.tsx` | + prop `onReveal?` (default grupo) |
| `web/src/screens/grupos/notes/NoteEditor.tsx` | + fonte de tipos/form opcional |
| `web/src/screens/grupos/notes/NoteTypeForm.tsx` | + `save?` opcional |
| `src/services/notes.js` | + `credentialLookupContext` pessoal |
| `src/engine.js` + `src/prompts/system.js` | injeta `credentialBlock` no prompt 1:1 |

## 11. Execução (inline, faseada)

1. Migration (notes +cols, note_types, trigger, reveal RPC) + validação SQL.
2. `lib/personalNotes.ts` + `useNotes` estendido + `useNoteTypes` (TDD vitest).
3. Parametrizar FieldRow/NoteEditor/NoteTypeForm (props opcionais, default grupo).
4. UI two-pane `Anotacoes.tsx` + detalhe pessoal (reuso).
5. "Virar tarefas" com `htmlToPlain`.
6. Backend TOM 1:1: `credentialLookupContext` + injeção no `system.js` (TDD).
7. Deploy (PWA auto + backend SCP) + e2e (preview + dry-run) + **regressão grupo**.
8. Registro `tom_known_issues` + memória.

## 12. Registro

Known-issue `PERSONALNOTES-MIRROR` (área anotações): espelho do módulo de grupo pro
pessoal, fichas tipadas + cripto + TOM 1:1; sinal de reincidência = "anotação pessoal
sem tipo/campos" ou "senha pessoal não recuperada pelo TOM".
