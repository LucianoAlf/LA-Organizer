// LAOR-2 item 2 — o controle de `visivel_tom`, que até 04/09 só existia como coluna no banco.
//
// A regra do escopo público mora na RPC get_credenciais_para e é uma CONJUNÇÃO:
//   visivel_tom = true  AND  status = 'ok'  AND  url_ref is not null
//
// Ou seja: marcar a caixa sem link, ou com status atenção/crítico, é um NO-OP silencioso —
// a pessoa acha que liberou pro time e nada muda. Este módulo existe pra que a tela diga
// isso na hora, em vez de deixar a descoberta pra depois. Se a condição da RPC mudar, os
// testes daqui quebram, e é isso que se quer: os dois lados têm de contar a mesma história.

export type EstadoVisibilidade = {
  /** false = marcar não teria efeito nenhum; a tela desabilita a caixa */
  podeMarcar: boolean;
  /** texto sob a caixa, sempre presente — explica efeito ou impedimento */
  hint: string;
};

export function estadoVisibilidadeTom(urlRef: string | null | undefined, status: string | null | undefined): EstadoVisibilidade {
  const temLink = typeof urlRef === 'string' && urlRef.trim().length > 0;
  if (!temLink) {
    return {
      podeMarcar: false,
      hint: 'Precisa de um link — é só ele que o time recebe. Preencha "Link / Referência" acima.',
    };
  }
  if (status !== 'ok') {
    return {
      podeMarcar: true,
      hint: 'Marcado, mas o TOM só passa o link com o status em OK. Enquanto estiver assim, o time não vê.',
    };
  }
  return {
    podeMarcar: true,
    hint: 'O time recebe só o nome e o link quando perguntar ao TOM. Os campos (senha, token) nunca saem.',
  };
}

export const LABEL_VISIVEL_TOM = 'O TOM pode passar esse link pro time inteiro';
