import { describe, it, expect } from 'vitest';
import { pertenceAoContexto, doContexto } from './agendaContexto';

// Os números são os do Alf em 09/09/2026, medidos no banco: 20 tarefas no mês, 17 delas com
// dono diferente dele; 11 atrasadas, 10 de outra pessoa.
const MINHA_TRABALHO = { context: 'work', delegated_to: null };
const MINHA_PESSOAL = { context: 'personal', delegated_to: null };
const DELEGADA = { context: 'work', delegated_to: 'fabi-id' };

describe('pertenceAoContexto', () => {
  it('delegada NÃO entra na aba Trabalho — é o bug que enchia a agenda do Alf', () => {
    // Tarefa delegada continua sendo context:'work'. Filtrar só por contexto a trazia junto.
    expect(pertenceAoContexto(DELEGADA, 'work')).toBe(false);
  });

  it('delegada entra na aba Delegadas, que é a casa dela', () => {
    expect(pertenceAoContexto(DELEGADA, 'delegated')).toBe(true);
  });

  it('o que é meu continua aparecendo', () => {
    expect(pertenceAoContexto(MINHA_TRABALHO, 'work')).toBe(true);
    expect(pertenceAoContexto(MINHA_PESSOAL, 'personal')).toBe(true);
  });

  it('minha tarefa NÃO aparece em Delegadas', () => {
    expect(pertenceAoContexto(MINHA_TRABALHO, 'delegated')).toBe(false);
    expect(pertenceAoContexto(MINHA_PESSOAL, 'delegated')).toBe(false);
  });

  it('contexto errado não casa', () => {
    expect(pertenceAoContexto(MINHA_TRABALHO, 'personal')).toBe(false);
    expect(pertenceAoContexto(MINHA_PESSOAL, 'work')).toBe(false);
  });

  it('delegada pessoal também sai da aba Pessoal', () => {
    expect(pertenceAoContexto({ context: 'personal', delegated_to: 'x' }, 'personal')).toBe(false);
  });

  it('string vazia em delegated_to não é delegação', () => {
    expect(pertenceAoContexto({ context: 'work', delegated_to: '' }, 'work')).toBe(true);
  });

  it('entrada torta nunca quebra', () => {
    expect(pertenceAoContexto(null, 'work')).toBe(false);
    expect(pertenceAoContexto(undefined, 'work')).toBe(false);
    expect(pertenceAoContexto({}, 'work')).toBe(false);
  });
});

describe('doContexto', () => {
  it('a agenda do Alf: 3 dele em vez de 20', () => {
    const mes = [
      ...Array.from({ length: 17 }, (_, i) => ({ context: 'work', delegated_to: `p${i}` })),
      MINHA_TRABALHO, MINHA_TRABALHO, MINHA_PESSOAL,
    ];
    expect(doContexto(mes, 'work')).toHaveLength(2);
    expect(doContexto(mes, 'personal')).toHaveLength(1);
    expect(doContexto(mes, 'delegated')).toHaveLength(17);
  });

  it('nada se perde: toda tarefa cai em exatamente uma aba', () => {
    const todas = [MINHA_TRABALHO, MINHA_PESSOAL, DELEGADA];
    const soma = doContexto(todas, 'work').length
      + doContexto(todas, 'personal').length
      + doContexto(todas, 'delegated').length;
    expect(soma).toBe(todas.length);
  });

  it('lista vazia ou torta devolve vazio', () => {
    expect(doContexto([], 'work')).toEqual([]);
    expect(doContexto(null, 'work')).toEqual([]);
    expect(doContexto(undefined, 'work')).toEqual([]);
  });
});
