# Chat de Grupo — Fase 1 (chat humano + render + anexos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membros de um grupo conversam em tempo real dentro do `/grupos/:id` (drawer 380px + tela cheia + mobile), com anexos (imagem/PDF/áudio) e renderização HTML segura — sem o TOM responder sozinho ainda (Fase 2).

**Architecture:** Tabela `group_chat_messages` (channel-agnostic pro espelho WhatsApp futuro) + RLS de membro + realtime existente. Hook `useGroupChat` (query+send+upload). Componentes de UI fiéis ao mockup, tokens DS, avatar real do TOM. Funções puras de agrupamento testadas (vitest).

**Tech Stack:** React+TS+Vite+Tailwind (DS), @tanstack/react-query, supabase-js (RLS + storage), dompurify + marked (render seguro), MediaRecorder (áudio), vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-chat-grupo-design.md` · **Mockup canônico (UI fiel):** `docs/superpowers/specs/assets/2026-06-11-chat-grupo-mockup.html`

**Regras do repo:** `_remote` NÃO é git (auto-deploy no Stop hook → SEM steps de commit/git). Validação: `cd _remote/web && npx tsc --noEmit && npx vite build`; testes `npx vitest run <file>`. Migrations via MCP `apply_migration` (pré-aprovado). Preview localhost:4173.

**Decisão de bucket:** seguir o padrão do app (buckets PÚBLICos + `getPublicUrl` — como `comunicado-anexos`, `checklist-attachments`, `avatars`). Bucket `group-chat` público; endurecer pra signed URL fica no radar. (Desvia do "privado" da spec por consistência com o codebase e simplicidade de cache/realtime.)

---

## File structure

| Arquivo | Papel |
|---|---|
| Migration (MCP) | tabela `group_chat_messages` + índices + RLS + bucket `group-chat` |
| Create `web/src/lib/groupChat.ts` + `.test.ts` | puras: agrupar mensagens por dia/remetente; unread count |
| Create `web/src/hooks/useGroupChat.ts` | query (embed sender) + send + upload anexo |
| Modify `web/src/hooks/useRealtimeSync.ts` | + `group_chat_messages` no WATCHED_TABLES |
| Create `web/src/screens/grupos/chat/MessageBubble.tsx` | bolha (markdown/HTML sanitizado, avatar real, anexo) |
| Create `web/src/screens/grupos/chat/MessageList.tsx` | lista (dividers, agrupamento) |
| Create `web/src/screens/grupos/chat/Composer.tsx` | texto + 📎 imagem/PDF + 🎤 áudio + enviar |
| Create `web/src/screens/grupos/chat/GroupChatDrawer.tsx` | drawer 380px / fullscreen / mobile |
| Create `web/src/hooks/useAudioRecorder.ts` | MediaRecorder wrapper |
| Modify `web/src/screens/grupos/GrupoWorkspace.tsx` | botão 💬 Chat + badge + montar drawer (flex) |

---

### Task 1: Migration — tabela, RLS, bucket

**Files:** Migration via MCP `apply_migration` (name: `group_chat_messages`).

- [ ] **1.1 Aplicar a migration** (MCP `apply_migration`, project `cesnbnrynvxvgdhfmaua`):

```sql
create table if not exists public.group_chat_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.work_groups(id) on delete cascade,
  sender_id uuid references public.collaborators(id) on delete set null, -- null = TOM
  role text not null default 'member' check (role in ('member','tom','system')),
  kind text not null default 'text' check (kind in ('text','image','pdf','audio','report')),
  content text,
  media_url text,
  media_mime text,
  media_filename text,
  media_extracted_text text,
  channel text not null default 'app' check (channel in ('app','whatsapp')),
  wa_message_id text,
  created_at timestamptz not null default now()
);
create index if not exists gcm_group_created_idx on public.group_chat_messages (group_id, created_at desc);
create unique index if not exists gcm_wa_msg_uq on public.group_chat_messages (wa_message_id) where wa_message_id is not null;

alter table public.group_chat_messages enable row level security;

