import { describe, it, expect } from 'vitest';
import { filterNotes, typesWithCount, allTags, noteExcerpt, templateFor, cardSubtitle, TEMPLATES, type GroupNote } from './groupNotes';

const N = (o: Partial<GroupNote>): GroupNote => ({ id: 'x', group_id: 'g', type: 'livre', category: 'Geral', tags: [], title: '', body: '', fields: [], pinned: false, created_by: null, updated_by: null, created_at: '', updated_at: '', ...o });

describe('groupNotes puras (v2 fichas tipadas)', () => {
  const notes = [
    N({ id: '1', title: 'Acesso Zoho', type: 'acesso', tags: ['Zoho'], fields: [{ label: 'Login', value: 'a@b' }, { label: 'Senha', value: 'segredo99', secret: true }] }),
    N({ id: '2', title: 'CNPJs', type: 'cnpj', tags: ['fiscal'], fields: [{ label: 'CNPJ', value: '12.345' }] }),
    N({ id: '3', title: 'Light Recreio', type: 'acesso', tags: ['Recreio', 'Light'], fields: [{ label: 'Login', value: 'rose@light' }] }),
  ];
  it('filterNotes por type', () => {
    expect(filterNotes(notes, { type: 'acesso' }).map((n) => n.id)).toEqual(['1', '3']);
  });
  it('filterNotes por tag', () => {
    expect(filterNotes(notes, { tag: 'Recreio' }).map((n) => n.id)).toEqual(['3']);
  });
  it('filterNotes por busca casa em label + valor não-secreto, nunca no segredo', () => {
    expect(filterNotes(notes, { query: 'a@b' }).map((n) => n.id)).toEqual(['1']);
    expect(filterNotes(notes, { query: '12.345' }).map((n) => n.id)).toEqual(['2']);
    expect(filterNotes(notes, { query: 'x' }).map((n) => n.id)).toEqual([]); // valor secreto não entra na busca
  });
  it('typesWithCount só os usados, na ordem dos tipos', () => {
    expect(typesWithCount(notes)).toEqual([{ type: 'acesso', count: 2 }, { type: 'cnpj', count: 1 }]);
  });
  it('allTags únicas ordenadas', () => {
    expect(allTags(notes)).toEqual(['Light', 'Recreio', 'Zoho', 'fiscal']);
  });
  it('cardSubtitle pega 1º campo não-secreto com valor', () => {
    expect(cardSubtitle(notes[0])).toBe('a@b');
  });
  it('templateFor devolve cópia (não muta o TEMPLATE)', () => {
    const t = templateFor('acesso');
    t[0].value = 'mutei';
    expect(TEMPLATES.acesso[0].value).toBe('');
    expect(t.find((f) => f.label === 'Senha')?.secret).toBe(true);
  });
  it('noteExcerpt corta', () => {
    expect(noteExcerpt('# Título\nlinha de corpo aqui').length).toBeLessThanOrEqual(120);
  });
});
