// Port LITERAL de _remote/src/finance/projection.js (Fase A).
// REGRA: muda fórmula aqui? muda no .js do engine também — senão o número diverge entre PWA e TOM.
// Taxas mensais (i decimal, ex: 0.0083 = 0.83%/mês).

export function futureValue(monthly: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return monthly * months;
  return monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

export function monthsToGoalSimple(target: number, current: number, monthly: number): number {
  const faltam = target - current;
  if (faltam <= 0) return 0;
  if (!monthly || monthly <= 0) return Infinity;
  return Math.ceil(faltam / monthly);
}

export function monthsToGoalWithInterest(target: number, current: number, monthly: number, monthlyRate: number): number {
  if (target - current <= 0) return 0;
  if ((!monthly || monthly <= 0) && (!current || monthlyRate === 0)) return Infinity;
  for (let n = 1; n <= 1200; n++) {
    const acc = current * Math.pow(1 + monthlyRate, n) + futureValue(monthly, monthlyRate, n);
    if (acc >= target) return n;
  }
  return Infinity;
}

export function formatMonths(n: number): string {
  if (!isFinite(n)) return 'tempo indefinido';
  const anos = Math.floor(n / 12);
  const meses = n % 12;
  const partes: string[] = [];
  if (anos > 0) partes.push(anos === 1 ? '1 ano' : `${anos} anos`);
  if (meses > 0) partes.push(meses === 1 ? '1 mês' : `${meses} meses`);
  if (partes.length === 0) return 'menos de 1 mês';
  return partes.join(' e ');
}

// v1 (spec §9): taxa rotulada como "estimativa ~10,5%/ano". Constante única usada por
// projeção/simulador na Fase C. Quando a v1.1 puser Selic viva numa tabela de config,
// trocar aqui (e o rótulo passa a ser dinâmico).
export const ANNUAL_RATE_ESTIMATE_PCT = 10.5;
export const MONTHLY_RATE_ESTIMATE = Math.pow(1 + ANNUAL_RATE_ESTIMATE_PCT / 100, 1 / 12) - 1;
export const RATE_LABEL = 'estimativa ~10,5%/ano';
