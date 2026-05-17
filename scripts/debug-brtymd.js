// Reproduz o bug do brtYmd
const s = new Date().toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo' });
console.log('raw toLocaleString:', JSON.stringify(s));

const d = new Date(s);
console.log('parsed valid?', !isNaN(d.getTime()));
console.log('parsed date:', d.toString());

// Tenta toISOString
try {
  console.log('toISOString:', d.toISOString());
} catch (e) {
  console.log('toISOString FAILED:', e.message);
}

// Alternativa correta usando Intl.DateTimeFormat
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
console.log('Intl format:', fmt.format(new Date()));
