# Anotações do Grupo — Senhas/Credenciais (cofre dentro das fichas) + recuperação pelo TOM

**Data:** 2026-06-13
**Módulo:** Base de conhecimento do grupo (`group_notes`) — fichas tipadas
**Pré-requisitos:** Fatias A/B/C entregues (reorder/cor-ícone, editor+IA, tipos custom).
**Escopo desta fatia:** **só Grupos de Trabalho.** Espelho pras Anotações pessoais (`notes`) = fatia seguinte.

## Goal

Guardar senhas/credenciais com segurança nas fichas e deixar o **TOM recuperá-las sob demanda no chat** ("qual a senha do cartão Santander final 8443?"), respeitando acesso e com **criptografia em repouso**.

## Decisões aprovadas (brainstorming)

| Tema | Decisão |
|---|---|
| Recuperação | **Busca automática sob demanda** — TOM acha a ficha que casa e injeta só ela naquele turno. |
| Cripto | **pgcrypto + Vault agora** — campos `secret` cifrados em repouso. |
| Armazenamento | **Campos `secret` nas fichas tipadas** (Acesso/Cartão/etc.) + **visão "🔑 Senhas"** (filtro). Sem tabela nova. |
| Revelar | **No chat normalmente** (senha de grupo já é compartilhada; pessoal é DM). |
| Acesso | Só o que o **remetente** pode ver (membro do grupo). collaborator vem do **sender, nunca do marker**. |

## Arquitetura

```
WRITE  PWA/TOM mandam senha em texto (TLS) → TRIGGER gn_encrypt_secret_fields cifra value dos campos secret (enc:v1:…) no banco
READ   select * devolve ciphertext nos secrets → PWA mostra •••• ; revelar/copiar → RPC reveal_note_secret (member-check) → texto
TOM    chat → credentialLookupContext(text): intenção de credencial? → busca fichas do grupo por match → gn_decrypt → injeta no prompt do turno → "a senha é X"
CHAVE  simétrica no Supabase Vault (server-side); pgcrypto pgp_sym_encrypt/decrypt
```

Infra confirmada: `pgcrypto 1.3` + `supabase_vault 0.3.1` instalados.

---

## Banco (migrations via apply_migration MCP)

### 1. Chave no Vault (uma vez)
```sql
select vault.create_secret(encode(gen_random_bytes(32), 'base64'), 'group_notes_secret_key', 'Chave simétrica das senhas das fichas de grupo');
```
Leitura: `(select decrypted_secret from vault.decrypted_secrets where name='group_notes_secret_key')`.

### 2. Cifra/decifra (helpers SECURITY DEFINER)
```sql
create or replace function public.gn_decrypt(ciphertext text)
returns text language plpgsql security definer set search_path=public,vault,extensions as $$
declare k text;
begin
  if ciphertext is null or left(ciphertext,7) <> 'enc:v1:' then return ciphertext; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='group_notes_secret_key';
  if k is null then return ciphertext; end if;
  return pgp_sym_decrypt(decode(substr(ciphertext,8),'base64'), k);
end; $$;
revoke all on function public.gn_decrypt(text) from public, anon, authenticated; -- só service_role/definer
```

### 3. Trigger que cifra campos `secret` no write
```sql
create or replace function public.gn_encrypt_secret_fields()
returns trigger language plpgsql security definer set search_path=public,vault,extensions as $$
declare k text; arr jsonb := coalesce(NEW.fields,'[]'::jsonb); out jsonb := '[]'::jsonb; el jsonb; v text;
begin
  if jsonb_typeof(arr) <> 'array' then return NEW; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='group_notes_secret_key';
  if k is null then return NEW; end if; -- sem chave: não trava o save
  for el in select * from jsonb_array_elements(arr) loop
    if (el->>'secret')='true' and coalesce(el->>'value','')<>'' and left(el->>'value',7)<>'enc:v1:' then
      v := 'enc:v1:' || encode(pgp_sym_encrypt(el->>'value', k), 'base64');
      el := jsonb_set(el, '{value}', to_jsonb(v));
    end if;
    out := out || el;
  end loop;
  NEW.fields := out; return NEW;
end; $$;
create trigger gn_encrypt_secrets before insert or update on public.group_notes
  for each row execute function public.gn_encrypt_secret_fields();
```
Idempotente (prefixo `enc:v1:` não recifra). Campos não-secretos + body ficam texto puro. **Write path do PWA/TOM não muda.**

### 4. RPC de revelar (member-checked) — usada pelo PWA
```sql
create or replace function public.reveal_note_secret(p_note_id uuid, p_field_index int)
returns text language plpgsql security definer set search_path=public,vault,extensions as $$
declare g uuid; val text;
begin
  select group_id, (fields->p_field_index->>'value') into g, val from public.group_notes where id=p_note_id;
  if g is null then raise exception 'not_found'; end if;
  if not exists (select 1 from public.work_group_members where group_id=g and collaborator_id=current_collab_id()) then
    raise exception 'forbidden';
  end if;
  return public.gn_decrypt(val);
end; $$;
grant execute on function public.reveal_note_secret(uuid,int) to authenticated;
```
> Migração dos dados existentes: rodar um `update group_notes set fields=fields` (dispara o trigger) pra cifrar os secrets já gravados. (Hoje só há fichas no Financeiro; impacto mínimo.)

---

## PWA

