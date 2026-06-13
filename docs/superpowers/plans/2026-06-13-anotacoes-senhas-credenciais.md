# Anotações do Grupo — Senhas/Credenciais (cripto + recuperação TOM) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Guardar senhas cifradas em repouso nas fichas de grupo e o TOM recuperá-las sob demanda no chat, respeitando acesso.

**Architecture:** `pgcrypto` cifra o `value` dos campos `secret` via **trigger** (chave no **Vault**); PWA revela por **RPC member-checked**; o TOM, ao detectar pedido de credencial, busca a ficha que casa, decifra (service_role) e injeta só ela no prompt do turno.

**Tech Stack:** Supabase (pgcrypto 1.3 + supabase_vault 0.3.1, apply_migration MCP); backend Node CJS + `node:test`; PWA React+TS + vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-anotacoes-senhas-credenciais.md`

---

## Modelo de deploy (igual fatias anteriores)
- `_remote` não é git; **sem commit por task** (verificação = teste/tsc). PWA → auto-deploy no fim do turno; backend (`src/`) → SCP + `pm2 restart tom` na task final; DB → `apply_migration` MCP (`cesnbnrynvxvgdhfmaua`).
- Comandos: PWA `cd web && npx tsc --noEmit` / `npx vite build` / `npx vitest run src/lib/groupNotes.test.ts`; backend `node --check src/<f>.js` / `node --test src/services/group-notes.test.js`.
- **Escopo: só Grupos de Trabalho.** Validar no preview com **ficha descartável** ([[feedback_preview_autosave_mutates_real_data]]).

## File Structure
**Migrations:** vault key + `gn_decrypt` + `gn_encrypt_secret_fields`+trigger + `reveal_note_secret` + backfill.
**Backend:** `src/services/group-notes.js` (lookup + puras) + `group-notes.test.js`; `src/services/group-chat-engine.js` (hook); `src/services/group-chat-prompt.js` (param).
**PWA:** `web/src/lib/groupNotes.ts` (+test); `notes/FieldRow.tsx`; `notes/NoteDetail.tsx`; `notes/NoteEditor.tsx`; `notes/NotesTypeFilter.tsx`; `GrupoAnotacoes.tsx`.

---

## Task 1: Migration — Vault key + cripto + trigger + RPC + backfill

**Files:** `apply_migration` (name `group_notes_secret_crypto`).

- [ ] **Step 1: Aplicar a migration**
```sql
-- chave no Vault (idempotente)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'group_notes_secret_key') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'base64'), 'group_notes_secret_key', 'Chave simétrica das senhas das fichas de grupo');
  end if;
end $$;

create or replace function public.gn_decrypt(ciphertext text)
returns text language plpgsql security definer set search_path = public, vault, extensions as $$
declare k text;
begin
  if ciphertext is null or left(ciphertext,7) <> 'enc:v1:' then return ciphertext; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='group_notes_secret_key';
  if k is null then return ciphertext; end if;
  return pgp_sym_decrypt(decode(substr(ciphertext,8),'base64'), k);
end; $$;
revoke all on function public.gn_decrypt(text) from public, anon, authenticated;
grant execute on function public.gn_decrypt(text) to service_role;

create or replace function public.gn_encrypt_secret_fields()
returns trigger language plpgsql security definer set search_path = public, vault, extensions as $$
declare k text; arr jsonb := coalesce(NEW.fields,'[]'::jsonb); out jsonb := '[]'::jsonb; el jsonb; v text;
begin
  if jsonb_typeof(arr) <> 'array' then return NEW; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='group_notes_secret_key';
  if k is null then return NEW; end if;
  for el in select * from jsonb_array_elements(arr) loop
    if (el->>'secret')='true' and coalesce(el->>'value','')<>'' and left(el->>'value',7)<>'enc:v1:' then
      v := 'enc:v1:' || encode(pgp_sym_encrypt(el->>'value', k), 'base64');
      el := jsonb_set(el, '{value}', to_jsonb(v));
    end if;
    out := out || el;
  end loop;
  NEW.fields := out; return NEW;
