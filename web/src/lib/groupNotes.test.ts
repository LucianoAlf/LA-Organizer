import { describe, it, expect } from 'vitest';
import { filterNotes, typesWithCount, allTags, noteExcerpt, templateFor, cardSubtitle, TEMPLATES, resolveColor, resolveIcon, renumber, TYPE_DEFAULTS, bodyToHtml, buildTypeIndex, typeLabel, templateForType, slugifyType, type GroupNote, type GroupNoteType } from './groupNotes';

const N = (o: Partial<GroupNote>): GroupNote => ({ id: 'x', group_id: 'g', type: 'livre', category: 'Geral', tags: [], title: '', body: '', fields: [], pinned: false, sort_order: 0, color: null, icon: null, created_by: null, updated_by: null, created_at: '', updated_at: '', ...o });

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

describe('aparência + reorder (Fatia A)', () => {
  it('resolveColor usa override, senão default do tipo', () => {
    expect(resolveColor(N({ type: 'acesso', color: null }))).toBe(TYPE_DEFAULTS.acesso.color);
    expect(resolveColor(N({ type: 'acesso', color: '#123456' }))).toBe('#123456');
  });
  it('resolveIcon usa override, senão default do tipo', () => {
    expect(resolveIcon(N({ type: 'conta', icon: null }))).toBe(TYPE_DEFAULTS.conta.icon);
    expect(resolveIcon(N({ type: 'conta', icon: 'Star' }))).toBe('Star');
  });
  it('renumber devolve {id,sort_order} 1..N na ordem da lista', () => {
    expect(renumber([N({ id: 'a' }), N({ id: 'b' }), N({ id: 'c' })])).toEqual([
      { id: 'a', sort_order: 1 }, { id: 'b', sort_order: 2 }, { id: 'c', sort_order: 3 },
    ]);
  });
});

const T = (o: Partial<GroupNoteType>): GroupNoteType => ({ id: 't', group_id: 'g', key: 'fornecedor', label: 'Fornecedor', color: '#1D9E75', icon: 'BuildingStore', fields: [{ label: 'CNPJ', value: '', kind: 'text' }], ...o });

describe('tipos customizados (Fatia C)', () => {
  const idx = buildTypeIndex([T({})]);
  it('buildTypeIndex tem as 5 base + a custom', () => {
    expect(idx.acesso.label).toBe('Acesso');
    expect(idx.fornecedor.label).toBe('Fornecedor');
    expect(idx.fornecedor.color).toBe('#1D9E75');
  });
  it('resolveColor/Icon usam o índice pra tipo custom', () => {
    expect(resolveColor({ type: 'fornecedor', color: null }, idx)).toBe('#1D9E75');
    expect(resolveIcon({ type: 'fornecedor', icon: null }, idx)).toBe('BuildingStore');
  });
  it('override da ficha vence o tipo', () => {
    expect(resolveColor({ type: 'fornecedor', color: '#E24B4A' }, idx)).toBe('#E24B4A');
  });
  it('tipo custom sem cor cai no fallback cinza/FileText', () => {
    const i2 = buildTypeIndex([T({ key: 'x', color: null, icon: null })]);
    expect(resolveColor({ type: 'x', color: null }, i2)).toBe('#5F5E5A');
    expect(resolveIcon({ type: 'x', icon: null }, i2)).toBe('FileText');
  });
  it('typeLabel e templateForType (custom e base)', () => {
    expect(typeLabel('fornecedor', idx)).toBe('Fornecedor');
    expect(typeLabel('acesso', idx)).toBe('Acesso');
    expect(templateForType('fornecedor', idx).map((f) => f.label)).toEqual(['CNPJ']);
    expect(templateForType('acesso', idx).length).toBeGreaterThan(0);
  });
  it('slugifyType normaliza acento/espaço', () => {
    expect(slugifyType('Conta a Pagar')).toBe('conta_a_pagar');
    expect(slugifyType('Cartão')).toBe('cartao');
  });
});

describe('bodyToHtml (compat HTML/markdown)', () => {
  it('HTML já formatado passa direto', () => {
    expect(bodyToHtml('<p>oi <strong>Rose</strong></p>')).toBe('<p>oi <strong>Rose</strong></p>');
  });
  it('markdown legado vira HTML', () => {
    expect(bodyToHtml('**oi**')).toContain('<strong>oi</strong>');
  });
  it('texto puro com quebra vira HTML com <br> (breaks)', () => {
    expect(bodyToHtml('linha 1\nlinha 2')).toContain('<br');
  });
  it('vazio ou só espaço → string vazia', () => {
    expect(bodyToHtml('')).toBe('');
    expect(bodyToHtml('   ')).toBe('');
  });
});
