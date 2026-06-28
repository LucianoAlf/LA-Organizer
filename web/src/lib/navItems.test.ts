import { test, expect } from 'vitest';
import { NAV_CATALOG, availableNavItems, resolveSlugs, DEFAULT_NAV_SLUGS, type NavGateContext } from './navItems';

const fullCtx: NavGateContext = {
  role: 'director',
  collaborator: { id: 'x', role: 'director', has_coord_permissions: true } as never,
  access: { inventario: true, loja_produtos: true },
  isMentor: true,
};
const minCtx: NavGateContext = {
  role: 'collaborator',
  collaborator: { id: 'x', role: 'collaborator', has_coord_permissions: false } as never,
  access: { inventario: false, loja_produtos: false },
  isMentor: false,
};

// ============ INVARIANTES ESTRUTURAIS ============

test('catálogo inclui exatamente os 4 slugs default (sem when)', () => {
  for (const slug of DEFAULT_NAV_SLUGS) {
    const item = NAV_CATALOG.find((i) => i.slug === slug);
    expect(item).toBeDefined();
    expect(item!.when).toBeUndefined(); // defaults NUNCA têm gating
  }
});

test('/hoje preserva label "Agenda" + matchPaths corretos', () => {
  const hoje = NAV_CATALOG.find((i) => i.slug === '/hoje')!;
  expect(hoje.label).toBe('Agenda');
  expect(hoje.matchPaths).toEqual(['/hoje', '/semana', '/mes']);
});

test('director vê TODO o catálogo (limite máximo do gating)', () => {
  const avail = availableNavItems(fullCtx);
  expect(avail).toHaveLength(NAV_CATALOG.length);
});

test('collaborator pelado vê ESTRITAMENTE menos itens que director (gating reduz)', () => {
  // Não codifica QUAIS itens — só prova que o when() filtra alguma coisa.
  // (Quirks como /la-journey aceitar não-manager são gating real do SidebarV2;
  //  não vão entrar nesse teste pra não amarrar nuance.)
  expect(availableNavItems(minCtx).length).toBeLessThan(availableNavItems(fullCtx).length);
});

test('todos os defaults ficam disponíveis pra collaborator pelado (NUNCA filtrados)', () => {
  const availSlugs = new Set(availableNavItems(minCtx).map((i) => i.slug));
  for (const s of DEFAULT_NAV_SLUGS) {
    expect(availSlugs.has(s)).toBe(true);
  }
});

// ============ resolveSlugs — sempre 4 válidos ============

test('resolveSlugs sempre devolve EXATAMENTE 4 itens', () => {
  expect(resolveSlugs([], fullCtx)).toHaveLength(4);
  expect(resolveSlugs(['/hoje'], fullCtx)).toHaveLength(4);
  expect(resolveSlugs(['/hoje','/projetos','/checklists','/habitos','/financeiro'], fullCtx)).toHaveLength(4);
});

test('resolveSlugs([], minCtx) também devolve 4 (defaults bastam)', () => {
  expect(resolveSlugs([], minCtx)).toHaveLength(4);
});

test('resolveSlugs drop slug inválido e recompleta com default', () => {
  const out = resolveSlugs(['/lixo', '/projetos'], fullCtx).map((i) => i.slug);
  expect(out).not.toContain('/lixo');
  expect(out).toContain('/projetos');
  expect(out).toHaveLength(4);
});

test('resolveSlugs drop slug sem permissão (genérico, sem assumir qual)', () => {
  const gatedSlug = NAV_CATALOG.find((i) => i.when)!.slug;
  const out = resolveSlugs([gatedSlug, '/projetos'], minCtx).map((i) => i.slug);
  expect(out).not.toContain(gatedSlug);
  expect(out).toContain('/projetos');
  expect(out).toHaveLength(4);
});

test('resolveSlugs dedup', () => {
  const out = resolveSlugs(['/hoje','/hoje','/projetos'], fullCtx).map((i) => i.slug);
  expect(out.filter((s) => s === '/hoje')).toHaveLength(1);
  expect(out).toHaveLength(4);
});

test('resolveSlugs preserva ordem do array de entrada', () => {
  const out = resolveSlugs(['/projetos','/habitos','/hoje','/checklists'], fullCtx).map((i) => i.slug);
  expect(out).toEqual(['/projetos','/habitos','/hoje','/checklists']);
});