end; $$;
drop trigger if exists gn_encrypt_secrets on public.group_notes;
create trigger gn_encrypt_secrets before insert or update on public.group_notes
  for each row execute function public.gn_encrypt_secret_fields();

create or replace function public.reveal_note_secret(p_note_id uuid, p_field_index int)
returns text language plpgsql security definer set search_path = public, vault, extensions as $$
declare g uuid; val text;
begin
  select group_id, (fields->p_field_index->>'value') into g, val from public.group_notes where id=p_note_id;
  if g is null then raise exception 'not_found'; end if;
  if not exists (select 1 from public.work_group_members where group_id=g and collaborator_id=current_collab_id()) then
    raise exception 'forbidden';
  end if;
  return public.gn_decrypt(val);
end; $$;
revoke all on function public.reveal_note_secret(uuid,int) from public, anon;
grant execute on function public.reveal_note_secret(uuid,int) to authenticated, service_role;

-- backfill: cifra os secrets já gravados (dispara o trigger)
update public.group_notes set fields = fields where fields::text like '%"secret":true%';
```

- [ ] **Step 2: Verificar (execute_sql)**
```sql
select id, jsonb_path_query_array(fields, '$[*] ? (@.secret == true).value') as secrets
from group_notes where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc';
```
Expected: se houver secrets, vêm como `enc:v1:…` (a nota "Contas a Pagar" não tem secret, então pode vir vazio — ok). Smoke do round-trip:
```sql
select left(public.gn_decrypt('enc:v1:' || encode(pgp_sym_encrypt('teste123', (select decrypted_secret from vault.decrypted_secrets where name='group_notes_secret_key')), 'base64')), 20) as roundtrip;
```
Expected: `teste123`.

---

## Task 2: `group-notes.js` — busca de credencial sob demanda (TDD)

**Files:** Modify `src/services/group-notes.js`; Test `src/services/group-notes.test.js`.

- [ ] **Step 1: Testes que falham** (append no test existente; estender o require)

require: `const { ..., pickType, renderTypesBlock, looksLikeCredentialRequest, scoreNoteMatch, buildCredentialBlock } = require('./group-notes');`
```js
test('looksLikeCredentialRequest: detecta intenção de credencial', () => {
  assert.ok(looksLikeCredentialRequest('qual a senha do cartão Santander'));
  assert.ok(looksLikeCredentialRequest('me passa o login do Zoho'));
  assert.ok(!looksLikeCredentialRequest('bom dia, tudo certo com as tarefas?'));
});
test('scoreNoteMatch: casa por título/rótulo/tag, ignora valor secreto', () => {
  const n = { title: 'Cartão Santander', tags: ['banco'], fields: [{ label: 'Final', value: '8443' }, { label: 'Senha', value: 'segredo', secret: true }] };
  assert.ok(scoreNoteMatch(n, ['santander']) >= 1);
  assert.ok(scoreNoteMatch(n, ['8443']) >= 1);
  assert.strictEqual(scoreNoteMatch(n, ['segredo']), 0); // valor secreto não entra no match
  assert.strictEqual(scoreNoteMatch(n, ['inexistente']), 0);
});
test('buildCredentialBlock: formata e instrui; vazio→""', () => {
  assert.strictEqual(buildCredentialBlock([]), '');
  const b = buildCredentialBlock([{ title: 'Cartão Santander', type: 'cartao', fields: [{ label: 'Senha', value: '1234' }] }]);
  assert.ok(b.includes('Cartão Santander') && b.includes('Senha: 1234'));
  assert.ok(/n[ãa]o despeje/i.test(b));
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/services/group-notes.test.js` → FAIL.

- [ ] **Step 3: Implementar em `group-notes.js`**
```js
function stripAccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function looksLikeCredentialRequest(text) { return /\b(senha|login|usu[áa]rio|usuario|acesso|credencial|c[óo]digo|pin)\b/i.test(String(text || '')); }
function credTokenize(text) { return [...new Set(stripAccent(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 3))]; }
function scoreNoteMatch(note, tokens) {
  const parts = [note.title, ...((note.tags) || []), ...((note.fields) || []).flatMap((f) => [f.label, f.secret ? '' : f.value])];
  const hay = stripAccent(parts.join(' '));
  return tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
}
function buildCredentialBlock(matches) {
  if (!matches || !matches.length) return '';
  const blocks = matches.map((m) => `### ${m.title} (${m.type || 'livre'})\n` +
    (m.fields || []).filter((f) => f.label || f.value).map((f) => `${f.label || '—'}: ${f.value || ''}`).join('\n')).join('\n\n');
  return `## Credencial(is) que casam com o pedido\n(responda só o que foi perguntado; NÃO despeje outras senhas)\n${blocks}`;
}
async function credentialLookupContext({ supabase, groupId, text }) {
  if (!looksLikeCredentialRequest(text)) return '';
  const tokens = credTokenize(text);
  if (!tokens.length) return '';
  const { data } = await supabase.from('group_notes').select('id, title, type, tags, fields').eq('group_id', groupId);
  const scored = (data || []).map((n) => ({ n, score: scoreNoteMatch(n, tokens) }))
    .filter((x) => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, 2);
  if (!scored.length) return '';
  const matches = [];
  for (const { n } of scored) {
    const fields = [];
    for (const f of (n.fields || [])) {
      if (!f.label && !f.value) continue;
      let value = f.value;
      if (f.secret && typeof value === 'string' && value.startsWith('enc:v1:')) {
        try { const { data: dec } = await supabase.rpc('gn_decrypt', { ciphertext: value }); if (dec != null) value = dec; } catch (_) {}
      }
      fields.push({ label: f.label, value });
    }
    matches.push({ title: n.title, type: n.type, fields });
  }
  return buildCredentialBlock(matches);
}
```
Exportar: adicionar `looksLikeCredentialRequest, scoreNoteMatch, buildCredentialBlock, credentialLookupContext` ao `module.exports`.

- [ ] **Step 4: Rodar e ver passar** — `node --test src/services/group-notes.test.js` → PASS; `node --check src/services/group-notes.js` → OK.

---

## Task 3: Engine + prompt — injetar a credencial no turno

**Files:** Modify `src/services/group-chat-engine.js`; `src/services/group-chat-prompt.js`.

- [ ] **Step 1: Engine — montar `credCtx`**
Em `group-chat-engine.js`, logo após o bloco do `notesCtx` (linha ~50):
```js
  let credCtx = '';
  try { credCtx = await groupNotes.credentialLookupContext({ supabase, groupId, text }); } catch (_) { credCtx = ''; }
```
E no `buildGroupChatPrompt({...})`, adicionar o campo:
```js
    credentialContext: credCtx, // credenciais que casam com o pedido deste turno (secrets decifrados)
```

- [ ] **Step 2: Prompt — aceitar e renderizar**
Em `group-chat-prompt.js`, na assinatura (linha ~18) adicionar `credentialContext`:
```js
function buildGroupChatPrompt({ soulText, groupName, members, pool, history, senderName, longTermMemory, notesContext, credentialContext, dateAnchor }) {
```
Logo após a linha que renderiza `notesContext` (`${notesContext ? ... : ''}`), adicionar:
```js
${credentialContext ? `\n${credentialContext}\n` : ''}
```

- [ ] **Step 3: Sanity** — `node --check src/services/group-chat-engine.js && node --check src/services/group-chat-prompt.js` → OK.

---

## Task 4: `lib/groupNotes.ts` — isEncrypted / notesWithSecrets / revealNoteSecret (TDD nas puras)

**Files:** Modify `web/src/lib/groupNotes.ts`; Test `web/src/lib/groupNotes.test.ts`.

- [ ] **Step 1: Testes que falham** (estender import + append)
import: adicionar `isEncrypted, notesWithSecrets`.
```js
describe('senhas (cripto)', () => {
  it('isEncrypted detecta o prefixo enc:v1:', () => {
    expect(isEncrypted('enc:v1:abc')).toBe(true);
    expect(isEncrypted('1234')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });
  it('notesWithSecrets filtra fichas com campo secret', () => {
    const a = N({ id: 'a', fields: [{ label: 'Senha', value: 'x', secret: true }] });
    const b = N({ id: 'b', fields: [{ label: 'Obs', value: 'y' }] });
    expect(notesWithSecrets([a, b]).map((n) => n.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd web && npx vitest run src/lib/groupNotes.test.ts` → FAIL.

- [ ] **Step 3: Implementar em `groupNotes.ts`**
```ts
export const isEncrypted = (v: string): boolean => typeof v === 'string' && v.startsWith('enc:v1:');
export function notesWithSecrets(notes: GroupNote[]): GroupNote[] {
  return notes.filter((n) => (n.fields || []).some((f) => f.secret));
}
export async function revealNoteSecret(noteId: string, fieldIndex: number): Promise<string> {
  const { data, error } = await supabase.rpc('reveal_note_secret', { p_note_id: noteId, p_field_index: fieldIndex });
  if (error) throw error;
  return (data as string) ?? '';
}
```

- [ ] **Step 4: Rodar e ver passar** — `cd web && npx vitest run src/lib/groupNotes.test.ts` → PASS.

---

## Task 5: `FieldRow.tsx` — revelar/copiar via RPC

**Files:** Modify `web/src/screens/grupos/notes/FieldRow.tsx`.

- [ ] **Step 1: Reescrever o componente**
```tsx
import { useState } from 'react';
import { Copy, Eye, EyeOff, ExternalLink, Check, Loader2 } from 'lucide-react';
import { revealNoteSecret, isEncrypted, type NoteField } from '../../../lib/groupNotes';

function normalizeUrl(v: string) { return /^https?:\/\//i.test(v) ? v : `https://${v}`; }

export function FieldRow({ field, noteId, index }: { field: NoteField; noteId?: string; index: number }) {
  const [shown, setShown] = useState(false);
  const [plain, setPlain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const isSecret = field.secret === true;
  const isUrl = field.kind === 'url' && !!field.value;
  const secretEnc = isSecret && isEncrypted(field.value);
  const display = !field.value ? '—' : isSecret ? (shown && plain != null ? plain : '••••••••') : field.value;

  async function ensurePlain(): Promise<string | null> {
    if (plain != null) return plain;
    if (!secretEnc) { setPlain(field.value); return field.value; } // secret legado/texto puro
    if (!noteId) return null;
    setBusy(true);
    try { const v = await revealNoteSecret(noteId, index); setPlain(v); return v; }
    catch { return null; } finally { setBusy(false); }
  }
  async function toggle() {
    if (shown) { setShown(false); return; }
    const v = await ensurePlain();
    if (v == null && secretEnc) return; // falha ao revelar → não abre
    setShown(true);
  }
  async function copy() {
    const v = isSecret ? await ensurePlain() : field.value;
    if (!v) return;
    navigator.clipboard?.writeText(v).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); });
  }

  return (
    <div className="flex items-center gap-md py-sm border-t border-border first:border-t-0">
      <span className="text-body-sm text-fg-muted w-24 shrink-0">{field.label || '—'}</span>
      <span className={`flex-1 min-w-0 truncate text-body-md ${isSecret ? 'tracking-widest' : ''} ${isUrl ? 'text-tom' : 'text-fg'} ${field.kind === 'password' || isUrl ? 'font-mono' : ''}`}>
        {display}
      </span>
      {field.value && (
        <div className="flex items-center gap-xs shrink-0 text-fg-muted">
          {isSecret && (
            <button type="button" onClick={toggle} aria-label={shown ? 'Esconder' : 'Mostrar'} className="p-1 rounded-sm hover:text-fg focus-ring">
              {busy ? <Loader2 size={15} className="animate-spin" /> : shown ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          {isUrl && (
            <a href={normalizeUrl(field.value)} target="_blank" rel="noreferrer" aria-label="Abrir link" className="p-1 rounded-sm hover:text-fg focus-ring">
              <ExternalLink size={15} />
            </a>
          )}
          <button type="button" onClick={copy} aria-label="Copiar" className="p-1 rounded-sm hover:text-fg focus-ring">
            {copied ? <Check size={15} className="text-tom" /> : <Copy size={15} />}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** — `cd web && npx tsc --noEmit` (vai apontar NoteDetail não passando noteId/index; resolve na Task 6).

---

## Task 6: `NoteDetail.tsx` — passar noteId + índice REAL do DB

**Files:** Modify `web/src/screens/grupos/notes/NoteDetail.tsx`.

- [ ] **Step 1: Iterar `note.fields` com índice original (não o filtrado)**
Trocar a derivação `const fields = (note.fields || []).filter(...)` e o bloco de render por:
```tsx
  const hasFields = (note.fields || []).some(f => f.label || f.value);
```
E o bloco que renderizava os fields:
```tsx
      {hasFields && (
        <div className="border-b border-border mb-lg">
          {(note.fields || []).map((f, i) => (f.label || f.value)
            ? <FieldRow key={i} field={f} noteId={note.id} index={i} />
            : null)}
        </div>
      )}
```
> O `index={i}` é o índice no array do banco — é o que o `reveal_note_secret(note_id, field_index)` usa. Atenção: o antigo usava o índice do array **filtrado**, que NÃO bate com o do banco.
Ajustar a condição vazia (`fields.length === 0 && !bodyHtml`) para usar `!hasFields && !bodyHtml`.

- [ ] **Step 2: Typecheck** — `cd web && npx tsc --noEmit` → PASS (FieldRow + NoteDetail).

---

## Task 7: `NoteEditor.tsx` — não apagar/expor secret cifrado ao editar

**Files:** Modify `web/src/screens/grupos/notes/NoteEditor.tsx`.

- [ ] **Step 1: Importar `isEncrypted`** — adicionar ao import de `groupNotes`.

- [ ] **Step 2: Input de valor do campo respeita o ciphertext**
Trocar o `<input>` do **valor** do campo por:
```tsx
            <input
              value={f.secret && isEncrypted(f.value || '') ? '' : f.value}
              onChange={e => setField(i, { value: e.target.value })}
              placeholder={f.secret && isEncrypted(f.value || '') ? '•••• (inalterado)' : 'Valor'}
              type={f.secret ? 'password' : 'text'}
              className="flex-1 min-w-0 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
```
> Lógica: campo secret cifrado mostra **vazio + placeholder**, mas o `draft` mantém o ciphertext no `value`. Sem digitar → salva o ciphertext (o trigger é idempotente, preserva). Ao digitar, `value` vira texto novo (`isEncrypted` passa a `false`) → o trigger recifra. Apagar tudo após digitar = deletar de propósito.

- [ ] **Step 3: Typecheck** — `cd web && npx tsc --noEmit` → PASS.

---

## Task 8: Filtro "🔑 Senhas"

**Files:** Modify `web/src/screens/grupos/notes/NotesTypeFilter.tsx`; `web/src/screens/grupos/GrupoAnotacoes.tsx`.

- [ ] **Step 1: NotesTypeFilter — chip de senhas**
Adicionar à interface `Props`: `secretsOnly?: boolean; onToggleSecrets?: () => void`. Na assinatura incluir `secretsOnly, onToggleSecrets`. Antes do `</div>` que fecha a row de chips, adicionar (só aparece se houver fichas com secret):
```tsx
      {notes.some(n => (n.fields || []).some(f => f.secret)) && onToggleSecrets && (
        <button type="button" className={chip(!!secretsOnly)} onClick={onToggleSecrets}>🔑 Senhas</button>
      )}
```

- [ ] **Step 2: GrupoAnotacoes — estado + filtro**
Importar `notesWithSecrets` de `groupNotes`. Adicionar estado: `const [secretsOnly, setSecretsOnly] = useState(false);`.
Aplicar no `filtered` (após o `filterNotes`):
```tsx
  const filtered0 = useMemo(() => filterNotes(notes, { type: typeFilter || undefined, query }), [notes, typeFilter, query]);
  const filtered = secretsOnly ? notesWithSecrets(filtered0) : filtered0;
```
(Renomear o `filtered` atual para `filtered0` e derivar `filtered`.) Passar pro `NotesTypeFilter`: `secretsOnly={secretsOnly} onToggleSecrets={() => setSecretsOnly(v => !v)}`. E desligar drag quando ativo: `const dragEnabled = !typeFilter && !query.trim() && !secretsOnly;`.

- [ ] **Step 3: Typecheck + build** — `cd web && npx tsc --noEmit && npx vite build` → PASS.

---

## Task 9: Deploy + e2e + registro

**Files:** nenhum novo.

- [ ] **Step 1: Bateria de testes** — `node --test src/services/group-notes.test.js` + `cd web && npx vitest run src/lib/groupNotes.test.ts` → PASS.
- [ ] **Step 2: Build PWA** — `cd web && npx tsc --noEmit && npx vite build` → PASS.
- [ ] **Step 3: Deploy backend** — SCP `src/services/group-notes.js`, `src/services/group-chat-engine.js`, `src/services/group-chat-prompt.js` → `tom:/opt/LA-Organizer/...` + `ssh tom "pm2 restart tom && sleep 2 && pm2 logs tom --lines 8 --nostream"` → "TOM pronto".
- [ ] **Step 4: SQL/integração (MCP execute_sql + VPS)**
  - Criar ficha de teste com campo secret via SQL `insert`/`update` (ou via PWA) → conferir que vem `enc:v1:…`.
  - `select public.reveal_note_secret('<id>', <idx>)` como service_role (MCP) → retorna texto. (member-check completo só dá pra validar com JWT de membro no PWA.)
- [ ] **Step 5: e2e preview (ficha descartável)** — localhost:4173, grupo Financeiro → Anotações:
  1. Criar ficha tipo Acesso "Teste QA" com Senha "abc123" → salvar.
  2. No banco: o campo Senha vem `enc:v1:…` (execute_sql).
  3. Detalhe: olho revela "abc123" (via RPC), copiar copia o texto.
  4. Editar a ficha → campo Senha aparece **vazio com "•••• (inalterado)"**; salvar sem digitar → senha **continua abc123** (não apagou).
  5. Filtro **🔑 Senhas** mostra só fichas com senha.
  6. **Apagar a ficha de teste** depois.
- [ ] **Step 6: dry-run TOM (VPS)** — `node --env-file=.env -e` chamando `credentialLookupContext({supabase: require('./src/supabase/client'), groupId:'d95f63af-...', text:'qual a senha do teste qa'})` → bloco com a senha decifrada; com `text:'bom dia'` → `''`.
- [ ] **Step 7: Registro** — `tom_known_issues` (atualizar `GROUPNOTES-BODY-HTML` ou novo `GROUPNOTES-SECRETS-CRYPTO`) + memória `project_groupchat_anotacoes_grupo.md` (seção "Senhas/cripto entregue") + lembrete pré-prod (rotacionar `group_notes_secret_key`).
- [ ] **Step 8: Fim do turno** — auto-deploy do PWA (sem push manual).

---

## Self-Review (feito)
- **Cobertura:** cripto trigger+vault (T1) ✓ · reveal RPC (T1/T4/T5) ✓ · TOM lookup sob demanda (T2/T3) ✓ · índice real no FieldRow (T6) ✓ · preservação do secret no editor (T7) ✓ · filtro 🔑 Senhas (T8) ✓ · deploy/e2e/registro (T9) ✓.
- **Placeholders:** nenhum — SQL/código completos; comandos com saída esperada.
- **Consistência:** `gn_decrypt`/`reveal_note_secret(p_note_id,p_field_index)` iguais entre SQL, `credentialLookupContext` (rpc `gn_decrypt {ciphertext}`) e `revealNoteSecret` (rpc `reveal_note_secret {p_note_id,p_field_index}`); `isEncrypted`/`notesWithSecrets` entre lib e consumidores; `credentialContext` entre engine e prompt; FieldRow recebe `noteId`+`index` (índice do array do banco).
- **Riscos:** índice do FieldRow precisa ser o do array do banco, não do filtrado (T6 cobre); editar secret cifrado não pode corromper (T7 mostra vazio, draft mantém ciphertext); `current_collab_id()` em SECURITY DEFINER vê o JWT do caller (mesmo padrão das RLS) — validar no e2e com usuário membro.
