import { describe, it, expect } from 'vitest';
import { botoesDaEspera, modoComFallback, rotuloStatus } from './aprovacaoTarefa';

// BOTAO-APROVAR-OPERACOES (05/10): "Aprovar" mandava compra/obra que NINGUÉM executou pra 'done'.
// awaiting_confirmation = (a) aprovação pra executar OU (b) confirmação de conclusão ("Marcar pronto").
describe('botoesDaEspera', () => {
  it('(a) aprovação pra executar: "Aprovar compra/obra" / "Rejeitar" pelo funil do TOM (nunca done)', () => {
    const b = botoesDaEspera('aprovacao', true);
    expect(b).toEqual({ tipo: 'aprovacao', aprovar: 'Aprovar compra/obra', rejeitar: 'Rejeitar' });
  });

  it('(b) confirmação de conclusão: "Confirmar conclusão" → done e "Reabrir" → in_progress', () => {
    const b = botoesDaEspera('conclusao', true);
    expect(b).toEqual({
      tipo: 'conclusao',
      confirmar: { rotulo: 'Confirmar conclusão', proximo: 'done' },
      reabrir: { rotulo: 'Reabrir', proximo: 'in_progress' },
    });
  });

  it('sem papel de aprovador: só o aviso, no sentido certo', () => {
    expect(botoesDaEspera('aprovacao', false)).toEqual({ tipo: 'aviso', texto: 'Aguardando aprovação da coordenação.' });
    expect(botoesDaEspera('conclusao', false)).toEqual({ tipo: 'aviso', texto: 'Aguardando a coordenação confirmar a conclusão.' });
  });

  it('modo ainda desconhecido: não oferece botão nenhum (nada de chutar done)', () => {
    expect(botoesDaEspera(null, true)).toEqual({ tipo: 'carregando' });
  });
});

describe('modoComFallback', () => {
  it('usa o modo do TOM quando veio', () => {
    expect(modoComFallback({ modoServidor: 'conclusao', falhou: false, requerAprovacao: true })).toBe('conclusao');
  });
  it('TOM fora do ar: cai no tipo da demanda (requires_approval → aprovação)', () => {
    expect(modoComFallback({ modoServidor: undefined, falhou: true, requerAprovacao: true })).toBe('aprovacao');
    expect(modoComFallback({ modoServidor: undefined, falhou: true, requerAprovacao: false })).toBe('conclusao');
  });
  it('ainda carregando: null', () => {
    expect(modoComFallback({ modoServidor: undefined, falhou: false, requerAprovacao: true })).toBeNull();
  });
});

describe('rotuloStatus', () => {
  it('awaiting_confirmation diz o que está esperando', () => {
    expect(rotuloStatus('awaiting_confirmation', 'aprovacao')).toBe('Aguardando aprovação');
    expect(rotuloStatus('awaiting_confirmation', 'conclusao')).toBe('Aguardando confirmação');
    expect(rotuloStatus('awaiting_confirmation', null)).toBe('Aguardando aprovação');
  });
  it('demais status seguem o rótulo operacional', () => {
    expect(rotuloStatus('pending', null)).toBe('Pendente');
    expect(rotuloStatus('xyz', null)).toBe('xyz');
  });
});