-- Membro do grupo lê e escreve. current_collab_id() já existe no projeto.
create policy gcm_member_select on public.group_chat_messages for select
  using (group_id in (select group_id from public.work_group_members where collaborator_id = public.current_collab_id()));
create policy gcm_member_insert on public.group_chat_messages for insert
  with check (
    group_id in (select group_id from public.work_group_members where collaborator_id = public.current_collab_id())
    and sender_id = public.current_collab_id() and role = 'member'
  );
create policy gcm_service_all on public.group_chat_messages for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
```

- [ ] **1.2 Criar o bucket público `group-chat`** (MCP `execute_sql`):

```sql
insert into storage.buckets (id, name, public)
values ('group-chat', 'group-chat', true)
on conflict (id) do nothing;
```

- [ ] **1.3 Verificar** (MCP `execute_sql`): `select policyname, cmd from pg_policies where tablename='group_chat_messages';` → 3 policies. E `select id, public from storage.buckets where id='group-chat';` → public=true. Descobrir o NOME da FK de sender pro embed: `select conname from pg_constraint where conrelid='group_chat_messages'::regclass and contype='f' and pg_get_constraintdef(oid) ilike '%collaborators%';` → anotar (provável `group_chat_messages_sender_id_fkey`).

### Task 2: Funções puras de agrupamento + testes (TDD)

**Files:** Create `web/src/lib/groupChat.ts` + `web/src/lib/groupChat.test.ts`

- [ ] **2.1 Escrever os testes (falhando):**

```ts
// web/src/lib/groupChat.test.ts
import { describe, it, expect } from 'vitest';
import { groupMessages, unreadCount, type ChatMsg } from './groupChat';

const m = (p: Partial<ChatMsg>): ChatMsg => ({
  id: Math.random().toString(36).slice(2), group_id: 'g', sender_id: 'u1', role: 'member',
  kind: 'text', content: 'oi', media_url: null, media_mime: null, media_filename: null,
  sender_name: 'Ana', sender_avatar: null, created_at: '2026-06-11T12:00:00Z', ...p,
});

describe('groupMessages', () => {
  it('insere divisor de dia e agrupa remetente consecutivo', () => {
    const r = groupMessages([
      m({ id: 'a', sender_id: 'u1', created_at: '2026-06-10T12:00:00Z' }),
      m({ id: 'b', sender_id: 'u1', created_at: '2026-06-10T12:01:00Z' }),
      m({ id: 'c', sender_id: 'u2', created_at: '2026-06-11T09:00:00Z' }),
    ]);
    // [day 10/06][a showAvatar][b noAvatar][day 11/06][c showAvatar]
    const days = r.filter(x => x.type === 'day').length;
    expect(days).toBe(2);
    const msgs = r.filter(x => x.type === 'msg');
    expect(msgs.find(x => x.msg!.id === 'a')!.showAvatar).toBe(true);
    expect(msgs.find(x => x.msg!.id === 'b')!.showAvatar).toBe(false); // mesmo remetente, mesmo dia
    expect(msgs.find(x => x.msg!.id === 'c')!.showAvatar).toBe(true);  // novo dia
  });
  it('TOM (role tom) sempre mostra avatar mesmo consecutivo', () => {
    const r = groupMessages([
      m({ id: 'a', role: 'tom', sender_id: null, sender_name: 'TOM' }),
      m({ id: 'b', role: 'tom', sender_id: null, sender_name: 'TOM' }),
    ]).filter(x => x.type === 'msg');
    expect(r[0].showAvatar).toBe(true);
    expect(r[1].showAvatar).toBe(false);
  });
});

