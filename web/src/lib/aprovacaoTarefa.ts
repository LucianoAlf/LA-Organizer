// web/src/lib/aprovacaoTarefa.ts — BOTAO-APROVAR-OPERACOES (05/10).
// awaiting_confirmation tem dois sentidos e o botão tem que saber qual:
//  'aprovacao' — compra/obra que nasceu aguardando aprovação pra SER FEITA. Aprovar → 'pending' e
//                Rejeitar → 'cancelled', SEMPRE pelo TOM (POST /internal/tarefa-aprovacao/decidir),
//                que fecha o APROV-XXXX e avisa quem pediu no WhatsApp. Nunca 'done'.
//  'conclusao' — "Marcar pronto" (in_progress → awaiting_confirmation): Confirmar conclusão → 'done',
//                Reabrir → 'in_progress', direto no app como sempre.
// Quem decide o modo é o TOM (GET /internal/tarefa-aprovacao, pela trilha tasks_audit); aqui só a TELA.
import { STATUS_LABEL_OPERATIONAL } from '../types';

export type ModoEspera = 'aprovacao' | 'conclusao';

export type BotoesEspera =
  | { tipo: 'aprovacao'; aprovar: string; rejeitar: string }
  | {
      tipo: 'conclusao';
      confirmar: { rotulo: string; proximo: 'done' };
      reabrir: { rotulo: string; proximo: 'in_progress' };
    }
  | { tipo: 'aviso'; texto: string }
  | { tipo: 'carregando' };

export function botoesDaEspera(modo: ModoEspera | null | undefined, podeAprovar: boolean): BotoesEspera {
  if (!modo) return { tipo: 'carregando' };
  if (!podeAprovar) {
    return {
      tipo: 'aviso',
      texto: modo === 'aprovacao' ? 'Aguardando aprovação da coordenação.' : 'Aguardando a coordenação confirmar a conclusão.',
    };
  }
  if (modo === 'aprovacao') return { tipo: 'aprovacao', aprovar: 'Aprovar compra/obra', rejeitar: 'Rejeitar' };
  return {
    tipo: 'conclusao',
    confirmar: { rotulo: 'Confirmar conclusão', proximo: 'done' },
    reabrir: { rotulo: 'Reabrir', proximo: 'in_progress' },
  };
}

/** Modo do TOM; se o TOM não respondeu, cai no tipo da demanda (o POST confere de novo no servidor). */
export function modoComFallback(args: {
  modoServidor: ModoEspera | null | undefined;
  falhou: boolean;
  requerAprovacao: boolean | null | undefined;
}): ModoEspera | null {
  if (args.modoServidor) return args.modoServidor;
  if (args.falhou) return args.requerAprovacao ? 'aprovacao' : 'conclusao';
  return null;
}

export function rotuloStatus(status: string, modo: ModoEspera | null | undefined): string {
  if (status === 'awaiting_confirmation') return modo === 'conclusao' ? 'Aguardando confirmação' : 'Aguardando aprovação';
  return STATUS_LABEL_OPERATIONAL[status] ?? status;
}
