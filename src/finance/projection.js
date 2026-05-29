// Projecao de meta e juros compostos (PRD §7.2). Puro. Taxas mensais (i decimal, ex 0.0083 = 0.83%/mes).

// Valor futuro de aportes mensais: M = P * ((1+i)^n - 1) / i
function futureValue(monthly, monthlyRate, months) {
  if (monthlyRate === 0) return monthly * months;
  return monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

// Meses pra atingir a meta sem juros (arredonda pra cima).
function monthsToGoalSimple(target, current, monthly) {
  const faltam = target - current;
  if (faltam <= 0) return 0;
  if (!monthly || monthly <= 0) return Infinity;
  return Math.ceil(faltam / monthly);
}

// Meses pra atingir a meta com juros compostos (menor n tal que current*(1+i)^n + FV(aporte) >= target).
function monthsToGoalWithInterest(target, current, monthly, monthlyRate) {
  if (target - current <= 0) return 0;
  if ((!monthly || monthly <= 0) && (!current || monthlyRate === 0)) return Infinity;
  for (let n = 1; n <= 1200; n++) {
    const acc = current * Math.pow(1 + monthlyRate, n) + futureValue(monthly, monthlyRate, n);
    if (acc >= target) return n;
  }
  return Infinity;
}

function formatMonths(n) {
  if (!isFinite(n)) return 'tempo indefinido';
  const anos = Math.floor(n / 12);
  const meses = n % 12;
  const partes = [];
  if (anos > 0) partes.push(anos === 1 ? '1 ano' : `${anos} anos`);
  if (meses > 0) partes.push(meses === 1 ? '1 mês' : `${meses} meses`);
  if (partes.length === 0) return 'menos de 1 mês';
  return partes.join(' e ');
}

module.exports = { futureValue, monthsToGoalSimple, monthsToGoalWithInterest, formatMonths };