describe('unreadCount', () => {
  it('conta mensagens após o lastReadIso de OUTROS remetentes', () => {
    const msgs = [
      m({ id: 'a', sender_id: 'u2', created_at: '2026-06-11T12:00:00Z' }),
      m({ id: 'b', sender_id: 'me', created_at: '2026-06-11T12:01:00Z' }), // minha, não conta
      m({ id: 'c', sender_id: 'u2', created_at: '2026-06-11T12:02:00Z' }),
    ];
    expect(unreadCount(msgs, '2026-06-11T11:59:00Z', 'me')).toBe(2);
    expect(unreadCount(msgs, '2026-06-11T12:01:30Z', 'me')).toBe(1);
    expect(unreadCount(msgs, null, 'me')).toBe(2); // nunca leu → todas dos outros
  });
});
```

- [ ] **2.2 Rodar e ver falhar:** `cd _remote/web && npx vitest run src/lib/groupChat.test.ts` → FAIL.

- [ ] **2.3 Implementar:**

```ts
// web/src/lib/groupChat.ts
// Puras do chat de grupo (Fase 1): agrupamento visual + contagem de não-lidas.
export interface ChatMsg {
  id: string; group_id: string; sender_id: string | null;
  role: 'member' | 'tom' | 'system';
  kind: 'text' | 'image' | 'pdf' | 'audio' | 'report';
  content: string | null; media_url: string | null; media_mime: string | null; media_filename: string | null;
  sender_name: string | null; sender_avatar: string | null; created_at: string;
}
export interface DayRow { type: 'day'; key: string; label: string; }
export interface MsgRow { type: 'msg'; key: string; msg: ChatMsg; showAvatar: boolean; mine: boolean; }
export type ChatRow = DayRow | MsgRow;

