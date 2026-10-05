'use strict';
// Sensor DREAM_MEMORY — uma linha por noite com o quadro inteiro do Dream (03/09: sem estes números
// "noite tranquila" e "extrator quebrado" eram a mesma linha de log).
//
// DREAM-FALLBACK-INVISIVEL (05/10): o marker de 05/10 dizia `executed ... erros=0` numa noite em que
// o Claude deu timeout 3× e o Codex respondeu no lugar (rituals.log). `erros` só contava extrator que
// LANÇOU; resposta degradada por outro modelo passava como noite limpa — e foi o Codex quem escreveu
// o achado da Rose com categoria errada (c6b853b6). Agora `fallback=N` sai sempre (0 explícito, pra
// ausência não ser ambígua) e qualquer fallback marca a noite como `fallback`. Pura.
function sensorDoDream({ ymd, colabs = 0, cand = 0, salvas = 0, dedup = 0, magros = 0, erros = [], fallbacks = 0 } = {}) {
  const lista = Array.isArray(erros) ? erros : [];
  const n = Number(fallbacks) || 0;
  return {
    result: (lista.length || n > 0) ? 'fallback' : 'executed',
    reason: `dm:${ymd} colabs=${colabs} cand=${cand} salvas=${salvas}`
      + ` dedup=${dedup} magros=${magros} erros=${lista.length} fallback=${n}`
      + (lista.length ? ` [${lista.slice(0, 2).join('; ')}]` : ''),
  };
}

module.exports = { sensorDoDream };