- **`lib/groupNotes.ts`**: `revealNoteSecret(noteId, fieldIndex): Promise<string>` → `supabase.rpc('reveal_note_secret', { p_note_id, p_field_index })`. Helper `isEncrypted(value)` = `value.startsWith('enc:v1:')`.
- **`FieldRow.tsx`**: passa a receber `noteId` + `index`. Para campo `secret`:
  - Sempre mostra `••••` (o `value` que veio é ciphertext).
  - **Olho**: ao revelar, chama `revealNoteSecret(noteId, index)` (loading curto) e mostra o texto; esconder limpa da memória.
  - **Copiar**: busca via RPC e copia o texto (não o ciphertext).
  - Erro (forbidden/falha) → toast "Não consegui revelar".
- **`NoteDetail.tsx`**: passa `noteId={note.id}` + `index` ao `FieldRow`.
- **Editor (`NoteEditor`/`NoteTypeForm`)**: ao **editar** uma ficha, um campo secret já cifrado não deve aparecer como `enc:v1:…` no input. Regra: no editor, campo secret vem **vazio com placeholder "•••• (inalterado)"**; só sobrescreve se o usuário digitar algo novo (string vazia = mantém o atual). Evita regravar/expor o ciphertext.
- **Visão "🔑 Senhas"**: novo filtro no `NotesTypeFilter`/topo — mostra só fichas com ≥1 campo `secret` (`notes.filter(n => n.fields.some(f => f.secret))`). Pura `notesWithSecrets(notes)` em `groupNotes.ts`.

---

## Backend (TOM) — recuperação sob demanda

### `src/services/group-notes.js` (puro + I/O)
- `looksLikeCredentialRequest(text): boolean` — heurística PT: `/\b(senha|login|usu[áa]rio|acesso|credencial|c[óo]digo|pin)\b/i`.
- `scoreNoteMatch(note, tokens): number` — nº de tokens (len≥3, sem acento, lower) presentes em `title` + labels + valores **não-secretos** + tags.
- `credentialLookupContext({ supabase, groupId, text })`:
  1. Se `!looksLikeCredentialRequest(text)` → `''`.
  2. Carrega fichas do grupo (id, title, type, tags, fields).
  3. Score por match; pega **top ≤2 com score≥1**.
  4. Pra cada ficha escolhida, decifra os campos secret (`supabase.rpc('gn_decrypt', { ciphertext })`, service_role).
  5. Retorna bloco: `## Credencial(is) que casam com o pedido\n### <title> (<tipo>)\n<label>: <valor>\n…` + nota "responda só se o remetente perguntou; não despeje outras senhas".
- Pura testável: `looksLikeCredentialRequest`, `scoreNoteMatch`, `buildCredentialBlock(matches)`.

### `src/services/group-chat-engine.js`
Após o `notesCtx` (linha ~50), montar `credCtx = await groupNotes.credentialLookupContext({ supabase, groupId, text })` e passar pro prompt (novo campo `credentialContext` em `buildGroupChatPrompt`, injetado logo após o `notesContext`). Só naquele turno. `text` = mensagem do remetente; `senderCollabId` já é o sender real.

### `group-chat-prompt.js`
Aceitar `credentialContext` e renderizar (quando não-vazio) com uma linha de regra: "Use a credencial abaixo só pra responder o que foi perguntado."

---

## Segurança — honesto

- Chave no **Vault (server-side)** → protege contra **dump/backup vazado** e leitura SQL casual. **NÃO** protege contra **service_role comprometido** (o TOM precisa decifrar) nem comprometimento do projeto Supabase. É defesa-em-profundidade, não bala de prata — mas já é **muito melhor que grupo de WhatsApp**.
- Injeção de secret no prompt só em **mensagem com intenção de credencial** + **fichas que casam** (não despeja tudo todo turno).
- `gn_decrypt` não é exposto a `authenticated` (só `reveal_note_secret` member-checked + service_role).
- Revela no chat (sua escolha). Pré-prod: **rotação de chaves** (inclui `group_notes_secret_key`) + **JWT/rate-limit** no `/internal/*` (lista existente).

## Testes
- **vitest** (`groupNotes.test.ts`): `isEncrypted`, `notesWithSecrets`.
- **node --test** (`group-notes.test.js`): `looksLikeCredentialRequest` (positivos/negativos), `scoreNoteMatch` (casa por título/label/tag, ignora secret), `buildCredentialBlock`.
- **SQL/integração (VPS/MCP)**: inserir ficha com campo secret → no banco vem `enc:v1:…`; `reveal_note_secret` devolve texto pra membro e `forbidden` pra não-membro; `gn_decrypt` round-trip.
- **e2e preview** (ficha descartável): criar Acesso com Senha → recarregar → olho revela via RPC, copiar copia o texto; campo no banco cifrado. Apagar depois.
- **dry-run TOM** (VPS): `credentialLookupContext({groupId, text:'qual a senha do cartão X'})` retorna o bloco com a senha decifrada; com texto sem intenção → `''`.

## Fora de escopo (próxima fatia)
- Espelho pras **Anotações pessoais** (`notes`): mesma mecânica (trigger + RPC + reveal + lookup com escopo no próprio usuário).
- Gerar senha forte / auditoria de quem revelou / expiração.

## Arquivos
**Migrations:** vault key + `gn_decrypt` + `gn_encrypt_secret_fields`+trigger + `reveal_note_secret` + backfill `update group_notes set fields=fields`.
**Backend:** `src/services/group-notes.js` (lookup + puras) + test; `src/services/group-chat-engine.js` (hook); `src/services/group-chat-prompt.js` (campo credentialContext).
**PWA:** `web/src/lib/groupNotes.ts` (`revealNoteSecret`/`isEncrypted`/`notesWithSecrets`) + test; `FieldRow.tsx` (RPC reveal); `NoteDetail.tsx` (passa noteId/index); `NoteEditor.tsx`/`NoteTypeForm.tsx` (secret inalterado no editar); visão "🔑 Senhas" no filtro.
