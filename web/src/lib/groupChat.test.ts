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
    const days = r.filter(x => x.type === 'day').length;
    expect(days).toBe(2);
    const msgs = r.filter(x => x.type === 'msg');
    expect(msgs.find(x => x.msg!.id === 'a')!.showAvatar).toBe(true);
    expect(msgs.find(x => x.msg!.id === 'b')!.showAvatar).toBe(false);
    expect(msgs.find(x => x.msg!.id === 'c')!.showAvatar).toBe(true);
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
      m({ id: 'b', sender_id: 'me', created_at: '2026-06-11T12:01:00Z' }),
      m({ id: 'c', sender_id: 'u2', created_at: '2026-06-11T12:02:00Z' }),
    ];
    expect(unreadCount(msgs, '2026-06-11T11:59:00Z', 'me')).toBe(2);
    expect(unreadCount(msgs, '2026-06-11T12:01:30Z', 'me')).toBe(1);
    expect(unreadCount(msgs, null, 'me')).toBe(2);
  });
});
