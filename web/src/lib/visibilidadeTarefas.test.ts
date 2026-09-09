import { describe, it, expect } from 'vitest';
import { clausulasVisibilidade, podeVerTarefa } from './visibilidadeTarefas';

const EU = 'alf-id';
const GRUPO_BARRA = 'barra-id';

describe('clausulasVisibilidade', () => {
  it('a rede do autor exige que NÃO haja grupo dono', () => {
    // Sem o `and(...)`, "Arthur — anotar no campo Instagram" (pool da Barra, criada pelo Alf)
    // seguia aparecendo pra ele depois de sair do grupo.
    // Confere o CONTEUDO da clausula, nao a string inteira: ela ganha ressalvas novas a cada
    // incidente (a de `source` entrou em 09/09) e travar o texto exato faria o teste reprovar
    // conserto legitimo.
    const rede = clausulasVisibilidade(EU).find((c) => c.includes(`created_by.eq.${EU}`))!;
    expect(rede).toContain(`and(created_by.eq.${EU}`);
    expect(rede).toContain('assigned_group_id.is.null');
    expect(clausulasVisibilidade(EU)).not.toContain(`created_by.eq.${EU}`);
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

// AUTORIA-TECNICA-NAO-E-DELEGACAO (Alf, 09/09/2026).
// 18 tarefas "Renovação em risco" nasceram de automação (`source: system`) com o id dele como
// autor, e o app as mostrava como delegadas dele pra Fabi e pra Jéssica. Ele nunca delegou
// nenhuma. `created_by` ali é a credencial que a máquina usou, não quem decidiu.
describe('automação não vira delegação minha', () => {
  const AUTOMACAO_PRA_FABI = { assigned_to: 'fabi', created_by: EU, assigned_group_id: null, source: 'system' };
  const EU_DELEGUEI = { assigned_to: 'krissya', created_by: EU, assigned_group_id: null, source: 'manual' };

  it('tarefa de automação com dono OUTRO não é minha', () => {
    expect(podeVerTarefa(AUTOMACAO_PRA_FABI, EU, [])).toBe(false);
  });

  it('o que eu deleguei de verdade continua meu — o caso da Krissya', () => {
    expect(podeVerTarefa(EU_DELEGUEI, EU, [])).toBe(true);
  });

  it('automação SEM dono continua aparecendo — senão a tarefa some do mundo', () => {
    expect(podeVerTarefa({ assigned_to: null, created_by: EU, assigned_group_id: null, source: 'system' }, EU, [])).toBe(true);
  });

  it('automação atribuída A MIM aparece, obviamente', () => {
    expect(podeVerTarefa({ assigned_to: EU, created_by: EU, assigned_group_id: null, source: 'system' }, EU, [])).toBe(true);
  });

  it('tarefa antiga sem `source` não desaparece', () => {
    // `neq` não casa NULL em SQL; sem a cláusula `source.is.null` o acervo antigo sumia.
    expect(podeVerTarefa({ assigned_to: 'fabi', created_by: EU, assigned_group_id: null, source: null }, EU, [])).toBe(true);
    expect(clausulasVisibilidade(EU)[1]).toContain('source.is.null');
  });

  it('a cláusula SQL carrega as duas ressalvas', () => {
    const rede = clausulasVisibilidade(EU)[1];
    expect(rede).toContain('assigned_group_id.is.null');
    expect(rede).toContain('source.neq.system');
  });
});
