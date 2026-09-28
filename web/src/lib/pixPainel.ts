// web/src/lib/pixPainel.ts — painel "PIX automático" na área do grupo (Alf, 28/09).
// Os dados vêm prontos do TOM (GET /internal/pix-painel — mesmas regras da mensagem do grupo e do
// relatório de segunda). Aqui só o que é da TELA: relógio até a meta, porcentagem, filtro e busca.
// (A busca na rede mora em hooks/usePixPainel.ts — este arquivo é puro e testado.)

export interface PixCliente { nome: string; alunos: string[] }
export interface PixSecao { chave: string; emoji: string; nome: string; nota: string | null; n: number; clientes: PixCliente[] }
export interface PixPainel {
  unidade: string | null;
  metaYmd: string;
  total: number;
  migrados: number;
  faltam: number;
  aguardandoEmusys: number;
  /** 💳 cartão recorrente cadastrado no Emusys, mas pagou a última por PIX — conferir (28/09). */
  cartaoCadastrado?: number;
  cadastradosSemCobranca: number;
  dadoEm: string | null;
  faltamSecoes: PixSecao[];
  jaMigraram: (PixCliente & { migrouEm: string | null })[];
}

export interface Contagem { dias: number; horas: number; minutos: number; segundos: number; vencida: boolean }

/** Relógio até o FIM do dia da meta em Brasília (23:59:59 -03:00). */
export function contagemRegressiva(metaYmd: string, agoraMs: number): Contagem {
  const fim = Date.parse(`${metaYmd}T23:59:59-03:00`);
  const resto = Math.floor((fim - agoraMs) / 1000);
  if (!Number.isFinite(resto) || resto < 0) return { dias: 0, horas: 0, minutos: 0, segundos: 0, vencida: true };
  return {
    dias: Math.floor(resto / 86400),
    horas: Math.floor((resto % 86400) / 3600),
    minutos: Math.floor((resto % 3600) / 60),
    segundos: resto % 60,
    vencida: false,
  };
}

export function porcentagem(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Filtra por seção ('todas' = sem filtro) e busca no responsável OU nos alunos (sem acento/caixa). */
export function filtrarSecoes(secoes: PixSecao[], secao: string, busca: string): PixSecao[] {
  const q = norm(busca || '');
  const out: PixSecao[] = [];
  for (const s of secoes) {
    if (secao !== 'todas' && s.chave !== secao) continue;
    if (!q) { out.push(s); continue; }
    const clientes = s.clientes.filter((c) => norm(c.nome).includes(q) || c.alunos.some((a) => norm(a).includes(q)));
    if (clientes.length) out.push({ ...s, clientes });
  }
  return out;
}

export type ResultadoPainel = { tipo: 'ok'; painel: PixPainel } | { tipo: 'sem_unidade' } | { tipo: 'erro'; motivo: string };
