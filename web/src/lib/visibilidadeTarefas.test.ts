import { describe, it, expect } from 'vitest';
import { clausulasVisibilidade, podeVerTarefa } from './visibilidadeTarefas';

const EU = 'alf-id';
const GRUPO_BARRA = 'barra-id';

describe('clausulasVisibilidade', () => {
  it('a rede do autor exige que NÃO haja grupo dono', () => {
    // Sem o `and(...)`, "Arthur — anotar no campo Instagram" (pool da Barra, criada pelo Alf)
    // seguia aparecendo pra ele depois de sair do grupo.
    const c = clausulasVisibilidade(EU);
    expect(c).toContain(`and(created_by.eq.${EU},assigned_group_id.is.null)`);
    expect(c).not.toContain(`created_by.eq.${EU}`);
  });

  it('minhas tarefas e os grupos em que sou membro entram', () => {
    const c = clausulasVisibilidade(EU, [GRUPO_BARRA]);
    expect(c).toContain(`assigned_to.eq.${EU}`);
    expect(c).toContain(`assigned_group_id.in.(${GRUPO_BARRA})`);
    expect(c).toHaveLength(3);
  });

  it('sem grupo nenhum, não emite cláusula de grupo vazia', () => {
    // `assigned_group_id.in.()` é sintaxe inválida e derruba a query inteira.
    expect(clausulasVisibilidade(EU)).toHaveLength(2);
    expect(clausulasVisibilidade(EU, [])).toHaveLength(2);
    expect(clausulasVisibilidade(EU, ['', null as unknown as string])).toHaveLength(2);
  });
});

describe('podeVerTarefa', () => {
  const poolDaBarra = { assigned_to: null, created_by: EU, assigned_group_id: GRUPO_BARRA };

  it('o caso do Arthur: criei, é do pool, saí do grupo → não vejo mais', () => {
    expect(podeVerTarefa(poolDaBarra, EU, [])).toBe(false);
  });

  it('mesma tarefa, ainda sou membro → continuo vendo', () => {
    expect(podeVerTarefa(poolDaBarra, EU, [GRUPO_BARRA])).toBe(true);
  });

  it('tarefa órfã que eu criei continua aparecendo — senão desaparece do mundo', () => {
    expect(podeVerTarefa({ assigned_to: null, created_by: EU, assigned_group_id: null }, EU, [])).toBe(true);
  });

  it('tarefa atribuída a mim aparece mesmo que o grupo não seja meu', () => {
    expect(podeVerTarefa({ assigned_to: EU, created_by: 'outro', assigned_group_id: 'g-alheio' }, EU, [])).toBe(true);
  });

  it('tarefa de outra pessoa, sem grupo meu, não aparece', () => {
    expect(podeVerTarefa({ assigned_to: 'fabi', created_by: 'fabi', assigned_group_id: null }, EU, [])).toBe(false);
  });

  it('pool de grupo que é meu aparece mesmo sem eu ter criado', () => {
    expect(podeVerTarefa({ assigned_to: null, created_by: 'krissya', assigned_group_id: GRUPO_BARRA }, EU, [GRUPO_BARRA])).toBe(true);
  });

  it('entrada torta nunca quebra', () => {
    expect(podeVerTarefa(null, EU)).toBe(false);
    expect(podeVerTarefa(undefined, EU)).toBe(false);
    expect(podeVerTarefa({}, EU)).toBe(false);
    expect(podeVerTarefa({ created_by: EU }, '')).toBe(false);
  });
});
