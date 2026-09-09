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

// "Todos" (Alf, 09/09) — o dia é um só: trabalho + pessoal juntos, delegadas de fora.
describe('contexto "all"', () => {
  it('junta trabalho e pessoal', () => {
    expect(pertenceAoContexto(MINHA_TRABALHO, 'all')).toBe(true);
    expect(pertenceAoContexto(MINHA_PESSOAL, 'all')).toBe(true);
  });

  it('NÃO traz delegada — foi decisão explícita, não esquecimento', () => {
    // Na agenda do Alf, incluir delegadas em "Todos" devolveria 17 tarefas da Fabi e da
    // Jéssica pra tela que ele acabou de limpar.
    expect(pertenceAoContexto(DELEGADA, 'all')).toBe(false);
  });

  it('a soma de Todos + Delegadas cobre tudo, sem repetir', () => {
    const todas = [MINHA_TRABALHO, MINHA_PESSOAL, DELEGADA];
    expect(doContexto(todas, 'all')).toHaveLength(2);
    expect(doContexto(todas, 'delegated')).toHaveLength(1);
  });

  it('item sem contexto definido aparece em Todos', () => {
    // Tarefa antiga sem `context` sumia das duas abas e ninguém a via.
    expect(pertenceAoContexto({ context: null, delegated_to: null }, 'all')).toBe(true);
    expect(pertenceAoContexto({ context: null, delegated_to: null }, 'work')).toBe(false);
  });
});
