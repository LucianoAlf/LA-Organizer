// scripts/smoke-decompose.js
// Smoke offline: roda decomposeIfLarge contra 2 transcripts reais.
// Não chama Whisper (texto já dado). Não persiste no Supabase.
// Roda contra o Claude CLI REAL — testa latência e qualidade da extração.
const dec = require('../src/services/audio-decompose');

const CASE_LONG = `[áudio transcrito] Tom, bom dia. Olha, preciso que você tome conta de algumas coisas pra mim. Primeiro, marca uma reunião com a Juliana pra terça-feira no fim do dia, umas 18h, pra revisar o calendário do mês. Ah, também queria que você cobrasse o Rafinha sobre o relatório de matrículas — ele tinha prometido pra ontem e até agora nada. Outra coisa, por favor, manda comprar pilha tamanho AA pra microfonia da unidade Tatuapé, antes de sexta. E avisa o Yuri que a reunião de equipe vai mudar de quinta pra sexta, mesma hora. Ah, e lembra de mim na semana que vem pra eu fazer o checkpoint do projeto novo do LA Journey. Acho que é só isso. Valeu.`;
const CASE_SHORT = `[áudio transcrito] Marca reunião com Juliana terça às 18h.`;
// Caso médio — fronteira do gate: ~450 chars, 3 demandas, densidade média.
const CASE_MEDIUM = `[áudio transcrito] Tom, dá uma olhada nessas coisas pra mim. Marca reunião com a Anne quinta de manhã pra falar do orçamento. Também preciso que você cobre o relatório de matrículas que o Rafa tinha que mandar ontem. Ah, e por favor, lembra de mim sexta de manhã pra eu revisar o checkpoint do projeto novo. Valeu.`;

(async () => {
  console.log('--- Caso longo (Peterson-like) ---');
  const r1 = await dec.decomposeIfLarge(CASE_LONG);
  console.log(JSON.stringify({
    decomposed: r1.decomposed,
    items_count: r1.items.length,
    latency_ms: r1.latencyMs,
    reason: r1.reason,
  }, null, 2));
  console.log('Items:');
  r1.items.forEach((it, i) => console.log(`  ${i + 1}. ${it}`));
  console.log('\nrewrittenText (primeiros 500 chars):');
  console.log((r1.rewrittenText || '').slice(0, 500));

  console.log('\n--- Caso curto ---');
  const r2 = await dec.decomposeIfLarge(CASE_SHORT);
  console.log(JSON.stringify({
    decomposed: r2.decomposed,
    items_count: r2.items.length,
    latency_ms: r2.latencyMs,
    reason: r2.reason,
  }, null, 2));

  console.log(`\n--- Caso médio (fronteira do gate — ${CASE_MEDIUM.length} chars) ---`);
  const r3 = await dec.decomposeIfLarge(CASE_MEDIUM);
  console.log(JSON.stringify({
    decomposed: r3.decomposed,
    items_count: r3.items.length,
    latency_ms: r3.latencyMs,
    reason: r3.reason,
  }, null, 2));
  if (r3.decomposed) {
    console.log('Items:');
    r3.items.forEach((it, i) => console.log(`  ${i + 1}. ${it}`));
  }

  process.exit(0);
})().catch(err => { console.error('SMOKE FAIL:', err); process.exit(1); });
