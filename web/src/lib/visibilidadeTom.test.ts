import { describe, it, expect } from 'vitest';
import { estadoVisibilidadeTom } from './visibilidadeTom';

// A RPC get_credenciais_para libera pro time só com:
//   visivel_tom = true AND status = 'ok' AND url_ref is not null
// Estes testes fixam os DOIS outros fatores. Se alguém afrouxar a RPC sem mexer aqui (ou o
// contrário), a tela passa a mentir sobre o que vai acontecer.
describe('estadoVisibilidadeTom', () => {
  it('sem link, marcar seria no-op silencioso — desabilita e diz por quê', () => {
    for (const vazio of ['', '   ', null, undefined]) {
      const e = estadoVisibilidadeTom(vazio, 'ok');
      expect(e.podeMarcar).toBe(false);
      expect(e.hint).toMatch(/Link \/ Referência/);
    }
  });

  it('com link e status ok, explica o efeito exato', () => {
    const e = estadoVisibilidadeTom('https://x.com', 'ok');
    expect(e.podeMarcar).toBe(true);
    expect(e.hint).toMatch(/só o nome e o link/);
    expect(e.hint).toMatch(/nunca saem/);
  });

  it('status fora de ok deixa marcar mas avisa que ainda não vale', () => {
    for (const s of ['atencao', 'critico']) {
      const e = estadoVisibilidadeTom('https://x.com', s);
      expect(e.podeMarcar).toBe(true);
      expect(e.hint).toMatch(/status em OK/);
    }
  });

  it('status ausente é tratado como fora de ok', () => {
    expect(estadoVisibilidadeTom('https://x.com', null).hint).toMatch(/status em OK/);
    expect(estadoVisibilidadeTom('https://x.com', undefined).hint).toMatch(/status em OK/);
  });

  it('o hint nunca é vazio — a caixa jamais aparece sem explicação', () => {
    const casos: Array<[string | null, string | null]> = [
      ['https://x', 'ok'], ['https://x', 'critico'], ['', 'ok'], [null, null],
    ];
    for (const [u, s] of casos) expect(estadoVisibilidadeTom(u, s).hint.length).toBeGreaterThan(10);
  });
});
