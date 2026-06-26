'use strict';
// Converte o "month" do marker set_bill_amount em competência YYYY-MM-01.
// Aceita ISO (YYYY-MM / YYYY-MM-DD) ou nome PT (agosto, ago...). Nome sem ano: ano corrente se o
// mês ainda não passou, senão próximo ano (o override é sempre do mês corrente p/ frente). Inválido → null.
const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

function parseBillMonth(month, todayYmd) {
  const s = String(month || '').trim().toLowerCase();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-01`;
  const m = MESES[s.slice(0, 3)];
  if (!m) return null;
  const [y0, m0] = String(todayYmd).split('-').map(Number);
  const year = m >= m0 ? y0 : y0 + 1;
  return `${year}-${String(m).padStart(2, '0')}-01`;
}

module.exports = { parseBillMonth };
