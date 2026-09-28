import { describe, it, expect } from 'vitest';
import { contagemRegressiva, filtrarSecoes, porcentagem, type PixSecao } from './pixPainel';

// Prazo = fim do dia 31/10 em Brasília (23:59:59 -03:00).
describe('contagemRegressiva', () => {
  it('28/09 12:00 BRT → 33 dias, 11h, 59min', () => {
    const agora = Date.parse('2026-09-28T12:00:00-03:00');
    expect(contagemRegressiva('2026-10-31', agora)).toEqual({ dias: 33, horas: 11, minutos: 59, segundos: 59, vencida: false });
  });
  it('no próprio dia da meta ainda conta as horas', () => {
    const agora = Date.parse('2026-10-31T20:00:00-03:00');
    expect(contagemRegressiva('2026-10-31', agora)).toMatchObject({ dias: 0, horas: 3, minutos: 59, vencida: false });
  });
  it('depois do prazo: vencida, tudo zero', () => {
    const agora = Date.parse('2026-11-01T00:00:01-03:00');
    expect(contagemRegressiva('2026-10-31', agora)).toEqual({ dias: 0, horas: 0, minutos: 0, segundos: 0, vencida: true });
  });
});

describe('porcentagem', () => {
  it('arredonda e protege divisão por zero', () => {
    expect(porcentagem(10, 53)).toBe(19);
    expect(porcentagem(0, 0)).toBe(0);
  });
});

const SECOES: PixSecao[] = [
  { chave: 'pix_avulso', emoji: '🔴', nome: 'Pix avulso', nota: null, n: 2, clientes: [{ nome: 'Camila Coutinho', alunos: ['Daniel Victor'] }, { nome: 'Jorge Marinho', alunos: ['Pedro'] }] },
  { chave: 'bloqueio_emusys', emoji: '🔒', nome: 'Aguardando o Emusys', nota: 'x', n: 1, clientes: [{ nome: 'Clara Lapa', alunos: ['Bento', 'Tito'] }] },
];

describe('filtrarSecoes', () => {
  it('sem filtro e sem busca: tudo', () => {
    expect(filtrarSecoes(SECOES, 'todas', '')).toEqual(SECOES);
  });
  it('filtro por seção', () => {
    expect(filtrarSecoes(SECOES, 'bloqueio_emusys', '').map((s) => s.chave)).toEqual(['bloqueio_emusys']);
  });
  it('busca sem acento e sem caixa, no responsável OU no aluno; seção vazia some', () => {
    expect(filtrarSecoes(SECOES, 'todas', 'DANIEL vIctor')).toEqual([{ ...SECOES[0], clientes: [SECOES[0].clientes[0]] }]);
    expect(filtrarSecoes(SECOES, 'todas', 'tito').map((s) => s.chave)).toEqual(['bloqueio_emusys']);
    expect(filtrarSecoes([{ ...SECOES[0], clientes: [{ nome: 'Fátima', alunos: [] }] }], 'todas', 'fatima')).toHaveLength(1);
    expect(filtrarSecoes(SECOES, 'todas', 'ninguém')).toEqual([]);
  });
});
