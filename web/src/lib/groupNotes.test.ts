import { describe, it, expect } from 'vitest';
import { filterNotes, categoriesWithCount, allTags, noteExcerpt, type GroupNote } from './groupNotes';

const N = (o: Partial<GroupNote>): GroupNote => ({ id: 'x', group_id: 'g', category: 'Geral', tags: [], title: '', body: '', pinned: false, created_by: null, updated_by: null, created_at: '', updated_at: '', ...o });

describe('groupNotes puras', () => {
  const notes = [
    N({ id: '1', title: 'Acesso Zoho', category: 'Acessos', tags: ['Zoho'], body: 'login x' }),
    N({ id: '2', title: 'CNPJs', category: 'Fiscal', tags: ['fiscal'], body: 'numeros' }),
    N({ id: '3', title: 'Light Recreio', category: 'Acessos', tags: ['Recreio', 'Light'], body: 'senha y' }),
  ];
  it('filterNotes por categoria', () => {
    expect(filterNotes(notes, { category: 'Acessos' }).map((n) => n.id)).toEqual(['1', '3']);
  });
  it('filterNotes por tag', () => {
    expect(filterNotes(notes, { tag: 'Recreio' }).map((n) => n.id)).toEqual(['3']);
  });
  it('filterNotes por busca (título + body, case-insensitive)', () => {
    expect(filterNotes(notes, { query: 'zoho' }).map((n) => n.id)).toEqual(['1']);
    expect(filterNotes(notes, { query: 'senha' }).map((n) => n.id)).toEqual(['3']);
  });
  it('categoriesWithCount', () => {
    expect(categoriesWithCount(notes)).toEqual([{ category: 'Acessos', count: 2 }, { category: 'Fiscal', count: 1 }]);
  });
  it('allTags únicas ordenadas', () => {
    expect(allTags(notes)).toEqual(['Light', 'Recreio', 'Zoho', 'fiscal']);
  });
  it('noteExcerpt corta markdown', () => {
    expect(noteExcerpt('# Título\nlinha de corpo aqui').length).toBeLessThanOrEqual(120);
  });
});