const SP = 'America/Sao_Paulo';
function ymdSP(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function dayLabel(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return 'hoje';
  const d = new Date(ymd + 'T12:00:00Z'); const t = new Date(todayYmd + 'T12:00:00Z');
  if (Math.round((t.getTime() - d.getTime()) / 86400000) === 1) return 'ontem';
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/** Constrói as linhas renderizáveis: divisores de dia + flag de avatar (1º de um bloco do mesmo remetente no mesmo dia). */
export function groupMessages(messages: ChatMsg[], meId?: string): ChatRow[] {
  const todayYmd = ymdSP(new Date().toISOString());
  const rows: ChatRow[] = [];
  let lastDay = ''; let lastSender = '';
  for (const msg of messages) {
    const ymd = ymdSP(msg.created_at);
    if (ymd !== lastDay) {
      rows.push({ type: 'day', key: `day-${ymd}`, label: dayLabel(ymd, todayYmd) });
      lastDay = ymd; lastSender = '';
    }
    const senderKey = msg.role === 'tom' ? 'tom' : (msg.sender_id ?? 'system');
    const showAvatar = senderKey !== lastSender;
    lastSender = senderKey;
    rows.push({ type: 'msg', key: msg.id, msg, showAvatar, mine: !!meId && msg.sender_id === meId });
  }
  return rows;
}

/** Não-lidas = mensagens de OUTROS remetentes após lastReadIso (null = nunca leu). */
export function unreadCount(messages: ChatMsg[], lastReadIso: string | null, meId: string): number {
  return messages.filter(x => x.sender_id !== meId && (!lastReadIso || x.created_at > lastReadIso)).length;
}
```

- [ ] **2.4 Rodar e ver passar:** `npx vitest run src/lib/groupChat.test.ts` → PASS. `npx tsc --noEmit` → 0.

### Task 3: Hook `useGroupChat` + registro no realtime

**Files:** Create `web/src/hooks/useGroupChat.ts` · Modify `web/src/hooks/useRealtimeSync.ts`

- [ ] **3.1 Realtime:** em `web/src/hooks/useRealtimeSync.ts`, adicionar `'group_chat_messages',` ao array `WATCHED_TABLES` (após `'coordination_requests',`).

- [ ] **3.2 Hook** (usar o NOME de FK descoberto em 1.3 — abaixo assumido `group_chat_messages_sender_id_fkey`):

```ts
// web/src/hooks/useGroupChat.ts
// Chat de grupo (Fase 1): mensagens + envio + upload de anexo. Realtime cobre a sync.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { ChatMsg } from '../lib/groupChat';

const SELECT =
  'id, group_id, sender_id, role, kind, content, media_url, media_mime, media_filename, created_at, ' +
  'sender:collaborators!group_chat_messages_sender_id_fkey(full_name, avatar_url)';

function mapRow(r: any): ChatMsg {
  return {
    id: r.id, group_id: r.group_id, sender_id: r.sender_id, role: r.role, kind: r.kind,
    content: r.content, media_url: r.media_url, media_mime: r.media_mime, media_filename: r.media_filename,
    sender_name: r.sender?.full_name ?? (r.role === 'tom' ? 'TOM' : null),
    sender_avatar: r.sender?.avatar_url ?? null, created_at: r.created_at,
  };
}

export function useGroupChat(groupId: string | undefined) {
  const qc = useQueryClient();
  const { collaborator } = useAuth();

  const messages = useQuery({
    queryKey: ['group-chat', groupId],
    enabled: Boolean(groupId),
    queryFn: async (): Promise<ChatMsg[]> => {
      const { data, error } = await supabase
        .from('group_chat_messages').select(SELECT)
        .eq('group_id', groupId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapRow).reverse(); // antigo→novo pra render
    },
  });

  // Upload de anexo → bucket público group-chat → retorna {url, mime, filename, kind}.
  async function uploadAttachment(file: Blob, filename: string, mime: string): Promise<{ url: string; mime: string; filename: string; kind: ChatMsg['kind'] }> {
    const ext = (filename.split('.').pop() || 'bin').toLowerCase();
    const path = `${groupId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('group-chat').upload(path, file, { contentType: mime, upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('group-chat').getPublicUrl(path);
    const kind: ChatMsg['kind'] = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime === 'application/pdf' ? 'pdf' : 'text';
    return { url: data.publicUrl, mime, filename, kind };
  }

  const send = useMutation({
    mutationFn: async (input: { text?: string; attachment?: { url: string; mime: string; filename: string; kind: ChatMsg['kind'] } }) => {
      if (!collaborator) throw new Error('no_session');
      const a = input.attachment;
      const { error } = await supabase.from('group_chat_messages').insert({
        group_id: groupId, sender_id: collaborator.id, role: 'member',
        kind: a ? a.kind : 'text',
        content: input.text?.trim() || null,
        media_url: a?.url ?? null, media_mime: a?.mime ?? null, media_filename: a?.filename ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group-chat', groupId] }),
  });

  return { messages, send, uploadAttachment, meId: collaborator?.id ?? '' };
}
```

- [ ] **3.3 tsc:** `npx tsc --noEmit` → 0.

### Task 4: Deps de render + MessageBubble

**Files:** install deps · Create `web/src/screens/grupos/chat/MessageBubble.tsx`

- [ ] **4.1 Instalar deps:** `cd _remote/web && npm i dompurify marked && npm i -D @types/dompurify`

- [ ] **4.2 MessageBubble** (avatar real do TOM; markdown leve + report HTML, ambos sanitizados):

```tsx
// web/src/screens/grupos/chat/MessageBubble.tsx
// Bolha do chat de grupo (Fase 1). HTML SEMPRE via DOMPurify (mesmo do TOM).
import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ChatMsg } from '../../../lib/groupChat';

const SP = 'America/Sao_Paulo';
function hm(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
function firstName(n: string | null) { return (n ?? '').split(' ')[0] || '—'; }
const PURIFY = { ALLOWED_TAGS: ['b','strong','i','em','u','a','p','br','ul','ol','li','h3','h4','table','thead','tbody','tr','th','td','span','div','code','pre','blockquote'], ALLOWED_ATTR: ['href','target','rel','class'] };

export function MessageBubble({ msg, showAvatar, mine }: { msg: ChatMsg; showAvatar: boolean; mine: boolean }) {
  const isTom = msg.role === 'tom';
  const html = useMemo(() => {
    if (!msg.content) return '';
    const raw = msg.kind === 'report' ? msg.content : (marked.parse(msg.content, { async: false }) as string);
    return DOMPurify.sanitize(raw, PURIFY);
  }, [msg.content, msg.kind]);

  const avatar = isTom
    ? <img src="/tom-avatar.png" alt="TOM" className="w-7 h-7 rounded-full object-cover shrink-0" />
    : msg.sender_avatar
      ? <img src={msg.sender_avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
      : <span className="w-7 h-7 rounded-full bg-bg-elevated grid place-items-center text-label text-fg-muted shrink-0">{firstName(msg.sender_name)[0]}</span>;

  const bubbleCls = mine
    ? 'bg-tom text-black rounded-2xl rounded-br-sm'
    : isTom
      ? 'bg-tom-tint border border-tom rounded-2xl rounded-bl-sm'
      : 'bg-bg-surface border border-border rounded-2xl rounded-bl-sm';

  return (
    <div className={`flex gap-sm mb-xs ${mine ? 'flex-row-reverse' : ''}`}>
      <div className="w-7 shrink-0">{!mine && showAvatar && avatar}</div>
      <div className={`max-w-[78%] min-w-0 ${mine ? 'items-end' : ''}`}>
        {!mine && showAvatar && <div className="text-label text-tom-deep mb-0.5">{isTom ? 'TOM' : firstName(msg.sender_name)}</div>}
        <div className={`px-md py-sm ${bubbleCls}`}>
          {msg.kind === 'image' && msg.media_url && (
            <a href={msg.media_url} target="_blank" rel="noreferrer"><img src={msg.media_url} alt={msg.media_filename ?? ''} className="rounded-md max-h-60 mb-xs" /></a>
          )}
          {msg.kind === 'audio' && msg.media_url && (
            <audio controls src={msg.media_url} className="max-w-full mb-xs" />
          )}
          {msg.kind === 'pdf' && msg.media_url && (
            <a href={msg.media_url} target="_blank" rel="noreferrer" className="flex items-center gap-xs text-body-sm underline mb-xs">📄 {msg.media_filename ?? 'documento.pdf'}</a>
          )}
          {html && (
            msg.kind === 'report'
              ? <div className="rounded-md border border-tom overflow-hidden text-body-sm [&_h4]:bg-tom [&_h4]:text-black [&_h4]:px-sm [&_h4]:py-xs [&_h4]:font-bold [&>div]:p-sm [&_li]:my-0.5" dangerouslySetInnerHTML={{ __html: html }} />
              : <div className="text-body-sm leading-relaxed break-words [&_a]:underline [&_ul]:list-disc [&_ul]:pl-4" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          <div className={`text-[10px] mt-0.5 ${mine ? 'text-black/60' : 'text-fg-muted'}`}>{hm(msg.created_at)}</div>
        </div>
        {msg.kind === 'report' && (
          <div className="flex gap-xs mt-xs">
            <a href={`data:text/html;charset=utf-8,${encodeURIComponent(msg.content ?? '')}`} download="resumo.html" className="text-label text-fg-muted hover:text-fg">⬇ Baixar</a>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Nota:** confirmar que `bg-tom-tint` e `text-tom-deep` existem no tailwind.config.js (tom.tint `#E8F0CF`, tom.deep `#728538` — confirmados na config). Se algum util arbitrário (`text-[10px]`) for barrado pelo DS, trocar por `text-label`. `marked.parse` síncrono: usar `{ async: false }`.

### Task 5: useAudioRecorder + Composer + MessageList

**Files:** Create `web/src/hooks/useAudioRecorder.ts` · Create `.../chat/MessageList.tsx` · Create `.../chat/Composer.tsx`

- [ ] **5.1 useAudioRecorder:**

```ts
// web/src/hooks/useAudioRecorder.ts
import { useRef, useState } from 'react';
export function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.start(); recRef.current = rec; setRecording(true); setSeconds(0);
    timer.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
  }
  function stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec) return resolve(null);
      rec.onstop = () => {
        rec.stream.getTracks().forEach(t => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        resolve(chunks.current.length ? new Blob(chunks.current, { type: 'audio/webm' }) : null);
      };
      rec.stop();
    });
  }
  function cancel() {
    const rec = recRef.current;
    if (rec) { rec.onstop = () => rec.stream.getTracks().forEach(t => t.stop()); rec.stop(); }
    if (timer.current) clearInterval(timer.current);
    chunks.current = []; setRecording(false);
  }
  return { recording, seconds, start, stop, cancel };
}
```

- [ ] **5.2 MessageList** (consome `groupMessages`):

```tsx
// web/src/screens/grupos/chat/MessageList.tsx
import { useEffect, useRef } from 'react';
import { groupMessages, type ChatMsg } from '../../../lib/groupChat';
import { MessageBubble } from './MessageBubble';

export function MessageList({ messages, meId }: { messages: ChatMsg[]; meId: string }) {
  const rows = groupMessages(messages, meId);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  return (
    <div className="flex-1 overflow-y-auto px-md py-sm bg-bg-app">
      {rows.map(r => r.type === 'day'
        ? <div key={r.key} className="text-center my-sm"><span className="text-label text-fg-muted bg-bg-elevated rounded-full px-sm py-0.5">{r.label}</span></div>
        : <MessageBubble key={r.key} msg={r.msg} showAvatar={r.showAvatar} mine={r.mine} />
      )}
      <div ref={endRef} />
    </div>
  );
}
```

- [ ] **5.3 Composer:**

```tsx
// web/src/screens/grupos/chat/Composer.tsx
import { useRef, useState } from 'react';
import { Paperclip, Mic, Send, X } from 'lucide-react';
import { useAudioRecorder } from '../../../hooks/useAudioRecorder';
import { showToast } from '../../../components/Toast';
import type { ChatMsg } from '../../../lib/groupChat';

interface Props {
  onSend: (input: { text?: string; attachment?: { url: string; mime: string; filename: string; kind: ChatMsg['kind'] } }) => Promise<void>;
  upload: (file: Blob, filename: string, mime: string) => Promise<{ url: string; mime: string; filename: string; kind: ChatMsg['kind'] }>;
}

export function Composer({ onSend, upload }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rec = useAudioRecorder();

  async function sendText() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onSend({ text }); setText(''); }
    catch { showToast({ kind: 'error', title: 'Não consegui enviar' }); }
    finally { setBusy(false); }
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { showToast({ kind: 'error', title: 'Arquivo grande demais (máx 15MB)' }); return; }
    setBusy(true);
    try { const a = await upload(file, file.name, file.type); await onSend({ attachment: a }); }
    catch { showToast({ kind: 'error', title: 'Falha no anexo' }); }
    finally { setBusy(false); }
  }
  async function stopAudio() {
    const blob = await rec.stop();
    if (!blob) return;
    setBusy(true);
    try { const a = await upload(blob, `audio-${Date.now()}.webm`, 'audio/webm'); await onSend({ attachment: a }); }
    catch { showToast({ kind: 'error', title: 'Falha no áudio' }); }
    finally { setBusy(false); }
  }

  if (rec.recording) {
    return (
      <div className="flex items-center gap-sm border-t border-border p-sm bg-bg-surface">
        <button type="button" onClick={rec.cancel} className="w-8 h-8 grid place-items-center rounded-full text-danger" aria-label="Cancelar"><X size={18} /></button>
        <div className="flex-1 text-body-sm text-danger animate-pulse">● Gravando… {String(Math.floor(rec.seconds / 60)).padStart(2, '0')}:{String(rec.seconds % 60).padStart(2, '0')}</div>
        <button type="button" onClick={stopAudio} className="w-8 h-8 grid place-items-center rounded-full bg-tom text-black" aria-label="Enviar áudio"><Send size={16} /></button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-xs border-t border-border p-sm bg-bg-surface">
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="w-8 h-8 grid place-items-center rounded-full bg-bg-elevated text-fg-muted disabled:opacity-50" aria-label="Anexar"><Paperclip size={18} /></button>
      <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(); } }}
        placeholder="Mensagem pro grupo…" className="flex-1 bg-bg-app border border-border rounded-full px-md py-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
      {text.trim()
        ? <button type="button" onClick={sendText} disabled={busy} className="w-8 h-8 grid place-items-center rounded-full bg-tom text-black disabled:opacity-50" aria-label="Enviar"><Send size={16} /></button>
        : <button type="button" onClick={rec.start} disabled={busy} className="w-8 h-8 grid place-items-center rounded-full bg-bg-elevated text-fg-muted disabled:opacity-50" aria-label="Gravar áudio"><Mic size={18} /></button>}
    </div>
  );
}
```

- [ ] **5.4 tsc:** `npx tsc --noEmit` → 0.

### Task 6: GroupChatDrawer + integração no GrupoWorkspace

**Files:** Create `.../chat/GroupChatDrawer.tsx` · Modify `web/src/screens/grupos/GrupoWorkspace.tsx`

- [ ] **6.1 GroupChatDrawer:**

```tsx
// web/src/screens/grupos/chat/GroupChatDrawer.tsx
import { useEffect } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useGroupChat } from '../../../hooks/useGroupChat';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

interface Props {
  groupId: string; groupName: string; membersLine: string;
  fullscreen: boolean; onToggleFullscreen: () => void; onClose: () => void;
  onSeen: () => void;
}

export function GroupChatDrawer({ groupId, groupName, membersLine, fullscreen, onToggleFullscreen, onClose, onSeen }: Props) {
  const chat = useGroupChat(groupId);
  const msgs = chat.messages.data ?? [];
  useEffect(() => { onSeen(); }, [msgs.length, onSeen]);

  return (
    <aside className={[
      'flex flex-col bg-bg-surface border-l border-border min-h-0',
      fullscreen ? 'fixed inset-0 z-50' : 'w-full md:w-[380px] shrink-0 max-md:fixed max-md:inset-0 max-md:z-50',
    ].join(' ')}>
      <header className="flex items-center gap-sm px-md py-sm border-b border-border shrink-0">
        <img src="/tom-avatar.png" alt="" className="w-7 h-7 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <div className="text-body-md font-semibold truncate">{groupName} · chat</div>
          <div className="text-body-sm text-fg-muted truncate">{membersLine} e TOM</div>
        </div>
        <button type="button" onClick={onToggleFullscreen} className="w-8 h-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated max-md:hidden" aria-label="Tela cheia">{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button type="button" onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated" aria-label="Fechar"><X size={18} /></button>
      </header>
      <MessageList messages={msgs} meId={chat.meId} />
      <Composer onSend={chat.send.mutateAsync} upload={chat.uploadAttachment} />
    </aside>
  );
}
```

- [ ] **6.2 Integrar no GrupoWorkspace.tsx:** ler o arquivo; (a) import do drawer + `MessageSquare` do lucide; (b) estados `const [chatOpen, setChatOpen] = useState(false); const [chatFull, setChatFull] = useState(false);` + unread via localStorage:

```tsx
import { GroupChatDrawer } from './chat/GroupChatDrawer';
import { useGroupChat } from '../../hooks/useGroupChat';
import { unreadCount } from '../../lib/groupChat';
import { MessageSquare } from 'lucide-react';
// ...dentro do componente, após os hooks existentes:
const chatPeek = useGroupChat(groupId);                 // pra badge de não-lidas
const lastReadKey = `chat-read-${groupId}`;
const [lastRead, setLastRead] = useState<string | null>(() => localStorage.getItem(lastReadKey));
const unread = unreadCount(chatPeek.messages.data ?? [], lastRead, chatPeek.meId);
const markSeen = useCallback(() => {
  const iso = new Date().toISOString();
  localStorage.setItem(lastReadKey, iso); setLastRead(iso);
}, [lastReadKey]);
```

(c) envolver o `return` num flex-row: a coluna de conteúdo atual vira `<div className="flex-1 min-w-0">{...conteúdo existente...}</div>` e ao lado, quando `chatOpen`, monta `<GroupChatDrawer ... />`. O wrapper externo: `<div className="flex gap-lg w-full max-w-screen-2xl">`. (O container já era `max-w-screen-2xl` — agora vira flex pra caber o drawer.)

(d) botão no header (junto dos outros, desktop) e no cluster mobile:

```tsx
<Button variant="secondary" size="md" leadingIcon={<MessageSquare size={16} />} onClick={() => setChatOpen(v => !v)}>
  Chat{unread > 0 ? ` · ${unread}` : ''}
</Button>
```

(e) render condicional do drawer:

```tsx
{chatOpen && groupId && (
  <GroupChatDrawer
    groupId={groupId} groupName={group.name} membersLine={membersLine}
    fullscreen={chatFull} onToggleFullscreen={() => setChatFull(v => !v)}
    onClose={() => { setChatFull(false); setChatOpen(false); }}
    onSeen={markSeen}
  />
)}
```

**Nota de layout:** quando `chatOpen` e NÃO fullscreen no desktop, o conteúdo (`flex-1`) encolhe e o `aside` 380px senta à direita — empurrando, exatamente como o mockup. No mobile o `aside` é `fixed inset-0 z-50` (tela cheia). Confirmar import de `useState`/`useCallback` no topo do arquivo.

- [ ] **6.3 tsc + build:** `npx tsc --noEmit && npx vite build` → 0 erros / sucesso.

### Task 7: Validação

- [ ] **7.1** `npx vitest run src/lib/groupChat.test.ts` → PASS; `npx tsc --noEmit` → 0; `npx vite build` → OK.
- [ ] **7.2 Seed e2e** (MCP execute_sql): inserir 3 mensagens no grupo Financeiro (`d95f63af-...`) — uma da Rose (`8bfb18b6-...`), uma da Ana (`f238cfb7-...`), e uma `role='tom'` `kind='report'` com um HTML simples — pra ver render real:
```sql
insert into group_chat_messages (group_id, sender_id, role, kind, content) values
('d95f63af-5032-4120-89f2-ca4c49684cbc','8bfb18b6-3c2e-4579-b4a9-06409d7e84c4','member','text','Ana, viu os cheques que chegaram?'),
('d95f63af-5032-4120-89f2-ca4c49684cbc','f238cfb7-54ab-43a7-93ab-3f29c636fb8c','member','text','Vi! Tão na pasta, falta o sistema'),
('d95f63af-5032-4120-89f2-ca4c49684cbc',null,'tom','report','<h4>📋 Resumo</h4><div><b>Tarefa:</b><ul><li>Conferir cheques — sexta 12/06</li></ul></div>');
```
- [ ] **7.3 Preview** (browser-agent/preview_eval), logado como Alf (membro? Alf NÃO é membro do Financeiro — então o RLS de SELECT esconde as msgs dele). Pra validar visual: adicionar Alf como membro temporário OU validar como leitura via service-role-rendered DOM. Decisão: adicionar Alf ao grupo Financeiro (membro) pra testar, validar, e remover depois (ou deixar — decisão do Alf). Conferir: botão Chat abre o drawer empurrando o conteúdo (1440px); bolhas com avatar real; report renderizado; mobile (375px) abre tela cheia; enviar texto/imagem/áudio insere e aparece via realtime. Screenshot/eval contra o mockup.
- [ ] **7.4 Limpeza:** remover as msgs de seed se o Alf quiser (perguntar no fim). Atualizar STATUS na spec (Fase 1 entregue).

## Self-review

1. **Cobertura da spec (Fase 1):** tabela+RLS+bucket (T1), realtime (T3.1), hook query/send/upload (T3.2), puras+testes (T2), render sanitizado+avatar real (T4), composer com 3 anexos+áudio (T5), drawer/fullscreen/mobile + botão+badge (T6), validação+e2e (T7). ✓ TOM-responde-sozinho fora (Fase 2) — correto.
2. **Placeholders:** o NOME da FK em 1.3 é descoberta obrigatória (assumido `group_chat_messages_sender_id_fkey`; confirmar e ajustar o SELECT do hook). Não é placeholder vago — é verificação.
3. **Consistência de tipos:** `ChatMsg` (lib) é a fronteira usada por hook/bubble/list; `kind`/`role` unions batem em todos; `uploadAttachment` retorna o shape que `send`/Composer consomem. APIs DS a confirmar na execução: `bg-tom-tint`/`text-tom-deep` (na config ✓), `Button.leadingIcon` (✓), `showToast` shape (✓ {kind,title}). `marked.parse` síncrono com `{async:false}`.
